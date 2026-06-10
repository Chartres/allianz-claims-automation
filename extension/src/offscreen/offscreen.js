// Offscreen document — runs tesseract.js (WASM) to OCR invoice photos. The service worker creates
// this on demand and relays OCR_OFFSCREEN here. Photos are preprocessed (grayscale → Otsu
// binarization → upscale; lib/preprocess.js, node-tested) before recognition, and results are
// confidence-gated: low-confidence text is NOT trusted — the caller falls back to the vision path
// rather than filing from garbage. If binarization floods (glare/dark photos), we OCR the raw image
// and let the confidence gate decide.
import { createWorker } from '../../vendor/tesseract/tesseract.esm.min.js';
import { preprocess, usableBinarization } from '../lib/preprocess.js';

const MIN_CONFIDENCE = 55; // tesseract mean confidence (0-100) below which we don't trust the text

let workerP = null;
function getWorker() {
  if (!workerP) workerP = createWorker(['ces', 'eng'], 1, {
    workerPath: chrome.runtime.getURL('vendor/tesseract/worker.min.js'),
    corePath: chrome.runtime.getURL('vendor/tesseract/'),
    langPath: chrome.runtime.getURL('vendor/tesseract/'),
    workerBlobURL: false,
  });
  return workerP;
}

// dataUrl → preprocessed OffscreenCanvas (or the raw bitmap's canvas if binarization is unusable).
async function toCanvas(dataUrl) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const pre = preprocess(ctx.getImageData(0, 0, bmp.width, bmp.height));
  if (!usableBinarization(pre.inkRatio)) return c; // flooded → raw image, confidence gate decides
  const out = new OffscreenCanvas(pre.width, pre.height);
  out.getContext('2d').putImageData(new ImageData(pre.data, pre.width, pre.height), 0, 0);
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.type !== 'OCR_OFFSCREEN') return; // let the SW handle its own messages
  (async () => {
    try {
      const w = await getWorker();
      const { data } = await w.recognize(await toCanvas(msg.dataUrl));
      const confidence = data.confidence ?? 0;
      if (confidence < MIN_CONFIDENCE) { send({ ok: false, error: `low OCR confidence (${Math.round(confidence)})`, confidence }); return; }
      send({ ok: true, text: data.text, confidence });
    } catch (e) { send({ ok: false, error: e.message }); }
  })();
  return true; // async
});
