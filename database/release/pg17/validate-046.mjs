// Independent validation of migration 046 (reviewed acquisition-cost research batch) on a disposable, real PostgreSQL 17 server
// (embedded-postgres, scratchpad only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-045b),
// tcand = the candidate (default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-046.mjs <work-dir>     (run-046.sh prepares the work dir)
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

const FILE = '046_outcome_cost_research_batch.sql'
const ROLLBACK = 'database/release/sql/rollback-046.sql'
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
async function contentHashes(c) {
  const tables = (await rowsOf(c, `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) {
    const rows = (await rowsOf(c, `select t::text as r from public.${pg.escapeIdentifier(t)} t`)).map((r) => r.r).sort()
    out[t] = { n: rows.length, h: md5(rows) }
  }
  return out
}
const catalog = async (c) => ({
  views: Object.fromEntries((await rowsOf(c, `select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).map((r) => [r.relname, r.d])),
  acls: await rowsOf(c, `select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1`),
  pol: await rowsOf(c, `select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`),
  fn: await rowsOf(c, `select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text, '') as acl from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  trg: await rowsOf(c, `select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
})
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
const inRole = async (c, role, sql) => {
  await c.query('begin'); try { await c.query(`set local role ${role}`); await c.query('savepoint s'); try { await c.query(sql); return 'ALLOWED' } catch (e) { return e.code } } finally { await c.query('rollback') }
}
const status = async (c) => (await rowsOf(c, `select signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks, outcome_audit_queue, outcome_audits_completed, generation_id::int as g from product_database_status`))[0]
const drift = (c) => rowsOf(c, `select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const evidence = JSON.parse(fs.readFileSync(path.join(TC, 'database/research/046/research-evidence.json'), 'utf8'))
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 045b (49 files)', base.length === 49 && base.at(-1) === '045b_database_status_snapshot.sql')
  check('candidate manifest = baseline + 046 (50 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-045b are byte-identical between the baseline and the candidate and match the frozen hashes (49 entries)', frozenOk && Object.keys(frozen).length === 49)
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-046.sql: sha256 ${sha256(rbSql)}  ${Buffer.byteLength(rbSql)} bytes`)
  check('046: no CRLF; one transaction; no DDL on the public schema', !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql) && !/\b(create|alter|drop)\s+(table|view|function|policy|trigger|index)\b/i.test(sql.replace(/\$m046\$[\s\S]*?\$m046\$/, '')))
  const plan = fs.readFileSync(path.join(TC, 'database/release/046-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)))

  // --- A: the released 001-045b (the production state), then 046
  const A = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A, TBASE, base)
  console.log(`  001-045b replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const { checkInvariants, failedChecks } = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const pre = await checkInvariants(q(A)); const fpre = failedChecks(pre)
  check(`candidate verifier on the PRE-release state (production today): ${pre.hard.length - fpre.length}/${pre.hard.length}`, fpre.length === 0 && pre.hard.length === 247, fpre.map((x) => x.name).join(', '))
  const S0 = { cat: await catalog(A), full: await contentHashes(A), st: await status(A) }
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), full: await contentHashes(A), st: await status(A) }
  check(`046 applies in one transaction (${ms} ms, including the snapshot refresh)`, true)
  check('NO catalog change: view definitions, ACLs, RLS, policies, functions and triggers are identical', md5(S1.cat) === md5(S0.cat))
  const changed = Object.keys(S1.full).filter((t) => S1.full[t].h !== S0.full[t].h).sort()
  check('only the ledger, signings, sources and the eleven snapshots changed', JSON.stringify(changed) === JSON.stringify(['signing_financial_reports', 'signings', 'sources', ...SNAP].sort()), changed.join(','))
  const delta = (t) => S1.full[t].n - S0.full[t].n
  check('rows added: 10 reports, 8 sources; signings and every research table unchanged in size', delta('signing_financial_reports') === 10 && delta('sources') === 8 && delta('signings') === 0 && delta('outcome_audits') === 0 && delta('outcome_evidence') === 0 && delta('transaction_events') === 0, `reports +${delta('signing_financial_reports')}, sources +${delta('sources')}`)
  const NEW = evidence.signing_reports.filter((r) => r.kind === 'NEW')
  const total = NEW.reduce((a, r) => a + Number(r.amount), 0)
  check('coverage moves by exactly the sourced amounts: known costs +8, spend +$4,323,000.00, open tasks -8, NOT_AUDITED and audits unchanged',
    S1.st.signings_with_known_cost === S0.st.signings_with_known_cost + 8 && Math.round((Number(S1.st.cost) - Number(S0.st.cost)) * 100) === total * 100 && total === 4323000
      && S1.st.open_research_tasks === S0.st.open_research_tasks - 8 && S1.st.outcome_audit_queue === S0.st.outcome_audit_queue && S1.st.outcome_audits_completed === S0.st.outcome_audits_completed, JSON.stringify(S1.st))
  const bonuses = await rowsOf(A, `select p.slug, sg.signing_bonus_usd::text as bonus, sg.bonus_publicly_reported as rep, f.bonus_status as st from public.signings sg join public.players p on p.id = sg.player_id
    join public.v_signing_acquisition_financials f on f.signing_id = sg.id where p.slug = any($1) order by 1`, [evidence.examined.map((e) => e.player_slug)])
  const by = Object.fromEntries(bonuses.map((b) => [b.slug, b]))
  check('the eight researched bonuses are KNOWN at the sourced amounts', NEW.every((r) => by[r.player_slug].bonus === r.amount && by[r.player_slug].rep === true && by[r.player_slug].st === 'KNOWN'))
  check('Adrian Beltre stays an unresolved CONFLICT with a NULL canonical bonus; no resolution exists', by['adrian-beltre'].bonus === null && by['adrian-beltre'].st === 'CONFLICT' && (await rowsOf(A, `select count(*)::int as n from public.signing_financial_resolutions`))[0].n === 0)
  const unresolved = evidence.examined.filter((e) => e.outcome === 'UNRESOLVED')
  check(`${unresolved.length} signings looked for and not found stay UNKNOWN with no amount`, unresolved.every((e) => by[e.player_slug].bonus === null && by[e.player_slug].st === 'UNKNOWN'))
  check('no zero or negative bonus exists anywhere', (await rowsOf(A, `select (select count(*) from public.signings where signing_bonus_usd = 0)::int + (select count(*) from public.signing_financial_reports where amount <= 0)::int as n`))[0].n === 0)
  const gens = await Promise.all(SNAP.map(async (t) => (await rowsOf(A, `select coalesce(array_agg(distinct generation_id), '{}') as g from public.${t}`))[0].g))
  check('one coherent generation: +1 and identical across all eleven snapshots; drift 0', gens.every((g) => g.length === 1 && Number(g[0]) === S0.st.g + 1) && (await drift(A)).length === 0, JSON.stringify(gens[0]))
  const post = await checkInvariants(q(A)); const fpost = failedChecks(post)
  check(`candidate verifier after 046: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 247, fpost.map((x) => x.name).join(', '))
  // exact idempotency
  await apply(A, TC, [FILE])
  check('046 exact idempotency (all rows incl. ids / timestamps, definitions, ACLs, policies, functions); no further generation', md5({ cat: await catalog(A), full: await contentHashes(A) }) === md5({ cat: S1.cat, full: S1.full }))
  // API boundary
  const denial = await Promise.all([
    inRole(A, 'anon', `select 1 from public.signing_financial_reports limit 1`), inRole(A, 'authenticated', `select 1 from public.sources limit 1`),
    inRole(A, 'anon', `insert into public.signing_financial_reports (signing_id, component_type, amount, currency_code, report_origin, evidence_basis, confidence) values (gen_random_uuid(), 'SIGNING_BONUS', 1, 'USD', 'EXTERNAL_SOURCE', 'OTHER', 'LOW')`),
    inRole(A, 'anon', `update public.signings set signing_bonus_usd = 1`), inRole(A, 'authenticated', `delete from public.signing_financial_reports`),
    inRole(A, 'anon', `select * from public.disi_refresh_product_snapshots()`),
  ])
  check('anon / authenticated can neither read the ledger or sources nor write anything, nor run the refresh (42501)', denial.every((d) => d === '42501'), denial.join(','))
  check('the product still reads: anon sees the snapshots', (await inRole(A, 'anon', `select 1 from public.product_database_status`)) === 'ALLOWED' && (await inRole(A, 'anon', `select 1 from public.product_player_decision`)) === 'ALLOWED')
  // the ledger refuses a deletion (the rollback must retract)
  await A.query('begin')
  let del = ''
  try { await A.query('savepoint s'); await A.query(`delete from public.signing_financial_reports`) } catch (e) { del = e.code } finally { await A.query('rollback') }
  check('financial reports are never deleted (55000): a rollback can only retract', del === '55000', del)

  // --- B: rollback on a copy of the post-046 state
  await A.end()
  const admin = await connect('postgres'); await admin.query(`create database disi_b template disi_a`); await admin.end()
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  const SB = { st: await status(B), full: await contentHashes(B), cat: await catalog(B) }
  check(`rollback-046 commits in one transaction (${rms} ms)`, true)
  const bonusesB = await rowsOf(B, `select p.slug, sg.signing_bonus_usd::text as bonus, sg.bonus_publicly_reported as rep, f.bonus_status as st from public.signings sg join public.players p on p.id = sg.player_id
    join public.v_signing_acquisition_financials f on f.signing_id = sg.id where p.slug = any($1) order by 1`, [evidence.examined.map((e) => e.player_slug)])
  check('after rollback every researched signing is UNKNOWN again (canonical NULL, not publicly reported)', bonusesB.every((b) => b.bonus === null && b.rep === false && b.st === 'UNKNOWN'))
  check('after rollback coverage equals the pre-046 state and the snapshots are coherent with zero drift', SB.st.signings_with_known_cost === S0.st.signings_with_known_cost && SB.st.cost === S0.st.cost && SB.st.open_research_tasks === S0.st.open_research_tasks && (await drift(B)).length === 0 && SB.st.g === S1.st.g + 1)
  check('after rollback the catalog is unchanged and exactly ten reports are RETRACTED with the stated reason', md5(SB.cat) === md5(S0.cat) && (await rowsOf(B, `select count(*)::int as n from public.signing_financial_reports where record_status = 'RETRACTED' and retraction_reason = 'Migration 046 rolled back.'`))[0].n === 10)
  let again = ''
  try { await B.query(rbSql) } catch (e) { again = e.message; await B.query('rollback').catch(() => {}) }
  check('a second rollback refuses (the database is no longer in the post-046 state)', /rollback-046: report .* is not present and ACTIVE/.test(again), again.slice(0, 80))
  const rv = await checkInvariants(q(B)); const frv = failedChecks(rv)
  check(`verifier after rollback: ${rv.hard.length - frv.length}/${rv.hard.length}`, frv.length === 0, frv.map((x) => x.name).join(', '))
  await B.end()
} catch (e) {
  check('validator ran to completion', false, e.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
