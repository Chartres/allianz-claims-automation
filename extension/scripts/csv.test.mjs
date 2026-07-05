// Unit tests for lib/csv.js — run with: node scripts/csv.test.mjs
// Synthetic data only.
import { toCSV, fromCSV, claimsToCSV, claimsFromCSV } from '../src/lib/csv.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

// ---- toCSV / fromCSV round-trip ----
{
  const rows = [{ a: 'x', b: 'has,comma' }, { a: 'q"uote', b: 'multi\nline' }];
  const back = fromCSV(toCSV(rows));
  eq('round-trips commas/quotes/newlines', back, rows);
  eq('fromCSV skips blank trailing line', fromCSV('a,b\n1,2\n'), [{ a: '1', b: '2' }]);
}

// ---- claimsFromCSV ----
{
  const csv = [
    'Claim,Received,Status,Check,Patient,Provider,Category,Coverage%,Amount,ClaimInvoiced,ClaimReimbursed',
    '84512001,12/01/2026,Completed,ok,Tomáš,Stomatologie Vltava,Dental treatment,100,1850,2790,2602',
    '84512001,12/01/2026,Completed,ok,Jana,Lékárna U Anděla,Medication,80,940,2790,2602',
    '84512003,2026-02-17,Completed,declined,Tomáš,Stomatologie Vltava,Dental treatment,100,12500,12500,0',
  ].join('\n');
  const claims = claimsFromCSV(csv);
  eq('groups invoices back into claims', claims.length, 2);
  eq('keeps both invoices of a claim', claims[0].invoices.length, 2);
  eq('parses totals', [claims[0].total_invoiced, claims[0].total_reimbursed], [2790, 2602]);
  // received_iso must be derived so the dashboard's By-month aggregate works on imported data
  eq('derives received_iso from DD/MM/YYYY', claims[0].received_iso, '2026-01-12');
  eq('accepts ISO dates as-is', claims[1].received_iso, '2026-02-17');
}

// ---- claimsToCSV → claimsFromCSV round-trip ----
{
  const claim = {
    id: '84512005', received_date: '09/04/2026', received_iso: '2026-04-09', status: 'In Progress',
    check: 'pending', total_invoiced: 3200, total_reimbursed: 0, reimbursements: [],
    invoices: [{ patient: 'Tomáš', provider: 'Stomatologie Vltava', amount: 3200, category: 'Dental treatment', coverage_pct: 100, invoice_date: '2 Apr 2026' }],
  };
  const back = claimsFromCSV(claimsToCSV([claim]));
  eq('round-trips a claim', [back[0].id, back[0].total_invoiced, back[0].invoices[0].amount], ['84512005', 3200, 3200]);
  eq('round-trip regains received_iso', back[0].received_iso, '2026-04-09');
  // invoice_date must survive so the duplicate-filing guard still works on imported data
  eq('round-trips invoice_date', back[0].invoices[0].invoice_date, '2 Apr 2026');
  ok('import tolerates CSVs without the InvoiceDate column', claimsFromCSV('Claim,Received,Status,Check,Patient,Provider,Category,Coverage%,Amount,ClaimInvoiced,ClaimReimbursed\n1,12/01/2026,Completed,,J,P,C,80,10,10,8')[0].invoices[0].invoice_date === '');
}

console.log(fail ? `\n✗ FAIL — ${pass} passed, ${fail} failed.` : `\n✓ PASS — ${pass} passed, 0 failed.`);
process.exit(fail ? 1 : 0);
