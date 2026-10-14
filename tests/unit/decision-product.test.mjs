// The executive product (044): predictive numbers reach the interface only through lib/decision-display.js, which returns a number
// only for a supported row. With today's evidence (no supported 041 target) the interface therefore renders no probability, no
// expected value, no ranking and no recommendation - only the support state and what is needed. The new loaders run one query at a time.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  predictionReadiness, expectedValueCell, scenarioOptimization, decisionStateLabel, budgetStateLabel, NO_PROBABILITY_STATEMENT,
} from '../../lib/decision-display.js'
import { loadPortfolioData, loadReadinessData, loadDossierDecision, getPortfolioData, getReadinessData } from '../../lib/data.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function fakeClient(fixtures, { errorFor = {} } = {}) {
  const requests = []
  let inFlight = 0
  let maxInFlight = 0
  const client = {
    requests,
    get maxInFlight() { return maxInFlight },
    from(relation) {
      const req = { relation, calls: [] }
      requests.push(req)
      const builder = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') {
            return (resolve, reject) => {
              inFlight += 1
              maxInFlight = Math.max(maxInFlight, inFlight)
              return new Promise((done) => setTimeout(done, 1)).then(() => {
                inFlight -= 1
                const error = errorFor[relation] ?? null
                return { data: error ? null : fixtures[relation], error }
              }).then(resolve, reject)
            }
          }
          return (...args) => { req.calls.push([prop, ...args]); return builder }
        },
      })
      return builder
    },
  }
  return client
}

// today's executive overview row (canonical data as of 2026-10-05)
const TODAY = {
  analysis_as_of_date: '2026-10-05', dodgers_signings: 220, probability_targets: 4, supported_probability_targets: 0, non_null_probabilities: 0,
  expected_value_models: 1, supported_expected_value_models: 0, supported_expected_values: 0, predictive_portfolio_recommendations: 0,
  prediction_readiness_statement: NO_PROBABILITY_STATEMENT,
}

test('SUPPORT PROPAGATION (UI): with no supported target the interface publishes no probability, expected value or recommendation', () => {
  const r = predictionReadiness(TODAY)
  assert.equal(r.published, false)
  assert.equal(r.statement, 'DISI does not currently publish player outcome probabilities because the verified mature sample does not meet the minimum support threshold.')
  assert.deepEqual([r.supportedTargets, r.targets, r.supportedExpectedValues, r.recommendations], [0, 4, 0, 0])
  // a downstream count can never be displayed while its upstream model is unsupported, even if a row claimed otherwise
  const inconsistent = predictionReadiness({ ...TODAY, supported_expected_values: 12, predictive_portfolio_recommendations: 3 })
  assert.deepEqual([inconsistent.supportedExpectedValues, inconsistent.recommendations], [0, 0])
  // a missing overview is not support
  assert.equal(predictionReadiness(null).published, false)
})

test('expected value cells show a number only for a supported row; otherwise the state and its reason', () => {
  const unsupported = expectedValueCell({ expected_value_supported: false, expected_org_value_bwar: null, expected_value_state: 'PROBABILITY_NOT_SUPPORTED',
    expected_value_exclusion_reason: 'PROBABILITY_NOT_SUPPORTED:REFERENCE_POPULATION_NOT_SUPPORTED' })
  assert.deepEqual(unsupported, { supported: false, value: null, label: 'Not estimated: outcome probability not supported', reason: 'PROBABILITY_NOT_SUPPORTED:REFERENCE_POPULATION_NOT_SUPPORTED' })
  // a value on an unsupported row is never shown (and a zero is never invented)
  assert.equal(expectedValueCell({ expected_value_supported: false, expected_org_value_bwar: 0.4 }).value, null)
  assert.equal(expectedValueCell(undefined).supported, false)
  assert.deepEqual(expectedValueCell({ expected_value_supported: true, expected_org_value_bwar: '0.160' }).value, 0.16)
  // readiness rows: blockers become the reason
  const ready = expectedValueCell({ decision_support_state: 'HISTORICAL_CONTEXT_ONLY', decision_blockers: ['EXPECTED_VALUE_NOT_SUPPORTED', 'ACQUISITION_COST_UNKNOWN'] })
  assert.deepEqual([ready.supported, ready.label, ready.reason], [false, 'Historical context only', 'EXPECTED_VALUE_NOT_SUPPORTED, ACQUISITION_COST_UNKNOWN'])
})

test('portfolio scenarios show a selection only when value optimization is supported', () => {
  assert.deepEqual(scenarioOptimization({ value_optimization_state: 'VALUE_OPTIMIZATION_NOT_SUPPORTED', optimized_selection: null }),
    { supported: false, selection: [], expectedValue: null, label: 'Not supported: no candidate has a supported expected value' })
  // a selection without the supported state is ignored
  assert.equal(scenarioOptimization({ value_optimization_state: 'VALUE_OPTIMIZATION_NOT_SUPPORTED', optimized_selection: ['x'] }).supported, false)
  const ok = scenarioOptimization({ value_optimization_state: 'VALUE_OPTIMIZATION_SUPPORTED', optimized_selection: ['a', 'b'], optimized_expected_org_bwar: '0.8' })
  assert.deepEqual([ok.supported, ok.selection, ok.expectedValue], [true, ['a', 'b'], 0.8])
  assert.equal(decisionStateLabel('HISTORICAL_CONTEXT_ONLY'), 'Historical context only')
  assert.equal(budgetStateLabel('INDETERMINATE_UNKNOWN_COSTS'), 'Indeterminate: unknown costs')
})

test('pages never read a predictive column directly: probabilities, expected values and selections go through decision-display', () => {
  const pages = ['app/page.js', 'app/portfolio/page.js', 'app/prediction-readiness/page.js', 'app/players/[slug]/page.js']
  for (const p of pages) {
    const src = fs.readFileSync(path.join(root, p), 'utf8')
    assert.doesNotMatch(src, /\.(probability|probability_low_90|probability_high_90|expected_org_value_bwar|expected_direct_dodgers_bwar|optimized_selection|optimized_expected_org_bwar)\b/, p)
    assert.doesNotMatch(src, /<(meter|progress)\b/i, `${p}: no gauges`)
    assert.doesNotMatch(src, /\b(AI general manager|success predictor|signing oracle|predicted to (succeed|reach))\b/i, p)
  }
  // the readiness page shows a probability count only behind the published flag
  const readiness = fs.readFileSync(path.join(root, 'app/prediction-readiness/page.js'), 'utf8')
  assert.match(readiness, /readiness\.published \? Number\(overview\.non_null_probabilities\)/)
})

test('portfolio and readiness loaders run one query at a time and return the empty shape with a safe message on a timeout', async () => {
  const fixtures = {
    v_portfolio_decision_support: [{ decision_support_state: 'HISTORICAL_CONTEXT_ONLY', predictive_recommendations_total: 0 }],
    v_historical_portfolio_summary: [{ grain: 'ALL' }], v_portfolio_scenario_evaluation: [{ scenario_key: 'BASE_POOL' }],
    v_expected_value_support: [{ value_model_key: 'EXPECTED_DIRECT_DODGERS_BWAR_V1', expected_value_supported: false }],
    v_executive_overview: TODAY, v_prediction_readiness: [{ target_key: 'REACH_MLB_WITHIN_7_SEASONS' }], v_outcome_model_evaluation: [{ model_key: 'BASE_RATE' }],
  }
  const c1 = fakeClient(fixtures)
  const p = await loadPortfolioData(c1)
  assert.equal(c1.maxInFlight, 1)
  assert.deepEqual(c1.requests.map((r) => r.relation), ['v_portfolio_decision_support', 'v_historical_portfolio_summary', 'v_portfolio_scenario_evaluation', 'v_expected_value_support'])
  assert.equal(p.decisionSupport.length, 1)
  // the portfolio page never selects '*' from the heavy scenario / history views
  for (const r of c1.requests.filter((x) => ['v_historical_portfolio_summary', 'v_portfolio_scenario_evaluation'].includes(x.relation))) {
    assert.notEqual(r.calls.find((call) => call[0] === 'select')[1], '*')
  }
  const c2 = fakeClient(fixtures)
  const r = await loadReadinessData(c2)
  assert.equal(c2.maxInFlight, 1)
  assert.equal(r.overview.supported_probability_targets, 0)
  const timeout = { code: '57014', message: 'canceling statement due to statement timeout' }
  const failed = await getPortfolioData(fakeClient(fixtures, { errorFor: { v_portfolio_scenario_evaluation: timeout } }))
  assert.deepEqual([failed.live, failed.error, failed.scenarios], [false, 'The database did not respond in time. Please try again shortly.', []])
  const failed2 = await getReadinessData(fakeClient(fixtures, { errorFor: { v_executive_overview: timeout } }))
  assert.deepEqual([failed2.live, failed2.overview], [false, null])
})

test('dossier decision sections: sequential, skipped for non-Dodgers players, tolerant of a database without 042-044', async () => {
  const fixtures = {
    v_player_realized_organizational_value: [{ signing_id: 's1', signing_year: 2019 }],
    v_portfolio_candidate_readiness: [{ signing_id: 's1', decision_support_state: 'HISTORICAL_CONTEXT_ONLY' }],
    v_player_expected_organizational_value: [{ signing_id: 's1', expected_value_supported: false }],
    v_player_comparable_summary: [{ target_signing_id: 's1', comparables: 20 }],
  }
  const c = fakeClient(fixtures)
  const d = await loadDossierDecision(c, 'p1')
  assert.equal(c.maxInFlight, 1)
  assert.deepEqual([d.realizedValue.length, d.readiness.length, d.expectedValue.length, d.comparables.length, d.decisionAvailable], [1, 1, 1, 1, true])
  const none = fakeClient({ ...fixtures, v_player_realized_organizational_value: [] })
  const n = await loadDossierDecision(none, 'p2')
  assert.equal(none.requests.length, 1, 'no further query for a player without a Dodgers signing')
  assert.deepEqual([n.realizedValue, n.decisionAvailable], [[], true])
  const missing = await loadDossierDecision(fakeClient(fixtures, { errorFor: { v_player_realized_organizational_value: { code: 'PGRST205', message: 'not found' } } }), 'p3')
  assert.deepEqual([missing.realizedValue, missing.decisionAvailable], [[], false])
})
