import { useState } from "react";
import { computeAnalytics, MIN_SAMPLE } from "@careerpilot/shared";
import { Banner, Card, CardHeader, EmptyState, PageHeader, Select, SkeletonRows } from "../../ui/kit";
import { useLive } from "../../ui/hooks";
import { analysesRepo, applicationsRepo, jobsRepo } from "../../storage/db";
import { STATUS_LABEL } from "../lib";

export function AnalyticsPage() {
  const [range, setRange] = useState("all");
  const { data, loading } = useLive(async () => ({ jobs: await jobsRepo.list(), analyses: await analysesRepo.list(), applications: await applicationsRepo.list() }), []);
  if (loading || !data) return <SkeletonRows />;
  const since = range === "all" ? null : new Date(Date.now() - Number(range) * 86400000);
  const a = computeAnalytics({ ...data, since });
  const empty = data.jobs.length === 0 && data.applications.length === 0;

  const kpis: Array<[string, string | number, string?]> = [
    ["Jobs discovered", a.totals.discovered], ["Jobs saved", a.totals.saved], ["Applications you confirmed", a.totals.applied],
    ["Interviews", a.totals.interviews], ["Offers", a.totals.offers], ["Rejections", a.totals.rejections],
    ["Average match score", a.averageMatchScore ?? "—", a.averageMatchScore === null ? "No analyses yet" : "Across analysed jobs"],
    ["Interview conversion", a.interviewConversion.rate === null ? "—" : `${a.interviewConversion.rate}%`, a.interviewConversion.reliable ? `${a.interviewConversion.sample} applications` : `Needs ${MIN_SAMPLE}+ applications (have ${a.interviewConversion.sample})`],
  ];
  const maxStatus = Math.max(1, ...Object.values(a.statusDistribution));
  const maxWeek = Math.max(1, ...a.applicationsPerWeek.map((w) => w.count));
  const maxGap = Math.max(1, ...a.topMissingSkills.map((s) => s.count));

  return (
    <div>
      <PageHeader title="Analytics" subtitle="Computed from your own data. Small samples are labelled, not dressed up as trends."
        actions={<Select aria-label="Date range" className="!w-40" value={range} onChange={(e) => setRange(e.target.value)}><option value="all">All time</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></Select>} />
      {empty ? <EmptyState icon="📊" title="No data yet" body="Analytics appear once you analyse or save jobs." /> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{kpis.map(([l, v, s]) => <Card key={l} className="p-4"><p className="text-xs text-muted">{l}</p><p className="mt-1 text-3xl font-semibold">{v}</p>{s && <p className="mt-1 text-xs text-muted">{s}</p>}</Card>)}</div>
          {a.notes.map((n) => <Banner key={n} tone="info">{n}</Banner>)}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader title="Status distribution" />
              <ul className="space-y-2 p-5">{Object.entries(a.statusDistribution).map(([s, n]) => <li key={s} className="grid grid-cols-[100px_1fr_30px] items-center gap-3 text-sm"><span>{STATUS_LABEL[s as keyof typeof STATUS_LABEL]}</span><div className="h-3 rounded bg-surface-2"><div className="h-3 rounded bg-primary" style={{ width: `${(n / maxStatus) * 100}%` }} /></div><span className="text-right">{n}</span></li>)}{!Object.keys(a.statusDistribution).length && <li className="text-sm text-muted">No applications yet.</li>}</ul></Card>
            <Card><CardHeader title="Applications per week" subtitle="Only applications you confirmed as submitted" />
              <div className="p-5">{a.applicationsPerWeek.length === 0 ? <p className="text-sm text-muted">No confirmed applications in this range.</p> : (
                <><div role="img" aria-label="Applications per week bar chart" className="flex h-36 items-end gap-2">{a.applicationsPerWeek.map((w) => <div key={w.week} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${w.week}: ${w.count}`}><span className="text-xs">{w.count}</span><div className="w-full rounded-t bg-accent" style={{ height: `${(w.count / maxWeek) * 100}%` }} /></div>)}</div>
                  <div className="mt-1 flex gap-2 text-[10px] text-muted">{a.applicationsPerWeek.map((w) => <span key={w.week} className="flex-1 text-center">{w.week.slice(5)}</span>)}</div>
                  {a.applicationsPerWeek.length < 4 && <p className="mt-3 text-xs text-muted">Fewer than 4 weeks of data — not a trend yet.</p>}</>)}</div></Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card><CardHeader title="Most frequently missing skills" subtitle="Required or preferred skills “not found in resume” across analysed jobs" />
              <ul className="space-y-2 p-5">{a.topMissingSkills.map((s) => <li key={s.skill} className="grid grid-cols-[110px_1fr_30px] items-center gap-3 text-sm"><span>{s.skill}</span><div className="h-3 rounded bg-surface-2"><div className="h-3 rounded bg-warn" style={{ width: `${(s.count / maxGap) * 100}%` }} /></div><span className="text-right">{s.count}</span></li>)}{!a.topMissingSkills.length && <li className="text-sm text-muted">No gaps recorded yet.</li>}</ul>
              {a.topMissingSkills.length > 0 && <p className="px-5 pb-4 text-xs text-muted">Counts show how often a skill wasn't found, not proof you lack it.</p>}</Card>
            <Card><CardHeader title="Sources and interviews" />
              <div className="p-5">{a.sources.length === 0 ? <p className="text-sm text-muted">No confirmed applications yet.</p> : <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted"><th className="pb-2 font-medium">Source</th><th className="pb-2 font-medium">Applied</th><th className="pb-2 font-medium">Interviews</th></tr></thead><tbody>{a.sources.map((s) => <tr key={s.source}><td className="py-1">{s.source}</td><td>{s.applications}</td><td>{s.reliable ? s.interviews : <span className="text-xs text-muted">too few to compare</span>}</td></tr>)}</tbody></table>}
                <p className="mt-3 text-xs text-muted">CareerPilot does not claim any resume version or source improves interview rates unless there is enough of your own data.</p></div></Card>
          </div>
        </div>
      )}
    </div>
  );
}
