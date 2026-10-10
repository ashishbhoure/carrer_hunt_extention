import { Link, useNavigate } from "react-router-dom";
import { Badge, Banner, Button, Card, CardHeader, EmptyState, PageHeader, SkeletonRows } from "../../ui/kit";
import { useLive, fmtDate, timeAgo } from "../../ui/hooks";
import { analysesRepo, applicationsRepo, jobsRepo, profileRepo, resumesRepo } from "../../storage/db";
import { latestByJob, STATUS_LABEL, STATUS_TONE } from "../lib";

const IN_PROGRESS = new Set(["interested", "preparing", "applied", "assessment", "interview"]);

export function Dashboard() {
  const nav = useNavigate();
  const { data, loading } = useLive(async () => {
    const [jobs, analyses, apps, resumes, profile] = await Promise.all([jobsRepo.list(), analysesRepo.list(), applicationsRepo.list(), resumesRepo.list(), profileRepo.get()]);
    return { jobs, analyses, apps, resumes, profile };
  }, []);
  if (loading || !data) return <SkeletonRows n={4} />;
  const { jobs, analyses, apps, resumes, profile } = data;
  const def = resumes.find((r) => r.isDefault) ?? resumes[0];
  const scores = latestByJob(analyses, def?.id);
  const appliedJobIds = new Set(apps.filter((a) => a.appliedAt).map((a) => a.jobId));
  const recommended = jobs.filter((j) => !appliedJobIds.has(j.id) && scores.has(j.id)).sort((a, b) => scores.get(b.id)!.totalScore - scores.get(a.id)!.totalScore).slice(0, 4);
  const now = Date.now();
  const dueFollowUps = apps.filter((a) => (a.followUpAt || a.interviewAt) && !["rejected", "withdrawn"].includes(a.status)).flatMap((a) => [...(a.interviewAt ? [{ a, at: a.interviewAt, k: "Interview" }] : []), ...(a.followUpAt ? [{ a, at: a.followUpAt, k: "Follow-up" }] : [])]).sort((x, y) => x.at.localeCompare(y.at)).slice(0, 5);
  const activity = apps.flatMap((a) => a.history.map((h) => ({ ...h, label: `${a.title} · ${a.company}` }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  const kpis = [
    ["Jobs discovered", jobs.length], ["Saved jobs", jobs.filter((j) => j.savedAt).length],
    ["In progress", apps.filter((a) => IN_PROGRESS.has(a.status)).length], ["Interviews", apps.filter((a) => a.status === "interview").length],
  ] as const;
  const name = profile?.contact.fullName.split(" ")[0];

  return (
    <div>
      <PageHeader title={`Welcome back${name ? ", " + name : ""}`} subtitle="Here's where your job search stands." actions={<><Button onClick={() => nav("/jobs?add=1")} variant="primary">Analyze a job</Button><Button onClick={() => nav("/resumes")}>Resume library</Button></>} />

      {!def && <div className="mb-5"><Banner tone="warn" title="No resume uploaded" action={<Button size="sm" variant="primary" onClick={() => nav("/resumes")}>Upload</Button>}>Upload a resume to start scoring jobs.</Banner></div>}
      {def && profile && profile.skills.some((s) => !s.verified) && <div className="mb-5"><Banner tone="info" title="Profile needs your confirmation" action={<Button size="sm" onClick={() => nav("/profile")}>Review</Button>}>{profile.skills.filter((s) => !s.verified).length} detected skills have unconfirmed levels.</Banner></div>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map(([l, v]) => <Card key={l} className="p-4"><p className="text-xs text-muted">{l}</p><p className="mt-1 text-3xl font-semibold">{v}</p></Card>)}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recommended for you" subtitle="Your highest-scoring jobs you haven't applied to" action={<Link className="text-sm text-primary" to="/jobs">All jobs</Link>} />
          {recommended.length === 0 ? <div className="p-5"><EmptyState title="No analysed jobs yet" body="Analyse a job from any posting using the extension, or paste a description." action={<Button variant="primary" onClick={() => nav("/jobs?add=1")}>Paste a job</Button>} /></div> : (
            <ul className="divide-y divide-line">{recommended.map((j) => (
              <li key={j.id}><Link to={`/jobs/${j.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{j.title || "Untitled role"}</p><p className="truncate text-xs text-muted">{j.company || "Unknown company"}{j.location ? " · " + j.location : ""}</p></div><Badge tone={scores.get(j.id)!.totalScore >= 70 ? "good" : "warn"}>{scores.get(j.id)!.totalScore}</Badge></Link></li>
            ))}</ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Follow-ups & interviews" />
          {dueFollowUps.length === 0 ? <p className="p-5 text-sm text-muted">No follow-ups scheduled.</p> : (
            <ul className="divide-y divide-line">{dueFollowUps.map(({ a, at, k }) => (
              <li key={a.id + k} className="px-5 py-3 text-sm"><p className="font-medium">{a.title} <Badge tone={k === "Interview" ? "accent" : "warn"}>{k}</Badge></p><p className="text-xs text-muted">{a.company} · <span className={new Date(at).getTime() < now ? "text-bad" : ""}>{new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span></p></li>
            ))}</ul>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Recent activity" />
          {activity.length === 0 ? <p className="p-5 text-sm text-muted">Nothing yet. Save a job to start tracking.</p> : (
            <ul className="divide-y divide-line">{activity.map((a, i) => (
              <li key={i} className="flex items-center justify-between px-5 py-2.5 text-sm"><span><span className="font-medium">{a.label}</span> <span className="text-muted">— {a.detail}</span></span><span className="text-xs text-muted">{timeAgo(a.at)}</span></li>
            ))}</ul>
          )}
        </Card>
      </div>
      <p className="mt-6 text-xs text-muted">Pipeline: {Object.entries(apps.reduce<Record<string, number>>((m, a) => ((m[a.status] = (m[a.status] ?? 0) + 1), m), {})).map(([s, n]) => <Badge key={s} tone={STATUS_TONE[s as keyof typeof STATUS_TONE]} className="mr-1">{STATUS_LABEL[s as keyof typeof STATUS_LABEL]} {n}</Badge>)}</p>
    </div>
  );
}
