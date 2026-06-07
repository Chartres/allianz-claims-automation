#!/usr/bin/env node
/*
 * Default tracker output — a formula-driven local Excel file (no auth, no cloud).
 *   node bin/report.js
 * Reads data/claims.json (+ data/policy.json), writes data/claims.xlsx and data/claims-overview.md.
 * Open the .xlsx in Excel, LibreOffice, Numbers, or import to Google Sheets — formulas recompute.
 * (For a shared cloud Google Sheet instead, use bin/sheets-push.js — that one needs gws.)
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const C = require('../lib/config');
const workbook = require('../lib/workbook');

(async () => {
  const cfg = C.load();
  const dataFile = path.join(cfg._root, 'data', 'claims.json');
  const policyFile = path.join(cfg._root, 'data', 'policy.json');
  if (!fs.existsSync(dataFile)) { console.error('No data/claims.json — run bin/crawl.js first.'); process.exit(1); }
  const { crawledAt, claims } = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const policy = fs.existsSync(policyFile) ? JSON.parse(fs.readFileSync(policyFile, 'utf8')) : null;
  const { tabs, enriched } = workbook.build(claims, policy, cfg);

  const wb = new ExcelJS.Workbook();
  wb.calcProperties.fullCalcOnLoad = true; // recompute formulas when opened
  for (const tab of tabs) {
    const ws = wb.addWorksheet(tab.name);
    tab.rows.forEach((row, ri) => {
      row.forEach((cell, ci) => {
        const c = ws.getCell(ri + 1, ci + 1);
        if (typeof cell === 'string' && cell.startsWith('=')) c.value = { formula: cell.slice(1) };
        else if (cell !== '' && cell != null) c.value = cell;
      });
      if (ri === 0) ws.getRow(1).font = { bold: true };
    });
    ws.columns.forEach(col => { let w = 10; col.eachCell({ includeEmpty: false }, c => { const l = String(c.value && c.value.formula ? '#' : c.value ?? '').length; if (l > w) w = l; }); col.width = Math.min(w + 2, 48); });
  }
  const out = path.join(cfg._root, 'data', 'claims.xlsx');
  await wb.xlsx.writeFile(out);

  // markdown summary
  const r = n => Math.round(n), sum = (a, f) => a.reduce((s, x) => s + f(x), 0), uniq = a => [...new Set(a)];
  const ti = sum(enriched, c => c.total_invoiced), tr = sum(enriched, c => c.total_reimbursed);
  const attn = enriched.filter(c => ['declined', 'under', 'over', 'review'].includes(c.check));
  const md = [`# Allianz claims overview\n\n_Crawled ${crawledAt} · ${enriched.length} claims_\n`,
    `- **Invoiced:** ${r(ti).toLocaleString()} CZK`, `- **Reimbursed:** ${r(tr).toLocaleString()} CZK (${ti ? (100 * tr / ti).toFixed(1) : 0}%)`,
    `- **Outstanding:** ${r(ti - tr).toLocaleString()} CZK`,
    `\n## Needs attention (${attn.length})\n`, '| Claim | Check | Invoiced | Reimbursed | Patients | Note |', '|---|---|---|---|---|---|',
    ...attn.map(c => `| ${c.id} | ${c.check} | ${r(c.total_invoiced)} | ${r(c.total_reimbursed)} | ${uniq(c.invoices.map(i => i.patient)).join(', ')} | ${c.check_note} |`)];
  fs.writeFileSync(path.join(cfg._root, 'data', 'claims-overview.md'), md.join('\n') + '\n');

  console.log(`✅ Wrote ${out}`);
  console.log(`   ${enriched.length} claims · ${attn.length} need attention (declined ${enriched.filter(c => c.check === 'declined').length}, under ${enriched.filter(c => c.check === 'under').length}).`);
  console.log(`   Open in Excel / LibreOffice / Numbers, or import to Google Sheets. Markdown summary: data/claims-overview.md`);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
