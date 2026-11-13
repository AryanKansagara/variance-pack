import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Bridge } from './Bridge.tsx'
import { draft, facts, money, monthName, pctText, signedPct, type Note, type Status } from './engine/commentary.ts'
import { BASIS_LABEL, drivers as driversOf, shift, type AccountRow, type Flag, type Rollup } from './engine/variance.ts'
import type { Basis, Dataset } from './engine/types.ts'
import { basisLabel, checkFor, exportXlsx, snapshotOf, useAnalysis, useProject, type Analysis } from './projectData.ts'
import { saveProject, type CheckStatus, type Project as P, type Snapshot } from './store.ts'
import { deleteSnapshotCloud } from './sync.ts'
import { Empty, fmtMonth, fmtMonthShort, fmtPct, fmtUsd, go, isTyping, Link, Modal, NotFound, SyntheticBadge, toast, download } from './ui.tsx'
import { toCsv } from './engine/parse.ts'

const Data = lazy(() => import('./Data.tsx'))

const TABS = [['overview', 'Overview'], ['commentary', 'Commentary'], ['checklist', 'Flux checklist'], ['history', 'History'], ['data', 'Data & mapping']] as const

export default function ProjectView({ id, tab }: { id: string; tab: string }) {
  const { loading, project, ds, update } = useProject(id)
  const [entity, setEntity] = useState('all')
  const [basis, setBasis] = useState<Basis | null>(null)
  const b = basis ?? project?.config.basis ?? 'budget'
  const a = useAnalysis(project, ds, entity, b)
  const [account, setAccount] = useState<string | null>(null)
  useEffect(() => { if (project) document.title = `${project.name} · Variance Pack` }, [project?.name])

  if (loading) return <div className="boot" role="status"><span className="spinner" /> Loading</div>
  if (!project || !ds) return <NotFound />
  const noData = !ds.actuals.length || !project.config.mapping.length
  const t = TABS.some(([k]) => k === tab) ? tab : 'overview'

  return (
    <section className="page project">
      <div className="proj-head">
        <div>
          <p className="eyebrow"><Link href="/app">Close packs</Link> / {project.sampleId ? 'Synthetic company' : 'Your data'}</p>
          <h1>{project.name} {project.sampleId && <SyntheticBadge />}</h1>
        </div>
        {!noData && a.period && (
          <div className="controls">
            <label className="field inline"><span>Period</span>
              <select value={a.period} onChange={e => void update({ period: e.target.value })}>{[...a.periods].reverse().map(p => <option key={p} value={p}>{fmtMonth(p)}</option>)}</select>
            </label>
            {project.config.entities.length > 1 && (
              <label className="field inline"><span>Entity</span>
                <select value={entity} onChange={e => setEntity(e.target.value)}>
                  <option value="all">Consolidated ({project.config.reportingCurrency})</option>
                  {project.config.entities.map(en => <option key={en.id} value={en.id}>{en.name}</option>)}
                </select>
              </label>
            )}
            <div className="seg" role="group" aria-label="Compare against">
              {(['budget', 'mom', 'yoy'] as const).map(k => <button key={k} type="button" aria-pressed={b === k} onClick={() => setBasis(k)}>{k === 'budget' ? 'vs Budget' : k === 'mom' ? 'MoM' : 'YoY'}</button>)}
            </div>
          </div>
        )}
      </div>
      {project.dataMissing && <div className="banner warn">This pack was synced from another device and its ledger was too large to sync. Mapping, commentary and snapshots are here; re-import the ledger on this device to recompute.</div>}
      <nav className="tabs" aria-label="Pack sections">
        {TABS.map(([k, l]) => <Link key={k} href={`/app/p/${id}${k === 'overview' ? '' : '/' + k}`} aria-current={t === k ? 'page' : undefined}>{l}{k === 'commentary' && a.flags.length > 0 && <span className="count">{a.flags.length}</span>}</Link>)}
        <span className="tabs-spacer" />
        {!noData && a.report && <>
          <button type="button" className="btn ghost sm" onClick={() => void exportXlsx(project, a, b).catch(() => toast('Could not build the workbook.', { tone: 'error' }))}>Excel</button>
          <Link href={`/app/p/${id}/pack`} className="btn primary sm">Board pack</Link>
        </>}
      </nav>

      {t === 'data' ? <Suspense fallback={<div className="boot"><span className="spinner" /></div>}><Data project={project} ds={ds} /></Suspense>
        : noData ? (
          <Empty title="Import a ledger to start the close">
            <p className="muted">Bring a trial balance or GL detail for the current and prior month, plus a budget. Mapping is proposed from your account numbers and names.</p>
            <div className="row gap center-x"><Link href={`/app/p/${id}/data?import=1`} className="btn primary">Import data</Link><Link href="/docs" className="btn outline">Export steps by system</Link></div>
          </Empty>
        ) : !a.report ? null
          : t === 'overview' ? <Overview p={project} a={a} basis={b} onAccount={setAccount} />
            : t === 'commentary' ? <Commentary p={project} a={a} basis={b} onAccount={setAccount} />
              : t === 'checklist' ? <Checklist p={project} a={a} />
                : <History p={project} a={a} />}

      <AccountModal p={project} ds={ds} a={a} basis={b} entity={entity} account={account} onClose={() => setAccount(null)} />
    </section>
  )
}

// ---------- Overview ----------

function Kpi({ r, basis, label }: { r: Rollup; basis: Basis; label: string }) {
  const v = r.vs[basis]
  return (
    <div className="kpi card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{money(r.actual)}</div>
      <div className={`kpi-var ${v.amount === 0 ? '' : v.favourable ? 'fav-t' : 'unfav-t'}`}>{v.amount >= 0 ? '+' : '−'}{money(Math.abs(v.amount))} ({pctText(v.pct)}) vs {BASIS_LABEL[basis]}</div>
    </div>
  )
}

function Overview({ p, a, basis, onAccount }: { p: P; a: Analysis; basis: Basis; onAccount(acc: string): void }) {
  const r = a.report!
  const opex = r.sections.find(s => s.label === 'Operating expenses')
  const rev = r.sections.find(s => s.label === 'Revenue')
  const [open, setOpen] = useState<Set<string>>(() => new Set(r.lines.filter(l => l.accounts.some(x => x.vs[basis].flagged)).map(l => l.label)))
  const flagged = new Set(a.flags.map(f => f.row.account))
  const approved = a.flags.filter(f => a.notes[f.row.account]?.status === 'approved').length
  return (
    <div className="stack-lg">
      {r.unmapped.length > 0 && <div className="banner warn">{r.unmapped.length} P&amp;L account{r.unmapped.length > 1 ? 's are' : ' is'} not mapped ({r.unmapped.slice(0, 4).map(u => u.account).join(', ')}{r.unmapped.length > 4 ? '…' : ''}), so {r.unmapped.length > 1 ? 'they are' : 'it is'} left out of the P&amp;L. <Link href={`/app/p/${p.id}/data`}>Map them</Link>.</div>}
      {basis === 'budget' && !r.hasBudget && <div className="banner warn">No budget for {fmtMonth(r.period)}. <Link href={`/app/p/${p.id}/data?import=1`}>Import one</Link> or switch to MoM.</div>}
      {basis === 'mom' && !r.hasPrior && <div className="banner warn">No actuals for {fmtMonth(shift(r.period, -1))}, so month-over-month compares against zero.</div>}
      {basis === 'yoy' && !r.hasLastYear && <div className="banner warn">No actuals for {fmtMonth(shift(r.period, -12))}, so year-over-year compares against zero.</div>}
      <div className="kpis">
        {rev && <Kpi r={rev} basis={basis} label="Revenue" />}
        <Kpi r={r.grossProfit} basis={basis} label="Gross profit" />
        {opex && <Kpi r={opex} basis={basis} label="Operating expenses" />}
        <Kpi r={r.netIncome} basis={basis} label="Net income" />
        <div className="kpi card kpi-flags">
          <div className="kpi-label">Flagged for commentary</div>
          <div className="kpi-value">{a.flags.length}</div>
          <div className="kpi-var muted">{approved} approved · ≥{fmtUsd(p.config.thresholds.abs)} and ≥{fmtPct(p.config.thresholds.pct)}</div>
        </div>
      </div>
      {r.hasBudget && (
        <div className="card pad">
          <div className="row between wrap gap-sm"><h2 className="h4">Net income bridge, budget to actual</h2><span className="muted small">{fmtMonth(r.period)} · {r.scope.entity === 'all' ? 'consolidated' : r.scope.entity}</span></div>
          <Bridge report={r} flags={basis === 'budget' ? a.flags : []} onOpenAccount={onAccount} />
        </div>
      )}
      {r.eliminations.items.length > 0 && (
        <div className="card pad elim">
          <h2 className="h4">Intercompany eliminated</h2>
          <p className="muted small">{r.eliminations.items.map(e => `${e.account} ${e.name} (${e.byEntity.map(x => `${x.entity} ${fmtUsd(x.net)}`).join(', ')})`).join(' · ')}</p>
          <p className={Math.abs(r.eliminations.residual) < 1.01 ? 'small' : 'small unfav-t'}>Residual after elimination: <b>{fmtUsd(r.eliminations.residual, 2)}</b>{Math.abs(r.eliminations.residual) >= 0.01 && ' (both sides are not booked at the same rate; check the FX rate on the Data tab)'}</p>
        </div>
      )}
      <div className="card table-card">
        <table className="vt">
          <caption className="sr-only">Variance by account</caption>
          <thead><tr><th scope="col">Account</th><th scope="col" className="num">Actual</th><th scope="col" className="num">{basisLabel(basis)}</th><th scope="col" className="num">Var $</th><th scope="col" className="num">Var %</th><th scope="col"><span className="sr-only">Flag</span></th></tr></thead>
          {r.sections.map(s => (
            <tbody key={s.label}>
              <tr className="sec-row"><th scope="rowgroup" colSpan={6}>{s.label}</th></tr>
              {r.lines.filter(l => l.section === s.label).map(l => {
                const isOpen = open.has(l.label)
                return [
                  <tr key={l.label} className="line-row" onClick={() => setOpen(o => { const n = new Set(o); if (n.has(l.label)) n.delete(l.label); else n.add(l.label); return n })}>
                    <th scope="row"><button type="button" className="disclose" aria-expanded={isOpen}><i aria-hidden="true">{isOpen ? '▾' : '▸'}</i>{l.label}</button></th>
                    <VarCells r={l} basis={basis} />
                    <td />
                  </tr>,
                  ...(isOpen ? l.accounts.map(acc => (
                    <tr key={acc.account} className={`acc-row${flagged.has(acc.account) ? ' flagged' : ''}`} onClick={() => onAccount(acc.account)}>
                      <th scope="row"><button type="button" className="acc-btn"><span className="mono">{acc.account}</span> {acc.name}</button></th>
                      <VarCells r={acc} basis={basis} />
                      <td>{flagged.has(acc.account) && <span className="flag-dot" title="Flagged for commentary">●<span className="sr-only">Flagged</span></span>}</td>
                    </tr>
                  )) : []),
                ]
              })}
              <tr className="total-row"><th scope="row">Total {s.label.toLowerCase()}</th><VarCells r={s} basis={basis} /><td /></tr>
            </tbody>
          ))}
          <tbody><tr className="ni-row"><th scope="row">Net income</th><VarCells r={r.netIncome} basis={basis} /><td /></tr></tbody>
        </table>
      </div>
    </div>
  )
}

function VarCells({ r, basis }: { r: AccountRow | Rollup; basis: Basis }) {
  const v = r.vs[basis]
  const cls = v.amount === 0 ? '' : v.favourable ? 'fav-t' : 'unfav-t'
  return <>
    <td className="num">{fmtUsd(r.actual)}</td>
    <td className="num muted">{fmtUsd(v.base)}</td>
    <td className={`num ${cls}`}>{v.amount > 0 ? '+' : v.amount < 0 ? '−' : ''}{fmtUsd(Math.abs(v.amount))}</td>
    <td className={`num ${cls}`}>{signedPct(v.pct)}</td>
  </>
}

// ---------- Commentary ----------

const STATUSES: Status[] = ['draft', 'reviewed', 'approved']

export function saveNote(p: P, period: string, account: string, note: Note) {
  return saveProject({ ...p, notes: { ...p.notes, [`${period}|${account}`]: { ...note, updatedAt: Date.now() } } })
}

function Commentary({ p, a, basis, onAccount }: { p: P; a: Analysis; basis: Basis; onAccount(acc: string): void }) {
  const [focus, setFocus] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])
  const period = a.period!
  const counts = STATUSES.map(s => a.flags.filter(f => (a.notes[f.row.account]?.status ?? 'draft') === s).length)
  const setStatus = (f: Flag, status: Status) => void saveNote(p, period, f.row.account, { ...a.notes[f.row.account], status })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return
      const f = a.flags[focus]
      if (e.key === 'j' || e.key === 'k') {
        const n = Math.max(0, Math.min(a.flags.length - 1, focus + (e.key === 'j' ? 1 : -1)))
        setFocus(n); refs.current[n]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); refs.current[n]?.focus({ preventScroll: true })
      } else if (f && e.key === 'r') setStatus(f, 'reviewed')
      else if (f && e.key === 'a') setStatus(f, 'approved')
      else if (f && e.key === 'e') { e.preventDefault(); refs.current[focus]?.querySelector('textarea')?.focus() }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })
  if (basis !== 'budget' && basis !== p.config.basis) {
    return <div className="banner">Commentary is written against {BASIS_LABEL[p.config.basis]}. Switch the comparison back to <b>{basisLabel(p.config.basis)}</b>, or change the pack's default basis on the Data tab.</div>
  }
  if (!a.flags.length) return <Empty title="Nothing crosses materiality this month"><p className="muted">No account is over both {fmtUsd(p.config.thresholds.abs)} and {fmtPct(p.config.thresholds.pct)} against {BASIS_LABEL[basis]}. Lower the thresholds on the Data tab if your policy is tighter.</p></Empty>
  return (
    <div className="stack">
      <div className="row between wrap gap">
        <div className="status-bar" aria-label="Review progress">
          {STATUSES.map((s, i) => <span key={s} className={`sb ${s}`} style={{ flex: Math.max(counts[i], 0.001) }}>{counts[i] > 0 && `${counts[i]} ${s}`}</span>)}
        </div>
        <div className="row gap-sm wrap">
          <span className="muted small kbd-hint"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>e</kbd> edit · <kbd>r</kbd> reviewed · <kbd>a</kbd> approve</span>
          <button type="button" className="btn ghost sm" disabled={!counts[1]} onClick={() => {
            const notes = { ...p.notes }
            for (const f of a.flags) if (a.notes[f.row.account]?.status === 'reviewed') notes[`${period}|${f.row.account}`] = { ...a.notes[f.row.account], status: 'approved', updatedAt: Date.now() }
            void saveProject({ ...p, notes }); toast(`Approved ${counts[1]} reviewed line${counts[1] > 1 ? 's' : ''}.`, { tone: 'ok', undo: () => void saveProject(p) })
          }}>Approve all reviewed</button>
        </div>
      </div>
      {a.flags.map((f, i) => <NoteCard key={f.row.account} p={p} f={f} note={a.notes[f.row.account]} period={period} active={i === focus} onFocus={() => setFocus(i)} refEl={el => { refs.current[i] = el }} onAccount={onAccount} />)}
    </div>
  )
}

function NoteCard({ p, f, note, period, active, onFocus, refEl, onAccount }: { p: P; f: Flag; note: Note; period: string; active: boolean; onFocus(): void; refEl(el: HTMLElement | null): void; onAccount(a: string): void }) {
  const [text, setText] = useState(note.text)
  const [comment, setComment] = useState(note.comment)
  useEffect(() => { setText(note.text); setComment(note.comment) }, [note.text, note.comment])
  const tmpl = draft(f)
  const save = (patch: Partial<Note>) => void saveNote(p, period, f.row.account, { ...note, ...patch })
  const stale = note.edited && note.facts.tokens.join('|') !== facts(f).tokens.join('|')
  return (
    <article ref={refEl} tabIndex={-1} className={`card note ${note.status}${active ? ' active' : ''}`} onFocus={onFocus} onClick={onFocus}>
      <header className="note-head">
        <button type="button" className="linkish" onClick={() => onAccount(f.row.account)}><span className="mono">{f.row.account}</span> <b>{f.row.name}</b></button>
        <span className={`chip ${f.v.favourable ? 'fav' : 'unfav'}`}>{f.v.amount > 0 ? '+' : '−'}{money(Math.abs(f.v.amount))} · {pctText(f.v.pct)}</span>
        <span className={`chip nature-${f.nature}`}>{f.nature}</span>
        {f.drivers.length > 0 && <span className="muted small">drivers explain {Math.round(f.coverage * 100)}%</span>}
        <span className="grow" />
        <div className="stepper" role="group" aria-label="Review status">
          {STATUSES.map(s => <button key={s} type="button" aria-pressed={note.status === s} className={s} onClick={() => save({ status: s })}>{s}</button>)}
        </div>
      </header>
      {f.drivers.length > 0 && <ul className="driver-chips">{f.drivers.map(d => <li key={d.name}><b>{d.name}</b> {d.delta > 0 ? '+' : '−'}{money(Math.abs(d.delta))} <small>{d.tag}{d.memo ? ` · ${d.memo}` : ''}</small></li>)}</ul>}
      {note.carriedFrom && !note.edited && <p className="carried small">Wording carried forward from your {monthName(note.carriedFrom)} edit, with this month's numbers swapped in.</p>}
      {stale && <p className="carried small warn-t">The ledger changed since this was edited. Template now reads: “{tmpl}”</p>}
      <label className="sr-only" htmlFor={`n-${f.row.account}`}>Commentary for {f.row.name}</label>
      <textarea id={`n-${f.row.account}`} rows={3} value={text} onChange={e => setText(e.target.value)}
        onBlur={() => { if (text !== note.text) save({ text, edited: true, facts: facts(f), status: note.status === 'approved' ? 'reviewed' : note.status }) }} />
      <div className="row gap-sm wrap note-foot">
        <input aria-label="Reviewer comment" className="comment" placeholder="Reviewer comment" value={comment} onChange={e => setComment(e.target.value)} onBlur={() => { if (comment !== note.comment) save({ comment }) }} />
        {(note.edited || note.carriedFrom) && <button type="button" className="btn ghost sm" onClick={() => { const prev = note; save({ text: tmpl, edited: false, carriedFrom: undefined, facts: facts(f) }); toast('Reset to the template draft.', { undo: () => save(prev) }) }}>Reset to template</button>}
        {note.edited && <span className="muted small">Edited · carries into next month if {f.drivers[0]?.name ?? 'this driver'} recurs</span>}
      </div>
    </article>
  )
}

// ---------- Flux checklist ----------

const CHECK: [CheckStatus, string][] = [['open', 'Open'], ['in-progress', 'In progress'], ['done', 'Done'], ['n/a', 'N/A']]

function Checklist({ p, a }: { p: P; a: Analysis }) {
  const period = a.period!
  const items = a.flags.map(f => ({ f, c: checkFor(p, period, f.row.account), n: a.notes[f.row.account] }))
  const done = items.filter(i => i.c.status === 'done' || i.c.status === 'n/a').length
  const set = (acc: string, patch: Partial<ReturnType<typeof checkFor>>) => void saveProject({ ...p, checklist: { ...p.checklist, [`${period}|${acc}`]: { ...checkFor(p, period, acc), ...patch } } })
  if (!items.length) return <Empty title="No flagged accounts this month"><p className="muted">The checklist lists every account that crosses materiality.</p></Empty>
  return (
    <div className="stack">
      <div className="row between wrap gap">
        <div className="progress-wrap"><div className="progress"><i style={{ width: `${(done / items.length) * 100}%` }} /></div><span className="small"><b>{done}</b> of {items.length} closed for {fmtMonth(period)}</span></div>
        <button type="button" className="btn ghost sm" onClick={() => download(`flux-checklist-${period}.csv`, toCsv([['account', 'name', 'variance', 'pct', 'nature', 'status', 'owner', 'commentary_status', 'commentary'], ...items.map(i => [i.f.row.account, i.f.row.name, i.f.v.amount, i.f.v.pct === null ? '' : Math.round(i.f.v.pct * 1000) / 10, i.f.nature, i.c.status, i.c.owner, i.n?.status ?? 'draft', i.n?.text ?? ''])]))}>Download CSV</button>
      </div>
      <div className="card table-card">
        <table className="vt check">
          <thead><tr><th scope="col">Account</th><th scope="col" className="num">Variance</th><th scope="col">Nature</th><th scope="col">Commentary</th><th scope="col">Owner</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {items.map(({ f, c, n }) => (
              <tr key={f.row.account} className={c.status === 'done' ? 'done' : ''}>
                <th scope="row"><span className="mono">{f.row.account}</span> {f.row.name}</th>
                <td className={`num ${f.v.favourable ? 'fav-t' : 'unfav-t'}`}>{f.v.amount > 0 ? '+' : '−'}{fmtUsd(Math.abs(f.v.amount))}</td>
                <td><span className={`chip nature-${f.nature}`}>{f.nature}</span></td>
                <td><Link href={`/app/p/${p.id}/commentary`} className={`status-tag ${n?.status ?? 'draft'}`}>{n?.status ?? 'draft'}</Link></td>
                <td><input aria-label={`Owner for ${f.row.name}`} className="owner" defaultValue={c.owner} placeholder="Owner" onBlur={e => { if (e.target.value !== c.owner) set(f.row.account, { owner: e.target.value }) }} /></td>
                <td><select aria-label={`Status for ${f.row.name}`} value={c.status} onChange={e => set(f.row.account, { status: e.target.value as CheckStatus })}>{CHECK.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------- History ----------

function History({ p, a }: { p: P; a: Analysis }) {
  const snaps = [...p.snapshots].sort((x, y) => x.period.localeCompare(y.period) || x.createdAt - y.createdAt)
  const accounts = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of snaps) for (const r of s.rows) m.set(r.account, r.name)
    return [...m].sort((x, y) => x[0].localeCompare(y[0]))
  }, [snaps])
  const firstFlag = snaps.flatMap(s => s.rows.filter(r => r.flagged))[0]?.account
  const [acc, setAcc] = useState<string>(firstFlag ?? accounts[0]?.[0] ?? '')
  const [cmp, setCmp] = useState<[string, string]>([snaps[snaps.length - 2]?.id ?? '', snaps[snaps.length - 1]?.id ?? ''])
  const save = () => {
    const snap = snapshotOf(p, a.report!, a.flags, a.period!)
    void saveProject({ ...p, snapshots: [...p.snapshots, snap] })
    toast(`Saved ${snap.label}.`, { tone: 'ok' })
  }
  const trend = snaps.filter((s, i) => snaps.findLastIndex(x => x.period === s.period) === i).map(s => ({ s, r: s.rows.find(r => r.account === acc) }))
  const maxAbs = Math.max(1, ...trend.map(t => Math.abs(t.r?.variance ?? 0)))
  const A = snaps.find(s => s.id === cmp[0]), B = snaps.find(s => s.id === cmp[1])
  return (
    <div className="stack-lg">
      <div className="row between wrap gap">
        <p className="muted">Save a snapshot when the close is signed off. Each keeps the variance table and the commentary as approved.</p>
        <button type="button" className="btn primary" onClick={save}>Save {fmtMonth(a.period!)} close</button>
      </div>
      {!snaps.length ? <Empty title="No closes saved yet"><p className="muted">Snapshots let you follow an account across months and see what changed between closes.</p></Empty> : <>
        <div className="card pad">
          <div className="row between wrap gap-sm">
            <h2 className="h4">Variance trend by account</h2>
            <label className="field inline"><span>Account</span><select value={acc} onChange={e => setAcc(e.target.value)}>{accounts.map(([k, n]) => <option key={k} value={k}>{k} {n}</option>)}</select></label>
          </div>
          <div className="trend" role="img" aria-label={`Budget variance for ${acc} across saved closes`}>
            {trend.map(({ s, r }) => {
              const v = r?.variance ?? 0
              return (
                <div key={s.id} className="trend-col">
                  <div className="trend-plot">
                    <i className={`tb ${v === 0 ? '' : r?.favourable ? 'fav' : 'unfav'}${r?.flagged ? ' flagged' : ''}`} style={{ height: `${(Math.abs(v) / maxAbs) * 50}%`, [v * (r?.kind === 'revenue' ? 1 : -1) >= 0 ? 'bottom' : 'top']: '50%' }} />
                  </div>
                  <b>{v >= 0 ? '+' : '−'}{money(Math.abs(v))}</b>
                  <span className="muted small">{fmtMonthShort(s.period)}</span>
                </div>
              )
            })}
          </div>
          <ul className="trend-notes">{trend.filter(t => t.r?.note).map(t => <li key={t.s.id}><b>{fmtMonthShort(t.s.period)}</b> {t.r!.note}</li>)}</ul>
        </div>
        <div className="card pad">
          <div className="row between wrap gap-sm">
            <h2 className="h4">Compare two closes</h2>
            <div className="row gap-sm wrap">
              {[0, 1].map(i => <select key={i} aria-label={i ? 'Later close' : 'Earlier close'} value={cmp[i]} onChange={e => setCmp(c => i ? [c[0], e.target.value] : [e.target.value, c[1]])}>{snaps.map(s => <option key={s.id} value={s.id}>{s.label} · {new Date(s.createdAt).toLocaleDateString()}</option>)}</select>)}
            </div>
          </div>
          {A && B && <SnapCompare a={A} b={B} />}
        </div>
        <div className="card table-card">
          <table className="vt">
            <thead><tr><th scope="col">Close</th><th scope="col">Saved</th><th scope="col" className="num">Net income</th><th scope="col" className="num">Budget</th><th scope="col">Commentary</th><th /></tr></thead>
            <tbody>{[...snaps].reverse().map(s => (
              <tr key={s.id}>
                <th scope="row">{s.label}</th><td className="muted">{new Date(s.createdAt).toLocaleString()}</td>
                <td className="num">{fmtUsd(s.netIncome.actual)}</td><td className="num muted">{fmtUsd(s.netIncome.budget)}</td>
                <td>{s.approved}/{s.flagged} approved</td>
                <td><button type="button" className="btn danger-ghost sm" onClick={() => {
                  void saveProject({ ...p, snapshots: p.snapshots.filter(x => x.id !== s.id) })
                  const timer = setTimeout(() => void deleteSnapshotCloud(s.id), 8500)
                  toast(`Deleted ${s.label}.`, { undo: () => { clearTimeout(timer); void saveProject(p) } })
                }}>Delete</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </>}
    </div>
  )
}

function SnapCompare({ a, b }: { a: Snapshot; b: Snapshot }) {
  const rows = [...new Set([...a.rows, ...b.rows].map(r => r.account))].map(acc => {
    const x = a.rows.find(r => r.account === acc), y = b.rows.find(r => r.account === acc)
    const change = (y?.variance ?? 0) - (x?.variance ?? 0)
    const status = y?.flagged && !x?.flagged ? 'newly flagged' : x?.flagged && !y?.flagged ? 'cleared' : y?.flagged ? 'still flagged' : ''
    return { acc, name: y?.name ?? x?.name ?? acc, x, y, change, status }
  }).filter(r => r.status || Math.abs(r.change) >= 1).sort((m, n) => Number(!!n.status) - Number(!!m.status) || Math.abs(n.change) - Math.abs(m.change)).slice(0, 14)
  return (
    <div className="scroll-x"><table className="vt compact">
      <thead><tr><th scope="col">Account</th><th scope="col" className="num">{a.label}</th><th scope="col" className="num">{b.label}</th><th scope="col" className="num">Change</th><th scope="col">Flag</th></tr></thead>
      <tbody>{rows.map(r => (
        <tr key={r.acc}>
          <th scope="row"><span className="mono">{r.acc}</span> {r.name}</th>
          <td className="num">{fmtUsd(r.x?.variance ?? 0)}</td><td className="num">{fmtUsd(r.y?.variance ?? 0)}</td>
          <td className="num">{r.change >= 0 ? '+' : '−'}{fmtUsd(Math.abs(r.change))}</td>
          <td>{r.status && <span className={`status-tag ${r.status === 'cleared' ? 'approved' : r.status === 'newly flagged' ? 'unfav' : 'draft'}`}>{r.status}</span>}</td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}

// ---------- Account drill-down ----------

function AccountModal({ p, ds, a, basis, entity, account, onClose }: { p: P; ds: Dataset; a: Analysis; basis: Basis; entity: string; account: string | null; onClose(): void }) {
  const row = a.report?.rows.find(r => r.account === account)
  const flag = a.flags.find(f => f.row.account === account)
  const detail = useMemo(() => {
    if (!row || !a.period) return null
    const drv = flag?.drivers ?? driversOf(ds, p.config, row, a.period, basis, { entity }, row.vs[basis].amount)
    const lines = ds.actuals.filter(l => l.account === row.account && l.period === a.period && (entity === 'all' || l.entity === entity)).sort((x, y) => Math.abs(y.debit - y.credit) - Math.abs(x.debit - x.credit))
    const months = Array.from({ length: 12 }, (_, i) => shift(a.period!, i - 11))
    const fx = (e: string) => p.config.entities.find(x => x.id === e)?.fx ?? 1
    const series = months.map(m => {
      const act = ds.actuals.filter(l => l.account === row.account && l.period === m && (entity === 'all' || l.entity === entity)).reduce((s, l) => s + (l.debit - l.credit) * fx(l.entity), 0) * (row.kind === 'revenue' ? -1 : 1)
      const bud = ds.budget.filter(x => x.account === row.account && x.period === m && (entity === 'all' || x.entity === entity)).reduce((s, x) => s + x.amount * fx(x.entity), 0)
      return { m, act, bud }
    })
    return { drv, lines, series }
  }, [row, flag, ds, a.period, basis, entity, p.config])
  if (!row || !detail) return <Modal open={false} onClose={onClose} title=""><span /></Modal>
  const v = row.vs[basis]
  const max = Math.max(1, ...detail.series.flatMap(s => [Math.abs(s.act), Math.abs(s.bud)]))
  return (
    <Modal open={!!account} onClose={onClose} title={`${row.account} ${row.name}`} wide>
      <div className="stack">
        <div className="row gap wrap">
          <span className="chip">{row.line} · {row.section}</span>
          <span className={`chip ${v.favourable ? 'fav' : 'unfav'}`}>{v.amount >= 0 ? '+' : '−'}{fmtUsd(Math.abs(v.amount))} ({pctText(v.pct)}) vs {BASIS_LABEL[basis]}</span>
          {flag && <span className={`chip nature-${flag.nature}`}>{flag.nature}</span>}
          {flag?.timing.reason && <span className="muted small">Timing: {flag.timing.reason}</span>}
        </div>
        {flag && <blockquote className="sentence">{a.notes[row.account]?.text ?? draft(flag)}</blockquote>}
        <div>
          <h3 className="h5">Last 12 months, actual vs budget</h3>
          <div className="spark" role="img" aria-label="Monthly actual and budget">
            {detail.series.map(s => <div key={s.m} className={`sp-col${s.m === a.period ? ' cur' : ''}`} title={`${fmtMonth(s.m)}: actual ${fmtUsd(s.act)}, budget ${fmtUsd(s.bud)}`}>
              <i className="sp-bud" style={{ height: `${(Math.abs(s.bud) / max) * 100}%` }} /><i className="sp-act" style={{ height: `${(Math.abs(s.act) / max) * 100}%` }} /><span>{fmtMonthShort(s.m).slice(0, 3)}</span>
            </div>)}
          </div>
          <p className="legend small"><i className="lg-act" /> Actual <i className="lg-bud" /> Budget</p>
        </div>
        {row.pv && <p className="small">Price/volume: <b>price {money(row.pv.price)}</b>, <b>volume {money(row.pv.volume)}</b> on {row.pv.unitsActual.toLocaleString()} units vs {row.pv.unitsBudget.toLocaleString()} budgeted.</p>}
        <div>
          <h3 className="h5">Drivers {basis === 'budget' ? 'vs each vendor’s 3-month run-rate' : `vs ${BASIS_LABEL[basis]}`}</h3>
          {detail.drv.length ? <table className="vt compact"><thead><tr><th>Vendor / dept</th><th className="num">This month</th><th className="num">Compare</th><th className="num">Delta</th><th>Tag</th></tr></thead>
            <tbody>{detail.drv.map(d => <tr key={d.name}><th scope="row">{d.name}{d.memo && <div className="muted small">{d.memo}</div>}</th><td className="num">{fmtUsd(d.current)}</td><td className="num muted">{fmtUsd(d.compare)}</td><td className="num">{d.delta >= 0 ? '+' : '−'}{fmtUsd(Math.abs(d.delta))}</td><td>{d.tag}</td></tr>)}</tbody></table>
            : <p className="muted small">No vendor or department detail explains this movement. Import GL detail (not just a trial balance) to isolate drivers.</p>}
        </div>
        <div>
          <h3 className="h5">GL lines, {fmtMonth(a.period!)} ({detail.lines.length})</h3>
          <div className="scroll-x"><table className="vt compact">
            <thead><tr><th>Date</th><th>Entity</th><th>Vendor</th><th>Memo</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>{detail.lines.slice(0, 40).map((l, i) => <tr key={i}><td className="mono small">{l.date ?? l.period}</td><td>{l.entity}</td><td>{l.vendor ?? l.dept ?? ''}</td><td className="muted">{l.memo ?? ''}</td><td className="num">{l.debit ? fmtUsd(l.debit, 2) : ''}</td><td className="num">{l.credit ? fmtUsd(l.credit, 2) : ''}</td></tr>)}</tbody>
          </table></div>
          {detail.lines.length > 40 && <p className="muted small">Showing the 40 largest of {detail.lines.length}.</p>}
        </div>
        <div className="row end"><button type="button" className="btn ghost" onClick={() => { onClose(); go(`/app/p/${p.id}/commentary`) }} disabled={!flag}>Open in commentary</button></div>
      </div>
    </Modal>
  )
}
