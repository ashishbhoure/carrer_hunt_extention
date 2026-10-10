import type { CareerProfile, DocumentSection } from "./schemas";

const MAP: Record<string, string> = { "\\": "\\textbackslash{}", "&": "\\&", "%": "\\%", $: "\\$", "#": "\\#", _: "\\_", "{": "\\{", "}": "\\}", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" };

/** Escape user text for LaTeX so resume content can never inject commands. */
export function escapeLatex(s: string): string {
  return s
    .replace(/[\\&%$#_{}~^]/g, (c) => MAP[c]!)
    .replace(/[–—]/g, "--")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/•/g, "-")
    .replace(/₹/g, "Rs.")
    .replace(/[^\x09\x0a\x20-\x7e]/g, (c) => (/[À-ɏ]/.test(c) ? c : "?"));
}

const PREAMBLE = String.raw`\documentclass[10pt,a4paper]{article}
\usepackage[margin=0.8in]{geometry}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{titlesec}
\titleformat{\section}{\large\bfseries\scshape}{}{0em}{}[\titlerule]
\titlespacing*{\section}{0pt}{10pt}{5pt}
\setlist[itemize]{leftmargin=1.4em,itemsep=1pt,topsep=2pt}
\pagestyle{empty}
\setlength{\parindent}{0pt}
`;

function body(text: string, heading: string): string {
  if (heading === "Skills") return escapeLatex(text.replace(/\n/g, " "));
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const bullets = lines.filter((l) => /^[•\-*]\s/.test(l));
    const plain = lines.filter((l) => !/^[•\-*]\s/.test(l));
    const head = plain.length ? (heading === "Summary" || heading === "Certifications" || heading === "Education" ? plain.map(escapeLatex).join(" \\\\\n") : `\\textbf{${escapeLatex(plain[0]!)}}${plain.slice(1).map((p) => " \\\\\n" + escapeLatex(p)).join("")}`) : "";
    const items = bullets.length ? `\n\\begin{itemize}\n${bullets.map((b) => `  \\item ${escapeLatex(b.replace(/^[•\-*]\s/, ""))}`).join("\n")}\n\\end{itemize}` : "";
    return head + items;
  }).join("\n\n\\vspace{4pt}\n");
}

/** Build a clean single-column LaTeX resume from the final (accepted/rejected-resolved) sections. */
export function resumeToLatex(profile: CareerProfile, sections: DocumentSection[]): string {
  const c = profile.contact;
  const contact = [c.email && `\\href{mailto:${escapeLatex(c.email)}}{${escapeLatex(c.email)}}`, c.phone && escapeLatex(c.phone), c.location && escapeLatex(c.location), ...c.links.map((l) => escapeLatex(l))].filter(Boolean).join(" \\quad|\\quad ");
  const secs = ["Summary", "Skills", "Experience", "Projects", "Education", "Certifications"].flatMap((h) => {
    const s = sections.find((x) => x.heading === h);
    const text = s ? (s.decision === "rejected" ? s.original : s.proposed) : "";
    return text.trim() ? [`\\section*{${h}}\n${body(text, h)}`] : [];
  });
  return `${PREAMBLE}\\begin{document}\n\\begin{center}\n{\\LARGE\\bfseries ${escapeLatex(c.fullName || "Resume")}}\\\\[4pt]\n${contact}\n\\end{center}\n\n${secs.join("\n\n")}\n\\end{document}\n`;
}

/** Plain-text letter (cover letter) to LaTeX. */
export function letterToLatex(text: string): string {
  const paras = text.split(/\n{2,}/).map((p) => escapeLatex(p.trim()).replace(/\n/g, " \\\\\n")).filter(Boolean);
  return `${PREAMBLE}\\begin{document}\n${paras.join("\n\n\\vspace{8pt}\n")}\n\\end{document}\n`;
}

export function isValidPdf(bytes: Uint8Array): boolean {
  return bytes.length > 100 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
