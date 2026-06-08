// Content script on my.allianzcare.com — drives the NX/Angular claim form from the logged-in tab.
// Placeholder until the upload spike is confirmed on the live form (BUILD ORDER step 1→2). The proven
// synthetic-drag-drop upload lives in dropUpload.js; once validated, the payee/invoice form-driver
// (open nx-dropdowns, click role=option, set date/amount via input events, drop the file, submit)
// gets wired here and exposed to the side panel via chrome.runtime messaging.

(() => {
  // announce presence so the side panel / service worker know the portal tab is available
  chrome.runtime?.onMessage?.addListener((msg, _s, send) => {
    if (msg?.type === 'PING_PORTAL') send({ ok: true, url: location.href, loggedIn: !/login|signin/i.test(location.href) });
    return true;
  });
})();
