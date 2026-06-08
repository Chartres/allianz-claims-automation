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
  dd.click();
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

// ---- claim flow (mirrors lib/portal.js) ----
export async function startClaim(cfg) {
  const P = cfg.portal;
  await clickByText(/submit a claim/i);
  await sleep(1500);
  await selectDropdown('payee', P.payee || 'Insured member');
  await selectDropdown('paymentMethod', P.paymentMethod || 'Bank Transfer');
  await selectDropdown('paymentCurrency', new RegExp(P.currencyMatch || '^CZK'));
  document.body.click();
  const bank = await waitFor(() => [...document.querySelectorAll('nx-radio')].find(r => (r.innerText || '').includes(P.bankAccountMatch)), { timeout: 6000 });
  if (bank) bank.click();
  await sleep(400);
  await clickByText(/^continue$/i);
  await sleep(1800);
}

// inv: { fields:{patientLabel,provider,date,amount,category,subtype,reason}, invoiceBytes, invoiceName, docs:[{bytes,name}] }
export async function addInvoice(cfg, inv) {
  const P = cfg.portal;
  await clickByText(/add (another )?invoice/i);
  await sleep(1500);
  // upload invoice via synthetic drop
  const file = new File([inv.invoiceBytes], inv.invoiceName, { type: 'application/pdf' });
  for (const t of findDropTargets()) { try { fireDrop(t, file); } catch {} }
  await waitFor(() => document.getElementById('patientName'), { timeout: 8000 });
  await selectDropdown('patientName', inv.fields.patientLabel);
  await selectDropdown('country', new RegExp(P.countryMatch || 'Czech Republic', 'i'));
  await selectDropdown('currency', new RegExp(P.currencyMatch || '^CZK'));
  document.body.click();
  await fillInput('treatmentProvider', inv.fields.provider || cfg.defaultProvider);
  await fillInput('invoiceDate', inv.fields.date);
  await fillInput('treatmentDate-0', inv.fields.date);
  await selectDropdown('treatmentMainCategory-0', inv.fields.category);
  if (inv.fields.subtype) { await clickByText(new RegExp('^' + inv.fields.subtype + '$', 'i')).catch(() => {}); await sleep(800); }
  // supplementary docs → file inputs 1,2,…
  let idx = 1;
  for (const d of (inv.docs || [])) {
    const fi = document.querySelectorAll('input[type=file]')[idx];
    if (fi) { for (const t of [fi, fi.parentElement]) try { fireDrop(t, new File([d.bytes], d.name)); } catch {} ; idx++; await sleep(2000); }
  }
  if (document.getElementById('masterDiagnosisCode-0') && inv.fields.reason)
    await selectDropdown('masterDiagnosisCode-0', inv.fields.reason).catch(() => {});
  await fillInput('amount-0', inv.fields.amount);
  await sleep(800);
  const invalid = [...document.querySelectorAll('.ng-invalid')].map(e => e.getAttribute('formcontrolname')).filter(Boolean);
  const save = [...document.querySelectorAll('button')].find(b => /save invoice/i.test(b.innerText || ''));
  return { invalid, saveDisabled: !save || save.disabled };
}

export async function saveInvoice() { await clickByText(/save invoice/i); await sleep(2000); }

export async function submitClaim() {
  await clickByText(/^submit claim$/i); await sleep(2000);
  await clickByText(/agree and proceed/i).catch(() => {}); await sleep(3000);
  const m = (document.body.innerText.match(/claim number is (C\d+)/i) || [])[1];
  return m || null;
}
