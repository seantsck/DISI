// Migration 043: portfolio decision support. The 042 database is replayed (001-042), 043 is applied for real, and candidate readiness,
// support propagation (041 -> 042 -> 043: no predictive recommendation today), leakage safety, honest budget feasibility, the exact
// optimizer behind the support switch, retrospective labelling, the verifier, idempotency and the deterministic build are checked.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { portfolioQueries, PORTFOLIO_CHECK_NAMES } from '../../scripts/db/lib/portfolio-invariants.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '043_portfolio_decision_engine.sql'
const sql043 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const views042 = fs.readFileSync(path.join(root, 'database/research/042/views.sql'), 'utf8')
const views043 = fs.readFileSync(path.join(root, 'database/research/043/views.sql'), 'utf8')
const VIEWS = ['v_portfolio_candidate_readiness', 'v_historical_portfolio_summary', 'v_portfolio_scenario_evaluation', 'v_portfolio_decision_support', 'v_portfolio_research_queue']
const TABLES = ['portfolio_scenario_definitions']
const EXPECT043 = { ...CANONICAL_EXPECTATIONS, public_views_total: 150, public_tables_total: 66 }
const viewSql = (src, name) => src.slice(src.indexOf(`create or replace view public.${name}`), src.indexOf(`comment on view public.${name}`))

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
let before043
before(async () => {
  chain = await buildChainThrough('042_expected_organizational_value.sql')
  before043 = { hashes: await tableHashes(), defs: await viewDefs() }
  await chain.db.exec(sql043)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(portfolioQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
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
/** Inside a scratch transaction: make the REACH target and a stand-in conditional value (2.0 bWAR) supported, and rebind 042/043. */
async function supportEverything() {
  await chain.db.exec(`alter table outcome_targets drop constraint outcome_targets_min_reference_n_check, drop constraint outcome_targets_min_positives_check,
    drop constraint outcome_targets_min_negatives_check`)
  await chain.db.exec(`update outcome_targets set min_reference_n = 20, min_positives = 2, min_negatives = 2 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
  await chain.db.exec(`update expected_value_models set probability_target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
  await chain.db.exec(`alter view public.v_expected_value_support rename to v_expected_value_support_real`)
  await chain.db.exec(`create view public.v_expected_value_support as select r.value_model_key, r.value_model_version, r.probability_target_key, r.value_component,
    r.reference_population, r.probability_supported, r.labelled_n, r.positive_n, r.additional_positives_needed, r.additional_labels_needed, 10 as conditional_value_n,
    r.min_conditional_n, 0 as additional_conditional_observations_needed, true as conditional_value_supported,
    case when r.probability_supported then 2.0 end as conditional_mean_value_bwar, r.probability_supported as expected_value_supported,
    case when r.probability_supported then 'EXPECTED_VALUE_SUPPORTED' else 'PROBABILITY_NOT_SUPPORTED' end as support_state, r.blocking_reasons, r.evidence_as_of_date
    from public.v_expected_value_support_real r`)
  await chain.db.exec(viewSql(views042, 'v_player_expected_organizational_value'))
  await chain.db.exec(viewSql(views043, 'v_portfolio_candidate_readiness'))
}

test('043 shape: one RLS table, five security-invoker views, SELECT-only grants; nothing earlier changes', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 66, views: 150 })
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
  assert.deepEqual(Object.keys(after).filter((t) => after[t] !== before043.hashes[t]).sort(), TABLES)
  const defs = await viewDefs()
  assert.deepEqual(Object.keys(before043.defs).filter((x) => defs[x] !== before043.defs[x]), [])
  // the legacy 001 tables stay untouched and empty
  assert.deepEqual(await one(`select (select count(*) from portfolio_scenarios)::int as s, (select count(*) from model_predictions)::int as m`), { s: 0, m: 0 })
})

test('SUPPORT PROPAGATION: 041 and 042 support nothing, so 043 has no optimization-eligible candidate, no recommendation and no selection', async () => {
  const states = Object.fromEntries((await q(`select decision_support_state, count(*)::int as n from v_portfolio_candidate_readiness group by 1`)).map((r) => [r.decision_support_state, r.n]))
  assert.equal(states.PREDICTIVE_DECISION_SUPPORTED, undefined)
  assert.equal(Object.values(states).reduce((a, b) => a + b, 0), 220)
  assert.ok(states.HISTORICAL_CONTEXT_ONLY > 0)
  const r = await one(`select count(*) filter (where optimization_eligible)::int as eligible, count(expected_org_value_bwar)::int as ev from v_portfolio_candidate_readiness`)
  assert.deepEqual(r, { eligible: 0, ev: 0 })
  assert.deepEqual(await q(`select distinct predictive_recommendations_total as n from v_portfolio_decision_support`), [{ n: 0 }])
  const s = await one(`select count(*)::int as n, count(*) filter (where value_optimization_state = 'VALUE_OPTIMIZATION_NOT_SUPPORTED')::int as unsupported,
    count(optimized_selection)::int as selections, count(optimized_expected_org_bwar)::int as ev from v_portfolio_scenario_evaluation`)
  assert.equal(s.unsupported, s.n)
  assert.deepEqual([s.selections, s.ev], [0, 0])
})

test('readiness: the decision date is the signing cutoff, every blocked candidate names its blockers, and no column ranks', async () => {
  const bad = await one(`select count(*)::int as n from v_portfolio_candidate_readiness r join v_signing_time_features f on f.signing_id = r.signing_id
    where r.decision_as_of_date is distinct from f.signing_cutoff_date or (r.decision_support_state <> 'PREDICTIVE_DECISION_SUPPORTED' and cardinality(r.decision_blockers) = 0)`)
  assert.equal(bad.n, 0)
  const cols = (await q(`select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0`, [VIEWS])).map((r) => r.attname)
  for (const x of cols) assert.doesNotMatch(x, /rank|leader|best|score|causal|recommended_player|predicted_success/i, x)
})

test('leakage: flipping every outcome and adding later facts never changes a candidate\'s readiness', async () => {
  const cols = `signing_id, decision_as_of_date, population_class, signing_route, market_group, era_key, age_band, position_family, expectation_tier, cost_band,
    known_acquisition_cost_usd, cost_complete, player_data_complete, historical_comparables, decision_support_state, optimization_eligible, decision_blockers`
  const readiness = md5(await q(`select ${cols} from v_portfolio_candidate_readiness order by signing_id`))
  await scratch(async () => {
    await chain.db.exec(`update outcome_audits set reached_mlb_verified = not reached_mlb_verified,
      outcome_state = case when reached_mlb_verified then 'NO_MLB_STATUS_UNKNOWN' else 'REACHED_MLB' end`)
    await chain.db.exec(`update players set primary_position = 'C'`)
    await chain.db.exec(`delete from player_season_stints`)
    assert.equal(md5(await q(`select ${cols} from v_portfolio_candidate_readiness order by signing_id`)), readiness)
  })
})

test('budget feasibility is honest: unknown costs make it INDETERMINATE, never zero; known spend is a lower bound', async () => {
  const s = await q(`select * from v_portfolio_scenario_evaluation where scenario_key = 'BASE_POOL' order by signing_year`)
  assert.ok(s.length > 0)
  for (const r of s) {
    if (r.incomplete_cost_candidates > 0) {
      assert.notEqual(r.budget_state, 'WITHIN_BUDGET_ON_COMPLETE_COSTS', String(r.signing_year))
      assert.equal(r.budget_headroom_usd, null)
    }
  }
  assert.ok(s.some((r) => r.budget_state === 'INDETERMINATE_UNKNOWN_COSTS'))
  const reserve = await one(`select b.scenario_budget_usd::float as base, r.scenario_budget_usd::float as reserved from v_portfolio_scenario_evaluation b
    join v_portfolio_scenario_evaluation r on r.signing_year = b.signing_year and r.scenario_key = 'RESERVE_30' where b.scenario_key = 'BASE_POOL' and b.signing_year = 2024`)
  assert.ok(Math.abs(reserve.reserved - reserve.base * 0.7) < 0.01)
  const h = await q(`select * from v_historical_portfolio_summary`)
  for (const r of h) {
    assert.equal(r.analysis_kind, 'RETROSPECTIVE')
    assert.match(r.interpretation_note, /not imply that a better allocation was knowable/)
    if (r.complete_cost_signings < r.signings) assert.equal(r.spend_state, 'KNOWN_SPEND_IS_A_LOWER_BOUND')
  }
})

test('the switch: with supported expected values, only eligible candidates enter, and the selection is the exact value-maximizing feasible set', async () => {
  await scratch(async () => {
    await supportEverything()
    const elig = await q(`select signing_year, player_slug, known_acquisition_cost_usd::float as cost, expected_org_value_bwar::float as ev, cost_complete, player_data_complete
      from v_portfolio_candidate_readiness where optimization_eligible`)
    assert.ok(elig.length > 0, 'some candidate becomes eligible')
    for (const e of elig) assert.ok(e.cost_complete && e.player_data_complete && e.ev !== null)
    // candidates with unsupported inputs never become eligible
    assert.equal((await one(`select count(*)::int as n from v_portfolio_candidate_readiness where optimization_eligible and not cost_complete`)).n, 0)
    const sc = await q(`select scenario_key, signing_year, scenario_budget_usd::float as budget, optimized_selection, optimized_expected_org_bwar::float as ev,
      optimization_eligible_candidates, value_optimization_state from v_portfolio_scenario_evaluation where optimization_eligible_candidates > 0`)
    assert.ok(sc.length > 0)
    for (const s of sc) {
      const cands = elig.filter((e) => e.signing_year === s.signing_year)
      if (cands.length > 12) { assert.equal(s.value_optimization_state, 'VALUE_OPTIMIZATION_TOO_LARGE_FOR_EXACT_SEARCH'); continue }
      let best = 0
      for (let m = 1; m < 1 << cands.length; m++) {
        let c = 0, v = 0
        for (let i = 0; i < cands.length; i++) if (m & (1 << i)) { c += cands[i].cost; v += cands[i].ev }
        if (c <= s.budget + 1e-6 && v > best) best = v
      }
      assert.equal(s.value_optimization_state, 'VALUE_OPTIMIZATION_SUPPORTED')
      assert.ok(Math.abs((s.ev ?? 0) - Math.round(best * 1000) / 1000) < 1e-6, `${s.scenario_key} ${s.signing_year}: ${s.ev} vs ${best}`)
      for (const p of s.optimized_selection ?? []) assert.ok(cands.some((c) => c.player_slug === p))
    }
    assert.deepEqual(await failing(), [])
  })
})

test('verifier: the five 043 checks pass, each catches its own drift, and the full verifier passes on the 043 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(PORTFOLIO_CHECK_NAMES.length, 5)
  const full = await checkInvariants(q, EXPECT043)
  assert.deepEqual(failedChecks(full), [])
  const rd = 'v_portfolio_candidate_readiness'
  assert.ok((await drift(rd, { decision_blockers: `array[]::text[]` })).includes('portfolio_readiness_violations'))
  assert.ok((await drift(rd, { optimization_eligible: 'true', decision_support_state: `'PREDICTIVE_DECISION_SUPPORTED'` })).includes('portfolio_support_propagation_violations'))
  assert.ok((await drift('v_portfolio_scenario_evaluation', { budget_state: `'WITHIN_BUDGET_ON_COMPLETE_COSTS'` })).includes('portfolio_scenario_violations'))
  assert.ok((await drift('v_portfolio_decision_support', { predictive_recommendations_total: '3' })).includes('portfolio_decision_summary_violations'))
  assert.ok((await drift('v_historical_portfolio_summary', { analysis_kind: `'PREDICTIVE'` })).includes('portfolio_retrospective_label_violations'))
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = await viewDefs()
  const out = md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3`))))
  await chain.db.exec(sql043)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await viewDefs(), defs)
  assert.equal(md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3`)))), out)
})

test('reproducible: re-running the build produces the committed SQL bytes', () => {
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, f))).digest('hex')
  const before = sha(`database/sql/${FILE}`)
  execFileSync(process.execPath, [path.join(root, 'database/research/043/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(sha(`database/sql/${FILE}`), before)
})

test('frozen history: 043 adds only; it never alters, drops, deletes or updates an earlier object', () => {
  const code = sql043.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\bdrop (table|view|column)\b/i)
  assert.doesNotMatch(code, /\balter (view|column)\b/i)
  assert.doesNotMatch(code, /^\s*(delete from|truncate|update )/im)
  assert.doesNotMatch(code, /\balter table public\.(?!portfolio_scenario_definitions\b)/i)
})
