# Allianz Care claims automation

Drop invoice PDFs in a folder → they get parsed, classified by treatment type, matched to the
right patient and supplementary documents (dental plan, X-rays, prescription, …), and filed as
claims on the [Allianz Care MyHealth portal](https://my.allianzcare.com). Everything family- and
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
| *Optional:* email intake + `_todo`→`_hotovo` labels | `brew install googleworkspace-cli` (`gws`) | Google OAuth |
| *Optional:* shared cloud **Google** Sheet instead of local Excel | `gws` (as above) | Google OAuth |

The tracker writes a **local Excel file** (`data/claims.xlsx`, formula-driven) by default — no Google
account needed. `gws` is only for the optional Gmail automation or a shared cloud sheet; without it,
just drag email attachments into `intake/` yourself.

## Onboarding (start here)

```bash
brew install node poppler        # runtime + pdftotext  (Chrome you already have)
npm install                      # playwright-core + exceljs
node bin/onboard.js              # strong-defaulted Q&A → writes config.json
```

`onboard.js` asks a handful of questions, each with a sensible **[default]** — press Enter to accept.
It covers your docs folder, portal URL + policy ID, bank-account match, country/currency, optional
Gmail label IDs, and family members (portal dropdown label + invoice name aliases). Re-run to edit.

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
- The portal session is short-lived and per-browser; if a run reports `NOT_LOGGED_IN`, log back in
  in the Chrome window and re-run.
- The portal is an NX/Angular app: dropdowns are `nx-dropdown` (open, then click `role=option`);
  file inputs accept `setInputFiles` (multi-file). Final submit is **SUBMIT CLAIM → AGREE AND PROCEED**.
- Newly submitted claims show **In-progress**; they flip to **Closed** once Allianz finishes (a few days).
- `archive/` holds the original exploratory one-off scripts from development (gitignored).
```
