# Chrome MV3 extension — build brief

A browser-extension version of this tool. Files Allianz Care claims and shows a reimbursement
tracker, all inside the **already-logged-in Allianz tab** (content script — no Playwright/CDP, which
removes the session/login pain). **No Gmail/Sheets** in this version → no sensitive OAuth scopes →
no Google verification. Build on a branch; commit nothing personal; **de-risk the upload first**.

## Architecture
- **Content script** drives the NX/Angular claim form: open `nx-dropdown`s + click `role=option` via
  dispatched mouse events; set date/amount via `input` events.
- **Parsing in-browser:** PDFs via **pdf.js**; photos via **tesseract.js** in an **offscreen document**.
  **AI vision fallback:** if a photo can't be OCR'd, flag it and let the user opt in to the model
  reading it (sidecar shape `{patient,date,amount,provider,treatmentType}`); never file blind.
- **Reuse the pure-logic libs ~verbatim:** `classify`, `enrich`, `workbook`, `policy`, config/patient/
  provider matching. Config-driven (same `config.json` shape), editable in an **options page**.
- **Store everything** (config, crawled claims, policy) in **`chrome.storage.local`** (not localStorage).

## File intake — B primary, A fallback
- **B (primary):** File System Access API — user picks an invoices folder once; persist the directory
  handle; on opening the side panel, **rescan that folder** for new files (handle re-permission gracefully).
- **A (fallback):** a **drag-drop zone** in the side panel to drop files directly.

## Upload into the portal (the hard part)
Extensions can't `setInputFiles`, so build a `File` + `DataTransfer` in JS and dispatch a synthetic
`drop` on the form's "Drag and drop invoice here" zone.
**SPIKE THIS FIRST:** a content script that fills the payee step and uploads one invoice via synthetic
drag-drop on the real form. Prove the upload registers — gate the project on it — then continue.

## User journey
- **One-time:** install; log into Allianz; first run auto-discovers settings from the form (payee,
  bank+currency, country, family from the patient dropdown) → user confirms → `chrome.storage`.
- **Each batch:** open side panel → it rescans the granted folder (or you drop files) → parses +
  classifies + matches patient/required docs → **review list** (patient·date·amount·type + flags:
  unreadable photo, missing plan, unknown patient) → user confirms → drives the tab to file each
  invoice, **STOPS at the overview** for review, then submits.
- **Anytime:** a dynamic **dashboard** (side panel/options page) from `chrome.storage` — claims
  row-by-row, aggregates (by patient/category/provider/month/status), and a **"needs attention"** list
  (declined/under-paid). **Refresh = re-crawl.** **Export CSV/.xlsx** and **Import CSV** (round-trip:
  re-load a previously exported CSV to restore/merge the tracker).

## Tracker crawl
Crawl full claim history + policy from the logged-in portal. The MV3 service worker dies ~30s idle /
5-min cap, so **chunk** the crawl via `chrome.alarms` and/or an offscreen document; **checkpoint** to
`chrome.storage` so it resumes.

## Build order
1. **Spike** synthetic drag-drop upload + payee fill on the real form (gate on this).
2. Full filing flow (folder/drop → parse → review → drive form → submit).
3. Onboarding auto-discovery + options page.
4. Crawl + `chrome.storage` + dashboard + CSV export **and import**.

## Distribution
- Dev: **load unpacked**. Later: Chrome Web Store **"Unlisted"** (link-only, not public). No Gmail/Sheets
  → no OAuth verification.

> Reusable from the CLI repo: the pure-logic libs port directly; the I/O layer (PDF/OCR/portal-driving/
> storage) is rewritten for the browser. See the CLI's `lib/` for the proven selectors and parsing logic.
