import { useState } from "react";
import { DEFAULT_WEIGHTS, type Settings } from "@careerpilot/shared";
import { Badge, Banner, Button, Card, CardHeader, ConfirmDialog, Field, Input, PageHeader, Select, SkeletonRows, useToast } from "../../ui/kit";
import { errMsg, useSettings } from "../../ui/hooks";
import { deleteAllData, exportAllData, kv } from "../../storage/db";
import { exportJson } from "../../services/exporters";
import { isExtensionContext, send } from "../../messaging/client";
import { callAi } from "../../services/aiClient";

const PRESETS: Record<string, Partial<Settings["ai"]>> = {
  openai: { provider: "openai-compatible", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  anthropic: { provider: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5-20251001" },
  ollama: { provider: "openai-compatible", baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
};

export function SettingsPage() {
  const { settings, update } = useSettings();
  const toast = useToast();
  const [del, setDel] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ai, setAi] = useState<Settings["ai"] | null>(null);
  if (!settings) return <SkeletonRows />;
  const cur = ai ?? settings.ai;
  const w = settings.weights;
  const wTotal = w.requiredSkills + w.experience + w.roleAlignment + w.projects + w.preferred;
  const guard = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast.push({ tone: "good", text: ok }); } catch (e) { toast.push({ tone: "bad", text: errMsg(e) }); } };

  const saveAi = async () => {
    const next = { ...cur };
    if (next.enabled && !/^https?:\/\//.test(next.baseUrl)) throw new Error("The API base URL must start with https:// (or http://localhost for local models).");
    if (next.enabled) {
      const origin = `${new URL(next.baseUrl).origin}/*`;
      if (!(await chrome.permissions.request({ origins: [origin] }))) throw new Error("Chrome permission for that provider wasn't granted, so AI can't be used.");
    }
    await update({ ai: next });
    setAi(null);
  };

  const setNotifications = async (patch: Partial<Settings["notifications"]>) => {
    const next = { ...settings.notifications, ...patch };
    if (patch.enabled) {
      const ok = await chrome.permissions.request({ permissions: ["alarms", "notifications"] });
      if (!ok) throw new Error("Reminder permissions weren't granted.");
    }
    await update({ notifications: next });
    if (isExtensionContext()) await send({ type: "reminders/sync" });
  };

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Settings" />

      <Card><CardHeader title="Appearance" />
        <div className="p-5"><Field label="Theme">{(id) => <Select id={id} value={settings.theme} onChange={(e) => update({ theme: e.target.value as Settings["theme"] })}><option value="light">Light</option><option value="dark">Dark</option><option value="system">Match system</option></Select>}</Field></div></Card>

      <Card><CardHeader title="AI provider" subtitle="Optional. Scoring, parsing and tracking never need it." />
        <div className="space-y-4 p-5">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cur.enabled} onChange={(e) => setAi({ ...cur, enabled: e.target.checked })} />Enable AI features (tailoring, cover letters, coach)</label>
          <div className="flex flex-wrap gap-2 text-xs"><span className="text-muted">Presets:</span>{Object.keys(PRESETS).map((p) => <Button key={p} size="sm" onClick={() => setAi({ ...cur, ...PRESETS[p] } as Settings["ai"])}>{p}</Button>)}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Provider type">{(id) => <Select id={id} value={cur.provider} onChange={(e) => setAi({ ...cur, provider: e.target.value as Settings["ai"]["provider"] })}><option value="openai-compatible">OpenAI-compatible (OpenAI, OpenRouter, Ollama…)</option><option value="anthropic">Anthropic</option></Select>}</Field>
            <Field label="Model">{(id) => <Input id={id} value={cur.model} onChange={(e) => setAi({ ...cur, model: e.target.value })} />}</Field>
            <div className="sm:col-span-2"><Field label="API base URL">{(id) => <Input id={id} value={cur.baseUrl} onChange={(e) => setAi({ ...cur, baseUrl: e.target.value })} />}</Field></div>
            <div className="sm:col-span-2"><Field label="API key" hint="Stored only in this browser. Sent only to the base URL above, never to anyone else, and never included in exports.">{(id) => <Input id={id} type="password" autoComplete="off" value={cur.apiKey} onChange={(e) => setAi({ ...cur, apiKey: e.target.value })} />}</Field></div>
            <Field label="Daily request limit" hint="0 = unlimited">{(id) => <Input id={id} type="number" min={0} value={cur.dailyLimit} onChange={(e) => setAi({ ...cur, dailyLimit: Math.max(0, Number(e.target.value) || 0) })} />}</Field>
            <Field label="Timeout (seconds)">{(id) => <Input id={id} type="number" min={5} max={120} value={cur.timeoutMs / 1000} onChange={(e) => setAi({ ...cur, timeoutMs: Math.min(120, Math.max(5, Number(e.target.value) || 30)) * 1000 })} />}</Field>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" disabled={!ai} onClick={() => guard(saveAi, "AI settings saved.")}>Save AI settings</Button>
            <Button loading={testing} disabled={!settings.ai.enabled || !!ai} onClick={async () => { setTesting(true); await guard(async () => { const job = { id: "t", title: "Test", description: "React developer", contentHash: "t", requiredSkills: ["React"], preferredSkills: [] } as never; await callAi("analyzeJob", { profile: { skills: [], workExperience: [], projects: [], education: [], certifications: [], contact: {} } as never, job, analysis: { cacheKey: "test-" + Date.now(), skillMatches: [] } as never }); }, "Connection works."); setTesting(false); }}>Test connection</Button>
          </div>
          <Banner tone="info">When you press an AI button, the relevant parts of your profile and the job description are sent to the provider you configured above. Nothing is sent otherwise.</Banner>
        </div></Card>

      <Card><CardHeader title="Scoring weights" subtitle="Defaults are 35 / 25 / 20 / 10 / 10. Only the ratios matter." />
        <div className="grid gap-4 p-5 sm:grid-cols-5">
          {(Object.keys(DEFAULT_WEIGHTS) as Array<keyof typeof DEFAULT_WEIGHTS>).map((k) => <Field key={k} label={k.replace(/([A-Z])/g, " $1")}>{(id) => <Input id={id} type="number" min={0} max={100} value={w[k]} onChange={(e) => update({ weights: { ...w, [k]: Math.max(0, Number(e.target.value) || 0) } })} />}</Field>)}
          <div className="sm:col-span-5 flex items-center gap-3 text-sm"><Badge tone={wTotal === 100 ? "good" : "warn"}>Total {wTotal}</Badge>{wTotal !== 100 && <span className="text-muted">Weights are normalised automatically.</span>}<Button size="sm" onClick={() => update({ weights: DEFAULT_WEIGHTS })}>Reset</Button></div>
        </div></Card>

      <Card><CardHeader title="Reminders" subtitle="Local only, off by default. Requires Chrome's alarms & notifications permissions." />
        <div className="space-y-2 p-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={settings.notifications.enabled} onChange={(e) => guard(() => setNotifications({ enabled: e.target.checked }), e.target.checked ? "Reminders on." : "Reminders off.")} />Enable reminders</label>
          {settings.notifications.enabled && <label className="ml-6 flex items-center gap-2">Notify before interviews<select aria-label="Lead time" className="rounded border border-line bg-surface px-2 py-1" value={settings.notifications.leadMinutes} onChange={(e) => guard(() => setNotifications({ leadMinutes: Number(e.target.value) }), "Saved.")}>{[[0, "At the time"], [15, "15 minutes"], [30, "30 minutes"], [60, "1 hour"], [120, "2 hours"], [1440, "1 day"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
          {settings.notifications.enabled && (["followUps", "interviews", "savedJobsReview", "resumeReview"] as const).map((k) => (
            <label key={k} className="ml-6 flex items-center gap-2"><input type="checkbox" checked={settings.notifications[k]} onChange={(e) => guard(() => setNotifications({ [k]: e.target.checked }), "Saved.")} />{{ followUps: "Application follow-ups", interviews: "Upcoming interviews", savedJobsReview: "Weekly: saved jobs awaiting review", resumeReview: "Monthly: resume review" }[k]}</label>
          ))}
        </div></Card>

      <Card><CardHeader title="Privacy & data" />
        <div className="space-y-4 p-5 text-sm">
          <p>All data lives in this browser (IndexedDB). Nothing is uploaded unless you use an AI button or a job source you enabled.</p>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={settings.latexConsent} onChange={(e) => update({ latexConsent: e.target.checked })} /><span>Allow sending resume text to the online LaTeX compiler (texlive.net) when I export a LaTeX PDF. Off by default; you are asked at first use.</span></label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => guard(async () => exportJson(await exportAllData(), "careerpilot-export"), "Export downloaded (API key excluded; resume files not included).")}>Export my data (JSON)</Button>
            <Button variant="danger" onClick={() => setDel(true)}>Delete all data</Button>
            <Button onClick={() => guard(async () => { await chrome.permissions.remove({ origins: ["https://*/*", "http://localhost/*"] }).catch(() => false); await kv.set("grantedOrigins", []); }, "Optional site permissions revoked.")}>Revoke optional permissions</Button>
          </div>
        </div></Card>

      <ConfirmDialog open={del} danger title="Delete all CareerPilot data?" confirmLabel="Delete everything" body="This permanently removes resumes, profile, jobs, analyses, documents, applications and settings from this browser. Export first if you want a copy." onClose={() => setDel(false)} onConfirm={() => guard(deleteAllData, "All data deleted.")} />
    </div>
  );
}
