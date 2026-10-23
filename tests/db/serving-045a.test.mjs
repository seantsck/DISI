// Migration 045a: the product snapshot serving layer. The 045 database is replayed (001-045 with 043a), 045a is applied for real, and
// the snapshots are proven equal to the 042-045 analytical outputs in four support states (unsupported, probability-only, expected value
// supported with no eligible candidate, predictive decisions supported); the refresh is atomic, owner-only and derives every state; the
// API boundary closes the analytical layer; the verifier, idempotency, the deterministic build and the product contract are checked.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_046 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { productSnapshotQueries } from '../../scripts/db/lib/product-snapshot-invariants.mjs'
import { SNAPSHOT_TABLES, INTERNAL_VIEWS, STAGED_FUNCTIONS, SERVING_FUNCTIONS } from '../../database/research/045a/snapshots.mjs'
import { predictionReadiness, NO_PROBABILITY_STATEMENT } from '../../lib/decision-display.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '045a_product_snapshot_serving.sql'
const sql045a = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
async function scratch(fn) {
  await chain.db.exec('begin;')
  try { return await fn() } finally { await chain.db.exec('rollback;') }
}
const tableHashes = async () => {
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5((await q(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const catalog = async () => ({
  views: await q(`select relname, pg_get_viewdef(oid) as d, coalesce(relacl::text, '') as acl from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`),
  tables: await q(`select relname, coalesce(relacl::text, '') as acl, relrowsecurity as rls from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`),
  functions: await q(`select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text, '') as acl from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  policies: await q(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`),
})
const drift = async () => (await q(`select snapshot, missing_rows + extra_rows as n from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`))
const refresh = async () => q(`select snapshot, row_count from public.disi_refresh_product_snapshots()`)

// the four support states, each applied inside a rolled-back transaction
const probabilityOnly = async () => {
  await chain.db.exec(`alter table outcome_targets drop constraint outcome_targets_min_reference_n_check, drop constraint outcome_targets_min_positives_check,
    drop constraint outcome_targets_min_negatives_check`)
  await chain.db.exec(`update outcome_targets set min_reference_n = 20, min_positives = 2, min_negatives = 2 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
}
// a stand-in supported conditional value (2.0 bWAR); CREATE OR REPLACE keeps the view's oid, so every dependent reads it
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
// expected value supported, but every candidate's acquisition cost incomplete at the decision date: no candidate may be recommended
const expectedValueNoEligible = async () => {
  await expectedValueSupported()
  const cols = (await q(`select attname from pg_attribute where attrelid = 'public.v_signing_time_features'::regclass and attnum > 0 and not attisdropped order by attnum`)).map((r) => r.attname)
  await chain.db.exec(`alter view public.v_signing_time_features rename to zz_features_real`)
  await chain.db.exec(`create view public.v_signing_time_features as select ${cols.map((c) => (c === 'acquisition_cost_completeness' ? `'PARTIAL'::text as ${c}` : `r.${c}`)).join(', ')} from public.zz_features_real r`)
}
const STATES = {
  unsupported: { setUp: async () => {}, chain: 'NO_PREDICTIVE_LAYER_SUPPORTED' },
  probability_only: { setUp: probabilityOnly, chain: 'PROBABILITY_ONLY' },
  expected_value_no_eligible_candidate: { setUp: expectedValueNoEligible, chain: 'EXPECTED_VALUE_SUPPORTED_NO_ELIGIBLE_CANDIDATE' },
  predictive_decisions_supported: { setUp: expectedValueSupported, chain: 'PREDICTIVE_DECISIONS_SUPPORTED' },
}

let before045a
before(async () => {
  chain = await buildChainThrough('045_final_integration_release.sql')
  before045a = { hashes: await tableHashes(), catalog: await catalog() }
  await chain.db.exec(sql045a)
}, { timeout: 600000 })
after(async () => { await chain?.close() })

test('045a shape: ten RLS snapshot tables readable by the API roles; the analytical layer closed; nothing earlier written but the contract', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 77, views: 155 })
  const snap = await q(`select relname, relrowsecurity as rls, has_table_privilege('anon', oid, 'SELECT') as a, has_table_privilege('authenticated', oid, 'SELECT') as b,
      has_table_privilege('anon', oid, 'INSERT') or has_table_privilege('anon', oid, 'UPDATE') or has_table_privilege('anon', oid, 'DELETE') as anon_write
    from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`, [SNAPSHOT_TABLES])
  assert.equal(snap.length, 10)
  for (const s of snap) assert.deepEqual([s.rls, s.a, s.b, s.anon_write], [true, true, true, false], s.relname)
  const open = await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)
    and (has_table_privilege('anon', oid, 'SELECT') or has_table_privilege('authenticated', oid, 'SELECT'))`, [INTERNAL_VIEWS])
  assert.deepEqual(open, [])
  const fns = await q(`select proname, provolatile as vol, prosecdef as secdef, array_to_string(proconfig, ',') as cfg,
      has_function_privilege('public', oid, 'EXECUTE') or has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE') as api
    from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1) order by 1`, [[...STAGED_FUNCTIONS, ...SERVING_FUNCTIONS]])
  assert.equal(fns.length, 8)
  for (const f of fns) assert.deepEqual([f.secdef, f.cfg, f.api], [false, 'search_path=""', false], f.proname)
  assert.equal(fns.find((f) => f.proname === 'disi_refresh_product_snapshots').vol, 'v')
  assert.equal(fns.find((f) => f.proname === 'disi_product_snapshot_drift').vol, 's')
  // every pre-045a table keeps its rows, except the product contract, which now names what the application reads
  const after = await tableHashes()
  assert.deepEqual(Object.keys(before045a.hashes).filter((t) => after[t] !== before045a.hashes[t]), ['disi_product_contract'])
  // no earlier view definition changes except the release status (schema v0.36.1, canonical through 045a)
  const defs = Object.fromEntries((await catalog()).views.map((v) => [v.relname, v.d]))
  assert.deepEqual(before045a.catalog.views.filter((v) => defs[v.relname] !== v.d).map((v) => v.relname), ['v_disi_release_status'])
})

test('first generation: built by the migration, every snapshot equal to its analytical source, the unsupported state carried through', async () => {
  const e = await one(`select * from product_executive_snapshot`)
  assert.equal(Number(e.generation_id), 1)
  assert.deepEqual([e.product_version, e.schema_version, e.support_chain_state, e.canonical_through], ['DISI v1.0.0', 'v0.36.1', 'NO_PREDICTIVE_LAYER_SUPPORTED', '045a_product_snapshot_serving.sql'])
  assert.deepEqual([e.supported_probability_targets, e.non_null_probabilities, e.supported_expected_value_models, e.supported_expected_values, e.predictive_portfolio_recommendations], [0, 0, 0, 0, 0])
  assert.deepEqual([String(e.known_acquisition_spend_usd), e.signings_with_known_cost, e.dodgers_signings, String(e.cost_coverage), e.spend_state], ['117377237.33', 48, 220, '0.218', 'KNOWN_SPEND_IS_A_LOWER_BOUND'])
  assert.deepEqual([String(e.realized_org_value_bwar), String(e.value_left_organization_bwar)], ['298.83', '432.44'])
  assert.equal(predictionReadiness(e).statement, NO_PROBABILITY_STATEMENT)
  const counts = {}
  for (const t of SNAPSHOT_TABLES) counts[t] = (await one(`select count(*)::int as n from public.${t}`)).n
  assert.deepEqual(counts, { product_executive_snapshot: 1, product_prediction_readiness: 7, product_model_evaluations: 3, product_expected_value_support: 1,
    product_portfolio_decision_support: 6, product_portfolio_history: 26, product_portfolio_scenarios: 52, product_player_decision: 220,
    product_player_expected_value: 220, product_player_comparables: 475 })
  assert.deepEqual(await drift(), [])
  const states = await q(`select expected_value_state, count(*)::int as n from product_player_expected_value group by 1 order by 1`)
  assert.deepEqual(states, [{ expected_value_state: 'OUT_OF_SCOPE', n: 63 }, { expected_value_state: 'PROBABILITY_NOT_SUPPORTED', n: 157 }])
  const dec = await q(`select decision_support_state, count(*)::int as n from product_player_decision group by 1 order by 1`)
  assert.deepEqual(dec.map((r) => [r.decision_support_state, r.n]), [['HISTORICAL_CONTEXT_ONLY', 137], ['INSUFFICIENT_OUTCOME_SUPPORT', 1], ['INSUFFICIENT_PLAYER_DATA', 30], ['OUT_OF_SCOPE', 52]])
})

test('SEMANTIC EQUIVALENCE in four support states: the refresh carries each state downstream and every snapshot equals its source', async () => {
  const seen = {}
  for (const [name, s] of Object.entries(STATES)) {
    seen[name] = await scratch(async () => {
      await s.setUp()
      await refresh()
      assert.deepEqual(await drift(), [], `${name}: every snapshot equals a fresh evaluation of its source (values, NULLs, states, labels, provenance)`)
      const e = await one(`select support_chain_state, supported_probability_targets, non_null_probabilities, supported_expected_value_models, supported_expected_values,
        predictive_portfolio_recommendations from product_executive_snapshot`)
      const selections = (await one(`select count(optimized_selection)::int as n from product_portfolio_scenarios`)).n
      const evs = (await one(`select count(expected_org_value_bwar)::int as n from product_player_expected_value`)).n
      return { ...e, selections, evs }
    })
    assert.equal(seen[name].support_chain_state, s.chain, name)
  }
  assert.deepEqual([seen.unsupported.non_null_probabilities, seen.unsupported.evs, seen.unsupported.predictive_portfolio_recommendations, seen.unsupported.selections], [0, 0, 0, 0])
  assert.ok(seen.probability_only.non_null_probabilities > 0 && seen.probability_only.evs === 0 && seen.probability_only.predictive_portfolio_recommendations === 0)
  assert.ok(seen.expected_value_no_eligible_candidate.evs > 0 && seen.expected_value_no_eligible_candidate.predictive_portfolio_recommendations === 0
    && seen.expected_value_no_eligible_candidate.selections === 0)
  assert.ok(seen.predictive_decisions_supported.evs > 0 && seen.predictive_decisions_supported.predictive_portfolio_recommendations > 0
    && seen.predictive_decisions_supported.selections > 0)
  // nothing leaked out of the scratch transactions
  assert.equal((await one(`select support_chain_state from product_executive_snapshot`)).support_chain_state, 'NO_PREDICTIVE_LAYER_SUPPORTED')
})

test('atomic refresh: a failing stage leaves the previous generation complete; generations advance; content is deterministic', async () => {
  const before = { gen: (await one(`select generation_id from product_executive_snapshot`)).generation_id, hashes: await tableHashes() }
  await scratch(async () => {
    // a booby-trapped comparables source fails while the refresh runs (the planner folds 1 / 0)
    await chain.db.exec(`alter view public.v_player_comparable_summary rename to zz_cmp_real`)
    await chain.db.exec(`create view public.v_player_comparable_summary as select null::uuid as target_signing_id, (1 / 0)::text as x`)
    await chain.db.exec('savepoint s')
    await assert.rejects(refresh(), /division by zero|does not exist|structure of query/)
    await chain.db.exec('rollback to savepoint s')
    assert.equal((await one(`select generation_id from product_executive_snapshot`)).generation_id, before.gen)
  })
  assert.deepEqual(await tableHashes(), before.hashes)
  await scratch(async () => {
    const stages = await refresh()
    assert.deepEqual(stages.map((s) => s.snapshot), SNAPSHOT_TABLES)
    assert.equal(Number((await one(`select generation_id from product_executive_snapshot`)).generation_id), Number(before.gen) + 1)
    const content = async () => {
      const out = {}
      for (const t of SNAPSHOT_TABLES) out[t] = md5((await q(`select (to_jsonb(x) - array['generation_id', 'generated_at', 'snapshot_as_of_date']) as j from public.${t} x`)).map((r) => JSON.stringify(r.j)).sort())
      return out
    }
    const a = await content()
    await refresh()
    assert.deepEqual(await content(), a, 'the same inputs give the same snapshot content')
  })
})

test('API boundary: anon / authenticated read the snapshots, but neither the analytical views nor any staged or serving function', async () => {
  for (const role of ['anon', 'authenticated']) {
    await scratch(async () => {
      await chain.db.exec(`set local role ${role}`)
      assert.equal((await one(`select count(*)::int as n from product_player_decision`)).n, 220)
      assert.equal((await one(`select count(*)::int as n from product_executive_snapshot`)).n, 1)
    })
    for (const v of ['v_executive_overview', 'v_portfolio_candidate_readiness', 'v_player_realized_organizational_value', 'v_disi_release_status']) {
      await scratch(async () => {
        await chain.db.exec(`set local role ${role}`)
        await assert.rejects(q(`select 1 from public.${v} limit 1`), /permission denied/, `${role} ${v}`)
      })
    }
    for (const f of ['disi_executive_overview', 'disi_portfolio_candidate_readiness', 'disi_refresh_product_snapshots', 'disi_product_snapshot_drift']) {
      await scratch(async () => {
        await chain.db.exec(`set local role ${role}`)
        await assert.rejects(q(`select * from public.${f}()`), /permission denied/, `${role} ${f}`)
      })
    }
  }
})

test('product contract: exactly the relations the application reads, every one existing and readable; no analytical internal among them', async () => {
  const files = ['lib/data.js', ...fs.readdirSync(path.join(root, 'app'), { recursive: true }).filter((f) => String(f).endsWith('.js')).map((f) => path.join('app', String(f)))]
  const reads = new Set()
  for (const f of files) for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/\.from\('([a-z_0-9]+)'\)/g)) reads.add(m[1])
  // 045b later points the home page at product_database_status; at 045a the same read was v_database_status
  if (reads.delete('product_database_status')) reads.add('v_database_status')
  const contract = (await q(`select relation_name from disi_product_contract order by 1`)).map((r) => r.relation_name)
  assert.deepEqual(contract, [...reads].sort())
  assert.equal(contract.length, 47)
  assert.deepEqual(contract.filter((r) => INTERNAL_VIEWS.includes(r)), [])
  const intro = await q(`select relation_name, introduced_in from disi_product_contract where relation_name = any($1) order by 1`, [SNAPSHOT_TABLES])
  assert.ok(intro.length === 10 && intro.every((r) => r.introduced_in === '045a'))
})

test('verifier: the four snapshot checks pass, each catches its own drift, and the full verifier passes on 001-045a', async () => {
  const failing = async () => {
    const out = []
    for (const [name, sql] of Object.entries(productSnapshotQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
    return out.sort()
  }
  assert.deepEqual(await failing(), [])
  // 045b later adds the home-page status table (78); the 045a database has 77
  const full = await checkInvariants(q, { ...CANONICAL_EXPECTATIONS, public_tables_total: 77 })
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 249)
  await scratch(async () => {
    await chain.db.exec(`grant select on public.v_executive_overview to anon`)
    assert.deepEqual(await failing(), ['product_snapshot_api_violations'])
  })
  await scratch(async () => {
    await chain.db.exec(`grant execute on function public.disi_executive_overview() to authenticated`)
    assert.ok((await failing()).includes('product_snapshot_api_violations'))
  })
  await scratch(async () => {
    // a stale or tampered snapshot: the drift check reports it
    await chain.db.exec(`update product_player_decision set realized_org_value_bwar = realized_org_value_bwar + 1 where realized_org_value_bwar is not null`)
    assert.deepEqual(await failing(), ['product_snapshot_drift_violations'])
  })
  await scratch(async () => {
    await chain.db.exec(`update product_executive_snapshot set predictive_portfolio_recommendations = 3`)
    assert.ok((await failing()).includes('product_snapshot_support_violations'))
  })
  await scratch(async () => {
    await chain.db.exec(`update product_player_comparables set generation_id = generation_id + 1`)
    assert.deepEqual(await failing(), ['product_snapshot_generation_violations'])
  })
})

test('rerun: 045a is idempotent - no new generation, no data, definition, ACL or policy change', async () => {
  const hashes = await tableHashes()
  const cat = await catalog()
  await chain.db.exec(sql045a)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await catalog(), cat)
})

test('reproducible: re-running the build produces the committed SQL bytes', () => {
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, f))).digest('hex')
  const before = sha(`database/sql/${FILE}`)
  execFileSync(process.execPath, [path.join(root, 'database/research/045a/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(sha(`database/sql/${FILE}`), before)
})

test('forward-only: 045a adds tables and functions, redefines only the release status, writes only its own tables and the contract', () => {
  const code = sql045a.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\bdrop (table|view|column|function)\b/i)
  assert.doesNotMatch(code, /\balter (view|function)\b/i)
  // the only column change: generation_id NOT NULL on the new snapshot tables
  for (const m of code.matchAll(/alter table public\.(\w+) alter column (\w+)/gi)) assert.deepEqual([SNAPSHOT_TABLES.includes(m[1]), m[2]], [true, 'generation_id'])
  for (const m of code.matchAll(/\balter table public\.(\w+)/gi)) assert.ok(SNAPSHOT_TABLES.includes(m[1]), m[1])
  for (const m of code.matchAll(/^\s*(?:delete from|insert into|update) public\.(\w+)/gim)) assert.ok([...SNAPSHOT_TABLES, 'disi_product_contract'].includes(m[1]), m[1])
  assert.deepEqual([...code.matchAll(/create or replace view public\.(\w+)/g)].map((m) => m[1]), ['v_disi_release_status'])
  assert.doesNotMatch(code, /\btruncate\b/i)
})
