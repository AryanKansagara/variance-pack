import { SECTIONS, type Basis, type BudgetRow, type Config, type Dataset, type Line, type MapRow, type Section, type Thresholds } from './types.ts'

export const r2 = (n: number) => Math.round(n * 100) / 100

// ---------- Periods ----------

export function shift(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return d.toISOString().slice(0, 7)
}

export const periodsOf = (ds: Dataset) => [...new Set(ds.actuals.map(l => l.period))].sort()

export const BASIS_LABEL: Record<Basis, string> = { budget: 'budget', mom: 'prior month', yoy: 'last year' }

// ---------- Variance math ----------

export interface Variance {
  base: number
  amount: number
  /** Null when the base is zero. */
  pct: number | null
  favourable: boolean
  flagged: boolean
}

export function variance(actual: number, base: number, kind: MapRow['kind'], th: Thresholds): Variance {
  const amount = r2(actual - base)
  const pct = Math.abs(base) < 0.005 ? null : amount / Math.abs(base)
  const favourable = kind === 'revenue' ? amount >= 0 : amount <= 0
  // Both the dollar and the percent test must trip. A zero base counts as an infinite percent.
  const flagged = amount !== 0 && Math.abs(amount) >= th.abs && (pct === null || Math.abs(pct) >= th.pct)
  return { base: r2(base), amount, pct, favourable, flagged }
}

/** Natural sign: revenue positive as a credit, expense positive as a debit. */
export const natural = (net: number, kind: MapRow['kind']) => kind === 'revenue' ? -net : net
const contribution = (amt: number, kind: MapRow['kind']) => kind === 'revenue' ? amt : -amt

// ---------- Aggregation with FX and intercompany elimination ----------

export const isBalanceSheet = (account: string) => /^[123]/.test(account.trim())

export interface Scope {
  /** 'all' consolidates every entity and eliminates intercompany accounts. */
  entity: string
}

function fxOf(cfg: Config, entity: string) {
  return cfg.entities.find(e => e.id === entity)?.fx ?? 1
}

/** Net (debit minus credit) per account for one period, in reporting currency. */
export function netByAccount(lines: Line[], cfg: Config, period: string, scope: Scope): Map<string, number> {
  const ic = new Set(cfg.mapping.filter(m => m.intercompany).map(m => m.account))
  const out = new Map<string, number>()
  for (const l of lines) {
    if (l.period !== period) continue
    if (scope.entity !== 'all' && l.entity !== scope.entity) continue
    if (scope.entity === 'all' && ic.has(l.account)) continue
    out.set(l.account, (out.get(l.account) ?? 0) + (l.debit - l.credit) * fxOf(cfg, l.entity))
  }
  return out
}

function budgetByAccount(rows: BudgetRow[], cfg: Config, period: string, scope: Scope) {
  const ic = new Set(cfg.mapping.filter(m => m.intercompany).map(m => m.account))
  const amt = new Map<string, number>(), units = new Map<string, number>()
  for (const b of rows) {
    if (b.period !== period) continue
    if (scope.entity !== 'all' && b.entity !== scope.entity) continue
    if (scope.entity === 'all' && ic.has(b.account)) continue
    const fx = fxOf(cfg, b.entity)
    amt.set(b.account, (amt.get(b.account) ?? 0) + b.amount * fx)
    if (b.units) units.set(b.account, (units.get(b.account) ?? 0) + b.units)
  }
  return { amt, units }
}

function unitsByAccount(lines: Line[], period: string, scope: Scope) {
  const out = new Map<string, number>()
  for (const l of lines) if (l.period === period && l.units && (scope.entity === 'all' || l.entity === scope.entity)) out.set(l.account, (out.get(l.account) ?? 0) + l.units)
  return out
}

export interface Elimination {
  account: string
  name: string
  byEntity: { entity: string; net: number }[]
}

export interface Eliminations {
  items: Elimination[]
  /** Net of every intercompany line in reporting currency. Zero when both sides tie at the same rate. */
  residual: number
}

export function eliminations(ds: Dataset, cfg: Config, period: string): Eliminations {
  const items = cfg.mapping.filter(m => m.intercompany).map(m => {
    const by = new Map<string, number>()
    for (const l of ds.actuals) if (l.period === period && l.account === m.account) by.set(l.entity, (by.get(l.entity) ?? 0) + (l.debit - l.credit) * fxOf(cfg, l.entity))
    return { account: m.account, name: m.name, byEntity: [...by].map(([entity, net]) => ({ entity, net: r2(net) })) }
  }).filter(e => e.byEntity.length)
  return { items, residual: r2(items.reduce((s, e) => s + e.byEntity.reduce((t, b) => t + b.net, 0), 0)) }
}

// ---------- Price / volume ----------

export interface PriceVolume { volume: number; price: number; unitsActual: number; unitsBudget: number }

export function priceVolume(actual: number, ua: number, budget: number, ub: number): PriceVolume | null {
  if (!(ua > 0 && ub > 0)) return null
  const pb = budget / ub, pa = actual / ua
  return { volume: r2((ua - ub) * pb), price: r2((pa - pb) * ua), unitsActual: ua, unitsBudget: ub }
}

// ---------- Drivers from GL detail ----------

export type DriverTag = 'new' | 'one-off' | 'accrual' | 'run-rate' | 'dropped'

export interface Driver {
  name: string
  current: number
  compare: number
  delta: number
  tag: DriverTag
  memo?: string
  entries: number
}

const driverKey = (l: Line) => l.vendor?.trim() || l.dept?.trim() || 'Unattributed'
const ACCRUAL = /accru|revers|prepaid|true[- ]?up/i

function vendorTotals(lines: Line[], account: string, period: string, kind: MapRow['kind'], cfg: Config, scope: Scope) {
  const m = new Map<string, { amt: number; lines: Line[] }>()
  for (const l of lines) {
    if (l.account !== account || l.period !== period) continue
    if (scope.entity !== 'all' && l.entity !== scope.entity) continue
    const k = driverKey(l)
    const e = m.get(k) ?? { amt: 0, lines: [] }
    e.amt += natural(l.debit - l.credit, kind) * fxOf(cfg, l.entity)
    e.lines.push(l)
    m.set(k, e)
  }
  return m
}

/**
 * Which vendors (or departments) explain an account's movement. Against budget the comparison is each
 * vendor's trailing three-month run-rate, since budgets rarely carry vendor detail.
 */
export function drivers(ds: Dataset, cfg: Config, row: { account: string; kind: MapRow['kind'] }, period: string, basis: Basis, scope: Scope, varAmount: number): Driver[] {
  const { account, kind } = row
  const cur = vendorTotals(ds.actuals, account, period, kind, cfg, scope)
  const history = [1, 2, 3].map(i => vendorTotals(ds.actuals, account, shift(period, -i), kind, cfg, scope))
  const histPeriods = history.filter(h => h.size).length
  if (!histPeriods && !cur.size) return []
  let comp: Map<string, number>
  if (basis === 'budget') {
    comp = new Map()
    for (const h of history) for (const [k, v] of h) comp.set(k, (comp.get(k) ?? 0) + v.amt / Math.max(1, histPeriods))
  } else {
    const p = basis === 'mom' ? shift(period, -1) : shift(period, -12)
    comp = new Map([...vendorTotals(ds.actuals, account, p, kind, cfg, scope)].map(([k, v]) => [k, v.amt]))
  }
  const next = vendorTotals(ds.actuals, account, shift(period, 1), kind, cfg, scope)
  const seenBefore = new Set(history.flatMap(h => [...h.keys()]))
  const out: Driver[] = []
  for (const k of new Set([...cur.keys(), ...comp.keys()])) {
    const c = cur.get(k)
    const current = r2(c?.amt ?? 0), compare = r2(comp.get(k) ?? 0), delta = r2(current - compare)
    if (Math.abs(delta) < 0.5) continue
    const big = c?.lines.slice().sort((a, b) => Math.abs(b.debit - b.credit) - Math.abs(a.debit - a.credit))[0]
    const bigAmt = big ? Math.abs(big.debit - big.credit) * fxOf(cfg, big.entity) : 0
    const memo = big?.memo?.trim() || undefined
    const nextAmt = next.get(k)?.amt ?? 0
    let tag: DriverTag = 'run-rate'
    if (!c) tag = 'dropped'
    else if ((memo && ACCRUAL.test(memo)) || (current > 0 && nextAmt < 0 && Math.abs(nextAmt + current) <= 0.1 * current)) tag = 'accrual'
    else if (!seenBefore.has(k)) tag = 'new'
    // One entry carrying most of the movement and far above the usual run-rate.
    else if (bigAmt >= 0.6 * Math.abs(delta) && delta > 0 && bigAmt > 1.5 * Math.max(compare, 0) && c.lines.length <= 2) tag = 'one-off'
    out.push({ name: k, current, compare, delta, tag, memo, entries: c?.lines.length ?? 0 })
  }
  // Rank by contribution in the direction of the variance; keep the few that explain most of it.
  const dir = Math.sign(varAmount) || 1
  const ranked = out.filter(d => Math.sign(d.delta) === dir).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const keep: Driver[] = []
  let covered = 0
  for (const d of ranked) {
    if (keep.length >= 3) break
    if (keep.length && Math.abs(d.delta) < 0.1 * Math.abs(varAmount)) break
    keep.push(d)
    covered += Math.abs(d.delta)
    if (covered >= 0.8 * Math.abs(varAmount)) break
  }
  return keep
}

// ---------- Timing ----------

export interface Timing { timing: boolean; reason?: string; reversesIn?: string; offsets?: string }

/** A budget variance that reverses in an adjacent month, or that is carried by an accrual entry. */
export function timing(budgetVar: (p: string) => number | null, period: string, abs: number, drv: Driver[]): Timing {
  const v0 = budgetVar(period)
  if (v0 === null || Math.abs(v0) < abs) return { timing: false }
  for (const [p, label] of [[shift(period, 1), 'next'], [shift(period, -1), 'prior']] as const) {
    const v = budgetVar(p)
    if (v === null || Math.sign(v) === Math.sign(v0)) continue
    const ratio = Math.abs(v) / Math.abs(v0)
    if (ratio >= 0.5 && ratio <= 1.5) return label === 'next' ? { timing: true, reversesIn: p, reason: 'reverses next month' } : { timing: true, offsets: p, reason: 'offsets the prior month' }
  }
  const acc = drv.find(d => d.tag === 'accrual')
  if (acc) return { timing: true, reason: `accrual (${acc.name})` }
  return { timing: false }
}

// ---------- The report ----------

export interface AccountRow {
  account: string
  name: string
  line: string
  section: Section
  kind: MapRow['kind']
  actual: number
  budget: number
  prior: number
  lastYear: number
  vs: Record<Basis, Variance>
  pv: PriceVolume | null
}

export interface Rollup {
  label: string
  section: Section
  kind: MapRow['kind']
  actual: number
  budget: number
  prior: number
  lastYear: number
  vs: Record<Basis, Variance>
  accounts: AccountRow[]
}

export interface Report {
  period: string
  scope: Scope
  rows: AccountRow[]
  lines: Rollup[]
  sections: Rollup[]
  netIncome: Rollup
  grossProfit: Rollup
  unmapped: { account: string; net: number }[]
  eliminations: Eliminations
  hasBudget: boolean
  hasPrior: boolean
  hasLastYear: boolean
}

function rollup(label: string, section: Section, kind: MapRow['kind'], accounts: AccountRow[], th: Thresholds): Rollup {
  const sum = (f: (a: AccountRow) => number) => r2(accounts.reduce((s, a) => s + contribution(f(a), a.kind), 0) * (kind === 'revenue' ? 1 : -1))
  const actual = sum(a => a.actual), budget = sum(a => a.budget), prior = sum(a => a.prior), lastYear = sum(a => a.lastYear)
  return { label, section, kind, actual, budget, prior, lastYear, accounts, vs: { budget: variance(actual, budget, kind, th), mom: variance(actual, prior, kind, th), yoy: variance(actual, lastYear, kind, th) } }
}

export function buildReport(ds: Dataset, cfg: Config, period: string, scope: Scope = { entity: 'all' }): Report {
  const th = cfg.thresholds
  const cur = netByAccount(ds.actuals, cfg, period, scope)
  const pri = netByAccount(ds.actuals, cfg, shift(period, -1), scope)
  const ly = netByAccount(ds.actuals, cfg, shift(period, -12), scope)
  const bud = budgetByAccount(ds.budget, cfg, period, scope)
  const ua = unitsByAccount(ds.actuals, period, scope)
  const rows: AccountRow[] = []
  for (const m of cfg.mapping) {
    if (scope.entity === 'all' && m.intercompany) continue
    const actual = r2(natural(cur.get(m.account) ?? 0, m.kind))
    const budget = r2(bud.amt.get(m.account) ?? 0)
    const prior = r2(natural(pri.get(m.account) ?? 0, m.kind))
    const lastYear = r2(natural(ly.get(m.account) ?? 0, m.kind))
    if (!actual && !budget && !prior && !lastYear) continue
    rows.push({
      account: m.account, name: m.name, line: m.line, section: m.section, kind: m.kind, actual, budget, prior, lastYear,
      vs: { budget: variance(actual, budget, m.kind, th), mom: variance(actual, prior, m.kind, th), yoy: variance(actual, lastYear, m.kind, th) },
      pv: priceVolume(actual, ua.get(m.account) ?? 0, budget, bud.units.get(m.account) ?? 0),
    })
  }
  const mapped = new Set(cfg.mapping.map(m => m.account))
  const unmapped = [...cur].filter(([a, n]) => !mapped.has(a) && !isBalanceSheet(a) && Math.abs(n) > 0.005).map(([account, net]) => ({ account, net: r2(net) }))
  const lines: Rollup[] = [], sections: Rollup[] = []
  for (const s of SECTIONS) {
    const inS = rows.filter(r => r.section === s)
    if (!inS.length) continue
    const kind = s === 'Revenue' ? 'revenue' : s === 'Other income and expense' ? 'revenue' : 'expense'
    for (const l of [...new Set(inS.map(r => r.line))]) {
      const acc = inS.filter(r => r.line === l)
      lines.push(rollup(l, s, acc.every(a => a.kind === 'revenue') ? 'revenue' : 'expense', acc, th))
    }
    sections.push(rollup(s, s, kind, inS, th))
  }
  const has = (m: Map<string, number>) => [...m.values()].some(v => Math.abs(v) > 0.005)
  return {
    period, scope, rows, lines, sections, unmapped,
    netIncome: rollup('Net income', 'Revenue', 'revenue', rows, th),
    grossProfit: rollup('Gross profit', 'Revenue', 'revenue', rows.filter(r => r.section === 'Revenue' || r.section === 'Cost of revenue'), th),
    eliminations: scope.entity === 'all' ? eliminations(ds, cfg, period) : { items: [], residual: 0 },
    hasBudget: bud.amt.size > 0, hasPrior: has(pri), hasLastYear: has(ly),
  }
}

/** Budget variance for one account in any period, or null when there is no data for it. */
export function budgetVarFn(ds: Dataset, cfg: Config, account: string, kind: MapRow['kind'], scope: Scope) {
  const cache = new Map<string, number | null>()
  return (p: string) => {
    if (cache.has(p)) return cache.get(p)!
    const hasActual = ds.actuals.some(l => l.period === p)
    const b = budgetByAccount(ds.budget, cfg, p, scope).amt
    const v = hasActual && b.size ? natural(netByAccount(ds.actuals, cfg, p, scope).get(account) ?? 0, kind) - (b.get(account) ?? 0) : null
    cache.set(p, v)
    return v
  }
}

// ---------- Flagged accounts with drivers ----------

export type Nature = 'timing' | 'non-recurring' | 'run-rate' | 'unexplained'

export interface Flag {
  row: AccountRow
  v: Variance
  basis: Basis
  drivers: Driver[]
  timing: Timing
  nature: Nature
  /** Share of the variance the drivers account for. */
  coverage: number
}

export function flags(ds: Dataset, cfg: Config, report: Report, basis: Basis = cfg.basis): Flag[] {
  return report.rows.filter(r => r.vs[basis].flagged).map(row => {
    const v = row.vs[basis]
    const drv = drivers(ds, cfg, row, report.period, basis, report.scope, v.amount)
    const t = basis === 'budget' || basis === 'mom'
      ? timing(budgetVarFn(ds, cfg, row.account, row.kind, report.scope), report.period, cfg.thresholds.abs, drv)
      : { timing: false }
    const nature: Nature = t.timing ? 'timing' : !drv.length ? (row.pv ? 'run-rate' : 'unexplained') : drv[0].tag === 'new' || drv[0].tag === 'one-off' ? 'non-recurring' : 'run-rate'
    const coverage = v.amount ? Math.min(1, drv.reduce((s, d) => s + Math.abs(d.delta), 0) / Math.abs(v.amount)) : 0
    return { row, v, basis, drivers: drv, timing: t, nature, coverage }
  }).sort((a, b) => Math.abs(b.v.amount) - Math.abs(a.v.amount))
}
