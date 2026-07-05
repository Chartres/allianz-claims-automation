// Duplicate-filing protection — ported from the CLI's bin/intake.js (live-tested there).
// Two layers, both batch-level (they need to see all rows / the whole claim history, so they run
// after per-row evaluateRow): (1) an invoice matching a claim already in the crawled/imported
// history is blocked; (2) the same faktura arriving twice in one batch (original + reissued
// "paid" copy + a receipt) collapses to the best copy, the rest are flagged.

const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const normDate = s => { const m = s && s.match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/); return m ? `${m[1].padStart(2, '0')}/${MON[m[2].toLowerCase()]}/${m[3]}` : null; };

// Signatures of invoices already filed, keyed patientFirstWord|DD/MM/YYYY|roundedAmount → claim id.
export function submittedIndex(claims) {
  const byKey = {};
  for (const c of claims || []) for (const inv of (c.invoices || [])) {
    const d = normDate(inv.invoice_date);
    if (!d) continue;
    byKey[`${(inv.patient || '').split(/\s+/)[0]}|${d}|${Math.round(inv.amount)}`] = c.id;
  }
  return byKey;
}

// Recompute every row's batchFlags (idempotent — call after any evaluateRow pass, before render).
// Flagged rows are forced out of the filing selection: never file duplicates.
export function computeBatchFlags(rows, submitted) {
  for (const r of rows) r.batchFlags = [];

  for (const r of rows) {
    if (!submitted || r.parsed.amount === '?' || r.parsed.date === '?') continue;
    const already = submitted[`${r.parsed.patientName}|${r.parsed.date}|${Math.round(Number(r.parsed.amount))}`];
    if (already) r.batchFlags.push(`already submitted (claim ${already})`);
  }

  // Best copy of a shared VS = paid, then no other issues, then a filename that looks like a receipt.
  const groups = {};
  for (const r of rows) { const vs = r.parsed.vs; if (vs) (groups[vs] ||= []).push(r); }
  const rank = r => (r.parsed.paid === true ? 4 : 0) + (r.flags.length === 0 ? 2 : 0) + (/doklad|uhrazen/i.test(r.file.name) ? 1 : 0);
  for (const [vs, group] of Object.entries(groups)) {
    if (group.length < 2) continue;
    const keep = group.slice().sort((x, y) => rank(y) - rank(x))[0];
    for (const r of group) if (r !== keep) r.batchFlags.push(`duplicate of ${keep.file.name} (VS ${vs})`);
  }

  for (const r of rows) if (r.batchFlags.length) r.include = false;
}
