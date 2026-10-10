import type { Job, JobAnalysis } from "@careerpilot/shared";
import { Badge, Button, Card, scoreTone } from "../../ui/kit";

export function JobCard({ job, analysis, saved, attribution, onSave, onAnalyze, onOpen, busy }: {
  job: Job; analysis?: JobAnalysis; saved?: boolean; attribution?: { label: string; url: string };
  onSave: () => void; onAnalyze: () => void; onOpen?: () => void; busy?: boolean;
}) {
  const strong = analysis?.skillMatches.filter((m) => m.status === "matched_verified").slice(0, 3).map((m) => m.skill) ?? [];
  const gap = analysis?.skillMatches.find((m) => m.required && m.status === "not_found")?.skill;
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold" title={job.title}>{job.title || "Untitled role"}</h3>
          <p className="truncate text-sm text-muted">{job.company || "Unknown company"}{job.location ? ` · ${job.location}` : ""}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="neutral">{job.provider}</Badge>
            {job.workMode !== "unknown" && <Badge tone="accent">{job.workMode}</Badge>}
            {job.employmentType && <Badge>{job.employmentType}</Badge>}
            {job.salaryRange && <Badge tone="good">{job.salaryRange}</Badge>}
            {saved && <Badge tone="info">Saved</Badge>}
          </div>
        </div>
        <div className="shrink-0 text-right">
          {analysis ? <><p className={`text-2xl font-semibold ${{ good: "text-good", info: "text-primary", warn: "text-warn", bad: "text-bad" }[scoreTone(analysis.totalScore)]}`} aria-label={`Match score ${analysis.totalScore}`}>{analysis.totalScore}</p><p className="text-[11px] text-muted">{analysis.label}</p></> : <p className="text-xs text-muted">Not analysed</p>}
        </div>
      </div>
      {analysis && (
        <p className="mt-3 text-xs text-muted">
          {strong.length > 0 && <>Strongest: <strong className="text-ink">{strong.join(", ")}</strong>. </>}
          {gap && <>Main gap (not found in resume): <strong className="text-ink">{gap}</strong>.</>}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" loading={busy} onClick={onAnalyze}>{analysis ? "View analysis" : "Analyze"}</Button>
        <Button size="sm" onClick={onSave} disabled={saved}>{saved ? "Saved" : "Save"}</Button>
        {job.originalUrl && <a className="text-sm text-primary underline-offset-2 hover:underline" href={job.originalUrl} target="_blank" rel="noopener noreferrer" onClick={onOpen}>Open original job ↗</a>}
        {attribution && <a className="ml-auto text-xs text-muted hover:underline" href={attribution.url} target="_blank" rel="noopener noreferrer">{attribution.label}</a>}
      </div>
    </Card>
  );
}
