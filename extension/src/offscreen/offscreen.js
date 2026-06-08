// Offscreen document — runs tesseract.js (WASM) to OCR invoice photos. The service worker creates
// this on demand and relays OCR_OFFSCREEN here. tesseract.js validated offline on a real invoice image;
// the offscreen/asset-path wiring is pending live load.
import { createWorker } from '../../vendor/tesseract/tesseract.esm.min.js';

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

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.type !== 'OCR_OFFSCREEN') return; // let the SW handle its own messages
  (async () => {
    try { const w = await getWorker(); const { data } = await w.recognize(msg.dataUrl); send({ ok: true, text: data.text }); }
    catch (e) { send({ ok: false, error: e.message }); }
  })();
  return true; // async
});
