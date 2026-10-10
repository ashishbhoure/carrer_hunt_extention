import { fail, ok, requestSchema, type ExtractListResult, type ExtractResult, type Request, type Response } from "@careerpilot/shared";
import { AiError } from "@careerpilot/shared";
import { applicationsRepo, jobsRepo, settingsRepo } from "../storage/db";
import { callAi } from "../services/aiClient";

/* ---------- helpers ---------- */
const isWebUrl = (u?: string) => !!u && /^https?:\/\//i.test(u);
const originPattern = (u: string) => `${new URL(u).origin}/*`;

async function activeTab(tabId?: number): Promise<chrome.tabs.Tab | undefined> {
  if (tabId !== undefined) return chrome.tabs.get(tabId);
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function ensureContentScript(tab: chrome.tabs.Tab): Promise<"ok" | "denied"> {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ["content.js"] });
    return "ok";
  } catch {
    return "denied"; // no activeTab grant / restricted page / host permission missing
  }
}

async function toTab<T>(tabId: number, message: unknown): Promise<T> {
  const res = (await chrome.tabs.sendMessage(tabId, message)) as Response<T> | undefined;
  if (!res || !res.ok) throw new Error(res && !res.ok ? res.error.message : "No response from the page.");
  return res.data;
}

/* ---------- request handlers ---------- */
async function handle(req: Request): Promise<Response> {
  switch (req.type) {
    case "page/extract": {
      const tab = await activeTab(req.tabId);
      // The URL is hidden until Chrome has granted access (activeTab or a host permission).
      if (!tab?.id || (tab.url && !isWebUrl(tab.url))) {
        return ok<ExtractResult>({ status: "unsupported", tabUrl: tab?.url ?? "", message: "This page can't be analysed (browser or extension pages are off-limits). Paste the job description instead." });
      }
      if ((await ensureContentScript(tab)) === "denied") {
        return ok<ExtractResult>({ status: "failed", tabUrl: tab.url ?? "", needsPermission: true, origin: tab.url ? originPattern(tab.url) : undefined, message: "CareerPilot doesn't have access to this page yet. Click \"Allow on this site\" or paste the description." });
      }
      try {
        return ok(await toTab<ExtractResult>(tab.id, { type: "content/extract" }));
      } catch {
        return ok<ExtractResult>({ status: "failed", tabUrl: tab.url ?? "", message: "The page could not be read. Paste the job description instead." });
      }
    }
    case "page/extractList": {
      const tab = await activeTab(req.tabId);
      const empty = { cards: [] as ExtractListResult["cards"], provider: "generic" };
      if (!tab?.id || (tab.url && !isWebUrl(tab.url))) return ok<ExtractListResult>({ ...empty, status: "unsupported", tabUrl: tab?.url ?? "", message: "This page can't be scanned." });
      if ((await ensureContentScript(tab)) === "denied") return ok<ExtractListResult>({ ...empty, status: "failed", tabUrl: tab.url ?? "", needsPermission: true, origin: tab.url ? originPattern(tab.url) : undefined, message: "CareerPilot doesn't have access to this page yet." });
      try { return ok(await toTab<ExtractListResult>(tab.id, { type: "content/extractList" })); }
      catch { return ok<ExtractListResult>({ ...empty, status: "failed", tabUrl: tab.url ?? "", message: "The page could not be read." }); }
    }
    case "permissions/ensureOrigin":
      return ok({ granted: await chrome.permissions.contains({ origins: [req.origin] }) });
    case "dashboard/open": {
      const base = chrome.runtime.getURL("app.html");
      const existing = (await chrome.tabs.query({ url: `${base}*` }))[0];
      const url = `${base}#${req.route}`;
      if (existing?.id) { await chrome.tabs.update(existing.id, { url, active: true }); if (existing.windowId) await chrome.windows.update(existing.windowId, { focused: true }); }
      else await chrome.tabs.create({ url });
      return ok({});
    }
    case "reminders/sync":
      return ok(await syncReminders());
    case "ai/call": {
      try { return ok(await callAi(req.operation, req.payload as never)); }
      catch (e) { return e instanceof AiError ? fail(e.code, e.message) : fail("ai_failed", "The AI request failed."); }
    }
    case "autofill/scan": {
      const tab = await activeTab(req.tabId);
      if (!tab?.id || !isWebUrl(tab.url)) return fail("unsupported", "This page can't be scanned.");
      if ((await ensureContentScript(tab)) === "denied") return fail("permission", "No access to this page. Open the extension on the application page and try again.");
      try { return ok(await toTab(tab.id, { type: "content/scanForm" })); } catch { return fail("scan_failed", "Could not read the form."); }
    }
    case "autofill/apply": {
      const tab = await activeTab(req.tabId);
      if (!tab?.id) return fail("no_tab", "No active tab.");
      try { return ok(await toTab(tab.id, { type: "content/fillForm", fills: req.fills })); } catch { return fail("fill_failed", "Could not fill the form."); }
    }
  }
}

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  // Only accept messages from this extension's own pages (never web pages).
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(""))) return false;
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) { sendResponse(fail("bad_request", "Invalid request.")); return false; }
  handle(parsed.data).then(sendResponse).catch(() => sendResponse(fail("internal", "Something went wrong.")));
  return true; // async response
});

/* ---------- reminders (opt-in; alarms/notifications are optional permissions) ---------- */
const TERMINAL = new Set(["rejected", "withdrawn", "offer"]);
void syncReminders().catch(() => undefined); // re-arm alarms whenever the worker starts

async function syncReminders(): Promise<{ scheduled: number; reason?: string }> {
  if (!chrome.alarms) return { scheduled: 0, reason: "Reminder permission not granted." };
  const settings = await settingsRepo.get();
  const existing = await chrome.alarms.getAll();
  await Promise.all(existing.filter((a) => a.name.startsWith("cp:")).map((a) => chrome.alarms.clear(a.name)));
  if (!settings.notifications.enabled) return { scheduled: 0, reason: "Reminders are off." };
  let n = 0;
  const now = Date.now();
  const lead = settings.notifications.leadMinutes * 60_000;
  for (const a of await applicationsRepo.list()) {
    if (TERMINAL.has(a.status) && a.status !== "offer") continue;
    if (a.status === "rejected" || a.status === "withdrawn") continue;
    // Interview: notify `lead` minutes before the scheduled time.
    if (a.interviewAt && settings.notifications.interviews) {
      const when = new Date(a.interviewAt).getTime() - lead;
      if (when > now) { chrome.alarms.create(`cp:interview:${a.id}`, { when }); n++; }
    }
    // Follow-up: notify at the scheduled time.
    if (a.followUpAt && settings.notifications.followUps) {
      const when = new Date(a.followUpAt).getTime();
      if (when > now) { chrome.alarms.create(`cp:followup:${a.id}`, { when }); n++; }
    }
  }
  // Low-frequency digests, only if the user opted in to them.
  if (settings.notifications.savedJobsReview) { chrome.alarms.create("cp:saved-review", { delayInMinutes: 60 * 24 * 3, periodInMinutes: 60 * 24 * 7 }); n++; }
  if (settings.notifications.resumeReview) { chrome.alarms.create("cp:resume-review", { delayInMinutes: 60 * 24 * 14, periodInMinutes: 60 * 24 * 30 }); n++; }
  return { scheduled: n };
}

async function notify(id: string, title: string, message: string) {
  if (!chrome.notifications) return;
  chrome.notifications.create(id, { type: "basic", iconUrl: "icons/icon128.png", title, message });
}

chrome.alarms?.onAlarm.addListener(async (alarm) => {
  const settings = await settingsRepo.get();
  if (!settings.notifications.enabled || !alarm.name.startsWith("cp:")) return;
  const [, kind, id] = alarm.name.split(":");
  if (kind === "followup" || kind === "interview") {
    const a = id ? await applicationsRepo.get(id) : undefined;
    if (!a || TERMINAL.has(a.status)) return;
    const at = kind === "interview" ? a.interviewAt : a.followUpAt;
    const note = kind === "interview" ? a.interviewNote : a.followUpNote;
    await notify(alarm.name, kind === "interview" ? "Interview coming up" : "Time to follow up", `${a.title} · ${a.company}${at ? " · " + new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}${note ? " — " + note : ""}`);
  } else if (kind === "saved-review") {
    const saved = (await jobsRepo.list()).filter((j) => j.savedAt).length;
    if (saved) await notify(alarm.name, "Saved jobs waiting", `You have ${saved} saved job${saved > 1 ? "s" : ""} to review.`);
  } else if (kind === "resume-review") {
    await notify(alarm.name, "Resume review", "Is your master profile still up to date?");
  }
});

chrome.notifications?.onClicked.addListener(async () => { await handle({ type: "dashboard/open", route: "/tracker" }); });

chrome.runtime.onInstalled.addListener((d) => {
  if (d.reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("app.html#/onboarding") });
});
