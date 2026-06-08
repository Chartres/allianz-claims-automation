// Pure helpers ported from the CLI's lib/config.js — provider canonicalization + patient matching.
// Browser ESM, no Node deps.

export function canonicalProvider(cfg, name) {
  if (!name) return name;
  const n = name.toLowerCase();
  for (const [canonical, kws] of Object.entries(cfg.providers || {}))
    if ((kws || []).some(k => n.includes(k.toLowerCase()))) return canonical;
  return name.trim();
}

export function matchPatient(cfg, text) {
  if (!text) return null;
  for (const [key, p] of Object.entries(cfg.patients || {})) {
    const candidates = [key, p.portalLabel, ...(p.aliases || [])];
    if (candidates.some(c => c && text.includes(c))) return { key, ...p };
  }
  return null;
}
