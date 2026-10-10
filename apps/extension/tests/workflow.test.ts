// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importResume, updateResume } from "../src/services/resumes";
import { analyze, createApplication, jobFromInput, patchApplication, recordDiscoveredJob, saveJob, setApplicationStatus, UserFacingError } from "../src/services/workflow";
import { createCoverLetter, createTailoredResume, saveTailoredSections } from "../src/services/documents";
import { analysesRepo, applicationsRepo, deleteAllData, documentsRepo, exportAllData, jobsRepo, resumesRepo, settingsRepo } from "../src/storage/db";
import { computeAnalytics } from "@careerpilot/shared";
import { JD_TEXT, makeDocx, resetAll } from "./helpers";

beforeEach(async () => { await resetAll(); vi.unstubAllGlobals(); });

const setup = async () => { const resume = await importResume(await makeDocx()); const job = await recordDiscoveredJob(jobFromInput({ title: "MERN Stack Developer", company: "LogiCo", location: "Pune", url: "https://jobs.example.com/1?utm_source=x", description: JD_TEXT })); return { resume, job }; };

describe("jobs and analysis", () => {
  it("fails clearly with no resume", async () => {
    const job = await recordDiscoveredJob(jobFromInput({ title: "x", description: JD_TEXT }));
    await expect(analyze(job.id)).rejects.toThrow(/No resume/);
  });
  it("rejects empty descriptions", () => expect(() => jobFromInput({ description: "  " })).toThrow(UserFacingError));
  it("persists an analysis and serves the cached one when nothing changed", async () => {
    const { job } = await setup();
    const a1 = await analyze(job.id);
    const a2 = await analyze(job.id);
    expect(a2.id).toBe(a1.id);
    expect(await analysesRepo.list()).toHaveLength(1);
    const forced = await analyze(job.id, undefined, { force: true });
    expect(forced.id).not.toBe(a1.id);
    expect(forced.totalScore).toBe(a1.totalScore);
  });
  it("re-analyses when the resume changes", async () => {
    const { job, resume } = await setup();
    const a1 = await analyze(job.id);
    await updateResume(resume.id, { parsedProfile: { ...resume.parsedProfile!, skills: [] } });
    // master profile drives scoring; resume text change is what invalidates cache here
    const r = (await resumesRepo.get(resume.id))!;
    await resumesRepo.put({ ...r, extractedText: r.extractedText + "\nKubernetes AWS" });
    const a2 = await analyze(job.id);
    expect(a2.id).not.toBe(a1.id);
  });
  it("de-duplicates saved jobs by canonical URL", async () => {
    const { job } = await setup();
    const first = await saveJob(job);
    const dup = await saveJob(jobFromInput({ title: "Different", description: JD_TEXT, url: "https://www.jobs.example.com/1/" }));
    expect(first.created).toBe(true);
    expect(dup.created).toBe(false);
    expect(dup.duplicateOf?.id).toBe(job.id);
    expect(await jobsRepo.list()).toHaveLength(1);
  });
});

describe("application tracker", () => {
  it("creates, warns on duplicates and keeps history", async () => {
    const { job } = await setup();
    const analysis = await analyze(job.id);
    const saved = (await saveJob(job)).job;
    const first = await createApplication(saved, { analysis });
    expect(first.existing).toBe(false);
    expect(first.application.matchScoreAtSave).toBe(analysis.totalScore);
    const second = await createApplication(saved, { analysis });
    expect(second.existing).toBe(true);
    expect(await applicationsRepo.list()).toHaveLength(1);
    // duplicate detection also works for the same role posted at a different URL
    const clone = jobFromInput({ title: "MERN Stack Developer", company: "LogiCo", location: "Pune", description: JD_TEXT + " (repost)" });
    expect((await createApplication(clone)).existing).toBe(true);
  });
  it("never marks applied without explicit user confirmation", async () => {
    const { job } = await setup();
    const { application } = await createApplication((await saveJob(job)).job);
    await expect(setApplicationStatus(application.id, "applied")).rejects.toThrow(/Confirm/);
    const ok = await setApplicationStatus(application.id, "applied", { userConfirmedSubmitted: true });
    expect(ok.appliedAt).toBeTruthy();
    expect(ok.history.map((h) => h.type)).toContain("user_confirmed_submitted");
    const moved = await setApplicationStatus(application.id, "interview");
    expect(moved.history.at(-1)?.detail).toBe("applied → interview");
  });
  it("updates follow-up, notes and recruiter data", async () => {
    const { job } = await setup();
    const { application } = await createApplication((await saveJob(job)).job);
    const p = await patchApplication(application.id, { followUpAt: "2030-01-01T09:00:00.000Z", notes: "call Priya", recruiter: { name: "Priya", email: "p@x.com", phone: "" } });
    expect(p.followUpAt).toContain("2030");
    expect(p.history.map((h) => h.type)).toEqual(expect.arrayContaining(["followup", "note"]));
    await expect(patchApplication("nope", {})).rejects.toThrow(/not found/);
  });
  it("analytics only count user-confirmed applications", async () => {
    const { job } = await setup();
    const { application } = await createApplication((await saveJob(job)).job);
    let r = computeAnalytics({ jobs: await jobsRepo.list(), analyses: await analysesRepo.list(), applications: await applicationsRepo.list() });
    expect(r.totals.applied).toBe(0);
    await setApplicationStatus(application.id, "applied", { userConfirmedSubmitted: true });
    r = computeAnalytics({ jobs: await jobsRepo.list(), analyses: await analysesRepo.list(), applications: await applicationsRepo.list() });
    expect(r.totals.applied).toBe(1);
    expect(r.interviewConversion.rate).toBeNull();
  });
});

describe("tailoring and cover letters", () => {
  it("creates a tailored resume without unsupported keywords and stores versions per job", async () => {
    const { job } = await setup();
    const r1 = await createTailoredResume(job.id);
    expect(r1.doc.version).toBe(1);
    expect(r1.doc.content).not.toMatch(/Kubernetes/);
    expect(r1.notices.join(" ")).toMatch(/Kubernetes/);
    const r2 = await createTailoredResume(job.id);
    expect(r2.doc.version).toBe(2);
    expect(await documentsRepo.forJob(job.id)).toHaveLength(2);
  });
  it("respects accept / reject decisions when saving", async () => {
    const { job } = await setup();
    const { doc } = await createTailoredResume(job.id);
    const skills = doc.sections.find((s) => s.heading === "Skills")!;
    const rejected = doc.sections.map((s) => (s.id === skills.id ? { ...s, decision: "rejected" as const } : s));
    const saved = await saveTailoredSections(doc, rejected);
    expect(saved.content).toContain(skills.original);
  });
  it("creates an editable cover letter linked to the job", async () => {
    const { job } = await setup();
    const { doc } = await createCoverLetter(job.id, { notes: "I enjoy logistics." });
    expect(doc.documentType).toBe("cover_letter");
    expect(doc.content).toContain("I enjoy logistics.");
    expect(doc.jobId).toBe(job.id);
  });
  it("falls back to deterministic output when AI is unconfigured or fails", async () => {
    const { job } = await setup();
    const off = await createTailoredResume(job.id, { useAi: true });
    expect(off.doc.source).toBe("deterministic");
    expect(off.notices.join(" ")).toMatch(/AI is turned off/);
    await settingsRepo.update({ ai: { enabled: true, provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k", dailyLimit: 5, timeoutMs: 1000 } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    const failed = await createTailoredResume(job.id, { useAi: true });
    expect(failed.doc.source).toBe("deterministic");
    expect(failed.notices.join(" ")).toMatch(/could not reach|returned an error|unavailable/i);
  });
  it("flags AI output that invents skills or numbers", async () => {
    const { job } = await setup();
    await settingsRepo.update({ ai: { enabled: true, provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k", dailyLimit: 5, timeoutMs: 1000 } });
    const reply = JSON.stringify({ sections: [{ heading: "Summary", proposed: "Led Kubernetes migration improving throughput by 87%" }] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 })));
    const { doc } = await createTailoredResume(job.id, { useAi: true });
    expect(doc.source).toBe("ai");
    const summary = doc.sections.find((s) => s.heading === "Summary")!;
    expect(summary.warnings.join(" ")).toMatch(/Kubernetes/);
    expect(summary.warnings.join(" ")).toMatch(/87/);
    expect(summary.decision).toBe("pending");
  });
  it("enforces the daily AI usage limit", async () => {
    const { job } = await setup();
    await settingsRepo.update({ ai: { enabled: true, provider: "openai-compatible", baseUrl: "https://api.example.com/v1", model: "m", apiKey: "k", dailyLimit: 1, timeoutMs: 1000 } });
    const reply = JSON.stringify({ letter: "Dear team, I would like to apply for this role because my background matches." });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const a = await createCoverLetter(job.id, { useAi: true, notes: "one" });
    expect(a.doc.source).toBe("ai");
    const b = await createCoverLetter(job.id, { useAi: true, notes: "two" });
    expect(b.doc.source).toBe("deterministic");
    expect(b.notices.join(" ")).toMatch(/limit/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("privacy controls", () => {
  it("exports without the API key and deletes everything", async () => {
    await setup();
    await settingsRepo.update({ ai: { enabled: true, provider: "openai-compatible", baseUrl: "https://x/v1", model: "m", apiKey: "SECRET-KEY", dailyLimit: 5, timeoutMs: 1000 } });
    const dump = await exportAllData();
    expect(JSON.stringify(dump)).not.toContain("SECRET-KEY");
    expect(dump.resumes.length).toBe(1);
    await deleteAllData();
    expect(await resumesRepo.list()).toHaveLength(0);
    expect(await jobsRepo.list()).toHaveLength(0);
    expect((await settingsRepo.get()).ai.apiKey).toBe("");
  });
});
