#!/usr/bin/env node
/*
 * Bridge: pull invoice PDF attachments from Gmail (label _todo, with attachments) into intake/.
 * Lets the file-based intake flow consume email invoices. Read-only unless you later file them.
 *
 *   node bin/gmail-pull.js                 pull last ~13 months of _todo invoice attachments
 *   node bin/gmail-pull.js "after:2025/10/15"   custom Gmail query (appended to the label filter)
 *
 * Requires gws authenticated (see README). Does NOT relabel — relabel happens after a claim is
 * filed and confirmed, via lib/gmail.markDone (intake/--submit can call it for Gmail-sourced files).
 */
const path = require('path');
const C = require('../lib/config');
const gmail = require('../lib/gmail');

const cfg = C.load();
const INTAKE = path.join(cfg._root, 'intake');
const extra = process.argv[2] || 'newer_than:13m';
const query = `label:${cfg.gmail.todoLabelName || '_todo'} has:attachment ${extra}`;

const ids = gmail.listMessages(query, 100);
console.log(`Query: ${query}\n${ids.length} message(s) with attachments.`);
let total = 0;
for (const id of ids) {
  const saved = gmail.downloadAttachments(id, INTAKE);
  saved.forEach(p => console.log('  ↓', path.basename(p)));
  total += saved.length;
}
console.log(`\nDownloaded ${total} PDF(s) to intake/. Review, remove non-invoices, then:  node bin/intake.js`);
