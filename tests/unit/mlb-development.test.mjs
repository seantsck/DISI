// Offline tests for development-history research (scripts/mlb/lib/development.mjs).
// No network access; small fictional records built inline.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEVEL_TAXONOMY, classifyLevel, eraFor, parseInningsPitched, statDecimal, ageAtSeasonStart,
  resolveOrganization, buildAffiliations, dodgersAffiliationRules, distillStints,
  buildMilestoneCandidates, sqlValue, sqlRow, Json,
} from '../../scripts/mlb/lib/development.mjs'
import { normalizeSeasonSplits } from '../../scripts/mlb/lib/normalize.mjs'

const affiliations = buildAffiliations(dodgersAffiliationRules())

/**
 * A raw (pre-normalize) split with the optional fields present.
 * @template T
 * @param {T} over
 * @returns {T & { level: any, levelRank: any, games: any }}
 */
const raw = (over) => ({ level: null, levelRank: null, games: null, ...over })

const hit = (over = {}) => ({ group: 'hitting', stat: { gamesPlayed: 44, plateAppearances: 198, atBats: 167, hits: 46, baseOnBalls: 24, strikeOuts: 54, avg: '.275', obp: '.376', slg: '.443', ops: '.819', age: 17 }, ...over })
const pitch = (over = {}) => ({ group: 'pitching', stat: { gamesPlayed: 12, gamesStarted: 12, inningsPitched: '36.2', battersFaced: 155, hits: 38, runs: 19, earnedRuns: 13, baseOnBalls: 3, strikeOuts: 24, era: '3.19', whip: '1.12', age: 17 }, ...over })

test('level taxonomy: the Mexican League is never affiliated AAA, whatever the sport id says', () => {
  // 019 correction kept in the research layer: the MLB Stats API filed the
  // Mexican League under the Triple-A sport id before 2021.
  const mexican = classifyLevel({ league: 'Mexican League', sportId: 11 })
  assert.deepEqual([mexican.canonical, mexican.classification], ['FOREIGN_PRO', 'FOREIGN_PRO_LEAGUE'])
  assert.equal(LEVEL_TAXONOMY.FOREIGN_PRO.affiliated, false)
  for (const league of ['NPB', 'KBO League', 'Cuban National Series']) {
    assert.equal(classifyLevel({ league, sportId: 11 }).canonical, 'FOREIGN_PRO', league)
  }
  // Genuine minor-league sport ids classify by id.
  assert.equal(classifyLevel({ league: 'Midwest League', sportId: 14 }).canonical, 'LOW_A')
  assert.equal(classifyLevel({ league: 'x', sportId: 15 }).classification, 'SPORT_ID_15_SHORT_SEASON')
  assert.equal(classifyLevel({ league: 'x', sportId: 13 }).canonical, 'HIGH_A')
  assert.equal(classifyLevel({ league: 'x', sportId: 12 }).canonical, 'AA')
  assert.equal(classifyLevel({ league: 'x', sportId: 11 }).canonical, 'AAA')
  assert.equal(classifyLevel({ league: 'x', sportId: 1 }).canonical, 'MLB')
  assert.equal(classifyLevel({ league: 'x', sportId: 99 }).canonical, 'OTHER')
})

test('rookie leagues split by name; unclassifiable rookie ball stays OTHER, never invented', () => {
  assert.equal(classifyLevel({ league: 'Dominican Summer League', sportId: 16 }).canonical, 'INTERNATIONAL_ROOKIE')
  assert.equal(classifyLevel({ league: 'Arizona Complex League', sportId: 16 }).canonical, 'COMPLEX_ROOKIE')
  assert.equal(classifyLevel({ league: 'Florida Complex League', sportId: 16 }).canonical, 'COMPLEX_ROOKIE')
  assert.equal(classifyLevel({ league: 'Gulf Coast League', sportId: 16 }).canonical, 'COMPLEX_ROOKIE')
  const pioneer = classifyLevel({ league: 'Pioneer League', sportId: 16 })
  assert.deepEqual([pioneer.canonical, pioneer.classification], ['OTHER', 'UNKNOWN_ROOKIE_LEAGUE'])
  const blank = classifyLevel({ league: '', sportId: 16 })
  assert.equal(blank.canonical, 'OTHER')
  assert.match(blank.rule, /unknown/)
})

test('development eras are explicit, not assumed identical', () => {
  assert.deepEqual([eraFor(1959), eraFor(1960), eraFor(1988), eraFor(1989), eraFor(2016), eraFor(2017), eraFor(2020), eraFor(2021), eraFor(2026)],
    ['PRE_1960', 'PRE_ACADEMY_1960_1988', 'PRE_ACADEMY_1960_1988', 'CLASSIC_AFFILIATED_1989_2016',
      'CLASSIC_AFFILIATED_1989_2016', 'DSL_AZL_2017_2020', 'DSL_AZL_2017_2020', 'MODERN_FOUR_LEVEL_2021_PLUS', 'MODERN_FOUR_LEVEL_2021_PLUS'])
})

test('innings like "37.2" parse as exact thirds; impossible values stay null', () => {
  assert.equal(parseInningsPitched('37.2'), 37 + 2 / 3)
  assert.equal(parseInningsPitched('9.0'), 9)
  assert.equal(parseInningsPitched('6.1'), 6 + 1 / 3)
  assert.equal(parseInningsPitched('7'), 7)
  assert.equal(parseInningsPitched('37.3'), null, 'three outs is a full inning')
  assert.equal(parseInningsPitched('12.02'), null)
  assert.equal(parseInningsPitched('x'), null)
  assert.equal(parseInningsPitched(null), null)
  assert.equal(statDecimal('.275'), 0.275)
  assert.equal(statDecimal('.---'), null)
  assert.equal(statDecimal(0.31), 0.31)
})

test('season age uses the June 30 convention and never invents an age', () => {
  assert.equal(ageAtSeasonStart('2006-03-15', 2023), 17)
  assert.equal(ageAtSeasonStart('2006-07-15', 2023), 16, 'born after June 30 of the season')
  assert.equal(ageAtSeasonStart(null, 2023), null)
  assert.equal(ageAtSeasonStart('2023-07-01', 2023), null)
})

test('organizations resolve per season from reviewed rules; foreign clubs resolve to null deliberately', () => {
  assert.deepEqual(resolveOrganization('DSL LAD Mega', 'Dominican Summer League', 2023, affiliations),
    { organization: 'Los Angeles Dodgers', basis: 'AFFILIATION_TABLE' })
  assert.deepEqual(resolveOrganization('Ogden Raptors', 'Pioneer League', 2010, affiliations),
    { organization: 'Los Angeles Dodgers', basis: 'AFFILIATION_TABLE' })
  assert.equal(resolveOrganization('Ogden Raptors', 'Pioneer League', 2020, affiliations).organization, null,
    'an affiliation rule outside its seasons does not silently extend')
  assert.deepEqual(resolveOrganization('Los Angeles Dodgers', null, 2024, affiliations),
    { organization: 'Los Angeles Dodgers', basis: 'MLB_CLUB_NAME' })
  assert.deepEqual(resolveOrganization('St. Louis Cardinals', null, 2020, affiliations),
    { organization: 'St. Louis Cardinals', basis: 'MLB_CLUB_NAME' })
  assert.deepEqual(resolveOrganization('Diablos Rojos del Mexico', 'Mexican League', 2018, affiliations),
    { organization: null, basis: 'FOREIGN_PRO_CLUB' },
    'a Mexican club keeps organization null; the club name stays verbatim')
  assert.deepEqual(resolveOrganization(null, 'x', 2023, affiliations), { organization: null, basis: 'NO_TEAM_NAME' })
  assert.deepEqual(resolveOrganization('Totally Unknown Team', 'x', 2023, affiliations),
    { organization: null, basis: 'UNKNOWN_TEAM' })
})

test('season splits distill into stints: halves merge, teams and levels never do', () => {
  const splits = normalizeSeasonSplits({ stats: [
    { group: { displayName: 'hitting' }, splits: [
      { season: '2023', sport: { id: 16 }, team: { id: 612, name: 'DSL LAD Mega' }, league: { name: 'Dominican Summer League' }, stat: hit().stat },
      { season: '2024', sport: { id: 16 }, team: { id: 612, name: 'DSL LAD Mega' }, league: { name: 'Dominican Summer League' }, stat: hit().stat },
    ] },
    { group: { displayName: 'pitching' }, splits: [
      { season: '2023', sport: { id: 16 }, team: { id: 612, name: 'DSL LAD Mega' }, league: { name: 'Dominican Summer League' }, stat: pitch().stat },
    ] },
  ] })
  assert.equal(splits.length, 3)
  assert.equal(splits[0].stat.gamesPlayed, 44, 'the full stat object is carried through additively')
  assert.equal(splits[0].age, 17)
  const stints = distillStints(splits, affiliations, { birthDate: '2006-03-15' })
  assert.equal(stints.length, 2, 'the hitting and pitching halves of 2023 merge; 2024 is its own stint')
  const twoWay = stints.find((s) => s.season === 2023)
  assert.deepEqual(twoWay.groups, ['hitting', 'pitching'])
  assert.deepEqual([twoWay.batting.games, twoWay.batting.plateAppearances, twoWay.batting.kPct], [44, 198, 0.2727])
  assert.deepEqual([twoWay.pitchingLine.games, twoWay.pitchingLine.inningsPitched], [12, 36 + 2 / 3])
  assert.deepEqual([twoWay.level, twoWay.levelRank, twoWay.affiliated, twoWay.era],
    ['INTERNATIONAL_ROOKIE', 1, true, 'MODERN_FOUR_LEVEL_2021_PLUS'])
  assert.deepEqual([twoWay.organization, twoWay.organizationBasis], ['Los Angeles Dodgers', 'AFFILIATION_TABLE'])
  assert.deepEqual([twoWay.age, twoWay.ageSeasonStart], [17, 17])
})

test('a foreign stint distills as unaffiliated with no organization; the minors aggregate split is skipped', () => {
  const splits = [
    raw({ group: 'pitching', season: 2018, sportId: 11, level: 'AAA', levelRank: 6, teamId: 1, teamName: 'Diablos Rojos del Mexico', league: 'Mexican League', stat: pitch().stat, age: null, affiliated: true }),
    raw({ group: 'hitting', season: 2019, sportId: 21, level: 'AAA', levelRank: 6, teamId: 2, teamName: 'Minors Aggregate', league: 'Minors', stat: hit().stat, age: null, affiliated: true }),
  ]
  const stints = distillStints(splits, affiliations, {})
  assert.equal(stints.length, 1, 'sport id 21 is an aggregate, never a stint')
  assert.deepEqual([stints[0].level, stints[0].affiliated, stints[0].levelRank, stints[0].organization],
    ['FOREIGN_PRO', false, null, null])
  assert.equal(stints[0].sourceLevel, 'AAA', 'the source label is preserved beside the correction')
})

test('milestone candidates: dates exist only where a dated record supports them', () => {
  const stints = distillStints([
    raw({ group: 'hitting', season: 2023, sportId: 16, level: 'ROK', levelRank: 1, teamId: 612, teamName: 'DSL LAD Mega', league: 'Dominican Summer League', stat: hit().stat, age: 17, affiliated: true }),
    raw({ group: 'hitting', season: 2024, sportId: 16, level: 'ROK', levelRank: 1, teamId: 5427, teamName: 'ACL Dodgers', league: 'Arizona Complex League', stat: hit().stat, age: 18, affiliated: true }),
  ], affiliations, { birthDate: '2006-03-15' })
  const out = buildMilestoneCandidates({ stints, transactions: [
    { date: '2022-01-15', typeCode: 'SIG', description: 'signed' },
    { date: '2023-06-01', typeCode: 'REL', description: 'released x' },
    { date: '2024-08-01', typeCode: 'ASG', description: 'reassigned' },
    { date: '2025-03-30', typeCode: 'REL', description: 'final release' },
  ], signingDate: '2022-01-15' })
  const byCode = Object.fromEntries(out.map((m) => [m.milestone, m]))
  assert.deepEqual([byCode.SIGNED.eventDate, byCode.SIGNED.datePrecision, byCode.SIGNED.evidence],
    ['2022-01-15', 'DAY', 'SIGNING_RECORD'])
  assert.deepEqual([byCode.DSL_DEBUT.eventDate, byCode.DSL_DEBUT.datePrecision, byCode.DSL_DEBUT.season],
    [null, 'SEASON', 2023], 'a season split is not a date')
  assert.deepEqual([byCode.COMPLEX_DEBUT.eventDate, byCode.COMPLEX_DEBUT.datePrecision, byCode.COMPLEX_DEBUT.season],
    [null, 'SEASON', 2024])
  assert.equal(byCode.A_DEBUT, undefined, 'levels never played are never asserted')
  assert.deepEqual([byCode.RELEASED.eventDate, byCode.RELEASED.datePrecision, byCode.RELEASED.season, byCode.RELEASED.evidence],
    ['2025-03-30', 'DAY', 2025, 'MLB_TRANSACTION_LOG'], 'the FINAL release transaction is the disposition')
  for (const m of out) {
    if (m.datePrecision === 'DAY') assert.ok(m.eventDate, `${m.milestone} claims DAY without a date`)
    if (m.datePrecision === 'SEASON') assert.equal(m.eventDate, null, `${m.milestone} fabricated a date from a season`)
  }
})

test('an exact MLB debut date comes from the person record; organization changes stay SEASON-precision', () => {
  const stints = distillStints([
    raw({ group: 'hitting', season: 2022, sportId: 16, level: 'ROK', levelRank: 1, teamId: 612, teamName: 'DSL LAD Mega', league: 'Dominican Summer League', stat: hit().stat, age: 17, affiliated: true }),
    raw({ group: 'pitching', season: 2024, sportId: 16, level: 'ROK', levelRank: 1, teamId: 5427, teamName: 'ACL White Sox', league: 'Arizona Complex League', stat: pitch().stat, age: 19, affiliated: true }),
    raw({ group: 'hitting', season: 2026, sportId: 1, level: 'MLB', levelRank: 7, teamId: 147, teamName: 'Los Angeles Dodgers', league: 'Major League Baseball', stat: hit().stat, age: 21, affiliated: true }),
  ], affiliations, {})
  const out = buildMilestoneCandidates({ stints, mlbDebutDate: '2026-04-02' })
  const debut = out.find((m) => m.milestone === 'MLB_DEBUT')
  assert.deepEqual([debut.eventDate, debut.datePrecision, debut.evidence], ['2026-04-02', 'DAY', 'MLB_PERSON_RECORD'])
  assert.equal(out.find((m) => m.milestone === 'MLB_DEBUT' && m.datePrecision === 'SEASON'), undefined,
    'with a person-record date, no season-only MLB debut row is added')
  const change = out.find((m) => m.milestone === 'ORGANIZATION_CHANGE')
  assert.deepEqual([change.eventDate, change.datePrecision, change.season, change.organization],
    [null, 'SEASON', 2024, 'Chicago White Sox'])
  assert.match(change.note, /Los Angeles Dodgers to Chicago White Sox by 2024/)
})

test('sql helpers: unknown stays null, text escapes quotes, json wraps as jsonb', () => {
  assert.equal(sqlValue(null), 'null')
  assert.equal(sqlValue(undefined), 'null')
  assert.equal(sqlValue(true), 'true')
  assert.equal(sqlValue(0.123456), '0.1235', 'rates round to four decimals')
  assert.equal(sqlValue("O'Brien"), "'O''Brien'")
  assert.equal(sqlValue(new Json({ a: 1 })), "'{\"a\":1}'::jsonb")
  assert.equal(sqlRow(['x', null, 5]), "('x',null,5)")
})
