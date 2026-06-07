#!/usr/bin/env node
/*
 * Resumable crawl of the Allianz claims history into data/claims.json.
 *   node bin/crawl.js            incremental: crawl new claims + refresh any non-final (pending/in-progress)
 *   node bin/crawl.js --all      re-crawl every claim
 *   node bin/crawl.js 2026       only claims received in/after that year
 *
 * Robust against mid-way downtime: saves a checkpoint after EVERY claim, retries each claim,
 * and if the portal logs out it saves progress and exits — just log back in and re-run to resume.
 */
const fs = require('fs');
const path = require('path');
const C = require('../lib/config');
const portal = require('../lib/portal');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const cfg = C.load();
  const ALL = process.argv.includes('--all');
  const yearArg = process.argv.find(a => /^\d{4}$/.test(a));
  const yearFrom = yearArg ? parseInt(yearArg, 10) : null;
  const snapFile = path.join(cfg._root, 'data', 'claims.json');
  fs.mkdirSync(path.dirname(snapFile), { recursive: true });

  // load existing snapshot (resume)
  const byId = new Map();
  if (fs.existsSync(snapFile)) {
    try { JSON.parse(fs.readFileSync(snapFile, 'utf8')).claims.forEach(c => byId.set(c.id, c)); } catch {}
  }
  const save = () => fs.writeFileSync(snapFile, JSON.stringify({ crawledAt: new Date().toISOString(), claims: [...byId.values()] }, null, 2));
  const isFinal = c => c && /closed|paid|declined|settled|rejected/i.test(c.status) && c.flag !== 'pending';

  const browser = await portal.connect(cfg);
  const page = await portal.getPage(browser);
  if (!page) throw new Error('No Allianz page — run bin/launch-chrome.js and log in.');

  let list;
  for (let a = 1; ; a++) {
    try { list = await portal.listAllClaims(page, cfg); break; }
    catch (e) { if (a >= 3) throw e; console.log(`list attempt ${a} failed (${e.message}), retrying...`); await sleep(3000); }
  }
  if (yearFrom) list = list.filter(c => { const y = (c.received.match(/\d{4}/) || [])[0]; return y && +y >= yearFrom; });

  const todo = list.filter(c => ALL || !byId.has(c.id) || !isFinal(byId.get(c.id)));
  console.log(`${list.length} claims in history; ${todo.length} to (re)crawl (${byId.size} already cached).`);

  let done = 0;
  for (const c of todo) {
    let saved = false;
    for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
      try {
        const d = await portal.getClaimDetail(page, cfg, c);
        d.crawled_at = new Date().toISOString();
        byId.set(c.id, d);
        save(); // checkpoint after every claim
        saved = true; done++;
        console.log(`  [${done}/${todo.length}] ${c.id} ${c.status} — ${d.invoices.length} inv, reimb ${d.total_reimbursed} CZK, flag=${d.flag}`);
      } catch (e) {
        if (e.message === 'LOGGED_OUT') {
          save();
          console.error(`\n⚠ Portal logged out at ${c.id}. Progress saved (${byId.size} claims). Log back in and re-run to resume.`);
          await browser.close(); process.exit(2);
        }
        if (attempt >= 3) { console.log(`  ✗ ${c.id} failed after 3 tries: ${e.message.slice(0, 60)}`); }
        else await sleep(2500);
      }
    }
  }
  save();
  console.log(`\nDone. ${byId.size} claims in ${snapFile}.`);
  await browser.close();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
