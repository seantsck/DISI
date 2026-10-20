// DISI 046 research tooling: maturity, the outcome-audit cohort, audit conclusions, acquisition cost, transaction attribution,
// readiness blockers and the read-only commands. The distinctions under test are core DISI principles:
//   NOT_AUDITED is not AUDITED_NO_MLB, and an UNKNOWN cost is not $0.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isMatureSigning, maturityStatus, subtractYears } from '../../lib/research/maturity.js'
import { AUDIT_POLICY, AUDIT_TIERS, MATURITY_YEARS, NEVER_RESEARCHED_BONUS } from '../../lib/research/policy.js'
import { buildOutcomeCohort, cohortSummary, filterCohort } from '../../lib/research/outcome-cohort.js'
import { auditCaptureGaps, auditCaptureReport, auditConclusion } from '../../lib/research/outcome-audit.js'
import { costQueue, costReportGaps, costState, costSummary, costTier, largeClassYears } from '../../lib/research/cost-research.js'
import { attributionSummary, dispositionOf, incompleteChains, transactionResearchItems } from '../../lib/research/transaction-research.js'
import { readinessBlockers } from '../../lib/research/readiness-blockers.js'
import { queueBreakdown } from '../../lib/research/queue-analysis.js'
import { progressReport } from '../../lib/research/progress.js'
import { DEFAULT_AUDIT_POLICY } from '../../scripts/mlb/lib/classify.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const AS_OF = '2026-10-05'

// ---- synthetic dataset --------------------------------------------------------------------------------------------------

let seq = 0
const sign = (over = {}) => {
  seq += 1
  const id = String(seq).padStart(4, '0')
  return {
    signing_id: `s-${id}`, player_id: `p-${id}`, player_slug: `player-${id}`, full_name: `Player ${id}`, player_sort_name: `Player ${id}`,
    signing_year: 2018, signing_date: null, country_market: 'Venezuela', age_at_signing: 17, outcome_audit_status: 'NOT_AUDITED',
    reached_mlb_verified: null, outcome_state: null, ...over,
  }
}
const decision = (s, over = {}) => ({
  signing_id: s.signing_id, player_id: s.player_id, player_slug: s.player_slug, full_name: s.full_name, signing_year: s.signing_year,
  country_market: s.country_market, maturity_status: isMatureSigning(s, AS_OF) ? 'MATURE' : 'RECENT', outcome_state: s.outcome_state,
  reached_mlb_verified: s.reached_mlb_verified, realized_career_bwar: null, known_acquisition_cost_usd: null, cost_coverage_state: 'UNKNOWN',
  cost_components_known: [], cost_components_required_missing: ['SIGNING_BONUS'], chain_status: 'NO_TRADE_CHAIN', ...over,
})

function dataset() {
  seq = 0
  const mlb = sign({ full_name: 'Alpha Mlb', player_sort_name: 'Alpha Mlb', signing_year: 2014, outcome_audit_status: 'VERIFIED_MLB', reached_mlb_verified: true, outcome_state: 'REACHED_MLB' })
  const noMlb = sign({ full_name: 'Bravo NoMlb', player_sort_name: 'Bravo NoMlb', signing_year: 2015, outcome_audit_status: 'VERIFIED_NO_MLB', reached_mlb_verified: false, outcome_state: 'NO_MLB_CAREER_ENDED' })
  const matureNever = sign({ full_name: 'Charlie Never', player_sort_name: 'Charlie Never', signing_year: 2013 })
  const matureActive = sign({ full_name: 'Delta Active', player_sort_name: 'Delta Active', signing_year: 2021, signing_date: '2021-01-15' })
  const matureThin = sign({ full_name: 'Echo Thin', player_sort_name: 'Echo Thin', signing_year: 2021, signing_date: '2021-01-15' })
  const recent = sign({ full_name: 'Foxtrot Recent', player_sort_name: 'Foxtrot Recent', signing_year: 2024, signing_date: '2024-01-15' })
  const signings = [recent, matureThin, mlb, matureNever, noMlb, matureActive]
  const directory = [{ player_id: matureActive.player_id, mlb_id: 111, bref_id: null }, { player_id: matureThin.player_id, mlb_id: 222, bref_id: null }, { player_id: matureNever.player_id, mlb_id: 333, bref_id: 'x' }]
  const matureQueue = [
    { player_id: matureActive.player_id, mlb_id: 111, unaudited_reason: 'STILL_DEVELOPING', research_recommendation: 'NO_MLB_ACTIVE_IN_MINORS', disposition: 'ACTIVE', highest_level: 'AA', last_affiliated_season: 2026, last_affiliated_team: 'Tulsa' },
    { player_id: matureThin.player_id, mlb_id: 222, unaudited_reason: 'INSUFFICIENT_EVIDENCE', research_recommendation: 'INSUFFICIENT_EVIDENCE', disposition: 'UNKNOWN' },
    { player_id: matureNever.player_id, mlb_id: 333, unaudited_reason: 'NOT_YET_RESEARCHED', research_recommendation: null, disposition: null },
  ]
  return { signings, directory, matureQueue, mlb, noMlb, matureNever, matureActive, matureThin, recent }
}

// ---- maturity and pinned definitions ------------------------------------------------------------------------------------

test('maturity follows the 032 rule: a dated signing must be five years old at the as-of date; undated falls back to the year', () => {
  assert.equal(subtractYears('2026-10-05', 5), '2021-10-05')
  assert.equal(subtractYears('2028-02-29', 5), '2023-02-28', 'Feb 29 falls back like PostgreSQL date - interval')
  assert.equal(isMatureSigning({ signing_date: '2021-10-05', signing_year: 2021 }, AS_OF), true)
  assert.equal(isMatureSigning({ signing_date: '2021-10-06', signing_year: 2021 }, AS_OF), false)
  assert.equal(isMatureSigning({ signing_date: null, signing_year: 2021 }, AS_OF), true)
  assert.equal(isMatureSigning({ signing_date: null, signing_year: 2022 }, AS_OF), false)
  assert.equal(isMatureSigning({}, AS_OF), null)
  assert.equal(maturityStatus({}, AS_OF), 'UNKNOWN')
  assert.throws(() => isMatureSigning({ signing_year: 2000 }, 'today'))
})

test('the constants restate the existing rules and nothing drifts: classify.mjs policy, 019 tiers, 032 maturity years', () => {
  assert.deepEqual({ ...AUDIT_POLICY }, DEFAULT_AUDIT_POLICY)
  assert.equal(MATURITY_YEARS, 5)
  const sql019 = read('database/sql/019_mature_outcome_audit_expansion.sql')
  assert.match(sql019, /when s\.signing_year <= 2014 then 'TIER_1_THROUGH_2014'\s+when s\.signing_year <= 2020 then 'TIER_2_2015_2020'\s+else 'TIER_3_RECENT_MATURE'/)
  assert.match(sql019, /when s\.signing_year <= 2014 then 100\s+when s\.signing_year <= 2020 then 80\s+else 60\s+end \+ case when pp\.player_id is null then 10 else 0 end as priority/)
  assert.deepEqual(AUDIT_TIERS.map((t) => [t.key, t.priority]), [['TIER_1_THROUGH_2014', 100], ['TIER_2_2015_2020', 80], ['TIER_3_RECENT_MATURE', 60]])
  assert.equal(NEVER_RESEARCHED_BONUS, 10)
  assert.match(read('database/sql/032_player_value_organizational_realization.sql'), /extract\(year from as_of\.analysis_as_of_date\)::int - 5/)
})

// ---- NOT_AUDITED is not NO_MLB --------------------------------------------------------------------------------------------

test('NOT_AUDITED is never counted as, or converted to, a no-MLB result', () => {
  const d = dataset()
  const cohort = buildOutcomeCohort({ signings: d.signings, directory: d.directory, matureQueue: d.matureQueue, asOf: AS_OF })
  const sum = cohortSummary(cohort)
  assert.equal(sum.tracked, 6)
  assert.equal(sum.verified_mlb, 1)
  assert.equal(sum.verified_no_mlb, 1)
  assert.equal(sum.not_audited, 4)
  assert.equal(sum.verified_mlb + sum.verified_no_mlb + sum.not_audited, sum.tracked)
  for (const r of cohort.filter((x) => x.audit_status === 'NOT_AUDITED')) assert.equal(r.outcome_state, null, 'an unaudited player has no outcome state')
  // an unrecognised or missing audit status is NOT_AUDITED, never VERIFIED_NO_MLB
  const odd = buildOutcomeCohort({ signings: [sign({ outcome_audit_status: null }), sign({ outcome_audit_status: 'SOMETHING' })], asOf: AS_OF })
  assert.deepEqual(odd.map((r) => r.audit_status), ['NOT_AUDITED', 'NOT_AUDITED'])
  assert.equal(cohortSummary(odd).verified_no_mlb, 0)
})

test('no audit conclusion turns missing or insufficient evidence into a no-MLB audit', () => {
  for (const rec of ['INSUFFICIENT_EVIDENCE', undefined, '', 'SOMETHING_NEW']) {
    const c = auditConclusion({ recommendation: rec }, 2015)
    assert.equal(c.writeAudit, false)
    assert.equal(c.reachedMlb, null)
    assert.equal(c.outcomeState, null)
    assert.equal(c.conclusion, 'INSUFFICIENT_EVIDENCE')
  }
  // a no-MLB observation inside the policy hold stays NOT_AUDITED
  const held = auditConclusion({ recommendation: 'NO_MLB_ACTIVE_IN_MINORS', reason: 'x' }, 2021)
  assert.deepEqual([held.conclusion, held.writeAudit, held.reachedMlb], ['NOT_AUDITED', false, null])
  const young = auditConclusion({ recommendation: 'NO_MLB_CAREER_ENDED', reason: 'x' }, 2022)
  assert.deepEqual([young.conclusion, young.writeAudit], ['NOT_AUDITED', false])
})

test('audit status transitions: only a verified MLB debut or a policy-eligible no-MLB result writes an audit', () => {
  assert.deepEqual(auditConclusion({ recommendation: 'VERIFIED_MLB' }, 2024), { conclusion: 'VERIFIED_MLB', writeAudit: true, reachedMlb: true, outcomeState: 'REACHED_MLB', reason: 'Verified MLB debut.' })
  const ended = auditConclusion({ recommendation: 'NO_MLB_CAREER_ENDED', reason: 'released' }, 2021)
  assert.deepEqual([ended.conclusion, ended.writeAudit, ended.reachedMlb, ended.outcomeState], ['VERIFIED_NO_MLB', true, false, 'NO_MLB_CAREER_ENDED'])
  const active = auditConclusion({ recommendation: 'NO_MLB_ACTIVE_IN_MINORS', reason: 'playing' }, 2020)
  assert.deepEqual([active.conclusion, active.writeAudit, active.outcomeState], ['VERIFIED_NO_MLB', true, 'NO_MLB_ACTIVE_IN_MINORS'])
  assert.equal(auditConclusion({ recommendation: 'NO_MLB_ACTIVE_IN_MINORS' }, 2021).writeAudit, false)
  assert.equal(auditConclusion({ recommendation: 'NO_MLB_CAREER_ENDED' }, 2021).writeAudit, true)
  assert.equal(auditConclusion({ recommendation: 'NO_MLB_CAREER_ENDED' }, 2022).writeAudit, false)
})

test('a completed audit must capture the as-of date, identity, provenance and the evidence for its result', () => {
  const base = { conclusion: 'VERIFIED_MLB', asOfDate: AS_OF, mlbId: 1, rationale: 'MLB person record debut date', outcomeState: 'REACHED_MLB', mlbDebutDate: '2024-04-01', mlbDebutTeam: 'Los Angeles Dodgers', sources: [{ url: 'https://statsapi.mlb.com/api/v1/people/1', retrievedAt: '2026-10-05T00:00:00Z' }] }
  assert.deepEqual(auditCaptureGaps(base), [])
  assert.ok(auditCaptureGaps({ ...base, mlbDebutDate: null }).includes('mlb_debut_date'))
  assert.ok(auditCaptureGaps({ ...base, mlbDebutTeam: null }).includes('mlb_debut_organization'))
  assert.ok(auditCaptureGaps({ ...base, sources: [] }).includes('provenance_sources_with_url_and_retrieval_time'), 'an assertion without a source is not evidence')
  assert.ok(auditCaptureGaps({ ...base, sources: [{ url: 'https://x' }] }).includes('provenance_sources_with_url_and_retrieval_time'))
  assert.ok(auditCaptureGaps({ ...base, mlbId: null }).includes('mlb_identity'))
  assert.ok(auditCaptureGaps({ ...base, asOfDate: '10/5/2026' }).includes('as_of_date'))
  const noMlb = { ...base, conclusion: 'VERIFIED_NO_MLB', outcomeState: 'NO_MLB_CAREER_ENDED', mlbDebutDate: null, mlbDebutTeam: null, lastAffiliatedSeason: 2022 }
  assert.deepEqual(auditCaptureGaps(noMlb), [])
  assert.ok(auditCaptureGaps({ ...noMlb, lastAffiliatedSeason: null }).includes('no_mlb_evidence_last_affiliated_season_or_final_transaction'))
  assert.ok(auditCaptureGaps({ ...noMlb, mlbDebutDate: '2024-04-01' }).includes('no_mlb_result_must_not_carry_a_debut_date'))
  assert.ok(auditCaptureGaps({ ...noMlb, outcomeState: 'REACHED_MLB' }).includes('outcome_state_matches_conclusion'))
  for (const c of ['NOT_AUDITED', 'INSUFFICIENT_EVIDENCE']) assert.ok(auditCaptureGaps({ ...base, conclusion: c }).includes('conclusion_is_not_writable'), c)
})

// ---- the cohort -----------------------------------------------------------------------------------------------------------------

test('cohort selection and blockers: mature = signed five or more years before the as-of date; every unaudited player says why', () => {
  const d = dataset()
  const cohort = buildOutcomeCohort({ signings: d.signings, directory: d.directory, matureQueue: d.matureQueue, asOf: AS_OF })
  const by = Object.fromEntries(cohort.map((r) => [r.full_name, r]))
  assert.equal(by['Foxtrot Recent'].maturity, 'DEVELOPING')
  assert.deepEqual(by['Foxtrot Recent'].blockers.sort(), ['NOT_MATURE', 'NO_MLB_ID'])
  assert.deepEqual(by['Delta Active'].blockers, ['ACTIVE_IN_AFFILIATED_BALL_POLICY_HOLD'])
  assert.deepEqual(by['Echo Thin'].blockers, ['INSUFFICIENT_EVIDENCE'])
  assert.deepEqual(by['Charlie Never'].blockers, ['NOT_YET_RESEARCHED'])
  assert.equal(by['Charlie Never'].actionable_now, true)
  assert.equal(by['Delta Active'].actionable_now, false)
  assert.deepEqual(by['Alpha Mlb'].blockers, [], 'an audited player has no audit blockers')
  assert.equal(by['Charlie Never'].priority, 100 + NEVER_RESEARCHED_BONUS)
  assert.equal(by['Delta Active'].priority, 60)
  assert.equal(by['Foxtrot Recent'].priority, 0)
  const s = cohortSummary(cohort)
  assert.deepEqual([s.mature, s.mature_not_audited, s.developing_not_audited, s.mature_not_audited_actionable_now], [5, 3, 1, 1])
})

test('cohort ordering is deterministic and independent of input order; filters compose', () => {
  const d = dataset()
  const run = (signings) => buildOutcomeCohort({ signings, directory: d.directory, matureQueue: d.matureQueue, asOf: AS_OF }).map((r) => r.player_id)
  const forward = run(d.signings)
  assert.deepEqual(run([...d.signings].reverse()), forward)
  assert.deepEqual(run([d.signings[3], d.signings[0], d.signings[5], d.signings[1], d.signings[4], d.signings[2]]), forward)
  const cohort = buildOutcomeCohort({ signings: d.signings, directory: d.directory, matureQueue: d.matureQueue, asOf: AS_OF })
  assert.deepEqual(cohort.slice(0, 3).map((r) => r.full_name), ['Charlie Never', 'Delta Active', 'Echo Thin'], 'priority first, then class, date, name')
  assert.deepEqual(filterCohort(cohort, { mature: true, status: 'not_audited' }).map((r) => r.full_name), ['Charlie Never', 'Delta Active', 'Echo Thin'])
  assert.deepEqual(filterCohort(cohort, { mature: false, status: 'not_audited' }).map((r) => r.full_name), ['Foxtrot Recent'])
  assert.deepEqual(filterCohort(cohort, { year: 2021 }).map((r) => r.full_name), ['Delta Active', 'Echo Thin'])
  assert.deepEqual(filterCohort(cohort, { market: 'venezuela', limit: 2 }).length, 2)
  assert.deepEqual(filterCohort(cohort, { status: 'verified_no_mlb' }).map((r) => r.full_name), ['Bravo NoMlb'])
})

// ---- acquisition cost ----------------------------------------------------------------------------------------------------------

test('an UNKNOWN cost is never $0: NULL stays unknown, and a zero is a distinct, evidenced state', () => {
  const s = sign()
  assert.equal(costState(decision(s)), 'UNKNOWN')
  assert.equal(costState(decision(s, { cost_coverage_state: 'NO_RULE' })), 'NO_COST_RULE')
  assert.equal(costState(decision(s, { known_acquisition_cost_usd: '0', cost_coverage_state: 'COMPLETE' })), 'KNOWN_ZERO')
  assert.equal(costState(decision(s, { known_acquisition_cost_usd: '125000', cost_coverage_state: 'COMPLETE' })), 'KNOWN_COMPLETE')
  assert.equal(costState(decision(s, { known_acquisition_cost_usd: '125000', cost_coverage_state: 'PARTIAL' })), 'KNOWN_PARTIAL')
  assert.equal(costState(decision(s, { known_acquisition_cost_usd: '125000', cost_coverage_state: 'NO_RULE' })), 'KNOWN_UNJUDGED')
  const sum = costSummary([decision(s), decision(sign(), { known_acquisition_cost_usd: '100', cost_coverage_state: 'COMPLETE' }), decision(sign(), { known_acquisition_cost_usd: '0', cost_coverage_state: 'COMPLETE' })])
  assert.deepEqual([sum.known, sum.unknown, sum.known_spend_usd, sum.spend_is_lower_bound], [2, 1, 100, true])
  assert.equal(costSummary([decision(sign(), { known_acquisition_cost_usd: '5', cost_coverage_state: 'COMPLETE' })]).spend_is_lower_bound, false)
})

test('a researched cost is complete only with amount, currency, basis, source, retrieval date, evidence and confidence; zero needs explicit evidence', () => {
  const ok = { amount: 250000, currency: 'USD', amountBasis: 'EXACT', sourceUrl: 'https://example.org/a', retrievedAt: '2026-10-20', evidenceBasis: 'NEWS_REPORT', confidence: 'HIGH' }
  assert.deepEqual(costReportGaps(ok), [])
  assert.deepEqual(costReportGaps({ ...ok, amountBasis: 'ROUNDED' }), [])
  for (const [field, gap] of [['amount', 'amount'], ['currency', 'currency'], ['sourceUrl', 'source'], ['retrievedAt', 'retrieved_date'], ['evidenceBasis', 'evidence_basis'], ['confidence', 'confidence']]) {
    assert.ok(costReportGaps({ ...ok, [field]: undefined }).includes(gap), field)
  }
  assert.ok(costReportGaps({ ...ok, amountBasis: 'GUESS' }).includes('amount_basis_exact_rounded_approximate'))
  assert.ok(costReportGaps({ ...ok, amount: null }).includes('amount'), 'an unknown amount is not a report')
  assert.ok(costReportGaps({ ...ok, amount: NaN }).includes('amount'))
  assert.ok(costReportGaps({ ...ok, amount: -1 }).includes('amount'))
  assert.ok(costReportGaps({ ...ok, amount: 0 }).includes('zero_requires_explicit_evidence'))
  assert.deepEqual(costReportGaps({ ...ok, amount: 0, zeroEvidence: 'Source states no bonus was paid.' }), [])
})

test('cost research priority is a documented, deterministic tiering', () => {
  const mature = sign({ signing_year: 2012, outcome_audit_status: 'VERIFIED_NO_MLB', outcome_state: 'NO_MLB_CAREER_ENDED', reached_mlb_verified: false })
  const mlbRecent = sign({ signing_year: 2023, outcome_audit_status: 'VERIFIED_MLB', outcome_state: 'REACHED_MLB', reached_mlb_verified: true })
  const bigClass = sign({ signing_year: 2019 })
  const trade = sign({ signing_year: 2024 })
  const rest = sign({ signing_year: 2025 })
  const decisions = [
    decision(rest), decision(trade, { chain_status: 'COMPLETE_TERMINAL' }), decision(bigClass), decision(mlbRecent, { maturity_status: 'RECENT' }), decision(mature),
  ]
  const populations = [{ signing_year: 2019, expected_population: 50 }, { signing_year: 2025, expected_population: 5 }, { signing_year: 2024, expected_population: null }]
  assert.deepEqual([...largeClassYears(populations)], [2019])
  const q = costQueue(decisions, { populations })
  assert.deepEqual(q.map((r) => r.tier), [1, 2, 3, 4, 5])
  assert.deepEqual(q.map((r) => r.signing_id), [mature, mlbRecent, bigClass, trade, rest].map((s) => s.signing_id))
  assert.equal(costTier(decision(rest), { largeYears: new Set() }), 5)
  // determinism and filters
  assert.deepEqual(costQueue([...decisions].reverse(), { populations }).map((r) => r.signing_id), q.map((r) => r.signing_id))
  assert.equal(costQueue(decisions, { populations, mature: true }).length, 2, 'the 2012 audited signing and the unaudited 2019 signing are both mature')
  assert.equal(costQueue(decisions, { populations, mlb: true }).length, 1)
  assert.equal(costQueue(decisions, { populations, mlb: false }).length, 4)
  assert.equal(costQueue(decisions, { populations, limit: 2 }).length, 2)
  const withKnown = [...decisions, decision(sign(), { known_acquisition_cost_usd: '10', cost_coverage_state: 'COMPLETE' })]
  assert.equal(costQueue(withKnown, { populations, missing: true }).length, 5, '--missing excludes complete costs only')
})

// ---- transactions and attribution -----------------------------------------------------------------------------------------------

test('exit dispositions are explicit and unknown stays unknown', () => {
  assert.equal(dispositionOf('RELEASE'), 'RELEASED')
  assert.equal(dispositionOf('TRADE'), 'TRADED')
  assert.equal(dispositionOf('SALE'), 'SOLD_OR_ASSIGNED')
  assert.equal(dispositionOf('WAIVER'), 'SOLD_OR_ASSIGNED')
  assert.equal(dispositionOf('RULE5_SELECTION'), 'RULE_5_LOSS')
  assert.equal(dispositionOf('FREE_AGENCY'), 'FREE_AGENCY')
  assert.equal(dispositionOf('SOMETHING_ELSE'), 'UNKNOWN_DISPOSITION')
  assert.equal(dispositionOf(undefined), 'UNKNOWN_DISPOSITION')
})

test('attribution: package value is reported at package level, zero and NULL are not conflated', () => {
  const rows = [
    { chain_status: 'COMPLETE_TERMINAL', individually_attributable_trade_bwar: '1.5', package_first_hop_participation_bwar: null, value_left_organization_bwar: '1.5' },
    { chain_status: 'NO_TRADE_CHAIN', individually_attributable_trade_bwar: '0.0', package_first_hop_participation_bwar: '0.0', value_left_organization_bwar: '0.0' },
    { chain_status: 'COMPLETE_TERMINAL', individually_attributable_trade_bwar: null, package_first_hop_participation_bwar: '4.2', package_downstream_participation_bwar: '1.1', observable_not_attributable_bwar: '2', value_left_organization_bwar: null },
    { chain_status: 'INCOMPLETE_RETURN_UNRECORDED' },
  ]
  const a = attributionSummary(rows)
  assert.equal(a.individually_attributable_trade_value, 1, 'only the sole-asset trade is individually attributable; zero is a known no-value, not a value')
  assert.equal(a.package_first_hop_value, 1)
  assert.equal(a.package_downstream_value, 1)
  assert.equal(a.observable_not_attributable_value, 1)
  assert.equal(a.value_left_organization, 1)
  assert.equal(a.incomplete_chains, 1)
  assert.deepEqual(incompleteChains([
    { chain_status: 'INCOMPLETE_EXIT_NOT_RESEARCHED', signing_year: 1988, player_slug: 'b', full_name: 'B' },
    { chain_status: 'NO_TRADE_CHAIN', signing_year: 2000, player_slug: 'x', full_name: 'X' },
    { chain_status: 'INCOMPLETE_EXIT_NOT_RESEARCHED', signing_year: 1951, player_slug: 'a', full_name: 'A' },
  ]).map((r) => r.player_slug), ['a', 'b'])
})

test('transaction research items are ordered deterministically and filterable', () => {
  const transactionQueue = [
    { issue: 'CASH_AMOUNT_UNKNOWN', priority: 3, player_slug: 'z', event_key: 'e2' },
    { issue: 'EXIT_TRANSACTION_MISSING', priority: 1, player_slug: 'b', event_key: null },
    { issue: 'TRADE_RETURN_UNRECORDED', priority: 2, player_slug: 'a', event_key: 'e1' },
  ]
  const valueQueue = [
    { issue: 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED', priority: 2, player_slug: 'c', event_key: 'e3' },
    { issue: 'LINEAGE_BOUNDARY_NOTED', priority: 4, player_slug: 'd', event_key: null },
  ]
  const all = transactionResearchItems({ transactionQueue, valueQueue }, { missing: true })
  assert.deepEqual(all.map((r) => r.issue), ['EXIT_TRANSACTION_MISSING', 'TRADE_RETURN_UNRECORDED', 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED', 'CASH_AMOUNT_UNKNOWN'], 'a noted lineage boundary is not missing research')
  assert.deepEqual(transactionResearchItems({ transactionQueue: [...transactionQueue].reverse(), valueQueue: [...valueQueue].reverse() }, { missing: true }), all)
  assert.deepEqual(transactionResearchItems({ transactionQueue, valueQueue }, { unresolvedAttribution: true }).map((r) => r.issue), ['TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED'])
  assert.ok(transactionResearchItems({ transactionQueue, valueQueue }, { traded: true }).every((r) => r.event_key !== null))
})

// ---- readiness blockers ---------------------------------------------------------------------------------------------------------

const status = { tracked_signings: 220, outcome_audit_queue: 127, outcome_audits_completed: 93, signings_with_known_cost: 48, known_acquisition_cost_usd: 117377237.33, rate_eligible_populations: 0, class_members_missing: 3 }
const executive = { mature_signings: 98, signings_with_complete_cost: 44, supported_expected_value_models: 0, predictive_portfolio_recommendations: 0 }
const targets = [
  { target_key: 'T1', reference_population: 'POP', baseline_supported: false, labelled_n: 11, positive_n: 1, negative_n: 10, unaudited_n: 5, min_reference_n: 50, min_positives: 10, min_negatives: 10, additional_labels_needed: 39, additional_positives_needed: 9, additional_negatives_needed: 0 },
]
const populations = [
  { rate_eligible: false, rate_exclusion_reason: 'POPULATION_INCOMPLETE', unresolved_conflicts: 0 },
  { rate_eligible: false, rate_exclusion_reason: 'FULL_PERIOD_SIZE_UNKNOWN', unresolved_conflicts: 2 },
  { rate_eligible: false, rate_exclusion_reason: 'FULL_PERIOD_SIZE_UNKNOWN', unresolved_conflicts: 0 },
]
const evSupport = [{ value_model_key: 'M1', probability_target_key: 'T1', probability_supported: false, expected_value_supported: false, conditional_value_n: 0, min_conditional_n: 10, additional_conditional_observations_needed: 10 }]

test('readiness blockers state exact measured numbers and never imply a threshold the methodology does not define', () => {
  const r = readinessBlockers({ status, executive, targets, evSupport, populations, matureNotAudited: 7, decisionSupport: [{ optimization_eligible_candidates: 0 }] })
  const layer = Object.fromEntries(r.layers.map((l) => [l.key, l]))
  assert.deepEqual(r.layers.map((l) => l.key), ['OUTCOME_RATES', 'OUTCOME_PROBABILITIES', 'ACQUISITION_ECONOMICS', 'EXPECTED_VALUE', 'RECOMMENDATIONS'])
  const text = (l) => l.blockers.map((b) => b.statement).join('\n')
  assert.match(text(layer.OUTCOME_RATES), /127 of 220 tracked signings remain NOT_AUDITED/)
  assert.match(text(layer.OUTCOME_RATES), /7 of 98 mature signings remain NOT_AUDITED/)
  assert.match(text(layer.OUTCOME_RATES), /2 full signing periods have no source stating its size/)
  assert.match(text(layer.OUTCOME_RATES), /2 class-membership conflicts are unresolved/)
  assert.match(text(layer.OUTCOME_PROBABILITIES), /39 more needed to reach the minimum of 50/)
  assert.match(text(layer.OUTCOME_PROBABILITIES), /1 positive; 9 more needed/)
  assert.match(text(layer.OUTCOME_PROBABILITIES), /5 reference players remain NOT_AUDITED/)
  assert.match(text(layer.EXPECTED_VALUE), /depends on T1, which is not supported/)
  assert.match(text(layer.EXPECTED_VALUE), /0 of 10 required mature value observations/)
  assert.match(text(layer.RECOMMENDATIONS), /No expected-value model is supported/)
  assert.equal(layer.OUTCOME_RATES.state, 'NOT_SUPPORTED')
  assert.equal(layer.RECOMMENDATIONS.state, 'NOT_SUPPORTED')
  // acquisition economics: counts are facts; no pass/fail because the methodology defines no completeness threshold
  assert.equal(layer.ACQUISITION_ECONOMICS.state, 'NO_THRESHOLD_DEFINED')
  assert.match(layer.ACQUISITION_ECONOMICS.facts.map((f) => f.statement).join('\n'), /48 of 220 signings have a known acquisition cost/)
  assert.match(layer.ACQUISITION_ECONOMICS.facts.map((f) => f.statement).join('\n'), /lower bound; unknown costs are not counted as zero/)
  assert.doesNotMatch(JSON.stringify(layer.ACQUISITION_ECONOMICS), /insufficient|fails?|meets?/i)
})

test('readiness blockers are a pure function of the snapshot rows: same input, same output; support clears the blockers', () => {
  const input = { status, executive, targets, evSupport, populations, matureNotAudited: 7 }
  assert.equal(JSON.stringify(readinessBlockers(input)), JSON.stringify(readinessBlockers(structuredClone(input))))
  const supported = readinessBlockers({
    status: { ...status, rate_eligible_populations: 2, outcome_audit_queue: 0 }, executive: { ...executive, supported_expected_value_models: 1, predictive_portfolio_recommendations: 3 },
    targets: [{ ...targets[0], baseline_supported: true, additional_labels_needed: 0, additional_positives_needed: 0, unaudited_n: 0 }],
    evSupport: [{ ...evSupport[0], probability_supported: true, expected_value_supported: true, additional_conditional_observations_needed: 0 }],
    populations: [{ rate_eligible: true, rate_exclusion_reason: null, unresolved_conflicts: 0 }], matureNotAudited: 0,
  })
  const s = Object.fromEntries(supported.layers.map((l) => [l.key, l]))
  assert.equal(s.OUTCOME_RATES.state, 'SUPPORTED')
  assert.equal(s.OUTCOME_PROBABILITIES.state, 'SUPPORTED')
  assert.equal(s.EXPECTED_VALUE.state, 'SUPPORTED')
  assert.equal(s.RECOMMENDATIONS.state, 'SUPPORTED')
  assert.deepEqual(s.EXPECTED_VALUE.blockers, [])
  assert.deepEqual(s.RECOMMENDATIONS.blockers, [])
})

test('more audits never publish a rate: rate support comes only from rate-eligible populations, not from audit counts', () => {
  const r = readinessBlockers({ status: { ...status, outcome_audits_completed: 220, outcome_audit_queue: 0 }, executive, targets, evSupport, populations, matureNotAudited: 0 })
  const rates = r.layers.find((l) => l.key === 'OUTCOME_RATES')
  assert.equal(rates.state, 'NOT_SUPPORTED', 'a fully audited database with ineligible populations still has no rate')
  assert.ok(rates.blockers.some((b) => b.code === 'FULL_PERIOD_SIZE_UNKNOWN'))
  assert.equal(rates.blockers.some((b) => b.code === 'OUTCOME_AUDIT_INCOMPLETE_POPULATION'), false, 'audit completeness is reported truthfully as resolved')
  assert.equal(r.layers.find((l) => l.key === 'OUTCOME_PROBABILITIES').state, 'NOT_SUPPORTED')
})

// ---- queue breakdown and progress -----------------------------------------------------------------------------------------------

test('queue breakdown counts every item once, maps every known type and flags unmapped ones', () => {
  const d = dataset()
  const tasks = [
    { task_type: 'OUTCOME_AUDIT', priority: 30, signing_year: 2013, player_id: d.matureNever.player_id },
    { task_type: 'OUTCOME_AUDIT', priority: 70, signing_year: 2024, player_id: d.recent.player_id },
    { task_type: 'ACQUISITION_COST_UNKNOWN', priority: 10, signing_year: 2013, player_id: d.matureNever.player_id },
    { task_type: 'CLASS_MEMBERS_MISSING', priority: 95, signing_year: 2015, player_id: null },
    { task_type: 'BRAND_NEW_TYPE', priority: 1, signing_year: 2015, player_id: null },
  ]
  const b = queueBreakdown({ tasks, signings: d.signings, populations: [{ unresolved_conflicts: 2 }], transactionQueue: [{ issue: 'EXIT_TRANSACTION_MISSING', priority: 1, player_slug: d.mlb.player_slug }], valueQueue: [], asOf: AS_OF })
  assert.equal(b.totals.items, 5 + 1 + 2)
  const row = (type) => b.rows.find((r) => r.type === type)
  assert.deepEqual([row('OUTCOME_AUDIT').count, row('OUTCOME_AUDIT').affecting_mature, row('OUTCOME_AUDIT').blocking_analytical_eligibility, row('OUTCOME_AUDIT').priorities], [2, 1, 2, [30, 70]])
  assert.deepEqual([row('ACQUISITION_COST_UNKNOWN').blocking_cost_value_analysis, row('ACQUISITION_COST_UNKNOWN').blocking_analytical_eligibility], [1, 0])
  assert.deepEqual([row('CLASS_MEMBERS_MISSING').blocking_class_completeness, row('CLASS_MEMBERS_MISSING').affecting_mature], [1, 1], 'a class-level task is mature when its class year is')
  assert.deepEqual(b.unmapped, ['tasks:BRAND_NEW_TYPE'])
  assert.equal(row('UNRESOLVED_CLASS_MEMBERSHIP').count, 2)
  assert.equal(row('EXIT_TRANSACTION_MISSING').affecting_mature, 1)
})

test('progress reports differences only and keeps unknowns unknown', () => {
  const p = progressReport({ tracked_signings: 220, outcome_audit_queue: 127, signings_with_known_cost: 48 }, { tracked_signings: 220, outcome_audit_queue: 125, signings_with_known_cost: 55, known_acquisition_cost_usd: '9.5' })
  const by = Object.fromEntries(p.rows.map((r) => [r.field, r]))
  assert.equal(by.outcome_audit_queue.change, -2)
  assert.equal(by.signings_with_known_cost.change, 7)
  assert.equal(by.tracked_signings.change, 0)
  assert.equal(by.known_acquisition_cost_usd.change, null, 'no baseline value: no invented difference')
  assert.equal(p.changed, 2)
})

// ---- commands: read-only and deterministic --------------------------------------------------------------------------------------

function fixtureFile() {
  const d = dataset()
  const raw = {
    status: [{ ...status, generation_id: 3, source_data_as_of_date: AS_OF }], executive: [{ ...executive, source_data_as_of_date: AS_OF }], targets, evSupport, decisionSupport: [],
    decisions: d.signings.map((s) => decision(s)), signings: d.signings.map(({ outcome_state, ...rest }) => rest), directory: d.directory, sourceCounts: [], tasks: [],
    matureQueue: d.matureQueue, populations, transactionQueue: [], valueQueue: [], developmentQueue: [], periodQueue: [],
  }
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'disi-r046-')), 'dataset.json')
  fs.writeFileSync(file, JSON.stringify(raw))
  return file
}
const cli = (script, ...args) => spawnSync(process.execPath, [path.join(root, 'scripts/research', script), ...args], { encoding: 'utf8', env: { ...process.env, DISI_RESEARCH_DB_URL: '', DISI_VERIFY_DB_URL: '' } })

test('the research commands print identical output on every run and never need a database when given a dataset', () => {
  const file = fixtureFile()
  for (const [script, extra] of [['outcomes.mjs', ['--mature', '--status', 'not_audited']], ['costs.mjs', ['--missing']], ['transactions.mjs', ['--chains']], ['readiness.mjs', []], ['queue.mjs', []]]) {
    const a = cli(script, '--input', file, ...extra)
    const b = cli(script, '--input', file, ...extra)
    assert.equal(a.status, 0, `${script}: ${a.stderr}`)
    assert.equal(a.stdout, b.stdout, `${script} output is deterministic`)
    assert.ok(a.stdout.length > 50, String(script))
    assert.doesNotMatch(a.stdout, /\d{4}-\d{2}-\d{2}T\d{2}:/, `${script} prints no wall-clock time`)
  }
  const json = JSON.parse(cli('outcomes.mjs', '--input', file, '--mature', '--status', 'not_audited', '--format', 'json').stdout)
  assert.deepEqual(json.rows.map((r) => r.full_name), ['Charlie Never', 'Delta Active', 'Echo Thin'])
  assert.equal(json.summary.not_audited, 4)
  const csv = cli('outcomes.mjs', '--input', file, '--format', 'csv', '--limit', '1').stdout.split('\n').filter(Boolean)
  assert.equal(csv.length, 2)
  assert.match(csv[0], /^priority,signing_year,/)
})

test('without a dataset or a connection URL the commands refuse instead of guessing', () => {
  const r = cli('outcomes.mjs')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /No dataset/)
})

test('the database path is read-only and anon-only by construction', () => {
  const src = read('scripts/research/lib/source.mjs')
  assert.match(src, /begin read only/)
  assert.match(src, /set local role anon/)
  assert.doesNotMatch(src, /\b(insert|update|delete|truncate|alter|drop|create|grant)\b\s/i)
  const dataset = read('lib/research/dataset.js')
  for (const m of dataset.matchAll(/^\s+\w+: [`'"]((?:select|with)[^`'"]*)[`'"]/gms)) assert.match(m[1], /^\s*(select|with)\b/i)
  assert.doesNotMatch(dataset, /\b(insert into|update\s+\w+\s+set|delete from)\b/i)
  // none of the commands take a write option
  for (const f of ['outcomes', 'costs', 'transactions', 'readiness', 'progress', 'queue']) assert.doesNotMatch(read(`scripts/research/${f}.mjs`), /--(write|apply|commit)\b/, f)
})

// ---- the product: conservative, snapshot-only -----------------------------------------------------------------------------------

test('/prediction-readiness shows blockers derived from the snapshot rows and publishes no new number', () => {
  const page = read('app/prediction-readiness/page.js')
  assert.match(page, /const \{ live, error, overview, targets, evaluations, expectedValueSupport, blockers, evidence \} = await getReadinessData\(\)/)
  assert.match(page, /blockers\.layers\.map/)
  assert.match(page, /A count is not a verdict/)
  // the blocker text is rendered from the derived statements; the page holds no blocker numbers of its own
  assert.doesNotMatch(page, /127|\b48 of 220\b|NOT_AUDITED remain/)
  // support still comes from the existing gates: probabilities, expected values and recommendations are untouched
  assert.match(page, /readiness\.published \? Number\(overview\.non_null_probabilities\)/)
  assert.match(page, /readiness\.supportedExpectedValues > 0 \? readiness\.supportedExpectedValues : 'None'/)
  assert.match(page, /readiness\.recommendations > 0 \? readiness\.recommendations : 'None'/)
})

test('the readiness loader derives blockers from persisted product snapshots only, never from a live analytical view', () => {
  const data = read('lib/data.js')
  const body = data.slice(data.indexOf('export async function loadReadinessData'), data.indexOf('/** @param {any} [supabase] client override (tests) */\nexport async function getReadinessData'))
  const relations = [...body.matchAll(/\.from\('([a-z_0-9]+)'\)/g)].map((m) => m[1])
  assert.ok(relations.length >= 7)
  for (const r of relations) assert.match(r, /^product_/, r)
  assert.match(body, /readinessBlockers\(/)
})

test('the readiness layers never mark the economics layer supported or failing: no threshold exists to compare against', () => {
  const r = readinessBlockers({ status: { tracked_signings: 220, signings_with_known_cost: 220, outcome_audit_queue: 0 }, executive: { signings_with_complete_cost: 220, supported_expected_value_models: 0 }, targets: [], evSupport: [], matureNotAudited: 0 })
  const econ = r.layers.find((l) => l.key === 'ACQUISITION_ECONOMICS')
  assert.equal(econ.state, 'NO_THRESHOLD_DEFINED', 'even with every cost known, economics is a measurement, not a verdict')
  assert.deepEqual(econ.blockers, [])
})

// ---- the audit SQL generator refuses an audit that lacks its evidence --------------------------------------------------------------

test('auditCaptureReport separates gaps that stop an audit from gaps that are only reported', () => {
  const good = { conclusion: 'VERIFIED_MLB', asOfDate: AS_OF, mlbId: 1, rationale: 'debut', outcomeState: 'REACHED_MLB', mlbDebutDate: '2024-04-01', mlbDebutTeam: null, sources: [{ url: 'https://x', retrievedAt: '2026-10-05T00:00:00Z' }] }
  const r = auditCaptureReport(good)
  assert.deepEqual([r.writable, r.blocking, r.gaps], [true, [], ['mlb_debut_organization']], 'an ambiguous debut organization does not discard a sourced debut')
  assert.equal(auditCaptureReport({ ...good, sources: [] }).writable, false)
  assert.equal(auditCaptureReport({ ...good, mlbDebutDate: null }).writable, false)
  assert.equal(auditCaptureReport({ ...good, conclusion: 'INSUFFICIENT_EVIDENCE' }).writable, false)
})

test('outcome-sql-values writes an audit only when its capture is writable, and records the remaining gaps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disi-r046-sql-'))
  const source = [{ url: 'https://statsapi.mlb.com/api/v1/people/1', retrievedAt: '2026-10-05T00:00:00Z' }]
  const base = { signingYear: 2015, mlbId: 1, recommendation: 'VERIFIED_MLB', reachedMlb: true, reason: 'MLB debut 2020-07-24 in the MLB person record.', mlbDebutDate: '2020-07-24', mlbDebutTeam: 'Los Angeles Dodgers', sources: source }
  const records = [
    { ...base, name: 'Complete One', slug: 'complete-one' },
    { ...base, name: 'No Source', slug: 'no-source', mlbId: 2, sources: [] },
    { ...base, name: 'No Debut Date', slug: 'no-debut-date', mlbId: 3, mlbDebutDate: null },
    { ...base, name: 'Insufficient', slug: 'insufficient', mlbId: 4, recommendation: 'INSUFFICIENT_EVIDENCE', reachedMlb: false, mlbDebutDate: null, mlbDebutTeam: null },
  ]
  fs.writeFileSync(path.join(dir, 'outcomes.json'), JSON.stringify({ records }))
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/mlb/outcome-sql-values.mjs'), '--outcomes', path.join(dir, 'outcomes.json'), '--audit-date', AS_OF, '--out', path.join(dir, 'values.sql')], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const decisions = JSON.parse(fs.readFileSync(path.join(dir, 'values-decisions.json'), 'utf8')).records
  const by = Object.fromEntries(decisions.map((d) => [d.slug, d]))
  assert.equal(by['complete-one'].audited, true)
  assert.equal(by['no-source'].audited, false)
  assert.match(by['no-source'].decisionReason, /Audit capture incomplete \(provenance_sources_with_url_and_retrieval_time\)/)
  assert.equal(by['no-debut-date'].audited, false)
  assert.equal(by['insufficient'].audited, false)
  assert.equal(by['insufficient'].outcomeState, null, 'insufficient evidence never becomes a no-MLB state')
  const sql = fs.readFileSync(path.join(dir, 'values.sql'), 'utf8')
  const auditsBlock = sql.split('-- audits(')[1].split('-- sources(')[0]
  assert.match(auditsBlock, /complete-one/)
  assert.doesNotMatch(auditsBlock, /no-source|no-debut-date|insufficient/)
})

test('the release plan names the exact migration and rollback that are committed', () => {
  const plan = read('database/release/046-release-plan.md')
  for (const f of ['database/sql/046_outcome_cost_research_batch.sql', 'database/release/sql/rollback-046.sql']) {
    const bytes = fs.readFileSync(path.join(root, f))
    assert.ok(plan.includes(`\`${crypto.createHash('sha256').update(bytes).digest('hex')}\``), `${f}: sha256 in the plan`)
    assert.ok(plan.includes(`| \`${f}\` | ${bytes.length} |`), `${f}: byte count in the plan`)
  }
})
