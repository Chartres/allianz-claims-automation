#!/usr/bin/env node
// Print the Allianz claims history (id, date received, status) to verify claims landed.
//   node bin/reconcile.js
const C = require('../lib/config');
const portal = require('../lib/portal');

(async () => {
  const cfg = C.load();
  const browser = await portal.connect(cfg);
  const page = await portal.getPage(browser);
  if (!page) throw new Error('No Allianz page — run bin/launch-chrome.js and log in.');
  if (!await portal.isLoggedIn(page)) throw new Error('Not logged in.');
  const claims = await portal.getClaimsList(page, cfg);
  console.log(`\nClaims history (${claims.length}):`);
  for (const c of claims) console.log(`  ${c.id}  ${c.received.padEnd(14)}  ${c.status}`);
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
