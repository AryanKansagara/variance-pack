// Year-to-date trial balances (Xero's current Trial Balance) -> monthly actuals.
//
// Xero's Trial Balance shows balance sheet accounts at their closing balance and revenue and expense
// accounts from the first day of the financial year to the report date. A month is therefore the
// difference between two successive year-to-date reports of the same financial year. The first month of
// a fiscal year needs no predecessor. Everything is computed in whole cents.
//
// Sources: Xero Central, "Trial Balance report" (revenue and expense accounts count from the first day of
// the financial year; accounts with nil balances are hidden by default, so an account missing from a
// report is a zero balance) and https://reportpost.app/reports/xero-trial-balance-report summarising it.
import type { Dataset, Line } from './types.ts'
import { shift } from './variance.ts'

export type YtdState =
  /** First month of the fiscal year: the year to date is the month. */
  | 'first'
  /** Month = this year to date minus the previous month's. */
  | 'derived'
  /** The previous month's year-to-date trial balance is missing, so there is no monthly figure yet. */
  | 'blocked'
  /** The fiscal year start is not set, so no month can be told apart from a year to date. */
  | 'needs-fiscal-year'
  /** A later ledger import for this entity and month took precedence over the derived figures. */
  | 'overridden'

export interface YtdStatus {
  entity: string
  period: string
  state: YtdState
  /** Month that has to be imported for a blocked month. */
  needs?: string
  /** Accounts in the previous report with no balance in this one: their whole year to date reverses. */
  disappeared: string[]
  /** Accounts with no balance in the previous report. */
  appeared: string[]
  /** Most P&L accounts have a smaller year to date than last month, which is what a wrongly set fiscal year start looks like. */
  suspect?: boolean
  message: string
}

const cents = (n: number) => Math.round(n * 100)
export const monthLabel = (p: string) => new Date(p + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const monthNo = (p: string) => Number(p.slice(5, 7))

export const isFiscalMonth = (fy: unknown): fy is number => typeof fy === 'number' && Number.isInteger(fy) && fy >= 1 && fy <= 12
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Net debit (positive) or credit (negative) in cents per account, one set per entity and as-at month. */
function nets(ytd: Line[]) {
  const m = new Map<string, Map<string, { net: number; bs: boolean }>>()
  for (const l of ytd) {
    const key = `${l.entity}|${l.period}`
    const accounts = m.get(key) ?? new Map()
    const cur = accounts.get(l.account) ?? { net: 0, bs: false }
    cur.net += cents(l.debit) - cents(l.credit)
    cur.bs = cur.bs || !!l.bs
    accounts.set(l.account, cur)
    m.set(key, accounts)
  }
  return m
}

const toLine = (entity: string, period: string, account: string, net: number): Line =>
  ({ entity, period, account, debit: net > 0 ? net / 100 : 0, credit: net < 0 ? -net / 100 : 0, derived: true })

export interface Derived { lines: Line[]; status: YtdStatus[] }

/** Monthly lines for every as-at month that can be derived, and a status for every as-at month in `ytd`. */
export function deriveMonthly(ytd: Line[], fiscalYearStart: number | undefined): Derived {
  const lines: Line[] = []
  const status: YtdStatus[] = []
  const byKey = nets(ytd)
  const keys = [...byKey.keys()].map(k => { const i = k.lastIndexOf('|'); return { entity: k.slice(0, i), period: k.slice(i + 1) } })
    .sort((a, b) => a.entity.localeCompare(b.entity) || a.period.localeCompare(b.period))
  for (const { entity, period } of keys) {
    const base: YtdStatus = { entity, period, state: 'derived', disappeared: [], appeared: [], message: '' }
    if (!isFiscalMonth(fiscalYearStart)) {
      status.push({ ...base, state: 'needs-fiscal-year', message: `${monthLabel(period)}: set the month your fiscal year starts in. Without it a year to date cannot be told apart from a month, so nothing is derived.` })
      continue
    }
    const cur = byKey.get(`${entity}|${period}`)!
    const first = monthNo(period) === fiscalYearStart
    const prevPeriod = shift(period, -1)
    const prev = first ? new Map<string, { net: number; bs: boolean }>() : byKey.get(`${entity}|${prevPeriod}`)
    if (!prev) {
      status.push({ ...base, state: 'blocked', needs: prevPeriod, message: `${monthLabel(period)} is held back: the ${monthLabel(prevPeriod)} year-to-date trial balance is missing, and a month cannot be told from a year to date without it. Import ${monthLabel(prevPeriod)} to get ${monthLabel(period)}.` })
      continue
    }
    const out: Line[] = []
    const disappeared: string[] = [], appeared: string[] = []
    let seen = 0, shrank = 0
    for (const account of new Set([...cur.keys(), ...prev.keys()])) {
      const c = cur.get(account), p = prev.get(account)
      const bs = (c ?? p)!.bs
      if (bs) {
        if (c && c.net !== 0) out.push(toLine(entity, period, account, c.net)) // balance sheet: closing balance, as reported
        continue
      }
      const net = (c?.net ?? 0) - (p?.net ?? 0)
      if (!first && p && p.net !== 0) { seen++; if (Math.sign(c?.net ?? 0) === Math.sign(p.net) ? Math.abs(c!.net) < Math.abs(p.net) : !c) shrank++ }
      if (!first && !c && p && p.net !== 0) disappeared.push(account)
      if (!first && c && c.net !== 0 && !p) appeared.push(account)
      if (net !== 0) out.push(toLine(entity, period, account, net))
    }
    lines.push(...out)
    const suspect = !first && seen >= 3 && shrank / seen > 0.5
    status.push({
      ...base, state: first ? 'first' : 'derived', disappeared: disappeared.sort(), appeared: appeared.sort(), ...(suspect ? { suspect } : {}),
      message: first
        ? `${monthLabel(period)} is the first month of the fiscal year, so its year to date is the month.`
        : `${monthLabel(period)} = year to date as at ${monthLabel(period)} minus year to date as at ${monthLabel(prevPeriod)}.` +
          (disappeared.length ? ` ${disappeared.join(', ')} had a balance in ${monthLabel(prevPeriod)} and none now, so the whole year-to-date amount reverses in ${monthLabel(period)}.` : '') +
          (suspect ? ` Check the fiscal year start: ${shrank} of ${seen} revenue and expense accounts have a smaller year to date than in ${monthLabel(prevPeriod)}, which is what a year that started in ${monthLabel(period)} would look like.` : ''),
    })
  }
  return { lines, status }
}

/**
 * The dataset with its derived months recomputed from `ds.ytd`. Months for which a later ledger import
 * (non-derived lines for the same entity and month) exists keep that import.
 */
export function applyYtd(ds: Dataset, fiscalYearStart: number | undefined): { ds: Dataset; status: YtdStatus[] } {
  const own = ds.actuals.filter(l => !l.derived)
  if (!ds.ytd?.length) return { ds: own.length === ds.actuals.length ? ds : { ...ds, actuals: own }, status: [] }
  const taken = new Set(own.map(l => `${l.entity}|${l.period}`))
  const { lines, status } = deriveMonthly(ds.ytd, fiscalYearStart)
  const kept = lines.filter(l => !taken.has(`${l.entity}|${l.period}`))
  const final = status.map(s => taken.has(`${s.entity}|${s.period}`) && (s.state === 'first' || s.state === 'derived')
    ? { ...s, state: 'overridden' as const, message: `${monthLabel(s.period)}: a ledger import for this month is in use, so the year-to-date file does not change it.` }
    : s)
  return { ds: { ...ds, actuals: [...own, ...kept] }, status: final }
}

/**
 * Add year-to-date trial balance lines (one as-at month per entity) to a dataset. Re-importing a month replaces
 * it, and replaces any ledger rows for that entity and month, like every other actuals import.
 */
export function addYtd(ds: Dataset, imported: Line[], fiscalYearStart: number | undefined): { ds: Dataset; status: YtdStatus[] } {
  const keys = new Set(imported.map(l => `${l.entity}|${l.period}`))
  const next: Dataset = {
    ...ds,
    actuals: ds.actuals.filter(l => !keys.has(`${l.entity}|${l.period}`)),
    ytd: [...(ds.ytd ?? []).filter(l => !keys.has(`${l.entity}|${l.period}`)), ...imported],
  }
  return applyYtd(next, fiscalYearStart)
}
