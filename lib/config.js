// Loads and validates config.json (falls back to config.example.json).
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

function load() {
  const userCfg = path.join(ROOT, 'config.json');
  const example = path.join(ROOT, 'config.example.json');
  const file = fs.existsSync(userCfg) ? userCfg : example;
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg._root = ROOT;
  cfg._file = file;
  // resolve docsBaseDir (~ expansion)
  if (cfg.docsBaseDir) cfg.docsBaseDir = cfg.docsBaseDir.replace(/^~/, os.homedir());
  return cfg;
}

// Resolve a doc path (absolute, ~ , or relative to docsBaseDir).
function resolveDoc(cfg, p) {
  if (!p) return p;
  p = p.replace(/^~/, os.homedir());
  if (path.isAbsolute(p)) return p;
  return path.join(cfg.docsBaseDir || cfg._root, p);
}

// Map a parsed patient name (e.g. "Jane Doe") to a config patient key + portal label.
function matchPatient(cfg, text) {
  for (const [key, p] of Object.entries(cfg.patients)) {
    const candidates = [key, p.portalLabel, ...(p.aliases || [])];
    if (candidates.some(c => text.includes(c))) return { key, ...p };
  }
  return null;
}

// Map a raw provider name (e.g. "Acme Dental Clinic", "City Clinic Ltd") to its canonical name.
function canonicalProvider(cfg, name) {
  if (!name) return name;
  const n = name.toLowerCase();
  for (const [canonical, kws] of Object.entries(cfg.providers || {}))
    if ((kws || []).some(k => n.includes(k.toLowerCase()))) return canonical;
  return name.trim();
}

module.exports = { load, resolveDoc, matchPatient, canonicalProvider, ROOT };
