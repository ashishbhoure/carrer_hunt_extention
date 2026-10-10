import type { Job, JobAnalysis } from "@careerpilot/shared";

export interface JobFilters {
  keywords: string; location: string; workMode: string; employmentType: string; company: string; source: string;
  minScore: number; minYears: number | null; maxYears: number | null; hasSalary: boolean; postedWithinDays: number | null;
}
export const emptyFilters: JobFilters = { keywords: "", location: "", workMode: "", employmentType: "", company: "", source: "", minScore: 0, minYears: null, maxYears: null, hasSalary: false, postedWithinDays: null };
export type SortKey = "score" | "recent" | "title";

const has = (hay: string, needle: string) => hay.toLowerCase().includes(needle.toLowerCase().trim());

export function filterJobs(jobs: Job[], scores: Map<string, JobAnalysis>, f: JobFilters, now = Date.now()): Job[] {
  return jobs.filter((j) => {
    if (f.keywords.trim()) {
      const terms = f.keywords.toLowerCase().split(/[\s,]+/).filter(Boolean);
      const hay = `${j.title} ${j.company} ${j.requiredSkills.join(" ")} ${j.preferredSkills.join(" ")} ${j.description}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (f.location.trim() && !has(j.location, f.location) && !(has("remote", f.location) && j.workMode === "remote")) return false;
    if (f.workMode && j.workMode !== f.workMode) return false;
    if (f.employmentType && !has(j.employmentType, f.employmentType)) return false;
    if (f.company.trim() && !has(j.company, f.company)) return false;
    if (f.source && j.provider !== f.source) return false;
    if (f.hasSalary && !j.salaryRange) return false;
    // Experience range: keep jobs whose stated minimum falls inside the requested band; unknown stays visible.
    if (j.minYears !== null) {
      if (f.minYears !== null && j.minYears < f.minYears) return false;
      if (f.maxYears !== null && j.minYears > f.maxYears) return false;
    }
    // Date posted: only filter on verified dates; jobs without one are excluded when this filter is on.
    if (f.postedWithinDays !== null) {
      if (!j.datePosted) return false;
      if (now - new Date(j.datePosted).getTime() > f.postedWithinDays * 86400000) return false;
    }
    if (f.minScore > 0 && (scores.get(j.id)?.totalScore ?? -1) < f.minScore) return false;
    return true;
  });
}

export function sortJobs(jobs: Job[], scores: Map<string, JobAnalysis>, key: SortKey): Job[] {
  const copy = [...jobs];
  if (key === "score") return copy.sort((a, b) => (scores.get(b.id)?.totalScore ?? -1) - (scores.get(a.id)?.totalScore ?? -1));
  if (key === "title") return copy.sort((a, b) => a.title.localeCompare(b.title));
  return copy.sort((a, b) => (b.savedAt ?? b.discoveredAt).localeCompare(a.savedAt ?? a.discoveredAt));
}
