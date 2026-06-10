// Tests for the correction flywheel (synthetic names — no personal data).
// Run: node extension/scripts/learn.test.mjs
import { normName, learnPatientAlias, applyTypeHint, recordPatientCorrection, recordTypeCorrection } from '../src/lib/learn.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.log(`✗ ${msg}`)); };
const eq = (got, want, msg) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) pass++; else { fail++; console.log(`✗ ${msg}\n    got  ${a}\n    want ${b}`); } };

ok(normName('Žofie Dvořáková') === 'zofie dvorakova', 'normName strips diacritics + lowercases');

const child = { portalLabel: 'Child Surname (2012)', aliases: ['Žofie Dvořáková'] };

// uppercase, diacritic-free rendering in the invoice → learn the exact text form
eq(learnPatientAlias('Odberatel: ZOFIE DVORAKOVA, Praha', 'Child', child), 'ZOFIE DVORAKOVA', 'learns the uppercase diacritic-free form');
// exact alias already present in text → nothing to learn
eq(learnPatientAlias('Pacient: Žofie Dvořáková', 'Child', child), null, 'no learning when exact alias already matches');
// first-name-only appearance → learn it
eq(learnPatientAlias('pro pacienta zofie, termin 3.4.', 'Child', child), 'zofie', 'learns first-name-only form');
// name absent → nothing
eq(learnPatientAlias('Faktura 123 za služby', 'Child', child), null, 'no false learning when name absent');
eq(learnPatientAlias('', 'Child', child), null, 'empty text → null');

// type hints
const cfg = {
  treatmentTypes: { routineDental: { category: 'Dental Expenses', requiredDocs: [] }, orthodontic: { category: 'Dental Expenses', requiredDocs: ['xray'] } },
  patients: { Child: { ...child, aliases: [...child.aliases] } },
};
const unclassified = { typeKey: null, type: null, confidence: 0 };
const hinted = applyTypeHint(unclassified, 'Acme Dental', { ...cfg, typeHints: { 'Acme Dental': 'routineDental' } });
ok(hinted.typeKey === 'routineDental' && hinted.viaHint, 'hint classifies an unclassified invoice');
const keyworded = applyTypeHint({ typeKey: 'orthodontic', type: cfg.treatmentTypes.orthodontic, confidence: 2 }, 'Acme Dental', { ...cfg, typeHints: { 'Acme Dental': 'routineDental' } });
ok(keyworded.typeKey === 'orthodontic', 'keyword classification wins over hint');
ok(applyTypeHint(unclassified, 'Acme Dental', cfg).typeKey === null, 'no hint configured → unchanged');

// record helpers
recordPatientCorrection(cfg, 'Child', 'Odberatel: ZOFIE DVORAKOVA');
ok(cfg.patients.Child.aliases.includes('ZOFIE DVORAKOVA'), 'patient correction persists new alias');
const before = cfg.patients.Child.aliases.length;
recordPatientCorrection(cfg, 'Child', 'Odberatel: ZOFIE DVORAKOVA');
ok(cfg.patients.Child.aliases.length === before, 'idempotent — same correction not duplicated');
recordTypeCorrection(cfg, 'City Clinic', 'orthodontic');
eq(cfg.typeHints['City Clinic'], 'orthodontic', 'type correction persists provider hint');
recordTypeCorrection(cfg, 'City Clinic', 'nonexistent');
eq(cfg.typeHints['City Clinic'], 'orthodontic', 'unknown type not recorded');

console.log(`\n${fail ? '✗ FAIL' : '✓ PASS'} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
