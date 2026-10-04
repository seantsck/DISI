import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import { getAuditOperationsData } from '../../lib/data'
import { money, humanize } from '../../lib/format'

export const metadata = { title:'Research Queue — DISI' }

export default async function ResearchPage() {
  const { live, error, summary, queue, classes, markets } = await getAuditOperationsData()

  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Data operations</span>
          <h1>Research Queue</h1>
          <p>Outcome coverage is treated as a first-class dataset. Players remain unaudited until public records support an MLB-reach or no-MLB conclusion.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>

      {!summary && <DataUnavailable error={error} />}

      {summary && <>
        <section className="kpi-grid">
          <div className="kpi-card"><span>Tracked signings</span><strong>{summary.tracked_signings}</strong></div>
          <div className="kpi-card"><span>Audited outcomes</span><strong>{summary.audited}</strong><small>{summary.audit_completion_pct}% complete</small></div>
          <div className="kpi-card"><span>Outcome queue</span><strong>{summary.unaudited}</strong><small>Never treated as failures by default</small></div>
          <div className="kpi-card"><span>10+ year mature queue</span><strong>{summary.unaudited_10_plus_years}</strong><small>Highest research priority</small></div>
        </section>

        <section className="table-panel">
          <div className="table-head"><div><span className="eyebrow">Next work</span><h2>Prioritized outcome audits</h2></div><span className="micro-note">{queue.length} unaudited rows</span></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Priority</th><th>Player</th><th>Year</th><th>Market</th><th>Position</th><th>Known cost</th><th>Bucket</th></tr></thead>
            <tbody>{queue.map((r) => <tr key={`${r.signing_year}-${r.full_name}`}>
              <td><strong>{r.audit_priority_score}</strong></td>
              <td><strong>{r.full_name}</strong></td>
              <td>{r.signing_year}</td>
              <td>{r.country_market || '—'}</td>
              <td>{r.primary_position || '—'}</td>
              <td>{money(r.total_known_acquisition_cost_usd)}</td>
              <td>{humanize(r.audit_bucket)}</td>
            </tr>)}</tbody>
          </table></div>
        </section>

        <section className="table-panel">
          <div className="table-head"><div><span className="eyebrow">By class</span><h2>Outcome research completion</h2></div></div>
          <div className="table-scroll"><table>
            <thead><tr><th>Year</th><th>Tracked</th><th>Audited</th><th>Verified MLB</th><th>Queue</th><th>Complete</th></tr></thead>
            <tbody>{classes.map((r) => <tr key={r.signing_year}>
              <td>{r.signing_year}</td><td>{r.tracked_signings}</td><td>{r.audited_outcomes}</td>
              <td>{r.verified_mlb_players}</td><td>{r.outcome_queue}</td><td>{r.audit_completion_pct}%</td>
            </tr>)}</tbody>
          </table></div>
        </section>
      </>}
    </main>
  )
}
