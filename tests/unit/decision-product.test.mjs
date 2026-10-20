// The executive product (044): predictive numbers reach the interface only through lib/decision-display.js, which returns a number
// only for a supported row. With today's evidence (no supported 041 target) the interface therefore renders no probability, no
// expected value, no ranking and no recommendation - only the support state and what is needed. The new loaders run one query at a time.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  predictionReadiness, expectedValueCell, scenarioOptimization, decisionStateLabel, budgetStateLabel, NO_PROBABILITY_STATEMENT, snapshotFreshness,
} from '../../lib/decision-display.js'
import { loadPortfolioData, loadReadinessData, loadDossierDecision, getPortfolioData, getReadinessData, readinessFromPlayerDecision } from '../../lib/data.js'

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

const SNAPSHOT_TODAY = { ...TODAY, generation_id: 1, generated_at: '2026-10-14T23:11:15Z', snapshot_as_of_date: '2026-10-14', source_data_as_of_date: '2026-10-05',
  product_version: 'DISI v1.0.0', schema_version: 'v0.36.1', support_chain_state: 'NO_PREDICTIVE_LAYER_SUPPORTED' }

test('portfolio and readiness loaders read only the persisted snapshots, one query at a time, and return the empty shape with a safe message on a timeout', async () => {
  const fixtures = {
    product_portfolio_decision_support: [{ decision_support_state: 'HISTORICAL_CONTEXT_ONLY', predictive_recommendations_total: 0 }],
    product_portfolio_history: [{ grain: 'ALL' }], product_portfolio_scenarios: [{ scenario_key: 'BASE_POOL' }],
    product_expected_value_support: [{ value_model_key: 'EXPECTED_DIRECT_DODGERS_BWAR_V1', expected_value_supported: false }],
    product_executive_snapshot: SNAPSHOT_TODAY, product_prediction_readiness: [{ target_key: 'REACH_MLB_WITHIN_7_SEASONS' }], product_model_evaluations: [{ model_key: 'BASE_RATE' }],
    product_database_status: { tracked_signings: 220, outcome_audit_queue: 127, signings_with_known_cost: 48 }, product_player_decision: [{ maturity_status: 'MATURE', outcome_state: null }],
  }
  const c1 = fakeClient(fixtures)
  const p = await loadPortfolioData(c1)
  assert.equal(c1.maxInFlight, 1)
  assert.deepEqual(c1.requests.map((r) => r.relation), ['product_executive_snapshot', 'product_portfolio_decision_support', 'product_portfolio_history', 'product_portfolio_scenarios', 'product_expected_value_support'])
  assert.equal(p.decisionSupport.length, 1)
  assert.equal(snapshotFreshness(p.freshness), 'Snapshot generated 2026-10-14 · source data as of 2026-10-05 · DISI v1.0.0')
  // the portfolio page selects column lists from the larger snapshots
  for (const r of c1.requests.filter((x) => ['product_portfolio_history', 'product_portfolio_scenarios'].includes(x.relation))) {
    assert.notEqual(r.calls.find((call) => call[0] === 'select')[1], '*')
  }
  const c2 = fakeClient(fixtures)
  const r = await loadReadinessData(c2)
  assert.equal(c2.maxInFlight, 1)
  assert.deepEqual(c2.requests.map((x) => x.relation), ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_database_status', 'product_portfolio_decision_support', 'product_player_decision'])
  assert.ok(r.blockers.layers.some((l) => l.key === 'OUTCOME_RATES' && l.blockers.some((b) => /127 of 220 tracked signings remain NOT_AUDITED/.test(b.statement))))
  assert.equal(r.overview.supported_probability_targets, 0)
  assert.equal(predictionReadiness(r.overview).statement, NO_PROBABILITY_STATEMENT)
  const timeout = { code: '57014', message: 'canceling statement due to statement timeout' }
  const failed = await getPortfolioData(fakeClient(fixtures, { errorFor: { product_portfolio_scenarios: timeout } }))
  assert.deepEqual([failed.live, failed.error, failed.scenarios], [false, 'The database did not respond in time. Please try again shortly.', []])
  const failed2 = await getReadinessData(fakeClient(fixtures, { errorFor: { product_executive_snapshot: timeout } }))
  assert.deepEqual([failed2.live, failed2.overview], [false, null])
})

test('dossier decision sections: persisted per-player snapshots, sequential, skipped for non-Dodgers players, tolerant of a database without them', async () => {
  const fixtures = {
    product_player_decision: [{ signing_id: 's1', signing_year: 2019, realized_value_state: 'REALIZED_TO_DATE', cost_complete: true, cost_coverage_state: 'COMPLETE',
      decision_support_state: 'HISTORICAL_CONTEXT_ONLY', readiness_cost_complete: false, readiness_cost_coverage_state: 'PARTIAL', player_data_complete: true }],
    product_player_expected_value: [{ signing_id: 's1', expected_value_supported: false }],
    product_player_comparables: [{ target_signing_id: 's1', comparables: 20 }],
    product_executive_snapshot: SNAPSHOT_TODAY,
  }
  const c = fakeClient(fixtures)
  const d = await loadDossierDecision(c, 'p1')
  assert.equal(c.maxInFlight, 1)
  assert.deepEqual(c.requests.map((x) => x.relation), ['product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_executive_snapshot'])
  assert.deepEqual([d.realizedValue.length, d.readiness.length, d.expectedValue.length, d.comparables.length, d.decisionAvailable], [1, 1, 1, 1, true])
  // realized value keeps its own cost columns; the readiness row gets the decision-time ones back under their 043 names
  assert.deepEqual([d.realizedValue[0].cost_complete, d.readiness[0].cost_complete, d.readiness[0].cost_coverage_state], [true, false, 'PARTIAL'])
  assert.deepEqual(readinessFromPlayerDecision(fixtures.product_player_decision[0]).decision_support_state, 'HISTORICAL_CONTEXT_ONLY')
  assert.match(snapshotFreshness(d.freshness) ?? '', /^Snapshot generated 2026-10-14/)
  const none = fakeClient({ ...fixtures, product_player_decision: [] })
  const n = await loadDossierDecision(none, 'p2')
  assert.equal(none.requests.length, 1, 'no further query for a player without a Dodgers signing')
  assert.deepEqual([n.realizedValue, n.decisionAvailable], [[], true])
  const missing = await loadDossierDecision(fakeClient(fixtures, { errorFor: { product_player_decision: { code: 'PGRST205', message: 'not found' } } }), 'p3')
  assert.deepEqual([missing.realizedValue, missing.decisionAvailable], [[], false])
})

test('serving boundary: the application reads the 042-045 product only through the persisted snapshots, never the analytical layer', async () => {
  const { INTERNAL_VIEWS, CONTRACT_REMOVED_EARLIER, SNAPSHOT_TABLES, STAGED_FUNCTIONS, SERVING_FUNCTIONS } = await import('../../database/research/045a/snapshots.mjs')
  const files = ['lib/data.js', ...fs.readdirSync(path.join(root, 'app'), { recursive: true }).filter((f) => String(f).endsWith('.js')).map((f) => path.join('app', String(f)))]
  const reads = new Set()
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8')
    for (const m of src.matchAll(/\.from\('([a-z_0-9]+)'\)/g)) reads.add(m[1])
    for (const fn of [...STAGED_FUNCTIONS, ...SERVING_FUNCTIONS]) assert.ok(!src.includes(fn), `${f} must not call ${fn}`)
    assert.doesNotMatch(src, /\.rpc\(/, `${f}: no RPC call`)
  }
  for (const v of [...INTERNAL_VIEWS, ...CONTRACT_REMOVED_EARLIER]) assert.ok(!reads.has(v), `the app must not read ${v}`)
  for (const t of SNAPSHOT_TABLES) assert.ok(reads.has(t), `the app reads ${t}`)
})
