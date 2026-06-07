const { canonicalProvider } = require('./config');

// Enrich a crawled claim with canonical provider, per-invoice benefit category + expected
// co-insurance, then check the actual reimbursement against the expected total.
function enrich(claim, cfg) {
  const B = cfg.benefits || {};
  const provCat = B.providerCategory || {};
  const catCov = B.categoryCoverage || {};
  const tol = (B.tolerancePct != null ? B.tolerancePct : 5) / 100;

  // match a provider name to a category key by case-insensitive substring (handles
  // a short config key vs a longer name in the portal history)
  const catFor = (provider) => {
    if (!provider) return B.defaultCategory || null;
    const p = provider.toLowerCase();
    if (provCat[provider]) return provCat[provider];
    for (const [k, v] of Object.entries(provCat)) {
      const kl = k.toLowerCase();
      if (p.includes(kl) || kl.includes(p)) return v;
    }
    return B.defaultCategory || null;
  };

  let expectedTotal = 0, haveAllCoverage = true;
  const invoices = claim.invoices.map(i => {
    const provider = canonicalProvider(cfg, i.provider);
    const category = provCat[provider] || catFor(provider);
    const cov = category != null && catCov[category] != null ? catCov[category] : null;
    const expected = cov != null ? +(i.amount * cov / 100).toFixed(2) : null;
    if (expected == null) haveAllCoverage = false; else expectedTotal += expected;
    return { ...i, provider, provider_raw: i.provider, category, coverage_pct: cov, expected_reimbursed: expected };
  });
  expectedTotal = +expectedTotal.toFixed(2);

  const inv = claim.total_invoiced, reimb = claim.total_reimbursed;
  const ratio = inv ? +(reimb / inv).toFixed(4) : null;
  const pending = /progress|pending|submitted|received|open/i.test(claim.status);

  let check, note = '';
  if (pending) { check = 'pending'; note = 'Still processing — no reimbursement yet.'; }
  else if (reimb === 0 && inv > 0) { check = 'declined'; note = 'Turned down — 0 reimbursed. Check the claim update document; may need additional material / resubmission.'; }
  else if (!haveAllCoverage) { check = ratio >= 0.99 ? 'full' : 'review'; note = 'Some invoice categories unmapped — expected amount partial; verify.'; }
  else if (Math.abs(reimb - expectedTotal) <= Math.max(2, inv * tol)) { check = 'ok'; note = `Matches expected ${expectedTotal} CZK from policy coverage.`; }
  else if (reimb < expectedTotal) { check = 'under'; note = `Reimbursed ${reimb} < expected ${expectedTotal} CZK — possible under-payment, annual cap reached, or FX; verify.`; }
  else { check = 'over'; note = `Reimbursed ${reimb} > expected ${expectedTotal} CZK — verify (excess cover or my category mapping is off).`; }

  return {
    ...claim,
    invoices,
    expected_reimbursed: haveAllCoverage ? expectedTotal : null,
    ratio,
    shortfall: +(inv - reimb).toFixed(2),
    check,
    check_note: note,
  };
}

module.exports = { enrich };
