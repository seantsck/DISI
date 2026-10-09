// Offline tests for scripts/mlb/lib/exact-dates.mjs with deterministic
// fixtures. No network, no database. These prove the participation rule and
// the SEASON → DAY upgrade guard before any values are reviewed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractGameAppearances, attributeAppearances, exactDatesForStints,
  levelFirstAppearances, buildExactDateCandidates, classifyGameLevel,
} from '../../scripts/mlb/lib/exact-dates.mjs'

/** A hitting gameLog response with the given dated splits. */
const hittingLog = (rows) => ({
  stats: [{ splits: rows.map((r) => ({
    season: String(r.date.slice(0, 4)),
    date: r.date,
    game: { gamePk: r.gamePk ?? 900000 + Number(r.date.replaceAll('-', '')) },
    team: { id: r.teamId, name: r.teamName },
    sport: { id: r.sportId ?? 14, abbreviation: r.sportAbbr ?? 'A' },
    league: { id: 100, name: r.leagueName ?? 'Midwest League' },
    positionsPlayed: r.positionsPlayed ?? [{ code: '7', name: 'Left Fielder', type: 'Hitter', abbreviation: 'LF' }],
    stat: r.stat ?? { gamesPlayed: 1, plateAppearances: 4, atBats: 3 },
  })) }],
})

/** A pitching gameLog response with the given dated splits. */
const pitchingLog = (rows) => ({
  stats: [{ splits: rows.map((r) => ({
    season: String(r.date.slice(0, 4)),
    date: r.date,
    game: { gamePk: r.gamePk ?? 900000 + Number(r.date.replaceAll('-', '')) },
    team: { id: r.teamId, name: r.teamName },
    sport: { id: r.sportId ?? 14, abbreviation: r.sportAbbr ?? 'A' },
    league: { id: 100, name: r.leagueName ?? 'Midwest League' },
    stat: r.stat ?? { gamesPlayed: 1, inningsPitched: '2.0', battersFaced: 7 },
  })) }],
})

/** Minimal reviewed stint (the fields the library reads). */
const stint = (over = {}) => ({
  season: 2024, teamId: 456, teamName: 'Great Lakes Loons', league: 'Midwest League',
  level: 'LOW_A', levelRank: 3, affiliated: true, organization: 'Los Angeles Dodgers',
  groups: ['hitting'], ...over,
})

const aaMilestone = (over = {}) => ({
  milestone: 'AA_DEBUT', eventDate: null, datePrecision: 'SEASON', season: 2024,
  evidence: 'SEASON_SPLITS', ...over,
})

test('an exact game appearance upgrades SEASON to DAY in place', () => {
  const stints = [stint(), stint({ season: 2025, teamId: 260, teamName: 'Tulsa Drillers', level: 'AA', levelRank: 5, league: 'Texas League' })]
  const appearances = [
    ...extractGameAppearances(hittingLog([
      { date: '2024-04-05', teamId: 456, teamName: 'Great Lakes Loons' },
      { date: '2024-08-30', teamId: 456, teamName: 'Great Lakes Loons' },
      { date: '2025-04-03', teamId: 260, teamName: 'Tulsa Drillers', sportId: 12, leagueName: 'Texas League' },
    ]), 'hitting'),
  ]
  const out = buildExactDateCandidates({ stints, milestones: [aaMilestone({ season: 2025 })], appearances })
  assert.deepEqual(out.upgrades.map((u) => [u.eventCode, u.milestoneDate]), [['AA_DEBUT', '2025-04-03']])
  assert.equal(out.upgrades[0].priorEvidenceBasis, 'SEASON_SPLITS')
  assert.equal(out.upgrades[0].priorDatePrecision, 'SEASON')
})

test('a team schedule alone never creates an exact date', () => {
  // Roster/schedule-shaped entries (no stat block, no dated participation) are
  // not appearances and are dropped before any dating happens.
  const scheduleLike = { stats: [{ splits: [
    { date: '2024-04-05', team: { id: 456, name: 'Great Lakes Loons' } }, // no stat block at all
  ] }] }
  const appearances = extractGameAppearances(scheduleLike, 'hitting')
  assert.deepEqual(appearances, [])
  const out = buildExactDateCandidates({ stints: [stint()], milestones: [aaMilestone()], appearances: [] })
  assert.deepEqual(out.upgrades, [])
})

test('a transaction or promotion date alone never creates a game date', () => {
  // The library receives no transactions at all: only gameLog entries can
  // produce dates. A milestone whose season has no log coverage stays SEASON.
  const out = buildExactDateCandidates({
    stints: [stint({ season: 2022, teamId: 611, teamName: 'DSL LAD Bautista', level: 'INTERNATIONAL_ROOKIE', levelRank: 1, league: 'Dominican Summer League' })],
    milestones: [aaMilestone({ season: 2022 })],
    appearances: [],
  })
  assert.deepEqual(out.upgrades, [])
  assert.equal(out.conflicts.some((c) => c.kind === 'NO_GAME_LOG_COVERAGE'), true)
})

test('first and last appearance are correct within a stint', () => {
  const stints = [stint()]
  const appearances = extractGameAppearances(hittingLog([
    { date: '2024-08-30', teamId: 456, teamName: 'Great Lakes Loons' },
    { date: '2024-04-05', teamId: 456, teamName: 'Great Lakes Loons' },
    { date: '2024-04-09', teamId: 456, teamName: 'Great Lakes Loons' },
  ]), 'hitting')
  const attributed = attributeAppearances(stints, appearances)
  const dates = exactDatesForStints(stints, attributed)
  assert.deepEqual(dates.map((d) => [d.first, d.last]), [['2024-04-05', '2024-08-30']])
})

test('multi-level same-season dates stay attached to the correct levels', () => {
  const stints = [
    stint(), // 2024 Low-A, team 456
    stint({ season: 2024, teamId: 260, teamName: 'Tulsa Drillers', level: 'AA', levelRank: 5, league: 'Texas League' }),
  ]
  const appearances = extractGameAppearances(hittingLog([
    { date: '2024-06-01', teamId: 456, teamName: 'Great Lakes Loons' },
    { date: '2024-06-20', teamId: 260, teamName: 'Tulsa Drillers', sportId: 12, leagueName: 'Texas League' },
    { date: '2024-07-04', teamId: 260, teamName: 'Tulsa Drillers', sportId: 12, leagueName: 'Texas League' },
  ]), 'hitting')
  const attributed = attributeAppearances(stints, appearances)
  const dates = exactDatesForStints(stints, attributed)
  const lowA = dates.find((d) => d.season === 2024 && d.teamId === 456)
  const aa = dates.find((d) => d.teamId === 260)
  assert.deepEqual([lowA.first, lowA.last], ['2024-06-01', '2024-06-01'])
  assert.deepEqual([aa.first, aa.last], ['2024-06-20', '2024-07-04'])
  const firsts = levelFirstAppearances(attributed)
  assert.equal(firsts.find((f) => f.level === 'LOW_A').date, '2024-06-01')
  assert.equal(firsts.find((f) => f.level === 'AA').date, '2024-06-20')
})

test('multi-org season dates stay attached to the correct organizations', () => {
  const stints = [
    stint(), // Dodgers org, team 456
    stint({ season: 2024, teamId: 260, teamName: 'Tulsa Drillers', level: 'AA', levelRank: 5, league: 'Texas League', organization: 'Chicago White Sox' }),
  ]
  const appearances = extractGameAppearances(hittingLog([
    { date: '2024-05-01', teamId: 456, teamName: 'Great Lakes Loons' },
    { date: '2024-05-20', teamId: 260, teamName: 'Tulsa Drillers', sportId: 12, leagueName: 'Texas League' },
  ]), 'hitting')
  const attributed = attributeAppearances(stints, appearances)
  const dates = exactDatesForStints(stints, attributed)
  assert.equal(dates.filter((d) => d.first).length, 2)
  assert.equal(dates.find((d) => d.teamId === 260).first, '2024-05-20')
})

test('a pitcher game log is supported', () => {
  const stints = [stint({ groups: ['pitching'] })]
  const appearances = extractGameAppearances(pitchingLog([
    { date: '2024-04-06', teamId: 456, teamName: 'Great Lakes Loons' },
  ]), 'pitching')
  assert.equal(appearances.length, 1)
  assert.equal(appearances[0].ipOuts, 6)
  const out = buildExactDateCandidates({ stints, milestones: [], appearances })
  assert.equal(out.stintDates[0].first, '2024-04-06')
})

test('a two-way player dedupes hitting and pitching logs to one appearance per date', () => {
  const stints = [stint({ groups: ['hitting', 'pitching'] })]
  const appearances = [
    ...extractGameAppearances(hittingLog([{ date: '2024-04-06', teamId: 456, teamName: 'Great Lakes Loons' }]), 'hitting'),
    ...extractGameAppearances(pitchingLog([{ date: '2024-04-06', teamId: 456, teamName: 'Great Lakes Loons' }]), 'pitching'),
  ]
  const attributed = attributeAppearances(stints, appearances)
  const dates = exactDatesForStints(stints, attributed)
  assert.equal(dates[0].games, 2) // both records kept as evidence
  assert.equal(new Set(attributed.map((a) => a.date)).size, 1) // one distinct game date
  assert.equal(dates[0].first, '2024-04-06')
})

test('a defensive-only appearance is participation', () => {
  const log = { stats: [{ splits: [{
    season: '2024', date: '2024-05-02', game: { gamePk: 1 },
    team: { id: 456, name: 'Great Lakes Loons' },
    sport: { id: 14, abbreviation: 'A' }, league: { id: 100, name: 'Midwest League' },
    positionsPlayed: [{ code: '2', name: 'Catcher', type: 'Hitter', abbreviation: 'C' }],
    stat: { gamesPlayed: 1, plateAppearances: 0, atBats: 0 },
  }] }] }
  const appearances = extractGameAppearances(log, 'hitting')
  assert.equal(appearances.length, 1)
  assert.equal(appearances[0].defensive, true)
})

test('an entry with no participation markers is not an appearance', () => {
  const log = { stats: [{ splits: [{
    season: '2024', date: '2024-05-02', team: { id: 456, name: 'Great Lakes Loons' },
    stat: { gamesPlayed: 0 }, // roster-style entry: on the team, did not play
  }] }] }
  assert.deepEqual(extractGameAppearances(log, 'hitting'), [])
})

test('a foreign professional game never becomes affiliated AAA', () => {
  // The MLB Stats API filed the Mexican League under the Triple-A sport id
  // before 2021; the 021 correction must survive game-level attribution.
  const game = classifyGameLevel(11, 'Mexican League', 'AAA')
  assert.equal(game.level, 'FOREIGN_PRO')
  assert.equal(game.classification, 'FOREIGN_PRO_LEAGUE')
  const stints = [stint({ season: 2019, teamId: 380, teamName: 'Diablos Rojos del Mexico', level: 'FOREIGN_PRO', levelRank: null, affiliated: false, league: 'Mexican League', organization: null, groups: ['hitting'] })]
  const appearances = extractGameAppearances(hittingLog([
    { date: '2019-04-06', teamId: 380, teamName: 'Diablos Rojos del Mexico', sportId: 11, leagueName: 'Mexican League' },
  ]), 'hitting')
  const attributed = attributeAppearances(stints, appearances)
  assert.equal(attributed[0].level, 'FOREIGN_PRO')
})

test('conflicting exact sources create a conflict instead of an overwrite', () => {
  const stints = [stint({ season: 2025, teamId: 260, teamName: 'Tulsa Drillers', level: 'MLB', levelRank: 7, league: 'National League' })]
  const appearances = extractGameAppearances(hittingLog([
    { date: '2025-04-15', teamId: 260, teamName: 'Tulsa Drillers', sportId: 1, leagueName: 'National League' },
  ]), 'hitting')
  const out = buildExactDateCandidates({
    stints,
    milestones: [{ milestone: 'MLB_DEBUT', eventDate: '2025-04-10', datePrecision: 'DAY', season: 2025, evidence: 'MLB_PERSON_RECORD' }],
    appearances,
  })
  assert.deepEqual(out.upgrades, [])
  assert.equal(out.conflicts.length, 1)
  assert.equal(out.conflicts[0].kind, 'EXACT_DATE_CONFLICT')
  assert.equal(out.conflicts[0].valueA, '2025-04-10')
  assert.equal(out.conflicts[0].valueB, '2025-04-15')
})

test('missing game logs preserve SEASON precision', () => {
  const out = buildExactDateCandidates({
    stints: [stint({ season: 2024, teamId: 260, teamName: 'Tulsa Drillers', level: 'AA', levelRank: 5, league: 'Texas League' })],
    milestones: [aaMilestone({ season: 2024 })],
    appearances: [],
  })
  assert.deepEqual(out.upgrades, [])
  // No PROFESSIONAL_DEBUT is invented either.
  assert.deepEqual(out.newMilestones, [])
})

test('game logs that start after the reviewed first season do not upgrade', () => {
  // The milestone says first AA season 2021; logs only exist from 2022. The
  // true first appearance predates coverage, so the date is not provable.
  const stints = [
    stint({ season: 2021, teamId: 260, teamName: 'Tulsa Drillers', level: 'AA', levelRank: 5, league: 'Texas League' }),
    stint({ season: 2022, teamId: 260, teamName: 'Tulsa Drillers', level: 'AA', levelRank: 5, league: 'Texas League' }),
  ]
  const appearances = extractGameAppearances(hittingLog([
    { date: '2022-04-08', teamId: 260, teamName: 'Tulsa Drillers', sportId: 12, leagueName: 'Texas League' },
  ]), 'hitting')
  const out = buildExactDateCandidates({ stints, milestones: [aaMilestone({ season: 2021 })], appearances })
  assert.deepEqual(out.upgrades, [])
  assert.equal(out.conflicts.some((c) => c.kind === 'GAME_LOG_STARTS_LATER'), true)
})

test('PROFESSIONAL_DEBUT is emitted only when the first appearance falls in the first stint season', () => {
  const stints = [stint({ season: 2022, teamId: 611, teamName: 'DSL LAD Bautista', level: 'INTERNATIONAL_ROOKIE', levelRank: 1, league: 'Dominican Summer League' })]
  const inSeason = extractGameAppearances(hittingLog([
    { date: '2022-06-06', teamId: 611, teamName: 'DSL LAD Bautista', sportId: 16, leagueName: 'Dominican Summer League' },
  ]), 'hitting')
  const ok = buildExactDateCandidates({ stints, milestones: [], appearances: inSeason })
  assert.deepEqual(ok.newMilestones.map((m) => [m.eventCode, m.eventDate]), [['PROFESSIONAL_DEBUT', '2022-06-06']])

  // First stint is a foreign-pro club with no logs; the earliest dated game is
  // two seasons later, so the first professional game stays unknown.
  const foreignFirst = [stint({ season: 2019, teamId: 380, teamName: 'Diablos Rojos del Mexico', level: 'FOREIGN_PRO', levelRank: null, affiliated: false, league: 'Mexican League', organization: null })]
  const later = extractGameAppearances(hittingLog([
    { date: '2021-04-01', teamId: 456, teamName: 'Great Lakes Loons' },
  ]), 'hitting')
  const skip = buildExactDateCandidates({ stints: foreignFirst, milestones: [], appearances: later })
  assert.deepEqual(skip.newMilestones, [])
})
