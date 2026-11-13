// Fixtures below are short excerpts written to match the exact layout of real exports
// (QuickBooks Online General Ledger and Profit and Loss Detail CSV, Xero Trial Balance CSV).
// Company, customer and vendor names are made up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { creditNormal, detect, isBalanceSheetAccount, parseCsv, parseRows, proposeMapping, balanceChecks } from './parse.ts'
import { buildReport } from './variance.ts'
import type { Line } from './types.ts'

const load = (csv: string) => { const rows = parseCsv(csv); const d = detect(rows); return { d, p: parseRows(rows, d, { entity: 'MAIN' }) } }
const net = (ls: Line[]) => { const m: Record<string, number> = {}; for (const l of ls) m[l.account] = Math.round(((m[l.account] ?? 0) + l.debit - l.credit) * 100) / 100; return m }

const QBO_GL = `Harbor Row Studio LLC
General Ledger
"August 1-31, 2026"
,Date,Transaction Type,Num,Name,Memo/Description,Split,Amount,Balance
Operating Checking
,Beginning Balance,,,,,,,"21,950.40"
,08/03/2026,Payment,,Pine Street Dental,,Accounts Receivable (A/R),"3,600.00","25,550.40"
,08/05/2026,Expense,,,Monthly service fee,Bank Fees,-12.00,"25,538.40"
,08/12/2026,Bill Payment (Check),2051,Northwind Software,,Accounts Payable (A/P),-724.88,"24,813.52"
Total for Operating Checking,,,,,,,"$2,863.12",
Service Revenue
,Beginning Balance,,,,,,,"37,322.11"
,08/04/2026,Invoice,1041,Alder Clinic,Website refresh,Accounts Receivable (A/R),"2,400.00","39,722.11"
,08/21/2026,Invoice,1040,Pine Street Dental,Brand workshop,Accounts Receivable (A/R),"1,950.00","41,672.11"
Total for Service Revenue,,,,,,,"$4,350.00",
Bank Fees
,Beginning Balance,,,,,,,112.00
,08/05/2026,Expense,,,Monthly service fee,Operating Checking,12.00,124.00
Total for Bank Fees,,,,,,,$12.00,
TOTAL,,,,,,,"$7,225.12",

"Accrual Basis Wednesday, September 2, 2026 09:12 AM GMT-04:00"
`

test('QuickBooks General Ledger: natural-sign amounts become debits and credits, title gives the month', () => {
  const { d, p } = load(QBO_GL)
  assert.equal(d.format, 'QuickBooks Online: General Ledger')
  assert.equal(d.natural, true)
  assert.equal(d.period, '2026-08')
  assert.deepEqual(p.issues, [], 'beginning balances, totals and the footer are not errors')
  // Each account nets to its "Total for" line, with credit-normal revenue as a credit.
  assert.deepEqual(net(p.actuals), { 'Operating Checking': 2863.12, 'Service Revenue': -4350, 'Bank Fees': 12 })
  assert.equal(p.actuals.find(l => l.memo === 'Brand workshop')?.vendor, 'Pine Street Dental')
  const map = proposeMapping(Object.keys(net(p.actuals)).map(code => ({ code, name: code, type: p.types[code] })), [])
  assert.deepEqual(map.map(m => [m.account, m.section]), [['Service Revenue', 'Revenue'], ['Bank Fees', 'Operating expenses']], 'the bank account is not proposed as a P&L line')
})

const QBO_GL_NEW = `General Ledger,,,,,,,,,,
Lakeside Mobile Detailing,,,,,,,,,,
"January-December, 2025",,,,,,,,,,
,,,,,,,,,,
,Distribution account,Transaction date,Transaction type,Num,Name,Memo/Description,Split account,Amount,Balance,Adj
Accounts Receivable (A/R),,,,,,,,,,
,Accounts Receivable (A/R),01/01/2025,Invoice,1012,Fleetwise Rentals,,,"1,311.81","1,311.81",No
,Accounts Receivable (A/R),01/02/2025,Payment,,Fleetwise Rentals,,Main Checking *7940,-100.00,"1,211.81",No
Total for Accounts Receivable (A/R),,,,,,,,"$1,211.81",,
Sales,,,,,,,,,,
,Sales,01/01/2025,Invoice,1012,Fleetwise Rentals,,Accounts Receivable (A/R),"1,311.81","1,311.81",No
,Sales,02/03/2025,Sales Receipt,1013,Walk-in,,Main Checking *7940,250.00,"1,561.81",No
Total for Sales,,,,,,,,"$1,561.81",,
Main Checking *7940,,,,,,,,,,
,Main Checking *7940,01/02/2025,Payment,,Fleetwise Rentals,,Accounts Receivable (A/R),100.00,100.00,No
,Main Checking *7940,02/03/2025,Sales Receipt,1013,Walk-in,,Sales,250.00,350.00,No
Total for Main Checking *7940,,,,,,,,$350.00,,
,,,,,,,,,,
"Accrual Basis Friday, April 18, 2025 04:26 AM GMTZ",,,,,,,,,,
`

test('QuickBooks General Ledger, current layout with a Distribution account column', () => {
  const { d, p } = load(QBO_GL_NEW)
  assert.equal(d.format, 'QuickBooks Online: General Ledger')
  assert.equal(d.period, undefined, 'a full-year report does not imply one month')
  assert.deepEqual(p.issues, [])
  assert.deepEqual(p.periods, ['2025-01', '2025-02'])
  assert.deepEqual(net(p.actuals), { 'Accounts Receivable (A/R)': 1211.81, Sales: -1561.81, 'Main Checking *7940': 350 })
  // Double entry inside the extract balances once every side of the postings is present.
  assert.ok(balanceChecks(p.actuals).every(c => c.ok))
  const map = proposeMapping(Object.keys(net(p.actuals)).map(code => ({ code, name: code })), [])
  assert.deepEqual(map.map(m => m.account), ['Sales'], 'receivable and checking accounts stay off the P&L even with digits in the name')
})

const QBO_PL_DETAIL = `Springfield Makers,,,,,,,,
Profit and Loss Detail,,,,,,,,
January - December 2019,,,,,,,,
,,,,,,,,
,Date,Transaction Type,Num,Name,Memo/Description,Split,Amount,Balance
Ordinary Income/Expenses,,,,,,,,
   Income,,,,,,,,
      Memberships,,,,,,,,
,09/18/2019,Invoice,1005,Gearbox Labs,"Founding member.
Second line of the memo",Accounts Receivable (A/R),25.00   ,25.00
,09/28/2019,Invoice,1024,Ada Park,Founding member,Accounts Receivable (A/R),50.00   ,75.00
      Total for Memberships,,,,,,,$75.00   ,
      Sponsorships,,,,,,,,
,10/01/2019,Invoice,1030,Gearbox Labs,Gold sponsor,Accounts Receivable (A/R),"1,000.00   ","1,000.00   "
      Total for Sponsorships,,,,,,,"$1,000.00   ",
   Total for Income,,,,,,,"$1,075.00   ",
   Expenses,,,,,,,,
      Taxes & Licenses,,,,,,,,
,10/02/2019,Expense,,Secretary of State,Annual report,Checking,10.50   ,10.50
      Total for Taxes & Licenses,,,,,,,$10.50   ,
      Payment Fees (Intuit),,,,,,,,
,10/03/2019,Expense,,Intuit,Card fees,Checking,30.00   ,30.00
      Total for Payment Fees (Intuit),,,,,,,$30.00   ,
   Total for Expenses,,,,,,,$40.50   ,
Net Ordinary Income,,,,,,,"$1,034.50   ",
Net Income,,,,,,,"$1,034.50   ",
`

test('QuickBooks Profit and Loss Detail: nested sections set the sign, multi-line memos and net lines handled', () => {
  const { d, p } = load(QBO_PL_DETAIL)
  assert.equal(d.format, 'QuickBooks Online: Profit and Loss Detail')
  assert.deepEqual(p.issues, [])
  assert.deepEqual(net(p.actuals), { Memberships: -75, Sponsorships: -1000, 'Taxes & Licenses': 10.5, 'Payment Fees (Intuit)': 30 })
  assert.equal(p.actuals[0].memo, 'Founding member.\nSecond line of the memo')
  assert.equal(p.types.Sponsorships, 'Income')
  const map = proposeMapping(Object.keys(net(p.actuals)).map(code => ({ code, name: code, type: p.types[code] })), [])
  const line = (a: string) => map.find(m => m.account === a)!
  assert.equal(line('Sponsorships').section, 'Revenue')
  assert.equal(line('Sponsorships').line, 'Product revenue', 'a revenue account never lands on an expense line')
  assert.equal(line('Taxes & Licenses').line, 'Other operating', 'an expense never lands on a revenue line')
  assert.notEqual(line('Payment Fees (Intuit)').line, 'Software & IT', '"Intuit" is not "IT"')
})

const XERO_TB = `Trial Balance,,,,,
Demo Company (US),,,,,
As at 31 October 2025,,,,,
,,,,,
Account Code,Account,Account Type,Debit - Year to date,Credit - Year to date,31 Dec 2024
200,Sales,Revenue,,"28,793.18","(2,746.02)"
310,Cost of Goods Sold,Direct Costs,"2,340.00",,0.00
400,Advertising,Expense,"10,453.75",,0.00
477,Wages and Salaries,Expense,"17,885.00",,0.00
090,Checking Account,Bank,"5,092.83",,"6,109.98"
610,Accounts Receivable,Current Asset,"9,172.63",,500.00
800,Accounts Payable,Current Liability,,"10,768.63",(476.79)
960,Retained Earnings,Equity,,"5,382.40",0.00
Total,,,"44,944.21","44,944.21",0.00
`

test('Xero Trial Balance: YTD columns read with a warning, month from "As at", types drive the mapping', () => {
  const { d, p } = load(XERO_TB)
  assert.equal(d.format, 'Xero: Trial Balance')
  assert.equal(d.kind, 'actuals', 'the comparison column does not turn it into a budget')
  assert.equal(d.period, '2025-10')
  assert.equal(d.ytd, true)
  assert.deepEqual(p.issues.map(i => i.level), ['warning'])
  assert.equal(p.actuals.length, 8)
  assert.ok(balanceChecks(p.actuals)[0].ok)
  assert.equal(p.names['200'], 'Sales')
  const map = proposeMapping(p.actuals.map(l => ({ code: l.account, name: p.names[l.account], type: p.types[l.account] })), [])
  assert.deepEqual(map.map(m => [m.account, m.section, m.kind]), [
    ['200', 'Revenue', 'revenue'], ['310', 'Cost of revenue', 'expense'], ['400', 'Operating expenses', 'expense'], ['477', 'Operating expenses', 'expense'],
  ], 'Xero bank, receivable, payable and equity accounts are excluded by type, not by code range')
})

test('a trial balance with several comparison months stays actuals; "plan" only counts as a whole word', () => {
  const tb = 'Trial Balance\nAs at 30 June 2026\n\nAccount Code,Account,Account Type,Debit,Credit,May 2026,April 2026\n200,Sales,Revenue,,100,90,80\n090,Bank,Bank,100,,90,80\n'
  assert.equal(detect(parseCsv(tb)).kind, 'actuals')
  const gl = 'Date,Account,Explanation,Debit,Credit\n2026-06-03,6100 Advertising,Spring campaign,500,\n'
  assert.equal(detect(parseCsv(gl)).kind, 'actuals')
})

test('normal-balance and balance-sheet heuristics', () => {
  assert.equal(creditNormal('4000', 'Anything'), true)
  assert.equal(creditNormal('6100', 'Sales commissions'), false, 'code wins over name')
  assert.equal(creditNormal('Cost of sales', 'Cost of sales'), false)
  assert.equal(creditNormal('Sales tax payable', 'Sales tax payable'), true)
  assert.equal(creditNormal('Accumulated depreciation', 'Accumulated depreciation'), true)
  assert.equal(creditNormal('Memberships', 'Memberships', 'Income'), true)
  assert.equal(isBalanceSheetAccount('800', 'Accounts Payable', 'Current Liability'), true)
  assert.equal(isBalanceSheetAccount('090', 'Checking', 'Bank'), true)
  assert.equal(isBalanceSheetAccount('477', 'Wages', 'Expense'), false)
  assert.equal(isBalanceSheetAccount('1200', 'Receivables'), true)
  assert.equal(isBalanceSheetAccount('Undeposited Funds', 'Undeposited Funds'), true)
  assert.equal(isBalanceSheetAccount('Office Supplies', 'Office Supplies'), false)
})

test('accounts an import marked as balance sheet are not reported as unmapped', () => {
  const ds = { actuals: [{ entity: 'A', period: '2026-10', account: '090', debit: 100, credit: 0 }, { entity: 'A', period: '2026-10', account: '477', debit: 0, credit: 100 }], budget: [] }
  const base = { reportingCurrency: 'USD', thresholds: { abs: 1, pct: 0.1 }, basis: 'budget' as const, entities: [], mapping: [] }
  assert.deepEqual(buildReport(ds, base, '2026-10').unmapped.map(u => u.account), ['090', '477'])
  assert.deepEqual(buildReport(ds, { ...base, balanceSheet: ['090'] }, '2026-10').unmapped.map(u => u.account), ['477'])
})
