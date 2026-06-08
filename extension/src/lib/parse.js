// Extract invoice fields from already-extracted text (pdf.js for PDFs, tesseract.js for photos do the
// text step in the browser; this is the pure regex layer, ported from the CLI's lib/pdf.js parse()).
function cleanNum(s) {
  return s.replace(/[\s ]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.').replace(/,00$|\.00$/, '');
}

// parseFields(text, cfg) → { faktura, vs, patientName, date(DD/MM/YYYY), amount, paid, items[] }
export function parseFields(text, cfg = {}) {
  const t = text || '';
  if (!t.trim()) return { error: 'no text', items: [], raw: '', patientName: '?', date: '?', amount: '?', faktura: null, vs: null, paid: null };

  const fakt = t.match(/DOKLAD\s+[ČčCc]\.?\s*([0-9]{6,})/) || t.match(/doklad\s+č\.?\s*([0-9]{6,})/i);
  const vsM = t.match(/Variabilní symbol:\s*([0-9]{4,})/i);

  let patientName = '?';
  for (const [key, p] of Object.entries(cfg.patients || {})) {
    const cands = [...(p.aliases || []), p.portalLabel, key];
    if (cands.some(c => c && t.includes(c))) { patientName = key; break; }
  }

  const dm = t.match(/Datum uskut[^:]*:\s*([0-9]{2})\.([0-9]{2})\.([0-9]{4})/) || t.match(/Datum vystavení:\s*([0-9]{2})\.([0-9]{2})\.([0-9]{4})/);
  const date = dm ? `${dm[1]}/${dm[2]}/${dm[3]}` : '?';

  const cm = t.match(/Celkem(?:\s+k úhradě)?:?\s*([0-9\s .,]+)\s*(?:Kč|CZK)/i) || t.match(/Celkem\s+([0-9\s .,]+)\s*(?:Kč|CZK)/);
  const amount = cm ? cleanNum(cm[1]) : '?';

  const zm = t.match(/Zbývá uhradit:\s*([0-9\s .,]+)\s*(?:Kč|CZK)/i);
  const paid = zm ? ['0', '0.00', '0.0'].includes(cleanNum(zm[1])) : null;

  const items = (t.match(/^\s*([A-Z]\s?\d\d?\s*-\s*[^\n]{3,55})/gm) || []).map(s => s.trim().replace(/\s{2,}/g, ' ')).slice(0, 12);

  return { faktura: fakt ? fakt[1] : null, vs: vsM ? vsM[1] : (fakt ? fakt[1] : null), patientName, date, amount, paid, items, raw: t };
}
