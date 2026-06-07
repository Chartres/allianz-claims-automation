// Parse an invoice PDF into structured fields via `pdftotext -layout`.
const { execFileSync } = require('child_process');

function text(file) {
  try { return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }); }
  catch { return ''; }
}

function cleanNum(s) {
  return s.replace(/[\s ]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.').replace(/,00$|\.00$/, '');
}

// Returns { faktura, vs, patientName, date (DD/MM/YYYY), amount, paid, items[], raw }
function parse(file, cfg) {
  const t = text(file);
  if (!t) return { error: 'no text (image-only PDF?)', file };

  const fakt = t.match(/DOKLAD\s+[ČčCc]\.?\s*([0-9]{6,})/) || t.match(/doklad\s+č\.?\s*([0-9]{6,})/i);
  const vsM = t.match(/Variabilní symbol:\s*([0-9]{4,})/i);

  // patient: match against config aliases anywhere in text
  let patientName = '?';
  if (cfg) {
    for (const [key, p] of Object.entries(cfg.patients)) {
      const cands = [...(p.aliases || []), p.portalLabel, key];
      if (cands.some(c => t.includes(c))) { patientName = key; break; }
    }
  }

  const dm = t.match(/Datum uskut[^:]*:\s*([0-9]{2})\.([0-9]{2})\.([0-9]{4})/) ||
             t.match(/Datum vystavení:\s*([0-9]{2})\.([0-9]{2})\.([0-9]{4})/);
  const date = dm ? `${dm[1]}/${dm[2]}/${dm[3]}` : '?';

  const cm = t.match(/Celkem(?:\s+k úhradě)?:?\s*([0-9\s .,]+)\s*(?:Kč|CZK)/i) ||
             t.match(/Celkem\s+([0-9\s .,]+)\s*(?:Kč|CZK)/);
  const amount = cm ? cleanNum(cm[1]) : '?';

  const zm = t.match(/Zbývá uhradit:\s*([0-9\s .,]+)\s*(?:Kč|CZK)/i);
  const paid = zm ? ['0', '0.00', '0.0'].includes(cleanNum(zm[1])) : null;

  const items = (t.match(/^\s+([A-Z]\s?\d\d?\s*-\s*[^\n]{3,55})/gm) || [])
    .map(s => s.trim().replace(/\s{2,}/g, ' ')).slice(0, 12);

  return {
    file,
    faktura: fakt ? fakt[1] : null,
    vs: vsM ? vsM[1] : (fakt ? fakt[1] : null),
    patientName,
    date,
    amount,
    paid,
    items,
    raw: t,
  };
}

module.exports = { parse, text };
