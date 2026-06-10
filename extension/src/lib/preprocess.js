// Image preprocessing for OCR — pure pixel ops on ImageData-like objects ({data,width,height},
// RGBA), no canvas/DOM deps so it's node-testable. Benchmarked on real invoices (scripts/
// ocr-bench.mjs): tesseract's LSTM prefers smooth grayscale with stretched contrast over hard
// binarization (hard thresholds + jaggy upscaling LOSE fields on clean renders), so the default
// pipeline is grayscale → bilinear upscale → percentile contrast stretch. Otsu binarization is
// kept exported for diagnostics/experiments.

// Luminance per pixel (Rec. 601).
export function toGray(img) {
  const { data, width, height } = img;
  const g = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return { gray: g, width, height };
}

// Otsu's method — the threshold that minimizes intra-class variance of the gray histogram.
export function otsu(gray) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sumAll = 0; for (let i = 0; i < 256; i++) sumAll += i * hist[i];
  let sumB = 0, wB = 0, best = 127, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

// Bilinear upscale of a gray buffer — smooth edges OCR better than nearest-neighbour jaggies.
export function scaleGray({ gray, width, height }, factor) {
  if (factor <= 1) return { gray, width, height };
  const w = Math.round(width * factor), h = Math.round(height * factor);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(height - 1, y / factor), y0 = fy | 0, y1 = Math.min(height - 1, y0 + 1), dy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(width - 1, x / factor), x0 = fx | 0, x1 = Math.min(width - 1, x0 + 1), dx = fx - x0;
      const top = gray[y0 * width + x0] * (1 - dx) + gray[y0 * width + x1] * dx;
      const bot = gray[y1 * width + x0] * (1 - dx) + gray[y1 * width + x1] * dx;
      out[y * w + x] = top * (1 - dy) + bot * dy;
    }
  }
  return { gray: out, width: w, height: h };
}

// Linear contrast stretch between the lowPct/highPct gray percentiles — normalizes photos with a
// gray cast / poor lighting without destroying glyph antialiasing the way a hard threshold does.
export function contrastStretch(gray, lowPct = 0.02, highPct = 0.98) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  const n = gray.length;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= n * lowPct) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= n * (1 - highPct)) { hi = i; break; } }
  if (hi - lo < 32) return gray; // already flat/uniform — stretching would amplify noise
  const out = new Uint8ClampedArray(n), span = hi - lo;
  for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, ((gray[i] - lo) * 255) / span));
  return out;
}

// Default OCR pipeline: RGBA → grayscale → bilinear upscale to ≥minWidth → contrast stretch → RGBA.
// `binarize: true` adds a hard Otsu threshold after the stretch (diagnostics; off by default).
// Returns { data, width, height, threshold, inkRatio } — inkRatio = share of dark pixels, a sanity
// signal (≈1 or ≈0 means a flooded/blank capture the caller may want to treat as unreadable).
export function preprocess(img, { minWidth = 1500, maxScale = 3, binarize = false } = {}) {
  let g = toGray(img);
  g = scaleGray(g, Math.min(maxScale, Math.max(1, minWidth / g.width)));
  let gray = contrastStretch(g.gray);
  const t = otsu(gray);
  let ink = 0;
  if (binarize) { const b = new Uint8ClampedArray(gray.length); for (let i = 0; i < gray.length; i++) { const k = gray[i] <= t; b[i] = k ? 0 : 255; if (k) ink++; } gray = b; }
  else for (let i = 0; i < gray.length; i++) if (gray[i] <= t) ink++;
  const data = new Uint8ClampedArray(g.width * g.height * 4);
  for (let p = 0, i = 0; p < gray.length; p++, i += 4) { data[i] = data[i + 1] = data[i + 2] = gray[p]; data[i + 3] = 255; }
  return { data, width: g.width, height: g.height, threshold: t, inkRatio: ink / gray.length };
}

// Heuristic: a capture is plausibly a document if some ink but not a flood (typical text: 2–25%).
export const usableBinarization = inkRatio => inkRatio > 0.005 && inkRatio < 0.5;
