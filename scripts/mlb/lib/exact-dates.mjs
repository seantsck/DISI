// Exact development dates from game-level evidence (migration 022 research).
//
// The participation rule (documented, mirrored by the migration and tests):
//   * A dated entry in the official MLB Stats API gameLog endpoint with a
//     stat block IS a recorded game appearance. The endpoint enumerates games
//     in which the player actually participated; hitters may appear at the
//     plate (PA/AB) or defensively (`positionsPlayed`), pitchers by a recorded
//     pitching line. Pinch-running appears as an entry without PA when the
//     source represents it.
//   * A roster listing, a transaction, a promotion/option/assignment or a team
//     schedule is NEVER an appearance. Those records never produce entries in
//     the gameLog endpoint, so they cannot produce a date here.
//   * A season split (migration 021 evidence) evidences a season, never a date.
//
// Foreign professional leagues (Mexican League, NPB, KBO, Cuban professional)
// keep the 021 correction: they are FOREIGN_PRO at every point in history and
// never an affiliated AAA level, whatever the source filed them under.
//
// Every function here is deterministic: outputs are sorted, and unknown stays
// null — absence of evidence is never evidence of absence.

import { classifyLevel } from './development.mjs'

/** The participation rule, as a citable constant. */
export const PARTICIPATION_RULE =
  'A dated entry in the official gameLog endpoint with a stat block is a recorded appearance ' +
  '(hitters: plate appearance, at-bat or represented defensive appearance; pitchers: recorded pitching line). ' +
  'Roster lists, transactions, promotions, options, assignments and team schedules are never appearances.'

/** Earliest season the MLB Stats API gameLog reliably covers for minor leaguers. */
export const GAME_LOG_MIN_SEASON = 2006

const numOrNull = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const parseIpOuts = (v) => {
  if (v == null || v === '') return null
  const m = String(v).trim().match(/^(\d+)(?:\.(\d))?$/)
  if (!m) return null
  return Number(m[1]) * 3 + (m[2] ? Number(m[2]) : 0)
}

/**
 * Extracts dated appearance rows from one gameLog response.
 * @param {{ stats?: Array<{ splits?: Array<Record<string, any>> }> }} data
 * @param {'hitting' | 'pitching'} group
 * @returns {{ date: string, gamePk: number|null, teamId: number|null, teamName: string|null,
 *   sportId: number|null, sportAbbr: string|null, leagueName: string|null,
 *   gamesPlayed: number|null, plateAppearances: number|null, atBats: number|null,
 *   ipOuts: number|null, battersFaced: number|null, defensive: boolean }[]}
 */
export function extractGameAppearances(data, group) {
  const splits = data?.stats?.[0]?.splits ?? []
  const out = []
  for (const s of splits) {
    if (!s?.date || !s?.stat) continue
    const st = s.stat ?? {}
    const defensive = Array.isArray(s.positionsPlayed) && s.positionsPlayed.length > 0
    const row = {
      date: s.date,
      gamePk: numOrNull(s.game?.gamePk),
      teamId: numOrNull(s.team?.id),
      teamName: s.team?.name ?? null,
      sportId: numOrNull(s.sport?.id),
      sportAbbr: s.sport?.abbreviation ?? null,
      leagueName: s.league?.name ?? null,
      gamesPlayed: numOrNull(st.gamesPlayed),
      plateAppearances: numOrNull(st.plateAppearances),
      atBats: numOrNull(st.atBats),
      ipOuts: parseIpOuts(st.inningsPitched),
      battersFaced: numOrNull(st.battersFaced),
      defensive,
      group,
    }
    // Participation: a stat block on a dated gameLog entry is the recorded
    // appearance. A zero-PA entry is still an appearance when the source
    // represents one defensively (positionsPlayed) — otherwise it is a
    // roster-style entry and is not counted.
    const participated = row.gamesPlayed != null && row.gamesPlayed >= 1
      ? true
      : defensive || row.plateAppearances != null || row.atBats != null || row.ipOuts != null
    if (!participated) continue
    out.push(row)
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** Maps a game's sport id / league name through the 021 canonical taxonomy. */
export function classifyGameLevel(sportId, leagueName, levelAbbr) {
  const { canonical, classification, rule } = classifyLevel({ sportId, league: leagueName, level: levelAbbr })
  return { level: canonical, classification, rule }
}

/**
 * An appearance row, optionally carrying the source citation of the fetch it
 * came from (added by the distiller when flattening cached game logs).
 * @typedef {ReturnType<typeof extractGameAppearances>[number] & {
 *   sourceUrl?: string|null, retrievedAt?: string|null }} CitedAppearance
 */

/**
 * Attributes each appearance to the reviewed stint it belongs to (by season
 * and team id), falling back to the game's own sport classification when the
 * stint cannot be matched. The reviewed stint classification wins.
 * @param {ReturnType<typeof import('./development.mjs').distillStints>} stints
 * @param {CitedAppearance[]} appearances
 * @returns {(CitedAppearance & { level: string|null, attribution: string })[]}
 */
export function attributeAppearances(stints, appearances) {
  const byTeamSeason = new Map()
  for (const s of stints) {
    if (s.teamId == null) continue
    byTeamSeason.set(`${s.season}|${s.teamId}`, s)
  }
  return appearances.map((a) => {
    const stint = byTeamSeason.get(`${Number(a.date.slice(0, 4))}|${a.teamId}`)
    if (stint) return { ...a, level: stint.level, attribution: 'REVIEWED_STINT' }
    const game = classifyGameLevel(a.sportId, a.leagueName, a.sportAbbr)
    return { ...a, level: game.level, attribution: 'GAME_SPORT_CLASSIFICATION' }
  })
}

/**
 * First/last verified appearance dates per stint. A stint is keyed by
 * (season, teamId); multi-team, multi-level and multi-organization seasons
 * stay separate by construction.
 * @returns {{ season: number, teamId: number|null, first: string|null, last: string|null,
 *   basis: 'GAME_LOG'|null, games: number }[]}
 */
export function exactDatesForStints(stints, attributedAppearances) {
  const byKey = new Map()
  for (const s of stints) {
    byKey.set(`${s.season}|${s.teamId}`, { season: s.season, teamId: s.teamId ?? null, dates: [] })
  }
  for (const a of attributedAppearances) {
    const key = `${Number(a.date.slice(0, 4))}|${a.teamId}`
    const bucket = byKey.get(key)
    if (!bucket) continue // a game whose team has no reviewed stint is not a stint date
    bucket.dates.push(a.date)
  }
  return [...byKey.values()]
    .map((b) => ({
      season: b.season,
      teamId: b.teamId,
      first: b.dates.length ? b.dates.slice().sort()[0] : null,
      last: b.dates.length ? b.dates.slice().sort().at(-1) : null,
      basis: /** @type {'GAME_LOG'|null} */ (b.dates.length ? 'GAME_LOG' : null),
      games: b.dates.length,
    }))
    .sort((a, b) => a.season - b.season || (a.teamId ?? 0) - (b.teamId ?? 0))
}

/**
 * Earliest verified appearance date per canonical level (career-wide).
 * @returns {{ level: string, date: string, season: number }[]}
 */
export function levelFirstAppearances(attributedAppearances) {
  const byLevel = new Map()
  for (const a of attributedAppearances) {
    if (!a.level) continue
    const prev = byLevel.get(a.level)
    if (!prev || a.date < prev.date) byLevel.set(a.level, { level: a.level, date: a.date, season: Number(a.date.slice(0, 4)) })
  }
  return [...byLevel.values()].sort((a, b) => a.level.localeCompare(b.level))
}

/** The debut event code a canonical level evidences (021 vocabulary, unchanged). */
export const DEBUT_EVENT_BY_LEVEL = {
  INTERNATIONAL_ROOKIE: 'DSL_DEBUT',
  COMPLEX_ROOKIE: 'COMPLEX_DEBUT',
  LOW_A: 'A_DEBUT',
  HIGH_A: 'HIGH_A_DEBUT',
  AA: 'AA_DEBUT',
  AAA: 'AAA_DEBUT',
  MLB: 'MLB_DEBUT',
}

/**
 * Builds the exact-date candidates for one player from reviewed stints,
 * reviewed milestone candidates and game-level appearances.
 *
 * Upgrade rule (SEASON → DAY): an existing SEASON-precision debut milestone is
 * upgraded only when the earliest game-verified appearance at that milestone's
 * level falls in the milestone's own season_year — i.e. the game logs actually
 * cover the season the reviewed evidence named as the first one. When logs
 * only start later, the milestone keeps SEASON precision (the game log cannot
 * prove what came before it). A milestone that is already DAY is never
 * overwritten; a disagreeing game-log date becomes a conflict instead.
 *
 * PROFESSIONAL_DEBUT (no rows exist in 021): emitted only with exact game-log
 * evidence, and only when the earliest appearance falls in the player's first
 * stint season — the first professional game otherwise predates log coverage
 * and stays unknown rather than approximated.
 *
 * @param {{
 *   stints: ReturnType<typeof import('./development.mjs').distillStints>,
 *   milestones: { milestone: string, eventDate: string|null, datePrecision: string|null, season: number|null, evidence?: string|null }[],
 *   appearances: CitedAppearance[],
 *   dodgersTeamId?: number,
 * }} input
 */
export function buildExactDateCandidates({ stints, milestones, appearances, dodgersTeamId = 119 }) {
  const attributed = attributeAppearances(stints, appearances)
  const levelFirsts = levelFirstAppearances(attributed)
  const levelByCode = new Map(Object.entries(DEBUT_EVENT_BY_LEVEL).map(([level, code]) => [code, level]))

  const upgrades = []
  const conflicts = []
  const newMilestones = []

  for (const m of milestones) {
    if (!levelByCode.has(m.milestone)) continue
    const level = levelByCode.get(m.milestone)
    const first = levelFirsts.find((f) => f.level === level)
    const prior = {
      priorEvidenceBasis: m.evidence ?? 'SEASON_SPLITS',
      priorDatePrecision: m.datePrecision ?? 'SEASON',
    }
    if (m.datePrecision === 'DAY') {
      // Never overwrite an existing exact date. A disagreeing game-log date
      // becomes a recorded conflict instead.
      if (first && first.date !== m.eventDate) {
        conflicts.push({
          eventCode: m.milestone,
          kind: 'EXACT_DATE_CONFLICT',
          seasonYear: m.season ?? Number(m.eventDate?.slice(0, 4)) ?? null,
          valueA: m.eventDate,
          valueB: first.date,
          note: `Existing ${m.evidence ?? 'exact'} date ${m.eventDate} differs from the game-log first appearance ${first.date}; kept the existing value and recorded the conflict.`,
        })
      }
      continue
    }
    if (!first) {
      conflicts.push({
        eventCode: m.milestone,
        kind: 'NO_GAME_LOG_COVERAGE',
        seasonYear: m.season ?? null,
        valueA: null,
        valueB: null,
        note: `No game-log evidence at ${level}; the milestone stays season-precision.`,
      })
      continue
    }
    if (m.season != null && first.season !== m.season) {
      // The logs begin after the reviewed first season: the true first
      // appearance predates log coverage, so the date is not provable.
      conflicts.push({
        eventCode: m.milestone,
        kind: 'GAME_LOG_STARTS_LATER',
        seasonYear: m.season,
        valueA: String(m.season),
        valueB: first.date,
        note: `Reviewed first season ${m.season}; earliest game-log appearance at ${level} is ${first.date}. The earlier gap is not evidence of absence, so the milestone stays season-precision.`,
      })
      continue
    }
    upgrades.push({
      eventCode: m.milestone,
      seasonYear: m.season,
      milestoneDate: first.date,
      ...prior,
      level,
      note: `Exact first appearance at ${level} on ${first.date} from the official gameLog endpoint.`,
    })
  }

  // PROFESSIONAL_DEBUT: earliest verified appearance overall, only when it
  // falls in the player's first stint season (otherwise the first professional
  // game predates log coverage and stays unknown).
  const firstStint = [...stints].sort((a, b) => a.season - b.season || (a.levelRank ?? 99) - (b.levelRank ?? 99))[0]
  const earliest = attributed.slice().sort((a, b) => (a.date < b.date ? -1 : 1))[0]
  if (firstStint && earliest && Number(earliest.date.slice(0, 4)) === firstStint.season) {
    newMilestones.push({
      eventCode: 'PROFESSIONAL_DEBUT',
      eventDate: earliest.date,
      seasonYear: firstStint.season,
      level: earliest.level,
      organization: firstStint.organization ?? null,
      note: `First verified professional appearance on ${earliest.date} from the official gameLog endpoint (stint basis: ${earliest.attribution}).`,
    })
  }

  // Stint dates: exact first/last appearance per stint.
  const stintDates = exactDatesForStints(stints, attributed)

  // Coverage numbers for the report (informational, never asserted).
  const datedSeasons = new Set(attributed.map((a) => Number(a.date.slice(0, 4))))
  const coverage = {
    appearanceCount: attributed.length,
    datedSeasons: [...datedSeasons].sort(),
    levelsWithExactFirst: levelFirsts.map((f) => f.level),
    stintsWithDates: stintDates.filter((s) => s.first).length,
    stintsTotal: stints.length,
  }

  return { upgrades, newMilestones, conflicts, stintDates, coverage, attributed }
}
