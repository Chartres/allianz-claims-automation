// Side panel: intake (file invoices) + tracker dashboard. Reads/writes chrome.storage; talks to the
// portal tab's content script for filing. Pure-logic from the ported libs.
import { enrich } from '../lib/enrich.js';
import { claimsToCSV, claimsFromCSV } from '../lib/csv.js';
import { extractText, isImage } from '../lib/extract.js';
import { parseFields } from '../lib/parse.js';
import { classify } from '../lib/classify.js';
import { idbGet, idbSet } from '../lib/idb.js';

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString();
const uniq = a => [...new Set(a)].filter(Boolean);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const SUP = /\.(pdf|png|jpe?g|tiff?|bmp|gif|webp|heic|heif)$/i;
let CFG = {};

// seed config from the bundled default on first run
chrome.storage.local.get('config').then(async ({ config }) => {
  if (config) { CFG = config; return; }
  try { CFG = await fetch(chrome.runtime.getURL('config.default.json')).then(r => r.json()); await chrome.storage.local.set({ config: CFG }); } catch { CFG = {}; }
});

// ---------------- onboarding: discover settings from the portal ----------------
function applyDiscovery(found) {
  const P = CFG.portal = CFG.portal || {};
  if (found.payee?.length) P.payee = found.payee.includes('Insured member') ? 'Insured member' : found.payee[0];
  if (found.method?.length) P.paymentMethod = found.method.find(m => /bank/i.test(m)) || found.method[0];
  if (found.banks?.length) { const b = found.banks.find(x => x.country === 'CZE') || found.banks[0]; P.bankAccountMatch = b.last4; if (b.currency) P.currencyMatch = '^' + b.currency; }
  const cz = (found.countries || []).find(c => /czech/i.test(c)); if (cz) P.countryMatch = cz;
  if (found.patients?.length) {
    const pats = {};
    for (const label of found.patients) { const key = label.split(/\s+/)[0]; pats[key] = { portalLabel: label, aliases: [label.replace(/\s*\(\d{4}\)\s*$/, '').trim()] }; }
    CFG.patients = pats;
  }
}
$('#setup').addEventListener('click', () => $('#sampleFile').click());
$('#sampleFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; const s = $('#setupStatus');
  const [tab] = await chrome.tabs.query({ url: 'https://my.allianzcare.com/*' });
  if (!tab) { s.textContent = 'Open & log into Allianz first.'; return; }
  s.textContent = 'reading the portal…';
  const payload = { type: 'DISCOVER', config: CFG };
  if (file) { payload.sampleB64 = await toB64(file); payload.sampleName = file.name; }
  chrome.tabs.sendMessage(tab.id, payload, async (resp) => {
    if (chrome.runtime.lastError || !resp?.ok) { s.textContent = 'Failed: ' + (chrome.runtime.lastError?.message || resp?.error || '?'); return; }
    applyDiscovery(resp.found);
    await chrome.storage.local.set({ config: CFG });
    const f = resp.found;
    s.textContent = `✓ Saved — payee · ${(f.banks || []).length} account(s) · ${(f.patients || []).length} family member(s). Fine-tune in Options.`;
  });
});

// ---------------- intake ----------------
let rows = [];
const detectProvider = text => (Object.entries(CFG.providers || {}).find(([, kws]) => kws.some(k => (text || '').toLowerCase().includes(k.toLowerCase()))) || [])[0] || CFG.defaultProvider;

async function ingest(files) {
  for (const file of files) {
    if (!SUP.test(file.name)) continue;
    const text = await extractText(file);
    const parsed = parseFields(text, CFG);
    const cls = classify(parsed, CFG, { docAvailable: () => true });
    const flags = [];
    if (!text && isImage(file.name)) flags.push('photo — open & confirm (vision)');
    if (parsed.patientName === '?') flags.push('unknown patient');
    if (parsed.amount === '?') flags.push('no amount');
    if (!cls.typeKey) flags.push('unclassified');
    if (cls.type?.requiredDocs?.length) flags.push('needs ' + cls.type.requiredDocs.join('+'));
    rows.push({ file, parsed, cls, provider: detectProvider(text), flags, include: flags.length === 0 });
  }
  renderReview();
}

function renderReview() {
  const el = $('#review');
  if (!rows.length) { el.innerHTML = ''; $('#fileBar').hidden = true; return; }
  el.innerHTML = rows.map((r, i) => `
    <div class="rev">
      <input type="checkbox" data-i="${i}" ${r.include ? 'checked' : ''} ${r.flags.length ? 'disabled' : ''}>
      <div>
        <div class="meta"><b>${r.parsed.patientName}</b> · ${r.parsed.date} · ${r.parsed.amount} CZK · ${r.cls.typeKey || '?'}</div>
        <div class="muted">${r.file.name}</div>
        ${r.flags.length ? `<div class="flags">⚠ ${r.flags.join('; ')}</div>` : ''}
      </div>
    </div>`).join('');
  el.querySelectorAll('input[type=checkbox]').forEach(c => c.addEventListener('change', e => { rows[+e.target.dataset.i].include = e.target.checked; }));
  $('#fileBar').hidden = false;
}

const toB64 = async (file) => {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
};

$('#fileThese').addEventListener('click', async () => {
  const chosen = rows.filter(r => r.include);
  if (!chosen.length) return;
  const status = $('#fileStatus'); status.textContent = 'preparing…';
  const [tab] = await chrome.tabs.query({ url: 'https://my.allianzcare.com/*' });
  if (!tab) { status.textContent = 'Open & log into Allianz in a tab first.'; return; }
  const invoices = [];
  for (const r of chosen) invoices.push({
    meta: { id: r.file.name },
    invoiceName: r.file.name,
    invoiceB64: await toB64(r.file),
    fields: {
      patientLabel: (CFG.patients?.[r.parsed.patientName] || {}).portalLabel || r.parsed.patientName,
      provider: r.provider, date: r.parsed.date, amount: r.parsed.amount,
      category: r.cls.type.category, subtype: r.cls.type.subtype || null, reason: r.cls.type.reason || null,
    },
    docs: [],
  });
  status.textContent = 'filing… (watch the Allianz tab; it stops at the overview)';
  chrome.tabs.sendMessage(tab.id, { type: 'FILE_INVOICES', config: CFG, invoices }, (resp) => {
    if (chrome.runtime.lastError) { status.textContent = 'Error: ' + chrome.runtime.lastError.message; return; }
    if (!resp?.ok) { status.textContent = 'Failed: ' + (resp?.error || '?'); return; }
    const ok = resp.results.filter(x => x.ok).length;
    status.textContent = `Added ${ok}/${resp.results.length}. ${resp.note || ''} Review the overview, then submit.`;
  });
});

// drop zone (fallback A)
const dz = $('#dropzone');
['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', e => ingest([...e.dataTransfer.files]));

// folder (primary B) — File System Access, handle persisted in IndexedDB, rescan on open
async function verifyPermission(handle) {
  const opts = { mode: 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission(opts)) === 'granted';
}
async function scanFolder(handle) {
  rows = [];
  const files = [];
  for await (const entry of handle.values()) if (entry.kind === 'file' && SUP.test(entry.name)) files.push(await entry.getFile());
  await ingest(files);
}
$('#pickFolder').addEventListener('click', async () => {
  const handle = await window.showDirectoryPicker().catch(() => null);
  if (!handle) return;
  await idbSet('folder', handle);
  $('#folderName').textContent = '📁 ' + handle.name; $('#rescan').hidden = false;
  await scanFolder(handle);
});
$('#rescan').addEventListener('click', async () => {
  const handle = await idbGet('folder'); if (!handle) return;
  if (!await verifyPermission(handle)) { $('#folderName').textContent = '(permission needed — click Choose folder)'; return; }
  await scanFolder(handle);
});
idbGet('folder').then(async (handle) => {
  if (!handle) return;
  $('#folderName').textContent = '📁 ' + handle.name; $('#rescan').hidden = false;
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') scanFolder(handle); // else wait for Rescan gesture
});

// ---------------- tracker dashboard ----------------
const groupSum = (arr, key, amt) => { const m = new Map(); for (const r of arr) { const k = key(r) || '?'; const v = m.get(k) || { n: 0, amt: 0 }; v.n++; v.amt += amt(r); m.set(k, v); } return [...m.entries()].sort((a, b) => b[1].amt - a[1].amt); };

async function loadClaims() { const { claims = [] } = await chrome.storage.local.get('claims'); return claims.map(c => enrich(c, CFG)); }

async function renderDash() {
  const claims = await loadClaims();
  if (!claims.length) return;
  const inv = sum(claims, c => c.total_invoiced), reimb = sum(claims, c => c.total_reimbursed);
  const allInv = claims.flatMap(c => c.invoices.map(i => ({ ...i, claim: c.id })));
  $('#totals').innerHTML = `<div>Claims</div><b>${claims.length}</b><div>Invoiced</div><b>${fmt(inv)} CZK</b>` +
    `<div>Reimbursed</div><b>${fmt(reimb)} (${inv ? Math.round(100 * reimb / inv) : 0}%)</b><div>Outstanding</div><b>${fmt(inv - reimb)} CZK</b>`;
  const attn = claims.filter(c => ['declined', 'under', 'over', 'review'].includes(c.check));
  const cRow = c => `<tr><td>${c.id}</td><td><span class="flag ${c.check}">${c.check}</span></td><td class="num">${fmt(c.total_invoiced)}</td><td class="num">${fmt(c.total_reimbursed)}</td><td>${uniq(c.invoices.map(i => i.patient)).join(', ')}</td></tr>`;
  const tbl = rs => `<table><tr><th>Claim</th><th>Check</th><th class="num">Inv.</th><th class="num">Reimb.</th><th>Patients</th></tr>${rs.map(cRow).join('')}</table>`;
  const agg = (t, pairs) => `<h2>${t}</h2><table>${pairs.map(([k, v]) => `<tr><td>${k}</td><td class="num">${v.n}</td><td class="num">${fmt(v.amt)}</td></tr>`).join('')}</table>`;
  $('#content').innerHTML = (attn.length ? `<h2>⚠ Needs attention (${attn.length})</h2>${tbl(attn)}` : `<p class="muted">✓ Nothing declined/under-paid.</p>`) +
    `<h2>All claims</h2>${tbl(claims.slice().sort((a, b) => (b.received_iso || '').localeCompare(a.received_iso || '')))}` +
    agg('By patient', groupSum(allInv, i => i.patient, i => i.amount)) + agg('By category', groupSum(allInv, i => i.category, i => i.amount));
}

$('#refresh').addEventListener('click', () => {
  $('#refresh').textContent = '↻ Crawling…';
  chrome.runtime.sendMessage({ type: 'CRAWL' }, () => { $('#refresh').textContent = '↻ Refresh'; renderDash(); });
});
$('#export').addEventListener('click', async () => {
  const blob = new Blob([claimsToCSV(await loadClaims())], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'allianz-claims.csv'; a.click(); URL.revokeObjectURL(a.href);
});
$('#import').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; await chrome.storage.local.set({ claims: claimsFromCSV(await f.text()) }); renderDash(); });
chrome.storage.onChanged.addListener(ch => { if (ch.claims) renderDash(); if (ch.config) chrome.storage.local.get('config').then(({ config }) => { CFG = config || {}; }); });
renderDash();
