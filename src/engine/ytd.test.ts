// Xero year-to-date trial balances -> monthly actuals. The CSVs follow the layout of the real export
// (title rows, then Account Code / Account / Account Type / Debit - Year to date / Credit - Year to date).
// Company and account names are made up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balanceChecks, detect, parseCsv, parseRows } from './parse.ts'
import { buildReport } from './variance.ts'
import { addYtd, applyYtd, deriveMonthly } from './ytd.ts'
import type { Config, Dataset, Line } from './types.ts'

type Row = [code: string, name: string, type: string, debit: number | '', credit: number | '']
const money = (n: number | '') => n === '' ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const asAt = (period: string) => { const [y, m] = period.split('-').map(Number); return `${new Date(Date.UTC(y, m, 0)).getUTCDate()} ${MONTHS[m - 1]} ${y}` }

function xero(period: string, rows: Row[], opts: { entity?: string } = {}): Line[] {
  const text = ['Trial Balance,,,,', 'Harbor Row Studio (synthetic),,,,', `As at ${asAt(period)},,,,`, ',,,,', 'Account Code,Account,Account Type,Debit - Year to date,Credit - Year to date',
    ...rows.map(r => `${r[0]},${r[1]},${r[2]},"${money(r[3])}","${money(r[4])}"`), 'Total,,,,'].join('\n')
  const grid = parseCsv(text)
  const d = detect(grid)
  assert.equal(d.ytd, true)
  assert.equal(d.period, period)
  const p = parseRows(grid, d, { entity: opts.entity ?? 'MAIN' })
  assert.deepEqual(p.issues.map(i => i.level), ['warning'])
  return p.actuals
}

const net = (lines: Line[], period: string, entity = 'MAIN') => {
  const m: Record<string, number> = {}
  for (const l of lines) if (l.entity === entity && l.period === period) m[l.account] = Math.round(((m[l.account] ?? 0) + l.debit - l.credit) * 100) / 100
  return m
}
const empty: Dataset = { actuals: [], budget: [] }
const fold = (files: Line[][], fy: number | undefined = 1) => files.reduce((ds, f) => addYtd(ds, f, fy).ds, empty)

const JAN: Row[] = [['200', 'Sales', 'Revenue', '', 40000], ['310', 'Cost of Goods Sold', 'Direct Costs', 12000, ''], ['400', 'Advertising', 'Expense', 5000, ''], ['477', 'Wages and Salaries', 'Expense', 20000, ''], ['090', 'Checking Account', 'Bank', 50000, ''], ['960', 'Retained Earnings', 'Equity', '', 47000]]
const FEB: Row[] = [['200', 'Sales', 'Revenue', '', 85000], ['310', 'Cost of Goods Sold', 'Direct Costs', 26000, ''], ['400', 'Advertising', 'Expense', 22000, ''], ['477', 'Wages and Salaries', 'Expense', 40000, ''], ['485', 'Software Subscriptions', 'Expense', 1200.5, ''], ['090', 'Checking Account', 'Bank', 60000, ''], ['800', 'Accounts Payable', 'Current Liability', '', 17200.5], ['960', 'Retained Earnings', 'Equity', '', 47000]]

test('P&L accounts are differenced, balance sheet accounts keep their closing balances', () => {
  const ds = fold([xero('2026-01', JAN), xero('2026-02', FEB)])
  assert.deepEqual(net(ds.actuals, '2026-01'), { '200': -40000, '310': 12000, '400': 5000, '477': 20000, '090': 50000, '960': -47000 }, 'the first month of the fiscal year is its year to date')
  assert.deepEqual(net(ds.actuals, '2026-02'), {
    '200': -45000, '310': 14000, '400': 17000, '477': 20000, '485': 1200.5, // February alone
    '090': 60000, '800': -17200.5, '960': -47000, // closing balances, not movements
  })
  assert.ok(ds.actuals.every(l => l.derived), 'derived lines are marked, so none can pass for a posted amount')
  assert.equal(ds.ytd!.length, JAN.length + FEB.length, 'the year-to-date source is kept as imported')
})

test('the derived month reaches the variance report as the month, not the year so far', () => {
  const ds = fold([xero('2026-01', JAN), xero('2026-02', FEB)])
  const config: Config = { reportingCurrency: 'USD', thresholds: { abs: 10000, pct: 0.1 }, basis: 'budget', entities: [], balanceSheet: ['090', '800', '960'],
    mapping: [{ account: '200', name: 'Sales', line: 'Product revenue', section: 'Revenue', kind: 'revenue' }, { account: '310', name: 'COGS', line: 'Materials', section: 'Cost of revenue', kind: 'expense' },
      { account: '400', name: 'Advertising', line: 'Sales & marketing', section: 'Operating expenses', kind: 'expense' }, { account: '477', name: 'Wages', line: 'People', section: 'Operating expenses', kind: 'expense' }, { account: '485', name: 'Software', line: 'Software & IT', section: 'Operating expenses', kind: 'expense' }] }
  const withBudget = { ...ds, budget: [{ entity: 'MAIN', period: '2026-02', account: '200', amount: 44000 }, { entity: 'MAIN', period: '2026-02', account: '400', amount: 5000 }] }
  const r = buildReport(withBudget, config, '2026-02')
  assert.equal(r.rows.find(x => x.account === '200')!.actual, 45000)
  assert.equal(r.rows.find(x => x.account === '400')!.vs.budget.amount, 12000)
  assert.equal(r.unmapped.length, 0)
})

test('the first fiscal month needs no predecessor and follows the fiscal year setting', () => {
  // Fiscal year starting in April: April is the first month, so March of the previous year is not subtracted.
  const mar: Row[] = [['200', 'Sales', 'Revenue', '', 900000], ['400', 'Advertising', 'Expense', 700000, '']]
  const apr: Row[] = [['200', 'Sales', 'Revenue', '', 70000], ['400', 'Advertising', 'Expense', 6000, '']]
  const may: Row[] = [['200', 'Sales', 'Revenue', '', 150000], ['400', 'Advertising', 'Expense', 13000, '']]
  const ds = fold([xero('2026-03', mar), xero('2026-04', apr), xero('2026-05', may)], 4)
  assert.deepEqual(net(ds.actuals, '2026-04'), { '200': -70000, '400': 6000 })
  assert.deepEqual(net(ds.actuals, '2026-05'), { '200': -80000, '400': 7000 })
  const st = applyYtd(ds, 4).status
  assert.deepEqual(st.map(s => [s.period, s.state]), [['2026-03', 'blocked'], ['2026-04', 'first'], ['2026-05', 'derived']], 'March is not the first month of this fiscal year and February is missing')
  assert.equal(st[0].needs, '2026-02')
  // The same files with a January start: April now needs March, May needs April.
  const jan = fold([xero('2026-03', mar), xero('2026-04', apr), xero('2026-05', may)], 1)
  assert.deepEqual(net(jan.actuals, '2026-04'), { '200': 830000, '400': -694000 }, 'a different setting gives different, never silent, months')
})

test('without a fiscal year start nothing is derived and the reason is stated', () => {
  const ds = addYtd(empty, xero('2026-02', FEB), undefined)
  assert.deepEqual(ds.ds.actuals, [])
  assert.equal(ds.status[0].state, 'needs-fiscal-year')
  assert.match(ds.status[0].message, /fiscal year starts/)
  for (const bad of [0, 13, 1.5, NaN]) assert.equal(deriveMonthly(xero('2026-02', FEB), bad).lines.length, 0, `fiscal start ${bad} is rejected`)
})

test('a missing prior month holds the month back with a clear message; a gap is never bridged', () => {
  const mar: Row[] = [['200', 'Sales', 'Revenue', '', 130000], ['400', 'Advertising', 'Expense', 30000, ''], ['090', 'Checking Account', 'Bank', 99000, '']]
  const ds = fold([xero('2026-01', JAN), xero('2026-03', mar)])
  assert.deepEqual(ds.actuals.filter(l => l.period === '2026-03'), [], 'no March figure at all, not even the balance sheet lines')
  const st = applyYtd(ds, 1).status.find(s => s.period === '2026-03')!
  assert.equal(st.state, 'blocked')
  assert.equal(st.needs, '2026-02')
  assert.match(st.message, /March 2026 is held back: the February 2026 year-to-date trial balance is missing/)
  // The missing month arrives later: both months appear, and March is relative to February, not January.
  const filled = addYtd(ds, xero('2026-02', FEB), 1).ds
  assert.deepEqual(net(filled.actuals, '2026-03')['200'], -45000)
  assert.deepEqual(filled.actuals.filter(l => l.period === '2026-03' && l.account === '200').map(l => l.credit), [45000])
})

test('a month after a gap is still derived from its own predecessor', () => {
  const mar: Row[] = [['200', 'Sales', 'Revenue', '', 130000]]
  const apr: Row[] = [['200', 'Sales', 'Revenue', '', 180000]]
  const ds = fold([xero('2026-03', mar), xero('2026-04', apr)])
  assert.deepEqual(applyYtd(ds, 1).status.map(s => [s.period, s.state]), [['2026-03', 'blocked'], ['2026-04', 'derived']])
  assert.deepEqual(net(ds.actuals, '2026-04'), { '200': -50000 })
  assert.equal(net(ds.actuals, '2026-03')['200'], undefined)
})

test('new accounts, disappeared accounts, credits and reversals', () => {
  const feb: Row[] = [
    ['200', 'Sales', 'Revenue', '', 90000], // revenue year to date dropped from 100000 to 90000: a net reversal in the month
    ['500', 'New Venture Costs', 'Expense', 3000, ''], // appears in February
    ['477', 'Wages and Salaries', 'Expense', '', 250], // a credit balance on an expense account
  ]
  const jan: Row[] = [
    ['200', 'Sales', 'Revenue', '', 100000],
    ['400', 'Advertising', 'Expense', 8000, ''], // gone from the February report (nil balance hides it)
    ['477', 'Wages and Salaries', 'Expense', 1000, ''],
  ]
  const ds = fold([xero('2026-01', jan), xero('2026-02', feb)])
  assert.deepEqual(net(ds.actuals, '2026-02'), { '200': 10000, '500': 3000, '400': -8000, '477': -1250 })
  assert.deepEqual(ds.actuals.find(l => l.period === '2026-02' && l.account === '200'), { entity: 'MAIN', period: '2026-02', account: '200', debit: 10000, credit: 0, derived: true }, 'less revenue than last month is a debit')
  const st = applyYtd(ds, 1).status.find(s => s.period === '2026-02')!
  assert.deepEqual(st.disappeared, ['400'])
  assert.deepEqual(st.appeared, ['500'])
  assert.match(st.message, /400 had a balance in January 2026 and none now, so the whole year-to-date amount reverses/)
})

test('derived months sum back to the year to date exactly, in cents', () => {
  let seed = 7
  const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647 }
  for (const fy of [1, 4, 7]) {
    const accounts = ['200', '310', '400', '477', '485']
    const periods = Array.from({ length: 12 }, (_, i) => { const m = ((fy - 1 + i) % 12) + 1, y = 2026 + (fy - 1 + i >= 12 ? 1 : 0); return `${y}-${String(m).padStart(2, '0')}` })
    const ytd: Record<string, number> = Object.fromEntries(accounts.map(a => [a, 0]))
    const files: Line[][] = []
    for (const p of periods) {
      const rows: Row[] = accounts.map(a => {
        ytd[a] = Math.round((ytd[a] + (rand() * 20000 - 3000)) * 100) / 100 // amounts with awkward cents
        return a === '200' ? [a, 'Sales', 'Revenue', ytd[a] < 0 ? -ytd[a] : '', ytd[a] > 0 ? ytd[a] : ''] : [a, `Account ${a}`, 'Expense', ytd[a] > 0 ? ytd[a] : '', ytd[a] < 0 ? -ytd[a] : '']
      })
      files.push(xero(p, rows))
    }
    const ds = fold(files, fy)
    const cents = (x: number) => Math.round(x * 100)
    for (const a of accounts) {
      const sum = ds.actuals.filter(l => l.account === a).reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0)
      const last = files[11].filter(l => l.account === a).reduce((s, l) => s + cents(l.debit) - cents(l.credit), 0)
      assert.equal(sum, last, `fiscal start ${fy}, account ${a}: months add up to the year to date`)
    }
    assert.ok(applyYtd(ds, fy).status.every(s => s.state === 'first' || s.state === 'derived'))
  }
})

test('re-imported and out-of-order months give the same result as importing in order', () => {
  const mar: Row[] = [['200', 'Sales', 'Revenue', '', 130000], ['400', 'Advertising', 'Expense', 30000, '']]
  const files = [xero('2026-01', JAN), xero('2026-02', FEB), xero('2026-03', mar)]
  const inOrder = fold(files)
  const key = (ds: Dataset) => JSON.stringify([...ds.actuals].sort((a, b) => (a.period + a.account).localeCompare(b.period + b.account)))
  for (const order of [[2, 0, 1], [1, 2, 0], [2, 1, 0], [0, 2, 1]]) assert.equal(key(fold(order.map(i => files[i]))), key(inOrder), `order ${order}`)

  // Replacing February with a corrected file recomputes February and March; January is untouched.
  const corrected = xero('2026-02', FEB.map(r => r[0] === '400' ? ['400', 'Advertising', 'Expense', 20000, ''] as Row : r))
  const re = addYtd(inOrder, corrected, 1).ds
  assert.equal(re.ytd!.filter(l => l.period === '2026-02').length, FEB.length, 'one set per month, not two')
  assert.equal(net(re.actuals, '2026-02')['400'], 15000)
  assert.equal(net(re.actuals, '2026-03')['400'], 10000, 'March follows the corrected February')
  assert.equal(net(re.actuals, '2026-01')['400'], 5000)
  assert.equal(addYtd(re, files[1], 1).ds.actuals.length, inOrder.actuals.length)
  assert.equal(key(addYtd(re, files[1], 1).ds), key(inOrder), 're-importing the original file restores the original months')
})

test('a fiscal year change recomputes from the kept year-to-date files', () => {
  const ds = fold([xero('2026-01', JAN), xero('2026-02', FEB)], 1)
  const moved = applyYtd(ds, 2)
  assert.deepEqual(applyYtd(moved.ds, 2).ds.actuals, moved.ds.actuals, 'recomputing is stable')
  assert.deepEqual(moved.status.map(s => [s.period, s.state]), [['2026-01', 'blocked'], ['2026-02', 'first']])
  assert.equal(net(moved.ds.actuals, '2026-02')['200'], -85000, 'with a February start, February is the first month')
  assert.deepEqual(applyYtd(moved.ds, 1).ds.actuals, ds.actuals, 'and back again')
})

test('entities are differenced separately', () => {
  const us = [xero('2026-01', [['200', 'Sales', 'Revenue', '', 10]], { entity: 'US' }), xero('2026-02', [['200', 'Sales', 'Revenue', '', 25]], { entity: 'US' })]
  const ca = [xero('2026-02', [['200', 'Sales', 'Revenue', '', 99]], { entity: 'CA' })]
  const ds = fold([...us, ...ca])
  assert.equal(net(ds.actuals, '2026-02', 'US')['200'], -15)
  assert.equal(net(ds.actuals, '2026-02', 'CA')['200'], undefined, 'CA has no January, so it is held back; US January is not borrowed')
  assert.deepEqual(applyYtd(ds, 1).status.map(s => [s.entity, s.period, s.state]), [['CA', '2026-02', 'blocked'], ['US', '2026-01', 'first'], ['US', '2026-02', 'derived']])
})

test('ledger rows and year-to-date files for the same entity and month: the later import wins, both ways', () => {
  const gl: Line[] = [{ entity: 'MAIN', period: '2026-02', account: '200', debit: 0, credit: 7, date: '2026-02-03', vendor: 'Pine Street Dental' }]
  const withGl: Dataset = { actuals: gl, budget: [] }
  // A year-to-date file replaces the ledger rows of its month.
  const a = addYtd(addYtd(withGl, xero('2026-01', JAN), 1).ds, xero('2026-02', FEB), 1).ds
  assert.ok(a.actuals.filter(l => l.period === '2026-02').every(l => l.derived))
  // A ledger import after the year-to-date files wins, and the status says so.
  const afterGl: Dataset = { ...a, actuals: [...a.actuals.filter(l => l.period !== '2026-02'), ...gl] }
  const r = applyYtd(afterGl, 1)
  assert.deepEqual(r.ds.actuals.filter(l => l.period === '2026-02'), gl)
  assert.equal(r.status.find(s => s.period === '2026-02')!.state, 'overridden')
})

test('non-year-to-date data is left exactly as it is', () => {
  const gl: Line[] = [{ entity: 'MAIN', period: '2026-02', account: '200', debit: 0, credit: 7 }, { entity: 'MAIN', period: '2026-02', account: '090', debit: 7, credit: 0 }]
  const ds: Dataset = { actuals: gl, budget: [], tb: gl }
  assert.equal(applyYtd(ds, undefined).ds, ds, 'same object back: nothing recomputed')
  assert.equal(applyYtd(ds, 1).ds, ds)
  assert.deepEqual(applyYtd(ds, 1).status, [])
  assert.equal(balanceChecks(gl)[0].ok, true)
  // Balance checks ignore derived months (their source is checked instead) and still check everything else.
  const ytdDs = fold([xero('2026-01', JAN), xero('2026-02', FEB)])
  assert.deepEqual(balanceChecks(ytdDs.actuals), [])
  assert.deepEqual(balanceChecks(ytdDs.ytd!).map(c => [c.period, c.ok]), [['2026-01', true], ['2026-02', true]])
  assert.equal(balanceChecks([{ ...gl[0], credit: 8 }, gl[1]])[0].ok, false)
})

test('the importer marks balance sheet accounts from the Account Type column', () => {
  const lines = xero('2026-02', FEB)
  assert.deepEqual(lines.filter(l => l.bs).map(l => l.account).sort(), ['090', '800', '960'])
  assert.ok(lines.filter(l => !l.bs).every(l => ['200', '310', '400', '477', '485'].includes(l.account)))
})

test('a year-to-date file that does not balance is reported on its source, not hidden by the derived months', () => {
  const off = FEB.map(r => r[0] === '090' ? ['090', 'Checking Account', 'Bank', 60001, ''] as Row : r)
  const ds = fold([xero('2026-01', JAN), xero('2026-02', off)])
  assert.deepEqual(balanceChecks(ds.ytd!).map(c => [c.period, c.ok, c.diff]), [['2026-01', true, 0], ['2026-02', false, 1]])
})

test('a wrongly set fiscal year start is flagged when most accounts shrink', () => {
  // The organisation's year starts in April, but the pack says January: April's year to date is smaller than March's.
  const mar: Row[] = [['200', 'Sales', 'Revenue', '', 900000], ['310', 'COGS', 'Direct Costs', 300000, ''], ['400', 'Advertising', 'Expense', 70000, ''], ['477', 'Wages', 'Expense', 400000, '']]
  const apr: Row[] = [['200', 'Sales', 'Revenue', '', 80000], ['310', 'COGS', 'Direct Costs', 25000, ''], ['400', 'Advertising', 'Expense', 6000, ''], ['477', 'Wages', 'Expense', 33000, '']]
  const wrong = applyYtd(fold([xero('2026-02', [['200', 'Sales', 'Revenue', '', 1]]), xero('2026-03', mar), xero('2026-04', apr)], 1), 1).status
  assert.equal(wrong.find(s => s.period === '2026-04')!.suspect, true)
  assert.match(wrong.find(s => s.period === '2026-04')!.message, /Check the fiscal year start: 4 of 4/)
  const right = applyYtd(fold([xero('2026-03', mar), xero('2026-04', apr)], 4), 4).status
  assert.equal(right.find(s => s.period === '2026-04')!.suspect, undefined)
  assert.equal(applyYtd(fold([xero('2026-01', JAN), xero('2026-02', FEB)]), 1).status.some(s => s.suspect), false, 'normal growth is not flagged')
})

test('a year-to-date file without an Account Type column says so', () => {
  const grid = parseCsv('Trial Balance\nAs at 28 February 2026\n\nAccount Code,Account,Debit - Year to date,Credit - Year to date\n200,Sales,,100\n090,Checking,100,\n')
  const p = parseRows(grid, detect(grid), { entity: 'MAIN' })
  assert.deepEqual(p.issues.map(i => i.level), ['warning', 'warning'])
  assert.match(p.issues[1].message, /no Account Type column/i)
})
