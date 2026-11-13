import { useEffect, useMemo, useState } from 'react'
import { balanceChecks, detect, isBalanceSheetAccount, parseCsv, parseRows, proposeMapping, tieOut, toCsv, type Detected, type Field, type Kind } from './engine/parse.ts'
import { periodsOf } from './engine/variance.ts'
import { SECTIONS, type Basis, type Config, type Dataset, type Entity, type MapRow, type Section } from './engine/types.ts'
import { putData, saveProject, uuid, type ImportMeta, type Project } from './store.ts'
import { ask, download, fmtMonth, fmtUsd, Link, Modal, toast } from './ui.tsx'

export default function Data({ project: p, ds }: { project: Project; ds: Dataset }) {
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    if (new URLSearchParams(location.search).get('import') === '1') { history.replaceState({}, '', location.pathname); if (!p.sampleId) setImporting(true) }
  }, [p.sampleId])
  const setCfg = (patch: Partial<Config>) => void saveProject({ ...p, config: { ...p.config, ...patch } })
  const checks = useMemo(() => balanceChecks(ds.actuals), [ds])
  const ties = useMemo(() => ds.tb?.length ? tieOut(ds.actuals, ds.tb) : [], [ds])
  const seen = useMemo(() => [...new Set(ds.actuals.map(l => l.account))], [ds])
  const unmapped = seen.filter(a => !p.config.mapping.some(m => m.account === a) && !/^[123]/.test(a) && !p.config.balanceSheet?.includes(a))

  return (
    <div className="stack-lg data-tab">
      <div className="card pad">
        <div className="row between wrap gap">
          <div><h2 className="h4">Imports</h2><p className="muted small">Re-importing a month for an entity replaces it. Files are parsed in your browser.</p></div>
          <div className="row gap-sm wrap">
            <Link href="/docs" className="btn ghost sm">Export steps</Link>
            <button type="button" className="btn primary sm" disabled={!!p.sampleId} onClick={() => setImporting(true)}>Import file</button>
          </div>
        </div>
        {p.sampleId && <p className="small muted">This is a synthetic company, so its ledger cannot be replaced. Mapping, FX and thresholds below are editable. Create a new close pack to import your own data.</p>}
        {p.imports.length > 0 && <table className="vt compact"><thead><tr><th>File</th><th>Type</th><th>Format</th><th className="num">Rows</th><th>Periods</th><th>Issues</th></tr></thead>
          <tbody>{[...p.imports].reverse().map(i => <tr key={i.id}><th scope="row">{i.fileName}</th><td>{i.kind === 'tb' ? 'Tie-out TB' : i.kind}</td><td className="muted">{i.format}</td><td className="num">{i.rows.toLocaleString()}</td><td className="small">{i.periods.length ? `${i.periods[0]} to ${i.periods[i.periods.length - 1]}` : ''}</td><td className={i.issues ? 'warn-t' : 'muted'}>{i.issues || 'none'}</td></tr>)}</tbody></table>}
      </div>

      <div className="card pad">
        <h2 className="h4">Ledger checks</h2>
        {!checks.length ? <p className="muted small">Nothing imported yet.</p> : <>
          <ul className="checks">{checks.slice(-8).map(c => (
            <li key={`${c.entity}${c.period}`} className={c.ok ? 'ok' : c.pnlOnly ? 'info' : 'bad'}>
              <b>{c.entity} · {fmtMonth(c.period)}</b> debits {fmtUsd(c.debit, 2)} · credits {fmtUsd(c.credit, 2)} · {c.ok ? 'balanced' : c.pnlOnly ? `P&L-only extract (out by ${fmtUsd(c.diff, 2)}, expected without balance sheet lines)` : `out of balance by ${fmtUsd(c.diff, 2)}`}
            </li>))}
          </ul>
          {checks.length > 8 && <p className="muted small">Showing the latest 8 of {checks.length} entity-months; {checks.filter(c => !c.ok && !c.pnlOnly).length} out of balance in total.</p>}
          {ds.tb && (ties.length ? <p className="warn-t small">Trial balance does not tie to the GL on {ties.length} account-months, largest {ties[0].account} {fmtMonth(ties[0].period)} by {fmtUsd(ties[0].diff, 2)}.</p> : <p className="fav-t small">Trial balance ties to the GL detail on every account.</p>)}
        </>}
      </div>

      <div className="card pad">
        <h2 className="h4">Materiality and comparison</h2>
        <div className="row gap wrap">
          <label className="field"><span>Dollar threshold</span><input type="number" min={0} step={500} defaultValue={p.config.thresholds.abs} onBlur={e => setCfg({ thresholds: { ...p.config.thresholds, abs: Math.max(0, +e.target.value || 0) } })} /></label>
          <label className="field"><span>Percent threshold</span><input type="number" min={0} step={1} defaultValue={Math.round(p.config.thresholds.pct * 1000) / 10} onBlur={e => setCfg({ thresholds: { ...p.config.thresholds, pct: Math.max(0, +e.target.value || 0) / 100 } })} /></label>
          <label className="field"><span>Commentary written against</span><select value={p.config.basis} onChange={e => setCfg({ basis: e.target.value as Basis })}><option value="budget">Budget</option><option value="mom">Prior month</option><option value="yoy">Same month last year</option></select></label>
        </div>
        <p className="muted small">An account is flagged only when its variance is at least the dollar amount <b>and</b> at least the percent. Accounts with no comparison amount trip on dollars alone.</p>
      </div>

      <Entities p={p} ds={ds} setCfg={setCfg} />
      <Mapping p={p} unmapped={unmapped} setCfg={setCfg} />

      {!p.sampleId && ds.actuals.length > 0 && (
        <div className="card pad danger-zone">
          <h2 className="h4">Clear imported data</h2>
          <p className="muted small">Removes the ledger and budget from this pack. Mapping, commentary and snapshots stay.</p>
          <button type="button" className="btn danger-ghost sm" onClick={async () => {
            if (!(await ask('Clear imported data?', 'The ledger, budget and tie-out trial balance are removed from this device. You can undo for a few seconds.', 'Clear data'))) return
            const prev = ds, prevImports = p.imports
            await putData(p.id, { actuals: [], budget: [] })
            await saveProject({ ...p, imports: [] })
            toast('Imported data cleared.', { undo: async () => { await putData(p.id, prev); await saveProject({ ...p, imports: prevImports }) } })
          }}>Clear data</button>
        </div>
      )}
      <ImportWizard open={importing} onClose={() => setImporting(false)} p={p} ds={ds} />
    </div>
  )
}

function Entities({ p, ds, setCfg }: { p: Project; ds: Dataset; setCfg(c: Partial<Config>): void }) {
  const ids = [...new Set([...p.config.entities.map(e => e.id), ...ds.actuals.map(l => l.entity)])]
  const ents: Entity[] = ids.map(id => p.config.entities.find(e => e.id === id) ?? { id, name: id, currency: p.config.reportingCurrency, fx: 1 })
  const set = (id: string, patch: Partial<Entity>) => setCfg({ entities: ents.map(e => e.id === id ? { ...e, ...patch } : e) })
  return (
    <div className="card pad">
      <div className="row between wrap gap"><h2 className="h4">Entities and FX</h2>
        <label className="field inline"><span>Reporting currency</span><input className="short" defaultValue={p.config.reportingCurrency} onBlur={e => setCfg({ reportingCurrency: e.target.value.toUpperCase().slice(0, 3) || 'USD' })} /></label>
      </div>
      {!ents.length ? <p className="muted small">Entities appear here after you import actuals.</p> : (
        <table className="vt compact">
          <thead><tr><th>Entity</th><th>Name</th><th>Currency</th><th className="num">Rate to {p.config.reportingCurrency}</th></tr></thead>
          <tbody>{ents.map(e => <tr key={e.id}><th scope="row" className="mono">{e.id}</th>
            <td><input aria-label={`Name of ${e.id}`} defaultValue={e.name} onBlur={x => set(e.id, { name: x.target.value || e.id })} /></td>
            <td><input aria-label={`Currency of ${e.id}`} className="short" defaultValue={e.currency} onBlur={x => set(e.id, { currency: x.target.value.toUpperCase().slice(0, 3) })} /></td>
            <td className="num"><input aria-label={`FX rate for ${e.id}`} type="number" step="0.0001" min="0" className="short num" defaultValue={e.fx} onBlur={x => { const v = +x.target.value; if (v > 0) set(e.id, { fx: v }); else toast('The FX rate must be above zero.', { tone: 'error' }) }} /></td></tr>)}</tbody>
        </table>
      )}
      <p className="muted small">One rate per entity, applied to actuals and budget. Use your month-end or average rate per policy; the intercompany residual on the Overview shows any mismatch.</p>
    </div>
  )
}

function Mapping({ p, unmapped, setCfg }: { p: Project; unmapped: string[]; setCfg(c: Partial<Config>): void }) {
  const [filter, setFilter] = useState('')
  const lines = [...new Set(p.config.mapping.map(m => m.line))].sort()
  const set = (account: string, patch: Partial<MapRow>) => setCfg({ mapping: p.config.mapping.map(m => m.account === account ? { ...m, ...patch } : m) })
  const shown = p.config.mapping.filter(m => !filter || `${m.account} ${m.name} ${m.line}`.toLowerCase().includes(filter.toLowerCase()))
  return (
    <div className="card pad">
      <div className="row between wrap gap">
        <div><h2 className="h4">Chart of accounts mapping</h2><p className="muted small">Each account rolls into a P&amp;L line and section. Revenue-type accounts are favourable when above budget; intercompany accounts are eliminated on consolidation.</p></div>
        <div className="row gap-sm wrap">
          <input aria-label="Filter accounts" placeholder="Filter" value={filter} onChange={e => setFilter(e.target.value)} />
          <button type="button" className="btn ghost sm" onClick={() => download('mapping.csv', toCsv([['account', 'name', 'line', 'section', 'kind', 'intercompany'], ...p.config.mapping.map(m => [m.account, m.name, m.line, m.section, m.kind, m.intercompany ? 'yes' : ''])]))}>Download CSV</button>
        </div>
      </div>
      {unmapped.length > 0 && <div className="banner warn row between wrap gap-sm"><span>{unmapped.length} P&amp;L account{unmapped.length > 1 ? 's' : ''} in the ledger {unmapped.length > 1 ? 'are' : 'is'} not mapped: {unmapped.slice(0, 6).join(', ')}{unmapped.length > 6 ? '…' : ''}</span>
        <button type="button" className="btn primary sm" onClick={() => { const add = proposeMapping(unmapped.map(a => ({ code: a, name: `Account ${a}` })), p.config.mapping); setCfg({ mapping: [...p.config.mapping, ...add].sort((x, y) => x.account.localeCompare(y.account)) }); toast(`Mapped ${add.length} accounts. Review the lines below.`, { tone: 'ok' }) }}>Propose mapping</button></div>}
      <datalist id="pl-lines">{lines.map(l => <option key={l} value={l} />)}</datalist>
      <div className="scroll-x"><table className="vt compact map-table">
        <thead><tr><th>Account</th><th>Name</th><th>P&amp;L line</th><th>Section</th><th>Type</th><th>IC</th></tr></thead>
        <tbody>{shown.map(m => <tr key={m.account}>
          <th scope="row" className="mono">{m.account}</th>
          <td><input aria-label={`Name for ${m.account}`} defaultValue={m.name} onBlur={e => e.target.value !== m.name && set(m.account, { name: e.target.value })} /></td>
          <td><input aria-label={`Line for ${m.account}`} list="pl-lines" defaultValue={m.line} onBlur={e => e.target.value && e.target.value !== m.line && set(m.account, { line: e.target.value })} /></td>
          <td><select aria-label={`Section for ${m.account}`} value={m.section} onChange={e => set(m.account, { section: e.target.value as Section })}>{SECTIONS.map(s => <option key={s}>{s}</option>)}</select></td>
          <td><select aria-label={`Type for ${m.account}`} value={m.kind} onChange={e => set(m.account, { kind: e.target.value as MapRow['kind'] })}><option value="revenue">Revenue</option><option value="expense">Expense</option></select></td>
          <td><input type="checkbox" aria-label={`Intercompany ${m.account}`} checked={!!m.intercompany} onChange={e => set(m.account, { intercompany: e.target.checked })} /></td>
        </tr>)}</tbody>
      </table></div>
    </div>
  )
}

// ---------- Import wizard ----------

const FIELDS: Record<Kind, [Field, string, boolean][]> = {
  actuals: [['account', 'Account', true], ['accountName', 'Account name', false], ['period', 'Period', false], ['date', 'Date', false], ['debit', 'Debit', false], ['credit', 'Credit', false], ['amount', 'Signed amount', false], ['vendor', 'Vendor / name', false], ['dept', 'Department', false], ['memo', 'Memo', false], ['entity', 'Entity', false], ['units', 'Units', false]],
  budget: [['account', 'Account', true], ['period', 'Period', false], ['amount', 'Amount', false], ['entity', 'Entity', false], ['units', 'Units', false]],
  mapping: [['account', 'Account', true], ['accountName', 'Name', false], ['line', 'P&L line', true], ['section', 'Section', false], ['kind', 'Type', false], ['intercompany', 'Intercompany', false]],
}

function ImportWizard({ open, onClose, p, ds }: { open: boolean; onClose(): void; p: Project; ds: Dataset }) {
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null)
  const [det, setDet] = useState<Detected | null>(null)
  const [entity, setEntity] = useState(p.config.entities[0]?.id ?? 'MAIN')
  const [period, setPeriod] = useState('')
  const [asTb, setAsTb] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const reset = () => { setFile(null); setDet(null); setErr(null); setAsTb(false) }
  const parsed = useMemo(() => file && det ? parseRows(file.rows, det, { entity, period: period || undefined }) : null, [file, det, entity, period])
  const balance = useMemo(() => parsed && det?.kind === 'actuals' ? balanceChecks(parsed.actuals) : [], [parsed, det])

  const read = async (f: File) => {
    setBusy(true); setErr(null)
    try {
      let rows: string[][]
      if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) {
        const XLSX = await import('xlsx')
        const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        rows = (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', dateNF: 'yyyy-mm-dd' }) as unknown[][]).map(r => r.map(c => String(c ?? '').trim()))
      } else rows = parseCsv(await f.text())
      if (!rows.length) throw new Error('The file is empty.')
      const d = detect(rows)
      setFile({ name: f.name, rows }); setDet(d); setPeriod(d.period ?? '')
      if (d.columns.entity === undefined && !p.config.entities.length) setEntity('MAIN')
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const commit = async () => {
    if (!parsed || !det || !file) return
    let next: Dataset = { ...ds }
    let mapping = p.config.mapping
    let bsAdd: string[] = []
    if (det.kind === 'mapping') {
      const byAcc = new Map(mapping.map(m => [m.account, m]))
      for (const m of parsed.mapping) byAcc.set(m.account, m)
      mapping = [...byAcc.values()].sort((a, b) => a.account.localeCompare(b.account))
    } else if (det.kind === 'budget') {
      const keys = new Set(parsed.budget.map(b => `${b.entity}|${b.period}`))
      next = { ...next, budget: [...ds.budget.filter(b => !keys.has(`${b.entity}|${b.period}`)), ...parsed.budget] }
    } else {
      const keys = new Set(parsed.actuals.map(l => `${l.entity}|${l.period}`))
      if (asTb) next = { ...next, tb: [...(ds.tb ?? []).filter(l => !keys.has(`${l.entity}|${l.period}`)), ...parsed.actuals] }
      else next = { ...next, actuals: [...ds.actuals.filter(l => !keys.has(`${l.entity}|${l.period}`)), ...parsed.actuals] }
    }
    if (det.kind !== 'mapping') {
      const accts = [...new Set([...parsed.actuals.map(l => l.account), ...parsed.budget.map(b => b.account)])]
      const add = proposeMapping(accts.map(code => ({ code, name: parsed.names[code] ?? code, type: parsed.types[code] })), mapping)
      mapping = [...mapping, ...add].sort((a, b) => a.account.localeCompare(b.account))
      const mapped = new Set(mapping.map(m => m.account))
      bsAdd = accts.filter(a => !mapped.has(a) && isBalanceSheetAccount(a, parsed.names[a] ?? a, parsed.types[a]))
    }
    const entIds = [...new Set([...next.actuals.map(l => l.entity), ...next.budget.map(b => b.entity)])]
    const entities = [...p.config.entities, ...entIds.filter(id => !p.config.entities.some(e => e.id === id)).map(id => ({ id, name: id, currency: p.config.reportingCurrency, fx: 1 }))]
    const meta: ImportMeta = { id: uuid(), kind: det.kind === 'actuals' && asTb ? 'tb' : det.kind, fileName: file.name, format: det.format, rows: parsed.actuals.length + parsed.budget.length + parsed.mapping.length, issues: parsed.issues.length, periods: parsed.periods, at: Date.now() }
    await putData(p.id, next)
    const periods = periodsOf(next)
    await saveProject({ ...p, imports: [...p.imports, meta], config: { ...p.config, mapping, entities, ...(bsAdd.length ? { balanceSheet: [...new Set([...(p.config.balanceSheet ?? []), ...bsAdd])] } : {}) }, period: periods[periods.length - 1] ?? p.period })
    toast(`Imported ${meta.rows.toLocaleString()} rows from ${file.name}.`, { tone: 'ok' })
    reset(); onClose()
  }

  const setCol = (f: Field, v: string) => det && setDet({ ...det, columns: { ...det.columns, [f]: v === '' ? undefined : +v } })
  const needsPeriod = det && det.kind !== 'mapping' && det.columns.period === undefined && det.columns.date === undefined && (det.kind === 'actuals' || !Object.keys(det.monthColumns).length)

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="Import data" wide>
      {!file ? (
        <div className="stack">
          <label className={`drop${busy ? ' busy' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void read(f) }}>
            <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,.xlsm" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void read(f) }} />
            <strong>{busy ? 'Reading…' : 'Drop a CSV or Excel file, or click to choose'}</strong>
            <span className="muted small">Trial balance, GL detail, budget (long or one column per month), or a chart-of-accounts mapping. The format is detected for you.</span>
          </label>
          {err && <p className="error" role="alert">{err}</p>}
          <p className="small muted">Not sure what to export? <Link href="/docs">Step-by-step for QuickBooks Online, Xero, NetSuite and Sage Intacct</Link>.</p>
        </div>
      ) : det && parsed && (
        <div className="stack">
          <div className="row between wrap gap-sm">
            <div><b>{file.name}</b> <span className="chip">{det.format}</span> <span className="muted small">header on line {det.headerRow + 1}</span></div>
            <button type="button" className="btn ghost sm" onClick={reset}>Choose another file</button>
          </div>
          <div className="row gap wrap">
            <label className="field"><span>This file is</span><select value={det.kind} onChange={e => setDet({ ...det, kind: e.target.value as Kind })}><option value="actuals">Actuals (TB or GL detail)</option><option value="budget">Budget or forecast</option><option value="mapping">Chart-of-accounts mapping</option></select></label>
            {det.kind !== 'mapping' && det.columns.entity === undefined && <label className="field"><span>Entity</span><input value={entity} onChange={e => setEntity(e.target.value.trim() || 'MAIN')} list="ents" /><datalist id="ents">{p.config.entities.map(e => <option key={e.id} value={e.id} />)}</datalist></label>}
            {needsPeriod && <label className="field"><span>Period (no date column)</span><input type="month" value={period} onChange={e => setPeriod(e.target.value)} required /></label>}
            {det.kind === 'actuals' && ds.actuals.length > 0 && <label className="check-field"><input type="checkbox" checked={asTb} onChange={e => setAsTb(e.target.checked)} /> Use only to tie out against the GL already imported</label>}
          </div>
          <details open={parsed.issues.length > 0 || !parsed.actuals.length && !parsed.budget.length && !parsed.mapping.length}>
            <summary>Column mapping</summary>
            <div className="colmap">
              {FIELDS[det.kind].map(([f, l, req]) => (
                <label key={f} className="field"><span>{l}{req && ' *'}</span>
                  <select value={det.columns[f] ?? ''} onChange={e => setCol(f, e.target.value)}>
                    <option value="">Not in file</option>
                    {det.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {det.kind === 'budget' && Object.keys(det.monthColumns).length > 0 && <p className="small muted">Month columns: {Object.values(det.monthColumns).map(fmtMonth).join(', ')}</p>}
          </details>
          <div className="validation">
            <div className="v-sum">
              <span><b>{(parsed.actuals.length + parsed.budget.length + parsed.mapping.length).toLocaleString()}</b> rows ready</span>
              <span>{parsed.skipped} skipped (totals, blanks, zero)</span>
              <span className={parsed.issues.length ? 'warn-t' : 'fav-t'}><b>{parsed.issues.length}</b> issues</span>
              {parsed.periods.length > 0 && <span>{parsed.periods.length === 1 ? fmtMonth(parsed.periods[0]) : `${fmtMonth(parsed.periods[0])} to ${fmtMonth(parsed.periods[parsed.periods.length - 1])}`}</span>}
              {det.kind === 'actuals' && <span>{parsed.hasDetail ? 'GL detail (drivers available)' : 'Trial balance (no vendor detail)'}</span>}
            </div>
            {balance.length > 0 && <ul className="checks small">{balance.slice(-4).map(c => <li key={c.entity + c.period} className={c.ok ? 'ok' : c.pnlOnly ? 'info' : 'bad'}>{c.entity} {fmtMonth(c.period)}: {c.ok ? 'debits equal credits' : c.pnlOnly ? `P&L only, net ${fmtUsd(c.diff, 2)}` : `out of balance by ${fmtUsd(c.diff, 2)}`}</li>)}</ul>}
            {parsed.issues.length > 0 && <ul className="issues">{parsed.issues.slice(0, 50).map((i, k) => <li key={k}><span className="mono">Line {i.line}</span> {i.message}</li>)}{parsed.issues.length > 50 && <li className="muted">…and {parsed.issues.length - 50} more</li>}</ul>}
          </div>
          <div className="row end gap">
            <button type="button" className="btn ghost" onClick={() => { reset(); onClose() }}>Cancel</button>
            <button type="button" className="btn primary" disabled={(!parsed.actuals.length && !parsed.budget.length && !parsed.mapping.length) || !!(needsPeriod && !period)} onClick={() => void commit()}>Import {parsed.issues.length ? 'valid rows' : ''}</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
