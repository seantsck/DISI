import Link from 'next/link'
import DataMode from './components/DataMode'
import DataUnavailable from './components/DataUnavailable'
import PlayerLink from './components/PlayerLink'
import AuditBadge from './components/AuditBadge'
import RowLink from './components/RowLink'
import { getHomeData } from '../lib/data.js'
import { money, moneyExact, bwar, humanize, pctFraction, MISSING } from '../lib/format.js'

// Rendered per request so pages always reflect the live database (never a build-time snapshot).
export const dynamic = 'force-dynamic'

const SECTIONS = [
  ['/signings', 'Signings', 'Sortable, filterable table of every signing record.'],
  ['/players', 'Players', 'Player directory with aliases and individual research dossiers.'],
  ['/markets', 'Markets', 'Signings, known cost and audited outcomes by country and pathway.'],
  ['/development', 'Development', 'Signing-to-MLB timing where both dates are recorded.'],
  ['/asset-conversion', 'Asset Conversion', 'Trades and releases, with package-level return attribution.'],
  ['/league', 'League Benchmark', 'Cross-organization signing volume, pools and prospect samples.'],
  ['/research', 'Research & Data Coverage', 'Class coverage, source support and the open research queue.'],
  ['/methodology', 'Methodology', 'Source priority, metric definitions and data-quality rules.'],
]

function Stat({ label, value, note }) {
  return (
    <div className="stat-cell">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

export default async function HomePage() {
  const { live, error, status, snapshot, knownMlb, rateSummary } = await getHomeData()

  return (
    <main className="shell page-main">
      <header className="home-head">
        <div className="hero-status"><DataMode live={live} error={error} /></div>
        <h1 className="home-title">DISI</h1>
        <p className="home-subtitle">Dodgers International Signings Research Database</p>
        <p className="home-description">
          A public-data research database covering Brooklyn and Los Angeles Dodgers international signings:
          signing classes, acquisition costs, player development, MLB outcomes, transactions and organizational value.
          Each fact is linked to its source. Values that are not known are left blank, never filled in.
        </p>
      </header>

      {!status && <DataUnavailable error={error} />}

      {status && <>
        <section aria-labelledby="status-heading" className="section-block">
          <div className="section-heading">
            <h2 id="status-heading">Database status</h2>
            <Link href="/research">Coverage detail →</Link>
          </div>
          <div className="stat-grid">
            <Stat label="Tracked signings" value={status.tracked_signings.toLocaleString()} note={`${status.dodgers_players.toLocaleString()} Dodgers players · ${status.league_benchmark_players} other-club benchmark players kept separately`} />
            <Stat label="Years represented" value={status.years_represented} note={`${status.earliest_signing_year}–${status.latest_signing_year}; not every year is covered`} />
            <Stat label="Markets represented" value={status.markets_represented} note={`${status.signings_with_unknown_market} signings with unknown market`} />
            <Stat label="Classes with known population" value={status.classes_with_known_population} note={`${status.opening_classes_complete} announced opening classes complete · ${status.full_periods_complete} full signing periods complete`} />
            <Stat label="Outcome audits completed" value={status.outcome_audits_completed} note={`${status.outcome_audit_queue} signings not yet audited (not failures)`} />
            <Stat label="Verified MLB outcomes" value={status.verified_mlb_outcomes} note={`${status.verified_no_mlb_outcomes} verified with no MLB debut`} />
            <Stat label="Known acquisition cost" value={money(status.known_acquisition_cost_usd)} note={`Sum over ${status.signings_with_known_cost} signings with a recorded cost; unknown costs are excluded, not $0`} />
            <Stat label="Research queue" value={status.open_research_tasks.toLocaleString()} note={`${status.class_members_missing} expected class members not yet in the database`} />
          </div>
          <p className="page-guardrail">
            <strong>No organization-wide MLB rate is shown here.</strong>{' '}
            {rateSummary?.rate_eligible_classes
              ? `${rateSummary.rate_eligible_classes} signing class(es) meet the rate-eligibility rules (complete signing population, complete outcome audit, five years mature): ${rateSummary.verified_mlb_players} of ${rateSummary.rate_eligible_signings} reached MLB (${pctFraction(rateSummary.verified_mlb_reach_rate)}). Other classes are excluded from any rate.`
              : 'No full signing-period population yet meets all three rate-eligibility rules (complete population, complete outcome audit, five years mature). A complete announced opening class is not the full signing period, so verified MLB players are reported as counts, not as a share of tracked signings.'}
          </p>
        </section>

        <section aria-labelledby="snapshot-heading" className="table-panel">
          <div className="table-head">
            <div><span className="eyebrow">Signing database</span><h2 id="snapshot-heading">Most recent signing records</h2></div>
            <form action="/signings" method="get" role="search" className="inline-search">
              <label className="sr-only" htmlFor="home-q">Search signings</label>
              <input id="home-q" type="search" name="q" placeholder="Search signings by player…" />
              <button type="submit" className="button-link">Search</button>
            </form>
          </div>
          <div className="table-scroll">
            <table className="research-table">
              <thead><tr><th>Player</th><th className="num">Year</th><th>Market</th><th>Pos</th><th>Pathway</th><th className="num">Known cost</th><th>Outcome audit</th><th className="num">Career bWAR</th></tr></thead>
              <tbody>
                {snapshot.map((r) => (
                  <RowLink key={r.signing_id} href={`/players/${r.player_slug}`}>
                    <td className="sticky-col"><PlayerLink slug={r.player_slug} name={r.full_name} /></td>
                    <td className="num">{r.signing_year}</td>
                    <td>{r.country_market || MISSING}</td>
                    <td>{r.primary_position || MISSING}</td>
                    <td>{humanize(r.pathway)}</td>
                    <td className="num" title={r.total_known_acquisition_cost_usd == null ? 'Unknown — not $0' : moneyExact(r.total_known_acquisition_cost_usd)}>{money(r.total_known_acquisition_cost_usd)}</td>
                    <td><AuditBadge status={r.outcome_audit_status} /></td>
                    <td className="num">{bwar(r.career_bwar)}</td>
                  </RowLink>
                ))}
              </tbody>
            </table>
          </div>
          <p className="micro-note table-foot"><Link className="text-link" href="/signings">Open the full signings table ({status.tracked_signings} Dodgers records) →</Link></p>
        </section>

        <nav aria-label="Database sections" className="section-index">
          {SECTIONS.map(([href, label, text]) => (
            <Link key={href} href={href} className="next-card">
              <strong>{label} →</strong>
              <p>{text}</p>
            </Link>
          ))}
        </nav>

        {knownMlb.length > 0 && (
          <section aria-labelledby="findings-heading" className="section-block secondary-findings">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Selected research findings</span>
                <h2 id="findings-heading">Highest career bWAR among verified MLB outcomes</h2>
              </div>
              <Link href="/signings?mlb=yes&sort=bwar&dir=desc">All verified MLB outcomes →</Link>
            </div>
            <p className="micro-note">These are individually verified cases, not a sample from which to infer a success rate.</p>
            <ol className="findings-list">
              {knownMlb.map((p) => (
                <li key={p.player_id}>
                  <PlayerLink slug={p.player_slug} name={p.full_name} />
                  <span className="muted">
                    {p.signing_year} · {p.country_market || 'Unknown market'} · {p.direct_dodgers_franchise_debut ? 'Dodgers-franchise debut' : `debuted with ${p.mlb_debut_org || 'another club'}`}
                  </span>
                  <strong>{bwar(p.career_bwar)} <small>bWAR{p.current_status?.startsWith('ACTIVE') ? ` through ${p.bwar_observed_through_season}` : ''}</small></strong>
                </li>
              ))}
            </ol>
          </section>
        )}
      </>}
    </main>
  )
}
