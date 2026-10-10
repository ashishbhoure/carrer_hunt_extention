import { useMemo, useState } from "react";
import { analyzeJob, buildJob, type ExtractListResult, type Job, type JobAnalysis, type ListCard } from "@careerpilot/shared";
import { Badge, Banner, Button, Skeleton, useToast } from "../ui/kit";
import { errMsg } from "../ui/hooks";
import { profileRepo, resumesRepo, settingsRepo } from "../storage/db";
import { createApplication, recordDiscoveredJob, saveJob } from "../services/workflow";
import { MessageError, send } from "../messaging/client";

interface Row { card: ListCard; job: Job; analysis: JobAnalysis }

/** Turn a result-card summary into a job. Cards only carry a few facts, so scores are marked partial. */
export function cardToJob(card: ListCard, provider: string, tabUrl: string): Job {
  const description = [
    card.title, card.company && `Company: ${card.company}`, card.location && `Location: ${card.location}`,
    card.experience && `Experience: ${card.experience}`, card.salary && `Salary: ${card.salary}`,
    card.skills.length ? ["Requirements", ...card.skills.map((s) => `- ${s}`)].join("\n") : "", card.snippet,
  ].filter(Boolean).join("\n");
  return buildJob({ title: card.title, company: card.company, location: card.location, description, url: card.url || tabUrl, provider, salaryRange: card.salary, extractorConfidence: 0.45, extractorNotes: ["Scored from the search-result card only."] });
}

export async function scoreCards(r: ExtractListResult, resumeId: string): Promise<Row[]> {
  const [resume, master, settings] = [await resumesRepo.get(resumeId), await profileRepo.get(), await settingsRepo.get()];
  const profile = master ?? resume?.parsedProfile;
  if (!resume || !profile) throw new Error("Upload a resume first.");
  return r.cards.map((card) => {
    const job = cardToJob(card, r.provider, r.tabUrl);
    return { card, job, analysis: analyzeJob({ job, profile, resumeId: resume.id, resumeText: resume.extractedText, weights: settings.weights }) };
  }).sort((a, b) => b.analysis.totalScore - a.analysis.totalScore);
}

export function ScanList({ tabId, isWeb, resumeId, onBack }: { tabId?: number; isWeb: boolean; resumeId: string; onBack: () => void; tabUrl?: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsOrigin, setNeedsOrigin] = useState<string | null>(null);
  const [min, setMin] = useState(55);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
  const shown = useMemo(() => (rows ?? []).filter((r) => r.analysis.totalScore >= min), [rows, min]);

  const scan = async () => {
    setBusy(true); setError(null); setRows(null); setNeedsOrigin(null);
    try {
      const r = await send<ExtractListResult>({ type: "page/extractList", tabId });
      if (r.needsPermission) { setNeedsOrigin(r.origin ?? null); setError(r.message ?? null); return; }
      if (r.status !== "ok") { setError(r.message ?? "No jobs found on this page."); return; }
      setTotal(r.cards.length);
      setRows(await scoreCards(r, resumeId));
    } catch (e) { setError(e instanceof MessageError ? e.message : errMsg(e)); } finally { setBusy(false); }
  };

  const grant = async () => {
    if (!needsOrigin || !(await chrome.permissions.request({ origins: [needsOrigin] }))) { setError("Permission not granted."); return; }
    await scan();
  };

  const save = async (row: Row) => {
    try {
      const stored = await recordDiscoveredJob(row.job);
      const r = await saveJob(stored);
      await createApplication(r.job, { analysis: row.analysis });
      setSaved((s) => new Set(s).add(row.job.id));
    } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); }
  };

  return (
    <div className="space-y-3">
      <Banner tone="info">Scans the job cards already shown on this page (nothing is clicked or fetched). Scores come from each card's summary, so open a job for the full analysis.</Banner>
      {!rows && !busy && <Button className="w-full" variant="primary" disabled={!isWeb} onClick={scan}>Scan this page's jobs</Button>}
      {needsOrigin && <Button className="w-full" variant="primary" onClick={grant}>Allow on this site</Button>}
      {error && <Banner tone="warn">{error}</Banner>}
      {busy && <div role="status" aria-label="Scanning" className="space-y-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>}

      {rows && (
        <>
          <div className="flex items-center justify-between text-xs"><span><strong>{shown.length}</strong> of {total} jobs match ≥ {min}</span>
            <label className="flex items-center gap-2 text-muted">Min score<input aria-label="Minimum score" type="range" min={0} max={100} step={5} value={min} onChange={(e) => setMin(Number(e.target.value))} /></label></div>
          {shown.length === 0 && <p className="text-sm text-muted">No jobs reach this score. Lower the minimum to see more.</p>}
          <ul className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
            {shown.map((r) => {
              const matched = r.analysis.skillMatches.filter((m) => m.status.startsWith("matched")).slice(0, 3).map((m) => m.skill);
              const gap = r.analysis.skillMatches.find((m) => m.required && m.status === "not_found")?.skill;
              return (
                <li key={r.job.id} className="rounded-lg border border-line bg-surface p-2.5 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><p className="truncate font-medium" title={r.card.title}>{r.card.title}</p><p className="truncate text-xs text-muted">{[r.card.company, r.card.location, r.card.experience].filter(Boolean).join(" · ")}</p></div>
                    <Badge tone={r.analysis.totalScore >= 70 ? "good" : r.analysis.totalScore >= 55 ? "warn" : "neutral"}>{r.analysis.totalScore}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">{matched.length ? <>Matches: {matched.join(", ")}. </> : null}{gap ? <>Not found in resume: {gap}.</> : null}{!matched.length && !gap ? "Too little detail on the card to compare." : null}</p>
                  <div className="mt-1.5 flex gap-2">
                    <Button size="sm" disabled={saved.has(r.job.id)} onClick={() => save(r)}>{saved.has(r.job.id) ? "Saved" : "Save"}</Button>
                    {r.card.url && <a className="inline-flex items-center rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-surface-2" href={r.card.url} target="_blank" rel="noopener noreferrer">Open ↗</a>}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-between"><Button size="sm" onClick={scan}>Rescan</Button><Button size="sm" variant="primary" disabled={!shown.length} onClick={async () => { for (const r of shown) if (!saved.has(r.job.id)) await save(r); toast.push({ tone: "good", text: "Saved all shown jobs." }); }}>Save all shown</Button></div>
        </>
      )}
      <Button size="sm" variant="ghost" onClick={onBack}>← Back</Button>
    </div>
  );
}
