#!/usr/bin/env node
// Crawl the Allianz "My Benefits / coverage" page into data/policy.json (run to refresh).
//   node bin/policy.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('../lib/config');
const portal = require('../lib/portal');
const policy = require('../lib/policy');

(async () => {
  const cfg = C.load();
  const browser = await portal.connect(cfg);
  const page = await portal.getPage(browser);
  if (!page) throw new Error('No Allianz page — run bin/launch-chrome.js and log in.');
  await page.goto(`${cfg.portal.url}/coverage`);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  if (!await portal.isLoggedIn(page)) throw new Error('Not logged in.');
  await page.waitForFunction(() => /Benefit Limit|Maximum Benefit/i.test(document.body.innerText), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const text = await page.evaluate(() => document.body.innerText);
  const parsed = policy.parse(text);
  const hash = crypto.createHash('sha256').update(JSON.stringify(parsed.benefits)).digest('hex').slice(0, 16);
  const out = path.join(cfg._root, 'data', 'policy.json');
  const histFile = path.join(cfg._root, 'data', 'policy-history.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
  const now = new Date().toISOString();
  if (prev && prev.hash === hash) {
    // unchanged — just bump the lastChecked timestamp, keep history clean
    prev.lastChecked = now;
    fs.writeFileSync(out, JSON.stringify(prev, null, 2));
    console.log(`Policy unchanged (hash ${hash}). ${prev.benefits.length} benefits. Updated lastChecked.`);
  } else {
    parsed.hash = hash; parsed.crawledAt = now; parsed.lastChecked = now; parsed.rawText = text;
    fs.writeFileSync(out, JSON.stringify(parsed, null, 2));
    const hist = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, 'utf8')) : [];
    hist.push({ hash, crawledAt: now, benefitCount: parsed.benefits.length, changedFrom: prev ? prev.hash : null });
    fs.writeFileSync(histFile, JSON.stringify(hist, null, 2));
    console.log(`${prev ? 'Policy CHANGED' : 'Policy ingested'} (hash ${hash}). ${parsed.benefits.length} benefits, ${parsed.period && parsed.period.from}–${parsed.period && parsed.period.to}.`);
    const dental = parsed.benefits.find(b => /Dental Plan/i.test(b.name));
    if (dental) console.log(`Dental plan: €${dental.remaining_eur} remaining of €${dental.limit_eur}.`);
  }
  console.log(`Saved -> ${out}`);
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
