import { useState } from "react";
import type { Job } from "@careerpilot/shared";
import { Banner, Button, Field, Input, Textarea } from "../../ui/kit";
import { jobFromInput, recordDiscoveredJob, analyze, UserFacingError } from "../../services/workflow";
import { errMsg } from "../../ui/hooks";
import { resumesRepo } from "../../storage/db";

/** Manual / pasted job entry: the always-available fallback to site extraction. */
export function JobIntake({ onDone, initial }: { onDone: (job: Job) => void; initial?: Partial<{ title: string; company: string; location: string; url: string; description: string }> }) {
  const [f, setF] = useState({ title: "", company: "", location: "", url: "", description: "", ...initial });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const submit = async () => {
    setError(null);
    if (f.description.trim().length < 40) { setError("Paste the full job description (at least a few sentences)."); return; }
    if (f.url.trim() && !/^https?:\/\//i.test(f.url.trim())) { setError("The job URL must start with http:// or https://"); return; }
    setBusy(true);
    try {
      if (!(await resumesRepo.getDefault())) throw new UserFacingError("Upload a resume first so the job can be scored against it.");
      const job = await recordDiscoveredJob(jobFromInput({ ...f, url: f.url.trim() || undefined }));
      await analyze(job.id);
      onDone(job);
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {error && <Banner tone="bad" title="Can't analyse yet">{error}</Banner>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title">{(id) => <Input id={id} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="MERN Stack Developer" />}</Field>
        <Field label="Company">{(id) => <Input id={id} value={f.company} onChange={(e) => set("company", e.target.value)} />}</Field>
        <Field label="Location">{(id) => <Input id={id} value={f.location} onChange={(e) => set("location", e.target.value)} />}</Field>
        <Field label="Job URL (optional)" hint="Used for de-duplication and the “Open original” link.">{(id) => <Input id={id} value={f.url} onChange={(e) => set("url", e.target.value)} placeholder="https://…" />}</Field>
      </div>
      <Field label="Job description">{(id) => <Textarea id={id} rows={10} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="Paste the full job description here…" />}</Field>
      <div className="flex justify-end"><Button variant="primary" loading={busy} onClick={submit}>Analyze job</Button></div>
    </div>
  );
}
