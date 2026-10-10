import type { CareerProfile, Job, JobAnalysis, ScoreBreakdownItem, SkillMatch, CategoryKey } from "../schemas";
import { canonicalSkill, textMentionsSkill, findEvidence } from "../skills/extract";
import { estimateYears } from "../parsing/dates";
import { clamp, hashString, normalizeSpace, uid, nowIso } from "../util";

export const MODEL_VERSION = "deterministic-1.0";

export type Weights = Record<CategoryKey, number>;
export const DEFAULT_WEIGHTS: Weights = { requiredSkills: 35, experience: 25, roleAlignment: 20, projects: 10, preferred: 10 };

const LABELS: Record<CategoryKey, string> = {
  requiredSkills: "Required skills coverage",
  experience: "Relevant experience",
  roleAlignment: "Role & responsibility alignment",
  projects: "Relevant projects & achievements",
  preferred: "Preferred skills & qualifications",
};

export function scoreLabel(score: number): JobAnalysis["label"] {
  if (score >= 85) return "Excellent match";
  if (score >= 70) return "Strong match";
  if (score >= 55) return "Partial match";
  return "Low match";
}

const STOP = new Set("the a an and or of to in for with on at by from as is are be will you your we our their this that these those it its etc using use work working experience years year strong good great knowledge ability able team teams including include role skills required preferred looking join company candidate responsibilities should must have has having plus about across into such other more than who what which can per well new".split(" "));

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ").split(/\s+/).map((t) => t.replace(/^\.+|\.+$/g, "")).filter((t) => t.length > 2 && !STOP.has(t));
}
const stem = (t: string) => t.replace(/(ing|ed|es|s|er|ers|ment)$/, "");
const TITLE_SYN: Record<string, string> = { developer: "engineer", programmer: "engineer", engineering: "engineer", fullstack: "full", "full-stack": "full", sde: "engineer", swe: "engineer" };
function titleTokens(title: string): Set<string> {
  return new Set(
    title.toLowerCase().replace(/[^a-z0-9+#\s-]/g, " ").split(/[\s-]+/)
      .filter((t) => t && !["sr", "senior", "jr", "junior", "lead", "ii", "iii", "i", "the", "a", "and", "of", "stack"].includes(t))
      .map((t) => TITLE_SYN[t] ?? stem(t)),
  );
}
function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a), B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.min(A.size, B.size);
}

export interface AnalyzeInput {
  job: Job;
  profile: CareerProfile;
  resumeId: string;
  resumeText: string;
  weights?: Partial<Weights>;
  now?: Date;
}

const levelCredit = { experienced: 1, working: 0.8, learning: 0.35 } as const;

function profileText(profile: CareerProfile): string {
  return [
    profile.summary, profile.currentRole,
    ...profile.workExperience.flatMap((w) => [w.title, ...w.bullets]),
    ...profile.projects.flatMap((p) => [p.name, p.description, ...p.technologies, ...p.bullets]),
    ...profile.certifications,
  ].join("\n");
}

export function analysisCacheKey(input: Pick<AnalyzeInput, "job" | "profile" | "resumeText" | "weights">): string {
  return hashString([MODEL_VERSION, input.job.contentHash, input.job.requiredSkills.join(","), input.job.preferredSkills.join(","), input.job.minYears, hashString(input.resumeText), JSON.stringify(input.profile), JSON.stringify(input.weights ?? {})].join("|"));
}

export function analyzeJob(input: AnalyzeInput): JobAnalysis {
  const { job, profile, resumeText } = input;
  const weights: Weights = { ...DEFAULT_WEIGHTS, ...input.weights };
  const incompleteReasons: string[] = [];
  const pText = profileText(profile);
  const fullText = `${resumeText}\n${pText}`;

  const profileSkillMap = new Map(profile.skills.map((s) => [canonicalSkill(s.name), s]));

  const matchSkill = (skill: string, required: boolean): { match: SkillMatch; credit: number } => {
    const canon = canonicalSkill(skill);
    const ps = profileSkillMap.get(canon);
    if (ps?.level === "not_applicable") return { match: { skill: canon, status: "marked_not_applicable", evidence: "You marked this skill as not applicable.", required }, credit: 0 };
    if (ps) {
      const credit = levelCredit[ps.level] * (ps.verified ? 1 : 0.9);
      return {
        match: { skill: canon, status: ps.level === "learning" ? "matched_learning" : "matched_verified", evidence: findEvidence(fullText, canon) || `Listed in your profile as "${ps.level}"${ps.verified ? "" : " (not yet verified by you)"}.`, required },
        credit,
      };
    }
    if (textMentionsSkill(fullText, canon)) return { match: { skill: canon, status: "matched_text_only", evidence: findEvidence(fullText, canon), required }, credit: 0.6 };
    return { match: { skill: canon, status: "not_found", evidence: "", required }, credit: 0 };
  };

  const reqResults = job.requiredSkills.map((s) => matchSkill(s, true));
  const prefResults = job.preferredSkills.map((s) => matchSkill(s, false));
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  // 1. Required skills
  const reqScore = clamp(mean(reqResults.map((r) => r.credit)) * 100);
  const reqMatched = reqResults.filter((r) => r.credit > 0).length;

  // 2. Preferred
  const prefScore = clamp(mean(prefResults.map((r) => r.credit)) * 100);

  // 3. Experience
  let years = profile.yearsOfExperience;
  if (years === null) years = estimateYears(profile.workExperience, input.now);
  const expParts: Array<{ score: number; w: number; note: string }> = [];
  if (job.minYears !== null && years !== null) {
    let s: number;
    if (years >= job.minYears) s = job.maxYears !== null && years > job.maxYears + 4 ? 85 : 100;
    else s = clamp(Math.pow(years / Math.max(job.minYears, 0.5), 1.5) * 100);
    expParts.push({ score: s, w: 0.6, note: `${years} yrs vs ${job.experienceRequirements || job.minYears + "+ yrs"} requested` });
  } else if (job.minYears === null) incompleteReasons.push("The job does not state required years of experience.");
  else incompleteReasons.push("Your years of experience are not set in your profile.");
  const titles = [profile.currentRole, ...profile.targetRoles, ...profile.workExperience.map((w) => w.title)].filter(Boolean);
  if (job.title && titles.length) {
    const best = Math.max(...titles.map((t) => titleSimilarity(job.title, t)));
    expParts.push({ score: best * 100, w: 0.4, note: `title similarity ${(best * 100).toFixed(0)}%` });
  } else if (job.title) incompleteReasons.push("No job titles in your profile to compare against.");
  const expNA = expParts.length === 0;
  const expScore = expNA ? 0 : clamp(expParts.reduce((a, p) => a + p.score * p.w, 0) / expParts.reduce((a, p) => a + p.w, 0));

  // 4. Role alignment (unique significant terms from responsibilities, no repetition reward)
  const respText = job.responsibilities.length ? job.responsibilities.join(" ") : job.description;
  const skillWords = new Set([...job.requiredSkills, ...job.preferredSkills].flatMap((s) => tokens(s)));
  const jobTerms = [...new Set(tokens(respText).map(stem))].filter((t) => !skillWords.has(t));
  const haveTerms = new Set(tokens(fullText).map(stem));
  const termCoverage = jobTerms.length ? jobTerms.filter((t) => haveTerms.has(t)).length / jobTerms.length : 0;
  const bestTitle = titles.length && job.title ? Math.max(...titles.map((t) => titleSimilarity(job.title, t))) : 0;
  const roleNA = !jobTerms.length && !job.title;
  // Term coverage of long JDs tops out low even for good fits, so it is scaled (documented in TESTING/ARCHITECTURE).
  const roleScore = roleNA ? 0 : clamp((jobTerms.length ? Math.min(1, termCoverage / 0.6) : bestTitle) * 60 + bestTitle * 40);

  // 5. Projects & achievements
  const evidenceBlocks = [
    ...profile.projects.map((p) => ({ name: p.name || "Untitled project", text: [p.name, p.description, ...p.technologies, ...p.bullets].join(" ") })),
    ...profile.workExperience.map((w) => ({ name: `${w.title}${w.company ? " @ " + w.company : ""}`, text: w.bullets.join(" ") })),
  ].filter((b) => b.text.trim());
  const jobSkills = [...job.requiredSkills, ...job.preferredSkills].map(canonicalSkill);
  const relevantProjects: JobAnalysis["relevantProjects"] = [];
  const covered = new Set<string>();
  for (const b of evidenceBlocks) {
    const hits = jobSkills.filter((s) => textMentionsSkill(b.text, s));
    hits.forEach((h) => covered.add(h));
    if (hits.length) relevantProjects.push({ name: b.name, reason: `Mentions ${[...new Set(hits)].slice(0, 5).join(", ")}` });
  }
  relevantProjects.sort((a, b) => b.reason.length - a.reason.length);
  const projNA = evidenceBlocks.length === 0 || jobSkills.length === 0;
  if (evidenceBlocks.length === 0) incompleteReasons.push("No projects or achievements in your profile to compare.");
  const projScore = projNA ? 0 : clamp((covered.size / new Set(jobSkills).size) * 100);

  const prefNA = prefResults.length === 0;
  const reqNA = reqResults.length === 0;
  if (reqNA) incompleteReasons.push("No required skills could be detected in the job description.");
  if (job.description.length < 400) incompleteReasons.push("The job description is short; the score may be incomplete.");

  const raw: Record<CategoryKey, { score: number; na: boolean; why: string }> = {
    requiredSkills: { score: reqScore, na: reqNA, why: reqNA ? "No required skills detected." : `${reqMatched} of ${reqResults.length} required skills found in your profile/resume.` },
    experience: { score: expScore, na: expNA, why: expNA ? "Not enough information on either side." : expParts.map((p) => p.note).join("; ") + "." },
    roleAlignment: { score: roleScore, na: roleNA, why: `${Math.round(termCoverage * 100)}% of distinct responsibility terms appear in your background; title similarity ${Math.round(bestTitle * 100)}%.` },
    projects: { score: projScore, na: projNA, why: projNA ? "No project/achievement evidence to compare." : `${covered.size} of ${new Set(jobSkills).size} job skills are evidenced in projects or work achievements.` },
    preferred: { score: prefScore, na: prefNA, why: prefNA ? "No preferred skills listed." : `${prefResults.filter((r) => r.credit > 0).length} of ${prefResults.length} preferred skills found.` },
  };

  const keys = Object.keys(raw) as CategoryKey[];
  const activeWeight = keys.filter((k) => !raw[k].na).reduce((a, k) => a + weights[k], 0);
  const breakdown: ScoreBreakdownItem[] = keys.map((k) => {
    const w = raw[k].na || activeWeight === 0 ? 0 : (weights[k] / activeWeight) * 100;
    return { key: k, label: LABELS[k], score: Math.round(raw[k].score), weight: Math.round(w * 10) / 10, weighted: Math.round(((raw[k].score * w) / 100) * 10) / 10, explanation: raw[k].why, notApplicable: raw[k].na };
  });
  const total = activeWeight === 0 ? 0 : Math.round(clamp(keys.reduce((a, k) => a + (raw[k].na ? 0 : raw[k].score * weights[k]), 0) / activeWeight));

  const skillMatches = [...reqResults, ...prefResults].map((r) => r.match);
  const mentioned = skillMatches.filter((m) => m.status !== "not_found" && m.status !== "marked_not_applicable").length;
  const keywordCoverage = skillMatches.length ? Math.round((mentioned / skillMatches.length) * 100) : 0;

  const missingReq = skillMatches.filter((m) => m.required && m.status === "not_found").map((m) => m.skill);
  const missingPref = skillMatches.filter((m) => !m.required && m.status === "not_found").map((m) => m.skill);
  const experienceGaps: string[] = [];
  if (job.minYears !== null && years !== null && years < job.minYears) experienceGaps.push(`The role asks for ${job.experienceRequirements || job.minYears + "+ years"}; your profile shows about ${years}.`);
  if (job.title && titles.length && bestTitle < 0.4) experienceGaps.push(`None of your titles closely resemble "${job.title}".`);

  const recommendations: string[] = [];
  if (missingReq.length) recommendations.push(`Not found in your resume: ${missingReq.join(", ")}. If you have real experience with these, add them to your profile with evidence; if not, treat them as learning gaps — don't claim them.`);
  const learning = skillMatches.filter((m) => m.status === "matched_learning").map((m) => m.skill);
  if (learning.length) recommendations.push(`You marked ${learning.join(", ")} as "learning"; they earn partial credit only.`);
  const textOnly = skillMatches.filter((m) => m.status === "matched_text_only").map((m) => m.skill);
  if (textOnly.length) recommendations.push(`${textOnly.join(", ")} appear only in resume text. Add them to your profile skills with a level you can defend to raise confidence.`);
  if (missingPref.length) recommendations.push(`Preferred skills not found: ${missingPref.join(", ")}.`);
  if (!relevantProjects.length && jobSkills.length) recommendations.push("None of your projects or achievements mention the key technologies. Consider adding a relevant project if you have one.");
  if (job.requiredSkills.length && !reqNA && reqMatched === reqResults.length) recommendations.push("Your resume covers every required skill; make sure the top bullets show them in action.");

  const label = scoreLabel(total);
  const top = skillMatches.filter((m) => m.required && m.status === "matched_verified").slice(0, 3).map((m) => m.skill);
  const explanation =
    `${label} (${total}/100). ` +
    (reqNA ? "" : `${reqMatched} of ${reqResults.length} required skills were found. `) +
    (top.length ? `Strongest evidence: ${top.join(", ")}. ` : "") +
    (missingReq.length ? `Main gap (not found in resume): ${missingReq.slice(0, 3).join(", ")}. ` : "") +
    "This is a transparent skills-and-experience comparison, not an ATS score or a prediction of interview outcome.";

  return {
    id: uid(),
    jobId: job.id,
    resumeId: input.resumeId,
    cacheKey: analysisCacheKey(input),
    totalScore: total,
    label,
    breakdown,
    skillMatches,
    keywordCoverage,
    relevantProjects: relevantProjects.slice(0, 5),
    experienceGaps,
    recommendations,
    explanation: normalizeSpace(explanation),
    incomplete: incompleteReasons.length > 0,
    incompleteReasons: [...new Set(incompleteReasons)],
    modelVersion: MODEL_VERSION,
    createdAt: nowIso(),
  };
}
