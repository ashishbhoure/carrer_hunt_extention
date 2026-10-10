import type { ListCard } from "@careerpilot/shared";
import { parseExperience, parseSalary } from "@careerpilot/shared";
import type { AdapterContext } from "./types";
import { text } from "./dom";

const JOB_HREF = /(job-listings|\/jobs?\/|\/job-|\/jd\/|viewjob|\/j\/|\/careers?\/|jobdetail|[?&]jk=)/i;

const SITE_CARDS: Array<[RegExp, string]> = [
  [/naukri\.com$/, ".srp-jobtuple-wrapper, article.jobTuple, .cust-job-tuple, [class*='jobTuple']"],
  [/hirist\.(tech|com)$/, "[class*='job-card' i], [class*='jobCard' i], [class*='job-tuple' i]"],
  [/indeed\./, ".job_seen_beacon, [data-jk]"],
];

const isLinkedIn = (u: URL) => /(^|\.)linkedin\.com$/.test(u.hostname);

function abs(href: string | null, base: URL): string {
  try { return href ? new URL(href, base).href : ""; } catch { return ""; }
}

function jobAnchors(el: Element): HTMLAnchorElement[] {
  return Array.from(el.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((a) => JOB_HREF.test(a.getAttribute("href") ?? "") && text(a).length > 2);
}

/** Group job links into card containers without relying on site-specific class names. */
function genericCards(doc: Document): Element[] {
  const seen = new Set<Element>();
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((x) => JOB_HREF.test(x.getAttribute("href") ?? "") && text(x).length > 3)) {
    let el: Element | null = a;
    let best: Element | null = null;
    // climb while the ancestor still contains a single distinct job link
    for (let i = 0; i < 6 && el?.parentElement && el.parentElement !== doc.body; i++) {
      const p: Element = el.parentElement;
      const hrefs = new Set(jobAnchors(p).map((x) => x.getAttribute("href")));
      if (hrefs.size > 1) break;
      el = p;
      if (text(p).length >= 40) best = p;
    }
    if (best) seen.add(best);
  }
  return [...seen];
}

const pick = (el: Element, sel: string) => text(el.querySelector(sel));

function readCard(el: Element, base: URL): ListCard | null {
  const links = jobAnchors(el);
  const titleEl = el.querySelector<HTMLAnchorElement>("a[class*='title' i], [class*='title' i] a, h2 a, h3 a") ?? links[0];
  const title = text(titleEl);
  if (!title || title.length > 160) return null;
  const all = text(el);
  const company = pick(el, "[class*='comp-name' i], [class*='company' i], [class*='employer' i], [data-testid*='company' i]");
  const location = pick(el, "[class*='locWdth' i], [class*='location' i], [class*='loc' i]");
  const expText = pick(el, "[class*='expwdth' i], [class*='exp' i]") || parseExperience(all).text;
  const salary = pick(el, "[class*='sal' i]") || parseSalary(all);
  const skills = Array.from(el.querySelectorAll("li[class*='tag' i], li[class*='skill' i], [class*='tags' i] li, [class*='skill' i] li")).map((x) => text(x)).filter((s) => s && s.length < 40).slice(0, 15);
  const snippet = pick(el, "[class*='job-desc' i], [class*='description' i], [class*='snippet' i]") || all.slice(0, 500);
  return { title, company, location, experience: expText, salary, skills, snippet: snippet.slice(0, 600), url: abs((titleEl as HTMLAnchorElement | undefined)?.getAttribute?.("href") ?? links[0]?.getAttribute("href") ?? null, base) };
}

/**
 * Read the job cards visible on a search-results page the user is already viewing.
 * Only DOM already rendered by the page is read: no scrolling, clicking, navigation or extra requests.
 * LinkedIn is deliberately excluded (its terms forbid extensions reading its pages).
 */
export function extractJobList(ctx: AdapterContext): { status: "ok" | "none_found" | "unsupported"; cards: ListCard[]; provider: string; message?: string } {
  if (isLinkedIn(ctx.url)) return { status: "unsupported", cards: [], provider: "linkedin", message: "LinkedIn doesn't allow extensions to read its job lists. Open a job, select its description text and analyse it, or paste it." };
  const site = SITE_CARDS.find(([re]) => re.test(ctx.url.hostname));
  let els: Element[] = [];
  if (site) { try { els = Array.from(ctx.doc.querySelectorAll(site[1])); } catch { els = []; } }
  els = els.filter((e) => jobAnchors(e).length > 0 || text(e).length > 40);
  if (els.length < 2) els = genericCards(ctx.doc);
  const cards: ListCard[] = [];
  const seen = new Set<string>();
  for (const el of els) {
    const c = readCard(el, ctx.url);
    if (!c) continue;
    const key = c.url || `${c.title}|${c.company}`;
    if (seen.has(key)) continue;
    seen.add(key); cards.push(c);
    if (cards.length >= 60) break;
  }
  const provider = ctx.url.hostname.replace(/^www\./, "").split(".")[0] ?? "generic";
  return cards.length ? { status: "ok", cards, provider } : { status: "none_found", cards: [], provider, message: "No job cards were found on this page. Open a search-results page, or analyse a single job instead." };
}
