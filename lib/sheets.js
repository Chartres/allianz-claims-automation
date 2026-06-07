// Google Sheets writer via gws (needs the spreadsheets scope). Stores the sheet id in data/sheet-id.txt
// so the same cross-device spreadsheet is reused/overwritten on each push.
const fs = require('fs');
const path = require('path');
const { gws, gwsJson } = require('./gmail');

function idFile(cfg) { return path.join(cfg._root, 'data', 'sheet-id.txt'); }

function createSpreadsheet(title, tabs) {
  const body = { properties: { title }, sheets: tabs.map(t => ({ properties: { title: t } })) };
  const d = gwsJson(['sheets', 'spreadsheets', 'create', '--json', JSON.stringify(body)]);
  if (!d || !d.spreadsheetId) throw new Error('create failed: ' + (gws(['sheets', 'spreadsheets', 'create', '--json', JSON.stringify(body)]).slice(0, 200)));
  return { spreadsheetId: d.spreadsheetId, url: d.spreadsheetUrl };
}

function ensureSpreadsheet(cfg, title, tabs) {
  const f = idFile(cfg);
  if (fs.existsSync(f)) {
    const id = fs.readFileSync(f, 'utf8').trim();
    // verify it still exists
    const d = gwsJson(['sheets', 'spreadsheets', 'get', '--params', JSON.stringify({ spreadsheetId: id })]);
    if (d && d.spreadsheetId) {
      // ensure all needed tabs exist
      const have = new Set((d.sheets || []).map(s => s.properties.title));
      const add = tabs.filter(t => !have.has(t));
      if (add.length) gwsJson(['sheets', 'spreadsheets', 'batchUpdate', '--params', JSON.stringify({ spreadsheetId: id }),
        '--json', JSON.stringify({ requests: add.map(t => ({ addSheet: { properties: { title: t } } })) })]);
      return { spreadsheetId: id, url: d.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}` };
    }
  }
  const s = createSpreadsheet(title, tabs);
  fs.writeFileSync(f, s.spreadsheetId);
  return s;
}

function setTab(spreadsheetId, tab, values) {
  gwsJson(['sheets', 'spreadsheets', 'values', 'clear', '--params', JSON.stringify({ spreadsheetId, range: `${tab}!A1:ZZ100000` }), '--json', '{}']);
  gwsJson(['sheets', 'spreadsheets', 'values', 'update',
    '--params', JSON.stringify({ spreadsheetId, range: `${tab}!A1`, valueInputOption: 'USER_ENTERED' }),
    '--json', JSON.stringify({ values })]);
}

module.exports = { ensureSpreadsheet, createSpreadsheet, setTab };
