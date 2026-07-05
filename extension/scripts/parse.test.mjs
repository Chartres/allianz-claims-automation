// Tests for the parse + classify layer (synthetic names — no personal data).
// Covers the real-world-invoice fixes from the CLI's live run: recipient-block patient matching
// (never the bare config key — it collides with staff names), 1–2 digit dates across label
// variants, and keyword matching that survives extractor-injected mid-word spaces.
// Run: node extension/scripts/parse.test.mjs
import { parseFields } from '../src/lib/parse.js';
import { classify } from '../src/lib/classify.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.log(`✗ ${msg}`)); };
const eq = (got, want, msg) => { if (got === want) pass++; else { fail++; console.log(`✗ ${msg}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); } };

const cfg = {
  patients: {
    Pavel: { portalLabel: 'Pavel Novak (1980)', aliases: ['Pavel Novák'] },
    Jana: { portalLabel: 'Jana Novakova (1985)', aliases: ['Jana Nováková'] },
  },
  treatmentTypes: {
    routineDental: { category: 'Dental Expenses', subtype: 'Routine Dental Treatment', requiredDocs: [], keywords: ['zubního kamene', 'preventivní', 'prohlídka'] },
    orthodontic: { category: 'Dental Expenses', subtype: 'Orthodontic treatment', requiredDocs: ['dentalPlan', 'xray'], keywords: ['ortodont', 'rovnátk'] },
  },
};

// ── patient matching ──
// The supplier block names a dentist whose first name equals a config key; the recipient is Jana.
// Bare keys must never match (staff collision); the Odběratel block wins.
const collide = parseFields(
  'Dodavatel: MDDr. Pavel Čurda, Stomatologie s.r.o.\nOdběratel: Jana Nováková\nPraha 5\n\nDatum vystavení: 03.06.2026\nCelkem k úhradě: 1 500,00 Kč',
  cfg,
);
eq(collide.patientName, 'Jana', 'recipient block beats a staff name earlier in the text');

const staffOnly = parseFields('Dodavatel: MDDr. Pavel Čurda\nFaktura za služby\nCelkem: 500 Kč', cfg);
eq(staffOnly.patientName, '?', 'bare config key never matches (staff-name collision)');

const aliasAnywhere = parseFields('Pacient: Jana Nováková, kontrola', cfg);
eq(aliasAnywhere.patientName, 'Jana', 'alias still matches outside a labelled recipient block');

const viaLabel = parseFields('Bill to: Pavel Novak (1980)\nInvoice date: 3.6.2026\nTotal 200', cfg);
eq(viaLabel.patientName, 'Pavel', 'portalLabel matches inside an English Bill-to block');

// ── date extraction ──
eq(parseFields('Datum vystavení: 3.6.2026\n', cfg).date, '03/06/2026', 'pads 1-digit day/month (Datum vystavení)');
eq(parseFields('Datum uskutečnění zdanitelného plnění: 05.06.2026', cfg).date, '05/06/2026', 'Datum uskutečnění still parses');
eq(parseFields('Invoice date: 12/06/2026', cfg).date, '12/06/2026', 'English Invoice date with slashes');
eq(parseFields('žádné datum tady', cfg).date, '?', 'missing date → ?');

// ── classify: extractor-injected mid-word spaces ──
const squished = classify({ items: [], raw: 'Odstranění zubního kam ene a instruktáž', patientName: 'Jana' }, cfg, {});
eq(squished.typeKey, 'routineDental', 'keyword matches despite an injected mid-word space');
const squishedKw = classify({ items: [], raw: 'O rtodontická kontrola', patientName: 'Jana' }, cfg, {});
eq(squishedKw.typeKey, 'orthodontic', 'squished haystack also bridges spaces inside the keyword region');
const clean = classify({ items: ['Preventivní prohlídka'], raw: '', patientName: 'Jana' }, cfg, {});
eq(clean.typeKey, 'routineDental', 'normal matching unaffected');

console.log(`\n${fail ? '✗ FAIL' : '✓ PASS'} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
