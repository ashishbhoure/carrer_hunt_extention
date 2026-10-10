import type { ExtractedJobFields, ExtractionStatus } from "@careerpilot/shared";
import type { AdapterContext, JobSourceAdapter } from "./types";
import { findJobPosting, fromJobPosting } from "./jsonld";
import { firstText, htmlToText, meta, text } from "./dom";

const MIN_DESC = 200;

function statusOf(r: Partial<ExtractedJobFields>): ExtractionStatus {
  const d = (r.description ?? "").length;
  if (!r.title && d < MIN_DESC) return "not_a_job_page";
  if (r.title && r.company && d >= MIN_DESC) return "ok";
  if (d >= MIN_DESC || r.title) return "partial";
  return "failed";
}

const JOB_HINT = /(responsibilit|requirement|qualification|what you('ll| will)|about the (role|job)|job description|skills|experience)/i;

/** Last-resort: find the element with the most job-like text. Low confidence. */
function largestJobBlock(doc: Document): string {
  const candidates = Array.from(doc.querySelectorAll("main, article, section, [role=main], [class*=description i], [class*=job i], [id*=description i], [id*=job i]"));
  let best = ""; let bestScore = 0;
  for (const el of candidates) {
    const t = htmlToText(el, doc);
    if (t.length < MIN_DESC || t.length > 30000) continue;
    const score = Math.min(t.length, 6000) + (JOB_HINT.test(t) ? 3000 : 0);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

function selectionText(doc: Document): string {
  const s = doc.defaultView?.getSelection?.()?.toString().trim() ?? "";
  return s.length >= MIN_DESC ? s : "";
}

/** Generic adapter: JSON-LD JobPosting → semantic/meta → largest job-like block. */
function extractGeneric(ctx: AdapterContext, selectors: { title?: string[]; company?: string[]; location?: string[]; description?: string[] } = {}): Partial<ExtractedJobFields> {
  const { doc } = ctx;
  const notes: string[] = [];
  const jp = findJobPosting(doc);
  let r: Partial<ExtractedJobFields> = {};
  let confidence = 0.2;
  if (jp) { r = fromJobPosting(jp, doc); confidence = 0.9; notes.push("Read from the page's structured job metadata (JSON-LD)."); }

  if (!r.title) r.title = firstText(doc, [...(selectors.title ?? []), '[itemprop="title"]', "h1"]) || meta(doc, "og:title");
  if (!r.company) r.company = firstText(doc, [...(selectors.company ?? []), '[itemprop="hiringOrganization"] [itemprop="name"]', '[itemprop="hiringOrganization"]']) || meta(doc, "og:site_name");
  if (!r.location) r.location = firstText(doc, [...(selectors.location ?? []), '[itemprop="jobLocation"]']);
  if (!r.description || r.description.length < MIN_DESC) {
    let d = "";
    for (const s of selectors.description ?? []) { try { const el = doc.querySelector(s); if (el) d = htmlToText(el, doc); } catch { /* ignore */ } if (d.length >= MIN_DESC) break; }
    if (d.length < MIN_DESC) d = largestJobBlock(doc);
    if (d.length >= MIN_DESC) { r.description = d; confidence = Math.min(confidence, jp ? 0.7 : 0.5); notes.push("Description was located heuristically; please verify it is complete."); }
  }
  if (!r.title) notes.push("Job title could not be detected reliably.");
  if (!r.company) notes.push("Company could not be detected reliably.");
  r.confidence = confidence - (r.title ? 0 : 0.15) - (r.company ? 0 : 0.1);
  r.notes = notes;
  return r;
}

const base = (id: string, hosts: RegExp, sel: Parameters<typeof extractGeneric>[1] = {}): JobSourceAdapter => ({
  id,
  canHandle: (url) => hosts.test(url.hostname),
  extractJobDetails: (ctx) => ({ ...extractGeneric(ctx, sel), provider: id, url: ctx.url.href }),
  extractJobDescription: (ctx) => extractGeneric(ctx, sel).description ?? "",
  getApplicationLink: (ctx) => {
    const a = Array.from(ctx.doc.querySelectorAll("a[href]")).find((x) => /^(apply( now| here| on company site)?|apply for this job)$/i.test(text(x)));
    try { return a ? new URL((a as HTMLAnchorElement).getAttribute("href")!, ctx.url).href : ""; } catch { return ""; }
  },
  getExtractionStatus: statusOf,
});

/**
 * LinkedIn forbids third-party tools that scrape or modify its pages, so this adapter never reads the
 * page DOM. It only uses text the user has selected themselves, plus the URL. Title/company are entered by the user.
 */
const linkedin: JobSourceAdapter = {
  id: "linkedin",
  canHandle: (url) => /(^|\.)linkedin\.com$/.test(url.hostname),
  extractJobDetails: (ctx) => {
    const description = selectionText(ctx.doc);
    return {
      provider: "linkedin", url: ctx.url.href, description,
      confidence: description ? 0.4 : 0,
      notes: description
        ? ["Used the text you selected. Please enter the title and company."]
        : ["LinkedIn does not allow extensions to read its pages. Select the job description text on the page, then analyse again — or paste it manually."],
    };
  },
  extractJobDescription: (ctx) => selectionText(ctx.doc),
  getApplicationLink: () => "",
  getExtractionStatus: (r) => ((r.description ?? "").length >= MIN_DESC ? "partial" : "unsupported"),
};

// Best-effort, attribute-substring selectors; JSON-LD is tried first, so these are only a fallback.
const naukri = base("naukri", /(^|\.)naukri\.com$/, { title: ["h1[class*=jd-header-title i]", "h1"], company: ["[class*=jd-header-comp-name i] a", "[class*=comp-name i]"], description: ["[class*=job-desc i]", "[class*=JDC i]", "section[class*=job-desc i]"] });
const hirist = base("hirist", /(^|\.)hirist\.(tech|com)$/, { title: ["h1"], description: ["[class*=job-description i]", "[class*=description i]"] });
const indeed = base("indeed", /(^|\.)indeed\.[a-z.]+$/, { title: ["h1[class*=jobsearch-JobInfoHeader-title i]", "h1"], description: ["#jobDescriptionText"] });
const generic = base("generic", /.*/);

export const ADAPTERS: JobSourceAdapter[] = [linkedin, naukri, hirist, indeed];

export function pickAdapter(url: URL): JobSourceAdapter {
  return ADAPTERS.find((a) => a.canHandle(url)) ?? generic;
}

export function extractFromPage(ctx: AdapterContext) {
  const adapter = pickAdapter(ctx.url);
  const details = adapter.extractJobDetails(ctx);
  const description = (details.description && details.description.length ? details.description : adapter.extractJobDescription(ctx)) ?? "";
  const merged = { ...details, description, applicationUrl: details.applicationUrl || adapter.getApplicationLink(ctx), url: ctx.url.href, provider: adapter.id };
  // Selected text always wins when present: it is the user's explicit input.
  const sel = adapter.id === "linkedin" ? "" : selectionText(ctx.doc);
  if (sel) { merged.description = sel; merged.notes = [...(merged.notes ?? []), "Used the text you selected on the page."]; }
  return { adapterId: adapter.id, status: adapter.getExtractionStatus(merged), fields: merged };
}
