// Persona traversal — opens the real side panel UI in headless Chrome (via playwright-core,
// channel:'chrome'), with a chrome.* API shim, and walks three personas through their jobs-to-be-done,
// asserting outcomes and screenshotting each step into dist/personas/.
//
//   P1 "first-run"      — install, no portal: see empty state, import a CSV, read the dashboard.
//   P2 "filing parent"  — portal connected: drop invoices, fix a misread, attach a doc, watch the
//                          correction flywheel auto-classify the next invoice, file the batch.
//   P3 "auditor"        — quarter-end: spot declined/under-paid claims, export the CSV.
//
// Run: npm run personas        All data below is synthetic (the Novák family).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { claimsFromCSV } from '../src/lib/csv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'personas');
fs.mkdirSync(OUT, { recursive: true });

// ---------------- synthetic world ----------------
const CFG = {
  defaultProvider: null,
  providers: { 'Stomatologie Vltava': ['stomatologie vltava'], 'Lékárna U Anděla': ['u anděla'] },
  benefits: {
    providerCategory: { 'Stomatologie Vltava': 'Dental treatment', 'Lékárna U Anděla': 'Medication' },
    categoryCoverage: { 'Dental treatment': 100, Medication: 80, 'Medical practitioner fees': 80 },
    defaultCategory: 'Medical practitioner fees',
    tolerancePct: 5,
  },
  patients: {
    Jana: { portalLabel: 'Jana Nováková (1985)', aliases: ['Jana Nováková'] },
    Tomáš: { portalLabel: 'Tomáš Novák (2013)', aliases: ['Tomáš Novák'] },
  },
  treatmentTypes: {
    routineDental: { category: 'Dental Expenses', subtype: 'Routine Dental Treatment', reason: 'Dental Treatment', requiredDocs: [], keywords: ['preventivní', 'zubního kamene', 'hygiena'] },
    orthodontic: { category: 'Dental Expenses', subtype: 'Orthodontic treatment', reason: 'Teeth misalignment', requiredDocs: ['dentalPlan', 'xray'], keywords: ['invisalign', 'ortodont'] },
    prescription: { category: 'Medication and Medical Aids', subtype: null, reason: null, requiredDocs: ['prescription'], keywords: ['výdej na recept'] },
    doctorVisit: { category: 'Doctor Visit', subtype: null, reason: null, requiredDocs: [], keywords: ['konzultace', 'vyšetření'] },
  },
  supplementaryDocs: { prescription: { Jana: 'Jana/recept.pdf' } },
};

const CSV = [
  'Claim,Received,Status,Check,Patient,Provider,Category,Coverage%,Amount,ClaimInvoiced,ClaimReimbursed',
  '84512001,12/01/2026,Completed,,Tomáš,Stomatologie Vltava,Dental treatment,100,1850,2790,2602',
  '84512001,12/01/2026,Completed,,Jana,Lékárna U Anděla,Medication,80,940,2790,2602',
  '84512002,03/02/2026,Completed,,Jana,Lékárna U Anděla,Medication,80,560,560,448',
  '84512003,17/02/2026,Completed,,Tomáš,Stomatologie Vltava,Dental treatment,100,12500,12500,0',
  '84512004,28/03/2026,Completed,,Jana,City Clinic,Medical practitioner fees,80,2400,2400,1100',
  '84512005,09/04/2026,In Progress,,Tomáš,Stomatologie Vltava,Dental treatment,100,3200,3200,0',
  '84512006,02/05/2026,In Progress,,Jana,City Clinic,Medical practitioner fees,80,1750,1750,0',
].join('\n');

// OCR shim returns these, in the order images are dropped.
const OCR_TEXTS = [
  // 1 — clean: known patient, dental keywords → routineDental, no required docs
  'Stomatologie Vltava s.r.o.\nFAKTURA - DAŇOVÝ DOKLAD Č. 2260001234\nPacient: Tomáš Novák\nDatum vystavení: 14.05.2026\nPreventivní prohlídka, odstranění zubního kamene\nCelkem: 1 850 Kč\nZbývá uhradit: 0,00 Kč',
  // 2 — pharmacy, no type keywords → unclassified; persona corrects → flywheel learns the provider
  'Lékárna U Anděla\nDOKLAD Č. 2260009876\nJana Nováková\nDatum vystavení: 21.05.2026\nDoplatek za přípravky\nCelkem: 740 Kč',
  // 3 — same provider again → the learned hint auto-classifies it (↻)
  'Lékárna U Anděla\nDOKLAD Č. 2260010222\nJana Nováková\nDatum vystavení: 02.06.2026\nDoplatek za přípravky\nCelkem: 320 Kč',
];

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ---------------- chrome.* shim (runs in the page before any module) ----------------
function shim(scenario) {
  const store = scenario.store || {};
  const changed = new Set();
  const msgListeners = new Set();
  const fire = (changes) => changed.forEach(f => { try { f(changes, 'local'); } catch {} });
  const ocr = [...(scenario.ocrTexts || [])];
  const respond = (cb, resp) => { if (cb) setTimeout(() => cb(resp), 0); return Promise.resolve(resp); };

  window.chrome = {
    runtime: {
      lastError: undefined,
      getURL: p => location.origin + '/' + String(p).replace(/^\//, ''),
      onMessage: { addListener: f => msgListeners.add(f), removeListener: f => msgListeners.delete(f) },
      sendMessage(msg, cb) {
        if (msg?.type === 'OCR_IMAGE') return respond(cb, { ok: true, text: ocr.shift() || '' });
        return respond(cb, { ok: false, error: 'not available in traversal' });
      },
    },
    storage: {
      onChanged: { addListener: f => changed.add(f) },
      local: {
        get: (key) => Promise.resolve(typeof key === 'string' ? { [key]: store[key] } : { ...store }),
        set: (obj) => { Object.assign(store, obj); fire(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }]))); return Promise.resolve(); },
      },
    },
    tabs: {
      query: () => Promise.resolve(scenario.portal ? [{ id: 1, url: 'https://my.allianzcare.com/myhealth/1/home' }] : []),
      sendMessage(_id, msg, cb) {
        if (msg?.type === 'PING_PORTAL') return cb && cb({ ok: true, loggedIn: !!scenario.loggedIn });
        if (msg?.type === 'FILE_INVOICES') {
          // simulate the content driver: stream progress, then per-invoice results
          const invs = msg.invoices || [];
          const emit = m => msgListeners.forEach(f => { try { f(m, {}, () => {}); } catch {} });
          let t = 0;
          emit({ type: 'FILE_PROGRESS', i: 0, total: invs.length, id: null, state: 'starting claim' });
          invs.forEach((inv, i) => {
            setTimeout(() => emit({ type: 'FILE_PROGRESS', i, total: invs.length, id: inv.meta?.id, state: 'filing' }), t += 120);
            setTimeout(() => emit({ type: 'FILE_PROGRESS', i: i + 1, total: invs.length, id: inv.meta?.id, state: 'saved' }), t += 120);
          });
          setTimeout(() => cb({ ok: true, results: invs.map(inv => ({ id: inv.meta?.id, ok: true })), note: 'Stopped at the claim overview.' }), t + 120);
          return;
        }
        cb && cb({ ok: false, error: 'unhandled: ' + msg?.type });
      },
    },
  };
}

// ---------------- tiny static server for the extension root ----------------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---------------- harness ----------------
let pass = 0, fail = 0, shot = 0;
const check = (name, cond) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } };
const snap = async (page, name, locator) => {
  const file = path.join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`);
  await (locator || page).screenshot(locator ? { path: file } : { path: file, fullPage: true });
  console.log(`  📷 ${path.relative(ROOT, file)}`);
};
const dropFiles = (page, names) => page.evaluate((fnames) => {
  const dt = new DataTransfer();
  for (const n of fnames) dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], n, { type: 'image/png' }));
  document.querySelector('#dropzone').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
}, names);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2 });
const open = async (scenario, url = '/src/sidepanel/panel.html') => {
  const page = await ctx.newPage();
  await page.addInitScript(shim, scenario);
  await page.goto(BASE + url);
  return page;
};

// ===== P1 · first-run user — JTBD: "I just installed this; show me where my money went." =====
console.log('\nP1 · first-run user (no portal, no data)');
{
  const page = await open({ store: {}, portal: false });
  await page.waitForFunction(() => document.querySelector('#portalStatus')?.textContent.includes('portal not open'));
  check('empty state explains itself (no data hint)', await page.locator('#content').innerText().then(t => /No data yet/.test(t)));
  check('file bar stays hidden until something is dropped', await page.locator('#fileBar').isHidden()); // [hidden] vs .bar{display:flex}
  await snap(page, 'first-run-empty');
  await page.setInputFiles('#import', { name: 'allianz-claims.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await page.waitForSelector('#totals b');
  const totals = await page.locator('#totals').innerText();
  check('totals show 6 claims', /Claims\s*6/.test(totals.replace(/\n/g, ' ')));
  const content = await page.locator('#content').innerText(); // NB: h2 text renders uppercase (CSS)
  check('needs-attention surfaces problem claims', /needs attention \(\d\)/i.test(content));
  check('by-month aggregate works on imported CSV', /2026-0[1-5]/.test(content));
  check('all five aggregate sections render', ['by patient', 'by category', 'by provider', 'by month', 'by status'].every(h => content.toLowerCase().includes(h)));
  await snap(page, 'first-run-dashboard');
  await page.close();
}

// ===== P2 · filing parent — JTBD: "Clear this month's invoice pile in minutes, not an evening." =====
console.log('\nP2 · filing parent (portal connected, drops 3 invoice photos)');
{
  const page = await open({ store: { config: CFG }, portal: true, loggedIn: true, ocrTexts: OCR_TEXTS });
  await page.waitForFunction(() => document.querySelector('#portalStatus')?.textContent.includes('connected'));
  check('portal status shows ● connected', true);

  await dropFiles(page, ['faktura-2260001234.png', 'faktura-2260009876.png']);
  await page.waitForSelector('.rev');
  check('both drops appear in review', await page.locator('.rev').count() === 2);
  const row0 = await page.locator('.rev').nth(0).innerText();
  check('invoice 1 parsed clean (Tomáš · routineDental, no flags)', /14\/05\/2026/.test(row0) && /1850/.test(row0) && !/⚠/.test(row0));
  const row1 = await page.locator('.rev').nth(1).innerText();
  check('invoice 2 flagged unclassified', /unclassified/.test(row1));
  await snap(page, 'parent-review-flagged');

  // correction: set type → the flywheel learns Lékárna U Anděla → prescription
  await page.locator('.fix-type[data-i="1"]').selectOption('prescription');
  await page.waitForFunction(() => /missing .*recept/.test(document.querySelectorAll('.rev')[1]?.innerText || ''));
  check('correction re-evaluates: now asks for the prescription doc', true);

  // attach the prescription by hand
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.attach[data-i="1"]').click();
  await (await chooser).setFiles({ name: 'recept-jana.pdf', mimeType: 'application/pdf', buffer: PNG_1PX });
  await page.waitForFunction(() => /recept-jana\.pdf/.test(document.querySelectorAll('.rev')[1]?.innerText || ''));
  check('manual attach satisfies the doc requirement', !/⚠/.test(await page.locator('.rev').nth(1).innerText()));
  await snap(page, 'parent-corrected-attached');

  // flywheel: drop another invoice from the same pharmacy → auto-classified via the learned hint
  await dropFiles(page, ['faktura-2260010222.png']);
  await page.waitForFunction(() => document.querySelectorAll('.rev').length === 3);
  const row2 = await page.locator('.rev').nth(2).innerText();
  check('flywheel: next invoice from that provider auto-classifies (↻)', /↻/.test(await page.locator('.rev').nth(2).innerHTML()));
  check('…and still honestly gates on its own missing doc', /missing .*recept/.test(row2));
  const chooser2 = page.waitForEvent('filechooser');
  await page.locator('.attach[data-i="2"]').click();
  await (await chooser2).setFiles({ name: 'recept-jana.pdf', mimeType: 'application/pdf', buffer: PNG_1PX });
  await page.waitForFunction(() => !/⚠/.test(document.querySelectorAll('.rev')[2]?.innerText || ''));
  await snap(page, 'parent-flywheel-hint');

  // file the batch — progress streams, stops at the overview
  await page.locator('#fileThese').click();
  await page.waitForFunction(() => /Added 3\/3/.test(document.querySelector('#fileStatus')?.textContent || ''), null, { timeout: 5000 });
  check('filing reports 3/3 added, stops at overview for review', true);
  await snap(page, 'parent-filed');
  await page.close();
}

// ===== P3 · auditor — JTBD: "Quarter-end: did Allianz actually pay what the policy promises?" =====
console.log('\nP3 · auditor (seeded tracker, checks shortfalls, exports)');
{
  const page = await open({ store: { config: CFG, claims: claimsFromCSV(CSV) }, portal: false });
  await page.waitForSelector('#totals b');
  const content = await page.locator('#content').innerText();
  check('declined claim is flagged', /declined/.test(content));
  check('under-paid claim is flagged', /under/.test(content));
  await snap(page, 'auditor-attention', page.locator('#content table').first());
  const dl = page.waitForEvent('download');
  await page.locator('#export').click();
  check('CSV export downloads', (await dl).suggestedFilename() === 'allianz-claims.csv');
  await page.close();
}

// ===== design consistency: options page =====
console.log('\nOptions page (design system match)');
{
  const page = await open({ store: { config: CFG } }, '/src/options/options.html');
  await page.waitForFunction(() => (document.querySelector('#cfg')?.value || '').includes('treatmentTypes'));
  await page.locator('#save').click();
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#status')?.textContent || ''));
  check('options round-trips the config', true);
  await snap(page, 'options-settings');
  await page.close();
}

await browser.close();
server.close();
console.log(fail ? `\n✗ FAIL — ${pass} passed, ${fail} failed.` : `\n✓ PASS — ${pass} passed, 0 failed. Screenshots in ${path.relative(process.cwd(), OUT)}/`);
process.exit(fail ? 1 : 0);
