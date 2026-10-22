// 051 (audited no-MLB development coverage): the cohort rules as pure functions and the committed research artifacts. No database. The database
// behaviour (the cohort reproduced from the canonical chain, the verifier check, no probability leakage) is proven in tests/db/research-051.test.mjs.
//   NO MLB OUTCOME != NO DEVELOPMENT   AUDITED NO MLB != CAREER FAILURE   HIGHEST LEVEL != COMPLETE DEVELOPMENT HISTORY
//   LAST OBSERVED SEASON != CAREER END   MISSING SEASON != NO SEASON PLAYED   FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON
//   UNKNOWN ORGANIZATION != DODGERS   SEASON PRECISION != DAY PRECISION   POST-CONTROL AFFILIATED PLAY != DODGERS DEVELOPMENT

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditedNoMlbCohort, auditedNoMlbCoverage, careerSegments, exactDateCoverage, historyCoverage, DODGERS_ORGANIZATION,
} from '../../lib/research/history-coverage.js'
import { developmentRecords, firstProSeasonStatus } from '../../lib/research/development-research.js'
import { developmentNeeds } from '../../lib/research/development-needs.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/051', f), 'utf8'))

const LAD = DODGERS_ORGANIZATION
const stint = (season, level, organization_name = LAD, extra = {}) => ({ season, level, organization_name, stint_kind: 'TEAM_STINT', affiliate_team: `${level} ${season}`, ...extra })
const signing = (id, status, extra = {}) => ({ player_id: id, player_slug: id, full_name: id, signing_id: `s-${id}`, signing_year: 2015, pathway: 'LATAM_AMATEUR', outcome_audit_status: status,
  reached_mlb_verified: status === 'VERIFIED_MLB' ? true : status === 'VERIFIED_NO_MLB' ? false : null, ...extra })

test('cohort: exactly the VERIFIED_NO_MLB audits; NOT_AUDITED and verified MLB are excluded', () => {
  const s = [signing('a', 'VERIFIED_NO_MLB'), signing('b', 'NOT_AUDITED'), signing('c', 'VERIFIED_MLB'), signing('d', 'VERIFIED_NO_MLB')]
  assert.deepEqual(auditedNoMlbCohort(s).map((x) => x.player_id), ['a', 'd'])
  assert.deepEqual(auditedNoMlbCohort([]), [])
})

test('missing season stays unknown; the cancelled 2020 season is explained by the league, not queued', () => {
  const gap = historyCoverage({ signing_year: 2015, mlb_debut_date: null }, [stint(2016, 'INTERNATIONAL_ROOKIE'), stint(2018, 'LOW_A')])
  assert.deepEqual(gap.gaps.map((g) => [g.code, g.seasons]), [['NO_EVIDENCE_FOUND', [2017]]])
  const y2020 = historyCoverage({ signing_year: 2018, mlb_debut_date: null }, [stint(2019, 'INTERNATIONAL_ROOKIE'), stint(2021, 'LOW_A')])
  assert.deepEqual(y2020.gaps, [])
  assert.deepEqual(y2020.notes.map((n) => [n.code, n.seasons]), [['LEAGUE_SEASON_NOT_PLAYED', [2020]]])
  assert.equal(y2020.state, 'NO_OPEN_GAP')
})

test('first observed season is not the first professional season; a prior professional route stays separate', () => {
  assert.equal(firstProSeasonStatus({ signing_year: 2015, pathway: 'LATAM_AMATEUR' }, { professional_debut_season: 2017 }), 'FIRST_OBSERVED_ONLY')
  assert.equal(firstProSeasonStatus({ signing_year: 2015, pathway: 'LATAM_AMATEUR' }, { professional_debut_season: 2016 }), 'KNOWN')
  assert.equal(firstProSeasonStatus({ signing_year: 2015, pathway: 'CUBAN_PRO' }, { professional_debut_season: 2016 }), 'PRIOR_PROFESSIONAL_CAREER')
  // the 048 rule is applied exactly: a 2019 signing first observed in 2021 is FIRST_OBSERVED_ONLY even though 2020 was not played (051 reports it, never changes it)
  assert.equal(firstProSeasonStatus({ signing_year: 2019, pathway: 'LATAM_AMATEUR' }, { professional_debut_season: 2021 }), 'FIRST_OBSERVED_ONLY')
})

test('no affiliated record stays unknown: no level, no season, no invented rookie year', () => {
  const seg = careerSegments([])
  assert.equal(seg.highest_level_whole_career, null)
  assert.equal(seg.highest_level_at_dodgers_affiliate, null)
  assert.equal(seg.last_observed_affiliated, null)
  assert.equal(firstProSeasonStatus({ signing_year: 2021, pathway: 'LATAM_AMATEUR' }, {}), 'NO_AFFILIATED_RECORD')
  assert.deepEqual(historyCoverage({ signing_year: 2021, mlb_debut_date: null }, []).gaps.map((g) => g.code), ['SOURCE_UNAVAILABLE'])
})

test('a later stint with another organization is not Dodgers development; the highest level is reported for each part', () => {
  const seg = careerSegments([stint(2014, 'INTERNATIONAL_ROOKIE'), stint(2015, 'COMPLEX_ROOKIE'), stint(2017, 'OTHER', LAD, { level_classification: 'UNKNOWN_ROOKIE_LEAGUE' }),
    stint(2018, 'LOW_A', 'Cincinnati Reds'), stint(2022, 'AAA', 'Atlanta Braves')])
  assert.deepEqual(seg.highest_level_whole_career, { level: 'AAA', season: 2022 })
  assert.deepEqual(seg.highest_level_at_dodgers_affiliate, { level: 'COMPLEX_ROOKIE', season: 2015 })
  assert.equal(seg.highest_level_reached_elsewhere, true)
  assert.deepEqual(seg.dodgers_affiliate_seasons, [2014, 2015, 2017])
  assert.deepEqual(seg.other_organization_seasons, [2018, 2022])
  assert.deepEqual(seg.other_organizations, ['Atlanta Braves', 'Cincinnati Reds'])
  // a Pioneer League (rookie-advanced) stint is on record but cannot be placed on the ladder: reported, never ranked
  assert.deepEqual(seg.unplaceable_level_seasons, [2017])
})

test('an unknown organization is never Dodgers; foreign professional seasons are kept apart', () => {
  const seg = careerSegments([stint(2016, 'LOW_A'), stint(2017, 'HIGH_A', null), stint(2018, 'FOREIGN_PRO', null, { league_name: 'Mexican League' })])
  assert.deepEqual(seg.dodgers_affiliate_seasons, [2016])
  assert.deepEqual(seg.unknown_organization_seasons, [2017])
  assert.deepEqual(seg.foreign_pro_seasons, [2018])
  assert.deepEqual(seg.foreign_pro_leagues, ['Mexican League'])
  assert.deepEqual(seg.highest_level_at_dodgers_affiliate, { level: 'LOW_A', season: 2016 })
  // the last observed AFFILIATED record is not the last season played, and never a release
  assert.deepEqual(seg.last_observed_affiliated, { season: 2017, teams: ['HIGH_A 2017'], organizations: ['UNKNOWN_ORGANIZATION'], last_game_date: null })
})

test('season precision never becomes a date; exact dates need game-log evidence', () => {
  const rows = [stint(2015, 'LOW_A', LAD, { first_game_date: '2015-04-09', last_game_date: '2015-09-01' }), stint(2016, 'HIGH_A'), stint(2005, 'AA')]
  assert.deepEqual(exactDateCoverage(rows), { log_era_stints: 2, dated: 1, undated: 1, undated_foreign_pro: 0 })
  assert.equal(careerSegments(rows).last_observed_affiliated.last_game_date, null)
  assert.equal(careerSegments(rows.slice(0, 1)).last_observed_affiliated.last_game_date, '2015-09-01')
  // a season total repeats its team rows and is never counted as a stint
  assert.equal(exactDateCoverage([{ ...rows[1], stint_kind: 'SEASON_TOTAL' }]).log_era_stints, 0)
})

test('an MLB stint or an MLB_DEBUT milestone on a VERIFIED_NO_MLB player is a contradiction, never a silent change', () => {
  const data = {
    signings: [signing('x', 'VERIFIED_NO_MLB'), signing('y', 'VERIFIED_NO_MLB'), signing('z', 'VERIFIED_NO_MLB')],
    developmentSummary: [], developmentQueue: [], progressionDecisions: [], exitSummary: [],
    milestones: [{ player_id: 'y', event_code: 'MLB_DEBUT' }],
  }
  const stints = new Map([['x', [stint(2019, 'MLB')]], ['z', [stint(2019, 'AA')]]])
  const cov = auditedNoMlbCoverage(data, stints, developmentRecords, developmentNeeds)
  assert.deepEqual(cov.contradictions, ['x', 'y'])
})

test('coverage: denominators, the two highest-level questions and the 2020-only season gaps', () => {
  const data = {
    signings: [signing('a', 'VERIFIED_NO_MLB', { signing_year: 2018 }), signing('b', 'VERIFIED_NO_MLB'), signing('c', 'NOT_AUDITED'), signing('d', 'VERIFIED_NO_MLB', { signing_year: 2021 })],
    developmentSummary: [{ player_id: 'a', highest_affiliated_level: 'AAA', professional_debut_season: 2019 }, { player_id: 'b', highest_affiliated_level: 'LOW_A', professional_debut_season: 2016 }],
    developmentQueue: [{ player_id: 'a', issue: 'SEASON_GAP', priority: 2 }, { player_id: 'd', issue: 'IDENTITY_BUT_NO_PROFESSIONAL_SEASONS', priority: 3 }],
    progressionDecisions: [], exitSummary: [{ player_id: 'a', control_state: 'LEFT_DODGERS_CONTROL' }], milestones: [],
  }
  const stints = new Map([
    ['a', [stint(2019, 'INTERNATIONAL_ROOKIE'), stint(2021, 'HIGH_A'), stint(2022, 'AAA', 'Toronto Blue Jays')]],
    ['b', [stint(2016, 'INTERNATIONAL_ROOKIE'), stint(2017, 'LOW_A')]],
  ])
  const cov = auditedNoMlbCoverage(data, stints, developmentRecords, developmentNeeds)
  assert.equal(cov.players, 3)
  assert.deepEqual(cov.any_development_history, { n: 2, of: 3 })
  assert.deepEqual(cov.highest_level_known, { n: 2, of: 3, unresolved: ['d'] })
  assert.deepEqual(cov.highest_level_whole_career, { LOW_A: 1, AAA: 1 })
  assert.deepEqual(cov.highest_level_at_dodgers_affiliate, { LOW_A: 1, HIGH_A: 1 })
  assert.deepEqual(cov.highest_level_reached_elsewhere, { n: 1, of: 3, players: ['a'] })
  assert.deepEqual(cov.season_gap_only_league_not_played, { n: 1, of: 1 })
  assert.deepEqual(cov.no_structured_affiliated_record, { n: 1, of: 3, players: ['d'] })
  assert.deepEqual(cov.rows.map((r) => r.player_slug), ['b', 'a', 'd'])
  assert.deepEqual(cov.rows.find((r) => r.player_slug === 'd').needs, ['SEASON_COVERAGE'])
})

test('artifact: the derived cohort is the 46 audited no-MLB players, with the two unresolved highest levels named', () => {
  const cohort = read('cohort.json')
  const baseline = read('baseline.json')
  assert.equal(cohort.players.length, 46)
  assert.equal(new Set(cohort.players.map((p) => p.player_slug)).size, 46)
  assert.deepEqual(baseline.outcome_audit_status, { VERIFIED_MLB: 47, VERIFIED_NO_MLB: 46, NOT_AUDITED: 127 })
  assert.deepEqual(cohort.players.filter((p) => p.highest_level_recorded === 'UNKNOWN').map((p) => p.player_slug).sort(), ['damaso-marte-jr', 'sebastian-jimenez'])
  assert.ok(cohort.players.every((p) => !p.contradiction))
  assert.ok(cohort.players.every((p) => p.highest_level_recorded !== 'MLB'))
  // a highest level reached with another organization is reported apart, never as Dodgers development
  assert.deepEqual(cohort.players.filter((p) => p.highest_level_reached_elsewhere).map((p) => p.player_slug).sort(),
    ['alex-de-jesus', 'carlos-rincon', 'elio-campos', 'hendrik-clementina', 'julian-leon', 'rayne-doncon', 'ronny-brito'])
})

test('artifact: the official source holds no fact DISI lacks for this cohort, and nothing disagrees', () => {
  const { totals, players, organization_seasons: org } = read('development-records.json')
  assert.equal(totals.cohort_players, 46)
  assert.equal(totals.source_stints, totals.on_record_stints)
  assert.equal(totals.reviewed_facts_disi_lacks, 0)
  assert.equal(totals.disagreements, 0)
  assert.equal(players.length, 46)
  // the undated log-era stints are explained, never filled
  assert.ok(players.flatMap((p) => p.game_dates.undated).every((u) => u.reason.length > 20))
  // every two-organization season is checked against the recorded exit; none is inconsistent
  assert.ok(org.length > 0 && org.every((o) => o.state !== 'INCONSISTENT_WITH_RECORDED_EXIT'))
  const cov = read('coverage-before-after.json')
  assert.equal(cov.canonical_rows_written, 0)
  assert.deepEqual(cov.before, cov.after)
})

test('artifact: no new progression review is created; every cohort inversion is covered by a 024 decision', () => {
  const p = read('progression-review.json')
  assert.equal(p.new_reviews_created, 0)
  assert.ok(p.inversions.length > 0)
  assert.ok(p.inversions.every((i) => i.decisions.length > 0 && !i.open_in_queue))
  assert.ok(p.pending_decisions.every((d) => d.confidence === 'LOW'))
})

test('artifact: needs are reported as detector rows and de-duplicated evidence gaps, by the 048 groups', () => {
  const n = read('needs-before-after.json')
  const c = n.before.audited_no_mlb_cohort
  assert.ok(c.detector_rows >= c.distinct_needs)
  assert.deepEqual(Object.keys(c.by_need).sort(), ['GAME_DATES', 'LEVEL_CLASSIFICATION', 'ORGANIZATION', 'SEASON_COVERAGE', 'SEQUENCE_REVIEW', 'SOURCE_CONFLICT'])
  assert.deepEqual(n.before, n.after)
  const m = read('source-manifest.json')
  assert.match(m.policy, /Official MLB Stats API only/)
  assert.ok(m.not_used.some((x) => /Baseball-Reference/.test(x)))
})
