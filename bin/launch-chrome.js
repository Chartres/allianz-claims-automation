#!/usr/bin/env node
// Launch an isolated Chrome with remote debugging on the Allianz portal, so the
// driver can attach over CDP. You log in (email+password+OTP) in this window once.
const { spawn } = require('child_process');
const path = require('path');
const cfg = require('../lib/config').load();

const CHROME = process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  : 'google-chrome';
const profile = path.resolve(cfg._root, cfg.portal.chromeProfileDir || 'chrome-profile');
const port = cfg.portal.cdpPort || 9222;

const child = spawn(CHROME, [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check',
  `${cfg.portal.url}/claims/list`,
], { detached: true, stdio: 'ignore' });
child.unref();

console.log(`Launched Chrome (CDP :${port}, profile ${profile}).`);
console.log('→ Log in to the Allianz portal in that window (email + password + OTP).');
console.log('→ Then run:  node bin/intake.js   (add --file to fill, --submit to submit)');
