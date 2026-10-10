import { AiError, checkUsage, createAiProvider, type AiContext, type AiProvider } from "@careerpilot/shared";
import { kv, settingsRepo } from "../storage/db";

export type AiOperation = "analyzeJob" | "tailorResume" | "generateCoverLetter" | "generateInterviewQuestions" | "draftOutreach" | "suggest";

export async function aiStatus(): Promise<{ configured: boolean; reason?: string }> {
  const { ai } = await settingsRepo.get();
  if (!ai.enabled) return { configured: false, reason: "AI is turned off. Everything below still works with the built-in deterministic tools." };
  if (!ai.model || (!ai.apiKey && !/localhost|127\.0\.0\.1/.test(ai.baseUrl))) return { configured: false, reason: "AI provider is incomplete — add a model and API key in Settings." };
  return { configured: true };
}

const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, unknown>();

/** Runs an AI operation with: config check, daily usage limit, request de-duplication and a short in-memory cache. */
export async function callAi<T>(op: AiOperation, ctx: AiContext & Record<string, unknown>, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<T> {
  const { ai } = await settingsRepo.get();
  const provider: AiProvider = createAiProvider(ai, fetcher); // throws AiError("not_configured")
  const key = JSON.stringify([op, ctx.job.contentHash, ctx.analysis.cacheKey, ctx.notes, ctx.recipient, ctx.kind]);
  if (cache.has(key)) return cache.get(key) as T;
  if (inflight.has(key)) return inflight.get(key) as Promise<T>;

  const today = new Date().toISOString().slice(0, 10);
  const usage = checkUsage(await kv.get<{ day: string; count: number }>("aiUsage"), ai.dailyLimit, today);
  if (!usage.allowed) throw new AiError("limit", `Daily AI usage limit (${ai.dailyLimit}) reached. Raise it in Settings or try tomorrow.`);

  const p = (async () => {
    try {
      const result = await (provider[op] as (c: unknown) => Promise<T>)(ctx);
      await kv.set("aiUsage", usage.next); // count only successful calls
      cache.set(key, result);
      return result;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

export function describeAiError(e: unknown): string {
  if (e instanceof AiError) return e.message;
  return "The AI request failed unexpectedly. Your data is unchanged.";
}
