import { useState } from "react";
import { Link } from "react-router-dom";
import { computeAnalytics, type Job, type JobAnalysis } from "@careerpilot/shared";
import type { InterviewOutput } from "@careerpilot/shared";
import { Badge, Banner, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Select, SkeletonRows, Textarea, useToast } from "../../ui/kit";
import { errMsg, useLive } from "../../ui/hooks";
import { analysesRepo, applicationsRepo, jobsRepo, resumesRepo } from "../../storage/db";
import { aiStatus, callAi, describeAiError } from "../../services/aiClient";
import { analyze, resolveProfile } from "../../services/workflow";
import { latestByJob } from "../lib";

type Suggest = "projects" | "learning" | "weeklyPlan" | "resumeImprovements";

export function Coach() {
  const toast = useToast();
  const { data, loading } = useLive(async () => ({ jobs: await jobsRepo.list(), analyses: await analysesRepo.list(), apps: await applicationsRepo.list(), def: await resumesRepo.getDefault(), ai: await aiStatus() }), []);
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ kind: string; items?: string[]; interview?: InterviewOutput; message?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [recipient, setRecipient] = useState("Recruiter");

  if (loading || !data) return <SkeletonRows />;
  const scores = latestByJob(data.analyses, data.def?.id);
  const job: Job | undefined = data.jobs.find((j) => j.id === (jobId || data.jobs[0]?.id));
  const a = computeAnalytics({ jobs: data.jobs, analyses: data.analyses, applications: data.apps });

  // Deterministic learning gaps: always available, no AI needed.
  const gaps = a.topMissingSkills;

  const run = async (kind: string, op: "generateInterviewQuestions" | "suggest" | "draftOutreach" | "analyzeJob", extra: Record<string, unknown> = {}) => {
    if (!job) return;
    setBusy(true); setErr(null); setOut(null);
    try {
      const profile = await resolveProfile(data.def);
      const analysis: JobAnalysis = scores.get(job.id) ?? (await analyze(job.id, data.def?.id));
      const r = await callAi<any>(op, { profile, job, analysis, ...extra });
      setOut(op === "generateInterviewQuestions" ? { kind, interview: r } : op === "draftOutreach" ? { kind, message: r.message } : op === "analyzeJob" ? { kind, items: [r.explanation, ...r.suggestions] } : { kind, items: r.items });
    } catch (e) { setErr(describeAiError(e) || errMsg(e)); toast.push({ tone: "bad", text: "AI request failed." }); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="Career coach" subtitle="Optional AI help grounded in your verified profile. It drafts — you decide." />
      {!data.ai.configured && <div className="mb-5"><Banner tone="info" title="AI is not configured" action={<Link className="text-sm text-primary underline" to="/settings">Set up</Link>}>{data.ai.reason} The skill-gap summary below works without AI.</Banner></div>}

      <Card className="mb-5">
        <CardHeader title="Learning gaps from your analysed jobs" subtitle="Skills most often “not found in resume” — a to-learn list only if you genuinely lack them." />
        <div className="flex flex-wrap gap-2 p-5">{gaps.length ? gaps.map((g) => <Badge key={g.skill} tone="warn">{g.skill} · {g.count} job{g.count > 1 ? "s" : ""}</Badge>) : <p className="text-sm text-muted">Analyse a few jobs to see patterns.</p>}</div>
      </Card>

      {data.jobs.length === 0 ? <EmptyState title="Add a job to coach against" body="Interview prep and suggestions are built around a specific job." /> : (
        <Card>
          <CardHeader title="Tools" />
          <div className="space-y-4 p-5">
            <Field label="Job">{(id) => <Select id={id} value={job?.id ?? ""} onChange={(e) => setJobId(e.target.value)}>{data.jobs.map((j) => <option key={j.id} value={j.id}>{j.title || "Untitled"} — {j.company || "Unknown"}</option>)}</Select>}</Field>
            <div className="flex flex-wrap gap-2">
              {([["Why this job may suit me", "analyzeJob", {}], ["Portfolio project ideas", "suggest", { kind: "projects" }], ["Learning gaps", "suggest", { kind: "learning" }], ["Weekly job-search plan", "suggest", { kind: "weeklyPlan" }], ["Resume improvements", "suggest", { kind: "resumeImprovements" }]] as const).map(([label, op, extra]) => (
                <Button key={label} disabled={!data.ai.configured || busy} onClick={() => run(label, op, extra)}>{label}</Button>
              ))}
              <Button disabled={!data.ai.configured || busy} onClick={() => run("Interview questions & STAR prompts", "generateInterviewQuestions")}>Interview questions & STAR prompts</Button>
            </div>
            <div className="flex items-end gap-2"><Field label="Recruiter outreach draft — recipient role">{(id) => <Input id={id} value={recipient} onChange={(e) => setRecipient(e.target.value)} />}</Field><Button disabled={!data.ai.configured || busy} onClick={() => run("Outreach draft", "draftOutreach", { recipient })}>Draft message</Button></div>
          </div>
        </Card>
      )}

      {busy && <div className="mt-5"><SkeletonRows n={2} /></div>}
      {err && <div className="mt-5"><Banner tone="warn" title="AI unavailable">{err}</Banner></div>}
      {out && (
        <Card className="mt-5">
          <CardHeader title={out.kind} action={<Badge tone="accent">AI-generated — review before use</Badge>} />
          <div className="space-y-3 p-5 text-sm">
            {out.items && <ul className="list-disc space-y-1.5 pl-5">{out.items.map((i, n) => <li key={n}>{i}</li>)}</ul>}
            {out.message && <><Textarea aria-label="Draft message" rows={8} defaultValue={out.message} /><p className="text-xs text-muted">Copy and send it yourself. CareerPilot never sends messages, emails or connection requests.</p></>}
            {out.interview && <>
              <div><h4 className="font-medium">Technical</h4><ul className="list-disc pl-5">{out.interview.technical.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
              <div><h4 className="font-medium">Behavioural</h4><ul className="list-disc pl-5">{out.interview.behavioral.map((q, i) => <li key={i}>{q}</li>)}</ul></div>
              <div><h4 className="font-medium">STAR practice (from your experience)</h4><ul className="space-y-2 pl-1">{out.interview.star.map((s, i) => <li key={i}><p>{s.prompt}</p><p className="text-xs text-muted">Based on: {s.basedOn}</p></li>)}</ul></div></>}
          </div>
        </Card>
      )}
    </div>
  );
}
