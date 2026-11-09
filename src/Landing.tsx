import { useMemo, useState } from 'react'
import { Bridge } from './Bridge.tsx'
import { buildReport, flags as flagsOf } from './engine/variance.ts'
import { SAMPLES, sampleConfig, sampleData } from './engine/sample.ts'
import { money } from './engine/commentary.ts'
import { createSampleProject } from './projectData.ts'
import { go, Link, SyntheticBadge, toast } from './ui.tsx'

const EVIDENCE = [
  { src: 'r/FPandA', quote: 'The advice that gets upvoted: find the one vendor, project, position, SKU or component that actually explains the variance, then say whether it is timing or a real over or underspend.', tie: 'Every flag lists its top vendors or departments and a timing call.' },
  { src: 'r/Accounting', quote: 'A recurring doubt about AI write-ups: do they explain the why, or just restate that the number moved?', tie: 'No model here. Each sentence is assembled from computed GL drivers, with the numbers inlined.' },
  { src: 'r/Accounting', quote: 'Smaller companies ask whether they really have to set aside a full day of the close for flux analysis.', tie: 'Flagging, drivers and first drafts take seconds, so the day goes to review.' },
  { src: 'r/CFO', quote: 'Multi-entity consolidation in spreadsheets has a hidden cost: FX, intercompany and a deck rebuilt by hand every month.', tie: 'Editable FX rates, intercompany elimination by mapped account, one consolidated pack.' },
]

const STEPS = [
  ['Import', 'Trial balance or GL detail for this month and last, plus the budget. QuickBooks, Xero, NetSuite, Intacct or any CSV/XLSX.'],
  ['Flag', 'Budget, month-over-month and year-over-year variances. An account is flagged only when it trips both the dollar and the percent threshold.'],
  ['Explain', 'Top vendors and departments behind each flag, new and one-off entries, accruals, price and volume, timing that reverses.'],
  ['Write', 'A deterministic first draft per flag. Your edits carry into next month when the same driver comes back.'],
  ['Review', 'Draft, reviewed, approved, with a reviewer comment on each line and a flux checklist for the close.'],
  ['Ship', 'A printable board pack and an Excel workbook of the variance table with commentary.'],
] as const

export function Landing() {
  const [sample, setSample] = useState('saas')
  const { report, fl } = useMemo(() => {
    const ds = sampleData(sample), c = sampleConfig(sample), p = SAMPLES.find(s => s.id === sample)!.period
    const report = buildReport(ds, c, p)
    return { report, fl: flagsOf(ds, c, report) }
  }, [sample])
  const ni = report.netIncome.vs.budget
  const open = async (id = sample) => {
    const p = await createSampleProject(id)
    toast(`Opened ${p.name}, a synthetic company.`, { tone: 'ok' })
    go(`/app/p/${p.id}`)
  }

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Month-end variance analysis</p>
          <h1>Commentary that explains the <em>why</em>, not just the movement.</h1>
          <p className="lede">Variance Pack turns your trial balance, GL detail and budget into flagged variances, the vendors behind them, and a reviewed commentary pack. Every sentence is built from the ledger. Nothing is made up.</p>
          <div className="row gap wrap">
            <button type="button" className="btn primary lg" onClick={() => void open()}>Try the sample close</button>
            <Link href="/app?import=1" className="btn outline lg">Import your ledger</Link>
          </div>
          <p className="small muted">Free, runs in your browser, no account needed.</p>
        </div>
        <div className="hero-card card">
          <div className="hc-head">
            <div>
              <div className="hc-title">Net income bridge, October 2026 <SyntheticBadge /></div>
              <div className="muted small">Budget to actual by P&amp;L line · {money(Math.abs(ni.amount))} {ni.favourable ? 'favourable' : 'unfavourable'}</div>
            </div>
            <div className="seg" role="group" aria-label="Sample company">
              {SAMPLES.map(s => <button key={s.id} type="button" aria-pressed={sample === s.id} onClick={() => setSample(s.id)}>{s.name}</button>)}
            </div>
          </div>
          <Bridge key={sample} report={report} flags={fl} initial={sample === 'saas' ? 'Sales & marketing' : 'Freight'} compact />
        </div>
      </section>

      <section className="band">
        <div className="container">
          <p className="eyebrow center">What analysts keep asking for</p>
          <h2 className="center">Built around how variance commentary actually gets written</h2>
          <div className="evidence">
            {EVIDENCE.map((e, i) => (
              <figure key={i} className="card ev">
                <figcaption className="muted small">Paraphrased from {e.src}</figcaption>
                <blockquote>{e.quote}</blockquote>
                <p className="ev-tie">{e.tie}</p>
              </figure>
            ))}
          </div>
        </div>
      </section>

      <section className="container steps-sec">
        <p className="eyebrow">The workflow</p>
        <h2>From ledger to board pack in one sitting</h2>
        <ol className="steps">
          {STEPS.map(([t, b], i) => <li key={t} className="card"><span className="step-n">{String(i + 1).padStart(2, '0')}</span><h3>{t}</h3><p>{b}</p></li>)}
        </ol>
      </section>

      <section className="container grounded">
        <div>
          <p className="eyebrow">Grounded, not generated</p>
          <h2>Every figure in a sentence traces to a ledger line</h2>
          <p>Drafts are templates filled only from computed drivers: the variance, its percent, the vendor deltas, the timing call and the price/volume split. If the ledger cannot explain a variance, the draft says so and asks for review instead of inventing a reason.</p>
          <ul className="ticks">
            <li>Both a dollar and a percent threshold, set per pack</li>
            <li>Favourable and unfavourable handled for revenue vs expense</li>
            <li>Edited wording carries forward with this month's numbers swapped in</li>
          </ul>
        </div>
        <div className="card anatomy">
          <p className="anat-sentence">
            <mark data-k="1">Advertising and media $38k (26%)</mark> over budget, driven by <mark data-k="2">Acme Media $35k</mark> <mark data-k="3">new campaign invoice</mark> (new vendor); <mark data-k="4">non-recurring</mark>.
          </p>
          <ol className="anat-key small">
            <li><b>1</b> Actual minus budget for 6100, consolidated at the pack's FX rates</li>
            <li><b>2</b> Vendor's October spend minus its 3-month run-rate</li>
            <li><b>3</b> Memo on the largest entry, invoice INV-20418</li>
            <li><b>4</b> No spend from this vendor in the prior three months</li>
          </ol>
        </div>
      </section>

      <section className="container bento">
        {[
          ['Drivers from GL detail', 'Top vendors or departments per flag, with new vendors, one-off entries and accruals called out.'],
          ['Timing detection', 'A variance that reverses next month, or offsets last month, is called timing. So is an accrual pattern.'],
          ['Price and volume', 'Where units exist, the variance splits into price and volume, and the two add back to the total.'],
          ['Multi-entity', 'Translate each entity at an editable rate, eliminate intercompany by mapped account, see the residual.'],
          ['Validation first', 'Format detection, column mapping, a line-numbered issue report, debits equal credits, TB to GL tie-out.'],
          ['History', 'Snapshot each close and follow an account’s variance across months.'],
        ].map(([t, b]) => <div key={t} className="card bento-item"><h3>{t}</h3><p>{b}</p></div>)}
      </section>

      <section className="cta-band">
        <div className="container row between wrap-sm gap">
          <div>
            <h2>Run October's close on a synthetic company</h2>
            <p>A SaaS business with a marketing overspend and an early audit accrual, or a US and Canadian distributor with intercompany to eliminate.</p>
          </div>
          <div className="row gap wrap">
            <button type="button" className="btn white lg" onClick={() => void open('saas')}>Northwind Cloud</button>
            <button type="button" className="btn white-outline lg" onClick={() => void open('multi')}>Maple &amp; Main Supply</button>
          </div>
        </div>
      </section>
    </div>
  )
}
