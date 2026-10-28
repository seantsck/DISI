// Independent validation of migration 057 (benchmark bWAR evidence) on a disposable, real PostgreSQL 17 server (embedded-postgres, scratchpad
// only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-056, frozen; 051 added no migration), tcand = the
// candidate (default HEAD). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-057.mjs <work-dir>     (run-057.sh prepares the work dir)
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

const FILE = '057_benchmark_bwar_evidence.sql'
const ROLLBACK = 'database/release/sql/rollback-057.sql'
const BAT_SHA = 'ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023'
const PITCH_SHA = '3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825'
const WRITTEN = ['outcome_model_evaluations', 'outcomes', 'player_mlb_team_season_war', 'sources']
const BWAR = ['POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS']
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
const support = async (c) => Object.fromEntries((await rowsOf(c, `select target_key || '/' || reference_population as k, labelled_n, positive_n, negative_n, support_state from public.v_outcome_target_support`)).map((r) => [r.k, r]))
const prediction = async (c) => (await rowsOf(c, `select
    (select count(probability)::int from public.v_player_outcome_probability) as probabilities,
    (select count(*) filter (where prediction_eligible)::int from public.v_player_outcome_probability) as eligible,
    (select supported_probability_targets from public.v_executive_overview) as targets,
    (select count(*)::int from public.v_expected_value_support where probability_supported or expected_value_supported) as ev,
    (select predictive_portfolio_recommendations from public.product_executive_snapshot) as recs,
    (select supported_fitted_models from public.product_executive_snapshot) as fitted,
    (select bool_and(evaluation_current) from public.v_outcome_model_evaluation) as current,
    (select count(*)::int from public.outcome_model_evaluations) as evaluations,
    (select count(*)::int from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED') as supported_models,
    (select count(*)::int from public.players p where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
       and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')) as overlap`))[0]
const labels = async (c) => rowsOf(c, `select player_slug, target_key, label, training_state, window_bwar::text as w from public.v_outcome_training_population
  where target_key = any($1) and reference_population = 'TOP_PROSPECT_SAMPLE' and training_state in ('BENCHMARK_SAMPLE_ONLY', 'OUTCOME_UNAUDITED') order by 1, 2`, [BWAR])
const reachEval = (c) => rowsOf(c, `select m::text as t from public.outcome_model_evaluations m where target_key = 'REACH_MLB_WITHIN_7_SEASONS' order by model_key`)

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene, the approved sources
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 056 (60 files; 051 added no migration)', base.length === 60 && base.at(-1) === '056_international_benchmark_2019.sql')
  check('candidate manifest = baseline + 057 (61 files), forward-only', JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-056 are byte-identical between the baseline and the candidate and match the frozen hashes (60 entries; 057 is not frozen)', frozenOk && Object.keys(frozen).length === 60 && !(FILE in frozen))
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  sha1(LF) ${sha1(sql.replace(/\r\n/g, '\n'))}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-057.sql: sha256 ${sha256(rbSql)}  ${Buffer.byteLength(rbSql)} bytes`)
  const body = sql.replace(/\$m057\$[\s\S]*?\$m057\$/g, '').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
  check('057: no CRLF; one transaction; no DDL on a public object (only temporary tables); no grant, revoke, function, trigger, policy or view',
    !sql.includes('\r') && /^begin;$/m.test(sql) && /^commit;$/m.test(sql)
      && !/\b(create|alter|drop)\s+(table|view|function|trigger|policy|type|index)\b/i.test(body.replace(/create temporary table _m057\w*/gi, ''))
      && !/\b(grant|revoke)\b/i.test(body) && !/(insert into|update) public\.outcome_targets/i.test(body))
  const payload = JSON.parse(sql.match(/\$m057\$([\s\S]*?)\$m057\$/)[1])
  const capture = JSON.parse(fs.readFileSync(path.join(TC, 'database/research/057/source-capture.json'), 'utf8'))
  check('sources: exactly the two approved archived captures (decoded SHA-256 ec088b3a... / 3d80dcd5..., the Wayback timestamps 20260911214553 / 20260210222101), as recorded in source-capture.json',
    payload.sources.length === 2 && payload.sources.find((s) => s.component === 'BAT').decoded_sha256 === BAT_SHA && payload.sources.find((s) => s.component === 'PITCH').decoded_sha256 === PITCH_SHA
      && payload.sources.every((s) => capture.files.some((f) => f.url === s.url && f.decoded_sha256 === s.decoded_sha256 && s.notes.includes(f.cdx_digest) && s.notes.includes(f.archived_payload_sha256)))
      && /20260911214553id_/.test(payload.sources.find((s) => s.component === 'BAT').url) && /20260210222101id_/.test(payload.sources.find((s) => s.component === 'PITCH').url)
      && payload.sources.every((s) => s.source_type === 'WAR_DATA_FILE' && s.source_tier === 'BASEBALL_REFERENCE'))
  check('rows: 54 for exactly eleven players, every season <= 2025 (no partial 2026), no deferred 2016-class or transaction-value player, no TOT row',
    payload.war.rows.length === 54 && new Set(payload.war.rows.map((r) => r[0])).size === 11 && payload.war.rows.every((r) => r[2] <= 2025 && r[3] !== 'TOT')
      && !payload.war.rows.some((r) => ['ariasga01', 'onajo01', 'garcilu04', 'moralfr02', 'garlajo01', 'grantmu01', 'versazo01', 'leyriji01'].includes(r[0])) && payload.observed_through_season === 2025)
  const plan = fs.readFileSync(path.join(TC, 'database/release/057-release-plan.md'), 'utf8')
  check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql)))

  // --- A: the released 001-056 (the production state), then 057
  const A0 = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A0, TBASE, base)
  console.log(`  001-056 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await A0.end()
  await copyDb('disi_a', 'disi_pre')
  const A = await connect('disi_a')
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } = inv
  const pre = await checkInvariants(q(A), CANONICAL_EXPECTATIONS); const fpre = failedChecks(pre)
  check(`the HEAD verifier on the PRE-057 state (production today): ${pre.hard.length - fpre.length}/${pre.hard.length} (057 moves no pin)`, fpre.length === 0 && pre.hard.length === 259, fpre.map((x) => x.name).join(', '))
  const S0 = { cat: await catalog(A), rows: await tableRows(A), gen: await generations(A), sup: await support(A), pred: await prediction(A), lab: await labels(A), reach: await reachEval(A) }
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), rows: await tableRows(A), gen: await generations(A), sup: await support(A), pred: await prediction(A), lab: await labels(A), reach: await reachEval(A) }
  check(`057 applies in one transaction (${ms} ms)`, true)
  check('additivity: every relation, column, ACL, RLS flag, option, owner, view definition, policy, trigger, enum and function body is identical', md5(S1.cat) === md5(S0.cat))
  const H0 = hashes(S0.rows), H1 = hashes(S1.rows)
  const changed = Object.keys(H1).filter((t) => H1[t].h !== H0[t]?.h && !SNAP.includes(t)).sort()
  check('only team-season WAR, outcomes, sources and the stored evaluation receive rows; every other table is byte-identical', JSON.stringify(changed) === JSON.stringify(WRITTEN), changed.join(','))
  const lostIn = (t) => { const s = new Set(S1.rows[t]); return S0.rows[t].filter((r) => !s.has(r)) }
  const lost = Object.keys(S0.rows).filter((t) => !SNAP.includes(t) && t !== 'outcomes').filter((t) => lostIn(t).length)
  const lostOutcomes = lostIn('outcomes').map((r) => JSON.parse(r))
  check('no existing row changed or disappeared, except the eleven outcomes whose NULL career bWAR is now set',
    lost.length === 0 && lostOutcomes.length === 11 && lostOutcomes.every((o) => o.career_war === null), `${lost.join(',')} outcomes:${lostOutcomes.length}`)
  const delta = (t) => S1.rows[t].length - S0.rows[t].length
  check('rows added: 54 team-season rows, 2 sources, 6 bWAR evaluation rows, 0 outcomes', [delta('player_mlb_team_season_war'), delta('sources'), delta('outcome_model_evaluations'), delta('outcomes')].join(',') === '54,2,6,0',
    [delta('player_mlb_team_season_war'), delta('sources'), delta('outcome_model_evaluations'), delta('outcomes')].join(','))
  const shape = (await rowsOf(A, `select count(*)::int as n, count(*) filter (where w.record_status = 'ACTIVE' and w.war_system = 'BWAR' and w.confidence = 'VERIFIED' and w.observed_through_season = 2025
      and w.organization_id is not null and w.player_id is not null)::int as ok, max(w.season)::int as last_season, count(distinct w.bref_id)::int as players,
      count(*) filter (where w.war is null)::int as null_war, count(*) filter (where w.war is null and w.note is null)::int as null_unexplained
    from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id where so.url like 'https://web.archive.org/web/2026%war_daily_%'`))[0]
  check('WAR shape: 54 ACTIVE BWAR VERIFIED rows, observed through 2025, last season 2025, organizations mapped, eleven players; the one NULL-WAR row is explained, never zero',
    shape.n === 54 && shape.ok === 54 && shape.last_season === 2025 && shape.players === 11 && shape.null_war === 1 && shape.null_unexplained === 0, JSON.stringify(shape))
  const dup = (await rowsOf(A, `select count(*)::int as n from (select bref_id, season, bref_team_code, stint_ordinal, component from public.player_mlb_team_season_war where record_status = 'ACTIVE'
    group by 1, 2, 3, 4, 5 having count(*) > 1) x`))[0].n
  const tot = (await rowsOf(A, `select count(*)::int as n from public.player_mlb_team_season_war where bref_team_code = 'TOT'`))[0].n
  const stints = await rowsOf(A, `select bref_id, season, string_agg(stint_ordinal || ':' || bref_team_code || ':' || war, ',' order by stint_ordinal) as s from public.player_mlb_team_season_war
    where record_status = 'ACTIVE' and component = 'BAT' and (bref_id, season) in (('sotoju01', 2022), ('taverle01', 2025), ('pachecr01', 2024)) group by 1, 2 order by 1`)
  check('team stints: one row per player, season, team, stint and component; no TOT row; Soto 2022 WSN + SDP, Taveras 2025 TEX + SEA, Pache 2024 PHI + BAL + MIA each counted once',
    dup === 0 && tot === 0 && JSON.stringify(stints.map((r) => r.s)) === JSON.stringify(['1:PHI:0.06,2:BAL:0.05,3:MIA:-0.32', '1:WSN:3.73,2:SDP:1.74', '1:TEX:0.05,2:SEA:-0.63']), JSON.stringify(stints))
  const sums = await rowsOf(A, `select pl.slug, sum(w.war)::text as s, oc.career_war::text as c from public.player_mlb_team_season_war w join public.players pl on pl.id = w.player_id
    join public.outcomes oc on oc.player_id = pl.id join public.sources so on so.id = w.source_id where so.url like 'https://web.archive.org/web/2026%war_daily_%' group by 1, 3 order by 1`)
  check('career bWAR = the sum of the loaded rows for each of the eleven (the 035 rule), equal to the reviewed values',
    sums.length === 11 && sums.every((r) => Number(r.s) === Number(r.c) && Number(r.c) === Number(payload.players.find((p) => p.slug === r.slug).career_bwar)), JSON.stringify(sums.map((r) => [r.slug, r.c])))
  const lab1 = (slug, t) => S1.lab.find((x) => x.player_slug === slug && x.target_key === t)
  const T = (t) => S1.lab.filter((x) => x.target_key === t && payload.players.some((p) => p.slug === x.player_slug))
  check('labels: positive bWAR 8 TRUE / 3 FALSE, 2+ bWAR 6 TRUE / 5 FALSE, each from its own window sum',
    T(BWAR[0]).filter((x) => x.label === true).length === 8 && T(BWAR[0]).filter((x) => x.label === false).length === 3
      && T(BWAR[1]).filter((x) => x.label === true).length === 6 && T(BWAR[1]).filter((x) => x.label === false).length === 5
      && payload.players.every((p) => lab1(p.slug, BWAR[0]).label === p.positive_bwar_label && Number(lab1(p.slug, BWAR[0]).w) === Number(p.window_bwar) && lab1(p.slug, BWAR[1]).label === p.bwar_2_label))
  const stillNull = [...payload.deferred_slugs, ...payload.identity_slugs]
  check('the four deferred 2016-class reachers and the three unresolved identities stay NULL (OUTCOME_UNAUDITED) for both bWAR targets',
    stillNull.every((s) => BWAR.every((t) => lab1(s, t)?.label === null && lab1(s, t)?.training_state === 'OUTCOME_UNAUDITED')))
  const s = (k) => S1.sup[k]
  check('support: benchmark positive bWAR 75 / 7 / 68 -> 86 / 15 / 71 BASELINE_SUPPORTED; 2+ bWAR 86 / 9 / 77 not supported',
    JSON.stringify([s(`${BWAR[0]}/TOP_PROSPECT_SAMPLE`), s(`${BWAR[1]}/TOP_PROSPECT_SAMPLE`)].map((x) => [x.labelled_n, x.positive_n, x.negative_n, x.support_state]))
      === JSON.stringify([[86, 15, 71, 'BASELINE_SUPPORTED'], [86, 9, 77, 'BASELINE_NOT_SUPPORTED']])
      && S0.sup[`${BWAR[0]}/TOP_PROSPECT_SAMPLE`].support_state === 'BASELINE_NOT_SUPPORTED' && S0.sup[`${BWAR[0]}/TOP_PROSPECT_SAMPLE`].labelled_n === 75)
  const unmoved = Object.keys(S0.sup).filter((k) => k.endsWith('DODGERS_TRACKED_AND_OPENING_CLASS') || k.startsWith('REACH_MLB_WITHIN_7_SEASONS/'))
  check('every Dodgers support row and the reach target are unchanged; thresholds unchanged (50 / 10 / 10, 10 events per feature)',
    unmoved.length === 5 && unmoved.every((k) => md5(S0.sup[k]) === md5(S1.sup[k]))
      && (await rowsOf(A, `select count(*)::int as n from public.outcome_targets where min_reference_n = 50 and min_positives = 10 and min_negatives = 10 and events_per_feature = 10`))[0].n === 4)
  check('reach evaluation byte-identical (86b58f47..., 173 rows / 34 positives / 7 folds)', md5(S1.reach) === md5(S0.reach) && S0.reach.length === 3)
  const ev = await rowsOf(A, `select target_key, model_key, evaluated_rows, positive_n, folds, decision, decision_reason, brier_skill_vs_base_rate::float8 as skill, evaluation_current
    from public.v_outcome_model_evaluation where target_key = any($1) order by 1, 2`, [BWAR])
  const e = (t, m) => ev.find((x) => x.target_key === t && x.model_key === m)
  check('bWAR evaluations stored and current (88 rows, 4 folds; 14 / 9 positives); stratified rate NO_SKILL_OVER_BASELINE (positive bWAR) / INSUFFICIENT_EVENTS (2+ bWAR), logistic INSUFFICIENT_EVENTS',
    ev.length === 6 && ev.every((x) => x.evaluated_rows === 88 && x.folds === 4 && x.evaluation_current && x.decision !== 'MODEL_SUPPORTED')
      && e(BWAR[0], 'BASE_RATE').positive_n === 14 && e(BWAR[1], 'BASE_RATE').positive_n === 9
      && /^NO_SKILL_OVER_BASELINE/.test(e(BWAR[0], 'POPULATION_STRATIFIED_RATE').decision_reason) && e(BWAR[0], 'POPULATION_STRATIFIED_RATE').skill <= 0
      && /^INSUFFICIENT_EVENTS: 14 positives for 6 feature/.test(e(BWAR[0], 'LOGISTIC_L2').decision_reason)
      && /^INSUFFICIENT_EVENTS: 9 positives for 1 feature/.test(e(BWAR[1], 'POPULATION_STRATIFIED_RATE').decision_reason), JSON.stringify(ev.map((x) => [x.target_key, x.model_key, x.positive_n, x.skill, x.decision])))
  check('BASELINE SUPPORTED != MODEL SUPPORTED, BENCHMARK SUPPORT != DODGERS SUPPORT: 0 supported models, probabilities, eligible rows, Dodgers targets, expected values, recommendations; overlap 0',
    S1.pred.supported_models === 0 && S1.pred.fitted === 0 && S1.pred.probabilities === 0 && S1.pred.eligible === 0 && S1.pred.targets === 0 && S1.pred.ev === 0 && S1.pred.recs === 0
      && S1.pred.overlap === 0 && S1.pred.current === true && S1.pred.evaluations === 9, JSON.stringify(S1.pred))
  const rd = Object.fromEntries((await rowsOf(A, `select target_key || '/' || reference_population as k, readiness_state from public.product_prediction_readiness`)).map((x) => [x.k, x.readiness_state]))
  check('product: readiness shows positive bWAR SUPPORTED for the benchmark sample only; every Dodgers row NOT_SUPPORTED',
    rd[`${BWAR[0]}/TOP_PROSPECT_SAMPLE`] === 'SUPPORTED' && rd[`${BWAR[1]}/TOP_PROSPECT_SAMPLE`] === 'NOT_SUPPORTED'
      && Object.entries(rd).filter(([k]) => k.endsWith('DODGERS_TRACKED_AND_OPENING_CLASS')).every(([, v]) => v === 'NOT_SUPPORTED'), JSON.stringify(rd))
  check('one snapshot refresh: every snapshot in one new generation, zero drift', S1.gen.every((g) => g.length === 1 && g[0] === S0.gen[0][0] + 1) && (await drift(A)).length === 0, JSON.stringify(S1.gen[0]))
  const post = await checkInvariants(q(A), CANONICAL_EXPECTATIONS); const fpost = failedChecks(post)
  check(`HEAD verifier after 057: ${post.hard.length - fpost.length}/${post.hard.length}`, fpost.length === 0 && post.hard.length === 259, fpost.map((x) => x.name).join(', '))
  await apply(A, TC, [FILE])
  check('057 exact idempotency (every row, definition, ACL, policy, function; no second refresh)', md5({ cat: await catalog(A), rows: await tableRows(A) }) === md5({ cat: S1.cat, rows: S1.rows }))
  await A.end()

  // --- guards on copies of the pre-057 state
  const guard = async (name, mutate, pattern, migration = sql) => {
    const db = `disi_g${results.length}`
    await copyDb('disi_pre', db)
    const G = await connect(db)
    let msg = ''
    try { if (mutate) await G.query(mutate); await G.query(migration) } catch (err) { msg = err.message; await G.query('rollback').catch(() => {}) }
    await G.end()
    check(name, pattern.test(msg), msg.slice(0, 140))
  }
  await guard('guard: a source whose decoded SHA-256 differs is refused', null, /057: the sources are not the two approved archived Baseball-Reference captures/, sql.replace(BAT_SHA, '0'.repeat(64)))
  await guard('guard: a deferred 2016-class reacher in the rows is refused', null, /057: the scope is not exactly the eleven approved complete-window players/,
    sql.replace('"deferred_bref_ids":["ariasga01"', '"deferred_bref_ids":["sotoju01"'))
  await guard('guard: an existing different career bWAR is never overwritten', `update public.outcomes o set career_war = 1.23 from public.players p where p.id = o.player_id and p.slug = 'juan-soto'`,
    /057: juan-soto already carries a different career bWAR/)
  await guard('guard: other active team-season evidence for an approved player is refused', `insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id,
      stint_ordinal, component, war, games, source_id, observed_through_date, observed_through_season, retrieved_at, confidence)
    select 'sotoju01', '665742', p.id, 2018, 'WSN', (select organization_id from public.bref_team_code_map where bref_team_code = 'WSN'), 1, 'BAT', 3.00, 116, so.id, '2026-09-28', 2026, now(), 'VERIFIED'
    from public.players p, public.sources so where p.slug = 'juan-soto' and so.url = 'https://www.baseball-reference.com/data/war_daily_bat.txt'`, /057: juan-soto already has active team-season bWAR from another source/)
  await guard('guard: a changed threshold is refused', `update public.outcome_targets set min_positives = 11 where target_key = 'POSITIVE_BWAR_WITHIN_10_SEASONS'`, /057: the outcome-target thresholds are not the 041 ones/)
  await guard('guard: a stored reach evaluation that is not the 056 one is refused', `update public.outcome_model_evaluations set training_fingerprint = '00000000000000000000000000000000'`,
    /057: the stored reach evaluation is not the current 056 one/)
  await guard('guard: a player with both a Dodgers and a benchmark signing is refused', `insert into public.signings (player_id, organization_id, signing_year, pathway, bonus_publicly_reported, record_scope)
    select p.id, o.id, 2026, 'OTHER', false, 'TRACKED' from public.players p, public.organizations o where p.slug = 'jasson-dominguez' and o.abbreviation = 'LAD'`,
    /057: a player holds both a Dodgers signing and a benchmark signing/)
  await guard('guard: a database without 056 is refused', `delete from public.signing_population_member_sources where member_id in (select m.id from public.signing_population_members m
      join public.signing_populations sp on sp.id = m.population_id where sp.population_key = 'MLB-2019-PIPELINE-TOP30');
    delete from public.signing_population_members where population_id in (select id from public.signing_populations where population_key = 'MLB-2019-PIPELINE-TOP30');
    delete from public.signing_populations where population_key = 'MLB-2019-PIPELINE-TOP30'`,
    /057: Migrations through 056 have not been applied/)

  // --- B: rollback on a copy of the post-057 state
  await copyDb('disi_a', 'disi_b')
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  check(`rollback-057 commits in one transaction (${rms} ms)`, true)
  const SB = { cat: await catalog(B), rows: await tableRows(B), gen: await generations(B), sup: await support(B), pred: await prediction(B), lab: await labels(B), reach: await reachEval(B) }
  const HB = hashes(SB.rows)
  const rdiff = Object.keys(H0).filter((t) => !SNAP.includes(t) && !['sources', 'player_mlb_team_season_war'].includes(t) && HB[t]?.h !== H0[t].h)
  check('after rollback every table equals the pre-057 state row for row (the sources stay as provenance; WAR rows are retracted, never deleted)', rdiff.length === 0, rdiff.join(','))
  const warB = await rowsOf(B, `select (to_jsonb(w) - 'updated_at')::text as r from public.player_mlb_team_season_war w where w.record_status = 'ACTIVE'`)
  const retracted = await rowsOf(B, `select count(*)::int as n, count(*) filter (where retraction_reason like 'Rollback of Migration 057%')::int as r from public.player_mlb_team_season_war where record_status = 'RETRACTED'`)
  check('after rollback the ACTIVE team-season rows are exactly the pre-057 rows; the 54 057 rows are RETRACTED with the rollback reason',
    md5(warB.map((r) => r.r).sort()) === md5(S0.rows.player_mlb_team_season_war) && retracted[0].n === 54 && retracted[0].r === 54, JSON.stringify(retracted[0]))
  check('after rollback the catalog, support, labels, reach evaluation and prediction state equal the pre-057 state',
    md5(SB.cat) === md5(S0.cat) && md5(SB.sup) === md5(S0.sup) && md5(SB.lab) === md5(S0.lab) && md5(SB.reach) === md5(S0.reach) && SB.pred.evaluations === 3 && SB.pred.current === true)
  check('after rollback one new generation, zero drift', SB.gen.every((g) => g.length === 1 && g[0] === S1.gen[0][0] + 1) && (await drift(B)).length === 0)
  let again = ''
  try { await B.query(rbSql) } catch (err) { again = err.message; await B.query('rollback').catch(() => {}) }
  check('a second rollback refuses (057 is no longer applied)', /rollback-057: Migration 057 is not applied/.test(again), again.slice(0, 100))
  const rv = await checkInvariants(q(B), CANONICAL_EXPECTATIONS); const frv = failedChecks(rv)
  check(`the HEAD verifier after rollback: ${rv.hard.length - frv.length}/${rv.hard.length}`, frv.length === 0, frv.map((x) => x.name).join(', '))
  await apply(B, TC, [FILE])
  const SR = { sup: await support(B), lab: await labels(B), pred: await prediction(B), reach: await reachEval(B) }
  const evOf = async (c) => rowsOf(c, `select target_key, model_key, training_fingerprint, decision, brier_score::text from public.outcome_model_evaluations order by 1, 2`)
  const C1 = await connect('disi_a')
  const evA = await evOf(C1); await C1.end()
  check('reapplying 057 after its rollback reproduces the same support, labels, evaluations and prediction state',
    md5(SR.sup) === md5(S1.sup) && md5(SR.lab) === md5(S1.lab) && md5(await evOf(B)) === md5(evA) && md5(SR.reach) === md5(S1.reach) && md5({ ...SR.pred }) === md5({ ...S1.pred }))
  const rep = await checkInvariants(q(B), CANONICAL_EXPECTATIONS); const frep = failedChecks(rep)
  check(`057 can be applied again after its rollback: the HEAD verifier passes ${rep.hard.length - frep.length}/${rep.hard.length}`, frep.length === 0, frep.map((x) => x.name).join(', '))
  let dep = ''
  await B.query(`update public.outcomes o set career_war = 9.99 from public.players p where p.id = o.player_id and p.slug = 'juan-soto'`)
  try { await B.query(rbSql) } catch (err) { dep = err.message; await B.query('rollback').catch(() => {}) }
  check('rollback refuses when later research depends on the 057 evidence', /rollback-057: later research depends on the 057 evidence/.test(dep), dep.slice(0, 100))
  await B.end()
} catch (err) {
  check('validator ran to completion', false, err.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
