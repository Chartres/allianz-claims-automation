// Content script on my.allianzcare.com. Bridges the side panel ↔ the page: pings login state and runs
// the form-driver to file invoices in the logged-in tab. (Classic content script; loads the ESM
// form-driver via dynamic import — modules are declared web_accessible_resources.)
//
// STATUS: filing path pending live validation (the gating upload spike needs an OTP login).

const url = (p) => chrome.runtime.getURL(p);
let fd = null;
async function driver() { if (!fd) fd = await import(url('src/content/formDriver.js')); return fd; }

function b64ToBytes(b64) {
  const bin = atob(b64); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  (async () => {
    try {
      if (msg?.type === 'PING_PORTAL') {
        send({ ok: true, url: location.href, loggedIn: !/login|signin/i.test(location.href) });
        return;
      }
      if (msg?.type === 'FILE_INVOICES') {
        const m = await driver();
        const total = msg.invoices.length;
        const progress = (i, id, state) => chrome.runtime.sendMessage({ type: 'FILE_PROGRESS', i, total, id, state }).catch(() => {});
        progress(0, null, 'starting claim');
        await m.startClaim(msg.config);
        const results = [];
        for (const [idx, inv] of msg.invoices.entries()) {
          progress(idx, inv.meta?.id, 'filing');
          const built = {
            fields: inv.fields,
            invoiceName: inv.invoiceName,
            invoiceBytes: b64ToBytes(inv.invoiceB64),
            docs: (inv.docs || []).map(d => ({ name: d.name, bytes: b64ToBytes(d.b64) })),
          };
          const r = await m.addInvoice(msg.config, built);
          if (!r.saveDisabled) { await m.saveInvoice(); results.push({ id: inv.meta?.id, ok: true }); progress(idx + 1, inv.meta?.id, 'saved'); }
          else { results.push({ id: inv.meta?.id, ok: false, invalid: r.invalid }); progress(idx + 1, inv.meta?.id, 'failed: ' + r.invalid.join(',')); }
        }
        send({ ok: true, results, note: 'Stopped at the claim overview.' });
        return;
      }
      if (msg?.type === 'SUBMIT_CLAIM') {
        const m = await driver();
        send({ ok: true, claim: await m.submitClaim() });
        return;
      }
      if (msg?.type === 'DISCOVER') {
        const m = await driver();
        const sample = msg.sampleB64 ? { bytes: b64ToBytes(msg.sampleB64), name: msg.sampleName || 'sample.pdf' } : null;
        send({ ok: true, found: await m.discover(msg.config || {}, sample) });
        return;
      }
    } catch (e) { send({ ok: false, error: e.message }); }
  })();
  return true; // async response
});
