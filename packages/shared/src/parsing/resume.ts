import type { CareerProfile, ParsedFieldFlag, ProfileSkill, WorkExperience, Education, Project } from "../schemas";
import { extractSkills, canonicalSkill } from "../skills/extract";
import { isKnownSkill } from "../skills/taxonomy";
import { estimateYears } from "./dates";
import { nowIso, uid, uniq } from "../util";

export interface ParsedResume {
  profile: CareerProfile;
  confidence: number;
  flags: ParsedFieldFlag[];
}

type Sec = "summary" | "skills" | "experience" | "projects" | "education" | "certifications" | "other";

const SECTION_RES: Array<[RegExp, Sec]> = [
  [/^(professional |career )?(summary|objective|profile|about( me)?)$/i, "summary"],
  [/^(technical |key |core )?(skills|technologies|tech stack|competenc(y|ies)|skills (&|and) tools)$/i, "skills"],
  [/^((professional|work|relevant|employment) )?(experience|history)( & .*)?$|^employment$/i, "experience"],
  [/^(personal |academic |key |notable )?projects$/i, "projects"],
  [/^(education|academics?|academic (background|qualifications?)|qualifications?)$/i, "education"],
  [/^(certifications?|certificates?|licenses?|courses|achievements?|awards?)( (&|and) .*)?$/i, "certifications"],
];

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const DATE = `(?:${MONTH}\\s+\\d{4}|\\d{1,2}[/-]\\d{4}|\\d{4})`;
const RANGE_RE = new RegExp(`(${DATE})\\s*(?:-|–|—|to)\\s*(${DATE}|present|current|now|till date|ongoing)`, "i");
const BULLET_RE = /^\s*[•\-*–·▪●◦✓➢>]\s*/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,5}/;
const URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com\/[^\s,;|)]+|github\.com\/[^\s,;|)]+|[a-z0-9-]+\.(?:dev|io|me|app|com|in|tech|xyz)(?:\/[^\s,;|)]*)?)/gi;

function sectionOf(line: string): Sec | null {
  const t = line.replace(/[:\s_–—-]+$/g, "").replace(/^[#*\s]+/, "").trim();
  if (!t || t.length > 40 || /[.@]/.test(t)) return null;
  for (const [re, s] of SECTION_RES) if (re.test(t)) return s;
  return null;
}

const DEGREE_RE = /\b(b\.?\s?tech|b\.?\s?e\.?|bachelor[a-z' ]*|m\.?\s?tech|master[a-z' ]*|m\.?\s?s\.?c?|b\.?\s?sc|b\.?\s?c\.?a|m\.?\s?c\.?a|mba|ph\.?d|diploma|b\.?\s?a\.?|hsc|ssc|12th|10th)\b/i;

export function parseResumeText(text: string): ParsedResume {
  const clean = text.replace(/\r/g, "").replace(/ /g, " ");
  const lines = clean.split("\n").map((l) => l.replace(/\s+$/, ""));
  const nonEmpty = lines.filter((l) => l.trim());
  const flags: ParsedFieldFlag[] = [];

  // --- sections
  const sections: Record<Sec, string[]> = { summary: [], skills: [], experience: [], projects: [], education: [], certifications: [], other: [] };
  let cur: Sec = "other";
  for (const line of lines) {
    const s = sectionOf(line);
    if (s) { cur = s; continue; }
    if (line.trim()) sections[cur].push(line);
  }
  const header = nonEmpty.slice(0, 10).join("\n");

  // --- contact
  const email = EMAIL_RE.exec(clean)?.[0] ?? "";
  const phone = (() => {
    for (const l of nonEmpty.slice(0, 12)) {
      const stripped = l.replace(EMAIL_RE, "");
      const m = PHONE_RE.exec(stripped);
      if (m && m[0].replace(/\D/g, "").length >= 10) return m[0].trim();
    }
    return "";
  })();
  const links = uniq((clean.match(URL_RE) ?? []).filter((l) => !EMAIL_RE.test(l) && !l.includes("@")).map((l) => l.replace(/[.,]+$/, "")).slice(0, 8));
  let fullName = "";
  for (const l of nonEmpty.slice(0, 5)) {
    const t = l.trim();
    if (EMAIL_RE.test(t) || /\d/.test(t) || sectionOf(t)) continue;
    if (/^[A-Za-z][A-Za-z.'-]*(\s+[A-Za-z][A-Za-z.'-]*){1,3}$/.test(t) && t.length < 40) { fullName = t; break; }
  }
  const location = (() => {
    for (const l of nonEmpty.slice(0, 8)) {
      const parts = l.split(/[|•·]/).map((p) => p.trim());
      for (const p of parts) if (/^[A-Z][A-Za-z .]+,\s*[A-Z][A-Za-z .]+$/.test(p) && !EMAIL_RE.test(p) && !/\d/.test(p)) return p;
    }
    return "";
  })();

  // --- skills
  const skillNames: string[] = [];
  for (const l of sections.skills) {
    const body = l.replace(/^[^:]{2,30}:/, (m) => (/(languages|frameworks|tools|databases|technologies|libraries|cloud|frontend|backend|other)/i.test(m) ? "" : m));
    for (const raw of body.split(/[,;|•·•]|\s{3,}/)) {
      const t = raw.replace(BULLET_RE, "").trim();
      if (t.length >= 2 && t.length <= 30 && /[A-Za-z]/.test(t)) skillNames.push(canonicalSkill(t));
    }
  }
  const taxonomySkills = extractSkills(clean);
  const allSkillNames = uniq([...skillNames.filter((s) => isKnownSkill(s) || sections.skills.length), ...taxonomySkills]);
  // Parsed skills are never auto-promoted: level "working", unverified.
  const skills: ProfileSkill[] = allSkillNames.slice(0, 80).map((name) => ({ name, level: "working", verified: false, primary: false }));

  // --- experience
  const workExperience: WorkExperience[] = [];
  {
    const exp = sections.experience;
    let curr: WorkExperience | null = null;
    let pendingHeader: string | null = null;
    for (const line of exp) {
      const r = RANGE_RE.exec(line);
      if (r) {
        const rest = line.replace(RANGE_RE, " ").replace(/[()|,–—-]+\s*$/g, "").replace(/^[\s|,–—-]+/, "").trim();
        const headerText = rest.length > 2 ? rest : pendingHeader ?? "";
        const { title, company } = splitTitleCompany(headerText);
        const isCurrent = /present|current|now|till date|ongoing/i.test(r[2]!);
        curr = { id: uid(), title, company, start: r[1]!.trim(), end: isCurrent ? "Present" : r[2]!.trim(), current: isCurrent, bullets: [], verified: false };
        workExperience.push(curr);
        pendingHeader = null;
        continue;
      }
      if (BULLET_RE.test(line) || (curr && line.length > 60)) {
        if (curr) curr.bullets.push(line.replace(BULLET_RE, "").trim());
        continue;
      }
      // short non-bullet line: either header for next entry or title/company detail for current
      if (curr && curr.bullets.length === 0 && (!curr.title || !curr.company)) {
        const { title, company } = splitTitleCompany(line.trim());
        if (!curr.title) curr.title = title || company; else if (!curr.company) curr.company = company || title;
        if (!curr.company && title && curr.title !== title) curr.company = title;
      } else pendingHeader = line.trim();
    }
  }

  // --- projects
  const projects: Project[] = [];
  {
    let cp: Project | null = null;
    for (const line of sections.projects) {
      const isBullet = BULLET_RE.test(line);
      if (!isBullet && line.trim().length < 90 && !/[.!]$/.test(line.trim())) {
        const [namePart, tech] = line.split(/\s[|–—]\s|\s-\s|:\s*(?=[A-Z])/);
        cp = { id: uid(), name: (namePart ?? line).trim(), description: "", technologies: tech ? extractSkills(tech) : [], bullets: [], link: "", verified: false };
        projects.push(cp);
      } else if (cp) {
        const body = line.replace(BULLET_RE, "").trim();
        if (isBullet) cp.bullets.push(body); else cp.description += (cp.description ? " " : "") + body;
        const techFound = extractSkills(body);
        cp.technologies = uniq([...cp.technologies, ...techFound]);
        const url = /https?:\/\/\S+/.exec(body)?.[0];
        if (url && !cp.link) cp.link = url;
      }
    }
  }

  // --- education
  const education: Education[] = [];
  for (const line of sections.education) {
    const t = line.replace(BULLET_RE, "").trim();
    if (!t) continue;
    if (DEGREE_RE.test(t)) {
      const year = /(?:19|20)\d{2}(?:\s*[-–]\s*(?:(?:19|20)\d{2}|present))?/i.exec(t)?.[0] ?? "";
      const degreeMatch = t.replace(year, "").replace(/[|,–—-]\s*$/g, "").trim();
      education.push({ id: uid(), degree: degreeMatch, institution: "", year, verified: false });
    } else if (education.length && !education[education.length - 1]!.institution && /university|college|institute|school|academy|iit|nit/i.test(t)) {
      education[education.length - 1]!.institution = t.replace(/(?:19|20)\d{2}.*$/, "").replace(/[|,–—-]\s*$/g, "").trim();
    } else if (/university|college|institute|school|academy/i.test(t)) {
      education.push({ id: uid(), degree: "", institution: t.replace(/(?:19|20)\d{2}.*$/, "").trim(), year: /(?:19|20)\d{2}/.exec(t)?.[0] ?? "", verified: false });
    }
  }

  const certifications = sections.certifications.map((l) => l.replace(BULLET_RE, "").trim()).filter((l) => l.length > 3 && l.length < 150);
  const summary = sections.summary.join(" ").replace(/\s+/g, " ").trim();
  const yearsEstimated = estimateYears(workExperience);
  const currentRole = workExperience.find((w) => w.current)?.title ?? workExperience[0]?.title ?? "";

  // --- confidence + flags
  const weights: Array<[string, number, boolean, string]> = [
    ["contact.fullName", 0.12, !!fullName, "Name not detected — please enter it."],
    ["contact.email", 0.15, !!email, "No email address found."],
    ["contact.phone", 0.08, !!phone, "No phone number found."],
    ["skills", 0.2, skills.length >= 3, "Few or no skills detected."],
    ["workExperience", 0.22, workExperience.length > 0, "No work experience entries detected; check your resume layout."],
    ["education", 0.1, education.length > 0, "No education detected."],
    ["projects", 0.05, projects.length > 0, "No projects detected."],
    ["summary", 0.08, summary.length > 0, "No professional summary found."],
  ];
  let confidence = 0;
  for (const [field, w, ok, msg] of weights) {
    if (ok) confidence += w; else flags.push({ field, message: msg, confidence: 0 });
  }
  const incompleteWork = workExperience.filter((w) => !w.title || !w.company || !w.start);
  if (incompleteWork.length) {
    confidence -= 0.05;
    flags.push({ field: "workExperience", message: `${incompleteWork.length} experience entr${incompleteWork.length > 1 ? "ies are" : "y is"} missing a title, company or date — please verify.`, confidence: 0.4 });
  }
  if (text.replace(/\s/g, "").length < 300) flags.push({ field: "text", message: "Very little text was extracted. The file may be scanned/image-based.", confidence: 0.1 });
  flags.push({ field: "skills", message: "Skills were detected automatically and set to \"Working knowledge\". Please confirm each level.", confidence: 0.6 });

  const profile: CareerProfile = {
    id: uid(),
    contact: { fullName, email, phone, location, links },
    summary,
    currentRole,
    yearsOfExperience: yearsEstimated,
    skills,
    workExperience,
    education,
    projects,
    certifications,
    targetRoles: [],
    preferredIndustries: [],
    preferredLocations: [],
    workModes: [],
    employmentTypes: [],
    salaryPreferences: { currency: "INR", minimum: null, target: null },
    noticePeriod: "",
    verifiedFields: [],
    updatedAt: nowIso(),
  };
  void header;
  return { profile, confidence: Math.max(0, Math.min(1, Math.round(confidence * 100) / 100)), flags };
}

function splitTitleCompany(text: string): { title: string; company: string } {
  const t = text.replace(BULLET_RE, "").trim();
  if (!t) return { title: "", company: "" };
  const at = /^(.*?)\s+(?:at|@)\s+(.+)$/i.exec(t);
  if (at) return { title: at[1]!.trim(), company: at[2]!.trim() };
  const parts = t.split(/\s[|–—-]\s|,\s+(?=[A-Z])/).map((p) => p.trim()).filter(Boolean);
  const roleRe = /(developer|engineer|manager|lead|architect|analyst|consultant|designer|intern|specialist|administrator|director|officer|associate|programmer|tester|qa)/i;
  if (parts.length >= 2) {
    const roleIdx = parts.findIndex((p) => roleRe.test(p));
    if (roleIdx === 1) return { title: parts[1]!, company: parts[0]! };
    return { title: parts[0]!, company: parts[1]! };
  }
  return roleRe.test(t) ? { title: t, company: "" } : { title: "", company: t };
}
