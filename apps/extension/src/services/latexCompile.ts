import { isValidPdf } from "@careerpilot/shared";
import { settingsRepo } from "../storage/db";

export const LATEX_ENDPOINT = "https://texlive.net/cgi-bin/latexcgi";
export const LATEX_ORIGIN = "https://texlive.net/*";

export class LatexError extends Error {
  constructor(public code: "no_consent" | "no_permission" | "offline" | "compile_failed" | "bad_response", message: string) { super(message); }
}

export async function hasLatexConsent() { return (await settingsRepo.get()).latexConsent; }
export async function grantLatexConsent(v: boolean) { await settingsRepo.update({ latexConsent: v }); }

/** Ask Chrome for access to the compiler host. Must be called from a user gesture. */
export async function requestLatexPermission(): Promise<boolean> {
  return chrome.permissions.request({ origins: [LATEX_ORIGIN] });
}

/**
 * Compile LaTeX to PDF using the public texlive.net service (pdflatex).
 * The document text is sent to that service, so this only runs after explicit consent.
 */
export async function compileLatexToPdf(tex: string, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<Blob> {
  if (!(await hasLatexConsent())) throw new LatexError("no_consent", "Online LaTeX compilation needs your consent first.");
  if (typeof chrome !== "undefined" && chrome.permissions && !(await chrome.permissions.contains({ origins: [LATEX_ORIGIN] }))) {
    throw new LatexError("no_permission", "Chrome permission for the LaTeX compiler hasn't been granted.");
  }
  const form = new FormData();
  form.append("filecontents[]", new Blob([tex], { type: "text/plain" }), "document.tex");
  form.append("filename[]", "document.tex");
  form.append("engine", "pdflatex");
  form.append("return", "pdf");
  let res: Response;
  try { res = await fetcher(LATEX_ENDPOINT, { method: "POST", body: form, redirect: "follow" }); }
  catch { throw new LatexError("offline", "Couldn't reach the LaTeX compiler. Check your connection, or download the .tex file."); }
  if (!res.ok) throw new LatexError("compile_failed", `The LaTeX compiler returned an error (${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!isValidPdf(bytes)) {
    const log = new TextDecoder().decode(bytes.slice(0, 4000));
    const hint = /! ([^\n]{5,120})/.exec(log)?.[1];
    throw new LatexError("compile_failed", `LaTeX compilation failed${hint ? `: ${hint}` : ""}. Download the .tex and fix it, or use the quick PDF.`);
  }
  return new Blob([bytes], { type: "application/pdf" });
}
