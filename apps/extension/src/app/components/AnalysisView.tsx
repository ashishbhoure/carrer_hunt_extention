import type { Job, JobAnalysis, SkillMatch } from "@careerpilot/shared";
import { Badge, Banner, Bar, Card, CardHeader, ScoreRing, scoreTone } from "../../ui/kit";

const STATUS: Record<SkillMatch["status"], { label: string; tone: "good" | "info" | "warn" | "bad" | "neutral" }> = {
  matched_verified: { label: "Matched", tone: "good" },
  matched_learning: { label: "Learning (partial)", tone: "info" },
  matched_text_only: { label: "In resume text", tone: "info" },
  not_found: { label: "Not found in resume", tone: "warn" },
  marked_not_applicable: { label: "You marked N/A", tone: "bad" },
};

export function SkillChip({ m }: { m: SkillMatch }) {
  const s = STATUS[m.status];
  return <span title={m.evidence || s.label} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs"><span className="font-medium">{m.skill}</span><Badge tone={s.tone}>{s.label}</Badge></span>;
}

export function AnalysisView({ analysis, job }: { analysis: JobAnalysis; job: Job }) {
  const req = analysis.skillMatches.filter((m) => m.required);
  const pref = analysis.skillMatches.filter((m) => !m.required);
  const matched = analysis.skillMatches.filter((m) => m.status.startsWith("matched"));
  const missing = analysis.skillMatches.filter((m) => m.status === "not_found" || m.status === "marked_not_applicable");
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-6">
          <ScoreRing score={analysis.totalScore} size={112} label={analysis.label} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{analysis.label}</h2><Badge tone={scoreTone(analysis.totalScore) === "info" ? "info" : scoreTone(analysis.totalScore)}>{analysis.totalScore}/100</Badge></div>
            <p className="mt-1 text-sm text-muted">{analysis.explanation}</p>
            <p className="mt-2 text-xs text-muted">Evidence-based score from your verified profile and the job's stated requirements — not an ATS score and not a prediction of hiring outcome. Keyword coverage: {analysis.keywordCoverage}%.</p>
          </div>
        </div>
      </Card>

      {(analysis.incomplete || job.extractionConfidence < 0.5) && (
        <Banner tone="warn" title="This score may be incomplete">
          <ul className="list-disc pl-4">{[...analysis.incompleteReasons, ...(job.extractionConfidence < 0.5 ? ["Job details were extracted with low confidence — check the fields."] : [])].map((r, i) => <li key={i}>{r}</li>)}</ul>
        </Banner>
      )}

      <Card>
        <CardHeader title="Score breakdown" subtitle="Weighted sum of category scores. Categories with no data are excluded and weights re-normalized." />
        <div className="divide-y divide-line">
          {analysis.breakdown.map((b) => (
            <div key={b.key} className="grid gap-2 px-5 py-3 sm:grid-cols-[220px_1fr_90px] sm:items-center">
              <div><p className="text-sm font-medium">{b.label}</p><p className="text-xs text-muted">weight {b.weight}%</p></div>
              <div><Bar value={b.notApplicable ? 0 : b.score} tone={b.notApplicable ? "info" : undefined} /><p className="mt-1 text-xs text-muted">{b.explanation}</p></div>
              <div className="text-right text-sm font-semibold">{b.notApplicable ? <Badge>N/A</Badge> : <>{b.score}<span className="text-xs font-normal text-muted"> → +{b.weighted}</span></>}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Matched skills (${matched.length})`} />
          <div className="flex flex-wrap gap-2 p-5">{matched.length ? matched.map((m) => <SkillChip key={m.skill} m={m} />) : <p className="text-sm text-muted">None found.</p>}</div>
        </Card>
        <Card>
          <CardHeader title={`Not found in your resume (${missing.length})`} subtitle="“Not found” is not the same as “you lack it”. Add real experience to your profile if it was missed." />
          <div className="flex flex-wrap gap-2 p-5">{missing.length ? missing.map((m) => <span key={m.skill} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs"><span className="font-medium">{m.skill}</span><Badge tone={m.required ? "warn" : "neutral"}>{m.required ? "required" : "preferred"}</Badge></span>) : <p className="text-sm text-good">Nothing missing from the detected skills.</p>}</div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Evidence" subtitle={`${req.length} required · ${pref.length} preferred skills checked`} />
        <ul className="divide-y divide-line">
          {analysis.skillMatches.filter((m) => m.evidence).slice(0, 12).map((m) => (
            <li key={m.skill} className="flex gap-3 px-5 py-2.5 text-sm"><span className="w-28 shrink-0 font-medium">{m.skill}</span><span className="text-muted">{m.evidence}</span></li>
          ))}
          {analysis.skillMatches.every((m) => !m.evidence) && <li className="px-5 py-3 text-sm text-muted">No evidence snippets available.</li>}
        </ul>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Relevant projects & achievements" />
          <ul className="space-y-2 p-5 text-sm">{analysis.relevantProjects.length ? analysis.relevantProjects.map((p) => <li key={p.name}><span className="font-medium">{p.name}</span><span className="text-muted"> — {p.reason}</span></li>) : <li className="text-muted">None of your projects mention the key technologies.</li>}</ul>
        </Card>
        <Card>
          <CardHeader title="Potential experience gaps" />
          <ul className="list-disc space-y-1 p-5 pl-9 text-sm">{analysis.experienceGaps.length ? analysis.experienceGaps.map((g, i) => <li key={i}>{g}</li>) : <li className="list-none -ml-4 text-muted">No gaps detected from the stated requirements.</li>}</ul>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recommendations" subtitle="Deterministic suggestions from the comparison — they never add skills you haven't confirmed." />
        <ul className="list-disc space-y-1.5 p-5 pl-9 text-sm">{analysis.recommendations.length ? analysis.recommendations.map((r, i) => <li key={i}>{r}</li>) : <li className="list-none -ml-4 text-muted">No recommendations.</li>}</ul>
      </Card>
    </div>
  );
}
