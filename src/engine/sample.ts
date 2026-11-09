// Synthetic companies. Deterministic (seeded), regenerated on load instead of stored.
import type { BudgetRow, Config, Dataset, Entity, Line, MapRow } from './types.ts'
import { r2, shift } from './variance.ts'

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface SampleDef { id: string; name: string; blurb: string; period: string }

export const SAMPLES: SampleDef[] = [
  { id: 'saas', name: 'Northwind Cloud', blurb: 'B2B SaaS, one entity. October has a new media agency blowing the marketing budget, a seat-price increase, and an audit fee accrued a month early.', period: '2026-10' },
  { id: 'multi', name: 'Maple & Main Supply', blurb: 'Distributor with a US parent (USD) and a Canadian subsidiary (CAD). Intercompany management fee to eliminate, a freight spike and a materials price rise.', period: '2026-10' },
]

const FIRST = '2025-01', LAST = '2026-10'
const months = () => { const out: string[] = []; for (let p = FIRST; p <= LAST; p = shift(p, 1)) out.push(p); return out }
const idx = (p: string) => months().indexOf(p)

class Book {
  actuals: Line[] = []
  budget: BudgetRow[] = []
  map: MapRow[]
  rand: () => number
  constructor(map: MapRow[], rand: () => number) { this.map = map; this.rand = rand }
  kind(account: string) { return this.map.find(m => m.account === account)?.kind ?? 'expense' }
  post(entity: string, period: string, account: string, amount: number, extra: Partial<Line> = {}) {
    if (Math.abs(amount) < 0.5) return
    const amt = r2(amount)
    // Natural-sign amount -> debit/credit, with the offset to AR (revenue) or AP (expense) so every month balances.
    const rev = this.kind(account) === 'revenue'
    const dr = rev ? amt < 0 : amt > 0
    const a = Math.abs(amt)
    const day = String(1 + Math.floor(this.rand() * 27)).padStart(2, '0')
    this.actuals.push({ entity, period, account, debit: dr ? a : 0, credit: dr ? 0 : a, date: `${period}-${day}`, ...extra })
    this.actuals.push({ entity, period, account: rev ? '1200' : '2000', debit: dr ? 0 : a, credit: dr ? a : 0, date: `${period}-${day}`, memo: rev ? 'Accounts receivable' : 'Accounts payable' })
  }
  plan(entity: string, period: string, account: string, amount: number, units?: number) {
    this.budget.push({ entity, period, account, amount: r2(amount), ...(units ? { units } : {}) })
  }
  noise(pct = 0.03) { return 1 + (this.rand() * 2 - 1) * pct }
}

const m = (account: string, name: string, line: string, section: MapRow['section'], kind: MapRow['kind'] = 'expense', intercompany = false): MapRow =>
  ({ account, name, line, section, kind, ...(intercompany ? { intercompany } : {}) })

// ---------- Northwind Cloud ----------

const SAAS_MAP: MapRow[] = [
  m('4000', 'Subscription revenue', 'Subscription revenue', 'Revenue', 'revenue'),
  m('4100', 'Implementation services', 'Services revenue', 'Revenue', 'revenue'),
  m('5000', 'Cloud hosting', 'Hosting', 'Cost of revenue'),
  m('5100', 'Support salaries', 'Customer support', 'Cost of revenue'),
  m('6000', 'R&D salaries', 'People', 'Operating expenses'),
  m('6050', 'G&A salaries', 'People', 'Operating expenses'),
  m('6100', 'Advertising and media', 'Sales & marketing', 'Operating expenses'),
  m('6150', 'Events and sponsorships', 'Sales & marketing', 'Operating expenses'),
  m('6200', 'Sales commissions', 'Sales & marketing', 'Operating expenses'),
  m('6300', 'Software subscriptions', 'Software & IT', 'Operating expenses'),
  m('6400', 'Rent', 'Facilities', 'Operating expenses'),
  m('6500', 'Audit and legal', 'Professional fees', 'Operating expenses'),
  m('6600', 'Travel', 'Travel & entertainment', 'Operating expenses'),
  m('7000', 'Depreciation', 'Depreciation', 'Operating expenses'),
  m('8000', 'Interest income', 'Other', 'Other income and expense', 'revenue'),
]

function saas(): Dataset {
  const b = new Book(SAAS_MAP, rng(42))
  const E = 'NWC'
  for (const p of months()) {
    const i = idx(p), oct = p === '2026-10', sep = p === '2026-09'
    const seatsPlan = Math.round(9400 * 1.018 ** i)
    const seats = oct ? Math.round(seatsPlan * 0.985) : Math.round(seatsPlan * b.noise(0.01))
    const price = i >= 21 ? 49.5 : 46 // price list rise in October 2026, budget held at $46
    const tiers = [['Enterprise', 0.52], ['Mid-market', 0.33], ['SMB', 0.15]] as const
    for (const [t, share] of tiers) b.post(E, p, '4000', seats * share * price, { vendor: t, units: Math.round(seats * share), memo: `${t} subscriptions` })
    b.plan(E, p, '4000', seatsPlan * 46, seatsPlan)
    b.post(E, p, '4100', 18000 * b.noise(0.2), { vendor: 'Implementation team', dept: 'Services' }); b.plan(E, p, '4100', 18000)
    b.post(E, p, '5000', 0.11 * seats * 46 * b.noise(0.02), { vendor: 'Amazon Web Services', memo: 'Monthly AWS usage' })
    b.post(E, p, '5000', 4200 * b.noise(0.02), { vendor: 'Cloudflare' }); b.plan(E, p, '5000', 0.11 * seatsPlan * 46 + 4200)
    b.post(E, p, '5100', 31000 * b.noise(0.01), { dept: 'Support', memo: 'Payroll' }); b.plan(E, p, '5100', 31000)
    b.post(E, p, '6000', 142000 * 1.004 ** i * b.noise(0.01), { dept: 'Engineering', memo: 'Payroll' }); b.plan(E, p, '6000', 142000 * 1.004 ** i)
    b.post(E, p, '6050', 58000 * b.noise(0.01), { dept: 'G&A', memo: 'Payroll' }); b.plan(E, p, '6050', 58000)
    b.post(E, p, '6100', 96000 * b.noise(0.05), { vendor: 'Google Ads', memo: 'Search campaigns' })
    b.post(E, p, '6100', 52000 * b.noise(0.05), { vendor: 'LinkedIn Ads', memo: 'Paid social' })
    if (oct) b.post(E, p, '6100', 35000, { vendor: 'Acme Media', memo: 'New campaign invoice', ref: 'INV-20418' })
    b.plan(E, p, '6100', 148000)
    b.post(E, p, '6150', (i % 6 === 4 ? 38000 : 6000) * b.noise(0.1), { vendor: i % 6 === 4 ? 'SaaStr' : 'Meetup venues' }); b.plan(E, p, '6150', i % 6 === 4 ? 40000 : 6000)
    b.post(E, p, '6200', 0.08 * seats * price * 0.3 * b.noise(0.05), { dept: 'Sales', memo: 'Commission accrual' }); b.plan(E, p, '6200', 0.08 * seatsPlan * 46 * 0.3)
    for (const [v, a] of [['Salesforce', 14200], ['Slack', 3100], ['GitHub', 4800], ['Atlassian', 2600]] as const) b.post(E, p, '6300', a * b.noise(0.01), { vendor: v })
    b.plan(E, p, '6300', 24700)
    b.post(E, p, '6400', 38500, { vendor: 'Harbourfront Properties', memo: 'Office rent' }); b.plan(E, p, '6400', 38500)
    // Audit fee: budgeted in October, accrued in September when fieldwork started.
    if (sep) b.post(E, p, '6500', 48000, { vendor: 'Baker Tilly LLP', memo: 'Audit fee accrual, fieldwork started early' })
    b.post(E, p, '6500', 6500 * b.noise(0.2), { vendor: 'Osler LLP', memo: 'General counsel' })
    b.plan(E, p, '6500', 6500 + (oct ? 48000 : 0))
    b.post(E, p, '6600', 12500 * b.noise(0.15), { vendor: 'Navan', memo: 'Travel bookings' }); b.plan(E, p, '6600', 12500)
    b.post(E, p, '7000', 21000, { memo: 'Monthly depreciation' }); b.plan(E, p, '7000', 21000)
    b.post(E, p, '8000', 7200 * b.noise(0.05), { vendor: 'Silicon Valley Bank', memo: 'Interest on deposits' }); b.plan(E, p, '8000', 7200)
  }
  return { actuals: b.actuals, budget: b.budget }
}

// ---------- Maple & Main Supply ----------

const MULTI_MAP: MapRow[] = [
  m('4000', 'Product sales', 'Product revenue', 'Revenue', 'revenue'),
  m('4900', 'Intercompany management fee income', 'Intercompany', 'Revenue', 'revenue', true),
  m('5000', 'Materials', 'Materials', 'Cost of revenue'),
  m('5100', 'Freight in', 'Freight', 'Cost of revenue'),
  m('6000', 'Salaries and wages', 'People', 'Operating expenses'),
  m('6100', 'Marketing', 'Sales & marketing', 'Operating expenses'),
  m('6400', 'Warehouse rent', 'Facilities', 'Operating expenses'),
  m('6700', 'Professional fees', 'Professional fees', 'Operating expenses'),
  m('6900', 'Intercompany management fee expense', 'Intercompany', 'Operating expenses', 'expense', true),
  m('8100', 'FX gain or loss', 'Other', 'Other income and expense', 'revenue'),
]

function multi(): Dataset {
  const b = new Book(MULTI_MAP, rng(7))
  for (const p of months()) {
    const i = idx(p), oct = p === '2026-10'
    for (const [E, scale, curr] of [['US', 1, 'USD'], ['CA', 0.62 / 0.73, 'CAD']] as const) {
      const unitsPlan = Math.round((E === 'US' ? 8200 : 5100) * (1 + 0.15 * Math.sin((i / 12) * 2 * Math.PI)))
      const units = Math.round(unitsPlan * (oct && E === 'US' ? 1.07 : b.noise(0.02)))
      const price = 62 * scale
      b.post(E, p, '4000', units * price * b.noise(0.005), { vendor: E === 'US' ? 'Wholesale accounts' : 'Retail partners', units }); b.plan(E, p, '4000', unitsPlan * price, unitsPlan)
      const cost = (i >= 20 ? 31.9 : 29) * scale // supplier price rise from September 2026
      b.post(E, p, '5000', units * cost, { vendor: E === 'US' ? 'Great Lakes Polymers' : 'Laurentian Resin Co', units, memo: 'Materials receipts' }); b.plan(E, p, '5000', unitsPlan * 29 * scale, unitsPlan)
      b.post(E, p, '5100', units * 2.4 * scale * b.noise(0.04), { vendor: E === 'US' ? 'Midwest Carriers' : 'Maritime Freightways' })
      if (oct && E === 'CA') b.post(E, p, '5100', 21500, { vendor: 'Northern Haul Logistics', memo: 'Expedited freight, Vancouver port delay', ref: 'NHL-7781' })
      b.plan(E, p, '5100', unitsPlan * 2.4 * scale)
      b.post(E, p, '6000', (E === 'US' ? 88000 : 61000) * b.noise(0.01), { dept: 'Operations', memo: 'Payroll' }); b.plan(E, p, '6000', E === 'US' ? 88000 : 61000)
      b.post(E, p, '6100', (E === 'US' ? 14000 : 8000) * b.noise(0.08), { vendor: E === 'US' ? 'Meta Ads' : 'Google Ads' }); b.plan(E, p, '6100', E === 'US' ? 14000 : 8000)
      b.post(E, p, '6400', E === 'US' ? 26000 : 23500, { vendor: E === 'US' ? 'Prologis' : 'Pure Industrial', memo: 'Warehouse lease' }); b.plan(E, p, '6400', E === 'US' ? 26000 : 23500)
      b.post(E, p, '6700', (E === 'US' ? 9000 : 5500) * b.noise(0.1), { vendor: E === 'US' ? 'Grant Thornton' : 'MNP LLP' }); b.plan(E, p, '6700', E === 'US' ? 9000 : 5500)
      b.post(E, p, '8100', (b.rand() - 0.5) * 3000, { memo: `${curr} revaluation` })
      // Monthly management fee: CA pays CAD 13,700, US books USD 10,000.
      if (E === 'US') { b.post(E, p, '4900', 10000, { vendor: 'Maple & Main Canada', memo: 'Management fee' }); b.plan(E, p, '4900', 10000) }
      else { b.post(E, p, '6900', 13700, { vendor: 'Maple & Main US', memo: 'Management fee' }); b.plan(E, p, '6900', 13700) }
    }
  }
  return { actuals: b.actuals, budget: b.budget }
}

const BASE = { reportingCurrency: 'USD', thresholds: { abs: 10000, pct: 0.1 }, basis: 'budget' as const }

export function sampleConfig(id: string): Config {
  if (id === 'multi') {
    const entities: Entity[] = [{ id: 'US', name: 'Maple & Main US Inc.', currency: 'USD', fx: 1 }, { id: 'CA', name: 'Maple & Main Canada Ltd.', currency: 'CAD', fx: 0.73 }]
    return { ...BASE, thresholds: { abs: 7500, pct: 0.08 }, mapping: MULTI_MAP, entities }
  }
  return { ...BASE, mapping: SAAS_MAP, entities: [{ id: 'NWC', name: 'Northwind Cloud Inc.', currency: 'USD', fx: 1 }] }
}

const cache = new Map<string, Dataset>()
export function sampleData(id: string): Dataset {
  if (!cache.has(id)) cache.set(id, id === 'multi' ? multi() : saas())
  return cache.get(id)!
}
