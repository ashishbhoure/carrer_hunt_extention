import { extractSkills } from "../skills/extract";
import type { WorkMode } from "../schemas";
import { uniq } from "../util";

export interface StructuredJob {
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  qualifications: string[];
  workMode: WorkMode;
  employmentType: string;
  salaryRange: string;
  experienceRequirements: string;
  minYears: number | null;
  maxYears: number | null;
  confidence: number;
  notes: string[];
}

type Section = "required" | "preferred" | "responsibilities" | "qualifications" | "other";

const HEADINGS: Array<[RegExp, Section]> = [
  [/^(nice to have|good to have|preferred|bonus|plus points?|it'?s a plus|desirable|optional)/i, "preferred"],
  [/^(requirements?|required( skills| qualifications)?|must[- ]have|what you('ll)? need|what we('re| are) looking for|skills( required)?|key skills|technical skills|you have|you bring|mandatory)/i, "required"],
  [/^(responsibilit(y|ies)|what you('ll| will) do|your role|duties|the role|key responsibilities|day[- ]to[- ]day|you will)/i, "responsibilities"],
  [/^(qualifications?|education|eligibility|who you are)/i, "qualifications"],
];

function headingOf(line: string): Section | null {
  const t = line.replace(/^[#*\-•\s]+/, "").replace(/[:\s]+$/, "").trim();
  if (!t || t.length > 60) return null;
  for (const [re, sec] of HEADINGS) if (re.test(t)) return sec;
  if (/^(about (us|the company|the role)|benefits|perks|who we are|company|overview|why join)/i.test(t)) return "other";
  return null;
}

const PREFERRED_INLINE = /\b(nice to have|good to have|preferred|bonus|a plus|is a plus|desirable|advantage|familiarity with)\b/i;

export function parseExperience(text: string): { text: string; min: number | null; max: number | null } {
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*(\d{1,2})\s*)?\+?\s*(?:years?|yrs?)(?:\s+of)?(?:\s+(?:relevant|professional|hands[- ]on|work|industry))?(?:\s+experience)?/gi;
  let best: { text: string; min: number; max: number | null } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : null;
    if (min > 40) continue;
    const ctx = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40);
    if (!/experience|exp\b|expertise|years/i.test(ctx)) continue;
    if (!best) best = { text: m[0].trim(), min, max };
  }
  return best ?? { text: "", min: null, max: null };
}

export function parseSalary(text: string): string {
  const m =
    /((?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)\s?[\d,.]+\s?(?:k|l|lpa|lakhs?|lacs?|cr)?(?:\s?(?:-|–|to)\s?(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp)?\s?[\d,.]+\s?(?:k|l|lpa|lakhs?|lacs?|cr)?)?(?:\s?(?:per|\/|a)\s?(?:year|yr|annum|month|hour|hr))?)/i.exec(text) ??
    /(\d[\d,.]*\s?(?:-|–|to)\s?\d[\d,.]*\s?(?:lpa|lakhs?|lacs?))/i.exec(text);
  return m ? m[1]!.trim() : "";
}

export function detectWorkMode(text: string): WorkMode {
  const t = text.toLowerCase();
  const hybrid = /\bhybrid\b/.test(t);
  const remote = /\b(remote|work from home|wfh|work-from-home|anywhere)\b/.test(t);
  const onsite = /\b(on-?site|work from office|wfo|in[- ]office)\b/.test(t);
  if (hybrid) return "hybrid";
  if (remote && !onsite) return "remote";
  if (onsite && !remote) return "onsite";
  if (remote && onsite) return "hybrid";
  return "unknown";
}

export function detectEmploymentType(text: string): string {
  const t = text.toLowerCase();
  if (/\bfull[- ]time\b/.test(t)) return "Full-time";
  if (/\bpart[- ]time\b/.test(t)) return "Part-time";
  if (/\bcontract(or)?\b|\bfreelance\b|\bc2h\b/.test(t)) return "Contract";
  if (/\bintern(ship)?\b/.test(t)) return "Internship";
  return "";
}

function bulletsOf(lines: string[]): string[] {
  return lines
    .map((l) => l.replace(/^[\s•\-*–·\d.)]+/, "").trim())
    .filter((l) => l.length > 8);
}

/** Turn raw job-description text into structured fields. Pure and deterministic. */
export function structureJobText(raw: string): StructuredJob {
  const text = raw.replace(/\r/g, "");
  const lines = text.split("\n");
  const buckets: Record<Section, string[]> = { required: [], preferred: [], responsibilities: [], qualifications: [], other: [] };
  let current: Section = "other";
  let sawHeading = false;
  for (const line of lines) {
    const h = headingOf(line);
    if (h) { current = h; sawHeading = true; continue; }
    if (line.trim()) buckets[current].push(line);
  }

  const required = new Set<string>();
  const preferred = new Set<string>();

  for (const line of buckets.preferred) extractSkills(line).forEach((s) => preferred.add(s));
  for (const line of [...buckets.required, ...buckets.qualifications, ...buckets.responsibilities, ...buckets.other]) {
    const skills = extractSkills(line);
    if (!skills.length) continue;
    const isPref = PREFERRED_INLINE.test(line);
    for (const s of skills) (isPref ? preferred : required).add(s);
  }
  // A skill explicitly required anywhere wins over a preferred mention.
  for (const s of required) preferred.delete(s);

  const exp = parseExperience(text);
  const notes: string[] = [];
  let confidence = 0.4;
  if (sawHeading) confidence += 0.2; else notes.push("No section headings found; skills were treated as required unless marked nice-to-have.");
  if (required.size >= 3) confidence += 0.2; else notes.push("Few skills detected in the description.");
  if (text.length >= 600) confidence += 0.1; else notes.push("The description is short; the score may be incomplete.");
  if (exp.min !== null) confidence += 0.1;

  return {
    requiredSkills: [...required],
    preferredSkills: [...preferred],
    responsibilities: bulletsOf(buckets.responsibilities).slice(0, 25),
    qualifications: bulletsOf([...buckets.qualifications, ...buckets.required.filter((l) => /degree|bachelor|master|b\.?tech|b\.?e\b|m\.?tech|mca|bca/i.test(l))]).slice(0, 15),
    workMode: detectWorkMode(text),
    employmentType: detectEmploymentType(text),
    salaryRange: parseSalary(text),
    experienceRequirements: exp.text,
    minYears: exp.min,
    maxYears: exp.max,
    confidence: Math.min(1, confidence),
    notes: uniq(notes),
  };
}
