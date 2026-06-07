#!/usr/bin/env node
/*
 * Open the dedicated Chrome the tool drives, then wait until you've logged in *to that window*.
 *   node bin/launch-chrome.js
 *
 * IMPORTANT: it opens a SEPARATE Chrome with its own empty profile (not your everyday Chrome).
 * Log in (email + password + OTP) in THAT window — the one this script just opened. The script
 * watches the same browser it will drive, so when it prints "logged in" you're definitely connected.
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const { chromium } = require('playwright-core');
const cfg = require('../lib/config').load();

const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : (process.platform === 'win32' ? 'C\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : 'google-chrome');
const profile = path.resolve(cfg._root, cfg.portal.chromeProfileDir || 'chrome-profile');
const port = cfg.portal.cdpPort || 9222;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // already running with a logged-in session?
  let alreadyUp = false;
  try { execSync(`curl -s http://localhost:${port}/json/version`, { stdio: 'ignore' }); alreadyUp = true; } catch {}

  if (!alreadyUp) {
    const child = spawn(CHROME, [
      `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--new-window',
      `${cfg.portal.url}/claims/list`,
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    console.log('\n🟦 A NEW Chrome window just opened (its own blank profile — NOT your everyday Chrome).');
  } else {
    console.log('\n🟦 Re-using the Chrome already started by this tool (CDP port ' + port + ').');
  }
  console.log('   → Log in there: email + password + OTP, until you see "My Claims".');
  console.log('   (If this keeps waiting, you may be logging into your normal Chrome by mistake —');
  console.log('    use the window THIS script opened.)\n');

  const deadline = Date.now() + 5 * 60 * 1000;
  let lastMsg = 0;
  while (Date.now() < deadline) {
    try {
      const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
      let page = null;
      for (const ctx of browser.contexts()) for (const p of ctx.pages()) if (p.url().includes('allianzcare.com')) page = p;
      const loggedIn = page && !/login|signin/i.test(page.url());
      await browser.close();
      if (loggedIn) { console.log('✅ Logged in and connected. Next:  npm run track   (or: node bin/discover.js to auto-fill settings)'); return; }
    } catch { /* CDP not up yet */ }
    if (Date.now() - lastMsg > 8000) { process.stdout.write('   …waiting for login\n'); lastMsg = Date.now(); }
    await sleep(2000);
  }
  console.log('⌛ Timed out waiting for login. Re-run when ready — Chrome stays open.');
})();
