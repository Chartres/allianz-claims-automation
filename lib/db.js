// Lightweight claims database (node:sqlite — built in, zero deps, single file).
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

function open(cfg) {
  const dir = path.join(cfg._root, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'claims.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      received_date TEXT,
      received_iso TEXT,
      status TEXT,
      total_invoiced REAL,
      total_reimbursed REAL,
      reimbursed_date TEXT,
      flag TEXT,
      doc_count INTEGER,
      crawled_at TEXT
    );
    CREATE TABLE IF NOT EXISTS invoices (
      claim_id TEXT, patient TEXT, provider TEXT, invoice_date TEXT, treatment TEXT, amount REAL
    );
    CREATE TABLE IF NOT EXISTS reimbursements (
      claim_id TEXT, date TEXT, reference TEXT, category TEXT, reimbursed_to TEXT, method TEXT, amount REAL
    );
  `);
  return db;
}

function upsertClaim(db, c) {
  db.prepare('DELETE FROM invoices WHERE claim_id=?').run(c.id);
  db.prepare('DELETE FROM reimbursements WHERE claim_id=?').run(c.id);
  db.prepare(`INSERT INTO claims (id,received_date,received_iso,status,total_invoiced,total_reimbursed,reimbursed_date,flag,doc_count,crawled_at)
              VALUES (?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET received_date=excluded.received_date,received_iso=excluded.received_iso,
                status=excluded.status,total_invoiced=excluded.total_invoiced,total_reimbursed=excluded.total_reimbursed,
                reimbursed_date=excluded.reimbursed_date,flag=excluded.flag,doc_count=excluded.doc_count,crawled_at=excluded.crawled_at`)
    .run(c.id, c.received_date, c.received_iso, c.status, c.total_invoiced, c.total_reimbursed, c.reimbursed_date, c.flag, c.doc_count, c.crawled_at);
  const inv = db.prepare('INSERT INTO invoices VALUES (?,?,?,?,?,?)');
  for (const i of c.invoices) inv.run(c.id, i.patient, i.provider, i.invoice_date, i.treatment, i.amount);
  const rb = db.prepare('INSERT INTO reimbursements VALUES (?,?,?,?,?,?,?)');
  for (const r of c.reimbursements) rb.run(c.id, r.date, r.reference, r.category, r.reimbursed_to, r.method, r.amount);
}

module.exports = { open, upsertClaim };
