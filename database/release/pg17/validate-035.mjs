// Independent 035 validation on a disposable, real PostgreSQL 17 server (embedded-postgres, scratchpad only).
// Sources come from git archives: t034 = 1edf314 (frozen 034), t035 = the 035 candidate (CANDIDATE_035, default HEAD). Never touches a hosted database.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const WORK = path.resolve(process.argv[2])
const S = WORK
// embedded-postgres and pg come from the throwaway work directory (run.sh installs them there), never from the repo
const req = createRequire(path.join(WORK, 'deps', 'package.json'))
const { default: EmbeddedPostgres } = await import(pathToFileURL(req.resolve('embedded-postgres')).href)
const { default: pg } = await import(pathToFileURL(req.resolve('pg')).href)
const T034 = path.join(S, 't034'), T035 = path.join(S, 't035')
const port = 54000 + Math.floor(Math.random() * 900)
const dataDir = path.join(S, 'pgdata-' + port)
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`) }

const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} })
await server.initialise()
await server.start()
const connect = async (db) => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'postgres', database: db }); await c.connect(); return c }

const sqlFiles = (root) => JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8')).canonical_sql
const readSql = (root, f) => fs.readFileSync(path.join(root, 'database/sql', f), 'utf8')

async function freshDb(name) {
  const admin = await connect('postgres')
  await admin.query(`create database ${name}`)
  await admin.end()
  const c = await connect(name)
  // Supabase-like roles (the migrations grant to anon / authenticated)
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

// whole-content hashes per table, excluding generated identity / clock columns so that two independent replays are comparable
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
const viewDefs = async (c) => Object.fromEntries((await c.query(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).rows.map((r) => [r.relname, r.d]))
const acls = async (c) => (await c.query(`select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','v','m') order by 1`)).rows
const policies = async (c) => (await c.query(`select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`)).rows
const functions = async (c) => (await c.query(`select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text,'') as acl from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p') order by 1`)).rows

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)

  // --- frozen baseline
  const frozen = JSON.parse(fs.readFileSync(path.join(T035, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const files034 = sqlFiles(T034), files035 = sqlFiles(T035)
  check('034 manifest at 1edf314 ends at 034 (34 files)', files034.length === 34 && files034.at(-1).startsWith('034_'))
  check('035 manifest = 034 manifest + 035 only', JSON.stringify(files035.slice(0, 34)) === JSON.stringify(files034) && files035.length === 35 && files035[34] === '035_international_benchmark_outcomes.sql')
  let frozenOk = true
  for (const f of files034) {
    const a = readSql(T034, f), b = readSql(T035, f)
    if (a !== b || sha1(a.replace(/\r\n/g, '\n')) !== frozen[f]) { frozenOk = false; console.log('  drift: ' + f) }
  }
  check('001-034 byte-identical between 1edf314 and the candidate and equal to frozen-migrations.json', frozenOk)
  check('034 SHA-1 = 3cb5494f13800a4d44e2ffb6aa6bd1ff88aae5f5', sha1(readSql(T034, files034[33])) === '3cb5494f13800a4d44e2ffb6aa6bd1ff88aae5f5', sha1(readSql(T034, files034[33])))

  // --- A: 001-034 (frozen), then 035 (the production path)
  const A = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A, T034, files034)
  console.log(`  001-034 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const { checkInvariants: check034, failedChecks: failed034 } = await import(path.join(T034, 'scripts/db/lib/invariants.mjs'))
  const q = (c) => async (sql, params) => (await c.query(sql, params)).rows
  const r034 = await check034(q(A))
  const f034 = failed034(r034)
  check(`034 verifier (1edf314) on real PG17 001-034: ${r034.hard.length - f034.length}/${r034.hard.length}`, f034.length === 0, f034.map((x) => x.name).join(', '))

  const before = { stable: await contentHashes(A, { stable: false }), views: await viewDefs(A), acls: await acls(A), pol: await policies(A), fn: await functions(A) }
  t0 = Date.now()
  await apply(A, T035, [files035[34]])
  console.log(`  035 apply on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const after = { full: await contentHashes(A, { stable: false }), views: await viewDefs(A), acls: await acls(A), pol: await policies(A), fn: await functions(A) }

  // 035 is additive: tables touched, views added, nothing earlier redefined
  const changedTables = Object.keys(after.full).filter((t) => JSON.stringify(after.full[t]) !== JSON.stringify(before.stable[t]))
  const newTables = Object.keys(after.full).filter((t) => !(t in before.stable))
  check('035 creates no table', newTables.length === 0, newTables.join(','))
  console.log('  tables written by 035: ' + changedTables.map((t) => `${t} ${before.stable[t].n}->${after.full[t].n}`).join('; '))
  const redefined = Object.keys(before.views).filter((v) => before.views[v] !== after.views[v])
  const addedViews = Object.keys(after.views).filter((v) => !(v in before.views))
  check('035 redefines no 001-034 view', redefined.length === 0, redefined.join(','))
  check('035 adds exactly the three benchmark views', JSON.stringify(addedViews.sort()) === JSON.stringify(['v_international_benchmark_class_coverage', 'v_international_benchmark_player_outcomes', 'v_international_benchmark_research_queue']), addedViews.join(','))
  const aclChanged = before.acls.filter((x) => JSON.stringify(x) !== JSON.stringify(after.acls.find((y) => y.relname === x.relname)))
  check('035 changes no existing ACL / RLS / reloption', aclChanged.length === 0, aclChanged.map((x) => x.relname).join(','))
  check('035 changes no policy or function', JSON.stringify(before.pol) === JSON.stringify(after.pol) && JSON.stringify(before.fn) === JSON.stringify(after.fn))
  const newAcl = after.acls.filter((x) => addedViews.includes(x.relname))
  check('new views: security_invoker, anon/authenticated SELECT only', newAcl.every((x) => /security_invoker=(true|on)/.test(x.opts) && !/anon=[a-zA-Z]*[^r\/][a-zA-Z]*\//.test(x.acl.replace(/anon=r\//, '')) && /anon=r\//.test(x.acl) && /authenticated=r\//.test(x.acl)), newAcl.map((x) => `${x.relname} ${x.acl} ${x.opts}`).join(' | '))
  check('every public table has RLS', after.acls.filter((x) => x.relkind === 'r' && !x.rls).length === 0)
  check('every public view is security_invoker', after.acls.filter((x) => x.relkind === 'v' && !/security_invoker=(true|on)/.test(x.opts)).map((x) => x.relname).length === 0)

  const one = async (sql) => (await A.query(sql)).rows[0]
  const pop = await one(`select count(*)::int as n, count(*) filter (where not is_dodgers)::int as non_dodgers,
      count(*) filter (where not is_dodgers and identity_resolved)::int as resolved,
      count(*) filter (where not is_dodgers and outcome_state <> 'UNAUDITED')::int as audited,
      count(*) filter (where not is_dodgers and reached_mlb_verified)::int as reached,
      count(*) filter (where not is_dodgers and outcome_state = 'UNAUDITED' and reached_mlb_verified is not null)::int as unaudited_not_null,
      count(distinct signing_id)::int as distinct_signings
    from v_international_benchmark_player_outcomes`)
  check('benchmark: 48 non-Dodgers / 43 resolved+audited / 11 reached / unaudited reach is NULL / one row per signing',
    pop.non_dodgers === 48 && pop.resolved === 43 && pop.audited === 43 && pop.reached === 11 && pop.unaudited_not_null === 0 && pop.distinct_signings === pop.n, JSON.stringify(pop))
  const cov = (await A.query(`select population_key, census_state, members, expected_size, rate_eligible_strict, comparison_label, rate_blockers from v_international_benchmark_class_coverage order by 1`)).rows
  check('coverage: no class rate-eligible; all SAMPLE_COMPARISON', cov.every((r) => !r.rate_eligible_strict && r.comparison_label === 'SAMPLE_COMPARISON'))
  const tp = cov.filter((r) => r.census_state === 'TOP_PROSPECT_SAMPLE')
  check('Top-Prospect populations are labelled samples, never census (20/30, 28/30)', tp.length === 2 && tp.map((r) => `${r.members}/${r.expected_size}`).sort().join(',') === '20/30,28/30' && tp.every((r) => r.rate_blockers.includes('NOT_A_FULL_SIGNING_PERIOD')), tp.map((r) => `${r.population_key} ${r.members}/${r.expected_size}`).join('; '))
  const asOf = await one(`select max(audited_through_date)::text as d from outcome_audits`)
  check('analysis as-of date unchanged (2026-10-05)', asOf.d === '2026-10-05', asOf.d)

  const { checkInvariants: check035, failedChecks: failed035 } = await import(path.join(T035, 'scripts/db/lib/invariants.mjs'))
  const r035 = await check035(q(A))
  const f035 = failed035(r035)
  check(`035 verifier (candidate) on real PG17 001-034 + 035: ${r035.hard.length - f035.length}/${r035.hard.length}`, f035.length === 0 && r035.hard.length === 186, f035.map((x) => x.name).join(', '))

  // idempotency: rerun 035 on the same database
  await apply(A, T035, [files035[34]])
  const rerun = { full: await contentHashes(A, { stable: false }), views: await viewDefs(A), acls: await acls(A) }
  check('035 rerun is a no-op (all rows incl. ids/timestamps, view definitions, ACLs)', JSON.stringify(rerun) === JSON.stringify({ full: after.full, views: after.views, acls: after.acls }))

  // convergence: a fresh 001-035 replay equals the incremental path (excluding generated ids / clock columns)
  const B = await freshDb('disi_b')
  await apply(B, T035, files035)
  const [ha, hb] = [await contentHashes(A, { stable: true }), await contentHashes(B, { stable: true })]
  const diff = Object.keys({ ...ha, ...hb }).filter((t) => JSON.stringify(ha[t]) !== JSON.stringify(hb[t]))
  check('convergence: fresh 001-035 = 001-034 then 035 (content, views, ACLs, policies, functions)',
    diff.length === 0 && JSON.stringify(await viewDefs(A)) === JSON.stringify(await viewDefs(B)) && JSON.stringify(await acls(A)) === JSON.stringify(await acls(B))
      && JSON.stringify(await policies(A)) === JSON.stringify(await policies(B)) && JSON.stringify(await functions(A)) === JSON.stringify(await functions(B)), diff.join(','))

  // anon can read the new views through RLS (security_invoker => evaluated as anon)
  await A.query('begin; set local role anon')
  const anonN = (await A.query('select count(*)::int as n from v_international_benchmark_player_outcomes')).rows[0].n
  let anonWrite = 'blocked'
  try { await A.query(`savepoint s; insert into outcome_audits default values`); anonWrite = 'ALLOWED' } catch { await A.query('rollback to savepoint s') }
  await A.query('rollback')
  check('anon: reads benchmark view under RLS; cannot write outcome_audits', anonN === pop.n && anonWrite === 'blocked', `rows ${anonN}, write ${anonWrite}`)

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
