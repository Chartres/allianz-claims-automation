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

## 🧩 Built end-to-end (all 4 steps) — remaining work is LIVE VALIDATION, not coding
Everything is now implemented and committed:
- **Crawl orchestration** (`src/background/service-worker.js`): `CRAWL` drives the portal tab via `chrome.scripting`, parses with `crawl.js`, checkpoints per claim to `chrome.storage` (resumes by skipping finalized claims).
- **Onboarding discovery** (`formDriver.discover` + `DISCOVER` bridge + panel "⚙ Set up from portal"): reads payee/method/bank+currency/country/family from the live form; bundled `config.default.json` seeds a working config.
- **Filing flow**, **intake**, **dashboard/CSV**, **PDF parsing**, **upload helper** — all present.

These need a logged-in portal + the loaded extension to *verify/tune* (I can't, solo):
1. **GATE: upload spike — ✅ CLEARED (2026-06-08).** Ran live against the real form: synthetic `drop`
   on `NX-FILE-UPLOADER-DROP-ZONE` registered the file (invoice-info fields revealed + filename/size
   shown). The project's core unknown is resolved — the extension upload approach works on the portal.
   (Validated in page/MAIN world via the CLI session; the loaded extension's ISOLATED-world content
   script uses the identical File+DataTransfer dispatch.)
2. **Form-driver** — confirm Angular change-detection fires for dispatched dropdown/input events.
3. **Crawl** — tune navigation timing / SW-lifetime chunking on a real history.
4. **Discovery** — confirm the live reads.
5. **Image auto-OCR** — `tesseract.js` in an offscreen document: **built** (OCR validated offline on a real invoice image → correct fields); the offscreen/asset-path wiring is pending live load. HEIC + OCR failures fall back to the vision path.

**Every architecture item and build-order step now has an implementation.** The only outstanding work is the live validation in items 1–4 above (OTP login + loaded extension).

## How to validate (you, once)
1. `chrome://extensions` → Developer mode → **Load unpacked** → `extension/`.
2. **Offline check (no login):** side panel → **Import CSV** `data/claims-extension.csv` (dashboard populates); drop a PDF in "File invoices" (it parses + classifies in the review list).
3. **Live:** log into Allianz in a tab → **⚙ Set up from portal** (pick a sample invoice) → then **File selected** on a review row (watch it drive the form + stop at the overview), and **↻ Refresh** to crawl. Report anything that misbehaves and it's a quick fix.

## How to pick it up
1. **See the tracker now (no portal):** `chrome://extensions` → Developer mode → **Load unpacked** → `extension/` → open the side panel → **Import CSV** → `data/claims-extension.csv` (generated from your last crawl). Dashboard should populate.
2. **Run the gate:** log into Allianz in the tool's Chrome, then drive the spike (point a fresh Claude session at this repo + `EXTENSION-GOAL.md`, or continue here): file the payee step and a synthetic-drop upload on the real form via `formDriver.js`; confirm it registers.
3. Then build items 3–6 above. The pure-logic libs need no further work.

## File map
- `extension/manifest.json` · `src/background/service-worker.js` · `src/content/{driver,formDriver,dropUpload}.js`
- `src/sidepanel/{panel.html,panel.js}` · `src/options/{options.html,options.js}`
- `src/lib/{parse,classify,enrich,policy,canonical,csv}.js`
