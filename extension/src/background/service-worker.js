// MV3 service worker — opens the side panel and orchestrates the claims crawl by driving the
// logged-in portal tab via chrome.scripting (parsing with the offline-validated crawl.js parsers).
//
// STATUS: crawl logic is a faithful port of the CLI crawler; pending live tuning (navigation timing,
// and chunking very large histories around the ~5-min SW cap — it checkpoints per claim so re-running
// Refresh resumes by skipping already-stored claims).
import { parseClaimsList, parseClaimDetail, detailUrl } from '../content/crawl.js';

chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function portalTab() {
  const [t] = await chrome.tabs.query({ url: 'https://my.allianzcare.com/*' });
  return t;
}
async function runInTab(tabId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.result;
}
function waitForComplete(tabId, timeout = 15000) {
  return new Promise(res => {
    const h = (id, info) => { if (id === tabId && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(h); res(true); } };
    chrome.tabs.onUpdated.addListener(h);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(h); res(false); }, timeout);
  });
}

async function crawl(cfg) {
  const tab = await portalTab();
  if (!tab) return { ok: false, error: 'Open & log into Allianz in a tab first.' };
  const base = (cfg?.portal?.url) || 'https://my.allianzcare.com/myhealth/1/home';
  const policyId = cfg?.portal?.policyId || '';

  // claims list
  await chrome.tabs.update(tab.id, { url: `${base}/claims/list` });
  await waitForComplete(tab.id); await sleep(2500);
  const listText = await runInTab(tab.id, () => document.body.innerText);
  if (/login|signin/i.test(listText) || !/C3\d{7}/.test(listText)) return { ok: false, error: 'Not logged in / no claims visible.' };
  const list = parseClaimsList(listText);

  // resume: skip claims already stored
  const { claims = [] } = await chrome.storage.local.get('claims');
  const have = new Map(claims.map(c => [c.id, c]));
  const isFinal = c => c && !/progress|pending/i.test(c.status);
  const todo = list.filter(c => !isFinal(have.get(c.id)));

  for (const c of todo) {
    await chrome.tabs.update(tab.id, { url: detailUrl(base, policyId, c.id) });
    await waitForComplete(tab.id); await sleep(1500);
    // expand the accordions, then read text
    await runInTab(tab.id, () => {
      for (const label of ['Invoices', 'Reimbursements', 'Submitted Documents']) {
        const el = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === label);
        el?.click();
      }
    });
    await sleep(900);
    const text = await runInTab(tab.id, () => document.body.innerText);
    const detail = parseClaimDetail(text, c, policyId);
    detail.crawled_at = new Date().toISOString();
    have.set(c.id, detail);
    await chrome.storage.local.set({ claims: [...have.values()] }); // checkpoint
  }
  return { ok: true, count: have.size };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'CRAWL') {
    chrome.storage.local.get('config').then(({ config }) => crawl(config || {}))
      .then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
});
