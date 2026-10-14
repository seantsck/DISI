// Independent validation of the 042-045 bundle on a disposable, real PostgreSQL 17 server (embedded-postgres, scratchpad only).
// Sources come from git archives: tbase = the released baseline (BASELINE, default origin/main, 001-041), tcand = the bundle candidate
// (CANDIDATE, default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-042-045.mjs <work-dir>     (run-042-045.sh prepares the work dir)
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
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

const BUNDLE = ['042_expected_organizational_value.sql', '043_portfolio_decision_engine.sql', '044_executive_product.sql', '045_final_integration_release.sql']
const NEW_TABLES = ['disi_product_contract', 'expected_value_models', 'portfolio_scenario_definitions']
const NEW_TABLE_ROWS = { disi_product_contract: 48, expected_value_models: 1, portfolio_scenario_definitions: 4 }
const NEW_VIEWS = {
  '042_expected_organizational_value.sql': ['v_expected_value_research_queue', 'v_expected_value_support', 'v_historical_org_value_distribution', 'v_player_expected_organizational_value', 'v_player_realized_organizational_value'],
  '043_portfolio_decision_engine.sql': ['v_historical_portfolio_summary', 'v_portfolio_candidate_readiness', 'v_portfolio_decision_support', 'v_portfolio_research_queue', 'v_portfolio_scenario_evaluation'],
  '044_executive_product.sql': ['v_executive_overview', 'v_prediction_readiness'],
  '045_final_integration_release.sql': ['v_disi_release_status', 'v_executive_metric_provenance', 'v_research_roadmap'],
}
const REDEFINES = {}
const ALL_NEW_VIEWS = Object.values(NEW_VIEWS).flat().sort()

const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} })
await server.initialise()
await server.start()
const connect = async (db) => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: db }); c.on('error', () => {}); await c.connect(); return c }
const sqlFiles = (root) => JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8')).canonical_sql
const readSql = (root, f) => fs.readFileSync(path.join(root, 'database/sql', f), 'utf8')

async function freshDb(name) {
  const admin = await connect('postgres')
  await admin.query(`create database ${name}`)
  await admin.end()
  const c = await connect(name)
  await c.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  end $$`)
  return c
}
async function apply(c, root, files) {
  for (const f of files) {
    try { await c.query(readSql(root, f)) } catch (e) { throw new Error(`${f}: ${e.message}`) }
  }
}
async function contentHashes(c, { stable }) {
  const tables = (await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).rows.map((r) => r.relname)
  const out = {}
  for (const t of tables) {
    const cols = (await c.query(`select attname, format_type(atttypid, atttypmod) as ty from pg_attribute where attrelid = ('public.' || quote_ident($1))::regclass and attnum > 0 and not attisdropped order by attnum`, [t])).rows
    const keep = stable ? cols.filter((x) => !/^(uuid|timestamp with time zone|uuid\[\])$/.test(x.ty) && !/^(id|created_at|updated_at)$/.test(x.attname)) : cols
    const list = keep.map((x) => `t.${pg.escapeIdentifier(x.attname)}`).join(', ') || `1`
    const rows = (await c.query(`select (${list})::text as r from public.${pg.escapeIdentifier(t)} t`)).rows.map((r) => r.r).sort()
    out[t] = { n: rows.length, h: md5(rows) }
  }
  return out
}
// the output of every bundle view, without generated-id columns (ids differ between two independent replays)
async function viewOutputs(c) {
  const out = {}
  for (const v of ALL_NEW_VIEWS) {
    const cols = (await c.query(`select attname, format_type(atttypid, atttypmod) as ty from pg_attribute where attrelid = ('public.' || quote_ident($1))::regclass and attnum > 0 and not attisdropped order by attnum`, [v])).rows
    const keep = cols.filter((x) => !/^(uuid|uuid\[\])$/.test(x.ty))
    const rows = (await c.query(`select (${keep.map((x) => `t.${pg.escapeIdentifier(x.attname)}`).join(', ')})::text as r from public.${pg.escapeIdentifier(v)} t`)).rows.map((r) => r.r).sort()
    out[v] = { n: rows.length, h: md5(rows) }
  }
  return out
}
const viewDefs = async (c) => Object.fromEntries((await c.query(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).rows.map((r) => [r.relname, r.d]))
const acls = async (c) => (await c.query(`select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','v','m') order by 1`)).rows
const policies = async (c) => (await c.query(`select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`)).rows
const functions = async (c) => (await c.query(`select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text,'') as acl from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') order by 1`)).rows
const snapshot = async (c) => ({ full: await contentHashes(c, { stable: false }), views: await viewDefs(c), acls: await acls(c), pol: await policies(c), fn: await functions(c) })

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)

  // --- frozen baseline and bundle identity
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 041 (42 files)', base.length === 42 && base.at(-1) === '041_outcome_probability_infrastructure.sql')
  check('candidate manifest = baseline + 042, 043, 044, 045 in order', JSON.stringify(cand) === JSON.stringify([...base, ...BUNDLE]), cand.slice(40).join(','))
  let frozenOk = true
  for (const f of base) {
    const a = readSql(TBASE, f), b = readSql(TC, f)
    if (a !== b || sha1(a.replace(/\r\n/g, '\n')) !== frozen[f]) { frozenOk = false; console.log('  drift: ' + f) }
  }
  // every frozen entry must match the candidate's bytes
  const frozenRest = Object.keys(frozen).filter((f) => !base.includes(f))
  const restOk = frozenRest.every((f) => cand.includes(f) && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f])
  check(`001-041 byte-identical between the baseline and the candidate and frozen (${Object.keys(frozen).length} entries)`, frozenOk && restOk && base.every((f) => f in frozen) && Object.keys(frozen).length === 42, frozenRest.join(','))
  for (const f of BUNDLE) console.log(`  ${f}: sha256 ${sha256(readSql(TC, f))}  sha1(LF) ${sha1(readSql(TC, f).replace(/\r\n/g, '\n'))}  ${Buffer.byteLength(readSql(TC, f))} bytes`)
  check('bundle files have no CRLF and one transaction each', BUNDLE.every((f) => !readSql(TC, f).includes('\r') && /^begin;$/m.test(readSql(TC, f)) && /^commit;$/m.test(readSql(TC, f))))

  // --- A: the released 001-041, then 042, 043, 044, 045 (the production path)
  const A = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A, TBASE, base)
  console.log(`  001-041 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const q = (c) => async (sql, params) => (await c.query(sql, params)).rows
  const { checkInvariants: checkBase, failedChecks: failedBase } = await import(path.join(TBASE, 'scripts/db/lib/invariants.mjs'))
  const rb = await checkBase(q(A)); const fb = failedBase(rb)
  check(`baseline verifier on 001-041: ${rb.hard.length - fb.length}/${rb.hard.length}`, fb.length === 0 && rb.hard.length === 223, fb.map((x) => x.name).join(', '))

  const before = await snapshot(A)
  for (const f of BUNDLE) {
    const s0 = await snapshot(A)
    const o0 = REDEFINES[f] ? await viewOutputs(A) : null
    t0 = Date.now()
    await apply(A, TC, [f])
    if (o0) check(`${f}: every bundle view returns exactly the same rows as before (query shape only)`, JSON.stringify(await viewOutputs(A)) === JSON.stringify(o0))
    const ms = Date.now() - t0
    const s1 = await snapshot(A)
    const added = Object.keys(s1.views).filter((v) => !(v in s0.views)).sort()
    const redefined = Object.keys(s0.views).filter((v) => s0.views[v] !== s1.views[v])
    check(`${f}: applies in one transaction (${ms} ms) and adds exactly its views`, JSON.stringify(added) === JSON.stringify(NEW_VIEWS[f]), added.join(','))
    check(`${f}: redefines ${REDEFINES[f] ? 'exactly ' + REDEFINES[f].join(',') : 'no earlier view'}`, JSON.stringify(redefined) === JSON.stringify(REDEFINES[f] ?? []), redefined.join(','))
    await apply(A, TC, [f])
    const s2 = await snapshot(A)
    check(`${f}: exact idempotency (all rows incl. ids / timestamps, view definitions, ACLs, policies, functions)`, md5(s2) === md5(s1))
  }
  const after = await snapshot(A)
  const newTables = Object.keys(after.full).filter((t) => !(t in before.full)).sort()
  const changedTables = Object.keys(before.full).filter((t) => JSON.stringify(before.full[t]) !== JSON.stringify(after.full[t]))
  check(`bundle creates only ${NEW_TABLES.join(', ')} (${JSON.stringify(NEW_TABLE_ROWS)}) and writes no existing table`, JSON.stringify(newTables) === JSON.stringify(NEW_TABLES) && NEW_TABLES.every((t) => after.full[t].n === NEW_TABLE_ROWS[t]) && changedTables.length === 0, `${newTables} ${changedTables}`)
  const aclChanged = before.acls.filter((x) => JSON.stringify(x) !== JSON.stringify(after.acls.find((y) => y.relname === x.relname)))
  check('bundle changes no existing ACL / RLS / reloption, policy or function', aclChanged.length === 0 && JSON.stringify(after.fn) === JSON.stringify(before.fn)
    && JSON.stringify(after.pol.filter((p) => !NEW_TABLES.includes(p.tablename))) === JSON.stringify(before.pol), aclChanged.map((x) => x.relname).join(','))
  const newRel = after.acls.filter((x) => ALL_NEW_VIEWS.includes(x.relname) || NEW_TABLES.includes(x.relname))
  check('new relations: views security_invoker, the table RLS, anon / authenticated SELECT only, PUBLIC nothing',
    newRel.length === ALL_NEW_VIEWS.length + NEW_TABLES.length && newRel.every((x) => (x.relkind === 'v' ? /security_invoker=(true|on)/.test(x.opts) : x.rls) && /anon=r\//.test(x.acl) && /authenticated=r\//.test(x.acl) && !/(^|[{,])=/.test(x.acl)),
    newRel.filter((x) => !/anon=r\//.test(x.acl)).map((x) => x.relname).join(','))
  const counts = (await A.query(`select count(*) filter (where relkind = 'r')::int as t, count(*) filter (where relkind = 'v')::int as v,
    count(*) filter (where relkind = 'r' and not relrowsecurity)::int as no_rls,
    count(*) filter (where relkind = 'v' and not coalesce(array_to_string(reloptions, ',') ~ 'security_invoker=(true|on)', false))::int as not_invoker
    from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v')`)).rows[0]
  check('whole schema: 67 tables / 155 views, every table RLS, every view security_invoker', counts.t === 67 && counts.v === 155 && counts.no_rls === 0 && counts.not_invoker === 0, JSON.stringify(counts))

  const { checkInvariants: checkCand, failedChecks: failedCand } = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const rc = await checkCand(q(A)); const fc = failedCand(rc)
  check(`candidate verifier on 001-041 + 042 + 043 + 044 + 045: ${rc.hard.length - fc.length}/${rc.hard.length}`, fc.length === 0 && rc.hard.length === 241, fc.map((x) => x.name).join(', '))

  // release rerun safety: the whole bundle applied again on the final state is a no-op
  await apply(A, TC, BUNDLE)
  check('bundle re-applied in order on the final state is a no-op', md5(await snapshot(A)) === md5(after))

  // convergence: a fresh 001-045 replay equals the incremental path
  const B = await freshDb('disi_b')
  t0 = Date.now()
  await apply(B, TC, cand)
  console.log(`  fresh 001-045 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const [ha, hb] = [await contentHashes(A, { stable: true }), await contentHashes(B, { stable: true })]
  const diff = Object.keys({ ...ha, ...hb }).filter((t) => JSON.stringify(ha[t]) !== JSON.stringify(hb[t]))
  const [oa, ob] = [await viewOutputs(A), await viewOutputs(B)]
  const vdiff = ALL_NEW_VIEWS.filter((v) => JSON.stringify(oa[v]) !== JSON.stringify(ob[v]))
  check('convergence: fresh 001-045 = 001-041 then 042, 043, 044, 045 (table content, view definitions, ACLs, policies, functions, bundle view outputs)',
    diff.length === 0 && vdiff.length === 0 && JSON.stringify(await viewDefs(A)) === JSON.stringify(await viewDefs(B)) && JSON.stringify(await acls(A)) === JSON.stringify(await acls(B))
      && JSON.stringify(await policies(A)) === JSON.stringify(await policies(B)) && JSON.stringify(await functions(A)) === JSON.stringify(await functions(B)), [...diff, ...vdiff].join(','))
  const rf = await checkCand(q(B)); const ff = failedCand(rf)
  check(`candidate verifier on the fresh 001-045 replay: ${rf.hard.length - ff.length}/${rf.hard.length}`, ff.length === 0 && rf.hard.length === 241, ff.map((x) => x.name).join(', '))

  // anon: reads every bundle view through RLS within the Supabase anon statement timeout; cannot write the new table
  await A.query(`begin; set local role anon; set local statement_timeout = '3s'`)
  const timings = []
  let anonOk = true
  for (const v of ALL_NEW_VIEWS) {
    const s = Date.now()
    try { await A.query(`select * from public.${v}`); timings.push(`${v} ${Date.now() - s}ms`) } catch (e) { anonOk = false; timings.push(`${v} ERROR ${e.code}`) }
  }
  let anonWrite = 'blocked'
  try { await A.query(`savepoint s; insert into public.expected_value_models (value_model_key) values ('X')`); anonWrite = 'ALLOWED' } catch { await A.query('rollback to savepoint s') }
  await A.query('rollback')
  check(`anon reads all ${ALL_NEW_VIEWS.length} bundle views under RLS within 3 s; cannot write expected_value_models`, anonOk && anonWrite === 'blocked', `write ${anonWrite}`)
  console.log('  anon full-read timings (local PG17): ' + timings.join('; '))

  // rollback: the guarded logical rollback returns A to its exact 001-041 state, and the bundle re-applies afterwards
  const rollback = fs.readFileSync(path.join(TC, 'database/release/sql/rollback-042-045.sql'), 'utf8')
  await A.query(rollback)
  check('rollback-042-045.sql returns the database to its exact 001-041 state (all rows incl. ids / timestamps, views, ACLs, policies, functions)', md5(await snapshot(A)) === md5(before))
  await apply(A, TC, BUNDLE)
  const rr = await checkCand(q(A)); const fr = failedCand(rr)
  check(`bundle re-applies after a rollback: ${rr.hard.length - fr.length}/${rr.hard.length}`, fr.length === 0 && rr.hard.length === 241, fr.map((x) => x.name).join(', '))
  await A.query(`create view public.zz_dependent with (security_invoker = true) as select count(*) as n from public.v_player_realized_organizational_value`)
  let refused = false
  try { await A.query(rollback) } catch (e) { refused = /depend on it/.test(e.message); await A.query('rollback').catch(() => {}) }
  check('rollback refuses while an object outside the bundle depends on it', refused)

  await A.end(); await B.end()
} catch (e) {
  check('run', false, e.stack)
} finally {
  await server.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
}
const failedN = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failedN}/${results.length} real-PostgreSQL checks passed${failedN ? ` — ${failedN} FAILED` : ''}`)
process.exitCode = failedN ? 1 : 0
