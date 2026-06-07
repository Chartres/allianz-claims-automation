// Parse the Allianz "My Benefits / coverage" page text into a structured policy.
function euro(s) { const m = (s || '').match(/€\s*([\d,]+(?:\.\d+)?)/); return m ? parseFloat(m[1].replace(/,/g, '')) : null; }
function pct(s) { const m = (s || '').match(/(\d+)\s*%\s*refund/i); return m ? parseInt(m[1], 10) : (/full refund/i.test(s) ? 100 : null); }
function isValueLine(l) { return /€|%|Full Refund|day limit|Max\.|Maximum|refund/i.test(l); }

function parse(text) {
  const lines = text.split('\n').flatMap(l => l.split('\t')).map(l => l.trim()).filter(Boolean);
  const period = (text.match(/From\s+(\d{1,2} \w+ \d{4})\s+to\s+(\d{1,2} \w+ \d{4})/) || []).slice(1);
  const region = (text.match(/Region of Cover\s*\n?\s*([^\n\t]+)/) || [])[1];
  const overall = (text.match(/Overall Maximum Benefit\s*€\s*([\d,]+)/) || [])[1];

  let plan = '';
  const benefits = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/Plan$/.test(l) && l.length < 40) { plan = l; }            // e.g. "... Out-patient Plan"
    if (isValueLine(l)) continue;                                   // value, handled with its name
    if (l.length < 4 || /^(Benefit Limit|Remaining|Notes|Insured|Region|Effective|Please Note|Treatment guarantee|Hello|My )/.test(l)) continue;
    // gather the value lines that follow this (a benefit name)
    const vals = [];
    for (let j = i + 1; j < lines.length && j < i + 5 && isValueLine(lines[j]); j++) vals.push(lines[j]);
    if (!vals.length) continue;
    const joined = vals.join(' | ');
    const eVals = vals.map(euro).filter(v => v != null);
    benefits.push({
      plan, name: l,
      coinsurance: pct(joined),
      limit_eur: eVals.length ? eVals[0] : null,
      remaining_eur: eVals.length > 1 ? eVals[eVals.length - 1] : null,
      raw: joined,
    });
  }
  return {
    period: period.length ? { from: period[0], to: period[1] } : null,
    region: region || null,
    overallMaxEur: overall ? parseFloat(overall.replace(/,/g, '')) : null,
    benefits,
  };
}

module.exports = { parse };
