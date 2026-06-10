// Unit tests for the OCR preprocessing pipeline (synthetic pixels — no personal data).
// Pipeline choice (grayscale + bilinear upscale + contrast stretch, NOT hard binarization) was
// driven by scripts/ocr-bench.mjs on real invoices: stretch 54→82 confidence; binarize lost fields.
// Run: node extension/scripts/preprocess.test.mjs
import { toGray, otsu, scaleGray, contrastStretch, preprocess, usableBinarization } from '../src/lib/preprocess.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.log(`✗ ${msg}`)); };

// synthetic "document photo": light noisy background with dark text-like strokes + gray cast
function synthetic(w = 200, h = 100, { lo = 50, hi = 230 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 42; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const stroke = (y % 20 < 4) && (x % 10 < 6);              // periodic "text" bars (~12% ink)
    const v = stroke ? lo + rnd() * 30 : hi - 40 + rnd() * 40;
    data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

const img = synthetic();
const g = toGray(img);
ok(g.gray.length === 200 * 100, 'toGray: one value per pixel');

const t = otsu(g.gray);
ok(t >= 80 && t < 190, `otsu separates the two modes — dark 50-80, light 190-230 (got ${t})`);

const s = scaleGray(g, 2);
ok(s.width === 400 && s.height === 200, 'scaleGray doubles dimensions');
ok(s.gray[0] === g.gray[0], 'bilinear preserves origin pixel');
// bilinear: midpoint between two pixels ≈ their average
const mid = s.gray[1], avg = (g.gray[0] + g.gray[1]) / 2;
ok(Math.abs(mid - avg) <= 1, `bilinear midpoint ≈ neighbour average (got ${mid} vs ${avg})`);

// contrast stretch: a washed-out cast (90..150) spreads toward 0..255
const cast = synthetic(100, 60, { lo: 90, hi: 150 });
const cg = toGray(cast).gray;
const stretched = contrastStretch(cg);
ok(Math.min(...stretched) < 20 && Math.max(...stretched) > 235, 'stretch expands a washed-out cast to full range');
// near-flat input is left alone (stretching would amplify noise)
const flat = new Uint8ClampedArray(500).fill(128);
ok(contrastStretch(flat) === flat, 'flat input returned untouched');

const pre = preprocess(img, { minWidth: 400, maxScale: 3 });
ok(pre.width >= 400, `preprocess upscales to minWidth (got ${pre.width})`);
ok(pre.data.length === pre.width * pre.height * 4, 'preprocess returns RGBA');
// default output is grayscale (NOT binary) — antialiasing preserved for the LSTM
let nonBinary = 0; for (let i = 0; i < pre.data.length; i += 4) if (pre.data[i] !== 0 && pre.data[i] !== 255) nonBinary++;
ok(nonBinary > 0, 'default output keeps gray midtones (no hard binarization)');
ok(pre.inkRatio > 0.03 && pre.inkRatio < 0.4, `inkRatio plausible for text (got ${pre.inkRatio.toFixed(3)})`);
ok(usableBinarization(pre.inkRatio), 'capture judged usable');

// binarize: true still produces pure black/white (diagnostics path)
const bin = preprocess(img, { minWidth: 400, binarize: true });
const vals = new Set(); for (let i = 0; i < bin.data.length; i += 4) vals.add(bin.data[i]);
ok(vals.size === 2 && vals.has(0) && vals.has(255), 'binarize:true yields pure black/white');

// flood cases → caller should fall back to the raw image / vision
ok(!usableBinarization(0.001), 'near-blank → unusable');
ok(!usableBinarization(0.7), 'flooded-black → unusable');

// no upscale when already large
const big = preprocess(synthetic(2000, 80), { minWidth: 1500 });
ok(big.width === 2000, 'no upscale when width ≥ minWidth');

console.log(`\n${fail ? '✗ FAIL' : '✓ PASS'} — ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
