import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CareerProfile, Resume } from "@careerpilot/shared";
import { Badge, Banner, Button, Card, Logo, useToast } from "../../ui/kit";
import { ResumeUploader } from "../components/ResumeUploader";
import { ProfileEditor } from "../components/ProfileEditor";
import { profileRepo, resumesRepo, settingsRepo } from "../../storage/db";
import { useLive, useSettings } from "../../ui/hooks";

const STEPS = ["Welcome", "Resume", "Profile", "Privacy & AI", "Done"] as const;

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [resume, setResume] = useState<Resume | null>(null);
  const nav = useNavigate();
  const toast = useToast();
  const { settings, update } = useSettings();
  const { data: master } = useLive(() => profileRepo.get(), [step]);
  const { data: existing } = useLive(() => resumesRepo.list(), []);
  const activeResume = resume ?? existing?.[0] ?? null;

  // `fromOnboarding` stops the App guard from bouncing back before the settings change has propagated.
  const finish = async () => { await settingsRepo.update({ onboardingComplete: true }); nav("/", { state: { fromOnboarding: true } }); };

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <div className="mb-8 flex items-center justify-between"><Logo /><Button variant="ghost" size="sm" onClick={finish}>Skip setup</Button></div>
      <ol className="mb-8 flex gap-2" aria-label="Progress">
        {STEPS.map((s, i) => <li key={s} aria-current={i === step ? "step" : undefined} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-primary" : "bg-line"}`} title={s} />)}
      </ol>

      {step === 0 && (
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Your personal job-search copilot</h1>
          <p className="mt-3 text-muted">Upload your resume once. CareerPilot builds a profile you verify, then helps you judge jobs honestly, tailor documents truthfully and track every application.</p>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2">
            {[["Honest matching", "A transparent score — not a guess from an AI."], ["Never invents", "No made-up skills, metrics or experience."], ["You stay in control", "Autofill needs your review; nothing is ever submitted for you."], ["Private by default", "Everything is stored on this device. AI is optional."]].map(([t, b]) => (
              <li key={t}><Card className="h-full p-4"><p className="font-medium">{t}</p><p className="mt-1 text-sm text-muted">{b}</p></Card></li>
            ))}
          </ul>
          <Button className="mt-8" variant="primary" onClick={() => setStep(1)}>Get started</Button>
        </div>
      )}

      {step === 1 && (
        <div>
          <h1 className="text-2xl font-semibold">Upload your resume</h1>
          <p className="mb-5 mt-2 text-sm text-muted">PDF or DOCX. It is parsed on your device; you'll review everything next.</p>
          {activeResume ? (
            <Card className="flex items-center justify-between p-4">
              <div><p className="font-medium">{activeResume.title}</p><p className="text-xs text-muted">Parsing confidence {Math.round(activeResume.parsingConfidence * 100)}% · <Badge tone={activeResume.parsingStatus === "parsed" ? "good" : "warn"}>{activeResume.parsingStatus === "parsed" ? "Parsed" : "Needs review"}</Badge></p></div>
              <Badge tone="info">Add more resumes later in the Resume library</Badge>
            </Card>
          ) : null}
          {!activeResume && <ResumeUploader onImported={(r) => { setResume(r); toast.push({ tone: "good", text: "Resume imported." }); }} />}
          <div className="mt-6 flex justify-between"><Button onClick={() => setStep(0)}>Back</Button><Button variant="primary" disabled={!activeResume} onClick={() => setStep(2)}>Review profile</Button></div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h1 className="text-2xl font-semibold">Review your profile</h1>
          <p className="mb-5 mt-2 text-sm text-muted">Correct anything the parser got wrong and confirm your skill levels. You can change all of this later.</p>
          {master && activeResume ? (
            <ProfileEditor profile={master} flags={activeResume.parsingFlags} saveLabel="Save & continue" onSave={async (p: CareerProfile) => { await profileRepo.put(p); toast.push({ tone: "good", text: "Profile saved." }); setStep(3); }} />
          ) : <Banner tone="warn" title="No profile yet">Go back and upload a resume.</Banner>}
        </div>
      )}

      {step === 3 && settings && (
        <div>
          <h1 className="text-2xl font-semibold">Privacy & AI</h1>
          <Card className="mt-5 space-y-4 p-5 text-sm">
            <p><strong>Storage:</strong> your resume, profile, jobs and applications are stored in this browser only. Nothing is sent to a server.</p>
            <p><strong>AI (optional):</strong> the built-in scoring works with no AI. If you later enable an AI provider in Settings, only the text needed for that request is sent to the provider <em>you</em> choose, and only after you press a button.</p>
            <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={settings.ai.enabled} onChange={(e) => update({ ai: { ...settings.ai, enabled: e.target.checked } })} /><span>I plan to use an AI provider (configure the key in Settings).</span></label>
          </Card>
          <div className="mt-6 flex justify-between"><Button onClick={() => setStep(2)}>Back</Button><Button variant="primary" onClick={() => setStep(4)}>Continue</Button></div>
        </div>
      )}

      {step === 4 && (
        <div className="text-center">
          <div className="text-5xl" aria-hidden>✅</div>
          <h1 className="mt-4 text-2xl font-semibold">You're all set</h1>
          <p className="mt-2 text-muted">Open any job posting, click the CareerPilot icon and choose “Analyze this job” — or paste a description in the dashboard.</p>
          <Button className="mt-6" variant="primary" onClick={finish}>Open dashboard</Button>
        </div>
      )}
    </div>
  );
}
