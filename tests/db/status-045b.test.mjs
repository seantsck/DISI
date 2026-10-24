// Migration 045b: the home-page status snapshot. The 045a database is built (001-045a), 045b is applied for real, and the new snapshot is
// proven equal to v_database_status (its internal source), part of the same generation as the other ten, readable but never writable by
// the API roles, with v_database_status closed to them; the refresh and drift functions carry the eleventh snapshot; the product contract
// swaps the view for the table; the migration is idempotent, forward-only and reproducible; the application reads only the snapshot.

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
import { assemble } from '../../database/research/045b/build.mjs'
import { ALL_SNAPSHOT_TABLES, ALL_INTERNAL_VIEWS, STAGED_FUNCTIONS, SERVING_FUNCTIONS } from '../../database/research/045b/snapshots.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '045b_database_status_snapshot.sql'
const sql045b = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')

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
const asRole = async (role, sql) => {
  await chain.db.exec('begin;')
  try {
    await chain.db.exec(`set local role ${role};`)
    return await chain.db.query(sql)
  } finally { await chain.db.exec('rollback;') }
}
const denied = async (role, sql) => {
  try { await asRole(role, sql) } catch (e) { return /permission denied|row-level security|must be owner/i.test(String(e.message)) }
  return false
}

let before045b
before(async () => {
  chain = await buildChainThrough('045a_product_snapshot_serving.sql')
  before045b = { contract: await q(`select relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in from disi_product_contract order by 1`), hashes: await tableHashes(), catalog: await catalog(), generation: (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g }
  await chain.db.exec(sql045b)
}, { timeout: 600000 })
after(async () => { await chain?.close() })

test('045b shape: one more RLS table readable by the API roles, v_database_status closed to them; 78 tables / 155 views', async () => {
  const c = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views,
    (select count(*) from pg_proc where proname = any($1) and pronamespace = 'public'::regnamespace)::int as functions`, [[...STAGED_FUNCTIONS, ...SERVING_FUNCTIONS]])
  assert.deepEqual(c, { tables: 78, views: 155, functions: 8 })
  const t = await one(`select relrowsecurity as rls, has_table_privilege('anon', oid, 'SELECT') as a, has_table_privilege('authenticated', oid, 'SELECT') as b,
      has_table_privilege('anon', oid, 'INSERT') or has_table_privilege('anon', oid, 'UPDATE') or has_table_privilege('anon', oid, 'DELETE')
        or has_table_privilege('authenticated', oid, 'INSERT') or has_table_privilege('authenticated', oid, 'UPDATE') or has_table_privilege('authenticated', oid, 'DELETE') as api_write,
      has_table_privilege('public', oid, 'SELECT') as pub
    from pg_class where relnamespace = 'public'::regnamespace and relname = 'product_database_status'`)
  assert.deepEqual(t, { rls: true, a: true, b: true, api_write: false, pub: false })
  assert.deepEqual(await q(`select policyname, cmd from pg_policies where tablename = 'product_database_status'`), [{ policyname: 'public_read_product_database_status', cmd: 'SELECT' }])
  const v = await one(`select has_table_privilege('anon', 'public.v_database_status', 'SELECT') as a, has_table_privilege('authenticated', 'public.v_database_status', 'SELECT') as b,
      has_table_privilege('public', 'public.v_database_status', 'SELECT') as p`)
  assert.deepEqual(v, { a: false, b: false, p: false })
  assert.equal(ALL_SNAPSHOT_TABLES.length, 11)
  assert.ok(ALL_INTERNAL_VIEWS.includes('v_database_status'))
})

test('SEMANTIC EQUIVALENCE: the snapshot equals v_database_status exactly - same columns, types, values, one row - and describes the executive snapshot\'s generation', async () => {
  const cols = (await q(`select attname, format_type(atttypid, atttypmod) as t from pg_attribute where attrelid = 'public.v_database_status'::regclass and attnum > 0 and not attisdropped order by attnum`))
  assert.equal(cols.length, 26)
  const snapCols = (await q(`select attname, format_type(atttypid, atttypmod) as t from pg_attribute where attrelid = 'public.product_database_status'::regclass and attnum > 0 and not attisdropped order by attnum`))
  assert.deepEqual(snapCols.map((c) => c.attname).slice(0, 5), ['generation_id', 'generated_at', 'source_data_as_of_date', 'product_version', 'schema_version'])
  assert.deepEqual(snapCols.slice(5), cols)
  const eq = await one(`select (select count(*) from public.product_database_status)::int as snapshot_rows,
    (select count(*) from (select to_jsonb(s) as j from public.v_database_status s except all
       select to_jsonb(t) - array['generation_id', 'generated_at', 'source_data_as_of_date', 'product_version', 'schema_version']::text[] from public.product_database_status t) a)::int as missing,
    (select count(*) from (select to_jsonb(t) - array['generation_id', 'generated_at', 'source_data_as_of_date', 'product_version', 'schema_version']::text[] from public.product_database_status t
       except all select to_jsonb(s) from public.v_database_status s) b)::int as extra`)
  assert.deepEqual(eq, { snapshot_rows: 1, missing: 0, extra: 0 })
  const meta = await one(`select s.generation_id = e.generation_id as same_generation, s.generated_at = e.generated_at as same_time, s.source_data_as_of_date = e.source_data_as_of_date as same_as_of,
      s.product_version = e.product_version and s.schema_version = e.schema_version as same_version, s.source_data_as_of_date is not null as has_as_of,
      s.tracked_signings = e.dodgers_signings as same_count
    from public.product_database_status s cross join public.product_executive_snapshot e`)
  assert.deepEqual(meta, { same_generation: true, same_time: true, same_as_of: true, same_version: true, has_as_of: true, same_count: true })
  // no metric changed: the known 220 / 93 / 48 / 117377237.33 of production are the canonical build's values too
  const s = await one(`select tracked_signings, outcome_audits_completed, signings_with_known_cost, known_acquisition_cost_usd::text as cost from public.product_database_status`)
  assert.deepEqual(s, { tracked_signings: 220, outcome_audits_completed: 93, signings_with_known_cost: 48, cost: '117377237.33' })
  assert.deepEqual(await drift(), [])
})

test('045b writes the generation: migrating an existing 045a database advances it once, and every one of the eleven snapshots carries it', async () => {
  const g = (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g
  assert.equal(g, before045b.generation + 1)
  for (const t of ALL_SNAPSHOT_TABLES) assert.equal((await one(`select count(*) filter (where generation_id <> $1)::int as n from public.${t}`, [g])).n, 0, t)
})

test('nothing else changes: no existing view definition, ACL, policy or other function; only the refresh / drift functions, the contract and v_database_status\'s ACL', async () => {
  const after = await catalog()
  const byName = (rows, key) => Object.fromEntries(rows.map((r) => [r[key], r]))
  const bv = byName(before045b.catalog.views, 'relname')
  const av = byName(after.views, 'relname')
  assert.deepEqual(Object.keys(av), Object.keys(bv))
  for (const k of Object.keys(av)) {
    assert.equal(av[k].d, bv[k].d, `${k} definition`)
    if (k !== 'v_database_status') assert.equal(av[k].acl, bv[k].acl, `${k} ACL`)
  }
  assert.notEqual(av.v_database_status.acl, bv.v_database_status.acl)
  const bf = byName(before045b.catalog.functions, 'f')
  const af = byName(after.functions, 'f')
  assert.deepEqual(Object.keys(af), Object.keys(bf))
  const changed = Object.keys(af).filter((k) => af[k].h !== bf[k].h || af[k].acl !== bf[k].acl).sort()
  assert.deepEqual(changed, ['disi_product_snapshot_drift()', 'disi_refresh_product_snapshots()'])
  const bt = byName(before045b.catalog.tables, 'relname')
  for (const t of after.tables) if (t.relname !== 'product_database_status') assert.deepEqual(t, bt[t.relname], t.relname)
  assert.deepEqual(after.policies.filter((p) => p.tablename !== 'product_database_status'), before045b.catalog.policies)
  const hashes = await tableHashes()
  const moved = Object.keys(before045b.hashes).filter((t) => hashes[t] !== before045b.hashes[t]).sort()
  // the ten snapshots are regenerated (generation + timestamps) and the contract swaps one relation; no research table changes
  assert.deepEqual(moved.filter((t) => !t.startsWith('product_') && t !== 'disi_product_contract'), [])
})

test('refresh: one transaction writes all eleven snapshots in a new generation; a stale snapshot is reported by the drift check and repaired by the refresh', async () => {
  await scratch(async () => {
    const rows = await q(`select snapshot, row_count from public.disi_refresh_product_snapshots()`)
    assert.deepEqual(rows.map((r) => r.snapshot), ALL_SNAPSHOT_TABLES)
    assert.equal(rows.at(-1).row_count, 1)
    const g = (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g
    assert.equal(g, before045b.generation + 2)
    assert.equal((await one(`select generation_id::int as g from product_database_status`)).g, g)
    assert.deepEqual(await drift(), [])
  })
  await scratch(async () => {
    await chain.db.exec(`update product_database_status set tracked_signings = tracked_signings + 1`)
    assert.deepEqual(await drift(), [{ snapshot: 'product_database_status', n: 2 }])
    await q(`select * from public.disi_refresh_product_snapshots()`)
    assert.deepEqual(await drift(), [])
  })
})

test('refresh validation: a status snapshot that disagrees with the executive snapshot is refused and the previous generation stays', async () => {
  const fn = (await one(`select pg_get_functiondef('public.disi_refresh_product_snapshots()'::regprocedure) as d`)).d
  assert.match(fn, /status snapshot is not one row/)
  assert.match(fn, /status snapshot disagrees with the executive snapshot/)
  // a trigger corrupts the status row as the refresh writes it: the validation refuses the whole generation
  await chain.db.exec('begin;')
  try {
    await chain.db.exec(`create function pg_temp.corrupt() returns trigger language plpgsql as $f$ begin new.tracked_signings := new.tracked_signings + 1; return new; end $f$;
      create trigger zz_corrupt before insert on public.product_database_status for each row execute function pg_temp.corrupt();`)
    await assert.rejects(q(`select * from public.disi_refresh_product_snapshots()`), /status snapshot disagrees with the executive snapshot/)
  } finally { await chain.db.exec('rollback;') }
  const g = (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g
  assert.equal(g, before045b.generation + 1)
})

test('API boundary: anon / authenticated read the snapshot and cannot write it, read the internal source or run the serving functions', async () => {
  for (const role of ['anon', 'authenticated']) {
    const r = await asRole(role, `select tracked_signings, open_research_tasks, generated_at from public.product_database_status`)
    assert.equal(r.rows.length, 1)
    assert.ok(await denied(role, `select * from public.v_database_status`), `${role} v_database_status`)
    assert.ok(await denied(role, `insert into public.product_database_status select * from public.product_database_status`), `${role} insert`)
    assert.ok(await denied(role, `update public.product_database_status set tracked_signings = 0`), `${role} update`)
    assert.ok(await denied(role, `delete from public.product_database_status`), `${role} delete`)
    assert.ok(await denied(role, `truncate public.product_database_status`), `${role} truncate`)
    assert.ok(await denied(role, `select * from public.disi_refresh_product_snapshots()`), `${role} refresh`)
    assert.ok(await denied(role, `select * from public.disi_product_snapshot_drift()`), `${role} drift`)
  }
  const fns = await q(`select proname, prosecdef as secdef, has_function_privilege('public', oid, 'EXECUTE') or has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('authenticated', oid, 'EXECUTE') as api
    from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1) order by 1`, [[...STAGED_FUNCTIONS, ...SERVING_FUNCTIONS]])
  assert.equal(fns.length, 8)
  for (const f of fns) assert.deepEqual([f.secdef, f.api], [false, false], f.proname)
  // 045b adds no API-executable function: the set the API roles can run is the one 045a left (pure helpers only)
  const exec = async (cat) => cat.functions.filter((f) => /anon|authenticated|=X/.test(f.acl) || f.acl === '').map((f) => f.f)
  assert.deepEqual(await exec(await catalog()), await exec(before045b.catalog))
})

test('a request never evaluates v_database_status: the snapshot read is one scan of the persisted table, with no function or view stack', async () => {
  const plan = (await q(`explain (format json) select * from public.product_database_status`))[0]['QUERY PLAN']
  const text = JSON.stringify(plan)
  assert.match(text, /"Relation Name":\s*"product_database_status"/)
  assert.doesNotMatch(text, /Function Scan|v_database_status|v_signing_records|v_research_tasks/)
  const rels = [...text.matchAll(/"Relation Name":\s*"(\w+)"/g)].map((m) => m[1])
  assert.deepEqual([...new Set(rels)], ['product_database_status'])
})

test('product contract: the snapshot replaces the view; exactly the relations the application reads, each existing and readable', async () => {
  const files = ['lib/data.js', ...fs.readdirSync(path.join(root, 'app'), { recursive: true }).filter((f) => String(f).endsWith('.js')).map((f) => path.join('app', String(f)))]
  const reads = new Set()
  for (const f of files) for (const m of fs.readFileSync(path.join(root, f), 'utf8').matchAll(/\.from\('([a-z_0-9]+)'\)/g)) reads.add(m[1])
  // 054 adds the player's transaction stream (v_player_career_transactions) to the contract; this chain predates it
  reads.delete('v_player_career_transactions')
  const contract = (await q(`select relation_name from disi_product_contract order by 1`)).map((r) => r.relation_name)
  assert.deepEqual(contract, [...reads].sort())
  assert.equal(contract.length, 47)
  assert.ok(reads.has('product_database_status'))
  assert.ok(!reads.has('v_database_status'))
  assert.deepEqual(contract.filter((r) => ALL_INTERNAL_VIEWS.includes(r)), [])
  const row = await one(`select relation_kind, product_area, contract_tier, app_routes, introduced_in from disi_product_contract where relation_name = 'product_database_status'`)
  assert.deepEqual(row, { relation_kind: 'TABLE', product_area: 'EXECUTIVE', contract_tier: 'EXECUTIVE', app_routes: ['/'], introduced_in: '045b' })
  const status = await one(`select product_contract_relations::int as n from product_executive_snapshot`)
  assert.equal(status.n, 47)
})

test('the application home read: getHomeData reads product_database_status and nothing in lib or app names v_database_status', () => {
  const data = fs.readFileSync(path.join(root, 'lib/data.js'), 'utf8')
  assert.match(data, /\.from\('product_database_status'\)\.select\('\*'\)\.maybeSingle\(\)/)
  const files = ['lib/data.js', ...fs.readdirSync(path.join(root, 'app'), { recursive: true }).filter((f) => String(f).endsWith('.js')).map((f) => path.join('app', String(f)))]
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\/.*$/gm, ''), /v_database_status/, f)
})

test('verifier: the four snapshot checks cover the eleventh snapshot; the full verifier passes on 001-045b; each check catches its own drift', async () => {
  const failing = async () => {
    const out = []
    for (const [name, sql] of Object.entries(productSnapshotQueries(true, true))) if ((await one(sql)).n !== 0) out.push(name)
    return out.sort()
  }
  assert.deepEqual(await failing(), [])
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 258)
  await scratch(async () => {
    await chain.db.exec(`grant select on public.v_database_status to anon`)
    assert.deepEqual(await failing(), ['product_snapshot_api_violations'])
  })
  await scratch(async () => {
    await chain.db.exec(`update product_database_status set open_research_tasks = open_research_tasks + 1`)
    assert.deepEqual(await failing(), ['product_snapshot_drift_violations'])
  })
  await scratch(async () => {
    await chain.db.exec(`update product_database_status set generation_id = generation_id + 1`)
    assert.deepEqual(await failing(), ['product_snapshot_generation_violations'])
  })
  await scratch(async () => {
    await chain.db.exec(`delete from product_database_status`)
    assert.ok((await failing()).includes('product_snapshot_generation_violations') || (await failing()).includes('product_snapshot_drift_violations'))
  })
})

test('rerun: 045b is idempotent - no new generation, no data, definition, ACL or policy change', async () => {
  const hashes = await tableHashes()
  const cat = await catalog()
  await chain.db.exec(sql045b)
  assert.deepEqual(await tableHashes(), hashes)
  assert.deepEqual(await catalog(), cat)
})

test('reproducible: the committed SQL is the build output, and the 045a build is unchanged by the refactor', () => {
  assert.equal(assemble(), sql045b.replace(/\r\n/g, '\n'))
  const sha = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, f))).digest('hex')
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const before = sha('database/sql/045a_product_snapshot_serving.sql')
  execFileSync(process.execPath, [path.join(root, 'database/research/045a/build.mjs')], { cwd: root, stdio: 'pipe' })
  assert.equal(sha('database/sql/045a_product_snapshot_serving.sql'), before)
  assert.equal(before, frozen['045a_product_snapshot_serving.sql'])
})

test('forward-only: 045b creates one table, re-issues only the refresh / drift functions, writes only its snapshot tables and the contract, and touches no research data', () => {
  const code = sql045b.replace(/--.*$/gm, '')
  assert.doesNotMatch(code, /\bdrop (table|view|column|function)\b/i)
  assert.doesNotMatch(code, /\balter (view|function)\b/i)
  assert.doesNotMatch(code, /\btruncate\b/i)
  assert.deepEqual([...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]), ['product_database_status'])
  assert.deepEqual([...code.matchAll(/create or replace function public\.(\w+)/g)].map((m) => m[1]), ['disi_refresh_product_snapshots', 'disi_product_snapshot_drift'])
  assert.deepEqual([...code.matchAll(/create or replace view/g)], [])
  for (const m of code.matchAll(/\balter table public\.(\w+)/gi)) assert.equal(m[1], 'product_database_status')
  for (const m of code.matchAll(/^\s*(?:delete from|insert into|update) public\.(\w+)/gim)) assert.ok([...ALL_SNAPSHOT_TABLES, 'disi_product_contract'].includes(m[1]), m[1])
})

test('rollback-045b: returns the 045a state exactly - table gone, 045a function bodies restored, contract and v_database_status grant restored', async () => {
  const rollback = fs.readFileSync(path.join(root, 'database/release/sql/rollback-045b.sql'), 'utf8')
  await chain.db.exec(rollback)
  const after = await catalog()
  assert.deepEqual(after.views, before045b.catalog.views)
  assert.deepEqual(after.functions, before045b.catalog.functions)
  assert.deepEqual(after.tables, before045b.catalog.tables)
  assert.deepEqual(after.policies, before045b.catalog.policies)
  const hashes = await tableHashes()
  assert.deepEqual(Object.keys(hashes), Object.keys(before045b.hashes))
  // the contract is the same set of rows (only created_at of the restored v_database_status row is new)
  assert.deepEqual((await q(`select relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in from disi_product_contract order by 1`)).map((r) => r.relation_name),
    before045b.contract.map((r) => r.relation_name))
  assert.deepEqual(await q(`select relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in from disi_product_contract order by 1`), before045b.contract)
  assert.equal((await one(`select count(*)::int as n from pg_class where relname = 'product_database_status'`)).n, 0)
})
