# Extension — install & distribution

Two ways to run the MV3 extension: **load unpacked** (dev / personal use, no store) and **Chrome
Web Store “Unlisted”** (link-only sharing). No Gmail/Sheets scopes → no Google OAuth verification
either way.

## A. Load unpacked (recommended — personal use, niche tool)

This is all you need to use it yourself or hand the folder to a trusted person.

1. `chrome://extensions` → toggle **Developer mode** (top-right).
2. **Load unpacked** → select the `extension/` folder.
3. Pin it; click the icon to open the side panel.

### First run (offline, no portal needed)
- Side panel → **Import CSV** `data/claims-extension.csv` → the dashboard populates (totals, needs-
  attention, by patient/category).
- Drop a PDF/photo into **File invoices** → it parses + classifies into the review list.

### Live (with the portal)
1. Log into Allianz in a tab (`my.allianzcare.com`).
2. **⚙ Set up from portal** → pick one sample invoice → it reads payee / bank+currency / country /
   family and saves a config to `chrome.storage`. Fine-tune in **Options**.
3. Put your invoices (and any supporting docs — dental plans, x-rays, prescriptions) in one folder;
   map the supporting docs in **Options → `supplementaryDocs`** (patient × docType → filename).
4. **Choose folder** (or drag-drop) → review list → tick the rows → **File selected**. It drives the
   form, attaches each invoice + its required docs, and **stops at the overview** for your review.
5. Submit from the portal (or the panel’s submit), then **↻ Refresh** to re-crawl the tracker.

> Caveat for unpacked installs: Chrome may show a “Disable developer-mode extensions” nag on each
> startup. Harmless — dismiss it. The Web Store route (below) removes it.

## B. Chrome Web Store — Unlisted (link-only)

Use this to share with others without a public listing or OAuth review.

1. One-time: register a Chrome Web Store developer account ($5 lifetime fee).
2. Zip the **contents** of `extension/` (manifest at the zip root, not nested in a folder).
3. [Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) → **New item** →
   upload the zip.
4. Fill the listing (name, description, 128px icon, ≥1 screenshot, privacy tab).
   - **Visibility: Unlisted** → only people with the link can install; not searchable, not featured.
   - **Permissions justification:** `storage` (config + tracker), `scripting`/`activeTab` (drive the
     form you’re viewing), `sidePanel`, `offscreen` (OCR photos), `alarms` (chunk the crawl),
     `downloads` (CSV export); host permission limited to `https://my.allianzcare.com/*`.
   - **Data use:** declare that all data stays local (chrome.storage / your folder); nothing is sent
     to any server. No Gmail/Sheets/identity scopes are requested.
5. Submit. Unlisted items still get a review, but with no sensitive OAuth scopes it’s lightweight.
6. Share the resulting `chromewebstore.google.com/detail/<id>` link.

### Why not self-hosted .crx?
Chrome blocks side-loaded `.crx` for normal users (`CRX_REQUIRED_PROOF_MISSING`) — only Web Store
or enterprise-policy installs are honored. So it’s **load-unpacked** (dev) or **Unlisted** (share).

## Privacy / data handling
- Everything is local: config + crawled claims in `chrome.storage.local`; invoices read from the
  folder **you** grant via the File System Access API (handle persisted in IndexedDB).
- No network calls except to the Allianz portal you’re already logged into.
- The AI vision fallback for unreadable photos is **opt-in per file** — nothing is read without your
  click.
- Repo hygiene: `config.json` and `data/` are gitignored; the bundled `config.default.json` is
  generic (placeholder names/accounts).
