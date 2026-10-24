// 052 (development taxonomy and chronology resolution): the chronology rules as pure functions and the committed research artifacts. No database.
// The migration itself (apply, rerun, rollback, reapply, the detector matching these rules, isolation) is proven in tests/db/research-052.test.mjs.
//   HISTORICAL LEAGUE LABEL != MODERN LEVEL   AFFILIATE NAME != ORGANIZATION WITHOUT SEASON CONTEXT   LEAGUE SEASON NOT PLAYED != MISSING PLAYER SEASON
//   MULTI-ORG SEASON != DATA ERROR   TEAM CHANGE != CANONICAL TRANSACTION   TRANSACTION DATE != FIRST APPEARANCE DATE   SEASON GAP != DID NOT PLAY
//   SEASON PRECISION != DAY PRECISION   PENDING REVIEW != NEGATIVE DEVELOPMENT EVENT   SOURCE-LIMITED != RESEARCH FAILURE

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GAP_CLASS, MINOR_LEAGUE_SEASONS_NOT_PLAYED, gapClassCounts, multiOrganizationClass, multiOrganizationSeasons, needCauses, seasonGaps,
  seasonNotPlayedExplains, undatedStints,
} from '../../lib/research/development-chronology.js'
import { careerSegments } from '../../lib/research/history-coverage.js'
import { HISTORY_QUERIES } from '../../lib/research/dataset.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/052', f), 'utf8'))

const minor = (season, level = 'LOW_A', extra = {}) => ({ season, level, affiliated: true, stint_kind: 'TEAM_STINT', organization_name: 'Los Angeles Dodgers', organization_abbreviation: 'LAD', ...extra })
const mlb = (season, extra = {}) => minor(season, 'MLB', extra)
const foreign = (season) => ({ season, level: 'FOREIGN_PRO', affiliated: false, stint_kind: 'TEAM_STINT', organization_name: null })

test('2020: an affiliated minor leaguer\'s missing 2020 is the league\'s, not the player\'s; other missing seasons stay open', () => {
  assert.deepEqual(MINOR_LEAGUE_SEASONS_NOT_PLAYED, [2020])
  const g = seasonGaps([minor(2019, 'INTERNATIONAL_ROOKIE'), minor(2021)])
  assert.deepEqual(g.missing, [{ season: 2020, cause: 'LEAGUE_SEASON_NOT_PLAYED' }])
  assert.deepEqual(g.open, [])
  // 2019 was played: it stays open beside the explained 2020 (Andy Pages' shape)
  const pages = seasonGaps([minor(2018, 'COMPLEX_ROOKIE'), minor(2021, 'HIGH_A')])
  assert.deepEqual(pages.open, [2019])
  assert.deepEqual(pages.explained, [2020])
})

test('2020: leagues that did play are never suppressed (a major leaguer, a foreign professional, a player with no record before)', () => {
  // the 2020 major-league season was played: a player with a major-league stint by 2020 has a genuine gap
  assert.equal(seasonNotPlayedExplains([mlb(2019), mlb(2021)], 2020), false)
  assert.deepEqual(seasonGaps([minor(2018, 'AAA'), mlb(2019), mlb(2021)]).open, [2020])
  // a debut after 2020 (Oneil Cruz, MLB in 2021) does not stop 2020 from being the league's
  assert.equal(seasonNotPlayedExplains([minor(2019, 'AA'), mlb(2021)], 2020), true)
  // the last season before is foreign professional play (NPB and KBO played 2020): open
  assert.equal(seasonNotPlayedExplains([foreign(2019), minor(2021)], 2020), false)
  // the last season before is a mix of minor and major-league play: open
  assert.equal(seasonNotPlayedExplains([minor(2019, 'AAA'), mlb(2019), minor(2021, 'AAA')], 2020), false)
  // only 2020 is ever explained
  assert.equal(seasonNotPlayedExplains([minor(2016), minor(2018)], 2017), false)
})

test('season gaps name their cause and never read "did not play"', () => {
  const g = seasonGaps([minor(1952, 'MLB'), minor(1954, 'MLB'), minor(2005, 'AAA'), foreign(2007), minor(2010), minor(2012)])
  const cause = Object.fromEntries(g.missing.map((m) => [m.season, m.cause]))
  assert.equal(cause[1953], 'BEFORE_STRUCTURED_MINOR_LEAGUE_RECORDS')
  assert.equal(cause[2006], 'ADJACENT_TO_FOREIGN_PROFESSIONAL_PLAY')
  assert.equal(cause[2011], 'NO_RECORD_IN_OFFICIAL_SOURCE')
  assert.ok(!g.missing.some((m) => /NOT_PLAY|DID_NOT/.test(m.cause) && m.cause !== 'LEAGUE_SEASON_NOT_PLAYED'))
})

const trade = (date, from = 'LAD', to = 'CWS') => ({ transaction_date: date, from_organization: from, to_organization: to, transaction_type: 'TRADE', event_key: `T_${date}` })
const cws = (extra) => minor(2023, 'LOW_A', { organization_name: 'Chicago White Sox', organization_abbreviation: 'CWS', ...extra })

test('a multi-organization season is bracketed only by a canonical transaction with game dates on both sides; the three dates stay three facts', () => {
  const st = [minor(2023, 'COMPLEX_ROOKIE', { first_game_date: '2023-06-05', last_game_date: '2023-07-29' }), cws({ first_game_date: '2023-08-09', last_game_date: '2023-09-06' })]
  const [m] = multiOrganizationSeasons(st, [trade('2023-08-04')])
  assert.equal(m.state, 'BRACKETED')
  assert.deepEqual(m.transaction, { event_key: 'T_2023-08-04', date: '2023-08-04', type: 'TRADE', from: 'Los Angeles Dodgers', to: 'Chicago White Sox' })
  assert.deepEqual(m.segments.map((g) => [g.organization, g.first_appearance, g.last_appearance]),
    [['Los Angeles Dodgers', '2023-06-05', '2023-07-29'], ['Chicago White Sox', '2023-08-09', '2023-09-06']])
  // the post-trade stint stays separate; nothing is merged or moved
  assert.equal(m.segments.length, 2)
})

test('a team change is never a transaction; missing dates and contradicting dates stay open', () => {
  const dated = [minor(2023, 'COMPLEX_ROOKIE', { first_game_date: '2023-06-05', last_game_date: '2023-07-29' }), cws({ first_game_date: '2023-08-09', last_game_date: '2023-09-06' })]
  assert.equal(multiOrganizationSeasons(dated, [])[0].state, 'NO_CANONICAL_TRANSACTION')
  // a release is not a move to the second organization: 053 reads it as the Dodgers end of the move only, never as a trade into the other club
  const released = multiOrganizationSeasons(dated, [{ ...trade('2023-08-04'), to_organization: null, transaction_type: 'RELEASE' }])[0]
  assert.equal(released.state, 'BRACKETED_AT_DODGERS_BOUNDARY')
  assert.equal(released.transaction.type, 'RELEASE')
  assert.equal(multiOrganizationSeasons(dated, [trade('2023-07-01')])[0].state, 'DATES_DO_NOT_BRACKET_TRANSACTION')
  const undated = [minor(2023, 'COMPLEX_ROOKIE'), cws({})]
  assert.equal(multiOrganizationSeasons(undated, [trade('2023-08-04')])[0].state, 'TRANSACTION_RECORDED_DATES_MISSING')
  const old = [minor(1997, 'MLB'), minor(1997, 'MLB', { organization_name: 'Colorado Rockies', organization_abbreviation: 'COL' })]
  assert.equal(multiOrganizationSeasons(old, [trade('1997-08-19', 'LAD', 'COL')])[0].state, 'TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS')
  // an unknown organization is not an organization: it never makes a season multi-organization
  assert.deepEqual(multiOrganizationSeasons([minor(2023), minor(2023, 'HIGH_A', { organization_name: null, organization_abbreviation: null })], []), [])
  assert.equal(multiOrganizationClass('NO_CANONICAL_TRANSACTION'), 'TRANSACTION_BLOCKED')
  assert.equal(multiOrganizationClass('TRANSACTION_RECORDED_DATES_BEFORE_GAME_LOGS'), 'SOURCE_LIMITED')
  assert.equal(multiOrganizationClass('BRACKETED'), 'NOT_A_GAP')
})

test('game dates: undated log-era stints keep NULL and a cause; foreign professional play is source-limited, never given MiLB dates', () => {
  const u = undatedStints([minor(2018, 'AAA'), { ...foreign(2018), affiliate_team: 'Toros de Tijuana' }, minor(2005, 'AA'), minor(2019, 'AA', { first_game_date: '2019-04-04', last_game_date: '2019-09-02' })])
  assert.deepEqual(u.map((x) => [x.season, x.level, x.cause]), [[2018, 'AAA', 'GAME_LOG_RETURNS_NO_GAMES'], [2018, 'FOREIGN_PRO', 'FOREIGN_PROFESSIONAL_LEAGUE_OUTSIDE_GAME_LOG']])
  // a pre-log-era stint is not a missing date at all
  assert.ok(!u.some((x) => x.season < 2006))
})

test('need causes: each open need gets exactly one class, and every class is counted even when zero', () => {
  const needs = [
    { player_id: 'a', player_slug: 'a', need: 'SEASON_COVERAGE', issues: ['SEASON_GAP'] },
    { player_id: 'b', player_slug: 'b', need: 'LEVEL_CLASSIFICATION', issues: ['UNKNOWN_LEVEL_CLASSIFICATION'] },
    { player_id: 'c', player_slug: 'c', need: 'SEQUENCE_REVIEW', issues: ['LEVEL_SKIP_CAMEO_CANDIDATE'] },
    { player_id: 'd', player_slug: 'd', need: 'ORGANIZATION', issues: ['MULTI_ORG_SEASON_UNVERIFIED'] },
  ]
  const stints = {
    a: [minor(2019, 'INTERNATIONAL_ROOKIE'), minor(2021)],
    b: [minor(2015, 'OTHER', { level_classification: 'UNKNOWN_ROOKIE_LEAGUE', league_name: 'Pioneer League', affiliated: false })],
    c: [], d: [minor(2023, 'COMPLEX_ROOKIE'), cws({})],
  }
  const rows = needCauses(needs, (p) => stints[p], () => [], () => [])
  assert.deepEqual(rows.map((r) => [r.player_slug, r.gap_class]), [['a', 'NOT_A_GAP'], ['b', 'TAXONOMY_GAP'], ['c', 'HUMAN_REVIEW'], ['d', 'TRANSACTION_BLOCKED']])
  for (const r of rows) assert.ok(r.cause && r.closes_with)
  const counts = gapClassCounts(rows)
  assert.deepEqual(Object.keys(counts), Object.keys(GAP_CLASS))
  assert.equal(counts.IDENTITY_BLOCKED, 0)
})

test('highest level is still two questions: a resolved organization moves only the Dodgers-affiliate figure (Santana 2006)', () => {
  const before = [minor(2006, 'HIGH_A', { organization_name: null }), minor(2007, 'LOW_A'), minor(2008, 'AA', { organization_name: 'Cleveland Guardians' }), mlb(2010, { organization_name: 'Cleveland Guardians' })]
  const after = before.map((s) => (s.season === 2006 ? { ...s, organization_name: 'Los Angeles Dodgers' } : s))
  assert.equal(careerSegments(before).highest_level_at_dodgers_affiliate.level, 'LOW_A')
  assert.equal(careerSegments(after).highest_level_at_dodgers_affiliate.level, 'HIGH_A')
  assert.deepEqual(careerSegments(after).highest_level_whole_career, careerSegments(before).highest_level_whole_career)
  assert.equal(careerSegments(after).highest_level_reached_elsewhere, true)
})

test('the history read carries what 052 keys on (stint id, team id, abbreviation) and the transactions it checks against', () => {
  assert.match(HISTORY_QUERIES.stints, /stint_id/)
  assert.match(HISTORY_QUERIES.stints, /organization_abbreviation/)
  assert.match(HISTORY_QUERIES.stintKeys, /team_id/)
  assert.match(HISTORY_QUERIES.transactions, /from v_player_transactions/)
  assert.match(HISTORY_QUERIES.organizations, /from organizations/)
  for (const sql of Object.values(HISTORY_QUERIES)) assert.doesNotMatch(sql, /\b(insert|update|delete|alter|create|drop)\b/i)
})

// ---- the committed artifacts --------------------------------------------------------------------------------------------------------------

test('artifacts: every organization assignment is season-bounded official evidence; three corrections; one co-op club stays unresolved', () => {
  const a = read('affiliate-organization-research.json')
  assert.deepEqual(a.by_state, { CORRECTED_BY_052: 3, MATCHES_OFFICIAL_RECORD: 1383, NO_MLB_PARENT: 1, RESOLVED_BY_052: 319 })
  assert.equal(a.team_season_errors, 0)
  assert.deepEqual(a.corrections.map((c) => [c.slug, c.season, c.recorded, c.official]), [
    ['antonio-osuna', 2005, 'Houston Astros', 'Washington Nationals'], ['chan-ho-park', 2007, 'Houston Astros', 'New York Mets'], ['pedro-astacio', 2006, 'Houston Astros', 'Washington Nationals']])
  const v = read('migration-values.json')
  for (const o of v.organizations) {
    assert.equal(o.evidence.season, o.season)
    assert.equal(o.evidence.teamId, o.team_id)
    assert.ok(o.evidence.url.includes(`/teams/${o.team_id}?season=${o.season}`))
    // the Dodgers organization only where the record names the Dodgers
    assert.equal(o.organization_name === 'Los Angeles Dodgers' || o.organization_name === 'Brooklyn Dodgers', o.evidence.parentOrgId === 119)
  }
  assert.equal(a.no_mlb_parent[0].official_parent.id, 11)
})

test('artifacts: the Pioneer League is classified per season by the official sport; no stint is placed on the ladder', () => {
  const u = read('unclassified-levels.json')
  assert.equal(u.team_stints, 41)
  assert.deepEqual(Object.keys(u.by_league), ['Pioneer League'])
  assert.deepEqual(u.by_official_sport, { '16:Rookie': 41 })
  const sport = Object.fromEntries(u.official_pioneer_league_sport_by_season.map((r) => [r.season, r.sport_id]))
  assert.equal(sport[1988], 16)
  assert.equal(sport[2018], 16)
  assert.equal(sport[2019], 5442)
  assert.equal(sport[2021], 23)
  const v = read('migration-values.json')
  assert.deepEqual(v.era_map.map((e) => [e.era, e.maps_to]), [['PRE_ACADEMY_1960_1988', 'OTHER'], ['DSL_AZL_2017_2020', 'OTHER'], ['MODERN_FOUR_LEVEL_2021_PLUS', 'INDEPENDENT']])
  assert.ok(!v.era_map.some((e) => e.maps_to === 'COMPLEX_ROOKIE'))
})

test('artifacts: dates only from the game log, never overwritten; professional debuts only for amateur signings with a first-season record', () => {
  const g = read('game-date-research.json')
  assert.equal(g.errors, 0)
  assert.equal(g.stints_by_state.CONFLICT, undefined)
  assert.deepEqual(g.stints_by_state, { FILLED_BY_052: 528, FOREIGN_PROFESSIONAL_NO_LOG: 6, MATCHES: 32 })
  assert.equal(g.milestone_season_to_day_upgrades, 101)
  const v = read('migration-values.json')
  for (const d of v.stint_dates) {
    assert.ok(d.source_url.includes('stats=gameLog'))
    assert.ok(d.first_game_date.startsWith(String(d.season)) && d.last_game_date.startsWith(String(d.season)))
    assert.ok(d.first_game_date <= d.last_game_date)
  }
  for (const u of v.milestone_upgrades) assert.ok(u.milestone_date.startsWith(String(u.season_year)))
  assert.equal(v.professional_debuts.length, 11)
  const rejected = Object.fromEntries(g.professional_debuts_not_dated.map((r) => [r.slug, r.reason.split(' ')[0].replace(':', '')]))
  for (const s of ['hyun-jin-ryu', 'roki-sasaki', 'julio-urias', 'yasiel-puig', 'yordan-alvarez', 'yusniel-diaz']) assert.equal(rejected[s], 'PRIOR_PROFESSIONAL_CAREER')
  for (const s of ['elian-herrera', 'ramon-rosso']) assert.equal(rejected[s], 'FIRST_OBSERVED_ONLY')
  // the 2006 window is not a disagreement: no source conflict is recorded
  assert.equal(g.pipeline_window_artifacts.count, 9)
})

test('artifacts: the exposed sequences are pending reviews, never decided', () => {
  const v = read('migration-values.json')
  assert.deepEqual(v.progression_reviews.map((r) => `${r.slug}:${r.event_code}`),
    ['elian-herrera:A_DEBUT', 'elian-herrera:HIGH_A_DEBUT', 'pedro-baez:AAA_DEBUT', 'ramon-troncoso:AAA_DEBUT', 'roki-sasaki:AAA_DEBUT'])
  for (const r of v.progression_reviews) assert.match(r.notes, /is not decided/)
  const s = read('sequence-review.json')
  assert.equal(s.automatic_interpretive_decisions, 0)
  assert.equal(s.resolved_by_objective_evidence, 0)
})

test('artifacts: every reduction has a reason; nothing is reduced by merging; FACT_MISSING is closed and the rest is classified', () => {
  const n = read('needs-before-after.json')
  assert.deepEqual([n.before.detector_rows, n.before.distinct_needs, n.before.affected_players], [347, 173, 85])
  assert.deepEqual([n.after.detector_rows, n.after.distinct_needs, n.after.affected_players], [134, 110, 66])
  assert.equal(n.new_needs.length, 0)
  for (const r of n.resolved_needs) assert.ok(r.class_before && r.reason, `${r.player_slug} ${r.need}`)
  assert.equal(n.resolved_needs.length, 173 - 110)
  const g = read('gap-classification.json')
  assert.equal(Object.values(g.before.counts).reduce((a, b) => a + b, 0), 173)
  assert.equal(Object.values(g.after.counts).reduce((a, b) => a + b, 0), 110)
  assert.equal(g.after.counts.FACT_MISSING, 0)
  assert.equal(g.after.counts.NOT_A_GAP, 0)
  assert.equal(g.after.by_need.LEVEL_CLASSIFICATION.TAXONOMY_GAP, 26)
  assert.equal(g.after.by_need.SEQUENCE_REVIEW.HUMAN_REVIEW, 5)
  const s = read('season-gaps-2020.json')
  assert.equal(s.affiliated_minor_league_stints_recorded_for_2020, 0)
  for (const r of s.official_schedules.filter((x) => x.season === 2020 && x.sport_id !== 1)) assert.equal(r.regular_season_games, 0)
  assert.ok(s.official_schedules.find((x) => x.season === 2020 && x.sport_id === 1).regular_season_games > 0)
})

test('artifacts: the highest-level distributions of the audited no-MLB cohort are unchanged; two players move at a Dodgers affiliate', () => {
  const h = read('highest-level-before-after.json')
  assert.deepEqual(h.audited_no_mlb_cohort.whole_career_after, h.audited_no_mlb_cohort.whole_career_before)
  assert.deepEqual(h.audited_no_mlb_cohort.at_dodgers_affiliate_after, h.audited_no_mlb_cohort.at_dodgers_affiliate_before)
  assert.deepEqual(h.all_dodgers_signings.whole_career_after, h.all_dodgers_signings.whole_career_before)
  assert.deepEqual(h.changed_players.map((c) => [c.player_slug, c.at_dodgers_affiliate.before, c.at_dodgers_affiliate.after]),
    [['carlos-santana', 'LOW_A (2007)', 'HIGH_A (2006)'], ['jorbit-vivas', 'AA (2023)', 'AAA (2023)']])
})
