import type { ExtractedJobFields } from "@careerpilot/shared";
import { htmlToText } from "./dom";

type Json = Record<string, any>;

function flatten(node: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(node)) node.forEach((n) => flatten(n, out));
  else if (node && typeof node === "object") {
    out.push(node as Json);
    const g = (node as Json)["@graph"];
    if (g) flatten(g, out);
  }
  return out;
}

const isJobPosting = (n: Json) => [n["@type"]].flat().some((t) => String(t).toLowerCase() === "jobposting");

export function findJobPosting(doc: Document): Json | null {
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const found = flatten(JSON.parse(s.textContent ?? "null")).find(isJobPosting);
      if (found) return found;
    } catch { /* malformed JSON-LD is common; ignore */ }
  }
  return null;
}

function location(jp: Json): string {
  const locs = [jp.jobLocation].flat().filter(Boolean) as Json[];
  const parts = locs.map((l) => {
    const a = l.address ?? {};
    return [a.addressLocality, a.addressRegion, a.addressCountry?.name ?? a.addressCountry].filter((x) => typeof x === "string" && x).join(", ");
  }).filter(Boolean);
  const remote = String(jp.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE" ? "Remote" : "";
  return [...new Set([...parts, remote].filter(Boolean))].join(" / ");
}

function salary(jp: Json): string {
  const s = jp.baseSalary;
  if (!s) return "";
  const v = s.value ?? {};
  const cur = s.currency ?? v.currency ?? "";
  const unit = v.unitText ? `/${String(v.unitText).toLowerCase()}` : "";
  if (typeof v === "number") return `${cur} ${v}${unit}`.trim();
  if (v.minValue || v.maxValue) return `${cur} ${v.minValue ?? ""}${v.maxValue ? "–" + v.maxValue : ""}${unit}`.trim();
  if (v.value) return `${cur} ${v.value}${unit}`.trim();
  return "";
}

/** Map schema.org JobPosting to our extracted fields. Returns only what the page states. */
export function fromJobPosting(jp: Json, doc: Document): Partial<ExtractedJobFields> {
  const desc = typeof jp.description === "string" ? htmlToText(jp.description, doc) : "";
  const org = jp.hiringOrganization;
  return {
    title: typeof jp.title === "string" ? jp.title.trim() : "",
    company: (typeof org === "string" ? org : org?.name) ?? "",
    location: location(jp),
    description: desc,
    employmentType: [jp.employmentType].flat().filter(Boolean).map((e) => String(e).replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())).join(", "),
    salaryRange: salary(jp),
    datePosted: typeof jp.datePosted === "string" ? jp.datePosted : undefined,
    applicationUrl: typeof jp.url === "string" && /^https?:/.test(jp.url) ? jp.url : "",
  };
}
