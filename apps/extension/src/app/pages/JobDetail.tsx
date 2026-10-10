import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { canonicalSkill, APPLICATION_CHECKLIST, type Job } from "@careerpilot/shared";
import { Badge, Banner, Button, Card, CardHeader, ConfirmDialog, Field, Input, Overlay, PageHeader, Select, SkeletonRows, Textarea, useToast } from "../../ui/kit";
import { errMsg, fmtDate, useLive } from "../../ui/hooks";
import { analysesRepo, applicationsRepo, jobsRepo, kv, resumesRepo } from "../../storage/db";
import { analyze, createApplication, findDuplicateApplication, resolveProfile, saveJob, setApplicationStatus, updateJob } from "../../services/workflow";
import { aiStatus, callAi, describeAiError } from "../../services/aiClient";
import { AnalysisView } from "../components/AnalysisView";
import { STATUS_LABEL, STATUS_TONE } from "../lib";

const csv = (s: string) => [...new Set(s.split(",").map((x) => canonicalSkill(x)).filter(Boolean))];

export function JobDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [resumeId, setResumeId] = useState<string>("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmSubmitted, setConfirmSubmitted] = useState(false);
  const [ai, setAi] = useState<{ explanation: string; suggestions: string[] } | null>(null);
  const [aiErr, setAiErr] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [dupWarn, setDupWarn] = useState<string | null>(null);

  const { data, loading, reload } = useLive(async () => {
    const [job, resumes, apps, jobs] = await Promise.all([jobsRepo.get(id), resumesRepo.list(), applicationsRepo.list(), jobsRepo.list()]);
    const rid = resumeId || resumes.find((r) => r.isDefault)?.id || resumes[0]?.id;
    const analysis = job && rid ? (await analysesRepo.forJob(job.id)).find((a) => a.resumeId === rid) : undefined;
    const app = apps.find((a) => a.jobId === id) ?? (job ? findDuplicateApplication(job, apps, jobs) : undefined);
    const checklist = (await kv.get<boolean[]>(`checklist:${app?.id}`)) ?? [];
    return { job, resumes, analysis, app, rid, checklist };
  }, [id, resumeId]);

  // Analyse automatically if this job has no analysis yet for the selected resume.
  useEffect(() => {
    if (data?.job && data.rid && !data.analysis && !busy) { setBusy(true); analyze(data.job.id, data.rid).then(() => reload()).catch((e) => toast.push({ tone: "bad", text: errMsg(e) })).finally(() => setBusy(false)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.job?.id, data?.rid, data?.analysis]);

  if (loading || !data) return <SkeletonRows />;
  const { job, resumes, analysis, app, rid, checklist } = data;
  if (!job) return <Banner tone="bad" title="Job not found" action={<Button size="sm" onClick={() => nav("/jobs")}>Back to jobs</Button>}>It may have been deleted.</Banner>;
  if (!resumes.length) return <Banner tone="warn" title="Upload a resume first" action={<Button size="sm" variant="primary" onClick={() => nav("/resumes")}>Upload</Button>}>Scores compare the job against your resume.</Banner>;

  const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.push({ tone: "good", text: ok }); await reload(); } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); } };

  const saveToTracker = () => run(async () => {
    const r = await saveJob(job);
    const res = await createApplication(r.job, { analysis });
    if (res.existing) setDupWarn(`You already track "${res.application.title}" at ${res.application.company} (${STATUS_LABEL[res.application.status]}). No duplicate was created.`);
    else toast.push({ tone: "good", text: "Saved and added to your tracker." });
  });

  const askAi = async () => {
    if (!analysis) return;
    setAiBusy(true); setAiErr(null);
    try {
      const st = await aiStatus();
      if (!st.configured) { setAiErr(st.reason!); return; }
      const profile = await resolveProfile(resumes.find((r) => r.id === rid));
      setAi(await callAi("analyzeJob", { profile, job, analysis }));
    } catch (e) { setAiErr(describeAiError(e)); } finally { setAiBusy(false); }
  };

  const toggleCheck = async (i: number) => {
    if (!app) return;
    const next = APPLICATION_CHECKLIST.map((_, k) => (k === i ? !checklist[k] : !!checklist[k]));
    await kv.set(`checklist:${app.id}`, next);
  };

  return (
    <div>
      <PageHeader
        title={job.title || "Untitled role"}
        subtitle={<>{job.company || "Unknown company"}{job.location ? ` · ${job.location}` : ""} · <Badge>{job.provider}</Badge> {job.workMode !== "unknown" && <Badge tone="accent">{job.workMode}</Badge>} {job.salaryRange && <Badge tone="good">{job.salaryRange}</Badge>}</>}
        actions={<>
          <Select aria-label="Resume used" className="!w-48" value={rid} onChange={(e) => setResumeId(e.target.value)}>{resumes.map((r) => <option key={r.id} value={r.id}>{r.title}{r.isDefault ? " (default)" : ""}</option>)}</Select>
          <Button onClick={() => setEditing(true)}>Edit details</Button>
          {job.originalUrl && <a className="inline-flex items-center rounded-lg border border-line px-3.5 py-2 text-sm hover:bg-surface-2" href={job.originalUrl} target="_blank" rel="noopener noreferrer">Open original ↗</a>}
        </>} />

      {dupWarn && <div className="mb-4"><Banner tone="warn" title="Duplicate application">{dupWarn}</Banner></div>}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => nav(`/jobs/${job.id}/documents`)}>Tailor resume</Button>
        <Button onClick={() => nav(`/jobs/${job.id}/documents?tab=cover`)}>Generate cover letter</Button>
        <Button onClick={saveToTracker} disabled={!!app && !!job.savedAt}>{app ? "In tracker" : "Save job"}</Button>
        <Button variant="ghost" loading={busy} onClick={() => run(() => analyze(job.id, rid, { force: true }), "Re-analysed.")}>Re-analyze</Button>
        {app && <Badge tone={STATUS_TONE[app.status]}>{STATUS_LABEL[app.status]}</Badge>}
        <span className="text-xs text-muted">Found {fmtDate(job.discoveredAt)} · extraction confidence {Math.round(job.extractionConfidence * 100)}%</span>
      </div>

      {job.extractionNotes.length > 0 && job.extractionConfidence < 0.7 && <div className="mb-5"><Banner tone="info" title="Check the extracted details"><ul className="list-disc pl-4">{job.extractionNotes.map((n, i) => <li key={i}>{n}</li>)}</ul></Banner></div>}

      {!analysis ? <SkeletonRows n={3} /> : (
        <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <div className="min-w-0 space-y-5">
            <AnalysisView analysis={analysis} job={job} />
            <Card>
              <CardHeader title="AI recommendations" subtitle="Optional and qualitative. These never change the score." action={<Button size="sm" loading={aiBusy} onClick={askAi}>{ai ? "Refresh" : "Get AI suggestions"}</Button>} />
              <div className="p-5 text-sm">
                {aiErr && <Banner tone="warn" title="AI unavailable">{aiErr} <Link className="text-primary underline" to="/settings">Settings</Link></Banner>}
                {!ai && !aiErr && <p className="text-muted">Turn on an AI provider in Settings for a written explanation. Everything above already works without it.</p>}
                {ai && <><p>{ai.explanation}</p><ul className="mt-2 list-disc space-y-1 pl-5">{ai.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul><p className="mt-3 text-xs text-muted">AI-generated — verify before relying on it.</p></>}
              </div>
            </Card>
          </div>

          <aside className="space-y-5">
            <Card>
              <CardHeader title="Application checklist" subtitle="Tick these yourself. CareerPilot never submits for you." />
              {!app ? <p className="p-5 text-sm text-muted">Save the job to start an application.</p> : (
                <div className="space-y-2 p-5">
                  {APPLICATION_CHECKLIST.map((c, i) => (
                    <label key={c} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={!!checklist[i]} onChange={() => toggleCheck(i)} />{c}</label>
                  ))}
                  {app.status !== "applied" && !app.appliedAt ? (
                    <div className="pt-2"><Button size="sm" variant="primary" onClick={() => setConfirmSubmitted(true)}>I submitted my application</Button><p className="mt-1.5 text-xs text-muted">Only mark this after you've clicked the site's submit button.</p></div>
                  ) : <p className="pt-2 text-xs text-good">Applied {fmtDate(app.appliedAt)} (confirmed by you).</p>}
                </div>
              )}
            </Card>
            <Card>
              <CardHeader title="What the job asks for" />
              <div className="space-y-3 p-5 text-sm">
                <p><span className="text-muted">Experience:</span> {job.experienceRequirements || "Not stated"}</p>
                <p><span className="text-muted">Employment:</span> {job.employmentType || "Not stated"}</p>
                <div><p className="mb-1 text-muted">Required</p><div className="flex flex-wrap gap-1">{job.requiredSkills.map((s) => <Badge key={s}>{s}</Badge>)}{!job.requiredSkills.length && <span className="text-xs text-muted">None detected</span>}</div></div>
                <div><p className="mb-1 text-muted">Preferred</p><div className="flex flex-wrap gap-1">{job.preferredSkills.map((s) => <Badge key={s} tone="neutral">{s}</Badge>)}{!job.preferredSkills.length && <span className="text-xs text-muted">None detected</span>}</div></div>
              </div>
            </Card>
          </aside>
        </div>
      )}

      <EditJob open={editing} job={job} onClose={() => setEditing(false)} onSave={async (j) => { await updateJob(j); setEditing(false); await analyze(j.id, rid); await reload(); toast.push({ tone: "good", text: "Job updated and re-scored." }); }} />
      <ConfirmDialog open={confirmSubmitted} title="Mark as applied?" confirmLabel="Yes, I submitted it" body="Confirm that you clicked the site's final submit button yourself. CareerPilot only records what you tell it."
        onClose={() => setConfirmSubmitted(false)} onConfirm={() => run(async () => { const a = app ?? (await createApplication((await saveJob(job)).job, { analysis })).application; await setApplicationStatus(a.id, "applied", { userConfirmedSubmitted: true }); }, "Application recorded.")} />
    </div>
  );
}

function EditJob({ open, job, onClose, onSave }: { open: boolean; job: Job; onClose: () => void; onSave: (j: Job) => Promise<void> }) {
  const [f, setF] = useState(job);
  const [req, setReq] = useState(job.requiredSkills.join(", "));
  const [pref, setPref] = useState(job.preferredSkills.join(", "));
  useEffect(() => { setF(job); setReq(job.requiredSkills.join(", ")); setPref(job.preferredSkills.join(", ")); }, [job, open]);
  return (
    <Overlay open={open} onClose={onClose} title="Correct job details" side width="max-w-xl">
      <div className="space-y-4">
        <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label="Company">{(id) => <Input id={id} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />}</Field>
        <Field label="Location">{(id) => <Input id={id} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} />}</Field>
        <Field label="Minimum years of experience">{(id) => <Input id={id} type="number" min={0} value={f.minYears ?? ""} onChange={(e) => setF({ ...f, minYears: e.target.value === "" ? null : Number(e.target.value) })} />}</Field>
        <Field label="Required skills (comma-separated)">{(id) => <Input id={id} value={req} onChange={(e) => setReq(e.target.value)} />}</Field>
        <Field label="Preferred skills (comma-separated)">{(id) => <Input id={id} value={pref} onChange={(e) => setPref(e.target.value)} />}</Field>
        <Field label="Description">{(id) => <Textarea id={id} rows={10} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <div className="flex justify-end"><Button variant="primary" disabled={f.description.trim().length < 20} onClick={() => onSave({ ...f, requiredSkills: csv(req), preferredSkills: csv(pref).filter((s) => !csv(req).includes(s)) })}>Save & re-score</Button></div>
      </div>
    </Overlay>
  );
}
