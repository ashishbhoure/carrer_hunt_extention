import { jobSchema, type Job, type WorkMode } from "../schemas";
import { structureJobText } from "./structure";
import { canonicalizeUrl, contentHash, jobFingerprint, providerFromUrl } from "./url";
import { nowIso, uid } from "../util";

export interface JobInput {
  title?: string;
  company?: string;
  location?: string;
  url?: string;
  applicationUrl?: string;
  description: string;
  provider?: string;
  providerJobId?: string;
  salaryRange?: string;
  employmentType?: string;
  workMode?: WorkMode;
  datePosted?: string;
  /** confidence reported by the extractor for title/company/description */
  extractorConfidence?: number;
  extractorNotes?: string[];
}

/** Build a normalized Job from extracted/pasted fields. Does not invent missing fields. */
export function buildJob(input: JobInput): Job {
  const description = input.description.replace(/\r/g, "").trim();
  if (!description) throw new Error("Job description is empty.");
  const s = structureJobText(description);
  const canonicalUrl = canonicalizeUrl(input.url ?? "");
  const base = {
    id: uid(),
    provider: input.provider ?? (input.url ? providerFromUrl(input.url) : "manual"),
    providerJobId: input.providerJobId,
    canonicalUrl,
    originalUrl: input.url ?? "",
    applicationUrl: input.applicationUrl ?? "",
    title: input.title?.trim() ?? "",
    company: input.company?.trim() ?? "",
    location: input.location?.trim() ?? "",
    workMode: input.workMode && input.workMode !== "unknown" ? input.workMode : s.workMode,
    employmentType: input.employmentType || s.employmentType,
    salaryRange: input.salaryRange || s.salaryRange,
    experienceRequirements: s.experienceRequirements,
    minYears: s.minYears,
    maxYears: s.maxYears,
    requiredSkills: s.requiredSkills,
    preferredSkills: s.preferredSkills,
    responsibilities: s.responsibilities,
    qualifications: s.qualifications,
    description,
    datePosted: input.datePosted,
    extractionConfidence: Math.round(Math.min(1, input.extractorConfidence !== undefined ? (input.extractorConfidence + s.confidence) / 2 : s.confidence) * 100) / 100,
    extractionNotes: [...(input.extractorNotes ?? []), ...s.notes],
    discoveredAt: nowIso(),
    contentHash: contentHash(description),
    fingerprint: "",
  };
  base.fingerprint = jobFingerprint(base);
  return jobSchema.parse(base);
}

/** Re-derive structured fields after the user edits the description or skill lists. */
export function refreshJobFingerprint(job: Job): Job {
  return { ...job, contentHash: contentHash(job.description), fingerprint: jobFingerprint(job) };
}
