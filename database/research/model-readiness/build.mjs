#!/usr/bin/env node
// Model-readiness audit: a pure function of one replay export (export.mjs) and the committed evaluation records of
// database/research/{041,050,055,056,057}/evaluation.json. No database is read and nothing is written outside this directory.
//   node database/research/model-readiness/build.mjs [--export <replay-export.json>]
// Writes population.json, targets.json, feature-coverage.csv, mature-outcome-gaps.csv, model-history.json, priority-backlog.csv and
// audit-report.md. The output carries no timestamp: the same export always gives byte-identical files.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const exportPath = arg('export') || path.join(root, 'research-output/model-readiness/replay-export.json')
const raw = fs.readFileSync(exportPath)
const exportSha = crypto.createHash('sha256').update(raw).digest('hex')
const Q = JSON.parse(raw).queries
for (const [k, v] of Object.entries(Q)) if (v.error) throw new Error(`export query ${k} failed: ${v.error}`)
const rows = (k) => Q[k].rows

// ---------------------------------------------------------------------------------------------------------------- helpers
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null)
const rate = (a, b) => (b ? Math.round((10000 * a) / b) / 10000 : null)
const day = (v) => (v ? String(v).slice(0, 10) : null)
const count = (xs, f) => { const m = {}; for (const x of xs) { const k = String(f(x)); m[k] = (m[k] || 0) + 1 } return Object.fromEntries(Object.entries(m).sort()) }
const by = (xs, k) => Object.fromEntries(xs.map((x) => [x[k], x]))
const csvCell = (v) => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const csv = (header, data) => [header.join(','), ...data.map((r) => header.map((h) => csvCell(r[h])).join(','))].join('\n') + '\n'
const json = (o) => JSON.stringify(o, null, 2) + '\n'
const write = (f, s) => fs.writeFileSync(path.join(here, f), s)

const AMATEUR_IN = (r) => r.signing_route !== 'PROFESSIONAL_SIGNING'
const LABELLED = new Set(['TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY'])
const FINAL_STATES = new Set(['REACHED_MLB', 'NO_MLB_CAREER_ENDED'])
const TARGET_ORDER = ['REACH_MLB_WITHIN_7_SEASONS', 'POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS', 'DODGERS_MLB_VALUE_WITHIN_10_SEASONS']
const REFS = { DODGERS: 'DODGERS_TRACKED_AND_OPENING_CLASS', BENCHMARK: 'TOP_PROSPECT_SAMPLE' }

const stf = rows('signing_time_features')
const stfBy = by(stf, 'signing_id')
const fm = by(rows('feature_matrix'), 'signing_id')
const ro = rows('realized_outcome')
const tp = rows('training_population')
const targets = [...rows('outcome_targets')].sort((a, b) => TARGET_ORDER.indexOf(a.target_key) - TARGET_ORDER.indexOf(b.target_key))
const fin = by(rows('financials'), 'signing_id')
const sr = by(rows('signing_records'), 'signing_id')
const devBy = by(rows('development_summary'), 'player_id')
const pathBy = by(rows('development_pathway'), 'signing_id')
const txBy = by(rows('career_transactions'), 'player_slug')
const rankBy = by(rows('rankings'), 'player_slug')
const asOf = rows('as_of')[0].analysis_as_of_date
const lastCompleteSeason = tp[0].last_complete_season
const group = (s) => (s.is_dodgers ? 'DODGERS' : 'BENCHMARK')
// The architecture's own model scope (041): reference-population members on the amateur route. Outcome-selected historical
// Dodgers signings and professional-route signings never train anything.
const inModelScope = (s) => (s.is_dodgers ? ['TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS'].includes(s.population_class) : s.population_class === 'TOP_PROSPECT_SAMPLE') && AMATEUR_IN(s)

// ---------------------------------------------------------------------------------------------------------------- 1. population
const population = { analysis_as_of_date: asOf, last_complete_season: lastCompleteSeason, export_sha256: exportSha, pooling: 'Dodgers and benchmark are reported separately. The architecture never pools them for support (v_outcome_target_support); it pools them only inside the out-of-time model comparison (outcome_model_evaluations), and predictions are made only for the Dodgers tracked / opening-class population.', maturity_rules: {
  outcome_maturity: 'v_player_realized_outcome.outcome_maturity: Dodgers signing_date + 5 years <= analysis date (signing year + 5 when undated); benchmark signing year + 5.',
  target_horizon: `v_outcome_training_population.exposure_complete: signing_year + horizon_seasons <= last complete MLB season (${lastCompleteSeason}). A row is CENSORED (never negative) before that.`,
  final_outcome: 'An outcome is final when outcome_state is REACHED_MLB or NO_MLB_CAREER_ENDED. NO_MLB_ACTIVE_IN_MINORS and NO_MLB_STATUS_UNKNOWN are audited but not final; UNAUDITED has no audit.',
}, groups: {} }
for (const g of ['DODGERS', 'BENCHMARK']) {
  const S = stf.filter((s) => group(s) === g)
  const ids = new Set(S.map((s) => s.signing_id))
  const R = ro.filter((r) => ids.has(r.signing_id))
  const scope = S.filter(inModelScope)
  const scopeIds = new Set(scope.map((s) => s.signing_id))
  const T = tp.filter((r) => ids.has(r.signing_id))
  const perTarget = {}
  for (const t of targets) {
    const X = T.filter((r) => r.target_key === t.target_key)
    const L = X.filter((r) => LABELLED.has(r.training_state))
    perTarget[t.target_key] = {
      horizon_end_season_rule: `signing_year + ${t.horizon_seasons} <= ${lastCompleteSeason}`,
      exposure_complete: X.filter((r) => r.exposure_complete).length,
      training_state: count(X, (r) => r.training_state),
      usable_labelled_n: L.length,
      usable_labelled_n_features_complete: L.filter((r) => fm[r.signing_id].model_features_complete).length,
      positives: L.filter((r) => r.label === true).length,
      negatives: L.filter((r) => r.label === false).length,
      missing_label_past_horizon: X.filter((r) => r.training_state === 'OUTCOME_UNAUDITED').length,
      labels_out_of_scope: { true: X.filter((r) => r.training_state === 'OUT_OF_SCOPE' && r.label === true).length, false: X.filter((r) => r.training_state === 'OUT_OF_SCOPE' && r.label === false).length },
    }
  }
  const pb = perTarget.POSITIVE_BWAR_WITHIN_10_SEASONS
  population.groups[g] = {
    total_signings: S.length,
    signing_years: { min: Math.min(...S.map((s) => s.signing_year)), max: Math.max(...S.map((s) => s.signing_year)), by_year: count(S, (s) => s.signing_year) },
    population_class: count(S, (s) => s.population_class),
    signing_route: count(S, (s) => s.signing_route),
    model_scope_n: scope.length,
    model_scope_by_year: count(scope, (s) => s.signing_year),
    outcome_maturity: count(R, (r) => r.outcome_maturity),
    outcome_maturity_in_model_scope: count(R.filter((r) => scopeIds.has(r.signing_id)), (r) => r.outcome_maturity),
    outcome_state: count(R, (r) => r.outcome_state),
    outcome_state_by_maturity: count(R, (r) => `${r.outcome_maturity}|${r.outcome_state}`),
    reached_mlb: { true: R.filter((r) => r.reached_mlb_verified === true).length, false: R.filter((r) => r.reached_mlb_verified === false).length, unaudited: R.filter((r) => r.reached_mlb_verified === null).length },
    unaudited_outcomes: R.filter((r) => r.outcome_state === 'UNAUDITED').length,
    mature_without_final_outcome: R.filter((r) => r.outcome_maturity === 'MATURE' && !FINAL_STATES.has(r.outcome_state)).length,
    positive_bwar_labels_in_scope: { positive: pb.positives, non_positive: pb.negatives, missing_past_horizon: pb.missing_label_past_horizon, censored: pb.training_state.CENSORED || 0 },
    model_features_complete: { all: S.filter((s) => fm[s.signing_id].model_features_complete).length, model_scope: scope.filter((s) => fm[s.signing_id].model_features_complete).length, feature_gap: count(scope.filter((s) => !fm[s.signing_id].model_features_complete), (s) => fm[s.signing_id].feature_gap) },
    by_target: perTarget,
  }
}
const D = population.groups.DODGERS, B = population.groups.BENCHMARK
write('population.json', json(population))

// ---------------------------------------------------------------------------------------------------------------- 2. targets
const support = rows('target_support')
const targetOut = { analysis_as_of_date: asOf, support_rule: 'v_outcome_target_support: a reference baseline is supported when labelled_n >= min_reference_n, positives >= min_positives and negatives >= min_negatives. A fitted model additionally needs events_per_feature positives per model feature and positive out-of-time Brier skill (041 evaluate.mjs).', targets: [] }
for (const t of targets) {
  const pops = []
  for (const [g, ref] of Object.entries(REFS)) {
    if (t.applies_to === 'DODGERS_ONLY' && g === 'BENCHMARK') { pops.push({ population: g, reference_population: ref, applicable: false }); continue }
    const s = support.find((x) => x.target_key === t.target_key && x.reference_population === ref)
    const pg = population.groups[g].by_target[t.target_key]
    pops.push({
      population: g, reference_population: ref, applicable: true,
      in_scope_rows: s.population_rows, usable_labelled_n: s.labelled_n, usable_labelled_n_features_complete: pg.usable_labelled_n_features_complete,
      positives: s.positive_n, negatives: s.negative_n, censored: s.censored_n, missing_label_past_horizon: s.unaudited_n,
      positive_rate: rate(s.positive_n, s.labelled_n),
      baseline_supported: s.baseline_supported, support_state: s.support_state,
      baseline_probability: num(s.baseline_probability), baseline_90: s.baseline_supported ? [num(s.baseline_probability_low_90), num(s.baseline_probability_high_90)] : null,
      additional_labels_needed: s.additional_labels_needed, additional_positives_needed: s.additional_positives_needed,
      additional_negatives_needed: Math.max(t.min_negatives - s.negative_n, 0),
      positives_needed_for_6_feature_logistic: Math.max(t.events_per_feature * 6 - s.positive_n, 0),
    })
  }
  targetOut.targets.push({ target_key: t.target_key, label: t.label, horizon_seasons: t.horizon_seasons, applies_to: t.applies_to, threshold_bwar: num(t.threshold_bwar), label_rule: t.label_rule,
    thresholds: { min_reference_n: t.min_reference_n, min_positives: t.min_positives, min_negatives: t.min_negatives, events_per_feature: t.events_per_feature }, populations: pops })
}
const dPops = targetOut.targets.map((t) => ({ t: t.target_key, p: t.populations.find((p) => p.population === 'DODGERS') }))
const nearest = [...dPops].sort((a, b) => a.p.additional_positives_needed + a.p.additional_labels_needed - (b.p.additional_positives_needed + b.p.additional_labels_needed))[0]
const furthest = [...dPops].sort((a, b) => b.p.additional_positives_needed - a.p.additional_positives_needed || b.p.additional_labels_needed - a.p.additional_labels_needed)[0]
targetOut.limiting_target = {
  dodgers_nearest_to_support: { target_key: nearest.t, gap: `${nearest.p.additional_labels_needed} more labels, ${nearest.p.additional_positives_needed} more positives` },
  dodgers_furthest_from_support: { target_key: furthest.t, gap: `${furthest.p.additional_labels_needed} more labels, ${furthest.p.additional_positives_needed} more positives (0 positives today)` },
  statement: `No Dodgers target is supported. The limiting target is ${nearest.t}: it is the nearest to support and every other Dodgers target needs strictly more labels and positives. The 10-season targets (positive bWAR, 2+ bWAR, Dodgers MLB value) can only label 2016-and-earlier signings, of which the tracked Dodgers population holds ${D.by_target.POSITIVE_BWAR_WITHIN_10_SEASONS.usable_labelled_n} amateur rows; DODGERS_MLB_VALUE_WITHIN_10_SEASONS has 0 positives and gates the only expected-value model.`,
  benchmark: 'Benchmark reach and positive-bWAR baselines are BASELINE_SUPPORTED for the benchmark population only (never shown for a Dodgers player); BWAR_2 is one positive short. BASELINE SUPPORTED is not MODEL SUPPORTED.',
}
targetOut.effect_of_062 = 'Not verified (062 is not applied to the audited state). Owner-observed career bWAR adds CAREER_BWAR metric observations; the bWAR labels read team-season WAR rows (player_mlb_team_season_war) inside the horizon window, not CAREER_BWAR, so 062 as described changes BWAR_MISSING and the CAREER_BWAR count but no label, support count or evaluation fingerprint.'
write('targets.json', json(targetOut))

// ---------------------------------------------------------------------------------------------------------------- 3. features
const reachLabelled = new Set(tp.filter((r) => r.target_key === 'REACH_MLB_WITHIN_7_SEASONS' && LABELLED.has(r.training_state)).map((r) => r.signing_id))
const scopes = {
  DODGERS_MODEL_SCOPE: stf.filter((s) => s.is_dodgers && inModelScope(s)),
  DODGERS_REACH_LABELLED: stf.filter((s) => s.is_dodgers && reachLabelled.has(s.signing_id)),
  BENCHMARK_MODEL_SCOPE: stf.filter((s) => !s.is_dodgers && inModelScope(s)),
  BENCHMARK_REACH_LABELLED: stf.filter((s) => !s.is_dodgers && reachLabelled.has(s.signing_id)),
}
const dev = (s) => devBy[s.player_id] || {}
const reached = (s) => ro.find((r) => r.signing_id === s.signing_id).reached_mlb_verified === true
// eligible(s) -> the row can have the feature at all; known(s) -> it has it
const FEATURES = [
  ['age_in_signing_year', 'SIGNING_TIME', 'USED_BY_041_LOGISTIC', () => true, (s) => s.has_age, 'Complete in model scope; no indicator needed.'],
  ['position_at_signing', 'SIGNING_TIME', 'USED_BY_041_LOGISTIC (is_pitcher)', () => true, (s) => s.has_position, 'Safe: few missing; 041 drops the row (model_features_complete) rather than imputing.'],
  ['country_market', 'SIGNING_TIME', 'USED_BY_041_LOGISTIC (is_dominican_republic, is_venezuela)', () => true, (s) => s.has_market, 'Indicator not safe for Dodgers: missingness is a 2022 tracked-class / pathway OTHER artefact, so a missing flag would encode signing class.'],
  ['market_group_mapped', 'SIGNING_TIME', 'USED_BY_041_LOGISTIC', () => true, (s) => !['UNKNOWN', 'UNMAPPED'].includes(s.market_group), 'Same as country_market.'],
  ['pathway_classified', 'SIGNING_TIME', 'SCOPE_RULE (professional route excluded)', () => true, (s) => s.pathway && s.pathway !== 'OTHER', 'pathway OTHER is an unclassified route, not a missing value; a default is safe only as its own category.'],
  ['era_key', 'SIGNING_TIME', 'AVAILABLE_NOT_USED', () => true, (s) => s.era_key && s.era_key !== 'ERA_BOUNDARY_AMBIGUOUS', 'Derived from year/date; collinear with the out-of-time fold.'],
  ['exact_signing_date', 'SIGNING_TIME', 'CUTOFF_ONLY', () => true, (s) => s.cutoff_precision === 'DAY', 'Safe default exists: the 039 cutoff falls back to 31 December (YEAR_END), which is conservative for leakage.'],
  ['signing_bonus_usd', 'SIGNING_TIME', 'EXCLUDED_BY_041_DESIGN', () => true, (s) => s.has_bonus, 'Not safe as imputed value: known bonuses are selection-biased (reported for prominent signings); see unknown-cost policy.'],
  ['total_known_acquisition_cost_usd', 'SIGNING_TIME', 'EXCLUDED_BY_041_DESIGN', () => true, (s) => s.known_acquisition_cost_usd !== null, 'COALESCE(cost, 0) + acquisition_cost_missing is computable but the indicator mostly encodes source coverage; see audit-report section 4.'],
  ['acquisition_cost_complete', 'SIGNING_TIME', 'EXCLUDED_BY_041_DESIGN', () => true, (s) => s.acquisition_cost_completeness === 'COMPLETE', 'PARTIAL is a lower bound, NO_RULE has no component rule for the pathway.'],
  ['expectation_at_signing (scouting band)', 'SIGNING_TIME', 'USED_BY_041_LOGISTIC (is_top_expectation_band)', () => true, (s) => s.has_expectation, 'Not safe: for Dodgers it is near-absent, so the feature is collinear with population (benchmark rows are rank-selected).'],
  ['international_rank (signing record)', 'SIGNING_TIME', 'AVAILABLE_NOT_USED', () => true, (s) => sr[s.signing_id].international_rank !== null, 'Benchmark rows are defined by rank; Dodgers rank exists only for listed signings. A missing indicator equals "not ranked", which is a population definition, not a feature.'],
  ['any_ranking_observation', 'MIXED (often post-signing)', 'NOT_A_FEATURE_UNLESS_DATED_BEFORE_CUTOFF', () => true, (s) => !!rankBy[s.player_slug], 'Only rankings dated on or before the cutoff are leakage-safe; that subset is expectation_at_signing.'],
  ['first_pro_game_exact', 'POST_SIGNING', 'NOT_A_FEATURE (leakage for signing-time targets)', () => true, (s) => !!dev(s).professional_debut_date_exact, 'Usable only for a conditional model with a later as-of date.'],
  ['professional_debut_season', 'POST_SIGNING', 'NOT_A_FEATURE (leakage for signing-time targets)', () => true, (s) => dev(s).professional_debut_season != null, 'Same.'],
  ['dsl_debut_exact (among DSL debuts)', 'POST_SIGNING', 'NOT_A_FEATURE', (s) => dev(s).first_dsl_season != null, (s) => !!dev(s).first_dsl_date, 'Same.'],
  ['complex_debut_exact (among complex debuts)', 'POST_SIGNING', 'NOT_A_FEATURE', (s) => dev(s).first_complex_season != null, (s) => !!dev(s).first_complex_date, 'Same.'],
  ['full_season_A_exact (among A arrivals)', 'POST_SIGNING', 'NOT_A_FEATURE', (s) => dev(s).first_a_season != null, (s) => !!dev(s).first_a_date, 'Same.'],
  ['high_A_exact (among High-A arrivals)', 'POST_SIGNING', 'NOT_A_FEATURE', (s) => dev(s).first_high_a_season != null, (s) => !!dev(s).first_high_a_date, 'Same.'],
  ['AA_exact (among AA arrivals)', 'POST_SIGNING', 'NOT_A_FEATURE', (s) => dev(s).first_aa_season != null, (s) => !!dev(s).first_aa_date, 'Same.'],
  ['AAA_exact (among AAA arrivals)', 'POST_SIGNING', 'NOT_A_FEATURE', (s) => dev(s).first_aaa_season != null, (s) => !!dev(s).first_aaa_date, 'Same.'],
  ['level_progression (observed affiliated seasons)', 'POST_SIGNING', 'NOT_A_FEATURE', () => true, (s) => (pathBy[s.signing_id]?.observed_seasons || 0) > 0, 'Dodgers only (037); benchmark has no development rows.'],
  ['development_velocity (seasons to full-season)', 'POST_SIGNING', 'NOT_A_FEATURE', (s) => pathBy[s.signing_id]?.full_season_arrival_season != null, (s) => pathBy[s.signing_id]?.seasons_to_full_season != null, 'Defined only for full-season arrivals.'],
  ['mlb_debut_date (among MLB reachers)', 'LABEL_INPUT', 'LABEL (REACH uses the debut season)', (s) => reached(s), (s) => !!ro.find((r) => r.signing_id === s.signing_id).mlb_debut_date, 'Label-blocking if missing for a reacher.'],
  ['days_signing_to_mlb_exact (among reachers)', 'POST_SIGNING', 'NOT_A_FEATURE', (s) => reached(s), (s) => dev(s).days_signing_to_mlb_exact != null, 'Needs an exact signing date and debut date.'],
  ['career_transaction_history', 'POST_SIGNING', 'NOT_A_FEATURE', () => true, (s) => !!txBy[s.player_slug], 'Transactions are outcome-adjacent (exits, trades); never a signing-time feature.'],
]
const structural = (S, known) => {
  const yr = {}
  for (const s of S) { const k = s.signing_year; yr[k] = yr[k] || [0, 0]; yr[k][0]++; if (!known(s)) yr[k][1]++ }
  const missing = S.filter((s) => !known(s))
  if (!missing.length) return { structural: 'NO_MISSING', detail: '' }
  const rates = Object.values(yr).filter(([n]) => n >= 5).map(([n, m]) => m / n)
  const spread = rates.length ? Math.max(...rates) - Math.min(...rates) : 0
  const pw = count(missing, (s) => s.pathway)
  const detail = 'missing by year ' + Object.entries(yr).filter(([, [, m]]) => m).map(([y, [n, m]]) => `${y}:${m}/${n}`).join(' ') + '; by pathway ' + Object.entries(pw).map(([k, v]) => `${k}:${v}`).join(' ')
  return { structural: missing.length === S.length ? 'ALL_MISSING' : spread >= 0.4 ? 'STRUCTURAL' : 'NOT_STRUCTURAL', detail }
}
const featureRows = []
for (const [name, timing, role, eligible, known, note] of FEATURES) {
  for (const [scope, S0] of Object.entries(scopes)) {
    const S = S0.filter(eligible)
    const k = S.filter(known).length
    const st = structural(S, known)
    featureRows.push({ feature: name, scope, timing, model_role: role, eligible: S.length, known: k, missing: S.length - k, completeness_pct: S.length ? pct(k, S.length).toFixed(1) : '', missingness: st.structural, missingness_detail: st.detail, missing_indicator_or_default: note })
  }
}
write('feature-coverage.csv', csv(['feature', 'scope', 'timing', 'model_role', 'eligible', 'known', 'missing', 'completeness_pct', 'missingness', 'missingness_detail', 'missing_indicator_or_default'], featureRows))
const fr = (f, s) => featureRows.find((r) => r.feature === f && r.scope === s)

// ---------------------------------------------------------------------------------------------------------------- 4. unknown-cost policy
const costState = (s) => ({ COMPLETE: 'KNOWN', PARTIAL: 'PARTIAL', UNKNOWN: 'UNKNOWN', NO_RULE: 'NO_COST_RULE' })[s.acquisition_cost_completeness] || 'UNKNOWN'
const costPolicy = {}
for (const [scope, S] of Object.entries(scopes)) {
  const states = count(S, costState)
  const known = S.filter((s) => s.known_acquisition_cost_usd !== null)
  const lab = tp.filter((r) => r.target_key === 'REACH_MLB_WITHIN_7_SEASONS' && LABELLED.has(r.training_state) && S.some((s) => s.signing_id === r.signing_id))
  const pos = lab.filter((r) => r.label === true), neg = lab.filter((r) => r.label === false)
  const kn = (xs) => xs.filter((r) => stfBy[r.signing_id].known_acquisition_cost_usd !== null).length
  costPolicy[scope] = {
    rows: S.length, state: { KNOWN: states.KNOWN || 0, PARTIAL: states.PARTIAL || 0, UNKNOWN: states.UNKNOWN || 0, UNDISCLOSED: 0, NO_COST_RULE: states.NO_COST_RULE || 0 },
    rows_with_cost_value_before: known.length, rows_with_cost_value_after: S.length,
    known_zero_cost_rows: known.filter((s) => num(s.known_acquisition_cost_usd) === 0).length,
    reach_labelled: lab.length, reach_labelled_cost_known: kn(lab), reach_positive_cost_known: `${kn(pos)}/${pos.length}`, reach_negative_cost_known: `${kn(neg)}/${neg.length}`,
  }
}
const dodgersAll = stf.filter((s) => s.is_dodgers)
const knownSpend = dodgersAll.reduce((a, s) => a + (sr[s.signing_id].total_known_acquisition_cost_usd === null ? 0 : Math.round(num(sr[s.signing_id].total_known_acquisition_cost_usd) * 100)), 0) / 100
const dodgersKnown = dodgersAll.filter((s) => sr[s.signing_id].total_known_acquisition_cost_usd !== null).length

// ---------------------------------------------------------------------------------------------------------------- 5. mature outcome backlog
const queueBy = by(rows('mature_outcome_queue'), 'player_slug')
const auditBy = by(rows('outcome_audits'), 'player_slug')
const sigBy = by(rows('signings'), 'signing_id')
const backlog = ro.filter((r) => r.is_dodgers && r.outcome_maturity === 'MATURE' && !FINAL_STATES.has(r.outcome_state))
  .sort((a, b) => a.signing_year - b.signing_year || a.player_slug.localeCompare(b.player_slug))
  .map((r) => {
    const s = stfBy[r.signing_id], q = queueBy[r.player_slug], a = auditBy[r.player_slug], dv = devBy[r.player_id] || {}, sg = sigBy[r.signing_id]
    const reach = tp.find((x) => x.signing_id === r.signing_id && x.target_key === 'REACH_MLB_WITHIN_7_SEASONS')
    const maturityDate = r.signing_date ? `${Number(day(r.signing_date).slice(0, 4)) + 5}${day(r.signing_date).slice(4)}` : `${r.signing_year + 5} (year only)`
    const missing = {
      UNAUDITED: q?.unaudited_reason === 'INSUFFICIENT_EVIDENCE' ? 'No outcome audit and no affiliated professional record in DISI: need any professional appearance, release or retirement evidence (identity is MLBAM-resolved).' : 'No outcome audit: need an audited reach / disposition record through the analysis date (player is still affiliated, so the audit would record NO_MLB_ACTIVE_IN_MINORS, which is still not final).',
      NO_MLB_ACTIVE_IN_MINORS: 'Audited, active in the minors, no MLB debut: final only at an MLB debut or a release / retirement with no debut. Not researchable to final today; re-audit after the 2027 season.',
      NO_MLB_STATUS_UNKNOWN: `Audited no-MLB, current status unknown (audit note: ${a?.audit_note || 'none'}): need release / retirement or current-affiliation evidence.`,
    }[r.outcome_state]
    const name = sg.full_name
    const query = r.outcome_state === 'NO_MLB_STATUS_UNKNOWN'
      ? `"${name}" ${/Toronto/.test(a?.audit_note || '') ? 'Blue Jays' : 'Dodgers'} minor league 2026 released OR retired OR "free agent"`
      : r.outcome_state === 'UNAUDITED' && q?.unaudited_reason === 'INSUFFICIENT_EVIDENCE'
        ? `"${name}" Dodgers ${r.signing_year} international signing ${s.country_market || ''} DSL released`.replace(/\s+/g, ' ')
        : q?.last_affiliated_team
          ? `"${name}" "${q.last_affiliated_team}" 2026 stats transactions`
          : `"${name}" ${sg.mlb_id ? sg.mlb_id + ' ' : ''}minor league 2026 stats transactions`
    return {
      player_slug: r.player_slug, full_name: name, mlb_id: sg.mlb_id, signing_year: r.signing_year, signing_date: day(r.signing_date), population_class: s.population_class,
      maturity_basis: r.maturity_basis, mature_since: maturityDate,
      reach_7_horizon_end_season: r.signing_year + 7, reach_7_training_state: reach.training_state, reach_7_label: reach.label === null ? '' : String(reach.label),
      outcome_state: r.outcome_state, audited_through_date: a ? day(a.audited_through_date) : '',
      highest_affiliated_level: dv.highest_affiliated_level || q?.highest_level || '', last_affiliated_season: dv.highest_affiliated_season || q?.last_affiliated_season || '',
      last_affiliated_team: q?.last_affiliated_team || '', missing_evidence: missing, google_query: query,
    }
  })
write('mature-outcome-gaps.csv', csv(['player_slug', 'full_name', 'mlb_id', 'signing_year', 'signing_date', 'population_class', 'maturity_basis', 'mature_since', 'reach_7_horizon_end_season', 'reach_7_training_state', 'reach_7_label', 'outcome_state', 'audited_through_date', 'highest_affiliated_level', 'last_affiliated_season', 'last_affiliated_team', 'missing_evidence', 'google_query'], backlog))

// ---------------------------------------------------------------------------------------------------------------- 6. development coverage (Dodgers)
const dScope = scopes.DODGERS_MODEL_SCOPE
const devCoverage = ['exact_signing_date', 'first_pro_game_exact', 'dsl_debut_exact (among DSL debuts)', 'complex_debut_exact (among complex debuts)', 'full_season_A_exact (among A arrivals)', 'high_A_exact (among High-A arrivals)', 'AA_exact (among AA arrivals)', 'AAA_exact (among AAA arrivals)', 'level_progression (observed affiliated seasons)', 'development_velocity (seasons to full-season)', 'mlb_debut_date (among MLB reachers)', 'days_signing_to_mlb_exact (among reachers)']
  .map((f) => { const r = fr(f, 'DODGERS_MODEL_SCOPE'); return { feature: f, eligible: r.eligible, known: r.known, completeness_pct: r.completeness_pct, classification: f.startsWith('mlb_debut_date') ? 'MODEL_BLOCKING (label input)' : 'NICE_TO_HAVE' } })

// ---------------------------------------------------------------------------------------------------------------- 7. model history
const evals = rows('model_evaluation')
const research = {}
for (const m of ['041', '050', '055', '056', '057']) research[m] = JSON.parse(fs.readFileSync(path.join(here, '..', m, 'evaluation.json'), 'utf8'))
const history = []
for (const m of Object.keys(research)) {
  const e = research[m]
  for (const x of e.evaluations) {
    const tgt = e.targets ? e.targets.find((t) => t.target === x.target_key) : e
    history.push({ migration: m, target_key: x.target_key, model_key: x.model_key, feature_list: x.feature_list, validation: `${x.validation_method} (${x.folds} folds)`, evaluated_rows: x.evaluated_rows, positive_n: x.positive_n,
      by_population: tgt?.by_population || null, brier_score: x.brier_score, log_loss: x.log_loss, auc: x.auc, brier_skill_vs_base_rate: x.brier_skill_vs_base_rate, decision: x.decision, decision_reason: x.decision_reason, training_fingerprint: x.training_fingerprint })
  }
}
const current = TARGET_ORDER.filter((t) => evals.some((e) => e.target_key === t)).map((t) => {
  const E = evals.filter((e) => e.target_key === t)
  const base = E.find((e) => e.model_key === 'BASE_RATE')
  const tgt = targets.find((x) => x.target_key === t)
  return { target_key: t, train_test: 'Pooled DODGERS_TRACKED_AND_OPENING_CLASS + TOP_PROSPECT_SAMPLE labelled rows with complete signing-time features; leave-one-signing-year-out (every fold is out-of-time); no separate later OOT holdout exists.',
    evaluated_rows: base.evaluated_rows, positives: base.positive_n, folds: base.folds, evaluation_current: E.every((e) => e.evaluation_current), training_fingerprint: base.training_fingerprint,
    baseline: { model_key: 'BASE_RATE', brier: num(base.brier_score), log_loss: num(base.log_loss) },
    models: E.filter((e) => e.model_key !== 'BASE_RATE').sort((a, b) => a.model_key.localeCompare(b.model_key)).map((e) => ({ model_key: e.model_key, features: e.feature_list, brier: num(e.brier_score), log_loss: num(e.log_loss), auc: num(e.auc), brier_skill_vs_base_rate: num(e.brier_skill_vs_base_rate),
      events_needed: tgt.events_per_feature * e.feature_list.length, events_available: e.positive_n, events_rule_pass: e.positive_n >= tgt.events_per_feature * e.feature_list.length, skill_rule_pass: num(e.brier_skill_vs_base_rate) > 0, decision: e.decision, failure_reason: e.decision_reason.split(':')[0] })) }
})
const modelHistory = { stored_evaluations_current: current, research_history: history, rule: '041 evaluate.mjs: MODEL_SUPPORTED requires positives >= events_per_feature x features AND out-of-time Brier skill > 0. Nothing was re-run for this audit.', supported_models: evals.filter((e) => e.decision === 'MODEL_SUPPORTED').length }
write('model-history.json', json(modelHistory))

// ---------------------------------------------------------------------------------------------------------------- 8. research queues classified
const rt = rows('research_tasks')
const n = (xs, f) => xs.filter(f).length
const classGaps = rt.filter((r) => r.task_type === 'CLASS_MEMBERS_MISSING').map((r) => { const m = /(\d+) of (\d+) expected/.exec(r.detail); return { year: r.signing_year, missing: Number(m[1]), expected: Number(m[2]) } }).sort((a, b) => a.year - b.year)
const classGapText = classGaps.map((c) => `${c.year}: ${c.missing} of ${c.expected} missing`).join(', ')
const classGapMissing = classGaps.reduce((a, c) => a + c.missing, 0)
const classGapReach = classGaps.filter((c) => c.year + 7 <= lastCompleteSeason).reduce((a, c) => a + c.missing, 0)
const classGap10 = classGaps.filter((c) => c.year + 10 <= lastCompleteSeason).reduce((a, c) => a + c.missing, 0)
const queues = [
  ['v_research_tasks', 'OUTCOME_AUDIT (not yet 5-year mature)', 'DODGERS', n(rt, (r) => r.task_type === 'OUTCOME_AUDIT' && r.franchise_key === 'DODGERS') - (D.outcome_state_by_maturity['MATURE|UNAUDITED'] || 0), 'NOT_APPLICABLE', 'NONE', `Of the ${n(rt, (r) => r.task_type === 'OUTCOME_AUDIT' && r.franchise_key === 'DODGERS')} Dodgers OUTCOME_AUDIT tasks, these are signings less than 5 years old: no outcome can be final and every target is censored. The ${D.outcome_state_by_maturity['MATURE|UNAUDITED'] || 0} mature ones are the v_dodgers_mature_outcome_queue row.`],
  ['v_research_tasks', 'OUTCOME_AUDIT', 'BENCHMARK', n(rt, (r) => r.task_type === 'OUTCOME_AUDIT' && r.franchise_key !== 'DODGERS'), 'IDENTITY_BLOCKED', 'MEDIUM', 'The three unresolved benchmark identities (Yrizarry, Rosario, Amundaray); each blocks a reach label and both bWAR labels.'],
  ['v_research_tasks', 'ACQUISITION_COST_UNKNOWN', 'DODGERS', n(rt, (r) => r.task_type === 'ACQUISITION_COST_UNKNOWN' && r.franchise_key === 'DODGERS'), 'LOW_MATERIALITY', 'LOW', 'Cost is excluded from the 041 feature set by design and resolving it adds no label. Many small international bonuses were probably never reported, but the schema cannot mark a value UNDISCLOSED, so no row is classified that way.'],
  ['v_research_tasks', 'ACQUISITION_COST_UNKNOWN', 'BENCHMARK', n(rt, (r) => r.task_type === 'ACQUISITION_COST_UNKNOWN' && r.franchise_key !== 'DODGERS'), 'LOW_MATERIALITY', 'NONE', 'Benchmark costs never enter a Dodgers estimate or a 041 feature.'],
  ['v_research_tasks', 'BWAR_MISSING', 'BENCHMARK', n(rt, (r) => r.task_type === 'BWAR_MISSING'), 'NOT_APPLICABLE', 'NONE', 'Reads the CAREER_BWAR metric, which no label reads (labels read team-season WAR). 062 (not applied here) is described as adding owner-observed career bWAR for 32 of the 39, which would leave 7, without moving a label.'],
  ['v_research_tasks', 'SIGNING_DATE_MISSING', 'ALL', n(rt, (r) => r.task_type === 'SIGNING_DATE_MISSING'), 'ACTIONABLE', 'LOW', 'Only the feature cutoff precision depends on it (YEAR_END fallback is leakage-safe); era_key is ambiguous only for undated 2012 / 2017 signings.'],
  ['v_research_tasks', 'MARKET_MISSING', 'ALL', n(rt, (r) => r.task_type === 'MARKET_MISSING'), 'ACTIONABLE', 'MEDIUM', `Market is a 041 model feature; ${fr('country_market', 'DODGERS_REACH_LABELLED').missing} of ${fr('country_market', 'DODGERS_REACH_LABELLED').eligible} labelled Dodgers reach rows lack it and drop out of the evaluation.`],
  ['v_research_tasks', 'CLASS_MEMBERS_MISSING / CLASS_SIZE_SOURCE_NOT_OFFICIAL', 'DODGERS', n(rt, (r) => ['CLASS_MEMBERS_MISSING', 'CLASS_SIZE_SOURCE_NOT_OFFICIAL'].includes(r.task_type)), 'ACTIONABLE', 'HIGH', `Census completeness of Dodgers signing classes. Missing members: ${classGapText}. These are the highest-value research items for Dodgers support.`],
  ['v_outcome_probability_research_queue', 'LABEL_BLOCKED_BY_MISSING_AUDIT (4 deferred 2016 benchmark reachers)', 'BENCHMARK', 8, 'ACTIONABLE', 'MEDIUM', 'Gabriel Arias, Jorge Oña, Luis García Jr., Francisco Morales: horizon 2026 elapsed, labels wait for a post-2026-season Baseball-Reference capture (057 notes). Each adds one positive-bWAR and one 2+ bWAR label.'],
  ['v_outcome_probability_research_queue', 'LABEL_BLOCKED_BY_MISSING_AUDIT (3 identities)', 'BENCHMARK', 9, 'IDENTITY_BLOCKED', 'LOW', 'Yrizarry (birth-country conflict), Rosario, Amundaray (no SFA transaction): 3 labels per target family.'],
  ['v_dodgers_mature_outcome_queue', 'mature 2021 opening-class unaudited', 'DODGERS', rows('mature_outcome_queue').length, 'ACTIONABLE', 'LOW', 'Final classification is not possible for the five still-affiliated players; the two with no record need evidence. None of them labels a target before 2028.'],
  ['v_dodgers_development_research_queue', 'development dates / levels', 'DODGERS', rows('development_queue').length, 'LOW_MATERIALITY', 'NONE', 'Post-signing facts: never a feature for a signing-time target. Issues: ' + Object.entries(count(rows('development_queue'), (r) => r.issue)).map(([k, v]) => `${k} ${v}`).join(', ') + '.'],
  ['v_transaction_research_queue', 'CASH_AMOUNT_UNKNOWN / POOL_SPACE_AMOUNT_UNKNOWN', 'DODGERS', n(rows('transaction_queue'), (r) => ['CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN'].includes(r.issue)), 'UNDISCLOSED', 'NONE', 'The 061 research read the reports and these amounts are not stated (061 README); organizational value only, never a label or feature.'],
  ['v_transaction_research_queue', 'other transaction gaps', 'DODGERS', n(rows('transaction_queue'), (r) => !['CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN'].includes(r.issue)), 'NOT_APPLICABLE', 'NONE', 'Transaction value is organizational value (034), not an outcome-probability label or feature. Issues: ' + Object.entries(count(rows('transaction_queue').filter((r) => !['CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN'].includes(r.issue)), (r) => r.issue)).map(([k, v]) => `${k} ${v}`).join(', ') + '.'],
  ['v_value_research_queue', 'value gaps', 'DODGERS', rows('value_queue').length, 'NOT_APPLICABLE', 'LOW', 'Affects the expected-value layer (042) only after a probability target is supported. Issues: ' + Object.entries(count(rows('value_queue'), (r) => r.issue)).map(([k, v]) => `${k} ${v}`).join(', ') + '.'],
  ['v_financial_research_queue', 'financial provenance', 'ALL', rows('financial_queue').length, 'LOW_MATERIALITY', 'NONE', 'Provenance and pool treatment; no label or 041 feature. Issues: ' + Object.entries(count(rows('financial_queue'), (r) => r.issue)).map(([k, v]) => `${k} ${v}`).join(', ') + '.'],
  ['v_international_benchmark_research_queue', 'benchmark research', 'BENCHMARK', rows('benchmark_queue').length, 'LOW_MATERIALITY', 'LOW', 'Issues: ' + Object.entries(count(rows('benchmark_queue'), (r) => r.issue)).map(([k, v]) => `${k} ${v}`).join(', ') + '. BENCHMARK_REACHED_WITHOUT_TEAM_SEASON_FACTS rows with a horizon still open are censored anyway.'],
  ['v_dodgers_player_identity_research_queue', 'identity attributes', 'ALL', rows('identity_queue').length, 'LOW_MATERIALITY', 'NONE', 'Handedness / birthplace; not 041 features. The 3 MLB_ID_UNRESOLVED rows are the benchmark identities above.'],
]
const dReach = targetOut.targets[0].populations[0]
const blockers = [
  { rank: 1, blocker: 'DODGERS_CENSUS_EXPANSION_MATURE_CLASSES', category: 'NEEDS_CENSUS_EXPANSION', classification: 'ACTIONABLE', model_impact: 'HIGH', count: dReach.usable_labelled_n,
    detail: `Only ${dReach.usable_labelled_n} Dodgers amateur rows can carry a 7-season label (classes 2015, 2018, 2019; none for 2016-2017 or before 2015 outside the outcome-selected set). Support needs ${dReach.additional_labels_needed} more labels and ${dReach.additional_positives_needed} more positives; at the observed Dodgers rate (${dReach.positives}/${dReach.usable_labelled_n}) 10 positives imply roughly ${Math.ceil(10 / (dReach.positives / dReach.usable_labelled_n))} labelled rows. DISI already registers the expected size of three mature classes with members missing (${classGapText}): up to ${classGapMissing} signees (fewer if some are professional-route), ${classGapReach} of them past the 7-season horizon and ${classGap10} past the 10-season horizon. Loading and auditing them could by itself clear the 50-row minimum; whether it clears 10 positives depends on how many reached MLB. No CLASS_MEMBERS_MISSING task exists for any other mature class; this audit did not check whether those classes have a registered size.` },
  { rank: 2, blocker: 'HORIZON_CENSORING_OF_RECENT_DODGERS_CLASSES', category: 'NEEDS_MORE_LABELS (time)', classification: 'STRUCTURALLY_UNKNOWN', model_impact: 'HIGH', count: D.by_target.REACH_MLB_WITHIN_7_SEASONS.training_state.CENSORED,
    detail: `${D.by_target.REACH_MLB_WITHIN_7_SEASONS.training_state.CENSORED} of ${D.model_scope_n} Dodgers in-scope rows are CENSORED for the 7-season target (2021+ classes; the 2021 class labels after the 2028 season, 2022 after 2029). No research shortens this; it is a waiting cost.` },
  { rank: 3, blocker: 'EVENTS_PER_FEATURE_FOR_ANY_FITTED_MODEL', category: 'NEEDS_CENSUS_EXPANSION (benchmark depth)', classification: 'ACTIONABLE', model_impact: 'HIGH', count: current[0]?.positives,
    detail: `Best case (REACH pooled): ${current[0]?.positives} positives against 60 needed for the 6-feature logistic; the population-stratified rate has no out-of-time skill. The benchmark already covers every mature class 2013-2019 (Top 30); more events need deeper lists or a league census, not more classes.` },
  { rank: 4, blocker: 'DODGERS_SIGNING_TIME_EXPECTATION_MISSING', category: 'NEEDS_DATA', classification: 'ACTIONABLE', model_impact: 'MEDIUM', count: fr('expectation_at_signing (scouting band)', 'DODGERS_MODEL_SCOPE').missing,
    detail: `${fr('expectation_at_signing (scouting band)', 'DODGERS_MODEL_SCOPE').known} of ${fr('expectation_at_signing (scouting band)', 'DODGERS_MODEL_SCOPE').eligible} Dodgers in-scope rows have a pre-signing expectation band versus ${fr('expectation_at_signing (scouting band)', 'BENCHMARK_MODEL_SCOPE').known} of ${fr('expectation_at_signing (scouting band)', 'BENCHMARK_MODEL_SCOPE').eligible} benchmark rows, so is_top_expectation_band and is_top_prospect_sample are confounded with population.` },
  { rank: 5, blocker: 'DODGERS_10_SEASON_TARGETS_HAVE_NO_DEPTH', category: 'NEEDS_CENSUS_EXPANSION', classification: 'STRUCTURALLY_UNKNOWN', model_impact: 'MEDIUM', count: D.by_target.POSITIVE_BWAR_WITHIN_10_SEASONS.usable_labelled_n,
    detail: `10-season targets label only 2016-and-earlier signings: ${D.by_target.POSITIVE_BWAR_WITHIN_10_SEASONS.usable_labelled_n} Dodgers rows (${D.by_target.POSITIVE_BWAR_WITHIN_10_SEASONS.positives} positive bWAR, ${D.by_target.DODGERS_MLB_VALUE_WITHIN_10_SEASONS.positives} Dodgers-value positive). DODGERS_MLB_VALUE gates the only expected-value model.` },
  { rank: 6, blocker: 'BENCHMARK_LABELS_BLOCKED (4 deferred reachers + 3 identities)', category: 'NEEDS_MORE_LABELS', classification: 'ACTIONABLE', model_impact: 'MEDIUM', count: 7,
    detail: 'BWAR_2 benchmark support is one positive short; the 4 deferred 2016 reachers are the only near-term source of that positive (post-2026 capture).' },
  { rank: 7, blocker: 'DODGERS_MARKET_MISSING_IN_LABELLED_ROWS', category: 'NEEDS_DATA', classification: 'ACTIONABLE', model_impact: 'LOW', count: fr('country_market', 'DODGERS_REACH_LABELLED').missing,
    detail: `${fr('country_market', 'DODGERS_REACH_LABELLED').missing} labelled Dodgers reach rows lack market and 1 lacks position, so ${D.by_target.REACH_MLB_WITHIN_7_SEASONS.usable_labelled_n_features_complete} of ${D.by_target.REACH_MLB_WITHIN_7_SEASONS.usable_labelled_n} enter the evaluation.` },
]
const backlogRows = [
  ...blockers.map((b) => ({ rank: b.rank, item: b.blocker, source: 'audit', population: b.blocker.startsWith('BENCHMARK') ? 'BENCHMARK' : b.blocker.startsWith('EVENTS') ? 'POOLED' : 'DODGERS', count: b.count, classification: b.classification, verdict_category: b.category, model_impact: b.model_impact, detail: b.detail })),
  ...queues.map(([src, issue, popn, c, cls, impact, detail], i) => ({ rank: blockers.length + 1 + i, item: issue, source: src, population: popn, count: c, classification: cls, verdict_category: '', model_impact: impact, detail })),
]
write('priority-backlog.csv', csv(['rank', 'item', 'source', 'population', 'count', 'classification', 'verdict_category', 'model_impact', 'detail'], backlogRows))

// ---------------------------------------------------------------------------------------------------------------- 9/10. report
const verdict = 'NEEDS_MULTIPLE'
const verdictParts = ['NEEDS_CENSUS_EXPANSION', 'NEEDS_MORE_LABELS', 'NEEDS_DATA']
const tline = (t) => t.populations.filter((p) => p.applicable).map((p) => `| ${t.target_key} | ${p.population} | ${p.usable_labelled_n} | ${p.usable_labelled_n_features_complete} | ${p.positives} | ${p.negatives} | ${p.censored} | ${p.missing_label_past_horizon} | ${p.positive_rate === null ? 'n/a' : p.positive_rate.toFixed(4)} | ${p.support_state} | ${p.additional_labels_needed} / ${p.additional_positives_needed} |`).join('\n')
const featTable = (scope) => featureRows.filter((r) => r.scope === scope).map((r) => `| ${r.feature} | ${r.timing} | ${r.model_role} | ${r.eligible} | ${r.known} | ${r.missing} | ${r.completeness_pct} | ${r.missingness} |`).join('\n')
const cp = costPolicy
const report = `# DISI model-readiness audit (frozen 061 state)

Read-only audit of the canonical post-061 replay (analysis as of ${asOf}, last complete MLB season ${lastCompleteSeason}). Export SHA-256 \`${exportSha}\`.
No migration, database write, model fit or evaluation re-run was made. Numbers are exact counts from the export; the only estimate is marked as one.

**Verdict: ${verdict}** (${verdictParts.join(' + ')}). Supported fitted models ${modelHistory.supported_models}; Dodgers supported targets 0; probabilities, expected values and recommendations 0.

## 1. Population (Dodgers and benchmark are never pooled for support)

| | Dodgers | Benchmark |
|---|---:|---:|
| Signings | ${D.total_signings} | ${B.total_signings} |
| Signing years | ${D.signing_years.min}-${D.signing_years.max} | ${B.signing_years.min}-${B.signing_years.max} |
| Population classes | ${Object.entries(D.population_class).map(([k, v]) => `${k} ${v}`).join(', ')} | ${Object.entries(B.population_class).map(([k, v]) => `${k} ${v}`).join(', ')} |
| Model scope (reference population, amateur route) | ${D.model_scope_n} | ${B.model_scope_n} |
| Outcome-mature (5-year rule), all | ${D.outcome_maturity.MATURE || 0} | ${B.outcome_maturity.MATURE || 0} |
| Outcome-mature, model scope | ${D.outcome_maturity_in_model_scope.MATURE || 0} | ${B.outcome_maturity_in_model_scope.MATURE || 0} |
| 7-season horizon elapsed (exposure complete) | ${D.by_target.REACH_MLB_WITHIN_7_SEASONS.exposure_complete} | ${B.by_target.REACH_MLB_WITHIN_7_SEASONS.exposure_complete} |
| 10-season horizon elapsed | ${D.by_target.POSITIVE_BWAR_WITHIN_10_SEASONS.exposure_complete} | ${B.by_target.POSITIVE_BWAR_WITHIN_10_SEASONS.exposure_complete} |
| Reached MLB true / false / unaudited | ${D.reached_mlb.true} / ${D.reached_mlb.false} / ${D.reached_mlb.unaudited} | ${B.reached_mlb.true} / ${B.reached_mlb.false} / ${B.reached_mlb.unaudited} |
| Unaudited outcomes | ${D.unaudited_outcomes} | ${B.unaudited_outcomes} |
| Mature without a final outcome | ${D.mature_without_final_outcome} | ${B.mature_without_final_outcome} |
| Positive / non-positive bWAR labels (in scope) | ${D.positive_bwar_labels_in_scope.positive} / ${D.positive_bwar_labels_in_scope.non_positive} | ${B.positive_bwar_labels_in_scope.positive} / ${B.positive_bwar_labels_in_scope.non_positive} |
| Positive-bWAR label missing past horizon | ${D.positive_bwar_labels_in_scope.missing_past_horizon} | ${B.positive_bwar_labels_in_scope.missing_past_horizon} |
| Signing-time features complete (age, position, market), model scope | ${D.model_features_complete.model_scope} / ${D.model_scope_n} | ${B.model_features_complete.model_scope} / ${B.model_scope_n} |

Dodgers model-scope rows by signing year: ${Object.entries(D.model_scope_by_year).map(([k, v]) => `${k}: ${v}`).join(', ')}. The ${D.population_class.OUTCOME_SELECTED_SAMPLE} outcome-selected historical signings (1951-2017) carry labels but are excluded by design (selected because they reached MLB); the 3 professional-route signings are excluded.

**Usable N** (labelled, in scope): Dodgers ${D.by_target.REACH_MLB_WITHIN_7_SEASONS.usable_labelled_n} for REACH_MLB_WITHIN_7_SEASONS (${D.by_target.REACH_MLB_WITHIN_7_SEASONS.usable_labelled_n_features_complete} with complete features), ${D.by_target.POSITIVE_BWAR_WITHIN_10_SEASONS.usable_labelled_n} for each 10-season target. Benchmark ${B.by_target.REACH_MLB_WITHIN_7_SEASONS.usable_labelled_n} for reach (${B.by_target.REACH_MLB_WITHIN_7_SEASONS.usable_labelled_n_features_complete} complete), ${B.by_target.POSITIVE_BWAR_WITHIN_10_SEASONS.usable_labelled_n} for each bWAR target (${B.by_target.POSITIVE_BWAR_WITHIN_10_SEASONS.usable_labelled_n_features_complete} complete).

## 2. Targets

| Target | Population | Labelled N | Features complete | Positives | Negatives | Censored | Missing past horizon | Positive rate | Support | Needs labels / positives |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
${targetOut.targets.map(tline).join('\n')}

Thresholds (every target): ${targets[0].min_reference_n} labelled, ${targets[0].min_positives} positives, ${targets[0].min_negatives} negatives; ${targets[0].events_per_feature} events per model feature.

Limiting target: **${targetOut.limiting_target.dodgers_nearest_to_support.target_key}** (${targetOut.limiting_target.dodgers_nearest_to_support.gap}). ${targetOut.limiting_target.statement}

${targetOut.limiting_target.benchmark}

062 effect: ${targetOut.effect_of_062}

## 3. Feature completeness

The 041 model features are signing-time only: population class, age in signing year, position family at signing, market group, and the earliest expectation band dated on or before the signing cutoff. Bonus / cost is shown but excluded by design. Development, later evaluations, bWAR and transactions are post-signing facts and are never features for these targets (the feature matrix is tested to be invariant to them). "STRUCTURAL" means the missing rate differs by at least 40 points between signing years with 5 or more rows; details per row are in \`feature-coverage.csv\`.

Dodgers model scope (${dScope.length} rows):

| Feature | Timing | Role | Eligible | Known | Missing | % | Missingness |
|---|---|---|---:|---:|---:|---:|---|
${featTable('DODGERS_MODEL_SCOPE')}

Benchmark model scope (${scopes.BENCHMARK_MODEL_SCOPE.length} rows):

| Feature | Timing | Role | Eligible | Known | Missing | % | Missingness |
|---|---|---|---:|---:|---:|---:|---|
${featTable('BENCHMARK_MODEL_SCOPE')}

Top missing features that matter: (1) expectation at signing for Dodgers (${fr('expectation_at_signing (scouting band)', 'DODGERS_MODEL_SCOPE').known}/${fr('expectation_at_signing (scouting band)', 'DODGERS_MODEL_SCOPE').eligible}), a 041 logistic input; (2) acquisition cost (${fr('total_known_acquisition_cost_usd', 'DODGERS_MODEL_SCOPE').known}/${fr('total_known_acquisition_cost_usd', 'DODGERS_MODEL_SCOPE').eligible} Dodgers in scope, ${fr('total_known_acquisition_cost_usd', 'BENCHMARK_MODEL_SCOPE').known}/${fr('total_known_acquisition_cost_usd', 'BENCHMARK_MODEL_SCOPE').eligible} benchmark), excluded by design; (3) market for Dodgers (${fr('country_market', 'DODGERS_MODEL_SCOPE').missing} missing, ${fr('country_market', 'DODGERS_REACH_LABELLED').missing} of them in labelled rows); (4) exact signing date (${fr('exact_signing_date', 'DODGERS_MODEL_SCOPE').missing} Dodgers in scope, ${fr('exact_signing_date', 'BENCHMARK_MODEL_SCOPE').missing} benchmark), cutoff precision only.

## 4. Unknown-cost policy (evaluated, not applied)

Proposal: \`acquisition_cost_model_usd = COALESCE(total_known_acquisition_cost_usd, 0)\`, \`acquisition_cost_missing = (total_known_acquisition_cost_usd IS NULL)\`, and \`acquisition_cost_state\` in KNOWN / PARTIAL / UNKNOWN / UNDISCLOSED / NO_COST_RULE (KNOWN = COMPLETE, PARTIAL = PARTIAL lower bound, UNKNOWN = no component known, NO_COST_RULE = NO_RULE pathway, UNDISCLOSED = 0 rows: the schema has no field that distinguishes "never disclosed" from "not yet found").

| Scope | Rows | KNOWN | PARTIAL | UNKNOWN | UNDISCLOSED | NO_COST_RULE | Rows with a cost value before -> after | Known $0 rows | Reach-labelled rows with cost known | Positives / negatives with cost known |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---|
${Object.entries(cp).map(([k, v]) => `| ${k} | ${v.rows} | ${v.state.KNOWN} | ${v.state.PARTIAL} | ${v.state.UNKNOWN} | ${v.state.UNDISCLOSED} | ${v.state.NO_COST_RULE} | ${v.rows_with_cost_value_before} -> ${v.rows_with_cost_value_after} | ${v.known_zero_cost_rows} | ${v.reach_labelled_cost_known}/${v.reach_labelled} | ${v.reach_positive_cost_known} / ${v.reach_negative_cost_known} |`).join('\n')}

Findings:
- **Usable N.** It raises the rows that carry a cost value (Dodgers model scope ${cp.DODGERS_MODEL_SCOPE.rows_with_cost_value_before} -> ${cp.DODGERS_MODEL_SCOPE.rows_with_cost_value_after}). It adds no label. Labels are what limit every target, and cost is not a 041 feature, so the usable N of every target stays the same: Dodgers reach ${D.by_target.REACH_MLB_WITHIN_7_SEASONS.usable_labelled_n}.
- **Ledger.** It corrupts nothing as long as it stays a model-side derived column, in an export or a view that is never written back. Dodgers known cost stays ${dodgersKnown} / ${D.total_signings - dodgersKnown} and $${knownSpend.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}. It would corrupt the ledger if it were persisted into a cost column or into \`total_known_acquisition_cost_usd\`: the 0 would become indistinguishable from a known $0.00 (Pedro Astacio, outside model scope; ${cp.DODGERS_MODEL_SCOPE.known_zero_cost_rows} known-zero rows in Dodgers scope) and would understate a lower-bound spend.
- **Signal.** In the labelled Dodgers reach rows, cost is known for ${cp.DODGERS_REACH_LABELLED.reach_positive_cost_known} positives and ${cp.DODGERS_REACH_LABELLED.reach_negative_cost_known} negatives. Missingness tracks source coverage and signing class (\`feature-coverage.csv\` missingness_detail), so the indicator would learn coverage, not talent. PARTIAL values are lower bounds and must not be read as totals.
- **Verdict.** It is acceptable as a modelling convention: the indicator is mandatory, the state must be carried, nothing is written to the ledger, and it is used only in a model whose evaluation beats the base rate. It is not a readiness lever.

## 5. Mature outcome backlog (Dodgers, 5-year maturity, outcome not final)

${backlog.length} signings. Immature players are skipped. \`mature-outcome-gaps.csv\` has the evidence each one is missing and a Google query ready to paste.

| Player | Signing | Mature since | Reach horizon end | Reach state | Outcome state | Highest level (season) |
|---|---|---|---|---|---|---|
${backlog.map((b) => `| ${b.full_name} | ${b.signing_year} | ${b.mature_since} | ${b.reach_7_horizon_end_season} | ${b.reach_7_training_state}${b.reach_7_label ? ' ' + b.reach_7_label : ''} | ${b.outcome_state} | ${b.highest_affiliated_level || 'none'}${b.last_affiliated_season ? ' (' + b.last_affiliated_season + ')' : ''} |`).join('\n')}

None of the 12 can add a label today:
- The five 2018-2019 signings already carry a FALSE reach label. Their horizon has elapsed, and reach is not affected by whether their careers are over.
- The seven 2021 opening-class signings are CENSORED until the 2028 season for every target.
- Closing the backlog makes the outcome records final. It does not move support.

## 6. Development-path coverage (Dodgers model scope; benchmark has no development rows)

| Field | Eligible | Known exact | % | Classification |
|---|---:|---:|---:|---|
${devCoverage.map((r) => `| ${r.feature} | ${r.eligible} | ${r.known} | ${r.completeness_pct} | ${r.classification} |`).join('\n')}

Only the MLB debut date of a reacher feeds a label. It is complete, so it is not blocking. Every other development field is post-signing, so it is NICE_TO_HAVE for the 041 signing-time targets. It would become MODEL_BLOCKING only for a conditional model that is evaluated at a later as-of date (for example, P(MLB | reached full-season by season 2)), and no such target exists in \`outcome_targets\`.

## 7. Model history

| Target | Rows / positives / folds | Base-rate Brier | Model | Brier | Skill vs base | AUC | Events need / have | Decision | Failure reason |
|---|---|---:|---|---:|---:|---:|---|---|---|
${current.flatMap((c) => c.models.map((m) => `| ${c.target_key} | ${c.evaluated_rows} / ${c.positives} / ${c.folds} | ${c.baseline.brier} | ${m.model_key} | ${m.brier} | ${m.brier_skill_vs_base_rate} | ${m.auc} | ${m.events_needed} / ${m.events_available} | ${m.decision} | ${m.failure_reason} |`)).join('\n')}

Validation for every row is leave-one-signing-year-out over the pooled Dodgers and benchmark labelled rows with complete features. That is out-of-time by construction. There is no separate later holdout. All stored evaluations are current: the live training fingerprint matches. The only positive skill is REACH LOGISTIC_L2 (+${current[0].models.find((m) => m.model_key === 'LOGISTIC_L2').brier_skill_vs_base_rate}). It is rejected on events per feature (34 < 60). The research history (\`model-history.json\`) shows REACH moving through 59/8 (041), 101/19 (050), 148/30 (055) and 173/34 (056). Over those steps logistic skill went -0.123, -0.037, +0.035, +0.018. It is not monotone, and no fitted model was ever supported.

## 8. Research queues classified

Classes: ACTIONABLE, UNDISCLOSED, STRUCTURALLY_UNKNOWN, LOW_MATERIALITY, NOT_APPLICABLE, IDENTITY_BLOCKED. The goal is not to drive the queues to zero: most queue rows have no model impact.

| Queue | Item | Population | Count | Class | Model impact |
|---|---|---|---:|---|---|
${queues.map(([src, issue, popn, c, cls, impact]) => `| ${src} | ${issue} | ${popn} | ${c} | ${cls} | ${impact} |`).join('\n')}

## 9. Verdict and blockers

**${verdict}**: ${verdictParts.join(', ')}. Ranked by expected impact on reaching Dodgers support and a supported model:

${blockers.map((b) => `${b.rank}. **${b.blocker}** (${b.category}; ${b.classification}). ${b.detail}`).join('\n')}

The estimate in blocker 1 is arithmetic on the observed rate. It is not a forecast.

## Not verified

- The 062 effect is reasoned from the label definitions in 041. It was not measured, because 062 is not applied to this replay.
- The replay is generation 15; production is generation 16. The two are logically equal per the release records. Production was not read.
- UNDISCLOSED cost cannot be separated from UNKNOWN with the current schema. The 0 in that column is a schema limit, not a finding.
`
write('audit-report.md', report)
process.stderr.write(`built from ${path.relative(root, exportPath)} (${exportSha.slice(0, 12)})\n`)
