import { describe, expect, it } from "vitest";
import {
  analyzeJob, buildJob, canonicalSkill, canonicalizeUrl, dedupeJobs, extractSkills, parseResumeText, structureJobText,
  estimateYears, findDuplicate, scoreLabel, jobAnalysisSchema, DEFAULT_WEIGHTS, analysisCacheKey, careerProfileSchema,
} from "../src";
import { JD_TEXT, RESUME_TEXT } from "./fixtures";

describe("skill normalization", () => {
  it("maps synonyms to canonical names", () => {
    expect(canonicalSkill("JS")).toBe("JavaScript");
    expect(canonicalSkill("postgres")).toBe("PostgreSQL");
    expect(canonicalSkill("ReactJS")).toBe("React");
    expect(canonicalSkill("k8s")).toBe("Kubernetes");
  });
  it("extracts each skill once and handles symbols", () => {
    const s = extractSkills("We use C++, C#, Node.js, node js and Node.js again. React React React");
    expect(s.filter((x) => x === "Node.js")).toHaveLength(1);
    expect(s).toEqual(expect.arrayContaining(["C++", "C#", "React"]));
  });
  it("does not match 'java' inside 'javascript'", () => {
    expect(extractSkills("javascript developer")).not.toContain("Java");
  });
});

describe("resume parsing", () => {
  const { profile, confidence, flags } = parseResumeText(RESUME_TEXT);
  it("extracts contact", () => {
    expect(profile.contact.fullName).toBe("Rahul Sharma");
    expect(profile.contact.email).toBe("rahul.sharma@example.com");
    expect(profile.contact.phone.replace(/\D/g, "")).toContain("9876543210");
    expect(profile.contact.links.some((l) => l.includes("github.com/rahuls"))).toBe(true);
  });
  it("extracts skills as unverified 'working', never upgrading", () => {
    expect(profile.skills.map((s) => s.name)).toEqual(expect.arrayContaining(["React", "Node.js", "MongoDB", "TypeScript"]));
    expect(profile.skills.every((s) => s.level === "working" && !s.verified)).toBe(true);
  });
  it("extracts experience, projects, education, certifications", () => {
    expect(profile.workExperience).toHaveLength(2);
    expect(profile.workExperience[0]).toMatchObject({ title: "Software Engineer", company: "Acme Technologies", current: true });
    expect(profile.workExperience[1]).toMatchObject({ title: "Junior Developer", company: "Beta Soft" });
    expect(profile.workExperience[0]!.bullets).toHaveLength(3);
    expect(profile.projects.map((p) => p.name)).toEqual(["Expense Tracker", "Chat App"]);
    expect(profile.education[0]!.degree).toMatch(/B\.?Tech/i);
    expect(profile.certifications).toContain("MongoDB Associate Developer");
  });
  it("reports confidence and flags", () => {
    expect(confidence).toBeGreaterThan(0.7);
    expect(flags.some((f) => /Working knowledge/.test(f.message))).toBe(true);
  });
  it("flags near-empty text", () => {
    const r = parseResumeText("hello");
    expect(r.confidence).toBeLessThan(0.3);
    expect(r.flags.some((f) => f.field === "text")).toBe(true);
  });
  it("produces a schema-valid profile", () => {
    expect(() => careerProfileSchema.parse(profile)).not.toThrow();
  });
});

describe("dates", () => {
  it("merges overlapping ranges", () => {
    const y = estimateYears([{ start: "Jan 2020", end: "Jan 2022", current: false }, { start: "Jun 2021", end: "Jan 2023", current: false }]);
    expect(y).toBe(3);
  });
  it("returns null with no dates", () => expect(estimateYears([{ start: "", end: "" }])).toBeNull());
});

describe("job structuring", () => {
  const s = structureJobText(JD_TEXT);
  it("separates required and preferred skills", () => {
    expect(s.requiredSkills).toEqual(expect.arrayContaining(["JavaScript", "React", "Node.js", "MongoDB", "AWS", "Kubernetes"]));
    expect(s.preferredSkills).toEqual(expect.arrayContaining(["TypeScript", "GraphQL", "Docker"]));
    expect(s.requiredSkills).not.toContain("TypeScript");
  });
  it("parses experience, mode, type and salary", () => {
    expect(s.minYears).toBe(3);
    expect(s.workMode).toBe("hybrid");
    expect(s.employmentType).toBe("Full-time");
    expect(s.salaryRange).toMatch(/12/);
  });
  it("lets required win when a skill appears in both", () => {
    const r = structureJobText("Requirements\n- React\nNice to have\n- React and GraphQL");
    expect(r.requiredSkills).toContain("React");
    expect(r.preferredSkills).not.toContain("React");
  });
});

describe("scoring", () => {
  const { profile } = parseResumeText(RESUME_TEXT);
  const job = buildJob({ title: "MERN Stack Developer", company: "LogiCo", location: "Pune", description: JD_TEXT });
  const run = (p = profile, j = job) => analyzeJob({ job: j, profile: p, resumeId: "r1", resumeText: RESUME_TEXT });

  it("returns schema-valid result in 0..100 with weights summing to 100", () => {
    const a = run();
    expect(() => jobAnalysisSchema.parse(a)).not.toThrow();
    expect(a.totalScore).toBeGreaterThanOrEqual(0);
    expect(a.totalScore).toBeLessThanOrEqual(100);
    const w = a.breakdown.filter((b) => !b.notApplicable).reduce((s, b) => s + b.weight, 0);
    expect(Math.round(w)).toBe(100);
  });
  it("matches formula sum(score*weight)", () => {
    const a = run();
    const total = a.breakdown.reduce((s, b) => s + (b.score * b.weight) / 100, 0);
    expect(Math.abs(total - a.totalScore)).toBeLessThan(2);
  });
  it("labels missing skills as 'not found', not confirmed missing", () => {
    const a = run();
    const k = a.skillMatches.find((m) => m.skill === "Kubernetes")!;
    expect(k.status).toBe("not_found");
    expect(a.recommendations.join(" ")).toMatch(/Not found in your resume/);
    expect(a.explanation).not.toMatch(/ATS score is/i);
  });
  it("only marks confirmed missing when the user says not applicable", () => {
    const p = { ...profile, skills: [...profile.skills, { name: "Kubernetes", level: "not_applicable" as const, verified: true, primary: false }] };
    expect(run(p).skillMatches.find((m) => m.skill === "Kubernetes")!.status).toBe("marked_not_applicable");
  });
  it("gives less credit to 'learning' than 'experienced'", () => {
    const mk = (level: "learning" | "experienced") => run({ ...profile, skills: profile.skills.map((s) => (s.name === "React" ? { ...s, level, verified: true } : s)) });
    const get = (a: ReturnType<typeof run>) => a.breakdown.find((b) => b.key === "requiredSkills")!.score;
    expect(get(mk("experienced"))).toBeGreaterThan(get(mk("learning")));
  });
  it("does not reward repeated keywords", () => {
    const j2 = buildJob({ title: "MERN Stack Developer", description: JD_TEXT + "\nReact React React React React React" });
    expect(run(profile, j2).breakdown.find((b) => b.key === "requiredSkills")!.score).toBe(run().breakdown.find((b) => b.key === "requiredSkills")!.score);
  });
  it("flags incomplete descriptions", () => {
    const j = buildJob({ title: "Dev", description: "Need React developer." });
    const a = run(profile, j);
    expect(a.incomplete).toBe(true);
    expect(a.incompleteReasons.join(" ")).toMatch(/short/);
  });
  it("redistributes weight when a category has no data", () => {
    const j = buildJob({ title: "MERN Developer", description: "Requirements\n- React\n- Node.js\n- MongoDB\n" + "x".repeat(10) });
    const a = run(profile, j);
    expect(a.breakdown.find((b) => b.key === "preferred")!.notApplicable).toBe(true);
  });
  it("cache key changes when resume changes, stable otherwise", () => {
    const k1 = analysisCacheKey({ job, profile, resumeText: RESUME_TEXT });
    expect(analysisCacheKey({ job, profile, resumeText: RESUME_TEXT })).toBe(k1);
    expect(analysisCacheKey({ job, profile, resumeText: RESUME_TEXT + " more" })).not.toBe(k1);
  });
  it("labels", () => {
    expect([scoreLabel(90), scoreLabel(85), scoreLabel(84), scoreLabel(70), scoreLabel(69), scoreLabel(55), scoreLabel(54)]).toEqual(
      ["Excellent match", "Excellent match", "Strong match", "Strong match", "Partial match", "Partial match", "Low match"]);
    expect(DEFAULT_WEIGHTS.requiredSkills + DEFAULT_WEIGHTS.experience + DEFAULT_WEIGHTS.roleAlignment + DEFAULT_WEIGHTS.projects + DEFAULT_WEIGHTS.preferred).toBe(100);
  });
  it("a strong candidate outscores an unrelated profile", () => {
    const empty = parseResumeText("Jane Doe\njane@x.com\nSKILLS\nPhotoshop, Illustrator, Figma\nEXPERIENCE\nDesigner at Studio   Jan 2020 - Present\n• Designed posters");
    const a = run(profile);
    const b = analyzeJob({ job, profile: empty.profile, resumeId: "r2", resumeText: "Jane Doe Photoshop" });
    expect(a.totalScore).toBeGreaterThan(b.totalScore + 25);
  });
});

describe("urls and dedupe", () => {
  it("canonicalizes tracking params, www and trailing slash", () => {
    expect(canonicalizeUrl("https://www.Example.com/jobs/1/?utm_source=x&b=2&a=1#top")).toBe("example.com/jobs/1?a=1&b=2");
  });
  it("collapses LinkedIn URL variants", () => {
    expect(canonicalizeUrl("https://www.linkedin.com/jobs/view/senior-dev-at-acme-3812345678/?trk=abc")).toBe("linkedin.com/jobs/view/3812345678");
    expect(canonicalizeUrl("https://www.linkedin.com/jobs/search/?currentJobId=3812345678&keywords=x")).toBe("linkedin.com/jobs/view/3812345678");
  });
  it("rejects non-http urls", () => expect(canonicalizeUrl("javascript:alert(1)")).toBe(""));
  it("detects duplicates by url and fingerprint", () => {
    const a = buildJob({ title: "React Dev", company: "Acme Pvt Ltd", location: "Pune, India", url: "https://x.com/j/1?utm_source=a", description: "React role" });
    const b = buildJob({ title: "React Dev", company: "ACME", location: "Pune", description: "different text" });
    const c = buildJob({ title: "Other", company: "Z", url: "https://x.com/j/1", description: "other" });
    expect(findDuplicate(b, [a])?.reason).toBe("fingerprint");
    expect(findDuplicate(c, [a])?.reason).toBe("canonical_url");
    expect(dedupeJobs([a, b, c])).toHaveLength(1);
  });
  it("rejects empty descriptions", () => expect(() => buildJob({ description: "   " })).toThrow());
});
