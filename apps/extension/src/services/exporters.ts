export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 60) || "document";

export function exportTex(content: string, name: string) {
  saveBlob(new Blob([content], { type: "application/x-tex" }), `${safeName(name)}.tex`);
}

export function exportBlobAs(blob: Blob, name: string, ext: string) {
  saveBlob(blob, `${safeName(name)}.${ext}`);
}

export function exportTxt(content: string, name: string) {
  saveBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), `${safeName(name)}.txt`);
}

const SECTION_HEADS = new Set(["SUMMARY", "SKILLS", "EXPERIENCE", "PROJECTS", "EDUCATION", "CERTIFICATIONS"]);

export async function exportDocx(content: string, name: string) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
  const lines = content.split("\n");
  const paragraphs = lines.map((line, i) => {
    if (i === 0 && line.trim()) return new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: line, bold: true })] });
    if (SECTION_HEADS.has(line.trim())) return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240 }, children: [new TextRun({ text: line.trim(), bold: true })] });
    if (line.startsWith("• ")) return new Paragraph({ bullet: { level: 0 }, children: [new TextRun(line.slice(2))] });
    return new Paragraph({ children: [new TextRun(line)] });
  });
  const doc = new Document({ sections: [{ children: paragraphs }] });
  saveBlob(await Packer.toBlob(doc), `${safeName(name)}.docx`);
}

export async function exportPdf(content: string, name: string) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48, width = pdf.internal.pageSize.getWidth() - margin * 2, pageH = pdf.internal.pageSize.getHeight();
  let y = margin;
  const lines = content.split("\n");
  lines.forEach((raw, i) => {
    const head = SECTION_HEADS.has(raw.trim());
    pdf.setFont("helvetica", head || i === 0 ? "bold" : "normal");
    pdf.setFontSize(i === 0 ? 18 : head ? 12 : 10.5);
    if (head) y += 8;
    for (const part of pdf.splitTextToSize(raw || " ", width) as string[]) {
      if (y > pageH - margin) { pdf.addPage(); y = margin; }
      pdf.text(part, margin, y);
      y += i === 0 ? 22 : 14;
    }
  });
  saveBlob(pdf.output("blob"), `${safeName(name)}.pdf`);
}

export function exportJson(data: unknown, name: string) {
  saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `${safeName(name)}.json`);
}
