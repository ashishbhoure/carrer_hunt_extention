import type { FormFieldDescriptor } from "@careerpilot/shared";
import { isVisible, text } from "../adapters/dom";

const esc = (s: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));

function labelFor(el: HTMLElement, doc: Document): string {
  const id = el.getAttribute("id");
  const parts: string[] = [];
  if (id) parts.push(text(doc.querySelector(`label[for="${esc(id)}"]`)));
  const wrap = el.closest("label");
  if (wrap) parts.push(text(wrap));
  parts.push(el.getAttribute("aria-label") ?? "");
  const lb = el.getAttribute("aria-labelledby");
  if (lb) parts.push(lb.split(/\s+/).map((i) => text(doc.getElementById(i))).join(" "));
  if (!parts.some(Boolean)) {
    const prev = el.parentElement?.querySelector("label, legend, span, div");
    if (prev && prev !== el) parts.push(text(prev).slice(0, 80));
  }
  return parts.filter(Boolean)[0]?.slice(0, 120) ?? "";
}

function selectorFor(el: HTMLElement, doc: Document): string {
  const id = el.getAttribute("id");
  if (id && doc.querySelectorAll(`#${esc(id)}`).length === 1) return `#${esc(id)}`;
  const name = el.getAttribute("name");
  const tag = el.tagName.toLowerCase();
  if (name) {
    const sel = `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
    if (doc.querySelectorAll(sel).length === 1) return sel;
  }
  const path: string[] = [];
  let n: HTMLElement | null = el;
  while (n && n !== doc.body) {
    const p: HTMLElement | null = n.parentElement;
    if (!p) break;
    path.unshift(`${n.tagName.toLowerCase()}:nth-child(${Array.from(p.children).indexOf(n) + 1})`);
    n = p;
  }
  return `body > ${path.join(" > ")}`;
}

/** Collect visible, fillable fields. Passwords/hidden/submit controls are excluded entirely. */
export function scanForm(doc: Document): FormFieldDescriptor[] {
  const els = Array.from(doc.querySelectorAll<HTMLElement>("input, textarea, select"));
  const out: FormFieldDescriptor[] = [];
  for (const el of els) {
    const input = el as HTMLInputElement;
    const type = el.tagName.toLowerCase() === "input" ? (input.type || "text").toLowerCase() : el.tagName.toLowerCase();
    if (["hidden", "password", "submit", "button", "reset", "image"].includes(type)) continue;
    if (!isVisible(el) || (input as HTMLInputElement).disabled || (input as HTMLInputElement).readOnly) continue;
    out.push({
      selector: selectorFor(el, doc), tag: el.tagName.toLowerCase(), type,
      name: el.getAttribute("name") ?? "", id: el.getAttribute("id") ?? "", label: labelFor(el, doc),
      placeholder: el.getAttribute("placeholder") ?? "", autocomplete: el.getAttribute("autocomplete") ?? "",
      required: input.required || el.getAttribute("aria-required") === "true",
      options: el.tagName === "SELECT" ? Array.from((el as HTMLSelectElement).options).map((o) => o.text) : undefined,
    });
  }
  return out;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export interface FillOutcome { selector: string; filled: boolean; reason?: string }

/**
 * Fill only the user-approved values. Never overwrites a non-empty field, never touches
 * password/file/submit controls, and never submits or clicks anything.
 */
export function fillFields(doc: Document, fills: Array<{ selector: string; value: string }>): FillOutcome[] {
  return fills.map(({ selector, value }) => {
    let el: HTMLElement | null = null;
    try { el = doc.querySelector<HTMLElement>(selector); } catch { /* invalid */ }
    if (!el) return { selector, filled: false, reason: "Field not found" };
    const tag = el.tagName.toLowerCase();
    const type = ((el as HTMLInputElement).type ?? "").toLowerCase();
    if (!["input", "textarea", "select"].includes(tag) || ["password", "file", "hidden", "submit", "button", "checkbox", "radio"].includes(type)) return { selector, filled: false, reason: "Field type not supported" };
    if (tag === "select") {
      const sel = el as HTMLSelectElement;
      const opt = Array.from(sel.options).find((o) => o.text.trim().toLowerCase() === value.trim().toLowerCase());
      if (!opt) return { selector, filled: false, reason: "No matching option" };
      sel.value = opt.value; sel.dispatchEvent(new Event("change", { bubbles: true }));
      return { selector, filled: true };
    }
    const inp = el as HTMLInputElement | HTMLTextAreaElement;
    if (inp.value.trim()) return { selector, filled: false, reason: "Already has a value" };
    setNativeValue(inp, value);
    inp.style.outline = "2px solid #6d5dfc";
    return { selector, filled: true };
  });
}
