import { useEffect, useMemo, useState } from 'react'
import { draft, money, pctText } from './engine/commentary.ts'
import type { Flag, Report, Rollup } from './engine/variance.ts'

interface Step { key: string; label: string; delta: number; lines: Rollup[] }

export function bridgeSteps(report: Report, max = 7): Step[] {
  const all = report.lines.map(l => ({ key: l.label, label: l.label, delta: l.kind === 'revenue' ? l.vs.budget.amount : -l.vs.budget.amount, lines: [l] })).filter(s => Math.abs(s.delta) >= 1)
  if (all.length <= max) return all
  const keep = new Set([...all].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, max - 1).map(s => s.key))
  const rest = all.filter(s => !keep.has(s.key))
  return [...all.filter(s => keep.has(s.key)), { key: '__other', label: 'All other', delta: rest.reduce((t, s) => t + s.delta, 0), lines: rest.flatMap(s => s.lines) }]
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Types a sentence out once, so the commentary visibly writes itself from the drivers. */
export function Typed({ text }: { text: string }) {
  const [n, setN] = useState(reduced() ? text.length : 0)
  useEffect(() => {
    if (reduced()) { setN(text.length); return }
    setN(0)
    let i = 0
    const t = setInterval(() => { i += 2; setN(i); if (i >= text.length) clearInterval(t) }, 14)
    return () => clearInterval(t)
  }, [text])
  return <span className="typed">{text.slice(0, n)}{n < text.length && <i className="caret" aria-hidden="true" />}<span className="sr-only">{text.slice(n)}</span></span>
}

export function Bridge({ report, flags, initial, compact, onOpenAccount }: { report: Report; flags: Flag[]; initial?: string; compact?: boolean; onOpenAccount?(account: string): void }) {
  const steps = useMemo(() => bridgeSteps(report), [report])
  const [sel, setSel] = useState<string | null>(initial ?? null)
  useEffect(() => { if (sel && !steps.some(s => s.key === sel)) setSel(null) }, [steps, sel])
  const start = report.netIncome.budget, end = report.netIncome.actual
  const W = 820, H = compact ? 260 : 300, padL = 56, padR = 12, padT = 26, padB = 58
  const cols = steps.length + 2
  const bw = Math.min(64, ((W - padL - padR) / cols) * 0.62)
  const x = (i: number) => padL + ((W - padL - padR) / cols) * (i + 0.5)
  let run = start
  const bars = steps.map(s => { const from = run; run += s.delta; return { ...s, from, to: run } })
  const vals = [0, start, end, ...bars.flatMap(b => [b.from, b.to])]
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || 1
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB)
  const ticks = niceTicks(lo, hi)
  const selected = steps.find(s => s.key === sel)
  const lineFlags = selected ? flags.filter(f => selected.lines.some(l => l.accounts.some(a => a.account === f.row.account))) : []

  const label = (t: string) => t.length > 13 ? t.split(/\s+|(?<=&)/).reduce<string[]>((acc, w) => { const last = acc[acc.length - 1]; if (last && (last + ' ' + w).length <= 13) acc[acc.length - 1] = last + ' ' + w; else acc.push(w); return acc }, []).slice(0, 2) : [t]

  return (
    <div className="bridge">
      <div className="bridge-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Net income bridge from budget ${money(start)} to actual ${money(end)}`} className="bridge-svg">
          {ticks.map(t => <g key={t} className="tick"><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} /><text x={padL - 8} y={y(t) + 4} textAnchor="end">{money(t)}</text></g>)}
          <line className="zero" x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} />
          <Total x={x(0)} bw={bw} y0={y(0)} y1={y(start)} value={start} label={['Budget', 'net income']} H={H} i={0} cls="t-budget" />
          {bars.map((b, i) => {
            const top = y(Math.max(b.from, b.to)), h = Math.max(2, Math.abs(y(b.from) - y(b.to)))
            const fav = b.delta >= 0, active = b.key === sel
            return (
              <g key={b.key} className={`step ${fav ? 'fav' : 'unfav'}${active ? ' active' : ''}${sel && !active ? ' dim' : ''}`} style={{ ['--i' as string]: i + 1 }}
                role="button" tabIndex={0} aria-pressed={active} aria-label={`${b.label}: ${fav ? 'favourable' : 'unfavourable'} ${money(Math.abs(b.delta))}. Show drivers.`}
                onClick={() => setSel(active ? null : b.key)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(active ? null : b.key) } }}>
                <line className="conn" x1={x(i) + bw / 2} x2={x(i + 1) - bw / 2} y1={y(b.from)} y2={y(b.from)} />
                <rect className="hit" x={x(i + 1) - bw / 2 - 6} y={padT - 20} width={bw + 12} height={H - padT} />
                <rect className="bar" x={x(i + 1) - bw / 2} y={top} width={bw} height={h} rx={3} style={{ transformOrigin: `${x(i + 1)}px ${y(b.from)}px` }} />
                <text className="val" x={x(i + 1)} y={top - 7} textAnchor="middle">{fav ? '+' : '−'}{money(Math.abs(b.delta))}</text>
                {label(b.label).map((t, k) => <text key={k} className="lbl" x={x(i + 1)} y={H - padB + 18 + k * 14} textAnchor="middle">{t}</text>)}
              </g>
            )
          })}
          <line className="conn" x1={x(bars.length) + bw / 2} x2={x(bars.length + 1) - bw / 2} y1={y(end)} y2={y(end)} />
          <Total x={x(bars.length + 1)} bw={bw} y0={y(0)} y1={y(end)} value={end} label={['Actual', 'net income']} H={H} i={bars.length + 1} cls="t-actual" />
        </svg>
      </div>
      <div className={`bridge-detail${selected ? ' open' : ''}`} aria-live="polite">
        {!selected ? (
          <p className="muted hint"><span className="pulse" aria-hidden="true" />Click a bar to expand its GL drivers and write the commentary.</p>
        ) : !lineFlags.length ? (
          <div>
            <h4>{selected.label} <span className={selected.delta >= 0 ? 'fav-t' : 'unfav-t'}>{selected.delta >= 0 ? '+' : '−'}{money(Math.abs(selected.delta))}</span></h4>
            <p className="muted">No account in this line crosses both materiality thresholds, so no commentary is required. Largest accounts:</p>
            <ul className="mini-list">{selected.lines.flatMap(l => l.accounts).sort((a, b) => Math.abs(b.vs.budget.amount) - Math.abs(a.vs.budget.amount)).slice(0, 3).map(a => <li key={a.account}><span>{a.account} {a.name}</span><b>{money(a.vs.budget.amount)} ({pctText(a.vs.budget.pct)})</b></li>)}</ul>
          </div>
        ) : lineFlags.map(f => (
          <div key={f.row.account} className="bd-flag">
            <div className="bd-head">
              <button type="button" className="linkish" onClick={() => onOpenAccount?.(f.row.account)} disabled={!onOpenAccount}><b>{f.row.account}</b> {f.row.name}</button>
              <span className={`chip ${f.v.favourable ? 'fav' : 'unfav'}`}>{f.v.amount > 0 ? '+' : '−'}{money(Math.abs(f.v.amount))} · {pctText(f.v.pct)}</span>
              <span className={`chip nature-${f.nature}`}>{f.nature}</span>
            </div>
            {f.drivers.length > 0 && (
              <ul className="drivers">{f.drivers.map(d => (
                <li key={d.name} style={{ ['--w' as string]: `${Math.min(100, Math.abs(d.delta) / Math.abs(f.v.amount) * 100)}%` }}>
                  <span className="dn">{d.name}<small>{d.tag}{d.memo ? ` · ${d.memo}` : ''}</small></span>
                  <span className="dbar" aria-hidden="true"><i /></span>
                  <b>{d.delta > 0 ? '+' : '−'}{money(Math.abs(d.delta))}</b>
                </li>
              ))}</ul>
            )}
            {f.row.pv && <p className="small muted">Price {money(f.row.pv.price)} · volume {money(f.row.pv.volume)} ({f.row.pv.unitsActual.toLocaleString()} vs {f.row.pv.unitsBudget.toLocaleString()} units)</p>}
            <blockquote className="sentence"><Typed text={draft(f)} /></blockquote>
          </div>
        ))}
      </div>
    </div>
  )
}

function Total({ x, bw, y0, y1, value, label, H, i, cls }: { x: number; bw: number; y0: number; y1: number; value: number; label: string[]; H: number; i: number; cls: string }) {
  return (
    <g className={`total ${cls}`} style={{ ['--i' as string]: i }}>
      <rect className="bar" x={x - bw / 2} y={Math.min(y0, y1)} width={bw} height={Math.max(2, Math.abs(y0 - y1))} rx={3} style={{ transformOrigin: `${x}px ${y0}px` }} />
      <text className="val strong" x={x} y={Math.min(y0, y1) - 7} textAnchor="middle">{money(value)}</text>
      {label.map((t, k) => <text key={k} className="lbl strong" x={x} y={H - 58 + 18 + k * 14} textAnchor="middle">{t}</text>)}
    </g>
  )
}

function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo || 1
  const step0 = span / 4
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) ?? mag * 10
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v))
  return out
}
