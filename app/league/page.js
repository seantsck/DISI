import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import PlayerLink from '../components/PlayerLink'
import { getLeagueData } from '../../lib/data.js'
import { money, humanize } from '../../lib/format.js'
import { benchmarkClassSummary, benchmarkLabelCoverage } from '../../lib/research/benchmark-sample.js'

export const metadata = { title: 'League Benchmark' }

// Rendered per request so pages always reflect the live database (never a build-time snapshot).
export const dynamic = 'force-dynamic'

export default async function LeaguePage() {
  const { live, error, rows, orgs, coverage, periodOrgs, benchmarkReadiness } = await getLeagueData()
  const years = [...new Set(rows.map(r => r.signing_year))].sort()
  const classes = benchmarkClassSummary(rows, coverage)
  const labels = benchmarkLabelCoverage(benchmarkReadiness)
  const classYears = classes.map((c) => c.class_year)
  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Cross-organization comparison</span>
          <h1>League Benchmark</h1>
          <p>League-wide international acquisition records with explicit coverage labels. The benchmark is a rank-selected sample: the players MLB Pipeline ranked in its international Top 30 lists, not every international signing.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>
      {!live && <DataUnavailable error={error} />}
      <div className="page-guardrail">
        <strong>Rank-selected sample, not a census.</strong> The benchmark rows are MLB Pipeline Top 30 international prospects
        {classYears.length ? ` (${classYears.join(', ')} lists)` : ''} with a verified signing. They describe ranked prospects only: no figure here is a rate of
        international signings, an organization&apos;s hit rate or a Dodgers comparison. A player appears under the list he was ranked on; his signing year is the
        year of his official signing. DISI will add full club-year classes only when source coverage supports that claim.
      </div>

      {classes.length > 0 && <section className="table-panel" aria-labelledby="benchmark-classes-heading">
        <div className="table-head">
          <div><span className="eyebrow">MLB Pipeline international Top 30</span><h2 id="benchmark-classes-heading">The benchmark sample by source list</h2></div>
          <span className="micro-note">Counts with their denominators; never a rate</span>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>List</th><th className="num">List size</th><th className="num">Benchmark signings</th><th className="num">Outcome audited</th><th className="num">Reached MLB</th><th className="num">Audited, no MLB debut</th><th className="num">Not audited</th><th className="num">Professional route</th><th>Signing years</th></tr></thead>
          <tbody>{classes.map((c) => <tr key={c.class_year}>
            <td><strong>{c.class_year}</strong></td>
            <td className="num">{c.list_size ?? '—'}</td>
            <td className="num">{c.benchmark_signings}</td>
            <td className="num">{c.audited}</td>
            <td className="num">{c.reached_mlb}</td>
            <td className="num">{c.audited_no_mlb}</td>
            <td className="num">{c.not_audited}</td>
            <td className="num">{c.professional_route}</td>
            <td>{Object.entries(c.signing_years).map(([y, k]) => `${y}: ${k}`).join(' · ')}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="micro-note table-foot">
          Among this MLB Pipeline Top 30 benchmark sample only. A listed player the Dodgers signed is a Dodgers record, not a benchmark row; a listed player whose
          signing or identity could not be verified is not counted (the list size minus the benchmark signings). No MLB debut found is not a career end, and an
          unaudited player is unknown, not a non-reacher. Professional-route signings (prior professional play) are shown but never train an amateur estimate.
        </p>
      </section>}

      {labels.length > 0 && <section className="table-panel" aria-labelledby="benchmark-labels-heading">
        <div className="table-head">
          <div><span className="eyebrow">Fixed-horizon outcome labels (041)</span><h2 id="benchmark-labels-heading">What the sample can label</h2></div>
          <span className="micro-note">The benchmark&apos;s own reference population</span>
        </div>
        <div className="table-scroll"><table>
          <thead><tr><th>Target</th><th className="num">Labelled</th><th className="num">Positive</th><th className="num">Negative</th><th className="num">Unaudited</th><th className="num">Open horizon</th><th>Reading</th></tr></thead>
          <tbody>{labels.map((t) => <tr key={t.target_key}>
            <td><strong>{t.target_label}</strong></td>
            <td className="num">{t.labelled}</td><td className="num">{t.positives}</td><td className="num">{t.negatives}</td>
            <td className="num">{t.unaudited}</td><td className="num">{t.open_horizon}</td>
            <td className="wrap">{t.statement}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="micro-note table-foot">
          Benchmark support is not Dodgers support: a target supported in this sample never produces a probability for a Dodgers player, and the two
          populations are never pooled. A reacher whose Baseball-Reference team-season WAR is not loaded has no bWAR label (missing WAR is not zero WAR).
        </p>
      </section>}

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
          <thead><tr><th>Signing year</th><th>List rank</th><th>Player</th><th>Club</th><th>Market</th><th>Position</th><th>Bonus</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.signing_id}>
            <td>{r.signing_year}</td><td>{r.international_rank ?? '—'}</td><td><PlayerLink slug={r.player_slug} name={r.full_name} /></td>
            <td>{r.organization}</td><td>{r.country_market || '—'}</td><td>{r.primary_position || '—'}</td><td>{money(r.signing_bonus_usd)}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
    </main>
  )
}
