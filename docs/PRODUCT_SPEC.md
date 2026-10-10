# CareerPilot AI — Product Spec

A personal, local-first job-search copilot: resume vault → verified career profile → job analysis (deterministic score) → tailored documents → user-reviewed autofill → application tracking.

## Principles (non-negotiable)
1. **Truthfulness.** Never invent experience, skills, metrics, credentials, jobs, salaries or dates. Verified facts and AI suggestions are always visually and structurally distinct.
2. **Deterministic score.** The numeric match score comes from a transparent engine, never from an LLM. It is not an "ATS score" and guarantees nothing.
3. **Works without paid AI.** Dashboard, parsing, scoring and tracking require no API call.
4. **User in control.** No auto-submit, no auto-send, no silent collection. Permissions requested only when a feature needs them.
5. **Compliant.** No scraping of restricted sites, no login/CAPTCHA/anti-bot bypass. LinkedIn: user opens a listing, then invokes analysis on the page they are viewing.
6. **Untrusted input.** Job pages and resumes are data; embedded instructions are ignored.

## Users
Primary: an individual developer targeting MERN / Full Stack / React / Node roles. The skill taxonomy and scoring config are data-driven so other professions can be added later.

## Modules and phase mapping
| Module | Summary | Phase |
|---|---|---|
| A Resume Vault | PDF/DOCX upload, parse, correct, versions, default | 1 |
| B Master Profile | Editable profile, skill levels never auto-upgraded | 1 |
| C Extension | MV3 popup, service worker, content scripts, options, typed messaging | 1 shell, 2 full |
| D Extraction | Site adapters + manual paste, confidence, correctable | 1 manual, 2 adapters |
| E Analyzer | Weighted deterministic score + breakdown + evidence | 1 |
| F Discovery | Authorized sources/APIs, URL import, search links, dedupe | 4 |
| G Tailoring | Diff, accept/reject, truthful-keyword warnings, export | 3 |
| H Cover letter | Editable, saved to job | 3 |
| I Autofill | User-initiated, field-by-field review, never submits | 5 |
| J Tracker | 10 statuses; table, kanban, calendar, drawer; duplicate warning | 1 |
| K Analytics | Honest KPIs, minimum-sample gating | 1 basic, 6 full |
| L Coach | Optional AI tools, drafts only | 6 |
| M Reminders | Opt-in local alarms | 6 |

## Scoring model (Module E)
Category scores normalized 0–100; `matchScore = Σ score × weight`. Default weights: required skills 35, experience 25, role/responsibility 20, projects/achievements 10, preferred 10 (configurable object, settings UI later). Labels: 85+ Excellent, 70–84 Strong, 55–69 Partial, <55 Low.
- Synonym normalization (JS/JavaScript, Postgres/PostgreSQL, Node/Node.js…).
- Each skill counted once (no repetition reward); required vs preferred separated.
- Skill evidence tiers: profile skill marked Experienced > Working > Learning (partial credit) > text-only mention in resume (lower credit, flagged "unverified").
- Missing items are labelled **"not found in resume"**, never "confirmed missing", unless the user marked the skill Not Applicable.
- If the job description is short/incomplete, the result carries an `incomplete` flag and the UI says the score may be incomplete.
- Output: score, breakdown, matched/missing skills, evidence snippets, explanation — all generated from facts.

## Data (local-first)
IndexedDB (via `idb`) holds: resumes (metadata + file Blob), career profile, jobs, analyses (cached by hash of resume+job), tailored documents, applications (+history), settings. `chrome.storage.local` only for small flags; never `sync` for resumes. A `StorageAdapter` interface allows a later HTTP/Postgres adapter.

## Phase 1 acceptance (MVP)
Upload PDF/DOCX → extracted & parsed with confidence flags → edit every field → profile saved. Paste a job description → deterministic analysis with breakdown and evidence → save job → create/move application in tracker. Basic dashboard counts derived from real stored data. No network or AI key needed. Tests for parsing, synonyms, scoring, dedupe, validation, storage.

## Out of scope until approved
Cloud backend, auth, Redis, vector DB, any scraping of LinkedIn/Naukri/Hirist.
