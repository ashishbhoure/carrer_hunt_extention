import { useRef, useState } from "react";
import type { Resume } from "@careerpilot/shared";
import { Banner, Button } from "../../ui/kit";
import { importResume, ResumeFileError } from "../../services/resumes";

export function ResumeUploader({ onImported, compact }: { onImported: (r: Resume) => void; compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const handle = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(null);
    try { onImported(await importResume(file)); }
    catch (e) { setError(e instanceof ResumeFileError ? e.message : "Could not import this resume. Your data was not changed."); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files[0]); }}
        className={`flex flex-col items-center rounded-xl border-2 border-dashed px-6 ${compact ? "py-6" : "py-10"} text-center transition ${drag ? "border-primary bg-primary/5" : "border-line"}`}>
        <p className="text-sm font-medium">Drop your resume here, or</p>
        <Button className="mt-3" variant="primary" loading={busy} onClick={() => input.current?.click()}>{busy ? "Reading resume…" : "Choose PDF or DOCX"}</Button>
        <input ref={input} data-testid="resume-input" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" aria-label="Upload resume" onChange={(e) => void handle(e.target.files?.[0])} />
        <p className="mt-3 max-w-sm text-xs text-muted">Max 5 MB. The file is read in your browser and stored on this device — it is not uploaded anywhere.</p>
      </div>
      {error && <div className="mt-3"><Banner tone="bad" title="Upload failed">{error}</Banner></div>}
    </div>
  );
}
