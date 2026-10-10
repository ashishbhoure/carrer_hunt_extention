/** Convert an HTML fragment (or element) to readable plain text, preserving lists and paragraphs. */
export function htmlToText(input: string | Element, doc: Document = document): string {
  const root: Element = typeof input === "string" ? Object.assign(doc.createElement("div"), { innerHTML: input }) : input;
  const out: string[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 3) { out.push((n.textContent ?? "").replace(/\s+/g, " ")); return; }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    if (["script", "style", "noscript", "svg", "iframe"].includes(tag)) return;
    if (tag === "br") { out.push("\n"); return; }
    const block = ["p", "div", "section", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "article"].includes(tag);
    if (tag === "li") out.push("\n- ");
    else if (block) out.push("\n");
    el.childNodes.forEach(walk);
    if (block) out.push("\n");
  };
  walk(root);
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

export const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

export function firstText(doc: Document, selectors: string[]): string {
  for (const s of selectors) {
    try { const t = text(doc.querySelector(s)); if (t) return t; } catch { /* invalid selector on this browser */ }
  }
  return "";
}

export function meta(doc: Document, name: string): string {
  return (doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`) as HTMLMetaElement | null)?.content?.trim() ?? "";
}

export function isVisible(el: Element): boolean {
  const h = el as HTMLElement;
  if (h.hidden) return false;
  const s = h.ownerDocument.defaultView?.getComputedStyle(h);
  return !(s && (s.display === "none" || s.visibility === "hidden"));
}
