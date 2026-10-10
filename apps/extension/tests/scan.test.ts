import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractJobList } from "../src/adapters/list";
import { cardToJob, scoreCards } from "../src/popup/ScanList";
import { parseTabTitle } from "../src/popup/Popup";
import { LatexError, compileLatexToPdf, grantLatexConsent } from "../src/services/latexCompile";
import { profileRepo, resumesRepo } from "../src/storage/db";
import { nowIso, parseResumeText, uid, type Resume } from "@careerpilot/shared";
import { RESUME_TEXT, resetAll } from "./helpers";

const doc = (html: string) => new DOMParser().parseFromString(html, "text/html");

const card = (id: number, title: string, company: string, skills: string[], exp = "3-5 Yrs") => `
  <div class="srp-jobtuple-wrapper"><article class="jobTuple">
    <a class="title" href="/job-listings-${title.toLowerCase().replace(/\W+/g, "-")}-${id}">${title}</a>
    <a class="comp-name" href="/company/${company}">${company}</a>
    <span class="expwdth">${exp}</span><span class="locWdth">Pune, Mumbai</span>
    <span class="sal">8-12 Lacs PA</span>
    <div class="job-desc">Looking for a developer to build and maintain web applications for our customers.</div>
    <ul class="tags-gt">${skills.map((s) => `<li class="tag-li">${s}</li>`).join("")}</ul>
  </article></div>`;

const NAUKRI = `<html><body><div class="list">
  ${card(1, "MERN Stack Developer", "Acme", ["React", "Node.js", "MongoDB", "Express"])}
  ${card(2, "Java Backend Engineer", "Beta", ["Java", "Spring Boot", "Kubernetes", "Kafka"], "5-8 Yrs")}
  ${card(3, "React Developer", "Gamma", ["React", "TypeScript", "Redux"], "2-4 Yrs")}
</div></body></html>`;

describe("job list extraction", () => {
  it("reads every card on a Naukri-style results page", () => {
    const r = extractJobList({ doc: doc(NAUKRI), url: new URL("https://www.naukri.com/mern-jobs") });
    expect(r.status).toBe("ok");
    expect(r.cards.map((c) => c.title)).toEqual(["MERN Stack Developer", "Java Backend Engineer", "React Developer"]);
    expect(r.cards[0]).toMatchObject({ company: "Acme", experience: "3-5 Yrs", skills: ["React", "Node.js", "MongoDB", "Express"] });
    expect(r.cards[0]!.url).toBe("https://www.naukri.com/job-listings-mern-stack-developer-1");
    expect(r.cards[0]!.salary).toMatch(/8-12/);
  });
  it("falls back to structure-based detection on unknown sites", () => {
    const html = `<html><body><main>${[1, 2, 3].map((i) => `<li><div><a href="/jobs/view/${i}">Developer ${i}</a><p>Company ${i} · Remote · 3+ years of experience with React</p></div></li>`).join("")}</main><a href="/about">About us</a></body></html>`;
    const r = extractJobList({ doc: doc(html), url: new URL("https://careers.example.com/search") });
    expect(r.status).toBe("ok");
    expect(r.cards).toHaveLength(3);
    expect(r.cards[1]!.url).toBe("https://careers.example.com/jobs/view/2");
  });
  it("never reads LinkedIn lists", () => {
    const r = extractJobList({ doc: doc(NAUKRI), url: new URL("https://www.linkedin.com/jobs/search/") });
    expect(r).toMatchObject({ status: "unsupported", cards: [] });
    expect(r.message).toMatch(/doesn't allow/);
  });
  it("reports pages without job cards", () => {
    expect(extractJobList({ doc: doc("<html><body><p>Hello</p></body></html>"), url: new URL("https://example.com/") }).status).toBe("none_found");
  });
  it("de-duplicates repeated cards", () => {
    const r = extractJobList({ doc: doc(NAUKRI + NAUKRI.replace("<html><body>", "")), url: new URL("https://www.naukri.com/x") });
    expect(r.cards).toHaveLength(3);
  });
});

describe("scoring result cards", () => {
  beforeEach(resetAll);
  it("ranks cards by match, flags them as partial, and never invents detail", async () => {
    const parsed = parseResumeText(RESUME_TEXT);
    const resume: Resume = { id: uid(), title: "r", description: "", fileName: "r.docx", mimeType: "x", size: 1, extractedText: RESUME_TEXT, parsedProfile: parsed.profile, parsingConfidence: 1, parsingFlags: [], parsingStatus: "parsed", isDefault: true, createdAt: nowIso(), updatedAt: nowIso() };
    await resumesRepo.put(resume); await profileRepo.put(parsed.profile);
    const list = extractJobList({ doc: doc(NAUKRI), url: new URL("https://www.naukri.com/mern-jobs") });
    const rows = await scoreCards({ ...list, tabUrl: "https://www.naukri.com/mern-jobs" }, resume.id);
    expect(rows.map((r) => r.card.company)).toEqual(["Acme", "Gamma", "Beta"]);
    expect(rows[0]!.analysis.totalScore).toBeGreaterThan(rows[2]!.analysis.totalScore + 20);
    expect(rows[0]!.analysis.incomplete).toBe(true);
    expect(rows[2]!.analysis.skillMatches.some((m) => m.skill === "Kubernetes" && m.status === "not_found")).toBe(true);
    expect(cardToJob(list.cards[0]!, "naukri", "https://x").requiredSkills).toEqual(expect.arrayContaining(["React", "Node.js", "MongoDB"]));
    await expect(scoreCards(list as never, "missing")).rejects.toThrow(/resume/i);
  });
});

describe("LinkedIn helper", () => {
  it("prefills title and company from the tab title (metadata, not page content)", () => {
    expect(parseTabTitle("Software Developer 2 | Vena Solutions | LinkedIn")).toEqual({ title: "Software Developer 2", company: "Vena Solutions" });
    expect(parseTabTitle("MERN Dev - Acme - Naukri.com")).toEqual({ title: "MERN Dev", company: "Acme" });
    expect(parseTabTitle("")).toEqual({ title: "", company: "" });
  });
});

describe("LaTeX compile", () => {
  beforeEach(async () => { await resetAll(); vi.stubGlobal("chrome", { permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) } }); });
  const pdf = () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, ...new Array(200).fill(32)]), { status: 200 });
  it("requires consent before anything is sent", async () => {
    const fetcher = vi.fn();
    await expect(compileLatexToPdf("x", fetcher as never)).rejects.toMatchObject({ code: "no_consent" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires the Chrome host permission", async () => {
    await grantLatexConsent(true);
    (chrome.permissions.contains as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    await expect(compileLatexToPdf("x", vi.fn() as never)).rejects.toMatchObject({ code: "no_permission" });
  });
  it("posts the tex and returns a validated PDF", async () => {
    await grantLatexConsent(true);
    const fetcher = vi.fn(async () => pdf());
    const blob = await compileLatexToPdf("\\documentclass{article}", fetcher as never);
    expect(blob.type).toBe("application/pdf");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://texlive.net/cgi-bin/latexcgi");
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("engine")).toBe("pdflatex");
  });
  it("surfaces compile errors and network failures", async () => {
    await grantLatexConsent(true);
    const bad = vi.fn(async () => new Response("! Undefined control sequence.\nl.5 \\foo", { status: 200 }));
    await expect(compileLatexToPdf("x", bad as never)).rejects.toThrow(/Undefined control sequence/);
    const off = vi.fn(async () => { throw new TypeError("net"); });
    await expect(compileLatexToPdf("x", off as never)).rejects.toBeInstanceOf(LatexError);
  });
});
