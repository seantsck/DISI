// Independent validation of migration 052 (development taxonomy and chronology resolution) on a disposable, real PostgreSQL 17 server
// (embedded-postgres, scratchpad only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-050; 051 added
// no migration), tcand = the candidate (default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-052.mjs <work-dir>     (run-052.sh prepares the work dir)
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

const FILE = '052_development_taxonomy_chronology_resolution.sql'
const ROLLBACK = 'database/release/sql/rollback-052.sql'
const QUEUE = 'v_dodgers_development_research_queue'
const WRITTEN = ['development_level_era_map', 'development_milestones', 'development_progression_decisions', 'player_season_stints', 'sources']
const MOVED_PINS = ['coded_milestones', 'dated_stints', 'professional_debut_milestones', 'progression_decisions', 'progression_decisions_pending', 'progression_roles', 'undated_log_era_stints']
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
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
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

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 050 (54 files; 051 added no migration)', base.length === 54 && base.at(-1) === '050_international_benchmark_support_expansion.sql')
  check('candidate manifest = baseline + 052 (55 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-050 are byte-identical between the baseline and the candidate and match the frozen hashes (54 entries)', frozenOk && Object.keys(frozen).length === 54)
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-052.sql: sha256 ${sha256(rbSql)}  ${Buffer.byteLength(rbSql)} bytes`)
  const body = sql.replace(/\$m052\$[\s\S]*?\$m052\$/g, '').replace(/create temporary table[^;]*;/gi, '')
  const views = [...body.matchAll(/create or replace view public\.(\w+)/gi)].map((m) => m[1])
  check('052: no CRLF; one transaction; no table / policy / trigger / index / function / type DDL; the only view DDL replaces the research queue; no outcome, WAR, transaction or cost write',
    !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql) && !/\b(create|alter|drop)\s+(table|policy|trigger|index|function|type)\b/i.test(body)
      && JSON.stringify(views) === JSON.stringify([QUEUE])
      && !/\b(insert into|update|delete from)\s+public\.(outcome_audits|outcomes|player_mlb_team_season_war|transaction_events|transaction_event_assets|signings|signing_financial_reports|player_evaluations)\b/i.test(body), views.join(','))
  const plan = fs.readFileSync(path.join(TC, 'database/release/052-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)))

  // --- A: the released 001-050 (the production state), then 052
  const A = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A, TBASE, base)
  console.log(`  001-050 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_051 } = inv
  const pre = await checkInvariants(q(A), EXPECTATIONS_THROUGH_051); const fpre = failedChecks(pre)
  check(`the through-051 expectations hold on the PRE-release state (production today): ${pre.hard.length - fpre.length}/${pre.hard.length}`, fpre.length === 0 && pre.hard.length === 252, fpre.map((x) => x.name).join(', '))
  const preHead = failedChecks(await checkInvariants(q(A)))
  check(`the HEAD verifier on the pre-release state fails exactly the seven pins 052 moves: ${252 - preHead.length}/252`,
    JSON.stringify(preHead.map((x) => x.name).sort()) === JSON.stringify(MOVED_PINS), preHead.map((x) => x.name).join(','))
  const S0 = { cat: await catalog(A), full: await contentHashes(A), sup: await support(A), pred: await prediction(A), gen: await generations(A) }
  const secdef0 = (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), full: await contentHashes(A), sup: await support(A), pred: await prediction(A), gen: await generations(A) }
  check(`052 applies in one transaction (${ms} ms)`, true)
  const viewChanged = Object.keys(S1.cat.views).filter((v) => S1.cat.views[v] !== S0.cat.views[v])
  check('the only catalog change is the research-queue view definition; ACLs, RLS, reloptions, policies, triggers, enums and every function are identical',
    JSON.stringify(viewChanged) === JSON.stringify([QUEUE]) && md5([S1.cat.acls, S1.cat.pol, S1.cat.fnsig, S1.cat.fnbody, S1.cat.trg, S1.cat.enums]) === md5([S0.cat.acls, S0.cat.pol, S0.cat.fnsig, S0.cat.fnbody, S0.cat.trg, S0.cat.enums]), viewChanged.join(','))
  const changed = Object.keys(S1.full).filter((t) => S1.full[t].h !== S0.full[t].h).sort()
  check('only the five development research tables changed (stints, milestones, progression decisions, the level-era map, sources); no snapshot row moved',
    JSON.stringify(changed) === JSON.stringify(WRITTEN), changed.join(','))
  const dn = (t) => S1.full[t].n - S0.full[t].n
  check('rows added: 0 stints, 11 milestones, 5 pending decisions, 3 era-map rows, the cited sources', dn('player_season_stints') === 0 && dn('development_milestones') === 11
    && dn('development_progression_decisions') === 5 && dn('development_level_era_map') === 3 && dn('sources') > 0, JSON.stringify(Object.fromEntries(WRITTEN.map((t) => [t, dn(t)]))))
  check('support, the feature matrix, probabilities, targets, expected values, recommendations and the evaluation fingerprint are unchanged',
    md5(S1.sup) === md5(S0.sup) && md5(S1.pred) === md5(S0.pred) && S1.pred.probabilities === 0 && S1.pred.targets === 0 && S1.pred.ev === 0 && S1.pred.recs === 0
      && S1.pred.fingerprint === 'af9ec05feb3ee1518cb7608193cd209a' && S1.pred.current === true, JSON.stringify(S1.pred))
  const reach = S1.sup['REACH_MLB_WITHIN_7_SEASONS/TOP_PROSPECT_SAMPLE']
  check('benchmark reach support stays 90 / 19 / 71 BASELINE_SUPPORTED', reach.labelled_n === 90 && reach.positive_n === 19 && reach.negative_n === 71 && reach.support_state === 'BASELINE_SUPPORTED')
  check('the snapshot generation does not move and no snapshot drifts', md5(S1.gen) === md5(S0.gen) && (await drift(A)).length === 0, JSON.stringify(S1.gen[0]))
  const counts = (await rowsOf(A, `select
      (select count(*)::int from public.player_season_stints where stint_kind = 'TEAM_STINT' and organization_id is null and level <> 'FOREIGN_PRO') as unresolved,
      (select count(*)::int from public.player_season_stints where first_game_date is not null) as dated,
      (select count(*)::int from public.v_dodgers_development_research_queue) as queue,
      (select count(*)::int from public.v_dodgers_development_research_queue where issue = 'SEASON_GAP') as gaps,
      (select count(*)::int from public.v_dodgers_development_research_queue where issue = 'MULTI_ORG_SEASON_UNVERIFIED') as multi`))[0]
  check('1 team stint stays unresolved, 1,274 stints are dated, the queue holds 134 detector rows (20 season gaps, 20 multi-organization players)',
    counts.unresolved === 1 && counts.dated === 1274 && counts.queue === 134 && counts.gaps === 20 && counts.multi === 20, JSON.stringify(counts))
  const post = await checkInvariants(q(A)); const fpost = failedChecks(post)
  check(`HEAD verifier after 052: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 252, fpost.map((x) => x.name).join(', '))
  await apply(A, TC, [FILE])
  check('052 exact idempotency (all rows, definitions, ACLs, policies, functions)', md5({ cat: await catalog(A), full: await contentHashes(A) }) === md5({ cat: S1.cat, full: S1.full }))
  const attempts = [
    ['anon', `select 1 from public.${QUEUE} limit 1`], ['anon', `select 1 from public.player_season_stints limit 1`],
    ['anon', `update public.player_season_stints set organization_id = null`], ['authenticated', `insert into public.development_level_era_map (era, source_label, maps_to) values ('PRE_1960', 'x', 'OTHER')`],
    ['anon', `delete from public.development_progression_decisions`], ['anon', `update public.development_milestones set date_precision = 'SEASON'`],
  ]
  const outcome = []
  for (const [role, stmt] of attempts) outcome.push(await inRole(A, role, stmt))
  check('the product reads; anon / authenticated cannot write stints, the era map, decisions or milestones (42501)',
    outcome[0] === 'ALLOWED' && outcome[1] === 'ALLOWED' && outcome.slice(2).every((d) => d === '42501'), outcome.join(','))
  check(`no SECURITY DEFINER function was added (${secdef0} before, the same after)`, (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n === secdef0)

  // --- B: rollback on a copy of the post-052 state
  await A.end()
  const admin = await connect('postgres'); await admin.query(`create database disi_b template disi_a`); await admin.end()
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  const SB = { full: await contentHashes(B), cat: await catalog(B), sup: await support(B), gen: await generations(B) }
  check(`rollback-052 commits in one transaction (${rms} ms)`, true)
  const rdiff = Object.keys(S0.full).filter((t) => SB.full[t].h !== S0.full[t].h)
  check('after rollback every table equals the pre-052 state row for row', rdiff.length === 0, rdiff.join(','))
  check('after rollback the catalog (the 024 research-queue view included) equals the pre-052 state', md5(SB.cat) === md5(S0.cat))
  check('after rollback support and the generation equal the pre-052 state, with zero drift', md5(SB.sup) === md5(S0.sup) && md5(SB.gen) === md5(S0.gen) && (await drift(B)).length === 0)
  let again = ''
  try { await B.query(rbSql) } catch (e) { again = e.message; await B.query('rollback').catch(() => {}) }
  check('a second rollback refuses (052 is no longer applied)', /rollback-052: 0 of \d+ organization stints are not in their 052 state/.test(again), again.slice(0, 100))
  const rv = await checkInvariants(q(B), EXPECTATIONS_THROUGH_051); const frv = failedChecks(rv)
  check(`the through-051 verifier after rollback: ${rv.hard.length - frv.length}/${rv.hard.length}`, frv.length === 0, frv.map((x) => x.name).join(', '))
  await apply(B, TC, [FILE])
  const SR = await contentHashes(B, ['id', 'created_at', 'reviewed_at', 'accessed_at', 'source_id'])
  const S1n = await (async () => { const C = await connect('disi_a'); try { return await contentHashes(C, ['id', 'created_at', 'reviewed_at', 'accessed_at', 'source_id']) } finally { await C.end() } })()
  check('reapplying 052 after its rollback reproduces the same content (surrogate ids and write timestamps aside)', md5(SR) === md5(S1n),
    Object.keys(SR).filter((t) => SR[t].h !== S1n[t].h).join(','))
  const rep = await checkInvariants(q(B)); const frep = failedChecks(rep)
  check(`052 can be applied again after its rollback: the HEAD verifier passes ${rep.hard.length - frep.length}/${rep.hard.length}`, frep.length === 0, frep.map((x) => x.name).join(', '))
  await B.end()
} catch (e) {
  check('validator ran to completion', false, e.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
