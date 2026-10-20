// DISI 048 research tooling: verified MLB development coverage, first observed vs first professional season, the documented path, the de-duplicated
// development queue and the progression-review packet. The distinctions under test are core DISI principles:
//   UNKNOWN DEVELOPMENT HISTORY != NO DEVELOPMENT     MISSING SEASON != NO SEASON PLAYED     PARTIAL HISTORY != NO HISTORY
//   FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON     POST-MLB MINOR-LEAGUE STINT != DEVELOPMENTAL ARRIVAL
//   AMBIGUOUS LEVEL SEQUENCE != CANONICAL LEVEL DEBUT
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  DEVELOPMENT_TIERS, FIRST_RECORD_MAX_GAP_SEASONS, PROFESSIONAL_PATHWAYS, developmentDimensions, developmentQueue, developmentRecords, firstProSeasonKnown,
  firstProSeasonStatus, isProfessionalPathway, timingFacts,
} from '../../lib/research/development-research.js'
import { HISTORY_GAP, LEAGUE_SEASON_NOT_PLAYED, historyCoverage, verifiedMlbCoverage } from '../../lib/research/history-coverage.js'
import { NEED_GROUPS, developmentNeedSummary, developmentNeeds, needGroup } from '../../lib/research/development-needs.js'
import { LADDER, progressionReviewPacket, renderReviewPacket } from '../../lib/research/progression-review.js'
import { DATASET_QUERIES, HISTORY_QUERIES, assembleDataset } from '../../lib/research/dataset.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let seq = 0
const sign = (over = {}) => {
  seq += 1
  const id = String(seq).padStart(4, '0')
  return {
    signing_id: `s-${id}`, player_id: `p-${id}`, player_slug: `player-${id}`, full_name: `Player ${id}`, player_sort_name: `Player ${id}`,
    signing_year: 2010, signing_date: '2010-07-02', country_market: 'Dominican Republic', pathway: 'LATAM_AMATEUR', outcome_audit_status: 'NOT_AUDITED',
    reached_mlb_verified: null, mlb_debut_date: null, ...over,
  }
}
const stint = (season, level, over = {}) => ({ season, level, stint_kind: 'TEAM_STINT', organization_name: 'Los Angeles Dodgers', level_classification: 'SPORT_ID_13', affiliated: true, ...over })

// ---- first OBSERVED season != first PROFESSIONAL season -----------------------------------------------------------------------

test('first observed season is not the first professional season: a record that starts two or more seasons after signing is only the first observed record', () => {
  assert.equal(FIRST_RECORD_MAX_GAP_SEASONS, 1)
  const s = sign({ signing_year: 1985 })
  assert.equal(firstProSeasonStatus(s, { first_a_season: 1986 }), 'KNOWN')
  assert.equal(firstProSeasonStatus(s, { first_a_season: 1988 }), 'FIRST_OBSERVED_ONLY', 'signed 1985, the API begins in 1988: 1988 is not the first professional season')
  assert.equal(firstProSeasonKnown(s, { first_a_season: 1988 }), false)
  assert.equal(firstProSeasonStatus(s, {}), 'NO_AFFILIATED_RECORD')
  assert.equal(firstProSeasonStatus(s, null), 'NO_AFFILIATED_RECORD')
  const dims = developmentDimensions({ signing: s, summary: { first_a_season: 1988 }, decision: null })
  assert.equal(dims.FIRST_PRO_SEASON, 'UNKNOWN')
})

test('an established professional\'s first affiliated season is never his first professional season, even one season after signing', () => {
  assert.deepEqual([...PROFESSIONAL_PATHWAYS].sort(), ['CUBAN_PRO', 'JAPAN_PRO', 'KOREA_PRO', 'MEXICAN_LEAGUE_TRANSFER', 'POSTED_PLAYER'])
  for (const pathway of PROFESSIONAL_PATHWAYS) {
    const s = sign({ pathway, signing_year: 2012 })
    assert.equal(isProfessionalPathway(pathway), true)
    assert.equal(firstProSeasonStatus(s, { first_complex_season: 2012 }), 'PRIOR_PROFESSIONAL_CAREER', pathway)
    assert.equal(firstProSeasonStatus(s, { first_a_season: 2013 }), 'PRIOR_PROFESSIONAL_CAREER', pathway)
    assert.equal(developmentDimensions({ signing: s, summary: { first_complex_season: 2012 }, decision: null }).FIRST_PRO_SEASON, 'UNKNOWN', pathway)
    // no affiliated record at all stays a missing record, not a prior career
    assert.equal(firstProSeasonStatus(s, {}), 'NO_AFFILIATED_RECORD')
  }
  // an amateur pathway, and an UNKNOWN pathway, are not treated as professional
  for (const pathway of ['LATAM_AMATEUR', 'CUBAN_AMATEUR', 'JAPAN_AMATEUR', 'KOREA_AMATEUR', 'OTHER', null, undefined]) {
    assert.equal(isProfessionalPathway(pathway), false, String(pathway))
    assert.equal(firstProSeasonStatus(sign({ pathway, signing_year: 2012 }), { first_complex_season: 2012 }), 'KNOWN', String(pathway))
  }
})

test('the record carries why the first professional season is not established', () => {
  const s = sign({ pathway: 'CUBAN_PRO', signing_year: 2015, reached_mlb_verified: true, outcome_audit_status: 'VERIFIED_MLB', mlb_debut_date: '2022-08-02' })
  const data = { signings: [s], decisions: [], developmentQueue: [], transactionQueue: [], developmentSummary: [{ player_id: s.player_id, first_complex_season: 2016 }], sourceCounts: {} }
  const [r] = developmentRecords(data)
  assert.equal(r.first_pro_status, 'PRIOR_PROFESSIONAL_CAREER')
  assert.equal(r.pathway, 'CUBAN_PRO')
  assert.ok(r.missing.includes('FIRST_PRO_SEASON_UNKNOWN'), 'still a research obligation')
})

// ---- the documented path ----------------------------------------------------------------------------------------------------

test('a missing historical season stays unknown: nothing is filled in, and the gap says WHY the record is silent', () => {
  // signed 1985, the first record is 1988, then 1989 and 1991 (1990 has no record)
  const subject = { signing_year: 1985, mlb_debut_date: '1992-06-01', pathway: 'LATAM_AMATEUR' }
  const rows = [stint(1988, 'LOW_A'), stint(1989, 'HIGH_A'), stint(1991, 'AAA'), stint(1992, 'MLB')]
  const h = historyCoverage(subject, rows)
  assert.equal(h.first_observed_season, 1988)
  assert.equal(h.history_start, 'SOURCE_BEGINS_LATE')
  assert.equal(h.start_gap_seasons, 3)
  const codes = h.gaps.map((g) => g.code)
  assert.ok(codes.includes('SOURCE_BEGINS_LATE') && codes.includes('NO_EVIDENCE_FOUND'))
  assert.deepEqual(h.gaps.find((g) => g.code === 'NO_EVIDENCE_FOUND').seasons, [1990])
  assert.equal(h.state, 'PARTIAL')
  assert.equal(h.pre_mlb_seasons_observed, 3, 'only the seasons with records are counted: 1985-87 and 1990 are not invented')
  assert.ok(!JSON.stringify(h).includes('"1986"'))
})

test('a player the source returns nothing for before the debut is SOURCE_UNAVAILABLE, not a player with no development', () => {
  const h = historyCoverage({ signing_year: 1951, mlb_debut_date: '1952-08-22' }, [stint(1952, 'MLB'), stint(1953, 'MLB')])
  assert.equal(h.history_start, 'NO_PRE_MLB_RECORD')
  assert.deepEqual(h.gaps.map((g) => g.code), ['SOURCE_UNAVAILABLE'])
  assert.equal(h.pre_mlb_seasons_observed, 0)
  assert.equal(h.state, 'PARTIAL')
  assert.ok(HISTORY_GAP.SOURCE_UNAVAILABLE.includes('no structured pre-MLB record'))
})

test('a post-MLB minor-league stint is not part of the pre-MLB path or a developmental arrival', () => {
  const subject = { signing_year: 2010, mlb_debut_date: '2013-05-01' }
  const rows = [stint(2010, 'COMPLEX_ROOKIE'), stint(2011, 'LOW_A'), stint(2012, 'AA'), stint(2013, 'AAA'), stint(2013, 'MLB'), stint(2016, 'COMPLEX_ROOKIE'), stint(2018, 'HIGH_A')]
  const h = historyCoverage(subject, rows)
  assert.equal(h.pre_mlb_seasons_observed, 4, '2016 and 2018 rehabilitation stints are after the debut season')
  assert.equal(h.pre_mlb_stints, 4)
  assert.equal(h.state, 'NO_OPEN_GAP')
  assert.equal(h.gaps.length, 0)
})

test('the 2020 minor-league season was not played: a gap only in 2020 is explained by the league, not queued as an unknown season', () => {
  assert.ok(LEAGUE_SEASON_NOT_PLAYED[2020])
  const subject = { signing_year: 2017, mlb_debut_date: '2022-04-01' }
  const rows = [stint(2018, 'COMPLEX_ROOKIE'), stint(2019, 'LOW_A'), stint(2021, 'AA'), stint(2022, 'MLB')]
  const h = historyCoverage(subject, rows)
  assert.deepEqual(h.gaps.map((g) => g.code), [])
  assert.deepEqual(h.notes.map((n) => n.code), ['LEAGUE_SEASON_NOT_PLAYED'])
  assert.deepEqual(h.notes[0].seasons, [2020])
  // ...but a different missing season is still a gap
  const g = historyCoverage(subject, [stint(2018, 'COMPLEX_ROOKIE'), stint(2021, 'AA'), stint(2022, 'MLB')])
  assert.deepEqual(g.gaps.find((x) => x.code === 'NO_EVIDENCE_FOUND').seasons, [2019])
})

test('a partial chronology stays partial: "NO_OPEN_GAP" is the strongest state and there is no "complete"', () => {
  const clean = historyCoverage({ signing_year: 2010, mlb_debut_date: '2013-05-01' }, [stint(2011, 'COMPLEX_ROOKIE'), stint(2012, 'AA'), stint(2013, 'MLB')])
  assert.equal(clean.state, 'NO_OPEN_GAP')
  for (const v of [clean, historyCoverage({ signing_year: 2010 }, [])]) assert.ok(['NO_OPEN_GAP', 'PARTIAL'].includes(v.state))
  assert.ok(!JSON.stringify(clean).toLowerCase().includes('complete'))
  const noOrg = historyCoverage({ signing_year: 2010, mlb_debut_date: '2013-05-01' }, [stint(2011, 'COMPLEX_ROOKIE', { organization_name: null }), stint(2012, 'AA'), stint(2013, 'MLB')])
  assert.equal(noOrg.state, 'PARTIAL')
  assert.deepEqual(noOrg.gaps.map((g) => g.code), ['ORGANIZATION_UNCLEAR'])
  const unclear = historyCoverage({ signing_year: 2010, mlb_debut_date: '2013-05-01' }, [stint(2011, 'OTHER', { level_classification: 'UNKNOWN_ROOKIE_LEAGUE' }), stint(2012, 'AA'), stint(2013, 'MLB')])
  assert.deepEqual(unclear.gaps.map((g) => g.code), ['LEVEL_UNCLEAR'])
  assert.equal(unclear.first_affiliated_season, 2011, 'an unplaceable rookie league is still a minor-league record')
})

test('season totals repeat their component team stints and are not counted as seasons or stints', () => {
  const rows = [stint(2011, 'LOW_A'), stint(2011, 'LOW_A', { stint_kind: 'SEASON_TOTAL', organization_name: null }), stint(2012, 'MLB')]
  const h = historyCoverage({ signing_year: 2010, mlb_debut_date: '2012-04-01' }, rows)
  assert.equal(h.pre_mlb_stints, 1)
  assert.deepEqual(h.gaps.map((g) => g.code), [], 'a team-less total is not an unresolved organization')
})

test('international professional context is not misclassified: prior professional leagues are a note, FOREIGN_PRO is not an affiliated record, the path is partial', () => {
  // Mexican League club before the Dodgers signing; the only affiliated records follow
  const subject = { signing_year: 2012, mlb_debut_date: '2016-05-27', pathway: 'MEXICAN_LEAGUE_TRANSFER' }
  const h = historyCoverage(subject, [stint(2013, 'LOW_A'), stint(2014, 'HIGH_A'), stint(2016, 'MLB')])
  assert.ok(h.notes.some((n) => n.code === 'PRIOR_PROFESSIONAL_CAREER'))
  assert.equal(h.state, 'PARTIAL', 'affiliated records do not describe the professional career before the signing')
  // a FOREIGN_PRO season before the debut is not a first affiliated season
  const f = historyCoverage({ signing_year: 2008, mlb_debut_date: '2012-04-01', pathway: 'LATAM_AMATEUR' }, [stint(2010, 'FOREIGN_PRO', { organization_name: null, affiliated: false }), stint(2011, 'AAA'), stint(2012, 'MLB')])
  assert.equal(f.first_affiliated_season, 2011)
  assert.equal(f.first_observed_season, 2010)
  assert.ok(!f.gaps.some((g) => g.code === 'ORGANIZATION_UNCLEAR'), 'a foreign club is organization-unmapped by design')
  // an amateur signing the same way has no such note
  assert.deepEqual(historyCoverage({ signing_year: 2012, mlb_debut_date: '2016-05-27', pathway: 'LATAM_AMATEUR' }, [stint(2013, 'LOW_A'), stint(2016, 'MLB')]).notes, [])
})

// ---- verified MLB cohort coverage ---------------------------------------------------------------------------------------------

const cohortData = () => {
  seq = 0
  const make = (over, sm, st) => ({ s: sign(over), sm, st })
  const items = [
    make({ reached_mlb_verified: true, outcome_audit_status: 'VERIFIED_MLB', mlb_debut_date: '2014-05-01', signing_year: 2010, signing_date: '2010-07-02' },
      { first_dsl_season: 2011, days_signing_to_mlb_exact: 1399, years_signing_to_mlb_exact: 3.83 }, [stint(2011, 'INTERNATIONAL_ROOKIE'), stint(2013, 'AA'), stint(2014, 'MLB')]),
    make({ reached_mlb_verified: true, outcome_audit_status: 'VERIFIED_MLB', mlb_debut_date: '2019-06-09', signing_year: 2016, signing_date: null, pathway: 'CUBAN_PRO' },
      { first_dsl_season: 2016, days_signing_to_mlb_exact: null }, [stint(2016, 'INTERNATIONAL_ROOKIE'), stint(2019, 'MLB')]),
    make({ reached_mlb_verified: true, outcome_audit_status: 'VERIFIED_MLB', mlb_debut_date: '1992-07-03', signing_year: 1987, signing_date: '1987-11-21' },
      { first_a_season: 1990, days_signing_to_mlb_exact: 1686, years_signing_to_mlb_exact: 4.62 }, [stint(1990, 'LOW_A'), stint(1992, 'MLB')]),
    make({ outcome_audit_status: 'VERIFIED_NO_MLB' }, { first_dsl_season: 2011 }, [stint(2011, 'INTERNATIONAL_ROOKIE')]),
    make({ outcome_audit_status: 'NOT_AUDITED' }, null, []),
  ]
  return {
    data: { signings: items.map((i) => i.s), decisions: [], developmentQueue: [], transactionQueue: [], sourceCounts: {},
      developmentSummary: items.filter((i) => i.sm).map((i) => ({ player_id: i.s.player_id, player_slug: i.s.player_slug, ...i.sm })) },
    stints: new Map(items.map((i) => [i.s.player_id, i.st])),
  }
}

test('the verified MLB coverage counts only verified MLB players, each with its denominator, and never turns a season into a date', () => {
  const { data, stints } = cohortData()
  // one verified MLB player has an open chronology issue (a stint with no organization); chronology is usable only with no open issue
  data.developmentQueue = [{ player_id: data.signings[0].player_id, issue: 'UNRESOLVED_ORGANIZATION' }]
  const cov = verifiedMlbCoverage(data, stints, developmentRecords)
  assert.equal(cov.players, 3, 'the audited non-MLB and the NOT_AUDITED player are not in the verified MLB cohort')
  assert.deepEqual(cov.exact_signing_date, { n: 2, of: 3 })
  assert.deepEqual(cov.exact_mlb_debut_date, { n: 3, of: 3 })
  assert.deepEqual(cov.signing_to_mlb_both_dates, { n: 2, of: 3 }, 'a missing signing date means no interval, whatever the signing year says')
  assert.deepEqual(cov.verified_first_professional_season, { n: 1, of: 3 }, 'amateur within a season: known; Cuban professional and the late start: not')
  assert.deepEqual(cov.prior_professional_career, { n: 1, of: 3 })
  assert.deepEqual(cov.any_pre_mlb_history, { n: 3, of: 3 })
  assert.deepEqual(cov.usable_affiliate_chronology, { n: 2, of: 3 }, 'an open chronology issue removes a player from the usable chronology; nothing is cleared by this table')
  assert.equal(cov.rows.length, 3)
  assert.deepEqual(cov.rows.map((r) => r.signing_year), [1987, 2010, 2016], 'deterministic: signing year then slug')
  assert.equal(cov.path_state.of, 3)
  assert.ok(cov.history_start.SOURCE_BEGINS_LATE >= 1)
})

test('signing-to-MLB timing requires both exact dates and is described by acquisition route, each with its own denominator', () => {
  const { data } = cohortData()
  const t = timingFacts(data)
  assert.deepEqual([t.signing_to_mlb_exact.n, t.signing_to_mlb_exact.of], [2, 3])
  assert.deepEqual(t.signing_to_mlb_exact_by_route.amateur_signing, { n: 2, of: 2, min_years: 3.83, median_years: (3.83 + 4.62) / 2, max_years: 4.62 })
  assert.deepEqual(t.signing_to_mlb_exact_by_route.established_professional, { n: 0, of: 1, min_years: null, median_years: null, max_years: null })
  assert.ok(!('rate' in t) && !('score' in t) && !('prediction' in t))
  assert.match(t.note, /NOT_AUDITED players are not counted as negative outcomes/)
})

test('deterministic queue ordering: the same data in any input order yields the same queue', () => {
  const { data } = cohortData()
  const a = JSON.stringify(developmentQueue(data))
  const shuffled = { ...data, signings: [...data.signings].reverse(), developmentSummary: [...data.developmentSummary].reverse() }
  assert.equal(JSON.stringify(developmentQueue(shuffled)), a)
  assert.equal(JSON.stringify(developmentQueue(data)), a)
  assert.deepEqual(Object.keys(DEVELOPMENT_TIERS).map(Number), [1, 2, 3, 4, 5, 6, 7], 'the tier ladder is unchanged')
})

// ---- the de-duplicated queue --------------------------------------------------------------------------------------------------

const detectors = (rows) => ({ signings: [{ player_id: 'p1', player_slug: 'a', full_name: 'A', signing_year: 2010 }, { player_id: 'p2', player_slug: 'b', full_name: 'B', signing_year: 2011 }], developmentQueue: rows })

test('duplicate research-gap prevention: detectors that name the same missing evidence become ONE need, and nothing is dropped', () => {
  const issues = ['MISSING_FIRST_GAME_DATE', 'MISSING_LAST_GAME_DATE', 'GAME_LOG_UNAVAILABLE', 'SEASON_ONLY_MILESTONE', 'MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES']
  const data = detectors(issues.map((issue) => ({ player_id: 'p1', issue, priority: 3 })))
  const needs = developmentNeeds(data)
  assert.equal(needs.length, 1)
  assert.equal(needs[0].need, 'GAME_DATES')
  assert.deepEqual(needs[0].issues, [...issues].sort(), 'every merged detector is listed; none is deleted')
  const sum = developmentNeedSummary(data)
  assert.equal(sum.detector_rows, 5, 'the raw detector count stays visible')
  assert.equal(sum.needs, 1)
})

test('different evidence gaps stay separate needs, and one player can have several', () => {
  const data = detectors([
    { player_id: 'p1', issue: 'GAME_LOG_UNAVAILABLE', priority: 3 }, { player_id: 'p1', issue: 'UNRESOLVED_ORGANIZATION', priority: 2 },
    { player_id: 'p1', issue: 'MULTI_ORG_SEASON_UNVERIFIED', priority: 1 }, { player_id: 'p1', issue: 'SEASON_GAP', priority: 2 },
    { player_id: 'p1', issue: 'UNKNOWN_LEVEL_CLASSIFICATION', priority: 2 }, { player_id: 'p1', issue: 'UNKNOWN_LEVEL_GAME_LOG', priority: 2 },
    { player_id: 'p2', issue: 'NON_MONOTONIC_PROGRESSION', priority: 1 },
  ])
  const needs = developmentNeeds(data)
  assert.deepEqual(needs.map((n) => `${n.player_slug}:${n.need}`), ['b:SEQUENCE_REVIEW', 'a:SEASON_COVERAGE', 'a:LEVEL_CLASSIFICATION', 'a:ORGANIZATION', 'a:GAME_DATES'])
  assert.deepEqual(needs.find((n) => n.need === 'ORGANIZATION').issues, ['MULTI_ORG_SEASON_UNVERIFIED', 'UNRESOLVED_ORGANIZATION'])
  assert.equal(needs.find((n) => n.need === 'ORGANIZATION').priority, 1, 'the most urgent merged detector sets the priority')
  assert.deepEqual(needs.find((n) => n.need === 'LEVEL_CLASSIFICATION').issues, ['UNKNOWN_LEVEL_CLASSIFICATION', 'UNKNOWN_LEVEL_GAME_LOG'])
})

test('an issue the registry does not know is reported as its own need, never dropped or folded into another', () => {
  const needs = developmentNeeds(detectors([{ player_id: 'p1', issue: 'SOME_FUTURE_ISSUE', priority: 2 }]))
  assert.equal(needs.length, 1)
  assert.equal(needs[0].need, 'UNGROUPED:SOME_FUTURE_ISSUE')
  assert.equal(needGroup('SOME_FUTURE_ISSUE'), null)
  assert.deepEqual(developmentNeedSummary(detectors([{ player_id: 'p1', issue: 'SOME_FUTURE_ISSUE' }])).by_need, { 'UNGROUPED:SOME_FUTURE_ISSUE': 1 })
})

test('the need order is deterministic: same database state, same order, whatever the row order', () => {
  const rows = [
    { player_id: 'p2', issue: 'GAME_LOG_UNAVAILABLE', priority: 3 }, { player_id: 'p1', issue: 'GAME_LOG_UNAVAILABLE', priority: 3 },
    { player_id: 'p1', issue: 'SEASON_GAP', priority: 2 }, { player_id: 'p2', issue: 'SEASON_GAP', priority: 2 },
  ]
  const a = JSON.stringify(developmentNeeds(detectors(rows)))
  assert.equal(JSON.stringify(developmentNeeds(detectors([...rows].reverse()))), a)
  assert.equal(JSON.stringify(developmentNeeds({ ...detectors(rows), signings: [...detectors(rows).signings].reverse() })), a)
})

test('every detector of the development queue view belongs to exactly one need group', () => {
  const sql = fs.readFileSync(path.join(root, 'database/sql/024_development_progression_decisions.sql'), 'utf8')
  const view = sql.slice(sql.indexOf('create or replace view public.v_dodgers_development_research_queue'))
  const detectorsInView = [...view.matchAll(/^\s+\('([A-Z_]+)', \d,/gm)].map((m) => m[1])
  assert.ok(detectorsInView.length >= 14, `found ${detectorsInView.length}`)
  const grouped = NEED_GROUPS.flatMap((g) => g.issues)
  assert.equal(new Set(grouped).size, grouped.length, 'no detector sits in two groups')
  for (const issue of detectorsInView) assert.ok(grouped.includes(issue), `${issue} has a need group`)
})

// ---- the progression-review packet -------------------------------------------------------------------------------------------

const jansenLike = () => ({
  player: { player_id: 'p-j', player_slug: 'kenley-jansen', full_name: 'Kenley Jansen', signing_year: 2004, mlb_debut_date: '2010-07-24' },
  decisions: [
    { player_id: 'p-j', event_code: 'AA_DEBUT', progression_role: 'REVIEW_REQUIRED', review_status: 'PENDING_REVIEW', confidence: 'LOW', notes: 'Unresolved sequence: 8 Triple-A games...', as_of_date: '2026-10-20' },
    { player_id: 'p-j', event_code: 'AAA_DEBUT', progression_role: 'REVIEW_REQUIRED', review_status: 'PENDING_REVIEW', confidence: 'LOW', notes: 'Unresolved sequence: 8 Triple-A games...', as_of_date: '2026-10-20' },
  ],
  progression: [
    { event_code: 'A_DEBUT', first_appearance_season: 2008, first_appearance_date: null, first_appearance_precision: 'SEASON', development_state: 'REACHED' },
    { event_code: 'HIGH_A_DEBUT', first_appearance_season: 2009, first_appearance_date: null, first_appearance_precision: 'SEASON', development_state: 'REACHED' },
    { event_code: 'AA_DEBUT', first_appearance_season: 2010, first_appearance_date: null, first_appearance_precision: 'SEASON', development_state: 'UNRESOLVED' },
    { event_code: 'AAA_DEBUT', first_appearance_season: 2009, first_appearance_date: null, first_appearance_precision: 'SEASON', development_state: 'UNRESOLVED' },
    { event_code: 'MLB_DEBUT', first_appearance_season: 2010, first_appearance_date: '2010-07-24', first_appearance_precision: 'DAY', development_state: 'REACHED' },
  ],
  stints: [
    { season: 2010, level: 'AA', g: 22, affiliate_team: 'Chattanooga Lookouts', stint_kind: 'TEAM_STINT' },
    { season: 2009, level: 'AAA', g: 8, affiliate_team: 'Albuquerque Isotopes', stint_kind: 'TEAM_STINT' },
    { season: 2009, level: 'HIGH_A', g: 38, affiliate_team: 'Inland Empire 66ers', stint_kind: 'TEAM_STINT' },
    { season: 2010, level: 'HIGH_A', g: 11, affiliate_team: 'Inland Empire 66ers', stint_kind: 'TEAM_STINT' },
    { season: 2010, level: 'MLB', g: 25, affiliate_team: 'Los Angeles Dodgers', stint_kind: 'TEAM_STINT' },
    { season: 2008, level: 'LOW_A', g: 40, affiliate_team: 'Great Lakes Loons', stint_kind: 'TEAM_STINT' },
    { season: 2010, level: 'AA', g: 22, stint_kind: 'SEASON_TOTAL' },
  ],
})

test('the review packet lays out the evidence in order and decides nothing: Jansen\'s AA/AAA decisions stay PENDING_REVIEW', () => {
  const j = jansenLike()
  const before = structuredClone(j.decisions)
  const packet = progressionReviewPacket(j.player, j.decisions, j.progression, j.stints)
  assert.equal(packet.decided, false)
  assert.deepEqual(j.decisions, before, 'the input decisions are not touched')
  assert.deepEqual(packet.pending.map((d) => [d.event_code, d.role, d.status]), [['AA_DEBUT', 'REVIEW_REQUIRED', 'PENDING_REVIEW'], ['AAA_DEBUT', 'REVIEW_REQUIRED', 'PENDING_REVIEW']])
  // source stints in chronological order (season, then ladder order), the season-total row left out
  assert.deepEqual(packet.path.map((s) => `${s.season} ${s.label}`), ['2008 Low-A', '2009 High-A', '2009 Triple-A', '2010 High-A', '2010 Double-A', '2010 MLB'])
  assert.deepEqual(packet.path.map((s) => s.before_mlb_debut), [true, true, true, true, true, false])
  // the conflicting level interpretation: Double-A (2010) is first recorded AFTER Triple-A (2009)
  assert.deepEqual(packet.inversions, [{ lower: 'AA_DEBUT', higher: 'AAA_DEBUT', lower_first_season: 2010, higher_first_season: 2009 }])
  assert.equal(packet.readings.length, 1)
  assert.deepEqual(packet.readings[0].interpretations.map((i) => i.id), ['EARLY_CAMEO_AT_HIGHER_LEVEL', 'LOWER_LEVEL_IS_REASSIGNMENT_OR_REHABILITATION'])
  assert.match(packet.readings[0].interpretations[0].reading, /Triple-A \(2009, 8 G before the MLB debut\) was an early cameo/)
  assert.ok(packet.evidence_needed.length >= 3)
})

test('the rendered packet states that nothing is a decision and shows the pending notes, the stints and the competing readings', () => {
  const j = jansenLike()
  const text = renderReviewPacket(progressionReviewPacket(j.player, j.decisions, j.progression, j.stints))
  assert.match(text, /Nothing below is a decision/)
  assert.match(text, /AA_DEBUT {2}REVIEW_REQUIRED \/ PENDING_REVIEW/)
  assert.match(text, /Unresolved sequence: 8 Triple-A games/)
  assert.match(text, /Inland Empire 66ers/)
  assert.match(text, /COMPETING READINGS: AA_DEBUT vs AAA_DEBUT/)
  assert.match(text, /EVIDENCE THAT WOULD SETTLE IT/)
  assert.doesNotMatch(text, /\/ REVIEWED|resolved as|decision: /i, 'no pending row is rendered as decided')
})

test('a sequence with no inversion yields no competing readings, and a reviewed decision is not listed as pending', () => {
  const j = jansenLike()
  const clean = progressionReviewPacket(j.player, [{ ...j.decisions[0], progression_role: 'EARLY_CAMEO', review_status: 'REVIEWED' }], j.progression.map((p) => (p.event_code === 'AAA_DEBUT' ? { ...p, first_appearance_season: 2011 } : p)), j.stints)
  assert.deepEqual(clean.pending, [])
  assert.deepEqual(clean.inversions, [])
  assert.deepEqual(clean.readings, [])
  assert.equal(LADDER.length, 6)
})

// ---- dataset / CLI plumbing ---------------------------------------------------------------------------------------------------

test('the history relations are read-only public views and a table the API roles can already read; the base dataset is unchanged', () => {
  assert.deepEqual(Object.keys(HISTORY_QUERIES), ['stints', 'progression', 'progressionDecisions'])
  for (const sql of Object.values(HISTORY_QUERIES)) {
    assert.match(sql, /^\s*select /i)
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|grant|truncate)\b/i)
  }
  assert.ok(!('stints' in DATASET_QUERIES), 'the large history is only read by the commands that ask for it')
  assert.match(DATASET_QUERIES.signings, /\bpathway\b/)
  const d = assembleDataset({ signings: [], decisions: [] })
  assert.deepEqual([d.stints, d.progression, d.progressionDecisions], [[], [], []])
})

test('the research CLI refuses --mlb-coverage and --review without stint history, and never writes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-048-cli-'))
  const file = path.join(dir, 'raw.json')
  fs.writeFileSync(file, JSON.stringify({ signings: [], decisions: [], status: [{ source_data_as_of_date: '2026-10-05' }] }))
  for (const flag of ['--mlb-coverage', '--review']) {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/research/development.mjs'), flag, '--input', file], { encoding: 'utf8' })
    assert.equal(r.status, 1, flag)
    assert.match(r.stderr, /No stint history in this dataset/)
  }
  const needs = spawnSync(process.execPath, [path.join(root, 'scripts/research/development.mjs'), '--needs', '--input', file], { encoding: 'utf8' })
  assert.equal(needs.status, 0)
  assert.match(needs.stdout, /detector_rows: 0/)
  const source = fs.readFileSync(path.join(root, 'scripts/research/development.mjs'), 'utf8')
  assert.doesNotMatch(source, /\b(insert into|update public|delete from)\b/i)
})

test('no analytical threshold moved: the first-record gap, the tiers and the evidence minimums are the 047 values', () => {
  assert.equal(FIRST_RECORD_MAX_GAP_SEASONS, 1)
  assert.deepEqual(Object.values(DEVELOPMENT_TIERS), ['VERIFIED_MLB_MISSING_TIMING', 'MATURE_AUDITED_MISSING_HIGHEST_LEVEL', 'DODGERS_WAR_INCOMPLETE_CHRONOLOGY', 'TRADED_INCOMPLETE_PRE_TRADE_HISTORY', 'AUDITED_NO_MLB_INCOMPLETE', 'NOT_AUDITED_INCOMPLETE', 'REMAINING'])
  const m = fs.readFileSync(path.join(root, 'docs/RESEARCH-METHODOLOGY.md'), 'utf8')
  assert.match(m, /FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON/)
  assert.match(m, /PARTIAL HISTORY != NO HISTORY/)
})

// ---- the page loader -----------------------------------------------------------------------------------------------------------------------

import { getDevelopmentData } from '../../lib/data.js'

/** A fake Supabase client that honours .range(), like the Data API: a page is a slice of the fixture, capped at what the range asks for. */
function pagingClient(fixtures, errorFor = {}) {
  const requests = []
  return {
    requests,
    from(relation) {
      const req = { relation, calls: [] }
      requests.push(req)
      const builder = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') {
            return (resolve, reject) => Promise.resolve().then(() => {
              const error = errorFor[relation] ?? null
              let rows = fixtures[relation] ?? []
              const range = req.calls.find((c) => c[0] === 'range')
              if (range) rows = rows.slice(range[1], range[2] + 1)
              return { data: error ? null : rows, error }
            }).then(resolve, reject)
          }
          if (prop === 'maybeSingle') return () => builder
          return (...args) => { req.calls.push([prop, ...args]); return builder }
        },
      })
      return builder
    },
  }
}

test('/development reads the verified MLB players\' stints from a relation the product contract already names, in pages, bounded to those players', async () => {
  const stints = Array.from({ length: 2300 }, (_, i) => ({ player_id: 'p1', season: 1990 + (i % 30), level: 'AA', stint_kind: 'TEAM_STINT' }))
  const c = pagingClient({
    v_signing_records: [{ signing_id: 's1', player_id: 'p1', player_slug: 'a', reached_mlb_verified: true, pathway: 'LATAM_AMATEUR' }, { signing_id: 's2', player_id: 'p2', player_slug: 'b', reached_mlb_verified: false }],
    v_player_development_stints: stints,
  })
  const r = await getDevelopmentData(c)
  assert.equal(r.live, true)
  assert.equal(r.mlbStints.length, 2300, 'every page is read, in order')
  const reqs = c.requests.filter((x) => x.relation === 'v_player_development_stints')
  assert.equal(reqs.length, 3, 'three pages of at most 1,000 rows')
  assert.deepEqual(reqs.map((x) => x.calls.find((y) => y[0] === 'range').slice(1)), [[0, 999], [1000, 1999], [2000, 2999]])
  for (const x of reqs) {
    assert.deepEqual(x.calls.find((y) => y[0] === 'in').slice(1), ['player_id', ['p1']], 'only the verified MLB players')
    assert.doesNotMatch(x.calls.find((y) => y[0] === 'select')[1], /\*/, 'a named, narrow column list')
  }
  const contract = fs.readFileSync(path.join(root, 'database/sql/045_final_integration_release.sql'), 'utf8') + fs.readFileSync(path.join(root, 'database/sql/045b_database_status_snapshot.sql'), 'utf8')
  assert.ok(contract.includes('v_player_development_stints'), 'the relation is part of the product contract')
  // the page reads no relation outside the contract: the decisions table and the progression view are for the research CLI only
  assert.ok(!c.requests.some((x) => /progression/.test(x.relation)))
})

test('/development tolerates a failed stint read: the page stays live and the coverage table is left out, never shown as empty', async () => {
  const c = pagingClient({ v_signing_records: [{ signing_id: 's1', player_id: 'p1', reached_mlb_verified: true }] }, { v_player_development_stints: { code: '57014', message: 'timeout' } })
  const r = await getDevelopmentData(c)
  assert.equal(r.live, true)
  assert.deepEqual(r.mlbStints, [], 'a failed page set is not a partial one')
  const none = await getDevelopmentData(pagingClient({ v_signing_records: [{ signing_id: 's2', player_id: 'p2', reached_mlb_verified: false }] }))
  assert.deepEqual(none.mlbStints, [])
  assert.equal(none.live, true)
})

// ---- deriving the pending reviews --------------------------------------------------------------------------------------------------------

test('derive-reviews flags exactly the inverted level pairs, ignores post-MLB debuts and rookie-level ties, and decides nothing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-048-reviews-'))
  const dir = path.join(tmp, 'database/research/048')
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(root, 'database/research/048/derive-reviews.mjs'), path.join(dir, 'derive-reviews.mjs'))
  fs.writeFileSync(path.join(dir, 'existing-development.json'), JSON.stringify({ players: { 'already-done': { stints: [], milestones: [] } } }))
  const players = ['inverted', 'clean', 'rookie-tie', 'post-mlb-only', 'already-done'].map((slug) => ({ slug, signing_year: 2010, mlb_id: 1 }))
  fs.writeFileSync(path.join(dir, 'development-cohort.json'), JSON.stringify({ as_of_date: '2026-10-20', players, already_researched: ['already-done'], progression_reviews: [] }))
  const ms = (slug, rows) => ({ slug, milestones: rows.map(([milestone, season, eventDate = null]) => ({ milestone, season, eventDate })) })
  const stintOf = (slug, season, level, games, teamName = 'Club') => ({ slug, season, level, stintKind: 'TEAM_STINT', teamName, batting: { games } })
  const out = path.join(tmp, 'pipeline')
  fs.mkdirSync(out)
  fs.writeFileSync(path.join(out, 'development-milestones.json'), JSON.stringify({ records: [
    // High-A first recorded in 2011, Low-A only in 2012: the lower level runs backward
    ms('inverted', [['A_DEBUT', 2012], ['HIGH_A_DEBUT', 2011], ['AA_DEBUT', 2013], ['MLB_DEBUT', 2014, '2014-05-01']]),
    ms('clean', [['A_DEBUT', 2011], ['HIGH_A_DEBUT', 2012], ['MLB_DEBUT', 2013, '2013-05-01']]),
    // DSL and complex share a tier: complex before DSL is not an inversion
    ms('rookie-tie', [['COMPLEX_DEBUT', 2010], ['DSL_DEBUT', 2011], ['A_DEBUT', 2012], ['MLB_DEBUT', 2014, '2014-05-01']]),
    // a Complex debut dated after the MLB debut season is a rehab appearance and is ignored
    ms('post-mlb-only', [['A_DEBUT', 2011], ['HIGH_A_DEBUT', 2012], ['COMPLEX_DEBUT', 2019], ['MLB_DEBUT', 2013, '2013-05-01']]),
    ms('already-done', [['A_DEBUT', 2012], ['HIGH_A_DEBUT', 2011], ['MLB_DEBUT', 2014, '2014-05-01']]),
  ] }))
  fs.writeFileSync(path.join(out, 'player-seasons.json'), JSON.stringify({ records: [
    { slug: 'inverted', stints: [stintOf('inverted', 2011, 'HIGH_A', 5), stintOf('inverted', 2012, 'LOW_A', 90), stintOf('inverted', 2014, 'MLB', 9)] },
    { slug: 'clean', stints: [] }, { slug: 'rookie-tie', stints: [] }, { slug: 'post-mlb-only', stints: [] }, { slug: 'already-done', stints: [] },
  ] }))
  const r = spawnSync(process.execPath, [path.join(dir, 'derive-reviews.mjs'), out], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'development-cohort.json'), 'utf8'))
  assert.deepEqual(doc.progression_reviews.map((x) => `${x.slug}:${x.event_code}`), ['inverted:A_DEBUT', 'inverted:HIGH_A_DEBUT'], 'only the inverted player, and only the two levels of the inverted pair')
  for (const x of doc.progression_reviews) {
    assert.deepEqual([x.decision_basis, x.confidence, x.as_of_date], ['STINT_CHRONOLOGY_REVIEW', 'LOW', '2026-10-20'])
    assert.match(x.notes, /2011 High-A 5 G; 2012 Low-A 90 G/, 'the season-by-season path is in the note, and the MLB season is not part of it')
    assert.match(x.notes, /is not decided/)
    assert.match(x.notes, /none of these levels is accepted as a developmental arrival until a reviewer decides/)
    assert.doesNotMatch(x.notes, /rehabilitation assignment\./, 'neither reading is asserted')
  }
  // deterministic: a second run yields the same bytes
  const first = fs.readFileSync(path.join(dir, 'development-cohort.json'), 'utf8')
  spawnSync(process.execPath, [path.join(dir, 'derive-reviews.mjs'), out], { encoding: 'utf8' })
  assert.equal(fs.readFileSync(path.join(dir, 'development-cohort.json'), 'utf8'), first)
})
