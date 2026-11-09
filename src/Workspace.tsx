import { useEffect, useState } from 'react'
import { SAMPLES } from './engine/sample.ts'
import { createBlankProject, createSampleProject } from './projectData.ts'
import { deleteProject, useProjects } from './store.ts'
import { Empty, fmtMonth, go, Link, Modal, SyntheticBadge, toast } from './ui.tsx'

export default function Workspace() {
  const list = useProjects()
  const [naming, setNaming] = useState(false)
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (q.get('import') === '1') { history.replaceState({}, '', '/app'); setNaming(true) }
    const s = q.get('sample'), tab = q.get('tab')
    if (s && SAMPLES.some(x => x.id === s)) void createSampleProject(s).then(p => go(`/app/p/${p.id}${tab ? '/' + tab : ''}`, { replace: true }))
  }, [])

  const create = async (name: string) => {
    const p = await createBlankProject(name || 'My company')
    go(`/app/p/${p.id}/data?import=1`)
  }
  const sample = async (id: string) => { const p = await createSampleProject(id); go(`/app/p/${p.id}`) }

  if (list === null) return <div className="boot" role="status"><span className="spinner" /> Loading</div>
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Close packs</h1>
          <p className="muted">One pack per company or reporting group. Each keeps its mapping, commentary and a snapshot of every close.</p>
        </div>
        <div className="row gap wrap">
          <button type="button" className="btn primary" onClick={() => setNaming(true)}>New close pack</button>
        </div>
      </div>

      {list.length === 0 ? (
        <Empty title="No close packs yet" icon={<EmptyArt />}>
          <p className="muted">Start with a synthetic company to see a full October close, or bring your own trial balance and budget.</p>
          <div className="row gap center-x wrap">
            <button type="button" className="btn primary" onClick={() => void sample('saas')}>Try the sample</button>
            <button type="button" className="btn outline" onClick={() => setNaming(true)}>Import your data</button>
          </div>
        </Empty>
      ) : (
        <div className="proj-grid">
          {list.map(p => {
            const last = p.snapshots[p.snapshots.length - 1]
            return (
              <article key={p.id} className="card proj">
                <Link href={`/app/p/${p.id}`} className="proj-link">
                  <h3>{p.name} {p.sampleId && <SyntheticBadge />}</h3>
                  <p className="muted small">{p.period ? `Working ${fmtMonth(p.period)}` : 'No data imported yet'} · {p.config.entities.length || 1} {p.config.entities.length > 1 ? 'entities' : 'entity'} · {p.config.mapping.length} mapped accounts</p>
                  <div className="proj-meta">
                    <span>{p.snapshots.length} closes saved</span>
                    {last && <span>Last: {last.label} · {last.approved}/{last.flagged} approved</span>}
                  </div>
                </Link>
                <div className="row gap-sm proj-actions">
                  <Link href={`/app/p/${p.id}/commentary`} className="btn ghost sm">Commentary</Link>
                  <Link href={`/app/p/${p.id}/pack`} className="btn ghost sm">Board pack</Link>
                  <button type="button" className="btn danger-ghost sm" onClick={async () => {
                    const undo = await deleteProject(p.id)
                    toast(`Deleted ${p.name}.`, { undo: () => void undo() })
                  }}>Delete</button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className="samples">
        <h2 className="h4">Synthetic companies</h2>
        <div className="proj-grid">
          {SAMPLES.map(s => (
            <button key={s.id} type="button" className="card sample-card" onClick={() => void sample(s.id)}>
              <strong>{s.name}</strong> <SyntheticBadge />
              <span className="muted small">{s.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <Modal open={naming} onClose={() => setNaming(false)} title="New close pack">
        <form onSubmit={e => { e.preventDefault(); void create(String(new FormData(e.currentTarget).get('name') ?? '').trim()) }} className="stack">
          <label className="field"><span>Company or reporting group</span><input name="name" autoFocus placeholder="Acme Holdings consolidated" /></label>
          <p className="muted small">Next you will import actuals (trial balance or GL detail), a budget, and optionally a chart-of-accounts mapping.</p>
          <div className="row end gap"><button type="button" className="btn ghost" onClick={() => setNaming(false)}>Cancel</button><button className="btn primary">Create and import</button></div>
        </form>
      </Modal>
    </section>
  )
}

const EmptyArt = () => (
  <svg className="empty-art" viewBox="0 0 120 80" aria-hidden="true">
    <rect x="8" y="30" width="14" height="40" rx="2" className="ea-total" />
    <rect x="30" y="18" width="14" height="12" rx="2" className="ea-fav" />
    <rect x="52" y="18" width="14" height="22" rx="2" className="ea-unfav" />
    <rect x="74" y="40" width="14" height="8" rx="2" className="ea-unfav" />
    <rect x="96" y="48" width="14" height="22" rx="2" className="ea-actual" />
  </svg>
)
