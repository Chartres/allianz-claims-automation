// Browser text extraction. PDFs via the vendored pdf.js (reconstructing lines from positioned text
// items — validated offline to feed parse.js). Images return '' → the review flags them for the AI
// vision fallback (agent reads the photo with the user's OK). tesseract.js auto-OCR can be added in
// an offscreen document later as an enhancement.
import * as pdfjs from '../../vendor/pdfjs/pdf.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('vendor/pdfjs/pdf.worker.mjs');

const IMG = /\.(png|jpe?g|tiff?|bmp|gif|webp|heic|heif)$/i;

export async function extractPdfText(arrayBuffer) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const byY = new Map();
    for (const it of tc.items) {
      const y = Math.round(it.transform[5]);
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y).push({ x: it.transform[4], s: it.str });
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a))
      lines.push(byY.get(y).sort((a, b) => a.x - b.x).map(o => o.s).join(' '));
  }
  return lines.join('\n');
}

export function isImage(name) { return IMG.test(name); }

async function fileToB64(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}

// Returns extracted text. PDFs → pdf.js. Images → tesseract.js via the offscreen document (SW relays).
// '' (→ vision fallback) for HEIC, OCR failures, or unreadable PDFs.
export async function extractText(file) {
  try {
    if (/\.pdf$/i.test(file.name)) return await extractPdfText(await file.arrayBuffer());
    if (isImage(file.name) && !/\.(heic|heif)$/i.test(file.name)) {
      const resp = await chrome.runtime.sendMessage({ type: 'OCR_IMAGE', b64: await fileToB64(file), mime: file.type || 'image/png' });
      if (resp?.ok && resp.text?.trim()) return resp.text;
    }
  } catch { /* fall through to vision fallback */ }
  return '';
}
