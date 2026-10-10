import { useState } from "react";
import { uid, nowIso, SKILL_LEVELS, WORK_MODES, canonicalSkill, careerProfileSchema, type CareerProfile, type ParsedFieldFlag, type SkillLevel } from "@careerpilot/shared";
import { Badge, Banner, Button, Card, CardHeader, Field, Input, Select, Textarea } from "../../ui/kit";

const LEVEL_LABEL: Record<SkillLevel, string> = { experienced: "Experienced", working: "Working knowledge", learning: "Learning", not_applicable: "Not applicable" };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

export function ProfileEditor({ profile, flags = [], onSave, saveLabel = "Save profile" }: { profile: CareerProfile; flags?: ParsedFieldFlag[]; onSave: (p: CareerProfile) => Promise<void> | void; saveLabel?: string }) {
  const [p, setP] = useState<CareerProfile>(profile);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const flag = (field: string) => flags.find((f) => f.field === field && f.confidence < 0.5)?.message ? "Needs verification" : undefined;
  const set = (patch: Partial<CareerProfile>) => setP((x) => ({ ...x, ...patch }));
  const setContact = (patch: Partial<CareerProfile["contact"]>) => setP((x) => ({ ...x, contact: { ...x.contact, ...patch } }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (p.contact.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.contact.email)) e.email = "Enter a valid email address.";
    if (p.yearsOfExperience !== null && (p.yearsOfExperience < 0 || p.yearsOfExperience > 60)) e.years = "Enter years between 0 and 60.";
    const { minimum, target } = p.salaryPreferences;
    if (minimum !== null && target !== null && target < minimum) e.salary = "Target salary can't be lower than the minimum.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const parsed = careerProfileSchema.parse({ ...p, updatedAt: nowIso() });
      await onSave(parsed);
    } finally { setSaving(false); }
  };

  const addSkill = () => {
    const name = canonicalSkill(newSkill);
    if (!name || p.skills.some((s) => canonicalSkill(s.name) === name)) { setNewSkill(""); return; }
    set({ skills: [...p.skills, { name, level: "working", verified: true, primary: false }] });
    setNewSkill("");
  };

  return (
    <div className="space-y-5">
      {flags.filter((f) => f.confidence < 0.5).length > 0 && (
        <Banner tone="warn" title="Please verify these items">
          <ul className="list-disc pl-4">{flags.filter((f) => f.confidence < 0.5).map((f, i) => <li key={i}>{f.message}</li>)}</ul>
        </Banner>
      )}

      <Card>
        <CardHeader title="Contact" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Full name" flag={flag("contact.fullName")}>{(id) => <Input id={id} value={p.contact.fullName} onChange={(e) => setContact({ fullName: e.target.value })} />}</Field>
          <Field label="Email" error={errors.email} flag={flag("contact.email")}>{(id) => <Input id={id} type="email" value={p.contact.email} onChange={(e) => setContact({ email: e.target.value })} />}</Field>
          <Field label="Phone" flag={flag("contact.phone")}>{(id) => <Input id={id} value={p.contact.phone} onChange={(e) => setContact({ phone: e.target.value })} />}</Field>
          <Field label="Location">{(id) => <Input id={id} value={p.contact.location} onChange={(e) => setContact({ location: e.target.value })} />}</Field>
          <div className="sm:col-span-2"><Field label="Links (comma-separated)" hint="Portfolio, GitHub, LinkedIn…">{(id) => <Input id={id} value={p.contact.links.join(", ")} onChange={(e) => setContact({ links: csv(e.target.value) })} />}</Field></div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Professional summary" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Current role">{(id) => <Input id={id} value={p.currentRole} onChange={(e) => set({ currentRole: e.target.value })} />}</Field>
          <Field label="Years of experience" error={errors.years}>{(id) => <Input id={id} type="number" min={0} step={0.5} value={p.yearsOfExperience ?? ""} onChange={(e) => set({ yearsOfExperience: e.target.value === "" ? null : Number(e.target.value) })} />}</Field>
          <div className="sm:col-span-2"><Field label="Summary" flag={flag("summary")}>{(id) => <Textarea id={id} value={p.summary} onChange={(e) => set({ summary: e.target.value })} />}</Field></div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Skills" subtitle="Detected skills start as “Working knowledge”. CareerPilot never upgrades a level for you." />
        <div className="p-5">
          <div className="mb-4 flex gap-2">
            <Input aria-label="Add a skill" placeholder="Add a skill, e.g. Node.js" value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill())} />
            <Button onClick={addSkill}>Add</Button>
          </div>
          {p.skills.length === 0 && <p className="text-sm text-muted">No skills yet.</p>}
          <ul className="grid gap-2 sm:grid-cols-2">
            {p.skills.map((s, i) => (
              <li key={s.name} className="flex items-center gap-2 rounded-lg border border-line p-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={s.name}>{s.name}</span>
                {!s.verified && <Badge tone="warn">Unverified</Badge>}
                <Select aria-label={`${s.name} level`} className="!w-auto !py-1 text-xs" value={s.level} onChange={(e) => set({ skills: p.skills.map((x, j) => (j === i ? { ...x, level: e.target.value as SkillLevel, verified: true } : x)) })}>
                  {SKILL_LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                </Select>
                <Button size="sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => set({ skills: p.skills.filter((_, j) => j !== i) })}>✕</Button>
              </li>
            ))}
          </ul>
          {p.skills.some((s) => !s.verified) && <Button className="mt-3" size="sm" onClick={() => set({ skills: p.skills.map((s) => ({ ...s, verified: true })) })}>Confirm all current levels</Button>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Work experience" action={<Button size="sm" onClick={() => set({ workExperience: [...p.workExperience, { id: uid(), title: "", company: "", start: "", end: "", current: false, bullets: [], verified: false }] })}>Add role</Button>} />
        <div className="space-y-4 p-5">
          {p.workExperience.length === 0 && <p className="text-sm text-muted">No experience entries.</p>}
          {p.workExperience.map((w, i) => {
            const upd = (patch: Partial<typeof w>) => set({ workExperience: p.workExperience.map((x, j) => (j === i ? { ...x, ...patch, verified: true } : x)) });
            return (
              <div key={w.id} className="rounded-lg border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Title">{(id) => <Input id={id} value={w.title} onChange={(e) => upd({ title: e.target.value })} />}</Field>
                  <Field label="Company">{(id) => <Input id={id} value={w.company} onChange={(e) => upd({ company: e.target.value })} />}</Field>
                  <Field label="Start" hint="e.g. Jan 2021">{(id) => <Input id={id} value={w.start} onChange={(e) => upd({ start: e.target.value })} />}</Field>
                  <Field label="End" hint="or Present">{(id) => <Input id={id} value={w.end} onChange={(e) => upd({ end: e.target.value, current: /present|current/i.test(e.target.value) })} />}</Field>
                  <div className="sm:col-span-2"><Field label="Achievements (one per line)">{(id) => <Textarea id={id} value={w.bullets.join("\n")} onChange={(e) => upd({ bullets: e.target.value.split("\n").filter((l) => l.trim()) })} />}</Field></div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  {!w.verified && <Badge tone="warn">Unverified</Badge>}<span />
                  <Button size="sm" variant="danger" onClick={() => set({ workExperience: p.workExperience.filter((_, j) => j !== i) })}>Remove</Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Projects" action={<Button size="sm" onClick={() => set({ projects: [...p.projects, { id: uid(), name: "", description: "", technologies: [], bullets: [], link: "", verified: false }] })}>Add project</Button>} />
        <div className="space-y-4 p-5">
          {p.projects.length === 0 && <p className="text-sm text-muted">No projects.</p>}
          {p.projects.map((x, i) => {
            const upd = (patch: Partial<typeof x>) => set({ projects: p.projects.map((y, j) => (j === i ? { ...y, ...patch, verified: true } : y)) });
            return (
              <div key={x.id} className="rounded-lg border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name">{(id) => <Input id={id} value={x.name} onChange={(e) => upd({ name: e.target.value })} />}</Field>
                  <Field label="Technologies (comma-separated)">{(id) => <Input id={id} value={x.technologies.join(", ")} onChange={(e) => upd({ technologies: csv(e.target.value) })} />}</Field>
                  <div className="sm:col-span-2"><Field label="Description">{(id) => <Textarea id={id} value={x.description} onChange={(e) => upd({ description: e.target.value })} />}</Field></div>
                </div>
                <div className="mt-2 text-right"><Button size="sm" variant="danger" onClick={() => set({ projects: p.projects.filter((_, j) => j !== i) })}>Remove</Button></div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title="Education & certifications" action={<Button size="sm" onClick={() => set({ education: [...p.education, { id: uid(), degree: "", institution: "", year: "", verified: false }] })}>Add education</Button>} />
        <div className="space-y-3 p-5">
          {p.education.map((e, i) => {
            const upd = (patch: Partial<typeof e>) => set({ education: p.education.map((x, j) => (j === i ? { ...x, ...patch, verified: true } : x)) });
            return (
              <div key={e.id} className="grid items-end gap-3 sm:grid-cols-[2fr_2fr_1fr_auto]">
                <Field label="Degree">{(id) => <Input id={id} value={e.degree} onChange={(ev) => upd({ degree: ev.target.value })} />}</Field>
                <Field label="Institution">{(id) => <Input id={id} value={e.institution} onChange={(ev) => upd({ institution: ev.target.value })} />}</Field>
                <Field label="Year">{(id) => <Input id={id} value={e.year} onChange={(ev) => upd({ year: ev.target.value })} />}</Field>
                <Button size="sm" variant="danger" aria-label="Remove education" onClick={() => set({ education: p.education.filter((_, j) => j !== i) })}>✕</Button>
              </div>
            );
          })}
          <Field label="Certifications (one per line)">{(id) => <Textarea id={id} value={p.certifications.join("\n")} onChange={(e) => set({ certifications: e.target.value.split("\n").filter((l) => l.trim()) })} />}</Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Job preferences" subtitle="Used for matching and autofill only. Nothing here is inferred." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Target job titles (comma-separated)">{(id) => <Input id={id} value={p.targetRoles.join(", ")} placeholder="MERN Stack Developer, React Developer" onChange={(e) => set({ targetRoles: csv(e.target.value) })} />}</Field>
          <Field label="Preferred industries">{(id) => <Input id={id} value={p.preferredIndustries.join(", ")} onChange={(e) => set({ preferredIndustries: csv(e.target.value) })} />}</Field>
          <Field label="Preferred cities">{(id) => <Input id={id} value={p.preferredLocations.join(", ")} onChange={(e) => set({ preferredLocations: csv(e.target.value) })} />}</Field>
          <Field label="Employment types">{(id) => <Input id={id} value={p.employmentTypes.join(", ")} placeholder="Full-time, Contract" onChange={(e) => set({ employmentTypes: csv(e.target.value) })} />}</Field>
          <fieldset className="sm:col-span-2"><legend className="mb-1 text-xs font-medium text-muted">Work mode</legend>
            <div className="flex gap-4">{WORK_MODES.filter((m) => m !== "unknown").map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm capitalize"><input type="checkbox" checked={p.workModes.includes(m)} onChange={(e) => set({ workModes: e.target.checked ? [...p.workModes, m] : p.workModes.filter((x) => x !== m) })} />{m}</label>
            ))}</div>
          </fieldset>
          <Field label="Minimum salary (per year)">{(id) => <Input id={id} type="number" min={0} value={p.salaryPreferences.minimum ?? ""} onChange={(e) => set({ salaryPreferences: { ...p.salaryPreferences, minimum: e.target.value === "" ? null : Number(e.target.value) } })} />}</Field>
          <Field label="Target salary (per year)" error={errors.salary}>{(id) => <Input id={id} type="number" min={0} value={p.salaryPreferences.target ?? ""} onChange={(e) => set({ salaryPreferences: { ...p.salaryPreferences, target: e.target.value === "" ? null : Number(e.target.value) } })} />}</Field>
          <Field label="Notice period / availability">{(id) => <Input id={id} value={p.noticePeriod} placeholder="e.g. 30 days" onChange={(e) => set({ noticePeriod: e.target.value })} />}</Field>
        </div>
      </Card>

      <div className="sticky bottom-0 -mx-1 flex justify-end border-t border-line bg-bg/90 px-1 py-3 backdrop-blur">
        <Button variant="primary" loading={saving} onClick={save}>{saveLabel}</Button>
      </div>
    </div>
  );
}
