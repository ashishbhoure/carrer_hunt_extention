export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export type ResumeKind = "pdf" | "docx";

export class ResumeFileError extends Error {}

/** Validate by extension, MIME and magic bytes (never trust the filename alone). */
export async function validateResumeFile(file: File): Promise<ResumeKind> {
  if (file.size === 0) throw new ResumeFileError("The file is empty.");
  if (file.size > MAX_RESUME_BYTES) throw new ResumeFileError(`The file is too large (max ${MAX_RESUME_BYTES / 1024 / 1024} MB).`);
  const name = file.name.toLowerCase();
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if (name.endsWith(".pdf") && isPdf) return "pdf";
  if (name.endsWith(".docx") && isZip) return "docx";
  if (name.endsWith(".doc")) throw new ResumeFileError("Legacy .doc files are not supported. Save the resume as DOCX or PDF.");
  throw new ResumeFileError("Only PDF and DOCX files are supported, and the file contents must match its extension.");
}

async function extractPdf(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    const rows = new Map<number, Array<{ x: number; s: string }>>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const y = Math.round(item.transform[5] / 3) * 3;
      const row = rows.get(y) ?? [];
      row.push({ x: item.transform[4], s: item.str });
      rows.set(y, row);
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => r.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim());
    pages.push(lines.join("\n"));
  }
  await doc.destroy();
  return pages.join("\n");
}

async function extractDocx(buf: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf });
  return value;
}

/** Runs entirely in the browser; the file is never uploaded. */
export async function extractResumeText(file: File, kind: ResumeKind): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return (kind === "pdf" ? await extractPdf(buf) : await extractDocx(buf)).replace(/\u0000/g, "").trim();
  } catch (e) {
    throw new ResumeFileError("Could not read this file. It may be corrupted or password-protected.");
  }
}
