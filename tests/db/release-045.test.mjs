// Migration 045: final integration (DISI v1.0.0). The 044 database is replayed (001-044), 045 is applied for real, and the product
// contract (exactly the relations the application reads), the release status, the full support chain, executive metric provenance,
// the research roadmap, the verifier, idempotency and the deterministic build are checked.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { releaseQueries, RELEASE_CHECK_NAMES } from '../../scripts/db/lib/release-invariants.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_046 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '045_final_integration_release.sql'
const sql045 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const contract = JSON.parse(fs.readFileSync(path.join(root, 'database/research/045/contract.json'), 'utf8'))
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const VIEWS = ['v_disi_release_status', 'v_research_roadmap', 'v_executive_metric_provenance']
const TABLES = ['disi_product_contract']

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
let before045
before(async () => {
  chain = await buildChainThrough('044_executive_product.sql')
  before045 = { hashes: await tableHashes(), defs: await viewDefs() }
  await chain.db.exec(sql045)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(releaseQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
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

test('045 shape: one RLS table, three security-invoker views, SELECT-only grants; 67 tables / 155 views; nothing earlier changes', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 67, views: 155 })
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
  assert.deepEqual(Object.keys(after).filter((t) => after[t] !== before045.hashes[t]).sort(), TABLES)
  const defs = await viewDefs()
  assert.deepEqual(Object.keys(before045.defs).filter((x) => defs[x] !== before045.defs[x]), [])
  // the roadmap is a wrapper over its staged, read-only, invoker-rights function; the release status reads the overview's counts
  const f = await one(`select l.lanname, p.provolatile as vol, p.prosecdef as secdef, array_to_string(p.proconfig, ',') as cfg,
      has_function_privilege('public', p.oid, 'EXECUTE') as public_x, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_x,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_x
    from pg_proc p join pg_language l on l.oid = p.prolang where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_research_roadmap'`)
  assert.deepEqual(f, { lanname: 'plpgsql', vol: 's', secdef: false, cfg: 'search_path=""', public_x: false, anon_x: true, auth_x: true })
  assert.match(defs.v_research_roadmap, /disi_research_roadmap\(\)/)
  assert.match(defs.v_disi_release_status, /v_executive_overview/)
  for (const v of ['v_disi_release_status', 'v_research_roadmap']) {
    const lines = (await q(`explain (memory, summary, costs off) select * from public.${v}`)).map((r) => Object.values(r)[0])
    assert.ok(Number(lines.find((l) => /Memory: used=/.test(l)).match(/used=(\d+)kB/)[1]) < 2048, `${v} plans in under 2 MB`)
  }
})

test('product contract: exactly the reviewed 045 contract (the relations the 045-era application read), each existing, secured and readable', async () => {
  // 045a later replaces the analytical entries with the product snapshots the application now reads (tests/db/serving-045a.test.mjs)
  const rows = await q(`select relation_name, relation_kind, contract_tier, introduced_in from disi_product_contract order by 1`)
  assert.deepEqual(rows.map((r) => r.relation_name), contract.contract.map((c) => c.relation_name).sort())
  assert.equal(rows.length, contract.contract.length)
  // the introducing migration is the first canonical migration that creates the relation
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8')).canonical_sql
  for (const r of rows) {
    const re = new RegExp(`create\\s+(or\\s+replace\\s+)?(view|table)\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${r.relation_name}\\b`, 'i')
    const first = manifest.find((f) => re.test(fs.readFileSync(path.join(root, 'database/sql', f), 'utf8')))
    assert.equal(r.introduced_in, first.slice(0, first.indexOf('_')), r.relation_name)
  }
})

test('release status: DISI v1.0.0 with data freshness, model versions and the support chain state', async () => {
  const s = await one(`select * from v_disi_release_status`)
  assert.equal(s.product_version, `DISI v${pkg.version}`)
  assert.equal(s.schema_version, 'v0.36')
  assert.equal(s.probability_model_version, 'outcome-probability-v1')
  assert.equal(s.value_model_version, 'expected-org-value-v1')
  assert.equal(s.decision_engine_version, 'portfolio-decision-v1')
  assert.deepEqual([s.probability_targets, s.supported_probability_targets, s.expected_value_models, s.supported_expected_value_models, s.predictive_portfolio_recommendations],
    [4, 0, 1, 0, 0])
  assert.equal(s.support_chain_state, 'NO_PREDICTIVE_LAYER_SUPPORTED')
  assert.equal(s.product_contract_relations, 48)
  assert.doesNotMatch(s.product_statement, /AI general manager|oracle|predictor/i)
})

test('CRITICAL SUPPORT CHAIN: supported_targets = 0 -> supported expected values = 0 -> predictive recommendations = 0, end to end', async () => {
  const chainState = await one(`select
    (select count(distinct target_key) from v_outcome_target_support where baseline_supported)::int as targets,
    (select count(probability) from v_player_outcome_probability)::int as probabilities,
    (select count(expected_org_value_bwar) from v_player_expected_organizational_value)::int as expected_values,
    (select count(*) from v_portfolio_candidate_readiness where optimization_eligible)::int as eligible,
    (select count(optimized_selection) from v_portfolio_scenario_evaluation)::int as selections,
    (select predictive_portfolio_recommendations from v_executive_overview)::int as overview_recommendations,
    (select support_chain_state from v_disi_release_status) as chain`)
  assert.deepEqual(chainState, { targets: 0, probabilities: 0, expected_values: 0, eligible: 0, selections: 0, overview_recommendations: 0, chain: 'NO_PREDICTIVE_LAYER_SUPPORTED' })
  assert.deepEqual(await failing(), [])
  // a supported target alone moves the chain to PROBABILITY_ONLY - never further without the downstream evidence
  await scratch(async () => {
    await chain.db.exec(`alter table outcome_targets drop constraint outcome_targets_min_reference_n_check, drop constraint outcome_targets_min_positives_check,
      drop constraint outcome_targets_min_negatives_check`)
    await chain.db.exec(`update outcome_targets set min_reference_n = 20, min_positives = 2, min_negatives = 2 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
    const s = await one(`select support_chain_state, supported_probability_targets, supported_expected_value_models, predictive_portfolio_recommendations from v_disi_release_status`)
    assert.deepEqual(s, { support_chain_state: 'PROBABILITY_ONLY', supported_probability_targets: 1, supported_expected_value_models: 0, predictive_portfolio_recommendations: 0 })
    assert.deepEqual(await failing(), [])
  })
})

test('executive metric provenance and the research roadmap are complete and consistent', async () => {
  const m = await q(`select * from v_executive_metric_provenance`)
  assert.ok(m.length >= 10)
  const cols = (await q(`select attname from pg_attribute where attrelid = 'public.v_executive_overview'::regclass and attnum > 0`)).map((r) => r.attname)
  for (const x of m) {
    assert.ok(cols.includes(x.metric_key), x.metric_key)
    assert.ok(cols.includes(x.denominator_column), x.denominator_column)
  }
  const r = await q(`select * from v_research_roadmap order by priority`)
  assert.deepEqual(r.map((x) => x.gap_area), ['OUTCOME_AUDITS', 'PREDICTION_SUPPORT', 'POPULATION_COMPLETENESS', 'COST_COVERAGE', 'BENCHMARK_DEPTH',
    'SIGNING_TIME_FEATURES', 'SCOUTING_COVERAGE', 'REALIZED_VALUE_RESOLUTION'])
  assert.match(r[1].evidence_needed, /Closest Dodgers target/)
  for (const x of r) assert.ok(x.open_items >= 0)
})

test('verifier: the five 045 checks pass, each catches its own drift, and the full verifier passes on 001-045', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(RELEASE_CHECK_NAMES.length, 5)
  // 045a later adds the ten product snapshot tables (77); the 045 database has 67
  const full = await checkInvariants(q, { ...CANONICAL_EXPECTATIONS, public_tables_total: 67 })
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 249)
  await scratch(async () => {
    await chain.db.exec(`insert into disi_product_contract (relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in)
      values ('v_does_not_exist', 'VIEW', 'EXECUTIVE', 'PAGE', '{/}', 'test', '045')`)
    assert.ok((await failing()).includes('product_contract_violations'))
  })
  assert.ok((await drift('v_disi_release_status', { supported_expected_value_models: '1' })).includes('release_status_violations'))
  assert.ok((await drift('v_disi_release_status', { predictive_portfolio_recommendations: '2' })).includes('support_chain_violations'))
  assert.ok((await drift('v_executive_metric_provenance', { denominator_column: `'no_such_column'` })).includes('executive_metric_provenance_violations'))
  assert.ok((await drift('v_research_roadmap', { priority: '1' })).includes('research_roadmap_violations'))
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = await viewDefs()
  const out = md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2`))))
  await chain.db.exec(sql045)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await viewDefs(), defs)
  assert.equal(md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2`)))), out)
})

test('reproducible: re-running the build produces the committed SQL bytes', () => {
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, f))).digest('hex')
  const before = sha(`database/sql/${FILE}`)
  execFileSync(process.execPath, [path.join(root, 'database/research/045/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(sha(`database/sql/${FILE}`), before)
})

test('frozen history: 045 adds only; it never alters, drops, deletes or updates an earlier object, nor evaluates an analytical view', () => {
  const code = sql045.replace(/--.*$/gm, '')
  // the postconditions are structural: the migration never reads the release status or the roadmap it defines
  assert.doesNotMatch(code, /from public\.v_(disi_release_status|research_roadmap)\b/i)
  assert.doesNotMatch(code, /\bdrop (table|view|column)\b/i)
  assert.doesNotMatch(code, /\balter (view|column)\b/i)
  assert.doesNotMatch(code, /^\s*(delete from|truncate|update )/im)
  assert.doesNotMatch(code, /\balter table public\.(?!disi_product_contract\b)/i)
})
