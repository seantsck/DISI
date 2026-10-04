import Link from 'next/link'
import DataMode from './components/DataMode'
import DataUnavailable from './components/DataUnavailable'
import { getDashboardData } from '../lib/data'
import { money, humanize } from '../lib/format'

export default async function HomePage() {
  const { live, error, universe, coverage, rateSummary, knownMlb } = await getDashboardData()

  if (!universe) {
    return (
      <main>
        <header className="hero shell overview-hero">
          <div className="hero-status"><DataMode live={live} error={error} /></div>
          <p className="kicker">Dodgers International Signing Intelligence</p>
          <h1>From signing capital to championship-window value.</h1>
        </header>
        <DataUnavailable error={error} />
      </main>
    )
  }

  const covYears = coverage.filter(c => c.expected_signings)
  const topMlb = knownMlb.slice(0, 12)

  return (
    <main>
      <header className="hero shell overview-hero">
        <div className="hero-status"><DataMode live={live} error={error} /></div>
        <p className="kicker">Dodgers International Signing Intelligence</p>
        <h1>{universe.tracked_signings} tracked international acquisitions. One franchise-wide research system.</h1>
        <p className="hero-copy">
          Public-data intelligence spanning {universe.earliest_signing_year}–{universe.latest_signing_year},
          with signing-class coverage, outcome audits, development, downstream MLB value and asset conversion kept analytically separate.
        </p>
      </header>

      <section className="shell kpi-grid">
        <div className="kpi-card"><span>Tracked acquisitions</span><strong>{universe.tracked_signings}</strong><small>{universe.tracked_markets} markets represented</small></div>
        <div className="kpi-card"><span>Outcomes audited</span><strong>{universe.audited_outcomes}</strong><small>{universe.outcome_audit_queue} remain in the research queue</small></div>
        <div className="kpi-card"><span>Verified MLB outcomes</span><strong>{knownMlb.length}</strong><small>Known cases, not a population hit rate</small></div>
        <div className="kpi-card"><span>Known acquisition cost</span><strong>{money(universe.known_acquisition_cost_usd)}</strong><small>Unknown cost components remain null</small></div>
      </section>

      <section className="shell page-guardrail">
        <strong>No denominator theater.</strong>
        {rateSummary?.rate_eligible_classes
          ? ` ${rateSummary.rate_eligible_classes} mature signing classes currently satisfy both complete signing-population and complete outcome-audit requirements for rate analysis.`
          : ' No mature signing class currently satisfies both complete signing-population and complete outcome-audit requirements, so DISI withholds an organization-wide MLB reach rate.'}
      </section>

      <section className="shell section-block">
        <div className="section-heading">
          <div><span className="eyebrow">Known MLB value</span><h2>The international pipeline is much bigger than four players.</h2></div>
          <Link href="/signings">Open all tracked signings →</Link>
        </div>
        <div className="mlb-outcome-grid">
          {topMlb.map((p) => (
            <article className="mlb-outcome-card" key={p.player_id}>
              <div className="coverage-top"><span>{p.signing_year}</span><span>{p.country_market || 'Unknown market'}</span></div>
              <h3>{p.full_name}</h3>
              <div className="case-big">{p.career_war == null ? '—' : Number(p.career_war).toFixed(1)} <small>observed career WAR</small></div>
              <p>{p.direct_dodgers_franchise_debut ? 'Dodgers-franchise MLB debut' : `MLB debut: ${p.mlb_debut_org || '—'}`}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="shell section-block">
        <div className="section-heading">
          <div><span className="eyebrow">Census progress</span><h2>How complete are the signing classes?</h2></div>
          <Link href="/research">Open research queue →</Link>
        </div>
        <div className="coverage-grid">
          {covYears.map((c) => {
            const pct = c.coverage_rate == null ? null : Number(c.coverage_rate) * 100
            return (
              <div className="coverage-card" key={`${c.signing_year}-${c.coverage_type}`}>
                <div className="coverage-top"><strong>{c.signing_year}</strong><span>{humanize(c.coverage_type)}</span></div>
                <div className="coverage-number">{c.tracked_signings}{c.expected_signings ? ` / ${c.expected_signings}` : ''}</div>
                {pct != null && <div className="coverage-track"><i style={{width:`${Math.min(100,pct)}%`}} /></div>}
                <small>{pct == null ? 'Verified set; total population unknown' : `${pct.toFixed(0)}% reconstructed`}</small>
              </div>
            )
          })}
        </div>
      </section>

      <section className="shell next-grid">
        <Link href="/signings" className="next-card"><span>181-player universe</span><strong>Signings →</strong><p>Every reconstructed player, acquisition cost, audit state and MLB outcome.</p></Link>
        <Link href="/research" className="next-card"><span>Data operations</span><strong>Research Queue →</strong><p>Prioritized outcome audits and class-level completion.</p></Link>
        <Link href="/markets" className="next-card"><span>Geography & pathways</span><strong>Markets →</strong><p>Where talent came from and how the acquisition model evolved.</p></Link>
        <Link href="/league" className="next-card"><span>Cross-club context</span><strong>League Benchmark →</strong><p>Compare international signing volume, bonus pools and tracked top prospects.</p></Link>
        <Link href="/asset-conversion" className="next-card"><span>Disposition value</span><strong>Asset Conversion →</strong><p>Trade and competitive-context analysis for players converted into other assets.</p></Link>
      </section>
    </main>
  )
}
