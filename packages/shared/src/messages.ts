import { z } from "zod";

/** Typed request/response protocol between popup/dashboard, service worker and content script. */
export const extractedJobFieldsSchema = z.object({
  title: z.string().default(""),
  company: z.string().default(""),
  location: z.string().default(""),
  description: z.string().default(""),
  employmentType: z.string().default(""),
  salaryRange: z.string().default(""),
  datePosted: z.string().optional(),
  applicationUrl: z.string().default(""),
  url: z.string().default(""),
  provider: z.string().default("generic"),
  confidence: z.number().min(0).max(1).default(0),
  notes: z.array(z.string()).default([]),
});
export type ExtractedJobFields = z.infer<typeof extractedJobFieldsSchema>;

export const extractionStatusSchema = z.enum(["ok", "partial", "unsupported", "not_a_job_page", "failed"]);
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;

export const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("page/extract"), tabId: z.number().int().optional() }),
  z.object({ type: z.literal("page/extractList"), tabId: z.number().int().optional() }),
  z.object({ type: z.literal("permissions/ensureOrigin"), origin: z.string() }),
  z.object({ type: z.literal("dashboard/open"), route: z.string().default("/") }),
  z.object({ type: z.literal("reminders/sync") }),
  z.object({ type: z.literal("ai/call"), operation: z.enum(["analyzeJob", "tailorResume", "generateCoverLetter", "generateInterviewQuestions", "draftOutreach", "suggest"]), payload: z.unknown() }),
  z.object({ type: z.literal("autofill/scan"), tabId: z.number().int().optional() }),
  z.object({ type: z.literal("autofill/apply"), tabId: z.number().int().optional(), fills: z.array(z.object({ selector: z.string(), value: z.string() })) }),
]);
export type Request = z.infer<typeof requestSchema>;

export type Response<T = unknown> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export const ok = <T>(data: T): Response<T> => ({ ok: true, data });
export const fail = (code: string, message: string): Response<never> => ({ ok: false, error: { code, message } });

export interface ExtractResult {
  status: ExtractionStatus;
  job?: ExtractedJobFields;
  tabUrl: string;
  message?: string;
  needsPermission?: boolean;
  origin?: string;
}

/** Message from SW to the injected content script. */
export const contentRequestSchema = z.object({ type: z.enum(["content/extract", "content/extractList", "content/scanForm", "content/fillForm"]), fills: z.array(z.object({ selector: z.string(), value: z.string() })).optional() });
export type ContentRequest = z.infer<typeof contentRequestSchema>;

export const listCardSchema = z.object({
  title: z.string(), company: z.string().default(""), location: z.string().default(""), experience: z.string().default(""),
  salary: z.string().default(""), skills: z.array(z.string()).default([]), snippet: z.string().default(""), url: z.string().default(""),
});
export type ListCard = z.infer<typeof listCardSchema>;

export interface ExtractListResult {
  status: "ok" | "none_found" | "unsupported" | "failed";
  cards: ListCard[];
  tabUrl: string;
  provider: string;
  message?: string;
  needsPermission?: boolean;
  origin?: string;
}
