// Build a Chrome Web Store-ready zip (manifest at the root). Bundles only runtime files — dev-only
// bits (scripts/, package.json, tests, node_modules) are excluded. Run: node extension/scripts/package.mjs
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mf = JSON.parse(readFileSync(resolve(EXT, 'manifest.json'), 'utf8'));
const RUNTIME = ['manifest.json', 'config.default.json', 'icons', 'src', 'vendor'];
const out = resolve(EXT, 'dist', `${mf.name.replace(/\s+/g, '-').toLowerCase()}-${mf.version}.zip`);

mkdirSync(resolve(EXT, 'dist'), { recursive: true });
rmSync(out, { force: true });
// -r recurse, -X drop extra attrs; exclude any stray scratch under src/ just in case
execFileSync('zip', ['-r', '-X', out, ...RUNTIME, '-x', '*/.DS_Store', '*/node_modules/*'], { cwd: EXT, stdio: 'inherit' });
console.log(`\n✓ ${out.replace(EXT + '/', '')}  (upload this to the Web Store as an Unlisted item)`);
