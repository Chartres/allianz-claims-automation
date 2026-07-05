// Tests for duplicate-filing protection (synthetic data — no personal data).
// Ported behavior from the CLI's bin/intake.js: an invoice already in the claim history is
// blocked, and the same faktura arriving twice in one batch (original + paid copy + receipt)
// collapses to the best copy. Run: node extension/scripts/dedupe.test.mjs
import { submittedIndex, computeBatchFlags } from '../src/lib/dedupe.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.log(`✗ ${msg}`)); };
const eq = (got, want, msg) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) pass++; else { fail++; console.log(`✗ ${msg}\n    got  ${a}\n    want ${b}`); } };

// ── submittedIndex: keyed patientFirstWord|DD/MM/YYYY|roundedAmount ──
const claims = [
  { id: '84512001', invoices: [{ patient: 'Jana Novakova (1985)', invoice_date: '3 Jun 2026', amount: 1500 }] },
  { id: '84512002', invoices: [{ patient: 'Tomáš Novák', invoice_date: '12 June 2026', amount: 820.4 }] },
  { id: '84512003', invoices: [{ patient: 'Jana Novakova (1985)', invoice_date: 'garbage', amount: 100 }] },
];
const idx = submittedIndex(claims);
eq(idx['Jana|03/06/2026|1500'], '84512001', 'portal "3 Jun 2026" date normalizes and indexes');
eq(idx['Tomáš|12/06/2026|820'], '84512002', 'full month name + fractional amount rounds');
ok(!Object.keys(idx).some(k => k.includes('garbage')), 'unparseable dates are skipped');

// ── already-submitted flag ──
const row = (file, parsed, flags = []) => ({ file: { name: file }, parsed, flags, include: flags.length === 0 });
const r1 = row('inv1.pdf', { patientName: 'Jana', date: '03/06/2026', amount: '1500', vs: null, paid: true });
const r2 = row('inv2.pdf', { patientName: 'Jana', date: '04/06/2026', amount: '1500', vs: null, paid: true });
computeBatchFlags([r1, r2], idx);
eq(r1.batchFlags, ['already submitted (claim 84512001)'], 'matching patient|date|amount is flagged');
ok(r1.include === false, 'already-submitted row is excluded from filing');
eq(r2.batchFlags, [], 'different date passes');
ok(r2.include === true, 'clean row stays included');

// ── batch dedupe by VS: keep the best copy, flag the rest ──
const a = row('faktura-2260001234.pdf', { patientName: 'Jana', date: '05/06/2026', amount: '900', vs: '2260001234', paid: false });
const b = row('doklad-uhrazeno-2260001234.pdf', { patientName: 'Jana', date: '05/06/2026', amount: '900', vs: '2260001234', paid: true });
const c = row('other.pdf', { patientName: 'Jana', date: '06/06/2026', amount: '400', vs: '2260009999', paid: true });
computeBatchFlags([a, b, c], {});
eq(a.batchFlags, ['duplicate of doklad-uhrazeno-2260001234.pdf (VS 2260001234)'], 'unpaid copy flagged as duplicate of the paid one');
ok(a.include === false, 'duplicate is excluded from filing');
eq(b.batchFlags, [], 'best copy kept');
eq(c.batchFlags, [], 'lone VS untouched');

// clean rows beat flagged ones when neither is paid
const d = row('x-2260007777.pdf', { patientName: '?', date: '?', amount: '?', vs: '2260007777', paid: null }, ['unknown patient']);
const e = row('y-2260007777.pdf', { patientName: 'Jana', date: '07/06/2026', amount: '100', vs: '2260007777', paid: null });
computeBatchFlags([d, e], {});
ok(d.batchFlags.length === 1 && e.batchFlags.length === 0, 'issue-free copy wins the dedupe rank');

// flags recompute cleanly on re-evaluation (no accumulation)
computeBatchFlags([d, e], {});
ok(d.batchFlags.length === 1, 'recomputing does not accumulate duplicate flags');

console.log(`\n${fail ? '✗ FAIL' : '✓ PASS'} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
