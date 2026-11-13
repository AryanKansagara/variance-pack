// Import pipeline: CSV text or sheet rows -> detected format -> column mapping -> typed rows + validation.
import type { BudgetRow, Line, MapRow, Section } from './types.ts'
import { isBalanceSheet, r2 } from './variance.ts'

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', q = false
  const delim = (text.split('\n', 1)[0].match(/\t/g)?.length ?? 0) > (text.split('\n', 1)[0].match(/,/g)?.length ?? 0) ? '\t' : ','
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows.map(r => r.map(c => c.trim()))
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows.map(r => r.map(v => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }).join(',')).join('\n') + '\n'
}

/** "$1,234.50", "(1,234.50)", "1234.5-", "" -> number, or null if it is not a number. */
export function num(s: string | undefined): number | null {
  if (s === undefined) return 0
  let t = s.replace(/[$€£\s]|CAD|USD/g, '').replace(/,/g, '')
  if (t === '' || t === '-' || t === '—') return 0
  let neg = false
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1) }
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1) }
  if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return neg ? -n : n
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Period (YYYY-MM) from a date or period label. */
export function toPeriod(s: string | undefined): string | null {
  if (!s) return null
  const t = s.trim().toLowerCase()
  let m = t.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?(?:[ t].*)?$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (m) {
    const a = +m[1], b = +m[2]
    const month = a > 12 ? b : a
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]
    return month >= 1 && month <= 12 ? `${y}-${String(month).padStart(2, '0')}` : null
  }
  m = t.match(/^(?:\d{1,2}[ -])?([a-z]{3})[a-z]*\.?[ \-']*(\d{2,4})$/)
  if (m && MONTHS.includes(m[1])) return `${m[2].length === 2 ? 2000 + +m[2] : m[2]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}`
  m = t.match(/^(\d{4})\s*p(?:eriod)?\s*(\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
  return null
}

/** "6100 Advertising", "6100 - Advertising", "Advertising (6100)", "6100" -> code and name. */
export function splitAccount(s: string): { code: string; name: string } {
  const t = s.trim()
  let m = t.match(/^([\w.-]*\d[\w.-]*)\s*[-–:·]?\s+(.+)$/)
  if (m) return { code: m[1], name: m[2].trim() }
  m = t.match(/^(.+?)\s*\(([\w.-]*\d[\w.-]*)\)$/)
  if (m) return { code: m[2], name: m[1].trim() }
  return { code: t, name: t }
}

// ---------- Detection ----------

export type Kind = 'actuals' | 'budget' | 'mapping'
export type Field = 'entity' | 'period' | 'date' | 'account' | 'accountName' | 'vendor' | 'dept' | 'memo' | 'debit' | 'credit' | 'amount' | 'units' | 'ref'
  | 'line' | 'section' | 'kind' | 'intercompany'

const SYN: Record<Field, RegExp> = {
  entity: /^(entity|subsidiary|company|location|class)$/,
  period: /^(period|accounting period|posting period|fiscal period|month)$/,
  date: /^(date|transaction date|txn date|posting date|gl date|trandate|journal date)$/,
  account: /^(account|account ?(no|number|#|code)|gl ?account|acct|account id|gl code|distribution account)$/,
  accountName: /^(account ?(name|title|description)|gl account name|description of account)$/,
  vendor: /^(name|vendor|vendor name|supplier|payee|contact|customer\/vendor|vendor \/ customer|entity name|vendor\/customer)$/,
  dept: /^(department|dept|cost cent(er|re)|division)$/,
  memo: /^(memo|memo\/description|description|line description|narration|reference description)$/,
  debit: /^(debit|debits|dr|debit amount|amount \(debit\)|debit \(usd\)|debit \(cad\)|ytd debit|debit - year to date|debit - ytd)$/,
  credit: /^(credit|credits|cr|credit amount|amount \(credit\)|credit \(usd\)|credit \(cad\)|ytd credit|credit - year to date|credit - ytd)$/,
  amount: /^(amount|net|net amount|balance|value|budget|forecast|net change|amount \(usd\))$/,
  units: /^(units|qty|quantity|volume|headcount|seats)$/,
  ref: /^(num|no\.?|document number|doc|ref|reference|journal|je|transaction id|source)$/,
  line: /^(line|p&l line|pl line|rollup|roll-up|report line|group|category|fs line)$/,
  section: /^(section|type|account type|statement section|class)$/,
  kind: /^(kind|nature|sign)$/,
  intercompany: /^(intercompany|ic|eliminate|elimination)$/,
}

export interface Detected {
  kind: Kind
  /** Human label for the source system format we recognised. */
  format: string
  headerRow: number
  headers: string[]
  columns: Partial<Record<Field, number>>
  /** Wide budgets: column index -> period. */
  monthColumns: Record<number, string>
  /** QuickBooks reports sign Amount by the account's normal balance, not debit-positive. */
  natural?: boolean
  /** Debit and credit columns are year-to-date (Xero's current Trial Balance). */
  ytd?: boolean
  /** Single month named in the report title ("As at 31 October 2025", "August 1-31, 2026"). */
  period?: string
}

const norm = (h: string) => h.toLowerCase().replace(/\s+/g, ' ').replace(/[_]/g, ' ').trim()

function guessColumns(headers: string[]): Partial<Record<Field, number>> {
  const out: Partial<Record<Field, number>> = {}
  headers.forEach((h, i) => {
    const n = norm(h)
    for (const f of Object.keys(SYN) as Field[]) if (out[f] === undefined && SYN[f].test(n)) { out[f] = i; break }
  })
  return out
}

/** The one month a report title covers, if it names exactly one. */
function titlePeriod(top: string[]): string | undefined {
  for (const t of top) {
    const s = t.trim().toLowerCase().replace(/,/g, '')
    let m = s.match(/^(?:as (?:at|of)|for the month ended|month ended|period ended?) (.+)$/)
    if (m) { const p = toPeriod(m[1]); if (p) return p }
    m = s.match(/^([a-z]+) \d{1,2}\s*[-–]\s*\d{1,2} (\d{4})$/)
    if (m) { const p = toPeriod(`${m[1]} ${m[2]}`); if (p) return p }
    if (/^[a-z]+ \d{4}$/.test(s)) { const p = toPeriod(s); if (p) return p }
  }
  return undefined
}

export function detect(rows: string[][]): Detected {
  let best = { i: 0, score: -1 }
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cols = guessColumns(rows[i])
    const months = rows[i].filter(c => toPeriod(c) && !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(c)).length
    const score = Object.keys(cols).length + Math.min(months, 3)
    if (score > best.score) best = { i, score }
  }
  const headers = rows[best.i] ?? []
  const columns = guessColumns(headers)
  // Xero: "Account Code" holds the code, the plain "Account" column the name.
  if (columns.account !== undefined && /code/i.test(headers[columns.account]) && columns.accountName === undefined) {
    const i = headers.findIndex(h => norm(h) === 'account')
    if (i >= 0) columns.accountName = i
  }
  const monthColumns: Record<number, string> = {}
  headers.forEach((h, i) => { const p = toPeriod(h); if (p && !Object.values(columns).includes(i)) monthColumns[i] = p })
  const top = rows.slice(0, best.i).flat().join(' ').toLowerCase()
  const hs = headers.map(norm).join('|')
  let kind: Kind = 'actuals'
  const hasDrCr = columns.debit !== undefined || columns.credit !== undefined
  if (columns.line !== undefined && columns.debit === undefined && Object.keys(monthColumns).length === 0) kind = 'mapping'
  // A trial balance with comparison-period columns still has debit and credit columns; it is not a wide budget.
  else if ((Object.keys(monthColumns).length >= 2 && !hasDrCr) || /\b(budget|forecast|plan)\b/.test(top + hs)) kind = 'budget'
  let format = 'Generic layout'
  let natural = false
  const qboReport = hs.includes('transaction type') && (hs.includes('split') || hs.includes('balance')) && !hasDrCr && columns.amount !== undefined
  if (/journal/.test(top) && hs.includes('transaction type')) format = 'QuickBooks Online: Journal report'
  else if (qboReport && /profit and loss detail|statement of activity detail/.test(top)) { format = 'QuickBooks Online: Profit and Loss Detail'; natural = true }
  else if (qboReport) { format = 'QuickBooks Online: General Ledger'; natural = true }
  else if (/trial balance/.test(top) && (/ytd debit|year to date/.test(hs) || hs.includes('account type'))) format = 'Xero: Trial Balance'
  else if (/account transactions|general ledger/.test(top) && hs.includes('source')) format = 'Xero: Account Transactions'
  else if (hs.includes('subsidiary') || hs.includes('posting period') || hs.includes('amount (debit)')) format = 'NetSuite: transaction saved search'
  else if (/intacct/.test(top) || hs.includes('account title') || hs.includes('gl date')) format = 'Sage Intacct: General Ledger'
  else if (/trial balance/.test(top)) format = 'Trial balance'
  if (kind === 'budget') format = Object.keys(monthColumns).length >= 2 ? 'Budget, one column per month' : 'Budget, one row per account and month'
  if (kind === 'mapping') format = 'Chart of accounts mapping'
  const ytd = /ytd|year to date/.test(norm(headers[columns.debit ?? -1] ?? '') + norm(headers[columns.credit ?? -1] ?? ''))
  const period = kind === 'actuals' ? titlePeriod(rows.slice(0, best.i).map(r => r.filter(Boolean).join(' '))) : undefined
  return { kind, format, headerRow: best.i, headers, columns, monthColumns, ...(natural ? { natural } : {}), ...(ytd ? { ytd } : {}), ...(period ? { period } : {}) }
}

// ---------- Typed parsing with a validation report ----------

export interface Issue { line: number; message: string; level: 'error' | 'warning' }

export interface Parsed {
  actuals: Line[]
  budget: BudgetRow[]
  mapping: MapRow[]
  issues: Issue[]
  skipped: number
  periods: string[]
  hasDetail: boolean
  /** Account names seen in the file, used to propose a mapping. */
  names: Record<string, string>
  /** Account type per account when the file carries one (Xero "Account Type", QuickBooks report sections). */
  types: Record<string, string>
}

export interface ParseOpts {
  /** Used when the file has no entity column. */
  entity: string
  /** Used when the file has neither a period nor a date column (a single-month trial balance). */
  period?: string
}

const get = (r: string[], i: number | undefined) => i === undefined ? undefined : r[i]

export function parseRows(rows: string[][], d: Detected, opts: ParseOpts): Parsed {
  const out: Parsed = { actuals: [], budget: [], mapping: [], issues: [], skipped: 0, periods: [], hasDetail: false, names: {}, types: {} }
  const c = d.columns
  const issue = (line: number, message: string, level: Issue['level'] = 'error') => { if (out.issues.length < 500) out.issues.push({ line, message, level }) }
  let groupAccount: string | null = null
  // QuickBooks report sections ("Income", "Expenses") tell us the normal balance of the accounts under them.
  let sectionType: 'Income' | 'Expense' | null = null
  if (d.ytd) issue(d.headerRow + 1, 'Debit and credit columns are year-to-date. P&L accounts will show the year so far, not the month; export the trial balance for a single month or use GL detail.', 'warning')
  for (let i = d.headerRow + 1; i < rows.length; i++) {
    const r = rows[i], ln = i + 1
    if (!r.some(x => x)) continue
    if (/^total\b|^net income|^grand total/i.test(r[0] ?? '') || /^total\b/i.test(get(r, c.account) ?? '')) { out.skipped++; continue }
    if (d.natural && /^(net (income|revenue|operating|other|ordinary)|gross profit)/i.test(r[0] ?? '')) { out.skipped++; continue }
    if (/^(beginning|opening) balance$/i.test(get(r, c.date) ?? '')) { out.skipped++; continue }

    if (d.kind === 'mapping') {
      const acct = get(r, c.account)
      if (!acct) { issue(ln, 'Missing account'); continue }
      const { code, name } = splitAccount(acct)
      const section = toSection(get(r, c.section) ?? '', code)
      const k = (get(r, c.kind) ?? '').toLowerCase()
      out.mapping.push({
        account: code, name: get(r, c.accountName) || name, line: get(r, c.line) || name, section,
        kind: /rev|income|credit|cr/.test(k) ? 'revenue' : /exp|cost|debit|dr/.test(k) ? 'expense' : section === 'Revenue' ? 'revenue' : 'expense',
        intercompany: /^(y|yes|true|1|x)$/i.test(get(r, c.intercompany) ?? ''),
      })
      continue
    }

    // Grouped exports (Xero Account Transactions, QBO General Ledger) put the account in a header row.
    const acctCell = get(r, c.account)
    const amounts = [c.debit, c.credit, c.amount].filter(x => x !== undefined).map(x => r[x!]).filter(Boolean)
    if (!acctCell && r.filter(Boolean).length === 1 && !amounts.length) {
      groupAccount = r.find(Boolean)!
      if (!d.format.includes('Profit and Loss Detail')) continue
      if (/^(income|revenue|other income|other revenue)$/i.test(groupAccount)) sectionType = 'Income'
      else if (/^(expenses?|expenditures|other expenses?|other expenditures|cost of (goods sold|sales|revenue))$/i.test(groupAccount)) sectionType = 'Expense'
      continue
    }
    const rawAcct = acctCell || groupAccount
    if (!rawAcct) { issue(ln, 'No account on this row'); continue }
    const { code, name } = splitAccount(rawAcct)
    const entity = get(r, c.entity) || opts.entity

    if (d.kind === 'budget') {
      const wide = Object.entries(d.monthColumns)
      if (wide.length) {
        for (const [col, period] of wide) {
          const v = num(r[+col])
          if (v === null) { issue(ln, `"${r[+col]}" in ${d.headers[+col]} is not a number`); continue }
          if (v !== 0) out.budget.push({ entity, period, account: code, amount: r2(v) })
        }
      } else {
        const period = toPeriod(get(r, c.period)) ?? toPeriod(get(r, c.date)) ?? opts.period
        const v = num(get(r, c.amount) ?? get(r, c.debit))
        if (!period) { issue(ln, 'No period or date'); continue }
        if (v === null) { issue(ln, `"${get(r, c.amount)}" is not a number`); continue }
        const units = c.units !== undefined ? num(r[c.units]) ?? undefined : undefined
        out.budget.push({ entity, period, account: code, amount: r2(v), ...(units ? { units } : {}) })
      }
      if (name !== code) out.names[code] = name
      continue
    }

    let debit = 0, credit = 0
    if (c.debit !== undefined || c.credit !== undefined) {
      const dv = num(get(r, c.debit)), cv = num(get(r, c.credit))
      if (dv === null || cv === null) { issue(ln, `Amount "${dv === null ? get(r, c.debit) : get(r, c.credit)}" is not a number`); continue }
      debit = dv; credit = cv
      if (debit < 0) { credit -= debit; debit = 0 }
      if (credit < 0) { debit -= credit; credit = 0 }
    } else if (c.amount !== undefined) {
      const v = num(get(r, c.amount))
      if (v === null) { issue(ln, `Amount "${get(r, c.amount)}" is not a number`); continue }
      const flip = d.natural && creditNormal(code, name, sectionType)
      if ((v >= 0) !== flip) debit = Math.abs(v); else credit = Math.abs(v)
    } else { issue(ln, 'No debit, credit or amount column'); continue }
    if (!debit && !credit) { out.skipped++; continue }
    const period = toPeriod(get(r, c.period)) ?? toPeriod(get(r, c.date)) ?? opts.period ?? d.period
    if (!period) { issue(ln, get(r, c.date) ? `Could not read the date "${get(r, c.date)}"` : 'No period or date, and no default period chosen'); continue }
    const type = get(r, c.section) || (d.natural && !/^\d/.test(code) ? sectionType : null)
    if (type) out.types[code] = type
    const vendor = get(r, c.vendor) || undefined, dept = get(r, c.dept) || undefined, memo = get(r, c.memo) || undefined
    if (vendor || memo || c.date !== undefined) out.hasDetail = true
    const units = c.units !== undefined ? num(r[c.units]) ?? undefined : undefined
    const nameCell = get(r, c.accountName)
    out.actuals.push({
      entity, period, account: code, debit: r2(debit), credit: r2(credit),
      ...(vendor ? { vendor } : {}), ...(dept ? { dept } : {}), ...(memo ? { memo } : {}),
      ...(get(r, c.date) ? { date: get(r, c.date) } : {}), ...(units ? { units } : {}), ...(get(r, c.ref) ? { ref: get(r, c.ref) } : {}),
    })
    if (nameCell || name !== code) out.names[code] = nameCell || name
  }
  out.periods = [...new Set([...out.actuals.map(l => l.period), ...out.budget.map(b => b.period)])].sort()
  return out
}

const CREDIT_NAME = /\b(income|revenue|sales|payable|liabilit(y|ies)|equity|capital|retained earnings|loans?|deferred|accrued|unearned|credit card|line of credit|accumulated|contributions?)\b/i
const DEBIT_NAME = /\b(expenses?|cost of|cogs|receivable|prepaid|draws?|distributions?|discounts? given|refunds?)\b/i

/** Whether an account normally carries a credit balance, from its code (2-4xxx), name, or report section. */
export function creditNormal(code: string, name: string, section: 'Income' | 'Expense' | null = null): boolean {
  if (/^\d/.test(code)) return /^[234]/.test(code)
  if (DEBIT_NAME.test(name)) return false
  if (CREDIT_NAME.test(name)) return true
  return section === 'Income'
}

const BS_TYPE = /bank|asset|liabilit|equity|receivable|payable|inventory|prepayment|credit card|current|fixed|non-current|retained/i
const BS_NAME = /\b(checking|savings|bank|cash|petty cash|receivable|payable|inventory|prepaid|deposits?|loans?|credit card|equity|retained earnings|accumulated|undeposited|liabilit(y|ies)|opening balance)\b/i

/** Balance-sheet account, from the type column when there is one, else the code (1-3xxx) or, for unnumbered accounts, the name. */
export function isBalanceSheetAccount(code: string, name = '', type?: string): boolean {
  if (type) return BS_TYPE.test(type) && !/expense|income|revenue/i.test(type)
  if (/^\d/.test(code)) return isBalanceSheet(code)
  const n = name || code
  return BS_NAME.test(n) && !/\b(fees?|charges?|expenses?|interest|commissions?|income|revenue)\b/i.test(n)
}

function sectionFromType(type: string): Section | null {
  const t = type.toLowerCase()
  if (/other income/.test(t)) return 'Other income and expense'
  if (/^(revenue|sales|income)$/.test(t)) return 'Revenue'
  if (/direct cost|cost of/.test(t)) return 'Cost of revenue'
  if (/expense|overhead|depreciation/.test(t)) return 'Operating expenses'
  return null
}

function toSection(s: string, code: string): Section {
  const t = s.toLowerCase()
  if (/rev|sales|income$/.test(t) && !/other/.test(t)) return 'Revenue'
  if (/cogs|cost of (rev|sales|goods)|direct/.test(t)) return 'Cost of revenue'
  if (/other|interest|fx|tax/.test(t)) return 'Other income and expense'
  if (/opex|operating|expense|sg&a|g&a/.test(t)) return 'Operating expenses'
  return sectionFromCode(code)
}

function sectionFromCode(code: string): Section {
  const d = code.trim()[0]
  if (d === '4') return 'Revenue'
  if (d === '5') return 'Cost of revenue'
  if (d === '8' || d === '9') return 'Other income and expense'
  return 'Operating expenses'
}

const LINE_HINTS: [RegExp, string][] = [
  [/subscription|saas|recurring|license/i, 'Subscription revenue'], [/service|implementation|professional/i, 'Services revenue'],
  [/product sales|sales|revenue/i, 'Product revenue'], [/hosting|aws|cloud|infrastructure/i, 'Hosting'], [/freight|shipping/i, 'Freight'],
  [/material|inventory|cogs|cost of goods|purchases/i, 'Materials'], [/advert|marketing|media|campaign|events|sponsor/i, 'Sales & marketing'],
  [/commission|sales/i, 'Sales & marketing'], [/salar|wage|payroll|benefit|bonus|tax.*payroll|contractor/i, 'People'],
  [/rent|lease|office|utilit|facilit/i, 'Facilities'], [/software|subscriptions|tools|\bit\b/i, 'Software & IT'],
  [/travel|meal|entertain/i, 'Travel & entertainment'], [/legal|audit|accounting|professional fee|consult/i, 'Professional fees'],
  [/depreci|amorti/i, 'Depreciation'], [/interest|bank|fx|exchange|other/i, 'Other'], [/intercompany|management fee/i, 'Intercompany'],
]

/** Propose a mapping for accounts the user has not mapped yet. Balance-sheet accounts are left out. */
export function proposeMapping(accounts: { code: string; name: string; type?: string }[], existing: MapRow[]): MapRow[] {
  const have = new Set(existing.map(m => m.account))
  return accounts.filter(a => !have.has(a.code) && !isBalanceSheetAccount(a.code, a.name, a.type)).map(a => {
    const section = (a.type && sectionFromType(a.type)) || (/^\d/.test(a.code) ? sectionFromCode(a.code) : creditNormal(a.code, a.name) ? 'Revenue' : 'Operating expenses')
    const ic = /intercompany|inter-company|\bic\b/i.test(a.name)
    const line = ic ? 'Intercompany' : LINE_HINTS.find(([re, l]) => re.test(a.name) && (section === 'Revenue') === /revenue$/.test(l))?.[1] ?? (section === 'Revenue' ? 'Product revenue' : section === 'Cost of revenue' ? 'Cost of revenue' : 'Other operating')
    return { account: a.code, name: a.name, line, section, kind: section === 'Revenue' || (section === 'Other income and expense' && /income|gain/i.test(`${a.name} ${a.type ?? ''}`)) ? 'revenue' : 'expense', ...(ic ? { intercompany: true } : {}) }
  })
}

// ---------- Ledger checks ----------

export interface BalanceCheck { entity: string; period: string; debit: number; credit: number; diff: number; ok: boolean; pnlOnly: boolean }

/** Debits must equal credits per entity and period. A P&L-only extract will not balance, and says so. */
export function balanceChecks(lines: Line[]): BalanceCheck[] {
  const m = new Map<string, BalanceCheck>()
  for (const l of lines) {
    const k = `${l.entity}|${l.period}`
    const e = m.get(k) ?? { entity: l.entity, period: l.period, debit: 0, credit: 0, diff: 0, ok: true, pnlOnly: true }
    e.debit += l.debit; e.credit += l.credit
    if (isBalanceSheetAccount(l.account)) e.pnlOnly = false
    m.set(k, e)
  }
  return [...m.values()].map(e => ({ ...e, debit: r2(e.debit), credit: r2(e.credit), diff: r2(e.debit - e.credit), ok: Math.abs(e.debit - e.credit) < 0.01 })).sort((a, b) => a.period.localeCompare(b.period) || a.entity.localeCompare(b.entity))
}

export interface TieOut { entity: string; period: string; account: string; ledger: number; tb: number; diff: number }

/** Compare a trial balance against the GL detail it should summarise. Returns only the accounts that do not tie. */
export function tieOut(gl: Line[], tb: Line[]): TieOut[] {
  const sum = (ls: Line[]) => {
    const m = new Map<string, number>()
    for (const l of ls) { const k = `${l.entity}|${l.period}|${l.account}`; m.set(k, (m.get(k) ?? 0) + l.debit - l.credit) }
    return m
  }
  const a = sum(gl), b = sum(tb)
  const tbPeriods = new Set(tb.map(l => `${l.entity}|${l.period}`))
  const out: TieOut[] = []
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const [entity, period, account] = k.split('|')
    if (!tbPeriods.has(`${entity}|${period}`)) continue
    const diff = r2((a.get(k) ?? 0) - (b.get(k) ?? 0))
    if (Math.abs(diff) >= 0.01) out.push({ entity, period, account, ledger: r2(a.get(k) ?? 0), tb: r2(b.get(k) ?? 0), diff })
  }
  return out.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
}
