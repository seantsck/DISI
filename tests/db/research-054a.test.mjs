// 054a (development research-queue performance) over the exact database it was written for (the 054 chain): the 054 definition is what the
// chain holds, 054a changes only the materialization of team_stints, the queue returns the same rows, nothing else in the catalog or the data moves,
// the guard refuses any other predecessor, the migration reruns, and the rollback restores the 054 definition exactly.
//   QUERY SHAPE != QUERY RESULT

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_054A as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { ALL_SNAPSHOT_TABLES } from '../../database/research/045b/snapshots.mjs'
import { queueViews, BEFORE, AFTER } from '../../database/research/054a/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '054a_development_queue_performance.sql'
const QUEUE = 'v_dodgers_development_research_queue'
const sql054a = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback054a = fs.readFileSync(path.join(root, 'database/release/sql/rollback-054a.sql'), 'utf8')
const sql054 = fs.readFileSync(path.join(root, 'database/sql/054_full_career_transaction_history.sql'), 'utf8')
const views = queueViews(sql054)

// The research queue without its surrogate player id, every row, sorted: the same value on any database built from the canonical chain,
// production included (128 rows; read-only on production 2026-10-25, the 054 view and the 054a query both gave this hash).
const QUEUE_ROWS = `select count(*)::int as n, md5(string_agg(md5(r), '' order by md5(r))) as h from (select concat_ws('|', player_slug, full_name, mlb_id, signing_year,
  issue, priority, detail) as r from public.${QUEUE}) x`
const EXPECTED_QUEUE = { n: 128, h: '081f8efb25d47334b3727bcfd32149a1' }

let chain
let pre054a
let post054a
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const open = async (dump) => {
  const db = new PGlite({ loadDataDir: dump, extensions: { pgcrypto } })
  return { db, query: async (s, p) => (await db.query(s, p)).rows, close: () => db.close() }
}
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params, c = chain) => (await c.query(sql, params))[0]
const failsWith = async (c, sql, pattern) => {
  try { await c.db.exec(sql) } catch (e) {
    await c.db.exec('rollback;').catch(() => {})
    assert.match(String(e.message), pattern)
    return
  }
  assert.fail(`expected the statement to fail with ${pattern}`)
}
const tables = async (c) => {
  const out = {}
  const names = (await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  for (const t of names) out[t] = (await c.query(`select count(*)::int as n, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h from public.${t} x`))[0]
  return out
}
const surface = async (c) => ({
  relations: await c.query(`select c.relname, c.relkind::text, c.relrowsecurity, coalesce(c.relacl::text, '') as acl, coalesce(array_to_string(c.reloptions, ','), '') as opts,
      coalesce(obj_description(c.oid, 'pg_class'), '') as note, c.relowner::regrole::text as owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'i', 'S') order by 1`),
  columns: await c.query(`select table_name, column_name, data_type, ordinal_position from information_schema.columns where table_schema = 'public' order by 1, 4`),
  functions: await c.query(`select p.oid::regprocedure::text as f, p.prosecdef, coalesce(p.proacl::text, '') as acl, md5(pg_get_functiondef(p.oid)) as h
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`),
  policies: await c.query(`select tablename, policyname, cmd, roles::text, coalesce(qual, '') as qual from pg_policies where schemaname = 'public' order by 1, 2`),
  triggers: await c.query(`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
  views: await c.query(`select relname, md5(pg_get_viewdef(oid)) as h from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`),
})
const rowsOf = async (c) => (await c.query(`select x::text as r from public.${QUEUE} x`)).map((r) => r.r).sort()
const defOf = async (c) => (await one(`select pg_get_viewdef('public.${QUEUE}'::regclass) as d`, [], c)).d
// a definition as this server deparses it: a temporary view built from the statement's query
const deparse = async (c, query) => {
  await c.db.exec(`create temporary view _probe as ${query}`)
  try { return (await one(`select pg_get_viewdef('pg_temp._probe'::regclass) as d`, [], c)).d } finally { await c.db.exec('drop view pg_temp._probe') }
}

let preTables, preSurface, preRows, preDef, preGeneration
before(async () => {
  chain = await buildChainThrough('054_full_career_transaction_history.sql')
  pre054a = await chain.db.dumpDataDir('none')
  preTables = await tables(chain)
  preSurface = await surface(chain)
  preRows = await rowsOf(chain)
  preDef = await defOf(chain)
  preGeneration = (await one(`select max(generation_id)::int as g from public.product_executive_snapshot`)).g
  await chain.db.exec(sql054a)
  post054a = await chain.db.dumpDataDir('none')
}, { timeout: 900000 })
after(async () => { await chain?.close() })

test('054a follows 054 in the manifest (055 follows it), is frozen at its released hash, and the build reproduces the migration and the rollback', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '054_full_career_transaction_history.sql')
  assert.equal(manifest.canonical_sql[i + 1], '055_international_benchmark_2017_2018.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.equal(frozen[FILE], crypto.createHash('sha1').update(sql054a.replace(/\r\n/g, '\n')).digest('hex'))
  assert.equal(frozen[FILE], '05acf920403c65f53fa595a6d85daced4046206a')
  assert.match(sql054a, /^-- DISI v0\.39\.1\n-- 054a_development_queue_performance\.sql\n/)
  assert.match(rollback054a, /^-- DISI rollback-054a\.sql/)
  assert.ok(!sql054a.includes('\r') && !rollback054a.includes('\r'))
  // the 054a statement is the 054 statement with one token replaced; the rollback carries the 054 statement byte for byte
  assert.equal(views.view054a, views.view054.replace(BEFORE, AFTER))
  assert.equal(views.view054a.length - views.view054.length, ' not materialized'.length)
  assert.ok(sql054a.includes(`\n${views.view054a}\n`))
  assert.ok(!sql054a.includes(`\n${views.view054}\n`))
  assert.ok(rollback054a.includes(`\n${views.view054}\n`))
  // the only DDL on a public object is the one view; nothing is written
  const body = sql054a.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
  assert.deepEqual([...body.matchAll(/create or replace view (\S+)/gi)].map((m) => m[1]), ['public.v_dodgers_development_research_queue'])
  assert.ok(!/\b(insert into|update\s+public|delete from|truncate|alter|grant|revoke|create (table|index|function|policy|trigger|type))\b/i.test(body.replace(/create temporary table _m054a_before[^;]*;/, '')))
  assert.ok(!/disi_refresh_product_snapshots/.test(body))
})

test('the 054 chain holds exactly the 054 definition (materialized team_stints, no hint)', async () => {
  assert.equal(preDef, await deparse(chain, views.query054))
  assert.notEqual(preDef, await deparse(chain, views.query054a))
  assert.ok(!/MATERIALIZED/i.test(preDef))
})

test('054a: team_stints is NOT MATERIALIZED, progression is untouched, and the definition is exactly the 054a query', async () => {
  const d = await defOf(chain)
  assert.equal(d, await deparse(chain, views.query054a))
  assert.match(d, /team_stints AS NOT MATERIALIZED \(/)
  assert.equal(d.match(/MATERIALIZED/g).length, 1)
  assert.match(d, /progression AS \(/)
  assert.ok(!/progression AS (NOT )?MATERIALIZED/.test(d))
  assert.equal(d.replace('team_stints AS NOT MATERIALIZED (', 'team_stints AS ('), preDef)
  // the planner inlines it: no CTE scan of team_stints remains
  const plan = (await q(`explain (costs off) select * from public.${QUEUE}`)).map((r) => r['QUERY PLAN']).join('\n')
  assert.ok(!/CTE team_stints/.test(plan) && !/CTE Scan on team_stints/.test(plan), plan.slice(0, 400))
})

test('the queue returns the same rows: the same multiset of whole rows, the pinned production row hash, 128 detector rows', async () => {
  const now = await rowsOf(chain)
  assert.equal(now.length, preRows.length)
  assert.deepEqual(now, preRows)
  assert.deepEqual(await one(QUEUE_ROWS), EXPECTED_QUEUE)
  const c = await open(pre054a)
  try { assert.deepEqual(await one(QUEUE_ROWS, [], c), EXPECTED_QUEUE) } finally { await c.close() }
})

test('nothing else moves: every table row, column, grant, option, comment, owner, function, policy and trigger is what 054 left; one view definition changes', async () => {
  assert.deepEqual(await tables(chain), preTables)
  const now = await surface(chain)
  assert.deepEqual(now.relations, preSurface.relations)
  assert.deepEqual(now.columns, preSurface.columns)
  assert.deepEqual(now.functions, preSurface.functions)
  assert.deepEqual(now.policies, preSurface.policies)
  assert.deepEqual(now.triggers, preSurface.triggers)
  const changed = now.views.filter((v) => preSurface.views.find((x) => x.relname === v.relname)?.h !== v.h).map((v) => v.relname)
  assert.deepEqual(changed, [QUEUE])
  assert.deepEqual(now.views.map((v) => v.relname), preSurface.views.map((v) => v.relname))
})

test('security: the queue stays security_invoker, SELECT-only for anon and authenticated, readable by anon, not updatable', async () => {
  const r = preSurface.relations.find((x) => x.relname === QUEUE)
  assert.match(r.opts, /security_invoker=(true|on)/)
  assert.deepEqual((await surface(chain)).relations.find((x) => x.relname === QUEUE), r)
  const priv = await one(`select
      has_table_privilege('anon', 'public.${QUEUE}', 'SELECT') as anon_read, has_table_privilege('authenticated', 'public.${QUEUE}', 'SELECT') as auth_read,
      has_table_privilege('anon', 'public.${QUEUE}', 'INSERT') or has_table_privilege('anon', 'public.${QUEUE}', 'UPDATE') or has_table_privilege('anon', 'public.${QUEUE}', 'DELETE')
        or has_table_privilege('authenticated', 'public.${QUEUE}', 'INSERT') or has_table_privilege('authenticated', 'public.${QUEUE}', 'UPDATE')
        or has_table_privilege('authenticated', 'public.${QUEUE}', 'DELETE') as write`)
  assert.deepEqual(priv, { anon_read: true, auth_read: true, write: false })
  const upd = await one(`select is_updatable, is_insertable_into from information_schema.views where table_schema = 'public' and table_name = '${QUEUE}'`)
  assert.deepEqual([upd.is_updatable, upd.is_insertable_into], ['NO', 'NO'])
  await chain.db.exec(`begin; set local role anon;`)
  try { assert.equal((await one(`select count(*)::int as n from public.${QUEUE}`)).n, 128) } finally { await chain.db.exec('rollback;') }
})

test('no snapshot moves: the same generation, zero drift; the verifier passes 259/259 with the canonical expectations', async () => {
  assert.equal((await one(`select max(generation_id)::int as g from public.product_executive_snapshot`)).g, preGeneration)
  for (const t of ALL_SNAPSHOT_TABLES) assert.equal((await one(`select count(*) filter (where generation_id <> $1)::int as n from public.${t}`, [preGeneration])).n, 0, t)
  assert.deepEqual(await q(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`), [])
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 259)
})

test('rerunnable: applying 054a again changes nothing', async () => {
  const c = await open(post054a)
  try {
    const a = { t: await tables(c), s: await surface(c) }
    await c.db.exec(sql054a)
    assert.deepEqual({ t: await tables(c), s: await surface(c) }, a)
  } finally { await c.close() }
})

test('guards: 054a refuses a database without 054 and any predecessor definition other than 054; the rollback refuses anything but 054a', async () => {
  const a = await open(pre054a)
  try {
    // another definition of the queue (the 054 text with progression inlined instead) is not the 054 view
    await a.db.exec(`create or replace view public.${QUEUE} with (security_invoker = true) as ${views.query054.replace('progression as (', 'progression as not materialized (')}`)
    await failsWith(a, sql054a, /054a: v_dodgers_development_research_queue is not the 054 definition/)
    await failsWith(a, rollback054a, /rollback-054a: v_dodgers_development_research_queue is not the 054a definition/)
  } finally { await a.close() }
  const b = await open(pre054a)
  try {
    await b.db.exec('drop view public.v_player_career_transactions')
    await failsWith(b, sql054a, /054a: Migration 054 has not been applied/)
  } finally { await b.close() }
  const c = await open(pre054a)
  try {
    await failsWith(c, rollback054a, /rollback-054a: v_dodgers_development_research_queue is not the 054a definition/)
  } finally { await c.close() }
})

test('rollback restores the exact 054 definition and nothing else moves; reapplying 054a reproduces the 054a state', async () => {
  const c = await open(post054a)
  try {
    const after054a = await surface(c)
    await c.db.exec(rollback054a)
    assert.equal(await defOf(c), preDef)
    assert.deepEqual(await surface(c), preSurface)
    assert.deepEqual(await tables(c), preTables)
    assert.deepEqual(await rowsOf(c), preRows)
    await failsWith(c, rollback054a, /rollback-054a: v_dodgers_development_research_queue is not the 054a definition/)
    await c.db.exec(sql054a)
    assert.deepEqual(await surface(c), after054a)
    assert.deepEqual(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name), [])
  } finally { await c.close() }
})
