// Classify a parsed invoice into a treatment type + resolve required supplementary docs.
// Ported from the CLI's lib/classify.js → browser ESM. The browser has no filesystem, so instead of
// fs.existsSync it asks an injected `docAvailable(docType, patientKey)` predicate (the side panel
// knows which plan/X-ray/prescription files the user has granted/picked).
export function classify(parsed, cfg, { forceTypeKey, docAvailable } = {}) {
  let best = null, bestScore = 0, overridden = false;

  if (forceTypeKey && cfg.treatmentTypes[forceTypeKey]) {
    best = forceTypeKey; bestScore = 99; overridden = true;
  } else {
    const hay = ((parsed.items || []).join(' ') + ' ' + (parsed.raw || '')).toLowerCase();
    for (const [key, tt] of Object.entries(cfg.treatmentTypes)) {
      const score = (tt.keywords || []).reduce((n, kw) => n + (hay.includes(kw.toLowerCase()) ? 1 : 0), 0);
      if (score > bestScore) { best = key; bestScore = score; }
    }
    const ov = cfg.patientOverrides && cfg.patientOverrides[parsed.patientName];
    if (ov && ov.forceTreatmentType) { best = ov.forceTreatmentType; overridden = true; }
  }

  if (!best) return { typeKey: null, type: null, confidence: 0, missingDocs: ['unclassified'], requiredDocs: [] };

  const type = cfg.treatmentTypes[best];
  const requiredDocs = type.requiredDocs || [];
  const missingDocs = requiredDocs.filter(need => !(docAvailable && docAvailable(need, parsed.patientName)));
  return { typeKey: best, type, confidence: bestScore, overridden, requiredDocs, missingDocs };
}
