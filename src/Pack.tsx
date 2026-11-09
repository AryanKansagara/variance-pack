import { useEffect, useState } from 'react'
import { Bridge } from './Bridge.tsx'
import { money, pctText } from './engine/commentary.ts'
import { BASIS_LABEL } from './engine/variance.ts'
import { exportXlsx, useAnalysis, useProject } from './projectData.ts'
import { getDefaults } from './store.ts'
import { fmtMonth, fmtPct, fmtUsd, Link, NotFound, SyntheticBadge, ThemeToggle, toast } from './ui.tsx'

export default function Pack({ id }: { id: string }) {
  const { loading, project: p, ds } = useProject(id)
  const a = useAnalysis(p, ds)
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [preparer, setPreparer] = useState(getDefaults().preparer)
  useEffect(() => { if (p && a.period) document.title = `${p.name} management pack, ${fmtMonth(a.period)}` }, [p?.name, a.period])
  if (loading) return <div className="boot" role="status"><span className="spinner" /> Loading</div>
  if (!p || !a.report) return <><NotFound /></>
  const r = a.report, basis = p.config.basis
  const shown = a.flags.filter(f => !approvedOnly || a.notes[f.row.account]?.status === 'approved')
  const pending = a.flags.length - a.flags.filter(f => a.notes[f.row.account]?.status === 'approved').length
  const kpis = [r.sections.find(s => s.label === 'Revenue'), r.grossProfit, r.sections.find(s => s.label === 'Operating expenses'), r.netIncome].filter(Boolean)

  return (
    <div className="pack-page">
      <div className="pack-bar no-print">
        <Link href={`/app/p/${id}/commentary`} className="btn ghost sm">← Back to commentary</Link>
        <label className="check-field small"><input type="checkbox" checked={approvedOnly} onChange={e => setApprovedOnly(e.target.checked)} /> Approved commentary only</label>
        <label className="field inline small"><span>Prepared by</span><input value={preparer} onChange={e => setPreparer(e.target.value)} placeholder="Your name" /></label>
        <span className="grow" />
        <ThemeToggle />
        <button type="button" className="btn ghost sm" onClick={() => void exportXlsx(p, a, basis).catch(() => toast('Could not build the workbook.', { tone: 'error' }))}>Excel</button>
        <button type="button" className="btn primary sm" onClick={() => print()}>Print or save PDF</button>
      </div>
      {pending > 0 && <p className="banner warn no-print pack-warn">{pending} of {a.flags.length} commentary lines are not approved yet. They print marked as drafts.</p>}
      <article className="pack">
        <header className="pack-cover">
          <div className="monogram lg" aria-hidden="true">VP</div>
          <p className="eyebrow">Management pack</p>
          <h1>{p.name} {p.sampleId && <SyntheticBadge />}</h1>
          <p className="pack-sub">{fmtMonth(a.period!)} · actual vs {BASIS_LABEL[basis]} · {p.config.entities.length > 1 ? `consolidated in ${p.config.reportingCurrency}` : p.config.reportingCurrency}</p>
          <p className="muted small">{preparer ? `Prepared by ${preparer} · ` : ''}{new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}</p>
        </header>

        <section className="pack-sec">
          <h2>Summary</h2>
          <div className="pack-kpis">
            {kpis.map(k => { const v = k!.vs[basis]; return (
              <div key={k!.label}><span className="muted small">{k!.label}</span><b>{fmtUsd(k!.actual)}</b><span className={v.favourable ? 'fav-t' : 'unfav-t'}>{v.amount >= 0 ? '+' : '−'}{money(Math.abs(v.amount))} ({pctText(v.pct)})</span></div>
            ) })}
          </div>
          {r.hasBudget && <div className="pack-bridge"><Bridge report={r} flags={[]} compact /></div>}
        </section>

        <section className="pack-sec">
          <h2>Commentary on material variances</h2>
          <p className="muted small">Accounts at least {fmtUsd(p.config.thresholds.abs)} and {fmtPct(p.config.thresholds.pct)} from {BASIS_LABEL[basis]}. Every figure is computed from the general ledger.</p>
          {!shown.length ? <p className="muted">No commentary to show.</p> : (
            <ol className="pack-notes">{shown.map(f => { const n = a.notes[f.row.account]; return (
              <li key={f.row.account}>
                <div className="pn-head"><b>{f.row.name}</b> <span className="mono muted small">{f.row.account}</span><span className={f.v.favourable ? 'fav-t' : 'unfav-t'}>{f.v.amount >= 0 ? '+' : '−'}{fmtUsd(Math.abs(f.v.amount))} · {pctText(f.v.pct)} {f.v.favourable ? 'F' : 'U'}</span>{n?.status !== 'approved' && <span className="status-tag draft">{n?.status ?? 'draft'}</span>}</div>
                <p>{n?.text}</p>
                {n?.comment && <p className="small muted">Reviewer: {n.comment}</p>}
              </li>
            ) })}</ol>
          )}
        </section>

        <section className="pack-sec break-before">
          <h2>P&amp;L by line</h2>
          <table className="vt pack-table">
            <thead><tr><th>Line</th><th className="num">Actual</th><th className="num">{BASIS_LABEL[basis].replace(/^./, c => c.toUpperCase())}</th><th className="num">Variance</th><th className="num">%</th></tr></thead>
            {r.sections.map(s => (
              <tbody key={s.label}>
                {r.lines.filter(l => l.section === s.label).map(l => { const v = l.vs[basis]; return <tr key={l.label}><td>{l.label}</td><td className="num">{fmtUsd(l.actual)}</td><td className="num">{fmtUsd(v.base)}</td><td className={`num ${v.amount === 0 ? '' : v.favourable ? 'fav-t' : 'unfav-t'}`}>{fmtUsd(v.amount)}</td><td className="num">{v.pct === null ? '–' : pctText(v.pct)}</td></tr> })}
                <tr className="total-row"><th>Total {s.label.toLowerCase()}</th><td className="num">{fmtUsd(s.actual)}</td><td className="num">{fmtUsd(s.vs[basis].base)}</td><td className="num">{fmtUsd(s.vs[basis].amount)}</td><td className="num">{pctText(s.vs[basis].pct)}</td></tr>
              </tbody>
            ))}
            <tbody><tr className="ni-row"><th>Net income</th><td className="num">{fmtUsd(r.netIncome.actual)}</td><td className="num">{fmtUsd(r.netIncome.vs[basis].base)}</td><td className="num">{fmtUsd(r.netIncome.vs[basis].amount)}</td><td className="num">{pctText(r.netIncome.vs[basis].pct)}</td></tr></tbody>
          </table>
          {r.eliminations.items.length > 0 && <p className="small muted">Intercompany eliminated: {r.eliminations.items.map(e => `${e.account} ${e.name}`).join(', ')}. Residual {fmtUsd(r.eliminations.residual, 2)}. FX: {p.config.entities.map(e => `${e.currency} ${e.fx}`).join(', ')}.</p>}
        </section>
        <footer className="pack-foot small muted">{p.sampleId ? 'Synthetic company for demonstration. ' : ''}Prepared with Variance Pack.</footer>
      </article>
    </div>
  )
}
