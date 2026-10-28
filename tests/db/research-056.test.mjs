// Migration 056: the international benchmark deepened with the mature 2019 class. The 055 database is built (001-055), 056 is applied for real,
// and the tests prove that a listed player becomes a benchmark signing only with a verified signing and identity, that the listed Dodgers
// signing (Luis Rodriguez, stored rank 4) is untouched, that nothing that existed before 056 moves (the 2013-2018 benchmark included), that the
// 2019 reach labels are mature and its 10-season labels censored, that benchmark support never reaches a Dodgers probability, that the stored
// evaluation is re-run and supports no model, and that 056 is idempotent, guarded, reproducible and reversible.
//   RANKING APPEARANCE != NEW SIGNING   SOURCE LIST MEMBERSHIP != VERIFIED SIGNING   BENCHMARK SUPPORT != DODGERS SUPPORT

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS, EXPECTATIONS_THROUGH_055 } from '../../scripts/db/lib/invariants.mjs'
import { measure } from '../../database/research/056/measure.mjs'
import { assemble, assembleRollback, research } from '../../database/research/056/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '056_international_benchmark_2019.sql'
const sql056 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback056 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-056.sql'), 'utf8')
const evaluation = JSON.parse(fs.readFileSync(path.join(root, 'database/research/056/evaluation.json'), 'utf8'))
const evaluation055 = JSON.parse(fs.readFileSync(path.join(root, 'database/research/055/evaluation.json'), 'utf8'))
const DODGERS = 'DODGERS_TRACKED_AND_OPENING_CLASS'
const BENCH = 'TOP_PROSPECT_SAMPLE'
const NEW_POPS = ['MLB-2019-PIPELINE-TOP30']

let chain
let pre056Dump
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
const dodgersRanks = (c = chain) => c.query(`select p.slug, s.international_rank::text as r, s.record_scope, md5(s::text) as h from public.signings s join public.players p on p.id = s.player_id
  join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS' order by 1, 4`)
const LUIS = 'luis-rodriguez-2019'

let preDodgersRanks, preTables
before(async () => {
  chain = await buildChainThrough('055_international_benchmark_2017_2018.sql')
  pre056Dump = await chain.db.dumpDataDir('none')
  pre = await measure(q)
  preDodgersRanks = await dodgersRanks()
  preTables = await tableHashes()
  await chain.db.exec(sql056)
}, { timeout: 900000 })

after(async () => { await chain?.close() })

test('056 follows 055 in the manifest (057 follows it) and is frozen at its released hash', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '055_international_benchmark_2017_2018.sql')
  assert.equal(manifest.canonical_sql[i + 1], '057_benchmark_bwar_evidence.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.equal(frozen[FILE], crypto.createHash('sha1').update(sql056.replace(/\r\n/g, '\n')).digest('hex'))
  assert.equal(frozen[FILE], 'e9a07cfe4338e098a60b22c0e6cee6b40b1cbcf6')
  assert.match(sql056, /^-- DISI v0\.41\n-- 056_international_benchmark_2019\.sql\n/)
  assert.match(rollback056, /^-- DISI rollback of Migration 056/)
})

test('baseline: the 056 research was written against exactly this pre-056 state', () => {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'database/research/056/baseline.json'), 'utf8'))
  assert.deepEqual(pre.counts, b.counts)
  assert.deepEqual(pre.support, b.support)
  assert.ok(pre.evaluation.every((e) => e.evaluation_current && e.training_fingerprint === evaluation055.fingerprint), 'the 055 evaluation is the stored, current one before 056')
  assert.deepEqual([pre.counts.benchmark_signings, pre.support.find((s) => s.target_key === 'REACH_MLB_WITHIN_7_SEASONS' && s.reference_population === BENCH).labelled_n], [152, 140])
})

test('data only: no table, view, function, grant, policy, trigger or definition changes', async () => {
  const c = await clone(pre056Dump)
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

test('membership: 26 benchmark signings; every one of the 30 listed members has one decision; the not-added are queued, never players', async () => {
  const m = await measure(q)
  assert.deepEqual([m.counts.players - pre.counts.players, m.counts.benchmark_signings - pre.counts.benchmark_signings, m.counts.player_evaluations - pre.counts.player_evaluations,
    m.counts.outcome_audits - pre.counts.outcome_audits, m.counts.outcomes - pre.counts.outcomes, m.counts.signing_populations - pre.counts.signing_populations,
    m.counts.census_coverage_rows - pre.counts.census_coverage_rows, m.counts.population_members - pre.counts.population_members], [26, 26, 26, 26, 4, 1, 1, 26])
  assert.equal(m.counts.benchmark_signings, 178)
  const [p] = await q(`select population_key, population_scope, expected_size, rate_analysis_suitable, stated_composition from public.signing_populations where population_key = $1`, [NEW_POPS[0]])
  assert.deepEqual([p.population_key, p.population_scope, p.expected_size, p.rate_analysis_suitable], [NEW_POPS[0], BENCH, 30, false])
  const sc = p.stated_composition
  assert.deepEqual([sc.benchmark_signings, sc.dodgers_signings_mapped.length, sc.identity_unresolved.length, sc.identity_conflicts.length, sc.route_not_established.length, sc.deceased_before_outcome_horizon.length], [26, 1, 3, 0, 0, 0])
  assert.equal(sc.benchmark_signings + sc.dodgers_signings_mapped.length + sc.identity_unresolved.length, sc.list_members, 'every listed player has exactly one decision')
  for (const id of [691188, 691268, 691181]) assert.equal((await one(`select count(*)::int as n from public.players where mlb_id = $1`, [id])).n, 0, `${id} is queued, not added`)
  const nt = await q(`select population_key, detail from public.v_international_benchmark_research_queue where issue = 'POPULATION_MEMBERS_NOT_TRACKED' and population_key = $1`, [NEW_POPS[0]])
  assert.equal(nt.length, 1)
  assert.match(nt[0].detail, /names 30 members; 26 are tracked/)
})

test('Dodgers protection: Luis Rodriguez keeps his one Dodgers signing byte for byte (stored rank 4); no Dodgers rank or row moves', async () => {
  const r = await one(`select count(*)::int as signings, count(*) filter (where s.record_scope = 'TRACKED_DODGERS')::int as dodgers,
      count(*) filter (where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')::int as benchmark, max(s.international_rank)::text as rank, max(p.mlb_id)::text as mlb
    from public.signings s join public.players p on p.id = s.player_id where p.slug = $1`, [LUIS])
  assert.deepEqual(r, { signings: 1, dodgers: 1, benchmark: 0, rank: '4.00', mlb: '691177' })
  assert.equal((await one(`select count(*)::int as n from public.players where mlb_id = 691177`)).n, 1, 'no second player with his MLB id')
  assert.equal((await one(`select count(*)::int as n from public.player_evaluations e join public.players p on p.id = e.player_id join public.player_evaluation_rankings r on r.evaluation_id = e.id
    where p.slug = $1 and r.scope_label = '2019 MLB Pipeline Top 30 international prospects'`, [LUIS])).n, 0, 'no 056 ranking for a Dodgers player')
  assert.deepEqual(await dodgersRanks(), preDodgersRanks, 'every Dodgers signing is byte-identical (rank included)')
  assert.equal((await one(`select count(*)::int as n from public.players p where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
    and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')`)).n, 0)
  const m = await measure(q)
  for (const k of ['dodgers_players', 'dodgers_signings', 'dodgers_audits', 'dodgers_verified_mlb', 'dodgers_verified_no_mlb', 'dodgers_not_audited', 'known_costs', 'known_spend_usd',
    'open_research_tasks', 'stints', 'milestones', 'transaction_events', 'transaction_assets', 'war_rows']) assert.equal(m.counts[k], pre.counts[k], `${k} does not move`)
  for (const k of ['dodgers_signings_hash', 'dodgers_audits_hash', 'war_hash', 'financial_reports_hash', 'transactions_hash', 'development_hash']) assert.equal(m.hashes[k], pre.hashes[k], `${k} is byte-identical`)
})

test('nothing that existed before moves: every table differs only by added rows (the 2013-2018 benchmark, sources, snapshots aside)', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => now[t] !== preTables[t]).sort()
  assert.deepEqual(changed.filter((t) => !t.startsWith('product_')), ['evidence', 'outcome_audits', 'outcome_evidence', 'outcome_model_evaluations', 'outcomes', 'player_aliases',
    'player_evaluation_rankings', 'player_evaluations', 'players', 'signing_census_coverage', 'signing_population_member_sources', 'signing_population_members', 'signing_populations',
    'signings', 'sources'])
  const c = await clone(pre056Dump)
  try {
    for (const t of ['evidence', 'outcome_audits', 'outcome_evidence', 'outcomes', 'player_aliases', 'player_evaluation_rankings', 'player_evaluations', 'players', 'signing_census_coverage',
      'signing_population_member_sources', 'signing_population_members', 'signing_populations', 'signings', 'sources']) {
      const rows = async (x) => new Set(R(await x.query(`select (to_jsonb(t) - 'updated_at')::text as r from public.${t} t`)).map((r) => r.r))
      const [a, b] = [await rows(c), await rows(chain)]
      assert.equal([...a].filter((r) => !b.has(r)).length, 0, `${t}: no existing row changed or disappeared`)
    }
    const old = async (x) => md5(await x.query(`select s.*, sp.population_key from public.signings s join public.signing_population_members m on m.signing_id = s.id
      join public.signing_populations sp on sp.id = m.population_id where sp.population_key like 'MLB-201_-PIPELINE-TOP30' and sp.population_key <> all($1) order by s.id`, [NEW_POPS]))
    assert.equal(await old(chain), await old(c), 'the 2013-2018 benchmark signings and memberships are byte-identical')
  } finally { await c.close() }
})

test('horizons and labels: the 041 rule decides every label; 2019 reach labels are mature (4 / 22), its 10-season labels censored', async () => {
  const by = Object.fromEntries((await measure(q)).benchmark_labels.filter((l) => l.population_key === NEW_POPS[0]).map((l) => [l.target_key, l]))
  assert.deepEqual([by.REACH_MLB_WITHIN_7_SEASONS.rows, by.REACH_MLB_WITHIN_7_SEASONS.positive, by.REACH_MLB_WITHIN_7_SEASONS.negative, by.REACH_MLB_WITHIN_7_SEASONS.censored,
    by.REACH_MLB_WITHIN_7_SEASONS.unaudited], [26, 4, 22, 0, 0])
  for (const t of ['POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS']) assert.deepEqual([by[t].positive, by[t].negative, by[t].censored], [0, 0, 26], `${t}: censored`)
  // the 041 horizon: a 2019 signing's 7-season horizon is 2026 = the last complete season, so it is exposed; its 10-season horizon is 2029
  for (const id of ['691176', '691182', '691251', '691185']) {
    const l = await label(slugOf(id), 'REACH_MLB_WITHIN_7_SEASONS')
    assert.deepEqual([l.signing_year, l.horizon_end_season, l.exposure_complete, l.label], [2019, 2026, true, true], `${id} reached within 7 seasons`)
  }
  const salasReach = await label(slugOf('691191'), 'REACH_MLB_WITHIN_7_SEASONS')
  assert.deepEqual([salasReach.label, salasReach.training_state], [false, 'BENCHMARK_SAMPLE_ONLY'])
  const tenYear = await label(slugOf('691176'), 'POSITIVE_BWAR_WITHIN_10_SEASONS')
  assert.deepEqual([tenYear.horizon_end_season, tenYear.exposure_complete, tenYear.label, tenYear.training_state], [2029, false, null, 'CENSORED'])
  const c = await clone(pre056Dump)
  try {
    const targets = async (x) => md5(await x.query(`select * from public.outcome_targets order by target_key`))
    assert.equal(await targets(c), await targets(chain))
    assert.doesNotMatch(sql056, /(insert into|update) public\.outcome_targets/)
  } finally { await c.close() }
  assert.equal((await one(`select count(*)::int as n from public.outcomes o join public.players p on p.id = o.player_id where p.slug = any($1::text[]) and o.career_war is not null`,
    [research.newPlayers.map((p) => p.slug)])).n, 0, 'MISSING BWAR != ZERO BWAR')
})

test('population separation: benchmark reach support deepens (166 / 34 / 132); Dodgers support does not move; no probability, expected value or recommendation', async () => {
  const sup = Object.fromEntries((await q(`select target_key || '/' || reference_population as k, labelled_n, positive_n, negative_n, support_state from public.v_outcome_target_support`)).map((r) => [r.k, r]))
  assert.deepEqual(sup[`REACH_MLB_WITHIN_7_SEASONS/${BENCH}`], { k: `REACH_MLB_WITHIN_7_SEASONS/${BENCH}`, labelled_n: 166, positive_n: 34, negative_n: 132, support_state: 'BASELINE_SUPPORTED' })
  for (const t of ['POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS']) {
    const before = pre.support.find((x) => x.target_key === t && x.reference_population === BENCH)
    assert.deepEqual([sup[`${t}/${BENCH}`].labelled_n, sup[`${t}/${BENCH}`].positive_n, sup[`${t}/${BENCH}`].support_state], [before.labelled_n, before.positive_n, 'BASELINE_NOT_SUPPORTED'])
  }
  for (const r of pre.support.filter((x) => x.reference_population === DODGERS)) {
    const now = sup[`${r.target_key}/${DODGERS}`]
    assert.deepEqual([now.labelled_n, now.positive_n, now.negative_n, now.support_state], [r.labelled_n, r.positive_n, r.negative_n, r.support_state], `${r.target_key}: Dodgers support is unchanged`)
  }
  assert.deepEqual(await one(`select count(probability)::int as nn, count(*) filter (where prediction_eligible)::int as eligible from public.v_player_outcome_probability`), { nn: 0, eligible: 0 })
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

test('evaluation: re-run on the 056 data (173 / 34 / 7 folds), current, a new fingerprint; no model supported; José Salas labelled but feature-incomplete', async () => {
  const ev = await q(`select model_key, evaluated_rows, positive_n, folds, decision, training_fingerprint, evaluation_current from public.v_outcome_model_evaluation order by model_key`)
  assert.ok(ev.every((e) => e.evaluation_current && e.training_fingerprint === evaluation.fingerprint && e.training_fingerprint !== evaluation055.fingerprint))
  assert.equal(evaluation.fingerprint, '86b58f473301e2425751d853abd88e94')
  assert.deepEqual(ev.map((e) => [e.model_key, e.evaluated_rows, e.positive_n, e.folds, e.decision]),
    [['BASE_RATE', 173, 34, 7, 'BASELINE_REFERENCE'], ['LOGISTIC_L2', 173, 34, 7, 'MODEL_NOT_SUPPORTED'], ['POPULATION_STRATIFIED_RATE', 173, 34, 7, 'MODEL_NOT_SUPPORTED']])
  assert.equal(evaluation.negatives, 139)
  const by = Object.fromEntries(evaluation.evaluations.map((e) => [e.model_key, e]))
  for (const e of evaluation055.evaluations) {
    assert.deepEqual([by[e.model_key].feature_list, by[e.model_key].training_populations, by[e.model_key].validation_method, by[e.model_key].target_key, by[e.model_key].model_version],
      [e.feature_list, e.training_populations, e.validation_method, e.target_key, e.model_version], 'the same models, features and validation as 041 / 050 / 055')
  }
  assert.ok(by.LOGISTIC_L2.brier_skill_vs_base_rate > 0)
  assert.match(by.LOGISTIC_L2.decision_reason, /^INSUFFICIENT_EVENTS: 34 positives for 6 feature\(s\); at least 60 are required/)
  assert.ok(by.POPULATION_STRATIFIED_RATE.brier_skill_vs_base_rate <= 0)
  assert.match(by.POPULATION_STRATIFIED_RATE.decision_reason, /^NO_SKILL_OVER_BASELINE/)
  // José Salas (born in the United States) is labelled for support but has no complete signing-time features, so he is not evaluated
  const salas = await one(`select p.label, x.model_features_complete from public.v_outcome_training_population p join public.v_outcome_feature_matrix x on x.signing_id = p.signing_id
    where p.player_slug = $1 and p.target_key = 'REACH_MLB_WITHIN_7_SEASONS'`, [slugOf('691191')])
  assert.deepEqual(salas, { label: false, model_features_complete: false })
  assert.equal((await one(`select count(*) filter (where model_support_state = 'MODEL_SUPPORTED')::int as n from public.v_player_outcome_probability`)).n, 0)
  assert.equal((await q(`select issue from public.v_outcome_probability_research_queue where issue = 'MODEL_EVALUATION_STALE'`)).length, 0)
})

test('product: one refresh, zero drift; readiness shows the benchmark row separately; the coverage ledger lists seven samples', async () => {
  const gens = await q(`select distinct generation_id::text as g from public.product_executive_snapshot union select distinct generation_id::text from public.product_prediction_readiness`)
  assert.equal(gens.length, 1)
  assert.equal(Number(gens[0].g), Number(pre.counts.snapshot_generation) + 1)
  assert.deepEqual(await q(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`), [])
  const r = Object.fromEntries((await q(`select target_key || '/' || reference_population as k, readiness_state from public.product_prediction_readiness`)).map((x) => [x.k, x.readiness_state]))
  assert.equal(r[`REACH_MLB_WITHIN_7_SEASONS/${BENCH}`], 'SUPPORTED')
  assert.ok(Object.entries(r).filter(([k]) => k.endsWith(DODGERS)).every(([, v]) => v === 'NOT_SUPPORTED'))
  const cov = await q(`select period_start_year, expected_signings, tracked_signings from public.v_signing_data_coverage where coverage_type = 'TOP_PROSPECT_SAMPLE' order by 1`)
  assert.deepEqual(cov.map((x) => [x.period_start_year, x.expected_signings, x.tracked_signings]), [[2013, 30, 20], [2014, 30, 28], [2015, 30, 27], [2016, 30, 27], [2017, 30, 28], [2018, 30, 22], [2019, 30, 26]])
})

test('verifier: 259/259 at the 056 head with no new check; the 055 pins fail exactly on the five counts 056 moves', async () => {
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 259)
  const old = await checkInvariants(q, EXPECTATIONS_THROUGH_055)
  assert.deepEqual(failedChecks(old).map((f) => f.name).sort(), ['league_benchmark_players', 'player_evaluations', 'players_total', 'scouting_legacy_ranks_backfilled', 'scouting_legacy_ranks_total'])
  const c = await clone(pre056Dump)
  try {
    const p = await checkInvariants(c.query, EXPECTATIONS_THROUGH_055)
    assert.deepEqual(failedChecks(p).map((f) => f.name), [], 'the pre-056 state passes its own pins 259/259')
  } finally { await c.close() }
})

test('idempotent: a rerun adds nothing, runs no second refresh and changes no table', async () => {
  const b = await tableHashes()
  const gen = (await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g
  await chain.db.exec(sql056)
  assert.deepEqual(await tableHashes(), b)
  assert.equal((await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g, gen)
})

test('guarded: 056 refuses a database it was not written for, or one where the listed Dodgers signing changed', async () => {
  const a = await clone(pre056Dump)
  try {
    await a.db.exec(`update public.signings s set international_rank = null from public.players p where p.id = s.player_id and p.slug = '${LUIS}'`)
    await failsWith(a, sql056, /056: the listed Dodgers signing luis-rodriguez-2019 is not one tracked Dodgers signing with this identity and its stored rank/)
  } finally { await a.close() }
  const b = await clone(pre056Dump)
  try {
    await b.db.exec(`update public.outcome_model_evaluations set training_fingerprint = '00000000000000000000000000000000'`)
    await failsWith(b, sql056, /056: the stored model evaluation is neither the 055 one nor the 056 one/)
  } finally { await b.close() }
  const c = await clone(pre056Dump)
  try {
    await c.db.exec(`update public.players set mlb_id = 691176 where slug = 'yeremy-rosario'`)
    await failsWith(c, sql056, /056: MLB id 691176 already belongs to another player/)
  } finally { await c.close() }
  const d = await clone(pre056Dump)
  try {
    await d.db.exec(`delete from public.signing_population_member_sources where member_id in (select m.id from public.signing_population_members m join public.signing_populations sp on sp.id = m.population_id where sp.population_key = 'MLB-2018-PIPELINE-TOP30');
      delete from public.signing_population_members where population_id in (select id from public.signing_populations where population_key = 'MLB-2018-PIPELINE-TOP30');
      delete from public.signing_populations where population_key = 'MLB-2018-PIPELINE-TOP30'`)
    await failsWith(d, sql056, /056: Migrations 054a and 055 have not been applied/)
  } finally { await d.close() }
})

test('rollback: removes exactly the 056 rows, restores the 055 evaluation, leaves the Dodgers untouched, refreshes once; 056 applies again', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(rollback056)
    const got = await tableHashes(c)
    const differs = Object.keys(preTables).filter((t) => preTables[t] !== got[t] && !t.startsWith('product_') && t !== 'sources')
    assert.deepEqual(differs, [], 'every research table equals its pre-056 content; the sources stay as provenance')
    const m = await measure(async (s) => (await c.db.query(s)).rows)
    assert.deepEqual({ ...m.counts, sources: null, snapshot_generation: null }, { ...pre.counts, sources: null, snapshot_generation: null })
    assert.deepEqual(m.support, pre.support)
    assert.ok(m.evaluation.every((e) => e.evaluation_current && e.training_fingerprint === evaluation055.fingerprint), 'the stored 055 evaluation is back, and current')
    assert.deepEqual(await dodgersRanks(c), preDodgersRanks)
    assert.deepEqual((await c.query(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)), [])
    assert.equal((await c.query(`select count(*)::int as n from pg_trigger t join pg_class r on r.oid = t.tgrelid where r.relname in ('player_evaluations', 'player_evaluation_rankings') and not t.tgisinternal and t.tgenabled <> 'O'`))[0].n, 0)
    assert.deepEqual(failedChecks(await checkInvariants(c.query, EXPECTATIONS_THROUGH_055)).map((f) => f.name), [])
    await failsWith(c, rollback056, /rollback-056: Migration 056 is not applied/)
    await c.db.exec(sql056)
    const again = await measure(async (s) => (await c.db.query(s)).rows)
    const now = await measure(q)
    assert.deepEqual({ ...again.counts, snapshot_generation: null }, { ...now.counts, snapshot_generation: null })
    assert.deepEqual(again.support, now.support)
    assert.deepEqual(again.evaluation.map((e) => [e.model_key, e.training_fingerprint, e.evaluation_current]), now.evaluation.map((e) => [e.model_key, e.training_fingerprint, e.evaluation_current]))
    assert.deepEqual(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name), [])
  } finally { await c.close() }
})

test('rollback refuses when later research depends on a 056 benchmark player', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`insert into public.signings (player_id, organization_id, signing_year, pathway, bonus_publicly_reported, record_scope)
      select p.id, o.id, 2026, 'OTHER', false, 'TRACKED' from public.players p, public.organizations o where p.mlb_id = 691176 and o.abbreviation = 'TB'`)
    await failsWith(c, rollback056, /rollback-056: later research depends on 1 of the 056 benchmark players/)
  } finally { await c.close() }
})

test('reproducible: the committed migration and rollback are byte-identical to the build output', () => {
  assert.equal(assemble(evaluation), sql056)
  assert.equal(assembleRollback(), rollback056)
})
