# Extension — build status (branch `chrome-extension`)

Honest state of the MV3 port. The brief is in `EXTENSION-GOAL.md`.

## ✅ Done & validated (autonomously testable)
- **Scaffold:** `manifest.json` (MV3, content script on allianzcare, side panel, options, offscreen/alarms perms, web_accessible_resources), service worker, content-script bridge.
- **Pure-logic brain → browser ESM, unit-tested** (`extension/src/lib/`): `parse` (invoice fields), `classify` (+ agent-forced type + injected `docAvailable`), `enrich` (per-invoice category/coverage/check), `policy`, `canonical`, `csv` (export **and** import, round-trip tested).
- **Dashboard** (`src/sidepanel/`): totals, needs-attention, claims, by patient/category/provider — from `chrome.storage`; CSV import/export buttons.
- **Options page:** config editor (chrome.storage).
- **Upload technique de-risked in real headless Chrome:** synthetic `DragEvent`+`DataTransfer` delivers a `File` to a dropzone handler. (`archive/technique-test.js`.)
- **Form-driver** (`src/content/formDriver.js`) + bridge (`driver.js`): payee step + addInvoice (synthetic-drop upload) + save + submit, ported from the proven CLI `lib/portal.js`. Syntax-valid; **not yet run against the live form.**

## ✅ Also done & validated since
- **Intake UI** (`src/sidepanel/`): File System Access "pick a folder, persist handle (IndexedDB), rescan on open" (primary B) + drop zone (fallback A) + parse/classify → review list with flags → "File selected" messages the portal tab's content script.
- **PDF text extraction** (`src/lib/extract.js` + vendored `pdf.js`): line-reconstruction from positioned text items → `parseFields` — **validated offline on a real invoice** (faktura/patient/date/amount all correct).
- **Crawl parsers** (`src/content/crawl.js`): `parseClaimsList` + `parseClaimDetail` ported from the proven CLI regexes — **validated offline** (invoices/reimbursements/decimals/flags).

## ⛔ Pending — genuinely needs an OTP login + the loaded extension (can't be done headless)
1. **GATE: upload spike on the real form** — confirm the synthetic drop registers on the actual NX dropzone (general mechanism already proven). Run after logging in.
2. **Form-driver live validation** — confirm Angular change-detection fires for the dispatched dropdown/input events; tweak if needed.
3. **Crawl orchestration** — the SW drives the portal tab across navigations and chunks work around the ~30s/5-min service-worker limit (`chrome.alarms`/offscreen), checkpointing to `chrome.storage`. (Parsers are done; this is the live-only glue.)
4. **Onboarding discovery** — read payee/bank+currency/country/family from the logged-in form → confirm → `chrome.storage` (port of CLI `bin/discover.js`).
5. **Image auto-OCR** (optional) — `tesseract.js` in an offscreen document. Images already work via the **vision fallback** (agent reads with the user's OK), so this is an enhancement.

## How to pick it up
1. **See the tracker now (no portal):** `chrome://extensions` → Developer mode → **Load unpacked** → `extension/` → open the side panel → **Import CSV** → `data/claims-extension.csv` (generated from your last crawl). Dashboard should populate.
2. **Run the gate:** log into Allianz in the tool's Chrome, then drive the spike (point a fresh Claude session at this repo + `EXTENSION-GOAL.md`, or continue here): file the payee step and a synthetic-drop upload on the real form via `formDriver.js`; confirm it registers.
3. Then build items 3–6 above. The pure-logic libs need no further work.

## File map
- `extension/manifest.json` · `src/background/service-worker.js` · `src/content/{driver,formDriver,dropUpload}.js`
- `src/sidepanel/{panel.html,panel.js}` · `src/options/{options.html,options.js}`
- `src/lib/{parse,classify,enrich,policy,canonical,csv}.js`
