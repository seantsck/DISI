#!/usr/bin/env node
// Writes two reviewer files from a measurement before and after Migration 056 (measure.mjs) and the committed research:
//   support-before-after.json   support per target and reference population, evaluation, probabilities, executive, release, expected value,
//                               benchmark classes, labels per class and the benchmark queue, before and after Migration 056 (the 050 report shape)
//   source-audit.json           per class: the official source, the 30 ranked members, what was resolved, mapped, not added or sent to a person and
//                               why, the labels, the 10-season maturity, and the official source and transaction evidence behind them
//   node database/research/056/report.mjs
// It builds the canonical chain through 055 in PGlite, measures it, applies the committed 056 migration to the SAME database and measures again,
// so row hashes (which carry each build's surrogate ids) compare like with like. Every number is measured or read from the research files,
// never typed. Populations are reported side by side and never pooled.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { research } from './build.mjs'
import { measure } from './measure.mjs'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const chain = await buildChainThrough('055_international_benchmark_2017_2018.sql')
const q = (sql) => chain.query(sql)
const before = await measure(q)
await chain.db.exec(fs.readFileSync(path.join(here, '../../sql/056_international_benchmark_2019.sql'), 'utf8'))
const after = await measure(q)
await chain.close()
const cohorts = JSON.parse(fs.readFileSync(path.join(here, 'source-cohorts.json'), 'utf8'))
const identity = JSON.parse(fs.readFileSync(path.join(here, 'identity-research.json'), 'utf8'))
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
  generated_by: 'database/research/056/report.mjs (from measure.mjs before and after Migration 056)',
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
  benchmark_labels: { before: before.benchmark_labels, after: after.benchmark_labels },
  benchmark_queue: { before: before.benchmark_queue, after: after.benchmark_queue },
  counts: Object.fromEntries(Object.entries(counts).filter(([k]) => k !== 'functions')),
  unchanged_hashes: Object.fromEntries(['dodgers_signings_hash', 'dodgers_audits_hash', 'war_hash', 'financial_reports_hash', 'transactions_hash', 'development_hash']
    .map((k) => [k, before.hashes[k] === after.hashes[k]])),
}
fs.writeFileSync(path.join(here, 'support-before-after.json'), JSON.stringify(doc, null, 1) + '\n')

// ---- the source audit, per class --------------------------------------------------------------------------------------------------------
const label = (pop, target) => after.benchmark_labels.find((l) => l.population_key === pop && l.target_key === target)
const audit = cohorts.cohorts.map((c) => {
  const d = research.decisions.filter((x) => x.population_key === c.population_key)
  const by = (k) => d.filter((x) => x.decision === k)
  const added = research.newPlayers.filter((p) => p.population_key === c.population_key)
  const reach = label(c.population_key, 'REACH_MLB_WITHIN_7_SEASONS')
  const bwar = label(c.population_key, 'POSITIVE_BWAR_WITHIN_10_SEASONS')
  const resolved = identity.entries.filter((e) => e.cohort === c.population_key && e.result === 'RESOLVED')
  return {
    class_year: c.class_year, population_key: c.population_key,
    official_source: { endpoint: c.list_capture.original_url, capture: c.list_capture.url, captured_at: c.list_capture.captured_at, last_updated: c.list_capture.last_updated,
      sha256: c.list_capture.sha256, internet_archive_digest: c.list_capture.cdx_digest, list_path: c.list_capture.list_path, basis: c.list_basis,
      club_revision: { capture: c.club_capture.url, last_updated: c.club_capture.last_updated, sha256: c.club_capture.sha256 },
      corroborating_captures: c.corroborating_captures.map((x) => ({ capture: x.url, last_updated: x.last_updated, sha256: x.sha256 })) },
    ranked_source_players: c.members.length,
    identities_resolved_automatically: resolved.length,
    identities_unresolved: by('IDENTITY_INSUFFICIENT_EVIDENCE').length + by('IDENTITY_CONFLICT').length,
    sent_to_human_review: d.filter((x) => x.human_review).map((x) => ({ rank: x.rank, name: x.published_name, decision: x.decision, reason: x.reason,
      candidates: (x.candidates_considered ?? []).map((k) => ({ mlb_id: k.person_id, name: k.name, club: k.club, signed: k.date, match: k.match })) })),
    dodgers_overlaps: by('MAPPED_TO_EXISTING_DODGERS_SIGNING').map((x) => ({ rank: x.rank, name: x.published_name, mlb_id: x.mlb_id, slug: x.slug,
      stored_dodgers_international_rank: x.stored_dodgers_international_rank, observed_rank_in_this_edition: x.observed_rank_in_this_edition, written: false })),
    verified_not_added: [...by('ROUTE_NOT_ESTABLISHED'), ...by('DECEASED_BEFORE_OUTCOME_HORIZON')].map((x) => ({ rank: x.rank, name: x.published_name, mlb_id: x.mlb_id, decision: x.decision, reason: x.reason })),
    benchmark_signings_added: added.length,
    reach_mlb_within_7_seasons: { mature: true, horizon_end_season: c.class_year + 7, positive: reach?.positive ?? 0, negative: reach?.negative ?? 0,
      unknown_or_censored: (reach?.censored ?? 0) + (reach?.unaudited ?? 0), not_labelled_because_not_added: 30 - added.length },
    ten_season_targets: { mature: false, horizon_end_season: c.class_year + 10, labelled: (bwar?.positive ?? 0) + (bwar?.negative ?? 0), censored: bwar?.censored ?? 0,
      note: 'The 10-season horizon (signing year + 10) has not elapsed; every 10-season label is CENSORED under the unchanged 041 rule.' },
    official_sources_written: added.length * 2 + 2 + c.corroborating_captures.length,
    official_transaction_evidence: added.length,
    reached_mlb_at_boundary: added.filter((p) => p.mlb_debut_date).map((p) => ({ name: p.full_name, debut: p.mlb_debut_date })),
  }
})
fs.writeFileSync(path.join(here, 'source-audit.json'), JSON.stringify({ generated_by: 'database/research/056/report.mjs', audit_through_date: '2026-10-05', classes: audit }, null, 1) + '\n')
console.log(JSON.stringify({ crossed: doc.crossed, unchanged_hashes: doc.unchanged_hashes, classes: audit.map((a) => [a.class_year, a.benchmark_signings_added, a.reach_mlb_within_7_seasons.positive, a.reach_mlb_within_7_seasons.negative]) }))
