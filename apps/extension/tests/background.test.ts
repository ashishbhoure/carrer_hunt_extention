// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applicationSchema } from "@careerpilot/shared";
import { applicationsRepo, settingsRepo } from "../src/storage/db";

type Listener = (msg: unknown, sender: Record<string, unknown>, send: (r: unknown) => void) => boolean | void;
let listener: Listener;
const chromeMock: Record<string, any> = {
  runtime: { id: "ext-id", getURL: (p: string) => `chrome-extension://ext-id/${p}`, onMessage: { addListener: (l: Listener) => { listener = l; } }, onInstalled: { addListener: vi.fn() } },
  tabs: { query: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), sendMessage: vi.fn() },
  windows: { update: vi.fn() },
  scripting: { executeScript: vi.fn() },
  permissions: { contains: vi.fn(async () => false) },
};

beforeAll(async () => {
  vi.stubGlobal("chrome", chromeMock);
  await import("../src/background/index");
});
beforeEach(() => { vi.clearAllMocks(); });

const SELF = { id: "ext-id", url: "chrome-extension://ext-id/popup.html" };
const call = (msg: unknown, sender: Record<string, unknown> = SELF) =>
  new Promise<{ handled: boolean; res?: any }>((resolve) => {
    const handled = listener(msg, sender, (res) => resolve({ handled: true, res }));
    if (!handled) resolve({ handled: false });
  });

describe("service worker message protocol", () => {
  it("registers a listener but does not touch any page at startup", () => {
    expect(listener).toBeTypeOf("function");
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  it("ignores messages from other extensions and from web/content-script origins", async () => {
    expect((await call({ type: "page/extract" }, { id: "evil-ext", url: "chrome-extension://evil-ext/x.html" })).handled).toBe(false);
    expect((await call({ type: "page/extract" }, { id: "ext-id", url: "https://evil.example.com/" })).handled).toBe(false);
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  it("rejects malformed requests", async () => {
    const { res } = await call({ type: "does/not/exist" });
    expect(res).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });
  it("refuses browser-internal pages", async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: 1, url: "chrome://extensions" }]);
    const { res } = await call({ type: "page/extract" });
    expect(res.ok).toBe(true);
    expect(res.data.status).toBe("unsupported");
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
  });
  it("asks for permission instead of assuming it when injection is denied", async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: 2, url: "https://jobs.example.com/a/1" }]);
    chromeMock.scripting.executeScript.mockRejectedValue(new Error("Cannot access contents of the page"));
    const { res } = await call({ type: "page/extract" });
    expect(res.data).toMatchObject({ needsPermission: true, origin: "https://jobs.example.com/*" });
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled();
  });
  it("injects the content script on demand and relays its typed result", async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: 3, url: "https://jobs.example.com/a/1" }]);
    chromeMock.scripting.executeScript.mockResolvedValue([]);
    chromeMock.tabs.sendMessage.mockResolvedValue({ ok: true, data: { status: "ok", tabUrl: "https://jobs.example.com/a/1", job: { title: "Dev" } } });
    const { res } = await call({ type: "page/extract" });
    expect(chromeMock.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 3 }, files: ["content.js"] });
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(3, { type: "content/extract" });
    expect(res).toMatchObject({ ok: true, data: { status: "ok" } });
  });
  it("degrades gracefully when the page does not answer", async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: 4, url: "https://jobs.example.com/a/1" }]);
    chromeMock.scripting.executeScript.mockResolvedValue([]);
    chromeMock.tabs.sendMessage.mockRejectedValue(new Error("no receiver"));
    const { res } = await call({ type: "page/extract" });
    expect(res.data.status).toBe("failed");
  });
  it("opens the dashboard, reusing an existing tab", async () => {
    chromeMock.tabs.query.mockResolvedValue([]);
    await call({ type: "dashboard/open", route: "/tracker" });
    expect(chromeMock.tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://ext-id/app.html#/tracker" });
    chromeMock.tabs.query.mockResolvedValue([{ id: 9, windowId: 1 }]);
    await call({ type: "dashboard/open", route: "/jobs" });
    expect(chromeMock.tabs.update).toHaveBeenCalledWith(9, { url: "chrome-extension://ext-id/app.html#/jobs", active: true });
  });
  it("reports that reminders need the optional permission", async () => {
    const { res } = await call({ type: "reminders/sync" });
    expect(res).toMatchObject({ ok: true, data: { scheduled: 0 } });
    expect(res.data.reason).toMatch(/permission/i);
  });
  it("returns a typed AI error when AI is not configured", async () => {
    const { res } = await call({ type: "ai/call", operation: "tailorResume", payload: { job: { contentHash: "h" }, analysis: { cacheKey: "k" } } });
    expect(res).toMatchObject({ ok: false, error: { code: "not_configured" } });
  });

  it("schedules interview reminders before the time and follow-ups at the time, skipping past and closed applications", async () => {
    const created: Array<{ name: string; when: number }> = [];
    chromeMock.alarms = { getAll: vi.fn(async () => [{ name: "cp:stale" }, { name: "other" }]), clear: vi.fn(), create: vi.fn((name: string, o: { when: number }) => created.push({ name, when: o.when })), onAlarm: { addListener: vi.fn() } };
    await settingsRepo.update({ notifications: { enabled: true, followUps: true, interviews: true, savedJobsReview: false, resumeReview: false, leadMinutes: 60 } });
    const day = 86400000, now = Date.now();
    const mk = (id: string, status: string, o: object) => applicationSchema.parse({ id, jobId: id, title: id, company: "C", status, savedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...o });
    const interviewAt = new Date(now + 2 * day).toISOString(), followUpAt = new Date(now + day).toISOString();
    await applicationsRepo.put(mk("a", "interview", { interviewAt, followUpAt }));
    await applicationsRepo.put(mk("past", "interview", { interviewAt: new Date(now - day).toISOString() }));
    await applicationsRepo.put(mk("rej", "rejected", { followUpAt }));
    const { res } = await call({ type: "reminders/sync" });
    expect(res.data.scheduled).toBe(2);
    expect(chromeMock.alarms.clear).toHaveBeenCalledWith("cp:stale");
    expect(chromeMock.alarms.clear).not.toHaveBeenCalledWith("other");
    expect(created.find((c) => c.name === "cp:interview:a")!.when).toBe(new Date(interviewAt).getTime() - 3600_000);
    expect(created.find((c) => c.name === "cp:followup:a")!.when).toBe(new Date(followUpAt).getTime());
    expect(created.some((c) => c.name.includes("past") || c.name.includes("rej"))).toBe(false);
  });
  it("schedules nothing when reminders are off", async () => {
    await settingsRepo.update({ notifications: { enabled: false, followUps: true, interviews: true, savedJobsReview: false, resumeReview: false, leadMinutes: 60 } });
    const { res } = await call({ type: "reminders/sync" });
    expect(res.data.scheduled).toBe(0);
  });
});
