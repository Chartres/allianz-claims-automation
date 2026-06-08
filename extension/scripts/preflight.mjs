// Static preflight for the unpacked extension. Catches the load-time wiring bugs that code-injection
// testing can't see: broken manifest paths, unresolved ESM imports, getURL() targets that don't exist,
// and MV3 CSP gotchas (e.g. WASM needs 'wasm-unsafe-eval'). Run: node extension/scripts/preflight.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = p => relative(EXT, p);
const errs = [], warns = [];
const err = m => errs.push(m), warn = m => warns.push(m);
const has = p => existsSync(resolve(EXT, p));

// ---- manifest ----
const mf = JSON.parse(readFileSync(resolve(EXT, 'manifest.json'), 'utf8'));
const checkPath = (p, label) => { if (!has(p)) err(`${label}: missing file "${p}"`); };
checkPath(mf.background?.service_worker, 'background.service_worker');
checkPath(mf.side_panel?.default_path, 'side_panel.default_path');
checkPath(mf.options_page, 'options_page');
for (const cs of mf.content_scripts || []) for (const j of cs.js || []) checkPath(j, 'content_scripts.js');
for (const war of mf.web_accessible_resources || []) for (const r of war.resources || []) checkPath(r, 'web_accessible_resources');
for (const ic of Object.values(mf.icons || {})) checkPath(ic, 'icons');
for (const ic of Object.values(mf.action?.default_icon || {})) checkPath(ic, 'action.default_icon');

// ---- MV3 CSP: WASM (tesseract) needs 'wasm-unsafe-eval' on extension pages ----
const usesWasm = has('vendor/tesseract') && readdirSync(resolve(EXT, 'vendor/tesseract')).some(f => f.endsWith('.wasm'));
const csp = mf.content_security_policy?.extension_pages || '';
if (usesWasm && !/wasm-unsafe-eval/.test(csp))
  err(`WASM present (tesseract) but manifest CSP lacks 'wasm-unsafe-eval' → OCR will fail to compile. Add content_security_policy.extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'".`);

// ---- ESM import resolution (only local ./ ../ specifiers) ----
const allJs = [];
(function walk(d) { for (const n of readdirSync(d)) { const p = resolve(d, n); if (n === 'node_modules' || n === 'scripts') continue; statSync(p).isDirectory() ? walk(p) : /\.(m?js)$/.test(n) && allJs.push(p); } })(EXT);
const IMPORT_RE = /(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const f of allJs) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2];
    if (!spec || !spec.startsWith('.')) continue;            // skip bare specifiers / chrome.runtime.getURL imports
    const target = resolve(dirname(f), spec);
    if (!existsSync(target)) err(`${rel(f)}: unresolved import "${spec}"`);
  }
  // getURL('...') targets must exist as packaged resources
  for (const m of src.matchAll(/getURL\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const p = m[1].replace(/\/$/, '');                       // trailing-slash dirs (corePath/langPath) → check dir
    if (p && !has(p)) err(`${rel(f)}: getURL("${m[1]}") → missing "${p}"`);
  }
}

// ---- icons (warn-only: Chrome falls back to a default) ----
if (!mf.icons && !mf.action?.default_icon) warn('no icons declared — Chrome will use a default puzzle icon (fine for unpacked).');

// ---- report ----
for (const w of warns) console.log('⚠  ' + w);
for (const e of errs) console.log('✗  ' + e);
console.log(errs.length ? `\nFAIL — ${errs.length} error(s).` : `\nOK — manifest paths, imports, and getURL targets resolve${warns.length ? ` (${warns.length} warning(s))` : ''}.`);
process.exit(errs.length ? 1 : 0);
