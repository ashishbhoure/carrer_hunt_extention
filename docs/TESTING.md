# Testing

Run: `pnpm test` (unit/integration), `pnpm e2e` (real Chromium; run `pnpm build` first and install the browser once).

| Layer | Where | Covers |
|---|---|---|
| Unit | `packages/shared/tests` (49) | skill synonyms, resume parsing (+flags/confidence), dates, job structuring (required vs preferred), scoring formula/weights/labels/caching/repetition/N-A redistribution, URL canonicalisation, dedupe, tailoring + truthfulness validator, diff, autofill mapping, AI provider (schema validation, quota/auth/network errors, prompt-injection delimiters, usage limit), analytics sample-size gating |
| Integration | `apps/extension/tests/*.test.ts` (node env, fake-indexeddb, real DOCX via `docx`+`mammoth`) | file validation (magic bytes), upload → profile, versions/default/replace/delete, merge-into-master, analysis cache/invalidations, duplicate jobs/applications, confirmation-gated "applied", history, tailoring + AI failure fallback + invented-content flags + usage limit, export without API key, delete-all |
| Extension | `adapters`, `background`, `ui` tests (jsdom) | JSON-LD/selector/generic extraction, malformed JSON-LD, LinkedIn selection-only, form scan/fill (no overwrite/submit), SW sender checks & typed protocol, permission-denied → ask, popup render/analyze/save/restore across sessions, no page read before click |
| Discovery | `discovery.test.ts` | provider normalisation from API-shaped fixtures, failure isolation, call-interval cache, cross-source dedupe, filters/sorting |
| E2E (real browser) | `tests/e2e/extension.spec.ts` (5) | manifest permissions; invalid file rejected; **real PDF** parsed by pdf.js; profile review; paste job → score breakdown → save → tailor → DOCX/PDF download → tracker → persists after reload; SW refuses unpermitted pages; popup flow; dark theme |

Fixtures are synthetic; no real job platform is contacted. Provider tests use API-shaped samples captured from the public documentation/response format.

## Not covered by automation (be honest)
- Live behaviour of Naukri/Hirist/Indeed selectors (only fixtures).
- Popup extraction on a page *with* `activeTab` granted (requires a real toolbar click, which Playwright cannot perform); covered by unit tests of the SW + content script logic, and manually.
- Live Remotive/Arbeitnow calls and live LLM providers.
- Automated accessibility audit (keyboard/labels were built in and spot-checked; run axe/Lighthouse before store submission).
