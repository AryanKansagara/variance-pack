/** One posted GL line, or one trial-balance row (no vendor). Amounts in the entity's currency. */
export interface Line {
  entity: string
  period: string // YYYY-MM
  account: string
  debit: number
  credit: number
  vendor?: string
  dept?: string
  memo?: string
  date?: string
  units?: number
  ref?: string
}

/** Budget or forecast amount, natural sign (revenue and expense both positive). */
export interface BudgetRow {
  entity: string
  period: string
  account: string
  amount: number
  units?: number
}

export type Section = 'Revenue' | 'Cost of revenue' | 'Operating expenses' | 'Other income and expense'
export const SECTIONS: Section[] = ['Revenue', 'Cost of revenue', 'Operating expenses', 'Other income and expense']

export interface MapRow {
  account: string
  name: string
  /** P&L line the account rolls into, e.g. "Sales & marketing". */
  line: string
  section: Section
  /** Revenue-type accounts are favourable when actual is above budget. */
  kind: 'revenue' | 'expense'
  intercompany?: boolean
}

export interface Entity {
  id: string
  name: string
  currency: string
  /** Units of reporting currency per unit of entity currency. */
  fx: number
}

export interface Dataset {
  actuals: Line[]
  budget: BudgetRow[]
}

export interface Thresholds {
  /** Both must trip for an account to be flagged. */
  abs: number
  pct: number
}

export type Basis = 'budget' | 'mom' | 'yoy'

export interface Config {
  mapping: MapRow[]
  entities: Entity[]
  reportingCurrency: string
  thresholds: Thresholds
  basis: Basis
}
