import { contentRequestSchema, type ExtractResult } from "@careerpilot/shared";
import { extractFromPage } from "../adapters/adapters";
import { extractJobList } from "../adapters/list";
import { fillFields, scanForm } from "./forms";

/**
 * Injected on demand (chrome.scripting.executeScript) after the user clicks the extension.
 * It does nothing until it receives a message from this extension's own service worker.
 */
const FLAG = "__careerpilotInjected";
const w = window as unknown as Record<string, unknown>;

if (!w[FLAG]) {
  w[FLAG] = true;
  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false; // ignore anything not from our extension
    const parsed = contentRequestSchema.safeParse(raw);
    if (!parsed.success) return false;
    try {
      const req = parsed.data;
      if (req.type === "content/extract") {
        const { status, fields } = extractFromPage({ doc: document, url: new URL(location.href) });
        const result: ExtractResult = { status, tabUrl: location.href, job: { ...fields, title: fields.title ?? "", company: fields.company ?? "", location: fields.location ?? "", description: fields.description ?? "", employmentType: fields.employmentType ?? "", salaryRange: fields.salaryRange ?? "", applicationUrl: fields.applicationUrl ?? "", url: location.href, provider: fields.provider ?? "generic", confidence: Math.max(0, Math.min(1, fields.confidence ?? 0)), notes: fields.notes ?? [] } };
        sendResponse({ ok: true, data: result });
      } else if (req.type === "content/extractList") {
        const r = extractJobList({ doc: document, url: new URL(location.href) });
        sendResponse({ ok: true, data: { ...r, tabUrl: location.href } });
      } else if (req.type === "content/scanForm") {
        sendResponse({ ok: true, data: scanForm(document) });
      } else if (req.type === "content/fillForm") {
        sendResponse({ ok: true, data: fillFields(document, req.fills ?? []) });
      }
    } catch (e) {
      sendResponse({ ok: false, error: { code: "content_error", message: "The page could not be read." } });
    }
    return true;
  });
}
