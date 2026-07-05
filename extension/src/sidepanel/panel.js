// Side panel: intake (file invoices) + tracker dashboard. Reads/writes chrome.storage; talks to the
// portal tab's content script for filing. Pure-logic from the ported libs.
import { enrich } from '../lib/enrich.js';
import { claimsToCSV, claimsFromCSV } from '../lib/csv.js';
import { extractText, isImage } from '../lib/extract.js';
import { parseFields } from '../lib/parse.js';
import { classify } from '../lib/classify.js';
import { idbGet, idbSet } from '../lib/idb.js';
import { SUP, baseName, indexFiles, supDocNameSet, resolveDocFiles } from '../lib/docs.js';
import { applyTypeHint, recordPatientCorrection, recordTypeCorrection } from '../lib/learn.js';
import { submittedIndex, computeBatchFlags } from '../lib/dedupe.js';

const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString();
const uniq = a => [...new Set(a)].filter(Boolean);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
let CFG = {};

// seed config from the bundled default on first run
chrome.storage.local.get('config').then(async ({ config }) => {
  if (config) { CFG = config; return; }
  try { CFG = await fetch(chrome.runtime.getURL('config.default.json')).then(r => r.json()); await chrome.storage.local.set({ config: CFG }); } catch { CFG = {}; }
});

// ---------------- portal connection status ----------------
async function pingPortal() {
  const el = $('#portalStatus');
  const [tab] = await chrome.tabs.query({ url: 'https://my.allianzcare.com/*' });
  if (!tab) { el.textContent = '○ portal not open'; el.className = 'muted'; return; }
  chrome.tabs.sendMessage(tab.id, { type: 'PING_PORTAL' }, (r) => {
    if (chrome.runtime.lastError || !r?.ok) { el.textContent = '○ portal tab not ready (reload it)'; el.className = 'muted'; return; }
    el.textContent = r.loggedIn ? '● connected to portal' : '◐ portal open — log in';
    el.className = r.loggedIn ? 'ok-dot' : 'warn-dot';
  });
}
pingPortal();
setInterval(pingPortal, 20000);

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
// index of already-filed invoices (from the crawled/imported claim history) — blocks re-filing
let submittedIdx = {};
const refreshSubmittedIdx = async () => { const { claims = [] } = await chrome.storage.local.get('claims'); submittedIdx = submittedIndex(claims); };
refreshSubmittedIdx();
// index of every supported file the user has granted (folder, recursed, + drops), keyed by lowercased
// relative path AND basename — so config.supplementaryDocs can reference "Child/opg.png" or "opg.png".
let folderFiles = new Map();
const detectProvider = text => (Object.entries(CFG.providers || {}).find(([, kws]) => kws.some(k => (text || '').toLowerCase().includes(k.toLowerCase()))) || [])[0] || CFG.defaultProvider;

// (Re)evaluate a row: classify (keywords → learned provider hint → manual override), resolve its
// supporting docs from the folder, recompute flags. Called on ingest AND after each correction.
function evaluateRow(row) {
  const { parsed, file, text } = row;
  const docAvailable = (docType, patientKey) => resolveDocFiles(folderFiles, CFG, docType, patientKey).found.length > 0;
  let cls = classify(parsed, CFG, { docAvailable, forceTypeKey: row.forcedType });
  cls = applyTypeHint(cls, row.provider, CFG);             // learned provider→type fallback
  const docFiles = [...(row.manualDocs || [])], missingDocs = [];
  for (const need of (cls.type?.requiredDocs || [])) {
    const { found, missing } = resolveDocFiles(folderFiles, CFG, need, parsed.patientName);
    found.forEach(f => { try { f._docType = need; } catch {} }); // groups files per uploader slot when filing
    docFiles.push(...found);
    if (!found.length && !row.manualDocs?.length) missingDocs.push(...missing); // hand-picked docs satisfy
  }
  const flags = [];
  if (!text && isImage(file.name)) flags.push('photo — open & confirm (vision)');
  if (parsed.patientName === '?') flags.push('unknown patient');
  if (parsed.amount === '?') flags.push('no amount');
  if (!cls.typeKey) flags.push('unclassified');
  if (missingDocs.length) flags.push('missing ' + missingDocs.join(' + ') + ' — add to folder');
  Object.assign(row, { cls, docFiles, flags, include: flags.length === 0 });
  return row;
}

async function ingest(files) {
  indexFiles(folderFiles, files);            // so attachments referenced from any row are findable
  const supSet = supDocNameSet(CFG);
  for (const file of files) {
    if (!SUP.test(file.name)) continue;
    if (supSet.has(baseName(file))) continue; // it's a supporting doc, not an invoice to file
    const text = await extractText(file);
    const parsed = parseFields(text, CFG);
    rows.push(evaluateRow({ file, text, parsed, provider: detectProvider(text) }));
  }
  renderReview();
}

const opts = (keys, sel) => ['?', ...keys].map(k => `<option value="${k}" ${k === (sel || '?') ? 'selected' : ''}>${k}</option>`).join('');

function renderReview() {
  const el = $('#review');
  if (!rows.length) { el.innerHTML = ''; $('#fileBar').hidden = true; return; }
  computeBatchFlags(rows, submittedIdx); // duplicates within the batch + already-filed invoices
  el.innerHTML = rows.map((r, i) => { const fl = [...r.flags, ...(r.batchFlags || [])]; return `
    <div class="rev">
      <input type="checkbox" data-i="${i}" ${r.include ? 'checked' : ''} ${fl.length ? 'disabled' : ''}>
      <div style="flex:1">
        <div class="meta">
          <select class="fix-patient" data-i="${i}" title="Correct the patient — the fix is remembered">${opts(Object.keys(CFG.patients || {}), r.parsed.patientName)}</select>
          · ${r.parsed.date} · ${r.parsed.amount} CZK ·
          <select class="fix-type" data-i="${i}" title="Correct the treatment type — remembered for this provider">${opts(Object.keys(CFG.treatmentTypes || {}), r.cls.typeKey)}</select>
          ${r.cls.viaHint ? '<span class="muted" title="classified from a previous correction for this provider">↻</span>' : ''}
        </div>
        <div class="muted">${r.file.name}${r.docFiles?.length ? ` · 📎 ${r.docFiles.map(d => d.name).join(', ')}` : ''}</div>
        ${fl.length ? `<div class="flags">⚠ ${fl.join('; ')}</div>` : ''}
        <button class="attach" data-i="${i}">📎 Attach doc…</button>
      </div>
    </div>`; }).join('');
  el.querySelectorAll('input[type=checkbox]').forEach(c => c.addEventListener('change', e => { rows[+e.target.dataset.i].include = e.target.checked; }));
  el.querySelectorAll('.attach').forEach(b => b.addEventListener('click', e => { attachIdx = +e.currentTarget.dataset.i; const inp = $('#attachFile'); inp.value = ''; inp.click(); }));
  // the flywheel: corrections fix the row AND teach the config for next time
  el.querySelectorAll('.fix-patient').forEach(s => s.addEventListener('change', async e => {
    const r = rows[+e.target.dataset.i], v = e.target.value;
    r.parsed.patientName = v;
    if (v !== '?') { recordPatientCorrection(CFG, v, r.parsed.raw); await chrome.storage.local.set({ config: CFG }); }
    evaluateRow(r); renderReview();
  }));
  el.querySelectorAll('.fix-type').forEach(s => s.addEventListener('change', async e => {
    const r = rows[+e.target.dataset.i], v = e.target.value;
    r.forcedType = v === '?' ? null : v;
    if (r.forcedType && r.provider) { recordTypeCorrection(CFG, r.provider, r.forcedType); await chrome.storage.local.set({ config: CFG }); }
    evaluateRow(r); renderReview();
  }));
  $('#fileBar').hidden = false;
}

// per-row manual attach — supplement (or override) the config-folder resolution by hand-picking a doc.
let attachIdx = -1;
$('#attachFile').addEventListener('change', e => {
  if (attachIdx < 0 || !e.target.files.length) return;
  const r = rows[attachIdx];
  r.manualDocs = [...(r.manualDocs || []), ...e.target.files]; // survives re-evaluation
  attachIdx = -1;
  evaluateRow(r); renderReview();
});

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
    docs: await Promise.all((r.docFiles || []).map(async d => ({ name: d.name, b64: await toB64(d), docType: d._docType || null }))),
  });
  status.textContent = 'filing… (watch the Allianz tab; it stops at the overview)';
  const onProg = m => { if (m?.type === 'FILE_PROGRESS') status.textContent = `${m.i}/${m.total} ${m.state}${m.id ? ' — ' + m.id : ''}`; };
  chrome.runtime.onMessage.addListener(onProg);
  chrome.tabs.sendMessage(tab.id, { type: 'FILE_INVOICES', config: CFG, invoices }, (resp) => {
    chrome.runtime.onMessage.removeListener(onProg);
    if (chrome.runtime.lastError) { status.textContent = 'Error: ' + chrome.runtime.lastError.message; return; }
    if (!resp?.ok) { status.textContent = 'Failed: ' + (resp?.error || '?'); return; }
    const ok = resp.results.filter(x => x.ok).length;
    status.textContent = `Added ${ok}/${resp.results.length} — review the overview in the Allianz tab, then submit there.`;
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
// recurse the granted folder, tagging each file with its relative path (so subfolder docs resolve).
async function collectFiles(handle, prefix = '') {
  const out = [];
  for await (const entry of handle.values()) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.kind === 'directory') out.push(...await collectFiles(entry, rel));
    else if (entry.kind === 'file' && SUP.test(entry.name)) { const f = await entry.getFile(); try { f._relPath = rel; } catch {} out.push(f); }
  }
  return out;
}
async function scanFolder(handle) {
  rows = []; folderFiles = new Map();          // fresh scan → rebuild the file index from scratch
  await ingest(await collectFiles(handle));     // ingest indexes attachments + reviews invoices
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
    agg('By patient', groupSum(allInv, i => i.patient, i => i.amount)) + agg('By category', groupSum(allInv, i => i.category, i => i.amount)) +
    agg('By provider', groupSum(allInv, i => i.provider, i => i.amount)) +
    agg('By month', groupSum(claims, c => (c.received_iso || '').slice(0, 7), c => c.total_invoiced).sort((a, b) => b[0].localeCompare(a[0]))) +
    agg('By status', groupSum(claims, c => c.status, c => c.total_invoiced));
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
chrome.storage.onChanged.addListener(ch => {
  if (ch.claims) { renderDash(); refreshSubmittedIdx().then(() => { if (rows.length) renderReview(); }); } // fresh crawl may reveal already-filed rows
  if (ch.config) chrome.storage.local.get('config').then(({ config }) => { CFG = config || {}; });
});
renderDash();
