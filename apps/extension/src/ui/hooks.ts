import { useCallback, useEffect, useRef, useState } from "react";
import type { Settings } from "@careerpilot/shared";
import { onDbChange, settingsRepo } from "../storage/db";

/** Query IndexedDB and re-run when any store changes (in this tab, the popup or another tab). */
export function useLive<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; loading: boolean; error?: string }>({ loading: true });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const run = useCallback(async () => {
    try { setState({ data: await fetchRef.current(), loading: false }); }
    catch { setState((s) => ({ ...s, loading: false, error: "Could not read your local data. Browser storage may be unavailable." })); }
  }, []);
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout> | undefined;
    const go = () => { clearTimeout(timer); timer = setTimeout(() => { if (alive) void run(); }, 30); };
    void run();
    const off = onDbChange(go);
    return () => { alive = false; clearTimeout(timer); off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ...state, reload: run };
}

export function useSettings() {
  const { data, loading, reload } = useLive(() => settingsRepo.get(), []);
  const update = useCallback(async (patch: Partial<Settings>) => { await settingsRepo.update(patch); await reload(); }, [reload]);
  return { settings: data, loading, update };
}

export function applyTheme(theme: Settings["theme"] | undefined) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
export const timeAgo = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
export const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : "Something went wrong.");
