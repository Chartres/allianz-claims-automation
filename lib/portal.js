// Allianz Care MyHealth portal driver (NX/Angular app) over Playwright CDP.
const { chromium } = require('playwright-core');

async function connect(cfg) {
  const browser = await chromium.connectOverCDP(`http://localhost:${cfg.portal.cdpPort || 9222}`);
  return browser;
}
async function getPage(browser) {
  for (const c of browser.contexts())
    for (const p of c.pages())
      if (p.url().includes('allianzcare.com')) return p;
  return null;
}
async function isLoggedIn(page) {
  return !/login|signin/i.test(page.url());
}

// --- NX component helpers ---
async function selectDropdown(page, id, matcher) {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('#' + id).click({ timeout: 8000 });
  await page.waitForTimeout(700);
  const opts = await page.getByRole('option').allInnerTexts();
  const re = matcher instanceof RegExp ? matcher : null;
  const idx = opts.findIndex(o => re ? re.test(o) : o === matcher);
  if (idx < 0) { await page.keyboard.press('Escape'); throw new Error(`#${id}: no option matches ${matcher} (have: ${opts.slice(0, 8).join(', ')})`); }
  await page.getByRole('option').nth(idx).click({ timeout: 5000 });
  await page.waitForTimeout(500);
  return opts[idx];
}
async function fillInput(page, id, value) {
  const el = page.locator('#' + id);
  await el.click({ timeout: 6000 });
  await el.fill('');
  await el.type(String(value), { delay: 35 });
  await page.waitForTimeout(250);
}

// --- claim flow ---
async function startClaim(page, cfg) {
  const P = cfg.portal;
  await page.goto(`${P.url}/claims/list`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  if (!await isLoggedIn(page)) throw new Error('NOT_LOGGED_IN');
  await page.getByRole('button', { name: /submit a claim/i }).first().click({ timeout: 8000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1800);
  await selectDropdown(page, 'payee', P.payee);
  await selectDropdown(page, 'paymentMethod', P.paymentMethod);
  await selectDropdown(page, 'paymentCurrency', new RegExp(P.currencyMatch));
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('nx-radio', { hasText: P.bankAccountMatch }).click({ timeout: 6000 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^continue$/i }).first().click({ timeout: 6000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

// inv: { invoiceFiles[], patientLabel, provider, date, amount, category, subtype, reason, docs:{key:[paths]} }
async function addInvoice(page, cfg, inv) {
  const P = cfg.portal;
  await page.getByRole('button', { name: /add (another )?invoice/i }).first().click({ timeout: 8000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // invoice upload (input 0) — accepts multiple (invoice + payment proof)
  await page.locator('input[type=file]').first().setInputFiles(inv.invoiceFiles, { timeout: 12000 });
  await page.waitForTimeout(2500 + 800 * (inv.invoiceFiles.length - 1));
  await selectDropdown(page, 'patientName', inv.patientLabel);
  await selectDropdown(page, 'country', new RegExp(P.countryMatch, 'i'));
  await selectDropdown(page, 'currency', new RegExp(P.currencyMatch));
  await page.keyboard.press('Escape').catch(() => {});
  await fillInput(page, 'treatmentProvider', inv.provider || cfg.defaultProvider);
  await fillInput(page, 'invoiceDate', inv.date);
  await page.keyboard.press('Tab'); await page.waitForTimeout(300);
  await fillInput(page, 'treatmentDate-0', inv.date);
  await selectDropdown(page, 'treatmentMainCategory-0', inv.category);
  await page.waitForTimeout(800);
  if (inv.subtype) {
    await page.getByText(inv.subtype, { exact: true }).first().click({ timeout: 6000 });
    await page.waitForTimeout(1000);
  }
  // supplementary docs -> file inputs 1,2,... in requiredDocs order
  let fileIdx = 1;
  for (const key of Object.keys(inv.docs || {})) {
    const files = inv.docs[key];
    if (!files || !files.length) continue;
    await page.locator('input[type=file]').nth(fileIdx).setInputFiles(files, { timeout: 15000 });
    await page.waitForTimeout(2500 + 800 * (files.length - 1));
    fileIdx++;
  }
  // reason (masterDiagnosisCode) if present/required
  if (await page.locator('#masterDiagnosisCode-0').count()) {
    const required = await page.evaluate(() => document.querySelector('#masterDiagnosisCode-0')?.classList.contains('ng-invalid'));
    if (inv.reason) await selectDropdown(page, 'masterDiagnosisCode-0', inv.reason).catch(() => {});
    else if (required) await selectDropdown(page, 'masterDiagnosisCode-0', /.*/).catch(() => {});
  }
  await fillInput(page, 'amount-0', inv.amount);
  await page.keyboard.press('Tab'); await page.waitForTimeout(800);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  const invalid = await page.evaluate(() => [...document.querySelectorAll('.ng-invalid')].map(e => e.getAttribute('formcontrolname')).filter(Boolean));
  const save = page.getByRole('button', { name: /save invoice/i }).first();
  const disabled = await save.isDisabled().catch(() => true);
  return { invalid, saveDisabled: disabled };
}

async function saveInvoice(page) {
  await page.getByRole('button', { name: /save invoice/i }).first().click({ timeout: 8000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);
}
async function listInvoices(page) {
  const t = await page.evaluate(() => document.body.innerText);
  return (t.match(/Patient name:[\s\S]*?Total invoice amount:CZK [\d,\.]+/g) || [])
    .map(s => s.replace(/\s+/g, ' ').trim());
}
async function submitClaim(page) {
  await page.getByRole('button', { name: /^submit claim$/i }).first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  const agree = page.getByRole('button', { name: /agree and proceed/i });
  if (await agree.count()) await agree.first().click({ timeout: 8000 });
  await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(3500);
  const t = await page.evaluate(() => document.body.innerText);
  const m = t.match(/claim number is (C\d+)/i);
  return m ? m[1] : null;
}
async function getClaimsList(page, cfg) {
  await page.goto(`${cfg.portal.url}/claims/list`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const t = await page.evaluate(() => document.body.innerText);
  const out = [];
  const re = /(C3\d{7})\s*Date\s+received:\s*([^\n]+)\s*Submitted\s+by:\s*[^\n]+\s*([A-Za-z][^\n]*)/g;
  let m; while ((m = re.exec(t)) !== null) out.push({ id: m[1], received: m[2].trim(), status: m[3].trim() });
  return out;
}

// --- crawling ---
function parseMonth(s) { // "1 Oct 2025" -> "2025-10-01"
  const m = s.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (!m) return null;
  const mo = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }[m[2]] || '00';
  return `${m[3]}-${mo}-${String(m[1]).padStart(2,'0')}`;
}

// Load the whole claims list, clicking "Continue/Show more" until it stops growing.
async function listAllClaims(page, cfg, maxPages = 20) {
  await page.goto(`${cfg.portal.url}/claims/list`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  if (!await isLoggedIn(page)) throw new Error('NOT_LOGGED_IN');
  // claim cards render async — wait until at least one appears
  await page.waitForFunction(() => /C3\d{7}/.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const extract = async () => {
    const t = await page.evaluate(() => document.body.innerText);
    const out = []; const re = /(C3\d{7})\s*Date\s+received:\s*([^\n]+)\s*Submitted\s+by:\s*[^\n]+\s*([A-Za-z][^\n]*)/g;
    let m; while ((m = re.exec(t)) !== null) out.push({ id: m[1], received: m[2].trim(), status: m[3].trim() });
    return out;
  };
  const byId = new Map();
  const merge = arr => arr.forEach(c => { if (!byId.has(c.id)) byId.set(c.id, c); });
  merge(await extract());
  for (let pages = 0; pages < maxPages; pages++) {
    const before = byId.size;
    const more = page.getByRole('button', { name: /show more|load more|view more|see more/i }).first();
    if (!await more.count() || await more.isDisabled().catch(() => true)) break;
    const url = page.url();
    await more.click({ timeout: 5000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1800);
    if (page.url() !== url) { await page.goto(`${cfg.portal.url}/claims/list`); await page.waitForTimeout(2000); break; }
    merge(await extract());
    if (byId.size === before) break; // no growth → done
  }
  return [...byId.values()];
}

// Crawl one claim's detail: invoices, reimbursements, documents, totals, flag.
async function getClaimDetail(page, cfg, claim) {
  const num = claim.id.replace(/^C/, '');
  await page.goto(`${cfg.portal.url}/claims/details/${cfg.portal.policyId}/${num}?source=crawl`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  if (!await isLoggedIn(page)) throw new Error('LOGGED_OUT');
  await page.waitForFunction((id) => document.body.innerText.includes(id), claim.id, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  for (const label of ['Invoices', 'Reimbursements', 'Submitted Documents']) {
    const h = page.getByText(label, { exact: false }).first();
    if (await h.count()) { await h.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(700); }
  }
  await page.waitForTimeout(600);
  const t = await page.evaluate(() => document.body.innerText);
  const num2 = n => parseFloat(String(n).replace(/[\s,]/g, '')) || 0;
  // slice to sections to avoid header nav ("Provider finder") polluting matches
  const section = (start, ...ends) => {
    const i = t.indexOf(start); if (i < 0) return '';
    let j = t.length; for (const e of ends) { const k = t.indexOf(e, i + start.length); if (k >= 0) j = Math.min(j, k); }
    return t.slice(i + start.length, j);
  };
  const invText = section('\nInvoices', '\nReimbursements', '\nSubmitted Documents');
  const reimText = section('\nReimbursements', '\nSubmitted Documents');

  const invoices = [];
  let m, reI = /Provider\s*(.+?)\s*Patient\s*(.+?)\s*Invoice date\s*(.+?)\s*(?:Treatment\s*(.+?)\s*)?Amount\s*([\d,.]+)\s*CZK/gs;
  while ((m = reI.exec(invText)) !== null)
    invoices.push({ provider: m[1].trim(), patient: m[2].trim(), invoice_date: m[3].trim(), treatment: (m[4] || '').trim() || null, amount: num2(m[5]) });

  const reimbursements = [];
  let reR = /Reimbursement date\s*(.+?)\s*Reference\s*(.+?)\s*Reimbursed\s*(.+?)\s*Reimbursement method\s*(.+?)\s*Amount\s*([\d,.]+)\s*CZK/gs;
  while ((m = reR.exec(reimText)) !== null) {
    const ref = m[2].trim(); const cat = (ref.split(/[.·]/).pop() || '').trim();
    reimbursements.push({ date: m[1].trim(), reference: ref, category: cat, reimbursed_to: m[3].trim(), method: m[4].trim(), amount: num2(m[5]) });
  }

  const doc_count = (t.match(/DOCUMENT\s+\d+/g) || []).length;
  const total_invoiced = invoices.reduce((s, i) => s + i.amount, 0);
  const total_reimbursed = reimbursements.reduce((s, r) => s + r.amount, 0);
  const status = claim.status;
  let flag;
  if (/progress|pending|submitted|received|open/i.test(status)) flag = 'pending';
  else if (total_reimbursed === 0 && total_invoiced > 0) flag = 'declined';
  else if (total_reimbursed + 1 < total_invoiced) flag = 'partial';
  else flag = 'paid';

  return {
    id: claim.id, received_date: claim.received, received_iso: parseMonth(claim.received), status,
    total_invoiced, total_reimbursed, reimbursed_date: reimbursements[0] ? reimbursements[0].date : null,
    flag, doc_count, invoices, reimbursements,
  };
}

module.exports = { connect, getPage, isLoggedIn, selectDropdown, fillInput, startClaim, addInvoice, saveInvoice, listInvoices, submitClaim, getClaimsList, listAllClaims, getClaimDetail };
