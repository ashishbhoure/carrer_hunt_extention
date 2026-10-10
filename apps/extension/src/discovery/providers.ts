import { buildJob, dedupeJobs, type Job } from "@careerpilot/shared";
import { htmlToText } from "../adapters/dom";

export interface DiscoveryQuery { keywords: string; location?: string; remoteOnly?: boolean }

/**
 * A job source backed by an official, documented public API. Each provider is independent:
 * one failing never breaks the others. No scraping, no logins, no anti-bot evasion.
 */
export interface JobFeedProvider {
  id: string;
  name: string;
  /** Required by the provider's terms: shown on every result and linked back. */
  attribution: { label: string; url: string };
  origins: string[];
  /** Minimum minutes between network calls (provider fair-use). */
  minIntervalMinutes: number;
  search(q: DiscoveryQuery, fetcher: typeof fetch): Promise<Job[]>;
}

const toText = (html: string) => (typeof document !== "undefined" ? htmlToText(html) : html.replace(/<[^>]+>/g, " "));
const safeUrl = (u: unknown) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");

export const remotive: JobFeedProvider = {
  id: "remotive",
  name: "Remotive",
  attribution: { label: "Jobs via Remotive", url: "https://remotive.com" },
  origins: ["https://remotive.com/*"],
  minIntervalMinutes: 360, // provider asks for at most ~4 calls/day
  async search(q, fetcher) {
    const res = await fetcher(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q.keywords)}&limit=50`);
    if (!res.ok) throw new Error(`Remotive responded ${res.status}`);
    const json = (await res.json()) as { jobs?: Array<Record<string, any>> };
    return (json.jobs ?? []).flatMap((j) => {
      const description = toText(String(j.description ?? ""));
      if (!description || !j.title) return [];
      return [buildJob({
        provider: "remotive", providerJobId: String(j.id), url: safeUrl(j.url), title: String(j.title), company: String(j.company_name ?? ""),
        location: String(j.candidate_required_location ?? "Remote"), workMode: "remote", employmentType: String(j.job_type ?? "").replace(/_/g, " "),
        salaryRange: String(j.salary ?? ""), datePosted: typeof j.publication_date === "string" ? j.publication_date : undefined, description, extractorConfidence: 0.9,
      })];
    });
  },
};

export const arbeitnow: JobFeedProvider = {
  id: "arbeitnow",
  name: "Arbeitnow",
  attribution: { label: "Jobs via Arbeitnow", url: "https://www.arbeitnow.com" },
  origins: ["https://www.arbeitnow.com/*"],
  minIntervalMinutes: 60,
  async search(q, fetcher) {
    const res = await fetcher("https://www.arbeitnow.com/api/job-board-api");
    if (!res.ok) throw new Error(`Arbeitnow responded ${res.status}`);
    const json = (await res.json()) as { data?: Array<Record<string, any>> };
    const terms = q.keywords.toLowerCase().split(/\s+/).filter(Boolean);
    return (json.data ?? []).flatMap((j) => {
      const description = toText(String(j.description ?? ""));
      const hay = `${j.title} ${(j.tags ?? []).join(" ")} ${description}`.toLowerCase();
      if (!j.title || !description || (terms.length && !terms.every((t) => hay.includes(t)))) return [];
      if (q.remoteOnly && !j.remote) return [];
      return [buildJob({
        provider: "arbeitnow", providerJobId: String(j.slug), url: safeUrl(j.url), title: String(j.title), company: String(j.company_name ?? ""),
        location: String(j.location ?? ""), workMode: j.remote ? "remote" : "unknown", employmentType: (j.job_types ?? []).join(", "),
        datePosted: typeof j.created_at === "number" ? new Date(j.created_at * 1000).toISOString() : undefined, description, extractorConfidence: 0.9,
      })];
    });
  },
};

export const PROVIDERS: JobFeedProvider[] = [remotive, arbeitnow];

export interface ProviderOutcome { provider: string; ok: boolean; count: number; error?: string; cached?: boolean }

export interface CacheStore { get(k: string): Promise<{ at: number; jobs: Job[] } | undefined>; set(k: string, v: { at: number; jobs: Job[] }): Promise<void> }

/** Run providers independently (allSettled), honouring each provider's minimum interval via a cache. */
export async function runDiscovery(providers: JobFeedProvider[], q: DiscoveryQuery, fetcher: typeof fetch, cache: CacheStore, now = Date.now()): Promise<{ jobs: Job[]; outcomes: ProviderOutcome[] }> {
  const settled = await Promise.allSettled(providers.map(async (p) => {
    const key = `feed:${p.id}:${q.keywords.toLowerCase().trim()}:${q.remoteOnly ? 1 : 0}`;
    const hit = await cache.get(key);
    if (hit && now - hit.at < p.minIntervalMinutes * 60_000) return { p, jobs: hit.jobs, cached: true };
    const jobs = await p.search(q, fetcher);
    await cache.set(key, { at: now, jobs });
    return { p, jobs, cached: false };
  }));
  const outcomes: ProviderOutcome[] = settled.map((s, i) => s.status === "fulfilled"
    ? { provider: providers[i]!.id, ok: true, count: s.value.jobs.length, cached: s.value.cached }
    : { provider: providers[i]!.id, ok: false, count: 0, error: "Source unavailable. Try again later." });
  const all = settled.flatMap((s) => (s.status === "fulfilled" ? s.value.jobs : []));
  return { jobs: dedupeJobs(all), outcomes };
}

/** Search links for sites the user searches themselves. We only generate the URL; we never fetch these sites. */
export function searchLinks(keywords: string, location: string): Array<{ site: string; url: string }> {
  const kw = keywords.trim(), loc = location.trim();
  if (!kw) return [];
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [
    { site: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}${loc ? "&location=" + encodeURIComponent(loc) : ""}` },
    { site: "Naukri", url: `https://www.naukri.com/${slug(kw)}-jobs${loc ? "-in-" + slug(loc) : ""}` },
    { site: "Indeed", url: `https://www.indeed.com/jobs?q=${encodeURIComponent(kw)}${loc ? "&l=" + encodeURIComponent(loc) : ""}` },
  ];
}
