// Independent validation of migration 050 (international benchmark expansion and probability-support audit) on a disposable, real PostgreSQL 17
// server (embedded-postgres, scratchpad only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-049),
// tcand = the candidate (default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-050.mjs <work-dir>     (run-050.sh prepares the work dir)
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

const FILE = '050_international_benchmark_support_expansion.sql'
const ROLLBACK = 'database/release/sql/rollback-050.sql'
const DODGERS = 'DODGERS_TRACKED_AND_OPENING_CLASS'
const FIXED = ['disi_executive_overview', 'disi_refresh_product_snapshots']
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
    const rows = (await rowsOf(c, `select (to_jsonb(t) - 'updated_at')::text as r from public.${pg.escapeIdentifier(t)} t`)).map((r) => r.r).sort()
    out[t] = { n: rows.length, h: md5(rows) }
  }
  return out
}
const catalog = async (c) => ({
  views: Object.fromEntries((await rowsOf(c, `select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).map((r) => [r.relname, r.d])),
  acls: await rowsOf(c, `select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v') order by 1`),
  pol: await rowsOf(c, `select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`),
  fnsig: await rowsOf(c, `select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') as cfg from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  fnbody: Object.fromEntries((await rowsOf(c, `select p.proname, md5(p.prosrc) as h from pg_proc p where p.pronamespace = 'public'::regnamespace`)).map((r) => [r.proname, r.h])),
  trg: await rowsOf(c, `select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
})
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
const RESEARCH = ['evidence', 'outcome_audits', 'outcome_evidence', 'outcome_model_evaluations', 'outcomes', 'player_aliases', 'player_evaluation_rankings', 'player_evaluations',
  'players', 'signing_census_coverage', 'signing_population_member_sources', 'signing_population_members', 'signing_populations', 'signings', 'sources']
const inRole = async (c, role, sql) => {
  await c.query('begin'); try { await c.query(`set local role ${role}`); await c.query('savepoint s'); try { await c.query(sql); return 'ALLOWED' } catch (e) { return e.code } } finally { await c.query('rollback') }
}
const drift = (c) => rowsOf(c, `select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)
const support = async (c) => Object.fromEntries((await rowsOf(c, `select target_key || '/' || reference_population as k, labelled_n, positive_n, negative_n, support_state from public.v_outcome_target_support`)).map((r) => [r.k, r]))
const dodgers = async (c) => (await rowsOf(c, `select
  (select md5(string_agg(t, '|' order by t)) from (select (to_jsonb(s))::text as t from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) as signings,
  (select md5(string_agg(t, '|' order by t)) from (select (to_jsonb(a))::text as t from public.outcome_audits a join public.signings s on s.player_id = a.player_id join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) as audits,
  (select count(*)::int from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') as n,
  (select count(*)::int from public.signings s join public.organizations o on o.id = s.organization_id join public.outcome_audits a on a.player_id = s.player_id where o.franchise_key = 'DODGERS') as audited`))[0]

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 049 (53 files)', base.length === 53 && base.at(-1) === '049_transaction_package_completion.sql')
  check('candidate manifest = baseline + 050 (54 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-049 are byte-identical between the baseline and the candidate and match the frozen hashes (53 entries)', frozenOk && Object.keys(frozen).length === 53)
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-050.sql: sha256 ${sha256(rbSql)}  ${Buffer.byteLength(rbSql)} bytes`)
  const body = sql.replace(/\$m050\$[\s\S]*?\$m050\$/g, '').replace(/\$fn\$[\s\S]*?\$fn\$/g, '')
  const fnDdl = [...body.matchAll(/create or replace function public\.(\w+)\(/gi)].map((m) => m[1]).sort()
  check('050: no CRLF; one transaction; no table / view / policy / trigger / index DDL; the only function DDL replaces the two reviewed functions; no WAR row inserted',
    !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql) && !/\b(create|alter|drop)\s+(table|view|policy|trigger|index)\b/i.test(body.replace(/create temporary table[^;]*;/gi, ''))
      && JSON.stringify(fnDdl) === JSON.stringify(FIXED) && !/insert into public\.player_mlb_team_season_war/i.test(body), fnDdl.join(','))
  const plan = fs.readFileSync(path.join(TC, 'database/release/050-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)))

  // --- A: the released 001-049 (the production state), then 050
  const A = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A, TBASE, base)
  console.log(`  001-049 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_049 } = inv
  const pre = await checkInvariants(q(A), EXPECTATIONS_THROUGH_049); const fpre = failedChecks(pre)
  check(`the through-049 expectations hold on the PRE-release state (production today): ${pre.hard.length - fpre.length}/${pre.hard.length}`, fpre.length === 0 && pre.hard.length === 248, fpre.map((x) => x.name).join(', '))
  const preHead = failedChecks(await checkInvariants(q(A)))
  check(`the HEAD verifier on the pre-release state fails exactly the five pins 050 moves: ${248 - preHead.length}/248`,
    JSON.stringify(preHead.map((x) => x.name).sort()) === JSON.stringify(['league_benchmark_players', 'player_evaluations', 'players_total', 'scouting_legacy_ranks_backfilled', 'scouting_legacy_ranks_total']), preHead.map((x) => x.name).join(','))
  const S0 = { cat: await catalog(A), full: await contentHashes(A), sup: await support(A), d: await dodgers(A), gen: (await rowsOf(A, `select max(generation_id)::int as g from public.product_executive_snapshot`))[0].g }
  check('the baseline is the state this research started from: 268 players, 48 benchmark signings, 136 audits; Dodgers 220 signings / 93 audits',
    S0.full.players.n === 268 && S0.full.outcome_audits.n === 136 && S0.d.n === 220 && S0.d.audited === 93
      && (await rowsOf(A, `select count(*)::int as n from public.signings where record_scope = 'MLB_PIPELINE_TOP_PROSPECT'`))[0].n === 48)
  check('before 050 no target is supported in any population', Object.values(S0.sup).every((s) => s.support_state !== 'BASELINE_SUPPORTED'))
  const secdef0 = (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), full: await contentHashes(A), sup: await support(A), d: await dodgers(A) }
  check(`050 applies in one transaction (${ms} ms, including the snapshot refresh)`, true)
  check('NO catalog change: view definitions, ACLs, RLS, reloptions, policies, triggers and every function signature / ACL / security / volatility / config are identical',
    md5([S1.cat.views, S1.cat.acls, S1.cat.pol, S1.cat.fnsig, S1.cat.trg]) === md5([S0.cat.views, S0.cat.acls, S0.cat.pol, S0.cat.fnsig, S0.cat.trg]))
  const bodies = Object.keys(S1.cat.fnbody).filter((k) => S1.cat.fnbody[k] !== S0.cat.fnbody[k]).sort()
  check('exactly two function bodies changed: the executive overview and the snapshot refresh (one statement each)', JSON.stringify(bodies) === JSON.stringify(FIXED), bodies.join(','))
  const changed = Object.keys(S1.full).filter((t) => S1.full[t].h !== S0.full[t].h).sort()
  check('only the benchmark research tables, the stored evaluation and the eleven snapshots changed', JSON.stringify(changed) === JSON.stringify([...RESEARCH, ...SNAP].sort()), changed.join(','))
  const dn = (t) => S1.full[t].n - S0.full[t].n
  check('rows added: 54 players and signings, 2 populations and coverage rows, 54 members, 56 audits, 23 outcomes, 54 evaluations; 3 evaluation rows replaced, none added',
    dn('players') === 54 && dn('signings') === 54 && dn('signing_populations') === 2 && dn('signing_census_coverage') === 2 && dn('signing_population_members') === 54
      && dn('outcome_audits') === 56 && dn('outcomes') === 23 && dn('player_evaluations') === 54 && dn('outcome_model_evaluations') === 0,
    JSON.stringify(Object.fromEntries(RESEARCH.map((t) => [t, dn(t)]))))
  check('the Dodgers signings and audits are byte-identical; WAR, costs, transactions and development are untouched',
    S1.d.signings === S0.d.signings && S1.d.audits === S0.d.audits && ['player_mlb_team_season_war', 'signing_financial_reports', 'transaction_events', 'transaction_event_assets',
      'player_season_stints', 'development_milestones', 'development_progression_decisions', 'research_source_conflicts'].every((t) => S1.full[t].h === S0.full[t].h))
  const reach = S1.sup[`REACH_MLB_WITHIN_7_SEASONS/TOP_PROSPECT_SAMPLE`]
  check('the benchmark reach target crosses naturally: 90 labelled, 19 positive, 71 negative, BASELINE_SUPPORTED; nothing else crosses',
    reach.labelled_n === 90 && reach.positive_n === 19 && reach.negative_n === 71 && reach.support_state === 'BASELINE_SUPPORTED'
      && Object.entries(S1.sup).filter(([k]) => k !== 'REACH_MLB_WITHIN_7_SEASONS/TOP_PROSPECT_SAMPLE').every(([, s]) => s.support_state !== 'BASELINE_SUPPORTED'), JSON.stringify(reach))
  check('BENCHMARK SUPPORT != DODGERS SUPPORT: every Dodgers support row is unchanged',
    Object.keys(S0.sup).filter((k) => k.endsWith(DODGERS)).every((k) => md5(S1.sup[k]) === md5(S0.sup[k])))
  const chain = (await rowsOf(A, `select (select count(probability)::int from public.v_player_outcome_probability) as probabilities,
      (select count(*)::int from public.v_player_outcome_probability where prediction_eligible) as eligible,
      (select supported_probability_targets from public.v_executive_overview) as targets, (select prediction_readiness_state from public.v_executive_overview) as state,
      (select support_chain_state from public.v_disi_release_status) as chain, (select count(*)::int from public.v_expected_value_support where probability_supported or expected_value_supported) as ev,
      (select predictive_portfolio_recommendations from public.product_executive_snapshot) as recs`))[0]
  check('no probability, no supported Dodgers target, no expected value, no recommendation; the overview and release state say so',
    chain.probabilities === 0 && chain.eligible === 0 && chain.targets === 0 && chain.state === 'NO_SUPPORTED_PROBABILITY_TARGET' && chain.chain === 'NO_PREDICTIVE_LAYER_SUPPORTED' && chain.ev === 0 && chain.recs === 0, JSON.stringify(chain))
  const ev = await rowsOf(A, `select model_key, evaluated_rows, positive_n, folds, decision, training_fingerprint, evaluation_current from public.v_outcome_model_evaluation order by 1`)
  check('the stored evaluation is the re-run one and current: 101 rows, 19 positives, 6 folds, no fitted model supported',
    ev.length === 3 && ev.every((e) => e.evaluation_current && e.evaluated_rows === 101 && e.positive_n === 19 && e.folds === 6 && e.decision !== 'MODEL_SUPPORTED' && e.training_fingerprint === 'af9ec05feb3ee1518cb7608193cd209a'), JSON.stringify(ev.map((e) => [e.model_key, e.decision])))
  const dup = (await rowsOf(A, `select count(*)::int as n from public.players p where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
    and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')`))[0].n
  check('no Dodgers signing has a benchmark copy (RANKING APPEARANCE != NEW SIGNING)', dup === 0)
  const war = (await rowsOf(A, `select count(*)::int as n from public.outcomes o join public.players p on p.id = o.player_id join public.signings s on s.player_id = p.id
    where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT' and o.career_war is not null and not exists (select 1 from public.player_mlb_team_season_war w where w.player_id = p.id or w.bref_id = p.bref_id)`))[0].n
  check('MISSING BWAR != ZERO BWAR: no benchmark outcome carries a career bWAR without loaded team-season rows', war === 0)
  const gens = await Promise.all(SNAP.map(async (t) => (await rowsOf(A, `select coalesce(array_agg(distinct generation_id), '{}') as g from public.${t}`))[0].g))
  check('one coherent generation: +1 and identical across all eleven snapshots; drift 0', gens.every((g) => g.length === 1 && Number(g[0]) === S0.gen + 1) && (await drift(A)).length === 0, JSON.stringify(gens[0]))
  const post = await checkInvariants(q(A)); const fpost = failedChecks(post)
  check(`HEAD verifier after 050: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 248, fpost.map((x) => x.name).join(', '))
  // exact idempotency
  await apply(A, TC, [FILE])
  check('050 exact idempotency (all rows, definitions, ACLs, policies, functions); no further generation', md5({ cat: await catalog(A), full: await contentHashes(A) }) === md5({ cat: S1.cat, full: S1.full }))
  // API boundary
  const attempts = [
    ['anon', `select 1 from public.v_signing_records limit 1`], ['anon', `select 1 from public.product_prediction_readiness limit 1`],
    ['anon', `insert into public.players (full_name, slug) values ('x', 'x-050')`], ['authenticated', `update public.signings set signing_year = 2000`],
    ['anon', `delete from public.player_evaluations`], ['anon', `update public.outcome_model_evaluations set decision = 'MODEL_SUPPORTED'`],
    ['anon', `update public.outcome_targets set min_positives = 1`], ['anon', `select * from public.disi_refresh_product_snapshots()`],
  ]
  const outcome = []
  for (const [role, stmt] of attempts) outcome.push(await inRole(A, role, stmt))
  check('the product reads; anon / authenticated cannot write research rows, the evaluation or the thresholds, or run the refresh (42501)',
    outcome[0] === 'ALLOWED' && outcome[1] === 'ALLOWED' && outcome.slice(2).every((d) => d === '42501'), outcome.join(','))
  check(`no SECURITY DEFINER function was added (${secdef0} before, the same after)`, (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n === secdef0)

  // --- B: rollback on a copy of the post-050 state
  await A.end()
  const admin = await connect('postgres'); await admin.query(`create database disi_b template disi_a`); await admin.end()
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  const SB = { full: await contentHashes(B), cat: await catalog(B), sup: await support(B) }
  check(`rollback-050 commits in one transaction (${rms} ms)`, true)
  const rdiff = RESEARCH.filter((t) => t !== 'sources' && SB.full[t].h !== S0.full[t].h)
  check('after rollback every 050 research table equals the pre-050 state row for row (updated_at aside); sources stay as provenance', rdiff.length === 0, rdiff.join(','))
  check('after rollback the catalog equals the pre-050 state, function bodies included, and the evaluation guards are enabled', md5(SB.cat) === md5(S0.cat))
  check('after rollback support equals the pre-050 state and the snapshots are coherent with zero drift', md5(SB.sup) === md5(S0.sup) && (await drift(B)).length === 0)
  let again = ''
  try { await B.query(rbSql) } catch (e) { again = e.message; await B.query('rollback').catch(() => {}) }
  check('a second rollback refuses (050 is no longer applied)', /rollback-050: Migration 050 is not applied/.test(again), again.slice(0, 90))
  const rv = await checkInvariants(q(B), EXPECTATIONS_THROUGH_049); const frv = failedChecks(rv)
  check(`the through-049 verifier after rollback: ${rv.hard.length - frv.length}/${rv.hard.length}`, frv.length === 0, frv.map((x) => x.name).join(', '))
  await apply(B, TC, [FILE])
  const rep = await checkInvariants(q(B)); const frep = failedChecks(rep)
  check(`050 can be applied again after its rollback: the HEAD verifier passes ${rep.hard.length - frep.length}/${rep.hard.length}`, frep.length === 0, frep.map((x) => x.name).join(', '))
  await B.end()
} catch (e) {
  check('validator ran to completion', false, e.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
