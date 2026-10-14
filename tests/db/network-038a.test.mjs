// Migration 038a: post-038 query-shape correction of v_network_player_outcomes. The 038 database is replayed (001-038), the 038
// definitions of the four network views are kept as copies, 038a is applied for real, and the new views are compared with the old
// ones on the real data and on a synthetic relationship for every tracked signing (every pathway and expectation branch).

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '038a_network_outcome_view_performance.sql'
const sql038a = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
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
const catalog = async () => ({
  defs: await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' and relname not like 'zz\\_%' order by 1`),
  meta: await q(`select c.relname, a.attnum, a.attname, format_type(a.atttypid, a.atttypmod) as t, obj_description(c.oid, 'pg_class') as cmt,
      coalesce(array_to_string(c.reloptions, ','), '') as o, coalesce(c.relacl::text, '') as acl
    from pg_class c join pg_attribute a on a.attrelid = c.oid where c.relnamespace = 'public'::regnamespace and c.relname = any($1) and a.attnum > 0 order by 1, 2`, [VIEWS]),
  policies: await q(`select tablename, policyname, cmd, roles::text as roles, qual from pg_policies where schemaname = 'public' order by 1, 2`),
  functions: await q(`select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
})
let before038a
before(async () => {
  chain = await buildChainThrough('038_signing_network_outcomes.sql')
  // the 038 definitions, kept as copies that read the old player view (views bind by oid, so the text is rebound to the copy)
  for (const v of VIEWS) {
    const def = (await one(`select pg_get_viewdef($1::regclass) as d`, [`public.${v}`])).d.replace(/\bv_network_player_outcomes\b/g, 'zz_old_v_network_player_outcomes')
    await chain.db.exec(`create view public.zz_old_${v} with (security_invoker = true) as ${def}; grant select on public.zz_old_${v} to anon, authenticated`)
  }
  before038a = { hashes: await tableHashes(), catalog: await catalog() }
  await chain.db.exec(sql038a)
}, { timeout: 300000 })
after(async () => { await chain?.close() })

const sameRows = async () => {
  const out = {}
  for (const v of VIEWS) {
    const n = (await one(`select count(*)::int as n from public.${v}`)).n
    const d1 = (await one(`select count(*)::int as n from (select * from public.${v} except all select * from public.zz_old_${v}) x`)).n
    const d2 = (await one(`select count(*)::int as n from (select * from public.zz_old_${v} except all select * from public.${v}) x`)).n
    out[v] = { n, diff: d1 + d2 }
  }
  return out
}

test('038a changes only the query of v_network_player_outcomes: no table, row, grant, policy, function, comment, column or type changes', async () => {
  assert.deepEqual(await tableHashes(), before038a.hashes)
  const now = await catalog()
  const changed = now.defs.filter((d) => before038a.catalog.defs.find((b) => b.relname === d.relname)?.d !== d.d).map((d) => d.relname)
  assert.deepEqual(changed, ['v_network_player_outcomes'])
  assert.deepEqual(now.meta, before038a.catalog.meta)
  assert.deepEqual(now.policies, before038a.catalog.policies)
  assert.deepEqual(now.functions, before038a.catalog.functions)
  assert.match(now.meta.find((m) => m.relname === 'v_network_player_outcomes').o, /security_invoker=true/)
})

test('equivalence on the real data: all four network views return exactly the 038 rows', async () => {
  const r = await sameRows()
  assert.deepEqual(r, {
    v_network_player_outcomes: { n: 9, diff: 0 }, v_network_outcome_summary: { n: 8, diff: 0 },
    v_network_outcome_coverage: { n: 26, diff: 0 }, v_network_outcome_research_queue: { n: 11, diff: 0 },
  })
})

test('equivalence on a synthetic relationship for every tracked signing: every pathway class and expectation state, identical rows', async () => {
  await chain.db.exec('begin;')
  try {
    await chain.db.exec(`insert into player_network_relationships (player_id, entity_id, signing_id, relationship_type, stage, source_id, evidence_basis, confidence, retrieved_at)
      select s.player_id, (select id from network_entities where entity_type = 'PERSON' order by slug limit 1), s.id, 'TRAINED_WITH', 'PRE_SIGNING',
        (select id from sources order by url limit 1), 'MANUAL_RESEARCH', 'HIGH', now()
      from signings s join organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS'
      on conflict do nothing`)
    await chain.db.exec(`insert into player_network_relationships (player_id, entity_id, signing_id, relationship_type, stage, source_id, evidence_basis, confidence, retrieved_at)
      select s.player_id, (select id from network_entities where entity_type = 'PERSON' order by slug offset 1 limit 1), null, 'TRAINED_WITH', 'UNKNOWN',
        (select id from sources order by url limit 1), 'MANUAL_RESEARCH', 'MEDIUM', now()
      from signings s join organizations o on o.id = s.organization_id where o.franchise_key <> 'DODGERS'`)
    const r = await sameRows()
    for (const v of VIEWS) assert.equal(r[v].diff, 0, v)
    assert.ok(r.v_network_player_outcomes.n >= 268)
    const cov = await one(`select count(distinct pathway_class)::int as pc, count(distinct expectation_comparison_state)::int as es,
      count(*) filter (where pathway_class is null)::int as no_pathway from v_network_player_outcomes`)
    assert.ok(cov.pc >= 9, `pathway classes ${cov.pc}`)
    assert.ok(cov.es >= 5, `expectation states ${cov.es}`)
    assert.ok(cov.no_pathway >= 48, 'benchmark (non-Dodgers) players keep a NULL pathway')
    // the pathway and expectation columns equal the 037 / 036 views for every Dodgers signing
    const mism = await one(`select count(*)::int as n from v_network_player_outcomes x
      join v_player_development_pathway p on p.signing_id = x.signing_id
      where x.pathway_class is distinct from p.pathway_class or x.pathway_status is distinct from p.pathway_status`)
    assert.equal(mism.n, 0)
  } finally {
    await chain.db.exec('rollback;')
  }
})

test('verifier: every check passes on the 038a database (125 views + the four zz_old copies)', async () => {
  const full = await checkInvariants(q, { ...CANONICAL_EXPECTATIONS, public_views_total: 129, public_tables_total: 60 })
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 228)
})

test('rerun: 038a is idempotent', async () => {
  const hashes = await tableHashes()
  const cat = await catalog()
  const rows = await sameRows()
  await chain.db.exec(sql038a)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await catalog(), cat)
  assert.deepEqual(await sameRows(), rows)
})

test('reproducible: building from the same inputs produces the committed bytes', () => {
  const before = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex')
  execFileSync(process.execPath, [path.join(root, 'database/research/038a/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(crypto.createHash('sha1').update(fs.readFileSync(path.join(root, 'database/sql', FILE))).digest('hex'), before)
})

test('forward-only: 038a replaces one view and touches no table or data; the applied 038 file is frozen and unedited', () => {
  const code = sql038a.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\b(create|drop|alter) table\b/i)
  assert.doesNotMatch(code, /\b(drop|alter) (view|column)\b/i)
  assert.doesNotMatch(code, /^\s*(insert into|delete from|truncate|update |grant |revoke |comment on)/im)
  assert.equal((code.match(/create or replace view/gi) ?? []).length, 1)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const sql038 = fs.readFileSync(path.join(root, 'database/sql/038_signing_network_outcomes.sql'), 'utf8')
  assert.equal(crypto.createHash('sha1').update(sql038.replace(/\r\n/g, '\n')).digest('hex'), frozen['038_signing_network_outcomes.sql'])
  assert.equal(frozen['038_signing_network_outcomes.sql'], 'c07611249418c33f12e5a1934bb7948652a70dd7')
})
