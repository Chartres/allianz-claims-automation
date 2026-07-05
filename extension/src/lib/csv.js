// CSV round-trip for the tracker — export the dashboard data and re-import it later.
// Browser ESM, RFC-4180-ish (quotes fields with comma/quote/newline; doubles inner quotes).

export function toCSV(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
  const esc = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

export function fromCSV(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter(r => r.length > 1 || (r[0] && r[0].trim()))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// Flatten claims → one CSV row per invoice (round-trips the full tracker). Import groups by Claim back.
const INV_COLS = ['Claim', 'Received', 'Status', 'Check', 'Patient', 'Provider', 'Category', 'Coverage%', 'Amount', 'InvoiceDate', 'ClaimInvoiced', 'ClaimReimbursed'];

export function claimsToCSV(enrichedClaims) {
  const rows = [];
  for (const c of enrichedClaims) for (const i of (c.invoices.length ? c.invoices : [{}]))
    rows.push({ Claim: c.id, Received: c.received_date, Status: c.status, Check: c.check, Patient: i.patient || '', Provider: i.provider || '', Category: i.category || '', 'Coverage%': i.coverage_pct ?? '', Amount: i.amount ?? '', InvoiceDate: i.invoice_date || '', ClaimInvoiced: c.total_invoiced, ClaimReimbursed: c.total_reimbursed });
  return toCSV(rows, INV_COLS);
}

// Derive an ISO date from the portal's DD/MM/YYYY (or an already-ISO string) so the dashboard's
// By-month aggregate works on imported data, not just crawled data.
const toISO = (d) => {
  const m = /^(\d{2})[\/.](\d{2})[\/.](\d{4})$/.exec(d || '');
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(d || '') ? d.slice(0, 10) : '';
};

export function claimsFromCSV(text) {
  const byId = new Map();
  for (const r of fromCSV(text)) {
    if (!r.Claim) continue;
    if (!byId.has(r.Claim)) byId.set(r.Claim, { id: r.Claim, received_date: r.Received, received_iso: toISO(r.Received), status: r.Status, total_invoiced: +r.ClaimInvoiced || 0, total_reimbursed: +r.ClaimReimbursed || 0, reimbursements: [], invoices: [] });
    if (r.Amount !== '') byId.get(r.Claim).invoices.push({ patient: r.Patient, provider: r.Provider, amount: +r.Amount || 0, invoice_date: r.InvoiceDate || '', category: r.Category });
  }
  return [...byId.values()];
}
