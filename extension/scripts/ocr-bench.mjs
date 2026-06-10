// OCR bench — validate the preprocessing pipeline on a REAL image/PDF, locally.
//   node extension/scripts/ocr-bench.mjs <invoice.pdf|photo.png> [--degrade]
// Converts PDFs/images to BMP via macOS `sips` (BMP = trivially decodable raw pixels), runs the
// extension's actual preprocess() on those pixels, then OCRs raw vs preprocessed with tesseract.js
// (node) and reports confidence + whether key fields (faktura no., amounts, dates) survive.
// --degrade simulates a phone photo (downscale + gray cast + noise) before testing.
// Takes a user-supplied path; nothing personal lives in this script.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preprocess, usableBinarization } from '../src/lib/preprocess.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [input, ...flags] = process.argv.slice(2);
if (!input) { console.error('usage: node ocr-bench.mjs <invoice.pdf|photo> [--degrade]'); process.exit(2); }
const DEGRADE = flags.includes('--degrade');
const tmp = mkdtempSync(join(tmpdir(), 'ocrbench-'));

// ---- BMP read/write (BITMAPINFOHEADER, 24bpp, bottom-up) ----
function readBMP(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 2) !== 'BM') throw new Error('not a BMP');
  const off = b.readUInt32LE(10), width = b.readInt32LE(18), heightRaw = b.readInt32LE(22), bpp = b.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) throw new Error('unsupported bpp ' + bpp);
  const height = Math.abs(heightRaw), bottomUp = heightRaw > 0, bytes = bpp / 8;
  const rowSize = Math.ceil(width * bytes / 4) * 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcY = bottomUp ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const s = off + srcY * rowSize + x * bytes, d = (y * width + x) * 4;
      const a = bytes === 4 ? b[s + 3] / 255 : 1;            // PDF renders use alpha; flatten on white
      data[d] = b[s + 2] * a + 255 * (1 - a);
      data[d + 1] = b[s + 1] * a + 255 * (1 - a);
      data[d + 2] = b[s] * a + 255 * (1 - a);
      data[d + 3] = 255; // BGRA→RGBA over white
    }
  }
  return { data, width, height };
}
function writeBMP(path, { data, width, height }) {
  const rowSize = Math.ceil(width * 3 / 4) * 4, img = rowSize * height;
  const b = Buffer.alloc(54 + img);
  b.write('BM'); b.writeUInt32LE(54 + img, 2); b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14); b.writeInt32LE(width, 18); b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(img, 34);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = (y * width + x) * 4, d = 54 + (height - 1 - y) * rowSize + x * 3;
    b[d] = data[s + 2]; b[d + 1] = data[s + 1]; b[d + 2] = data[s]; // RGBA→BGR
  }
  writeFileSync(path, b);
}

// simulate a phone photo: downscale, gray cast, noise
function degrade(img) {
  const f = 0.5, w = Math.round(img.width * f), h = Math.round(img.height * f);
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((Math.round(y / f) * img.width) + Math.round(x / f)) * 4, d = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) data[d + c] = Math.max(0, Math.min(255, img.data[s + c] * 0.75 + 40 + (rnd() - 0.5) * 36));
    data[d + 3] = 255;
  }
  return { data, width: w, height: h };
}

const fields = t => ({
  faktura: (t.match(/\b22[456][0-9]{7}\b/) || [])[0] || null,
  date: (t.match(/\b\d{1,2}\.\s?\d{1,2}\.\s?20\d{2}\b/) || [])[0] || null,
  amounts: (t.match(/\b\d[\d\s]{2,8}(?:,\d\d)?\s*(?:Kč|CZK)/g) || []).length,
});

// ---- prepare input ----
const bmp0 = join(tmp, 'in.bmp');
execFileSync('sips', ['-s', 'format', 'bmp', resolve(input), '--out', bmp0], { stdio: 'pipe' });
let img = readBMP(bmp0);
if (DEGRADE) img = degrade(img);
console.log(`input: ${input} → ${img.width}x${img.height}${DEGRADE ? ' (degraded: 0.5x, cast, noise)' : ''}`);

const pre = preprocess(img);
console.log(`preprocess: threshold=${pre.threshold} inkRatio=${pre.inkRatio.toFixed(3)} usable=${usableBinarization(pre.inkRatio)} → ${pre.width}x${pre.height}`);
const rawBmp = join(tmp, 'raw.bmp'), preBmp = join(tmp, 'pre.bmp');
writeBMP(rawBmp, img); writeBMP(preBmp, pre);

// ---- OCR both ----
const { createWorker } = await import(join(ROOT, 'node_modules/tesseract.js/src/index.js'));
const w = await createWorker(['ces', 'eng']);
for (const [label, path] of [['raw       ', rawBmp], ['preprocess', preBmp]]) {
  const { data } = await w.recognize(path);
  const f = fields(data.text);
  console.log(`${label}: confidence=${Math.round(data.confidence)}  faktura=${f.faktura}  date=${f.date}  amounts=${f.amounts}`);
}
await w.terminate();
rmSync(tmp, { recursive: true, force: true });
