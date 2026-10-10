import { useEffect, useState } from "react";
import { canonicalizeUrl, mapFormFields, APPLICATION_CHECKLIST, type ExtractResult, type FieldMapping, type Job, type JobAnalysis, type FormFieldDescriptor } from "@careerpilot/shared";
import { Badge, Banner, Button, Field, Input, Logo, ScoreRing, Select, Skeleton, Textarea, useToast } from "../ui/kit";
import { applyTheme, errMsg, useLive, useSettings } from "../ui/hooks";
import { analysesRepo, jobsRepo, profileRepo, resumesRepo } from "../storage/db";
import { analyze, createApplication, jobFromInput, recordDiscoveredJob, saveJob, setApplicationStatus } from "../services/workflow";
import { openDashboard, send, MessageError } from "../messaging/client";
import { ScanList } from "./ScanList";

/** Browser tab titles look like "Role | Company | LinkedIn" or "Role - Company". This is tab metadata, not page content. */
export function parseTabTitle(title = ""): { title: string; company: string } {
  const parts = title.split(/\s[|–—-]\s/).map((s) => s.trim()).filter((s) => s && !/^(linkedin|naukri(\.com)?|indeed|hirist)$/i.test(s));
  return { title: parts[0] ?? "", company: parts[1] ?? "" };
}
import { providerFromUrl } from "@careerpilot/shared";

type Tab = { id?: number; url?: string; title?: string };
type View = "main" | "manual" | "autofill" | "scan";

const KNOWN: Record<string, string> = { linkedin: "LinkedIn", naukri: "Naukri", hirist: "Hirist", indeed: "Indeed" };

export function Popup() {
  const toast = useToast();
  const { settings } = useSettings();
  useEffect(() => { applyTheme(settings?.theme); }, [settings?.theme]);
  const [tab, setTab] = useState<Tab>({});
  const [view, setView] = useState<View>("main");
  const [resumeId, setResumeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionOrigin, setPermissionOrigin] = useState<string | null>(null);
  const [fields, setFields] = useState<{ title: string; company: string; location: string; description: string; url: string; confidence: number; notes: string[]; provider: string } | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const { data: resumes, loading } = useLive(() => resumesRepo.list(), []);
  const rid = resumeId || resumes?.find((r) => r.isDefault)?.id || resumes?.[0]?.id || "";

  // Page detection uses only the tab URL; the page content is never read until the user clicks Analyze.
  useEffect(() => {
    chrome.tabs?.query({ active: true, currentWindow: true }).then(async ([t]) => {
      setTab({ id: t?.id, url: t?.url, title: t?.title });
      // Restore a previous analysis for this exact page (persists across popup sessions).
      const canon = canonicalizeUrl(t?.url ?? "");
      if (canon) {
        const existing = (await jobsRepo.list()).find((j) => j.canonicalUrl === canon);
        if (existing) { setJob(existing); const a = (await analysesRepo.forJob(existing.id))[0]; if (a) setAnalysis(a); }
      }
    }).catch(() => undefined);
  }, []);

  const isWeb = !!tab.url && /^https?:/i.test(tab.url);
  const host = isWeb ? new URL(tab.url!).hostname.replace(/^www\./, "") : "";
  const linkedin = isWeb && providerFromUrl(tab.url!) === "linkedin";
  const known = isWeb ? KNOWN[providerFromUrl(tab.url!)] : undefined;

  const runAnalysis = async (f: NonNullable<typeof fields>) => {
    if (!rid) throw new Error("Upload a resume in the dashboard first.");
    const j = await recordDiscoveredJob(jobFromInput({ title: f.title, company: f.company, location: f.location, description: f.description, url: f.url || undefined, provider: f.provider, extractorConfidence: f.confidence, extractorNotes: f.notes }));
    setJob(j);
    setAnalysis(await analyze(j.id, rid));
  };

  const doExtract = async () => {
    setBusy(true); setError(null); setPermissionOrigin(null); setSavedMsg(null);
    try {
      const r = await send<ExtractResult>({ type: "page/extract", tabId: tab.id });
      if (r.needsPermission) { setPermissionOrigin(r.origin ?? (isWeb ? `${new URL(tab.url!).origin}/*` : null)); setError(r.message ?? null); return; }
      if (r.status === "unsupported" || r.status === "failed" || !r.job) { setError(r.message ?? r.job?.notes?.[0] ?? "Couldn't read a job from this page."); return; }
      const tt = parseTabTitle(tab.title);
      const f = { title: r.job.title || (linkedin ? tt.title : ""), company: r.job.company || (linkedin ? tt.company : ""), location: r.job.location, description: r.job.description, url: r.job.url, confidence: r.job.confidence, notes: r.job.notes, provider: r.job.provider };
      setFields(f);
      if (r.status === "not_a_job_page" || f.description.length < 120) { setError(f.notes[0] ?? "This doesn't look like a job listing. Paste the description instead."); return; }
      await runAnalysis(f);
    } catch (e) { setError(e instanceof MessageError ? e.message : errMsg(e)); } finally { setBusy(false); }
  };

  const grant = async () => {
    if (!permissionOrigin) return;
    const ok = await chrome.permissions.request({ origins: [permissionOrigin] });
    if (ok) { setPermissionOrigin(null); setError(null); await doExtract(); } else setError("Permission not granted — you can paste the description instead.");
  };

  const save = async () => {
    if (!job) return;
    try {
      const r = await saveJob(job); const res = await createApplication(r.job, { analysis });
      setJob(r.job); setSavedMsg(res.existing ? "Already in your tracker — no duplicate created." : "Saved to your tracker.");
    } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); }
  };

  /* ---------- no resume ---------- */
  if (!loading && resumes && resumes.length === 0) {
    return (
      <div className="p-4"><Header />
        <Banner tone="warn" title="Upload your resume first" action={<Button size="sm" variant="primary" onClick={() => openDashboard("/resumes")}>Open</Button>}>CareerPilot scores jobs against your resume. It's stored only on this device.</Banner>
      </div>
    );
  }

  return (
    <div className="p-4">
      <Header />
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium text-muted" htmlFor="resume">Resume</label>
        {loading ? <Skeleton className="h-9 w-full" /> : <Select id="resume" value={rid} onChange={(e) => { setResumeId(e.target.value); setAnalysis(null); }}>{resumes?.map((r) => <option key={r.id} value={r.id}>{r.title}{r.isDefault ? " (default)" : ""}</option>)}</Select>}
      </div>

      <div className="mb-3 rounded-lg border border-line bg-surface p-3 text-sm">
        <p className="text-xs text-muted">Current page</p>
        {isWeb ? <><p className="truncate font-medium" title={tab.title}>{tab.title || host}</p><p className="text-xs text-muted">{host} {known ? <Badge tone="good">{known} supported</Badge> : <Badge>Generic read</Badge>}</p></> : <p className="text-muted">Not a web page.</p>}
      </div>

      {view === "main" && (
        <>
          {error && <div className="mb-3"><Banner tone="warn" title="Couldn't analyse this page">{error}</Banner></div>}
          {permissionOrigin && <Button className="mb-3 w-full" variant="primary" onClick={grant}>Allow on this site</Button>}
          {!analysis && !busy && (
            <div className="space-y-2">
              <Button className="w-full" variant="primary" disabled={!isWeb} onClick={doExtract}>Analyze this job</Button>
              <Button className="w-full" onClick={() => setView("manual")}>Paste a job description</Button>
              {linkedin ? <p className="rounded-lg border border-line p-2 text-xs text-muted"><strong>LinkedIn:</strong> it doesn't allow extensions to read its pages. <strong>Select the job description text</strong> on the page (drag with the mouse), then click <em>Analyze this job</em> — or paste it. The title and company are filled in from the tab title.</p> : <Button className="w-full" disabled={!isWeb} onClick={() => setView("scan")}>Scan all jobs on this page</Button>}
              <p className="text-xs text-muted">The page is only read when you click Analyze. {known === "LinkedIn" && "On LinkedIn, select the description text first."}</p>
            </div>
          )}
          {busy && <div role="status" aria-label="Analysing" className="space-y-2"><Skeleton className="h-24 w-full" /><Skeleton className="h-4 w-2/3" /></div>}

          {analysis && job && !busy && (
            <div className="space-y-3">
              <div className="flex items-center gap-4 rounded-lg border border-line bg-surface p-3">
                <ScoreRing score={analysis.totalScore} size={84} label={analysis.label} />
                <div className="min-w-0"><p className="truncate font-semibold" title={job.title}>{job.title || "Untitled role"}</p><p className="truncate text-xs text-muted">{job.company || "Unknown company"}</p><p className="mt-1 text-sm font-medium">{analysis.label}</p></div>
              </div>
              {(analysis.incomplete || job.extractionConfidence < 0.5) && <Banner tone="warn" title="Score may be incomplete">{analysis.incompleteReasons[0] ?? "Job details were detected with low confidence."}</Banner>}
              {analysis.skillMatches.some((m) => m.status === "not_found" && m.required) && <p className="text-xs text-muted">Not found in resume: {analysis.skillMatches.filter((m) => m.status === "not_found" && m.required).slice(0, 4).map((m) => m.skill).join(", ")}</p>}
              {savedMsg && <Banner tone="good">{savedMsg}</Banner>}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="primary" onClick={save}>Save job</Button>
                <Button onClick={() => openDashboard(`/jobs/${job.id}`)}>Full analysis</Button>
                <Button onClick={() => openDashboard(`/jobs/${job.id}/documents`)}>Tailor resume</Button>
                <Button onClick={() => openDashboard(`/jobs/${job.id}/documents?tab=cover`)}>Cover letter</Button>
              </div>
              <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setView("autofill")}>Help with application form…</Button><Button size="sm" variant="ghost" onClick={() => { setAnalysis(null); setJob(null); }}>Analyze again</Button></div>
            </div>
          )}
        </>
      )}

      {view === "manual" && <Manual initial={{ ...parseTabTitle(tab.title), description: "" }} onCancel={() => setView("main")} onSubmit={async (f) => { setBusy(true); setView("main"); setError(null); try { await runAnalysis({ ...f, url: tab.url ?? "", confidence: 0.6, notes: [], provider: "manual" }); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); } }} />}
      {view === "scan" && <ScanList tabId={tab.id} isWeb={isWeb} resumeId={rid} onBack={() => setView("main")} />}
      {view === "autofill" && <Autofill tabId={tab.id} job={job} onBack={() => setView("main")} />}

      <div className="mt-4 border-t border-line pt-3"><Button variant="ghost" size="sm" className="w-full" onClick={() => openDashboard("/")}>Open dashboard ↗</Button></div>
    </div>
  );
}

const Header = () => <div className="mb-4 flex items-center justify-between"><Logo compact /></div>;

function Manual({ onSubmit, onCancel, initial }: { onSubmit: (f: { title: string; company: string; location: string; description: string }) => void; onCancel: () => void; initial?: { title: string; company: string; description: string } }) {
  const [f, setF] = useState({ title: initial?.title ?? "", company: initial?.company ?? "", location: "", description: "" });
  const [err, setErr] = useState("");
  return (
    <div className="space-y-3">
      <Field label="Job title">{(id) => <Input id={id} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
      <Field label="Company">{(id) => <Input id={id} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} />}</Field>
      <Field label="Job description" error={err}>{(id) => <Textarea id={id} rows={6} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Paste the full description…" />}</Field>
      <div className="flex justify-between"><Button onClick={onCancel}>Back</Button><Button variant="primary" onClick={() => (f.description.trim().length < 40 ? setErr("Paste the full job description.") : onSubmit(f))}>Analyze</Button></div>
    </div>
  );
}

/** Review-before-fill. Nothing is filled until the user ticks fields and clicks Fill; nothing is ever submitted. */
function Autofill({ tabId, job, onBack }: { tabId?: number; job: Job | null; onBack: () => void }) {
  const toast = useToast();
  const [maps, setMaps] = useState<Array<FieldMapping & { use: boolean; edited: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filled, setFilled] = useState<number | null>(null);
  const [checks, setChecks] = useState<boolean[]>(APPLICATION_CHECKLIST.map(() => false));
  const [submitted, setSubmitted] = useState(false);

  const scan = async () => {
    setErr(null);
    try {
      const profile = await profileRepo.get();
      if (!profile) { setErr("No profile yet. Upload a resume first."); return; }
      const fields = await send<FormFieldDescriptor[]>({ type: "autofill/scan", tabId });
      setMaps(mapFormFields(fields, profile).map((m) => ({ ...m, use: !!m.value && !m.sensitive, edited: m.value })));
    } catch (e) { setErr(e instanceof MessageError ? e.message : errMsg(e)); }
  };
  useEffect(() => { void scan(); /* eslint-disable-next-line */ }, []);

  const fill = async () => {
    const fills = (maps ?? []).filter((m) => m.use && m.edited.trim()).map((m) => ({ selector: m.field.selector, value: m.edited }));
    if (!fills.length) { toast.push({ tone: "info", text: "Nothing selected." }); return; }
    try { const r = await send<Array<{ filled: boolean }>>({ type: "autofill/apply", tabId, fills }); setFilled(r.filter((x) => x.filled).length); }
    catch (e) { setErr(errMsg(e)); }
  };

  const confirmSubmitted = async () => {
    if (!job) return;
    const { application } = await createApplication((await saveJob(job)).job, { status: "preparing" });
    await setApplicationStatus(application.id, "applied", { userConfirmedSubmitted: true });
    setSubmitted(true);
  };

  return (
    <div className="space-y-3">
      <Banner tone="info">Review each field. Salary and notice period are unticked by default; screening, eligibility and file fields are never filled. <strong>You</strong> must click the site's submit button.</Banner>
      {err && <Banner tone="warn">{err}</Banner>}
      {!maps && !err && <Skeleton className="h-32 w-full" />}
      {maps && maps.length === 0 && <p className="text-sm text-muted">No fillable fields found on this page.</p>}
      <ul className="max-h-64 space-y-2 overflow-y-auto">
        {maps?.map((m, i) => (
          <li key={m.field.selector + i} className="rounded-lg border border-line p-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" disabled={!m.key} checked={m.use} onChange={(e) => setMaps(maps.map((x, j) => (j === i ? { ...x, use: e.target.checked } : x)))} /><span className="truncate font-medium">{m.field.label || m.field.name || m.field.placeholder || m.field.type}</span>{m.sensitive && <Badge tone="warn">Sensitive</Badge>}</label>
            {m.key ? <Input aria-label={`Value for ${m.field.label || m.field.name}`} className="mt-1.5 !py-1 text-xs" value={m.edited} onChange={(e) => setMaps(maps.map((x, j) => (j === i ? { ...x, edited: e.target.value } : x)))} /> : <p className="mt-1 text-xs text-muted">{m.reason}</p>}
            {m.key && !m.value && <p className="mt-1 text-xs text-muted">{m.reason}</p>}
          </li>
        ))}
      </ul>
      {filled !== null && <Banner tone="good" title={`Filled ${filled} field${filled === 1 ? "" : "s"}`}>Already-filled fields were left alone. Review everything on the page.</Banner>}
      <div className="flex justify-between"><Button onClick={onBack}>Back</Button><Button variant="primary" disabled={!maps?.some((m) => m.use)} onClick={fill}>Fill selected</Button></div>

      {filled !== null && (
        <div className="rounded-lg border border-line p-3 text-sm">
          <p className="mb-2 font-medium">Before you submit</p>
          {APPLICATION_CHECKLIST.slice(0, 4).map((c, i) => <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={checks[i]} onChange={() => setChecks(checks.map((x, j) => (j === i ? !x : x)))} />{c}</label>)}
          {!submitted ? (
            job ? <Button className="mt-3 w-full" disabled={!checks.slice(0, 4).every(Boolean)} onClick={confirmSubmitted}>I submitted it — record in tracker</Button> : <p className="mt-2 text-xs text-muted">Analyze the job first to track it.</p>
          ) : <Banner tone="good">Recorded as applied because you confirmed it.</Banner>}
        </div>
      )}
    </div>
  );
}
