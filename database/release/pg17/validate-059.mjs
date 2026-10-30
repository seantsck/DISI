// Independent validation of migration 059 (career bWAR metric reconciliation) on a disposable, real PostgreSQL 17 server (embedded-postgres, scratchpad
// only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-058, frozen), tcand = the
// candidate (default HEAD, or the working tree with CANDIDATE=WORKTREE). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-059.mjs <work-dir>     (run-059.sh prepares the work dir)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
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
const check = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${String(results.length).padStart(2, '0')}. ${name}${detail ? ' - ' + detail : ''}`) }

const FILE = '059_career_bwar_metric_reconciliation.sql'
const FILE058 = '058_transaction_return_bwar_evidence.sql'
const ROLLBACK = 'database/release/sql/rollback-059.sql'
const BAT_URL = 'https://www.baseball-reference.com/data/war_daily_bat.txt'
const FPS = '102c01a35d380d36493465cef1070c07,1aa73185a9dab3071d4530ee670dd088,86b58f473301e2425751d853abd88e94'
const EXPECTED = { 'rafael-devers': '30.6', 'gleyber-torres': '20.9', 'eloy-jimenez': '5.2', 'huascar-ynoa': '1.1', 'marcos-diplan': '0.4', 'dermis-garcia': '0.5',
  'lewin-diaz': '0.1', 'anderson-espinoza': '0.0', 'hyo-jun-park': '-0.6', 'jose-herrera': '-0.7', 'diego-castillo': '-0.8' }
const ELEVEN = Object.keys(EXPECTED).sort()
const SNAP_DROP = ['generation_id', 'refreshed_at', 'created_at', 'generated_at', 'snapshot_at', 'id', 'updated_at']
// hosted parity: production sets statement_timeout = 2min for every session; the disposable server does the same (059 / rollback-059 raise their own
// limit with SET LOCAL '600s', which must apply inside their transaction only)
const HOSTED_STATEMENT_TIMEOUT = '2min'
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {}, postgresFlags: ['-c', `statement_timeout=${HOSTED_STATEMENT_TIMEOUT}`] })
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
// runs a SQL file with psql -X -v ON_ERROR_STOP=1 against a database of the disposable server
// in one session: SHOW statement_timeout, the file, SHOW statement_timeout (the session default before and after; a SET LOCAL must not leak)
const psql = (db, file) => new Promise((resolve) => {
  const show = "select 'SESSION_STATEMENT_TIMEOUT=' || current_setting('statement_timeout') as t"
  const p = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-h', 'localhost', '-p', String(port), '-U', 'postgres', '-d', db, '-c', show, '-f', file, '-c', show],
    { env: { ...process.env, PGPASSWORD: 'postgres' } })
  let out = ''; p.stdout.on('data', (d) => { out += d }); p.stderr.on('data', (d) => { out += d })
  p.on('close', (code) => {
    const seen = [...out.matchAll(/SESSION_STATEMENT_TIMEOUT=(\S+)/g)].map((m) => m[1])
    resolve({ code, out, before: seen[0] ?? null, after: seen.length > 1 ? seen[seen.length - 1] : null })
  })
})
const rowsOf = async (c, sql, params) => (await c.query(sql, params)).rows
const q = (c) => async (sql, params) => rowsOf(c, sql, params)
let SNAP = []
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
  cols: await rowsOf(c, `select table_name, column_name, data_type, ordinal_position, column_default, is_nullable from information_schema.columns where table_schema = 'public' order by 1, 4`),
  cons: await rowsOf(c, `select conrelid::regclass::text as t, conname, contype, pg_get_constraintdef(oid) as d from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2`),
  pol: await rowsOf(c, `select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2`),
  fn: await rowsOf(c, `select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '') as cfg, md5(p.prosrc) as h
    from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  trg: await rowsOf(c, `select c.relname, t.tgname, t.tgenabled, md5(pg_get_triggerdef(t.oid)) as d from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
  enums: await rowsOf(c, `select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as v from pg_enum e join pg_type t on t.oid = e.enumtypid group by 1 order by 1`),
})
const drift = (c) => rowsOf(c, `select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)
const generations = async (c) => Promise.all(SNAP.map(async (t) => (await rowsOf(c, `select coalesce(array_agg(distinct generation_id), '{}') as g from public.${t}`))[0].g.map(Number)))
const snapContent = async (c) => Object.fromEntries(await Promise.all(SNAP.map(async (t) => [t, md5((await rowsOf(c,
  `select (to_jsonb(t) ${SNAP_DROP.map((k) => `- '${k}'`).join(' ')})::text as r from public.${t} t`)).map((r) => r.r).sort())])))
const viewRows = async (c, v) => (await rowsOf(c, `select to_jsonb(t)::text as r from public.${v} t`)).map((r) => r.r).sort()
const mkVerifier = (inv) => async (c, exp) => { const r = await inv.checkInvariants(q(c), exp); const f = inv.failedChecks(r); return { total: r.hard.length, ok: r.hard.length - f.length, names: f.map((x) => x.name) } }
const equalJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const total = (rows) => rows.reduce((s, r) => s + r.items, 0)
const obsRows = async (c) => (await rowsOf(c, `select to_jsonb(m)::text as r from public.player_metric_observations m`)).map((r) => r.r).sort()
const missing = async (c) => (await rowsOf(c, `select player_slug, franchise_key from public.v_research_tasks where task_type = 'BWAR_MISSING' order by 1`))
const careerCount = async (c) => (await rowsOf(c, `select count(*)::int as n from public.player_metric_observations where metric_key = 'CAREER_BWAR'`))[0].n
const srcCount = async (c) => (await rowsOf(c, `select count(*)::int as n from public.sources`))[0].n
const PRED_VIEWS = ['v_outcome_training_population', 'v_outcome_feature_matrix', 'v_outcome_target_support', 'v_outcome_model_evaluation', 'v_player_outcome_probability', 'v_expected_value_support']
const VALUE_VIEWS = ['v_player_realized_organizational_value', 'v_transaction_asset_lineage', 'v_transaction_research_queue', 'v_value_research_queue', 'v_executive_overview']
const viewHashes = async (c, vs) => Object.fromEntries(await Promise.all(vs.map(async (v) => [v, md5(await viewRows(c, v))])))
const diffKeys = (a, b) => Object.keys({ ...a, ...b }).filter((k) => !equalJson(a[k], b[k])).sort()

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  SNAP = []
  const psqlv = await new Promise((r) => { const p = spawn('psql', ['--version']); let o = ''; p.stdout.on('data', (d) => { o += d }); p.on('close', () => r(o.trim())) })
  console.log(`client: ${psqlv}`)

  // --- identity: manifest, frozen history, file hygiene
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  sha1(LF) ${sha1(sql.replace(/\r\n/g, '\n'))}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-059.sql: sha256 ${sha256(rbSql)}  sha1(LF) ${sha1(rbSql.replace(/\r\n/g, '\n'))}  ${Buffer.byteLength(rbSql)} bytes`)
  const tmp = path.join(WORK, 'sql059'); fs.mkdirSync(tmp, { recursive: true })
  const F059 = path.join(tmp, 'migration-059.sql'), R059 = path.join(tmp, 'rollback-059.sql')
  fs.writeFileSync(F059, sql); fs.writeFileSync(R059, rbSql)
  const identityOk = base.length === 62 && base.at(-1) === FILE058 && cand.length === 63 && equalJson(cand, [...base, FILE])
    && base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f)) && Object.keys(frozen).length === 62 && !(FILE in frozen)
  check('identity: baseline manifest = 001-058 (62 files), candidate = baseline + 059 (63), forward-only; 001-058 byte-identical and match the 62 frozen hashes; 059 not frozen', identityOk)

  // --- A: the released 001-058 (the production state)
  const A0 = await freshDb('disi_a')
  let t0 = Date.now()
  let replayOk = true, replayErr = ''
  try { await apply(A0, TBASE, base) } catch (e) { replayOk = false; replayErr = e.message }
  check(`canonical chain 001-058 replays on PG17 (${((Date.now() - t0) / 1000).toFixed(1)}s)`, replayOk, replayErr.slice(0, 200))
  if (!replayOk) throw new Error('replay failed')
  await A0.end()
  const A = await connect('disi_a')
  SNAP = (await rowsOf(A, `select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname like 'product\\_%' order by 1`)).map((r) => r.relname)
  console.log(`  product snapshot tables (${SNAP.length}): ${SNAP.join(', ')}`)
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { CANONICAL_EXPECTATIONS } = inv
  const verify = mkVerifier(inv)
  const { measure } = await import(pathToFileURL(path.join(TC, 'database/research/059/measure.mjs')).href)
  const evidence = JSON.parse(fs.readFileSync(path.join(TC, 'database/research/059/career-bwar-evidence.json'), 'utf8'))
  const scope = JSON.parse(fs.readFileSync(path.join(TC, 'database/research/059/scope.json'), 'utf8'))
  const excluded = scope.excluded_057.map((x) => x.slug).sort()
  const ev = Object.fromEntries(evidence.players.map((p) => [p.slug, p]))

  const snapState = async (c) => ({ cat: await catalog(c), rows: await tableRows(c), gen: await generations(c), m: await measure(q(c)), snap: await snapContent(c),
    pred: await viewHashes(c, PRED_VIEWS), val: await viewHashes(c, VALUE_VIEWS), miss: await missing(c), n: await careerCount(c), src: await srcCount(c), obs: await obsRows(c) })
  const S0 = await snapState(A)
  const pre = await verify(A, CANONICAL_EXPECTATIONS)
  const have = (await rowsOf(A, `select pl.slug from public.player_metric_observations m join public.players pl on pl.id = m.player_id where pl.slug = any($1)`, [[...ELEVEN, ...excluded]]))
  const tasks0 = S0.m.research_task_types.find((x) => x.task_type === 'BWAR_MISSING')?.items
  check(`pre-state: 47 CAREER_BWAR observations, BWAR_MISSING 50 (v_research_tasks and measure), none of the 11 or the 057 eleven has an observation, sources ${S0.src}, drift 0, verifier ${pre.ok}/${pre.total}`,
    S0.n === 47 && S0.miss.length === 50 && tasks0 === 50 && have.length === 0 && excluded.length === 11 && ELEVEN.length === 11 && (await drift(A)).length === 0 && pre.names.length === 0 && pre.total === 259,
    `n=${S0.n} missing=${S0.miss.length} have=${have.length} sources=${S0.src} ${pre.names.join(',')}`)
  const scopeOk = equalJson(Object.keys(ev).sort(), ELEVEN) && ELEVEN.every((s) => Number(ev[s].career_bwar) === Number(EXPECTED[s])) && equalJson(scope.players.map((p) => p.slug).sort(), ELEVEN)
  check('research evidence: career-bwar-evidence.json and scope.json list exactly the 11 players with the 11 specified values', scopeOk)

  // --- apply 059 with psql
  t0 = Date.now()
  const ap = await psql('disi_a', F059)
  check(`apply 059 with psql -X -v ON_ERROR_STOP=1: exit ${ap.code}, COMMIT (${Date.now() - t0} ms)`, ap.code === 0 && /^COMMIT$/m.test(ap.out) && !/ROLLBACK|ERROR/.test(ap.out), ap.out.trim().split('\n').slice(-3).join(' | '))
  check(`hosted parity on apply: session statement_timeout ${ap.before} before and ${ap.after} after (the migration's SET LOCAL 600s did not leak)`,
    ap.before === HOSTED_STATEMENT_TIMEOUT && ap.after === HOSTED_STATEMENT_TIMEOUT && /^SET$/m.test(ap.out), `before=${ap.before} after=${ap.after}`)
  const S1 = await snapState(A)

  // 4: exactly 11 new rows, only for the 11 slugs, no other row changed
  const pre0 = new Set(S0.obs), post1 = new Set(S1.obs)
  const removed = S0.obs.filter((r) => !post1.has(r)), added = S1.obs.filter((r) => !pre0.has(r)).map((r) => JSON.parse(r))
  const idSlug = Object.fromEntries((await rowsOf(A, `select id, slug from public.players`)).map((r) => [r.id, r.slug]))
  const addedSlugs = added.map((r) => idSlug[r.player_id]).sort()
  check('exactly 11 new player_metric_observations rows (CAREER_BWAR, one per slug, only the 11 slugs); no pre-existing observation row changed or disappeared',
    added.length === 11 && removed.length === 0 && S1.obs.length === S0.obs.length + 11 && equalJson(addedSlugs, ELEVEN) && added.every((r) => r.metric_key === 'CAREER_BWAR'), `added ${added.length} removed ${removed.length}`)

  // 5/6: exact values and fields
  const vals = Object.fromEntries(added.map((r) => [idSlug[r.player_id], r]))
  const batSrc = (await rowsOf(A, `select id from public.sources where url = $1`, [BAT_URL]))
  const valBad = ELEVEN.filter((s) => !vals[s] || Number(vals[s].value) !== Number(EXPECTED[s]) || String(Number(vals[s].value)) !== String(Number(EXPECTED[s])))
  check('exact values per player (numeric equality): ' + ELEVEN.map((s) => `${s} ${EXPECTED[s]}`).join(', '), valBad.length === 0 && ELEVEN.every((s) => vals[s]), valBad.join(','))
  const fieldBad = ELEVEN.filter((s) => { const r = vals[s]; return !r || r.observed_through_date !== '2026-09-28' || r.observed_through_season !== 2026 || batSrc.length !== 1 || r.source_id !== batSrc[0].id
    || r.confidence !== 'VERIFIED' || r.notes !== ev[s].notes })
  check('every row: observed_through_date 2026-09-28, season 2026, source = the live batting-file source (single sources row), confidence VERIFIED, notes exactly as built; sources count unchanged',
    fieldBad.length === 0 && S1.src === S0.src, `${fieldBad.join(',')} sources ${S0.src}->${S1.src}`)

  // 7: BWAR_MISSING
  const m0 = S0.miss.map((r) => r.player_slug), m1 = S1.miss.map((r) => r.player_slug)
  const gone = m0.filter((s) => !m1.includes(s)).sort()
  const goneRows = S0.miss.filter((r) => gone.includes(r.player_slug))
  check('BWAR_MISSING 50 -> 39: exactly the 11 slugs removed, the other 39 identical, all 11 benchmark (franchise_key <> DODGERS), nothing added',
    m0.length === 50 && m1.length === 39 && equalJson(gone, ELEVEN) && m1.every((s) => m0.includes(s)) && goneRows.length === 11 && goneRows.every((r) => r.franchise_key !== 'DODGERS')
      && equalJson(S1.miss, S0.miss.filter((r) => !gone.includes(r.player_slug))) && S1.m.research_task_types.find((x) => x.task_type === 'BWAR_MISSING').items === 39)

  // 8: outcomes
  check('outcomes table byte-identical (row set)', equalJson(S0.rows.outcomes, S1.rows.outcomes) && S0.rows.outcomes.length > 0, `${S1.rows.outcomes.length} rows`)

  // 9: prediction
  const p1 = S1.m.prediction
  const evalRows = equalJson(S0.rows.outcome_model_evaluations, S1.rows.outcome_model_evaluations)
  check('prediction unchanged: the six prediction views and outcome_model_evaluations rows identical; prediction fingerprints identical; evaluation fingerprints = 102c01a3.../1aa73185.../86b58f47...; 0 supported models, probabilities, expected values, recommendations',
    equalJson(S0.pred, S1.pred) && evalRows && equalJson(S0.m.prediction, p1) && p1.evaluation_fingerprints === FPS && p1.supported_models === 0 && p1.probabilities === 0 && p1.expected_values === 0 && p1.recommendations === 0,
    JSON.stringify(p1))

  // 10: transaction/value
  const act = (s) => s.rows.player_mlb_team_season_war
  const vt1 = S1.m.value_totals
  check('transaction/value unchanged: team-season WAR rows identical (2025 ACTIVE), realized value, lineage, transaction queue (57), value queue (90), executive overview identical; realized 299.00 / 88',
    equalJson(act(S0), act(S1)) && equalJson(S0.val, S1.val) && equalJson(S0.m.value_totals, vt1) && equalJson(S0.m.executive, S1.m.executive) && total(S1.m.transaction_queue) === 57 && total(S1.m.value_queue) === 90
      && vt1.realized === '299.00' && vt1.resolved === 88 && S1.m.war.active === 2025, JSON.stringify([vt1.realized, vt1.resolved, S1.m.war.active, total(S1.m.transaction_queue), total(S1.m.value_queue)]))

  // 11: verifier
  const post = await verify(A, CANONICAL_EXPECTATIONS)
  check(`HEAD verifier before ${pre.ok}/${pre.total} and after 059 ${post.ok}/${post.total}`, post.names.length === 0 && post.total === 259 && pre.total === 259 && pre.names.length === 0, post.names.join(', '))

  // 12: snapshots
  const nonSnapChanged = Object.keys(S1.rows).filter((t) => !SNAP.includes(t) && t !== 'player_metric_observations' && !equalJson(S0.rows[t], S1.rows[t]))
  const snapChanged = SNAP.filter((t) => S0.snap[t] !== S1.snap[t])
  const cntGen = await Promise.all(SNAP.map(async (t) => (await rowsOf(A, `select count(distinct generation_id)::int as n from public.${t}`))[0].n))
  check(`snapshots: all ${SNAP.length} tables at one new generation (S0 + 1), zero drift; business content (minus generation, ids and timestamps) identical in every product_* table; no other table changed`,
    S0.gen.every((x) => x.length === 1) && S1.gen.every((x) => x.length === 1 && x[0] === S0.gen[0][0] + 1) && cntGen.every((n) => n === 1) && (await drift(A)).length === 0
      && snapChanged.length === 0 && nonSnapChanged.length === 0, `gen ${S0.gen[0]}->${S1.gen[0]} snapChanged:${snapChanged.join(',')} otherChanged:${nonSnapChanged.join(',')}`)

  // 17 (part a): catalog after
  check('schema/security catalog identical before vs after 059 (relations, columns, constraints, ACLs, RLS, views, functions incl. bodies, policies, triggers, enums)', md5(S0.cat) === md5(S1.cat), diffKeys(S0.cat, S1.cat).join(','))

  // 13: idempotent rerun
  const ap2 = await psql('disi_a', F059)
  const S1b = { rows: await tableRows(A), gen: await generations(A), cat: await catalog(A) }
  check('idempotent rerun of 059: commits, every table (including snapshots) identical, generation unchanged, catalog identical',
    ap2.code === 0 && /^COMMIT$/m.test(ap2.out) && equalJson(S1b.rows, S1.rows) && equalJson(S1b.gen, S1.gen) && md5(S1b.cat) === md5(S1.cat), ap2.out.trim().split('\n').slice(-2).join(' | '))
  await A.end()

  // --- copies of the post-059 state
  await copyDb('disi_a', 'disi_b')
  await copyDb('disi_a', 'disi_g')

  // 14: rollback
  const B = await connect('disi_b')
  t0 = Date.now()
  const rb = await psql('disi_b', R059)
  const SB = await snapState(B)
  const lostB = Object.keys(S0.rows).filter((t) => !SNAP.includes(t) && !equalJson(S0.rows[t], SB.rows[t]))
  check(`rollback-059 commits (${Date.now() - t0} ms): 11 rows deleted, CAREER_BWAR back to 47, BWAR_MISSING back to 50 with the original 50 slugs, every other table (including player_metric_observations) identical to the pre-059 state, generation +1, drift 0, catalog identical`,
    rb.code === 0 && /^COMMIT$/m.test(rb.out) && SB.n === 47 && S1.obs.length - SB.obs.length === 11 && equalJson(SB.obs, S0.obs) && equalJson(SB.miss, S0.miss) && SB.miss.length === 50
      && lostB.length === 0 && SB.snap && equalJson(SB.snap, S0.snap) && SB.gen.every((x) => x.length === 1 && x[0] === S1.gen[0][0] + 1) && (await drift(B)).length === 0 && md5(SB.cat) === md5(S0.cat)
      && equalJson(SB.pred, S0.pred) && equalJson(SB.val, S0.val),
    `${rb.out.trim().split('\n').slice(-2).join(' | ')} diff:${lostB.join(',')}`)
  check(`hosted parity on rollback: session statement_timeout ${rb.before} before and ${rb.after} after (rollback-059's SET LOCAL 600s did not leak)`,
    rb.before === HOSTED_STATEMENT_TIMEOUT && rb.after === HOSTED_STATEMENT_TIMEOUT && /^SET$/m.test(rb.out), `before=${rb.before} after=${rb.after}`)
  const HB = hashes(await tableRows(B))
  const rb2 = await psql('disi_b', R059)
  const HB2 = hashes(await tableRows(B))
  check('second rollback refuses (059 is not applied) and changes nothing', rb2.code !== 0 && /rollback-059: Migration 059 is not applied/.test(rb2.out) && equalJson(HB, HB2), rb2.out.trim().split('\n').slice(-2).join(' | ').slice(0, 160))
  await B.end()

  // 15/16: guarded refusal on a copy of the post-059 state
  const G = await connect('disi_g')
  const full = async () => hashes(await tableRows(G))
  const refuse = async (label, pattern) => {
    const before = await full(); const r = await psql('disi_g', R059); const after = await full()
    check(`guarded refusal: ${label} -> rollback-059 fails and every table hash is unchanged`, r.code !== 0 && pattern.test(r.out) && equalJson(before, after), r.out.trim().split('\n').slice(-2).join(' | ').slice(0, 170))
  }
  const SG = await snapState(G)
  check('guard setup: copy of the post-059 state equals the first post-059 state', equalJson(SG.rows, S1.rows))
  await G.query(`insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence, notes)
    select p.id, 'CAREER_BWAR', 31.0, date '2027-10-01', 2027, s.id, 'VERIFIED', 'validator guard' from public.players p, public.sources s where p.slug = 'rafael-devers' and s.url = $1`.replace('$1', `'${BAT_URL}'`))
  await refuse('a later CAREER_BWAR observation for rafael-devers (2027-10-01) exists', /rollback-059: a CAREER_BWAR observation of the eleven is not the released 059 observation/)
  await G.query(`delete from public.player_metric_observations where notes = 'validator guard'`)
  check('guard cleanup: the test observation deleted, state equals the first post-059 state', equalJson(await tableRows(G), S1.rows))
  await G.query(`update public.player_metric_observations m set value = 30.7 from public.players p where p.id = m.player_id and p.slug = 'rafael-devers' and m.metric_key = 'CAREER_BWAR'`)
  await refuse('a 059 row (rafael-devers) has a changed value 30.7', /rollback-059: a CAREER_BWAR observation of the eleven is not the released 059 observation/)
  await G.query(`update public.player_metric_observations m set value = 30.6 from public.players p where p.id = m.player_id and p.slug = 'rafael-devers' and m.metric_key = 'CAREER_BWAR'`)
  check('guard restore: the 059 row restored, state equals the first post-059 state', equalJson(await tableRows(G), S1.rows))
  const rbG = await psql('disi_g', R059)
  const rpG = await psql('disi_g', F059)
  const SG2 = await snapState(G)
  const logical = async (c) => { const t = await tableRows(c, SNAP_DROP); return t }
  const L1 = await logical(G)
  // logical comparison of the first post-059 state: rebuild it from the copy's twin disi_b (rolled back) is not needed; compare against S1 with the same drops
  const A2 = await connect('disi_a'); const L0 = await logical(A2); await A2.end()
  check('after restoring: rollback then reapply 059 both commit; the reapplied state equals the first post-059 state logically (ignoring surrogate ids, created_at and generation); generation = restored + 2; drift 0; catalog identical',
    rbG.code === 0 && rpG.code === 0 && equalJson(L1, L0) && SG2.gen.every((x) => x.length === 1 && x[0] === S1.gen[0][0] + 2) && (await drift(G)).length === 0 && md5(SG2.cat) === md5(S0.cat)
      && SG2.n === 47 + 11 && equalJson(SG2.miss, S1.miss) && equalJson(SG2.pred, S1.pred) && equalJson(SG2.val, S1.val),
    `${rbG.code}/${rpG.code} gen ${SG2.gen[0]}`)
  const vG = await verify(G, CANONICAL_EXPECTATIONS)
  check(`HEAD verifier after rollback and reapply: ${vG.ok}/${vG.total}`, vG.names.length === 0 && vG.total === 259, vG.names.join(', '))
  await G.end()
} catch (err) {
  check('validator ran to completion', false, err.stack || err.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
