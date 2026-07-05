# Allianz Care claims automation

> **Setting up with an AI agent?** Just point Claude Code / Codex / Cursor at this repo and say
> *"set this up for me"* — the README + `bin/onboard.js`/`bin/discover.js` are designed for an agent
> to read and drive end-to-end. (Optional: connect the **Context7** MCP so the agent pulls current
> docs for `playwright-core` / `exceljs`.)
>
> **Vision fallback for photos:** if `tesseract` can't read a photo, `intake.js` flags it as
> *"needs agent vision"*. The driving agent should — **with the user's OK** — open the image, read the
> fields, and drop a sidecar `intake/<image>.json` (`{patient, date "DD/MM/YYYY", amount, provider,
> treatmentType}`); the tool then uses that instead of OCR. No OCR engine or API key required for this path.

Drop invoice **PDFs or photos** (JPG/PNG/HEIC…) in a folder → they get parsed (PDFs via `pdftotext`,
images via `tesseract` OCR), classified by treatment type, matched to the right patient and
supplementary documents (dental plan, X-rays, prescription, …), and filed as claims on the
[Allianz Care MyHealth portal](https://my.allianzcare.com). Everything family- and
treatment-specific lives in `config.json`, so anyone can use it with their own names and documents.

## How it works

```
intake/  ──parse──▶  classify ──match docs/payment──▶  drive portal ──▶  submit ──▶  _processed/
 (PDFs)              (config.treatmentTypes)            (Playwright/CDP)            (+ relabel Gmail)
```

- **`lib/pdf.js`** — `pdftotext` → `{ faktura, patient, date, amount, paid, items }`
- **`lib/classify.js`** — keyword-scores items into a `treatmentType`; resolves required docs; applies per-patient overrides
- **`lib/portal.js`** — the NX/Angular portal driver over Chrome DevTools Protocol (payee step → add invoice → submit)
- **`lib/gmail.js`** — `gws` wrappers to pull email attachments and move `_todo`→`_hotovo`
- **`bin/intake.js`** — the end-to-end surface (dry-run / fill / submit)

## Dependencies

Everything you need for the core tool is a single `brew`/`npm` install with **no accounts or auth**:

| Need it for | Install | Auth/setup? |
|---|---|---|
| **Core** (drive the portal, build the Excel tracker) | `brew install node` · Google Chrome · `npm install` | none |
| **Filing from PDFs** (parse invoices) | `brew install poppler` (`pdftotext`) | none |
| **Filing from photos/images** (OCR JPG/PNG/HEIC…) | `brew install tesseract` (+ Czech: drop `ces.traineddata` into `$(brew --prefix)/share/tessdata`) | none |
| *Optional:* email intake + `_todo`→`_hotovo` labels | `brew install googleworkspace-cli` (`gws`) | Google OAuth |
| *Optional:* shared cloud **Google** Sheet instead of local Excel | `gws` (as above) | Google OAuth |

The tracker writes a **local Excel file** (`data/claims.xlsx`, formula-driven) by default — no Google
account needed. `gws` is only for the optional Gmail automation or a shared cloud sheet; without it,
just drag email attachments into `intake/` yourself.

## Onboarding (start here)

```bash
brew install node poppler        # runtime + pdftotext  (Chrome you already have)
npm install                      # playwright-core + exceljs
```

**Recommended — auto-discover from the portal + a sample invoice (you just confirm):**
```bash
node bin/launch-chrome.js        # opens the tool's own Chrome; log in there (it waits & confirms)
node bin/discover.js invoice.pdf # reads payee/bank/country + your family from the portal, parses the
                                 # sample invoice, shows each value → press Enter to accept → config.json
```
`discover.js` pulls your **saved bank accounts**, payee/payment-method options, country, and the
**patient dropdown** (your family members with their exact portal labels) straight from the logged-in
site, and reads the sample invoice for provider/patient hints — so you confirm rather than type. It
uploads the sample only to reveal those fields, then abandons the draft (nothing is submitted).

**Manual alternative** — strong-defaulted Q&A (no browser needed):
```bash
node bin/onboard.js              # press Enter to accept each [default]; re-run anytime to edit
```

<details><summary>Optional Google integration (Gmail intake / cloud sheet)</summary>

Install `gws` (`brew install googleworkspace-cli`), create a **Desktop** OAuth client in Google Cloud
Console, save it to `~/.config/gws/client_secret.json`, enable the Gmail/Sheets APIs for the project, and:
```bash
gws auth login --scopes "https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive.file"
```
</details>

### What's in config.json
- **patients** — portal dropdown label + invoice-name aliases.
- **providers / benefits** — provider → benefit **category**, and category → expected **co-insurance %**
  (from your policy). Drives per-invoice expected reimbursement and the payout check.
- **treatmentTypes** — portal category/subtype/reason + required supplementary docs, per treatment.
- **supplementaryDocs / patientOverrides** — doc files per patient, and per-patient rules.

## Usage

```bash
node bin/launch-chrome.js          # opens an isolated Chrome on the portal — log in (email+pwd+OTP) once
# drop invoice PDFs into ./intake/  (or: node bin/gmail-pull.js  to pull them from Gmail)

node bin/intake.js                 # DRY RUN: prints the plan + flags issues, files nothing
node bin/intake.js --file          # fills one claim with all ready invoices, stops at the overview to review
node bin/intake.js --submit        # fills + submits + moves PDFs to intake/_processed/

node bin/reconcile.js              # prints claims history (id / date / status) to verify they landed
```

### What `intake.js` handles automatically
- **Right patient, not the payer or the dentist.** The patient is read from the invoice recipient
  (Odběratel / Bill to), matched on full-name aliases — so a treating clinician who shares a first
  name with a family member (e.g. dentist *MDDr. Pavol Čurilla* vs patient *Pavol*) is never mistaken
  for the patient.
- **Deduplicates copies.** The same invoice often arrives two or three times (original + reissued
  *paid* copy + a receipt). Entries sharing a faktura number are collapsed to one, keeping the paid copy.
- **Skips already-filed invoices.** If `data/claims.json` exists (run `npm run crawl` first), invoices
  that match an existing claim by patient + date + amount are reported and skipped — no duplicate claims.
- **Orthodontic supplementary docs.** Orthodontic treatment requires a **dental/treatment plan** and
  **OPG panoramic X-ray/intra-oral photos** upload. List them in `treatmentTypes.orthodontic.requiredDocs`
  and map the files per patient in `supplementaryDocs`; intake attaches them to the right upload slots.
- **Mixed invoice formats.** Dates are parsed across the `DD.MM.YYYY` / `D.M.YYYY` / `D/M/YYYY` /
  `Invoice date:` variants; classification tolerates the intra-word spaces `pdftotext` sometimes injects.

Run the logic self-check any time with `npm test` (no portal or network needed).

**`reference/allianz-portal-reference.json`** is the committed, non-personal catalog of the whole
portal: payee and payment-method options, the 112 reimbursement currencies, the 244 treatment
countries, all 15 treatment categories with their sub-treatments, the diagnosis reasons, and the two
required accident/other-insurer questions. `config.example.json` fields (`treatmentTypes[].category`/
`subtype`/`reason`, `portal.payee`/`paymentMethod`/`currencyMatch`/`countryMatch`) must be exact
strings from it — so onboarding is mostly copy-from-reference, no portal spelunking. `discover.js`
regenerates the category tree into `data/treatment-catalog.json` from your own logged-in portal.

## Claims & reimbursements tracker

Crawls the whole portal history + your policy, checks every reimbursement against the policy, and
builds a formula-driven **local Excel file** `data/claims.xlsx` (plus `data/claims.json`,
`data/policy.json`, `data/claims-overview.md`). No account or auth required.

```bash
npm run track          # = policy.js → crawl.js → report.js  (one command to refresh everything)
# or individually:
node bin/policy.js     # ingest My Benefits → data/policy.json (hashed; only rewrites when it changes)
node bin/crawl.js      # crawl claims → data/claims.json  (--all to re-crawl; or a year e.g. 2026)
node bin/report.js     # → data/claims.xlsx (open in Excel/LibreOffice/Numbers/Sheets)

node bin/sheets-push.js  # OPTIONAL: same workbook to a shared cloud Google Sheet (needs gws)
```

The workbook is **formula-driven**: only raw facts are values (invoice lines, reimbursements, claim
status, the policy table, two reference tabs). Category, coverage, expected, totals, per-claim checks
and the breakdowns are universal spreadsheet formulas (`SUMIF`/`COUNTIF`/`IF`/`VLOOKUP`) that recompute
in Excel, LibreOffice, Numbers or Google Sheets — edit a base cell and everything updates.

- **Per-invoice category:** every invoice is tagged with its benefit category (from its provider) and
  the policy's expected co-insurance %, so a multi-invoice claim shows each line's own category.
- **Reimbursement check:** per claim, expected = Σ(invoice × coverage%). Each claim is flagged
  `ok` / `under` / `over` / `declined` / `pending`. (Annual caps, deductibles and EUR↔CZK FX aren't
  modelled, so `under`/`over`/`review` means *verify*, not *definitely wrong*.)
- **Policy in the DB:** stored in `data/policy.json` with a content hash; re-running `policy.js` only
  rewrites on a real change and appends to `data/policy-history.json`.

Sheet tabs: **Overview** (totals + breakdowns by check-status, patient, category, provider, month +
policy remaining-this-year), **Claims** (invoiced vs reimbursed vs expected, check, note), **Invoices**
(per-line category + coverage + expected), **Reimbursements**, **Policy** (benefits, limits, remaining,
%), **Needs attention** (declined / under-paid claims — the ones to chase or resubmit).

**Resumable:** the crawler checkpoints after every claim and, if the portal logs out mid-run, saves
progress and exits — just log back in and re-run to continue. It's incremental by default
(re-crawls only new claims + any still in-progress); `--all` forces a full re-crawl.

Invoices with blocking issues (unknown patient, missing required docs, unclassified, no amount) are
**reported and skipped**, never filed blind. Add the missing doc to `data/` + `config.supplementaryDocs`,
or fix the patient alias, then re-run.

### Proof of payment
Allianz reimburses **paid** invoices. Two ways to satisfy it:
- File the *paid* version of the invoice (issuer reissues with "Zbývá uhradit: 0"), **or**
- Drop the bank payment confirmation PDF in `confirmations/`. Intake matches it to the invoice by
  variabilní symbol (faktura number) and attaches it to the claim as proof.

## Adding a person / treatment / document

- **New family member** → add to `config.patients` (`portalLabel` must match the portal's patient
  dropdown text exactly; `aliases` are how their name appears on invoices).
- **New treatment type** (e.g. physiotherapy, prescription meds) → add to `config.treatmentTypes`
  with its portal `category`/`subtype`/`reason`, `keywords`, and any `requiredDocs`.
- **Supplementary material** (dental plan, OPG/X-ray, prescription for prescription meds) → put the
  files under `data/<Patient>/` and reference them in `config.supplementaryDocs.<docType>.<Patient>`.
- **Per-patient rule** → `config.patientOverrides` (e.g. file someone's ortho visits as routine when
  no treatment plan exists).

## Notes / gotchas
- **Log in to the right window.** The tool drives a *separate* Chrome with its own blank profile (the
  one `bin/launch-chrome.js` opens), not your everyday Chrome. Log in there — `launch-chrome.js` watches
  that exact browser and prints "✅ Logged in" once it sees the session, so there's no guessing.
- The portal session is short-lived and per-browser; if a run reports `NOT_LOGGED_IN`, re-run
  `bin/launch-chrome.js`, log in again, and resume (the crawler picks up where it left off).
- The portal is an NX/Angular app: dropdowns are `nx-dropdown` (open, then click `role=option`);
  file inputs accept `setInputFiles` (multi-file). Final submit is **SUBMIT CLAIM → AGREE AND PROCEED**.
- **Payee step order matters.** The saved bank accounts render *only after* the reimbursement
  currency is chosen and are filtered by it, so currency must be set first. Some policies also gate
  Continue on two required questions ("...as a result of an accident?" / "...insured by another
  provider?") — both are answered *No*. The driver handles all of this and is a no-op where a policy
  doesn't show them.
- Newly submitted claims show **In-progress**; they flip to **Closed** once Allianz finishes (a few days).
- `archive/` holds the original exploratory one-off scripts from development (gitignored).
```
