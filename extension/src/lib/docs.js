// Pure supporting-doc resolution — no chrome/DOM deps so it's unit-testable under node.
// A "file" here is anything with a `.name` and optional `._relPath` (folder scans tag the latter).
// config.supplementaryDocs maps docType → patientKey → filename(s) (string or array), referencing
// files by relative path ("Child/opg.png") or basename ("opg.png"); both resolve against the index.

export const SUP = /\.(pdf|png|jpe?g|tiff?|bmp|gif|webp|heic|heif)$/i;

const norm = s => String(s).replace(/\\/g, '/').toLowerCase();
export const relKey = f => norm(f._relPath || f.name);
export const baseName = f => relKey(f).split('/').pop();

// Index files by lowercased relative path AND basename (first basename wins on collision).
export function indexFiles(map, files) {
  for (const f of files) {
    if (!SUP.test(f.name)) continue;
    const rel = relKey(f);
    map.set(rel, f);
    const base = rel.split('/').pop();
    if (!map.has(base)) map.set(base, f);
  }
  return map;
}

// The set of basenames configured as supplementary docs — these are attachments, never invoices.
export function supDocNameSet(cfg) {
  const s = new Set();
  for (const byPatient of Object.values(cfg.supplementaryDocs || {}))
    for (const spec of Object.values(byPatient))
      for (const n of (Array.isArray(spec) ? spec : [spec]))
        s.add(norm(n).split('/').pop());
  return s;
}

// Resolve a docType+patient to actual file objects from the index. Returns {found, missing}.
export function resolveDocFiles(map, cfg, docType, patientKey) {
  const spec = cfg.supplementaryDocs?.[docType]?.[patientKey];
  if (!spec) return { found: [], missing: [docType] };
  const names = Array.isArray(spec) ? spec : [spec];
  const found = [], missing = [];
  for (const n of names) {
    const key = norm(n);
    const f = map.get(key) || map.get(key.split('/').pop());
    if (f) found.push(f); else missing.push(n);
  }
  return { found, missing };
}
