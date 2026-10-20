// Migration 042: realized and expected organizational value. The 041 database is replayed (001-041), 042 is applied for real, and the
// realized-value decomposition, cost separation, labelled historical distributions, expected-value support propagation (041 unsupported
// -> 042 NULL), NULL safety, the support switch, the verifier, idempotency and the deterministic build are checked.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { orgValueQueries, ORG_VALUE_CHECK_NAMES } from '../../scripts/db/lib/org-value-invariants.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_046 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '042_expected_organizational_value.sql'
const sql042 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const views042 = fs.readFileSync(path.join(root, 'database/research/042/views.sql'), 'utf8')
const VIEWS = ['v_player_realized_organizational_value', 'v_historical_org_value_distribution', 'v_expected_value_support', 'v_player_expected_organizational_value', 'v_expected_value_research_queue']
const TABLES = ['expected_value_models']
const EXPECT042 = { ...CANONICAL_EXPECTATIONS, public_views_total: 145, public_tables_total: 65 }

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
let before042
before(async () => {
  chain = await buildChainThrough('041_outcome_probability_infrastructure.sql')
  before042 = { hashes: await tableHashes(), defs: await viewDefs() }
  await chain.db.exec(sql042)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(orgValueQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
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

test('042 shape: one RLS table, five security-invoker views, SELECT-only grants; nothing earlier changes', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 65, views: 145 })
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
  assert.deepEqual(Object.keys(after).filter((t) => after[t] !== before042.hashes[t]).sort(), TABLES)
  const defs = await viewDefs()
  assert.deepEqual(Object.keys(before042.defs).filter((x) => defs[x] !== before042.defs[x]), [])
})

test('realized value: one row per Dodgers signing; package, observable and other-club value are never added to a player', async () => {
  const s = await one(`select count(*)::int as n, count(distinct signing_id)::int as d,
    count(*) filter (where realized_value_state = 'REALIZED_TO_DATE')::int as realized,
    count(*) filter (where realized_value_state = 'OUTCOME_NOT_OBSERVED' and realized_org_value_bwar is not null)::int as unobserved_valued
    from v_player_realized_organizational_value`)
  assert.equal(s.n, (await one(`select count(*)::int as n from v_player_organizational_realization`)).n)
  assert.equal(s.d, s.n)
  assert.equal(s.unobserved_valued, 0, 'an unobserved outcome is unknown, never 0')
  assert.ok(s.realized > 0)
  // the total equals the 034 definition (direct + individually attributable), and excludes package / observable / other-club value
  const mismatch = await one(`select count(*)::int as n from v_player_realized_organizational_value v
    join v_downstream_organizational_realization d on d.signing_id = v.signing_id and d.row_grain = 'SIGNING'
    where v.realized_org_value_bwar is distinct from d.total_individually_attributable_organizational_bwar`)
  assert.equal(mismatch.n, 0)
  const cols = (await q(`select attname from pg_attribute where attrelid = 'public.v_player_realized_organizational_value'::regclass and attnum > 0`)).map((r) => r.attname)
  for (const c of ['direct_dodgers_bwar', 'individually_attributable_trade_bwar', 'package_first_hop_participation_bwar', 'package_downstream_participation_bwar',
    'observable_not_attributable_bwar', 'value_left_organization_bwar', 'realized_career_bwar', 'signing_bonus_usd', 'posting_fee_usd', 'transfer_fee_usd',
    'release_fee_usd', 'other_acquisition_fee_usd', 'known_acquisition_cost_usd', 'cost_components_known', 'cost_complete', 'cost_coverage_state']) assert.ok(cols.includes(c), c)
  assert.ok(!cols.some((c) => /fwar/i.test(c)), 'bWAR only; fWAR is never blended')
})

test('cost: no ratio without complete cost, a mature signing and a resolved value; unknown cost is never zero', async () => {
  const r = await one(`select count(*) filter (where realized_org_bwar_per_million_usd is not null and (not cost_complete or maturity_status <> 'MATURE'))::int as bad,
    count(*) filter (where cost_coverage_state <> 'COMPLETE' and ratio_suppression_reason is null)::int as unexplained,
    count(*) filter (where cost_coverage_state = 'UNKNOWN' and known_acquisition_cost_usd is not null)::int as unknown_valued
    from v_player_realized_organizational_value`)
  assert.deepEqual(r, { bad: 0, unexplained: 0, unknown_valued: 0 })
})

test('historical distributions are labelled descriptive, exclude the notable-player set and need 10 resolved values', async () => {
  const rows = await q(`select * from v_historical_org_value_distribution`)
  assert.ok(rows.length > 0)
  for (const d of rows) {
    assert.equal(d.statistic_kind, 'HISTORICAL_DESCRIPTIVE')
    if (d.value_known_n < 10) assert.equal(d.historical_median_org_bwar, null)
  }
  const cols = Object.keys(rows[0])
  for (const c of cols.filter((x) => /p25|median|p75|share/.test(x) && x !== 'positive_value_n')) assert.match(c, /^historical_/, c)
  const all = rows.find((d) => d.grain === 'ALL')
  const notable = await one(`select count(*)::int as n from v_player_realized_organizational_value where maturity_status = 'MATURE' and population_class = 'OUTCOME_SELECTED_SAMPLE'`)
  assert.ok(notable.n > 0)
  assert.equal(all.mature_members, (await one(`select count(*)::int as n from v_player_realized_organizational_value where maturity_status = 'MATURE'
    and population_class in ('TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS') and signing_route = 'AMATEUR_OR_UNCLASSIFIED_SIGNING'`)).n)
})

test('SUPPORT PROPAGATION: 041 supports no target, so 042 supports no expected value and every expected value is NULL with a reason', async () => {
  assert.equal((await one(`select count(distinct target_key)::int as n from v_outcome_target_support where baseline_supported`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from v_expected_value_support where expected_value_supported`)).n, 0)
  const e = await one(`select count(*)::int as n, count(expected_org_value_bwar)::int as ev, count(expected_direct_dodgers_bwar)::int as direct,
    count(probability)::int as p, count(expected_trade_realization_bwar)::int as trade, count(expected_org_bwar_per_million_usd)::int as ratio,
    count(*) filter (where expected_value_supported)::int as supported, count(*) filter (where expected_value_exclusion_reason is null)::int as unexplained
    from v_player_expected_organizational_value`)
  assert.deepEqual(e, { n: 220, ev: 0, direct: 0, p: 0, trade: 0, ratio: 0, supported: 0, unexplained: 0 })
  const states = Object.fromEntries((await q(`select expected_value_state, count(*)::int as n from v_player_expected_organizational_value group by 1`)).map((r) => [r.expected_value_state, r.n]))
  assert.equal(states.EXPECTED_VALUE_SUPPORTED, undefined)
  assert.ok(states.PROBABILITY_NOT_SUPPORTED > 0)
})

test('two gates: a supported probability alone is not enough; the conditional value must also be supported', async () => {
  await scratch(async () => {
    await chain.db.exec(`alter table outcome_targets drop constraint outcome_targets_min_reference_n_check, drop constraint outcome_targets_min_positives_check,
      drop constraint outcome_targets_min_negatives_check`)
    // the Dodgers-value target becomes "supported" with 11 labels and 0 positives (p = 0), but no positive value-known observation exists
    await chain.db.exec(`update outcome_targets set min_reference_n = 5, min_positives = 0, min_negatives = 2 where target_key = 'DODGERS_MLB_VALUE_WITHIN_10_SEASONS'`)
    const s = await one(`select probability_supported, conditional_value_supported, expected_value_supported, support_state from v_expected_value_support`)
    assert.deepEqual(s, { probability_supported: true, conditional_value_supported: false, expected_value_supported: false, support_state: 'CONDITIONAL_VALUE_NOT_SUPPORTED' })
    const e = await one(`select count(expected_org_value_bwar)::int as ev, count(*) filter (where expected_value_state = 'CONDITIONAL_VALUE_NOT_SUPPORTED')::int as cond
      from v_player_expected_organizational_value`)
    assert.equal(e.ev, 0)
    assert.ok(e.cond > 0)
    assert.deepEqual(await failing(), [])
  })
})

test('the switch: when both inputs are supported, expected value appears only for eligible rows and equals probability x conditional mean', async () => {
  await scratch(async () => {
    await chain.db.exec(`alter table outcome_targets drop constraint outcome_targets_min_reference_n_check, drop constraint outcome_targets_min_positives_check,
      drop constraint outcome_targets_min_negatives_check`)
    await chain.db.exec(`update outcome_targets set min_reference_n = 20, min_positives = 2, min_negatives = 2 where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
    await chain.db.exec(`update expected_value_models set probability_target_key = 'REACH_MLB_WITHIN_7_SEASONS'`)
    // stand in a supported conditional value (2.0 bWAR) and rebuild the dependent view over it, inside this rolled-back transaction
    await chain.db.exec(`alter view public.v_expected_value_support rename to v_expected_value_support_real`)
    await chain.db.exec(`create view public.v_expected_value_support as select r.value_model_key, r.value_model_version, r.probability_target_key, r.value_component,
      r.reference_population, r.probability_supported, r.labelled_n, r.positive_n, r.additional_positives_needed, r.additional_labels_needed, 10 as conditional_value_n,
      r.min_conditional_n, 0 as additional_conditional_observations_needed, true as conditional_value_supported,
      case when r.probability_supported then 2.0 end as conditional_mean_value_bwar, r.probability_supported as expected_value_supported,
      case when r.probability_supported then 'EXPECTED_VALUE_SUPPORTED' else 'PROBABILITY_NOT_SUPPORTED' end as support_state, r.blocking_reasons, r.evidence_as_of_date
      from public.v_expected_value_support_real r`)
    const ev = views042.slice(views042.indexOf('create or replace view public.v_player_expected_organizational_value'), views042.indexOf('comment on view public.v_player_expected_organizational_value'))
    await chain.db.exec(ev)
    const rows = await q(`select e.expected_org_value_bwar::float as v, e.probability::float as p, e.expected_direct_dodgers_bwar_low_90::float as lo,
      e.expected_direct_dodgers_bwar_high_90::float as hi, f.population_class, f.signing_route, t.exposure_complete
      from v_player_expected_organizational_value e join v_signing_time_features f on f.signing_id = e.signing_id
      join v_outcome_training_population t on t.signing_id = e.signing_id and t.target_key = e.probability_target_key
      where e.expected_value_supported`)
    assert.ok(rows.length > 0)
    for (const r of rows) {
      assert.ok(['TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS'].includes(r.population_class))
      assert.equal(r.signing_route, 'AMATEUR_OR_UNCLASSIFIED_SIGNING')
      assert.equal(r.exposure_complete, false)
      assert.ok(Math.abs(r.v - Math.round(r.p * 2.0 * 1000) / 1000) < 1e-9)
      assert.ok(r.lo <= r.v && r.v <= r.hi)
    }
    const unsupported = await one(`select count(expected_org_value_bwar)::int as n from v_player_expected_organizational_value where not expected_value_supported`)
    assert.equal(unsupported.n, 0)
  })
})

test('NULL safety: no expected-value, probability or ratio column is ever zero-filled while unsupported', async () => {
  const z = await one(`select count(*)::int as n from v_player_expected_organizational_value
    where not expected_value_supported and (coalesce(expected_org_value_bwar, -1) = 0 or coalesce(expected_direct_dodgers_bwar, -1) = 0 or coalesce(probability, -1) = 0)`)
  assert.equal(z.n, 0)
  const cols = (await q(`select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0`, [VIEWS])).map((r) => r.attname)
  for (const x of cols) assert.doesNotMatch(x, /rank|leader|best|score|causal|predicted_success/i, x)
})

test('research queue: the unsupported value model is queued with the evidence that would activate it', async () => {
  const r = await q(`select issue_type, count(*)::int as n from v_expected_value_research_queue group by 1 order by 1`)
  assert.ok(r.find((x) => x.issue_type === 'EXPECTED_VALUE_NOT_SUPPORTED')?.n === 1)
  const d = await one(`select detail, evidence_needed from v_expected_value_research_queue where issue_type = 'EXPECTED_VALUE_NOT_SUPPORTED'`)
  assert.match(d.detail, /DODGERS_MLB_VALUE_WITHIN_10_SEASONS is not supported/)
})

test('verifier: the five 042 checks pass, each catches its own drift, and the full verifier passes on the 042 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(ORG_VALUE_CHECK_NAMES.length, 5)
  const full = await checkInvariants(q, EXPECT042)
  assert.deepEqual(failedChecks(full), [])
  const rv = 'v_player_realized_organizational_value'
  assert.ok((await drift(rv, { realized_org_value_bwar: `case when r.realized_value_state = 'OUTCOME_NOT_OBSERVED' then 0 else r.realized_org_value_bwar end` })).includes('realized_value_row_violations'))
  assert.ok((await drift(rv, { realized_org_bwar_per_million_usd: `coalesce(r.realized_org_bwar_per_million_usd, 0)` })).includes('realized_value_cost_violations'))
  assert.ok((await drift('v_historical_org_value_distribution', { historical_median_org_bwar: '0' })).includes('historical_value_distribution_violations'))
  assert.ok((await drift('v_expected_value_support', { expected_value_supported: 'true' })).includes('expected_value_support_violations'))
  assert.ok((await drift('v_player_expected_organizational_value', { expected_org_value_bwar: '0' })).includes('expected_value_propagation_violations'))
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = await viewDefs()
  const out = md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3`))))
  await chain.db.exec(sql042)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await viewDefs(), defs)
  assert.equal(md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3`)))), out)
})

test('reproducible: re-running the build produces the committed SQL bytes', () => {
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, f))).digest('hex')
  const before = sha(`database/sql/${FILE}`)
  execFileSync(process.execPath, [path.join(root, 'database/research/042/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(sha(`database/sql/${FILE}`), before)
})

test('frozen history: 042 adds only; it never alters, drops, deletes or updates an earlier object', () => {
  const code = sql042.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\bdrop (table|view|column)\b/i)
  assert.doesNotMatch(code, /\balter (view|column)\b/i)
  assert.doesNotMatch(code, /^\s*(delete from|truncate|update )/im)
  assert.doesNotMatch(code, /\balter table public\.(?!expected_value_models\b)/i)
})
