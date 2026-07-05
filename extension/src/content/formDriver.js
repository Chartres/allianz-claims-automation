// Content-script form-driver — files a claim on the NX/Angular portal from the logged-in tab.
// Faithful port of the CLI's lib/portal.js (proven selectors) to DOM + dispatched events. The upload
// uses the synthetic drag-drop validated in headless Chrome (dropUpload.js).
//
// STATUS: pending live validation on the real form (the gating spike needs an OTP login). The
// selectors/flow mirror the working CLI; the Angular event-dispatch (open dropdown, pick option, set
// input) is the part to confirm against the live page.
import { fireDrop, findDropTargets } from './dropUpload.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, { timeout = 12000, every = 200 } = {}) {
  const end = Date.now() + timeout;
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); }
}
const visible = el => el && el.offsetParent !== null && !el.disabled;

// Click a button/element whose visible text matches `re`.
async function clickByText(re, { timeout = 10000 } = {}) {
  const el = await waitFor(() => [...document.querySelectorAll('button, a, [role=button]')]
    .find(b => visible(b) && re.test((b.innerText || '').trim())), { timeout });
  if (!el) throw new Error('button not found: ' + re);
  el.click();
  return el;
}

// Open an nx-dropdown by id, click the option matching `matcher` (string === or RegExp).
async function selectDropdown(id, matcher) {
  const dd = await waitFor(() => document.getElementById(id), { timeout: 10000 });
  if (!dd) throw new Error('dropdown #' + id + ' not found');
  document.body.click(); await sleep(200);                 // close any lingering overlay first
  dd.click(); await sleep(150);
  const opts = await waitFor(() => { const o = [...document.querySelectorAll('[role=option]')]; return o.length ? o : null; }, { timeout: 6000 }) || [];
  const re = matcher instanceof RegExp ? matcher : null;
  const opt = opts.find(o => { const t = (o.innerText || '').trim(); return re ? re.test(t) : t === matcher; });
  if (!opt) { document.body.click(); throw new Error('#' + id + ': no option ' + matcher); }
  opt.click();
  await sleep(400);
}

// Set an input's value so Angular registers it (native setter + input/change events).
async function fillInput(id, value) {
  const el = await waitFor(() => document.getElementById(id), { timeout: 8000 });
  if (!el) throw new Error('input #' + id + ' not found');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  el.focus();
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
  await sleep(200);
}

// Select an nx-radio (bank account, treatment subtype, …) by its label text — click the inner
// input[type=radio] so Angular registers it (the host element's click doesn't toggle it).
async function selectRadio(text) {
  const radio = await waitFor(() => [...document.querySelectorAll('nx-radio')]
    .find(r => { const t = (r.innerText || '').trim(); return t === text || t.includes(text); }), { timeout: 6000 });
  if (!radio) throw new Error('radio not found: ' + text);
  try { radio.scrollIntoView({ block: 'center' }); } catch {}
  // click the label (not just the input) — Angular needs the label's handler to fire dependent
  // updates (e.g. the subtype radio populating the reason dropdown); input-only check isn't enough.
  (radio.querySelector('label') || radio.querySelector('input[type=radio]') || radio).click();
  await sleep(400);
}

// Upload file(s) into a specific uploader slot of the current invoice form and confirm it took.
// The portal's file inputs have stable per-form ids (#nx-file-uploader-0-input = invoice,
// -1 = dental plan, -2 = X-rays/photos), which is far more reliable than indexing every file input
// on the page — after several invoices the DOM accumulates stale ones. Drops on the slot's own
// uploader zone (the gate-cleared technique), verified by filename + retried.
async function uploadTo(slot, files) {
  const stem = files[0].name.replace(/\.[^.]+$/, '').slice(0, 18);
  for (let attempt = 0; attempt < 3; attempt++) {
    const input = document.getElementById(`nx-file-uploader-${slot}-input`) || document.querySelectorAll('input[type=file]')[slot];
    const zone = input && (input.closest('nx-file-uploader')?.querySelector('nx-file-uploader-drop-zone') || input.closest('nx-file-uploader') || input.parentElement || input);
    const targets = zone ? [zone] : (slot === 0 ? findDropTargets() : []);
    for (const t of targets) { try { fireDrop(t, files); } catch {} }
    await sleep(2200 + 800 * (files.length - 1));
    if (document.body.innerText.includes(stem)) return true;
  }
  return false;
}

// ---- claim flow (mirrors lib/portal.js) ----
export async function startClaim(cfg) {
  const P = cfg.portal;
  await clickByText(/submit a claim/i);
  await sleep(1500);
  await selectDropdown('payee', P.payee || 'Insured member');
  await selectDropdown('paymentMethod', P.paymentMethod || 'Bank Transfer');
  // Reimbursement currency must be set before the saved bank accounts render — the account
  // list is filtered by it. (Setting the account first, or skipping currency, leaves an empty list.)
  await selectDropdown('paymentCurrency', new RegExp(P.currencyMatch || '^CZK'));
  document.body.click();
  await sleep(600);
  // Some policies gate Continue on two required questions ("...as a result of an accident?" /
  // "...insured by another provider?"). Answer both No. No-op when the policy doesn't show them.
  for (const id of ['question1ToggleNo', 'question2ToggleNo']) {
    const q = document.getElementById(id);
    if (q) { (q.querySelector('label') || q).click(); await sleep(300); }
  }
  // Pick the saved bank account (currency-filtered list). Guarded: a single-account policy
  // may show no chooser at all, in which case we just continue.
  if (P.bankAccountMatch && [...document.querySelectorAll('nx-radio')].some(r => (r.innerText || '').includes(P.bankAccountMatch)))
    await selectRadio(P.bankAccountMatch).catch(() => {});
  await sleep(400);
  await clickByText(/^continue$/i);
  await sleep(1800);
}

// inv: { fields:{patientLabel,provider,date,amount,category,subtype,reason}, invoiceBytes, invoiceName, docs:[{bytes,name}] }
export async function addInvoice(cfg, inv) {
  const P = cfg.portal;
  // Open a fresh invoice form. The button reads "Add invoice" the first time and "Add another
  // invoice" after — and after a heavy invoice (e.g. orthodontic with several large X-ray
  // uploads) the overview can take a while to settle, so retry the click.
  for (let attempt = 0; ; attempt++) {
    try { await clickByText(/add (another )?invoice/i); break; }
    catch (e) { if (attempt >= 2) throw e; await sleep(2500); }
  }
  await sleep(1500);
  // invoice upload (slot 0) via synthetic drop — verified + retried
  const file = new File([inv.invoiceBytes], inv.invoiceName, { type: 'application/pdf' });
  await uploadTo(0, [file]);
  await waitFor(() => document.getElementById('patientName'), { timeout: 8000 });
  await selectDropdown('patientName', inv.fields.patientLabel);
  await selectDropdown('country', new RegExp(P.countryMatch || 'Czech Republic', 'i'));
  await selectDropdown('currency', new RegExp(P.currencyMatch || '^CZK'));
  document.body.click();
  await fillInput('treatmentProvider', inv.fields.provider || cfg.defaultProvider);
  await fillInput('invoiceDate', inv.fields.date);
  await fillInput('treatmentDate-0', inv.fields.date);
  await selectDropdown('treatmentMainCategory-0', inv.fields.category);
  if (inv.fields.subtype) { await selectRadio(inv.fields.subtype).catch(() => {}); await sleep(800); } // subtype is an nx-radio
  // supplementary docs → uploader slots 1,2,… — one slot per doc type (dental plan, X-rays),
  // so multiple files of one type (e.g. several X-rays) land together in their slot.
  const groups = [];
  for (const d of (inv.docs || [])) {
    const f = new File([d.bytes], d.name);
    const g = d.docType && groups.find(x => x.docType === d.docType);
    if (g) g.files.push(f); else groups.push({ docType: d.docType, files: [f] });
  }
  let idx = 1;
  for (const g of groups) { await uploadTo(idx, g.files); idx++; }
  // reason (masterDiagnosisCode) if present/required. Try the configured reason; if it isn't an
  // exact option and the field is still required, fall back to the first real option so the form
  // can save rather than silently staying invalid.
  const reasonEl = inv.fields.reason
    ? await waitFor(() => document.getElementById('masterDiagnosisCode-0'), { timeout: 5000 }) // appears after subtype
    : document.getElementById('masterDiagnosisCode-0');
  if (reasonEl) {
    let picked = false;
    if (inv.fields.reason) picked = await selectDropdown('masterDiagnosisCode-0', inv.fields.reason).then(() => true).catch(() => false);
    if (!picked && document.getElementById('masterDiagnosisCode-0')?.classList.contains('ng-invalid'))
      await selectDropdown('masterDiagnosisCode-0', /\S/).catch(() => {});
  }
  await fillInput('amount-0', inv.fields.amount);
  await sleep(800);
  const invalid = [...document.querySelectorAll('.ng-invalid')].map(e => e.getAttribute('formcontrolname')).filter(Boolean);
  const save = [...document.querySelectorAll('button')].find(b => /save invoice/i.test(b.innerText || ''));
  return { invalid, saveDisabled: !save || save.disabled };
}

export async function saveInvoice() { await clickByText(/save invoice/i); await sleep(2000); }

// Read an nx-dropdown's option texts (open → collect → close).
async function readOptions(id) {
  const dd = document.getElementById(id); if (!dd) return [];
  dd.click();
  await waitFor(() => document.querySelectorAll('[role=option]').length, { timeout: 5000 });
  const o = [...document.querySelectorAll('[role=option]')].map(e => (e.innerText || '').trim());
  document.body.click(); await sleep(300);
  return o;
}

// Onboarding discovery — read settings from the live form. `sample` (optional {bytes,name}) is
// uploaded to reveal the patient + country dropdowns. Ported from the CLI's bin/discover.js. Does NOT
// submit; leaves a draft (harmless). STATUS: pending live validation.
const COUNTRY_CURRENCY = { CZE: 'CZK', SVK: 'EUR', LTU: 'EUR', DEU: 'EUR', AUT: 'EUR', FRA: 'EUR', IRL: 'EUR', ESP: 'EUR', ITA: 'EUR', NLD: 'EUR', PRT: 'EUR', GBR: 'GBP', USA: 'USD', POL: 'PLN', HUN: 'HUF', CHE: 'CHF', CAN: 'CAD', AUS: 'AUD' };
export async function discover(cfg, sample) {
  const P = cfg.portal || {};
  await clickByText(/submit a claim/i); await sleep(1500);
  const payee = await readOptions('payee');
  await selectDropdown('payee', payee.includes('Insured member') ? 'Insured member' : payee[0]).catch(() => {});
  const method = await readOptions('paymentMethod');
  await selectDropdown('paymentMethod', method.find(m => /bank/i.test(m)) || method[0]).catch(() => {});
  await selectDropdown('paymentCurrency', new RegExp(P.currencyMatch || '^CZK')).catch(() => {});
  document.body.click();
  await waitFor(() => document.querySelector('nx-radio') || /Saved bank/i.test(document.body.innerText), { timeout: 5000 });
  await sleep(600);
  const t = document.body.innerText, i = t.indexOf('Saved bank');
  const seg = i < 0 ? '' : t.slice(i, t.indexOf('CREATE NEW') >= 0 ? t.indexOf('CREATE NEW') : undefined);
  const banks = [...seg.matchAll(/(\d{4})\s+([A-Z]{3})\b/g)].map(m => ({ last4: m[1], country: m[2], currency: COUNTRY_CURRENCY[m[2]] || null }));
  let patients = [], countries = [];
  if (sample) {
    if (banks[0]) await selectRadio(banks[0].last4).catch(() => {});
    await clickByText(/^continue$/i).catch(() => {}); await sleep(1500);
    await clickByText(/add (another )?invoice/i).catch(() => {}); await sleep(1500);
    const file = new File([sample.bytes], sample.name, { type: 'application/pdf' });
    for (const tgt of findDropTargets()) { try { fireDrop(tgt, file); } catch {} }
    await waitFor(() => document.getElementById('patientName'), { timeout: 8000 });
    patients = await readOptions('patientName');
    countries = await readOptions('country');
  }
  return { payee, method, banks, patients, countries };
}

export async function submitClaim() {
  await clickByText(/^submit claim$/i); await sleep(2000);
  await clickByText(/agree and proceed/i).catch(() => {}); await sleep(3000);
  const m = (document.body.innerText.match(/claim number is (C\d+)/i) || [])[1];
  return m || null;
}
