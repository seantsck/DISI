// Independent validation of migration 058 (transaction-return bWAR evidence) on a disposable, real PostgreSQL 17 server (embedded-postgres, scratchpad
// only). Sources come from git archives: tbase = the released baseline (default origin/main: 001-057, frozen), tcand = the
// candidate (default HEAD, or the working tree with CANDIDATE=WORKTREE). Never touches a hosted database: no connection string is read.
//
//   node database/release/pg17/validate-058.mjs <work-dir>     (run-058.sh prepares the work dir)
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

const FILE = '058_transaction_return_bwar_evidence.sql'
const ROLLBACK = 'database/release/sql/rollback-058.sql'
const FILE057 = '057_benchmark_bwar_evidence.sql'
const BAT_SHA = 'ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023'
const PITCH_SHA = '3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825'
const FOUR = ['garlajo01', 'leyriji01', 'grantmu01', 'versazo01']
const FPS = '102c01a35d380d36493465cef1070c07,1aa73185a9dab3071d4530ee670dd088,86b58f473301e2425751d853abd88e94'
const SRC_LIKE = 'https://web.archive.org/web/2026%war_daily_%'
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
const SNAP_DROP = ['generation_id', 'refreshed_at', 'created_at', 'generated_at', 'snapshot_at']
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
const activeWar = async (c) => (await rowsOf(c, `select (to_jsonb(w) - 'updated_at')::text as r from public.player_mlb_team_season_war w where record_status = 'ACTIVE'`)).map((r) => r.r).sort()
const snapContent = async (c) => Object.fromEntries(await Promise.all(SNAP.map(async (t) => [t, md5((await rowsOf(c,
  `select (to_jsonb(t) ${SNAP_DROP.map((k) => `- '${k}'`).join(' ')})::text as r from public.${t} t`)).map((r) => r.r).sort())])))
const mkVerifier = (inv) => async (c, exp) => { const r = await inv.checkInvariants(q(c), exp); const f = inv.failedChecks(r); return { total: r.hard.length, ok: r.hard.length - f.length, names: f.map((x) => x.name) } }
const byIssue = (rows) => Object.fromEntries(rows.map((r) => [r.issue, r.items]))
const total = (rows) => rows.reduce((s, r) => s + r.items, 0)
const num = (v) => (v === null || v === undefined ? null : Number(v))
const equalJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const pick = (m) => ({ value_totals: m.value_totals, executive: m.executive, signings: m.signings, transaction_queue: m.transaction_queue, value_queue: m.value_queue, prediction: m.prediction })

try {
  const vc = await connect('postgres'); const ver = (await vc.query('select version() as v')).rows[0].v; await vc.end()
  console.log(`server: ${ver}`)
  check('PostgreSQL major version is 17', /PostgreSQL 17\./.test(ver), ver.split(',')[0])

  // --- identity: manifest, frozen history, file hygiene, the approved sources
  const frozen = JSON.parse(fs.readFileSync(path.join(TC, 'tests/db/frozen-migrations.json'), 'utf8')).files
  const base = sqlFiles(TBASE), cand = sqlFiles(TC)
  check('baseline manifest ends at 057 (61 files)', base.length === 61 && base.at(-1) === FILE057)
  check('candidate manifest = baseline + 058 (62 files), forward-only', cand.length === 62 && JSON.stringify(cand) === JSON.stringify([...base, FILE]))
  const frozenOk = base.every((f) => f in frozen && sha1(readSql(TC, f).replace(/\r\n/g, '\n')) === frozen[f] && readSql(TBASE, f) === readSql(TC, f))
  check('001-057 are byte-identical between the baseline and the candidate and match the frozen hashes (61 entries; 058 is not frozen)', frozenOk && Object.keys(frozen).length === 61 && !(FILE in frozen))
  const sql = readSql(TC, FILE)
  const rbSql = fs.readFileSync(path.join(TC, ROLLBACK), 'utf8')
  console.log(`  ${FILE}: sha256 ${sha256(sql)}  sha1(LF) ${sha1(sql.replace(/\r\n/g, '\n'))}  ${Buffer.byteLength(sql)} bytes`)
  console.log(`  rollback-058.sql: sha256 ${sha256(rbSql)}  sha1(LF) ${sha1(rbSql.replace(/\r\n/g, '\n'))}  ${Buffer.byteLength(rbSql)} bytes`)
  const body = sql.replace(/\$m058\$[\s\S]*?\$m058\$/g, '').replace(/--.*$/gm, '').replace(/'(?:[^']|'')*'/g, "''")
  const PROTECTED = 'players|bref_team_code_map|player_metric_observations|outcomes|outcome_model_evaluations|transaction_event_assets|transaction_events'
  check('058: no CRLF; one transaction; no DDL on a public object (only temporary _m058 tables and views); no grant or revoke; no new source; no write to players, team-code map, metrics, outcomes, evaluations or transactions',
    !sql.includes('\r') && (sql.match(/^begin;$/gm) || []).length === 1 && (sql.match(/^commit;$/gm) || []).length === 1
      && !/\b(create|alter|drop)\s+(table|view|function|trigger|policy|type|index|materialized|schema|extension|sequence)\b/i
        .test(body.replace(/create temporary table _m058\w*/gi, '').replace(/create temporary view _m058\w*/gi, '').replace(/drop view _m058\w*/gi, ''))
      && !/\b(grant|revoke)\b/i.test(body) && !/insert\s+into\s+public\.sources\b/i.test(body)
      && !new RegExp(`\\b(insert\\s+into|update|delete\\s+from)\\s+public\\.(${PROTECTED})\\b`, 'i').test(body))
  const payload = JSON.parse(sql.match(/\$m058\$([\s\S]*?)\$m058\$/)[1])
  const capture = JSON.parse(fs.readFileSync(path.join(TC, 'database/research/057/source-capture.json'), 'utf8'))
  const bat = payload.sources.find((s) => s.component === 'BAT'), pitch = payload.sources.find((s) => s.component === 'PITCH')
  check('sources: exactly the two 057 archived captures (decoded SHA-256 ec088b3a... / 3d80dcd5..., Wayback 20260911214553 / 20260210222101), as recorded in 057 source-capture.json',
    payload.sources.length === 2 && bat?.decoded_sha256 === BAT_SHA && pitch?.decoded_sha256 === PITCH_SHA
      && payload.sources.every((s) => capture.files.some((f) => f.url === s.url && f.decoded_sha256 === s.decoded_sha256 && f.cdx_digest === s.cdx_digest))
      && /20260911214553id_/.test(bat.url) && /20260210222101id_/.test(pitch.url))
  const rowsBy = (b) => payload.war.rows.filter((r) => r[0] === b).length
  const ex = payload.excluded_rows
  check('rows: 91 for exactly the four returned players (28 / 15 / 36 / 12), no TOT or WSA row, every season <= 2025; the one excluded row is the Versalles 1969 WSA stint 2 BAT 0.36 (OUTSIDE_DODGERS_VALUE_WINDOW_AND_UNMAPPED_TEAM)',
    payload.war.rows.length === 91 && new Set(payload.war.rows.map((r) => r[0])).size === 4 && FOUR.every((b) => payload.war.rows.some((r) => r[0] === b))
      && [rowsBy('garlajo01'), rowsBy('leyriji01'), rowsBy('grantmu01'), rowsBy('versazo01')].join() === '28,15,36,12'
      && payload.war.rows.every((r) => r[2] <= 2025 && r[3] !== 'TOT' && r[3] !== 'WSA') && payload.observed_through_season === 2025
      && ex.length === 1 && ex[0].bref_id === 'versazo01' && ex[0].season === 1969 && ex[0].team === 'WSA' && ex[0].stint === 2 && ex[0].component === 'BAT'
      && Number(ex[0].war) === 0.36 && ex[0].reason === 'OUTSIDE_DODGERS_VALUE_WINDOW_AND_UNMAPPED_TEAM')
  const planPath = path.join(TC, 'database/release/058-release-plan.md')
  if (fs.existsSync(planPath)) { const plan = fs.readFileSync(planPath, 'utf8'); check('release-plan hashes match the files', plan.includes(sha256(sql)) && plan.includes(sha256(rbSql))) }
  else check('release-plan hashes match the files', false, 'release plan missing')

  // --- A: the released 001-057 (the production state), then 058
  const A0 = await freshDb('disi_a')
  let t0 = Date.now()
  await apply(A0, TBASE, base)
  console.log(`  001-057 replay on PG17: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  await A0.end()
  await copyDb('disi_a', 'disi_pre')
  const A = await connect('disi_a')
  const inv = await import(path.join(TC, 'scripts/db/lib/invariants.mjs'))
  const { CANONICAL_EXPECTATIONS, EXPECTATIONS_THROUGH_057 } = inv
  const verify = mkVerifier(inv)
  const { measure } = await import(pathToFileURL(path.join(TC, 'database/research/058/measure.mjs')).href)
  const pre = await verify(A, CANONICAL_EXPECTATIONS), pre57 = await verify(A, EXPECTATIONS_THROUGH_057)
  check(`the HEAD verifier on the PRE-058 state (production today) fails exactly the asset-identity pin 058 moves: ${pre.ok}/${pre.total}; the through-057 expectations pass ${pre57.ok}/${pre57.total}`,
    equalJson(pre.names, ['transaction_asset_identity_consistency_violations']) && pre57.names.length === 0 && pre57.total === 259, `${pre.names.join(', ')} | ${pre57.names.join(', ')}`)
  const S0 = { cat: await catalog(A), rows: await tableRows(A), gen: await generations(A), m: await measure(q(A)), act: await activeWar(A), snap: await snapContent(A) }
  t0 = Date.now()
  await apply(A, TC, [FILE])
  const ms = Date.now() - t0
  const S1 = { cat: await catalog(A), rows: await tableRows(A), gen: await generations(A), m: await measure(q(A)), act: await activeWar(A), snap: await snapContent(A) }
  const M0 = S0.m, M1 = S1.m
  check(`058 applies in one transaction (${ms} ms)`, true)
  check('additivity: every relation, column, ACL, RLS flag, option, owner, view definition, policy, trigger, enum and function body is identical', md5(S1.cat) === md5(S0.cat))
  const H0 = hashes(S0.rows), H1 = hashes(S1.rows)
  const changed = Object.keys(H1).filter((t) => H1[t].h !== H0[t]?.h && !SNAP.includes(t)).sort()
  check('only the team-season WAR table changes among non-snapshot tables', equalJson(changed, ['player_mlb_team_season_war']), changed.join(','))
  const lostIn = (t) => { const s = new Set(S1.rows[t]); return S0.rows[t].filter((r) => !s.has(r)) }
  const lost = Object.keys(S0.rows).filter((t) => !SNAP.includes(t)).filter((t) => lostIn(t).length)
  const dWar = S1.rows.player_mlb_team_season_war.length - S0.rows.player_mlb_team_season_war.length
  check('no existing row changed or disappeared; +91 team-season rows; sources +0 (3384 stays)',
    lost.length === 0 && dWar === 91 && M1.counts.sources === M0.counts.sources && M1.counts.sources === 3384, `lost:${lost.join(',')} war+${dWar} sources:${M0.counts.sources}->${M1.counts.sources}`)
  const shape = (await rowsOf(A, `select count(*)::int as n, count(*) filter (where w.record_status = 'ACTIVE' and w.war_system = 'BWAR' and w.confidence = 'VERIFIED' and w.observed_through_season = 2025
      and w.organization_id is not null and w.player_id is null)::int as ok, count(*) filter (where w.bref_team_code = 'WSA')::int as wsa_in_four
    from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id where so.url like $1 and w.bref_id = any($2)`, [SRC_LIKE, FOUR]))[0]
  const perPlayer = Object.fromEntries((await rowsOf(A, `select bref_id, count(*)::int as n from public.player_mlb_team_season_war where bref_id = any($1) group by 1`, [FOUR])).map((r) => [r.bref_id, r.n]))
  const glob = (await rowsOf(A, `select count(*) filter (where bref_team_code = 'WSA')::int as wsa, count(*) filter (where record_status = 'ACTIVE' and organization_id is null)::int as active_null_org from public.player_mlb_team_season_war`))[0]
  const on57 = await rowsOf(A, `select count(*)::int as n, count(distinct w.bref_id)::int as players from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id
    where so.url like $1 and w.record_status = 'ACTIVE' and not (w.bref_id = any($2))`, [SRC_LIKE, FOUR])
  const a57 = await rowsOf(A, `select (to_jsonb(w) - 'updated_at')::text as r from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id
    where so.url like $1 and w.record_status = 'ACTIVE' and not (w.bref_id = any($2))`, [SRC_LIKE, FOUR])
  check('WAR shape: the 91 rows (28 / 15 / 36 / 12) are all ACTIVE BWAR VERIFIED through 2025 with an organization and player_id NULL; no WSA row anywhere; 0 ACTIVE rows with a NULL organization',
    shape.n === 91 && shape.ok === 91 && glob.wsa === 0 && glob.active_null_org === 0 && [perPlayer.garlajo01, perPlayer.leyriji01, perPlayer.grantmu01, perPlayer.versazo01].join() === '28,15,36,12', JSON.stringify({ ...shape, ...glob, perPlayer }))
  check('the 54 ACTIVE rows of the eleven 057 players on the two archived sources are unchanged (54 rows, 11 players)',
    on57[0].n === 54 && on57[0].players === 11 && a57.length === 54 && a57.every((r) => new Set(S0.act).has(r.r)), JSON.stringify(on57[0]))

  // --- the value facts
  const iv = (suffix) => M1.intervals.find((i) => i.interval_key.endsWith(':' + suffix))
  const lin = (name) => M1.lineage.find((l) => l.asset_name === name)
  const g = iv('279782')
  check('Garland acquisition-season placement: interval-bounded Dodgers bWAR 0.17 by COUNTERPARTY_STINT_ORDER, 2 Dodgers rows in the interval',
    g && num(g.bwar) === 0.17 && g.timing_resolution_basis === 'COUNTERPARTY_STINT_ORDER' && g.dodgers_rows_in_interval === 2, JSON.stringify(g))
  const gq = await rowsOf(A, `select count(*)::int as n from public.v_transaction_research_queue where issue = 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION' and asset_name = 'Jon Garland' and event_key = 'LAD_FREE_AGENCY_2009_JON_GARLAND'`)
  check('Garland 2011 is not credited: 2 Dodgers rows outside the interval (bWAR 0.14 outside) and queued as DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION',
    g && g.dodgers_rows_outside_interval === 2 && num(g.outside_bwar) === 0.14 && gq[0].n === 1, `${g?.dodgers_rows_outside_interval} ${g?.outside_bwar} queue:${gq[0].n}`)
  const gr = iv('115046'), vz = iv('123713')
  check('Grant 1.39 and Versalles -1.12 (interval-bounded Dodgers bWAR), both lineage CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE',
    num(gr?.bwar) === 1.39 && num(vz?.bwar) === -1.12 && lin('Mudcat Grant')?.attribution_level === 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE' && lin('Zoilo Versalles')?.attribution_level === 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'
      && num(lin('Mudcat Grant')?.bwar) === 1.39 && num(lin('Zoilo Versalles')?.bwar) === -1.12, JSON.stringify([gr?.bwar, vz?.bwar]))
  const edge = async (b) => (await rowsOf(A, `select attribution_status, return_state, individual_attribution_permitted from public.v_trade_realization_edges where incoming_bref_id = $1`, [b]))
  const eL = await edge('leyriji01'), eG = await edge('garlajo01')
  check('Leyritz -0.61 PACKAGE_ATTRIBUTABLE; edge SHARED_PACKAGE_RETURN with individual attribution not permitted; Garland edge SOLE_OUTGOING_ASSET',
    num(iv('117747')?.bwar) === -0.61 && lin('Jim Leyritz')?.attribution_level === 'PACKAGE_ATTRIBUTABLE' && num(lin('Jim Leyritz')?.bwar) === -0.61
      && eL.length === 1 && eL[0].attribution_status === 'SHARED_PACKAGE_RETURN' && eL[0].individual_attribution_permitted === false
      && eG.length === 1 && eG[0].attribution_status === 'SOLE_OUTGOING_ASSET', JSON.stringify([eL, eG]))
  const sg = (m, s) => m.signings.find((x) => x.player_slug === s)
  const ta = sg(M1, 'tony-abreu'), vi = sg(M1, 'jose-vizcaino'), cf = sg(M1, 'chico-fernandez')
  check('signings: Abreu REALIZED_TO_DATE / COMPLETE_TERMINAL / realized 1.40 / trade 0.17; Vizcaino realized 0.09 unchanged, package first hop -0.71; Fernandez realized 0.62 unchanged, observable 4.90 -> 5.17',
    ta.realized_value_state === 'REALIZED_TO_DATE' && ta.chain_status === 'COMPLETE_TERMINAL' && num(ta.realized) === 1.4 && num(ta.trade) === 0.17
      && num(vi.realized) === 0.09 && num(sg(M0, 'jose-vizcaino').realized) === 0.09 && num(vi.pkg_first) === -0.71
      && num(cf.realized) === 0.62 && num(sg(M0, 'chico-fernandez').realized) === 0.62 && num(sg(M0, 'chico-fernandez').observable) === 4.9 && num(cf.observable) === 5.17, JSON.stringify(M1.signings))
  const tq0 = byIssue(M0.transaction_queue), tq1 = byIssue(M1.transaction_queue), vq0 = byIssue(M0.value_queue), vq1 = byIssue(M1.value_queue)
  const othersSame = (a, b, moved) => Object.keys({ ...a, ...b }).filter((k) => !moved.includes(k)).every((k) => a[k] === b[k])
  check('transaction queue 58 -> 57 (DOWNSTREAM_WAR_NOT_LOADED 6 -> 4, DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION 5 -> 6, every other issue unchanged)',
    total(M0.transaction_queue) === 58 && total(M1.transaction_queue) === 57 && tq0.DOWNSTREAM_WAR_NOT_LOADED === 6 && tq1.DOWNSTREAM_WAR_NOT_LOADED === 4
      && tq0.DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION === 5 && tq1.DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION === 6 && othersSame(tq0, tq1, ['DOWNSTREAM_WAR_NOT_LOADED', 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION']))
  const sq = M1.scoped_queue
  check('value queue 93 -> 90 (DOWNSTREAM_ASSET_CHAIN_INCOMPLETE 8 -> 5, every other issue unchanged); Vizcaino CASH_AMOUNT_UNKNOWN and TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED remain',
    total(M0.value_queue) === 93 && total(M1.value_queue) === 90 && vq0.DOWNSTREAM_ASSET_CHAIN_INCOMPLETE === 8 && vq1.DOWNSTREAM_ASSET_CHAIN_INCOMPLETE === 5 && othersSame(vq0, vq1, ['DOWNSTREAM_ASSET_CHAIN_INCOMPLETE'])
      && sq.some((x) => x.issue === 'CASH_AMOUNT_UNKNOWN' && x.key === 'LAD_NYY_2000_JOSE_VIZCAINO') && sq.some((x) => x.issue === 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED' && x.key === 'jose-vizcaino'))
  const vt0 = M0.value_totals, vt1 = M1.value_totals, ex0 = M0.executive, ex1 = M1.executive
  check('value totals 87 / 297.60 / 80 / 7 / 1 / 96.39 / 141.44 -> 88 / 299.00 / 83 / 5 / 0 / 95.85 / 141.71; executive direct 282.77 -> 284.00, trade 14.83 -> 15.00, realized 299.00',
    equalJson([vt0.resolved, vt0.realized, vt0.realized_to_date, vt0.chain_incomplete, vt0.unresolved, vt0.pkg_first, vt0.observable], [87, '297.60', 80, 7, 1, '96.39', '141.44'])
      && equalJson([vt1.resolved, vt1.realized, vt1.realized_to_date, vt1.chain_incomplete, vt1.unresolved, vt1.pkg_first, vt1.observable], [88, '299.00', 83, 5, 0, '95.85', '141.71'])
      && [ex0.direct, ex0.trade].join() === '282.77,14.83' && [ex1.direct, ex1.trade, ex1.realized].join() === '284.00,15.00,299.00', JSON.stringify([vt1, ex1]))
  const p1 = M1.prediction, rt = (m) => m.research_task_types.find((x) => x.task_type === 'BWAR_MISSING')?.items
  check('prediction isolation: the prediction fingerprints are identical before and after; 0 supported models, probabilities, expected values, recommendations and targets; evaluation fingerprints unchanged; BWAR_MISSING 50 before and after',
    equalJson(M0.prediction, p1) && p1.supported_models === 0 && p1.probabilities === 0 && p1.expected_values === 0 && p1.recommendations === 0 && p1.supported_targets === 0
      && p1.evaluation_fingerprints === FPS && rt(M0) === 50 && rt(M1) === 50, JSON.stringify(p1))
  const post = await verify(A, CANONICAL_EXPECTATIONS), post57 = await verify(A, EXPECTATIONS_THROUGH_057)
  check(`HEAD verifier after 058: ${post.ok}/${post.total}; the pin moves from through-057 [${EXPECTATIONS_THROUGH_057.transaction_war_unavailable_mlb_ids}] to head [${CANONICAL_EXPECTATIONS.transaction_war_unavailable_mlb_ids}]`,
    post.names.length === 0 && post.total === 259 && equalJson(CANONICAL_EXPECTATIONS.transaction_war_unavailable_mlb_ids, []) && equalJson(EXPECTATIONS_THROUGH_057.transaction_war_unavailable_mlb_ids, ['279782', '117747']), post.names.join(', '))
  const cnt = (await Promise.all(SNAP.map(async (t) => (await rowsOf(A, `select count(distinct generation_id)::int as n from public.${t}`))[0].n)))
  const snapChanged = SNAP.filter((t) => S0.snap[t] !== S1.snap[t]).sort()
  check('snapshots: all 11 tables at one new generation (S0 + 1), zero drift; content (minus generation and timestamps) changes only in product_executive_snapshot and product_player_decision',
    S1.gen.every((x) => x.length === 1 && x[0] === S0.gen[0][0] + 1) && S0.gen.every((x) => x.length === 1) && cnt.every((n) => n === 1) && (await drift(A)).length === 0
      && equalJson(snapChanged, ['product_executive_snapshot', 'product_player_decision']), `gen ${S0.gen[0]}->${S1.gen[0]} changed:${snapChanged.join(',')}`)
  await apply(A, TC, [FILE])
  check('058 exact idempotency (every row, definition, ACL, policy, function; no second refresh)', md5({ cat: await catalog(A), rows: await tableRows(A) }) === md5({ cat: S1.cat, rows: S1.rows }))
  await A.end()

  // --- guards on copies of the pre-058 state
  const guard = async (name, mutate, pattern, migration = sql) => {
    const db = `disi_g${results.length}`
    await copyDb('disi_pre', db)
    const G = await connect(db)
    let msg = ''
    try { if (mutate) await G.query(mutate); await G.query(migration) } catch (err) { msg = err.message; await G.query('rollback').catch(() => {}) }
    await G.end()
    check(name, pattern.test(msg), msg.slice(0, 140))
  }
  await guard('guard: a source whose decoded SHA-256 differs is refused', null, /058: the sources are not the two approved archived Baseball-Reference captures/, sql.replace(BAT_SHA, '0'.repeat(64)))
  const cle = '["versazo01","123713",1969,"CLE",1,"BAT"', wsa = '["versazo01","123713",1969,"WSA",1,"BAT"'
  check('guard setup: the 1969 Versalles CLE row exists in the payload', sql.includes(cle))
  await guard('guard: a WSA row (unmapped team) in the payload is refused', null, /058: a row is not a complete 2025-or-earlier team-season stint of a mapped team/, sql.replace(cle, wsa))
  await guard('guard: a 057 database whose 054 rows were retracted is refused', `update public.player_mlb_team_season_war set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'validator guard'
    where source_id in (select id from public.sources where url like '${SRC_LIKE}')`, /058: the 057 team-season rows are not the 54 ACTIVE rows of its eleven players/)
  await guard('guard: a changed stored evaluation fingerprint (prediction layer not as researched) is refused', `update public.outcome_model_evaluations set training_fingerprint = '00000000000000000000000000000000'`,
    /058: the prediction layer is not in the state the research was written for/)

  // --- disposable copies of the post-058 state: C (rollback-057 dependency), B (rollback-058)
  await copyDb('disi_a', 'disi_c')
  await copyDb('disi_a', 'disi_b')
  const C = await connect('disi_c')
  const Crows = hashes(await tableRows(C))
  const tryRun = async (c, text) => { try { await c.query(text); return '' } catch (err) { await c.query('rollback').catch(() => {}); return err.message } }
  const r57 = await tryRun(C, await fs.promises.readFile(path.join(TC, 'database/release/sql/rollback-057.sql'), 'utf8'))
  check('rollback-057 on the post-058 state refuses (later research depends on the 057 evidence)', /rollback-057: later research depends on the 057 evidence/.test(r57), r57.slice(0, 120))
  const f57 = await tryRun(C, readSql(TC, FILE057))
  check('re-running the frozen 057 on the post-058 state refuses (its postconditions count every row on its sources)', /057 postcondition: 145 active rows cite the 057 sources; 54 were reviewed/.test(f57), f57.slice(0, 120))
  check('both refusals leave every table unchanged', equalJson(Crows, hashes(await tableRows(C))))
  await C.end()

  // --- B: rollback on a copy of the post-058 state
  const B = await connect('disi_b')
  t0 = Date.now()
  await B.query(rbSql)
  const rms = Date.now() - t0
  check(`rollback-058 commits in one transaction (${rms} ms)`, true)
  const SB = { cat: await catalog(B), rows: await tableRows(B), gen: await generations(B), m: await measure(q(B)), act: await activeWar(B) }
  const HB = hashes(SB.rows)
  const rdiff = Object.keys(H0).filter((t) => !SNAP.includes(t) && t !== 'player_mlb_team_season_war' && HB[t]?.h !== H0[t].h)
  const ret = (await rowsOf(B, `select count(*)::int as n, count(*) filter (where retraction_reason like 'Rollback of Migration 058%' and bref_id = any($1))::int as r from public.player_mlb_team_season_war where record_status = 'RETRACTED'`, [FOUR]))[0]
  const retBefore = M0.war.retracted
  check('after rollback the ACTIVE team-season rows are exactly the pre-058 rows; 91 RETRACTED rows carry the rollback reason, all for the four; every other table except team-season WAR equals the pre-058 state',
    md5(SB.act) === md5(S0.act) && ret.n === retBefore + 91 && ret.r === 91 && rdiff.length === 0, `${JSON.stringify(ret)} diff:${rdiff.join(',')}`)
  check('after rollback value totals, executive, signings, transaction and value queues and the prediction layer equal the pre-058 state',
    equalJson(pick(SB.m), pick(M0)) && md5(SB.cat) === md5(S0.cat))
  check('after rollback one new generation (post-058 + 1), zero drift', SB.gen.every((x) => x.length === 1 && x[0] === S1.gen[0][0] + 1) && (await drift(B)).length === 0, JSON.stringify(SB.gen[0]))
  const again = await tryRun(B, rbSql)
  check('a second rollback refuses (058 is no longer applied)', /rollback-058: Migration 058 is not applied/.test(again), again.slice(0, 100))
  const rv = await verify(B, EXPECTATIONS_THROUGH_057)
  check(`the through-057 verifier after rollback: ${rv.ok}/${rv.total}`, rv.names.length === 0 && rv.total === 259, rv.names.join(', '))
  const r57b = await tryRun(B, await fs.promises.readFile(path.join(TC, 'database/release/sql/rollback-057.sql'), 'utf8'))
  check('rollback-057 still refuses after rollback-058 (it treats the RETRACTED rows of the four on its sources as later research: documented, intended)', /rollback-057: later research depends on the 057 evidence/.test(r57b), r57b.slice(0, 120))
  await apply(B, TC, [FILE])
  const SR = { m: await measure(q(B)), cat: await catalog(B), gen: await generations(B) }
  const warR = (await rowsOf(B, `select count(*) filter (where record_status = 'ACTIVE')::int as a, count(*) filter (where record_status = 'RETRACTED')::int as r from public.player_mlb_team_season_war`))[0]
  const rep = await verify(B, CANONICAL_EXPECTATIONS)
  check(`reapplying 058 after its rollback reproduces the post-058 value, executive, signings, queues and prediction state; ACTIVE WAR ${warR.a}, RETRACTED ${warR.r}; generation = rollback + 1; HEAD verifier ${rep.ok}/${rep.total}`,
    equalJson(pick(SR.m), pick(M1)) && warR.a === M1.war.active && warR.a === 2025 && warR.r === retBefore + 91 && SR.gen.every((x) => x.length === 1 && x[0] === SB.gen[0][0] + 1)
      && rep.names.length === 0 && rep.total === 259, `${JSON.stringify(warR)} ${rep.names.join(', ')}`)
  check('no schema or security change after rollback and reapply (catalog equals the pre-058 catalog)', md5(SR.cat) === md5(S0.cat))
  await B.end()
} catch (err) {
  check('validator ran to completion', false, err.stack || err.message)
} finally {
  await server.stop().catch(() => {})
}
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
