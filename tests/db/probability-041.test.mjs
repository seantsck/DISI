// Migration 041: outcome-probability infrastructure. The 040 database is replayed (001-040), 041 is applied for real, and the targets,
// labels and censoring, training eligibility, leakage safety, support thresholds, NULL probabilities, the recorded evaluation and the
// verifier are checked.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { probabilityQueries, PROBABILITY_CHECK_NAMES } from '../../scripts/db/lib/probability-invariants.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '041_outcome_probability_infrastructure.sql'
const sql041 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const evaluation = JSON.parse(fs.readFileSync(path.join(root, 'database/research/041/evaluation.json'), 'utf8'))
const targets = JSON.parse(fs.readFileSync(path.join(root, 'database/research/041/targets.json'), 'utf8')).targets
const VIEWS = ['v_outcome_training_population', 'v_outcome_feature_matrix', 'v_outcome_target_support', 'v_outcome_model_evaluation', 'v_player_outcome_probability', 'v_outcome_probability_research_queue']
const TABLES = ['outcome_model_evaluations', 'outcome_targets']

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const tableHashes = async () => {
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5((await q(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const viewDefs = async () => Object.fromEntries((await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'`)).map((r) => [r.relname, r.d]))
let before041
before(async () => {
  chain = await buildChainThrough('040_historical_archetypes_comparables.sql')
  before041 = { hashes: await tableHashes(), defs: await viewDefs() }
  await chain.db.exec(sql041)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(probabilityQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
  return out.sort()
}
async function scratch(fn) {
  await chain.db.exec('begin;')
  try { return await fn() } finally { await chain.db.exec('rollback;') }
}
async function drift(view, overrides) {
  return scratch(async () => {
    const cols = (await q(`select attname from pg_attribute where attrelid = 'public.${view}'::regclass and attnum > 0 and not attisdropped order by attnum`)).map((r) => r.attname)
    await chain.db.exec(`alter view public.${view} rename to ${view}_real`)
    await chain.db.exec(`create view public.${view} as select ${cols.map((c) => (c in overrides ? `${overrides[c]} as ${c}` : `r.${c}`)).join(', ')} from public.${view}_real r`)
    return failing()
  })
}

test('041 shape: two RLS tables, six security-invoker views, SELECT-only grants, one transaction; nothing earlier changes', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 64, views: 140 })
  const v = await q(`select relname, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) and relkind = 'v' order by 1`, [VIEWS])
  assert.deepEqual(v.map((r) => r.relname), [...VIEWS].sort())
  for (const r of v) assert.match(r.opts, /security_invoker=true/)
  assert.deepEqual(await q(`select relname, relrowsecurity as rls from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`, [TABLES]),
    TABLES.map((n) => ({ relname: n, rls: true })))
  const acl = await q(`select c.relname, a.privilege_type as p from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)`, [[...VIEWS, ...TABLES]])
  assert.deepEqual([...new Set(acl.map((a) => a.p))], ['SELECT'])
  assert.equal(acl.length, (VIEWS.length + TABLES.length) * 2)
  const after = await tableHashes()
  assert.deepEqual(Object.keys(after).filter((t) => after[t] !== before041.hashes[t]).sort(), TABLES)
  const defs = await viewDefs()
  assert.deepEqual(Object.keys(before041.defs).filter((x) => defs[x] !== before041.defs[x]), [])
})

test('targets: exactly the reviewed four, each with a fixed horizon and the 50 / 10 / 10 support minimums', async () => {
  const t = await q(`select target_key, horizon_seasons, applies_to, min_reference_n, min_positives, min_negatives, events_per_feature from outcome_targets order by 1`)
  assert.deepEqual(t, targets.map((x) => ({ target_key: x.target_key, horizon_seasons: x.horizon_seasons, applies_to: x.applies_to, min_reference_n: x.min_reference_n,
    min_positives: x.min_positives, min_negatives: x.min_negatives, events_per_feature: x.events_per_feature })).sort((a, b) => (a.target_key < b.target_key ? -1 : 1)))
})

test('labels and censoring: nothing is negative because it is unaudited, young, active or inside its horizon', async () => {
  const s = Object.fromEntries((await q(`select training_state, count(*)::int as n, count(*) filter (where label)::int as pos from v_outcome_training_population
    where target_key = 'REACH_MLB_WITHIN_7_SEASONS' group by 1`)).map((r) => [r.training_state, [r.n, r.pos]]))
  assert.deepEqual(s, { BENCHMARK_SAMPLE_ONLY: [43, 6], CENSORED: [143, 0], OUTCOME_UNAUDITED: [5, 0], OUT_OF_SCOPE: [52, 39], TRAINING_ELIGIBLE: [25, 2] })
  assert.equal((await one(`select count(*)::int as n from v_outcome_training_population where training_state = 'CENSORED' and label is not null`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from v_outcome_training_population where reached_mlb_verified is null and label is not null`)).n, 0)
  // a 2022 signing that already debuted (De Paula) is still censored for the 7-season target: an early positive is never used
  const dp = await one(`select training_state, label from v_outcome_training_population where player_slug = 'josue-de-paula' and target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
  assert.deepEqual(dp, { training_state: 'CENSORED', label: null })
})

test('leakage: the feature matrix is the signing-time record; flipping outcomes and adding later facts changes labels but never a feature', async () => {
  const features = md5(await q(`select * from v_outcome_feature_matrix order by signing_id`))
  const labels = md5(await q(`select signing_id, target_key, label from v_outcome_training_population order by 1, 2`))
  await scratch(async () => {
    await chain.db.exec(`update outcome_audits set reached_mlb_verified = not reached_mlb_verified,
      outcome_state = case when reached_mlb_verified then 'NO_MLB_STATUS_UNKNOWN' else 'REACHED_MLB' end`)
    await chain.db.exec(`update players set primary_position = 'C'`)
    await chain.db.exec(`delete from player_season_stints`)
    assert.equal(md5(await q(`select * from v_outcome_feature_matrix order by signing_id`)), features)
    assert.notEqual(md5(await q(`select signing_id, target_key, label from v_outcome_training_population order by 1, 2`)), labels)
  })
})

test('support and probabilities: no target is supported today, so every probability is NULL with a reason - never zero', async () => {
  const sup = await q(`select target_key, reference_population, labelled_n, positive_n, support_state from v_outcome_target_support order by 1, 2`)
  for (const r of sup) assert.notEqual(r.support_state, 'BASELINE_SUPPORTED', `${r.target_key} ${r.reference_population}`)
  assert.deepEqual(sup.filter((r) => r.target_key === 'REACH_MLB_WITHIN_7_SEASONS').map((r) => [r.reference_population, r.labelled_n, r.positive_n]),
    [['DODGERS_TRACKED_AND_OPENING_CLASS', 25, 2], ['TOP_PROSPECT_SAMPLE', 43, 6]])
  const p = await one(`select count(*)::int as n, count(probability)::int as nonnull, count(*) filter (where prediction_exclusion_reason is null)::int as unexplained from v_player_outcome_probability`)
  assert.deepEqual(p, { n: 268 * 4, nonnull: 0, unexplained: 0 })
})

test('the support rule is the only switch: with lowered thresholds, probabilities appear only for open-outcome Dodgers amateur rows and equal the baseline', async () => {
  await scratch(async () => {
    // the table refuses thresholds below 30 / 10 / 10; lift the guard inside this rolled-back transaction only
    await chain.db.exec(`alter table outcome_targets drop constraint outcome_targets_min_reference_n_check, drop constraint outcome_targets_min_positives_check,
      drop constraint outcome_targets_min_negatives_check`)
    await chain.db.exec(`update outcome_targets set min_reference_n = 20, min_positives = 2, min_negatives = 2 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
    const rows = await q(`select o.player_slug, o.probability::float as p, o.probability_low_90::float as lo, o.probability_high_90::float as hi, f.population_class, f.signing_route, t.exposure_complete
      from v_player_outcome_probability o join v_signing_time_features f on f.signing_id = o.signing_id
      join v_outcome_training_population t on t.signing_id = o.signing_id and t.target_key = o.target_key
      where o.target_key = 'REACH_MLB_WITHIN_7_SEASONS' and o.probability is not null`)
    assert.ok(rows.length > 0)
    for (const r of rows) {
      assert.ok(['TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS'].includes(r.population_class))
      assert.equal(r.signing_route, 'AMATEUR_OR_UNCLASSIFIED_SIGNING')
      assert.equal(r.exposure_complete, false)
      assert.ok(Math.abs(r.p - 2 / 25) < 1e-4)
      assert.ok(r.lo <= r.p && r.p <= r.hi)
    }
    assert.deepEqual(await failing(), [])
  })
})

test('recorded evaluation: out-of-time, no model beats the base rate, decisions follow the events-per-feature rule, the fingerprint is current', async () => {
  const e = await q(`select model_key, evaluated_rows, positive_n, folds, brier_score::float as brier, brier_skill_vs_base_rate::float as skill, decision, evaluation_current
    from v_outcome_model_evaluation order by model_key`)
  assert.deepEqual(e.map((r) => r.model_key), ['BASE_RATE', 'LOGISTIC_L2', 'POPULATION_STRATIFIED_RATE'])
  for (const r of e) {
    assert.deepEqual([r.evaluated_rows, r.positive_n, r.folds, r.evaluation_current], [59, 8, 5, true])
    if (r.model_key !== 'BASE_RATE') {
      assert.equal(r.decision, 'MODEL_NOT_SUPPORTED')
      assert.ok(r.skill < 0, `${r.model_key} skill ${r.skill}`)
    }
  }
  // the stored rows are exactly the committed evaluation.json
  for (const r of e) assert.equal(r.brier, evaluation.evaluations.find((x) => x.model_key === r.model_key).brier_score, r.model_key)
  assert.equal(new Set(e.map((r) => r.evaluated_rows)).size, 1, 'every model is evaluated on the same rows')
  // a change to the training data makes the evaluation stale, which is queued (never silently cited)
  await scratch(async () => {
    await chain.db.exec(`update outcome_audits set reached_mlb_verified = false, outcome_state = 'NO_MLB_STATUS_UNKNOWN' where player_id = (select id from players where slug = 'gleyber-torres')`)
    assert.equal((await one(`select count(*) filter (where not evaluation_current)::int as n from v_outcome_model_evaluation`)).n, 3)
    assert.equal((await one(`select count(*)::int as n from v_outcome_probability_research_queue where issue = 'MODEL_EVALUATION_STALE'`)).n, 3)
  })
})

test('no accuracy, score or leaderboard column; probabilities are labelled with their population and support', async () => {
  const cols = (await q(`select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0`, [VIEWS])).map((r) => r.attname)
  const metrics = new Set(['brier_score'])
  for (const x of cols.filter((c) => !metrics.has(c))) assert.doesNotMatch(x, /accura|score$|rank|leader|best|causal/i, x)
  for (const need of ['prediction_as_of_date', 'probability', 'model_version', 'training_population', 'training_n', 'positive_n', 'feature_completeness', 'sample_state',
    'model_support_state', 'calibration_evidence', 'prediction_eligible', 'prediction_exclusion_reason']) {
    assert.ok(cols.includes(need), need)
  }
})

test('verifier: the six probability checks pass, each catches its own drift, and the full verifier passes on the 041 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(PROBABILITY_CHECK_NAMES.length, 6)
  const full = await checkInvariants(q, { ...CANONICAL_EXPECTATIONS, public_views_total: 140, public_tables_total: 64 })
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 233)
  const tp = 'v_outcome_training_population'
  assert.ok((await drift(tp, { label: `case when r.training_state = 'CENSORED' then false else r.label end` })).includes('outcome_label_state_violations'))
  assert.ok((await drift(tp, { label: `case when r.reached_mlb_verified is null then false else r.label end` })).includes('outcome_no_negative_coercion_violations'))
  assert.ok((await drift('v_outcome_feature_matrix', { position_family: `'PITCHER'` })).includes('outcome_feature_leakage_violations'))
  assert.ok((await drift('v_outcome_target_support', { baseline_probability: '0.1' })).includes('outcome_support_violations'))
  assert.ok((await drift('v_player_outcome_probability', { probability: '0' })).includes('outcome_probability_eligibility_violations'))
  await scratch(async () => {
    await chain.db.exec(`update outcome_model_evaluations set decision = 'MODEL_SUPPORTED' where model_key = 'LOGISTIC_L2'`)
    assert.ok((await failing()).includes('outcome_model_registry_violations'))
  })
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = await viewDefs()
  const out = md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3`))))
  await chain.db.exec(sql041)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await viewDefs(), defs)
  assert.equal(md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3`)))), out)
})

test('reproducible: re-running the evaluation and the build produces the committed evaluation and SQL bytes', () => {
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, f))).digest('hex')
  const before = [sha('database/research/041/evaluation.json'), sha(`database/sql/${FILE}`)]
  execFileSync(process.execPath, [path.join(root, 'database/research/041/evaluate.mjs')], { cwd: root, stdio: 'pipe' })
  execFileSync(process.execPath, [path.join(root, 'database/research/041/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.deepEqual([sha('database/research/041/evaluation.json'), sha(`database/sql/${FILE}`)], before)
})

test('frozen history: 041 adds only; it never alters, drops, deletes or updates an earlier object', () => {
  const code = sql041.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\bdrop (table|view|column)\b/i)
  assert.doesNotMatch(code, /\balter (view|column)\b/i)
  assert.doesNotMatch(code, /^\s*(delete from|truncate|update )/im)
  assert.doesNotMatch(code, /\balter table public\.(?!%I)/i)
})
