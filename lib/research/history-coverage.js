// How much of a verified MLB player's path from signing to MLB debut is actually documented (048). Pure functions over read-only rows.
//
// FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON. MISSING SEASON != NO SEASON PLAYED. PARTIAL HISTORY != NO HISTORY.
// UNKNOWN DEVELOPMENT HISTORY != NO DEVELOPMENT. Nothing here fills a season, a level or an organization: it names what is on record and says,
// for what is not, why the record is silent. There is deliberately no "complete" label: the strongest state is NO_OPEN_GAP at season precision.

import { isProfessionalPathway, FIRST_RECORD_MAX_GAP_SEASONS } from './development-research.js'

/**
 * Seasons in which the AFFILIATED minor-league calendar was not played, so a missing affiliated record for that season is explained by the
 * league, not by the player. This says nothing about where the player was that year (he may have played elsewhere); it only stops the gap from
 * being queued as an unknown affiliated season. Minor League Baseball's 2020 season was cancelled.
 */
export const LEAGUE_SEASON_NOT_PLAYED = Object.freeze({ 2020: 'The 2020 minor-league season was cancelled; no affiliated record exists for any player.' })

/** Gap codes: why the record is silent for part of the path. Each is a research obligation unless noted. */
export const HISTORY_GAP = Object.freeze({
  SOURCE_UNAVAILABLE: 'The source returns no structured pre-MLB record for this player.',
  SOURCE_BEGINS_LATE: 'The first structured record starts two or more seasons after signing; the earlier seasons are missing, not absent.',
  NO_EVIDENCE_FOUND: 'A season between the first record and the MLB debut has no structured record.',
  ORGANIZATION_UNCLEAR: 'A pre-MLB stint has no organization resolved from its team, league and season.',
  LEVEL_UNCLEAR: 'A pre-MLB stint could not be placed on the canonical level ladder.',
})

/** Notes: facts that explain, and do not by themselves open, a research obligation. */
export const HISTORY_NOTE = Object.freeze({
  PRIOR_PROFESSIONAL_CAREER: 'Signed as an established professional: affiliated records do not describe the career before the signing.',
  LEAGUE_SEASON_NOT_PLAYED: 'No affiliated league season was played in the listed year.',
})

const UNCLEAR_LEVEL = new Set(['UNKNOWN_ROOKIE_LEAGUE', 'UNRECOGNIZED_SPORT'])
const year = (v) => {
  const m = /^(\d{4})/.exec(String(v ?? ''))
  return m ? Number(m[1]) : null
}
const isTeamStint = (s) => (s.stint_kind ?? 'TEAM_STINT') === 'TEAM_STINT'

/**
 * The documented path of one player from signing to MLB debut, at season precision.
 * @param {{ signing_year?: number|null, mlb_debut_date?: string|null, pathway?: string|null }} subject
 * @param {{ season: number, level: string, stint_kind?: string, organization_name?: string|null, level_classification?: string|null, affiliated?: boolean|null }[]} stints
 */
export function historyCoverage(subject, stints) {
  const rows = (stints ?? []).filter(isTeamStint)
  const signingYear = subject.signing_year == null ? null : Number(subject.signing_year)
  const debutSeason = year(subject.mlb_debut_date)
  const preMlb = rows.filter((s) => s.level !== 'MLB' && (debutSeason === null || s.season <= debutSeason))
  // every pre-MLB minor-league record counts as a minor-league record, including a rookie league the ladder cannot place (LEVEL_UNCLEAR reports it)
  const affiliated = preMlb.filter((s) => s.level !== 'FOREIGN_PRO')
  const firstObserved = rows.length ? Math.min(...rows.map((s) => s.season)) : null
  const firstAffiliated = affiliated.length ? Math.min(...affiliated.map((s) => s.season)) : null
  const preMlbSeasons = [...new Set(preMlb.map((s) => s.season))].sort((a, b) => a - b)

  /** @type {{ code: string, detail: string, seasons?: number[] }[]} */
  const gaps = []
  /** @type {{ code: string, detail: string, seasons?: number[] }[]} */
  const notes = []
  let historyStart = 'NO_PRE_MLB_RECORD'
  let startGap = null

  if (preMlb.length === 0) {
    gaps.push({ code: 'SOURCE_UNAVAILABLE', detail: HISTORY_GAP.SOURCE_UNAVAILABLE })
  } else {
    startGap = firstAffiliated !== null && signingYear !== null ? firstAffiliated - signingYear : null
    if (startGap !== null && startGap > FIRST_RECORD_MAX_GAP_SEASONS) {
      historyStart = 'SOURCE_BEGINS_LATE'
      gaps.push({ code: 'SOURCE_BEGINS_LATE', detail: `${HISTORY_GAP.SOURCE_BEGINS_LATE} First record ${firstAffiliated}; signed ${signingYear}.`, seasons: [firstAffiliated] })
    } else if (firstAffiliated === null) {
      historyStart = 'NO_AFFILIATED_RECORD'
    } else {
      historyStart = 'FROM_SIGNING_SEASON'
    }
    // interior seasons with no record at all (any level, any league) between the first record and the MLB debut season
    const start = firstObserved ?? firstAffiliated
    const end = debutSeason ?? Math.max(...preMlbSeasons)
    const have = new Set(rows.map((s) => s.season))
    const missing = []
    const explained = []
    for (let y = start + 1; start !== null && y < end; y += 1) {
      if (have.has(y)) continue
      if (LEAGUE_SEASON_NOT_PLAYED[y]) explained.push(y)
      else missing.push(y)
    }
    if (missing.length) gaps.push({ code: 'NO_EVIDENCE_FOUND', detail: `${HISTORY_GAP.NO_EVIDENCE_FOUND} Seasons: ${missing.join(', ')}.`, seasons: missing })
    if (explained.length) notes.push({ code: 'LEAGUE_SEASON_NOT_PLAYED', detail: `${HISTORY_NOTE.LEAGUE_SEASON_NOT_PLAYED} ${explained.join(', ')}.`, seasons: explained })
    const noOrg = affiliated.filter((s) => !s.organization_name)
    if (noOrg.length) gaps.push({ code: 'ORGANIZATION_UNCLEAR', detail: HISTORY_GAP.ORGANIZATION_UNCLEAR, seasons: [...new Set(noOrg.map((s) => s.season))].sort((a, b) => a - b) })
    const unclear = preMlb.filter((s) => UNCLEAR_LEVEL.has(s.level_classification ?? ''))
    if (unclear.length) gaps.push({ code: 'LEVEL_UNCLEAR', detail: HISTORY_GAP.LEVEL_UNCLEAR, seasons: [...new Set(unclear.map((s) => s.season))].sort((a, b) => a - b) })
  }
  if (isProfessionalPathway(subject.pathway)) {
    notes.push({ code: 'PRIOR_PROFESSIONAL_CAREER', detail: HISTORY_NOTE.PRIOR_PROFESSIONAL_CAREER })
  }
  gaps.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  notes.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  return {
    first_observed_season: firstObserved,
    first_affiliated_season: firstAffiliated,
    start_gap_seasons: startGap,
    history_start: historyStart,
    debut_season: debutSeason,
    pre_mlb_seasons_observed: preMlbSeasons.length,
    pre_mlb_stints: preMlb.length,
    gaps,
    notes,
    // never "complete": NO_OPEN_GAP means only that no gap is visible in the structured season records
    // a prior professional career is never represented by affiliated records, so such a path is PARTIAL by construction
    state: gaps.length === 0 && historyStart === 'FROM_SIGNING_SEASON' && !isProfessionalPathway(subject.pathway) ? 'NO_OPEN_GAP' : 'PARTIAL',
  }
}

/**
 * The verified MLB cohort's development coverage: one row per player plus counts, each with its denominator.
 * @param {{ signings: any[], developmentSummary?: any[], developmentQueue?: any[], decisions?: any[], transactionQueue?: any[], exitSummary?: any[], sourceCounts?: any }} data
 * @param {Map<string, any[]> | Record<string, any[]>} stintsByPlayer player_id -> stint rows
 * @param {(data: any) => any[]} recordsOf developmentRecords (injected so this module has no import cycle)
 */
export function verifiedMlbCoverage(data, stintsByPlayer, recordsOf) {
  const get = (id) => (stintsByPlayer instanceof Map ? stintsByPlayer.get(id) : stintsByPlayer?.[id]) ?? []
  const summaries = new Map((data.developmentSummary ?? []).map((r) => [r.player_id, r]))
  const records = recordsOf(data).filter((r) => r.reached_mlb_verified)
  const rows = records.map((r) => {
    const sm = summaries.get(r.player_id) ?? {}
    const history = historyCoverage({ signing_year: r.signing_year, mlb_debut_date: r.mlb_debut_date, pathway: r.pathway }, get(r.player_id))
    return {
      player_id: r.player_id,
      player_slug: r.player_slug,
      full_name: r.full_name,
      signing_year: r.signing_year,
      signing_date: r.signing_date,
      mlb_debut_date: r.mlb_debut_date,
      pathway: r.pathway,
      first_pro_status: r.first_pro_status,
      dims: r.dims,
      days_signing_to_mlb_exact: sm.days_signing_to_mlb_exact ?? null,
      progression_review_pending: sm.progression_review_pending === true,
      history,
    }
  }).sort((a, b) => a.signing_year - b.signing_year || (a.player_slug < b.player_slug ? -1 : a.player_slug > b.player_slug ? 1 : 0))
  const n = rows.length
  const count = (f) => rows.filter(f).length
  const byStart = {}
  for (const r of rows) byStart[r.history.history_start] = (byStart[r.history.history_start] ?? 0) + 1
  return {
    players: n,
    any_pre_mlb_history: { n: count((r) => r.history.pre_mlb_stints > 0), of: n },
    usable_affiliate_chronology: { n: count((r) => r.dims.CHRONOLOGY === 'KNOWN'), of: n },
    exact_signing_date: { n: count((r) => r.dims.SIGNING_DATE === 'KNOWN'), of: n },
    exact_mlb_debut_date: { n: count((r) => r.dims.MLB_DEBUT === 'KNOWN'), of: n },
    signing_to_mlb_both_dates: { n: count((r) => r.days_signing_to_mlb_exact !== null && r.days_signing_to_mlb_exact !== undefined), of: n },
    verified_first_professional_season: { n: count((r) => r.dims.FIRST_PRO_SEASON === 'KNOWN'), of: n },
    // by acquisition pathway, not by whether an affiliated record exists: a Japanese or Cuban professional with no affiliated season is still one
    prior_professional_career: { n: count((r) => isProfessionalPathway(r.pathway)), of: n },
    progression_review_pending: { n: count((r) => r.progression_review_pending), of: n },
    path_state: { NO_OPEN_GAP: count((r) => r.history.state === 'NO_OPEN_GAP'), PARTIAL: count((r) => r.history.state === 'PARTIAL'), of: n },
    history_start: Object.fromEntries(Object.entries(byStart).sort(([a], [b]) => (a < b ? -1 : 1))),
    rows,
  }
}

/** A documented rule, not an analytical threshold: how many pre-MLB seasons make an expansion "substantial". */
export const SUBSTANTIAL_PRE_MLB_SEASONS = 3

/** The four final research results for a cohort player. */
export const RESEARCH_RESULT = Object.freeze(['SUBSTANTIALLY_EXPANDED', 'PARTIALLY_EXPANDED', 'NO_NEW_RELIABLE_EVIDENCE', 'UNRESOLVED_OR_CONFLICTED'])

/**
 * What a research pass achieved for one player. Deterministic and in this precedence:
 *   NO_NEW_RELIABLE_EVIDENCE   no pre-MLB stint was added (the player was already on record, or the source holds nothing before the debut)
 *   UNRESOLVED_OR_CONFLICTED   a level sequence is pending review (a person must decide before the levels count)
 *   SUBSTANTIALLY_EXPANDED     the pre-MLB path now reaches back to the signing season, with at least SUBSTANTIAL_PRE_MLB_SEASONS seasons and no season gap
 *   PARTIALLY_EXPANDED         pre-MLB history was added but starts late, has a gap, or is short
 * Added MLB-level stints alone are not development evidence.
 * @param {{ added_pre_mlb_stints: number, pending_review: boolean, history: ReturnType<typeof historyCoverage> }} p
 */
export function researchResult({ added_pre_mlb_stints, pending_review, history }) {
  if (added_pre_mlb_stints <= 0) return 'NO_NEW_RELIABLE_EVIDENCE'
  if (pending_review) return 'UNRESOLVED_OR_CONFLICTED'
  const gapless = !history.gaps.some((g) => g.code === 'NO_EVIDENCE_FOUND' || g.code === 'SOURCE_BEGINS_LATE' || g.code === 'SOURCE_UNAVAILABLE')
  if (history.history_start === 'FROM_SIGNING_SEASON' && gapless && history.pre_mlb_seasons_observed >= SUBSTANTIAL_PRE_MLB_SEASONS) return 'SUBSTANTIALLY_EXPANDED'
  return 'PARTIALLY_EXPANDED'
}

// ---- 051: the audited no-MLB cohort ---------------------------------------------------------------------------------------------------------
//
// AUDITED NO MLB != CAREER FAILURE. NO MLB OUTCOME != NO DEVELOPMENT. HIGHEST LEVEL != COMPLETE DEVELOPMENT HISTORY. LAST OBSERVED SEASON != CAREER
// END. LAST AFFILIATED APPEARANCE != RELEASE DATE. POST-CONTROL AFFILIATED PLAY != DODGERS DEVELOPMENT. UNKNOWN ORGANIZATION != DODGERS.
// These functions describe what the structured record documents. They never explain an outcome, never score a path, never infer an exit, an
// injury or a release from a gap, and never read a later season with another organization as Dodgers development.

/** The organization name the development record uses for the Dodgers' affiliates (Migration 021's affiliation table). */
export const DODGERS_ORGANIZATION = 'Los Angeles Dodgers'

/** The canonical ladder, low to high. A level off the ladder (OTHER, FOREIGN_PRO, INDEPENDENT) is never ranked. */
export const LEVEL_LADDER = Object.freeze(['INTERNATIONAL_ROOKIE', 'COMPLEX_ROOKIE', 'LOW_A', 'HIGH_A', 'AA', 'AAA', 'MLB'])
const LADDER_RANK = Object.freeze({ ...Object.fromEntries(LEVEL_LADDER.map((l, i) => [l, i + 1])), A: 3 })

/** The highest ladder level in a set of stints and the first season it was recorded; null when none is on the ladder. */
function highestOf(stints) {
  let best = null
  for (const s of stints) {
    const r = LADDER_RANK[s.level]
    if (!r) continue
    if (!best || r > best.rank || (r === best.rank && s.season < best.season)) best = { rank: r, level: s.level === 'A' ? 'LOW_A' : s.level, season: s.season }
  }
  return best ? { level: best.level, season: best.season } : null
}

const seasonsOf = (rows) => [...new Set(rows.map((s) => s.season))].sort((a, b) => a - b)
const day = (v) => (v ? String(v).slice(0, 10) : null)

/**
 * One player's recorded career split by WHO the affiliate belonged to, from each stint's own organization (season-aware, Migration 021's
 * affiliation table and the official records). Control is not inferred from adjacency: an affiliate's organization is a fact about that team and
 * season, and a stint with no organization stays UNKNOWN_ORGANIZATION (never Dodgers). Transactions remain the only source for an exit.
 * @param {{ season: number, level: string, stint_kind?: string, organization_name?: string|null, affiliate_team?: string|null, league_name?: string|null,
 *   level_classification?: string|null, first_game_date?: string|null, last_game_date?: string|null }[]} stints
 */
export function careerSegments(stints) {
  const rows = (stints ?? []).filter(isTeamStint)
  const foreign = rows.filter((s) => s.level === 'FOREIGN_PRO')
  const affiliated = rows.filter((s) => s.level !== 'FOREIGN_PRO')
  const dodgers = affiliated.filter((s) => s.organization_name === DODGERS_ORGANIZATION)
  const other = affiliated.filter((s) => s.organization_name && s.organization_name !== DODGERS_ORGANIZATION)
  const unknownOrg = affiliated.filter((s) => !s.organization_name)
  const whole = highestOf(affiliated)
  const atDodgers = highestOf(dodgers)
  const lastSeason = affiliated.length ? Math.max(...affiliated.map((s) => s.season)) : null
  const last = affiliated.filter((s) => s.season === lastSeason)
  const lastDates = last.map((s) => day(s.last_game_date)).filter(Boolean).sort()
  return {
    affiliated_seasons: seasonsOf(affiliated),
    dodgers_affiliate_seasons: seasonsOf(dodgers),
    other_organization_seasons: seasonsOf(other),
    other_organizations: [...new Set(other.map((s) => s.organization_name))].sort(),
    unknown_organization_seasons: seasonsOf(unknownOrg),
    foreign_pro_seasons: seasonsOf(foreign),
    foreign_pro_leagues: [...new Set(foreign.map((s) => s.league_name).filter(Boolean))].sort(),
    // a stint on record that the ladder cannot place (Pioneer League rookie-advanced, an unrecognized sport): reported, never ranked
    unplaceable_level_seasons: seasonsOf(affiliated.filter((s) => UNCLEAR_LEVEL.has(s.level_classification ?? '') || (!LADDER_RANK[s.level] && s.level !== 'MLB'))),
    highest_level_whole_career: whole,
    highest_level_at_dodgers_affiliate: atDodgers,
    // the whole-career highest level was first recorded with another organization: it is not Dodgers development
    highest_level_reached_elsewhere: Boolean(whole && (!atDodgers || LADDER_RANK[whole.level] > LADDER_RANK[atDodgers.level])),
    last_observed_affiliated: lastSeason === null ? null : {
      season: lastSeason,
      teams: [...new Set(last.map((s) => s.affiliate_team).filter(Boolean))].sort(),
      organizations: [...new Set(last.map((s) => s.organization_name ?? 'UNKNOWN_ORGANIZATION'))].sort(),
      // the last dated appearance in that season, only where a game log supports it; never a release date
      last_game_date: lastDates.at(-1) ?? null,
    },
    mlb_level_stints: rows.filter((s) => s.level === 'MLB').length,
  }
}

/** Exact-date coverage of log-era (2006+) team stints: both first and last appearance dated from a game log. */
export function exactDateCoverage(stints) {
  const logEra = (stints ?? []).filter((s) => isTeamStint(s) && s.season >= 2006)
  const dated = logEra.filter((s) => s.first_game_date && s.last_game_date)
  return { log_era_stints: logEra.length, dated: dated.length, undated: logEra.length - dated.length,
    undated_foreign_pro: logEra.filter((s) => !(s.first_game_date && s.last_game_date) && s.level === 'FOREIGN_PRO').length }
}

/** The 051 cohort: every Dodgers tracked signing whose canonical outcome audit is VERIFIED_NO_MLB. Derived, never listed by hand. */
export function auditedNoMlbCohort(signings) {
  return (signings ?? []).filter((s) => s.outcome_audit_status === 'VERIFIED_NO_MLB')
}

const tally = (rows, key) => {
  const out = {}
  for (const r of rows) { const k = key(r); out[k] = (out[k] ?? 0) + 1 }
  return out
}
const ladderTally = (rows, key) => {
  const t = tally(rows.filter((r) => key(r)), key)
  return Object.fromEntries(LEVEL_LADDER.filter((l) => t[l]).map((l) => [l, t[l]]))
}

/**
 * The audited no-MLB cohort's documented development, one row per player plus counts, each with its denominator. Descriptive only: no rate, no
 * score, no comparison with the verified MLB cohort, no reason for any path.
 * @param {{ signings: any[], developmentSummary?: any[], developmentQueue?: any[], milestones?: any[], progressionDecisions?: any[], exitSummary?: any[] }} data
 * @param {Map<string, any[]> | Record<string, any[]>} stintsByPlayer player_id -> stint rows
 * @param {(data: any) => any[]} recordsOf developmentRecords (injected so this module has no import cycle)
 * @param {(data: any) => any[]} needsOf developmentNeeds (injected)
 */
export function auditedNoMlbCoverage(data, stintsByPlayer, recordsOf, needsOf) {
  const get = (id) => (stintsByPlayer instanceof Map ? stintsByPlayer.get(id) : stintsByPlayer?.[id]) ?? []
  const cohortIds = new Set(auditedNoMlbCohort(data.signings).map((s) => s.player_id))
  const summaries = new Map((data.developmentSummary ?? []).map((r) => [r.player_id, r]))
  const exits = new Map((data.exitSummary ?? []).map((r) => [r.player_id, r]))
  const issues = new Map()
  for (const q of data.developmentQueue ?? []) { if (!issues.has(q.player_id)) issues.set(q.player_id, []); issues.get(q.player_id).push(q.issue) }
  const needs = new Map()
  for (const n of needsOf ? needsOf(data) : []) { if (!needs.has(n.player_id)) needs.set(n.player_id, []); needs.get(n.player_id).push(n.need) }
  const mlbDebutMilestones = new Set((data.milestones ?? []).filter((m) => m.event_code === 'MLB_DEBUT').map((m) => m.player_id))
  const pending = new Set((data.progressionDecisions ?? []).filter((d) => d.review_status === 'PENDING_REVIEW').map((d) => d.player_id))
  const rows = recordsOf(data).filter((r) => cohortIds.has(r.player_id)).map((r) => {
    const stints = get(r.player_id)
    const history = historyCoverage({ signing_year: r.signing_year, mlb_debut_date: null, pathway: r.pathway }, stints)
    const segments = careerSegments(stints)
    const playerIssues = (issues.get(r.player_id) ?? []).slice().sort()
    // every SEASON_GAP detector row of this player names only seasons the league did not play (the detector does not know 2020)
    const seasonGapExplained = playerIssues.includes('SEASON_GAP') && !history.gaps.some((g) => g.code === 'NO_EVIDENCE_FOUND')
    return {
      player_id: r.player_id,
      player_slug: r.player_slug,
      full_name: r.full_name,
      signing_year: r.signing_year,
      pathway: r.pathway,
      first_pro_status: r.first_pro_status,
      dims: r.dims,
      // the view's figure: the whole recorded career, any organization
      highest_level_recorded: summaries.get(r.player_id)?.highest_affiliated_level ?? null,
      history,
      segments,
      exact_dates: exactDateCoverage(stints),
      exit_control_state: exits.get(r.player_id)?.control_state ?? null,
      progression_review_pending: pending.has(r.player_id) || summaries.get(r.player_id)?.progression_review_pending === true,
      issues: playerIssues,
      needs: [...new Set(needs.get(r.player_id) ?? [])].sort(),
      season_gap_explained_by_league: seasonGapExplained,
      // a VERIFIED_NO_MLB audit contradicted by the development record: a stop, never a silent change of outcome
      contradiction: segments.mlb_level_stints > 0 || mlbDebutMilestones.has(r.player_id),
    }
  }).sort((a, b) => a.signing_year - b.signing_year || (a.player_slug < b.player_slug ? -1 : a.player_slug > b.player_slug ? 1 : 0))
  const n = rows.length
  const count = (f) => rows.filter(f).length
  const dated = rows.reduce((acc, r) => ({ log_era_stints: acc.log_era_stints + r.exact_dates.log_era_stints, dated: acc.dated + r.exact_dates.dated }), { log_era_stints: 0, dated: 0 })
  return {
    players: n,
    any_development_history: { n: count((r) => r.segments.affiliated_seasons.length + r.segments.foreign_pro_seasons.length > 0), of: n },
    no_structured_affiliated_record: { n: count((r) => r.segments.affiliated_seasons.length === 0), of: n,
      players: rows.filter((r) => r.segments.affiliated_seasons.length === 0).map((r) => r.player_slug) },
    highest_level_known: { n: count((r) => r.highest_level_recorded), of: n,
      unresolved: rows.filter((r) => !r.highest_level_recorded).map((r) => r.player_slug) },
    // two different questions, never blended: the whole recorded career (the published figure) and the Dodgers-affiliate part of it
    highest_level_whole_career: ladderTally(rows, (r) => r.highest_level_recorded),
    highest_level_at_dodgers_affiliate: ladderTally(rows, (r) => r.segments.highest_level_at_dodgers_affiliate?.level),
    highest_level_reached_elsewhere: { n: count((r) => r.segments.highest_level_reached_elsewhere), of: n,
      players: rows.filter((r) => r.segments.highest_level_reached_elsewhere).map((r) => r.player_slug) },
    later_career_with_other_organizations: { n: count((r) => r.segments.other_organization_seasons.length > 0), of: n },
    foreign_professional_seasons_recorded: { n: count((r) => r.segments.foreign_pro_seasons.length > 0), of: n },
    unplaceable_level_on_record: { n: count((r) => r.segments.unplaceable_level_seasons.length > 0), of: n },
    first_professional_season: tally(rows, (r) => r.first_pro_status),
    usable_chronology: { n: count((r) => r.dims.CHRONOLOGY === 'KNOWN'), of: n },
    path_state: { NO_OPEN_GAP: count((r) => r.history.state === 'NO_OPEN_GAP'), PARTIAL: count((r) => r.history.state === 'PARTIAL'), of: n },
    history_start: Object.fromEntries(Object.entries(tally(rows, (r) => r.history.history_start)).sort(([a], [b]) => (a < b ? -1 : 1))),
    season_gap_only_league_not_played: { n: count((r) => r.season_gap_explained_by_league), of: count((r) => r.issues.includes('SEASON_GAP')) },
    exact_dates: { ...dated, of_players: n },
    progression_review_pending: { n: count((r) => r.progression_review_pending), of: n },
    exit_control_state: Object.fromEntries(Object.entries(tally(rows, (r) => r.exit_control_state ?? 'UNKNOWN')).sort(([a], [b]) => (a < b ? -1 : 1))),
    contradictions: rows.filter((r) => r.contradiction).map((r) => r.player_slug),
    rows,
  }
}
