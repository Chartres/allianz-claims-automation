// MV3 service worker — event-driven (it sleeps when idle; keep handlers fast / chunk long work).
// Opens the side panel on toolbar click. The chunked crawl is wired here after the upload spike
// is confirmed on the live form (BUILD ORDER step 4).

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'CRAWL') {
    // TODO(step 4): drive the logged-in Allianz tab to crawl claim history + policy in chunks
    // (chrome.alarms / offscreen), checkpointing to chrome.storage.local. Not built until the
    // upload spike is validated on the live form.
    sendResponse({ ok: false, reason: 'crawl-not-implemented' });
  }
  return true; // async response
});
