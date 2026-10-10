import type { ExtractedJobFields, ExtractionStatus } from "@careerpilot/shared";

export interface AdapterContext { doc: Document; url: URL }

/**
 * A job-page extractor. Adapters only read the page the user is currently viewing, only when the
 * user explicitly invokes analysis, and never navigate, click, scroll or call site APIs.
 */
export interface JobSourceAdapter {
  readonly id: string;
  canHandle(url: URL): boolean;
  extractJobDetails(ctx: AdapterContext): Partial<ExtractedJobFields>;
  extractJobDescription(ctx: AdapterContext): string;
  getApplicationLink(ctx: AdapterContext): string;
  getExtractionStatus(result: Partial<ExtractedJobFields>): ExtractionStatus;
}
