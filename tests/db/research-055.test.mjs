// Migration 055: the international benchmark deepened with the mature 2017 and 2018 classes. The 054a database is built (001-054a), 055 is
// applied for real, and the tests prove that a listed player becomes a benchmark signing only with a verified signing and identity, that the two
// listed Dodgers signings (Cartaya, Rosario) are untouched (Rosario's rank stays NULL), that nothing that existed before 055 moves (the 2013-2016
// benchmark included), that the signing year drives the fixed horizons (a 10-season label stays censored), that a death before the horizon is
// never a negative label, that benchmark support never reaches a Dodgers probability, that the stored evaluation is re-run and supports no
// model, and that 055 is idempotent, guarded, reproducible and reversible.
//   RANKING APPEARANCE != NEW SIGNING   SOURCE LIST MEMBERSHIP != VERIFIED SIGNING   NO MLB DEBUT != NEGATIVE OUTCOME   BENCHMARK SUPPORT != DODGERS SUPPORT

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS, EXPECTATIONS_THROUGH_054A } from '../../scripts/db/lib/invariants.mjs'
import { measure } from '../../database/research/055/measure.mjs'
import { assemble, assembleRollback, research } from '../../database/research/055/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '055_international_benchmark_2017_2018.sql'
const sql055 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback055 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-055.sql'), 'utf8')
const evaluation = JSON.parse(fs.readFileSync(path.join(root, 'database/research/055/evaluation.json'), 'utf8'))
const evaluation050 = JSON.parse(fs.readFileSync(path.join(root, 'database/research/050/evaluation.json'), 'utf8'))
const DODGERS = 'DODGERS_TRACKED_AND_OPENING_CLASS'
const BENCH = 'TOP_PROSPECT_SAMPLE'
const NEW_POPS = ['MLB-2017-PIPELINE-TOP30', 'MLB-2018-PIPELINE-TOP30']

let chain
let pre055Dump
let pre
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
const R = (x) => (Array.isArray(x) ? x : x.rows)
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const clone = async (dump) => {
  const db = new PGlite({ loadDataDir: dump, extensions: { pgcrypto } })
  return { db, query: async (s, p) => (await db.query(s, p)).rows, close: () => db.close() }
}
const failsWith = async (c, sql, pattern) => {
  try { await c.db.exec(sql) } catch (e) {
    await c.db.exec('rollback;').catch(() => {})
    assert.match(String(e.message), pattern)
    return
  }
  assert.fail(`expected the statement to fail with ${pattern}`)
}
const tableHashes = async (c = chain) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5(R(await c.query(`select (to_jsonb(t) - 'updated_at')::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const label = async (slug, target, c = chain) => (await c.query(`select label, training_state, exposure_complete, horizon_end_season, signing_year, reference_population
  from public.v_outcome_training_population where player_slug = $1 and target_key = $2`, [slug, target]))[0]
const slugOf = (id) => research.newPlayers.find((p) => p.mlb_id === id)?.slug
const dodgersRanks = (c = chain) => c.query(`select p.slug, s.international_rank::text as r, s.record_scope from public.signings s join public.players p on p.id = s.player_id
  join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS' order by 1`)

let preDodgersRanks, preTables
before(async () => {
  chain = await buildChainThrough('054a_development_queue_performance.sql')
  pre055Dump = await chain.db.dumpDataDir('none')
  pre = await measure(q)
  preDodgersRanks = await dodgersRanks()
  preTables = await tableHashes()
  await chain.db.exec(sql055)
}, { timeout: 900000 })

after(async () => { await chain?.close() })

test('055 follows 054a in the manifest as the last file and is not frozen', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '054a_development_queue_performance.sql')
  assert.equal(i, manifest.canonical_sql.length - 1)
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.ok(!(FILE in frozen))
  assert.match(sql055, /^-- DISI v0\.40\n-- 055_international_benchmark_2017_2018\.sql\n/)
  assert.match(rollback055, /^-- DISI rollback of Migration 055/)
})

test('baseline: the 055 research was written against exactly this pre-055 state', () => {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'database/research/055/baseline.json'), 'utf8'))
  assert.deepEqual(pre.counts, b.counts)
  assert.deepEqual(pre.support, b.support)
  assert.ok(pre.evaluation.every((e) => e.evaluation_current && e.training_fingerprint === evaluation050.fingerprint), 'the 050 evaluation is the stored, current one before 055')
})

test('data only: no table, view, function, grant, policy, trigger or definition changes', async () => {
  const c = await clone(pre055Dump)
  try {
    const cat = async (x) => ({
      rel: await x.query(`select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'i') order by 1`),
      fn: await x.query(`select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile, md5(p.prosrc) as h from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
      pol: await x.query(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`),
      trg: await x.query(`select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
      views: await x.query(`select relname, md5(pg_get_viewdef(oid)) as h from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`),
    })
    assert.deepEqual(await cat(chain), await cat(c))
  } finally { await c.close() }
})

test('membership: 50 benchmark signings; every one of the 60 listed members has one decision; the not-added are queued, never players', async () => {
  const m = await measure(q)
  assert.deepEqual([m.counts.players - pre.counts.players, m.counts.benchmark_signings - pre.counts.benchmark_signings, m.counts.player_evaluations - pre.counts.player_evaluations,
    m.counts.outcome_audits - pre.counts.outcome_audits, m.counts.signing_populations - pre.counts.signing_populations, m.counts.census_coverage_rows - pre.counts.census_coverage_rows],
    [50, 50, 50, 50, 2, 2])
  const pops = await q(`select population_key, population_scope, expected_size, rate_analysis_suitable, stated_composition from public.signing_populations where population_key = any($1) order by 1`, [NEW_POPS])
  assert.deepEqual(pops.map((p) => [p.population_key, p.population_scope, p.expected_size, p.rate_analysis_suitable]), [[NEW_POPS[0], BENCH, 30, false], [NEW_POPS[1], BENCH, 30, false]])
  const [p17, p18] = pops.map((p) => p.stated_composition)
  assert.deepEqual([p17.benchmark_signings, p17.identity_unresolved.length, p17.deceased_before_outcome_horizon.length], [28, 1, 1])
  assert.deepEqual([p18.benchmark_signings, p18.dodgers_signings_mapped.length, p18.route_not_established.length, p18.identity_unresolved.length], [22, 2, 3, 3])
  for (const p of [p17, p18]) {
    assert.equal(p.benchmark_signings + p.dodgers_signings_mapped.length + p.identity_unresolved.length + p.identity_conflicts.length + p.route_not_established.length
      + p.deceased_before_outcome_horizon.length, p.list_members, 'every listed player has exactly one decision; none is silently dropped')
  }
  const members = await q(`select sp.population_key, count(*)::int as n from public.signing_population_members m join public.signing_populations sp on sp.id = m.population_id
    where sp.population_key = any($1) group by 1 order by 1`, [NEW_POPS])
  assert.deepEqual(members.map((r) => r.n), [28, 22])
  for (const id of [677567, 682625, 682630, 682631, 682640, 682624, 682644]) {
    assert.equal((await one(`select count(*)::int as n from public.players where mlb_id = $1`, [id])).n, 0, `${id} is queued, not added`)
  }
  assert.equal((await one(`select count(*)::int as n from public.players where public.disi_ascii_fold(full_name) ilike any(array['Wild%Pati%o', 'Wilderd%'])`)).n, 0)
  const notTracked = await q(`select population_key, detail from public.v_international_benchmark_research_queue where issue = 'POPULATION_MEMBERS_NOT_TRACKED' and population_key = any($1) order by 1`, [NEW_POPS])
  assert.deepEqual(notTracked.map((r) => r.population_key), NEW_POPS)
  assert.match(notTracked[0].detail, /names 30 members; 28 are tracked/)
  assert.match(notTracked[1].detail, /names 30 members; 22 are tracked/)
})

test('Dodgers protection: Cartaya and Rosario keep their one Dodgers signing byte for byte (Rosario\'s rank stays NULL); no Dodgers rank or row moves', async () => {
  for (const [slug, rank] of [['diego-cartaya', '1.00'], ['jerming-rosario', null]]) {
    const r = await one(`select count(*)::int as signings, count(*) filter (where s.record_scope = 'TRACKED_DODGERS')::int as dodgers,
        count(*) filter (where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')::int as benchmark, max(s.international_rank)::text as rank
      from public.signings s join public.players p on p.id = s.player_id where p.slug = $1`, [slug])
    assert.deepEqual(r, { signings: 1, dodgers: 1, benchmark: 0, rank })
    assert.equal((await one(`select count(*)::int as n from public.player_evaluations e join public.players p on p.id = e.player_id join public.player_evaluation_rankings r on r.evaluation_id = e.id
      where p.slug = $1 and r.scope_label like '201_ MLB Pipeline Top 30 international prospects' and r.scope_label in ('2017 MLB Pipeline Top 30 international prospects', '2018 MLB Pipeline Top 30 international prospects')`, [slug])).n, 0)
  }
  assert.deepEqual(await dodgersRanks(), preDodgersRanks, 'every Dodgers signing keeps its stored MLB Pipeline rank (or NULL)')
  assert.equal((await one(`select count(*)::int as n from public.players p where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
    and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')`)).n, 0)
  const m = await measure(q)
  for (const k of ['dodgers_players', 'dodgers_signings', 'dodgers_audits', 'dodgers_verified_mlb', 'dodgers_verified_no_mlb', 'dodgers_not_audited', 'known_costs', 'known_spend_usd',
    'open_research_tasks', 'stints', 'milestones', 'transaction_events', 'transaction_assets', 'war_rows']) assert.equal(m.counts[k], pre.counts[k], `${k} does not move`)
  for (const k of ['dodgers_signings_hash', 'dodgers_audits_hash', 'war_hash', 'financial_reports_hash', 'transactions_hash', 'development_hash']) assert.equal(m.hashes[k], pre.hashes[k], `${k} is byte-identical`)
})

test('nothing that existed before moves: every table differs only by added rows (the 2013-2016 benchmark, sources, snapshots aside)', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => now[t] !== preTables[t]).sort()
  assert.deepEqual(changed.filter((t) => !t.startsWith('product_')), ['evidence', 'outcome_audits', 'outcome_evidence', 'outcome_model_evaluations', 'outcomes', 'player_aliases',
    'player_evaluation_rankings', 'player_evaluations', 'players', 'signing_census_coverage', 'signing_population_member_sources', 'signing_population_members', 'signing_populations',
    'signings', 'sources'])
  // the pre-existing rows of each changed table (minus the evaluation rows 055 replaces) are byte-identical: the old rows are a subset of the new
  const c = await clone(pre055Dump)
  try {
    for (const t of ['evidence', 'outcome_audits', 'outcome_evidence', 'outcomes', 'player_aliases', 'player_evaluation_rankings', 'player_evaluations', 'players', 'signing_census_coverage',
      'signing_population_member_sources', 'signing_population_members', 'signing_populations', 'signings', 'sources']) {
      const rows = async (x) => new Set(R(await x.query(`select (to_jsonb(t) - 'updated_at')::text as r from public.${t} t`)).map((r) => r.r))
      const [a, b] = [await rows(c), await rows(chain)]
      assert.equal([...a].filter((r) => !b.has(r)).length, 0, `${t}: no existing row changed or disappeared`)
    }
  } finally { await c.close() }
  // the 2013-2016 benchmark: its signings, members and coverage rows are byte-identical
  const old = async (x) => md5(await x.query(`select s.*, sp.population_key from public.signings s join public.signing_population_members m on m.signing_id = s.id
    join public.signing_populations sp on sp.id = m.population_id where sp.population_key like 'MLB-201_-PIPELINE-TOP30' and sp.population_key <> all($1) order by s.id`, [NEW_POPS]))
  const c2 = await clone(pre055Dump)
  try { assert.equal(await old(chain), await old(c2)) } finally { await c2.close() }
})

test('horizons and labels: the 041 rules decide every label; 2017 / 2018 reach labels are final, their 10-season labels censored', async () => {
  const by = Object.fromEntries((await measure(q)).benchmark_labels.map((l) => [`${l.population_key}/${l.target_key}`, l]))
  assert.deepEqual([by[`${NEW_POPS[0]}/REACH_MLB_WITHIN_7_SEASONS`].positive, by[`${NEW_POPS[0]}/REACH_MLB_WITHIN_7_SEASONS`].negative, by[`${NEW_POPS[0]}/REACH_MLB_WITHIN_7_SEASONS`].censored], [5, 23, 0])
  assert.deepEqual([by[`${NEW_POPS[1]}/REACH_MLB_WITHIN_7_SEASONS`].positive, by[`${NEW_POPS[1]}/REACH_MLB_WITHIN_7_SEASONS`].negative, by[`${NEW_POPS[1]}/REACH_MLB_WITHIN_7_SEASONS`].censored], [6, 16, 0])
  for (const p of NEW_POPS) for (const t of ['POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS']) {
    const l = by[`${p}/${t}`]
    assert.deepEqual([l.positive, l.negative, l.censored], [0, 0, l.rows], `${p} ${t}: the 10-season horizon has not elapsed, so every label is censored`)
  }
  // George Valera signed in 2017 and debuted in 2025 (his eighth season): FALSE for reach within 7, while his audit stays REACHED_MLB
  const valera = await label(slugOf('671655'), 'REACH_MLB_WITHIN_7_SEASONS')
  assert.deepEqual([valera.signing_year, valera.label], [2017, false])
  assert.equal((await one(`select a.outcome_state from public.outcome_audits a join public.players p on p.id = a.player_id where p.mlb_id = 671655`)).outcome_state, 'REACHED_MLB')
  // Osleivis Basabe signed 2017-12-23 and debuted 2023: TRUE; a 2018 signing's 10-season horizon ends in 2028
  assert.equal((await label(slugOf('678545'), 'REACH_MLB_WITHIN_7_SEASONS')).label, true)
  const alvarez = await label(slugOf('682626'), 'POSITIVE_BWAR_WITHIN_10_SEASONS')
  assert.deepEqual([alvarez.horizon_end_season, alvarez.exposure_complete, alvarez.label, alvarez.training_state], [2028, false, null, 'CENSORED'])
  // no label is written by the migration: the targets and their rules are byte-identical
  const c = await clone(pre055Dump)
  try {
    const targets = async (x) => md5(await x.query(`select * from public.outcome_targets order by target_key`))
    assert.equal(await targets(c), await targets(chain))
    assert.doesNotMatch(sql055, /(insert into|update) public\.outcome_targets/)
  } finally { await c.close() }
  assert.equal((await one(`select count(*)::int as n from public.outcomes o join public.players p on p.id = o.player_id where p.slug = any($1::text[]) and o.career_war is not null`,
    [research.newPlayers.map((p) => p.slug)])).n, 0, 'MISSING BWAR != ZERO BWAR')
})

test('population separation: benchmark reach support deepens (140 / 30 / 110); Dodgers support does not move; no probability, expected value or recommendation', async () => {
  const sup = Object.fromEntries((await q(`select target_key || '/' || reference_population as k, labelled_n, positive_n, negative_n, support_state from public.v_outcome_target_support`)).map((r) => [r.k, r]))
  assert.deepEqual(sup[`REACH_MLB_WITHIN_7_SEASONS/${BENCH}`], { k: `REACH_MLB_WITHIN_7_SEASONS/${BENCH}`, labelled_n: 140, positive_n: 30, negative_n: 110, support_state: 'BASELINE_SUPPORTED' })
  for (const t of ['POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS']) {
    const before = pre.support.find((x) => x.target_key === t && x.reference_population === BENCH)
    assert.deepEqual([sup[`${t}/${BENCH}`].labelled_n, sup[`${t}/${BENCH}`].positive_n, sup[`${t}/${BENCH}`].support_state], [before.labelled_n, before.positive_n, 'BASELINE_NOT_SUPPORTED'])
  }
  for (const r of pre.support.filter((x) => x.reference_population === DODGERS)) {
    const now = sup[`${r.target_key}/${DODGERS}`]
    assert.deepEqual([now.labelled_n, now.positive_n, now.negative_n, now.support_state], [r.labelled_n, r.positive_n, r.negative_n, r.support_state], `${r.target_key}: Dodgers support is unchanged`)
  }
  const prob = await one(`select count(probability)::int as nn, count(*) filter (where prediction_eligible)::int as eligible from public.v_player_outcome_probability`)
  assert.deepEqual(prob, { nn: 0, eligible: 0 })
  const o = await one(`select supported_probability_targets, non_null_probabilities, supported_expected_value_models, supported_expected_values, predictive_portfolio_recommendations, supported_fitted_models, prediction_readiness_state from public.v_executive_overview`)
  assert.deepEqual(o, { supported_probability_targets: 0, non_null_probabilities: 0, supported_expected_value_models: 0, supported_expected_values: 0, predictive_portfolio_recommendations: 0,
    supported_fitted_models: 0, prediction_readiness_state: 'NO_SUPPORTED_PROBABILITY_TARGET' })
  assert.equal((await one(`select support_chain_state from public.v_disi_release_status`)).support_chain_state, 'NO_PREDICTIVE_LAYER_SUPPORTED')
  assert.equal((await one(`select count(*) filter (where probability_supported or expected_value_supported)::int as n from public.v_expected_value_support`)).n, 0)
})

test('thresholds: unchanged and not lowerable', async () => {
  const t = await q(`select target_key, min_reference_n, min_positives, min_negatives, events_per_feature from public.outcome_targets order by 1`)
  for (const r of t) assert.deepEqual([r.min_reference_n, r.min_positives, r.min_negatives, r.events_per_feature], [50, 10, 10, 10], `${r.target_key}: thresholds are not lowered`)
  const c = await clone(await chain.db.dumpDataDir('none'))
  try { await failsWith(c, `update public.outcome_targets set min_positives = 7 where target_key = 'POSITIVE_BWAR_WITHIN_10_SEASONS'`, /outcome_targets_min_positives_check/) } finally { await c.close() }
})

test('evaluation: re-run on the 055 data, current, a new fingerprint; no model supported (the logistic model has skill but too few events)', async () => {
  const ev = await q(`select model_key, evaluated_rows, positive_n, folds, decision, training_fingerprint, evaluation_current from public.v_outcome_model_evaluation order by model_key`)
  assert.ok(ev.every((e) => e.evaluation_current && e.training_fingerprint === evaluation.fingerprint && e.training_fingerprint !== evaluation050.fingerprint))
  assert.equal(evaluation.fingerprint, '67f2f80cf330e1278095916314688eee')
  assert.deepEqual(ev.map((e) => [e.model_key, e.evaluated_rows, e.positive_n, e.folds, e.decision]),
    [['BASE_RATE', 148, 30, 7, 'BASELINE_REFERENCE'], ['LOGISTIC_L2', 148, 30, 7, 'MODEL_NOT_SUPPORTED'], ['POPULATION_STRATIFIED_RATE', 148, 30, 7, 'MODEL_NOT_SUPPORTED']])
  const by = Object.fromEntries(evaluation.evaluations.map((e) => [e.model_key, e]))
  for (const e of evaluation050.evaluations) {
    assert.deepEqual([by[e.model_key].feature_list, by[e.model_key].training_populations, by[e.model_key].validation_method, by[e.model_key].target_key, by[e.model_key].model_version],
      [e.feature_list, e.training_populations, e.validation_method, e.target_key, e.model_version], 'the same models, features and validation as 041 / 050')
  }
  // the support rule, unchanged: the logistic model's out-of-time skill is positive, but 30 positives are short of the 60 its six features need
  assert.ok(by.LOGISTIC_L2.brier_skill_vs_base_rate > 0)
  assert.match(by.LOGISTIC_L2.decision_reason, /^INSUFFICIENT_EVENTS: 30 positives for 6 feature\(s\); at least 60 are required/)
  assert.ok(by.POPULATION_STRATIFIED_RATE.brier_skill_vs_base_rate <= 0)
  assert.match(by.POPULATION_STRATIFIED_RATE.decision_reason, /^NO_SKILL_OVER_BASELINE/)
  assert.equal((await one(`select count(*) filter (where model_support_state = 'MODEL_SUPPORTED')::int as n from public.v_player_outcome_probability`)).n, 0)
  assert.equal((await q(`select issue from public.v_outcome_probability_research_queue where issue = 'MODEL_EVALUATION_STALE'`)).length, 0)
})

test('product: one refresh, zero drift; readiness shows the benchmark row separately; the coverage ledger lists six samples', async () => {
  const gens = await q(`select distinct generation_id::text as g from public.product_executive_snapshot union select distinct generation_id::text from public.product_prediction_readiness`)
  assert.equal(gens.length, 1)
  assert.equal(Number(gens[0].g), Number(pre.counts.snapshot_generation) + 1)
  assert.deepEqual(await q(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`), [])
  const r = Object.fromEntries((await q(`select target_key || '/' || reference_population as k, readiness_state from public.product_prediction_readiness`)).map((x) => [x.k, x.readiness_state]))
  assert.equal(r[`REACH_MLB_WITHIN_7_SEASONS/${BENCH}`], 'SUPPORTED')
  assert.ok(Object.entries(r).filter(([k]) => k.endsWith(DODGERS)).every(([, v]) => v === 'NOT_SUPPORTED'))
  const cov = await q(`select period_start_year, expected_signings, tracked_signings from public.v_signing_data_coverage where coverage_type = 'TOP_PROSPECT_SAMPLE' order by 1`)
  assert.deepEqual(cov.map((x) => [x.period_start_year, x.expected_signings, x.tracked_signings]), [[2013, 30, 20], [2014, 30, 28], [2015, 30, 27], [2016, 30, 27], [2017, 30, 28], [2018, 30, 22]])
})

test('verifier: 258/258 at the 055 head with no new check; the 054a pins fail exactly on the five counts 055 moves', async () => {
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 258)
  const old = await checkInvariants(q, EXPECTATIONS_THROUGH_054A)
  assert.deepEqual(failedChecks(old).map((f) => f.name).sort(), ['league_benchmark_players', 'player_evaluations', 'players_total', 'scouting_legacy_ranks_backfilled', 'scouting_legacy_ranks_total'])
  const c = await clone(pre055Dump)
  try {
    const p = await checkInvariants(c.query, EXPECTATIONS_THROUGH_054A)
    assert.deepEqual(failedChecks(p).map((f) => f.name), [], 'the pre-055 state passes its own pins 258/258')
  } finally { await c.close() }
})

test('idempotent: a rerun adds nothing, runs no second refresh and changes no table', async () => {
  const b = await tableHashes()
  const gen = (await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g
  await chain.db.exec(sql055)
  assert.deepEqual(await tableHashes(), b)
  assert.equal((await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g, gen)
})

test('guarded: 055 refuses a database it was not written for, or one where a listed Dodgers signing changed', async () => {
  const a = await clone(pre055Dump)
  try {
    await a.db.exec(`update public.signings s set international_rank = 30 from public.players p where p.id = s.player_id and p.slug = 'jerming-rosario'`)
    await failsWith(a, sql055, /055: the listed Dodgers signing jerming-rosario is not one tracked Dodgers signing with this identity and its stored rank/)
  } finally { await a.close() }
  const b = await clone(pre055Dump)
  try {
    await b.db.exec(`update public.outcome_model_evaluations set training_fingerprint = '00000000000000000000000000000000'`)
    await failsWith(b, sql055, /055: the stored model evaluation is neither the 050 one nor the 055 one/)
  } finally { await b.close() }
  const c = await clone(pre055Dump)
  try {
    await c.db.exec(`update public.players set mlb_id = 677551 where slug = 'yeremy-rosario'`)
    await failsWith(c, sql055, /055: MLB id 677551 already belongs to another player/)
  } finally { await c.close() }
  const d = await clone(pre055Dump)
  try {
    const v = fs.readFileSync(path.join(root, 'database/sql/054_full_career_transaction_history.sql'), 'utf8')
    const s = v.indexOf('create or replace view public.v_dodgers_development_research_queue')
    await d.db.exec(v.slice(s, v.indexOf('\n-- ===========================================================================\n-- 6. POSTCONDITIONS', s)))
    await failsWith(d, sql055, /055: Migrations 054 and 054a have not been applied/)
  } finally { await d.close() }
})

test('rollback: removes exactly the 055 rows, restores the 050 evaluation, leaves the Dodgers untouched, refreshes once; 055 applies again', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(rollback055)
    const got = await tableHashes(c)
    const differs = Object.keys(preTables).filter((t) => preTables[t] !== got[t] && !t.startsWith('product_') && t !== 'sources')
    assert.deepEqual(differs, [], 'every research table equals its pre-055 content; the sources stay as provenance')
    const m = await measure(async (s) => (await c.db.query(s)).rows)
    assert.deepEqual({ ...m.counts, sources: null, snapshot_generation: null }, { ...pre.counts, sources: null, snapshot_generation: null })
    assert.deepEqual(m.support, pre.support)
    assert.ok(m.evaluation.every((e) => e.evaluation_current && e.training_fingerprint === evaluation050.fingerprint), 'the stored 050 evaluation is back, and current')
    assert.deepEqual(await dodgersRanks(c), preDodgersRanks)
    assert.deepEqual((await c.query(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)), [])
    assert.equal((await c.query(`select count(*)::int as n from pg_trigger t join pg_class r on r.oid = t.tgrelid where r.relname in ('player_evaluations', 'player_evaluation_rankings') and not t.tgisinternal and t.tgenabled <> 'O'`))[0].n, 0)
    assert.deepEqual(failedChecks(await checkInvariants(c.query, EXPECTATIONS_THROUGH_054A)).map((f) => f.name), [])
    await failsWith(c, rollback055, /rollback-055: Migration 055 is not applied/)
    await c.db.exec(sql055)
    const again = await measure(async (s) => (await c.db.query(s)).rows)
    const now = await measure(q)
    assert.deepEqual({ ...again.counts, snapshot_generation: null }, { ...now.counts, snapshot_generation: null })
    assert.deepEqual(again.support, now.support)
    assert.deepEqual(again.evaluation.map((e) => [e.model_key, e.training_fingerprint, e.evaluation_current]), now.evaluation.map((e) => [e.model_key, e.training_fingerprint, e.evaluation_current]))
    assert.deepEqual(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name), [])
  } finally { await c.close() }
})

test('rollback refuses when later research depends on a 055 benchmark player', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`insert into public.signings (player_id, organization_id, signing_year, pathway, bonus_publicly_reported, record_scope)
      select p.id, o.id, 2026, 'OTHER', false, 'TRACKED' from public.players p, public.organizations o where p.mlb_id = 677551 and o.abbreviation = 'NYY'`)
    await failsWith(c, rollback055, /rollback-055: later research depends on 1 of the 055 benchmark players/)
  } finally { await c.close() }
})

test('reproducible: the committed migration and rollback are byte-identical to the build output', () => {
  assert.equal(assemble(evaluation), sql055)
  assert.equal(assembleRollback(), rollback055)
})
