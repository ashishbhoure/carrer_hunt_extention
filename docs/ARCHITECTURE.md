# CareerPilot AI — Architecture

## Repository audit
Empty git repo (no commits, no files). Greenfield. Tooling available: Node 22.16, npm 10.9, pnpm 12.10 → **pnpm workspaces**.

## Key decision: where does the dashboard live?
Local-first data sits in the extension's IndexedDB. A Next.js site on `localhost` or a domain has a **different origin** and cannot read it (without externally_connectable messaging or a backend). Therefore:

- **Phase 1–3: the dashboard is an extension page** (`chrome-extension://…/app.html`, React + Vite + Tailwind + shadcn/ui components, React Router). Same IndexedDB, no backend, no sync problem, no extra permissions.
- **Next.js web app is deferred** to when a backend/cloud sync exists (Phase 4+ optional), reusing the same `packages/ui` components and `packages/shared` logic. This deviates from the "preferred" stack on purpose; it is the only design that is genuinely local-first. *Needs approval.*

## Structure (adapted, minimal)
```
apps/
  extension/            Vite + @crxjs/vite-plugin, MV3
    src/popup/          compact popup
    src/app/            full dashboard + onboarding + settings (options_page / tab)
    src/background/     service worker: message router, alarms, AI calls
    src/content/        on-demand injected extraction (activeTab + scripting)
    src/adapters/       site extractors (Phase 2)
    src/storage/        IndexedDB repositories behind StorageAdapter
    src/messaging/      typed request/response protocol
packages/
  shared/               zod schemas, types, constants, pure logic (no DOM/chrome APIs)
    scoring/ skills/ parsing/ jobs/(canonicalize, dedupe, normalize) validation/
  ui/                   shared React components + Tailwind preset (created when 2nd consumer exists)
apps/api, apps/web      NOT created until needed
docs/  tests/(e2e)
```

## Layers
1. **shared (pure TS)**: all business logic — resume text→profile parsing heuristics, skill taxonomy/synonyms, job text→structured job, scoring, dedupe, URL canonicalization. Unit-tested with Vitest; no duplication between popup/dashboard/service worker.
2. **storage**: `StorageAdapter` interface → `IndexedDbAdapter` (idb). Repositories per entity. Schema versioned with migrations. Remote adapter later.
3. **messaging**: discriminated-union `Request`/`Response` types validated with zod at the service-worker boundary; senders verified (`sender.id`, never trust page-origin messages).
4. **services**: `ResumeService` (pdfjs-dist / mammoth text extraction run in the dashboard page, not the SW), `JobService`, `AnalysisService` (cache by `sha256(resumeVersion+jobHash+configVersion)`), `ApplicationService`.
5. **AI provider (Phase 3)**: `AiProvider` interface (`analyzeJob`, `tailorResume`, `generateCoverLetter`, `generateInterviewQuestions`, `draftOutreach`); adapters for an OpenAI-compatible endpoint (covers low-cost providers and local Ollama) and Anthropic. Outputs validated with zod; no key in the bundle; user-supplied key stored in `chrome.storage.local` and used only against the user-configured endpoint; usage limits + cache.

## Permissions (manifest)
Install: `storage`, `activeTab`, `scripting`, `alarms` (Phase 6, optional), `unlimitedStorage` only if quota requires. No `host_permissions`; per-site access via `optional_host_permissions` requested at a user click. Remote AI endpoint hosts also optional.

## Extraction (Phase 2)
`JobSourceAdapter { canHandle, extractJobDetails, extractJobDescription, getApplicationLink, getExtractionStatus }`. Order: JSON-LD `JobPosting` → semantic/ARIA/meta → site-specific selectors → generic readability fallback → manual paste. Each returns per-field confidence. Injected only on user action via `scripting.executeScript` after `activeTab`. Tested against saved HTML fixtures.

## Tooling
TypeScript strict, Vite, Tailwind, Vitest (+ jsdom, fake-indexeddb), Testing Library, Playwright (loads unpacked extension) for E2E, ESLint + Prettier, `pnpm audit` in CI.

## Risks
| Risk | Mitigation |
|---|---|
| Resume parsing is heuristic and imperfect | Confidence per field, every field editable, nothing auto-verified |
| PDF.js worker under MV3 CSP | Bundle worker locally; no remote code |
| `@crxjs/vite-plugin` maintenance/compat | Pin version; fallback to plain Vite multi-entry config |
| LinkedIn/Naukri ToS | No automation/scraping; on-page analysis only on user-opened listings; adapter feature-flagged per site |
| Service worker lifetime | Stateless handlers; state in IndexedDB |
| Playwright + extensions needs headed Chromium | Documented; E2E run locally/CI with xvfb |
| Skill-taxonomy coverage | Data-driven taxonomy, user can add custom skills |
