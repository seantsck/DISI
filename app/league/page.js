import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import { getLeagueData } from '../../lib/data'
import { money, humanize } from '../../lib/format'

export const metadata = { title:'League Benchmark — DISI' }

export default async function LeaguePage() {
  const { live, error, rows, orgs, coverage, periodOrgs } = await getLeagueData()
  const years = [...new Set(rows.map(r => r.signing_year))].sort()
  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Cross-organization comparison</span>
          <h1>League Benchmark</h1>
          <p>League-wide international acquisition records with explicit coverage labels. The first benchmark layer uses MLB Pipeline Top 30 signing trackers; it is not presented as a complete signing census.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>
      {!live && <DataUnavailable error={error} />}
      <div className="page-guardrail">
        <strong>Benchmark ≠ census.</strong> The 2013 and 2014 rows are top-prospect tracker samples. DISI will add full club-year classes only when source coverage supports that claim.
      </div>

      <section className="table-panel">
        <div className="table-head"><div><span className="eyebrow">League-wide period totals</span><h2>2019–20 organization signing volume</h2></div><span className="micro-note">MLB-reported totals</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Club</th><th>Signings</th><th>Pool</th><th>Spent</th><th>Utilization</th></tr></thead>
          <tbody>{periodOrgs.map((r) => <tr key={`${r.period_label}-${r.organization}`}>
            <td><strong>{r.organization}</strong></td>
            <td>{r.signed_count}</td>
            <td>{money(r.pool_amount_usd)}</td>
            <td>{money(r.pool_spent_usd)}</td>
            <td>{r.pool_utilization_rate == null ? '—' : `${(Number(r.pool_utilization_rate)*100).toFixed(1)}%`}</td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className="table-panel">
        <div className="table-head">
          <div><span className="eyebrow">Coverage</span><h2>What is actually in the database</h2></div>
          <span className="micro-note">{years.length ? years.join(' · ') : 'No live rows'}</span>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>Period</th><th>Scope</th><th>Tracked</th><th>Expected/list size</th><th>Coverage</th></tr></thead>
          <tbody>{coverage.map((c,i) => <tr key={`${c.abbreviation || 'MLB'}-${c.period_start_year}-${i}`}>
            <td>{c.period_start_year}{c.period_end_year !== c.period_start_year ? `–${c.period_end_year}` : ''}</td>
            <td>{humanize(c.coverage_type)}</td>
            <td>{c.tracked_signings}</td>
            <td>{c.expected_signings ?? '—'}</td>
            <td>{c.observed_coverage_rate == null ? 'Not a census' : `${(Number(c.observed_coverage_rate)*100).toFixed(1)}%`}</td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className="table-panel">
        <div className="table-head"><div><span className="eyebrow">Organization view</span><h2>Tracked top-prospect commitments</h2></div></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Year</th><th>Club</th><th>Tracked Top 30 signings</th><th>Known spend</th><th>Best rank</th><th>Avg rank</th></tr></thead>
          <tbody>{orgs.map((r) => <tr key={`${r.signing_year}-${r.organization}`}>
            <td>{r.signing_year}</td><td><strong>{r.organization}</strong></td>
            <td>{r.tracked_top_prospect_signings}</td><td>{money(r.known_bonus_spend_usd)}</td>
            <td>{r.best_pipeline_rank ?? '—'}</td><td>{r.avg_pipeline_rank ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </section>

      <section className="table-panel">
        <div className="table-head"><div><span className="eyebrow">Player ledger</span><h2>League benchmark signings</h2></div><span className="micro-note">{rows.length} live rows</span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Year</th><th>Rank</th><th>Player</th><th>Club</th><th>Market</th><th>Position</th><th>Bonus</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={`${r.signing_year}-${r.organization}-${r.full_name}`}>
            <td>{r.signing_year}</td><td>{r.international_rank ?? '—'}</td><td><strong>{r.full_name}</strong></td>
            <td>{r.organization}</td><td>{r.country_market}</td><td>{r.primary_position || '—'}</td><td>{money(r.signing_bonus_usd)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </main>
  )
}
