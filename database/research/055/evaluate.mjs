#!/usr/bin/env node
// The 041 out-of-time model evaluation, re-run on the 055 data -> database/research/055/evaluation.json.
//
//   node database/research/055/evaluate.mjs [--dump <post-054a PGlite data-dir tar>]
//
// 055 adds labelled rows, so the training set the stored evaluation (050) was computed on no longer matches the live data (its fingerprint
// would go stale), exactly as when 050 added the 2015 and 2016 classes. This re-runs EXACTLY the 041 evaluation (database/research/041/evaluate.mjs): the same target (REACH_MLB_WITHIN_7_SEASONS),
// the same rows (TRAINING_ELIGIBLE and BENCHMARK_SAMPLE_ONLY rows with complete signing-time features), the same three models (BASE_RATE,
// POPULATION_STRATIFIED_RATE, LOGISTIC_L2 with lambda 1), the same leave-one-signing-year-out validation, the same metrics and the same
// support rule (MODEL_SUPPORTED only with events_per_feature positives per feature AND a positive out-of-time Brier skill). No new model, no
// tuning: this file is database/research/050/evaluate.mjs with only its chain, paths and labels changed. The data is the canonical
// 001-054a chain plus the 055 migration built without its evaluation update (assemble(null)).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { assemble } from './build.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const targets = JSON.parse(fs.readFileSync(path.join(here, '../041/targets.json'), 'utf8')).targets
const TARGET = 'REACH_MLB_WITHIN_7_SEASONS'
const target = targets.find((t) => t.target_key === TARGET)
const MODEL_VERSION = 'outcome-probability-v1'
const FEATURES = ['is_top_prospect_sample', 'is_top_expectation_band', 'age_in_signing_year_minus_17', 'is_pitcher', 'is_dominican_republic', 'is_venezuela']
const LAMBDA = 1
const failures = []
const r6 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 1e6) / 1e6)

const di = process.argv.indexOf('--dump')
let db, close
if (di > 0) {
  const { PGlite } = await import(['@electric-sql', 'pglite'].join('/'))
  const { pgcrypto } = await import(['@electric-sql', 'pglite', 'contrib', 'pgcrypto'].join('/'))
  db = new PGlite({ loadDataDir: new Blob([fs.readFileSync(process.argv[di + 1])]), extensions: { pgcrypto } })
  close = () => db.close()
} else {
  const { buildChainThrough } = await import('../../../tests/db/canonical-chain.mjs')
  const chain = await buildChainThrough('054a_development_queue_performance.sql')
  db = chain.db
  close = () => chain.close()
}
const query = async (sql, params) => (await db.query(sql, params)).rows
await db.exec(assemble(null))
const rows = await query(`select p.player_slug, p.label, p.population_class, p.signing_year, x.age_in_signing_year, x.position_family, x.market_group,
    x.expectation_tier, x.is_pitcher, x.is_dominican_republic, x.is_venezuela, x.is_top_expectation_band
  from v_outcome_training_population p join v_outcome_feature_matrix x on x.signing_id = p.signing_id
  where p.target_key = $1 and p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY') and x.model_features_complete
  order by p.player_slug`, [TARGET])
const asOf = (await query(`select max(audited_through_date)::text as d from outcome_audits`))[0].d
const previous = await query(`select model_key, training_fingerprint, evaluation_current, live_rows from v_outcome_model_evaluation order by model_key`)
await close()

// the fingerprint the view recomputes: same line format, C-collation (byte) order, newline-joined, md5
const lines = rows.map((r) => [r.player_slug, String(r.label), r.population_class, r.age_in_signing_year ?? '', r.position_family, r.market_group, r.expectation_tier].join('|')).sort()
const fingerprint = crypto.createHash('md5').update(lines.join('\n')).digest('hex')
if (previous.some((p) => p.evaluation_current)) failures.push('the 050 evaluation is unexpectedly still current on the 055 data')

const y = rows.map((r) => (r.label ? 1 : 0))
const X = rows.map((r) => [1, r.population_class === 'TOP_PROSPECT_SAMPLE' ? 1 : 0, r.is_top_expectation_band ? 1 : 0, r.age_in_signing_year - 17,
  r.is_pitcher ? 1 : 0, r.is_dominican_republic ? 1 : 0, r.is_venezuela ? 1 : 0])
const years = [...new Set(rows.map((r) => r.signing_year))].sort((a, b) => a - b)

/** Solves A x = b (Gaussian elimination with partial pivoting; A small and symmetric positive definite). */
function solve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}
/** L2-regularised logistic regression by iteratively reweighted least squares; the intercept (column 0) is not penalised. */
function fitLogistic(Xs, ys) {
  const k = Xs[0].length
  let w = new Array(k).fill(0)
  for (let it = 0; it < 100; it++) {
    const H = Array.from({ length: k }, () => new Array(k).fill(0))
    const g = new Array(k).fill(0)
    for (let i = 0; i < Xs.length; i++) {
      const z = Xs[i].reduce((s, v, j) => s + v * w[j], 0)
      const p = 1 / (1 + Math.exp(-z))
      const s = p * (1 - p)
      for (let a = 0; a < k; a++) {
        g[a] += (ys[i] - p) * Xs[i][a]
        for (let b = 0; b < k; b++) H[a][b] += s * Xs[i][a] * Xs[i][b]
      }
    }
    for (let a = 1; a < k; a++) { g[a] -= LAMBDA * w[a]; H[a][a] += LAMBDA }
    const step = solve(H, g)
    w = w.map((v, j) => v + step[j])
    if (Math.max(...step.map(Math.abs)) < 1e-10) break
  }
  return w
}
const predictLogistic = (w, x) => 1 / (1 + Math.exp(-x.reduce((s, v, j) => s + v * w[j], 0)))

const oof = { BASE_RATE: [], POPULATION_STRATIFIED_RATE: [], LOGISTIC_L2: [] }
const truth = []
for (const yr of years) {
  const train = rows.map((r, i) => i).filter((i) => rows[i].signing_year !== yr)
  const test = rows.map((r, i) => i).filter((i) => rows[i].signing_year === yr)
  const base = train.reduce((s, i) => s + y[i], 0) / train.length
  const oneClass = train.every((i) => y[i] === y[train[0]])
  const w = oneClass ? null : fitLogistic(train.map((i) => X[i]), train.map((i) => y[i]))
  for (const i of test) {
    const same = train.filter((j) => rows[j].population_class === rows[i].population_class)
    oof.BASE_RATE.push(base)
    oof.POPULATION_STRATIFIED_RATE.push(same.length ? same.reduce((s, j) => s + y[j], 0) / same.length : base)
    oof.LOGISTIC_L2.push(w ? predictLogistic(w, X[i]) : base)
    truth.push(y[i])
  }
}
const brier = (p) => p.reduce((s, v, i) => s + (v - truth[i]) ** 2, 0) / p.length
const logLoss = (p) => -p.reduce((s, v, i) => { const q = Math.min(Math.max(v, 1e-6), 1 - 1e-6); return s + (truth[i] ? Math.log(q) : Math.log(1 - q)) }, 0) / p.length
function auc(p) {
  const pos = p.filter((v, i) => truth[i] === 1), neg = p.filter((v, i) => truth[i] === 0)
  if (!pos.length || !neg.length) return null
  let s = 0
  for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0
  return s / (pos.length * neg.length)
}
const EDGES = [0, 0.1, 0.2, 0.3, 0.5, 1.000001]
function bins(p) {
  return EDGES.slice(0, -1).map((lo, k) => {
    const idx = p.map((v, i) => i).filter((i) => p[i] >= lo && p[i] < EDGES[k + 1])
    return { bin: `${lo}-${Math.min(EDGES[k + 1], 1)}`, n: idx.length, mean_predicted: idx.length ? r6(idx.reduce((s, i) => s + p[i], 0) / idx.length) : null,
      observed_rate: idx.length ? r6(idx.reduce((s, i) => s + truth[i], 0) / idx.length) : null }
  })
}
const positives = y.reduce((s, v) => s + v, 0)
const baseBrier = brier(oof.BASE_RATE)
const featureCount = { BASE_RATE: 0, POPULATION_STRATIFIED_RATE: 1, LOGISTIC_L2: FEATURES.length }
const evaluations = Object.keys(oof).map((model) => {
  const b = brier(oof[model])
  const skill = model === 'BASE_RATE' ? 0 : 1 - b / baseBrier
  const needed = target.events_per_feature * featureCount[model]
  let decision, reason
  if (model === 'BASE_RATE') {
    decision = 'BASELINE_REFERENCE'
    reason = `Naive reference: the training-fold positive rate. ${positives} positives in ${rows.length} labelled rows of two reference populations, pooled for this out-of-time comparison only. A population's own reference baseline is shown for a player only when that population's support minimums are met, and only for the Dodgers population.`
  } else if (positives < needed) {
    decision = 'MODEL_NOT_SUPPORTED'
    reason = `INSUFFICIENT_EVENTS: ${positives} positives for ${featureCount[model]} feature(s); at least ${needed} are required (${target.events_per_feature} per feature). Out-of-time Brier skill against the base rate ${r6(skill)}.`
  } else if (!(skill > 0)) {
    decision = 'MODEL_NOT_SUPPORTED'
    reason = `NO_SKILL_OVER_BASELINE: out-of-time Brier skill ${r6(skill)} is not above 0.`
  } else {
    decision = 'MODEL_SUPPORTED'
    reason = `Out-of-time Brier skill ${r6(skill)} with ${positives} positives.`
  }
  return {
    target_key: TARGET, model_key: model, model_version: MODEL_VERSION, validation_method: 'LEAVE_ONE_SIGNING_YEAR_OUT',
    feature_list: model === 'LOGISTIC_L2' ? FEATURES : model === 'POPULATION_STRATIFIED_RATE' ? ['population_class'] : [],
    training_populations: ['DODGERS_TRACKED_AND_OPENING_CLASS', 'TOP_PROSPECT_SAMPLE'],
    evaluated_rows: rows.length, positive_n: positives, folds: years.length,
    brier_score: r6(b), log_loss: r6(logLoss(oof[model])), auc: model === 'BASE_RATE' ? null : r6(auc(oof[model])), brier_skill_vs_base_rate: r6(skill),
    calibration_bins: bins(oof[model]), decision, decision_reason: reason, training_fingerprint: fingerprint, data_as_of_date: asOf,
  }
})
// the 041 rule: a supported fitted model must have its coefficients stored and reviewed before anything is built on it
if (evaluations.some((e) => e.decision === 'MODEL_SUPPORTED')) failures.push('a model was supported: store and review its coefficients before building')

const report = {
  generated_by: 'database/research/055/evaluate.mjs', method: 'database/research/041/evaluate.mjs, unchanged, on the 001-054a chain plus the 055 data',
  target: TARGET, evaluated_rows: rows.length, positives, negatives: rows.length - positives, folds: years, fingerprint,
  previous: { fingerprint: previous[0]?.training_fingerprint ?? null, evaluation_current_on_055_data: previous.map((p) => p.evaluation_current) },
  by_population: Object.fromEntries(['TOP_PROSPECT_SAMPLE', 'TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS'].map((pc) => [pc, {
    rows: rows.filter((r) => r.population_class === pc).length, positives: rows.filter((r) => r.population_class === pc && r.label).length }])),
  evaluations, failures,
}
fs.writeFileSync(path.join(here, 'evaluation.json'), JSON.stringify(report, null, 1) + '\n')
console.log(JSON.stringify({ rows: rows.length, positives, years, fingerprint, models: evaluations.map((e) => [e.model_key, e.brier_score, e.log_loss, e.auc, e.brier_skill_vs_base_rate, e.decision]), failures }))
if (failures.length) process.exitCode = 1
