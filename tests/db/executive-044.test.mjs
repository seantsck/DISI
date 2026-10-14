// Migration 044: the executive product contract. The 043a database is replayed (001-043a), 044 is applied for real, and the one-row
// executive overview (a staged function behind its view), prediction readiness, the full support-propagation chain (041 -> 042 -> 043
// -> 044), the switch, plan-boundedness and gating, the verifier, idempotency and the deterministic build are checked.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { executiveQueries, EXECUTIVE_CHECK_NAMES } from '../../scripts/db/lib/executive-invariants.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { NO_PROBABILITY_STATEMENT, predictionReadiness } from '../../lib/decision-display.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '044_executive_product.sql'
const sql044 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const VIEWS = ['v_executive_overview', 'v_prediction_readiness']
const EXPECT044 = { ...CANONICAL_EXPECTATIONS, public_views_total: 152, public_tables_total: 66 }

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
let before044
before(async () => {
  chain = await buildChainThrough('043a_decision_engine_performance.sql')
  before044 = { hashes: await tableHashes(), defs: await viewDefs() }
  await chain.db.exec(sql044)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(executiveQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
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

test('044 shape: two security-invoker views and the overview function, SELECT-only grants, no table, nothing earlier changes', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 66, views: 152 })
  const v = await q(`select relname, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) and relkind = 'v' order by 1`, [VIEWS])
  assert.deepEqual(v.map((r) => r.relname), [...VIEWS].sort())
  for (const r of v) assert.match(r.opts, /security_invoker=true/)
  const acl = await q(`select c.relname, a.privilege_type as p from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)`, [VIEWS])
  assert.deepEqual([...new Set(acl.map((a) => a.p))], ['SELECT'])
  assert.equal(acl.length, VIEWS.length * 2)
  assert.deepEqual(await tableHashes(), before044.hashes)
  const defs = await viewDefs()
  assert.deepEqual(Object.keys(before044.defs).filter((x) => defs[x] !== before044.defs[x]), [])
  const f = await one(`select l.lanname, p.provolatile as vol, p.prosecdef as secdef, array_to_string(p.proconfig, ',') as cfg,
      has_function_privilege('public', p.oid, 'EXECUTE') as public_x, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x
    from pg_proc p join pg_language l on l.oid = p.prolang where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_executive_overview'`)
  assert.deepEqual(f, { lanname: 'plpgsql', vol: 's', secdef: false, cfg: 'search_path=""', public_x: false, anon_x: true, auth_x: true })
  assert.match(defs.v_executive_overview, /disi_executive_overview\(\)/)
})

test('plan-bounded and gated: the overview plans in under 2 MB and, while nothing is supported, never plans or runs a per-player predictive layer', async () => {
  const lines = (await q(`explain (memory, summary, costs off) select * from v_executive_overview`)).map((r) => Object.values(r)[0])
  assert.ok(Number(lines.find((l) => /Memory: used=/.test(l)).match(/used=(\d+)kB/)[1]) < 2048)
  await scratch(async () => {
    // booby-trapped stand-ins fail as soon as they are planned (the planner folds 1 / 0)
    for (const v of ['v_player_outcome_probability', 'v_player_expected_organizational_value', 'v_portfolio_candidate_readiness']) {
      await chain.db.exec(`alter view public.${v} rename to zz_${v}`)
      await chain.db.exec(`create view public.${v} as select (1 / 0)::int as probability, 0 as expected_org_value_bwar, true as optimization_eligible`)
    }
    const o = await one(`select * from v_executive_overview`)
    assert.deepEqual([o.non_null_probabilities, o.supported_expected_values, o.predictive_portfolio_recommendations], [0, 0, 0])
    assert.equal(o.dodgers_signings, 220)
  })
})

test('executive overview: one row whose figures carry their denominators and equal the per-signing layer', async () => {
  const o = await one(`select * from v_executive_overview`)
  assert.equal((await one(`select count(*)::int as n from v_executive_overview`)).n, 1)
  assert.equal(o.dodgers_signings, 220)
  assert.equal(o.dodgers_outcome_selected_signings, 49)
  assert.equal(o.spend_state, 'KNOWN_SPEND_IS_A_LOWER_BOUND')
  assert.ok(o.signings_with_known_cost < o.dodgers_signings)
  // value produced for other clubs is reported, separately, and never folded into Dodgers value
  const sums = await one(`select round(sum(realized_org_value_bwar), 2)::text as org, round(sum(value_left_organization_bwar), 2)::text as left_org
    from v_player_realized_organizational_value`)
  assert.equal(String(o.realized_org_value_bwar), sums.org)
  assert.equal(String(o.value_left_organization_bwar), sums.left_org)
  assert.equal(String(o.analysis_as_of_date instanceof Date ? o.analysis_as_of_date.toISOString().slice(0, 10) : o.analysis_as_of_date), '2026-10-05')
})

test('CRITICAL SUPPORT PROPAGATION: 041 supports 0 targets -> 042 supports 0 expected values -> 043 makes 0 recommendations -> 044 reports exactly that', async () => {
  // 041
  assert.equal((await one(`select count(distinct target_key)::int as n from v_outcome_target_support where baseline_supported`)).n, 0)
  assert.equal((await one(`select count(probability)::int as n from v_player_outcome_probability`)).n, 0)
  // 042
  assert.equal((await one(`select count(*)::int as n from v_expected_value_support where expected_value_supported`)).n, 0)
  assert.equal((await one(`select count(expected_org_value_bwar)::int as n from v_player_expected_organizational_value`)).n, 0)
  // 043
  assert.equal((await one(`select count(*)::int as n from v_portfolio_candidate_readiness where optimization_eligible`)).n, 0)
  assert.equal((await one(`select count(optimized_selection)::int as n from v_portfolio_scenario_evaluation`)).n, 0)
  // 044
  const o = await one(`select * from v_executive_overview`)
  assert.deepEqual([o.supported_probability_targets, o.non_null_probabilities, o.supported_expected_value_models, o.supported_expected_values,
    o.predictive_portfolio_recommendations, o.supported_fitted_models], [0, 0, 0, 0, 0, 0])
  assert.equal(o.prediction_readiness_state, 'NO_SUPPORTED_PROBABILITY_TARGET')
  assert.equal(o.prediction_readiness_statement, NO_PROBABILITY_STATEMENT)
  // and the interface layer turns that row into no published number
  const ui = predictionReadiness(o)
  assert.deepEqual([ui.published, ui.supportedExpectedValues, ui.recommendations, ui.statement], [false, 0, 0, NO_PROBABILITY_STATEMENT])
})

test('prediction readiness: one row per target and reference population, mirroring 041 support, with what is still needed', async () => {
  const r = await q(`select * from v_prediction_readiness order by target_key, reference_population`)
  assert.equal(r.length, 7)
  for (const x of r) {
    assert.equal(x.readiness_state, 'NOT_SUPPORTED')
    assert.match(x.readiness_statement, /^Not supported: \d+ labelled outcomes/)
  }
  const reach = r.find((x) => x.target_key === 'REACH_MLB_WITHIN_7_SEASONS' && x.reference_population === 'DODGERS_TRACKED_AND_OPENING_CLASS')
  assert.deepEqual([reach.labelled_n, reach.positive_n, reach.negative_n, reach.additional_positives_needed, reach.additional_labels_needed], [25, 2, 23, 8, 25])
  assert.equal(Number(reach.base_rate_brier), 0.124032)
  assert.equal(Number(reach.best_fitted_model_brier), 0.13927)
  assert.equal(reach.fitted_model_supported, false)
})

test('the switch: when a target becomes supported, the overview reports it - and only what the lower layers support', async () => {
  await scratch(async () => {
    await chain.db.exec(`alter table outcome_targets drop constraint outcome_targets_min_reference_n_check, drop constraint outcome_targets_min_positives_check,
      drop constraint outcome_targets_min_negatives_check`)
    await chain.db.exec(`update outcome_targets set min_reference_n = 20, min_positives = 2, min_negatives = 2 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
    const o = await one(`select * from v_executive_overview`)
    assert.equal(o.supported_probability_targets, 1)
    assert.ok(o.non_null_probabilities > 0)
    assert.equal(o.prediction_readiness_state, 'PROBABILITIES_PUBLISHED_FOR_SUPPORTED_TARGETS')
    // the value model still depends on the unsupported Dodgers-value target: no expected value, no recommendation
    assert.deepEqual([o.supported_expected_value_models, o.supported_expected_values, o.predictive_portfolio_recommendations], [0, 0, 0])
    assert.deepEqual(await failing(), [])
  })
})

test('verifier: the three 044 checks pass, each catches its own drift, and the full verifier passes on the 044 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(EXECUTIVE_CHECK_NAMES.length, 3)
  const full = await checkInvariants(q, EXPECT044)
  assert.deepEqual(failedChecks(full), [])
  assert.ok((await drift('v_executive_overview', { realized_org_value_bwar: 'r.realized_org_value_bwar + r.value_left_organization_bwar' })).includes('executive_overview_violations'))
  assert.ok((await drift('v_executive_overview', { predictive_portfolio_recommendations: '5' })).includes('executive_support_propagation_violations'))
  assert.ok((await drift('v_prediction_readiness', { readiness_state: `'SUPPORTED'` })).includes('prediction_readiness_violations'))
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = await viewDefs()
  const out = md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2`))))
  await chain.db.exec(sql044)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await viewDefs(), defs)
  assert.equal(md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2`)))), out)
})

test('reproducible: re-running the build produces the committed SQL bytes', () => {
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, f))).digest('hex')
  const before = sha(`database/sql/${FILE}`)
  execFileSync(process.execPath, [path.join(root, 'database/research/044/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(sha(`database/sql/${FILE}`), before)
})

test('frozen history: 044 adds two views and one function; it never alters, drops, deletes or updates anything, nor evaluates the overview', () => {
  const code = sql044.replace(/--.*$/gm, '')
  // the postconditions are structural: the migration never reads the analytical stack it defines
  assert.doesNotMatch(code, /from public\.v_executive_overview/i)
  assert.equal((code.match(/create or replace function public\.disi_\w+\(\)/g) || []).length, 1)
  assert.doesNotMatch(code, /\bdrop (table|view|column)\b/i)
  assert.doesNotMatch(code, /\balter (view|column|table)\b/i)
  assert.doesNotMatch(code, /^\s*(delete from|truncate|update |insert into)/im)
  assert.doesNotMatch(code, /\bcreate table\b/i)
})
