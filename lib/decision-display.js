// Display rules for DISI's predictive layers (041 outcome probability, 042 expected value, 043 portfolio decision support).
//
// Pages render predictive numbers ONLY through these functions. A number is returned only when the row's own support state says it is
// supported; otherwise the caller gets the support state and its reason. This is what keeps an unsupported probability from turning
// into a fake expected value, a fake ranking or a fake recommendation in the interface (database/research/042/final-decision-architecture.md).

export const NO_PROBABILITY_STATEMENT =
  'DISI does not currently publish player outcome probabilities because the verified mature sample does not meet the minimum support threshold.'

/** @type {Record<string, string>} */
const DECISION_STATE_LABELS = {
  PREDICTIVE_DECISION_SUPPORTED: 'Decision supported',
  HISTORICAL_CONTEXT_ONLY: 'Historical context only',
  INSUFFICIENT_OUTCOME_SUPPORT: 'Insufficient outcome support',
  INSUFFICIENT_COST_DATA: 'Insufficient cost data',
  INSUFFICIENT_PLAYER_DATA: 'Insufficient player data',
  OUT_OF_SCOPE: 'Out of scope',
}

/** @type {Record<string, string>} */
const EXPECTED_VALUE_STATE_LABELS = {
  EXPECTED_VALUE_SUPPORTED: 'Expected value supported',
  PROBABILITY_NOT_SUPPORTED: 'Not estimated: outcome probability not supported',
  CONDITIONAL_VALUE_NOT_SUPPORTED: 'Not estimated: too few value observations',
  OUT_OF_SCOPE: 'Not estimated: outside the modelled population',
}

/** @type {Record<string, string>} */
const REALIZED_VALUE_STATE_LABELS = {
  REALIZED_TO_DATE: 'Realized to date',
  TO_DATE_CHAIN_INCOMPLETE: 'Known so far (transaction chain incomplete)',
  VALUE_UNRESOLVED: 'Unresolved',
  OUTCOME_NOT_OBSERVED: 'Outcome not yet observed',
}

/** @param {string | null | undefined} state */
export function decisionStateLabel(state) {
  return (state && DECISION_STATE_LABELS[state]) || 'Unknown'
}

/** @param {string | null | undefined} state */
export function expectedValueStateLabel(state) {
  return (state && EXPECTED_VALUE_STATE_LABELS[state]) || 'Not estimated'
}

/** @param {string | null | undefined} state */
export function realizedValueStateLabel(state) {
  return (state && REALIZED_VALUE_STATE_LABELS[state]) || 'Unknown'
}

/**
 * The prediction-readiness headline for the executive overview row (v_executive_overview).
 * @param {any} overview
 * @returns {{ published: boolean, statement: string, supportedTargets: number, targets: number, supportedExpectedValues: number, recommendations: number }}
 */
export function predictionReadiness(overview) {
  const supportedTargets = Number(overview?.supported_probability_targets ?? 0)
  const published = supportedTargets > 0 && Number(overview?.non_null_probabilities ?? 0) > 0
  return {
    published,
    statement: published ? String(overview.prediction_readiness_statement) : NO_PROBABILITY_STATEMENT,
    supportedTargets,
    targets: Number(overview?.probability_targets ?? 0),
    // a downstream count is shown only when its upstream support exists; otherwise it is 0 by construction
    supportedExpectedValues: Number(overview?.supported_expected_value_models ?? 0) > 0 ? Number(overview?.supported_expected_values ?? 0) : 0,
    recommendations: Number(overview?.supported_expected_value_models ?? 0) > 0 ? Number(overview?.predictive_portfolio_recommendations ?? 0) : 0,
  }
}

/**
 * An expected-value cell: the number only when the row is supported; otherwise the state and its reason.
 * @param {any} row a v_player_expected_organizational_value or v_portfolio_candidate_readiness row
 * @returns {{ supported: boolean, value: number | null, label: string, reason: string | null }}
 */
export function expectedValueCell(row) {
  const supported = row?.expected_value_supported === true || row?.decision_support_state === 'PREDICTIVE_DECISION_SUPPORTED'
  if (supported && row?.expected_org_value_bwar != null) {
    return { supported: true, value: Number(row.expected_org_value_bwar), label: expectedValueStateLabel('EXPECTED_VALUE_SUPPORTED'), reason: null }
  }
  return {
    supported: false,
    value: null,
    label: row?.expected_value_state ? expectedValueStateLabel(row.expected_value_state) : decisionStateLabel(row?.decision_support_state),
    reason: row?.expected_value_exclusion_reason ?? (Array.isArray(row?.decision_blockers) ? row.decision_blockers.join(', ') : null),
  }
}

/**
 * A portfolio scenario's optimization result: a selection only when value optimization is supported.
 * @param {any} scenario a v_portfolio_scenario_evaluation row
 * @returns {{ supported: boolean, selection: string[], expectedValue: number | null, label: string }}
 */
export function scenarioOptimization(scenario) {
  if (scenario?.value_optimization_state === 'VALUE_OPTIMIZATION_SUPPORTED' && Array.isArray(scenario.optimized_selection)) {
    return { supported: true, selection: scenario.optimized_selection, expectedValue: Number(scenario.optimized_expected_org_bwar), label: 'Value-maximizing feasible selection' }
  }
  return {
    supported: false,
    selection: [],
    expectedValue: null,
    label: scenario?.value_optimization_state === 'VALUE_OPTIMIZATION_TOO_LARGE_FOR_EXACT_SEARCH'
      ? 'Too many eligible candidates for an exact search'
      : 'Not supported: no candidate has a supported expected value',
  }
}

/** @type {Record<string, string>} */
const BUDGET_STATE_LABELS = {
  WITHIN_BUDGET_ON_COMPLETE_COSTS: 'Within budget (all costs known)',
  EXCEEDS_BUDGET_ON_KNOWN_COSTS: 'Exceeds budget on known costs',
  INDETERMINATE_UNKNOWN_COSTS: 'Indeterminate: unknown costs',
  NO_POOL_REPORTED: 'No pool reported',
  NO_CANDIDATES: 'No candidates',
}

/** @param {string | null | undefined} state */
export function budgetStateLabel(state) {
  return (state && BUDGET_STATE_LABELS[state]) || 'Unknown'
}
