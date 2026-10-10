import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/* ---------- Button ---------- */
type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md"; loading?: boolean }) {
  const v = {
    primary: "bg-primary text-primary-ink hover:opacity-90",
    secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
    ghost: "text-muted hover:bg-surface-2 hover:text-ink",
    danger: "bg-surface text-bad border border-line hover:bg-surface-2",
  }[variant];
  return (
    <button {...rest} disabled={disabled || loading} className={cx("inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed", size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm", v, className)}>
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------- Layout bits ---------- */
export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...rest} className={cx("rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,26,51,.04)]", className)}>{children}</div>;
}
export function CardHeader({ title, action, subtitle }: { title: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
      <div><h3 className="text-sm font-semibold">{title}</h3>{subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}</div>
      {action}
    </div>
  );
}
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}</div>
      <div className="flex gap-2">{actions}</div>
    </div>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "good" | "warn" | "bad" | "info" | "accent"; children: ReactNode; className?: string }) {
  const t = {
    neutral: "bg-surface-2 text-muted", good: "bg-good/10 text-good", warn: "bg-warn/10 text-warn",
    bad: "bg-bad/10 text-bad", info: "bg-primary/10 text-primary", accent: "bg-accent/10 text-accent",
  }[tone];
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", t, className)}>{children}</span>;
}

export function Banner({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "bad" | "good"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  const t = { info: "border-primary/30 bg-primary/5", warn: "border-warn/40 bg-warn/5", bad: "border-bad/40 bg-bad/5", good: "border-good/40 bg-good/5" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cx("flex items-start justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-sm", t)}>
      <div>{title && <p className="font-medium">{title}</p>}{children && <div className="text-muted">{children}</div>}</div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) { return <div aria-hidden className={cx("skeleton", className)} />; }
export function SkeletonRows({ n = 3 }: { n?: number }) {
  return <div role="status" aria-label="Loading" className="space-y-3">{Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="mb-3 text-3xl" aria-hidden>{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ---------- Forms ---------- */
const fieldCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus-visible:outline-primary disabled:opacity-60";
export function Field({ label, hint, error, children, flag }: { label: string; hint?: string; error?: string; flag?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">{label}{flag && <Badge tone="warn">{flag}</Badge>}</label>
      {children(id)}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && <p role="alert" className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) { return <input {...props} className={cx(fieldCls, props.className)} />; }
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea {...props} className={cx(fieldCls, "min-h-24", props.className)} />; }
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select {...props} className={cx(fieldCls, props.className)} />; }

/* ---------- Overlay: Dialog / Drawer ---------- */
export function Overlay({ open, onClose, title, children, side = false, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; side?: boolean; width?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex bg-navy/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        className={cx("flex flex-col overflow-hidden bg-surface shadow-xl", side ? `ml-auto h-full w-full ${width}` : `m-auto max-h-[90vh] w-full ${width} rounded-xl`)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", danger, onConfirm, onClose }: { open: boolean; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Overlay open={open} onClose={onClose} title={title} width="max-w-md">
      <div className="text-sm text-muted">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); onClose(); } }}>{confirmLabel}</Button>
      </div>
    </Overlay>
  );
}

/* ---------- Tabs ---------- */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx("rounded-md px-3 py-1.5 text-sm font-medium", value === t.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>{t.label}</button>
      ))}
    </div>
  );
}

/* ---------- Score ring ---------- */
export function scoreTone(score: number): "good" | "info" | "warn" | "bad" { return score >= 85 ? "good" : score >= 70 ? "info" : score >= 55 ? "warn" : "bad"; }
const toneVar = { good: "var(--good)", info: "var(--primary)", warn: "var(--warn)", bad: "var(--bad)" };
export function ScoreRing({ score, size = 96, label }: { score: number; size?: number; label?: string }) {
  const r = (size - 12) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`Match score ${score} out of 100${label ? ", " + label : ""}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={8} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={toneVar[scoreTone(score)]} strokeWidth={8} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      </svg>
      <span className="absolute text-center"><span className="block text-2xl font-semibold leading-none">{score}</span><span className="text-[10px] text-muted">/ 100</span></span>
    </div>
  );
}
export function Bar({ value, tone }: { value: number; tone?: "good" | "info" | "warn" | "bad" }) {
  return <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full" style={{ width: `${value}%`, background: toneVar[tone ?? scoreTone(value)] }} /></div>;
}

/* ---------- Toasts ---------- */
type Toast = { id: number; tone: "good" | "bad" | "info"; text: string };
const ToastCtx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { ...t, id }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.tone === "bad" ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.tone === "bad" ? "alert" : "status"} className={cx("pointer-events-auto rounded-lg border bg-surface px-3.5 py-2.5 text-sm shadow-lg", t.tone === "bad" ? "border-bad/50" : t.tone === "good" ? "border-good/50" : "border-line")}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <img src="icons/icon32.png" width={compact ? 22 : 28} height={compact ? 22 : 28} alt="" className="rounded-md" />
      <span className={cx("font-semibold tracking-tight", compact ? "text-sm" : "text-base")}>CareerPilot <span className="text-accent">AI</span></span>
    </div>
  );
}
