// Migration 038: signing network outcomes. The 037 database is replayed (001-037), 038 is applied for real, and the association
// rows, the entity summary guardrails (no denominator, no census, no ranking, cost gating), the known-sample coverage, the research
// queue and the verifier are checked against the 029 network facts and the 036 / 037 layers.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { networkOutcomeQueries, NETWORK_OUTCOME_CHECK_NAMES } from '../../scripts/db/lib/network-outcome-invariants.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '038_signing_network_outcomes.sql'
const sql038 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const VIEWS = ['v_network_player_outcomes', 'v_network_outcome_summary', 'v_network_outcome_coverage', 'v_network_outcome_research_queue']

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
let before038
before(async () => {
  chain = await buildChainThrough('037_development_pathway_intelligence.sql')
  before038 = {
    hashes: await tableHashes(),
    network029: md5(await q(`select * from v_dodgers_network_coverage order by 1, 3, 4`)),
    pathway: md5(await q(`select * from v_player_development_pathway order by signing_id`)),
  }
  await chain.db.exec(sql038)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(networkOutcomeQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
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

test('038 shape: no table, four security-invoker views, SELECT-only grants, one transaction', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
  assert.deepEqual(c, { tables: 60, views: 125 })
  const v = await q(`select relname, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) and relkind = 'v' order by 1`, [VIEWS])
  assert.deepEqual(v.map((r) => r.relname), [...VIEWS].sort())
  for (const r of v) assert.match(r.opts, /security_invoker=true/)
  const acl = await q(`select c.relname, r.rolname as grantee, a.privilege_type as p from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)`, [VIEWS])
  assert.deepEqual([...new Set(acl.map((a) => a.p))], ['SELECT'])
  assert.equal(acl.length, VIEWS.length * 2)
  assert.match(sql038, /^begin;$/m)
  assert.match(sql038, /^commit;$/m)
})

test('038 is derived only: no table changes; the 029 coverage view and the 037 pathways are byte-identical', async () => {
  assert.deepEqual(await tableHashes(), before038.hashes)
  assert.equal(md5(await q(`select * from v_dodgers_network_coverage order by 1, 3, 4`)), before038.network029)
  assert.equal(md5(await q(`select * from v_player_development_pathway order by signing_id`)), before038.pathway)
})

test('association rows: one per ACTIVE relationship with the outcome, expectation and pathway context; the grade is association strength', async () => {
  const rows = await q(`select player_slug, entity_slug, relationship_type, stage, signing_linked, attribution_confidence, reached_mlb_verified,
    career_bwar::float as c, pathway_class from v_network_player_outcomes order by 1, 2`)
  assert.equal(rows.length, 9)
  assert.deepEqual(rows.map((r) => [r.player_slug, r.entity_slug, r.attribution_confidence]), [
    ['christopher-arias', 'amauris-nina', 'HIGH'], ['christopher-arias', 'international-prospect-league', 'HIGH'],
    ['jorbit-vivas', 'yasser-mendez-academy', 'HIGH'], ['oneil-cruz', 'raul-valera', 'MEDIUM'],
    ['ronny-brito', 'international-prospect-league', 'HIGH'], ['ronny-brito', 'laurentino-genao', 'HIGH'],
    ['starling-heredia', 'dominican-prospect-league', 'HIGH'], ['starling-heredia', 'franklin-ferreras', 'HIGH'],
    ['starling-heredia', 'franklin-ferreras-program', 'LOW'],
  ])
  const cruz = rows.find((r) => r.player_slug === 'oneil-cruz')
  assert.deepEqual([cruz.reached_mlb_verified, cruz.c, cruz.signing_linked, cruz.stage], [true, 8.17, false, 'UNKNOWN'])
  // a retracted association disappears from every 038 view
  await scratch(async () => {
    await chain.db.exec(`update player_network_relationships set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test'
      where id = (select pr.id from player_network_relationships pr join players p on p.id = pr.player_id where p.slug = 'oneil-cruz')`)
    assert.equal((await one(`select count(*)::int as n from v_network_player_outcomes`)).n, 8)
    assert.equal((await one(`select count(*)::int as n from v_network_outcome_summary where entity_slug = 'raul-valera'`)).n, 0)
    assert.deepEqual(await failing(), [])
  })
})

test('entity summary: every entity is ANECDOTAL today; no denominator, census, comparison, rank or ratio; cost totals only when complete', async () => {
  const s = await q(`select entity_slug, relationship_type, tracked_signees, mature_audited_signees, reached_mlb, career_bwar_total::float as c, cost_coverage,
    complete_acquisition_cost_usd::float as cost, denominator_known, network_sample_state, comparison_label from v_network_outcome_summary order by 1, 2`)
  assert.equal(s.length, 8)
  for (const r of s) {
    assert.equal(r.denominator_known, false)
    assert.equal(r.network_sample_state, 'ANECDOTAL')
    assert.equal(r.comparison_label, 'NO_COMPARISON_DENOMINATOR_UNKNOWN')
  }
  const ipl = s.find((r) => r.entity_slug === 'international-prospect-league')
  assert.deepEqual([ipl.tracked_signees, ipl.reached_mlb, ipl.cost_coverage, ipl.cost], [2, 0, 'COMPLETE', 2500000])
  const ymAcademy = s.find((r) => r.entity_slug === 'yasser-mendez-academy')
  assert.deepEqual([ymAcademy.reached_mlb, ymAcademy.c, ymAcademy.cost_coverage, ymAcademy.cost], [1, 0.51, 'NONE', null])
  const cols = (await q(`select attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0 and not a.attisdropped`, [VIEWS])).map((r) => r.attname)
  for (const c of cols) assert.doesNotMatch(c, /rank|percentile|_rate$|hit_rate|per_million|per_dollar|roi|efficien|leader|score|causal|predict|effect/i, c)
})

test('coverage: the known network sample and the unattributed signings partition every Dodgers segment and are never compared', async () => {
  const c = await q(`select segment_kind, segment_value, network_state, signings, mature_reached_mlb, comparison_label from v_network_outcome_coverage order by 1, 2, 3`)
  const all = c.filter((r) => r.segment_kind === 'ALL')
  assert.deepEqual(all.map((r) => [r.network_state, r.signings]), [['KNOWN_NETWORK_SAMPLE', 5], ['UNATTRIBUTED_SIGNINGS', 215]])
  for (const kind of ['ALL', 'SIGNING_ERA', 'PATHWAY']) assert.equal(c.filter((r) => r.segment_kind === kind).reduce((n, r) => n + r.signings, 0), 220, kind)
  const era = c.filter((r) => r.segment_kind === 'SIGNING_ERA' && r.network_state === 'KNOWN_NETWORK_SAMPLE')
  assert.deepEqual(era.map((r) => [r.segment_value, r.signings]), [['2010-2017', 5], ['2018 and later', 0], ['Before 2010', 0]])
  for (const r of c) assert.equal(r.comparison_label, 'DESCRIPTIVE_ONLY_SELECTION_BIASED')
  const cols = (await q(`select attname from pg_attribute where attrelid = 'public.v_network_outcome_coverage'::regclass and attnum > 0`)).map((r) => r.attname)
  for (const x of cols) assert.doesNotMatch(x, /share|rate|difference|lift|ratio/i, x)
})

test('research queue: only new issue types', async () => {
  const issues = Object.fromEntries((await q(`select issue, count(*)::int as n from v_network_outcome_research_queue group by 1`)).map((r) => [r.issue, r.n]))
  assert.deepEqual(issues, { NETWORK_ENTITY_SAMPLE_ANECDOTAL: 8, NETWORK_RELATIONSHIP_NOT_SIGNING_LINKED: 2, NETWORK_SIGNEE_COST_INCOMPLETE: 1 })
  const old = (await q(`select distinct issue from v_network_research_queue`)).map((r) => r.issue)
  for (const k of Object.keys(issues)) assert.ok(!old.includes(k), k)
})

test('verifier: the six network outcome checks pass, each catches its own drift, and the full verifier passes on the 038 database', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(NETWORK_OUTCOME_CHECK_NAMES.length, 6)
  const full = await checkInvariants(q, { ...CANONICAL_EXPECTATIONS, public_views_total: 125, public_tables_total: 60 })
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 243, '207 through 038 plus the five 039, five 040 and six 041 checks, which pass trivially without their objects')
  const s = 'v_network_outcome_summary'
  assert.ok((await drift(s, { denominator_known: 'true' })).includes('network_outcome_census_claim_violations'))
  assert.ok((await drift(s, { network_sample_state: `'CENSUS'` })).includes('network_outcome_census_claim_violations'))
  assert.ok((await drift(s, { complete_acquisition_cost_usd: `coalesce(r.complete_acquisition_cost_usd, 1)` })).includes('network_outcome_cost_gating_violations'))
  const x = 'v_network_player_outcomes'
  assert.ok((await drift(x, { attribution_confidence: `'HIGH'` })).includes('network_outcome_attribution_violations'))
  assert.ok((await drift(x, { career_bwar: `coalesce(r.career_bwar, 0)` })).includes('network_outcome_passthrough_violations'))
  assert.ok((await drift('v_network_outcome_coverage', { comparison_label: `'COMPARABLE'` })).includes('network_outcome_coverage_violations'))
})

test('rerun: the migration is idempotent and changes no data and no definition', async () => {
  const hashes = await tableHashes()
  const defs = async () => q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)
  const outputs = async () => md5(await Promise.all(VIEWS.map((v) => q(`select * from public.${v} order by 1, 2, 3, 4`))))
  const d1 = await defs()
  const o1 = await outputs()
  await chain.db.exec(sql038)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await defs(), d1)
  assert.equal(await outputs(), o1)
})

test('reproducible: building from the same inputs produces the committed bytes', () => {
  const before = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  execFileSync(process.execPath, [path.join(root, 'database/research/038/build.mjs')], { cwd: root, stdio: 'pipe' })
  const afterHash = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  assert.equal(afterHash, before)
})

test('frozen history: 038 adds views only; no table, no alteration, no data change', () => {
  assert.doesNotMatch(sql038, /\b(create|drop|alter) table\b/i)
  assert.doesNotMatch(sql038, /\b(drop|alter) (view|column)\b/i)
  assert.doesNotMatch(sql038, /\b(insert into|delete from|truncate|update public\.)/i)
})
