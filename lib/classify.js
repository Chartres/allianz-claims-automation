// Classify a parsed invoice into a treatment type and resolve required supplementary docs.
const { resolveDoc } = require('./config');
const fs = require('fs');

// Returns { typeKey, type, reasonMissingDocs[], docs:{plan,xray,prescription...} }
function classify(parsed, cfg) {
  const hay = (parsed.items.join(' ') + ' ' + (parsed.raw || '')).toLowerCase();

  // score each treatment type by keyword hits
  let best = null, bestScore = 0;
  for (const [key, tt] of Object.entries(cfg.treatmentTypes)) {
    const score = (tt.keywords || []).reduce((n, kw) => n + (hay.includes(kw.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) { best = key; bestScore = score; }
  }

  // patient override (e.g. file someone's ortho visits as routine when no plan is on file)
  const ov = cfg.patientOverrides && cfg.patientOverrides[parsed.patientName];
  if (ov && ov.forceTreatmentType) best = ov.forceTreatmentType;

  if (!best) return { typeKey: null, type: null, confidence: 0, missingDocs: ['unclassified'], docs: {} };

  const type = cfg.treatmentTypes[best];
  const docs = {};
  const missingDocs = [];
  for (const need of (type.requiredDocs || [])) {
    const entry = (cfg.supplementaryDocs[need] || {})[parsed.patientName];
    if (!entry) { missingDocs.push(need); continue; }
    const list = (Array.isArray(entry) ? entry : [entry]).map(p => resolveDoc(cfg, p));
    const present = list.filter(p => fs.existsSync(p));
    if (!present.length) { missingDocs.push(need); continue; }
    docs[need] = present;
  }

  return { typeKey: best, type, confidence: bestScore, overridden: !!(ov && ov.forceTreatmentType), missingDocs, docs };
}

module.exports = { classify };
