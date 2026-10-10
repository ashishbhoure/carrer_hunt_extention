import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { analyzeJob, type Job, type JobAnalysis } from "@careerpilot/shared";
import { Badge, Banner, Button, Card, CardHeader, EmptyState, Field, Input, Overlay, PageHeader, Select, SkeletonRows, Tabs, useToast } from "../../ui/kit";
import { errMsg, useLive } from "../../ui/hooks";
import { analysesRepo, jobsRepo, kv, profileRepo, resumesRepo, settingsRepo } from "../../storage/db";
import { analyze, createApplication, recordDiscoveredJob, saveJob } from "../../services/workflow";
import { emptyFilters, filterJobs, sortJobs, type JobFilters, type SortKey } from "../jobFilters";
import { latestByJob } from "../lib";
import { JobCard } from "../components/JobCard";
import { JobIntake } from "../components/JobIntake";
import { PROVIDERS, runDiscovery, searchLinks, type ProviderOutcome } from "../../discovery/providers";

const PAGE = 10;

export function Jobs() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"mine" | "discover">("mine");
  const [addOpen, setAddOpen] = useState(params.get("add") === "1");
  const nav = useNavigate();
  const closeAdd = () => { setAddOpen(false); if (params.get("add")) setParams({}); };
  return (
    <div>
      <PageHeader title="Jobs" subtitle="Everything you've analysed or saved, plus authorized job sources."
        actions={<><Tabs tabs={[{ id: "mine", label: "My jobs" }, { id: "discover", label: "Discover" }]} value={tab} onChange={setTab} /><Button variant="primary" onClick={() => setAddOpen(true)}>Add job</Button></>} />
      {tab === "mine" ? <MyJobs /> : <Discover />}
      <Overlay open={addOpen} onClose={closeAdd} title="Add a job" width="max-w-2xl"><JobIntake onDone={(j) => { closeAdd(); nav(`/jobs/${j.id}`); }} /></Overlay>
    </div>
  );
}

function MyJobs() {
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<JobFilters>(emptyFilters);
  const [sort, setSort] = useState<SortKey>("recent");
  const [shown, setShown] = useState(PAGE);
  const { data, loading } = useLive(async () => ({ jobs: await jobsRepo.list(), analyses: await analysesRepo.list(), def: await resumesRepo.getDefault() }), []);
  const set = <K extends keyof JobFilters>(k: K, v: JobFilters[K]) => { setF((x) => ({ ...x, [k]: v })); setShown(PAGE); };

  const scores = useMemo(() => latestByJob(data?.analyses ?? [], data?.def?.id), [data]);
  const list = useMemo(() => sortJobs(filterJobs(data?.jobs ?? [], scores, f), scores, sort), [data, scores, f, sort]);
  const sources = [...new Set((data?.jobs ?? []).map((j) => j.provider))];

  if (loading || !data) return <SkeletonRows />;
  if (!data.jobs.length) return <EmptyState icon="🔎" title="No jobs yet" body="Open a job posting and click the CareerPilot icon, paste a description with “Add job”, or search authorized sources under Discover." />;

  const save = async (j: Job) => {
    try { const r = await saveJob(j); const a = scores.get(j.id); await createApplication(r.job, { analysis: a ?? null }); toast.push({ tone: "good", text: "Saved to your tracker." }); } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[250px_1fr]">
      <Card className="h-fit p-4" aria-label="Filters">
        <div className="space-y-3">
          <Field label="Keywords / skills">{(id) => <Input id={id} value={f.keywords} onChange={(e) => set("keywords", e.target.value)} placeholder="react node" />}</Field>
          <Field label="Location">{(id) => <Input id={id} value={f.location} onChange={(e) => set("location", e.target.value)} />}</Field>
          <Field label="Work mode">{(id) => <Select id={id} value={f.workMode} onChange={(e) => set("workMode", e.target.value)}><option value="">Any</option><option value="remote">Remote</option><option value="hybrid">Hybrid</option><option value="onsite">Onsite</option></Select>}</Field>
          <Field label="Employment type">{(id) => <Input id={id} value={f.employmentType} onChange={(e) => set("employmentType", e.target.value)} placeholder="Full-time" />}</Field>
          <Field label="Company">{(id) => <Input id={id} value={f.company} onChange={(e) => set("company", e.target.value)} />}</Field>
          <Field label="Source">{(id) => <Select id={id} value={f.source} onChange={(e) => set("source", e.target.value)}><option value="">All sources</option>{sources.map((s) => <option key={s}>{s}</option>)}</Select>}</Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Min yrs">{(id) => <Input id={id} type="number" min={0} value={f.minYears ?? ""} onChange={(e) => set("minYears", e.target.value === "" ? null : Number(e.target.value))} />}</Field>
            <Field label="Max yrs">{(id) => <Input id={id} type="number" min={0} value={f.maxYears ?? ""} onChange={(e) => set("maxYears", e.target.value === "" ? null : Number(e.target.value))} />}</Field>
          </div>
          <Field label={`Minimum match: ${f.minScore}`}>{(id) => <input id={id} className="w-full" type="range" min={0} max={100} step={5} value={f.minScore} onChange={(e) => set("minScore", Number(e.target.value))} />}</Field>
          <Field label="Date posted" hint="Only jobs with a verified posting date.">{(id) => <Select id={id} value={f.postedWithinDays ?? ""} onChange={(e) => set("postedWithinDays", e.target.value ? Number(e.target.value) : null)}><option value="">Any time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></Select>}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.hasSalary} onChange={(e) => set("hasSalary", e.target.checked)} />Salary listed</label>
          <Button size="sm" onClick={() => { setF(emptyFilters); setShown(PAGE); }}>Reset filters</Button>
        </div>
      </Card>
      <div>
        <div className="mb-3 flex items-center justify-between"><p className="text-sm text-muted">{list.length} job{list.length === 1 ? "" : "s"}</p>
          <label className="flex items-center gap-2 text-sm text-muted">Sort<Select aria-label="Sort" className="!w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}><option value="recent">Most recent</option><option value="score">Match score</option><option value="title">Title</option></Select></label></div>
        {list.length === 0 ? <EmptyState title="No jobs match these filters" action={<Button onClick={() => setF(emptyFilters)}>Reset filters</Button>} /> : (
          <ul className="space-y-3">{list.slice(0, shown).map((j) => (
            <li key={j.id}><JobCard job={j} analysis={scores.get(j.id)} saved={!!j.savedAt} onSave={() => save(j)} onAnalyze={() => nav(`/jobs/${j.id}`)} /></li>
          ))}</ul>
        )}
        {list.length > shown && <div className="mt-4 text-center"><Button onClick={() => setShown((s) => s + PAGE)}>Load more ({list.length - shown} left)</Button></div>}
      </div>
    </div>
  );
}

function Discover() {
  const nav = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState({ keywords: "", location: "", remoteOnly: false });
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Array<{ job: Job; analysis?: JobAnalysis }> | null>(null);
  const [outcomes, setOutcomes] = useState<ProviderOutcome[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const links = searchLinks(q.keywords, q.location);

  const search = async () => {
    setMsg(null); setResults(null);
    if (!q.keywords.trim()) { setMsg("Enter keywords or a job title."); return; }
    const chosen = PROVIDERS.filter((p) => enabled[p.id]);
    if (!chosen.length) { setMsg("Choose at least one source."); return; }
    setBusy(true);
    try {
      // Host permission is requested only now, in response to this click, for the chosen sources only.
      const granted = await chrome.permissions.request({ origins: chosen.flatMap((p) => p.origins) });
      if (!granted) { setMsg("Permission was not granted, so these sources can't be contacted."); return; }
      const { jobs, outcomes } = await runDiscovery(chosen, q, (...a) => fetch(...a), { get: (k) => kv.get(k), set: (k, v) => kv.set(k, v) });
      setOutcomes(outcomes);
      const [profile, resume, settings] = [await profileRepo.get(), await resumesRepo.getDefault(), await settingsRepo.get()];
      const ranked = jobs.map((job) => ({ job, analysis: profile && resume ? analyzeJob({ job, profile, resumeId: resume.id, resumeText: resume.extractedText, weights: settings.weights }) : undefined }))
        .sort((a, b) => (b.analysis?.totalScore ?? -1) - (a.analysis?.totalScore ?? -1));
      setResults(ranked);
      if (!profile || !resume) setMsg("Upload a resume to see match scores on these results.");
    } catch (e) { setMsg(errMsg(e)); } finally { setBusy(false); }
  };

  const keep = async (job: Job, goAnalyze: boolean, save: boolean) => {
    try {
      const stored = save ? (await saveJob(job)).job : await recordDiscoveredJob(job);
      if (save) await createApplication(stored, { analysis: null });
      if (goAnalyze) { await analyze(stored.id); nav(`/jobs/${stored.id}`); } else toast.push({ tone: "good", text: "Saved." });
    } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); }
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Search authorized sources" subtitle="Only official public job APIs. Results are real listings with source attribution — never invented." />
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field label="Title or keywords">{(id) => <Input id={id} value={q.keywords} onChange={(e) => setQ({ ...q, keywords: e.target.value })} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="React developer" />}</Field>
            <Field label="City (for search links)">{(id) => <Input id={id} value={q.location} onChange={(e) => setQ({ ...q, location: e.target.value })} placeholder="Pune" />}</Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {PROVIDERS.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!enabled[p.id]} onChange={(e) => setEnabled({ ...enabled, [p.id]: e.target.checked })} />{p.name}</label>)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.remoteOnly} onChange={(e) => setQ({ ...q, remoteOnly: e.target.checked })} />Remote only</label>
            <Button variant="primary" loading={busy} onClick={search}>Search</Button>
          </div>
          <p className="text-xs text-muted">Clicking Search asks Chrome for permission to contact only the sources you ticked.</p>
          {msg && <Banner tone="warn">{msg}</Banner>}
        </div>
      </Card>

      {links.length > 0 && (
        <Card className="p-5">
          <p className="mb-2 text-sm font-medium">Search other sites yourself</p>
          <p className="mb-3 text-xs text-muted">CareerPilot doesn't scrape these sites. These links open a normal search in a new tab; when you open a listing, use the extension popup to analyse it.</p>
          <div className="flex flex-wrap gap-2">{links.map((l) => <a key={l.site} className="rounded-lg border border-line px-3 py-1.5 text-sm text-primary hover:bg-surface-2" href={l.url} target="_blank" rel="noopener noreferrer">{l.site} ↗</a>)}</div>
        </Card>
      )}

      {outcomes.length > 0 && <div className="flex flex-wrap gap-2">{outcomes.map((o) => <Badge key={o.provider} tone={o.ok ? "good" : "bad"}>{o.provider}: {o.ok ? `${o.count} results${o.cached ? " (cached)" : ""}` : o.error}</Badge>)}</div>}
      {busy && <SkeletonRows />}
      {results && results.length === 0 && !busy && <EmptyState title="No results" body="Try broader keywords. Sources only return roles that match." />}
      {results && results.length > 0 && (
        <ul className="space-y-3">{results.slice(0, 30).map(({ job, analysis }) => (
          <li key={job.id}><JobCard job={job} analysis={analysis} attribution={PROVIDERS.find((p) => p.id === job.provider)?.attribution} onSave={() => keep(job, false, true)} onAnalyze={() => keep(job, true, false)} /></li>
        ))}</ul>
      )}
    </div>
  );
}
