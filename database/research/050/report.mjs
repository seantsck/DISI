#!/usr/bin/env node
// Writes database/research/050/support-before-after.json from two measurements (measure.mjs output):
//   node database/research/050/measure.mjs --dump <post-050 replay tar> > after.json
//   node database/research/050/report.mjs baseline.json after.json
// Every number is measured, never typed. Populations are reported side by side and never pooled.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const [bf, af] = process.argv.slice(2).map((f) => path.resolve(f))
const before = JSON.parse(fs.readFileSync(bf, 'utf8'))
const after = JSON.parse(fs.readFileSync(af, 'utf8'))
const key = (s) => `${s.target_key} / ${s.reference_population}`
const pick = (s) => s && ({ labelled: s.labelled_n, positives: s.positive_n, negatives: s.negative_n, censored: s.censored_n, unaudited: s.unaudited_n,
  minimum: `${s.min_reference_n} / ${s.min_positives} / ${s.min_negatives}`, support_state: s.support_state,
  baseline_probability: s.baseline_probability, interval_90: s.baseline_probability_low_90 ? [s.baseline_probability_low_90, s.baseline_probability_high_90] : null,
  additional_labels_needed: s.additional_labels_needed, additional_positives_needed: s.additional_positives_needed })
const keys = [...new Set([...before.support, ...after.support].map(key))].sort()
const support = keys.map((k) => {
  const b = before.support.find((s) => key(s) === k), a = after.support.find((s) => key(s) === k)
  return { target: k, before: pick(b), after: pick(a), crossed_naturally: b?.support_state !== 'BASELINE_SUPPORTED' && a?.support_state === 'BASELINE_SUPPORTED' }
})
const evaluation = (m) => m.evaluation.map((e) => ({ model: e.model_key, rows: e.evaluated_rows, positives: e.positive_n, folds: e.folds, brier: e.brier_score, log_loss: e.log_loss,
  auc: e.auc, brier_skill: e.brier_skill_vs_base_rate, decision: e.decision, fingerprint: e.training_fingerprint, current: e.evaluation_current }))
const counts = Object.fromEntries(Object.keys(after.counts).map((k) => [k, { before: before.counts[k], after: after.counts[k] }]))
const doc = {
  generated_by: 'database/research/050/report.mjs (from measure.mjs before and after Migration 050)',
  rule: 'BENCHMARK SUPPORT != DODGERS SUPPORT: each reference population is measured on its own; a benchmark baseline never produces a Dodgers probability.',
  thresholds: 'Unchanged: 50 labelled, 10 positives, 10 negatives per target and reference population; 10 positive events per model feature.',
  support,
  crossed: support.filter((s) => s.crossed_naturally).map((s) => s.target),
  evaluation: { before: evaluation(before), after: evaluation(after) },
  probabilities: { before: before.probabilities, after: after.probabilities },
  executive: { before: before.executive, after: after.executive },
  release: { before: before.release, after: after.release },
  expected_value: { before: before.expected_value, after: after.expected_value },
  benchmark_classes: { before: before.benchmark_classes, after: after.benchmark_classes },
  benchmark_queue: { before: before.benchmark_queue, after: after.benchmark_queue },
  counts,
  unchanged_hashes: Object.fromEntries(['dodgers_signings_hash', 'dodgers_audits_hash', 'war_hash', 'financial_reports_hash', 'transactions_hash', 'development_hash']
    .map((k) => [k, before.hashes[k] === after.hashes[k]])),
}
fs.writeFileSync(path.join(here, 'support-before-after.json'), JSON.stringify(doc, null, 1) + '\n')
console.log(JSON.stringify({ crossed: doc.crossed, unchanged_hashes: doc.unchanged_hashes }))
