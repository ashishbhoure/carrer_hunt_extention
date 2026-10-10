import type { CareerProfile, DocumentSection, Job, JobAnalysis } from "./schemas";
import { canonicalSkill, extractSkills, textMentionsSkill } from "./skills/extract";
import { uid } from "./util";

/** Plain-text resume rendering used for before/after comparison and export. */
export function renderSectionTexts(profile: CareerProfile, skillOrder?: string[], expOrder?: string[], projOrder?: string[]): Record<string, string> {
  const skills = skillOrder ?? profile.skills.filter((s) => s.level !== "not_applicable").map((s) => s.name);
  const exps = expOrder ? expOrder.map((id) => profile.workExperience.find((w) => w.id === id)!).filter(Boolean) : profile.workExperience;
  const projs = projOrder ? projOrder.map((id) => profile.projects.find((p) => p.id === id)!).filter(Boolean) : profile.projects;
  return {
    Summary: profile.summary,
    Skills: skills.join(", "),
    Experience: exps.map((w) => `${w.title}${w.company ? " — " + w.company : ""} (${w.start}${w.start || w.end ? " – " : ""}${w.end})\n${w.bullets.map((b) => "• " + b).join("\n")}`).join("\n\n"),
    Projects: projs.map((p) => `${p.name}${p.technologies.length ? " [" + p.technologies.join(", ") + "]" : ""}\n${p.description}${p.bullets.length ? "\n" + p.bullets.map((b) => "• " + b).join("\n") : ""}`.trim()).join("\n\n"),
    Education: profile.education.map((e) => `${e.degree}${e.institution ? ", " + e.institution : ""}${e.year ? " (" + e.year + ")" : ""}`).join("\n"),
    Certifications: profile.certifications.join("\n"),
  };
}

export function renderResumeText(profile: CareerProfile, sections: Record<string, string>): string {
  const c = profile.contact;
  const head = [c.fullName, [c.email, c.phone, c.location].filter(Boolean).join(" | "), c.links.join(" | ")].filter(Boolean).join("\n");
  const body = ["Summary", "Skills", "Experience", "Projects", "Education", "Certifications"]
    .filter((h) => sections[h]?.trim())
    .map((h) => `${h.toUpperCase()}\n${sections[h]}`)
    .join("\n\n");
  return `${head}\n\n${body}`.trim();
}

const relevance = (text: string, skills: string[]) => skills.filter((s) => textMentionsSkill(text, s)).length;

export interface TruthReport { warnings: string[]; unsupportedSkills: string[]; unverifiedNumbers: string[] }

/**
 * Truthfulness validator: flags skills or numeric claims in `proposed` that the verified source does not support.
 * Applies to deterministic and AI-generated output alike.
 */
export function validateTruthfulness(proposed: string, profile: CareerProfile, sourceText: string): TruthReport {
  const supported = new Set(profile.skills.filter((s) => s.level !== "not_applicable" && s.level !== "learning").map((s) => canonicalSkill(s.name)));
  const unsupportedSkills = extractSkills(proposed).filter((s) => !supported.has(s) && !textMentionsSkill(sourceText, s));
  const learning = extractSkills(proposed).filter((s) => profile.skills.some((p) => canonicalSkill(p.name) === s && p.level === "learning"));
  const nums = proposed.match(/\b\d[\d,.]*\s?(?:%|\+|k\b|x\b|million|lakhs?|users|ms|seconds)?/gi) ?? [];
  const src = sourceText.replace(/,/g, "");
  const unverifiedNumbers = [...new Set(nums.map((n) => n.trim()).filter((n) => /[%+kx]|million|lakh|users|ms/i.test(n) || n.length > 3))].filter((n) => !src.includes(n.replace(/,/g, "")));
  const warnings: string[] = [];
  if (unsupportedSkills.length) warnings.push(`Not supported by your verified profile: ${unsupportedSkills.join(", ")}. Remove them unless you can truthfully claim them.`);
  if (learning.length) warnings.push(`${learning.join(", ")} are marked "learning"; don't present them as experienced.`);
  if (unverifiedNumbers.length) warnings.push(`These numbers don't appear in your source resume: ${unverifiedNumbers.join(", ")}. Verify or remove.`);
  return { warnings, unsupportedSkills, unverifiedNumbers };
}

/** Deterministic tailoring: reorders and emphasizes existing verified content. Never adds new claims. */
export function tailorResumeDeterministic(profile: CareerProfile, job: Job, analysis: JobAnalysis, sourceText: string): { sections: DocumentSection[]; keywordWarnings: string[] } {
  const jobSkills = [...job.requiredSkills, ...job.preferredSkills].map(canonicalSkill);
  const original = renderSectionTexts(profile);
  const active = profile.skills.filter((s) => s.level !== "not_applicable");
  const skillOrder = [...active].sort((a, b) => Number(jobSkills.includes(canonicalSkill(b.name))) - Number(jobSkills.includes(canonicalSkill(a.name)))).map((s) => s.name);
  const expOrder = [...profile.workExperience].map((w) => w.id); // chronology is preserved; only bullets inside are reordered
  const reorderedProfile: CareerProfile = {
    ...profile,
    workExperience: profile.workExperience.map((w) => ({ ...w, bullets: [...w.bullets].sort((a, b) => relevance(b, jobSkills) - relevance(a, jobSkills)) })),
  };
  const projOrder = [...profile.projects].sort((a, b) => relevance(`${b.description} ${b.technologies.join(" ")} ${b.bullets.join(" ")}`, jobSkills) - relevance(`${a.description} ${a.technologies.join(" ")} ${a.bullets.join(" ")}`, jobSkills)).map((p) => p.id);
  const proposed = renderSectionTexts(reorderedProfile, skillOrder, expOrder, projOrder);

  const keywordWarnings = analysis.skillMatches.filter((m) => m.status === "not_found" || m.status === "marked_not_applicable").map((m) => `"${m.skill}" is requested but not supported by your verified profile, so it was NOT added.`);
  const sections: DocumentSection[] = Object.keys(original).filter((h) => original[h]?.trim() || proposed[h]?.trim()).map((heading) => {
    const same = original[heading] === proposed[heading];
    const report = validateTruthfulness(proposed[heading] ?? "", profile, sourceText);
    return { id: uid(), heading, original: original[heading] ?? "", proposed: proposed[heading] ?? "", decision: same ? "accepted" : "pending", warnings: report.warnings };
  });
  return { sections, keywordWarnings };
}

export function assembleFinalDocument(profile: CareerProfile, sections: DocumentSection[]): string {
  const map: Record<string, string> = {};
  for (const s of sections) map[s.heading] = s.decision === "rejected" ? s.original : s.proposed;
  return renderResumeText(profile, map);
}

/** Simple line-level diff for highlighting changed sections. */
export function diffLines(a: string, b: string): Array<{ text: string; kind: "same" | "added" | "removed" }> {
  const A = a.split("\n"), B = b.split("\n");
  const dp: number[][] = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const out: Array<{ text: string; kind: "same" | "added" | "removed" }> = [];
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { out.push({ text: A[i]!, kind: "same" }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) out.push({ text: A[i++]!, kind: "removed" });
    else out.push({ text: B[j++]!, kind: "added" });
  }
  while (i < A.length) out.push({ text: A[i++]!, kind: "removed" });
  while (j < B.length) out.push({ text: B[j++]!, kind: "added" });
  return out;
}

/** Deterministic cover letter template built only from verified facts. User edits before use. */
export function coverLetterDeterministic(profile: CareerProfile, job: Job, analysis: JobAnalysis, notes: string): string {
  const matched = analysis.skillMatches.filter((m) => m.status === "matched_verified").map((m) => m.skill).slice(0, 5);
  const role = profile.currentRole || profile.workExperience[0]?.title || "";
  const years = profile.yearsOfExperience;
  const topProject = analysis.relevantProjects[0]?.name;
  const lines = [
    `Dear ${job.company ? job.company + " " : ""}Hiring Team,`,
    "",
    `I am writing to apply for the ${job.title || "open"} position${job.company ? " at " + job.company : ""}.` +
      (role ? ` I currently work as ${/^[aeiou]/i.test(role) ? "an" : "a"} ${role}` + (years ? ` with about ${years} years of experience.` : ".") : ""),
    "",
    matched.length ? `The role asks for skills that I have worked with, including ${matched.join(", ")}.` : "I would welcome the chance to discuss how my background fits this role.",
    topProject ? `One relevant example from my background is ${topProject}.` : "",
    notes.trim() ? `\n${notes.trim()}` : "",
    "",
    "Thank you for your time and consideration. I would welcome the opportunity to discuss the role.",
    "",
    "Sincerely,",
    profile.contact.fullName,
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n").trim();
}
