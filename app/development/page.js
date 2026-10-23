import DataMode from '../components/DataMode'
import DataUnavailable from '../components/DataUnavailable'
import PlayerLink from '../components/PlayerLink'
import { getDevelopmentData } from '../../lib/data.js'
import { money, num, bwar, humanize, dateLabel, MISSING } from '../../lib/format.js'
import { developmentCoverage, developmentRecords, timingFacts } from '../../lib/research/development-research.js'
import { auditedNoMlbCoverage, verifiedMlbCoverage } from '../../lib/research/history-coverage.js'
import { NEED_GROUPS, developmentNeedSummary, developmentNeeds } from '../../lib/research/development-needs.js'

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
  MISSING_FIRST_GAME_DATE: 'A log-era stint has no verified first appearance date',
  MISSING_LAST_GAME_DATE: 'A log-era stint has no verified last appearance date',
  GAME_LOG_UNAVAILABLE: 'Log-era stints exist but none carry game-verified dates',
  SEASON_ONLY_MILESTONE: 'A level debut stays at season precision',
  MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES: 'Reached MLB with pre-MLB stints, but no level debut carries an exact date',
  UNKNOWN_LEVEL_GAME_LOG: 'A stint with an unclassified level has no dated appearances',
  NON_MONOTONIC_PROGRESSION: 'Developmental arrivals run backward and no reviewed decision covers it',
  LEVEL_SKIP_CAMEO_CANDIDATE: 'A brief higher-level first appearance that skips the level below, with no reviewed decision',
  EXACT_DATE_CONFLICT: 'Game-log evidence disagrees with an existing exact date',
}

const GAP_LABELS = {
  SOURCE_UNAVAILABLE: 'Source returns no pre-MLB record',
  SOURCE_BEGINS_LATE: 'Source begins late',
  NO_EVIDENCE_FOUND: 'Season with no record',
  ORGANIZATION_UNCLEAR: 'Organization unclear',
  LEVEL_UNCLEAR: 'Level unclear',
}

const COVERAGE_CARDS = [
  { key: 'any_pre_mlb_history', label: 'Any pre-MLB history', what: 'at least one minor-league season on record before the debut season' },
  { key: 'usable_affiliate_chronology', label: 'Usable affiliate chronology', what: 'stints on record and no open chronology issue; the rest cannot support timing analysis' },
  { key: 'exact_signing_date', label: 'Exact signing date', what: 'a recorded signing date' },
  { key: 'exact_mlb_debut_date', label: 'Exact MLB debut date', what: 'a verified debut date' },
  { key: 'signing_to_mlb_both_dates', label: 'Signing to MLB calculable', what: 'both dates exact; a season is never turned into a date' },
  { key: 'verified_first_professional_season', label: 'Verified first professional season', what: 'earliest record is the signing season or the next, for an amateur signing; a later start is only the first observed season' },
]


// 051: the audited no-MLB cohort's coverage cards (each a count with its denominator)
const NO_MLB_CARDS = [
  { key: 'any_development_history', label: 'Any development history', what: 'at least one season on record, affiliated or in a foreign professional league' },
  { key: 'highest_level_known', label: 'Known highest level', what: 'a highest affiliated level on record; absence from MLB is never turned into a level' },
  { key: 'usable_chronology', label: 'Usable chronology', what: 'stints on record and no open chronology issue; the rest cannot support timing analysis' },
  { key: 'later_career_with_other_organizations', label: 'Later career elsewhere', what: 'affiliated seasons with another organization are on record; they are not Dodgers development' },
]
const LEVEL_ROWS = ['INTERNATIONAL_ROOKIE', 'COMPLEX_ROOKIE', 'LOW_A', 'HIGH_A', 'AA', 'AAA']

const DIMENSION_CARDS = [
  { key: 'SIGNING_DATE', label: 'Signing date', what: 'tracked signings with a recorded signing date' },
  { key: 'FIRST_PRO_SEASON', label: 'First professional season', what: 'amateur signings whose earliest record is the signing season or the next; a later start is only the first observed record, and an established professional’s first affiliated season is not his first professional season' },
  { key: 'HIGHEST_LEVEL', label: 'Highest level reached', what: 'tracked signings with a known highest level (a verified MLB debut counts as MLB)' },
  { key: 'MLB_DEBUT', label: 'MLB debut date', what: 'verified MLB players with a recorded debut date' },
  { key: 'CHRONOLOGY', label: 'Affiliate chronology', what: 'tracked signings with stints on record and no open chronology issue; the rest cannot support timing analysis' },
]

function whenCell(exact, season) {
  if (exact) return <>{dateLabel(exact)} <span className="muted">(exact)</span></>
  if (season != null) return <>{season} <span className="muted">(season only)</span></>
  return <span className="unknown">{MISSING}</span>
}

export default async function DevelopmentPage() {
  const { live, error, coverage, byClass, byMarket, byBonus, queue, debuts, devSignings, devSummary, mlbStints } = await getDevelopmentData()
  const timed = debuts.filter((r) => r.years_signing_to_mlb != null)
  // 047: completeness per dimension (each with its denominator) and descriptive timing; the EXIT dimension lives on /asset-conversion
  const dataset = { signings: devSignings, developmentSummary: devSummary, developmentQueue: queue, decisions: [], transactionQueue: [] }
  const completeness = developmentCoverage(dataset, { dimensions: DIMENSION_CARDS.map((d) => d.key) })
  const timing = timingFacts(dataset)
  // 048: the verified MLB cohort's documented path, player by player (stints read for the 47 players; absent stints leave the table out)
  const stintsByPlayer = new Map()
  for (const s of mlbStints ?? []) { if (!stintsByPlayer.has(s.player_id)) stintsByPlayer.set(s.player_id, []); stintsByPlayer.get(s.player_id).push(s) }
  const mlbCoverage = stintsByPlayer.size > 0 ? verifiedMlbCoverage(dataset, stintsByPlayer, developmentRecords) : null
  // 051: the audited no-MLB cohort, from the same stint relation (read for those 46 players); absent stints leave the section out
  const noMlbCoverage = stintsByPlayer.size > 0 && devSignings.some((s) => s.outcome_audit_status === 'VERIFIED_NO_MLB')
    ? auditedNoMlbCoverage(dataset, stintsByPlayer, developmentRecords, developmentNeeds) : null
  const noMlbIds = new Set((noMlbCoverage?.rows ?? []).map((r) => r.player_id))
  const noMlbNeeds = developmentNeedSummary({ ...dataset, developmentQueue: queue.filter((q) => noMlbIds.has(q.player_id)) })
  // 048: the same queue, de-duplicated by the evidence gap each item names
  const needs = developmentNeeds(dataset)
  const needSummary = developmentNeedSummary(dataset)
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


        <section className="timeline-panel section-gap" aria-labelledby="completeness-heading">
          <div className="table-head">
            <div><span className="eyebrow">Completeness</span><h2 id="completeness-heading">Development-history completeness</h2></div>
            <span className="micro-note">Independent dimensions, each with its own denominator. A count of what is on record, never a success rate</span>
          </div>
          <p className="muted">Unknown development history is not “no development”: a player with a gap here is a research task, not a negative result. An audited outcome and a complete development history are separate states.</p>
          <div className="coverage-grid">
            {DIMENSION_CARDS.map((d) => {
              const c = completeness.dimensions[d.key]
              return (
                <div key={d.key}>
                  <span>{d.label}</span>
                  <strong>{c.known} of {c.applicable}</strong>
                  <small>{d.what}</small>
                </div>
              )
            })}
          </div>
          <h3 className="sub">Signing to MLB, where both dates are exact</h3>
          <p>
            <strong>{timing.signing_to_mlb_exact.n} of {timing.signing_to_mlb_exact.of}</strong> verified MLB players have an exact signing date and an exact debut date.
            {timing.signing_to_mlb_exact.n > 0 && <> Among those {timing.signing_to_mlb_exact.n}: {num(timing.signing_to_mlb_exact.min_years, 2)} to {num(timing.signing_to_mlb_exact.max_years, 2)} years (median {num(timing.signing_to_mlb_exact.median_years, 2)}).</>}
            {' '}This describes only those players; it is not an organization-wide figure and is not compared across cohorts.
          </p>
          <p className="muted">
            By acquisition route, each with its own denominator: <strong>{timing.signing_to_mlb_exact_by_route.amateur_signing.n} of {timing.signing_to_mlb_exact_by_route.amateur_signing.of}</strong> amateur signings
            {timing.signing_to_mlb_exact_by_route.amateur_signing.n > 0 && <> ({num(timing.signing_to_mlb_exact_by_route.amateur_signing.min_years, 2)} to {num(timing.signing_to_mlb_exact_by_route.amateur_signing.max_years, 2)} years, median {num(timing.signing_to_mlb_exact_by_route.amateur_signing.median_years, 2)})</>}
            {' '}and <strong>{timing.signing_to_mlb_exact_by_route.established_professional.n} of {timing.signing_to_mlb_exact_by_route.established_professional.of}</strong> established professionals
            {timing.signing_to_mlb_exact_by_route.established_professional.n > 0 && <> ({num(timing.signing_to_mlb_exact_by_route.established_professional.min_years, 2)} to {num(timing.signing_to_mlb_exact_by_route.established_professional.max_years, 2)} years, median {num(timing.signing_to_mlb_exact_by_route.established_professional.median_years, 2)})</>}.
            {' '}An established professional’s interval is acquisition to debut, not development from an amateur signing; the two are not compared.
          </p>
          <h3 className="sub">Highest level recorded among audited non-MLB players (whole recorded career, any organization)</h3>
          <p>
            <strong>{timing.highest_level_known.n} of {timing.highest_level_known.of}</strong> audited non-MLB players have a known highest level.
            Players whose outcome is NOT_AUDITED are not counted here and are not treated as negative outcomes. This counts every recorded affiliated
            season, including seasons with other organizations after the player left; the Dodgers-affiliate part is shown separately below.
          </p>
          {Object.keys(timing.highest_level_counts).length > 0 && (
            <div className="signal-row">{Object.entries(timing.highest_level_counts).map(([level, n]) => <span key={level}>{humanize(level)} · {n}</span>)}</div>
          )}
          <p className="muted small-note">Unresolved development research: {needSummary.needs} distinct evidence gaps across {needSummary.players} players, merged from {needSummary.detector_rows} detector rows (listed below).</p>
        </section>

        {mlbCoverage && (
          <section className="timeline-panel section-gap" aria-labelledby="mlb-coverage-heading">
            <div className="table-head">
              <div><span className="eyebrow">Verified MLB players</span><h2 id="mlb-coverage-heading">How much of each path is documented</h2></div>
              <span className="micro-note">{mlbCoverage.players} verified MLB players · season-level records · a count of what is on record, never a rate</span>
            </div>
            <p className="muted">A partial chronology stays partial. The source often begins after the professional career did, and a missing season is unknown, not a season the player did not play. {mlbCoverage.prior_professional_career.n} of the {mlbCoverage.players} were established professionals when signed (Cuban, Mexican, Japanese or Korean leagues); affiliated records do not describe that earlier career, and their first affiliated season is not their first professional season.</p>
            <div className="coverage-grid">
              {COVERAGE_CARDS.map((c) => {
                const v = mlbCoverage[c.key]
                return (
                  <div key={c.key}>
                    <span>{c.label}</span>
                    <strong>{v.n} of {v.of}</strong>
                    <small>{c.what}</small>
                  </div>
                )
              })}
              <div>
                <span>Documented path</span>
                <strong>{mlbCoverage.path_state.NO_OPEN_GAP} of {mlbCoverage.path_state.of}</strong>
                <small>no gap visible at season precision (never “complete”); the other {mlbCoverage.path_state.PARTIAL} are partial</small>
              </div>
              <div>
                <span>Pending progression review</span>
                <strong>{mlbCoverage.progression_review_pending.n} of {mlbCoverage.progression_review_pending.of}</strong>
                <small>an ambiguous level sequence a person has not yet decided</small>
              </div>
            </div>
            <details>
              <summary className="muted">The {mlbCoverage.players} paths, with why each record is silent where it is</summary>
              <table className="compact-table">
                <thead><tr><th>Player</th><th className="num">Signed</th><th className="num">First observed</th><th className="num">Pre-MLB seasons</th><th>Record</th><th>Where the record is silent</th><th>First professional season</th></tr></thead>
                <tbody>{mlbCoverage.rows.map((r) => (
                  <tr key={r.player_id}>
                    <td><PlayerLink slug={r.player_slug} name={r.full_name} /></td>
                    <td className="num">{r.signing_year}</td>
                    <td className="num">{r.history.first_observed_season ?? MISSING}</td>
                    <td className="num">{r.history.pre_mlb_seasons_observed}</td>
                    <td>{r.history.state === 'NO_OPEN_GAP' ? 'No gap visible' : <strong>Partial</strong>}{r.progression_review_pending && <span className="muted"> · review pending</span>}</td>
                    <td className="muted">{r.history.gaps.length ? r.history.gaps.map((g) => GAP_LABELS[g.code] ?? humanize(g.code)).join(' · ') : MISSING}{r.history.notes.some((n) => n.code === 'PRIOR_PROFESSIONAL_CAREER') && ' · prior professional career'}</td>
                    <td>{r.dims.FIRST_PRO_SEASON === 'KNOWN' ? 'Known' : <span className="unknown">{r.first_pro_status === 'PRIOR_PROFESSIONAL_CAREER' ? 'Not established (prior professional career)' : r.first_pro_status === 'FIRST_OBSERVED_ONLY' ? 'Only the first observed season' : 'Unknown'}</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            </details>
          </section>
        )}

        {noMlbCoverage && (
          <section className="timeline-panel section-gap" aria-labelledby="no-mlb-heading">
            <div className="table-head">
              <div><span className="eyebrow">Audited no-MLB cohort</span><h2 id="no-mlb-heading">Audited no-MLB development histories</h2></div>
              <span className="micro-note">{noMlbCoverage.players} players whose outcome audit is VERIFIED_NO_MLB · descriptive · not a success or failure rate · not a causal explanation</span>
            </div>
            <p className="muted">
              An audited no-MLB outcome is not a career failure and not an absence of development. Each figure below is what the structured season and
              game-log records document, with its denominator. A last observed season is not a career end or a release, and a missing season is unknown,
              not a season the player did not play. Players whose outcome is NOT_AUDITED are not in this cohort.
            </p>
            <div className="coverage-grid">
              {NO_MLB_CARDS.map((c) => {
                const v = noMlbCoverage[c.key]
                return (
                  <div key={c.key}>
                    <span>{c.label}</span>
                    <strong>{v.n} of {v.of}</strong>
                    <small>{c.what}</small>
                  </div>
                )
              })}
              <div>
                <span>Verified first professional season</span>
                <strong>{noMlbCoverage.first_professional_season.KNOWN ?? 0} of {noMlbCoverage.players}</strong>
                <small>{noMlbCoverage.first_professional_season.FIRST_OBSERVED_ONLY ?? 0} have only a first observed season; {noMlbCoverage.first_professional_season.NO_AFFILIATED_RECORD ?? 0} have no affiliated record</small>
              </div>
              <div>
                <span>Exact game dates</span>
                <strong>{noMlbCoverage.exact_dates.dated} of {noMlbCoverage.exact_dates.log_era_stints}</strong>
                <small>log-era (2006+) team stints with game-log first and last appearances; a season is never turned into a date</small>
              </div>
            </div>
            <h3 className="sub">Highest recorded level: the whole recorded career and the Dodgers-affiliate part of it</h3>
            <p className="muted">
              Two different questions, never blended. {noMlbCoverage.highest_level_reached_elsewhere.n} of {noMlbCoverage.players} first reached their highest
              recorded level with another organization, after leaving the Dodgers; that later play is career context, not Dodgers development. A rookie-advanced
              (Pioneer League) season is on record for {noMlbCoverage.unplaceable_level_on_record.n} players but has no place on the level ladder, so it is never ranked.
            </p>
            <table className="compact-table">
              <thead><tr><th>Level</th><th className="num">Whole recorded career</th><th className="num">At a Dodgers affiliate</th></tr></thead>
              <tbody>{LEVEL_ROWS.map((level) => (
                <tr key={level}>
                  <td>{humanize(level)}</td>
                  <td className="num">{noMlbCoverage.highest_level_whole_career[level] ?? 0}</td>
                  <td className="num">{noMlbCoverage.highest_level_at_dodgers_affiliate[level] ?? 0}</td>
                </tr>
              ))}
              <tr className="muted"><td>Unknown, or no level on the ladder</td><td className="num">{noMlbCoverage.highest_level_known.of - noMlbCoverage.highest_level_known.n}</td><td className="num">{noMlbCoverage.players - Object.values(noMlbCoverage.highest_level_at_dodgers_affiliate).reduce((a, b) => a + b, 0)}</td></tr>
              </tbody>
            </table>
            <p className="muted small-note">
              Unresolved development research for this cohort: {noMlbNeeds.needs} distinct evidence gaps across {noMlbNeeds.players} players
              {noMlbNeeds.needs > 0 && <> ({Object.entries(noMlbNeeds.by_need).map(([k, n]) => `${humanize(k)} ${n}`).join(', ')})</>}.
              {noMlbCoverage.season_gap_only_league_not_played.of > 0 && <> Every season-gap item here names only 2020, the cancelled minor-league season ({noMlbCoverage.season_gap_only_league_not_played.n} of {noMlbCoverage.season_gap_only_league_not_played.of}).</>}
            </p>
            <details>
              <summary className="muted">The {noMlbCoverage.players} documented paths</summary>
              <table className="compact-table">
                <thead><tr><th>Player</th><th className="num">Signed</th><th className="num">First observed</th><th>First professional season</th><th>Highest recorded level</th><th>At a Dodgers affiliate</th><th>Last observed affiliated season</th><th>Where the record is silent</th></tr></thead>
                <tbody>{noMlbCoverage.rows.map((r) => (
                  <tr key={r.player_id}>
                    <td><PlayerLink slug={r.player_slug} name={r.full_name} /></td>
                    <td className="num">{r.signing_year}</td>
                    <td className="num">{r.history.first_observed_season ?? MISSING}</td>
                    <td>{r.first_pro_status === 'KNOWN' ? 'Known' : <span className="unknown">{r.first_pro_status === 'FIRST_OBSERVED_ONLY' ? 'Only the first observed season' : r.first_pro_status === 'PRIOR_PROFESSIONAL_CAREER' ? 'Not established (prior professional career)' : 'No affiliated record'}</span>}</td>
                    <td>{r.highest_level_recorded ? humanize(r.highest_level_recorded) : <span className="unknown">Unknown</span>}</td>
                    <td>{r.segments.highest_level_at_dodgers_affiliate ? humanize(r.segments.highest_level_at_dodgers_affiliate.level) : <span className="unknown">{MISSING}</span>}</td>
                    <td>{r.segments.last_observed_affiliated
                      ? <>{r.segments.last_observed_affiliated.season} <span className="muted">· {r.segments.last_observed_affiliated.organizations.map((o) => (o === 'UNKNOWN_ORGANIZATION' ? 'organization unresolved' : o)).join(' / ')}</span></>
                      : <span className="unknown">None on record</span>}</td>
                    <td className="muted">{r.history.gaps.length ? r.history.gaps.map((g) => GAP_LABELS[g.code] ?? humanize(g.code)).join(' · ') : MISSING}{r.progression_review_pending && ' · progression review pending'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </details>
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
            <span className="micro-note">{needSummary.needs} evidence gaps · {needSummary.detector_rows} detector rows merged</span>
          </div>
          <p className="muted">Several detectors fire on the same missing evidence (a stint with no game dates also keeps every level debut at season precision), and researching one closes all of them. Each gap below is one piece of work; nothing is dropped, and a gap closes only when every detector it merges is quiet.</p>
          <ul className="plain-list">
            {NEED_GROUPS.filter((g) => needSummary.by_need[g.key]).map((g) => (
              <li key={g.key}><strong>{needSummary.by_need[g.key]}</strong> · {g.action}</li>
            ))}
          </ul>
          <details>
            <summary className="muted">All {needs.length} gaps by player</summary>
            <table className="compact-table">
              <thead><tr><th>Player</th><th>Class</th><th>Gap</th><th>Detectors merged</th></tr></thead>
              <tbody>{needs.map((r) => (
                <tr key={`${r.player_id}-${r.need}`}>
                  <td>{r.player_slug ? <PlayerLink slug={r.player_slug} name={r.full_name} /> : MISSING}</td>
                  <td>{r.signing_year ?? MISSING}</td>
                  <td>{humanize(r.need)}</td>
                  <td className="muted">{r.issues.map((i) => ISSUE_LABELS[i] ?? humanize(i)).join(' · ')}</td>
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
