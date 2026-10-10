import {
  assembleFinalDocument, coverLetterDeterministic, nowIso, tailorResumeDeterministic, uid, validateTruthfulness,
  type DocumentSection, type TailoredDocument, type TailorOutput,
} from "@careerpilot/shared";
import { analysesRepo, documentsRepo, jobsRepo, resumesRepo } from "../storage/db";
import { analyze, resolveProfile, UserFacingError } from "./workflow";
import { aiStatus, callAi, describeAiError } from "./aiClient";

async function context(jobId: string, resumeId?: string) {
  const job = await jobsRepo.get(jobId);
  if (!job) throw new UserFacingError("Job not found.");
  const resume = resumeId ? await resumesRepo.get(resumeId) : await resumesRepo.getDefault();
  if (!resume) throw new UserFacingError("No resume uploaded.");
  const profile = await resolveProfile(resume);
  const analysis = (await analysesRepo.forJob(jobId)).find((a) => a.resumeId === resume.id) ?? (await analyze(jobId, resume.id));
  return { job, resume, profile, analysis };
}

export interface GenerationResult { doc: TailoredDocument; notices: string[] }

export async function createTailoredResume(jobId: string, opts: { useAi?: boolean; resumeId?: string } = {}): Promise<GenerationResult> {
  const { job, resume, profile, analysis } = await context(jobId, opts.resumeId);
  const notices: string[] = [];
  const base = tailorResumeDeterministic(profile, job, analysis, resume.extractedText);
  let sections: DocumentSection[] = base.sections;
  let source: TailoredDocument["source"] = "deterministic";
  notices.push(...base.keywordWarnings);

  if (opts.useAi) {
    const st = await aiStatus();
    if (!st.configured) notices.push(st.reason!);
    else {
      try {
        const out = await callAi<TailorOutput>("tailorResume", { profile, job, analysis });
        sections = sections.map((s) => {
          const ai = out.sections.find((x) => x.heading.toLowerCase() === s.heading.toLowerCase());
          if (!ai || !ai.proposed.trim()) return s;
          const report = validateTruthfulness(ai.proposed, profile, resume.extractedText);
          return { ...s, proposed: ai.proposed, decision: ai.proposed === s.original ? "accepted" : "pending", warnings: report.warnings };
        });
        source = "ai";
      } catch (e) {
        notices.push(`${describeAiError(e)} Showing the deterministic tailoring instead.`);
      }
    }
  }
  const version = (await documentsRepo.forJob(jobId)).filter((d) => d.documentType === "resume").length + 1;
  const doc: TailoredDocument = { id: uid(), jobId, sourceResumeId: resume.id, documentType: "resume", content: assembleFinalDocument(profile, sections), sections, version, source, createdAt: nowIso() };
  await documentsRepo.put(doc);
  return { doc, notices };
}

export async function saveTailoredSections(doc: TailoredDocument, sections: DocumentSection[]): Promise<TailoredDocument> {
  const resume = await resumesRepo.get(doc.sourceResumeId);
  const profile = await resolveProfile(resume);
  const next = { ...doc, sections, content: assembleFinalDocument(profile, sections) };
  await documentsRepo.put(next);
  return next;
}

export async function createCoverLetter(jobId: string, opts: { notes?: string; useAi?: boolean; resumeId?: string } = {}): Promise<GenerationResult> {
  const { job, resume, profile, analysis } = await context(jobId, opts.resumeId);
  const notices: string[] = [];
  let content = coverLetterDeterministic(profile, job, analysis, opts.notes ?? "");
  let source: TailoredDocument["source"] = "deterministic";
  if (opts.useAi) {
    const st = await aiStatus();
    if (!st.configured) notices.push(st.reason!);
    else {
      try {
        const out = await callAi<{ letter: string }>("generateCoverLetter", { profile, job, analysis, notes: opts.notes ?? "" });
        const report = validateTruthfulness(out.letter, profile, resume.extractedText);
        content = out.letter;
        source = "ai";
        notices.push(...report.warnings);
      } catch (e) { notices.push(`${describeAiError(e)} Using the template letter instead.`); }
    }
  }
  const version = (await documentsRepo.forJob(jobId)).filter((d) => d.documentType === "cover_letter").length + 1;
  const doc: TailoredDocument = { id: uid(), jobId, sourceResumeId: resume.id, documentType: "cover_letter", content, sections: [], version, source, createdAt: nowIso() };
  await documentsRepo.put(doc);
  return { doc, notices };
}

export async function updateDocumentContent(doc: TailoredDocument, content: string) {
  const next = { ...doc, content };
  await documentsRepo.put(next);
  return next;
}
