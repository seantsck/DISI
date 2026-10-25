// Independent validation of migration 054a (development research-queue performance) on a disposable, real PostgreSQL 17 server
// (embedded-postgres, scratchpad only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-054, frozen;
// 051 added no migration), tcand = the candidate (default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-054a.mjs <work-dir>     (run-054a.sh prepares the work dir)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const WORK = path.resolve(process.argv[2])
const req = createRequire(path.join(WORK, 'deps', 'package.json'))
const { default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve('embedded-postgres')).href)
const { default: pg } = await import(pathToFileURL(req.resolve('pg')).href)
const TBASE = path.join(WORK, 'tbase'), TC = path.join(WORK, 'tcand')
const port = 54000 + Math.floor(Math.random() * 900)
const dataDir = path.join(WORK, 'pgdata-' + port)
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`) }

const FILE = '054a_development_queue_performance.sql'
const ROLLBACK = 'database/release/sql/rollback-054a.sql'
const QUEUE = 'v_dodgers_development_research_queue'
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
// the research queue without its surrogate player id: the production value, read-only on 2026-10-25 (128 rows)
const QUEUE_ROWS = `select count(*)::int as n, md5(string_agg(md5(r), '' order by md5(r))) as h from (select concat_ws('|', player_slug, full_name, mlb_id, signing_year,
  issue, priority, detail) as r from public.${QUEUE}) x`
const EXPECTED_QUEUE = { n: 128, h: '081f8efb25d47334b3727bcfd32149a1' }
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} })
await server.initialise()
await server.start()
const connect = async (db) => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: db }); c.on('error', () => {}); await c.connect(); return c }
const sqlFiles = (root) => JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8')).canonical_sql
const readSql = (root, f) => fs.readFileSync(path.join(root, 'database/sql', f), 'utf8')
async function freshDb(name) {
  const admin = await connect('postgres'); await admin.query(`create database ${name}`); await admin.end()
  const c = await connect(name)
  await c.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$`)
  return c
}
const copyDb = async (from, to) => { const admin = await connect('postgres'); await admin.query(`create database ${to} template ${from}`); await admin.end() }
async function apply(c, root, files) { for (const f of files) { try { await c.query(readSql(root, f)) } catch (e) { throw new Error(`${f}: ${e.message}`) } } }
const rowsOf = async (c, sql, params) => (await c.query(sql, params)).rows
const q = (c) => async (sql, params) => rowsOf(c, sql, params)
async function contentHashes(c) {
  const tables = (await rowsOf(c, `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) {
    const rows = (await rowsOf(c, `select to_jsonb(t)::text as r from public.${pg.escapeIdentifier(t)} t`)).map((r) => r.r).sort()
    out[t] = { n: rows.length, h: md5(rows) }
  }
  return out
}
const catalog = async (c) => ({
  views: Object.fromEntries((await rowsOf(c, `select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).map((r) => [r.relname, r.d])),
  rels: await rowsOf(c, `select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts,
      coalesce(obj_description(oid, 'pg_class'), '') as note, relowner::regrole::text as owner
    from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'i', 'S') order by 1`),
  cols: await rowsOf(c, `select table_name, column_name, data_type, ordinal_position from information_schema.columns where table_schema = 'public' order by 1, 4`),
  pol: await rowsOf(c, `select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`),
  fnsig: await rowsOf(c, `select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') as cfg from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  fnbody: Object.fromEntries((await rowsOf(c, `select p.oid::regprocedure::text as f, md5(p.prosrc) as h from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)).map((r) => [r.f, r.h])),
  trg: await rowsOf(c, `select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
  enums: await rowsOf(c, `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as v from pg_enum e join pg_type t on t.oid = e.enumtypid group by 1 order by 1`),
})
const inRole = async (c, role, sql) => {
  await c.query('begin'); try { await c.query(`set local role ${role}`); await c.query('savepoint s'); try { await c.query(sql); return 'ALLOWED' } catch (e) { return e.code } } finally { await c.query('rollback') }
}
// who can read and write the research queue: SELECT for both API roles, no write privilege, and a write attempt refused (a view that is not
// automatically updatable refuses with 55000 before any privilege is consulted)
async function access(c) {
  const attempts = [['anon', `select 1 from public.${QUEUE} limit 1`], ['authenticated', `select 1 from public.${QUEUE} limit 1`],
    ['anon', `delete from public.${QUEUE}`], ['authenticated', `update public.${QUEUE} set detail = 'x'`], ['anon', `insert into public.${QUEUE} (issue) values ('x')`]]
  const outcome = []
  for (const [role, stmt] of attempts) outcome.push(await inRole(c, role, stmt))
  const priv = await rowsOf(c, `select r as role, has_table_privilege(r, 'public.${QUEUE}', 'SELECT') as select,
      has_table_privilege(r, 'public.${QUEUE}', 'INSERT') or has_table_privilege(r, 'public.${QUEUE}', 'UPDATE') or has_table_privilege(r, 'public.${QUEUE}', 'DELETE')
        or has_table_privilege(r, 'public.${QUEUE}', 'TRUNCATE') as write from unnest(array['anon', 'authenticated']) r order by 1`)
  return { outcome, priv }
}
const drift = (c) => rowsOf(c, `select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)
const generations = async (c) => Promise.all(SNAP.map(async (t) => (await rowsOf(c, `select coalesce(array_agg(distinct generation_id), '{}') as g from public.${t}`))[0].g.map(Number)))
const queueRows = async (c) => (await rowsOf(c, `select x::text as r from public.${QUEUE} x`)).map((r) => r.r).sort()
// N visitors read the queue at once as anon, with the hosted anon timeout and work_mem; returns each read's wall time or its error code
async function visitors(db, n, rounds = 3) {
  const clients = await Promise.all(Array.from({ length: n }, () => connect(db)))
  const out = []
  try {
    for (const c of clients) await c.query(`set role anon; set statement_timeout = '3s'; set work_mem = '2MB'`)
    for (let r = 0; r < rounds; r++) {
      out.push(...await Promise.all(clients.map(async (c) => {
        const t = Date.now()
        try { await c.query(`select * from public.${QUEUE}`); return Date.now() - t } catch (e) { return e.code }
      })))
    }
  } finally { await Promise.all(clients.map((c) => c.end())) }
  return out
}
const summary = (xs) => { const ms = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b); return { reads: xs.length, errors: xs.length - ms.length, median: ms[Math.floor(ms.length / 2)], max: ms.at(-1) } }
const planOf = async (c) => {
  await c.query('begin')
  try {
    await c.query(`set local role anon; set local work_mem = '2MB'`)
    const p = (await rowsOf(c, `explain (analyze, buffers, memory, timing off, summary on, costs off, format json) select * from public.${QUEUE}`))[0]['QUERY PLAN'][0]
    const json = JSON.stringify(p)
    return { exec: p['Execution Time'], planning: p['Planning Time'], planMemKb: p.Planning?.['Memory Used'], temp: p.Plan['Temp Read Blocks'] ?? 0, cte: /"CTE Name":"team_stints"/.test(json), index: /player_season_stints_player_idx/.test(json) }
  } finally { await c.query('rollback') }
}

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 054 (57 files; 051 added no migration)', base.length === 57 && base.at(-1) === '054_full_career_transaction_history.sql')
  check('candidate manifest = baseline + 054a (58 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-054 are byte-identical between the baseline and the candidate and match the frozen hashes (57 entries; 054a is not frozen)', frozenOk && Object.keys(frozen).length === 57 && !(FILE in frozen))
  const rb054 = 'database/release/sql/rollback-054.sql'
  check('rollback-054 is byte-identical between the baseline and the candidate', fs.readFileSync(path.join(TBASE, rb054), 'utf8') === fs.readFileSync(path.join(TC, rb054), 'utf8'))
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  sha1(LF) ${sha1(sql.replace(/\r\n/g, '\n'))}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-054a.sql: sha256 ${sha256(rbSql)}  ${Buffer.byteLength(rbSql)} bytes`)
  const body = sql.replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
  const views = [...body.matchAll(/create or replace view (\S+)/gi)].map((m) => m[1])
  check('054a: no CRLF; one transaction; the only public DDL is the research-queue view; no write, grant, refresh, table, index, function, policy or trigger',
    !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql) && JSON.stringify(views) === JSON.stringify([`public.${QUEUE}`])
      && !/\b(insert into|update\s+public|delete from|truncate|alter|grant|revoke|create (table|index|function|policy|trigger|type))\b/i.test(body.replace(/create temporary table _m054a_before[^;]*;/, ''))
      && !/disi_refresh_product_snapshots/.test(body), views.join(','))
  const plan = fs.readFileSync(path.join(TC, 'database/release/054a-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)))

  // --- A: the released 001-054 (the production state), then 054a
  const A0 = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A0, TBASE, base)
  console.log(`  001-054 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await A0.end()
  await copyDb('disi_a', 'disi_pre')
  const A = await connect('disi_a')
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { checkInvariants, failedChecks } = inv
  const pre = await checkInvariants(q(A)); const fpre = failedChecks(pre)
  check(`the HEAD verifier on the PRE-054a state (production today) passes ${pre.hard.length - fpre.length}/${pre.hard.length}: 054a moves no pin`, fpre.length === 0 && pre.hard.length === 258, fpre.map((x) => x.name).join(', '))
  const S0 = { cat: await catalog(A), full: await contentHashes(A), gen: await generations(A), rows: await queueRows(A), pinned: (await rowsOf(A, QUEUE_ROWS))[0] }
  check('the pre-054a queue is the production queue (128 rows, the production row hash)', md5(S0.pinned) === md5(EXPECTED_QUEUE), JSON.stringify(S0.pinned))
  const P0 = await planOf(A)
  const access0 = await access(A)
  const secdef0 = (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), full: await contentHashes(A), gen: await generations(A), rows: await queueRows(A), pinned: (await rowsOf(A, QUEUE_ROWS))[0] }
  check(`054a applies in one transaction (${ms} ms)`, true)
  const viewChanged = Object.keys(S1.cat.views).filter((v) => S1.cat.views[v] !== S0.cat.views[v])
  check('additivity: exactly one view definition changes (the research queue); every relation, column, ACL, RLS flag, option, comment, owner, policy, trigger, enum and function is identical',
    JSON.stringify(viewChanged) === JSON.stringify([QUEUE]) && JSON.stringify(Object.keys(S1.cat.views)) === JSON.stringify(Object.keys(S0.cat.views))
      && md5([S1.cat.rels, S1.cat.cols, S1.cat.pol, S1.cat.fnsig, S1.cat.fnbody, S1.cat.trg, S1.cat.enums]) === md5([S0.cat.rels, S0.cat.cols, S0.cat.pol, S0.cat.fnsig, S0.cat.fnbody, S0.cat.trg, S0.cat.enums]), viewChanged.join(','))
  const d0 = S0.cat.views[QUEUE], d1 = S1.cat.views[QUEUE]
  check('the definition delta is exactly team_stints AS NOT MATERIALIZED (progression untouched)',
    d1 === d0.replace('team_stints AS (', 'team_stints AS NOT MATERIALIZED (') && d1 !== d0 && (d1.match(/MATERIALIZED/g) ?? []).length === 1 && /progression AS \(/.test(d1))
  const changed = Object.keys(S1.full).filter((t) => S1.full[t].h !== S0.full[t]?.h)
  check('every table, the snapshots included, is byte-identical (no row written)', changed.length === 0 && Object.keys(S1.full).length === Object.keys(S0.full).length, changed.join(','))
  check('no snapshot refresh: the same single generation everywhere, zero drift', md5(S1.gen) === md5(S0.gen) && S1.gen.every((g) => g.length === 1) && (await drift(A)).length === 0, JSON.stringify(S1.gen[0]))
  check('the queue returns the same 128 rows (whole-row multiset and the production row hash)', md5(S1.rows) === md5(S0.rows) && S1.rows.length === 128 && md5(S1.pinned) === md5(EXPECTED_QUEUE))
  const post = await checkInvariants(q(A)); const fpost = failedChecks(post)
  check(`HEAD verifier after 054a: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 258, fpost.map((x) => x.name).join(', '))
  const P1 = await planOf(A)
  console.log(`  plan as anon (work_mem 2MB): before ${JSON.stringify(P0)}  after ${JSON.stringify(P1)}`)
  check('the plan no longer materializes team_stints and reads player_season_stints_player_idx', P0.cte && !P1.cte && P1.index && P1.temp === 0, `temp ${P0.temp} -> ${P1.temp}`)
  check('planning memory stays modest (under 64 MB)', typeof P1.planMemKb === 'number' && P1.planMemKb < 65536, `${P0.planMemKb} kB -> ${P1.planMemKb} kB`)
  await apply(A, TC, [FILE])
  check('054a exact idempotency (every row, definition, ACL, policy, function; no refresh)', md5({ cat: await catalog(A), full: await contentHashes(A) }) === md5({ cat: S1.cat, full: S1.full }))
  const access1 = await access(A)
  check('anon and authenticated read the queue, hold no write privilege, and every write is refused, exactly as before 054a',
    md5(access1) === md5(access0) && access1.outcome[0] === 'ALLOWED' && access1.outcome[1] === 'ALLOWED' && access1.outcome.slice(2).every((x) => x !== 'ALLOWED')
      && access1.priv.every((r) => r.select && !r.write), JSON.stringify(access1))
  check(`no SECURITY DEFINER function was added (${secdef0} before, the same after)`, (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n === secdef0)
  await A.end()

  // --- concurrency: four anon visitors at once, the hosted anon timeout (3 s) and work_mem (2 MB); local timings do not predict the hosted instance
  const before4 = summary(await visitors('disi_pre', 4))
  const after4 = summary(await visitors('disi_a', 4))
  console.log(`  4 concurrent anon visitors x 3 rounds: before ${JSON.stringify(before4)}  after ${JSON.stringify(after4)}`)
  check('four concurrent anon visitors: no read times out after 054a, and the median read is faster than before', after4.errors === 0 && after4.median < before4.median, `${before4.median} ms -> ${after4.median} ms`)

  // --- B: rollback on a copy of the post-054a state
  await copyDb('disi_a', 'disi_b')
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  check(`rollback-054a commits in one transaction (${rms} ms)`, true)
  const SB = { cat: await catalog(B), full: await contentHashes(B), gen: await generations(B), rows: await queueRows(B) }
  check('after rollback the catalog equals the pre-054a state exactly (the 054 research-queue definition included)', md5(SB.cat) === md5(S0.cat))
  check('after rollback every table equals the pre-054a state and the queue returns the same rows; no refresh', md5(SB.full) === md5(S0.full) && md5(SB.gen) === md5(S0.gen) && md5(SB.rows) === md5(S0.rows) && (await drift(B)).length === 0)
  let again = ''
  try { await B.query(rbSql) } catch (e) { again = e.message; await B.query('rollback').catch(() => {}) }
  check('a second rollback refuses (054a is no longer applied)', /rollback-054a: v_dodgers_development_research_queue is not the 054a definition/.test(again), again.slice(0, 100))
  const rv = await checkInvariants(q(B)); const frv = failedChecks(rv)
  check(`the verifier after rollback: ${rv.hard.length - frv.length}/${rv.hard.length}`, frv.length === 0 && rv.hard.length === 258, frv.map((x) => x.name).join(', '))
  await apply(B, TC, [FILE])
  check('reapplying 054a after its rollback reproduces the 054a state exactly', md5({ cat: await catalog(B), full: await contentHashes(B) }) === md5({ cat: S1.cat, full: S1.full }))
  // the guard: another predecessor definition is refused (back to 054, then the 054 text with progression inlined instead)
  await B.query(rbSql)
  const alt = d0.replace('progression AS (', 'progression AS NOT MATERIALIZED (')
  await B.query(`create or replace view public.${QUEUE} with (security_invoker = true) as ${alt}`)
  let refused = ''
  try { await B.query(sql) } catch (e) { refused = e.message; await B.query('rollback').catch(() => {}) }
  check('the guard refuses an unexpected predecessor definition (054 with progression inlined instead)', /054a: v_dodgers_development_research_queue is not the 054 definition/.test(refused), refused.slice(0, 100))
  await B.end()
} catch (e) {
  check('validator ran to completion', false, e.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
