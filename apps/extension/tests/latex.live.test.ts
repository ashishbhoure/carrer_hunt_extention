// @vitest-environment node
// Network test: compiles generated LaTeX on texlive.net. Run with LATEX_LIVE=1 (skipped by default).
import { describe, expect, it } from "vitest";
import { analyzeJob, buildJob, letterToLatex, parseResumeText, resumeToLatex, tailorResumeDeterministic, coverLetterDeterministic, isValidPdf } from "@careerpilot/shared";
import { JD_TEXT, RESUME_TEXT } from "./fixtures";

const live = process.env.LATEX_LIVE === "1";

async function compile(tex: string) {
  const form = new FormData();
  form.append("filecontents[]", new Blob([tex]), "document.tex");
  form.append("filename[]", "document.tex");
  form.append("engine", "pdflatex");
  form.append("return", "pdf");
  const res = await fetch("https://texlive.net/cgi-bin/latexcgi", { method: "POST", body: form, redirect: "follow" });
  return new Uint8Array(await res.arrayBuffer());
}

describe.skipIf(!live)("texlive.net compile (live)", () => {
  const { profile } = parseResumeText(RESUME_TEXT);
  const job = buildJob({ title: "MERN Stack Developer", company: "LogiCo", description: JD_TEXT });
  const analysis = analyzeJob({ job, profile, resumeId: "r", resumeText: RESUME_TEXT });
  it("compiles the tailored resume, including hostile characters", async () => {
    const { sections } = tailorResumeDeterministic({ ...profile, summary: "R&D lead: 50% faster #1 $ _ ^ ~ {x} \input{evil}" }, job, analysis, RESUME_TEXT);
    const tex = resumeToLatex({ ...profile, summary: "R&D lead: 50% faster #1 $ _ ^ ~ {x} \input{evil}" }, sections);
    expect(isValidPdf(await compile(tex))).toBe(true);
  }, 90_000);
  it("compiles the cover letter", async () => {
    expect(isValidPdf(await compile(letterToLatex(coverLetterDeterministic(profile, job, analysis, "I enjoy logistics & routing.")))))
      .toBe(true);
  }, 90_000);
});
