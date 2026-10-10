import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CareerProfile, Resume } from "@careerpilot/shared";
import { Badge, Banner, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Overlay, PageHeader, SkeletonRows, Textarea, useToast } from "../../ui/kit";
import { useLive, fmtDate, errMsg } from "../../ui/hooks";
import { profileRepo, resumesRepo } from "../../storage/db";
import { deleteResume, downloadResumeFile, mergeIntoMaster, replaceResumeFile, setDefaultResume, updateResume } from "../../services/resumes";
import { ResumeUploader } from "../components/ResumeUploader";
import { ProfileEditor } from "../components/ProfileEditor";

export function Resumes() {
  const { data: resumes, loading } = useLive(() => resumesRepo.list(), []);
  const { data: master } = useLive(() => profileRepo.get(), []);
  const [edit, setEdit] = useState<Resume | null>(null);
  const [del, setDel] = useState<Resume | null>(null);
  const [meta, setMeta] = useState<Resume | null>(null);
  const [replaceFor, setReplaceFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const nav = useNavigate();

  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.push({ tone: "good", text: ok }); } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); } };

  return (
    <div>
      <PageHeader title="Resume library" subtitle="Each resume keeps its own parsed data. Your master profile is separate and is what scoring uses." />
      <Card className="mb-6 p-5"><ResumeUploader compact onImported={(r) => toast.push({ tone: "good", text: `Imported “${r.title}”.` })} /></Card>

      {loading ? <SkeletonRows /> : !resumes?.length ? <EmptyState title="No resumes yet" body="Upload a PDF or DOCX above to create your profile." icon="📄" /> : (
        <ul className="space-y-4">
          {resumes.map((r) => {
            const p = r.parsedProfile;
            return (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3 p-5">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{r.title}</h3>{r.isDefault && <Badge tone="accent">Default</Badge>}
                        <Badge tone={r.parsingStatus === "parsed" ? "good" : r.parsingStatus === "failed" ? "bad" : "warn"}>{r.parsingStatus === "parsed" ? "Parsed" : r.parsingStatus === "failed" ? "Parsing failed" : "Needs review"}</Badge></div>
                      <p className="mt-1 text-xs text-muted">{r.fileName} · {(r.size / 1024).toFixed(0)} KB · added {fmtDate(r.createdAt)}{r.description ? " · " + r.description : ""}</p>
                      <p className="mt-1 text-xs text-muted">Parsing confidence: <strong>{Math.round(r.parsingConfidence * 100)}%</strong></p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!r.isDefault && <Button size="sm" onClick={() => run(() => setDefaultResume(r.id), "Default resume updated.")}>Make default</Button>}
                      <Button size="sm" onClick={() => setEdit(r)}>Review parsed data</Button>
                      <Button size="sm" onClick={() => setMeta(r)}>Rename</Button>
                      <Button size="sm" onClick={() => run(() => downloadResumeFile(r.id), "Download started.")}>Download</Button>
                      <Button size="sm" onClick={() => { setReplaceFor(r.id); fileRef.current?.click(); }}>Replace file</Button>
                      <Button size="sm" variant="danger" onClick={() => setDel(r)}>Delete</Button>
                    </div>
                  </div>
                  {r.parsingFlags.filter((f) => f.confidence < 0.5).length > 0 && (
                    <div className="px-5 pb-3"><Banner tone="warn" title="Needs verification"><ul className="list-disc pl-4">{r.parsingFlags.filter((f) => f.confidence < 0.5).map((f, i) => <li key={i}>{f.message}</li>)}</ul></Banner></div>
                  )}
                  {p && (
                    <div className="border-t border-line px-5 py-3">
                      <p className="mb-1.5 text-xs font-medium text-muted">Skills overview ({p.skills.length})</p>
                      <div className="flex flex-wrap gap-1.5">{p.skills.slice(0, 18).map((s) => <Badge key={s.name}>{s.name}</Badge>)}{p.skills.length > 18 && <Badge tone="neutral">+{p.skills.length - 18}</Badge>}</div>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" onClick={() => run(async () => { if (master) await profileRepo.put(mergeIntoMaster(master, p)); else await profileRepo.put(p); }, "Merged into your master profile.")}>Merge into master profile</Button>
                        <Button size="sm" variant="ghost" onClick={() => nav("/profile")}>Open master profile</Button>
                      </div>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <input ref={fileRef} type="file" className="sr-only" aria-label="Replacement file" accept=".pdf,.docx" onChange={async (e) => {
        const f = e.target.files?.[0]; const id = replaceFor; e.target.value = "";
        if (f && id) await run(() => replaceResumeFile(id, f), "Resume file replaced and re-parsed.");
      }} />

      <Overlay open={!!edit} onClose={() => setEdit(null)} title={`Parsed data — ${edit?.title ?? ""}`} side width="max-w-3xl">
        {edit?.parsedProfile && <ProfileEditor profile={edit.parsedProfile} flags={edit.parsingFlags} saveLabel="Save corrections"
          onSave={async (p: CareerProfile) => { await updateResume(edit.id, { parsedProfile: p }); toast.push({ tone: "good", text: "Corrections saved to this resume." }); setEdit(null); }} />}
      </Overlay>

      <Overlay open={!!meta} onClose={() => setMeta(null)} title="Resume details" width="max-w-md">
        {meta && <MetaForm resume={meta} onSave={async (t, d) => { await run(() => updateResume(meta.id, { title: t, description: d }), "Saved."); setMeta(null); }} />}
      </Overlay>

      <ConfirmDialog open={!!del} danger title="Delete this resume?" confirmLabel="Delete" body={<>“{del?.title}” and its stored file will be removed from this device. Saved analyses keep their scores. This can't be undone.</>}
        onClose={() => setDel(null)} onConfirm={() => run(() => deleteResume(del!.id), "Resume deleted.")} />
    </div>
  );
}

function MetaForm({ resume, onSave }: { resume: Resume; onSave: (title: string, desc: string) => void }) {
  const [t, setT] = useState(resume.title); const [d, setD] = useState(resume.description);
  return (<div className="space-y-4"><Field label="Name" error={t.trim() ? undefined : "Name is required."}>{(id) => <Input id={id} value={t} onChange={(e) => setT(e.target.value)} />}</Field>
    <Field label="Description">{(id) => <Textarea id={id} value={d} onChange={(e) => setD(e.target.value)} />}</Field>
    <div className="flex justify-end"><Button variant="primary" disabled={!t.trim()} onClick={() => onSave(t.trim(), d)}>Save</Button></div></div>);
}
