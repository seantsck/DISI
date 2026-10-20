// DISI 047 research tooling: development completeness, the development queue, descriptive timing, package completeness, value attribution
// and the development / transaction evidence gaps. The distinctions under test are core DISI principles:
//   UNKNOWN DEVELOPMENT HISTORY != NO DEVELOPMENT        UNKNOWN TRANSACTION != RELEASED
//   UNKNOWN TRADE RETURN != ZERO VALUE                   PLAYER LEFT ORGANIZATION != PLAYER FAILED
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  CHRONOLOGY_ISSUES, DEVELOPMENT_TIERS, DIMENSIONS, FIRST_RECORD_MAX_GAP_SEASONS, MISSING_CODE, developmentCoverage, developmentDimensions,
  developmentQueue, developmentRecords, developmentState, developmentTier, firstProSeasonKnown, timingFacts,
} from '../../lib/research/development-research.js'
import { attributionLedger, attributionState, attributionStateCounts, packageCompleteness } from '../../lib/research/transaction-research.js'
import { evidenceBlockers } from '../../lib/research/readiness-blockers.js'
import { DATASET_QUERIES, assembleDataset } from '../../lib/research/dataset.js'
import { assetPath } from '../../lib/research/asset-path.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// ---- synthetic dataset --------------------------------------------------------------------------------------------------------

let seq = 0
const sign = (over = {}) => {
  seq += 1
  const id = String(seq).padStart(4, '0')
  return {
    signing_id: `s-${id}`, player_id: `p-${id}`, player_slug: `player-${id}`, full_name: `Player ${id}`, player_sort_name: `Player ${id}`,
    signing_year: 2010, signing_date: '2010-07-02', country_market: 'Venezuela', outcome_audit_status: 'NOT_AUDITED', reached_mlb_verified: null,
    mlb_debut_date: null, ...over,
  }
}
const decision = (s, over = {}) => ({
  signing_id: s.signing_id, player_id: s.player_id, player_slug: s.player_slug, maturity_status: 'MATURE', chain_status: 'NO_TRADE_CHAIN',
  realized_value_state: 'REALIZED_TO_DATE', direct_dodgers_bwar: null, individually_attributable_trade_bwar: null, package_first_hop_participation_bwar: null,
  package_downstream_participation_bwar: null, observable_not_attributable_bwar: null, value_left_organization_bwar: null, ...over,
})
const summary = (s, over = {}) => ({
  player_id: s.player_id, player_slug: s.player_slug, signing_date: s.signing_date, professional_debut_season: s.signing_year + 1, highest_affiliated_level: 'AA',
  mlb_debut_date: null, days_signing_to_mlb_exact: null, years_signing_to_mlb_exact: null, ...over,
})

const complete = () => { const s = sign(); return { s, d: decision(s), m: summary(s) } }

// ---- unknown is not none ----------------------------------------------------------------------------------------------------------

test('unknown development history is not "no development": a player with no records has UNKNOWN dimensions, never a negative state', () => {
  const s = sign({ signing_date: null })
  const dims = developmentDimensions({ signing: s, summary: null, decision: decision(s) })
  assert.equal(dims.SIGNING_DATE, 'UNKNOWN')
  assert.equal(dims.FIRST_PRO_SEASON, 'UNKNOWN')
  assert.equal(dims.HIGHEST_LEVEL, 'UNKNOWN')
  assert.equal(dims.CHRONOLOGY, 'UNKNOWN')
  assert.equal(developmentState(dims), 'PARTIAL', 'the exit is the only known dimension (a never-traded player has no open exit)')
  const none = developmentDimensions({ signing: s, summary: null, decision: decision(s), txIssues: ['EXIT_TRANSACTION_MISSING'] })
  assert.equal(developmentState(none), 'NONE_KNOWN')
  assert.ok(!['NO_DEVELOPMENT', 'NONE', 'FAILED'].includes(developmentState(none)))
  for (const v of Object.values(developmentDimensions({ signing: s, summary: null, decision: null }))) assert.ok(['KNOWN', 'UNKNOWN', 'NOT_APPLICABLE'].includes(v))
})

test('the dimensions are independent: an audited outcome can sit beside an incomplete development history, and timing beside an incomplete transaction history', () => {
  const s = sign({ outcome_audit_status: 'VERIFIED_NO_MLB', signing_date: '2010-07-02' })
  const a = developmentDimensions({ signing: s, summary: summary(s, { highest_affiliated_level: null, professional_debut_season: null }), decision: decision(s) })
  assert.equal(a.SIGNING_DATE, 'KNOWN')
  assert.equal(a.HIGHEST_LEVEL, 'UNKNOWN', 'an audited outcome does not make the development history complete')
  const t = sign({ reached_mlb_verified: true, mlb_debut_date: '2014-05-01', outcome_audit_status: 'VERIFIED_MLB' })
  const b = developmentDimensions({ signing: t, summary: summary(t), decision: decision(t, { chain_status: 'INCOMPLETE_EXIT_NOT_RESEARCHED' }) })
  assert.equal(b.FIRST_PRO_SEASON, 'KNOWN')
  assert.equal(b.EXIT, 'KNOWN', 'the signing\'s own exit is recorded; an unresearched DOWNSTREAM hop is a transaction-chain concern, not an exit gap for this player')
  const u = developmentDimensions({ signing: t, summary: summary(t), decision: decision(t), txIssues: ['EXIT_TRANSACTION_MISSING'] })
  assert.equal(u.EXIT, 'UNKNOWN')
  assert.equal(u.SIGNING_DATE, 'KNOWN', 'complete development timing beside an incomplete transaction history')
})

test('a verified MLB debut is the highest level (derived from the audited outcome); a non-MLB player with no stints has an UNKNOWN highest level', () => {
  const mlb = sign({ reached_mlb_verified: true, outcome_audit_status: 'VERIFIED_MLB', mlb_debut_date: '1995-05-02' })
  assert.equal(developmentDimensions({ signing: mlb, summary: null, decision: null }).HIGHEST_LEVEL, 'KNOWN')
  assert.equal(developmentDimensions({ signing: mlb, summary: null, decision: null }).MLB_DEBUT, 'KNOWN')
  const none = sign({ outcome_audit_status: 'VERIFIED_NO_MLB' })
  assert.equal(developmentDimensions({ signing: none, summary: null, decision: null }).HIGHEST_LEVEL, 'UNKNOWN')
  assert.equal(developmentDimensions({ signing: none, summary: null, decision: null }).MLB_DEBUT, 'NOT_APPLICABLE')
  const noDebut = sign({ reached_mlb_verified: true, outcome_audit_status: 'VERIFIED_MLB' })
  assert.equal(developmentDimensions({ signing: noDebut, summary: null, decision: null }).MLB_DEBUT, 'UNKNOWN')
})

test('the first professional season is KNOWN only when the earliest record is within a season of signing; a later start is the first OBSERVED record', () => {
  assert.equal(FIRST_RECORD_MAX_GAP_SEASONS, 1)
  const s = sign({ signing_year: 1994 })
  assert.equal(firstProSeasonKnown(s, { professional_debut_season: 1994 }), true)
  assert.equal(firstProSeasonKnown(s, { professional_debut_season: 1995 }), true)
  assert.equal(firstProSeasonKnown(s, { professional_debut_season: 1996 }), false, 'Beltré signed in 1994; the API starts in 1996: earlier seasons are missing, not absent')
  assert.equal(firstProSeasonKnown(s, { professional_debut_season: 2005, first_dsl_season: null }), false)
  assert.equal(firstProSeasonKnown(s, {}), false)
  assert.equal(firstProSeasonKnown(s, null), false)
  // a foreign professional career that starts before the Dodgers signing is a known first season
  assert.equal(firstProSeasonKnown(sign({ signing_year: 2012 }), { professional_debut_season: 2006 }), true)
})

test('an unknown transaction is not a release: an open exit is UNKNOWN and a downstream hop is not an exit gap', () => {
  const s = sign()
  for (const open of ['INCOMPLETE_EXIT_NOT_RESEARCHED', 'INCOMPLETE_EXIT_UNRECORDED', 'INCOMPLETE_RETURN_UNRECORDED']) assert.equal(developmentDimensions({ signing: s, summary: summary(s), decision: decision(s, { chain_status: open }) }).EXIT, 'KNOWN', `${open} describes downstream hops, not this exit`)
  assert.equal(developmentDimensions({ signing: s, summary: summary(s), decision: decision(s), txIssues: ['EXIT_TRANSACTION_MISSING'] }).EXIT, 'UNKNOWN')
  assert.equal(developmentDimensions({ signing: s, summary: summary(s), decision: decision(s), txIssues: ['EXIT_STATUS_UNVERIFIED'] }).EXIT, 'UNKNOWN')
  assert.equal(developmentDimensions({ signing: s, summary: summary(s), decision: decision(s), txIssues: ['CASH_AMOUNT_UNKNOWN'] }).EXIT, 'KNOWN', 'a package issue is not an unknown exit')
})

test('the exit comes from the exit summary: still-controlled has no exit to know, a recorded exit is known, no evidence is unknown', () => {
  const s = sign()
  const exit = (control_state) => developmentDimensions({ signing: s, summary: summary(s), decision: decision(s, { chain_status: 'STILL_ACTIVE' }), exitRow: { control_state } }).EXIT
  assert.equal(exit('STILL_DODGERS_CONTROLLED'), 'NOT_APPLICABLE')
  assert.equal(exit('LEFT_DODGERS_CONTROL'), 'KNOWN')
  assert.equal(exit('NO_EXIT_EVIDENCE'), 'UNKNOWN')
  assert.equal(exit('HISTORY_UNAVAILABLE'), 'UNKNOWN')
  assert.equal(exit('SOMETHING_NEW'), 'UNKNOWN', 'an unrecognised state is never assumed to be a known exit')
  // a STILL_ACTIVE chain does NOT make the signing "still with the club": the exit summary decides
  assert.equal(developmentDimensions({ signing: s, summary: summary(s), decision: decision(s, { chain_status: 'STILL_ACTIVE' }), exitRow: { control_state: 'LEFT_DODGERS_CONTROL' } }).EXIT, 'KNOWN')
})

test('affiliate chronology is UNKNOWN while any chronology issue is open, and KNOWN only with stints and no issue', () => {
  const s = sign()
  assert.equal(developmentDimensions({ signing: s, summary: summary(s), decision: null }).CHRONOLOGY, 'KNOWN')
  for (const issue of CHRONOLOGY_ISSUES) assert.equal(developmentDimensions({ signing: s, summary: summary(s), decision: null, issues: [issue] }).CHRONOLOGY, 'UNKNOWN', issue)
  assert.equal(developmentDimensions({ signing: s, summary: summary(s), decision: null, issues: ['SOMETHING_ELSE'] }).CHRONOLOGY, 'KNOWN')
  assert.equal(developmentDimensions({ signing: s, summary: null, decision: null }).CHRONOLOGY, 'UNKNOWN')
})

// ---- the queue ----------------------------------------------------------------------------------------------------------------

const build = () => {
  seq = 0
  const out = { signings: [], decisions: [], developmentSummary: [], developmentQueue: [], transactionQueue: [], sourceCounts: {} }
  const add = (s, d, m, issues = []) => {
    out.signings.push(s); out.decisions.push(d)
    if (m) out.developmentSummary.push(m)
    for (const issue of issues) out.developmentQueue.push({ player_id: s.player_id, issue })
    out.sourceCounts[s.player_id] = 3
  }
  // 1: verified MLB missing the first pro season
  let s = sign({ reached_mlb_verified: true, outcome_audit_status: 'VERIFIED_MLB', mlb_debut_date: '2012-05-01', signing_year: 2008, full_name: 'Zed MLB' })
  add(s, decision(s, { direct_dodgers_bwar: 4.5 }), summary(s, { professional_debut_season: 2012 }))
  // 1: verified MLB missing the signing date, bigger bWAR (sorts first inside the tier)
  s = sign({ reached_mlb_verified: true, outcome_audit_status: 'VERIFIED_MLB', mlb_debut_date: '2014-05-01', signing_year: 2009, signing_date: null, full_name: 'Amy MLB' })
  add(s, decision(s, { direct_dodgers_bwar: 9.1 }), summary(s))
  // 2: mature audited no-MLB, highest level unknown
  s = sign({ outcome_audit_status: 'VERIFIED_NO_MLB', full_name: 'Mature Negative' })
  add(s, decision(s), summary(s, { highest_affiliated_level: null }))
  // 3: Dodgers WAR, not MLB-verified flag but WAR (a player with direct value and a gap)
  s = sign({ outcome_audit_status: 'VERIFIED_MLB', reached_mlb_verified: true, mlb_debut_date: '2013-04-01', full_name: 'War Contributor' })
  add(s, decision(s, { direct_dodgers_bwar: 1.2 }), summary(s), ['SEASON_GAP'])
  // 4: traded, incomplete pre-trade history (not MLB, not audited-mature)
  s = sign({ outcome_audit_status: 'NOT_AUDITED', full_name: 'Traded Prospect' })
  add(s, decision(s, { maturity_status: 'NOT_MATURE', chain_status: 'COMPLETE_TERMINAL' }), summary(s, { professional_debut_season: null }))
  // 5: audited no-MLB, incomplete, not mature
  s = sign({ outcome_audit_status: 'VERIFIED_NO_MLB', full_name: 'Young Negative' })
  add(s, decision(s, { maturity_status: 'NOT_MATURE' }), summary(s), ['IDENTITY_BUT_NO_PROFESSIONAL_SEASONS'])
  // 6: not audited, incomplete
  s = sign({ outcome_audit_status: 'NOT_AUDITED', full_name: 'Active Unaudited' })
  add(s, decision(s, { maturity_status: 'NOT_MATURE' }), summary(s, { highest_affiliated_level: null }))
  // complete: never queued
  s = sign({ outcome_audit_status: 'VERIFIED_NO_MLB', full_name: 'Complete Player' })
  add(s, decision(s), summary(s))
  return out
}

test('the development queue is ordered by the documented tiers and never lists a complete player', () => {
  const data = build()
  const q = developmentQueue(data)
  assert.deepEqual(q.map((r) => r.full_name), ['Amy MLB', 'Zed MLB', 'Mature Negative', 'War Contributor', 'Traded Prospect', 'Young Negative', 'Active Unaudited'])
  assert.deepEqual(q.map((r) => r.tier), [1, 1, 2, 3, 4, 5, 6])
  assert.ok(!q.some((r) => r.full_name === 'Complete Player'))
  assert.deepEqual(q.map((r) => r.rank), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(Object.keys(DEVELOPMENT_TIERS), ['1', '2', '3', '4', '5', '6', '7'])
})

test('queue determinism: the same data gives the same bytes, in any input order', () => {
  const data = build()
  const a = JSON.stringify(developmentQueue(data))
  const shuffled = { ...data, signings: [...data.signings].reverse(), decisions: [...data.decisions].reverse(), developmentSummary: [...data.developmentSummary].reverse(), developmentQueue: [...data.developmentQueue].reverse() }
  assert.equal(JSON.stringify(developmentQueue(shuffled)), a)
  assert.equal(JSON.stringify(developmentQueue(data)), a)
})

test('equal priority and equal bWAR fall back to class, date, sort name and finally the signing id (a total order)', () => {
  seq = 0
  const mk = () => sign({ outcome_audit_status: 'NOT_AUDITED', full_name: 'Same Name', player_sort_name: 'Same Name', signing_date: null })
  const a = mk(); const b = mk()
  const data = { signings: [b, a], decisions: [decision(a, { maturity_status: 'NOT_MATURE' }), decision(b, { maturity_status: 'NOT_MATURE' })], developmentSummary: [], developmentQueue: [], transactionQueue: [], sourceCounts: {} }
  const q = developmentQueue(data)
  assert.deepEqual(q.map((r) => r.signing_id), [a.signing_id, b.signing_id])
})

test('queue filters: missing, mature, mlb yes/no, year, market, player and limit', () => {
  const data = build()
  assert.equal(developmentQueue(data, { mlb: true }).length, 3)
  assert.equal(developmentQueue(data, { mlb: false }).length, 4)
  assert.deepEqual(developmentQueue(data, { mature: true }).map((r) => r.maturity), Array(4).fill('MATURE'))
  assert.equal(developmentQueue(data, { year: 2008 }).length, 1)
  assert.equal(developmentQueue(data, { market: 'venezuela' }).length, 7)
  assert.equal(developmentQueue(data, { market: 'Cuba' }).length, 0)
  assert.equal(developmentQueue(data, { player: 'player-0001' }).length, 1)
  assert.equal(developmentQueue(data, { limit: 2 }).length, 2)
  assert.equal(developmentQueue(data, { missing: true }).length, 7)
})

test('every missing field is a stable code, reusing the names DISI already raises', () => {
  const data = build()
  const q = developmentQueue(data)
  const amy = q.find((r) => r.full_name === 'Amy MLB')
  assert.deepEqual(amy.missing, ['SIGNING_DATE_MISSING'])
  assert.equal(MISSING_CODE.SIGNING_DATE, 'SIGNING_DATE_MISSING')
  assert.equal(MISSING_CODE.EXIT, 'EXIT_TRANSACTION_MISSING')
  assert.deepEqual(DIMENSIONS, ['SIGNING_DATE', 'FIRST_PRO_SEASON', 'HIGHEST_LEVEL', 'MLB_DEBUT', 'EXIT', 'CHRONOLOGY'])
  for (const r of q) for (const m of r.missing) assert.ok(Object.values(MISSING_CODE).includes(m))
})

test('tiers: each rule in isolation', () => {
  const s = sign({ reached_mlb_verified: true, outcome_audit_status: 'VERIFIED_MLB', mlb_debut_date: '2010-01-01' })
  const unknownDims = { SIGNING_DATE: 'KNOWN', FIRST_PRO_SEASON: 'UNKNOWN', HIGHEST_LEVEL: 'KNOWN', MLB_DEBUT: 'KNOWN', EXIT: 'KNOWN', CHRONOLOGY: 'KNOWN' }
  assert.equal(developmentTier({ signing: s, decision: decision(s), dims: unknownDims }), 1)
  const audited = sign({ outcome_audit_status: 'VERIFIED_NO_MLB' })
  assert.equal(developmentTier({ signing: audited, decision: decision(audited), dims: { ...unknownDims, FIRST_PRO_SEASON: 'KNOWN', HIGHEST_LEVEL: 'UNKNOWN' } }), 2)
  assert.equal(developmentTier({ signing: audited, decision: decision(audited, { maturity_status: 'NOT_MATURE' }), dims: { ...unknownDims, FIRST_PRO_SEASON: 'KNOWN', HIGHEST_LEVEL: 'UNKNOWN' } }), 5)
  const traded = sign({ outcome_audit_status: 'NOT_AUDITED' })
  assert.equal(developmentTier({ signing: traded, decision: decision(traded, { chain_status: 'COMPLETE_TERMINAL' }), dims: unknownDims }), 4)
  assert.equal(developmentTier({ signing: traded, decision: decision(traded, { chain_status: 'STILL_ACTIVE' }), dims: unknownDims }), 4, 'STILL_ACTIVE is a trade whose returned asset is still held')
  assert.equal(developmentTier({ signing: traded, decision: decision(traded, { chain_status: 'NO_TRADE_CHAIN' }), dims: unknownDims }), 6)
  assert.equal(developmentTier({ signing: sign({ outcome_audit_status: 'INSUFFICIENT_EVIDENCE' }), decision: null, dims: unknownDims }), 6)
})

test('coverage states every dimension with its denominator (applicable players only)', () => {
  const c = developmentCoverage(build())
  assert.equal(c.signings, 8)
  assert.deepEqual(c.dimensions.MLB_DEBUT, { known: 3, applicable: 3 }, 'only verified MLB players have a debut to know')
  assert.equal(c.dimensions.SIGNING_DATE.applicable, 8)
  assert.equal(c.dimensions.SIGNING_DATE.known, 7)
  assert.equal(c.states.COMPLETE, 1)
  const records = developmentRecords(build())
  assert.equal(records.length, 8)
})

test('descriptive timing: every figure carries its denominator and NOT_AUDITED players are never counted as negative outcomes', () => {
  const data = build()
  data.developmentSummary.find((m) => m.player_id === 'p-0001').days_signing_to_mlb_exact = 1500
  data.developmentSummary.find((m) => m.player_id === 'p-0001').years_signing_to_mlb_exact = 4.1
  const t = timingFacts(data)
  assert.equal(t.verified_mlb_players, 3)
  assert.deepEqual([t.signing_to_mlb_exact.n, t.signing_to_mlb_exact.of], [1, 3])
  assert.equal(t.signing_to_mlb_exact.median_years, 4.1)
  assert.equal(t.audited_no_mlb_players, 3)
  assert.deepEqual([t.highest_level_known.n, t.highest_level_known.of], [2, 3])
  assert.deepEqual(t.highest_level_counts, { AA: 2 })
  assert.match(t.note, /NOT_AUDITED players are not counted as negative outcomes/)
  assert.ok(!('rate' in t) && !('score' in t))
})

// ---- trade packages and value attribution ------------------------------------------------------------------------------------------

test('unknown trade return is not zero: a NULL return stays "not determined", a recorded zero stays a recorded zero', () => {
  const d = (over) => decision(sign(), { chain_status: 'COMPLETE_TERMINAL', ...over })
  assert.equal(attributionState(d({ realized_value_state: 'OUTCOME_NOT_OBSERVED' })), 'VALUE_NOT_DETERMINED')
  assert.equal(attributionState(d({ individually_attributable_trade_bwar: 0, package_first_hop_participation_bwar: 0 })), 'RECORDED_ZERO_RETURN')
  assert.equal(attributionState(d({ individually_attributable_trade_bwar: null, package_first_hop_participation_bwar: null })), 'RECORDED_ZERO_RETURN', 'all-NULL on a completed chain is the recorded-zero branch only because the chain is complete; an incomplete chain is never zero')
  assert.equal(attributionState(d({ chain_status: 'INCOMPLETE_RETURN_UNRECORDED', individually_attributable_trade_bwar: 0 })), 'CHAIN_INCOMPLETE')
  assert.equal(attributionState(d({ chain_status: 'INCOMPLETE_PENDING_CONSIDERATION' })), 'CHAIN_INCOMPLETE')
})

test('multi-player trade attribution safety: package value is never credited to one player, and only a sole-outgoing-asset trade is individually attributed', () => {
  const d = (over) => decision(sign(), { chain_status: 'COMPLETE_TERMINAL', ...over })
  assert.equal(attributionState(d({ individually_attributable_trade_bwar: 0, package_first_hop_participation_bwar: 12.5 })), 'PACKAGE_LEVEL_ONLY')
  assert.equal(attributionState(d({ individually_attributable_trade_bwar: 0, observable_not_attributable_bwar: 3 })), 'PACKAGE_LEVEL_ONLY')
  assert.equal(attributionState(d({ individually_attributable_trade_bwar: 4.2, package_first_hop_participation_bwar: 4.2 })), 'INDIVIDUALLY_ATTRIBUTED')
  const ledger = attributionLedger([d({ package_first_hop_participation_bwar: 12.5, individually_attributable_trade_bwar: 0 })])
  assert.equal(ledger[0].individually_attributable_trade_bwar, 0, 'the package amount did not leak into the individual column')
  assert.equal(ledger[0].package_first_hop_participation_bwar, 12.5)
  assert.equal(attributionState(decision(sign(), { chain_status: 'NO_TRADE_CHAIN' })), 'NOT_A_TRADE_EXIT')
  assert.equal(attributionState(decision(sign(), { chain_status: 'STILL_ACTIVE' })), 'RETURN_STILL_ACCRUING', 'STILL_ACTIVE means a RETURNED asset is still held; the signing itself was traded')
})

test('the ledger keeps the value concepts separate and never sums them; unresolved cases sort first and stay visible', () => {
  const rows = [
    decision(sign({ signing_year: 1990 }), { chain_status: 'COMPLETE_TERMINAL', individually_attributable_trade_bwar: 3, direct_dodgers_bwar: 5, value_left_organization_bwar: 8 }),
    decision(sign({ signing_year: 1980 }), { chain_status: 'INCOMPLETE_EXIT_NOT_RESEARCHED', direct_dodgers_bwar: 1 }),
    decision(sign({ signing_year: 1985 }), { chain_status: 'NO_TRADE_CHAIN' }),
    decision(sign({ signing_year: 1995 }), { chain_status: 'COMPLETE_TERMINAL', realized_value_state: 'OUTCOME_NOT_OBSERVED' }),
    decision(sign({ signing_year: 2018 }), { chain_status: 'STILL_ACTIVE' }),
  ]
  const ledger = attributionLedger(rows)
  assert.equal(ledger.length, 4, 'a signing that left no trade chain is not in the asset-path ledger; a STILL_ACTIVE chain is a trade')
  assert.deepEqual(ledger.map((r) => r.attribution_state), ['CHAIN_INCOMPLETE', 'RETURN_STILL_ACCRUING', 'VALUE_NOT_DETERMINED', 'INDIVIDUALLY_ATTRIBUTED'])
  const keys = Object.keys(ledger[2])
  for (const k of ['direct_dodgers_bwar', 'value_left_organization_bwar', 'individually_attributable_trade_bwar', 'package_first_hop_participation_bwar', 'package_downstream_participation_bwar', 'observable_not_attributable_bwar']) assert.ok(keys.includes(k), k)
  assert.ok(!keys.some((k) => /total|sum|combined/.test(k)))
  assert.deepEqual(attributionStateCounts(rows), { CHAIN_INCOMPLETE: 1, INDIVIDUALLY_ATTRIBUTED: 1, NOT_A_TRADE_EXIT: 1, RETURN_STILL_ACCRUING: 1, VALUE_NOT_DETERMINED: 1 })
})

test('package completeness is counted per trade: a transaction sentence naming one side is an incomplete package', () => {
  const p = packageCompleteness({
    transactionQueue: [
      { issue: 'TRADE_RETURN_UNRECORDED', event_key: 'LAD_ARI_2009_TONY_ABREU' },
      { issue: 'CASH_AMOUNT_UNKNOWN', event_key: 'E1' }, { issue: 'CASH_AMOUNT_UNKNOWN', event_key: 'E2' }, { issue: 'PTBNL_UNRESOLVED', event_key: 'E2' },
      { issue: 'EXIT_STATUS_UNVERIFIED', event_key: null },
    ],
    valueQueue: [{ issue: 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED', player_slug: 'a' }, { issue: 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED', player_slug: 'b' }, { issue: 'LINEAGE_BOUNDARY_NOTED', player_slug: 'c' }],
  })
  assert.equal(p.packages_with_open_issues, 3)
  assert.deepEqual(p.packages_with_open_issues_by_issue, { CASH_AMOUNT_UNKNOWN: 2, PTBNL_UNRESOLVED: 1, TRADE_RETURN_UNRECORDED: 1 })
  assert.equal(p.unresolved_attribution_signings, 2)
  assert.deepEqual(packageCompleteness({}), { packages_with_open_issues: 0, packages_with_open_issues_by_issue: {}, unresolved_attribution_signings: 0 })
})

// ---- readiness: evidence gaps, never gates -----------------------------------------------------------------------------------------------

test('evidence gaps are reported with denominators, reuse DISI names, and are explicitly not gates', () => {
  const cov = developmentCoverage(build())
  const gaps = evidenceBlockers({ decisions: build().decisions, development: cov, packages: { packages_with_open_issues: 2, unresolved_attribution_signings: 5 } })
  const codes = gaps.map((g) => g.code)
  for (const c of ['SIGNING_DATE_MISSING', 'FIRST_PRO_SEASON_UNKNOWN', 'HIGHEST_LEVEL_UNKNOWN', 'CHRONOLOGY_INCOMPLETE', 'TRADE_PACKAGE_INCOMPLETE', 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED']) assert.ok(codes.includes(c), c)
  for (const g of gaps) assert.ok(Number.isFinite(Object.values(g.measured)[0]) && /\d+ (of \d+ )?/.test(g.statement), g.code)
  const known = ['SIGNING_DATE_MISSING', 'FIRST_PRO_SEASON_UNKNOWN', 'HIGHEST_LEVEL_UNKNOWN', 'MLB_DEBUT_UNKNOWN', 'EXIT_TRANSACTION_MISSING', 'CHRONOLOGY_INCOMPLETE', 'TRANSACTION_CHAIN_INCOMPLETE', 'TRADE_PACKAGE_INCOMPLETE', 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED']
  for (const c of codes) assert.ok(known.includes(c), c)
  assert.deepEqual(evidenceBlockers({ decisions: [], development: null, packages: null }), [])
  const src = fs.readFileSync(path.join(root, 'lib/research/readiness-blockers.js'), 'utf8')
  assert.match(src, /REPORTED, not gates/)
})

test('evidence gaps do not change any predictive-support layer: readinessBlockers is untouched by them', async () => {
  const { readinessBlockers } = await import('../../lib/research/readiness-blockers.js')
  const status = { tracked_signings: 220, outcome_audit_queue: 127, signings_with_known_cost: 56, outcome_audits_completed: 93 }
  const a = readinessBlockers({ status, executive: {}, targets: [], evSupport: [], populations: [], decisionSupport: [] })
  const b = readinessBlockers(/** @type {any} */ ({ status, executive: {}, targets: [], evSupport: [], populations: [], decisionSupport: [], decisions: build().decisions, developmentSummary: build().developmentSummary }))
  assert.deepEqual(a, b)
  assert.deepEqual(a.layers.map((l) => l.key), ['OUTCOME_RATES', 'OUTCOME_PROBABILITIES', 'ACQUISITION_ECONOMICS', 'EXPECTED_VALUE', 'RECOMMENDATIONS'])
})

// ---- dataset and the read-only command -----------------------------------------------------------------------------------------------------

test('the dataset reads the development summary through a public relation and the command never writes', () => {
  assert.match(DATASET_QUERIES.developmentSummary, /from v_dodgers_player_development_summary/)
  assert.match(DATASET_QUERIES.exitSummary, /from v_dodgers_international_exit_summary/)
  assert.deepEqual(assembleDataset({}).exitSummary, [])
  assert.doesNotMatch(Object.values(DATASET_QUERIES).join('\n'), /\b(insert|update|delete|truncate|alter|create|drop)\b/i)
  assert.deepEqual(assembleDataset({ developmentSummary: [{ player_id: 'x' }] }).developmentSummary, [{ player_id: 'x' }])
  assert.deepEqual(assembleDataset({}).developmentSummary, [])
  const src = fs.readFileSync(path.join(root, 'scripts/research/development.mjs'), 'utf8')
  assert.doesNotMatch(src, /\b(insert into|update public|delete from)\b/i)
})

test('research:development reads a saved dataset, prints deterministic text/json/csv and supports its filters', () => {
  const data = build()
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'disi-047-')), 'dataset.json')
  fs.writeFileSync(file, JSON.stringify({ ...data, sourceCounts: Object.entries(data.sourceCounts).map(([player_id, n]) => ({ player_id, n })), directory: [], status: [{ source_data_as_of_date: '2026-10-05' }], executive: [] }))
  const cli = (...a) => spawnSync(process.execPath, [path.join(root, 'scripts/research/development.mjs'), '--input', file, ...a], { encoding: 'utf8' })
  const one = cli('--missing', '--limit', '3')
  assert.equal(one.status, 0, one.stderr)
  assert.equal(cli('--missing', '--limit', '3').stdout, one.stdout, 'same data, same bytes')
  assert.match(one.stdout, /Amy MLB/)
  const json = JSON.parse(cli('--missing', '--format', 'json').stdout)
  assert.equal(json.rows.length, 7)
  assert.equal(json.rows[0].full_name, 'Amy MLB')
  const csv = cli('--missing', '--format', 'csv', '--limit', '1').stdout.split('\n').filter(Boolean)
  assert.equal(csv.length, 2)
  assert.match(csv[0], /rank,tier,signing_year,full_name/)
  assert.equal(JSON.parse(cli('--mlb', 'yes', '--format', 'json').stdout).rows.length, 3)
  assert.equal(JSON.parse(cli('--player', 'player-0002', '--format', 'json').stdout).rows.length, 1)
  assert.equal(JSON.parse(cli('--coverage', '--format', 'json').stdout).signings, 8)
  assert.equal(JSON.parse(cli('--timing', '--format', 'json').stdout).verified_mlb_players, 3)
  assert.equal(cli('--input', '/nonexistent.json').status, 1)
})

// ---- the dossier asset path -----------------------------------------------------------------------------------------------------------

test('asset path: only recorded steps are RECORDED; a missing exit is UNKNOWN and is never inferred', () => {
  const sg = { is_dodgers_franchise: true, signing_year: 2012, signing_date: null, reached_mlb_verified: true, mlb_debut_date: '2013-06-03', mlb_debut_org: 'Los Angeles Dodgers', outcome_audit_status: 'VERIFIED_MLB' }
  const steps = assetPath({ signings: [sg], devStints: [], devSummary: null, transactions: [], realizedValue: [decision(sign(), { chain_status: 'NO_TRADE_CHAIN' })] })
  const by = Object.fromEntries(steps.map((s) => [s.key, s]))
  assert.equal(by.SIGNED.state, 'RECORDED')
  assert.match(by.SIGNED.detail, /2012 \(exact date not recorded\)/)
  assert.equal(by.DEVELOPMENT.state, 'UNKNOWN')
  assert.match(by.DEVELOPMENT.detail, /not evidence of no development/)
  assert.equal(by.HIGHEST_LEVEL.state, 'RECORDED')
  assert.match(by.HIGHEST_LEVEL.detail, /derived from the verified MLB debut/)
  assert.equal(by.MLB_DEBUT.state, 'RECORDED')
  assert.equal(by.EXIT.state, 'UNKNOWN')
  assert.match(by.EXIT.detail, /neither is inferred/)
  assert.ok(!('PACKAGE' in by), 'no trade package step without an exit')
})

test('asset path: a trade package shows the package, and a shared package is not credited to the player', () => {
  const sg = { is_dodgers_franchise: true, signing_year: 1988, signing_date: '1988-06-01', reached_mlb_verified: true, mlb_debut_date: '1993-07-19', outcome_audit_status: 'VERIFIED_MLB' }
  const tx = [{ from_franchise_key: 'DODGERS', player_side: 'OUTGOING', record_kind: 'PACKAGE_EVENT', transaction_date: '1999-11-08', transaction_type: 'TRADE', to_organization: 'Toronto Blue Jays', outgoing_asset_count: 2, incoming_asset_count: 2, attribution_status: 'SHARED_PACKAGE_RETURN' }]
  const steps = assetPath({ signings: [sg], devStints: [{ season: 1991 }, { season: 1992 }], devSummary: { highest_affiliated_level: 'AAA' }, transactions: tx,
    realizedValue: [decision(sign(), { chain_status: 'COMPLETE_TERMINAL', individually_attributable_trade_bwar: 0, package_first_hop_participation_bwar: 21 })] })
  const by = Object.fromEntries(steps.map((s) => [s.key, s]))
  assert.match(by.DEVELOPMENT.detail, /2 seasons recorded from 1991/)
  assert.match(by.DEVELOPMENT.detail, /3 seasons after signing, so earlier seasons are not on record/)
  assert.equal(by.EXIT.state, 'RECORDED')
  assert.match(by.PACKAGE.detail, /2 assets out, 2 assets back \(shared package\)/)
  assert.equal(by.RETURN.state, 'RECORDED')
  assert.match(by.RETURN.detail, /not credited to this player/)
})

test('asset path: NOT_AUDITED is unknown, never a negative result; an incomplete chain leaves the return unknown', () => {
  const sg = { is_dodgers_franchise: true, signing_year: 2022, signing_date: '2022-01-15', reached_mlb_verified: null, outcome_audit_status: 'NOT_AUDITED' }
  const by = Object.fromEntries(assetPath({ signings: [sg], realizedValue: [decision(sign(), { chain_status: 'STILL_ACTIVE' })] }).map((s) => [s.key, s]))
  assert.equal(by.MLB_DEBUT.state, 'UNKNOWN')
  assert.match(by.MLB_DEBUT.detail, /NOT_AUDITED is not a negative result/)
  assert.equal(by.EXIT.state, 'UNKNOWN', 'a STILL_ACTIVE chain is not evidence that the player is still with the club')
  assert.match(by.EXIT.detail, /neither is inferred/)
  const accruing = Object.fromEntries(assetPath({ signings: [sg], transactions: [{ from_franchise_key: 'DODGERS', player_side: 'OUTGOING', record_kind: 'PACKAGE_EVENT', transaction_date: '2024-07-29', transaction_type: 'TRADE', outgoing_asset_count: 3, incoming_asset_count: 1 }], realizedValue: [decision(sign(), { chain_status: 'STILL_ACTIVE' })] }).map((s) => [s.key, s]))
  assert.equal(accruing.RETURN.state, 'UNKNOWN')
  assert.match(accruing.RETURN.detail, /still accruing and not final/)
  const neg = Object.fromEntries(assetPath({ signings: [{ ...sg, outcome_audit_status: 'VERIFIED_NO_MLB' }], realizedValue: [] }).map((s) => [s.key, s]))
  assert.equal(neg.MLB_DEBUT.state, 'NOT_APPLICABLE')
  const tx = [{ from_franchise_key: 'DODGERS', player_side: 'OUTGOING', record_kind: 'PACKAGE_EVENT', transaction_date: '1951-01-01', transaction_type: 'TRADE', outgoing_asset_count: 1, incoming_asset_count: 1 }]
  const inc = Object.fromEntries(assetPath({ signings: [sg], transactions: tx, realizedValue: [decision(sign(), { chain_status: 'INCOMPLETE_EXIT_NOT_RESEARCHED' })] }).map((s) => [s.key, s]))
  assert.equal(inc.RETURN.state, 'UNKNOWN')
  assert.match(inc.RETURN.detail, /not final/)
  assert.deepEqual(assetPath({}).map((s) => s.state), ['UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN'])
})

// ---- the page loaders --------------------------------------------------------------------------------------------------------------------------

import { getAssetConversionData, getDevelopmentData } from '../../lib/data.js'

function fakeClient(fixtures, errorFor = {}) {
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
              return { data: error ? null : (fixtures[relation] ?? []), error }
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

test('getDevelopmentData adds the completeness reads from public relations the product contract already names, and degrades to empty on error', async () => {
  const c = fakeClient({
    v_dodgers_development_coverage: [], v_signing_records: [{ signing_id: 's1' }], v_dodgers_player_development_summary: [{ player_id: 'p1' }],
  })
  const r = await getDevelopmentData(c)
  assert.equal(r.live, true)
  assert.deepEqual(r.devSignings, [{ signing_id: 's1' }])
  assert.deepEqual(r.devSummary, [{ player_id: 'p1' }])
  const relations = c.requests.map((x) => x.relation)
  assert.equal(relations.filter((x) => x === 'v_signing_records').length, 2, 'the existing debuts read plus the completeness read')
  assert.ok(relations.includes('v_dodgers_player_development_summary'))
  const contract = fs.readFileSync(path.join(root, 'database/sql/045b_database_status_snapshot.sql'), 'utf8') + fs.readFileSync(path.join(root, 'database/sql/045_final_integration_release.sql'), 'utf8')
  for (const rel of new Set(relations)) assert.ok(contract.includes(rel) || rel === 'v_signing_records', `${rel} is part of the product contract`)
  const bad = await getDevelopmentData(fakeClient({}, { v_dodgers_player_development_summary: { code: '57014', message: 'timeout' } }))
  assert.equal(bad.live, false)
  assert.deepEqual(bad.devSignings, [])
})

test('getAssetConversionData reads the asset paths from the persisted decision snapshot, never a live analytical view, and tolerates its absence', async () => {
  const c = fakeClient({
    v_player_transactions: [], product_player_decision: [{ signing_id: 's1', chain_status: 'COMPLETE_TERMINAL' }],
  })
  const r = await getAssetConversionData(c)
  assert.equal(r.live, true)
  assert.deepEqual(r.pathDecisions, [{ signing_id: 's1', chain_status: 'COMPLETE_TERMINAL' }])
  const req = c.requests.find((x) => x.relation === 'product_player_decision')
  const select = req.calls.find((x) => x[0] === 'select')[1]
  assert.match(select, /chain_status/)
  assert.doesNotMatch(select, /\*/, 'a bounded, named column list')
  for (const x of c.requests) assert.match(x.relation, /^(product_|v_player_transactions$|v_player_directory$)/)
  const missing = await getAssetConversionData(fakeClient({ v_player_transactions: [] }, { product_player_decision: { code: 'PGRST205', message: 'not found' } }))
  assert.equal(missing.live, true, 'the page still renders its trade cards')
  assert.deepEqual(missing.pathDecisions, [])
})

test('asset path: dates print as plain calendar dates whether the value is a date or a full timestamp', () => {
  const sg = { is_dodgers_franchise: true, signing_year: 1988, signing_date: '1988-06-06T00:00:00.000Z', reached_mlb_verified: true, mlb_debut_date: '1993-07-19T00:00:00.000Z', mlb_debut_org: 'LAD', outcome_audit_status: 'VERIFIED_MLB' }
  const tx = [{ from_franchise_key: 'DODGERS', player_side: 'OUTGOING', record_kind: 'TRANSACTION', transaction_date: '1999-11-08T00:00:00.000Z', transaction_type: 'TRADE', to_organization: 'TOR' }]
  const by = Object.fromEntries(assetPath({ signings: [sg], transactions: tx }).map((s) => [s.key, s]))
  assert.equal(by.SIGNED.detail, '1988-06-06')
  assert.equal(by.MLB_DEBUT.detail, '1993-07-19 with LAD')
  assert.equal(by.EXIT.detail, '1999-11-08 · trade to TOR')
})
