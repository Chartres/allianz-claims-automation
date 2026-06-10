// The correction flywheel — pure, node-testable. Each manual fix in the review list teaches the
// config so the next batch parses/classifies better:
//  · patient corrected  → learn the exact way that patient's name appears in this invoice's text
//                         (case/diacritics variant) as a new alias → parseFields matches next time.
//  · type corrected     → remember provider → treatmentType (used when keywords fail to classify).

// Normalize for fuzzy name comparison: lowercase + strip diacritics.
export const normName = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Find how `patient` (their known aliases/label/key) actually appears in `raw` text, tolerating
// case/diacritic differences. Returns the exact substring as written in the text if it's not already
// a known alias, else null. That substring is the new alias to save.
export function learnPatientAlias(raw, patientKey, patientCfg = {}) {
  if (!raw) return null;
  const known = [...(patientCfg.aliases || []), patientCfg.portalLabel, patientKey]
    .filter(Boolean).map(a => a.replace(/\s*\(\d{4}\)\s*$/, '').trim()).filter(a => a.length >= 3);
  const nraw = normName(raw);
  if (known.some(a => raw.includes(a))) return null;         // some exact form already matches — nothing to learn
  for (const a of known) {
    const na = normName(a);
    const i = nraw.indexOf(na);
    if (i >= 0) {
      // NFD normalization is 1:1 on length after mark-stripping for Czech/Slovak letters, so the
      // match position maps back onto the original string directly.
      const exact = raw.slice(i, i + a.length).trim();
      if (exact && !known.includes(exact)) return exact;
    }
    // first-name-only fallback: "Agnes" appears even when the surname is formatted differently
    const first = na.split(/\s+/)[0];
    if (first.length >= 4) {
      const j = nraw.indexOf(first);
      if (j >= 0) {
        const exact = raw.slice(j, j + first.length).trim();
        // parseFields matches exact substrings, so even a short form is worth learning —
        // skip only if this exact form is already a known alias.
        if (exact && !known.includes(exact)) return exact;
      }
    }
  }
  return null;
}

// Apply a learned provider→type hint when keyword classification failed.
export function applyTypeHint(cls, provider, cfg) {
  const hint = provider && cfg.typeHints?.[provider];
  if (cls.typeKey || !hint || !cfg.treatmentTypes?.[hint]) return cls;
  const type = cfg.treatmentTypes[hint];
  return { ...cls, typeKey: hint, type, confidence: 0.5, viaHint: true, requiredDocs: type.requiredDocs || [] };
}

// Record corrections into a config object (mutates + returns it; caller persists).
export function recordPatientCorrection(cfg, patientKey, raw) {
  const p = cfg.patients?.[patientKey];
  if (!p) return cfg;
  const alias = learnPatientAlias(raw, patientKey, p);
  if (alias) p.aliases = [...(p.aliases || []), alias];
  return cfg;
}
export function recordTypeCorrection(cfg, provider, typeKey) {
  if (!provider || !cfg.treatmentTypes?.[typeKey]) return cfg;
  (cfg.typeHints = cfg.typeHints || {})[provider] = typeKey;
  return cfg;
}
