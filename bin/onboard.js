#!/usr/bin/env node
/*
 * Interactive onboarding — strong-defaulted questions that write config.json.
 *   node bin/onboard.js
 * Every question has a sensible default in [brackets]; press Enter to accept. Re-run anytime to edit
 * (it pre-fills from your existing config.json).
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const cfgFile = path.join(ROOT, 'config.json');
const exFile = path.join(ROOT, 'config.example.json');
const base = JSON.parse(fs.readFileSync(fs.existsSync(cfgFile) ? cfgFile : exFile, 'utf8'));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def) => new Promise(res => rl.question(`${q}${def !== undefined && def !== '' ? ` [${def}]` : ''}: `, a => res(a.trim() || def)));
const askYN = async (q, def = 'y') => /^y/i.test(await ask(`${q} (y/n)`, def));

(async () => {
  console.log('\n— Allianz claims automation onboarding —\nPress Enter to accept the [default].\n');
  const cfg = JSON.parse(JSON.stringify(base));

  cfg.docsBaseDir = await ask('Folder holding your supplementary docs (plans, X-rays, prescriptions)', cfg.docsBaseDir);
  cfg.portal.url = await ask('Portal base URL', cfg.portal.url);
  cfg.portal.policyId = await ask('Policy / member ID (digits in the claim-detail URL)', cfg.portal.policyId);
  cfg.portal.bankAccountMatch = await ask('Reimbursement bank account — last digits to match', cfg.portal.bankAccountMatch);
  cfg.portal.countryMatch = await ask('Country of treatment', cfg.portal.countryMatch);
  cfg.portal.currencyMatch = await ask('Currency match (regex)', cfg.portal.currencyMatch);

  if (await askYN('\nSet up Gmail labels (for email intake + _todo→_hotovo)?', fs.existsSync(cfgFile) ? 'n' : 'y')) {
    cfg.gmail.todoLabelId = await ask('  _todo label id (list_labels via gws)', cfg.gmail.todoLabelId);
    cfg.gmail.hotovoLabelId = await ask('  _hotovo label id', cfg.gmail.hotovoLabelId);
  }

  if (await askYN('\nConfigure family members now?', 'y')) {
    const patients = {};
    let first = true;
    do {
      const key = await ask('  Short name (e.g. Alex), blank to stop', first ? '' : '');
      first = false;
      if (!key) break;
      const portalLabel = await ask(`    Exact portal dropdown text for ${key}`, `${key} Surname (2010)`);
      const aliases = (await ask(`    Name(s) as they appear on invoices (comma-separated)`, portalLabel.replace(/\s*\(\d+\)/, ''))).split(',').map(s => s.trim()).filter(Boolean);
      patients[key] = { portalLabel, aliases };
    } while (await askYN('  Add another?', 'y'));
    if (Object.keys(patients).length) cfg.patients = patients;
  }

  delete cfg._readme;
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  console.log(`\n✓ Wrote ${cfgFile}`);
  console.log('Next:');
  console.log('  1. npm install');
  console.log('  2. brew install poppler googleworkspace-cli   # pdftotext + gws');
  console.log('  3. gws auth login --scopes "https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive.file"');
  console.log('  4. node bin/launch-chrome.js   → log in (email+password+OTP)');
  console.log('  5. node bin/policy.js  &&  node bin/crawl.js  &&  node bin/sheets-push.js');
  rl.close();
})().catch(e => { console.error(e); rl.close(); process.exit(1); });
