import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  type Application, type CareerProfile, type Job, type JobAnalysis, type Resume, type Settings, type TailoredDocument,
  defaultSettings, settingsSchema,
} from "@careerpilot/shared";

interface CareerPilotDB extends DBSchema {
  resumes: { key: string; value: Resume };
  resumeFiles: { key: string; value: { id: string; blob: Blob } };
  profile: { key: string; value: CareerProfile };
  jobs: { key: string; value: Job; indexes: { canonicalUrl: string; fingerprint: string } };
  analyses: { key: string; value: JobAnalysis; indexes: { cacheKey: string; jobId: string } };
  applications: { key: string; value: Application; indexes: { jobId: string } };
  documents: { key: string; value: TailoredDocument; indexes: { jobId: string } };
  kv: { key: string; value: unknown };
}

export const DB_NAME = "careerpilot";
export const DB_VERSION = 1;
let dbPromise: Promise<IDBPDatabase<CareerPilotDB>> | null = null;

export function getDb() {
  dbPromise ??= openDB<CareerPilotDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Migrations: add `if (old < N)` blocks here for future versions.
      db.createObjectStore("resumes", { keyPath: "id" });
      db.createObjectStore("resumeFiles", { keyPath: "id" });
      db.createObjectStore("profile", { keyPath: "id" });
      const jobs = db.createObjectStore("jobs", { keyPath: "id" });
      jobs.createIndex("canonicalUrl", "canonicalUrl");
      jobs.createIndex("fingerprint", "fingerprint");
      const an = db.createObjectStore("analyses", { keyPath: "id" });
      an.createIndex("cacheKey", "cacheKey");
      an.createIndex("jobId", "jobId");
      db.createObjectStore("applications", { keyPath: "id" }).createIndex("jobId", "jobId");
      db.createObjectStore("documents", { keyPath: "id" }).createIndex("jobId", "jobId");
      db.createObjectStore("kv");
    },
    blocking() { dbPromise = null; },
  });
  return dbPromise;
}

/** Test helper: close and forget the cached connection. */
export async function resetDbForTests() {
  if (dbPromise) { (await dbPromise).close(); dbPromise = null; }
  await new Promise<void>((res) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}

// ---- change notifications (popup <-> dashboard <-> service worker) ----
const chan = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("careerpilot-db") : null;
const listeners = new Set<(store: string) => void>();
chan?.addEventListener("message", (e) => listeners.forEach((l) => l(String(e.data))));
export function notifyChange(store: string) {
  listeners.forEach((l) => l(store));
  chan?.postMessage(store);
}
export function onDbChange(fn: (store: string) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Storage abstraction. A remote (Postgres/API) adapter can implement the same shape later. */
export interface StorageAdapter {
  list<T>(store: StoreName): Promise<T[]>;
  get<T>(store: StoreName, id: string): Promise<T | undefined>;
  put<T extends { id: string }>(store: StoreName, value: T): Promise<void>;
  delete(store: StoreName, id: string): Promise<void>;
}
export type StoreName = "resumes" | "profile" | "jobs" | "analyses" | "applications" | "documents";

export const idbAdapter: StorageAdapter = {
  async list(store) { return (await (await getDb()).getAll(store)) as never; },
  async get(store, id) { return (await (await getDb()).get(store, id)) as never; },
  async put(store, value) { await (await getDb()).put(store, value as never); notifyChange(store); },
  async delete(store, id) { await (await getDb()).delete(store, id); notifyChange(store); },
};

// ---- repositories ----
const byDateDesc = <T,>(f: (t: T) => string) => (a: T, b: T) => f(b).localeCompare(f(a));

export const resumesRepo = {
  list: async () => (await idbAdapter.list<Resume>("resumes")).sort(byDateDesc((r) => r.createdAt)),
  get: (id: string) => idbAdapter.get<Resume>("resumes", id),
  put: (r: Resume) => idbAdapter.put("resumes", r),
  async remove(id: string) {
    const db = await getDb();
    await db.delete("resumeFiles", id);
    await idbAdapter.delete("resumes", id);
  },
  async putFile(id: string, blob: Blob) { await (await getDb()).put("resumeFiles", { id, blob }); },
  async getFile(id: string) { return (await (await getDb()).get("resumeFiles", id))?.blob; },
  async getDefault() { return (await resumesRepo.list()).find((r) => r.isDefault) ?? (await resumesRepo.list())[0]; },
};

export const profileRepo = {
  MASTER_ID: "master",
  async get() { return (await idbAdapter.get<CareerProfile>("profile", "master")); },
  async put(p: CareerProfile) { await idbAdapter.put("profile", { ...p, id: "master" }); },
};

export const jobsRepo = {
  list: async () => (await idbAdapter.list<Job>("jobs")).sort(byDateDesc((j) => j.savedAt ?? j.discoveredAt)),
  get: (id: string) => idbAdapter.get<Job>("jobs", id),
  put: (j: Job) => idbAdapter.put("jobs", j),
  remove: (id: string) => idbAdapter.delete("jobs", id),
};

export const analysesRepo = {
  list: () => idbAdapter.list<JobAnalysis>("analyses"),
  get: (id: string) => idbAdapter.get<JobAnalysis>("analyses", id),
  put: (a: JobAnalysis) => idbAdapter.put("analyses", a),
  async byCacheKey(key: string) { return (await (await getDb()).getFromIndex("analyses", "cacheKey", key)); },
  async forJob(jobId: string) { return (await (await getDb()).getAllFromIndex("analyses", "jobId", jobId)).sort(byDateDesc((a) => a.createdAt)); },
};

export const applicationsRepo = {
  list: async () => (await idbAdapter.list<Application>("applications")).sort(byDateDesc((a) => a.updatedAt)),
  get: (id: string) => idbAdapter.get<Application>("applications", id),
  put: (a: Application) => idbAdapter.put("applications", a),
  remove: (id: string) => idbAdapter.delete("applications", id),
  async forJob(jobId: string) { return (await (await getDb()).getAllFromIndex("applications", "jobId", jobId))[0]; },
};

export const documentsRepo = {
  list: () => idbAdapter.list<TailoredDocument>("documents"),
  get: (id: string) => idbAdapter.get<TailoredDocument>("documents", id),
  put: (d: TailoredDocument) => idbAdapter.put("documents", d),
  remove: (id: string) => idbAdapter.delete("documents", id),
  async forJob(jobId: string) { return (await (await getDb()).getAllFromIndex("documents", "jobId", jobId)).sort(byDateDesc((d) => d.createdAt)); },
};

export const kv = {
  async get<T>(key: string): Promise<T | undefined> { return (await (await getDb()).get("kv", key)) as T | undefined; },
  async set(key: string, value: unknown) { await (await getDb()).put("kv", value, key); notifyChange("kv"); },
};

export const settingsRepo = {
  async get(): Promise<Settings> {
    const raw = await kv.get<unknown>("settings");
    const parsed = settingsSchema.safeParse(raw ?? {});
    return parsed.success ? parsed.data : defaultSettings();
  },
  async put(s: Settings) { await kv.set("settings", settingsSchema.parse(s)); },
  async update(patch: Partial<Settings>) { const cur = await settingsRepo.get(); const next = { ...cur, ...patch }; await settingsRepo.put(next); return next; },
};

/** User-controlled export (JSON, resume binaries excluded) and full deletion. */
export async function exportAllData() {
  const db = await getDb();
  const settings = await settingsRepo.get();
  return {
    exportedAt: new Date().toISOString(),
    version: DB_VERSION,
    resumes: await db.getAll("resumes"),
    profile: await db.getAll("profile"),
    jobs: await db.getAll("jobs"),
    analyses: await db.getAll("analyses"),
    applications: await db.getAll("applications"),
    documents: await db.getAll("documents"),
    // API keys are never exported.
    settings: { ...settings, ai: { ...settings.ai, apiKey: "" } },
  };
}

export async function deleteAllData() {
  const db = await getDb();
  for (const s of ["resumes", "resumeFiles", "profile", "jobs", "analyses", "applications", "documents", "kv"] as const) await db.clear(s);
  notifyChange("all");
}
