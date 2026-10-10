# Security & Privacy

## Data handling
- All data (resumes, profile, jobs, analyses, documents, applications, settings) is stored locally in IndexedDB (`unlimitedStorage` not requested). Nothing leaves the device unless the user (a) presses an AI button with a provider configured, or (b) enables a job source and searches.
- Resume files are parsed in the browser; there is no resume upload feature, so no remote-upload consent flow is needed yet (`settings.remoteUploadConsent` is reserved for a future cloud adapter).
- Export (JSON) excludes API keys and resume binaries. *Delete all data* clears every store and settings.
- No telemetry, no analytics beacons, no logging of resume text or keys (no `console` output of user data).

## Permissions
Install-time: `storage`, `activeTab`, `scripting`. **No host permissions, no always-on content scripts.** Optional (requested at a click, for one origin or feature): AI provider origin, job-source origins, `alarms` + `notifications` for opt-in reminders. *Revoke optional permissions* in Settings.

## Threat model
| Threat | Mitigation |
|---|---|
| Malicious web page sends messages to the extension | No `externally_connectable`. Service worker accepts only senders with our extension id **and** an extension-page URL; requests validated with zod; content script answers only its own extension. Tested. |
| Page content injects instructions into the LLM | Job text/profile wrapped as delimited untrusted data; closing delimiters stripped; system prompt forbids following embedded instructions or revealing secrets; output must match a zod schema; truthfulness validator flags unsupported skills/numbers. Tested. |
| LLM fabricates experience | Deterministic tailoring never adds content; AI output flagged per section; user accepts/rejects each change. |
| API key theft | Stored in extension-local IndexedDB (not in bundle/source); sent only to the user-configured base URL; excluded from export; never logged. Not encrypted at rest (browser profile access = access) — documented limitation. |
| Malicious/oversized resume file | Extension + magic-byte validation, 5 MB cap, parsing in pdf.js with `isEvalSupported:false`, text only; no HTML rendering of file contents. |
| XSS via job/resume text | React escapes all text; no `dangerouslySetInnerHTML`; extracted HTML is converted to plain text via DOM walk (scripts skipped); only `http(s)` URLs kept. |
| Unintended automation / ToS violation | No auto-submit, no auto-send, no clicking; autofill is user-initiated, field-by-field, never overwrites, skips password/file/hidden/protected-attribute/screening fields. LinkedIn: DOM never read, selection-only. No CAPTCHA/login/anti-bot handling anywhere. |
| Cross-user access | Single-user local storage; there is no multi-user surface. Ownership checks become mandatory when a backend adapter is added. |
| Supply chain | Locked dependencies; `pnpm audit` in release checklist; no remote code (CSP `script-src 'self'`). |

## Accepted audit findings (as of build)
`pnpm audit --prod`: 3 moderate — `react-router@6` advisories concern server/SSR data APIs that this hash-routed SPA does not use; `sprintf-js` (via mammoth→argparse) has no patched release and is used only when parsing a DOCX the user selected. Revisit at each release.

## Known limitations
Local data is unencrypted at rest; anyone with access to the Chrome profile can read it. Site adapters other than JSON-LD/generic are best-effort and verified against fixtures only (not live sites).

## Online LaTeX compiler
PDF-from-LaTeX sends the resume/cover-letter LaTeX (personal data) to `texlive.net`. It is off by default, requires an explicit consent dialog and a Chrome host-permission grant (`https://texlive.net/*`), and consent can be withdrawn in Settings. LaTeX special characters in user content are escaped so content cannot inject commands (unit-tested and compiled live). The `.tex` download never leaves the device.

## Page-list scan
Reading result cards is user-initiated, uses only DOM already rendered in the open tab, and sends nothing anywhere. It is disabled on LinkedIn. Users remain responsible for complying with each site's terms.
