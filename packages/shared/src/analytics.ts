import type { Application, Job, JobAnalysis } from "./schemas";

/** Minimum number of data points before we show a rate/trend as meaningful. */
export const MIN_SAMPLE = 10;

export interface AnalyticsInput {
  jobs: Job[];
  analyses: JobAnalysis[];
  applications: Application[];
  since?: Date | null;
}

export interface AnalyticsResult {
  totals: { discovered: number; saved: number; applied: number; interviews: number; offers: number; rejections: number };
  averageMatchScore: number | null;
  statusDistribution: Record<string, number>;
  applicationsPerWeek: Array<{ week: string; count: number }>;
  interviewConversion: { rate: number | null; sample: number; reliable: boolean };
  topMissingSkills: Array<{ skill: string; count: number }>;
  sources: Array<{ source: string; applications: number; interviews: number; reliable: boolean }>;
  notes: string[];
}

const weekStart = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

const INTERVIEW_REACHED = new Set(["interview", "offer"]);

export function computeAnalytics({ jobs, analyses, applications, since }: AnalyticsInput): AnalyticsResult {
  const inRange = <T,>(items: T[], at: (t: T) => string | null | undefined) =>
    since ? items.filter((i) => { const v = at(i); return v ? new Date(v) >= since : false; }) : items;
  const rJobs = inRange(jobs, (j) => j.discoveredAt);
  const rApps = inRange(applications, (a) => a.createdAt);
  const rAnalyses = inRange(analyses, (a) => a.createdAt);

  // "Applied" counts only what the user confirmed (status moved to applied or later with appliedAt set).
  const confirmed = rApps.filter((a) => a.appliedAt);
  const reachedInterview = confirmed.filter((a) => INTERVIEW_REACHED.has(a.status) || a.history.some((h) => h.type === "status" && /→ (interview|offer)$/.test(h.detail)));
  const statusDistribution: Record<string, number> = {};
  for (const a of rApps) statusDistribution[a.status] = (statusDistribution[a.status] ?? 0) + 1;

  const perWeek = new Map<string, number>();
  for (const a of confirmed) { const k = weekStart(new Date(a.appliedAt!)); perWeek.set(k, (perWeek.get(k) ?? 0) + 1); }

  const missing = new Map<string, number>();
  const latestPerJob = new Map<string, JobAnalysis>();
  for (const a of rAnalyses) { const p = latestPerJob.get(a.jobId); if (!p || p.createdAt < a.createdAt) latestPerJob.set(a.jobId, a); }
  for (const a of latestPerJob.values()) for (const m of a.skillMatches) if (m.status === "not_found") missing.set(m.skill, (missing.get(m.skill) ?? 0) + 1);

  const bySource = new Map<string, { applications: number; interviews: number }>();
  for (const a of confirmed) {
    const s = bySource.get(a.source) ?? { applications: 0, interviews: 0 };
    s.applications++;
    if (reachedInterview.includes(a)) s.interviews++;
    bySource.set(a.source, s);
  }

  const notes: string[] = [];
  const reliable = confirmed.length >= MIN_SAMPLE;
  if (!reliable) notes.push(`Rates need at least ${MIN_SAMPLE} confirmed applications to be meaningful; you have ${confirmed.length}.`);

  return {
    totals: {
      discovered: rJobs.length,
      saved: rJobs.filter((j) => j.savedAt).length,
      applied: confirmed.length,
      interviews: rApps.filter((a) => a.status === "interview").length,
      offers: rApps.filter((a) => a.status === "offer").length,
      rejections: rApps.filter((a) => a.status === "rejected").length,
    },
    averageMatchScore: latestPerJob.size ? Math.round([...latestPerJob.values()].reduce((s, a) => s + a.totalScore, 0) / latestPerJob.size) : null,
    statusDistribution,
    applicationsPerWeek: [...perWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count })),
    interviewConversion: { rate: reliable ? Math.round((reachedInterview.length / confirmed.length) * 100) : null, sample: confirmed.length, reliable },
    topMissingSkills: [...missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([skill, count]) => ({ skill, count })),
    sources: [...bySource.entries()].map(([source, v]) => ({ source, ...v, reliable: v.applications >= MIN_SAMPLE })),
    notes,
  };
}
