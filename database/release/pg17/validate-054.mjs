// Independent validation of migration 054 (full-career transaction history) on a disposable, real PostgreSQL 17 server
// (embedded-postgres, scratchpad only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-053; 051 added
// no migration), tcand = the candidate (default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-054.mjs <work-dir>     (run-054.sh prepares the work dir)
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

const FILE = '054_full_career_transaction_history.sql'
const ROLLBACK = 'database/release/sql/rollback-054.sql'
const QUEUE = 'v_dodgers_development_research_queue'
const WRITTEN = ['disi_product_contract', 'player_career_transactions', 'sources']
const LEDGER = ['transaction_events', 'transaction_event_assets', 'transaction_asset_resolutions', 'dodgers_control_observations', 'transactions']
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
const GEN_FIELDS = ['generation_id', 'generated_at', 'snapshot_as_of_date']
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
async function contentHashes(c, drop = []) {
  const tables = (await rowsOf(c, `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) {
    const rows = (await rowsOf(c, `select (to_jsonb(t) - 'updated_at' ${drop.map((k) => `- '${k}'`).join(' ')})::text as r from public.${pg.escapeIdentifier(t)} t`)).map((r) => r.r).sort()
    out[t] = { n: rows.length, h: md5(rows) }
  }
  return out
}
const catalog = async (c) => ({
  views: Object.fromEntries((await rowsOf(c, `select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).map((r) => [r.relname, r.d])),
  acls: await rowsOf(c, `select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1`),
  pol: await rowsOf(c, `select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`),
  fnsig: await rowsOf(c, `select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') as cfg from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  fnbody: Object.fromEntries((await rowsOf(c, `select p.proname, md5(p.prosrc) as h from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1, 2`)).map((r) => [r.proname, r.h])),
  trg: await rowsOf(c, `select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
  enums: await rowsOf(c, `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as v from pg_enum e join pg_type t on t.oid = e.enumtypid group by 1 order by 1`),
})
const inRole = async (c, role, sql) => {
  await c.query('begin'); try { await c.query(`set local role ${role}`); await c.query('savepoint s'); try { await c.query(sql); return 'ALLOWED' } catch (e) { return e.code } } finally { await c.query('rollback') }
}
const drift = (c) => rowsOf(c, `select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)
const support = async (c) => Object.fromEntries((await rowsOf(c, `select target_key || '/' || reference_population as k, labelled_n, positive_n, negative_n, support_state from public.v_outcome_target_support`)).map((r) => [r.k, r]))
const prediction = async (c) => (await rowsOf(c, `select
    (select md5(string_agg(f::text, '|' order by f::text)) from public.v_outcome_feature_matrix f) as features,
    (select count(probability)::int from public.v_player_outcome_probability) as probabilities,
    (select supported_probability_targets from public.v_executive_overview) as targets,
    (select count(*)::int from public.v_expected_value_support where probability_supported or expected_value_supported) as ev,
    (select predictive_portfolio_recommendations from public.product_executive_snapshot) as recs,
    (select string_agg(distinct training_fingerprint, ',') from public.v_outcome_model_evaluation) as fingerprint,
    (select bool_and(evaluation_current) from public.v_outcome_model_evaluation) as current`))[0]
const generations = async (c) => Promise.all(SNAP.map(async (t) => (await rowsOf(c, `select coalesce(array_agg(distinct generation_id), '{}') as g from public.${t}`))[0].g.map(Number)))
const isolated = async (c) => (await rowsOf(c, `select
    (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t) as stints,
    (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t) as milestones,
    (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t) as decisions,
    (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t) as audits,
    (select md5(string_agg(t::text, '|' order by t::text)) from public.player_mlb_team_season_war t) as war,
    (select md5(string_agg(t::text, '|' order by t::text)) from public.signing_financial_reports t) as costs,
    (select count(*)::int from public.player_season_stints) as n_stints, (select count(*)::int from public.development_milestones) as n_milestones,
    (select count(*)::int from public.development_progression_decisions) as n_decisions, (select count(*)::int from public.player_mlb_team_season_war) as n_war`))[0]

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 053 (56 files; 051 added no migration)', base.length === 56 && base.at(-1) === '053_transaction_chronology_resolution.sql')
  check('candidate manifest = baseline + 054 (57 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-053 are byte-identical between the baseline and the candidate and match the frozen hashes (56 entries)', frozenOk && Object.keys(frozen).length === 56)
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-054.sql: sha256 ${sha256(rbSql)}  ${Buffer.byteLength(rbSql)} bytes`)
  const body = sql.replace(/\$m054\$[\s\S]*?\$m054\$/g, '').replace(/create temporary table[^;]*;/gi, '')
  const views = [...body.matchAll(/create or replace view public\.(\w+)/gi)].map((m) => m[1])
  const writes = [...new Set([...body.matchAll(/\b(?:insert into|update|delete from)\s+public\.(\w+)/gi)].map((m) => m[1]))].sort()
  const tables = [...body.matchAll(/create table if not exists public\.(\w+)/gi)].map((m) => m[1])
  check('054: no CRLF; one transaction; the only DDL is the career-history table, its indexes and read policy, the stream view and the research queue; writes only sources, career history and the contract',
    !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql) && !/\b(create|alter|drop)\s+(trigger|function|type)\b/i.test(body)
      && JSON.stringify(tables) === JSON.stringify(['player_career_transactions'])
      && JSON.stringify(views) === JSON.stringify(['v_player_career_transactions', QUEUE]) && JSON.stringify(writes) === JSON.stringify(WRITTEN), `${tables} / ${views.join(',')} / ${writes.join(',')}`)
  const plan = fs.readFileSync(path.join(TC, 'database/release/054-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)))

  // --- A: the released 001-053 (the production state), then 054
  const A = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A, TBASE, base)
  console.log(`  001-053 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_053 } = inv
  const pre = await checkInvariants(q(A), EXPECTATIONS_THROUGH_053); const fpre = failedChecks(pre)
  check(`the through-053 expectations hold on the PRE-release state (production today): ${pre.hard.length - fpre.length}/${pre.hard.length}`, fpre.length === 0 && pre.hard.length === 258, fpre.map((x) => x.name).join(', '))
  const preHead = failedChecks(await checkInvariants(q(A))).map((x) => x.name).sort()
  check('the HEAD verifier on the pre-release state fails exactly the two catalog pins 054 moves', JSON.stringify(preHead) === JSON.stringify(['public_tables_total', 'public_views_total']), preHead.join(','))
  const S0 = { cat: await catalog(A), full: await contentHashes(A), snap: await contentHashes(A, GEN_FIELDS), sup: await support(A), pred: await prediction(A), gen: await generations(A), iso: await isolated(A),
    intervals: (await rowsOf(A, `select md5(string_agg(i::text, '|' order by i.interval_key)) as h from public.v_player_control_intervals i`))[0].h }
  const secdef0 = (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), full: await contentHashes(A), snap: await contentHashes(A, GEN_FIELDS), sup: await support(A), pred: await prediction(A), gen: await generations(A), iso: await isolated(A) }
  check(`054 applies in one transaction (${ms} ms)`, true)
  const viewChanged = Object.keys(S1.cat.views).filter((v) => S0.cat.views[v] !== undefined && S1.cat.views[v] !== S0.cat.views[v])
  const viewAdded = Object.keys(S1.cat.views).filter((v) => S0.cat.views[v] === undefined)
  const keep = (rows, extra) => rows.filter((r) => !extra.includes(r.relname ?? r.tablename))
  check('catalog: the research-queue view changes; one table and one view are added; every other ACL, RLS flag, reloption, policy, trigger, enum and function is identical',
    JSON.stringify(viewChanged) === JSON.stringify([QUEUE]) && JSON.stringify(viewAdded) === JSON.stringify(['v_player_career_transactions'])
      && md5([keep(S1.cat.acls, ['player_career_transactions', 'v_player_career_transactions']), keep(S1.cat.pol, ['player_career_transactions']), S1.cat.fnsig, S1.cat.fnbody, S1.cat.trg, S1.cat.enums])
         === md5([S0.cat.acls, S0.cat.pol, S0.cat.fnsig, S0.cat.fnbody, S0.cat.trg, S0.cat.enums]), `${viewChanged} + ${viewAdded}`)
  const newAcl = S1.cat.acls.filter((r) => ['player_career_transactions', 'v_player_career_transactions'].includes(r.relname))
  check('the new table has RLS and the view security_invoker; both are SELECT-only for anon and authenticated',
    newAcl.length === 2 && newAcl.every((r) => r.acl === '{postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres}')
      && newAcl.find((r) => r.relkind === 'r').rls === true && /security_invoker=(true|on)/.test(newAcl.find((r) => r.relkind === 'v').opts), JSON.stringify(newAcl))
  const changed = Object.keys(S1.full).filter((t) => S1.full[t].h !== S0.full[t]?.h && !SNAP.includes(t)).sort()
  check('outside the snapshots only sources, the contract and the new career-history table changed; the Dodgers ledger is byte-identical',
    JSON.stringify(changed) === JSON.stringify(WRITTEN) && LEDGER.every((t) => S1.full[t].h === S0.full[t].h), changed.join(','))
  const snapChanged = SNAP.filter((t) => S1.snap[t].h !== S0.snap[t].h)
  check('one snapshot refresh: every snapshot in one new generation, zero drift; only the executive snapshot changes content (the contract count)',
    S1.gen.every((g) => g.length === 1 && g[0] === S0.gen[0][0] + 1) && (await drift(A)).length === 0 && JSON.stringify(snapChanged) === JSON.stringify(['product_executive_snapshot']), `${JSON.stringify(S1.gen[0])} ${snapChanged.join(',')}`)
  check('rows added: 46 career moves, 2 sources, 1 contract relation', S1.full.player_career_transactions.n === 46 && S1.full.sources.n - S0.full.sources.n === 2
    && S1.full.disi_product_contract.n - S0.full.disi_product_contract.n === 1)
  check('development facts, outcome audits, WAR and acquisition costs are byte-identical (1859 stints, 1084 milestones, 42 decisions, 1880 WAR rows)',
    md5(S1.iso) === md5(S0.iso) && S1.iso.n_stints === 1859 && S1.iso.n_milestones === 1084 && S1.iso.n_decisions === 42 && S1.iso.n_war === 1880, JSON.stringify(S1.iso).slice(0, 120))
  check('support, the feature matrix, probabilities, targets, expected values, recommendations and the evaluation fingerprint are unchanged',
    md5(S1.sup) === md5(S0.sup) && md5(S1.pred) === md5(S0.pred) && S1.pred.probabilities === 0 && S1.pred.targets === 0 && S1.pred.ev === 0 && S1.pred.recs === 0
      && S1.pred.fingerprint === 'af9ec05feb3ee1518cb7608193cd209a' && S1.pred.current === true, JSON.stringify(S1.pred))
  const reach = S1.sup['REACH_MLB_WITHIN_7_SEASONS/TOP_PROSPECT_SAMPLE']
  check('benchmark reach support stays 90 / 19 / 71 BASELINE_SUPPORTED', reach.labelled_n === 90 && reach.positive_n === 19 && reach.negative_n === 71 && reach.support_state === 'BASELINE_SUPPORTED')
  const counts = (await rowsOf(A, `select
      (select count(*)::int from public.v_dodgers_development_research_queue) as queue,
      (select count(*)::int from public.v_dodgers_development_research_queue where issue = 'MULTI_ORG_SEASON_UNVERIFIED') as multi,
      (select count(*)::int from public.v_transaction_research_queue) as tx_queue,
      (select count(*)::int from public.v_value_research_queue) as value_queue,
      (select md5(string_agg(i::text, '|' order by i.interval_key)) from public.v_player_control_intervals i) as intervals,
      (select count(*)::int from public.v_player_career_transactions where layer = 'CAREER_HISTORY') as career_rows,
      (select count(*)::int from public.player_career_transactions c join public.organizations o on o.id in (c.from_organization_id, c.to_organization_id) where o.franchise_key = 'DODGERS') as dodgers_rows`))[0]
  check('the queue holds 128 detector rows (14 multi-organization players); transaction queue 58, value queue 93; the stream labels 46 career rows; none names the Dodgers; control intervals unchanged',
    counts.queue === 128 && counts.multi === 14 && counts.tx_queue === 58 && counts.value_queue === 93 && counts.career_rows === 46 && counts.dodgers_rows === 0 && counts.intervals === S0.intervals,
    JSON.stringify({ ...counts, intervals: counts.intervals === S0.intervals }))
  const post = await checkInvariants(q(A)); const fpost = failedChecks(post)
  check(`HEAD verifier after 054: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 258, fpost.map((x) => x.name).join(', '))
  await apply(A, TC, [FILE])
  check('054 exact idempotency (all rows, definitions, ACLs, policies, functions; no second refresh)', md5({ cat: await catalog(A), full: await contentHashes(A) }) === md5({ cat: S1.cat, full: S1.full }))
  const attempts = [
    ['anon', `select 1 from public.${QUEUE} limit 1`], ['anon', `select 1 from public.v_player_career_transactions limit 1`],
    ['anon', `insert into public.player_career_transactions (event_key, player_id, transaction_date, transaction_type, description, source_id, source_reference) values ('x', gen_random_uuid(), date '2000-01-01', 'TRADE', 'x', gen_random_uuid(), 'x')`],
    ['authenticated', `update public.player_career_transactions set description = 'x'`], ['anon', `delete from public.player_career_transactions`],
  ]
  const outcome = []
  for (const [role, stmt] of attempts) outcome.push(await inRole(A, role, stmt))
  check('the product reads the stream; anon / authenticated cannot write career history (42501)',
    outcome[0] === 'ALLOWED' && outcome[1] === 'ALLOWED' && outcome.slice(2).every((d) => d === '42501'), outcome.join(','))
  check(`no SECURITY DEFINER function was added (${secdef0} before, the same after)`, (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n === secdef0)

  // --- B: rollback on a copy of the post-054 state
  await A.end()
  const admin = await connect('postgres'); await admin.query(`create database disi_b template disi_a`); await admin.end()
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  const SB = { full: await contentHashes(B), snap: await contentHashes(B, GEN_FIELDS), cat: await catalog(B), sup: await support(B), gen: await generations(B) }
  check(`rollback-054 commits in one transaction (${rms} ms)`, true)
  const rdiff = [...new Set([...Object.keys(S0.full), ...Object.keys(SB.full)])].filter((t) => !SNAP.includes(t) && SB.full[t]?.h !== S0.full[t]?.h)
  check('after rollback every canonical table equals the pre-054 state row for row (surrogate ids included; the career-history table is gone)', rdiff.length === 0, rdiff.join(','))
  check('after rollback the catalog (the 053 research-queue view included) equals the pre-054 state', md5(SB.cat) === md5(S0.cat))
  const sdiff = SNAP.filter((t) => SB.snap[t].h !== S0.snap[t].h)
  check('after rollback the snapshots carry the pre-054 content in one new generation, with zero drift', sdiff.length === 0 && SB.gen.every((g) => g.length === 1 && g[0] === S1.gen[0][0] + 1)
    && (await drift(B)).length === 0, sdiff.join(','))
  let again = ''
  try { await B.query(rbSql) } catch (e) { again = e.message; await B.query('rollback').catch(() => {}) }
  check('a second rollback refuses (054 is no longer applied)', /rollback-054: the 054 table or view is missing/.test(again), again.slice(0, 100))
  const rv = await checkInvariants(q(B), EXPECTATIONS_THROUGH_053); const frv = failedChecks(rv)
  check(`the through-053 verifier after rollback: ${rv.hard.length - frv.length}/${rv.hard.length}`, frv.length === 0, frv.map((x) => x.name).join(', '))
  await apply(B, TC, [FILE])
  const drop = ['id', 'created_at', 'source_id', 'accessed_at', ...GEN_FIELDS]
  const SR = await contentHashes(B, drop)
  const S1n = await (async () => { const C = await connect('disi_a'); try { return await contentHashes(C, drop) } finally { await C.end() } })()
  check('reapplying 054 after its rollback reproduces the same content (surrogate ids, write timestamps and the generation aside)', md5(SR) === md5(S1n),
    Object.keys(SR).filter((t) => SR[t].h !== S1n[t].h).join(','))
  const rep = await checkInvariants(q(B)); const frep = failedChecks(rep)
  check(`054 can be applied again after its rollback: the HEAD verifier passes ${rep.hard.length - frep.length}/${rep.hard.length}`, frep.length === 0, frep.map((x) => x.name).join(', '))
  await B.end()
} catch (e) {
  check('validator ran to completion', false, e.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
