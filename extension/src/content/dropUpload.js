// Synthetic drag-drop upload — the technique that replaces Playwright's setInputFiles (which
// extensions can't do). Build a File + DataTransfer and dispatch a real drop on the form's
// "Drag and drop invoice here" zone. Content scripts run in the ISOLATED world, but the File/
// DataTransfer we construct are carried on the dispatched DragEvent and read by the page's own
// drop handler, so the page (Angular) sees a normal drop.
//
// STATUS: pending live validation against the real form (the gating spike). The same logic is
// exercised by archive/upload-spike.js via the CLI's Playwright session.

/** Find the most likely dropzone element(s) on the invoice form. */
export function findDropTargets(doc = document) {
  const targets = [];
  const input = doc.querySelector('input[type=file]');
  if (input) targets.push(input, input.parentElement, input.closest('div'));
  const tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    if (/drag and drop/i.test(n.textContent)) {
      let e = n.parentElement;
      for (let i = 0; i < 3 && e; i++) { targets.push(e); e = e.parentElement; }
      break;
    }
  }
  return [...new Set(targets.filter(Boolean))];
}

/** Dispatch a synthetic dragenter/dragover/drop carrying `file` onto `target`. */
export function fireDrop(target, file) {
  const dt = new DataTransfer();
  dt.items.add(file);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const ev = new DragEvent(type, { bubbles: true, cancelable: true, composed: true });
    // dataTransfer is read-only on the constructor in some engines; force it
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    target.dispatchEvent(ev);
  }
}

/** Upload one file (bytes) into the invoice form. Returns true if the form appears to register it. */
export async function uploadInvoice(bytes, filename, mime = 'application/pdf', doc = document) {
  const file = new File([bytes], filename, { type: mime });
  const targets = findDropTargets(doc);
  for (const t of targets) { try { fireDrop(t, file); } catch {} }
  // give Angular a tick, then check the upload registered (invoice fields reveal / filename shows)
  await new Promise(r => setTimeout(r, 1500));
  return !!doc.querySelector('#patientName') || doc.body.innerText.includes(filename);
}
