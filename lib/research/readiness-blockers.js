// Deterministic analytical-readiness blockers, derived only from persisted product snapshot rows. Nothing here is free text from a
// model: each blocker is a code plus the measured numbers, and the statement is built from those numbers.
//
// A measurement is never presented as passing or failing a threshold unless the documented methodology defines that threshold
// (the 041 support minimums and the 018 rate-eligibility rule). Everything else is a plain fact.

import { orderBy } from './cmp.js'

const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`
/** The only reference population player probabilities are made for (v_player_outcome_probability). */
export const DODGERS_REFERENCE_POPULATION = 'DODGERS_TRACKED_AND_OPENING_CLASS'

/**
 * @param {{
 *   status: any, executive?: any, targets?: any[], evSupport?: any[], populations?: any[], decisionSupport?: any[],
 *   matureNotAudited?: number | null
 * }} d
 */
export function readinessBlockers(d) {
  const status = d.status ?? {}
  const executive = d.executive ?? {}
  const targets = d.targets ?? []
  const evSupport = d.evSupport ?? []
  const populations = d.populations ?? []
  const decisionSupport = d.decisionSupport ?? []

  const tracked = n(status.tracked_signings)
  const notAudited = n(status.outcome_audit_queue)
  const audited = n(status.outcome_audits_completed)

  // ---- 1. organization-level outcome rates (018 rate-eligibility rule) ----------------------------------------------------
  const rateBlockers = []
  const eligible = n(status.rate_eligible_populations) ?? 0
  const byReason = {}
  for (const p of populations) if (!p.rate_eligible) byReason[p.rate_exclusion_reason] = (byReason[p.rate_exclusion_reason] ?? 0) + 1
  const REASON_TEXT = {
    POPULATION_INCOMPLETE: (c) => `${plural(c, 'full signing period has', 'full signing periods have')} a known population that is not fully tracked`,
    FULL_PERIOD_SIZE_UNKNOWN: (c) => `${plural(c, 'full signing period has', 'full signing periods have')} no source stating its size`,
    SCOPE_NOT_A_FULL_SIGNING_PERIOD: (c) => `${plural(c, 'population is', 'populations are')} an opening class, a sample or another scope that is not a full signing period`,
    OUTCOME_AUDIT_INCOMPLETE: (c) => `${plural(c, 'population has', 'populations have')} tracked members without an outcome audit`,
    NOT_YET_FIVE_YEAR_MATURE: (c) => `${plural(c, 'population is', 'populations are')} not yet five years old`,
  }
  if (populations.length) {
    for (const [reason, count] of Object.entries(byReason).sort(([a], [b]) => (a < b ? -1 : 1))) {
      rateBlockers.push({ code: reason, measured: { populations: count }, statement: (REASON_TEXT[reason] ?? (() => `${count} populations are excluded: ${reason}`))(count) })
    }
  } else if (n(status.full_periods_with_known_size) !== null) {
    // snapshot-only fallback (the website): the status row carries the full-period counts
    const known = n(status.full_periods_with_known_size)
    const complete = n(status.full_periods_complete) ?? 0
    rateBlockers.push(known === 0
      ? { code: 'FULL_PERIOD_SIZE_UNKNOWN', measured: { full_periods_with_known_size: 0 }, statement: 'No full signing period has a source stating its size' }
      : { code: 'FULL_PERIOD_POPULATION_NOT_COMPLETE', measured: { complete, known }, statement: `${complete} of ${known} full signing periods with a known size are completely tracked` })
  }
  if (notAudited) rateBlockers.push({ code: 'OUTCOME_AUDIT_INCOMPLETE_POPULATION', measured: { not_audited: notAudited, tracked }, statement: `${notAudited} of ${tracked} tracked signings remain NOT_AUDITED` })
  if (d.matureNotAudited > 0) {
    rateBlockers.push({ code: 'MATURE_COHORT_NOT_FULLY_AUDITED', measured: { mature_not_audited: d.matureNotAudited, mature: n(executive.mature_signings) }, statement: `${d.matureNotAudited} of ${n(executive.mature_signings) ?? 'the'} mature signings remain NOT_AUDITED` })
  }
  const matureTotal = n(executive.mature_signings)
  const matureFacts = d.matureNotAudited != null && matureTotal != null
    ? [{ code: 'MATURE_AUDIT_COVERAGE', measured: { audited: matureTotal - d.matureNotAudited, mature: matureTotal }, statement: `${matureTotal - d.matureNotAudited} of ${matureTotal} mature signings have an outcome audit` }] : []
  const unresolvedConflicts = populations.reduce((a, p) => a + (n(p.unresolved_conflicts) ?? 0), 0)
  if (unresolvedConflicts > 0) rateBlockers.push({ code: 'UNRESOLVED_CLASS_MEMBERSHIP_CONFLICT', measured: { conflicts: unresolvedConflicts }, statement: `${plural(unresolvedConflicts, 'class-membership conflict is', 'class-membership conflicts are')} unresolved` })
  const missingMembers = n(status.class_members_missing)
  if (missingMembers) rateBlockers.push({ code: 'CLASS_MEMBERS_MISSING', measured: { missing: missingMembers }, statement: `${plural(missingMembers, 'expected class signee is', 'expected class signees are')} not yet in the database` })

  // ---- 2. acquisition economics ----------------------------------------------------------------------------------------------
  const knownCost = n(status.signings_with_known_cost) ?? n(executive.signings_with_known_cost)
  const completeCost = n(executive.signings_with_complete_cost)
  const economicsFacts = [
    { code: 'KNOWN_COST_COVERAGE', measured: { known: knownCost, tracked }, statement: `${knownCost} of ${tracked} signings have a known acquisition cost` },
    ...(completeCost != null ? [{ code: 'COMPLETE_COST_COVERAGE', measured: { complete: completeCost, tracked }, statement: `${completeCost} of ${tracked} signings have every required cost component known; only those are eligible for cost-aware ratios` }] : []),
    tracked != null && knownCost != null && tracked - knownCost > 0
      ? { code: 'KNOWN_SPEND_LOWER_BOUND', measured: { spend_usd: n(status.known_acquisition_cost_usd) }, statement: 'Known spend is a lower bound; unknown costs are not counted as zero' }
      : { code: 'KNOWN_SPEND_COMPLETE_COVERAGE', measured: { spend_usd: n(status.known_acquisition_cost_usd) }, statement: 'Every tracked signing has a known acquisition cost' },
  ]
  const economicsBlockers = []
  if (tracked != null && knownCost != null && tracked - knownCost > 0) economicsBlockers.push({ code: 'ACQUISITION_COST_UNKNOWN', measured: { unknown: tracked - knownCost, tracked }, statement: `${tracked - knownCost} of ${tracked} signings have no known acquisition cost` })
  if (notAudited) economicsBlockers.push({ code: 'OUTCOME_AUDIT_INCOMPLETE', measured: { not_audited: notAudited }, statement: `${notAudited} signings remain NOT_AUDITED, so cost per outcome cannot be judged for them` })

  // ---- 3. outcome probabilities (041 support minimums) -------------------------------------------------------------------------
  const probBlockers = []
  for (const t of [...targets].sort(orderBy([(r) => r.target_key, 'asc'], [(r) => r.reference_population, 'asc']))) {
    if (t.baseline_supported) continue
    const label = `${t.target_key} / ${t.reference_population}`
    if (n(t.additional_labels_needed) > 0) probBlockers.push({ code: 'INSUFFICIENT_LABELLED_OUTCOMES', target: label, measured: { labelled: n(t.labelled_n), minimum: n(t.min_reference_n), needed: n(t.additional_labels_needed) }, statement: `${label}: ${plural(Number(t.labelled_n), 'labelled outcome', 'labelled outcomes')}; ${t.additional_labels_needed} more needed to reach the minimum of ${t.min_reference_n}` })
    if (n(t.additional_positives_needed) > 0) probBlockers.push({ code: 'INSUFFICIENT_POSITIVES', target: label, measured: { positives: n(t.positive_n), minimum: n(t.min_positives), needed: n(t.additional_positives_needed) }, statement: `${label}: ${plural(Number(t.positive_n), 'positive', 'positives')}; ${t.additional_positives_needed} more needed to reach the minimum of ${t.min_positives}` })
    if (n(t.additional_negatives_needed) > 0) probBlockers.push({ code: 'INSUFFICIENT_NEGATIVES', target: label, measured: { negatives: n(t.negative_n), minimum: n(t.min_negatives), needed: n(t.additional_negatives_needed) }, statement: `${label}: ${plural(Number(t.negative_n), 'negative', 'negatives')}; ${t.additional_negatives_needed} more needed to reach the minimum of ${t.min_negatives}` })
    if (n(t.unaudited_n) > 0) probBlockers.push({ code: 'REFERENCE_PLAYERS_NOT_AUDITED', target: label, measured: { not_audited: n(t.unaudited_n) }, statement: `${label}: ${t.unaudited_n} reference players remain NOT_AUDITED` })
  }
  // BENCHMARK SUPPORT != DODGERS SUPPORT (050): player probabilities are made only for the Dodgers tracked / opening-class population, so only
  // that population's support makes the layer supported. A baseline supported in the rank-selected benchmark sample is a reference result,
  // reported as a fact of its own; it never supports a Dodgers probability, and populations are never pooled.
  const supportedTargets = targets.filter((t) => t.baseline_supported && t.reference_population === DODGERS_REFERENCE_POPULATION).length
  const benchmarkBaselines = targets.filter((t) => t.baseline_supported && t.reference_population !== DODGERS_REFERENCE_POPULATION)
  const dodgersPairs = targets.filter((t) => t.reference_population === DODGERS_REFERENCE_POPULATION).length

  // ---- 4. expected value --------------------------------------------------------------------------------------------------------
  const evBlockers = []
  for (const m of [...evSupport].sort(orderBy([(r) => r.value_model_key, 'asc']))) {
    if (m.expected_value_supported) continue
    if (!m.probability_supported) evBlockers.push({ code: 'UNSUPPORTED_OUTCOME_PROBABILITY', model: m.value_model_key, measured: { target: m.probability_target_key }, statement: `${m.value_model_key} depends on ${m.probability_target_key}, which is not supported` })
    if (n(m.additional_conditional_observations_needed) > 0) evBlockers.push({ code: 'INSUFFICIENT_CONDITIONAL_SAMPLE', model: m.value_model_key, measured: { observed: n(m.conditional_value_n), minimum: n(m.min_conditional_n) }, statement: `${m.value_model_key}: ${m.conditional_value_n} of ${m.min_conditional_n} required mature value observations` })
  }
  const evFacts = completeCost == null ? [] : [{ code: 'COST_NOT_A_GATE', measured: { complete: completeCost, tracked }, statement: `The current expected-value model values direct Dodgers bWAR and does not use cost; cost-aware ratios exist only for the ${completeCost} signings with complete cost` }]

  // ---- 5. recommendations (inherit every layer below) -----------------------------------------------------------------------------
  const supportedModels = n(executive.supported_expected_value_models) ?? evSupport.filter((m) => m.expected_value_supported).length
  const recBlockers = []
  if (!supportedModels) recBlockers.push({ code: 'UNSUPPORTED_EXPECTED_VALUE', measured: { supported_models: 0 }, statement: 'No expected-value model is supported, so no portfolio recommendation can be published' })
  const eligibleCandidates = decisionSupport.reduce((a, r) => a + (n(r.optimization_eligible_candidates) ?? 0), 0)
  if (!supportedModels && decisionSupport.length) recBlockers.push({ code: 'NO_OPTIMIZATION_ELIGIBLE_CANDIDATE', measured: { eligible: eligibleCandidates }, statement: `${eligibleCandidates} candidates are eligible for portfolio optimization` })

  const layer = (key, label, supported, thresholdDefined, facts, blockers) => ({
    key, label, state: supported ? 'SUPPORTED' : thresholdDefined ? 'NOT_SUPPORTED' : 'NO_THRESHOLD_DEFINED', facts, blockers,
  })
  return {
    measured: { tracked, audited, not_audited: notAudited },
    layers: [
      layer('OUTCOME_RATES', 'Organization outcome rates', eligible > 0, true, [{ code: 'RATE_ELIGIBLE_POPULATIONS', measured: { eligible }, statement: `${eligible} rate-eligible ${eligible === 1 ? 'population' : 'populations'}` }, ...matureFacts], rateBlockers),
      layer('OUTCOME_PROBABILITIES', 'Player outcome probabilities', supportedTargets > 0, true, [
        { code: 'SUPPORTED_TARGETS', measured: { supported: supportedTargets, targets: dodgersPairs }, statement: `${supportedTargets} of ${dodgersPairs} Dodgers targets meet their support minimum` },
        ...benchmarkBaselines.map((t) => ({ code: 'BENCHMARK_REFERENCE_BASELINE_SUPPORTED', target: `${t.target_key} / ${t.reference_population}`,
          measured: { labelled: n(t.labelled_n), positives: n(t.positive_n), negatives: n(t.negative_n) },
          statement: `${t.target_key} meets its support minimum in the rank-selected benchmark sample (${t.labelled_n} labelled, ${t.positive_n} positive, ${t.negative_n} negative). It is a reference result for that sample only and is never used for a Dodgers player's probability.` })),
      ], probBlockers.filter((b) => String(b.target ?? '').endsWith(` / ${DODGERS_REFERENCE_POPULATION}`))),
      layer('ACQUISITION_ECONOMICS', 'Acquisition economics', false, false, economicsFacts, economicsBlockers),
      layer('EXPECTED_VALUE', 'Expected organizational value', supportedModels > 0, true, evFacts, evBlockers),
      layer('RECOMMENDATIONS', 'Portfolio recommendations', (n(executive.predictive_portfolio_recommendations) ?? 0) > 0 && supportedModels > 0, true, [], recBlockers),
    ],
  }
}

/** Mature signings without an outcome audit, from product_player_decision rows (maturity_status, outcome_state). */
export function matureNotAuditedFrom(decisions) {
  return decisions.filter((d) => d.maturity_status === 'MATURE' && !d.outcome_state).length
}

/**
 * 047: development-history and transaction evidence gaps. These are REPORTED, not gates: no probability, expected-value or
 * recommendation layer is blocked by them unless its methodology says so (041/042 do not use them). Codes reuse the names DISI already
 * raises (SIGNING_DATE_MISSING, EXIT_TRANSACTION_MISSING, TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED ...); no queue category is duplicated.
 *
 * @param {{ decisions?: any[], development?: { signings: number, dimensions: Record<string, { known: number, applicable: number }> } | null,
 *           packages?: { packages_with_open_issues: number, unresolved_attribution_signings: number } | null, attributionCounts?: Record<string, number> | null }} d
 */
export function evidenceBlockers(d) {
  const out = []
  const decisions = d.decisions ?? []
  const dim = d.development?.dimensions
  const gap = (code, key, text) => {
    const x = dim?.[key]
    if (x && x.applicable - x.known > 0) out.push({ code, measured: { missing: x.applicable - x.known, applicable: x.applicable }, statement: `${x.applicable - x.known} of ${x.applicable} ${text}` })
  }
  gap('SIGNING_DATE_MISSING', 'SIGNING_DATE', 'tracked signings have no signing date')
  gap('FIRST_PRO_SEASON_UNKNOWN', 'FIRST_PRO_SEASON', 'tracked signings have no known first professional season')
  gap('HIGHEST_LEVEL_UNKNOWN', 'HIGHEST_LEVEL', 'tracked signings have no known highest level (a verified MLB debut counts as MLB)')
  gap('MLB_DEBUT_UNKNOWN', 'MLB_DEBUT', 'verified MLB signings have no recorded debut date')
  gap('EXIT_TRANSACTION_MISSING', 'EXIT', 'signings that may have left the organization have no verified exit transaction')
  gap('CHRONOLOGY_INCOMPLETE', 'CHRONOLOGY', 'tracked signings have an affiliate chronology too incomplete for timing analysis')
  const incomplete = decisions.filter((r) => String(r.chain_status).startsWith('INCOMPLETE')).length
  if (incomplete > 0) out.push({ code: 'TRANSACTION_CHAIN_INCOMPLETE', measured: { incomplete, signings: decisions.length }, statement: `${incomplete} of ${decisions.length} signings have an incomplete transaction chain` })
  const pk = d.packages
  if (pk && pk.packages_with_open_issues > 0) out.push({ code: 'TRADE_PACKAGE_INCOMPLETE', measured: { packages: pk.packages_with_open_issues }, statement: `${pk.packages_with_open_issues} trade packages have an open issue (return, cash, PTBNL, future considerations or pool space)` })
  const unresolved = pk?.unresolved_attribution_signings ?? 0
  if (unresolved > 0) out.push({ code: 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED', measured: { signings: unresolved }, statement: `${unresolved} signings were traded in a shared package whose return is not credited to any one player` })
  return out
}
