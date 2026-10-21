// Independent validation of migration 049 (transaction-package completion) on a disposable, real PostgreSQL 17
// server (embedded-postgres, scratchpad only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-048),
// tcand = the candidate (default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-049.mjs <work-dir>     (run-048.sh prepares the work dir)
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

const FILE = '049_transaction_package_completion.sql'
const ROLLBACK = 'database/release/sql/rollback-049.sql'
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
const RESEARCH = ['sources', 'transaction_event_assets', 'transaction_events']
const inRole = async (c, role, sql) => {
  await c.query('begin'); try { await c.query(`set local role ${role}`); await c.query('savepoint s'); try { await c.query(sql); return 'ALLOWED' } catch (e) { return e.code } } finally { await c.query('rollback') }
}
const status = async (c) => (await rowsOf(c, `select signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks, outcome_audit_queue, outcome_audits_completed, generation_id::int as g from public.product_database_status`))[0]
const drift = (c) => rowsOf(c, `select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)
const chains = async (c) => Object.fromEntries((await rowsOf(c, `select chain_status, count(*)::int as n from public.product_player_decision group by 1`)).map((r) => [r.chain_status, r.n]))
const counts = async (c) => (await rowsOf(c, `select (select count(*)::int from public.transaction_events) as events, (select count(*)::int from public.transaction_event_assets) as assets,
  (select count(*)::int from public.player_season_stints) as stints, (select count(*)::int from public.development_milestones) as milestones,
  (select count(*)::int from public.development_progression_decisions) as decisions, (select count(*)::int from public.transaction_asset_timing_observations) as timing,
  (select count(*)::int from public.transaction_asset_resolutions) as resolutions, (select count(*)::int from public.player_mlb_team_season_war) as war_rows,
  (select count(*)::int from public.transaction_event_assets where cash_amount_usd is not null) as cash_known`))[0]
const queues = async (c) => ({
  tx: Object.fromEntries((await rowsOf(c, `select issue, count(*)::int as n from public.v_transaction_research_queue group by 1`)).map((r) => [r.issue, r.n])),
  val: Object.fromEntries((await rowsOf(c, `select issue, count(*)::int as n from public.v_value_research_queue group by 1`)).map((r) => [r.issue, r.n])),
})

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const evidence = JSON.parse(fs.readFileSync(path.join(TC, 'database/research/049/transaction-evidence.json'), 'utf8'))
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 048 (52 files)', base.length === 52 && base.at(-1) === '048_verified_mlb_development_coverage.sql')
  check('candidate manifest = baseline + 049 (53 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-048 are byte-identical between the baseline and the candidate and match the frozen hashes (52 entries)', frozenOk && Object.keys(frozen).length === 52)
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-049.sql: sha256 ${sha256(rbSql)}  ${Buffer.byteLength(rbSql)} bytes`)
  const body = sql.replace(/\$m049\$[\s\S]*?\$m049\$/g, '')
  check('049: no CRLF; one transaction; no DDL on the public schema; no WAR row inserted', !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql)
    && !/\b(create|alter|drop)\s+(table|view|function|policy|trigger|index)\b/i.test(body.replace(/create temporary table[^;]*;/gi, '')) && !/insert into public\.player_mlb_team_season_war/i.test(body))
  const plan = fs.readFileSync(path.join(TC, 'database/release/049-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)))

  // --- A: the released 001-048 (the production state), then 049
  const A = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A, TBASE, base)
  console.log(`  001-048 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_048 } = inv
  const pre = await checkInvariants(q(A), EXPECTATIONS_THROUGH_048); const fpre = failedChecks(pre)
  check(`the through-048 expectations hold on the PRE-release state (production today): ${pre.hard.length - fpre.length}/${pre.hard.length}`, fpre.length === 0 && pre.hard.length === 247, fpre.map((x) => x.name).join(', '))
  const preHead = failedChecks(await checkInvariants(q(A)))
  check(`the HEAD verifier on the pre-release state also passes (049 moves no pinned count): ${247 - preHead.length}/247`, preHead.length === 0, preHead.map((x) => x.name).join(','))
  const S0 = { cat: await catalog(A), full: await contentHashes(A), st: await status(A), chains: await chains(A), counts: await counts(A), queues: await queues(A) }
  check('the baseline is the state this research started from: 209 events, 387 assets, 7 resolutions, 7 incomplete chains, queues 59 / 91',
    S0.counts.events === 209 && S0.counts.assets === 387 && S0.counts.resolutions === 7 && Object.entries(S0.chains).filter(([k]) => k.startsWith('INCOMPLETE')).reduce((n, [, v]) => n + v, 0) === 7
      && Object.values(S0.queues.tx).reduce((a, b) => a + b, 0) === 59 && Object.values(S0.queues.val).reduce((a, b) => a + b, 0) === 91, JSON.stringify(S0.counts))
  const abreuBefore = (await rowsOf(A, `select e.transaction_date::text as d, (select count(*)::int from public.transaction_event_assets a where a.event_id = e.id) as n from public.transaction_events e where e.event_key = 'LAD_ARI_2009_TONY_ABREU'`))[0]
  check('the Abreu trade as DISI stored it: 2009-10-09, one asset, no return', abreuBefore.d === '2009-10-09' && abreuBefore.n === 1, JSON.stringify(abreuBefore))
  const secdef0 = (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), full: await contentHashes(A), st: await status(A), chains: await chains(A), counts: await counts(A), queues: await queues(A) }
  check(`049 applies in one transaction (${ms} ms, including the snapshot refresh)`, true)
  check('NO catalog change: view definitions, ACLs, RLS, policies, functions and triggers are identical', md5(S1.cat) === md5(S0.cat))
  const changed = Object.keys(S1.full).filter((t) => S1.full[t].h !== S0.full[t].h).sort()
  check('only the transaction events, their assets, the sources and the eleven snapshots changed', JSON.stringify(changed) === JSON.stringify([...RESEARCH, ...SNAP].sort()), changed.join(','))
  check('rows added: 4 events, 9 assets, 5 sources; no resolution, observation, WAR row, stint or milestone moved; no cash amount added',
    S1.counts.events - S0.counts.events === 4 && S1.counts.assets - S0.counts.assets === 9 && S1.full.sources.n - S0.full.sources.n === 5 && S1.counts.resolutions === S0.counts.resolutions
      && S1.counts.war_rows === S0.counts.war_rows && S1.counts.timing === S0.counts.timing && S1.counts.stints === S0.counts.stints && S1.counts.milestones === S0.counts.milestones && S1.counts.cash_known === S0.counts.cash_known, JSON.stringify(S1.counts))
  check('audits, outcomes, costs, the ledger, players, WAR, development and the 033/034 observation tables are untouched', ['outcome_audits', 'outcome_evidence', 'outcomes', 'signings', 'signing_financial_reports', 'players', 'transaction_asset_resolutions', 'transaction_asset_timing_observations',
    'dodgers_control_observations', 'player_mlb_team_season_war', 'player_season_stints', 'development_milestones', 'development_progression_decisions', 'research_source_conflicts'].every((t) => S1.full[t].h === S0.full[t].h))
  check('NOT_AUDITED, audits, known costs and spend are unchanged', S1.st.signings_with_known_cost === S0.st.signings_with_known_cost && S1.st.cost === S0.st.cost && S1.st.outcome_audit_queue === S0.st.outcome_audit_queue && S1.st.outcome_audits_completed === S0.st.outcome_audits_completed, JSON.stringify(S1.st))
  // the transaction truth
  const abreu = (await rowsOf(A, `select e.transaction_date::text as d, e.description, (select string_agg(a.asset_side || ':' || a.asset_name, ',' order by a.asset_side, a.asset_name) from public.transaction_event_assets a where a.event_id = e.id) as assets from public.transaction_events e where e.event_key = 'LAD_ARI_2009_TONY_ABREU'`))[0]
  check('the Abreu trade is corrected forward: 2009-08-31, Garland incoming, Abreu the only outgoing asset, and 2009-10-09 kept in the record',
    abreu.d === '2009-08-31' && abreu.assets === 'INCOMING:Jon Garland,OUTGOING:Tony Abreu' && abreu.description.includes('2009-10-09') && abreu.description.includes('Retrosheet transaction 64131'), JSON.stringify(abreu))
  const edge = (await rowsOf(A, `select return_state, incoming_dodgers_bwar, individual_attribution_permitted from public.v_trade_realization_edges where event_key = 'LAD_ARI_2009_TONY_ABREU'`))[0]
  check('KNOWN TRANSACTION != KNOWN RETURN VALUE: Garland\'s return is RETURN_WAR_UNKNOWN, NULL (never zero), and the trade is still sole-outgoing', edge.return_state === 'RETURN_WAR_UNKNOWN' && edge.incoming_dodgers_bwar === null && edge.individual_attribution_permitted === true, JSON.stringify(edge))
  const m67 = (await rowsOf(A, `select (select count(*)::int from public.transaction_event_assets a where a.event_id = e.id and a.asset_side = 'OUTGOING') as out, (select count(*)::int from public.transaction_event_assets a where a.event_id = e.id and a.asset_side = 'INCOMING') as inc,
    (select count(*)::int from public.v_transaction_package_lineage l where l.exit_event_key = e.event_key) as closes from public.transaction_events e where e.event_key = 'LAD_MIN_1967_BOB_MILLER'`))[0]
  check('the 1967 Dodgers-Twins package is recorded: 3 out, 2 in, and it closes Bob Miller\'s interval', m67.out === 3 && m67.inc === 2 && m67.closes >= 1, JSON.stringify(m67))
  const ivs = await rowsOf(A, `select asset_name, exit_event_key, war_state, interval_bounded_dodgers_bwar from public.v_transaction_package_lineage where mlb_id in ('115046', '123713', '279782') order by 1`)
  check('Garland, Grant and Versalles each have a recorded exit and an unloaded WAR whose interval value is NULL, never zero', ivs.length === 3 && ivs.every((r) => r.exit_event_key && r.war_state === 'WAR_NOT_LOADED' && r.interval_bounded_dodgers_bwar === null), JSON.stringify(ivs.map((r) => [r.asset_name, r.exit_event_key])))
  check('chain statuses: the seven incomplete chains become five whose history is open and two (Abreu, Fernandez) whose history is recorded and whose WAR is not loaded',
    JSON.stringify(S1.chains) === JSON.stringify({ ...S0.chains, INCOMPLETE_EXIT_NOT_RESEARCHED: S0.chains.INCOMPLETE_EXIT_NOT_RESEARCHED - 1, INCOMPLETE_RETURN_UNRECORDED: S0.chains.INCOMPLETE_RETURN_UNRECORDED - 1, INCOMPLETE_WAR_NOT_LOADED: 2 }), JSON.stringify(S1.chains))
  check('queues: the transaction queue keeps 59 items (return unrecorded -1, Miller exit -1, Grant and Versalles WAR +2), the value queue 91; PTBNL / future-consideration / cash / pool-space items are unchanged',
    Object.values(S1.queues.tx).reduce((a, b) => a + b, 0) === 59 && Object.values(S1.queues.val).reduce((a, b) => a + b, 0) === 91 && JSON.stringify(S1.queues.val) === JSON.stringify(S0.queues.val)
      && S1.queues.tx.TRADE_RETURN_UNRECORDED === undefined && S1.queues.tx.DOWNSTREAM_WAR_NOT_LOADED === S0.queues.tx.DOWNSTREAM_WAR_NOT_LOADED + 2 && S1.queues.tx.EXIT_NOT_RESEARCHED_DOWNSTREAM === S0.queues.tx.EXIT_NOT_RESEARCHED_DOWNSTREAM - 1
      && ['CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN', 'FUTURE_CONSIDERATIONS_UNRESOLVED', 'PTBNL_UNRESOLVED'].every((i) => S1.queues.tx[i] === S0.queues.tx[i]), JSON.stringify(S1.queues.tx))
  const nothing = (await rowsOf(A, `select (select count(*)::int from public.transaction_event_assets where cash_amount_usd = 0 or pool_space_amount_usd = 0) as zero_amounts,
    (select count(*)::int from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id where a.asset_side = 'OUTGOING' and a.mlb_id in ('472796', '458260', '425540', '452705', '115514', '112226')) as inferred_exits`))[0]
  check('no unknown became a zero or an exit: no zero cash / pool-space amount; none of the six unresolved return assets has an outgoing row', nothing.zero_amounts === 0 && nothing.inferred_exits === 0, JSON.stringify(nothing))
  const ids = (await rowsOf(A, `select asset_name, mlb_id from public.transaction_event_assets where asset_name in ('Apostol Garcia', 'Danny Muegge', 'Rick Roberts', 'William Juárez') order by 1`))
  check('four named-only assets gained an MLB id (472796, 458260, 425540, 452705) and nothing else', JSON.stringify(ids.map((r) => r.mlb_id)) === JSON.stringify(['472796', '458260', '425540', '452705']))
  const gens = await Promise.all(SNAP.map(async (t) => (await rowsOf(A, `select coalesce(array_agg(distinct generation_id), '{}') as g from public.${t}`))[0].g))
  check('one coherent generation: +1 and identical across all eleven snapshots; drift 0', gens.every((g) => g.length === 1 && Number(g[0]) === S0.st.g + 1) && (await drift(A)).length === 0, JSON.stringify(gens[0]))
  const post = await checkInvariants(q(A)); const fpost = failedChecks(post)
  check(`HEAD verifier after 049: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 247, fpost.map((x) => x.name).join(', '))
  const unpinned = failedChecks(await checkInvariants(q(A), { ...inv.CANONICAL_EXPECTATIONS, transaction_war_unavailable_mlb_ids: [] }))
  check('without the pinned id the same data fails exactly the identity check: the relaxation is explicit and narrow', unpinned.length === 1 && unpinned[0].name === 'transaction_asset_identity_consistency_violations', unpinned.map((x) => x.name).join(','))
  const support = (await rowsOf(A, `select support_chain_state, supported_expected_value_models::int as m, predictive_portfolio_recommendations::int as r from public.product_executive_snapshot`))[0]
  check('no predictive layer became supported: the support chain, expected-value models and recommendations are unchanged', support.support_chain_state === 'NO_PREDICTIVE_LAYER_SUPPORTED' && support.m === 0 && support.r === 0)
  // exact idempotency
  await apply(A, TC, [FILE])
  check('049 exact idempotency (all rows incl. ids / timestamps, definitions, ACLs, policies, functions); no further generation', md5({ cat: await catalog(A), full: await contentHashes(A) }) === md5({ cat: S1.cat, full: S1.full }))
  // API boundary
  const attempts = [
    ['anon', `select 1 from public.transaction_events limit 1`], ['authenticated', `select 1 from public.transaction_event_assets limit 1`],
    ['anon', `insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id) select 'X', current_date, 'RELEASE', id, 'x', (select id from public.sources limit 1) from public.organizations limit 1`],
    ['authenticated', `update public.transaction_event_assets set mlb_id = '1'`], ['anon', `delete from public.transaction_events`], ['anon', `insert into public.sources (source_name, source_type, title, url) values ('x', 'x', 'x', 'https://x.example/')`],
    ['anon', `update public.transaction_events set transaction_date = current_date`], ['anon', `select * from public.disi_refresh_product_snapshots()`],
  ]
  const outcome = []
  for (const [role, stmt] of attempts) outcome.push(await inRole(A, role, stmt))
  check('the transaction tables stay public-read and API-write-denied; anon / authenticated cannot write or run the refresh (42501)', outcome[0] === 'ALLOWED' && outcome[1] === 'ALLOWED' && outcome.slice(2).every((d) => d === '42501'), outcome.join(','))
  check('the product still reads: anon sees the snapshots and the transaction views the application reads', (await inRole(A, 'anon', `select 1 from public.product_player_decision`)) === 'ALLOWED' && (await inRole(A, 'anon', `select 1 from public.v_player_transactions`)) === 'ALLOWED'
    && (await inRole(A, 'anon', `select 1 from public.v_transaction_research_queue`)) === 'ALLOWED')
  check(`no SECURITY DEFINER function was added (${secdef0} before, the same after)`, (await rowsOf(A, `select count(*)::int as n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef`))[0].n === secdef0)

  // --- B: rollback on a copy of the post-049 state
  await A.end()
  const admin = await connect('postgres'); await admin.query(`create database disi_b template disi_a`); await admin.end()
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  const SB = { st: await status(B), full: await contentHashes(B), cat: await catalog(B), chains: await chains(B), counts: await counts(B), queues: await queues(B) }
  check(`rollback-049 commits in one transaction (${rms} ms)`, true)
  check('after rollback the transaction events, assets and resolutions equal the pre-049 state, row for row', SB.counts.events === S0.counts.events && SB.counts.assets === S0.counts.assets && SB.counts.resolutions === S0.counts.resolutions
    && ['transaction_events', 'transaction_event_assets', 'transaction_asset_resolutions', 'player_mlb_team_season_war'].every((t) => SB.full[t].h === S0.full[t].h), JSON.stringify(SB.counts))
  check('after rollback the chain statuses and both queues equal the pre-049 state and the snapshots are coherent with zero drift', JSON.stringify(SB.chains) === JSON.stringify(S0.chains) && JSON.stringify(SB.queues) === JSON.stringify(S0.queues) && (await drift(B)).length === 0)
  check('after rollback the catalog is unchanged', md5(SB.cat) === md5(S0.cat))
  let again = ''
  try { await B.query(rbSql) } catch (e) { again = e.message; await B.query('rollback').catch(() => {}) }
  check('a second rollback refuses (the database is no longer in the post-049 state)', /rollback-049: the event .* is not present/.test(again), again.slice(0, 90))
  const rv = await checkInvariants(q(B), EXPECTATIONS_THROUGH_048); const frv = failedChecks(rv)
  check(`the through-048 verifier after rollback: ${rv.hard.length - frv.length}/${rv.hard.length}`, frv.length === 0, frv.map((x) => x.name).join(', '))
  await apply(B, TC, [FILE])
  const rep = await checkInvariants(q(B)); const frep = failedChecks(rep)
  check(`unlike 046, 049 can be applied again after its rollback: the HEAD verifier passes ${rep.hard.length - frep.length}/${rep.hard.length}`, frep.length === 0 && (await counts(B)).events === S1.counts.events, frep.map((x) => x.name).join(', '))
  await B.end()
} catch (e) {
  check('validator ran to completion', false, e.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
