// Tracker dashboard — renders claims from chrome.storage.local, fully formula-free (computed in JS).
// Spike-independent: reads stored data, never touches the portal here. Refresh asks the background
// to crawl (when logged in); Import/Export round-trip CSV.
import { enrich } from '../lib/enrich.js';
import { claimsToCSV, claimsFromCSV } from '../lib/csv.js';

const $ = sel => document.querySelector(sel);
const fmt = n => Math.round(n).toLocaleString();
const uniq = a => [...new Set(a)].filter(Boolean);
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const groupSum = (rows, key, amt) => {
  const m = new Map();
  for (const r of rows) { const k = key(r) || '?'; const v = m.get(k) || { n: 0, amt: 0 }; v.n++; v.amt += amt(r); m.set(k, v); }
  return [...m.entries()].sort((a, b) => b[1].amt - a[1].amt);
};

async function load() {
  const { claims = [], config = {} } = await chrome.storage.local.get(['claims', 'config']);
  return { claims: claims.map(c => enrich(c, config)), config };
}

function render({ claims }) {
  if (!claims.length) return; // keep the empty-state message
  const inv = sum(claims, c => c.total_invoiced), reimb = sum(claims, c => c.total_reimbursed);
  const allInv = claims.flatMap(c => c.invoices.map(i => ({ ...i, claim: c.id })));
  $('#totals').innerHTML = `
    <div>Claims</div><b>${claims.length}</b>
    <div>Invoiced</div><b>${fmt(inv)} CZK</b>
    <div>Reimbursed</div><b>${fmt(reimb)} CZK (${inv ? Math.round(100 * reimb / inv) : 0}%)</b>
    <div>Outstanding</div><b>${fmt(inv - reimb)} CZK</b>`;

  const attn = claims.filter(c => ['declined', 'under', 'over', 'review'].includes(c.check));
  const flag = c => `<span class="flag ${c.check}">${c.check}</span>`;
  const claimRow = c => `<tr><td>${c.id}</td><td>${c.received_date || ''}</td><td>${flag(c)}</td>` +
    `<td class="num">${fmt(c.total_invoiced)}</td><td class="num">${fmt(c.total_reimbursed)}</td>` +
    `<td>${uniq(c.invoices.map(i => i.patient)).join(', ')}</td></tr>`;
  const table = (rows) => `<table><tr><th>Claim</th><th>Received</th><th>Check</th><th class="num">Invoiced</th><th class="num">Reimb.</th><th>Patients</th></tr>${rows.map(claimRow).join('')}</table>`;
  const agg = (title, pairs) => `<h2>${title}</h2><table><tr><th>${title.split(' ')[1] || ''}</th><th class="num">#</th><th class="num">Invoiced</th></tr>` +
    pairs.map(([k, v]) => `<tr><td>${k}</td><td class="num">${v.n}</td><td class="num">${fmt(v.amt)}</td></tr>`).join('') + `</table>`;

  $('#content').innerHTML =
    (attn.length ? `<h2>⚠ Needs attention (${attn.length})</h2>${table(attn)}` : `<p class="muted">✓ Nothing declined or under-paid.</p>`) +
    `<h2>All claims</h2>${table(claims.slice().sort((a, b) => (b.received_iso || '').localeCompare(a.received_iso || '')))}` +
    agg('By patient', groupSum(allInv, i => i.patient, i => i.amount)) +
    agg('By category', groupSum(allInv, i => i.category, i => i.amount)) +
    agg('By provider', groupSum(allInv, i => i.provider, i => i.amount));
}

async function refresh() { render(await load()); }

// --- actions ---
$('#refresh').addEventListener('click', () => {
  $('#refresh').textContent = '↻ Crawling…';
  chrome.runtime.sendMessage({ type: 'CRAWL' }, () => { $('#refresh').textContent = '↻ Refresh'; refresh(); });
});

$('#export').addEventListener('click', async () => {
  const { claims } = await load();
  const blob = new Blob([claimsToCSV(claims)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'allianz-claims.csv'; a.click();
  URL.revokeObjectURL(a.href);
});

$('#import').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const claims = claimsFromCSV(await file.text());
  await chrome.storage.local.set({ claims });
  refresh();
});

chrome.storage.onChanged.addListener((changes) => { if (changes.claims) refresh(); });
refresh();
