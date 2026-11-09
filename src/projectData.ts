import { useEffect, useMemo, useState } from 'react'
import { buildReport, flags as flagsOf, periodsOf, BASIS_LABEL, type Flag, type Report } from './engine/variance.ts'
import { draft, monthName, startingNote, type Note } from './engine/commentary.ts'
import { SAMPLES, sampleConfig, sampleData } from './engine/sample.ts'
import type { Basis, Dataset } from './engine/types.ts'
import { blankConfig, getData, getProjects, saveProject, useProjects, uuid, type CheckItem, type Project, type Snapshot } from './store.ts'

export const EMPTY: Dataset = { actuals: [], budget: [] }

export async function createSampleProject(sampleId: string): Promise<Project> {
  const existing = getProjects().find(p => p.sampleId === sampleId)
  if (existing) return existing
  const def = SAMPLES.find(s => s.id === sampleId)!
  const ds = sampleData(sampleId)
  const config = sampleConfig(sampleId)
  const now = Date.now()
  const base: Project = {
    id: uuid(), name: def.name, createdAt: now, updatedAt: now, config, period: def.period, notes: {}, checklist: {}, snapshots: [], sampleId,
    imports: [
      { id: uuid(), kind: 'actuals', fileName: 'synthetic general ledger detail', format: 'Generic layout', rows: ds.actuals.length, issues: 0, periods: periodsOf(ds), at: now },
      { id: uuid(), kind: 'budget', fileName: 'synthetic FY budget', format: 'Budget, one row per account and month', rows: ds.budget.length, issues: 0, periods: [...new Set(ds.budget.map(b => b.period))].sort(), at: now },
    ],
  }
  // Three closed months, approved and snapshotted, so history and carry-forward have something to show.
  let p = base
  for (const period of ['2026-07', '2026-08', '2026-09']) {
    const report = buildReport(ds, config, period)
    const fl = flagsOf(ds, config, report)
    const notes = { ...p.notes }
    for (const f of fl) notes[`${period}|${f.row.account}`] = { ...startingNote(f, notes, priorPeriods(period)), status: 'approved', comment: 'Agreed with budget owner.', updatedAt: now }
    const checklist = { ...p.checklist }
    for (const f of fl) checklist[`${period}|${f.row.account}`] = { status: 'done', owner: f.row.section === 'Revenue' ? 'Revenue ops' : 'FP&A' }
    p = { ...p, notes, checklist }
    p = { ...p, snapshots: [...p.snapshots, snapshotOf(p, report, fl, period)] }
  }
  return saveProject(p)
}

export async function createBlankProject(name: string): Promise<Project> {
  const now = Date.now()
  return saveProject({ id: uuid(), name, createdAt: now, updatedAt: now, config: blankConfig(), period: null, notes: {}, checklist: {}, snapshots: [], imports: [] })
}

export function priorPeriods(period: string, n = 3): string[] {
  const out: string[] = []
  const [y, m] = period.split('-').map(Number)
  for (let i = 1; i <= n; i++) out.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7))
  return out
}

export function useProject(id: string) {
  const list = useProjects()
  const project = list?.find(p => p.id === id) ?? null
  const [ds, setDs] = useState<Dataset | null>(null)
  const importsKey = project ? project.imports.map(i => i.id).join(',') : ''
  useEffect(() => {
    if (!project) return
    let live = true
    if (project.sampleId) { setDs(sampleData(project.sampleId)); return }
    void getData(project.id).then(d => { if (live) setDs((d as Dataset | undefined) ?? EMPTY) })
    return () => { live = false }
  }, [project?.id, project?.sampleId, importsKey])
  const update = (patch: Partial<Project>) => project ? saveProject({ ...project, ...patch }) : undefined
  return { loading: list === null || (project !== null && ds === null), project, ds, update }
}

export interface Analysis {
  periods: string[]
  period: string | null
  report: Report | null
  flags: Flag[]
  notes: Record<string, Note>
}

export function useAnalysis(project: Project | null, ds: Dataset | null, entity = 'all', basis?: Basis): Analysis {
  const periods = useMemo(() => ds ? periodsOf(ds) : [], [ds])
  const period = project?.period && periods.includes(project.period) ? project.period : periods[periods.length - 1] ?? null
  const cfg = project?.config
  const b = basis ?? cfg?.basis ?? 'budget'
  const report = useMemo(() => ds && cfg && period && cfg.mapping.length ? buildReport(ds, cfg, period, { entity }) : null, [ds, cfg, period, entity])
  const flags = useMemo(() => ds && cfg && report ? flagsOf(ds, cfg, report, b) : [], [ds, cfg, report, b])
  const notes = useMemo(() => {
    const out: Record<string, Note> = {}
    if (!project || !period) return out
    for (const f of flags) out[f.row.account] = noteFor(project, f, period)
    return out
  }, [project, flags, period])
  return { periods, period, report, flags, notes }
}

/** The stored note if the analyst touched it, else a fresh starting note (template or carried forward). */
export function noteFor(p: Project, f: Flag, period: string): Note {
  const stored = p.notes[`${period}|${f.row.account}`]
  if (stored && f.basis === p.config.basis) return stored
  return startingNote(f, p.notes, priorPeriods(period))
}

export const checkFor = (p: Project, period: string, account: string): CheckItem => p.checklist[`${period}|${account}`] ?? { status: 'open', owner: '' }

export function snapshotOf(p: Project, report: Report, fl: Flag[], period: string): Snapshot {
  const flagged = new Set(fl.map(f => f.row.account))
  return {
    id: uuid(), period, label: `${monthName(period)} close`, createdAt: Date.now(),
    rows: report.rows.map(r => ({
      account: r.account, name: r.name, section: r.section, kind: r.kind, actual: r.actual, budget: r.budget, variance: r.vs.budget.amount, pct: r.vs.budget.pct,
      flagged: flagged.has(r.account), favourable: r.vs.budget.favourable, ...(p.notes[`${period}|${r.account}`] ? { note: p.notes[`${period}|${r.account}`].text } : {}),
    })),
    netIncome: { actual: report.netIncome.actual, budget: report.netIncome.budget },
    approved: fl.filter(f => p.notes[`${period}|${f.row.account}`]?.status === 'approved').length,
    flagged: fl.length,
  }
}

export const basisLabel = (b: Basis) => b === 'budget' ? 'Budget' : b === 'mom' ? 'Prior month' : 'Last year'
export { BASIS_LABEL, draft }

/** Variance table with commentary as an .xlsx workbook (SheetJS, loaded on demand). */
export async function exportXlsx(p: Project, a: Analysis, basis: Basis) {
  const XLSX = await import('xlsx')
  const r = a.report!
  const head = ['Section', 'Line', 'Account', 'Name', 'Actual', basisLabel(basis), 'Variance $', 'Variance %', 'Fav/Unfav', 'Flagged', 'Nature', 'Commentary', 'Status', 'Reviewer comment']
  const rows: (string | number | null)[][] = [[`${p.name}: variance vs ${BASIS_LABEL[basis]}, ${monthName(a.period!)}`], [`Thresholds: $${p.config.thresholds.abs.toLocaleString()} and ${Math.round(p.config.thresholds.pct * 100)}%. Reporting currency ${p.config.reportingCurrency}.`], [], head]
  const byAcc = new Map(a.flags.map(f => [f.row.account, f]))
  for (const line of r.lines) {
    for (const row of line.accounts) {
      const v = row.vs[basis], f = byAcc.get(row.account), n = a.notes[row.account]
      rows.push([row.section, row.line, row.account, row.name, row.actual, v.base, v.amount, v.pct === null ? null : Math.round(v.pct * 1000) / 1000, v.favourable ? 'F' : 'U', f ? 'Yes' : '', f?.nature ?? '', n?.text ?? '', n?.status ?? '', n?.comment ?? ''])
    }
    const v = line.vs[basis]
    rows.push([line.section, `Total ${line.label}`, '', '', line.actual, v.base, v.amount, v.pct === null ? null : Math.round(v.pct * 1000) / 1000, v.favourable ? 'F' : 'U', '', '', '', '', ''])
  }
  const ni = r.netIncome.vs[basis]
  rows.push([], ['', 'Net income', '', '', r.netIncome.actual, ni.base, ni.amount, ni.pct === null ? null : Math.round(ni.pct * 1000) / 1000, ni.favourable ? 'F' : 'U'])
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [18, 22, 9, 30, 13, 13, 13, 11, 9, 8, 13, 80, 10, 30].map(wch => ({ wch }))
  for (let i = 4; i < rows.length; i++) for (const c of [4, 5, 6]) { const cell = ws[XLSX.utils.encode_cell({ r: i, c })]; if (cell) cell.z = '#,##0;(#,##0)' }
  for (let i = 4; i < rows.length; i++) { const cell = ws[XLSX.utils.encode_cell({ r: i, c: 7 })]; if (cell) cell.z = '0.0%' }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Variance')
  const check = [['Account', 'Name', 'Variance $', 'Nature', 'Status', 'Owner', 'Commentary status']]
  for (const f of a.flags) { const c = checkFor(p, a.period!, f.row.account); check.push([f.row.account, f.row.name, String(f.v.amount), f.nature, c.status, c.owner, a.notes[f.row.account]?.status ?? 'draft']) }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(check), 'Flux checklist')
  XLSX.writeFile(wb, `${p.name.replace(/[^\w]+/g, '-').toLowerCase()}-variance-${a.period}.xlsx`)
}

export type { Flag, Report }
