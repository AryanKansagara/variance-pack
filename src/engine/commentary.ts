// Deterministic commentary: every number and name in a draft comes from a computed driver.
import { BASIS_LABEL, type Flag } from './variance.ts'

export function money(n: number): string {
  const a = Math.abs(n), s = n < 0 ? '-' : ''
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`
  if (a >= 1e4) return `${s}$${Math.round(a / 1e3)}k`
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  return `${s}$${Math.round(a)}`
}

export const pctText = (p: number | null) => p === null ? 'no base' : `${Math.round(Math.abs(p) * 100)}%`

export function monthName(period: string) {
  return new Date(period + '-01T00:00:00Z').toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

function direction(f: Flag) {
  const up = f.v.amount > 0
  if (f.basis === 'budget') return f.row.kind === 'revenue' ? (up ? 'above budget' : 'below budget') : (up ? 'over budget' : 'under budget')
  return `${up ? 'up' : 'down'} vs ${BASIS_LABEL[f.basis]}`
}

function driverPhrase(d: Flag['drivers'][number]) {
  const amt = money(Math.abs(d.delta))
  switch (d.tag) {
    case 'new': return `${d.name} ${amt}${d.memo ? ` ${d.memo.charAt(0).toLowerCase()}${d.memo.slice(1)}` : ''} (new vendor)`
    case 'one-off': return `${d.name} ${amt}${d.memo ? ` ${d.memo.charAt(0).toLowerCase()}${d.memo.slice(1)}` : ' one-off entry'}`
    case 'accrual': return `${d.name} ${amt} accrual`
    case 'dropped': return `no ${d.name} spend this month (run-rate ${amt})`
    default: return `${d.name} ${amt} ${d.delta > 0 ? 'above' : 'below'} its run-rate`
  }
}

/** The numbers inlined in a draft, in a fixed order, so edited wording can be refreshed next month. */
export interface Facts {
  key: string
  tokens: string[]
}

export function facts(f: Flag): Facts {
  return {
    key: `${f.row.account}|${f.drivers[0]?.name ?? ''}`,
    tokens: [money(Math.abs(f.v.amount)), pctText(f.v.pct), ...f.drivers.map(d => money(Math.abs(d.delta))), ...(f.row.pv ? [money(f.row.pv.volume), money(f.row.pv.price)] : [])],
  }
}

export function draft(f: Flag): string {
  const head = `${f.row.name} ${money(Math.abs(f.v.amount))} (${pctText(f.v.pct)}) ${direction(f)}`
  const pvLead = !f.drivers.length && f.row.pv && f.basis === 'budget'
  const parts = pvLead ? pvParts(f.row.pv!) : f.drivers.map(driverPhrase)
  const body = parts.length
    ? `, driven by ${parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]}`
    : ', no GL detail isolates a driver; needs review'
  const nature =
    f.nature === 'timing' ? `; timing${f.timing.reversesIn ? `, reverses in ${monthName(f.timing.reversesIn)}` : f.timing.offsets ? `, offsets ${monthName(f.timing.offsets)}` : f.timing.reason ? `, ${f.timing.reason}` : ''}`
      : f.nature === 'non-recurring' ? '; non-recurring'
        : f.nature === 'run-rate' ? '; recurring run-rate' : ''
  const pv = f.row.pv && f.basis === 'budget' && !pvLead ? ` Volume ${signedMoney(f.row.pv.volume)}, price ${signedMoney(f.row.pv.price)}.` : ''
  return `${head}${body}${nature}.${pv}`
}

function pvParts(pv: NonNullable<Flag['row']['pv']>) {
  return [['price', pv.price], ['volume', pv.volume]].sort((a, b) => Math.abs(+b[1]) - Math.abs(+a[1])).filter(([, v]) => Math.abs(+v) >= 1).map(([k, v]) => `${k} ${signedMoney(+v)}`)
}

const signedMoney = (n: number) => (n >= 0 ? '+' : '-') + money(Math.abs(n))

/**
 * Carry an analyst's edited wording into the next month when the same driver recurs: every number
 * that came from last month's facts is swapped for this month's figure; the prose is kept.
 */
export function carryForward(prevText: string, prev: Facts, next: Facts): string | null {
  if (prev.key !== next.key) return null
  let out = prevText
  const marks = prev.tokens.map((_, i) => `\u0000${i}\u0000`)
  // Replace longest tokens first so "$4.2k" never clobbers part of "$42k".
  const order = prev.tokens.map((t, i) => [t, i] as const).sort((a, b) => b[0].length - a[0].length)
  for (const [t, i] of order) if (t && next.tokens[i] !== undefined) out = out.split(t).join(marks[i])
  prev.tokens.forEach((_, i) => { out = out.split(marks[i]).join(next.tokens[i] ?? prev.tokens[i]) })
  return out
}

export type Status = 'draft' | 'reviewed' | 'approved'

export interface Note {
  text: string
  edited: boolean
  status: Status
  comment: string
  facts: Facts
  /** Set when the text was carried forward from a prior month's edit. */
  carriedFrom?: string
  updatedAt: number
}

/** Starting note for a flag: last month's edited wording if the driver recurs, else the template. */
export function startingNote(f: Flag, history: Record<string, Note | undefined>, priorPeriods: string[]): Note {
  const fx = facts(f)
  for (const p of priorPeriods) {
    const prev = history[`${p}|${f.row.account}`]
    if (!prev?.edited) continue
    const text = carryForward(prev.text, prev.facts, fx)
    if (text) return { text, edited: false, status: 'draft', comment: '', facts: fx, carriedFrom: p, updatedAt: 0 }
  }
  return { text: draft(f), edited: false, status: 'draft', comment: '', facts: fx, updatedAt: 0 }
}
