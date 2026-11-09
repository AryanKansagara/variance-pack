import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReport, drivers, flags, priceVolume, shift, timing, variance, type Flag } from './variance.ts'
import { carryForward, draft, facts, money, startingNote, type Note } from './commentary.ts'
import { balanceChecks, detect, num, parseCsv, parseRows, proposeMapping, splitAccount, tieOut, toPeriod } from './parse.ts'
import { sampleConfig, sampleData } from './sample.ts'
import type { Config, Dataset, Line } from './types.ts'

const th = { abs: 10000, pct: 0.1 }
const cfg = (over: Partial<Config> = {}): Config => ({
  reportingCurrency: 'USD', thresholds: th, basis: 'budget', entities: [],
  mapping: [
    { account: '4000', name: 'Revenue', line: 'Revenue', section: 'Revenue', kind: 'revenue' },
    { account: '6100', name: 'Marketing', line: 'Sales & marketing', section: 'Operating expenses', kind: 'expense' },
  ],
  ...over,
})
const L = (period: string, account: string, debit: number, credit: number, extra: Partial<Line> = {}): Line => ({ entity: 'A', period, account, debit, credit, ...extra })

test('variance sign: revenue above budget and expense below budget are favourable', () => {
  assert.equal(variance(110, 100, 'revenue', { abs: 0, pct: 0 }).favourable, true)
  assert.equal(variance(90, 100, 'revenue', { abs: 0, pct: 0 }).favourable, false)
  assert.equal(variance(90, 100, 'expense', { abs: 0, pct: 0 }).favourable, true)
  assert.equal(variance(110, 100, 'expense', { abs: 0, pct: 0 }).favourable, false)
})

test('materiality needs both the dollar and the percent test to trip', () => {
  assert.equal(variance(1_050_000, 1_000_000, 'expense', th).flagged, false, '$50k but only 5%')
  assert.equal(variance(9_000, 5_000, 'expense', th).flagged, false, '80% but only $4k')
  assert.equal(variance(130_000, 100_000, 'expense', th).flagged, true)
  assert.equal(variance(12_000, 0, 'expense', th).flagged, true, 'no budget at all trips on dollars alone')
  assert.equal(variance(12_000, 0, 'expense', th).pct, null)
})

test('report maps accounts, applies natural sign and rolls up to net income', () => {
  const ds: Dataset = {
    actuals: [L('2026-10', '4000', 0, 500_000), L('2026-10', '6100', 230_000, 0), L('2026-10', '1000', 270_000, 0), L('2026-10', '7777', 5_000, 0)],
    budget: [{ entity: 'A', period: '2026-10', account: '4000', amount: 480_000 }, { entity: 'A', period: '2026-10', account: '6100', amount: 190_000 }],
  }
  const r = buildReport(ds, cfg(), '2026-10')
  const rev = r.rows.find(x => x.account === '4000')!
  const mkt = r.rows.find(x => x.account === '6100')!
  assert.equal(rev.actual, 500_000)
  assert.equal(mkt.vs.budget.amount, 40_000)
  assert.equal(mkt.vs.budget.favourable, false)
  assert.equal(r.netIncome.actual, 270_000)
  assert.equal(r.netIncome.budget, 290_000)
  assert.equal(r.netIncome.vs.budget.favourable, false)
  assert.deepEqual(r.unmapped, [{ account: '7777', net: 5000 }], 'unmapped P&L accounts are reported, balance sheet is not')
})

test('month-over-month and year-over-year use prior and same-month-last-year actuals', () => {
  const ds: Dataset = { actuals: [L('2026-10', '6100', 120, 0), L('2026-09', '6100', 100, 0), L('2025-10', '6100', 60, 0)], budget: [] }
  const r = buildReport(ds, cfg(), '2026-10')
  assert.equal(r.rows[0].vs.mom.amount, 20)
  assert.equal(r.rows[0].vs.yoy.amount, 60)
  assert.equal(shift('2026-01', -1), '2025-12')
  assert.equal(shift('2025-11', 12), '2026-11')
})

test('consolidation converts at the entity FX rate and eliminates intercompany accounts', () => {
  const c = cfg({
    entities: [{ id: 'US', name: 'US', currency: 'USD', fx: 1 }, { id: 'CA', name: 'CA', currency: 'CAD', fx: 0.73 }],
    mapping: [...cfg().mapping,
      { account: '4900', name: 'IC fee income', line: 'IC', section: 'Revenue', kind: 'revenue', intercompany: true },
      { account: '6900', name: 'IC fee expense', line: 'IC', section: 'Operating expenses', kind: 'expense', intercompany: true }],
  })
  const ds: Dataset = {
    actuals: [
      { entity: 'US', period: '2026-10', account: '6100', debit: 1000, credit: 0 },
      { entity: 'CA', period: '2026-10', account: '6100', debit: 1000, credit: 0 },
      { entity: 'US', period: '2026-10', account: '4900', debit: 0, credit: 10_000 },
      { entity: 'CA', period: '2026-10', account: '6900', debit: 13_700, credit: 0 },
    ], budget: [],
  }
  const all = buildReport(ds, c, '2026-10')
  assert.equal(all.rows.find(r => r.account === '6100')!.actual, 1730)
  assert.ok(!all.rows.some(r => r.account === '4900' || r.account === '6900'), 'intercompany removed')
  assert.equal(all.eliminations.residual, 1, 'CAD 13,700 at 0.73 is USD 10,001, one dollar off the US side')
  const us = buildReport(ds, c, '2026-10', { entity: 'US' })
  assert.equal(us.rows.find(r => r.account === '4900')!.actual, 10_000, 'single entity keeps intercompany')
})

test('price/volume split sums to the total variance', () => {
  const pv = priceVolume(110 * 52, 110, 100 * 50, 100)!
  assert.equal(pv.volume, 500)
  assert.equal(pv.price, 220)
  assert.equal(pv.volume + pv.price, 110 * 52 - 100 * 50)
  assert.equal(priceVolume(100, 0, 100, 10), null)
})

test('drivers isolate a new vendor and ignore steady ones', () => {
  const ds: Dataset = { actuals: [], budget: [] }
  for (const p of ['2026-07', '2026-08', '2026-09', '2026-10']) {
    ds.actuals.push(L(p, '6100', 50_000, 0, { vendor: 'Google Ads' }))
    ds.actuals.push(L(p, '6100', 20_000, 0, { vendor: 'LinkedIn Ads' }))
  }
  ds.actuals.push(L('2026-10', '6100', 35_000, 0, { vendor: 'Acme Media', memo: 'New campaign invoice' }))
  const d = drivers(ds, cfg(), { account: '6100', kind: 'expense' }, '2026-10', 'budget', { entity: 'all' }, 35_000)
  assert.equal(d.length, 1)
  assert.equal(d[0].name, 'Acme Media')
  assert.equal(d[0].delta, 35_000)
  assert.equal(d[0].tag, 'new')
})

test('drivers flag a one-off entry from a known vendor and an accrual by memo', () => {
  const ds: Dataset = { actuals: [], budget: [] }
  for (const p of ['2026-07', '2026-08', '2026-09']) ds.actuals.push(L(p, '6100', 5_000, 0, { vendor: 'Studio North' }))
  ds.actuals.push(L('2026-10', '6100', 30_000, 0, { vendor: 'Studio North', memo: 'Brand refresh project' }))
  ds.actuals.push(L('2026-10', '6100', 12_000, 0, { vendor: 'Deloitte', memo: 'Year-end accrual' }))
  const d = drivers(ds, cfg(), { account: '6100', kind: 'expense' }, '2026-10', 'budget', { entity: 'all' }, 37_000)
  assert.equal(d[0].name, 'Studio North')
  assert.equal(d[0].tag, 'one-off')
  assert.equal(d.find(x => x.name === 'Deloitte')?.tag, 'accrual')
})

test('timing: a variance that reverses next month, and one that does not', () => {
  const vars: Record<string, number> = { '2026-09': 48_000, '2026-10': -47_000, '2026-08': 2000 }
  const t = timing(p => vars[p] ?? null, '2026-09', 10_000, [])
  assert.equal(t.timing, true)
  assert.equal(t.reversesIn, '2026-10')
  const t2 = timing(p => ({ '2026-09': 48_000, '2026-10': 30_000 } as Record<string, number>)[p] ?? null, '2026-09', 10_000, [])
  assert.equal(t2.timing, false)
  const t3 = timing(p => ({ '2026-09': 48_000, '2026-10': -5_000 } as Record<string, number>)[p] ?? null, '2026-09', 10_000, [])
  assert.equal(t3.timing, false, 'a small opposite move is not a reversal')
})

test('commentary draft inlines only computed numbers', () => {
  const ds = sampleData('saas'), c = sampleConfig('saas')
  const r = buildReport(ds, c, '2026-10')
  const f = flags(ds, c, r).find(x => x.row.account === '6100')!
  assert.ok(f, 'marketing is flagged')
  const text = draft(f)
  assert.match(text, /^Advertising and media \$\d+k \(\d+%\) over budget, driven by Acme Media \$35k new campaign invoice \(new vendor\)/)
  assert.match(text, /non-recurring\.$/)
  for (const tok of text.match(/\$[\d.]+[kM]?/g)!) assert.ok(facts(f).tokens.includes(tok), `${tok} comes from facts`)
})

test('sample SaaS: audit fee accrued early is detected as timing in both months', () => {
  const ds = sampleData('saas'), c = sampleConfig('saas')
  for (const p of ['2026-09', '2026-10']) {
    const f = flags(ds, c, buildReport(ds, c, p)).find(x => x.row.account === '6500')
    assert.ok(f, `audit flagged in ${p}`)
    assert.equal(f.nature, 'timing', p)
  }
  const sep = flags(ds, c, buildReport(ds, c, '2026-09')).find(x => x.row.account === '6500')!
  assert.match(draft(sep), /timing, reverses in Oct 2026/)
})

test('sample SaaS: subscription revenue shows a price/volume split', () => {
  const ds = sampleData('saas'), c = sampleConfig('saas')
  const row = buildReport(ds, c, '2026-10').rows.find(r => r.account === '4000')!
  assert.ok(row.pv)
  assert.ok(row.pv.price > 0 && row.pv.volume < 0, 'price up, seats down')
  assert.ok(Math.abs(row.pv.price + row.pv.volume - row.vs.budget.amount) < 1)
})

test('sample multi-entity: ledgers balance per entity and intercompany nets to near zero', () => {
  const ds = sampleData('multi'), c = sampleConfig('multi')
  assert.ok(balanceChecks(ds.actuals).every(b => b.ok))
  const r = buildReport(ds, c, '2026-10')
  assert.equal(r.eliminations.items.length, 2)
  assert.equal(r.eliminations.residual, 1)
  const freight = flags(ds, c, r).find(x => x.row.account === '5100')
  assert.ok(freight)
  assert.equal(freight.drivers[0].name, 'Northern Haul Logistics')
})

test('carry forward keeps the analyst wording and refreshes the numbers', () => {
  const prev = { key: '6100|Acme Media', tokens: ['$42k', '18%', '$35k'] }
  const next = { key: '6100|Acme Media', tokens: ['$51k', '22%', '$40k'] }
  const edited = 'Marketing $42k (18%) over plan: Acme Media $35k for the Q4 launch, agreed with the CMO.'
  assert.equal(carryForward(edited, prev, next), 'Marketing $51k (22%) over plan: Acme Media $40k for the Q4 launch, agreed with the CMO.')
  assert.equal(carryForward(edited, prev, { ...next, key: '6100|Google Ads' }), null, 'different driver starts fresh')
  assert.equal(carryForward('A $4.2k and $42k', { key: 'k', tokens: ['$42k', '$4.2k'] }, { key: 'k', tokens: ['$1k', '$2k'] }), 'A $2k and $1k')
})

test('startingNote uses the prior edited wording only when the driver recurs', () => {
  const ds = sampleData('saas'), c = sampleConfig('saas')
  const f = flags(ds, c, buildReport(ds, c, '2026-10')).find(x => x.row.account === '6100') as Flag
  const fx = facts(f)
  const prior: Note = { text: `Media spend ${fx.tokens[0]} over; ${fx.tokens[2]} Acme.`, edited: true, status: 'approved', comment: '', facts: { ...fx, tokens: fx.tokens.map(() => '$1k') }, updatedAt: 1 }
  const n = startingNote(f, { '2026-09|6100': { ...prior, text: 'Media spend $1k over; Acme drove it.' } }, ['2026-09'])
  assert.equal(n.carriedFrom, '2026-09')
  assert.equal(n.text, `Media spend ${fx.tokens[0]} over; Acme drove it.`)
  const fresh = startingNote(f, { '2026-09|6100': { ...prior, edited: false } }, ['2026-09'])
  assert.equal(fresh.text, draft(f))
})

test('money formatting', () => {
  assert.equal(money(42_300), '$42k')
  assert.equal(money(4_230), '$4.2k')
  assert.equal(money(1_250_000), '$1.25M')
  assert.equal(money(-850), '-$850')
})

test('number, period and account parsing handle accounting formats', () => {
  assert.equal(num('$1,234.50'), 1234.5)
  assert.equal(num('(1,234.50)'), -1234.5)
  assert.equal(num('500-'), -500)
  assert.equal(num(''), 0)
  assert.equal(num('abc'), null)
  assert.equal(toPeriod('2026-10-31'), '2026-10')
  assert.equal(toPeriod('10/31/2026'), '2026-10')
  assert.equal(toPeriod('31/10/2026'), '2026-10')
  assert.equal(toPeriod('Oct 2026'), '2026-10')
  assert.equal(toPeriod('Oct-26'), '2026-10')
  assert.equal(toPeriod('October 2026'), '2026-10')
  assert.deepEqual(splitAccount('6100 Advertising'), { code: '6100', name: 'Advertising' })
  assert.deepEqual(splitAccount('6100 - Advertising'), { code: '6100', name: 'Advertising' })
  assert.deepEqual(splitAccount('Advertising (6100)'), { code: '6100', name: 'Advertising' })
})

test('detects a NetSuite saved search and parses it with line-numbered issues', () => {
  const csv = [
    'Date,Posting Period,Type,Document Number,Name,Account,Memo,Amount (Debit),Amount (Credit),Department,Subsidiary',
    '10/03/2026,Oct 2026,Bill,B-1,Acme Media,6100 Advertising,Campaign,"35,000.00",,Marketing,US',
    '10/03/2026,Oct 2026,Bill,B-1,Acme Media,2000 Accounts Payable,Campaign,,"35,000.00",,US',
    '10/04/2026,Oct 2026,Bill,B-2,Bad Row,6100 Advertising,,abc,,,US',
  ].join('\n')
  const rows = parseCsv(csv)
  const d = detect(rows)
  assert.equal(d.kind, 'actuals')
  assert.equal(d.format, 'NetSuite: transaction saved search')
  const p = parseRows(rows, d, { entity: 'X' })
  assert.equal(p.actuals.length, 2)
  assert.equal(p.actuals[0].entity, 'US')
  assert.equal(p.actuals[0].vendor, 'Acme Media')
  assert.equal(p.issues.length, 1)
  assert.equal(p.issues[0].line, 4)
  assert.equal(p.names['6100'], 'Advertising')
})

test('parses a QuickBooks Journal report with title rows above the header', () => {
  const csv = [
    'Journal', 'Northwind Cloud', '"October 1-31, 2026"', '',
    'Date,Transaction Type,Num,Name,Memo/Description,Account,Debit,Credit',
    '10/05/2026,Bill,1001,Google Ads,Search,6100 Advertising,"$1,000.00",',
    ',,,,,2000 Accounts Payable,,"$1,000.00"',
    ',,,,,,"$1,000.00","$1,000.00"',
  ].join('\n')
  const rows = parseCsv(csv)
  const d = detect(rows)
  assert.equal(d.headerRow, 4)
  assert.equal(d.format, 'QuickBooks Online: Journal report')
  const p = parseRows(rows, d, { entity: 'NWC', period: '2026-10' })
  assert.equal(p.actuals.length, 2, 'the continuation row takes the default period; the totals row has no account')
  assert.equal(p.actuals[1].period, '2026-10')
})

test('parses a wide budget with one column per month', () => {
  const rows = parseCsv('Account,Jan 2026,Feb 2026,Mar 2026\n6100 Advertising,"10,000","12,000",11000\n4000 Revenue,50000,50000,abc')
  const d = detect(rows)
  assert.equal(d.kind, 'budget')
  const p = parseRows(rows, d, { entity: 'A' })
  assert.equal(p.budget.length, 5)
  assert.deepEqual(p.budget[1], { entity: 'A', period: '2026-02', account: '6100', amount: 12000 })
  assert.equal(p.issues[0].line, 3)
})

test('balance checks, tie-out and mapping proposals', () => {
  const lines = [L('2026-10', '6100', 100, 0), L('2026-10', '2000', 0, 90)]
  const b = balanceChecks(lines)[0]
  assert.equal(b.ok, false)
  assert.equal(b.diff, 10)
  const tie = tieOut([L('2026-10', '6100', 100, 0)], [L('2026-10', '6100', 120, 0)])
  assert.equal(tie.length, 1)
  assert.equal(tie[0].diff, -20)
  const m = proposeMapping([{ code: '4000', name: 'Subscription revenue' }, { code: '1000', name: 'Cash' }, { code: '6900', name: 'Intercompany fee' }, { code: '6100', name: 'Advertising' }], [])
  assert.equal(m.length, 3)
  assert.equal(m[0].kind, 'revenue')
  assert.equal(m[1].intercompany, true)
  assert.equal(m[2].line, 'Sales & marketing')
})
