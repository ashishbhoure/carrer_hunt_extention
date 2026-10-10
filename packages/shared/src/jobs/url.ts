import { hashString } from "../util";
import type { Job } from "../schemas";

const TRACKING = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|ref|refid|trk|trackingid|src|source|campaign|cmpid|referrer|lipi|licu|originalsubdomain)$/i;

/** Strip tracking params, fragments, www., trailing slashes; lowercase host; sort remaining params. */
export function canonicalizeUrl(input: string): string {
  if (!input) return "";
  let u: URL;
  try { u = new URL(input.trim()); } catch { return ""; }
  if (!/^https?:$/.test(u.protocol)) return "";
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  const keep: Array<[string, string]> = [];
  u.searchParams.forEach((v, k) => { if (!TRACKING.test(k)) keep.push([k, v]); });
  keep.sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of keep) u.searchParams.append(k, v);
  let path = u.pathname.replace(/\/+$/, "");
  // LinkedIn: /jobs/view/<id> or currentJobId=<id> -> stable form
  const li = /linkedin\.com$/.test(u.hostname) ? (/\/jobs\/view\/(?:[^/]*-)?(\d+)/.exec(u.pathname)?.[1] ?? u.searchParams.get("currentJobId")) : null;
  if (li) return `linkedin.com/jobs/view/${li}`;
  return `${u.hostname}${path}${u.search}`;
}

export function providerFromUrl(url: string): string {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (h.includes("linkedin.")) return "linkedin";
    if (h.includes("naukri.")) return "naukri";
    if (h.includes("hirist.")) return "hirist";
    if (h.includes("indeed.")) return "indeed";
    return h.replace(/^www\./, "") || "manual";
  } catch { return "manual"; }
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\b(pvt|private|ltd|limited|inc|llc|corp|technologies|technology|solutions)\b\.?/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export function jobFingerprint(j: Pick<Job, "title" | "company" | "location">): string {
  return hashString(`${norm(j.title)}|${norm(j.company)}|${norm(j.location.split(",")[0] ?? "")}`);
}

export function contentHash(description: string): string {
  return hashString(description.replace(/\s+/g, " ").trim().toLowerCase());
}

export type DuplicateReason = "canonical_url" | "provider_id" | "fingerprint";

export function findDuplicate(candidate: Job, existing: Job[]): { job: Job; reason: DuplicateReason } | null {
  for (const e of existing) {
    if (e.id === candidate.id) continue;
    if (candidate.canonicalUrl && e.canonicalUrl === candidate.canonicalUrl) return { job: e, reason: "canonical_url" };
    if (candidate.providerJobId && e.providerJobId === candidate.providerJobId && e.provider === candidate.provider) return { job: e, reason: "provider_id" };
    if (candidate.title && candidate.company && e.fingerprint === candidate.fingerprint) return { job: e, reason: "fingerprint" };
  }
  return null;
}

export function dedupeJobs<T extends Job>(jobs: T[]): T[] {
  const out: T[] = [];
  for (const j of jobs) if (!findDuplicate(j, out)) out.push(j);
  return out;
}
