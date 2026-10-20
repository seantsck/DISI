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
