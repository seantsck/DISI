import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import PlayerLink from '../components/PlayerLink'
import { getDevelopmentData } from '../../lib/data.js'
import { money, num, bwar, humanize, dateLabel, MISSING } from '../../lib/format.js'

export const metadata = { title: 'Development' }

// Rendered per request so pages always reflect the live database (never a build-time snapshot).
export const dynamic = 'force-dynamic'

const ISSUE_LABELS = {
  IDENTITY_BUT_NO_PROFESSIONAL_SEASONS: 'Resolved identity but no professional seasons recorded',
  SEASON_GAP: 'A season is missing between the first and last recorded season',
  UNKNOWN_LEVEL_CLASSIFICATION: 'A stint could not be classified into the canonical taxonomy',
  UNRESOLVED_ORGANIZATION: 'A stint has no organization resolved from its team/league/season',
  MULTI_ORG_SEASON_UNVERIFIED: 'Two organizations appear in the same season; the trade date needs review',
  MLB_PLAYER_MISSING_PRE_MLB_HISTORY: 'Reached MLB but no pre-MLB development record was found',
  LEVEL_CONFLICT: 'Source label and canonical classification disagree',
}

function whenCell(exact, season) {
  if (exact) return <>{dateLabel(exact)} <span className="muted">(exact)</span></>
  if (season != null) return <>{season} <span className="muted">(season only)</span></>
  return <span className="unknown">{MISSING}</span>
}

export default async function DevelopmentPage() {
  const { live, error, coverage, byClass, byMarket, byBonus, queue, debuts } = await getDevelopmentData()
  const timed = debuts.filter((r) => r.years_signing_to_mlb != null)
  const queueByIssue = queue.reduce((acc, r) => { acc[r.issue] = (acc[r.issue] || 0) + 1; return acc }, {})
  const queueIssues = Object.entries(queueByIssue).sort((a, b) => b[1] - a[1])
  return (
    <main className="shell page-main">
      <header className="page-hero">
        <div>
          <span className="eyebrow">Longitudinal progression</span>
          <h1>Development</h1>
          <p>Season-by-season development history for tracked players: stints, first appearances by level, and time from signing to each level where the records allow it.</p>
        </div>
        <DataMode live={live} error={error} />
      </header>
      {!live && <DataUnavailable error={error} />}
      {live && <>
        <div className="page-guardrail"><strong>Exact dates and season labels are separate measures.</strong> A season split evidences that a player appeared for a team in a season — never a date. Elapsed times are computed only where both endpoint dates exist; everywhere else the season is shown as a season, and unknown stays unknown rather than becoming a zero.</div>

        {coverage && (
          <section className="timeline-panel">
            <div className="table-head">
              <div><span className="eyebrow">Coverage</span><h2>Development data on record</h2></div>
              <span className="micro-note">Tracked cohort — never a rate</span>
            </div>
            <dl className="fact-grid wide">
              <div className="fact"><dt>Tracked players</dt><dd>{coverage.tracked_players}</dd></div>
              <div className="fact"><dt>With development history</dt><dd>{coverage.players_with_stints}</dd></div>
              <div className="fact"><dt>No structured season rows returned</dt><dd>{coverage.players_without_stints} <span className="muted">({coverage.resolved_players_without_stints} queried with a resolved identity; absence of data is not evidence of not playing)</span></dd></div>
              <div className="fact"><dt>MLB players with pre-MLB history</dt><dd>{coverage.mlb_players_with_pre_mlb_history} of {coverage.players_with_mlb_history}</dd></div>
              <div className="fact"><dt>First Double-A on record</dt><dd>{coverage.players_with_first_aa_season} <span className="muted">(season; {coverage.players_with_exact_first_aa_date} exact)</span></dd></div>
              <div className="fact"><dt>First Triple-A on record</dt><dd>{coverage.players_with_first_aaa_season} <span className="muted">(season; {coverage.players_with_exact_first_aaa_date} exact)</span></dd></div>
              <div className="fact"><dt>Signing → MLB calculable</dt><dd>{coverage.players_with_signing_to_mlb_time} <span className="muted">(both exact dates)</span></dd></div>
            </dl>
          </section>
        )}

        <section className="timeline-panel section-gap">
          <div className="table-head">
            <div><span className="eyebrow">Tracked cohort</span><h2>By signing class</h2></div>
            <span className="micro-note">Reached = developmental arrival after reviewed progression decisions (cameos and pending reviews are not counted); medians need two exact dates</span>
          </div>
          <table className="compact-table">
            <thead><tr>
              <th>Class</th><th className="num">Tracked</th><th className="num">Reached A</th><th className="num">High-A</th>
              <th className="num">AA</th><th className="num">AAA</th><th className="num">MLB</th>
              <th className="num">Median yrs to AA (exact)</th><th className="num">n</th>
              <th className="num">Median yrs to MLB (exact)</th><th className="num">n</th>
            </tr></thead>
            <tbody>{byClass.map((r) => (
              <tr key={r.signing_year}>
                <td>{r.signing_year}</td>
                <td className="num">{r.tracked_players}</td>
                <td className="num">{r.developmentally_reached_a ?? MISSING}</td>
                <td className="num">{r.developmentally_reached_high_a ?? MISSING}</td>
                <td className="num">{r.developmentally_reached_aa ?? MISSING}</td>
                <td className="num">{r.developmentally_reached_aaa ?? MISSING}</td>
                <td className="num">{r.reached_mlb}</td>
                <td className="num">{r.median_years_signing_to_aa_exact == null ? MISSING : num(r.median_years_signing_to_aa_exact, 2)}</td>
                <td className="num">{r.years_signing_to_aa_n}</td>
                <td className="num">{r.median_years_signing_to_mlb_exact == null ? MISSING : num(r.median_years_signing_to_mlb_exact, 2)}</td>
                <td className="num">{r.years_signing_to_mlb_n}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="muted small-note">Counts describe the tracked players in each class, not the full signing period. A brief cameo or an appearance still under progression review is a first appearance, not a reached level. Medians cover only the subset with both endpoint dates; the n columns say how many.</p>
        </section>

        <div className="dossier-grid section-gap">
          <section className="panel">
            <h2>By signing market</h2>
            <table className="compact-table">
              <thead><tr><th>Market</th><th className="num">Tracked</th><th className="num">AA</th><th className="num">AAA</th><th className="num">MLB</th><th className="num">Median signing age</th></tr></thead>
              <tbody>{byMarket.map((r) => (
                <tr key={r.country_market ?? 'unknown'}>
                  <td>{r.country_market ?? <span className="unknown">Unknown market</span>}</td>
                  <td className="num">{r.tracked_players}</td>
                  <td className="num">{r.developmentally_reached_aa ?? MISSING}</td>
                  <td className="num">{r.developmentally_reached_aaa ?? MISSING}</td>
                  <td className="num">{r.mlb_reach_count}</td>
                  <td className="num">{r.median_signing_age == null ? MISSING : num(r.median_signing_age, 1)}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="muted small-note">Descriptive comparison of where players were signed; no causal interpretation is implied.</p>
          </section>
          <section className="panel">
            <h2>By acquisition cost</h2>
            <table className="compact-table">
              <thead><tr><th>Bonus band</th><th className="num">Tracked</th><th className="num">AA</th><th className="num">AAA</th><th className="num">MLB</th><th className="num">Median yrs to MLB (exact)</th></tr></thead>
              <tbody>{byBonus.map((r) => (
                <tr key={r.bonus_band}>
                  <td>{r.bonus_band}</td>
                  <td className="num">{r.tracked_players}</td>
                  <td className="num">{r.developmentally_reached_aa ?? MISSING}</td>
                  <td className="num">{r.developmentally_reached_aaa ?? MISSING}</td>
                  <td className="num">{r.reached_mlb}</td>
                  <td className="num">{r.median_years_signing_to_mlb == null ? MISSING : num(r.median_years_signing_to_mlb, 2)}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="muted small-note">Unknown acquisition cost stays its own band; it is not $0 and not imputed.</p>
          </section>
        </div>

        <section className="timeline-panel section-gap">
          <div className="table-head">
            <div><span className="eyebrow">Research queue</span><h2>What still needs review</h2></div>
            <span className="micro-note">{queue.length} open items</span>
          </div>
          <ul className="plain-list">
            {queueIssues.map(([issue, count]) => (
              <li key={issue}><strong>{count}</strong> · {ISSUE_LABELS[issue] ?? humanize(issue)}</li>
            ))}
          </ul>
          <details>
            <summary className="muted">All {queue.length} queued players</summary>
            <table className="compact-table">
              <thead><tr><th>Player</th><th>Class</th><th>Issue</th><th>Detail</th></tr></thead>
              <tbody>{queue.map((r, i) => (
                <tr key={`${r.player_slug}-${r.issue}-${i}`}>
                  <td><PlayerLink slug={r.player_slug} name={r.full_name} /></td>
                  <td>{r.signing_year ?? MISSING}</td>
                  <td>{ISSUE_LABELS[r.issue] ?? humanize(r.issue)}</td>
                  <td className="muted">{r.detail}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>
        </section>

        <section className="timeline-panel section-gap">
          <div className="table-head">
            <div><span className="eyebrow">Verified MLB progression</span><h2>Signing → MLB debut</h2></div>
            <span className="micro-note">{timed.length} of {debuts.length} verified debuts have both dates</span>
          </div>
          <div className="development-list">
            {debuts.map((r) => (
              <article className="development-row" key={r.signing_id}>
                <div>
                  <strong><PlayerLink slug={r.player_slug} name={r.full_name} /></strong>
                  <span>{r.signing_year} · {r.country_market || 'Unknown market'} · {humanize(r.pathway)}</span>
                </div>
                <div className="development-metric">
                  <strong>{r.years_signing_to_mlb == null ? 'Date gap' : `${num(r.years_signing_to_mlb, 2)} yrs`}</strong>
                  <span>to {r.mlb_debut_org || 'MLB'} · {dateLabel(r.mlb_debut_date)}</span>
                </div>
                <div className="development-metric">
                  <strong>{bwar(r.career_bwar)}</strong>
                  <span>career bWAR{r.career_bwar != null && r.current_status?.startsWith('ACTIVE') ? ` thru ${r.bwar_observed_through_season}` : ''}</span>
                </div>
                <div className="development-metric">
                  <strong>{money(r.signing_bonus_usd)}</strong>
                  <span>signing bonus</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </>}
    </main>
  )
}
