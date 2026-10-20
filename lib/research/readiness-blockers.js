// Deterministic analytical-readiness blockers, derived only from persisted product snapshot rows. Nothing here is free text from a
// model: each blocker is a code plus the measured numbers, and the statement is built from those numbers.
//
// A measurement is never presented as passing or failing a threshold unless the documented methodology defines that threshold
// (the 041 support minimums and the 018 rate-eligibility rule). Everything else is a plain fact.

import { orderBy } from './cmp.js'

const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

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
  for (const [reason, count] of Object.entries(byReason).sort(([a], [b]) => (a < b ? -1 : 1))) {
    rateBlockers.push({ code: reason, measured: { populations: count }, statement: (REASON_TEXT[reason] ?? (() => `${count} populations are excluded: ${reason}`))(count) })
  }
  if (notAudited) rateBlockers.push({ code: 'OUTCOME_AUDIT_INCOMPLETE_POPULATION', measured: { not_audited: notAudited, tracked }, statement: `${notAudited} of ${tracked} tracked signings remain NOT_AUDITED` })
  if (d.matureNotAudited != null) {
    rateBlockers.push({ code: 'MATURE_COHORT_NOT_FULLY_AUDITED', measured: { mature_not_audited: d.matureNotAudited, mature: n(executive.mature_signings) }, statement: `${d.matureNotAudited} of ${n(executive.mature_signings) ?? 'the'} mature signings remain NOT_AUDITED` })
  }
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
    { code: 'KNOWN_SPEND_LOWER_BOUND', measured: { spend_usd: n(status.known_acquisition_cost_usd) }, statement: 'Known spend is a lower bound; unknown costs are not counted as zero' },
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
  const supportedTargets = targets.filter((t) => t.baseline_supported).length

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
      layer('OUTCOME_RATES', 'Organization outcome rates', eligible > 0, true, [{ code: 'RATE_ELIGIBLE_POPULATIONS', measured: { eligible }, statement: `${eligible} rate-eligible populations` }], rateBlockers),
      layer('OUTCOME_PROBABILITIES', 'Player outcome probabilities', supportedTargets > 0, true, [{ code: 'SUPPORTED_TARGETS', measured: { supported: supportedTargets, targets: targets.length }, statement: `${supportedTargets} of ${targets.length} target/population pairs meet their support minimum` }], probBlockers),
      layer('ACQUISITION_ECONOMICS', 'Acquisition economics', false, false, economicsFacts, economicsBlockers),
      layer('EXPECTED_VALUE', 'Expected organizational value', supportedModels > 0, true, evFacts, evBlockers),
      layer('RECOMMENDATIONS', 'Portfolio recommendations', (n(executive.predictive_portfolio_recommendations) ?? 0) > 0 && supportedModels > 0, true, [], recBlockers),
    ],
  }
}
