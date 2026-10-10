import type { ApplicationStatus, JobAnalysis } from "@careerpilot/shared";

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  discovered: "Discovered", saved: "Saved", interested: "Interested", preparing: "Preparing", applied: "Applied",
  assessment: "Assessment", interview: "Interview", offer: "Offer", rejected: "Rejected", withdrawn: "Withdrawn",
};
export const STATUS_TONE: Record<ApplicationStatus, "neutral" | "info" | "accent" | "good" | "bad" | "warn"> = {
  discovered: "neutral", saved: "info", interested: "info", preparing: "accent", applied: "accent",
  assessment: "warn", interview: "warn", offer: "good", rejected: "bad", withdrawn: "neutral",
};

/** Latest analysis per job, preferring the given (default) resume. */
export function latestByJob(analyses: JobAnalysis[], preferResumeId?: string): Map<string, JobAnalysis> {
  const m = new Map<string, JobAnalysis>();
  const sorted = [...analyses].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  for (const a of sorted) {
    const cur = m.get(a.jobId);
    if (!cur || (preferResumeId ? (a.resumeId === preferResumeId) >= (cur.resumeId === preferResumeId) : true)) m.set(a.jobId, a);
  }
  return m;
}
