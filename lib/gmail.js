// Gmail helpers via the `gws` (googleworkspace-cli) tool. Needs gmail.modify scope for relabel.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function gws(args) {
  try { return execFileSync('gws', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}
function gwsJson(args) {
  const out = gws(args);
  const i = out.indexOf('{'); const j = out.lastIndexOf('}');
  if (i < 0) return null;
  try { return JSON.parse(out.slice(i, j + 1)); } catch { return null; }
}

function listMessages(query, max = 100) {
  const d = gwsJson(['gmail', 'users', 'messages', 'list', '--params', JSON.stringify({ userId: 'me', q: query, maxResults: max })]);
  return (d && d.messages || []).map(m => m.id);
}

function getMessage(id, format = 'full') {
  return gwsJson(['gmail', 'users', 'messages', 'get', '--params', JSON.stringify({ userId: 'me', id, format })]);
}

function collectPdfParts(part, acc = []) {
  if ((part.filename || '').toLowerCase().endsWith('.pdf') && part.body && part.body.attachmentId)
    acc.push({ filename: part.filename, attachmentId: part.body.attachmentId });
  for (const p of (part.parts || [])) collectPdfParts(p, acc);
  return acc;
}

// Download all PDF attachments of a message into destDir. Returns saved paths.
function downloadAttachments(messageId, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const msg = getMessage(messageId, 'full');
  if (!msg) return [];
  const parts = collectPdfParts(msg.payload || {});
  const saved = [];
  parts.forEach((p, i) => {
    const d = gwsJson(['gmail', 'users', 'messages', 'attachments', 'get', '--params', JSON.stringify({ userId: 'me', messageId, id: p.attachmentId })]);
    if (!d || !d.data) return;
    const raw = Buffer.from(d.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const safe = p.filename.replace(/[^\w.\- ]/g, '_');
    const out = path.join(destDir, `${messageId.slice(0, 8)}_${i}_${safe}`);
    fs.writeFileSync(out, raw);
    saved.push(out);
  });
  return saved;
}

function threadIdOf(messageId) {
  const m = getMessage(messageId, 'minimal');
  return m ? m.threadId : null;
}

function relabelThread(threadId, addLabelIds = [], removeLabelIds = []) {
  const d = gwsJson(['gmail', 'users', 'threads', 'modify',
    '--params', JSON.stringify({ userId: 'me', id: threadId }),
    '--json', JSON.stringify({ addLabelIds, removeLabelIds })]);
  if (!d || !d.messages) return false;
  const labs = d.messages[0].labelIds || [];
  return addLabelIds.every(l => labs.includes(l)) && removeLabelIds.every(l => !labs.includes(l));
}

// Mark a thread settled: add _hotovo, remove _todo (label ids from cfg.gmail).
function markDone(messageOrThreadId, cfg) {
  const tid = threadIdOf(messageOrThreadId) || messageOrThreadId;
  return relabelThread(tid, [cfg.gmail.hotovoLabelId], [cfg.gmail.todoLabelId]);
}

module.exports = { gws, gwsJson, listMessages, getMessage, downloadAttachments, threadIdOf, relabelThread, markDone };
