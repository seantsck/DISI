// Migration 043a: post-043 query-shape correction. The 043 database is replayed (001-043); the ten 042 / 043 views are read in three
// support states (unsupported, probability-only, expected value supported) and their top-level planner memory recorded; 043a is applied
// for real and the same reads must give the same rows, while each wrapper plans in a fraction of the memory and a gated per-player
// layer is provably neither planned nor executed while its upstream support is absent.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_046 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { stagedFunctionQueries, STAGED_FUNCTION_CHECK_NAMES } from '../../scripts/db/lib/staged-function-invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '043a_decision_engine_performance.sql'
const sql043a = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const VIEWS = ['v_player_realized_organizational_value', 'v_historical_org_value_distribution', 'v_expected_value_support',
  'v_player_expected_organizational_value', 'v_expected_value_research_queue', 'v_portfolio_candidate_readiness', 'v_historical_portfolio_summary',
  'v_portfolio_scenario_evaluation', 'v_portfolio_decision_support', 'v_portfolio_research_queue']
const STAGED = {
  v_player_realized_organizational_value: 'disi_player_realized_organizational_value',
  v_player_expected_organizational_value: 'disi_player_expected_organizational_value',
  v_expected_value_research_queue: 'disi_expected_value_research_queue',
  v_portfolio_candidate_readiness: 'disi_portfolio_candidate_readiness',
}
const EXPECT043A = { ...CANONICAL_EXPECTATIONS, public_views_total: 150, public_tables_total: 66 }

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
async function scratch(fn) {
  await chain.db.exec('begin;')
  try { return await fn() } finally { await chain.db.exec('rollback;') }
}

// the three support states, each applied inside a rolled-back transaction
const probabilityOnly = async () => {
  await chain.db.exec(`alter table outcome_targets drop constraint outcome_targets_min_reference_n_check, drop constraint outcome_targets_min_positives_check,
    drop constraint outcome_targets_min_negatives_check`)
  await chain.db.exec(`update outcome_targets set min_reference_n = 20, min_positives = 2, min_negatives = 2 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
}
// a stand-in supported conditional value (2.0 bWAR). CREATE OR REPLACE keeps the view's oid, so every dependent - SQL view or staged
// function - reads the stand-in, before and after 043a alike
const expectedValueSupported = async () => {
  await probabilityOnly()
  await chain.db.exec(`update expected_value_models set probability_target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
  const def = (await one(`select pg_get_viewdef('public.v_expected_value_support'::regclass) as d`)).d
  await chain.db.exec(`create view public.zz_evs_real as ${def}`)
  await chain.db.exec(`create or replace view public.v_expected_value_support as select r.value_model_key, r.value_model_version, r.probability_target_key,
    r.value_component, r.reference_population, r.probability_supported, r.labelled_n, r.positive_n, r.additional_positives_needed, r.additional_labels_needed,
    10 as conditional_value_n, r.min_conditional_n, 0 as additional_conditional_observations_needed, true as conditional_value_supported,
    case when r.probability_supported then 2.0 end as conditional_mean_value_bwar, r.probability_supported as expected_value_supported,
    case when r.probability_supported then 'EXPECTED_VALUE_SUPPORTED' else 'PROBABILITY_NOT_SUPPORTED' end as support_state, r.blocking_reasons, r.evidence_as_of_date
    from public.zz_evs_real r`)
}
const STATES = { unsupported: async () => {}, probability_only: probabilityOnly, expected_value_supported: expectedValueSupported }

const outputs = async () => {
  const out = {}
  for (const v of VIEWS) out[v] = md5((await q(`select t::text as r from public.${v} t`)).map((r) => r.r).sort())
  return out
}
const allStates = async () => {
  const out = {}
  for (const [name, setUp] of Object.entries(STATES)) out[name] = await scratch(async () => { await setUp(); return outputs() })
  return out
}
const planMemoryKb = async (v) => {
  const lines = (await q(`explain (memory, summary, costs off) select * from public.${v}`)).map((r) => Object.values(r)[0])
  return Number(lines.find((l) => /Memory: used=/.test(l)).match(/used=(\d+)kB/)[1])
}
const tableHashes = async () => {
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5((await q(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
// every public view's columns and types (with typmods), comment, options and ACL; policies; functions other than the staged ones
const catalog = async () => ({
  meta: await q(`select c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) as t, obj_description(c.oid, 'pg_class') as cmt,
      coalesce(array_to_string(c.reloptions, ','), '') as o, coalesce(c.relacl::text, '') as acl
    from pg_class c join pg_attribute a on a.attrelid = c.oid
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'r') and a.attnum > 0 and not a.attisdropped order by 1, 2`),
  policies: await q(`select tablename, policyname, cmd, roles::text as roles, qual from pg_policies where schemaname = 'public' order by 1, 2`),
  functions: await q(`select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname <> all($1) order by 1`, [Object.values(STAGED)]),
})

let before043a
before(async () => {
  chain = await buildChainThrough('043_portfolio_decision_engine.sql')
  const plan = {}
  for (const v of Object.keys(STAGED)) plan[v] = await planMemoryKb(v)
  before043a = { outputs: await allStates(), plan, hashes: await tableHashes(), catalog: await catalog() }
  await chain.db.exec(sql043a)
}, { timeout: 600000 })
after(async () => { await chain?.close() })

test('043a shape: four staged functions, the four views redefined in place; every column, type, comment, option, ACL, policy and row unchanged', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 66, views: 150 })
  assert.deepEqual(await catalog(), before043a.catalog)
  assert.deepEqual(await tableHashes(), before043a.hashes)
  const fns = await q(`select p.proname, l.lanname, p.provolatile as vol, p.prosecdef as secdef, array_to_string(p.proconfig, ',') as cfg,
      has_function_privilege('public', p.oid, 'EXECUTE') as public_x, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x, p.pronargs as nargs
    from pg_proc p join pg_language l on l.oid = p.prolang where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by 1`, [Object.values(STAGED)])
  assert.equal(fns.length, 4)
  for (const f of fns) {
    assert.deepEqual({ ...f, proname: undefined }, { proname: undefined, lanname: 'plpgsql', vol: 's', secdef: false, cfg: 'search_path=""',
      public_x: false, anon_x: true, auth_x: true, nargs: 0 }, f.proname)
  }
  for (const [v, fn] of Object.entries(STAGED)) assert.match((await one(`select pg_get_viewdef($1::regclass) as d`, [`public.${v}`])).d, new RegExp(`\\b${fn}\\(\\)`))
})

test('semantic equivalence: all ten 042 / 043 views give identical rows when unsupported, probability-only and expected-value supported', async () => {
  const now = await allStates()
  for (const state of Object.keys(STATES)) assert.deepEqual(now[state], before043a.outputs[state], state)
  // the three states are genuinely different, so the comparison exercises every gated stage
  assert.notEqual(now.unsupported.v_expected_value_support, now.expected_value_supported.v_expected_value_support)
  assert.notEqual(now.unsupported.v_portfolio_scenario_evaluation, now.expected_value_supported.v_portfolio_scenario_evaluation)
  await scratch(async () => {
    await expectedValueSupported()
    assert.ok((await one(`select count(expected_org_value_bwar)::int as n from v_player_expected_organizational_value`)).n > 0)
    assert.ok((await one(`select count(*)::int as n from v_portfolio_candidate_readiness where optimization_eligible`)).n > 0)
  })
})

test('plan-bounded: each staged view plans in a small fraction of the memory the stacked 043 definition needed', async () => {
  for (const v of Object.keys(STAGED)) {
    const now = await planMemoryKb(v)
    assert.ok(now < 2048 && now * 20 < before043a.plan[v], `${v}: ${now} kB now, ${before043a.plan[v]} kB before`)
  }
})

test('gating: while expected value is unsupported the per-player expected-value layer is neither planned nor executed; once supported it is', async () => {
  // a booby-trapped stand-in fails as soon as it is planned (the planner folds 1 / 0); CREATE OR REPLACE is impossible across shapes, so swap names
  const trap = async () => {
    await chain.db.exec(`alter view public.v_player_expected_organizational_value rename to zz_ev_real`)
    await chain.db.exec(`create view public.v_player_expected_organizational_value as select null::uuid as signing_id, (1 / 0)::numeric as expected_org_value_bwar,
      null::text as expected_value_state`)
  }
  await scratch(async () => {
    await trap()
    assert.equal((await one(`select count(*)::int as n from v_portfolio_candidate_readiness`)).n, 220)
    assert.equal((await one(`select count(*)::int as n from v_portfolio_candidate_readiness where optimization_eligible`)).n, 0)
  })
  await scratch(async () => {
    await expectedValueSupported()
    await trap()
    await assert.rejects(q(`select count(*) from v_portfolio_candidate_readiness`), /division by zero/)
  })
})

test('verifier: the staged checks pass, each catches its own drift, and the full verifier passes on the 043a database', async () => {
  const failing = async () => {
    const out = []
    for (const [name, sql] of Object.entries(stagedFunctionQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
    return out.sort()
  }
  assert.deepEqual(await failing(), [])
  assert.equal(STAGED_FUNCTION_CHECK_NAMES.length, 2)
  const full = await checkInvariants(q, EXPECT043A)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 258)
  await scratch(async () => {
    await chain.db.exec(`grant execute on function public.disi_portfolio_candidate_readiness() to public`)
    assert.deepEqual(await failing(), ['staged_function_violations'])
  })
  await scratch(async () => {
    await chain.db.exec(`alter function public.disi_player_realized_organizational_value() volatile`)
    assert.deepEqual(await failing(), ['staged_function_violations'])
  })
  await scratch(async () => {
    // an API-executable writing function is caught even when it is not a staged one
    await chain.db.exec(`create function public.disi_zz_writer() returns void language sql volatile as 'select null'`)
    assert.deepEqual(await failing(), ['staged_function_violations'])
  })
  await scratch(async () => {
    // the view no longer reads its function (the original stacked shape): the wrapper check fails
    const expected = fs.readFileSync(path.join(root, 'database/research/042/views.sql'), 'utf8')
    await chain.db.exec(expected.slice(expected.indexOf('create or replace view public.v_expected_value_research_queue'),
      expected.indexOf('comment on view public.v_expected_value_research_queue')))
    assert.deepEqual(await failing(), ['staged_view_wrapper_violations'])
  })
})

test('rerun: 043a is idempotent and changes no data, definition, function or output', async () => {
  const defs = await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)
  const fdefs = await q(`select p.proname, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text, '') as acl from pg_proc p
    where p.pronamespace = 'public'::regnamespace order by 1, 2`)
  const cat = await catalog()
  const hashes = await tableHashes()
  const out = await outputs()
  await chain.db.exec(sql043a)
  assert.deepEqual(await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`), defs)
  assert.deepEqual(await q(`select p.proname, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text, '') as acl from pg_proc p
    where p.pronamespace = 'public'::regnamespace order by 1, 2`), fdefs)
  assert.deepEqual(await catalog(), cat)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await outputs(), out)
})

test('reproducible: re-running the build produces the committed SQL bytes', () => {
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, f))).digest('hex')
  const before = sha(`database/sql/${FILE}`)
  execFileSync(process.execPath, [path.join(root, 'database/research/043a/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(sha(`database/sql/${FILE}`), before)
})

test('forward-only: 043a redefines four views and adds four functions; it never creates a table, drops, alters or writes data', () => {
  const code = sql043a.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\bcreate table\b/i)
  assert.doesNotMatch(code, /\bdrop (table|view|column|function)\b/i)
  assert.doesNotMatch(code, /\balter (view|column|table|function)\b/i)
  assert.doesNotMatch(code, /^\s*(delete from|truncate|update |insert into)/im)
  assert.equal((code.match(/create or replace function public\.disi_\w+\(\)/g) || []).length, 4)
  assert.equal((code.match(/create or replace view public\.v_\w+/g) || []).length, 4)
})
