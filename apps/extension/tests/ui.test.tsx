import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { nowIso, parseResumeText, uid, type Resume } from "@careerpilot/shared";
import { Popup } from "../src/popup/Popup";
import { App } from "../src/app/App";
import { ToastProvider } from "../src/ui/kit";
import { applicationsRepo, documentsRepo, jobsRepo, profileRepo, resumesRepo, settingsRepo } from "../src/storage/db";
import { JD_TEXT, RESUME_TEXT, resetAll } from "./helpers";

const TAB_URL = "https://www.naukri.com/job-listings-mern-developer-123?utm_source=x";

function seedResume(): Resume {
  const parsed = parseResumeText(RESUME_TEXT);
  const r: Resume = { id: uid(), title: "Main resume", description: "", fileName: "r.docx", mimeType: "x", size: 10, extractedText: RESUME_TEXT, parsedProfile: parsed.profile, parsingConfidence: parsed.confidence, parsingFlags: parsed.flags, parsingStatus: "parsed", isDefault: true, createdAt: nowIso(), updatedAt: nowIso() };
  return r;
}
const seed = async () => { const r = seedResume(); await resumesRepo.put(r); await profileRepo.put(r.parsedProfile!); await settingsRepo.update({ onboardingComplete: true }); return r; };

const extractOk = { ok: true, data: { status: "ok", tabUrl: TAB_URL, job: { title: "MERN Stack Developer", company: "LogiCo", location: "Pune", description: JD_TEXT, employmentType: "", salaryRange: "", applicationUrl: "", url: TAB_URL, provider: "naukri", confidence: 0.9, notes: [] } } };

let sendMessage: ReturnType<typeof vi.fn>;
let permissionsRequest: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await resetAll();
  sendMessage = vi.fn(async () => ({ ok: true, data: {} }));
  permissionsRequest = vi.fn(async () => true);
  vi.stubGlobal("chrome", {
    runtime: { id: "ext", sendMessage: (...a: unknown[]) => sendMessage(...a) },
    tabs: { query: vi.fn(async () => [{ id: 5, url: TAB_URL, title: "MERN Stack Developer - LogiCo | Naukri" }]) },
    permissions: { request: (...a: unknown[]) => permissionsRequest(...a) },
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const renderPopup = () => render(<ToastProvider><Popup /></ToastProvider>);
const clickAnalyze = async () => { const b = (await screen.findByRole("button", { name: /Analyze this job/i })) as HTMLButtonElement; await waitFor(() => expect(b.disabled).toBe(false)); fireEvent.click(b); };

describe("popup", () => {
  it("shows a setup message when no resume exists", async () => {
    renderPopup();
    expect(await screen.findByText(/Upload your resume first/i)).toBeTruthy();
  });

  it("detects the page by URL only and does not read it until Analyze is clicked", async () => {
    await seed();
    renderPopup();
    expect(await screen.findByText(/naukri\.com/)).toBeTruthy();
    expect(screen.getByText(/Naukri supported/)).toBeTruthy();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("analyzes the page, shows the score, and saves to the tracker", async () => {
    await seed();
    sendMessage.mockResolvedValueOnce(extractOk);
    renderPopup();
    await clickAnalyze();
    const ring = await screen.findByRole("img", { name: /Match score \d+ out of 100/ });
    expect(ring).toBeTruthy();
    expect(sendMessage).toHaveBeenCalledWith({ type: "page/extract", tabId: 5 });
    expect(screen.getByText(/Not found in resume:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save job" }));
    await screen.findByText(/Saved to your tracker/);
    expect((await applicationsRepo.list())).toHaveLength(1);
    expect((await jobsRepo.list())[0]!.savedAt).toBeTruthy();
    // saving twice does not create a duplicate
    fireEvent.click(screen.getByRole("button", { name: "Save job" }));
    await screen.findByText(/Already in your tracker/);
    expect((await applicationsRepo.list())).toHaveLength(1);
  });

  it("restores the previous analysis when reopened on the same page (storage persists)", async () => {
    await seed();
    sendMessage.mockResolvedValueOnce(extractOk);
    const first = renderPopup();
    await clickAnalyze();
    await screen.findByRole("img", { name: /Match score/ });
    first.unmount();
    sendMessage.mockClear();
    renderPopup();
    await screen.findByRole("img", { name: /Match score/ });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not assume permission: shows Allow button and requests only on click", async () => {
    await seed();
    sendMessage.mockResolvedValueOnce({ ok: true, data: { status: "failed", tabUrl: TAB_URL, needsPermission: true, origin: "https://www.naukri.com/*", message: "No access yet" } }).mockResolvedValueOnce(extractOk);
    renderPopup();
    await clickAnalyze();
    const allow = await screen.findByRole("button", { name: /Allow on this site/i });
    expect(permissionsRequest).not.toHaveBeenCalled();
    fireEvent.click(allow);
    await waitFor(() => expect(permissionsRequest).toHaveBeenCalledWith({ origins: ["https://www.naukri.com/*"] }));
    await screen.findByRole("img", { name: /Match score/ });
  });

  it("explains an unreadable page and offers manual paste", async () => {
    await seed();
    sendMessage.mockResolvedValueOnce({ ok: true, data: { status: "unsupported", tabUrl: TAB_URL, message: "Paste the job description instead." } });
    renderPopup();
    await clickAnalyze();
    await screen.findByText(/Paste the job description instead/);
    fireEvent.click(screen.getByRole("button", { name: /Paste a job description/i }));
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    expect(await screen.findByText(/Paste the full job description/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Job description"), { target: { value: JD_TEXT } });
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "MERN Stack Developer" } });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));
    await screen.findByRole("img", { name: /Match score/ });
  });
});

const renderApp = (route: string) => render(<ToastProvider><MemoryRouter initialEntries={[route]}><App /></MemoryRouter></ToastProvider>);

describe("dashboard end-to-end flow (jsdom)", () => {
  it("redirects first-run users to onboarding", async () => {
    renderApp("/");
    expect(await screen.findByText(/Your personal job-search copilot/)).toBeTruthy();
  });

  it("paste job → analyze → breakdown → save → tailor → tracker", async () => {
    await seed();
    renderApp("/jobs?add=1");
    const dlg = await screen.findByRole("dialog", { name: "Add a job" });
    fireEvent.change(within(dlg).getByLabelText("Job title"), { target: { value: "MERN Stack Developer" } });
    fireEvent.change(within(dlg).getByLabelText("Company"), { target: { value: "LogiCo" } });
    fireEvent.change(within(dlg).getByLabelText("Job description"), { target: { value: JD_TEXT } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Analyze job" }));

    // analysis page with transparent breakdown
    expect(await screen.findByText("Score breakdown", {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText("Required skills coverage")).toBeTruthy();
    expect(screen.getAllByText(/Not found in your resume/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/not an ATS score/i).length).toBeGreaterThan(0);

    // save to tracker
    fireEvent.click(screen.getByRole("button", { name: "Save job" }));
    await waitFor(async () => expect(await applicationsRepo.list()).toHaveLength(1));

    // tailored resume
    fireEvent.click(screen.getByRole("button", { name: "Tailor resume" }));
    fireEvent.click(await screen.findByRole("button", { name: "Generate tailored version" }));
    await screen.findByText(/Version 1 created|Changed|Unchanged/, {}, { timeout: 8000 });
    await waitFor(async () => expect((await documentsRepo.list()).length).toBe(1));
    const stored = (await documentsRepo.list())[0]!;
    expect(stored.content).not.toMatch(/Kubernetes/);
    expect((await applicationsRepo.list())[0]!.tailoredDocumentId).toBe(stored.id);
  });

  it("shows the application in the tracker and requires confirmation before 'applied'", async () => {
    await seed();
    const job = (await import("../src/services/workflow")).jobFromInput({ title: "React Dev", company: "Acme", description: JD_TEXT });
    const { saveJob, createApplication } = await import("../src/services/workflow");
    await createApplication((await saveJob(job)).job, {});
    renderApp("/tracker");
    expect(await screen.findByText("React Dev")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Move React Dev to"), { target: { value: "applied" } });
    expect(await screen.findByText(/Confirm that you submitted this application yourself/)).toBeTruthy();
    expect((await applicationsRepo.list())[0]!.status).toBe("saved"); // not changed yet
    fireEvent.click(screen.getByRole("button", { name: /Yes, I submitted it/ }));
    await waitFor(async () => expect((await applicationsRepo.list())[0]!.status).toBe("applied"));
  });

  it("shows empty states instead of fake data", async () => {
    await settingsRepo.update({ onboardingComplete: true });
    renderApp("/analytics");
    expect(await screen.findByText("No data yet")).toBeTruthy();
    cleanup();
    renderApp("/tracker");
    expect(await screen.findByText("Nothing tracked yet")).toBeTruthy();
  });
});
