// Executes the supporting-doc resolution logic with mock files. Run: node extension/scripts/docs.test.mjs
import { SUP, baseName, relKey, indexFiles, supDocNameSet, resolveDocFiles } from '../src/lib/docs.js';

let pass = 0, fail = 0;
const eq = (got, want, msg) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a === b) { pass++; } else { fail++; console.log(`✗ ${msg}\n    got  ${a}\n    want ${b}`); } };
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.log(`✗ ${msg}`)); };

const cfg = {
  supplementaryDocs: {
    dentalPlan:   { Child: 'Child/dental-plan.pdf' },
    xray:         { Child: ['Child/opg.png'] },
    prescription: { Parent: 'prescription.pdf' },              // basename-only reference
  },
  treatmentTypes: {
    orthodontic:  { requiredDocs: ['dentalPlan', 'xray'] },
  },
};

// mock files as a folder scan would produce them (subfolders → _relPath)
const files = [
  { name: 'invoice-ortho.pdf', _relPath: 'invoice-ortho.pdf' },
  { name: 'dental-plan.pdf',   _relPath: 'Child/dental-plan.pdf' },
  { name: 'opg.png',           _relPath: 'Child/opg.png' },
  { name: 'prescription.pdf',  _relPath: 'Parent/prescription.pdf' },
  { name: 'notes.txt',         _relPath: 'notes.txt' },        // unsupported → ignored
];

// SUP filter
ok(SUP.test('a.pdf') && SUP.test('b.JPEG') && SUP.test('c.heic'), 'SUP matches pdf/jpeg/heic');
ok(!SUP.test('notes.txt'), 'SUP rejects .txt');

// keys
eq(relKey(files[1]), 'child/dental-plan.pdf', 'relKey lowercases path');
eq(baseName(files[1]), 'dental-plan.pdf', 'baseName strips path');

// index: by rel path + basename, skips unsupported
const map = indexFiles(new Map(), files);
ok(map.has('child/dental-plan.pdf') && map.has('dental-plan.pdf'), 'index has rel + basename');
ok(!map.has('notes.txt'), 'index skips unsupported file');

// supDocNameSet: basenames of all configured attachments
eq([...supDocNameSet(cfg)].sort(), ['dental-plan.pdf', 'opg.png', 'prescription.pdf'], 'supDocNameSet = attachment basenames');

// resolve by relative path
eq(resolveDocFiles(map, cfg, 'dentalPlan', 'Child').found.map(f => f.name), ['dental-plan.pdf'], 'resolve dentalPlan/Child');
eq(resolveDocFiles(map, cfg, 'xray', 'Child').found.map(f => f.name), ['opg.png'], 'resolve xray/Child (array spec)');
// resolve by basename-only reference
eq(resolveDocFiles(map, cfg, 'prescription', 'Parent').found.map(f => f.name), ['prescription.pdf'], 'resolve prescription/Parent by basename');

// missing detection: a file not in the folder
const partial = indexFiles(new Map(), [files[0], files[2]]); // invoice + opg only (no dental-plan)
const r = resolveDocFiles(partial, cfg, 'dentalPlan', 'Child');
eq(r.found, [], 'missing doc → found empty');
eq(r.missing, ['Child/dental-plan.pdf'], 'missing doc → reported');

// no config for that patient/doc → whole docType reported missing
eq(resolveDocFiles(map, cfg, 'dentalPlan', 'Parent').missing, ['dentalPlan'], 'unconfigured patient → docType missing');

// the invoice is NOT one of the supplementary docs (so it stays in the review list)
ok(!supDocNameSet(cfg).has(baseName(files[0])), 'invoice not treated as attachment');

console.log(`\n${fail ? '✗ FAIL' : '✓ PASS'} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
