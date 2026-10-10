# CareerPilot AI — Implementation Plan

Each phase is finished, tested and documented before the next starts.

## Phase 0 — Audit & planning (this)
Docs: PRODUCT_SPEC, ARCHITECTURE, IMPLEMENTATION_PLAN. **Gate: user approval.**

## Phase 1 — Local-first MVP (no AI key, no backend)
1. Workspace scaffold: pnpm workspace, TS strict, ESLint/Prettier, Vitest, `.gitignore`, `.env.example`.
2. `packages/shared`: zod schemas/types (Resume, CareerProfile, Job, JobAnalysis, Application…), skill taxonomy + synonyms, URL canonicalization, job fingerprint/dedupe, job-text structuring, scoring engine + config, resume text→profile parser. **Unit tests first for these.**
3. Extension shell: manifest, popup, background worker with typed messaging, dashboard page, router, design tokens (light + dark), base components.
4. Storage: IndexedDB adapter + repositories + migrations + export/delete-all; tests with fake-indexeddb.
5. Resume Library: upload (type/size validation), PDF/DOCX text extraction, parse with confidence, field-by-field editing, versions, default, download/replace/delete.
6. Master Profile editor + skill levels (never auto-upgraded).
7. Job Analysis: paste JD → structure → score → breakdown/evidence/missing skills UI; analysis cache; save job; dedupe warning.
8. Tracker: statuses, table + kanban, detail drawer, notes/history, duplicate warning.
9. Dashboard (real derived counts) + onboarding flow + popup (resume selector, manual paste, score, save).
10. Integration tests + one Playwright E2E (upload → profile → paste JD → analyze → save → track). README + TESTING.md + SECURITY.md draft + feature checklist.

## Phase 2 — Browser job analysis
Adapter interface, JSON-LD/generic extractor, Indeed-style/Naukri/Hirist/LinkedIn (on-page, user-initiated only) adapters validated against fixtures, optional host permission flow, popup page detection, unsupported fallback.

## Phase 3 — AI documents
AiProvider + adapters, settings/key handling, usage limits, tailoring with diff & truthfulness validator, cover letters, DOCX/PDF export.

## Phase 4 — Discovery
Official APIs / user-configured feeds only, URL import, generated search links, filters, ranking, dedupe, source attribution.

## Phase 5 — Application assistance
Form field mapper, review-before-fill UI, sensitive-field confirmation, checklist, post-submit confirmation → tracker.

## Phase 6 — Analytics, coach, reminders
Gated analytics, skill-gap summary, interview prep, opt-in `alarms` notifications.

## Phase 7 — Production readiness
a11y audit, perf, security review/audit, regression suite, Chrome Web Store packaging.

## Decisions needing approval
1. Dashboard as an **extension page** (Next.js deferred until a backend exists).
2. pnpm workspaces monorepo with `packages/shared` (+ `packages/ui` only when needed).
3. Resume parsing: heuristic, client-side (pdfjs-dist, mammoth), no remote upload in Phase 1.
4. shadcn/ui components copied in (Radix + Tailwind) inside the extension app.
