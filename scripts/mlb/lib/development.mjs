// Development-history research: canonical level taxonomy, organization
// resolution, season-splits distillation into player/team/level/season stints,
// and first-appearance milestone candidates.
//
// Rules encoded here (mirrored by database/sql/021 and its checks):
//   * The Mexican League, NPB, KBO, Cuban professional and similar foreign
//     leagues are NEVER classified as affiliated minor-league levels, even when
//     the MLB Stats API filed them under a Triple-A sport id before 2021.
//     Migration 019 already excludes them from affiliated progression; this
//     keeps that correction in the research layer.
//   * A season split is only evidence that the player APPEARED for that team in
//     that season. It is not a date. First/last game dates come only from
//     game-level endpoints and stay null otherwise.
//   * Missing data is unknown, never proof of absence.

import { foldText } from '../../../lib/text.js'

// ---------------------------------------------------------------------------
// Canonical level taxonomy
// ---------------------------------------------------------------------------

/**
 * Canonical development levels. `rank` orders progression upward within
 * affiliated baseball; MLB sits above every minor level.
 */
export const LEVEL_TAXONOMY = {
  INTERNATIONAL_ROOKIE: { rank: 1, label: 'International rookie (DSL-type)', affiliated: true },
  COMPLEX_ROOKIE: { rank: 2, label: 'Complex rookie (ACL/FCL-type)', affiliated: true },
  LOW_A: { rank: 3, label: 'Low-A / Single-A', affiliated: true },
  A: { rank: 3, label: 'Low-A / Single-A (legacy label)', affiliated: true },
  HIGH_A: { rank: 4, label: 'High-A', affiliated: true },
  AA: { rank: 5, label: 'Double-A', affiliated: true },
  AAA: { rank: 6, label: 'Triple-A', affiliated: true },
  MLB: { rank: 7, label: 'Major League Baseball', affiliated: true },
  INDEPENDENT: { rank: null, label: 'Independent professional', affiliated: false },
  FOREIGN_PRO: { rank: null, label: 'Established foreign professional league', affiliated: false },
  OTHER: { rank: null, label: 'Other / unclassified professional', affiliated: false },
}

/** Canonical levels the migration check constraint accepts. */
export const CANONICAL_LEVELS = Object.keys(LEVEL_TAXONOMY)

/**
 * Leagues that are established foreign professional competitions. They stay
 * FOREIGN_PRO at every point in history, regardless of how the MLB Stats API
 * represents them (the API filed the Mexican League under the Triple-A sport id
 * until 2020, which must NOT make it affiliated AAA).
 */
export const FOREIGN_PRO_LEAGUES = new Set([
  'Mexican League', 'LMB', 'Liga Mexicana de Beisbol',
  'NPB', 'Nippon Professional Baseball', 'Central League', 'Pacific League',
  'KBO', 'KBO League', 'Korean Baseball Organization',
  'Cuban National Series', 'Serie Nacional', 'Cuban League',
  'Chinese Professional Baseball League', 'CPBL',
  'Italian Baseball League', 'Australian Baseball League',
])

/** Reason a level was classified, recorded per stint for review. */
function classification(leagueName, eraSeason) {
  const league = (leagueName ?? '').trim()
  if (FOREIGN_PRO_LEAGUES.has(league)) {
    return {
      canonical: 'FOREIGN_PRO',
      classification: 'FOREIGN_PRO_LEAGUE',
      rule: `${league} is an established foreign professional league; never an affiliated minor level.`,
    }
  }
  // Sport-id first: the MLB Stats API's own level grouping (1 MLB, 11 AAA,
  // 12 AA, 13 High-A, 14 Low-A, 15 short-season A, 16 rookie, 21 aggregate).
  switch (eraSeason.sportId) {
    case 1: return { canonical: 'MLB', classification: 'MLB_SPORT_ID', rule: 'MLB sport id 1.' }
    case 11: return { canonical: 'AAA', classification: 'SPORT_ID_11', rule: 'Triple-A sport id.' }
    case 12: return { canonical: 'AA', classification: 'SPORT_ID_12', rule: 'Double-A sport id.' }
    case 13: return { canonical: 'HIGH_A', classification: 'SPORT_ID_13', rule: 'High-A sport id.' }
    case 14: return { canonical: 'LOW_A', classification: 'SPORT_ID_14', rule: 'Low-A / Single-A sport id.' }
    // Short-season A (id 15): the Northwest/Owlz-type leagues before 2021.
    case 15: return { canonical: 'LOW_A', classification: 'SPORT_ID_15_SHORT_SEASON', rule: 'Short-season A sport id; classified Low-A with the original label preserved.' }
    case 16: return classifyRookieLeague(leagueName)
    default: break
  }
  return { canonical: 'OTHER', classification: 'UNRECOGNIZED_SPORT', rule: 'Sport id not in the MLB Stats API level map.' }
}

/** Rookie-classification leagues by name (id 16 covers DSL + complex + Pioneer). */
function classifyRookieLeague(leagueName) {
  const league = (leagueName ?? '').trim()
  if (/Dominican Summer/i.test(league)) return { canonical: 'INTERNATIONAL_ROOKIE', classification: 'DSL_LEAGUE_NAME', rule: 'Dominican Summer League.' }
  if (/Arizona (Complex|Summer|League)/i.test(league) || /^AZL\b/i.test(league)) return { canonical: 'COMPLEX_ROOKIE', classification: 'AZ_LEAGUE_NAME', rule: 'Arizona rookie complex league.' }
  if (/Florida Complex/i.test(league) || /^FCL\b/i.test(league) || /Gulf Coast/i.test(league) || /^GCL\b/i.test(league)) return { canonical: 'COMPLEX_ROOKIE', classification: 'FL_LEAGUE_NAME', rule: 'Florida / Gulf Coast rookie complex league.' }
  return { canonical: 'OTHER', classification: 'UNKNOWN_ROOKIE_LEAGUE', rule: `Rookie-class sport id with unclassified league "${league || 'unknown'}".` }
}

/** Public entry: one split record → its canonical classification. */
export function classifyLevel(split) {
  return classification(split.league, split)
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/**
 * Resolves the MLB organization (franchise) that controls a team. Affiliation
 * is looked up by season so a trade-era stint carries the right owner.
 * @param {string | null} teamName
 * @param {string | null} leagueName
 * @param {number} season
 * @param {Map<string, string>} affiliations keyed `folded team|league|season` → organization name
 * @returns {{ organization: string | null, basis: string }}
 */
export function resolveOrganization(teamName, leagueName, season, affiliations) {
  if (!teamName) return { organization: null, basis: 'NO_TEAM_NAME' }
  const team = foldText(teamName).replace(/\s+/g, ' ').trim()
  const league = foldText(leagueName ?? '').trim()
  // League-specific rule first, then a team-level rule covering any league.
  const hit = affiliations.get(`${team}|${league}|${season}`) ?? affiliations.get(`${team}||${season}`)
  if (hit) return { organization: hit, basis: 'AFFILIATION_TABLE' }
  // Exact MLB club names are organizations in themselves.
  const club = MLB_CLUB_NAMES.get(team)
  if (club) return { organization: club, basis: 'MLB_CLUB_NAME' }
  const seasons = FOREIGN_PRO_TEAM_SEASONS[teamName]
  if (seasons && season >= seasons[0] && season <= seasons[1]) {
    return { organization: null, basis: 'FOREIGN_PRO_CLUB' }
  }
  return { organization: null, basis: 'UNKNOWN_TEAM' }
}

/** MLB club display names that map directly to their organization. */
export const MLB_CLUB_NAMES = new Map([
  ['los angeles dodgers', 'Los Angeles Dodgers'],
  ['brooklyn dodgers', 'Brooklyn Dodgers'],
  ['houston astros', 'Houston Astros'],
  ['new york mets', 'New York Mets'],
  ['st. louis cardinals', 'St. Louis Cardinals'],
  ['detroit tigers', 'Detroit Tigers'],
  ['pittsburgh pirates', 'Pittsburgh Pirates'],
  ['toronto blue jays', 'Toronto Blue Jays'],
  ['cleveland indians', 'Cleveland Indians'],
  ['cleveland guardians', 'Cleveland Guardians'],
  ['los angeles angels', 'Los Angeles Angels'],
  ['milwaukee brewers', 'Milwaukee Brewers'],
  ['boston red sox', 'Boston Red Sox'],
  ['cincinnati reds', 'Cincinnati Reds'],
  ['baltimore orioles', 'Baltimore Orioles'],
  ['seattle mariners', 'Seattle Mariners'],
  ['tampa bay rays', 'Tampa Bay Rays'],
  ['minnesota twins', 'Minnesota Twins'],
  ['philadelphia phillies', 'Philadelphia Phillies'],
  ['arizona diamondbacks', 'Arizona Diamondbacks'],
  ['texas rangers', 'Texas Rangers'],
  ['atlanta braves', 'Atlanta Braves'],
])

/**
 * Foreign professional clubs. A stint with one keeps organization null: the
 * club is recorded verbatim and the league classification (FOREIGN_PRO) carries
 * the "outside affiliated baseball" fact. No club name here is guessed.
 */
export const FOREIGN_PRO_TEAM_SEASONS = {
  'Diablos Rojos del Mexico': [1990, 2100],
  'Generales de Durango': [2018, 2100],
  'Guerreros de Oaxaca': [1990, 2100],
  'Leones de Yucatan': [1990, 2100],
  'Olmecas de Tabasco': [1990, 2100],
  'Tigres de Quintana Roo': [1990, 2100],
}

/**
 * Builds an affiliation lookup from reviewed rules. Each rule covers one team
 * name across listed leagues in listed seasons (inclusive). Rules are the
 * reviewed artifact: an unmapped team resolves to null and is queued instead
 * of being guessed.
 * @param {{ teamName: string, leagues?: string[], seasons: [number, number], organization: string }[]} rules
 */
export function buildAffiliations(rules) {
  const map = new Map()
  for (const rule of rules) {
    const team = foldText(rule.teamName).replace(/\s+/g, ' ').trim()
    const leagues = rule.leagues ?? []
    for (let season = rule.seasons[0]; season <= rule.seasons[1]; season += 1) {
      const keys = leagues.length
        ? leagues.map((l) => `${team}|${foldText(l).trim()}|${season}`)
        : [`${team}||${season}`]
      for (const key of keys) map.set(key, rule.organization)
    }
  }
  return map
}

/** How each known minor-league team maps to its parent organization.
 *  @returns {{ teamName: string, leagues?: string[], seasons: [number, number], organization: string }[]} */
export function dodgersAffiliationRules() {
  return [
    { teamName: 'DSL LAD Mega', seasons: [2021, 2100], organization: 'Los Angeles Dodgers' },
    { teamName: 'DSL LAD Bautista', seasons: [2019, 2100], organization: 'Los Angeles Dodgers' },
    { teamName: 'DSL Dodgers Shoemaker', seasons: [2018, 2100], organization: 'Los Angeles Dodgers' },
    { teamName: 'DSL Dodgers Robinson', seasons: [2018, 2100], organization: 'Los Angeles Dodgers' },
    { teamName: 'DSL Dodgers 1', seasons: [2014, 2017], organization: 'Los Angeles Dodgers' },
    { teamName: 'DSL Dodgers 2', seasons: [2014, 2017], organization: 'Los Angeles Dodgers' },
    { teamName: 'DSL Dodgers', seasons: [1990, 2015], organization: 'Los Angeles Dodgers' },
    { teamName: 'ACL Dodgers', seasons: [2021, 2100], organization: 'Los Angeles Dodgers' },
    { teamName: 'AZL Dodgers', seasons: [1990, 2018], organization: 'Los Angeles Dodgers' },
    { teamName: 'AZL Dodgers Lasorda', seasons: [2019, 2019], organization: 'Los Angeles Dodgers' },
    { teamName: 'AZL Dodgers Mota', seasons: [2019, 2019], organization: 'Los Angeles Dodgers' },
    { teamName: 'ACL Reds', seasons: [2025, 2026], organization: 'Cincinnati Reds' },
    { teamName: 'ACL White Sox', seasons: [2024, 2026], organization: 'Chicago White Sox' },
    { teamName: 'FCL Blue Jays', seasons: [2021, 2100], organization: 'Toronto Blue Jays' },
    { teamName: 'FCL Braves', seasons: [2021, 2100], organization: 'Atlanta Braves' },
    { teamName: 'FCL Twins', seasons: [2021, 2100], organization: 'Minnesota Twins' },
    { teamName: 'DSL Braves', seasons: [2021, 2100], organization: 'Atlanta Braves' },
    { teamName: 'DSL Orioles Black', seasons: [2024, 2100], organization: 'Baltimore Orioles' },
    { teamName: 'DSL Tigers 1', seasons: [2024, 2100], organization: 'Detroit Tigers' },
    { teamName: 'DSL Tigers 2', seasons: [2024, 2100], organization: 'Detroit Tigers' },
    { teamName: 'DSL Arizona Black', seasons: [2024, 2100], organization: 'Arizona Diamondbacks' },
    { teamName: 'Ogden Raptors', seasons: [1990, 2019], organization: 'Los Angeles Dodgers' },
    { teamName: 'Great Falls Dodgers', seasons: [1990, 2002], organization: 'Los Angeles Dodgers' },
    { teamName: 'Great Lakes Loons', seasons: [2007, 2100], organization: 'Los Angeles Dodgers' },
    { teamName: 'Rancho Cucamonga Quakes', seasons: [2011, 2100], organization: 'Los Angeles Dodgers' },
    { teamName: 'Ontario Tower Buzzers', seasons: [2026, 2026], organization: 'Los Angeles Dodgers' },
    { teamName: 'Tulsa Drillers', seasons: [2015, 2100], organization: 'Los Angeles Dodgers' },
    { teamName: 'Oklahoma City Dodgers', seasons: [2015, 2021], organization: 'Los Angeles Dodgers' },
    { teamName: 'Oklahoma City Dodgers', seasons: [2022, 2022], organization: 'Los Angeles Dodgers' },
    { teamName: 'GCL Dodgers', seasons: [2001, 2020], organization: 'Los Angeles Dodgers' },
    { teamName: 'Billings Mustangs', seasons: [1974, 2020], organization: 'Cincinnati Reds' },
    { teamName: 'Oklahoma City Baseball Club', seasons: [2024, 2024], organization: 'Los Angeles Dodgers' },
    { teamName: 'Oklahoma City Comets', seasons: [2025, 2100], organization: 'Los Angeles Dodgers' },
    { teamName: 'Chattanooga Lookouts', seasons: [2010, 2019], organization: 'Los Angeles Dodgers' },
    { teamName: 'Vero Beach Dodgers', seasons: [1990, 2000], organization: 'Los Angeles Dodgers' },
    { teamName: 'Albuquerque Dukes', seasons: [1990, 2000], organization: 'Los Angeles Dodgers' },
    { teamName: 'Albuquerque Isotopes', seasons: [2009, 2014], organization: 'Los Angeles Dodgers' },
    { teamName: 'Lakeland Flying Tigers', seasons: [2017, 2100], organization: 'Detroit Tigers' },
    { teamName: 'AZL Reds', seasons: [2019, 2020], organization: 'Cincinnati Reds' },
    { teamName: 'AZL White Sox', seasons: [2019, 2020], organization: 'Chicago White Sox' },
    { teamName: 'Greensboro Grasshoppers', seasons: [2019, 2024], organization: 'Pittsburgh Pirates' },
    { teamName: 'Bradenton Marauders', seasons: [2019, 2024], organization: 'Pittsburgh Pirates' },
    { teamName: 'Altoona Curve', seasons: [2019, 2026], organization: 'Pittsburgh Pirates' },
    { teamName: 'Indianapolis Indians', seasons: [2019, 2026], organization: 'Pittsburgh Pirates' },
    { teamName: 'GCL Pirates', seasons: [2018, 2020], organization: 'Pittsburgh Pirates' },
    { teamName: 'FCL Pirates', seasons: [2021, 2024], organization: 'Pittsburgh Pirates' },
    { teamName: 'Pirates Black', seasons: [2021, 2026], organization: 'Pittsburgh Pirates' },
    { teamName: 'DSL Pirates', seasons: [2019, 2026], organization: 'Pittsburgh Pirates' },
    { teamName: 'Hudson Valley Renegades', seasons: [2021, 2100], organization: 'New York Yankees' },
    { teamName: 'Somerset Patriots', seasons: [2021, 2100], organization: 'New York Yankees' },
    { teamName: 'Scranton/Wilkes-Barre RailRiders', seasons: [2018, 2100], organization: 'New York Yankees' },
    { teamName: 'Gwinnett Stripers', seasons: [2017, 2100], organization: 'Atlanta Braves' },
    { teamName: 'Mississippi Braves', seasons: [2010, 2024], organization: 'Atlanta Braves' },
    { teamName: 'Columbus Clippers', seasons: [2010, 2100], organization: 'Cleveland Indians/Guardians' },
    { teamName: 'Erie SeaWolves', seasons: [2010, 2100], organization: 'Detroit Tigers' },
    { teamName: 'New Hampshire Fisher Cats', seasons: [2010, 2100], organization: 'Toronto Blue Jays' },
    { teamName: 'Wilmington Blue Rocks', seasons: [2021, 2024], organization: 'Kansas City Royals' },
    { teamName: 'Wilmington Blue Rocks', seasons: [2025, 2100], organization: 'Washington Nationals' },
    { teamName: 'Winston-Salem Dash', seasons: [2019, 2024], organization: 'Chicago White Sox' },
    { teamName: 'Winston-Salem Dash', seasons: [2025, 2100], organization: 'Chicago White Sox' },
    { teamName: 'Winston-Salem Dash', seasons: [2025, 2100], organization: 'Chicago White Sox' },
    { teamName: 'Kannapolis Cannon Ballers', seasons: [2021, 2100], organization: 'Chicago White Sox' },
    { teamName: 'Cedar Rapids Kernels', seasons: [2013, 2100], organization: 'Minnesota Twins' },
    { teamName: 'Fort Myers Mighty Mussels', seasons: [2021, 2100], organization: 'Minnesota Twins' },
    { teamName: 'West Michigan Whitecaps', seasons: [2013, 2100], organization: 'Detroit Tigers' },
    { teamName: 'Lansing Lugnuts', seasons: [2019, 2100], organization: 'Toronto Blue Jays' },
    { teamName: 'Dayton Dragons', seasons: [2010, 2100], organization: 'Cincinnati Reds' },
    { teamName: 'Burlington Bees', seasons: [2013, 2020], organization: 'Los Angeles Angels' },
    { teamName: 'Inland Empire 66ers', seasons: [2011, 2100], organization: 'Los Angeles Angels' },
    { teamName: 'Eugene Emeralds', seasons: [2018, 2100], organization: 'San Francisco Giants' },
    { teamName: 'San Jose Giants', seasons: [2010, 2100], organization: 'San Francisco Giants' },
    // Augusta was a Giants affiliate through 2020; the Braves took over the Low-A
    // affiliation when the 2021 player-development structure began.
    { teamName: 'Augusta GreenJackets', seasons: [2018, 2020], organization: 'San Francisco Giants' },
    { teamName: 'Augusta GreenJackets', seasons: [2021, 2100], organization: 'Atlanta Braves' },
    { teamName: 'Brooklyn Cyclones', seasons: [2010, 2100], organization: 'New York Mets' },
    { teamName: 'Binghamton Rumble Ponies', seasons: [2017, 2100], organization: 'New York Mets' },
    { teamName: 'Syracuse Mets', seasons: [2019, 2100], organization: 'New York Mets' },
    { teamName: 'St. Paul Saints', seasons: [2021, 2100], organization: 'Minnesota Twins' },
    { teamName: 'Memphis Redbirds', seasons: [1998, 2007], organization: 'St. Louis Cardinals' },
    { teamName: 'Memphis Redbirds', seasons: [2018, 2100], organization: 'St. Louis Cardinals' },
    { teamName: 'Springfield Cardinals', seasons: [2010, 2100], organization: 'St. Louis Cardinals' },
    { teamName: 'Palm Beach Cardinals', seasons: [2010, 2100], organization: 'St. Louis Cardinals' },
    { teamName: 'Johnson City Cardinals', seasons: [2010, 2020], organization: 'St. Louis Cardinals' },
    { teamName: 'Mobile BayBears', seasons: [2011, 2019], organization: 'Los Angeles Angels' },
    { teamName: 'Birmingham Barons', seasons: [2010, 2100], organization: 'Chicago White Sox' },
    { teamName: 'San Antonio Missions', seasons: [2010, 2100], organization: 'San Diego Padres' },
    { teamName: 'San Antonio Missions', seasons: [1990, 1994], organization: 'Los Angeles Dodgers' },
    { teamName: 'Dunedin Blue Jays', seasons: [2010, 2100], organization: 'Toronto Blue Jays' },
    { teamName: 'Daytona Tortugas', seasons: [2015, 2100], organization: 'Cincinnati Reds' },
    { teamName: 'Daytona Cubs', seasons: [2010, 2014], organization: 'Chicago Cubs' },
    { teamName: 'Salt Lake Bees', seasons: [2011, 2100], organization: 'Los Angeles Angels' },
    { teamName: 'New Orleans Zephyrs', seasons: [1999, 2016], organization: 'Houston Astros' },
    // Vancouver has been Toronto's affiliate since 2011 (short-season A through
    // 2019, High-A from 2021); the club was never Oakland's in this period.
    { teamName: 'Vancouver Canadians', seasons: [2011, 2100], organization: 'Toronto Blue Jays' },
  ]
}

// ---------------------------------------------------------------------------
// Season splits → stints
// ---------------------------------------------------------------------------

const numOrNull = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** IP like "37.2" (37 and 2/3) → 37.6667. Keeps outs exactly. */
export function parseInningsPitched(value) {
  if (value == null || value === '') return null
  const s = String(value).trim()
  const m = s.match(/^(\d+)(?:\.(\d))?$/)
  if (!m) return null
  const whole = Number(m[1])
  const outs = m[2] ? Number(m[2]) : 0
  if (outs > 2 || !Number.isInteger(whole) || whole < 0) return null
  return whole + outs / 3
}

const pct = (numerator, denominator) =>
  numerator != null && denominator != null && denominator > 0
    ? Math.round((numerator / denominator) * 10000) / 10000
    : null

/**
 * Distills normalized season splits into player/team/level/season stints,
 * merging the hitting and pitching halves of the same (player, season, team,
 * league) split pair into one row. Hitter fields are only filled from hitting
 * data and pitcher fields only from pitching data.
 * @param {ReturnType<import('./normalize.mjs').normalizeSeasonSplits>} splits
 * @param {Map<string, string>} affiliations
 * @param {{ birthDate?: string | null, season?: number, sources?: unknown[] }} meta
 */
export function distillStints(splits, affiliations, meta) {
  const byKey = new Map()
  for (const split of splits) {
    if (split.sportId === 21) continue // "Minors" aggregate, never a stint
    const season = split.season
    if (!season) continue
    const key = [season, split.teamId ?? split.teamName, split.league ?? '', split.level].join('|')
    const { canonical, classification: cls, rule } = classifyLevel(split)
    const existing = byKey.get(key)
    if (existing) {
      // Other half of the same split (hitting + pitching): merge, keep groups.
      existing.groups.push(split.group)
      if (split.group === 'hitting') existing.hitting = split
      else if (split.group === 'pitching') existing.pitching = split
      continue
    }
    const org = resolveOrganization(split.teamName, split.league, season, affiliations)
    const stint = {
      season,
      teamId: split.teamId ?? null,
      teamName: split.teamName ?? null,
      league: split.league ?? null,
      sourceLevel: split.level,
      level: canonical,
      levelRank: LEVEL_TAXONOMY[canonical]?.rank ?? null,
      affiliated: LEVEL_TAXONOMY[canonical]?.affiliated === true,
      classification: cls,
      classificationRule: rule,
      organization: org.organization,
      organizationBasis: org.basis,
      era: eraFor(season),
      firstGameDate: null,
      lastGameDate: null,
      age: numOrNull(split.age),
      numTeams: numOrNull(split.numTeams),
      seasonLabel: split.seasonLabel ?? null,
      groups: [split.group],
      hitting: split.group === 'hitting' ? split : null,
      pitching: split.group === 'pitching' ? split : null,
    }
    byKey.set(key, stint)
  }
  const stints = [...byKey.values()]
  for (const s of stints) {
    s.batting = battingLine(s.hitting)
    s.pitchingLine = pitchingLine(s.pitching)
    s.ageSeasonStart = ageAtSeasonStart(meta.birthDate, s.season)
    s.sources = (meta.sources ?? []).map((x) => x)
  }
  classifySeasonTotals(stints)
  return stints.sort((a, b) => a.season - b.season || (a.levelRank ?? 99) - (b.levelRank ?? 99) || String(a.teamName).localeCompare(String(b.teamName)))
}

// ---------------------------------------------------------------------------
// Season-total (aggregate) splits
// ---------------------------------------------------------------------------

const TOTAL_BATTING_KEYS = ['games', 'plateAppearances', 'atBats', 'hits', 'doubles', 'triples', 'homeRuns', 'walks', 'strikeouts', 'stolenBases', 'caughtStealing']
const TOTAL_PITCHING_KEYS = ['games', 'gamesStarted', 'battersFaced', 'hitsAllowed', 'runs', 'earnedRuns', 'homeRunsAllowed', 'walks', 'strikeouts']

const isTeamless = (s) => s.teamId == null && s.teamName == null
const thirds = (ip) => (ip == null ? null : Math.round(ip * 3))

/**
 * True when every additive stat the total reports equals the components' sum (and at least one was compared).
 * @param {any} total
 * @param {any[]} parts
 */
function additivelyEqual(total, parts) {
  let compared = 0
  /** @type {Array<[string, string[]]>} */
  const lines = [['batting', TOTAL_BATTING_KEYS], ['pitchingLine', TOTAL_PITCHING_KEYS]]
  for (const [line, keys] of lines) {
    if (!total[line]) continue
    for (const key of keys) {
      const value = total[line][key]
      if (value == null) continue
      if (value !== parts.reduce((n, p) => n + (p[line]?.[key] ?? 0), 0)) return false
      compared++
    }
  }
  if (total.pitchingLine?.inningsPitched != null) {
    if (thirds(total.pitchingLine.inningsPitched) !== parts.reduce((n, p) => n + (thirds(p.pitchingLine?.inningsPitched) ?? 0), 0)) return false
  }
  return compared > 0
}

/**
 * @param {any[]} items
 * @param {number} size
 * @param {number} [start]
 * @param {any[]} [picked]
 * @returns {Generator<any[]>}
 */
function* subsetsOfSize(items, size, start = 0, picked = []) {
  if (picked.length === size) { yield [...picked]; return }
  for (let i = start; i < items.length; i++) {
    picked.push(items[i])
    yield* subsetsOfSize(items, size, i + 1, picked)
    picked.pop()
  }
}

/**
 * Classifies each distilled stint as TEAM_STINT, SEASON_TOTAL or UNRESOLVED.
 *
 * The MLB Stats API emits a team-less aggregate split (numTeams >= 2) when a
 * player appears for several teams in one sport/league season. A team-less
 * stint is a SEASON_TOTAL only when BOTH hold: the source says it aggregates
 * numTeams teams, AND its additive stats equal the sum of exactly that many
 * same-season team stints at the same source level. Anything else team-less is
 * UNRESOLVED - never silently dropped, never silently counted as a team stint.
 *   SAME_LEVEL   components share one canonical level, equal to the total's.
 *   CROSS_LEVEL  components span several canonical levels (rookie-sport totals).
 *   SUB_SEASON   a split-season label ("2018.1") whose components are a proper
 *                subset of the player's team stints for the season.
 * Mutates and returns `stints` (sets stintKind / seasonTotalBasis).
 * @param {any[]} stints
 */
export function classifySeasonTotals(stints) {
  for (const s of stints) { s.stintKind = 'TEAM_STINT'; s.seasonTotalBasis = null }
  for (const total of stints) {
    if (!isTeamless(total)) continue
    total.stintKind = 'UNRESOLVED'
    if (!(total.numTeams >= 2)) continue
    const pool = stints.filter((p) => !isTeamless(p) && p.season === total.season && p.sourceLevel === total.sourceLevel)
    if (pool.length < total.numTeams) continue
    if (pool.length === total.numTeams && additivelyEqual(total, pool)) {
      total.stintKind = 'SEASON_TOTAL'
      total.seasonTotalBasis = pool.every((p) => p.level === total.level) ? 'SAME_LEVEL' : 'CROSS_LEVEL'
    } else if (pool.length > total.numTeams && /\./.test(total.seasonLabel ?? '')) {
      for (const subset of subsetsOfSize(pool, total.numTeams)) {
        if (additivelyEqual(total, subset)) { total.stintKind = 'SEASON_TOTAL'; total.seasonTotalBasis = 'SUB_SEASON'; break }
      }
    }
  }
  return stints
}

/** The era a season belongs to, for historical handling. */
export function eraFor(season) {
  if (season < 1960) return 'PRE_1960'
  if (season < 1989) return 'PRE_ACADEMY_1960_1988'
  if (season < 2017) return 'CLASSIC_AFFILIATED_1989_2016'
  if (season < 2021) return 'DSL_AZL_2017_2020'
  return 'MODERN_FOUR_LEVEL_2021_PLUS'
}

/** Age (integer) as of June 30 of the season, the standard season-age convention. */
export function ageAtSeasonStart(birthDate, season) {
  if (!birthDate) return null
  const ref = Date.UTC(season, 5, 30)
  const birth = Date.parse(birthDate)
  if (!Number.isFinite(birth) || ref < birth) return null
  return Math.floor((ref - birth) / (365.2425 * 864e5))
}

/** Hitter line from a hitting split. Every field is null when absent. */
function battingLine(split) {
  if (!split) return null
  const st = split.stat ?? split ?? {}
  return {
    games: numOrNull(st.gamesPlayed),
    plateAppearances: numOrNull(st.plateAppearances),
    atBats: numOrNull(st.atBats),
    hits: numOrNull(st.hits),
    doubles: numOrNull(st.doubles),
    triples: numOrNull(st.triples),
    homeRuns: numOrNull(st.homeRuns),
    walks: numOrNull(st.baseOnBalls),
    strikeouts: numOrNull(st.strikeOuts),
    stolenBases: numOrNull(st.stolenBases),
    caughtStealing: numOrNull(st.caughtStealing),
    avg: statDecimal(st.avg),
    obp: statDecimal(st.obp),
    slg: statDecimal(st.slg),
    ops: statDecimal(st.ops),
    hitByPitch: numOrNull(st.hitByPitch),
    sacFlies: numOrNull(st.sacFlies),
    // Rate derivations only when the denominators exist.
    bbPct: pct(numOrNull(st.baseOnBalls), numOrNull(st.plateAppearances)),
    kPct: pct(numOrNull(st.strikeOuts), numOrNull(st.plateAppearances)),
    hrRatePerPa: numOrNull(st.homeRuns) != null && numOrNull(st.plateAppearances) > 0
      ? Math.round((numOrNull(st.homeRuns) / numOrNull(st.plateAppearances)) * 10000) / 10000
      : null,
  }
}

/** Pitcher line from a pitching split. */
function pitchingLine(split) {
  if (!split) return null
  const st = split.stat ?? split ?? {}
  const ip = parseInningsPitched(st.inningsPitched)
  const bf = numOrNull(st.battersFaced)
  const so = numOrNull(st.strikeOuts)
  const bb = numOrNull(st.baseOnBalls)
  return {
    games: numOrNull(st.gamesPlayed) ?? numOrNull(st.gamesPitched),
    gamesStarted: numOrNull(st.gamesStarted),
    inningsPitched: ip,
    battersFaced: bf,
    hitsAllowed: numOrNull(st.hits),
    runs: numOrNull(st.runs),
    earnedRuns: numOrNull(st.earnedRuns),
    homeRunsAllowed: numOrNull(st.homeRuns),
    walks: bb,
    strikeouts: so,
    era: statDecimal(st.era),
    whip: statDecimal(st.whip),
    hitByPitch: numOrNull(st.hitBatsmen),
    kPct: pct(so, bf),
    bbPct: pct(bb, bf),
    kMinusBbPct: so != null && bb != null && bf > 0 ? Math.round(((so - bb) / bf) * 10000) / 10000 : null,
    hrRatePerBf: pct(numOrNull(st.homeRuns), bf),
  }
}

/** ".243" → 0.243; unknown or malformed stays null. */
export function statDecimal(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const s = String(value).trim()
  if (!/^-?\.\d+$/.test(s) && !/^-?\d+\.\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

const DISPOSITION_CODE_TO_EVENT = { REL: 'RELEASED', RET: 'RETIRED' }

/** Internal mapping of canonical level → the debut milestone it evidences. */
const DEBUT_MILESTONE_BY_LEVEL = {
  INTERNATIONAL_ROOKIE: 'DSL_DEBUT',
  COMPLEX_ROOKIE: 'COMPLEX_DEBUT',
  LOW_A: 'A_DEBUT',
  HIGH_A: 'HIGH_A_DEBUT',
  AA: 'AA_DEBUT',
  AAA: 'AAA_DEBUT',
  MLB: 'MLB_DEBUT',
}

/**
 * First-appearance milestone candidates from stints, transactions and records.
 * A date exists only when the underlying record carries one: season-only
 * evidence yields date null, which the database treats as "unknown", never
 * "not reached" and never a fabricated date.
 * @param {{
 *   stints: ReturnType<typeof distillStints>,
 *   transactions?: { date: string, typeCode: string|null, fromTeamName?: string|null, toTeamName?: string|null, description?: string|null }[],
 *   signingDate?: string | null,
 *   mlbDebutDate?: string | null,
 *   auditedThroughSeason?: number,
 * }} input
 */
export function buildMilestoneCandidates({ stints, transactions = [], signingDate = null, mlbDebutDate = null, auditedThroughSeason = null }) {
  const affiliated = stints.filter((s) => s.affiliated)
  const firstOf = (level) => affiliated.filter((s) => s.level === level)
    .sort((a, b) => a.season - b.season)[0] ?? null
  const out = []

  if (signingDate) {
    out.push({ milestone: 'SIGNED', eventDate: signingDate, datePrecision: 'DAY', season: null, evidence: 'SIGNING_RECORD', level: null, organization: null, note: 'Recorded signing date.' })
  }

  for (const level of ['INTERNATIONAL_ROOKIE', 'COMPLEX_ROOKIE', 'LOW_A', 'HIGH_A', 'AA', 'AAA', 'MLB']) {
    const first = firstOf(level)
    if (!first) continue
    // For MLB prefer the person-record debut date when available.
    const exact = level === 'MLB' && mlbDebutDate ? mlbDebutDate : null
    out.push({
      milestone: DEBUT_MILESTONE_BY_LEVEL[level],
      eventDate: exact,
      datePrecision: exact ? 'DAY' : 'SEASON',
      season: first.season,
      evidence: exact ? 'MLB_PERSON_RECORD' : 'SEASON_SPLITS',
      level,
      organization: first.organization,
      note: exact ? 'Exact debut date from the MLB person record.' : 'Season of first appearance is known; the exact date is not recorded here.',
    })
  }

  // Organization changes: the first affiliated stint after one owned by a
  // different organization.
  const affiliatedChrono = [...affiliated].sort((a, b) => a.season - b.season || (a.levelRank ?? 0) - (b.levelRank ?? 0))
  let previous = null
  for (const stint of affiliatedChrono) {
    if (previous && stint.organization && previous.organization && stint.organization !== previous.organization) {
      out.push({
        milestone: 'ORGANIZATION_CHANGE',
        eventDate: null,
        datePrecision: 'SEASON',
        season: stint.season,
        evidence: 'SEASON_SPLITS',
        level: stint.level,
        organization: stint.organization,
        note: `Development moved from ${previous.organization} to ${stint.organization} by ${stint.season}; exact date not established.`,
      })
      break
    }
    previous = stint
  }

  // Release / retirement need a dated transaction; without one they are
  // unknown, never asserted. The FINAL transaction of each type is the
  // disposition that matters for "where development stopped".
  const sortedTx = [...transactions].sort((a, b) => (a.date < b.date ? -1 : 1))
  for (const event of ['RELEASED', 'RETIRED']) {
    const code = event === 'RELEASED' ? 'REL' : 'RET'
    const final = [...sortedTx].reverse().find((t) => t.typeCode === code)
    if (!final) continue
    out.push({
      milestone: event,
      eventDate: final.date,
      datePrecision: 'DAY',
      season: Number(final.date.slice(0, 4)),
      evidence: 'MLB_TRANSACTION_LOG',
      level: null,
      organization: final.fromTeamName ?? null,
      note: `${event === 'RELEASED' ? 'Final release' : 'Retirement'} transaction on ${final.date}.`,
    })
  }

  // Retirement / final affiliated appearance only where verified: the player
  // reached MLB or his case is mature-audited, and play has stopped.
  const lastAffiliated = affiliatedChrono.at(-1) ?? null
  if (mlbDebutDate && auditedThroughSeason && lastAffiliated && lastAffiliated.season < auditedThroughSeason - 2) {
    out.push({
      milestone: 'FINAL_AFFILIATED_APPEARANCE',
      eventDate: null,
      datePrecision: 'SEASON',
      season: lastAffiliated.season,
      evidence: 'SEASON_SPLITS',
      level: lastAffiliated.level,
      organization: lastAffiliated.organization,
      note: `No affiliated appearance after ${lastAffiliated.season} through the audited season; verified as of the audit date, not an exact retirement date.`,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// SQL VALUES helpers (shared by the development-sql-values command)
// ---------------------------------------------------------------------------

/** Wraps a value so it serializes as a jsonb literal, not text. */
export class Json {
  constructor(value) { this.value = value }
}

/** SQL literal for a research value; unknown stays null. */
export function sqlValue(v) {
  if (v == null) return 'null'
  if (v instanceof Json) return `${sqlValue(JSON.stringify(v.value))}::jsonb`
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'null'
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000)
  }
  return `'${String(v).replace(/'/g, "''")}'`
}

export function sqlRow(values) {
  return `(${values.map(sqlValue).join(',')})`
}
