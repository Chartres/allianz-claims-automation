// Build the tracker workbook as tabs of cells. Numbers are universal spreadsheet formulas
// (SUMIF/COUNTIF/IF/VLOOKUP — work in Excel, LibreOffice and Google Sheets) computed off the base
// data tabs. A cell is a primitive value, or a string starting with "=" (a formula).
const { enrich } = require('./enrich');
const { canonicalProvider } = require('./config');

function build(rawClaims, policy, cfg) {
  const B = cfg.benefits || {};
  const TOL = (B.tolerancePct != null ? B.tolerancePct : 5) / 100;
  const dentalName = B.dentalPlanBenefitName || '';
  const uniq = a => [...new Set(a)].filter(x => x !== '' && x != null);

  const enriched = rawClaims.map(c => enrich(c, cfg));
  const allInv = rawClaims.flatMap(c => c.invoices.map(i => ({ claim: c.id, patient: i.patient, provider: canonicalProvider(cfg, i.provider), date: i.invoice_date, amount: Math.round(i.amount) })));
  const allReimb = rawClaims.flatMap(c => c.reimbursements.map(r => ({ claim: c.id, date: r.date, category: r.category, to: r.reimbursed_to, method: r.method, amount: Math.round(r.amount) })));
  const eById = Object.fromEntries(enriched.map(c => [c.id, c]));
  const claimOrder = rawClaims.slice().sort((a, b) => (b.received_iso || '').localeCompare(a.received_iso || ''));

  // ---- base + reference tabs ----
  const Invoices = [['Claim', 'Patient', 'Provider', 'Invoice date', 'Amount CZK', 'Category', 'Coverage %', 'Expected CZK']];
  allInv.forEach((i, n) => {
    const r = n + 2;
    Invoices.push([i.claim, i.patient, i.provider, i.date, i.amount,
      `=IFERROR(VLOOKUP(C${r},ProviderMap!$A:$B,2,FALSE),"${B.defaultCategory || ''}")`,
      `=IFERROR(VLOOKUP(F${r},Coverage!$A:$B,2,FALSE),"")`,
      `=IF(G${r}="","",ROUND(E${r}*G${r}/100,2))`]);
  });
  const Reimbursements = [['Claim', 'Date', 'Category', 'Reimbursed to', 'Method', 'Amount CZK'],
    ...allReimb.map(x => [x.claim, x.date, x.category, x.to, x.method, x.amount])];
  const ProviderMap = [['Provider', 'Category'], ...Object.entries(B.providerCategory || {})];
  const Coverage = [['Category', 'Coverage %'], ...Object.entries(B.categoryCoverage || {})];

  // ---- Claims (base id/received/month/status; numbers are formulas; labels precomputed) ----
  const Claims = [['Claim', 'Received', 'Month', 'Status', 'Invoiced', 'Reimbursed', 'Expected', 'Shortfall', 'Ratio', 'Check', 'Patients', 'Providers', 'Note']];
  claimOrder.forEach((c, n) => {
    const r = n + 2, e = eById[c.id];
    Claims.push([c.id, c.received_date, (c.received_iso || '').slice(0, 7), c.status,
      `=SUMIF(Invoices!$A:$A,$A${r},Invoices!$E:$E)`,
      `=SUMIF(Reimbursements!$A:$A,$A${r},Reimbursements!$F:$F)`,
      `=SUMIF(Invoices!$A:$A,$A${r},Invoices!$H:$H)`,
      `=E${r}-F${r}`,
      `=IF(E${r}=0,"",F${r}/E${r})`,
      `=IF(OR(ISNUMBER(SEARCH("progress",D${r})),ISNUMBER(SEARCH("pending",D${r}))),"pending",IF(AND(F${r}=0,E${r}>0),"declined",IF(ABS(F${r}-G${r})<=MAX(2,E${r}*${TOL}),"ok",IF(F${r}<G${r},"under","over"))))`,
      uniq(e.invoices.map(i => i.patient)).join(', '),
      uniq(e.invoices.map(i => canonicalProvider(cfg, i.provider))).join(', '),
      `=IF(J${r}="declined","Turned down — check claim update / may need material",IF(J${r}="under","Reimbursed < expected — verify cap/deductible/FX",IF(J${r}="over","Reimbursed > expected — verify",IF(J${r}="pending","Processing",""))))`]);
  });

  // ---- Policy ----
  const Policy = [['Benefit', 'Plan', 'Coverage %', 'Limit €', 'Remaining €', 'Detail']];
  if (policy) for (const b of policy.benefits) Policy.push([b.name, b.plan || '', b.coinsurance ?? '', b.limit_eur ?? '', b.remaining_eur ?? '', b.raw || '']);

  // ---- Overview (formula totals) ----
  const Overview = [
    ['ALLIANZ CLAIMS — OVERVIEW (live formulas)'],
    ['Policy period', policy && policy.period ? `${policy.period.from}–${policy.period.to}` : ''],
    [],
    ['Claims', '=COUNTA(Claims!A2:A)'],
    ['Invoiced CZK', '=SUM(Invoices!E2:E1000)'],
    ['Reimbursed CZK', '=SUM(Reimbursements!F2:F1000)'],
    ['Expected CZK (policy)', '=SUM(Invoices!H2:H1000)'],
    ['Outstanding CZK', '=SUM(Invoices!E2:E1000)-SUM(Reimbursements!F2:F1000)'],
    ['Reimbursement rate', '=IFERROR(SUM(Reimbursements!F2:F1000)/SUM(Invoices!E2:E1000),0)'],
    ['Declined claims', '=COUNTIF(Claims!J2:J1000,"declined")'],
    ['Under-paid claims', '=COUNTIF(Claims!J2:J1000,"under")'],
  ];
  if (dentalName) Overview.push(['Dental plan remaining €', `=IFERROR(VLOOKUP("${dentalName}",Policy!A:E,5,FALSE),"")`, 'of', `=IFERROR(VLOOKUP("${dentalName}",Policy!A:E,4,FALSE),"")`]);

  // ---- Breakdowns (SUMIF/COUNTIF lists — universal, still live) ----
  const Breakdowns = [];
  const section = (title, cols) => { Breakdowns.push([], [title, ...cols.headers]); cols.rows.forEach(row => Breakdowns.push(row)); };
  section('BY CHECK', { headers: ['Claims', 'Invoiced', 'Reimbursed'], rows: ['pending', 'ok', 'under', 'over', 'declined', 'review'].map(k =>
    [k, `=COUNTIF(Claims!J:J,"${k}")`, `=SUMIF(Claims!J:J,"${k}",Claims!E:E)`, `=SUMIF(Claims!J:J,"${k}",Claims!F:F)`]) });
  section('BY PATIENT', { headers: ['Invoices', 'Invoiced', 'Expected'], rows: uniq(allInv.map(i => i.patient)).map(k =>
    [k, `=COUNTIF(Invoices!B:B,"${k}")`, `=SUMIF(Invoices!B:B,"${k}",Invoices!E:E)`, `=SUMIF(Invoices!B:B,"${k}",Invoices!H:H)`]) });
  const cats = uniq([...allInv.map(i => B.providerCategory[canonicalProvider(cfg, i.provider)] || B.defaultCategory)]);
  section('BY CATEGORY', { headers: ['Invoices', 'Invoiced', 'Expected'], rows: cats.map(k =>
    [k, `=COUNTIF(Invoices!F:F,"${k}")`, `=SUMIF(Invoices!F:F,"${k}",Invoices!E:E)`, `=SUMIF(Invoices!F:F,"${k}",Invoices!H:H)`]) });
  section('BY PROVIDER', { headers: ['Invoices', 'Invoiced', ''], rows: uniq(allInv.map(i => i.provider)).map(k =>
    [k, `=COUNTIF(Invoices!C:C,"${k}")`, `=SUMIF(Invoices!C:C,"${k}",Invoices!E:E)`, '']) });
  section('BY MONTH', { headers: ['Claims', 'Invoiced', 'Reimbursed'], rows: uniq(claimOrder.map(c => (c.received_iso || '').slice(0, 7))).sort().map(k =>
    [k, `=COUNTIF(Claims!C:C,"${k}")`, `=SUMIF(Claims!C:C,"${k}",Claims!E:E)`, `=SUMIF(Claims!C:C,"${k}",Claims!F:F)`]) });

  // ---- Needs attention (precomputed view of flagged claims) ----
  const NeedsAttention = [['Claim', 'Received', 'Status', 'Check', 'Invoiced', 'Reimbursed', 'Expected', 'Shortfall', 'Patients', 'Note']];
  for (const c of enriched.filter(c => ['declined', 'under', 'over', 'review'].includes(c.check)))
    NeedsAttention.push([c.id, c.received_date, c.status, c.check, Math.round(c.total_invoiced), Math.round(c.total_reimbursed),
      c.expected_reimbursed != null ? Math.round(c.expected_reimbursed) : '', Math.round(c.shortfall), uniq(c.invoices.map(i => i.patient)).join(', '), c.check_note]);

  return { enriched, tabs: [
    { name: 'Overview', rows: Overview }, { name: 'Claims', rows: Claims }, { name: 'Invoices', rows: Invoices },
    { name: 'Reimbursements', rows: Reimbursements }, { name: 'Policy', rows: Policy },
    { name: 'ProviderMap', rows: ProviderMap }, { name: 'Coverage', rows: Coverage },
    { name: 'Breakdowns', rows: Breakdowns }, { name: 'Needs attention', rows: NeedsAttention },
  ] };
}

module.exports = { build };
