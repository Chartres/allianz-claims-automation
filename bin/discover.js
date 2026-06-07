#!/usr/bin/env node
/*
 * Auto-onboarding: discover your settings from the logged-in Allianz portal + a sample invoice,
 * then you confirm — instead of typing everything into config.json by hand.
 *
 *   node bin/launch-chrome.js          # first: open the tool's Chrome and log in
 *   node bin/discover.js [sample.pdf]  # then: discover (uses a PDF you pass, else first in intake/)
 *
 * It reads: payee + payment-method options, your saved bank accounts, country, and the patient
 * dropdown (your family members, with the exact portal labels). It uploads the sample invoice only
 * to reveal those fields, then abandons the draft (nothing is submitted).
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const C = require('../lib/config');
const portal = require('../lib/portal');
const { text: pdfText } = require('../lib/pdf');

const cfg = C.load();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def) => new Promise(r => rl.question(`${q}${def ? ` [${def}]` : ''}: `, a => r(a.trim() || def)));

function findSample() {
  if (process.argv[2] && fs.existsSync(process.argv[2])) return process.argv[2];
  const intake = path.join(cfg._root, 'intake');
  const pdf = fs.existsSync(intake) && fs.readdirSync(intake).find(f => f.toLowerCase().endsWith('.pdf'));
  return pdf ? path.join(intake, pdf) : null;
}

(async () => {
  const sample = findSample();
  if (!sample) { console.error('Give a sample invoice: node bin/discover.js path/to/invoice.pdf  (or drop one in intake/).'); process.exit(1); }
  console.log(`Sample invoice: ${path.basename(sample)}`);

  const browser = await portal.connect(cfg);
  const page = await portal.getPage(browser);
  if (!page || !await portal.isLoggedIn(page)) { console.error('Not logged in. Run: node bin/launch-chrome.js  and log in first.'); process.exit(1); }

  const found = { payee: [], method: [], banks: [], countries: [], patients: [] };

  // --- payee step ---
  await page.goto(`${cfg.portal.url}/claims/list`); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /submit a claim/i }).first().click({ timeout: 8000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1800);
  const opts = async id => { await page.locator('#' + id).click({ timeout: 6000 }); await page.waitForTimeout(600); const o = await page.getByRole('option').allInnerTexts(); await page.keyboard.press('Escape'); return o.map(s => s.trim()); };
  found.payee = await opts('payee').catch(() => []);
  await portal.selectDropdown(page, 'payee', found.payee.includes('Insured member') ? 'Insured member' : found.payee[0]).catch(() => {});
  found.method = await opts('paymentMethod').catch(() => []);
  await portal.selectDropdown(page, 'paymentMethod', found.method.find(m => /bank/i.test(m)) || found.method[0]).catch(() => {});
  await portal.selectDropdown(page, 'paymentCurrency', new RegExp(cfg.portal.currencyMatch || '^CZK')).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(500);
  // saved bank accounts: in the page text the masked number is followed by a 3-letter country, e.g.
  // "********1234\n\tCZE". Each account may be in a different currency, so capture country→currency.
  const C2CUR = { CZE: 'CZK', SVK: 'EUR', LTU: 'EUR', DEU: 'EUR', AUT: 'EUR', FRA: 'EUR', IRL: 'EUR', ESP: 'EUR', ITA: 'EUR', NLD: 'EUR', PRT: 'EUR', GBR: 'GBP', USA: 'USD', POL: 'PLN', HUN: 'HUF', CHE: 'CHF', CAN: 'CAD', AUS: 'AUD' };
  const bankText = await page.evaluate(() => document.body.innerText);
  const seg = bankText.slice(Math.max(0, bankText.indexOf('Saved bank')), bankText.indexOf('CREATE NEW') >= 0 ? bankText.indexOf('CREATE NEW') : undefined);
  found.banks = [...seg.matchAll(/(\d{4})\s+([A-Z]{3})\b/g)].map(m => ({ last4: m[1], country: m[2], currency: C2CUR[m[2]] || null }));

  // --- invoice form (upload sample to reveal patient + country) ---
  if (found.banks[0]) await page.locator('nx-radio', { hasText: found.banks[0].last4 || '' }).first().click({ timeout: 5000 }).catch(() => {});
  await page.getByRole('button', { name: /^continue$/i }).first().click({ timeout: 6000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /add (another )?invoice/i }).first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(1500);
  await page.locator('input[type=file]').first().setInputFiles(sample, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(2500);
  found.patients = await opts('patientName').catch(() => []);
  found.countries = await opts('country').catch(() => []);

  // abandon the draft
  await page.goto(`${cfg.portal.url}/claims/list`).catch(() => {});
  await browser.close();

  // --- sample invoice text (provider + patient name suggestions) ---
  // The Czech invoice puts supplier (Dodavatel) and customer (Odběratel/Příjemce) in two columns;
  // the names are on the line after the header, split by runs of spaces.
  const raw = pdfText(sample);
  const lines = raw.split('\n');
  let supplier = '', odberatel = '';
  const hdr = lines.findIndex(l => /Dodavatel/i.test(l) && /(Odběratel|Příjemce|Prijemce)/i.test(l));
  if (hdr >= 0 && lines[hdr + 1]) {
    const cols = lines[hdr + 1].split(/\s{2,}/).map(s => s.trim()).filter(Boolean);
    supplier = cols[0] || ''; odberatel = cols.length > 1 ? cols[cols.length - 1] : '';
  }
  if (!supplier) supplier = (raw.match(/^\s*([A-ZÁ-Ž][^\n]{3,40}(?:s\.r\.o\.|Clinic|Medical|a\.s\.))/m) || [])[1] || '';
  if (!odberatel) odberatel = (raw.match(/Odběratel:\s*([^\n\t]+)/i) || [])[1] || '';
  supplier = supplier.trim(); odberatel = odberatel.trim();

  // --- build config (merge onto existing config.json or the example) ---
  const out = JSON.parse(JSON.stringify(cfg)); delete out._root; delete out._file;
  console.log('\n— Discovered (press Enter to accept each) —');
  out.portal.payee = await ask('Payee', found.payee.includes('Insured member') ? 'Insured member' : (found.payee[0] || out.portal.payee));
  out.portal.paymentMethod = await ask('Payment method', found.method.find(m => /bank/i.test(m)) || (found.method[0] || out.portal.paymentMethod));
  if (found.banks.length) {
    console.log('  Saved bank accounts (each may be a different currency):');
    found.banks.forEach((b, i) => console.log(`    ${i + 1}) ****${b.last4}  ${b.country || ''}${b.currency ? ' → ' + b.currency : ''}`));
    const def = (found.banks.findIndex(b => b.last4 === out.portal.bankAccountMatch) + 1) || 1;
    const idx = parseInt(await ask('Which account (number) — pick the one for your reimbursement currency', String(def)), 10) - 1;
    const pick = found.banks[idx] || found.banks[0];
    out.portal.bankAccountMatch = pick.last4;
    out.portal.currencyMatch = await ask('Reimbursement currency match (regex)', pick.currency ? '^' + pick.currency : (out.portal.currencyMatch || '^CZK'));
  }
  const czCountry = found.countries.find(c => /czech/i.test(c));
  out.portal.countryMatch = await ask('Country of treatment', czCountry || out.portal.countryMatch);

  if (found.patients.length) {
    console.log(`  Patient dropdown has ${found.patients.length}: ${found.patients.join(' · ')}`);
    if (/^y/i.test(await ask('Use these as your family members? (y/n)', 'y'))) {
      const patients = {};
      for (const label of found.patients) {
        const key = label.split(/\s+/)[0];                       // first name as the short key
        const alias = label.replace(/\s*\(\d{4}\)\s*$/, '').trim(); // name without (YYYY)
        patients[key] = { portalLabel: label, aliases: [alias] };
      }
      out.patients = patients;
    }
  }
  if (supplier || odberatel) console.log(`  Sample invoice → provider "${supplier.trim()}", patient "${odberatel.trim()}" (add provider→category mappings in config.benefits if needed).`);

  if (/^y/i.test(await ask('\nWrite these to config.json? (y/n)', 'y'))) {
    fs.writeFileSync(path.join(cfg._root, 'config.json'), JSON.stringify(out, null, 2));
    console.log('✓ Wrote config.json. Next: npm run track');
  } else console.log('Nothing written.');
  rl.close();
})().catch(e => { console.error('ERROR:', e.message); rl.close(); process.exit(1); });
