import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { APPLICATION_STATUSES, type Application, type ApplicationStatus } from "@careerpilot/shared";
import { Badge, Banner, Button, Card, ConfirmDialog, EmptyState, Field, Input, Overlay, PageHeader, Select, SkeletonRows, Tabs, Textarea, useToast, cx } from "../../ui/kit";
import { errMsg, fmtDate, useLive } from "../../ui/hooks";
import { applicationsRepo, resumesRepo, settingsRepo } from "../../storage/db";
import { patchApplication, setApplicationStatus } from "../../services/workflow";
import { send, isExtensionContext } from "../../messaging/client";
import { STATUS_LABEL, STATUS_TONE } from "../lib";

type View = "kanban" | "table" | "calendar";
type Kind = "followup" | "interview";

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO → value for <input type="datetime-local"> in local time. */
export const toLocalInput = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (iso: string, d: Date) => ymd(new Date(iso)) === ymd(d);

async function afterSchedule(toast: ReturnType<typeof useToast>) {
  const s = await settingsRepo.get();
  if (isExtensionContext()) await send({ type: "reminders/sync" }).catch(() => undefined);
  toast.push({ tone: "good", text: s.notifications.enabled ? "Scheduled — you'll get a reminder." : "Scheduled. Turn on reminders in Settings to be notified." });
}

export function Tracker() {
  const { data, loading } = useLive(async () => ({ apps: await applicationsRepo.list(), resumes: await resumesRepo.list() }), []);
  const [view, setView] = useState<View>("kanban");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingApplied, setPendingApplied] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState<Application | null>(null);
  const [sched, setSched] = useState<{ appId?: string; kind: Kind; date?: string } | null>(null);
  const toast = useToast();

  const apps = useMemo(() => (data?.apps ?? []).filter((a) => (!status || a.status === status) && (!q.trim() || `${a.title} ${a.company} ${a.notes}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status]);

  const move = async (a: Application, to: ApplicationStatus) => {
    if (a.status === to) return;
    if (to === "applied" && !a.appliedAt) { setPendingApplied(a); return; }
    try {
      await setApplicationStatus(a.id, to);
      if (to === "interview") setSched({ appId: a.id, kind: "interview" }); // ask for the interview date & time
    } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); }
  };

  const remove = async (a: Application) => {
    try {
      await applicationsRepo.remove(a.id);
      if (openId === a.id) setOpenId(null);
      if (isExtensionContext()) await send({ type: "reminders/sync" }).catch(() => undefined);
      toast.push({ tone: "good", text: "Application deleted." });
    } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); }
  };

  if (loading || !data) return <SkeletonRows />;
  const open = data.apps.find((a) => a.id === openId) ?? null;
  const callbacks = { onOpen: setOpenId, onDelete: setDeleting, onSchedule: (a: Application, kind: Kind) => setSched({ appId: a.id, kind }) };

  return (
    <div>
      <PageHeader title="Application tracker" subtitle="Statuses change only when you change them."
        actions={<><Button onClick={() => setSched({ kind: "followup" })} disabled={!data.apps.length}>Schedule</Button><Tabs tabs={[{ id: "kanban", label: "Board" }, { id: "table", label: "Table" }, { id: "calendar", label: "Follow-ups" }]} value={view} onChange={setView} /></>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input aria-label="Search applications" className="!w-64" placeholder="Search title, company, notes" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Filter by status" className="!w-44" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
      </div>

      {data.apps.length === 0 ? <EmptyState icon="🗂️" title="Nothing tracked yet" body="Save a job from its analysis page and it will appear here." />
        : view === "kanban" ? <Board apps={apps} onMove={move} {...callbacks} />
        : view === "table" ? <Table apps={apps} {...callbacks} />
        : <Calendar apps={data.apps} onOpen={setOpenId} onPickDay={(date) => setSched({ kind: "followup", date })} />}

      <Overlay open={!!open} onClose={() => setOpenId(null)} title="Application details" side width="max-w-xl">{open && <Detail app={open} resumeTitle={data.resumes.find((r) => r.id === open.resumeId)?.title} onMove={move} onDelete={setDeleting} />}</Overlay>
      <ScheduleDialog state={sched} apps={data.apps} onClose={() => setSched(null)} onDone={() => afterSchedule(toast)} />
      <ConfirmDialog open={!!pendingApplied} title="Mark as applied?" confirmLabel="Yes, I submitted it" body="Confirm that you submitted this application yourself on the employer's site."
        onClose={() => setPendingApplied(null)} onConfirm={async () => { try { await setApplicationStatus(pendingApplied!.id, "applied", { userConfirmedSubmitted: true }); } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); } }} />
      <ConfirmDialog open={!!deleting} danger title="Delete this application?" confirmLabel="Delete" body={<>“{deleting?.title}” at {deleting?.company} will be removed from the tracker, with its notes and schedule. The saved job and analysis stay in your Jobs list.</>}
        onClose={() => setDeleting(null)} onConfirm={() => remove(deleting!)} />
    </div>
  );
}

type Cb = { onOpen: (id: string) => void; onDelete: (a: Application) => void; onSchedule: (a: Application, k: Kind) => void };

function Board({ apps, onMove, onOpen, onDelete, onSchedule }: { apps: Application[]; onMove: (a: Application, s: ApplicationStatus) => void } & Cb) {
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {APPLICATION_STATUSES.map((s) => {
        const col = apps.filter((a) => a.status === s);
        return (
          <section key={s} aria-label={STATUS_LABEL[s]} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); setOver(null); const a = apps.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (a) onMove(a, s); }}
            className={cx("w-64 shrink-0 rounded-xl border p-2.5", over === s ? "border-primary bg-primary/5" : "border-line bg-surface-2/50")}>
            <h3 className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted">{STATUS_LABEL[s]}<Badge>{col.length}</Badge></h3>
            <ul className="space-y-2">
              {col.map((a) => (
                <li key={a.id}>
                  <div draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", a.id)} className="rounded-lg border border-line bg-surface p-3 shadow-sm">
                    <button className="block w-full text-left" onClick={() => onOpen(a.id)}>
                      <p className="truncate text-sm font-medium">{a.title}</p><p className="truncate text-xs text-muted">{a.company}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{a.matchScoreAtSave !== null && <Badge tone="info">{a.matchScoreAtSave}</Badge>}{a.interviewAt && <Badge tone="accent">🎤 {fmtDateTime(a.interviewAt)}</Badge>}{a.followUpAt && <Badge tone="warn">↻ {fmtDateTime(a.followUpAt)}</Badge>}</div>
                    </button>
                    <select aria-label={`Move ${a.title} to`} className="mt-2 w-full rounded border border-line bg-surface px-1.5 py-1 text-xs" value={a.status} onChange={(e) => onMove(a, e.target.value as ApplicationStatus)}>{APPLICATION_STATUSES.map((x) => <option key={x} value={x}>{STATUS_LABEL[x]}</option>)}</select>
                    <div className="mt-2 flex gap-1.5">
                      <Button size="sm" onClick={() => onSchedule(a, a.status === "interview" ? "interview" : "followup")} aria-label={`Schedule for ${a.title}`}>Schedule</Button>
                      <Button size="sm" variant="danger" onClick={() => onDelete(a)} aria-label={`Delete ${a.title}`}>Delete</Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Table({ apps, onOpen, onDelete, onSchedule }: { apps: Application[] } & Cb) {
  if (!apps.length) return <EmptyState title="No applications match" />;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-muted">{["Role", "Company", "Status", "Match", "Applied", "Follow-up", "Interview", ""].map((h, i) => <th key={i} scope="col" className="px-4 py-2.5 font-medium">{h || <span className="sr-only">Actions</span>}</th>)}</tr></thead>
        <tbody>{apps.map((a) => (
          <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface-2">
            <td className="px-4 py-2.5"><button className="font-medium text-primary hover:underline" onClick={() => onOpen(a.id)}>{a.title}</button></td>
            <td className="px-4 py-2.5">{a.company}</td><td className="px-4 py-2.5"><Badge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Badge></td>
            <td className="px-4 py-2.5">{a.matchScoreAtSave ?? "—"}</td><td className="px-4 py-2.5">{fmtDate(a.appliedAt)}</td><td className="px-4 py-2.5">{fmtDateTime(a.followUpAt)}</td><td className="px-4 py-2.5">{fmtDateTime(a.interviewAt)}</td>
            <td className="whitespace-nowrap px-4 py-2.5 text-right"><Button size="sm" onClick={() => onSchedule(a, "followup")}>Schedule</Button> <Button size="sm" variant="danger" aria-label={`Delete ${a.title}`} onClick={() => onDelete(a)}>Delete</Button></td>
          </tr>))}</tbody>
      </table>
    </Card>
  );
}

interface Ev { app: Application; kind: Kind; at: string }
const eventsOf = (apps: Application[]): Ev[] => apps.flatMap((a) => {
  if (["rejected", "withdrawn"].includes(a.status)) return [];
  return [...(a.followUpAt ? [{ app: a, kind: "followup" as const, at: a.followUpAt }] : []), ...(a.interviewAt ? [{ app: a, kind: "interview" as const, at: a.interviewAt }] : [])];
});

function Calendar({ apps, onOpen, onPickDay }: { apps: Application[]; onOpen: (id: string) => void; onPickDay: (date: string) => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const events = useMemo(() => eventsOf(apps), [apps]);
  const days = useMemo(() => {
    const start = (month.getDay() + 6) % 7; const n = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(start).fill(null), ...Array.from({ length: n }, (_, i) => i + 1)] as Array<number | null>;
  }, [month]);
  const today = ymd(new Date());
  const upcoming = events.filter((e) => new Date(e.at).getTime() >= Date.now() - 3600_000).sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between"><Button size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">←</Button><h3 className="font-semibold">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3><Button size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">→</Button></div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">{days.map((d, i) => {
          if (!d) return <div key={i} />;
          const date = new Date(month.getFullYear(), month.getMonth(), d);
          const evs = events.filter((e) => sameDay(e.at, date));
          return (
            <div key={i} className={cx("group relative min-h-20 rounded-lg border p-1 text-xs", ymd(date) === today ? "border-primary bg-primary/5" : "border-line")}>
              <button className="flex w-full items-center justify-between text-muted hover:text-primary" aria-label={`Add event on ${ymd(date)}`} onClick={() => onPickDay(ymd(date))}><span>{d}</span><span className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">＋</span></button>
              {evs.map((e) => <button key={e.app.id + e.kind} onClick={() => onOpen(e.app.id)} title={`${e.kind === "interview" ? "Interview" : "Follow-up"} · ${e.app.title} · ${fmtDateTime(e.at)}`} className={cx("mt-0.5 block w-full truncate rounded px-1 text-left text-[11px]", e.kind === "interview" ? "bg-accent/20" : "bg-warn/15")}>{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {e.app.company}</button>)}
            </div>
          );
        })}</div>
        <p className="mt-3 flex gap-3 text-xs text-muted"><span><span className="mr-1 inline-block h-2 w-2 rounded bg-warn/60" />Follow-up</span><span><span className="mr-1 inline-block h-2 w-2 rounded bg-accent/60" />Interview</span><span>Click a day to schedule.</span></p>
      </Card>
      <Card className="p-4"><h3 className="mb-2 text-sm font-semibold">Upcoming</h3>
        {upcoming.length === 0 ? <p className="text-sm text-muted">Nothing scheduled. Click a day in the calendar to add a follow-up or interview.</p> : <ul className="space-y-2">{upcoming.map((e) => <li key={e.app.id + e.kind}><button onClick={() => onOpen(e.app.id)} className="w-full rounded-lg border border-line p-2 text-left text-sm hover:bg-surface-2"><p className="flex items-center gap-2 font-medium">{e.app.title}<Badge tone={e.kind === "interview" ? "accent" : "warn"}>{e.kind === "interview" ? "Interview" : "Follow-up"}</Badge></p><p className="text-xs text-muted">{e.app.company} · {fmtDateTime(e.at)}</p></button></li>)}</ul>}
      </Card>
    </div>
  );
}

/** Schedule a follow-up or an interview (date + time). Saved items feed the reminders. */
function ScheduleDialog({ state, apps, onClose, onDone }: { state: { appId?: string; kind: Kind; date?: string } | null; apps: Application[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [appId, setAppId] = useState("");
  const [kind, setKind] = useState<Kind>("followup");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [moveStatus, setMoveStatus] = useState(true);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!state) return;
    const a = apps.find((x) => x.id === state.appId);
    setAppId(state.appId ?? apps[0]?.id ?? ""); setKind(state.kind); setNote("");
    const existing = a ? (state.kind === "interview" ? a.interviewAt : a.followUpAt) : null;
    setDate(existing ? toLocalInput(existing).slice(0, 10) : state.date ?? ymd(new Date(Date.now() + 86400000)));
    setTime(existing ? toLocalInput(existing).slice(11) : "10:00");
    setErr(""); setMoveStatus(true);
  }, [state?.appId, state?.kind, state?.date, !!state]); // eslint-disable-line react-hooks/exhaustive-deps
  const app = apps.find((a) => a.id === appId);

  const save = async () => {
    if (!app) { setErr("Choose an application."); return; }
    if (!date || !time) { setErr("Pick a date and a time."); return; }
    const iso = new Date(`${date}T${time}`).toISOString();
    if (new Date(iso).getTime() < Date.now() - 60_000) { setErr("That time is in the past."); return; }
    try {
      if (kind === "interview") {
        await patchApplication(app.id, { interviewAt: iso, interviewNote: note });
        if (moveStatus && !["interview", "offer"].includes(app.status)) await setApplicationStatus(app.id, "interview");
      } else await patchApplication(app.id, { followUpAt: iso, followUpNote: note });
      onClose(); onDone();
    } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); }
  };

  return (
    <Overlay open={!!state} onClose={onClose} title={kind === "interview" ? "Schedule interview" : "Schedule follow-up"} width="max-w-md">
      <div className="space-y-4">
        {err && <Banner tone="bad">{err}</Banner>}
        <Field label="Application">{(id) => <Select id={id} value={appId} onChange={(e) => setAppId(e.target.value)}>{apps.map((a) => <option key={a.id} value={a.id}>{a.title} — {a.company}</option>)}</Select>}</Field>
        <Field label="Type">{(id) => <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as Kind)}><option value="followup">Follow-up</option><option value="interview">Interview</option></Select>}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Time">{(id) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
        </div>
        <Field label="Note (optional)" hint={kind === "interview" ? "Round, interviewer, link…" : "What to follow up on"}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        {kind === "interview" && app && !["interview", "offer"].includes(app.status) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={moveStatus} onChange={(e) => setMoveStatus(e.target.checked)} />Also move this application to “Interview”</label>}
        <div className="flex justify-end gap-2"><Button onClick={onClose}>Skip</Button><Button variant="primary" onClick={save}>Save</Button></div>
      </div>
    </Overlay>
  );
}

function Detail({ app, resumeTitle, onMove, onDelete }: { app: Application; resumeTitle?: string; onMove: (a: Application, s: ApplicationStatus) => void; onDelete: (a: Application) => void }) {
  const toast = useToast();
  const [notes, setNotes] = useState(app.notes);
  const [iv, setIv] = useState(app.interviewNotes);
  const [rec, setRec] = useState(app.recruiter);
  const [follow, setFollow] = useState(toLocalInput(app.followUpAt));
  const [followNote, setFollowNote] = useState(app.followUpNote);
  const [interview, setInterview] = useState(toLocalInput(app.interviewAt));
  const [interviewNote, setInterviewNote] = useState(app.interviewNote);
  useEffect(() => { setNotes(app.notes); setIv(app.interviewNotes); setRec(app.recruiter); setFollow(toLocalInput(app.followUpAt)); setFollowNote(app.followUpNote); setInterview(toLocalInput(app.interviewAt)); setInterviewNote(app.interviewNote); }, [app.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    try {
      await patchApplication(app.id, { notes, interviewNotes: iv, recruiter: rec, followUpAt: fromLocalInput(follow), followUpNote: followNote, interviewAt: fromLocalInput(interview), interviewNote });
      await afterSchedule(toast);
    } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); }
  };
  return (
    <div className="space-y-5">
      <div><h3 className="text-lg font-semibold">{app.title}</h3><p className="text-sm text-muted">{app.company}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Badge>{app.matchScoreAtSave !== null && <Badge tone="info">Match at save: {app.matchScoreAtSave}</Badge>}{resumeTitle && <Badge>Resume: {resumeTitle}</Badge>}</div>
        <div className="mt-2 flex gap-3 text-sm"><Link className="text-primary hover:underline" to={`/jobs/${app.jobId}`}>View analysis</Link>{app.jobUrl && <a className="text-primary hover:underline" href={app.jobUrl} target="_blank" rel="noopener noreferrer">Open job ↗</a>}</div>
      </div>
      <Field label="Status">{(id) => <Select id={id} value={app.status} onChange={(e) => onMove(app, e.target.value as ApplicationStatus)}>{APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>}</Field>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Saved">{(id) => <Input id={id} readOnly value={fmtDate(app.savedAt)} />}</Field><Field label="Applied (you confirmed)">{(id) => <Input id={id} readOnly value={fmtDate(app.appliedAt)} />}</Field></div>
      <fieldset className="space-y-3 rounded-lg border border-line p-3"><legend className="px-1 text-xs font-medium text-muted">Schedule</legend>
        <Field label="Next follow-up (date & time)">{(id) => <Input id={id} type="datetime-local" value={follow} onChange={(e) => setFollow(e.target.value)} />}</Field>
        <Field label="Follow-up note">{(id) => <Input id={id} value={followNote} onChange={(e) => setFollowNote(e.target.value)} />}</Field>
        <Field label="Interview (date & time)">{(id) => <Input id={id} type="datetime-local" value={interview} onChange={(e) => setInterview(e.target.value)} />}</Field>
        <Field label="Interview note">{(id) => <Input id={id} value={interviewNote} onChange={(e) => setInterviewNote(e.target.value)} placeholder="Round, interviewer, link…" />}</Field>
        <p className="text-xs text-muted">Reminders fire at the follow-up time, and before the interview (lead time set in Settings).</p>
      </fieldset>
      <fieldset className="space-y-3"><legend className="text-xs font-medium text-muted">Recruiter (optional)</legend>
        <div className="grid gap-3 sm:grid-cols-3"><Input aria-label="Recruiter name" placeholder="Name" value={rec.name} onChange={(e) => setRec({ ...rec, name: e.target.value })} /><Input aria-label="Recruiter email" placeholder="Email" value={rec.email} onChange={(e) => setRec({ ...rec, email: e.target.value })} /><Input aria-label="Recruiter phone" placeholder="Phone" value={rec.phone} onChange={(e) => setRec({ ...rec, phone: e.target.value })} /></div></fieldset>
      <Field label="Notes">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
      <Field label="Interview prep notes">{(id) => <Textarea id={id} value={iv} onChange={(e) => setIv(e.target.value)} />}</Field>
      <div className="flex justify-between"><Button variant="danger" onClick={() => onDelete(app)}>Delete application</Button><Button variant="primary" onClick={save}>Save changes</Button></div>
      <div><h4 className="mb-2 text-sm font-semibold">History</h4><ol className="space-y-1.5 border-l border-line pl-4 text-sm">{[...app.history].reverse().map((h, i) => <li key={i}><span className="text-muted">{fmtDate(h.at)}</span> — {h.detail}</li>)}</ol></div>
      {app.status === "applied" && <Banner tone="good">Marked as applied on {fmtDate(app.appliedAt)} because you confirmed it.</Banner>}
    </div>
  );
}
