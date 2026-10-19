// Independent validation of migration 045b (home-page status snapshot) on a disposable, real PostgreSQL 17 server (embedded-postgres,
// scratchpad only). Sources come from git archives: tbase = the released baseline (BASELINE, default origin/main: 001-045a), tcand = the
// candidate (CANDIDATE, default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-045b.mjs <work-dir>     (run-045b.sh prepares the work dir)
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

const FILE = '045b_database_status_snapshot.sql'
const ROLLBACK = 'database/release/sql/rollback-045b.sql'
const ROLLBACK_ALL = 'database/release/sql/rollback-042-045.sql'
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
async function apply(c, root, files) { for (const f of files) { try { await c.query(readSql(root, f)) } catch (e) { throw new Error(`${f}: ${e.message}`) } } }
const rowsOf = async (c, sql, params) => (await c.query(sql, params)).rows
const q = (c) => async (sql, params) => rowsOf(c, sql, params)
async function contentHashes(c, { stable }) {
  const tables = (await rowsOf(c, `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) {
    const cols = await rowsOf(c, `select attname, format_type(atttypid, atttypmod) as ty from pg_attribute where attrelid = ('public.' || quote_ident($1))::regclass and attnum > 0 and not attisdropped order by attnum`, [t])
    const keep = stable ? cols.filter((x) => !/^(uuid|timestamp with time zone|uuid\[\])$/.test(x.ty) && !/^(id|created_at|updated_at)$/.test(x.attname)) : cols
    const list = keep.map((x) => `t.${pg.escapeIdentifier(x.attname)}`).join(', ') || `1`
    const rows = (await rowsOf(c, `select (${list})::text as r from public.${pg.escapeIdentifier(t)} t`)).map((r) => r.r).sort()
    out[t] = { n: rows.length, h: md5(rows) }
  }
  return out
}
const viewDefs = async (c) => Object.fromEntries((await rowsOf(c, `select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).map((r) => [r.relname, r.d]))
const acls = (c) => rowsOf(c, `select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1`)
const policies = (c) => rowsOf(c, `select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`)
const functions = (c) => rowsOf(c, `select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text, '') as acl from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)
const catalog = async (c) => ({ views: await viewDefs(c), acls: await acls(c), pol: await policies(c), fn: await functions(c) })
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
const snapState = async (c, tables = SNAP) => {
  const out = {}
  for (const t of tables) {
    const rows = (await rowsOf(c, `select t::text as r from public.${t} t`)).map((r) => r.r).sort()
    out[t] = { n: rows.length, h: md5(rows), gens: (await rowsOf(c, `select coalesce(array_agg(distinct generation_id), '{}') as g from public.${t}`))[0].g }
  }
  return out
}
const STATUS_META = ['generation_id', 'generated_at', 'source_data_as_of_date', 'product_version', 'schema_version']
const inRole = async (c, role, sql) => {
  await c.query('begin'); try { await c.query(`set local role ${role}`); await c.query('savepoint s'); try { await c.query(sql); return 'ALLOWED' } catch (e) { return e.code } } finally { await c.query('rollback') }
}

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, reproducible build, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 045a (48 files)', base.length === 48 && base.at(-1) === '045a_product_snapshot_serving.sql')
  check('candidate manifest = baseline + 045b (49 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-045a are byte-identical between the baseline and the candidate and match the frozen hashes (48 entries)', frozenOk && Object.keys(frozen).length === 48)
  check('045a is byte-identical to its committed (frozen) version', sha1(readSql(TC, base.at(-1)).replace(/\r\n/g, '\n')) === frozen['045a_product_snapshot_serving.sql'])
  const sql = readSql(TC, FILE)
  const { assemble } = await import(pathToFileURL(path.join(TC, 'database/research/045b/build.mjs')).href)
  check('045b builder output equals the committed SQL byte for byte', assemble() === sql)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8'), rbAllSql = fs.readFileSync(path.join(TC, ROLLBACK_ALL), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-045b.sql: sha256 ${sha256(rbSql)}   rollback-042-045.sql: sha256 ${sha256(rbAllSql)}`)
  check('045b: no CRLF; one transaction', !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql))
  const plan = fs.readFileSync(path.join(TC, 'database/release/045b-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)) && plan.includes(sha256(rbAllSql)))

  // --- A: the released 001-045a (the production state), then 045b
  const A = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A, TBASE, base)
  console.log(`  001-045a replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const { checkInvariants: checkBase, failedChecks: failedBase } = await import(path.join(TBASE, 'scripts/db/lib/invariants.mjs'))
  const rb = await checkBase(q(A)); const fb = failedBase(rb)
  check(`baseline verifier on 001-045a: ${rb.hard.length - fb.length}/${rb.hard.length}`, fb.length === 0 && rb.hard.length === 247, fb.map((x) => x.name).join(', '))
  const { checkInvariants: checkCand, failedChecks: failedCand, CANONICAL_EXPECTATIONS } = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const pre = await checkCand(q(A)); const fpre = failedCand(pre)
  check('candidate verifier on the PRE-release state (production today): exactly one expected failure, public_tables_total (77 vs 78) - 246/247',
    fpre.length === 1 && fpre[0].name === 'public_tables_total' && pre.hard.length === 247, fpre.map((x) => `${x.name} ${x.actual}`).join(', '))

  const S0 = { cat: await catalog(A), full: await contentHashes(A, { stable: false }), snap: await snapState(A, SNAP.slice(0, 10)),
    contract: await rowsOf(A, `select relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in from disi_product_contract order by 1`),
    fnExec: await rowsOf(A, `select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('public', p.oid, 'EXECUTE')) order by 1`),
    secdef: await rowsOf(A, `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef order by 1`) }
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), full: await contentHashes(A, { stable: false }) }
  check(`045b applies in one transaction (${ms} ms) on the 001-045a state`, true)
  const counts = (await rowsOf(A, `select count(*) filter (where relkind = 'r')::int as t, count(*) filter (where relkind = 'v')::int as v,
    count(*) filter (where relkind = 'r' and not relrowsecurity)::int as no_rls,
    count(*) filter (where relkind = 'v' and not coalesce(array_to_string(reloptions, ',') ~ 'security_invoker=(true|on)', false))::int as not_invoker
    from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v')`))[0]
  check('whole schema: 78 tables / 155 views, every table RLS, every view security_invoker', counts.t === 78 && counts.v === 155 && counts.no_rls === 0 && counts.not_invoker === 0, JSON.stringify(counts))
  const post = await checkCand(q(A)); const fpost = failedCand(post)
  check(`candidate verifier after 045b: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 247, fpost.map((x) => x.name).join(', '))

  // exact idempotency: applying again changes nothing (rows incl. ids / timestamps, definitions, ACLs, policies, functions)
  await apply(A, TC, [FILE])
  check('045b exact idempotency (all rows incl. ids / timestamps, view definitions, ACLs, policies, functions)',
    md5({ cat: await catalog(A), full: await contentHashes(A, { stable: false }) }) === md5(S1))

  // forward-only: the only catalog differences are the new table + its policy, the two re-issued functions and v_database_status's ACL
  const viewDiff = Object.keys(S1.cat.views).filter((v) => S1.cat.views[v] !== S0.cat.views[v])
  const aclDiff = S1.cat.acls.filter((x) => JSON.stringify(x) !== JSON.stringify(S0.cat.acls.find((y) => y.relname === x.relname))).map((x) => x.relname).sort()
  const fnDiff = S1.cat.fn.filter((x) => JSON.stringify(x) !== JSON.stringify(S0.cat.fn.find((y) => y.f === x.f))).map((x) => x.f.replace('public.', '')).sort()
  const polDiff = S1.cat.pol.filter((p) => !S0.cat.pol.some((o) => JSON.stringify(o) === JSON.stringify(p)))
  check('forward-only: no view definition changes; ACL changes = v_database_status + the new table; function changes = refresh + drift; one new policy',
    viewDiff.length === 0 && JSON.stringify(aclDiff) === JSON.stringify(['product_database_status', 'v_database_status'])
    && JSON.stringify(fnDiff) === JSON.stringify(['disi_product_snapshot_drift()', 'disi_refresh_product_snapshots()'])
    && polDiff.length === 1 && polDiff[0].tablename === 'product_database_status' && S1.cat.pol.length === S0.cat.pol.length + 1,
    JSON.stringify({ viewDiff, aclDiff, fnDiff }))
  const movedTables = Object.keys(S0.full).filter((t) => JSON.stringify(S0.full[t]) !== JSON.stringify(S1.full[t])).sort()
  check('no research data changes: only the ten regenerated snapshots and the contract table differ from the 001-045a state',
    movedTables.every((t) => t.startsWith('product_') || t === 'disi_product_contract'), movedTables.join(','))

  // --- snapshot correctness
  const gens = await snapState(A)
  const allGen = [...new Set(Object.values(gens).flatMap((x) => x.gens))]
  const g0 = Math.max(...Object.values(S0.snap).flatMap((x) => x.gens.map(Number)))
  check(`all 11 snapshot tables carry one generation (${allGen.join(',')}), which is the previous generation + 1 (${g0}+1)`, allGen.length === 1 && Number(allGen[0]) === g0 + 1 && Object.keys(gens).length === 11)
  check('product_database_status holds exactly one row', gens.product_database_status.n === 1)
  const cols = await rowsOf(A, `select a.attname, format_type(a.atttypid, a.atttypmod) as t from pg_attribute a where a.attrelid = 'public.v_database_status'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`)
  const sCols = await rowsOf(A, `select a.attname, format_type(a.atttypid, a.atttypmod) as t from pg_attribute a where a.attrelid = 'public.product_database_status'::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`)
  check('the snapshot has the 26 source columns, same names and types, preceded by the five metadata columns', cols.length === 26 && JSON.stringify(sCols.slice(5)) === JSON.stringify(cols) && JSON.stringify(sCols.slice(0, 5).map((c) => c.attname)) === JSON.stringify(STATUS_META))
  const drop = `array[${STATUS_META.map((c) => `'${c}'`).join(',')}]::text[]`
  const eq = (await rowsOf(A, `select (select count(*) from (select to_jsonb(s) j from public.v_database_status s except all select to_jsonb(t) - ${drop} from public.product_database_status t) a)::int as missing,
    (select count(*) from (select to_jsonb(t) - ${drop} from public.product_database_status t except all select to_jsonb(s) from public.v_database_status s) b)::int as extra`))[0]
  check('the 26 status fields equal v_database_status exactly (no missing, no extra)', eq.missing === 0 && eq.extra === 0, JSON.stringify(eq))
  const meta = (await rowsOf(A, `select s.generation_id = e.generation_id as g, s.generated_at = e.generated_at as t, s.source_data_as_of_date = e.source_data_as_of_date as d,
    s.product_version = e.product_version and s.schema_version = e.schema_version as v, s.tracked_signings = e.dodgers_signings as n, s.source_data_as_of_date is not null as nn
    from public.product_database_status s cross join public.product_executive_snapshot e`))[0]
  check('generation id, generated_at, as-of date and version metadata equal the executive snapshot of the same refresh; signing counts agree', Object.values(meta).every(Boolean), JSON.stringify(meta))
  const drift = await rowsOf(A, `select snapshot, missing_rows, extra_rows from public.disi_product_snapshot_drift()`)
  check(`drift reports no differences for all ${drift.length} snapshots (the eleventh is covered)`, drift.length === 11 && drift.every((d) => d.missing_rows === 0 && d.extra_rows === 0) && drift.at(-1).snapshot === 'product_database_status')

  // --- refresh: a normal refresh advances all eleven in one generation
  const gBefore = Number(allGen[0])
  const refreshed = await rowsOf(A, `select snapshot, row_count from public.disi_refresh_product_snapshots()`)
  const gens2 = await snapState(A); const all2 = [...new Set(Object.values(gens2).flatMap((x) => x.gens))]
  check('an explicit refresh writes eleven snapshots in one new generation', refreshed.length === 11 && refreshed.at(-1).snapshot === 'product_database_status' && all2.length === 1 && Number(all2[0]) === gBefore + 1)

  // --- transactional failure behaviour: each validation rule, and a late stage failure, leave the previous generation intact
  const failCase = async (label, setupSql, pattern) => {
    const stateBefore = await snapState(A)
    await A.query('begin')
    let msg = ''
    try {
      await A.query(setupSql)
      await A.query('savepoint r')
      try { await A.query(`select * from public.disi_refresh_product_snapshots()`) } catch (e) { msg = e.message }
      // inside the same transaction the failed call has left nothing behind (statement-level atomicity of the function)
      const inside = await snapState(A)
      check(`${label}: the failed refresh leaves no partial snapshot even inside the open transaction`, md5(inside) === md5(stateBefore))
      await A.query('rollback to savepoint r')
    } finally { await A.query('rollback') }
    const stateAfter = await snapState(A)
    check(`${label}: refresh is refused (${msg.slice(0, 90)}) and the previous generation remains intact in all 11 tables`, pattern.test(msg) && md5(stateAfter) === md5(stateBefore))
  }
  await failCase('rule 1 (status snapshot is not one row)', `create function pg_temp.dup() returns trigger language plpgsql as $f$ begin if pg_trigger_depth() = 1 then insert into public.product_database_status select new.*; end if; return new; end $f$;
    create trigger zz_dup before insert on public.product_database_status for each row execute function pg_temp.dup();`, /status snapshot is not one row/)
  await failCase('rule 2 (status signings disagree with the executive snapshot)', `create function pg_temp.bump() returns trigger language plpgsql as $f$ begin new.tracked_signings := new.tracked_signings + 1; return new; end $f$;
    create trigger zz_bump before insert on public.product_database_status for each row execute function pg_temp.bump();`, /status snapshot disagrees with the executive snapshot/)
  await failCase('a failure in an earlier stage (comparables)', `create function pg_temp.boom() returns trigger language plpgsql as $f$ begin raise exception 'forced stage failure'; end $f$;
    create trigger zz_boom before insert on public.product_player_comparables for each row execute function pg_temp.boom();`, /forced stage failure/)

  // --- contract and security
  const contract = (await rowsOf(A, `select relation_name from disi_product_contract order by 1`)).map((r) => r.relation_name)
  const reads = new Set()
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []))
  for (const f of [path.join(TC, 'lib/data.js'), ...walk(path.join(TC, 'app'))]) for (const m of fs.readFileSync(f, 'utf8').matchAll(/\.from\('([a-z_0-9]+)'\)/g)) reads.add(m[1])
  check('product contract = 47 relations = exactly what the application reads; includes product_database_status, not v_database_status',
    contract.length === 47 && JSON.stringify(contract) === JSON.stringify([...reads].sort()) && contract.includes('product_database_status') && !contract.includes('v_database_status'))
  const priv = (rel, p, role) => rowsOf(A, `select has_table_privilege($1, $2, $3) as x`, [role, `public.${rel}`, p]).then((r) => r[0].x)
  const readBoundary = []
  for (const role of ['anon', 'authenticated', 'public']) {
    readBoundary.push([role, 'v_database_status SELECT', await priv('v_database_status', 'SELECT', role) === false])
    readBoundary.push([role, 'product_database_status SELECT', await priv('product_database_status', 'SELECT', role) === (role !== 'public')])
    for (const p of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) readBoundary.push([role, `product_database_status ${p}`, await priv('product_database_status', p, role) === false])
  }
  check('privileges: anon / authenticated read product_database_status only (SELECT, no write, truncate, trigger, references); none of anon / authenticated / PUBLIC reads v_database_status',
    readBoundary.every((x) => x[2]), JSON.stringify(readBoundary.filter((x) => !x[2])))
  const roleResults = {}
  for (const role of ['anon', 'authenticated']) {
    roleResults[role] = {
      read: await inRole(A, role, `select * from public.product_database_status`),
      view: await inRole(A, role, `select * from public.v_database_status`),
      insert: await inRole(A, role, `insert into public.product_database_status select * from public.product_database_status`),
      update: await inRole(A, role, `update public.product_database_status set tracked_signings = 0`),
      delete: await inRole(A, role, `delete from public.product_database_status`),
      truncate: await inRole(A, role, `truncate public.product_database_status`),
      refresh: await inRole(A, role, `select * from public.disi_refresh_product_snapshots()`),
      drift: await inRole(A, role, `select * from public.disi_product_snapshot_drift()`),
    }
  }
  check('behavior as anon / authenticated: SELECT allowed; v_database_status, insert, update, delete, truncate, refresh and drift all denied (42501)',
    ['anon', 'authenticated'].every((r) => roleResults[r].read === 'ALLOWED' && Object.entries(roleResults[r]).filter(([k]) => k !== 'read').every(([, v]) => v === '42501')), JSON.stringify(roleResults))
  const rls = (await rowsOf(A, `select relrowsecurity as rls from pg_class where relname = 'product_database_status'`))[0].rls
  const polRows = await rowsOf(A, `select policyname, cmd, roles::text as roles from pg_policies where tablename = 'product_database_status'`)
  check('RLS is enabled on product_database_status with a single SELECT policy for anon, authenticated', rls && polRows.length === 1 && polRows[0].cmd === 'SELECT' && /anon/.test(polRows[0].roles) && /authenticated/.test(polRows[0].roles), JSON.stringify(polRows))
  const writePolicies = (await rowsOf(A, `select count(*)::int as n from pg_policies where schemaname = 'public' and cmd <> 'SELECT'`))[0].n
  const fnExec = await rowsOf(A, `select p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('public', p.oid, 'EXECUTE')) order by 1`)
  const secdef = await rowsOf(A, `select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef order by 1`)
  check('no new executable function and no SECURITY DEFINER function appeared; no table policy grants writes', JSON.stringify(fnExec) === JSON.stringify(S0.fnExec) && JSON.stringify(secdef) === JSON.stringify(S0.secdef) && writePolicies === 0,
    JSON.stringify({ added: fnExec.filter((x) => !S0.fnExec.some((y) => y.proname === x.proname)), secdef }))
  const fnProps = await rowsOf(A, `select p.proname, p.prosecdef as secdef, p.provolatile as vol, array_to_string(p.proconfig, ',') as cfg,
    has_function_privilege('public', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') as api
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('disi_player_realized_organizational_value', 'disi_player_expected_organizational_value', 'disi_expected_value_research_queue',
      'disi_portfolio_candidate_readiness', 'disi_executive_overview', 'disi_research_roadmap', 'disi_refresh_product_snapshots', 'disi_product_snapshot_drift') order by 1`)
  check('the eight internal functions: invoker rights, search_path fixed to empty, no PUBLIC / anon / authenticated EXECUTE, refresh VOLATILE and the rest STABLE',
    fnProps.length === 8 && fnProps.every((x) => !x.secdef && !x.api && /search_path=""/.test(x.cfg) && x.vol === (x.proname === 'disi_refresh_product_snapshots' ? 'v' : 's')), JSON.stringify(fnProps.filter((x) => x.secdef || x.api)))
  // the request-time read touches only the persisted table
  const plan = (await rowsOf(A, `explain (format json) select * from public.product_database_status`))[0]['QUERY PLAN']
  const planText = JSON.stringify(plan)
  check('the home-page status read is one scan of product_database_status (no view, no function)', /"Relation Name":\s*"product_database_status"/.test(planText) && !/Function Scan|v_database_status/.test(planText))

  // --- rollback exercise 1: 045b -> exact 045a
  const gBeforeRb = await snapState(A, SNAP.slice(0, 10))
  await A.query(rbSql)
  const S2 = { cat: await catalog(A), full: await contentHashes(A, { stable: false }) }
  check('rollback-045b.sql: views, ACLs (incl. v_database_status), RLS, policies and every function body return to the exact 045a catalog', md5(S2.cat) === md5(S0.cat),
    JSON.stringify(['views', 'acls', 'pol', 'fn'].filter((k) => md5(S2.cat[k]) !== md5(S0.cat[k]))))
  const contract2 = await rowsOf(A, `select relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in from disi_product_contract order by 1`)
  check('rollback-045b.sql: product_database_status is gone, the 47-relation contract is restored, no 045b object remains',
    JSON.stringify(contract2) === JSON.stringify(S0.contract) && (await rowsOf(A, `select to_regclass('public.product_database_status') is null as gone`))[0].gone
    && !(S2.full.product_database_status), '')
  const researchMoved = Object.keys(S0.full).filter((t) => !t.startsWith('product_') && t !== 'disi_product_contract' && JSON.stringify(S0.full[t]) !== JSON.stringify(S2.full[t]))
  check('rollback-045b.sql: no research table differs from the 001-045a state; the ten snapshots stay at their current generation and still equal their sources',
    researchMoved.length === 0 && md5(await snapState(A, SNAP.slice(0, 10))) === md5(gBeforeRb)
    && (await rowsOf(A, `select * from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)).length === 0)
  const rbv = await checkBase(q(A)); const frb = failedBase(rbv)
  check(`after rollback-045b the BASELINE verifier passes again: ${rbv.hard.length - frb.length}/${rbv.hard.length}`, frb.length === 0 && rbv.hard.length === 247, frb.map((x) => x.name).join(', '))
  let refused = false
  try { await A.query(rbSql) } catch (e) { refused = /not a 045b database/.test(e.message); await A.query('rollback').catch(() => {}) }
  check('rollback-045b.sql refuses to run twice (guarded)', refused)
  await apply(A, TC, [FILE])
  const again = await checkCand(q(A)); const fagain = failedCand(again)
  check(`045b re-applies after a rollback: ${again.hard.length - fagain.length}/${again.hard.length}`, fagain.length === 0 && again.hard.length === 247, fagain.map((x) => x.name).join(', '))

  // --- rollback exercise 2: rollback-042-045.sql from the 045b state returns the exact 001-041 state
  const Z = await freshDb('disi_z')
  await apply(Z, TC, cand.slice(0, 42))
  const zc = { cat: await catalog(Z), full: await contentHashes(Z, { stable: true }) }
  await Z.end()
  const C = await freshDb('disi_c')
  await apply(C, TC, cand)
  await C.query(rbAllSql)
  const cc = { cat: await catalog(C), full: await contentHashes(C, { stable: true }) }
  check('rollback-042-045.sql from the 045b state returns the exact 001-041 state (views, ACLs incl. v_database_status, policies, functions, row content)',
    md5(cc.cat) === md5(zc.cat) && md5(cc.full) === md5(zc.full), JSON.stringify(['views', 'acls', 'pol', 'fn'].filter((k) => md5(cc.cat[k]) !== md5(zc.cat[k]))))
  check('rollback-042-045.sql leaves no 045b object (no product_database_status; v_database_status readable by the API roles again)',
    (await rowsOf(C, `select to_regclass('public.product_database_status') is null as gone, has_table_privilege('anon', 'public.v_database_status', 'SELECT') as a, has_table_privilege('authenticated', 'public.v_database_status', 'SELECT') as b`))
      .every((r) => r.gone && r.a && r.b))
  await C.end()
  // and from a 045a-only state (the rollback file changed; the previous case must still work)
  const D = await freshDb('disi_d')
  await apply(D, TC, base)
  await D.query(rbAllSql)
  const dc = { cat: await catalog(D), full: await contentHashes(D, { stable: true }) }
  check('rollback-042-045.sql from a 045a-only state still returns the exact 001-041 state', md5(dc.cat) === md5(zc.cat) && md5(dc.full) === md5(zc.full))
  await D.end()
  // the candidate verifier is unchanged by all of the above on A
  await A.end()
} catch (e) {
  check('run', false, e.stack)
} finally {
  await server.stop()
  fs.rmSync(dataDir, { recursive: true, force: true })
}
const failedN = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failedN}/${results.length} real-PostgreSQL checks passed${failedN ? ` — ${failedN} FAILED` : ''}`)
process.exitCode = failedN ? 1 : 0
