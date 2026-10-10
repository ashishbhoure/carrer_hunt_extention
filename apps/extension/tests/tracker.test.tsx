import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Tracker, fromLocalInput, toLocalInput } from "../src/app/pages/Tracker";
import { ToastProvider } from "../src/ui/kit";
import { applicationsRepo, settingsRepo } from "../src/storage/db";
import { createApplication, jobFromInput, saveJob } from "../src/services/workflow";
import { JD_TEXT, resetAll } from "./helpers";

let sendMessage: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  await resetAll();
  sendMessage = vi.fn(async () => ({ ok: true, data: { scheduled: 1 } }));
  vi.stubGlobal("chrome", { runtime: { id: "ext", sendMessage: (...a: unknown[]) => sendMessage(...a) } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const addApp = async (title: string, company: string) => (await createApplication((await saveJob(jobFromInput({ title, company, description: JD_TEXT + title }))).job, {})).application;
const renderTracker = () => render(<ToastProvider><MemoryRouter><Tracker /></MemoryRouter></ToastProvider>);
const tomorrow = () => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

describe("tracker: delete", () => {
  it("deletes from the board only after confirmation", async () => {
    await addApp("React Dev", "Acme");
    renderTracker();
    fireEvent.click(await screen.findByRole("button", { name: "Delete React Dev" }));
    expect(await screen.findByText(/Delete this application\?/)).toBeTruthy();
    expect(await applicationsRepo.list()).toHaveLength(1); // not yet
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(async () => expect(await applicationsRepo.list()).toHaveLength(0));
    expect(await screen.findByText("Nothing tracked yet")).toBeTruthy();
  });
  it("can cancel a delete", async () => {
    await addApp("React Dev", "Acme");
    renderTracker();
    fireEvent.click(await screen.findByRole("button", { name: "Delete React Dev" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(await applicationsRepo.list()).toHaveLength(1);
  });
  it("deletes from the table view too", async () => {
    await addApp("Node Dev", "Beta");
    renderTracker();
    fireEvent.click(await screen.findByRole("tab", { name: "Table" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete Node Dev" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(async () => expect(await applicationsRepo.list()).toHaveLength(0));
  });
});

describe("tracker: scheduling", () => {
  it("schedules a follow-up from a calendar day with date and time, and syncs reminders", async () => {
    const app = await addApp("React Dev", "Acme");
    renderTracker();
    fireEvent.click(await screen.findByRole("tab", { name: "Follow-ups" }));
    const date = tomorrow();
    const monthOk = new Date(date).getMonth() === new Date().getMonth();
    if (!monthOk) fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    fireEvent.click(await screen.findByRole("button", { name: `Add event on ${date}` }));
    const dlg = await screen.findByRole("dialog", { name: "Schedule follow-up" });
    expect((within(dlg).getByLabelText("Date") as HTMLInputElement).value).toBe(date);
    fireEvent.change(within(dlg).getByLabelText("Time"), { target: { value: "15:30" } });
    fireEvent.change(within(dlg).getByLabelText("Note (optional)"), { target: { value: "ask about timeline" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await applicationsRepo.get(app.id))!.followUpAt).toBeTruthy());
    const saved = (await applicationsRepo.get(app.id))!;
    expect(toLocalInput(saved.followUpAt)).toBe(`${date}T15:30`);
    expect(saved.followUpNote).toBe("ask about timeline");
    expect(sendMessage).toHaveBeenCalledWith({ type: "reminders/sync" });
    expect(await screen.findByText(/Turn on reminders in Settings|you'll get a reminder/)).toBeTruthy();
    expect((await screen.findAllByText(/(15|03|3):30/)).length).toBeGreaterThan(0);
  });

  it("asks for the interview date & time when a card moves to Interview", async () => {
    const app = await addApp("React Dev", "Acme");
    await settingsRepo.update({ notifications: { enabled: true, followUps: true, interviews: true, savedJobsReview: false, resumeReview: false, leadMinutes: 60 } });
    renderTracker();
    fireEvent.change(await screen.findByLabelText("Move React Dev to"), { target: { value: "interview" } });
    const dlg = await screen.findByRole("dialog", { name: "Schedule interview" });
    fireEvent.change(within(dlg).getByLabelText("Date"), { target: { value: tomorrow() } });
    fireEvent.change(within(dlg).getByLabelText("Time"), { target: { value: "11:00" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await applicationsRepo.get(app.id))!.interviewAt).toBeTruthy());
    const saved = (await applicationsRepo.get(app.id))!;
    expect(saved.status).toBe("interview");
    expect(toLocalInput(saved.interviewAt)).toBe(`${tomorrow()}T11:00`);
    expect(saved.history.map((h) => h.type)).toContain("interview");
    expect(sendMessage).toHaveBeenCalledWith({ type: "reminders/sync" });
    expect(await screen.findByText(/you'll get a reminder/)).toBeTruthy();
  });

  it("the interview prompt can be skipped and rejects past times", async () => {
    const app = await addApp("React Dev", "Acme");
    renderTracker();
    fireEvent.change(await screen.findByLabelText("Move React Dev to"), { target: { value: "interview" } });
    let dlg = await screen.findByRole("dialog", { name: "Schedule interview" });
    fireEvent.change(within(dlg).getByLabelText("Date"), { target: { value: "2020-01-01" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save" }));
    expect(await within(dlg).findByText(/in the past/)).toBeTruthy();
    expect((await applicationsRepo.get(app.id))!.interviewAt).toBeNull();
    fireEvent.click(within(dlg).getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Schedule interview" })).toBeNull());
    expect((await applicationsRepo.get(app.id))!.status).toBe("interview");
    dlg = null as never;
  });

  it("edits follow-up and interview times in the details drawer", async () => {
    const app = await addApp("React Dev", "Acme");
    renderTracker();
    fireEvent.click(await screen.findByText("React Dev"));
    const dlg = await screen.findByRole("dialog", { name: "Application details" });
    fireEvent.change(within(dlg).getByLabelText("Interview (date & time)"), { target: { value: `${tomorrow()}T09:15` } });
    fireEvent.change(within(dlg).getByLabelText("Next follow-up (date & time)"), { target: { value: `${tomorrow()}T17:45` } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Save changes" }));
    await waitFor(async () => expect((await applicationsRepo.get(app.id))!.interviewAt).toBeTruthy());
    const saved = (await applicationsRepo.get(app.id))!;
    expect(toLocalInput(saved.followUpAt)).toBe(`${tomorrow()}T17:45`);
    expect(fromLocalInput("")).toBeNull();
  });
});
