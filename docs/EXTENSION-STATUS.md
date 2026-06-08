# Extension — build status (branch `chrome-extension`)

Honest state of the MV3 port. The brief is in `EXTENSION-GOAL.md`.

## ✅ Done & validated (autonomously testable)
- **Scaffold:** `manifest.json` (MV3, content script on allianzcare, side panel, options, offscreen/alarms perms, web_accessible_resources), service worker, content-script bridge.
- **Pure-logic brain → browser ESM, unit-tested** (`extension/src/lib/`): `parse` (invoice fields), `classify` (+ agent-forced type + injected `docAvailable`), `enrich` (per-invoice category/coverage/check), `policy`, `canonical`, `csv` (export **and** import, round-trip tested).
- **Dashboard** (`src/sidepanel/`): totals, needs-attention, claims, by patient/category/provider — from `chrome.storage`; CSV import/export buttons.
- **Options page:** config editor (chrome.storage).
- **Upload technique de-risked in real headless Chrome:** synthetic `DragEvent`+`DataTransfer` delivers a `File` to a dropzone handler. (`archive/technique-test.js`.)
- **Form-driver** (`src/content/formDriver.js`) + bridge (`driver.js`): payee step + addInvoice (synthetic-drop upload) + save + submit, ported from the proven CLI `lib/portal.js`. Syntax-valid; **not yet run against the live form.**

## ⛔ Pending — needs an OTP login and/or the loaded extension (can't be done headless)
1. **GATE: the upload spike on the real Allianz form** — confirm the synthetic drop registers on the actual NX/Angular dropzone (the general mechanism is proven; this is the site-specific confirmation). Run after logging in.
2. **Form-driver live validation** — confirm the Angular dropdown/input event-dispatch fires change detection on the real page; tweak if needed.
3. **Intake UI** — side-panel drop zone (fallback A) + File System Access "pick folder, rescan on open" (primary B) + review list → `FILE_INVOICES`.
4. **Text extraction** — vendor **pdf.js** (`pdfjs-dist`) for PDFs and **tesseract.js** (offscreen document) for photos into `extension/vendor/`; feed text to `parse.js`. AI vision fallback for unreadable photos.
5. **Onboarding discovery** — read payee/bank+currency/country/family from the logged-in form → confirm → `chrome.storage` (port of the CLI `bin/discover.js`).
6. **Chunked crawl** — drive the portal for claim history + policy; survive the ~30s/5-min service-worker limit via `chrome.alarms`/offscreen; checkpoint to `chrome.storage`.

## How to pick it up
1. **See the tracker now (no portal):** `chrome://extensions` → Developer mode → **Load unpacked** → `extension/` → open the side panel → **Import CSV** → `data/claims-extension.csv` (generated from your last crawl). Dashboard should populate.
2. **Run the gate:** log into Allianz in the tool's Chrome, then drive the spike (point a fresh Claude session at this repo + `EXTENSION-GOAL.md`, or continue here): file the payee step and a synthetic-drop upload on the real form via `formDriver.js`; confirm it registers.
3. Then build items 3–6 above. The pure-logic libs need no further work.

## File map
- `extension/manifest.json` · `src/background/service-worker.js` · `src/content/{driver,formDriver,dropUpload}.js`
- `src/sidepanel/{panel.html,panel.js}` · `src/options/{options.html,options.js}`
- `src/lib/{parse,classify,enrich,policy,canonical,csv}.js`
