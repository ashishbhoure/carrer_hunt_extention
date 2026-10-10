import {
  analysisCacheKey, analyzeJob, applicationSchema, buildJob, findDuplicate, jobFingerprint, nowIso, uid, refreshJobFingerprint,
  type Application, type ApplicationStatus, type CareerProfile, type Job, type JobAnalysis, type JobInput, type Resume,
} from "@careerpilot/shared";
import { analysesRepo, applicationsRepo, jobsRepo, profileRepo, resumesRepo, settingsRepo } from "../storage/db";

export class UserFacingError extends Error {}

/** Create a Job (not yet persisted) from pasted/extracted input. */
export function jobFromInput(input: JobInput): Job {
  try { return buildJob(input); } catch (e) { throw new UserFacingError((e as Error).message); }
}

export interface SaveJobResult { job: Job; duplicateOf?: Job; created: boolean }

/** Persist a job, or return the existing record when it is a duplicate (URL, provider id or fingerprint). */
export async function saveJob(job: Job): Promise<SaveJobResult> {
  const existing = await jobsRepo.list();
  const dup = findDuplicate(job, existing);
  if (dup) {
    if (!dup.job.savedAt) { const saved = { ...dup.job, savedAt: nowIso() }; await jobsRepo.put(saved); return { job: saved, duplicateOf: dup.job, created: false }; }
    return { job: dup.job, duplicateOf: dup.job, created: false };
  }
  const saved = { ...refreshJobFingerprint(job), savedAt: job.savedAt ?? nowIso() };
  await jobsRepo.put(saved);
  return { job: saved, created: true };
}

/** Persist without marking as "saved" (e.g. discovered/analysed only). */
export async function recordDiscoveredJob(job: Job): Promise<Job> {
  const dup = findDuplicate(job, await jobsRepo.list());
  if (dup) return dup.job;
  await jobsRepo.put(job);
  return job;
}

export async function updateJob(job: Job) { await jobsRepo.put(refreshJobFingerprint(job)); }

export async function resolveProfile(resume?: Resume): Promise<CareerProfile> {
  const master = await profileRepo.get();
  const profile = master ?? resume?.parsedProfile;
  if (!profile) throw new UserFacingError("No career profile yet. Upload a resume first.");
  return profile;
}

export async function analyze(jobId: string, resumeId?: string, opts: { force?: boolean } = {}): Promise<JobAnalysis> {
  const job = await jobsRepo.get(jobId);
  if (!job) throw new UserFacingError("Job not found.");
  const resume = resumeId ? await resumesRepo.get(resumeId) : await resumesRepo.getDefault();
  if (!resume) throw new UserFacingError("No resume uploaded. Upload a resume to analyse jobs.");
  const profile = await resolveProfile(resume);
  const settings = await settingsRepo.get();
  const input = { job, profile, resumeText: resume.extractedText, weights: settings.weights };
  const key = analysisCacheKey(input);
  if (!opts.force) {
    const cached = await analysesRepo.byCacheKey(key);
    if (cached && cached.resumeId === resume.id && cached.jobId === job.id) return cached;
  }
  const result = analyzeJob({ ...input, resumeId: resume.id });
  await analysesRepo.put(result);
  return result;
}

export function findDuplicateApplication(job: Pick<Job, "id" | "title" | "company" | "location" | "canonicalUrl">, apps: Application[], jobs: Job[]): Application | undefined {
  const fp = jobFingerprint({ title: job.title, company: job.company, location: job.location });
  const sameJobIds = new Set(jobs.filter((j) => j.id === job.id || (j.canonicalUrl && j.canonicalUrl === job.canonicalUrl) || (job.title && job.company && j.fingerprint === fp)).map((j) => j.id));
  return apps.find((a) => sameJobIds.has(a.jobId));
}

export async function createApplication(job: Job, opts: { status?: ApplicationStatus; analysis?: JobAnalysis | null; resumeId?: string | null } = {}): Promise<{ application: Application; existing: boolean }> {
  const [apps, jobs] = await Promise.all([applicationsRepo.list(), jobsRepo.list()]);
  const dup = findDuplicateApplication(job, apps, jobs);
  if (dup) return { application: dup, existing: true };
  const now = nowIso();
  const status = opts.status ?? "saved";
  const app = applicationSchema.parse({
    id: uid(), jobId: job.id, title: job.title || "Untitled role", company: job.company || "Unknown company", jobUrl: job.originalUrl, source: job.provider,
    matchScoreAtSave: opts.analysis?.totalScore ?? null, resumeId: opts.resumeId ?? opts.analysis?.resumeId ?? null, status, savedAt: now, createdAt: now, updatedAt: now,
    history: [{ at: now, type: "created", detail: `Created as ${status}` }],
  });
  await applicationsRepo.put(app);
  return { application: app, existing: false };
}

export async function setApplicationStatus(id: string, status: ApplicationStatus, opts: { userConfirmedSubmitted?: boolean } = {}): Promise<Application> {
  const a = await applicationsRepo.get(id);
  if (!a) throw new UserFacingError("Application not found.");
  const now = nowIso();
  const history = [...a.history, { at: now, type: "status" as const, detail: `${a.status} → ${status}` }];
  let appliedAt = a.appliedAt;
  if (status === "applied") {
    // Only mark as applied with explicit user confirmation.
    if (!opts.userConfirmedSubmitted && !appliedAt) throw new UserFacingError("Confirm that you submitted the application yourself before marking it as applied.");
    appliedAt ??= now;
    history.push({ at: now, type: "user_confirmed_submitted", detail: "User confirmed the application was submitted." });
  }
  const next = { ...a, status, appliedAt, history, updatedAt: now };
  await applicationsRepo.put(next);
  return next;
}

export async function patchApplication(id: string, patch: Partial<Pick<Application, "notes" | "interviewNotes" | "followUpAt" | "followUpNote" | "interviewAt" | "interviewNote" | "recruiter" | "resumeId" | "coverLetterId" | "tailoredDocumentId">>): Promise<Application> {
  const a = await applicationsRepo.get(id);
  if (!a) throw new UserFacingError("Application not found.");
  const now = nowIso();
  const history = [...a.history];
  if ("followUpAt" in patch && patch.followUpAt !== a.followUpAt) history.push({ at: now, type: "followup", detail: patch.followUpAt ? `Follow-up set for ${new Date(patch.followUpAt).toLocaleString()}` : "Follow-up cleared" });
  if ("interviewAt" in patch && patch.interviewAt !== a.interviewAt) history.push({ at: now, type: "interview", detail: patch.interviewAt ? `Interview scheduled for ${new Date(patch.interviewAt).toLocaleString()}` : "Interview time cleared" });
  if (patch.notes !== undefined && patch.notes !== a.notes) history.push({ at: now, type: "note", detail: "Notes updated" });
  const next = { ...a, ...patch, history, updatedAt: now };
  await applicationsRepo.put(next);
  return next;
}
