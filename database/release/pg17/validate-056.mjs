// Independent validation of migration 056 (international benchmark: the 2019 class) on a disposable, real PostgreSQL 17 server
// (embedded-postgres, scratchpad only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-055, frozen;
// 051 added no migration), tcand = the candidate (default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-056.mjs <work-dir>     (run-056.sh prepares the work dir)
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

const FILE = '056_international_benchmark_2019.sql'
const ROLLBACK = 'database/release/sql/rollback-056.sql'
const NEW_POPS = ['MLB-2019-PIPELINE-TOP30']
const LUIS = 'luis-rodriguez-2019'
const WRITTEN = ['evidence', 'outcome_audits', 'outcome_evidence', 'outcome_model_evaluations', 'outcomes', 'player_aliases', 'player_evaluation_rankings', 'player_evaluations',
  'players', 'signing_census_coverage', 'signing_population_member_sources', 'signing_population_members', 'signing_populations', 'signings', 'sources']
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
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
async function tableRows(c, drop = []) {
  const tables = (await rowsOf(c, `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = (await rowsOf(c, `select (to_jsonb(t) - 'updated_at' ${drop.map((k) => `- '${k}'`).join(' ')})::text as r from public.${pg.escapeIdentifier(t)} t`)).map((r) => r.r).sort()
  return out
}
const hashes = (rows) => Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, { n: r.length, h: md5(r) }]))
const catalog = async (c) => ({
  views: Object.fromEntries((await rowsOf(c, `select relname, md5(pg_get_viewdef(oid)) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)).map((r) => [r.relname, r.d])),
  rels: await rowsOf(c, `select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts, relowner::regrole::text as owner
    from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'i', 'S') order by 1`),
  cols: await rowsOf(c, `select table_name, column_name, data_type, ordinal_position from information_schema.columns where table_schema = 'public' order by 1, 4`),
  pol: await rowsOf(c, `select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' order by 1, 2`),
  fn: await rowsOf(c, `select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') as cfg, md5(p.prosrc) as h
    from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  trg: await rowsOf(c, `select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
  enums: await rowsOf(c, `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as v from pg_enum e join pg_type t on t.oid = e.enumtypid group by 1 order by 1`),
})
const drift = (c) => rowsOf(c, `select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)
const generations = async (c) => Promise.all(SNAP.map(async (t) => (await rowsOf(c, `select coalesce(array_agg(distinct generation_id), '{}') as g from public.${t}`))[0].g.map(Number)))
const support = async (c) => Object.fromEntries((await rowsOf(c, `select target_key || '/' || reference_population as k, labelled_n, positive_n, negative_n, censored_n, support_state from public.v_outcome_target_support`)).map((r) => [r.k, r]))
const prediction = async (c) => (await rowsOf(c, `select
    (select count(probability)::int from public.v_player_outcome_probability) as probabilities,
    (select count(*) filter (where prediction_eligible)::int from public.v_player_outcome_probability) as eligible,
    (select supported_probability_targets from public.v_executive_overview) as targets,
    (select count(*)::int from public.v_expected_value_support where probability_supported or expected_value_supported) as ev,
    (select predictive_portfolio_recommendations from public.product_executive_snapshot) as recs,
    (select string_agg(distinct training_fingerprint, ',') from public.v_outcome_model_evaluation) as fingerprint,
    (select bool_and(evaluation_current) from public.v_outcome_model_evaluation) as current,
    (select count(*)::int from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED') as supported_models`))[0]
const dodgers = async (c) => rowsOf(c, `select p.slug, s.international_rank::text as r, md5(s::text) as h from public.signings s join public.players p on p.id = s.player_id
  join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS' order by 1`)
const oldBenchmark = async (c) => md5(await rowsOf(c, `select s::text as t, sp.population_key from public.signings s join public.signing_population_members m on m.signing_id = s.id
  join public.signing_populations sp on sp.id = m.population_id where sp.population_key like 'MLB-201_-PIPELINE-TOP30' and sp.population_key <> all($1) order by 1`, [NEW_POPS]))
const labels = async (c) => rowsOf(c, `select sp.population_key, p.target_key, count(*) filter (where p.label)::int as pos, count(*) filter (where p.label is false)::int as neg,
    count(*) filter (where p.training_state = 'CENSORED')::int as cen
  from public.v_outcome_training_population p join public.signing_population_members m on m.signing_id = p.signing_id join public.signing_populations sp on sp.id = m.population_id
  where sp.population_key = any($1) group by 1, 2 order by 1, 2`, [NEW_POPS])

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 055 (59 files; 051 added no migration)', base.length === 59 && base.at(-1) === '055_international_benchmark_2017_2018.sql')
  check('candidate manifest = baseline + 056 (60 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-055 are byte-identical between the baseline and the candidate and match the frozen hashes (59 entries; 056 is not frozen)', frozenOk && Object.keys(frozen).length === 59 && !(FILE in frozen))
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  sha1(LF) ${sha1(sql.replace(/\r\n/g, '\n'))}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-056.sql: sha256 ${sha256(rbSql)}  ${Buffer.byteLength(rbSql)} bytes`)
  const body = sql.replace(/\$m056\$[\s\S]*?\$m056\$/g, '').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
  check('056: no CRLF; one transaction; no DDL on a public object (only temporary tables); no grant, revoke, function, trigger, policy or view',
    !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql)
      && !/\b(create|alter|drop)\s+(table|view|function|trigger|policy|type|index)\b(?!\s+_m056)/i.test(body.replace(/create temporary table _m056\w*/gi, ''))
      && !/\b(grant|revoke)\b/i.test(body))
  const plan = fs.readFileSync(path.join(TC, 'database/release/056-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)))

  // --- A: the released 001-055 (the production state), then 056
  const A0 = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A0, TBASE, base)
  console.log(`  001-055 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await A0.end()
  await copyDb('disi_a', 'disi_pre')
  const A = await connect('disi_a')
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_055, CANONICAL_EXPECTATIONS } = inv
  const pre = await checkInvariants(q(A), EXPECTATIONS_THROUGH_055); const fpre = failedChecks(pre)
  check(`the through-055 expectations hold on the PRE-056 state (production today): ${pre.hard.length - fpre.length}/${pre.hard.length}`, fpre.length === 0 && pre.hard.length === 258, fpre.map((x) => x.name).join(', '))
  const preHead = failedChecks(await checkInvariants(q(A), CANONICAL_EXPECTATIONS)).map((x) => x.name).sort()
  check('the HEAD verifier on the pre-056 state fails exactly the five pins 056 moves',
    JSON.stringify(preHead) === JSON.stringify(['league_benchmark_players', 'player_evaluations', 'players_total', 'scouting_legacy_ranks_backfilled', 'scouting_legacy_ranks_total']), preHead.join(','))
  const S0 = { cat: await catalog(A), rows: await tableRows(A), gen: await generations(A), sup: await support(A), pred: await prediction(A), dod: await dodgers(A), old: await oldBenchmark(A) }
  check('pre-056: Luis Rodriguez stores rank 4 on his one Dodgers signing', S0.dod.filter((d) => d.slug === LUIS).length === 1 && S0.dod.find((d) => d.slug === LUIS)?.r === '4.00')
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), rows: await tableRows(A), gen: await generations(A), sup: await support(A), pred: await prediction(A), dod: await dodgers(A), old: await oldBenchmark(A) }
  check(`056 applies in one transaction (${ms} ms)`, true)
  check('additivity: every relation, column, ACL, RLS flag, option, owner, view definition, policy, trigger, enum and function body is identical', md5(S1.cat) === md5(S0.cat))
  const H0 = hashes(S0.rows), H1 = hashes(S1.rows)
  const changed = Object.keys(H1).filter((t) => H1[t].h !== H0[t]?.h && !SNAP.includes(t)).sort()
  check('only the 050 benchmark tables (and the stored evaluation) receive rows; every other table is byte-identical', JSON.stringify(changed) === JSON.stringify(WRITTEN), changed.join(','))
  const lost = Object.keys(S0.rows).filter((t) => t !== 'outcome_model_evaluations' && !SNAP.includes(t)).filter((t) => { const s = new Set(S1.rows[t]); return S0.rows[t].some((r) => !s.has(r)) })
  check('no existing row changed or disappeared (the 3 evaluation rows are the only replaced rows)', lost.length === 0, lost.join(','))
  const delta = (t) => S1.rows[t].length - S0.rows[t].length
  check('rows added: 26 players, 26 signings, 26 rankings, 26 audits, 4 outcomes, 1 population, 26 members, 1 coverage row, 54 sources',
    [delta('players'), delta('signings'), delta('player_evaluations'), delta('player_evaluation_rankings'), delta('outcome_audits'), delta('outcomes'), delta('signing_populations'),
      delta('signing_population_members'), delta('signing_census_coverage'), delta('sources')].join(',') === '26,26,26,26,26,4,1,26,1,54',
    [delta('players'), delta('signings'), delta('player_evaluations'), delta('player_evaluation_rankings'), delta('outcome_audits'), delta('outcomes'), delta('signing_populations'), delta('signing_population_members'), delta('signing_census_coverage'), delta('sources')].join(','))
  const ranks = await rowsOf(A, `select r.scope_label, count(*)::int as n, count(distinct r.rank)::int as d, min(r.rank)::int as lo, max(r.rank)::int as hi
    from public.player_evaluation_rankings r join public.player_evaluations e on e.id = r.evaluation_id where r.scope_label in ('2019 MLB Pipeline Top 30 international prospects')
      and e.record_status = 'ACTIVE' group by 1 order by 1`)
  check('rank integrity: 26 ACTIVE rankings, distinct ranks within 1-30, each equal to the signing\'s published rank',
    JSON.stringify(ranks.map((r) => [r.n, r.d, r.lo >= 1 && r.hi <= 30])) === JSON.stringify([[26, 26, true]])
      && (await rowsOf(A, `select count(*)::int as n from public.signings s join public.player_evaluations e on e.player_id = s.player_id join public.player_evaluation_rankings r on r.evaluation_id = e.id
        where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT' and r.scope_label = '2019 MLB Pipeline Top 30 international prospects' and r.rank <> s.international_rank::int`))[0].n === 0, JSON.stringify(ranks))
  const ident = (await rowsOf(A, `select
      (select count(*) from (select mlb_id from public.players where mlb_id is not null group by 1 having count(*) > 1) x)::int as dup_mlb,
      (select count(*) from public.players p where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
         and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'))::int as both,
      (select count(*) from public.signings s join public.players p on p.id = s.player_id join public.signing_population_members m on m.signing_id = s.id join public.signing_populations sp on sp.id = m.population_id
         where sp.population_key = any($1) and (p.mlb_id is null or s.transaction_source_id is null or s.signing_date is null))::int as unsourced`, [NEW_POPS]))[0]
  check('identity: one player per MLB id, no player both a Dodgers and a benchmark signing, every new signing has an MLB id and an official transaction source',
    ident.dup_mlb === 0 && ident.both === 0 && ident.unsourced === 0, JSON.stringify(ident))
  check('Dodgers protection: every Dodgers signing byte-identical; Luis Rodriguez rank 4', md5(S1.dod) === md5(S0.dod))
  check('the 2013-2018 benchmark signings and memberships are byte-identical', S1.old === S0.old)
  const reach = S1.sup['REACH_MLB_WITHIN_7_SEASONS/TOP_PROSPECT_SAMPLE']
  const dodSame = Object.keys(S0.sup).filter((k) => k.endsWith('DODGERS_TRACKED_AND_OPENING_CLASS')).every((k) => md5(S0.sup[k]) === md5(S1.sup[k]))
  check('separation: benchmark reach 166 / 34 / 132 BASELINE_SUPPORTED; every Dodgers support row unchanged',
    reach.labelled_n === 166 && reach.positive_n === 34 && reach.negative_n === 132 && reach.support_state === 'BASELINE_SUPPORTED' && dodSame, JSON.stringify(reach))
  const L = await labels(A)
  const l = (p, t) => L.find((x) => x.population_key === p && x.target_key === t)
  check('labels: 2019 reach 4 / 22, none censored; every 10-season label censored',
    l(NEW_POPS[0], 'REACH_MLB_WITHIN_7_SEASONS').pos === 4 && l(NEW_POPS[0], 'REACH_MLB_WITHIN_7_SEASONS').neg === 22 && l(NEW_POPS[0], 'REACH_MLB_WITHIN_7_SEASONS').cen === 0
      && ['POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS'].every((t) => l(NEW_POPS[0], t).pos === 0 && l(NEW_POPS[0], t).neg === 0 && l(NEW_POPS[0], t).cen === 26), JSON.stringify(L))
  check('model state: evaluation current at 86b58f47..., no model supported; 0 probabilities, eligibility, targets, expected values, recommendations',
    S1.pred.fingerprint === '86b58f473301e2425751d853abd88e94' && S1.pred.current === true && S1.pred.supported_models === 0 && S1.pred.probabilities === 0 && S1.pred.eligible === 0
      && S1.pred.targets === 0 && S1.pred.ev === 0 && S1.pred.recs === 0, JSON.stringify(S1.pred))
  const thr = await rowsOf(A, `select min_reference_n, min_positives, min_negatives, events_per_feature from public.outcome_targets`)
  check('thresholds unchanged (50 / 10 / 10, 10 events per feature)', thr.every((t) => t.min_reference_n === 50 && t.min_positives === 10 && t.min_negatives === 10 && t.events_per_feature === 10))
  check('one snapshot refresh: every snapshot in one new generation, zero drift', S1.gen.every((g) => g.length === 1 && g[0] === S0.gen[0][0] + 1) && (await drift(A)).length === 0, JSON.stringify(S1.gen[0]))
  const post = await checkInvariants(q(A), CANONICAL_EXPECTATIONS); const fpost = failedChecks(post)
  check(`HEAD verifier after 056: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 258, fpost.map((x) => x.name).join(', '))
  await apply(A, TC, [FILE])
  check('056 exact idempotency (every row, definition, ACL, policy, function; no second refresh)', md5({ cat: await catalog(A), rows: await tableRows(A) }) === md5({ cat: S1.cat, rows: S1.rows }))
  await A.end()

  // --- guards on copies of the pre-055 state
  const guard = async (name, mutate, pattern) => {
    const db = `disi_g${results.length}`
    await copyDb('disi_pre', db)
    const G = await connect(db)
    let msg = ''
    try { await G.query(mutate); await G.query(sql) } catch (e) { msg = e.message; await G.query('rollback').catch(() => {}) }
    await G.end()
    check(name, pattern.test(msg), msg.slice(0, 120))
  }
  await guard('guard: a changed Luis Rodriguez rank is refused', `update public.signings s set international_rank = null from public.players p where p.id = s.player_id and p.slug = '${LUIS}'`,
    /056: the listed Dodgers signing luis-rodriguez-2019 is not one tracked Dodgers signing/)
  await guard('guard: an evaluation that is neither 055 nor 056 is refused', `update public.outcome_model_evaluations set training_fingerprint = '00000000000000000000000000000000'`,
    /056: the stored model evaluation is neither the 055 one nor the 056 one/)
  await guard('guard: a researched MLB id already on another player is refused', `update public.players set mlb_id = 691176 where slug = 'yeremy-rosario'`, /056: MLB id 691176 already belongs to another player/)

  // --- B: rollback on a copy of the post-056 state
  await copyDb('disi_a', 'disi_b')
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  check(`rollback-056 commits in one transaction (${rms} ms)`, true)
  const SB = { cat: await catalog(B), rows: await tableRows(B), gen: await generations(B), sup: await support(B), pred: await prediction(B), dod: await dodgers(B) }
  const HB = hashes(SB.rows)
  const rdiff = Object.keys(H0).filter((t) => !SNAP.includes(t) && t !== 'sources' && HB[t]?.h !== H0[t].h)
  check('after rollback every table equals the pre-056 state row for row (the sources stay as provenance)', rdiff.length === 0, rdiff.join(','))
  check('after rollback the catalog, support, Dodgers rows and the 055 evaluation equal the pre-056 state',
    md5(SB.cat) === md5(S0.cat) && md5(SB.sup) === md5(S0.sup) && md5(SB.dod) === md5(S0.dod) && SB.pred.fingerprint === S0.pred.fingerprint && SB.pred.current === true)
  check('after rollback one new generation, zero drift', SB.gen.every((g) => g.length === 1 && g[0] === S1.gen[0][0] + 1) && (await drift(B)).length === 0)
  let again = ''
  try { await B.query(rbSql) } catch (e) { again = e.message; await B.query('rollback').catch(() => {}) }
  check('a second rollback refuses (056 is no longer applied)', /rollback-056: Migration 056 is not applied/.test(again), again.slice(0, 100))
  const rv = await checkInvariants(q(B), EXPECTATIONS_THROUGH_055); const frv = failedChecks(rv)
  check(`the through-055 verifier after rollback: ${rv.hard.length - frv.length}/${rv.hard.length}`, frv.length === 0, frv.map((x) => x.name).join(', '))
  await apply(B, TC, [FILE])
  const drop = ['id', 'created_at', 'source_id', 'accessed_at', 'player_id', 'signing_id', 'member_id', 'population_id', 'evaluation_id', 'entity_id', 'legacy_coverage_id',
    'transaction_source_id', 'position_at_signing_source_id', 'expected_size_source_id', 'retrieved_at', 'generation_id', 'generated_at', 'snapshot_as_of_date', 'organization_id', 'publication_id']
  const R1 = hashes(await (async () => { const C = await connect('disi_a'); try { return await tableRows(C, drop) } finally { await C.end() } })())
  const RB = hashes(await tableRows(B, drop))
  const rr = Object.keys(R1).filter((t) => !SNAP.includes(t) && R1[t].h !== RB[t]?.h)
  check('reapplying 056 after its rollback reproduces the same content (surrogate ids, timestamps and the generation aside)', rr.length === 0, rr.join(','))
  const rep = await checkInvariants(q(B), CANONICAL_EXPECTATIONS); const frep = failedChecks(rep)
  check(`056 can be applied again after its rollback: the HEAD verifier passes ${rep.hard.length - frep.length}/${rep.hard.length}`, frep.length === 0, frep.map((x) => x.name).join(', '))
  await B.end()
} catch (e) {
  check('validator ran to completion', false, e.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
