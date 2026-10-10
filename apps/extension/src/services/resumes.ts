import { parseResumeText, nowIso, uid, canonicalSkill, type CareerProfile, type Resume } from "@careerpilot/shared";
import { profileRepo, resumesRepo } from "../storage/db";
import { extractResumeText, validateResumeFile, ResumeFileError } from "./extractText";

export { ResumeFileError };

function buildResume(file: File, text: string, id = uid(), prev?: Resume): Resume {
  const parsed = parseResumeText(text);
  const status = text.replace(/\s/g, "").length < 100 ? "failed" : parsed.confidence >= 0.8 && !parsed.flags.some((f) => f.confidence < 0.5) ? "parsed" : "needs_review";
  return {
    id,
    title: prev?.title ?? file.name.replace(/\.(pdf|docx)$/i, ""),
    description: prev?.description ?? "",
    fileName: file.name,
    mimeType: file.type || (file.name.endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    size: file.size,
    extractedText: text,
    parsedProfile: parsed.profile,
    parsingConfidence: parsed.confidence,
    parsingFlags: parsed.flags,
    parsingStatus: status,
    isDefault: prev?.isDefault ?? false,
    createdAt: prev?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };
}

export async function importResume(file: File, meta?: { title?: string; description?: string }): Promise<Resume> {
  const kind = await validateResumeFile(file);
  const text = await extractResumeText(file, kind);
  if (!text.trim()) throw new ResumeFileError("No text could be extracted. Scanned/image-only resumes are not supported yet.");
  const existing = await resumesRepo.list();
  const resume = buildResume(file, text);
  if (meta?.title?.trim()) resume.title = meta.title.trim();
  if (meta?.description) resume.description = meta.description;
  resume.isDefault = existing.length === 0;
  await resumesRepo.putFile(resume.id, file);
  await resumesRepo.put(resume);
  if (!(await profileRepo.get()) && resume.parsedProfile) await profileRepo.put({ ...resume.parsedProfile });
  return resume;
}

export async function replaceResumeFile(id: string, file: File): Promise<Resume> {
  const prev = await resumesRepo.get(id);
  if (!prev) throw new Error("Resume not found.");
  const kind = await validateResumeFile(file);
  const text = await extractResumeText(file, kind);
  if (!text.trim()) throw new ResumeFileError("No text could be extracted from the replacement file.");
  const next = buildResume(file, text, id, prev);
  await resumesRepo.putFile(id, file);
  await resumesRepo.put(next);
  return next;
}

export async function setDefaultResume(id: string) {
  for (const r of await resumesRepo.list()) if (r.isDefault !== (r.id === id)) await resumesRepo.put({ ...r, isDefault: r.id === id, updatedAt: nowIso() });
}

export async function deleteResume(id: string) {
  const r = await resumesRepo.get(id);
  await resumesRepo.remove(id);
  if (r?.isDefault) { const next = (await resumesRepo.list())[0]; if (next) await setDefaultResume(next.id); }
}

export async function updateResume(id: string, patch: Partial<Pick<Resume, "title" | "description" | "parsedProfile">>) {
  const r = await resumesRepo.get(id);
  if (!r) throw new Error("Resume not found.");
  await resumesRepo.put({ ...r, ...patch, updatedAt: nowIso() });
}

export async function downloadResumeFile(id: string) {
  const r = await resumesRepo.get(id);
  const blob = await resumesRepo.getFile(id);
  if (!r || !blob) throw new Error("The original file is not available.");
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: r.fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Merge a resume's parsed data into the master profile without overwriting what the user already set. */
export function mergeIntoMaster(master: CareerProfile, parsed: CareerProfile): CareerProfile {
  const haveSkill = new Set(master.skills.map((s) => canonicalSkill(s.name)));
  const haveRole = new Set(master.workExperience.map((w) => `${w.title}|${w.company}`.toLowerCase()));
  const haveProj = new Set(master.projects.map((p) => p.name.toLowerCase()));
  const haveEdu = new Set(master.education.map((e) => `${e.degree}|${e.institution}`.toLowerCase()));
  return {
    ...master,
    contact: { ...parsed.contact, ...Object.fromEntries(Object.entries(master.contact).filter(([, v]) => (Array.isArray(v) ? v.length : v))) } as CareerProfile["contact"],
    summary: master.summary || parsed.summary,
    currentRole: master.currentRole || parsed.currentRole,
    yearsOfExperience: master.yearsOfExperience ?? parsed.yearsOfExperience,
    skills: [...master.skills, ...parsed.skills.filter((s) => !haveSkill.has(canonicalSkill(s.name)))],
    workExperience: [...master.workExperience, ...parsed.workExperience.filter((w) => !haveRole.has(`${w.title}|${w.company}`.toLowerCase()))],
    projects: [...master.projects, ...parsed.projects.filter((p) => !haveProj.has(p.name.toLowerCase()))],
    education: [...master.education, ...parsed.education.filter((e) => !haveEdu.has(`${e.degree}|${e.institution}`.toLowerCase()))],
    certifications: [...new Set([...master.certifications, ...parsed.certifications])],
    updatedAt: nowIso(),
  };
}
