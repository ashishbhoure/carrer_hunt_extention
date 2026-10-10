import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { assembleFinalDocument, diffLines, letterToLatex, resumeToLatex, type DocumentSection, type TailoredDocument } from "@careerpilot/shared";
import { Badge, Banner, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, PageHeader, Select, SkeletonRows, Tabs, Textarea, useToast } from "../../ui/kit";
import { errMsg, fmtDate, useLive } from "../../ui/hooks";
import { applicationsRepo, documentsRepo, jobsRepo, resumesRepo } from "../../storage/db";
import { createCoverLetter, createTailoredResume, saveTailoredSections, updateDocumentContent } from "../../services/documents";
import { aiStatus } from "../../services/aiClient";
import { exportBlobAs, exportDocx, exportPdf, exportTex, exportTxt } from "../../services/exporters";
import { LatexError, compileLatexToPdf, grantLatexConsent, hasLatexConsent, requestLatexPermission } from "../../services/latexCompile";
import { patchApplication, resolveProfile } from "../../services/workflow";

export function Documents() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "cover" ? "cover" : "resume";
  const nav = useNavigate();
  const { data, loading } = useLive(async () => {
    const [job, docs, ai, resume] = await Promise.all([jobsRepo.get(id), documentsRepo.forJob(id), aiStatus(), resumesRepo.getDefault()]);
    return { job, docs, ai, resume };
  }, [id]);
  if (loading || !data) return <SkeletonRows />;
  if (!data.job) return <Banner tone="bad" title="Job not found" />;
  if (!data.resume) return <EmptyState title="Upload a resume first" action={<Button variant="primary" onClick={() => nav("/resumes")}>Upload</Button>} />;

  return (
    <div>
      <PageHeader title="Documents" subtitle={`${data.job.title || "Untitled role"} · ${data.job.company || "Unknown company"}`}
        actions={<><Tabs tabs={[{ id: "resume", label: "Tailored resume" }, { id: "cover", label: "Cover letter" }]} value={tab} onChange={(t) => setParams({ tab: t })} /><Button onClick={() => nav(`/jobs/${id}`)}>Back to analysis</Button></>} />
      {tab === "resume" ? <ResumeTab jobId={id} docs={data.docs.filter((d) => d.documentType === "resume")} aiOk={data.ai.configured} aiReason={data.ai.reason} /> : <CoverTab jobId={id} docs={data.docs.filter((d) => d.documentType === "cover_letter")} aiOk={data.ai.configured} aiReason={data.ai.reason} />}
    </div>
  );
}

async function linkToApplication(jobId: string, patch: { tailoredDocumentId?: string; coverLetterId?: string }) {
  const app = (await applicationsRepo.list()).find((a) => a.jobId === jobId);
  if (app) await patchApplication(app.id, patch);
}

function ResumeTab({ jobId, docs, aiOk, aiReason }: { jobId: string; docs: TailoredDocument[]; aiOk: boolean; aiReason?: string }) {
  const toast = useToast();
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState<"det" | "ai" | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [view, setView] = useState<"compare" | "preview">("compare");
  const doc = docs.find((d) => d.id === sel) ?? docs[0];
  const [sections, setSections] = useState<DocumentSection[]>([]);
  useEffect(() => { setSections(doc?.sections ?? []); }, [doc?.id]);

  const generate = async (useAi: boolean) => {
    setBusy(useAi ? "ai" : "det"); setNotices([]);
    try { const r = await createTailoredResume(jobId, { useAi }); setSel(r.doc.id); setNotices(r.notices); await linkToApplication(jobId, { tailoredDocumentId: r.doc.id }); toast.push({ tone: "good", text: `Version ${r.doc.version} created${r.doc.source === "ai" ? " with AI" : ""}.` }); }
    catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); } finally { setBusy(null); }
  };
  const decide = (sid: string, patch: Partial<DocumentSection>) => setSections((s) => s.map((x) => (x.id === sid ? { ...x, ...patch } : x)));
  const dirty = doc && JSON.stringify(sections) !== JSON.stringify(doc.sections);
  const save = async () => { try { await saveTailoredSections(doc!, sections); toast.push({ tone: "good", text: "Changes saved." }); } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); } };
  const finalText = doc ? (dirty ? assemblePreview(doc, sections) : doc.content) : "";
  const pending = sections.filter((s) => s.decision === "pending").length;

  const latex = useLatexExport();
  const buildTex = async () => { const profile = await resolveProfile(await resumesRepo.getDefault()); return resumeToLatex(profile, sections); };
  const exp = async (kind: "docx" | "pdf" | "txt" | "tex" | "latexpdf") => {
    const name = `resume-tailored-v${doc!.version}`;
    try {
      if (kind === "docx") await exportDocx(finalText, name);
      else if (kind === "pdf") await exportPdf(finalText, name);
      else if (kind === "tex") exportTex(await buildTex(), name);
      else if (kind === "latexpdf") { await latex.run(await buildTex(), name); return; }
      else exportTxt(finalText, name);
      toast.push({ tone: "good", text: "Export ready." });
    } catch (e) { toast.push({ tone: "bad", text: `Export failed: ${errMsg(e)}` }); }
  };

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <Button variant="primary" loading={busy === "det"} onClick={() => generate(false)}>Generate tailored version</Button>
        <Button loading={busy === "ai"} disabled={!aiOk} title={aiOk ? "" : aiReason} onClick={() => generate(true)}>Generate with AI</Button>
        {!aiOk && <span className="text-xs text-muted">{aiReason}</span>}
        {docs.length > 0 && <Select aria-label="Version" className="!ml-auto !w-auto" value={doc?.id} onChange={(e) => setSel(e.target.value)}>{docs.map((d) => <option key={d.id} value={d.id}>v{d.version} · {d.source === "ai" ? "AI" : "deterministic"} · {fmtDate(d.createdAt)}</option>)}</Select>}
      </Card>
      <Banner tone="info">Tailoring only reorders and re-emphasises what's already in your verified profile. Requested keywords your profile can't support are <strong>not</strong> added.</Banner>
      {notices.length > 0 && <Banner tone="warn" title="Notes"><ul className="list-disc pl-4">{notices.map((n, i) => <li key={i}>{n}</li>)}</ul></Banner>}

      {!doc ? <EmptyState title="No tailored version yet" body="Generate one to compare it with your original resume." /> : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs tabs={[{ id: "compare", label: "Compare" }, { id: "preview", label: "Preview" }]} value={view} onChange={setView} />
            <div className="flex flex-wrap gap-2">
              {dirty && <Button variant="primary" onClick={save}>Save changes</Button>}
              <Button variant="primary" loading={latex.busy} onClick={() => exp("latexpdf")}>Export PDF (LaTeX)</Button><Button onClick={() => exp("tex")}>Download .tex</Button><Button onClick={() => exp("docx")}>Export DOCX</Button><Button onClick={() => exp("pdf")}>Quick PDF</Button><Button onClick={() => exp("txt")}>TXT</Button>
            </div>
          </div>
          {latex.dialog}
          {pending > 0 && <p className="text-sm text-muted">{pending} section{pending > 1 ? "s" : ""} awaiting your decision.</p>}

          {view === "preview" ? <Card className="p-6"><pre className="whitespace-pre-wrap font-sans text-sm">{finalText}</pre></Card> : (
            <div className="space-y-4">{sections.map((s) => <SectionDiff key={s.id} s={s} onChange={(p) => decide(s.id, p)} />)}</div>
          )}
        </>
      )}
    </div>
  );
}

/** LaTeX → PDF with a one-time consent (the text is sent to texlive.net) and Chrome host permission. */
function useLatexExport() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<null | (() => Promise<void>)>(null);
  const compile = async (tex: string, name: string) => {
    setBusy(true);
    try { exportBlobAs(await compileLatexToPdf(tex), name, "pdf"); toast.push({ tone: "good", text: "PDF compiled with LaTeX." }); }
    catch (e) { toast.push({ tone: "bad", text: e instanceof LatexError ? e.message : errMsg(e) }); }
    finally { setBusy(false); }
  };
  return {
    busy,
    async run(tex: string, name: string) {
      if (!(await hasLatexConsent()) || !(await chrome.permissions.contains({ origins: ["https://texlive.net/*"] }))) { setAsk(() => async () => { await grantLatexConsent(true); if (!(await requestLatexPermission())) { toast.push({ tone: "bad", text: "Permission not granted. Use .tex or Quick PDF instead." }); return; } await compile(tex, name); }); return; }
      await compile(tex, name);
    },
    dialog: <ConfirmDialog open={!!ask} title="Compile with an online LaTeX service?" confirmLabel="Allow and compile" body={<>To compile LaTeX, your resume text is sent to <strong>texlive.net</strong>, a public compiler. Don&apos;t use this if your resume is sensitive. You can always download the <code>.tex</code> file and compile it locally (MiKTeX, Overleaf) instead. You can withdraw consent in Settings.</>} onClose={() => setAsk(null)} onConfirm={async () => { await ask?.(); }} />,
  };
}

function assemblePreview(doc: TailoredDocument, sections: DocumentSection[]) {
  const first = doc.content.split("\n\n")[0] ?? "";
  const body = sections.filter((s) => (s.decision === "rejected" ? s.original : s.proposed).trim()).map((s) => `${s.heading.toUpperCase()}\n${s.decision === "rejected" ? s.original : s.proposed}`).join("\n\n");
  return `${first}\n\n${body}`.trim();
}

function SectionDiff({ s, onChange }: { s: DocumentSection; onChange: (p: Partial<DocumentSection>) => void }) {
  const [editing, setEditing] = useState(false);
  const changed = s.original !== s.proposed;
  const diff = diffLines(s.original, s.proposed);
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{s.heading}{changed ? <Badge tone="accent">Changed</Badge> : <Badge>Unchanged</Badge>}{s.decision !== "pending" && <Badge tone={s.decision === "rejected" ? "bad" : "good"}>{s.decision}</Badge>}</span>}
        action={changed && <div className="flex gap-2"><Button size="sm" onClick={() => onChange({ decision: "accepted" })}>Accept</Button><Button size="sm" onClick={() => onChange({ decision: "rejected" })}>Reject</Button><Button size="sm" onClick={() => setEditing((e) => !e)}>{editing ? "Done" : "Edit"}</Button></div>} />
      {s.warnings.length > 0 && <div className="px-5 pt-4"><Banner tone="warn" title="Truthfulness check"><ul className="list-disc pl-4">{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Banner></div>}
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <div><p className="mb-1 text-xs font-medium text-muted">Original</p><pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-sans text-sm">{s.original || "—"}</pre></div>
        <div><p className="mb-1 text-xs font-medium text-muted">Tailored</p>
          {editing ? <Textarea aria-label={`Edit ${s.heading}`} rows={8} value={s.proposed} onChange={(e) => onChange({ proposed: e.target.value, decision: "edited" })} /> : (
            <div className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-sm">{changed ? diff.filter((d) => d.kind !== "removed").map((d, i) => <div key={i} className={d.kind === "added" ? "rounded bg-good/15 px-1" : ""}>{d.text || " "}</div>) : s.proposed || "—"}</div>
          )}
        </div>
      </div>
    </Card>
  );
}

function CoverTab({ jobId, docs, aiOk, aiReason }: { jobId: string; docs: TailoredDocument[]; aiOk: boolean; aiReason?: string }) {
  const toast = useToast();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"det" | "ai" | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const doc = docs.find((d) => d.id === sel) ?? docs[0];
  const [text, setText] = useState(doc?.content ?? "");
  useEffect(() => { setText(doc?.content ?? ""); }, [doc?.id, doc?.content]);

  const gen = async (useAi: boolean) => {
    setBusy(useAi ? "ai" : "det"); setNotices([]);
    try { const r = await createCoverLetter(jobId, { notes, useAi }); setSel(r.doc.id); setNotices(r.notices); await linkToApplication(jobId, { coverLetterId: r.doc.id }); }
    catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); } finally { setBusy(null); }
  };
  const name = `cover-letter-v${doc?.version ?? 1}`;
  const latex = useLatexExport();
  const guard = async (fn: () => Promise<void> | void, ok: string) => { try { await fn(); toast.push({ tone: "good", text: ok }); } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); } };

  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-4">
        <Field label="Your motivation or notes (optional)" hint="Only what you write here is added — nothing is invented about the company.">{(id) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <div className="flex flex-wrap items-center gap-3"><Button variant="primary" loading={busy === "det"} onClick={() => gen(false)}>Generate from template</Button><Button loading={busy === "ai"} disabled={!aiOk} onClick={() => gen(true)}>Generate with AI</Button>{!aiOk && <span className="text-xs text-muted">{aiReason}</span>}</div>
      </Card>
      {notices.length > 0 && <Banner tone="warn" title="Please check"><ul className="list-disc pl-4">{notices.map((n, i) => <li key={i}>{n}</li>)}</ul></Banner>}
      {!doc ? <EmptyState title="No cover letter yet" /> : (
        <Card>
          <CardHeader title={<>Cover letter v{doc.version} <Badge tone={doc.source === "ai" ? "accent" : "neutral"}>{doc.source === "ai" ? "AI-generated" : "Template"}</Badge></>}
            action={docs.length > 1 && <Select aria-label="Version" className="!w-auto" value={doc.id} onChange={(e) => setSel(e.target.value)}>{docs.map((d) => <option key={d.id} value={d.id}>v{d.version}</option>)}</Select>} />
          <div className="space-y-3 p-5">
            <Textarea aria-label="Cover letter" rows={16} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={text === doc.content} onClick={() => guard(async () => { await updateDocumentContent(doc, text); }, "Saved to this job.")}>Save</Button>
              <Button onClick={() => guard(() => navigator.clipboard.writeText(text), "Copied.")}>Copy</Button>
              <Button onClick={() => guard(() => exportTxt(text, name), "Downloaded.")}>TXT</Button>
              <Button onClick={() => guard(() => exportDocx(text, name), "Downloaded.")}>DOCX</Button>
              <Button variant="primary" loading={latex.busy} onClick={() => latex.run(letterToLatex(text), name)}>PDF (LaTeX)</Button>
              <Button onClick={() => guard(() => exportTex(letterToLatex(text), name), "Downloaded.")}>.tex</Button>
              <Button onClick={() => guard(() => exportPdf(text, name), "Downloaded.")}>Quick PDF</Button>
              {latex.dialog}
            </div>
            <p className="text-xs text-muted">Review and edit before sending. CareerPilot never sends anything for you.</p>
          </div>
        </Card>
      )}
    </div>
  );
}

void resolveProfile;
