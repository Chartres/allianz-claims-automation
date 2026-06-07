#!/usr/bin/env node
/*
 * Publish a FORMULA-DRIVEN Google Sheet from the crawled base data. Only raw facts are written as
 * values (each invoice's claim/patient/provider/date/amount, each reimbursement, each claim's
 * status, the policy table, and two small reference tables). Everything derived — per-invoice
 * category & coverage & expected, per-claim invoiced/reimbursed/expected/shortfall/ratio/check,
 * the totals and the breakdowns — is a live Google Sheets formula, so the whole workbook recomputes
 * itself off the base data. Also writes data/claims-overview.md. Run after bin/crawl.js (+ policy.js).
 */
const fs = require('fs');
const path = require('path');
const C = require('../lib/config');
const { enrich } = require('../lib/enrich');
const { canonicalProvider } = require('../lib/config');
const sheets = require('../lib/sheets');

const cfg = C.load();
const TOL = ((cfg.benefits && cfg.benefits.tolerancePct) != null ? cfg.benefits.tolerancePct : 5) / 100;
const dataFile = path.join(cfg._root, 'data', 'claims.json');
const policyFile = path.join(cfg._root, 'data', 'policy.json');
if (!fs.existsSync(dataFile)) { console.error('No data/claims.json — run bin/crawl.js first.'); process.exit(1); }
const { crawledAt, claims: rawClaims } = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const policy = fs.existsSync(policyFile) ? JSON.parse(fs.readFileSync(policyFile, 'utf8')) : null;
const enriched = rawClaims.map(c => enrich(c, cfg));   // for the local .md only

// ---------------- base data (values) ----------------
const allInv = rawClaims.flatMap(c => c.invoices.map(i => ({ claim: c.id, patient: i.patient, provider: canonicalProvider(cfg, i.provider), date: i.invoice_date, amount: Math.round(i.amount) })));
const allReimb = rawClaims.flatMap(c => c.reimbursements.map(r => ({ claim: c.id, date: r.date, category: r.category, to: r.reimbursed_to, method: r.method, amount: Math.round(r.amount) })));
const claimRows = rawClaims.slice().sort((a, b) => (b.received_iso || '').localeCompare(a.received_iso || ''));

// reference tables (config → sheet, so formulas can VLOOKUP)
const B = cfg.benefits || {};
const providerMap = [['Provider', 'Category'], ...Object.entries(B.providerCategory || {})];
const coverage = [['Category', 'Coverage %'], ...Object.entries(B.categoryCoverage || {})];
const defaultCat = B.defaultCategory || '';

// ---------------- Invoices (base + formula category/coverage/expected) ----------------
const invHeader = ['Claim', 'Patient', 'Provider', 'Invoice date', 'Amount CZK', 'Category', 'Coverage %', 'Expected CZK'];
const invData = allInv.map((i, n) => {
  const r = n + 2; // sheet row
  return [i.claim, i.patient, i.provider, i.date, i.amount,
    `=IFERROR(VLOOKUP(C${r},ProviderMap!$A:$B,2,FALSE),"${defaultCat}")`,
    `=IFERROR(VLOOKUP(F${r},Coverage!$A:$B,2,FALSE),"")`,
    `=IF(G${r}="","",ROUND(E${r}*G${r}/100,2))`];
});
const invoicesTab = [invHeader, ...invData];

// ---------------- Reimbursements (base) ----------------
const reimbTab = [['Claim', 'Date', 'Category', 'Reimbursed to', 'Method', 'Amount CZK'],
  ...allReimb.map(x => [x.claim, x.date, x.category, x.to, x.method, x.amount])];

// ---------------- Claims (base id/received/status + everything else formula) ----------------
const claimsHeader = ['Claim', 'Received', 'Month', 'Status', 'Invoiced', 'Reimbursed', 'Expected', 'Shortfall', 'Ratio', 'Check', 'Patients', 'Providers', 'Note'];
const claimsData = claimRows.map((c, n) => {
  const r = n + 2;
  return [c.id, c.received_date, (c.received_iso || '').slice(0, 7), c.status,
    `=SUMIF(Invoices!$A:$A,$A${r},Invoices!$E:$E)`,
    `=SUMIF(Reimbursements!$A:$A,$A${r},Reimbursements!$F:$F)`,
    `=SUMIF(Invoices!$A:$A,$A${r},Invoices!$H:$H)`,
    `=E${r}-F${r}`,
    `=IF(E${r}=0,"",F${r}/E${r})`,
    `=IF(REGEXMATCH(D${r},"(?i)progress|pending|received|open"),"pending",IF(AND(F${r}=0,E${r}>0),"declined",IF(ABS(F${r}-G${r})<=MAX(2,E${r}*${TOL}),"ok",IF(F${r}<G${r},"under","over"))))`,
    `=IFERROR(TEXTJOIN(", ",TRUE,UNIQUE(FILTER(Invoices!$B:$B,Invoices!$A:$A=$A${r}))),"")`,
    `=IFERROR(TEXTJOIN(", ",TRUE,UNIQUE(FILTER(Invoices!$C:$C,Invoices!$A:$A=$A${r}))),"")`,
    `=IFS(J${r}="declined","Turned down — check claim update / may need material",J${r}="under","Reimbursed < expected — verify cap/deductible/FX",J${r}="over","Reimbursed > expected — verify",J${r}="pending","Processing",TRUE,"")`];
});
const claimsTab = [claimsHeader, ...claimsData];

// ---------------- Policy (base) ----------------
const policyTab = [['Benefit', 'Plan', 'Coverage %', 'Limit €', 'Remaining €', 'Detail']];
if (policy) for (const b of policy.benefits) policyTab.push([b.name, b.plan || '', b.coinsurance ?? '', b.limit_eur ?? '', b.remaining_eur ?? '', b.raw || '']);

// ---------------- Overview (formula totals) ----------------
const overview = [
  ['ALLIANZ CLAIMS — OVERVIEW (live formulas)'],
  ['Claims crawled', crawledAt],
  ['Policy period', policy && policy.period ? `${policy.period.from}–${policy.period.to} (hash ${policy.hash})` : ''],
  [],
  ['Claims', '=COUNTA(Claims!A2:A)'],
  ['Invoiced CZK', '=SUM(Invoices!E2:E)'],
  ['Reimbursed CZK', '=SUM(Reimbursements!F2:F)'],
  ['Expected CZK (policy)', '=SUM(Invoices!H2:H)'],
  ['Outstanding CZK', '=SUM(Invoices!E2:E)-SUM(Reimbursements!F2:F)'],
  ['Reimbursement rate', '=IFERROR(SUM(Reimbursements!F2:F)/SUM(Invoices!E2:E),0)'],
  ['Declined claims', '=COUNTIF(Claims!J2:J,"declined")'],
  ['Under-paid claims', '=COUNTIF(Claims!J2:J,"under")'],
  [],
  ['Dental plan remaining €', `=IFERROR(VLOOKUP("${(cfg.benefits && cfg.benefits.dentalPlanBenefitName) || ''}",Policy!A:E,5,FALSE),"")`, 'of', `=IFERROR(VLOOKUP("${(cfg.benefits && cfg.benefits.dentalPlanBenefitName) || ''}",Policy!A:E,4,FALSE),"")`],
];

// ---------------- Breakdowns (QUERY group-bys, in column blocks so spills don't collide) ----------------
const breakdowns = [[
  `=QUERY(Claims!A1:M,"select J, count(J), sum(E), sum(F) where A is not null group by J order by sum(E) desc label J 'By check', count(J) 'Claims', sum(E) 'Invoiced', sum(F) 'Reimbursed'",1)`,
  '', '', '', '',
  `=QUERY(Invoices!A1:H,"select B, count(B), sum(E), sum(H) where A is not null group by B order by sum(E) desc label B 'By patient', count(B) 'Inv', sum(E) 'Invoiced', sum(H) 'Expected'",1)`,
  '', '', '', '',
  `=QUERY(Invoices!A1:H,"select F, count(F), sum(E), sum(H) where A is not null group by F order by sum(E) desc label F 'By category', count(F) 'Inv', sum(E) 'Invoiced', sum(H) 'Expected'",1)`,
  '', '', '', '',
  `=QUERY(Invoices!A1:H,"select C, count(C), sum(E) where A is not null group by C order by sum(E) desc label C 'By provider', count(C) 'Inv', sum(E) 'Invoiced'",1)`,
  '', '', '',
  `=QUERY(Claims!A1:M,"select C, count(C), sum(E), sum(F) where A is not null group by C order by C label C 'By month', count(C) 'Claims', sum(E) 'Invoiced', sum(F) 'Reimbursed'",1)`,
]];

// ---------------- Needs attention (live FILTER on Claims) ----------------
const needsAttention = [[
  `=QUERY(Claims!A1:M,"select A,B,D,J,E,F,G,H,K,M where J='declined' or J='under' or J='over' or J='review' label A 'Claim',B 'Received',D 'Status',J 'Check',E 'Invoiced',F 'Reimbursed',G 'Expected',H 'Shortfall',K 'Patients',M 'Note'",1)`
]];

// ---------------- local markdown (precomputed copy) ----------------
const r = n => Math.round(n), uniq = a => [...new Set(a)], sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const totInv = sum(enriched, c => c.total_invoiced), totReimb = sum(enriched, c => c.total_reimbursed);
const md = [`# Allianz claims overview\n\n_Crawled ${crawledAt} · ${enriched.length} claims_\n`,
  `- **Invoiced:** ${r(totInv).toLocaleString()} CZK`,
  `- **Reimbursed:** ${r(totReimb).toLocaleString()} CZK (${totInv ? (100 * totReimb / totInv).toFixed(1) : 0}%)`,
  `- **Outstanding:** ${r(totInv - totReimb).toLocaleString()} CZK`];
const attn = enriched.filter(c => ['declined', 'under', 'over', 'review'].includes(c.check));
md.push(`\n## Needs attention (${attn.length})\n`, '| Claim | Check | Invoiced | Reimbursed | Expected | Patients | Note |', '|---|---|---|---|---|---|---|');
attn.forEach(c => md.push(`| ${c.id} | ${c.check} | ${r(c.total_invoiced)} | ${r(c.total_reimbursed)} | ${c.expected_reimbursed ?? ''} | ${uniq(c.invoices.map(i => i.patient)).join(', ')} | ${c.check_note} |`));
fs.writeFileSync(path.join(cfg._root, 'data', 'claims-overview.md'), md.join('\n') + '\n');

// ---------------- push ----------------
console.log(`Base data: ${claimRows.length} claims, ${allInv.length} invoices, ${allReimb.length} reimbursements. Workbook is formula-driven.`);
try {
  const tabs = ['Overview', 'Claims', 'Invoices', 'Reimbursements', 'Policy', 'ProviderMap', 'Coverage', 'Breakdowns', 'Needs attention'];
  const s = sheets.ensureSpreadsheet(cfg, `Allianz Claims — ${cfg.portal.policyId}`, tabs);
  sheets.setTab(s.spreadsheetId, 'Invoices', invoicesTab);          // base first (formulas depend on it)
  sheets.setTab(s.spreadsheetId, 'Reimbursements', reimbTab);
  sheets.setTab(s.spreadsheetId, 'ProviderMap', providerMap);
  sheets.setTab(s.spreadsheetId, 'Coverage', coverage);
  sheets.setTab(s.spreadsheetId, 'Claims', claimsTab);
  sheets.setTab(s.spreadsheetId, 'Policy', policyTab);
  sheets.setTab(s.spreadsheetId, 'Overview', overview.map(row => row.length ? row : ['']));
  sheets.setTab(s.spreadsheetId, 'Breakdowns', breakdowns);
  sheets.setTab(s.spreadsheetId, 'Needs attention', needsAttention);
  console.log(`\n✅ Google Sheet (formula-driven) updated:\n${s.url}`);
} catch (e) {
  console.error('\nSheets push skipped:', e.message);
}
