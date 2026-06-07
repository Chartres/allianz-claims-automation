#!/usr/bin/env node
/*
 * OPTIONAL: publish the same formula-driven workbook to a shared, cross-device Google Sheet.
 * Requires gws with the spreadsheets scope (see README → optional Google integration).
 * Most people should just use `node bin/report.js` for a local Excel file (no auth).
 *   node bin/sheets-push.js
 */
const fs = require('fs');
const path = require('path');
const C = require('../lib/config');
const workbook = require('../lib/workbook');
const sheets = require('../lib/sheets');

const cfg = C.load();
const dataFile = path.join(cfg._root, 'data', 'claims.json');
const policyFile = path.join(cfg._root, 'data', 'policy.json');
if (!fs.existsSync(dataFile)) { console.error('No data/claims.json — run bin/crawl.js first.'); process.exit(1); }
const { claims } = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const policy = fs.existsSync(policyFile) ? JSON.parse(fs.readFileSync(policyFile, 'utf8')) : null;
const { tabs } = workbook.build(claims, policy, cfg);

try {
  const s = sheets.ensureSpreadsheet(cfg, `Allianz Claims — ${cfg.portal.policyId}`, tabs.map(t => t.name));
  // write base/reference tabs first so formula tabs resolve
  const order = ['Invoices', 'Reimbursements', 'ProviderMap', 'Coverage', 'Claims', 'Policy', 'Overview', 'Breakdowns', 'Needs attention'];
  for (const name of order) {
    const tab = tabs.find(t => t.name === name);
    if (tab) sheets.setTab(s.spreadsheetId, name, tab.rows.map(row => row.length ? row : ['']));
  }
  console.log(`✅ Google Sheet updated:\n${s.url}`);
} catch (e) {
  console.error('Sheets push failed:', e.message);
  console.error('This path needs gws + the spreadsheets scope. For a no-auth local file, use:  node bin/report.js');
}
