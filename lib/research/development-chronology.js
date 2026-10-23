// Development chronology: why a season, an organization or a date is missing, and what would close it (052). Pure functions over read-only rows.
//
// HISTORICAL LEAGUE LABEL != MODERN LEVEL. AFFILIATE NAME != ORGANIZATION WITHOUT SEASON CONTEXT. LEAGUE SEASON NOT PLAYED != MISSING PLAYER
// SEASON. SEASON GAP != DID NOT PLAY. MULTI-ORG SEASON != DATA ERROR. TEAM CHANGE != CANONICAL TRANSACTION. TRANSACTION DATE != FIRST APPEARANCE
// DATE. SOURCE-LIMITED != RESEARCH FAILURE. Nothing here fills a season, an organization, a date or a transaction: it reads what is on record and
// names, for each open research need, the cause and the evidence that would close it. The rules mirror the 052 research-queue view exactly; the
// DB tests compare the two.

/**
 * League seasons that were not played, from the official MLB Stats API schedule (052 research): the 2020 regular-season schedule holds no game
 * at any affiliated minor-league level (Triple-A through Rookie), while 2019 and 2021 hold thousands and the 2020 major-league season was played.
 */
export const MINOR_LEAGUE_SEASONS_NOT_PLAYED = Object.freeze([2020])

/** The first season the official minor-league game log covers (the 022 rule). Earlier dates are source-limited, never missing facts. */
export const GAME_LOG_FIRST_SEASON = 2006

/** The first season the official season splits carry minor-league records reliably; earlier minor-league careers are source-limited. */
export const MINOR_LEAGUE_SPLITS_FIRST_SEASON = 1960

/** Gap classes (052). Each open research need has exactly one. */
export const GAP_CLASS = Object.freeze({
  FACT_MISSING: 'An approved source holds the fact and DISI does not yet.',
  TAXONOMY_GAP: 'The evidence exists, but the reviewed level taxonomy cannot place it; a future architecture decision is needed.',
  SOURCE_LIMITED: 'No approved readable source holds the fact. Not a research failure, and not evidence that the fact does not exist.',
  HUMAN_REVIEW: 'The facts are on record and more than one interpretation is defensible; a person decides.',
  TRANSACTION_BLOCKED: 'The chronology depends on a transaction DISI has not recorded; a team change is never a transaction.',
  IDENTITY_BLOCKED: 'The player cannot be researched safely until the identity is resolved.',
  NOT_A_GAP: 'The detector read a known structural condition as missing evidence.',
})

const isTeamStint = (s) => (s.stint_kind ?? 'TEAM_STINT') === 'TEAM_STINT'
const day = (v) => (v ? String(v).slice(0, 10) : null)
const isMinorAffiliated = (s) => s.affiliated === true && s.level !== 'MLB'
const cmpText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Is a season the player has no record for explained by the league not playing it? Only for an affiliated minor leaguer: the player's last
 * recorded season before it is affiliated minor-league play only, and he has no major-league stint up to that season (the 2020 MLB season was
 * played, so a player with a major-league career is not covered). A missing season is otherwise unknown, never "did not play".
 * @param {any[]} teamStints the player's team stints
 */
export function seasonNotPlayedExplains(teamStints, season) {
  if (!MINOR_LEAGUE_SEASONS_NOT_PLAYED.includes(season)) return false
  if (teamStints.some((s) => s.level === 'MLB' && s.season <= season)) return false
  const before = teamStints.filter((s) => s.season < season)
  if (!before.length) return false
  const last = Math.max(...before.map((s) => s.season))
  return before.filter((s) => s.season === last).every(isMinorAffiliated)
}

/**
 * The seasons between a player's first and last recorded seasons with no record, each with its cause. `open` mirrors the 052 SEASON_GAP
 * detector: it fires only for a missing season the league-not-played rule does not explain.
 */
export function seasonGaps(stints) {
  const team = (stints ?? []).filter(isTeamStint)
  const have = new Set(team.map((s) => s.season))
  if (have.size < 2) return { missing: [], open: [], explained: [] }
  const lo = Math.min(...have)
  const hi = Math.max(...have)
  const missing = []
  for (let y = lo + 1; y < hi; y += 1) {
    if (have.has(y)) continue
    const prior = Math.max(...team.filter((s) => s.season < y).map((s) => s.season))
    const next = Math.min(...team.filter((s) => s.season > y).map((s) => s.season))
    const adjacentForeign = team.some((s) => (s.season === prior || s.season === next) && s.level === 'FOREIGN_PRO')
    let cause
    if (seasonNotPlayedExplains(team, y)) cause = 'LEAGUE_SEASON_NOT_PLAYED'
    else if (y < MINOR_LEAGUE_SPLITS_FIRST_SEASON) cause = 'BEFORE_STRUCTURED_MINOR_LEAGUE_RECORDS'
    else if (adjacentForeign) cause = 'ADJACENT_TO_FOREIGN_PROFESSIONAL_PLAY'
    else cause = 'NO_RECORD_IN_OFFICIAL_SOURCE'
    missing.push({ season: y, cause })
  }
  return {
    missing,
    open: missing.filter((m) => m.cause !== 'LEAGUE_SEASON_NOT_PLAYED').map((m) => m.season),
    explained: missing.filter((m) => m.cause === 'LEAGUE_SEASON_NOT_PLAYED').map((m) => m.season),
  }
}

/**
 * Seasons in which the player's team stints carry two or more organizations, each checked against the canonical transactions. A season is
 * BRACKETED only when exactly two organizations appear, one canonical transaction of this player moves him from the first to the second inside
 * that season, every stint of the season is game-dated, and the last appearance for the first organization is on or before the transaction date
 * while the first appearance for the second is on or after it. The transaction date, the last game before it and the first game after it stay
 * three separate facts; a team change never creates a transaction.
 * @param {any[]} stints the player's stints
 * @param {{ transaction_date: string, from_organization?: string|null, to_organization?: string|null, event_key?: string, transaction_type?: string }[]} transactions the player's canonical transactions
 */
export function multiOrganizationSeasons(stints, transactions) {
  // a stint's organization is matched to a transaction by the organization's abbreviation (what the transaction view carries), else its name
  const orgKey = (s) => s.organization_abbreviation ?? s.organization_name
  const team = (stints ?? []).filter(isTeamStint).filter((s) => s.organization_name)
  const bySeason = new Map()
  for (const s of team) bySeason.set(s.season, [...(bySeason.get(s.season) ?? []), s])
  const out = []
  for (const [season, rows] of [...bySeason].sort((a, b) => a[0] - b[0])) {
    const keys = [...new Set(rows.map(orgKey))]
    if (keys.length < 2) continue
    const segments = keys.map((k) => {
      const r = rows.filter((s) => orgKey(s) === k)
      const firsts = r.map((s) => day(s.first_game_date))
      const lasts = r.map((s) => day(s.last_game_date))
      const dated = firsts.every(Boolean) && lasts.every(Boolean)
      return {
        organization: r[0].organization_name,
        key: k,
        teams: [...new Set(r.map((s) => s.affiliate_team ?? ''))].sort(),
        levels: [...new Set(r.map((s) => s.level))].sort(),
        first_appearance: dated ? firsts.sort()[0] : null,
        last_appearance: dated ? lasts.sort().at(-1) : null,
        dated,
      }
    }).sort((a, b) => cmpText(a.first_appearance ?? '9999', b.first_appearance ?? '9999') || cmpText(a.organization, b.organization))
    const moves = (transactions ?? []).filter((t) => String(t.transaction_date ?? '').startsWith(String(season)) && t.from_organization && t.to_organization
      && t.from_organization !== t.to_organization && keys.includes(t.from_organization) && keys.includes(t.to_organization))
    let state
    let transaction = null
    if (keys.length > 2) state = 'MORE_THAN_TWO_ORGANIZATIONS'
    else if (!moves.length) state = 'NO_CANONICAL_TRANSACTION'
    else {
      const read = (t) => {
        const from = segments.find((g) => g.key === t.from_organization)
        const to = segments.find((g) => g.key === t.to_organization)
        const date = day(t.transaction_date)
        const bracketed = from.dated && to.dated && from.last_appearance <= date && to.first_appearance >= date
        return { t, from, to, date, bracketed }
      }
      const reads = moves.map(read)
      const hit = reads.find((r) => r.bracketed) ?? reads[0]
      transaction = { event_key: hit.t.event_key ?? null, date: hit.date, type: hit.t.transaction_type ?? null, from: hit.from.organization, to: hit.to.organization }
      if (hit.bracketed) state = 'BRACKETED'
      else if (!hit.from.dated || !hit.to.dated) state = season < GAME_LOG_FIRST_SEASON ? 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS' : 'TRANSACTION_RECORDED_DATES_MISSING'
      else state = 'DATES_DO_NOT_BRACKET_TRANSACTION'
    }
    out.push({ season, organizations: segments.map((g) => g.organization), segments: segments.map(({ key, ...g }) => g), transaction, state })
  }
  return out
}

/** The class of an open multi-organization season (BRACKETED seasons are not open). */
export function multiOrganizationClass(state) {
  switch (state) {
    case 'BRACKETED': return 'NOT_A_GAP'
    case 'NO_CANONICAL_TRANSACTION': return 'TRANSACTION_BLOCKED'
    case 'MORE_THAN_TWO_ORGANIZATIONS': return 'TRANSACTION_BLOCKED'
    case 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS': return 'SOURCE_LIMITED'
    case 'TRANSACTION_RECORDED_DATES_MISSING': return 'FACT_MISSING'
    default: return 'HUMAN_REVIEW'
  }
}

/** Undated log-era team stints and why each stays undated. */
export function undatedStints(stints) {
  return (stints ?? []).filter(isTeamStint).filter((s) => s.season >= GAME_LOG_FIRST_SEASON && (!s.first_game_date || !s.last_game_date)).map((s) => ({
    season: s.season, team: s.affiliate_team ?? null, level: s.level,
    cause: s.level === 'FOREIGN_PRO' ? 'FOREIGN_PROFESSIONAL_LEAGUE_OUTSIDE_GAME_LOG' : 'GAME_LOG_RETURNS_NO_GAMES',
  }))
}

/**
 * The cause of each open development need: one class, the reason and what evidence would close it. `needs` are developmentNeeds() rows;
 * `stintsOf` and `transactionsOf` return a player's rows.
 * @param {any[]} needs
 * @param {(playerId: string) => any[]} stintsOf
 * @param {(playerId: string) => any[]} transactionsOf
 * @param {(playerId: string) => any[]} [milestonesOf]
 */
export function needCauses(needs, stintsOf, transactionsOf, milestonesOf = () => []) {
  return needs.map((n) => {
    const stints = stintsOf(n.player_id) ?? []
    const team = stints.filter(isTeamStint)
    const c = classify(n, team, transactionsOf(n.player_id) ?? [], milestonesOf(n.player_id) ?? [])
    return { ...n, gap_class: c.gap_class, cause: c.cause, closes_with: c.closes_with }
  })
}

function classify(n, team, transactions, milestones) {
  switch (n.need) {
    case 'SOURCE_CONFLICT':
      return { gap_class: 'HUMAN_REVIEW', cause: 'Two sources disagree on a date; the stored value was kept.', closes_with: 'A reviewed decision between the two dated records.' }
    case 'SEQUENCE_REVIEW':
      return { gap_class: 'HUMAN_REVIEW', cause: 'An ambiguous level sequence (an early cameo, a later lower-level appearance or a skipped level).', closes_with: 'A reviewed progression decision; DISI never chooses one.' }
    case 'LEVEL_CLASSIFICATION': {
      const unclear = team.filter((s) => ['UNKNOWN_ROOKIE_LEAGUE', 'UNRECOGNIZED_SPORT'].includes(s.level_classification ?? ''))
      const leagues = [...new Set(unclear.map((s) => s.league_name ?? 'unknown'))].sort()
      return { gap_class: 'TAXONOMY_GAP', cause: `Rookie-sport seasons in ${leagues.join(', ')} that the reviewed ladder has no level for (neither an international nor a complex league).`,
        closes_with: 'A reviewed taxonomy decision; the official record files these seasons under the Rookie sport, so no existing level fits without an assumption.' }
    }
    case 'ORGANIZATION': {
      const issues = new Set(n.issues ?? [])
      if (issues.has('UNRESOLVED_ORGANIZATION')) {
        return { gap_class: 'SOURCE_LIMITED', cause: 'The official team-season record names no MLB parent organization for the team (a co-operative or independent club).',
          closes_with: 'A record of which organization held the player\'s contract that season.' }
      }
      const open = multiOrganizationSeasons(team, transactions).filter((m) => m.state !== 'BRACKETED')
      /** @type {string[]} */
      const classes = [...new Set(open.map((m) => multiOrganizationClass(m.state)))]
      const rank = ['FACT_MISSING', 'HUMAN_REVIEW', 'TRANSACTION_BLOCKED', 'SOURCE_LIMITED']
      const gapClass = rank.find((r) => classes.includes(r)) ?? 'TRANSACTION_BLOCKED'
      return { gap_class: gapClass, cause: `Multi-organization seasons not bracketed by a canonical transaction: ${open.map((m) => `${m.season} (${m.state})`).join(', ')}.`,
        closes_with: 'A canonical transaction moving the player between the two organizations, with game dates on both sides of it.' }
    }
    case 'SEASON_COVERAGE': {
      const issues = new Set(n.issues ?? [])
      if (issues.has('IDENTITY_BUT_NO_PROFESSIONAL_SEASONS')) {
        return { gap_class: 'SOURCE_LIMITED', cause: 'The official person record exists and the season splits return no structured season.',
          closes_with: 'A structured season record from an approved source; no season is invented.' }
      }
      if (issues.has('MLB_PLAYER_MISSING_PRE_MLB_HISTORY')) {
        return { gap_class: 'SOURCE_LIMITED', cause: 'The pre-MLB career predates the structured minor-league records the official source carries.',
          closes_with: 'An approved historical minor-league record.' }
      }
      const g = seasonGaps(team)
      if (!g.open.length) return { gap_class: 'NOT_A_GAP', cause: `Every missing season is a league season that was not played (${g.explained.join(', ')}).`, closes_with: 'Nothing: the league did not play.' }
      return { gap_class: 'SOURCE_LIMITED', cause: `Seasons with no record in the official source: ${g.missing.filter((m) => g.open.includes(m.season)).map((m) => `${m.season} (${m.cause})`).join(', ')}.`,
        closes_with: 'A structured record of where the player was those seasons. A missing season is unknown, never "did not play".' }
    }
    case 'GAME_DATES': {
      const undated = undatedStints(team)
      const seasonOnly = milestones.filter((m) => m.date_precision === 'SEASON' && ['DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT'].includes(m.event_code))
      const logEra = undated.filter((u) => u.cause === 'GAME_LOG_RETURNS_NO_GAMES')
      if (logEra.length) {
        return { gap_class: 'SOURCE_LIMITED', cause: `The official game log returns no games for ${logEra.length} log-era stint(s).`, closes_with: 'A dated appearance record for those stints.' }
      }
      if (undated.length) {
        return { gap_class: 'SOURCE_LIMITED', cause: 'Foreign professional seasons: the official minor-league game log does not carry them.', closes_with: 'A dated record from the foreign league itself.' }
      }
      const preLog = seasonOnly.filter((m) => Number(m.season_year) < GAME_LOG_FIRST_SEASON)
      return { gap_class: 'SOURCE_LIMITED', cause: preLog.length || !seasonOnly.length
        ? `Level debuts before ${GAME_LOG_FIRST_SEASON}, which the official game log does not cover; they stay season-precision.`
        : 'Level debuts whose first season the game log does not cover; they stay season-precision.', closes_with: 'A dated game record for the debut season.' }
    }
    default:
      return { gap_class: 'HUMAN_REVIEW', cause: `Unregistered need ${n.need}.`, closes_with: 'Review.' }
  }
}

/** Counts per gap class (every class listed, zero included), so a report never omits one. */
export function gapClassCounts(rows) {
  const out = Object.fromEntries(Object.keys(GAP_CLASS).map((k) => [k, 0]))
  for (const r of rows) out[r.gap_class] = (out[r.gap_class] ?? 0) + 1
  return out
}
