// Pure parsers for the tracker crawl — ported verbatim from the CLI's lib/portal.js (the regexes that
// already work against the live portal). These take page innerText and return structured data, so
// they're solid even before live wiring. The ORCHESTRATION (driving the portal tab across navigations
// while the MV3 service worker sleeps) is the live-only part — see docs/EXTENSION-STATUS.md.

function parseMonth(s) {
  const m = (s || '').match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (!m) return null;
  const mo = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }[m[2]] || '00';
  return `${m[3]}-${mo}-${String(m[1]).padStart(2, '0')}`;
}

// Claims list innerText → [{ id, received, status }]
export function parseClaimsList(text) {
  const out = [];
  const re = /(C3\d{7})\s*Date\s+received:\s*([^\n]+)\s*Submitted\s+by:\s*[^\n]+\s*([A-Za-z][^\n]*)/g;
  let m; while ((m = re.exec(text)) !== null) out.push({ id: m[1], received: m[2].trim(), status: m[3].trim() });
  return out;
}

// Claim-detail innerText → { invoices[], reimbursements[], totals, flag, ... }
export function parseClaimDetail(text, claim, policyId) {
  const num2 = n => parseFloat(String(n).replace(/[\s,]/g, '')) || 0;
  const section = (start, ...ends) => {
    const i = text.indexOf(start); if (i < 0) return '';
    let j = text.length; for (const e of ends) { const k = text.indexOf(e, i + start.length); if (k >= 0) j = Math.min(j, k); }
    return text.slice(i + start.length, j);
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

  const total_invoiced = invoices.reduce((s, i) => s + i.amount, 0);
  const total_reimbursed = reimbursements.reduce((s, r) => s + r.amount, 0);
  const status = claim.status;
  let flag;
  if (/progress|pending|submitted|received|open/i.test(status)) flag = 'pending';
  else if (total_reimbursed === 0 && total_invoiced > 0) flag = 'declined';
  else if (total_reimbursed + 1 < total_invoiced) flag = 'partial';
  else flag = 'paid';

  return { id: claim.id, received_date: claim.received, received_iso: parseMonth(claim.received), status, total_invoiced, total_reimbursed, reimbursed_date: reimbursements[0]?.date || null, flag, invoices, reimbursements };
}

// Detail URL for a claim (same pattern the CLI uses).
export const detailUrl = (base, policyId, id) => `${base}/claims/details/${policyId}/${id.replace(/^C/, '')}?source=ext`;
