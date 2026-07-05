#!/usr/bin/env node
// Self-check for the pure parsing/classification/dedup logic — no portal, no network.
//   node test/selfcheck.js
const assert = require('assert');
const path = require('path');
const { matchPatientInText, extractDate } = require('../lib/pdf');
const { classify } = require('../lib/classify');
const { dedupeByVs } = require('../bin/intake');

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ✓', name); };

const cfg = {
  patients: {
    Pavol: { portalLabel: 'Pavol Dravecky (1985)', aliases: ['Pavol Dravecký'] },
    Eliza: { portalLabel: 'Eliza Dravecka (2009)', aliases: ['Eliza Dravecká'] },
    Agnes: { portalLabel: 'Agnes Dravecka (2010)', aliases: ['Agnes Dravecká'] },
  },
  treatmentTypes: {
    orthodontic:   { category: 'Dental Expenses', subtype: 'Orthodontic treatment', requiredDocs: [], keywords: ['ortodont', 'niti', 'oblouk'] },
    routineDental: { category: 'Dental Expenses', subtype: 'Routine Dental Treatment', requiredDocs: [], keywords: ['rtg', 'bitewing', 'preventivní', 'prohlídka', 'zubn'] },
    psychotherapy: { category: 'Doctor Visit', subtype: 'Psychotherapy consultation', requiredDocs: [], keywords: ['psychoterap', 'terapie'] },
  },
  supplementaryDocs: {}, patientOverrides: {},
};

console.log('patient matching (recipient wins; dentist first-name must not collide):');
ok('recipient patient beats dentist with same first name', () => {
  const t = 'Dodavatel: Schill Dental Clinic   Odběratel: Eliza Dravecká\nK Panskému poli\nOdpovědná osoba: MDDr. Pavol Čurilla';
  assert.strictEqual(matchPatientInText(cfg, t), 'Eliza');
});
ok('dentist named Pavol on Agnes invoice → Agnes', () => {
  const t = 'Odběratel: Agnes Dravecká\nVystavil: MDDr. Pavol Čurilla';
  assert.strictEqual(matchPatientInText(cfg, t), 'Agnes');
});
ok('no known patient → null', () => {
  assert.strictEqual(matchPatientInText(cfg, 'Odběratel: Someone Else'), null);
});

console.log('date parsing (1–2 digit, . or / separators, label variants):');
ok('single-digit Czech D.M.YYYY', () => assert.strictEqual(extractDate('Datum vystavení: 11.6.2025'), '11/06/2025'));
ok('slash D/M/YYYY', () => assert.strictEqual(extractDate('Datum vystavení: 29/6/2026'), '29/06/2026'));
ok('two-digit taxable-supply date', () => assert.strictEqual(extractDate('Datum uskut. zdaň. plnění: 16.06.2025'), '16/06/2025'));
ok('English Invoice date', () => assert.strictEqual(extractDate('Invoice date: 02.07.2025'), '02/07/2025'));
ok('no date → ?', () => assert.strictEqual(extractDate('no dates here'), '?'));

console.log('classification (whitespace-tolerant against mangled pdftotext output):');
ok('mangled "O rtodontická" → orthodontic', () => {
  assert.strictEqual(classify({ items: [], raw: 'O 06 - O rtodontická kontrola aktívni léčby' }, cfg).typeKey, 'orthodontic');
});
ok('RTG + prohlídka → routineDental', () => {
  assert.strictEqual(classify({ items: [], raw: 'D53 - RTG BITEWING\nD02 - Preventivní prohlíd ka' }, cfg).typeKey, 'routineDental');
});
ok('psychoterapie → psychotherapy', () => {
  assert.strictEqual(classify({ items: [], raw: 'individuální psychoterapie' }, cfg).typeKey, 'psychotherapy');
});

console.log('dedup by faktura number (keeps the paid copy):');
ok('unpaid original flagged duplicate of paid receipt', () => {
  const plan = [
    { file: 'a-FAKTURA.pdf', parsed: { vs: '123', paid: false }, issues: [] },
    { file: 'b-Doklad-uhrazeno.pdf', parsed: { vs: '123', paid: true }, issues: [] },
  ];
  dedupeByVs(plan);
  assert.ok(plan[0].issues.some(i => /duplicate/.test(i)), 'unpaid original should be flagged');
  assert.strictEqual(plan[1].issues.length, 0, 'paid receipt should be kept clean');
});
ok('distinct faktura numbers are not deduped', () => {
  const plan = [
    { file: 'x.pdf', parsed: { vs: '1', paid: true }, issues: [] },
    { file: 'y.pdf', parsed: { vs: '2', paid: true }, issues: [] },
  ];
  dedupeByVs(plan);
  assert.strictEqual(plan[0].issues.length + plan[1].issues.length, 0);
});

console.log(`\nAll ${n} checks passed.`);
