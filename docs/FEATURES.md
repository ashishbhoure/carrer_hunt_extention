# Feature checklist

Legend: ✅ implemented & covered by automated tests · 🟡 implemented, partially/not automatically tested · ⏳ pending

## Phase 1 — Local-first MVP
- ✅ MV3 shell, popup, options/dashboard page, typed messaging
- ✅ Resume upload (PDF/DOCX), validation, parsing + confidence/flags, field-level editing, versions, default, download/replace/delete
- ✅ Master profile (skill levels never auto-upgraded; verified markers)
- ✅ Manual job input, deterministic score + inspectable breakdown, evidence, missing-vs-"not found", incomplete-data warnings, caching
- ✅ Save jobs (dedupe), tracker (10 statuses, table, board, follow-up calendar, drawer, history, duplicate warning)
- ✅ Dashboard with real derived data, onboarding, empty/loading/error states
- 🟡 Configurable weights (settings fields exist; applied in scoring; no dedicated tests of the UI)

## Phase 2 — Browser job analysis
- ✅ Adapter interface; JSON-LD, generic, Naukri/Hirist/Indeed (fixture-verified), LinkedIn selection-only
- ✅ Analyze this job, save, original link, unsupported/permission fallbacks, on-demand injection
- 🟡 Real-site selector accuracy (fixtures only)

## Phase 3 — AI documents
- ✅ Tailored resume (deterministic + optional AI), before/after diff, accept/reject/edit, truthfulness warnings, versions per job
- ✅ Cover letter (template + optional AI), edit/copy/download, saved to job
- ✅ DOCX/PDF/TXT export (DOCX/PDF verified in real browser)
- ✅ Provider abstraction (OpenAI-compatible, Anthropic), schema validation, timeouts, errors, daily limit, dedupe/cache
- 🟡 Live provider calls not exercised

## Phase 4 — Discovery
- ✅ Remotive + Arbeitnow official APIs, attribution, fair-use cache, failure isolation, dedupe, filters, ranking, pagination
- ✅ Search links (LinkedIn/Naukri/Indeed) that the user opens
- ⏳ Hirist search links (URL format unverified, so not generated); Adzuna/other keyed APIs

## Phase 5 — Application assistance
- ✅ Form scan, field mapping, review UI, sensitive-field opt-in, never fills screening/protected/file/password fields, never submits, checklist, user-confirmed "applied"
- 🟡 Popup closes when focus moves to the page; checklist also lives on the job page

## Phase 6 — Analytics, coach, reminders
- ✅ Honest analytics with minimum-sample gating, skill-gap summary
- 🟡 Coach (AI tools; deterministic gap list tested, AI prompts tested via provider tests)
- 🟡 Opt-in reminders via alarms/notifications (SW logic written; not automatically tested)

## Phase 7 — Production readiness
- ✅ Security doc, dependency audit (3 accepted moderate), regression suite
- ⏳ Automated a11y audit, performance profiling, Chrome Web Store packaging (zip + listing + privacy policy), optional backend/Next.js web app

## Update: LaTeX, list scan, scheduling
- ✅ LaTeX export of tailored resume / cover letter: `.tex` download, plus PDF via texlive.net after explicit consent + Chrome host permission (consent revocable in Settings). Generated LaTeX verified to compile on the live service (`LATEX_LIVE=1 pnpm --filter @careerpilot/extension exec vitest run tests/latex.live.test.ts`). Quick PDF (jsPDF) remains as an offline fallback.
- ✅ "Scan all jobs on this page": reads the result cards already rendered on the open page (Naukri/Hirist/Indeed hints + generic structure detection), scores each from its card summary (flagged partial), ranked list with min-score slider, Save / Open / Save all. 🟡 Verified against fixtures only, not live Naukri markup.
- ✅ LinkedIn: DOM is never read (their terms forbid it). Select the description text, or paste; title/company prefilled from the tab title. Lists are not scanned on LinkedIn.
- ✅ Tracker: delete (board, table, drawer, with confirmation), schedule follow-ups and interviews with date + time from the calendar (click a day), the Schedule button, the drawer, or the prompt shown when a card moves to Interview. Reminders fire at the follow-up time and a configurable lead time before interviews; alarms are re-armed when the service worker starts.
