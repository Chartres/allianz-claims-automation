#!/usr/bin/env node
/*
 * Intake processor — the "drop invoices in a folder and I file them" surface.
 *
 *   node bin/intake.js              Dry run: parse + classify everything in intake/, print the plan.
 *   node bin/intake.js --file       Fill a claim in the portal (stops at the overview for review).
 *   node bin/intake.js --submit     Fill + submit + relabel source threads + move PDFs to _processed/.
 *
 * Each invoice is parsed (patient, date, amount, treatment), classified, and matched
 * to required supplementary docs (dental plan, RTG, prescription, ...) from config.
 * Invoices with blocking issues (unknown patient, missing required docs, unclassified)
 * are reported and skipped, not filed.
 */
const fs = require('fs');
const path = require('path');
const C = require('../lib/config');
const { parse } = require('../lib/pdf');
const { classify } = require('../lib/classify');
const portal = require('../lib/portal');

const cfg = C.load();
const MODE = process.argv.includes('--submit') ? 'submit' : process.argv.includes('--file') ? 'file' : 'dry';
const INTAKE = path.join(cfg._root, 'intake');
const PROCESSED = path.join(INTAKE, '_processed');
const CONF = path.join(cfg._root, 'confirmations');

function detectProvider(raw) {
  for (const [name, kws] of Object.entries(cfg.providers || {}))
    if (kws.some(k => raw.toLowerCase().includes(k.toLowerCase()))) return name;
  return cfg.defaultProvider;
}

// Index payment confirmations by VS (faktura number).
function indexConfirmations() {
  const byVs = {};
  if (!fs.existsSync(CONF)) return byVs;
  for (const f of fs.readdirSync(CONF)) {
    if (!f.toLowerCase().endsWith('.pdf')) continue;
    const p = parse(path.join(CONF, f), cfg);
    if (p.vs) byVs[p.vs] = path.join(CONF, f);
  }
  return byVs;
}

function buildPlan() {
  if (!fs.existsSync(INTAKE)) fs.mkdirSync(INTAKE, { recursive: true });
  const confByVs = indexConfirmations();
  const files = fs.readdirSync(INTAKE).filter(f => f.toLowerCase().endsWith('.pdf'));
  const plan = [];
  for (const f of files) {
    const full = path.join(INTAKE, f);
    const parsed = parse(full, cfg);
    const issues = [];
    if (parsed.error) issues.push(parsed.error);
    if (parsed.patientName === '?') issues.push('unknown patient');
    if (parsed.amount === '?') issues.push('no amount');
    const cls = classify(parsed, cfg);
    if (!cls.typeKey) issues.push('unclassified treatment');
    cls.missingDocs.forEach(d => issues.push(`missing ${d}`));
    const patient = cfg.patients[parsed.patientName];
    const conf = parsed.vs && confByVs[parsed.vs] ? confByVs[parsed.vs] : null;
    plan.push({ file: f, full, parsed, cls, patient, conf, issues });
  }
  return plan;
}

function printPlan(plan) {
  console.log(`\nIntake: ${plan.length} invoice(s) in ${INTAKE}\n`);
  for (const e of plan) {
    const t = e.cls.type || {};
    const ok = e.issues.length === 0;
    console.log(`${ok ? '✓' : '✗'} ${e.file}`);
    console.log(`    ${e.parsed.patientName} · ${e.parsed.date} · ${e.parsed.amount} CZK · ${e.cls.typeKey || '?'}` +
      `${t.subtype ? ' (' + t.subtype + ')' : ''}${e.cls.overridden ? ' [override]' : ''}`);
    if (e.conf) console.log(`    + payment confirmation: ${path.basename(e.conf)}`);
    Object.entries(e.cls.docs || {}).forEach(([k, v]) => console.log(`    + ${k}: ${v.length} file(s)`));
    if (e.issues.length) console.log(`    ⚠ ${e.issues.join('; ')}`);
  }
  const ready = plan.filter(e => !e.issues.length);
  console.log(`\n${ready.length}/${plan.length} ready to file.` +
    (ready.length < plan.length ? '  (fix the ⚠ items or add the missing docs to config/data)' : ''));
  return ready;
}

async function fileClaim(ready, submit) {
  const browser = await portal.connect(cfg);
  const page = await portal.getPage(browser);
  if (!page) throw new Error('No Allianz page found — run bin/launch-chrome.js and log in first.');
  if (!await portal.isLoggedIn(page)) throw new Error('Portal not logged in — log in in the Chrome window first.');

  await portal.startClaim(page, cfg);
  console.log('\nFiling claim...');
  const filed = [];
  for (const e of ready) {
    const inv = {
      invoiceFiles: [e.full, ...(e.conf ? [e.conf] : [])],
      patientLabel: e.patient.portalLabel,
      provider: detectProvider(e.parsed.raw || ''),
      date: e.parsed.date,
      amount: e.parsed.amount,
      category: e.cls.type.category,
      subtype: e.cls.type.subtype || null,
      reason: e.cls.type.reason || null,
      docs: e.cls.docs,
    };
    const r = await portal.addInvoice(page, cfg, inv);
    if (r.saveDisabled) { console.log(`  ✗ ${e.file}: save disabled (invalid: ${r.invalid.join(',')||'?'}) — skipping`); continue; }
    await portal.saveInvoice(page);
    console.log(`  ✓ ${e.parsed.patientName} ${e.parsed.amount} ${e.cls.typeKey}`);
    filed.push(e);
  }
  console.log('\nInvoices in claim:');
  (await portal.listInvoices(page)).forEach((s, i) => console.log(`  [${i + 1}] ${s}`));

  if (!submit) { console.log('\n--file mode: stopped at overview. Review in Chrome, then re-run with --submit.'); await browser.close(); return; }

  const claimNo = await portal.submitClaim(page);
  console.log(`\n✅ Submitted — claim ${claimNo}`);
  // move filed PDFs to _processed/
  fs.mkdirSync(PROCESSED, { recursive: true });
  for (const e of filed) fs.renameSync(e.full, path.join(PROCESSED, e.file));
  console.log(`Moved ${filed.length} processed invoice(s) to intake/_processed/.`);
  await browser.close();
}

(async () => {
  const plan = buildPlan();
  if (!plan.length) { console.log(`No PDFs in ${INTAKE}. Drop invoice PDFs there and re-run.`); return; }
  const ready = printPlan(plan);
  if (MODE === 'dry') { console.log('\n(dry run — add --file to fill the portal, --submit to submit)'); return; }
  if (!ready.length) { console.log('\nNothing ready to file.'); return; }
  await fileClaim(ready, MODE === 'submit');
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
