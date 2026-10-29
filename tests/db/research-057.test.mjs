// Migration 057: benchmark bWAR evidence. The 056 database is built (001-056), 057 is applied for real, and the tests prove that exactly the
// eleven complete-window benchmark reachers gain Baseball-Reference team-season bWAR from the two approved archived captures (no partial 2026
// season, no deferred 2016-class reacher, no unresolved identity, no transaction-value player), that each team stint counts once, that the
// unchanged 041 labels follow from the rows (positive bWAR 8 / 3, 2+ bWAR 6 / 5), that the benchmark positive-bWAR baseline becomes supported
// (86 / 15 / 71) while 2+ bWAR stays one positive short, that no model, Dodgers target, probability, expected value or recommendation moves,
// and that 057 is idempotent, guarded, reproducible and reversible.
//   BWAR != FWAR   PARTIAL SEASON != COMPLETE TEAM-SEASON EVIDENCE   BASELINE SUPPORTED != MODEL SUPPORTED   BENCHMARK SUPPORT != DODGERS SUPPORT

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
// 058 emptied the head's unavailable-WAR pins; the 057 state (Garland and Leyritz still without WAR) is verified by the 057 layer
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_057 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { measure } from '../../database/research/057/measure.mjs'
import { assemble, assembleRollback, research } from '../../database/research/057/build.mjs'
import { benchmarkLabelCoverage } from '../../lib/research/benchmark-sample.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '057_benchmark_bwar_evidence.sql'
const sql057 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback057 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-057.sql'), 'utf8')
const evaluation = JSON.parse(fs.readFileSync(path.join(root, 'database/research/057/evaluation.json'), 'utf8'))
const scope = JSON.parse(fs.readFileSync(path.join(root, 'database/research/057/scope.json'), 'utf8'))
const BENCH = 'TOP_PROSPECT_SAMPLE'
const DODGERS = 'DODGERS_TRACKED_AND_OPENING_CLASS'
const PB = 'POSITIVE_BWAR_WITHIN_10_SEASONS'
const B2 = 'BWAR_2_WITHIN_10_SEASONS'
const ELEVEN = scope.approved.map((p) => p.slug)
const DEFERRED = scope.deferred_incomplete_window.map((p) => p.slug)
const IDENTITIES = scope.identity_unresolved.map((p) => p.slug)
const URLS = ['https://web.archive.org/web/20260911214553id_/https://www.baseball-reference.com/data/war_daily_bat.txt',
  'https://web.archive.org/web/20260210222101id_/https://www.baseball-reference.com/data/war_daily_pitch.txt']

let chain
let pre057Dump
let pre
let preTables
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
const R = (x) => (Array.isArray(x) ? x : x.rows)
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const clone = async (dump) => {
  const db = new PGlite({ loadDataDir: dump, extensions: { pgcrypto } })
  return { db, query: async (s, p) => (await db.query(s, p)).rows, close: () => db.close() }
}
const failsWith = async (c, sql, pattern) => {
  try { await c.db.exec(sql) } catch (e) {
    await c.db.exec('rollback;').catch(() => {})
    assert.match(String(e.message), pattern)
    return
  }
  assert.fail(`expected the statement to fail with ${pattern}`)
}
const tableHashes = async (c = chain) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5(R(await c.query(`select (to_jsonb(t) - 'updated_at')::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const rowsOf = async (c, t, where = '') => R(await c.query(`select (to_jsonb(t) - 'updated_at')::text as r from public.${t} t ${where}`)).map((r) => r.r).sort()
const labels = (c = chain) => c.query(`select player_slug, target_key, label, training_state, window_bwar::text as w from public.v_outcome_training_population
  where target_key in ('${PB}', '${B2}') and player_slug = any($1) order by 1, 2`, [[...ELEVEN, ...DEFERRED, ...IDENTITIES]])
const sup = async (c = chain) => Object.fromEntries((await c.query(`select target_key || '/' || reference_population as k, labelled_n, positive_n, negative_n, support_state
  from public.v_outcome_target_support`)).map((r) => [r.k, [r.labelled_n, r.positive_n, r.negative_n, r.support_state]]))

let preSupport, preLabels, preReach
before(async () => {
  chain = await buildChainThrough('056_international_benchmark_2019.sql')
  pre057Dump = await chain.db.dumpDataDir('none')
  pre = await measure(q)
  preTables = await tableHashes()
  preSupport = await sup()
  preLabels = await labels()
  preReach = await rowsOf(chain, 'outcome_model_evaluations')
  await chain.db.exec(sql057)
}, { timeout: 900000 })

after(async () => { await chain?.close() })

test('057 follows 056 in the manifest (058 follows it) and is frozen at its released hash', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '056_international_benchmark_2019.sql')
  assert.equal(manifest.canonical_sql[i + 1], '058_transaction_return_bwar_evidence.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.equal(Object.keys(frozen).length, 61)
  assert.equal(frozen[FILE], crypto.createHash('sha1').update(sql057.replace(/\r\n/g, '\n')).digest('hex'))
  assert.equal(frozen[FILE], '48766350e1f60595167c5b977a4759041874b4ac')
  assert.equal(crypto.createHash('sha256').update(rollback057).digest('hex'), 'f78599adb51fcaa887d1bc1e614c08cc1bc245e01adc4be8eb26d0967ee2f965')
  assert.match(sql057, /^-- DISI v0\.42\n-- 057_benchmark_bwar_evidence\.sql\n/)
  assert.match(rollback057, /^-- DISI rollback of Migration 057/)
})

test('baseline: the 057 research was written against exactly this pre-057 state', () => {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'database/research/057/baseline.json'), 'utf8'))
  assert.deepEqual(pre.counts, b.counts)
  assert.deepEqual(pre.support, b.support)
  assert.deepEqual(pre.war, b.war)
  assert.deepEqual(pre.evaluation.map((e) => [e.target_key, e.model_key, e.training_fingerprint, e.evaluation_current]), [
    ['REACH_MLB_WITHIN_7_SEASONS', 'BASE_RATE', '86b58f473301e2425751d853abd88e94', true], ['REACH_MLB_WITHIN_7_SEASONS', 'LOGISTIC_L2', '86b58f473301e2425751d853abd88e94', true],
    ['REACH_MLB_WITHIN_7_SEASONS', 'POPULATION_STRATIFIED_RATE', '86b58f473301e2425751d853abd88e94', true]])
  assert.deepEqual([preSupport[`${PB}/${BENCH}`], preSupport[`${B2}/${BENCH}`]], [[75, 7, 68, 'BASELINE_NOT_SUPPORTED'], [75, 3, 72, 'BASELINE_NOT_SUPPORTED']])
})

test('data only: no table, view, function, grant, policy, trigger or definition changes', async () => {
  const c = await clone(pre057Dump)
  try {
    const cat = async (x) => ({
      rel: await x.query(`select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'i') order by 1`),
      fn: await x.query(`select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile, md5(p.prosrc) as h from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
      pol: await x.query(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`),
      trg: await x.query(`select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
      views: await x.query(`select relname, md5(pg_get_viewdef(oid)) as h from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`),
    })
    assert.deepEqual(await cat(chain), await cat(c))
    assert.doesNotMatch(sql057, /(insert into|update) public\.outcome_targets/)
  } finally { await c.close() }
})

test('sources: the two approved archived Baseball-Reference captures, WAR_DATA_FILE / BASEBALL_REFERENCE, pinned by archive digest and decoded SHA-256', async () => {
  const s = await q(`select url, source_name, source_type, source_tier, publication_date::text as pub, notes from public.sources where url = any($1) order by url`, [URLS])
  assert.equal(s.length, 2)
  const bat = s.find((x) => x.url === URLS[0]), pitch = s.find((x) => x.url === URLS[1])
  for (const x of s) assert.deepEqual([x.source_name, x.source_type, x.source_tier], ['Baseball-Reference', 'WAR_DATA_FILE', 'BASEBALL_REFERENCE'])
  assert.match(bat.notes, /ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023/)
  assert.match(bat.notes, /CEBQTPXSHPR6RO2WZMQ7FK2LRRV575GV/)
  assert.match(bat.notes, /captured 2026-09-11T21:45:53Z; original Last-Modified 2026-09-11T04:57:41Z/)
  assert.match(bat.notes, /the capture's 2026 rows are mid-season and are not loaded/)
  assert.match(pitch.notes, /3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825/)
  assert.match(pitch.notes, /HW43HICGDZB6V2QAOFETX36ZQOQBY6UW/)
  assert.match(pitch.notes, /captured 2026-02-10T22:21:01Z; original Last-Modified 2025-11-04T14:33:16Z/)
  assert.deepEqual([bat.pub, pitch.pub], ['2026-09-11', '2025-11-04'])
  const w = await q(`select so.url, count(*)::int as n, max(w.season)::int as last, min(w.observed_through_season)::int as lo, max(w.observed_through_season)::int as hi,
      min(w.observed_through_date)::text as d from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id where so.url = any($1) group by 1 order by 1`, [URLS])
  // ordered by URL: the pitching capture (20260210) first; DeJesus is the one pitcher, his 2023 batting row is the NULL-WAR row
  assert.deepEqual(w.map((x) => [x.url === URLS[0] ? 'BAT' : 'PITCH', x.n, x.last, x.lo, x.hi, x.d]), [['PITCH', 1, 2023, 2025, 2025, '2025-11-04'], ['BAT', 53, 2025, 2025, 2025, '2026-09-11']])
  assert.equal(pre.counts.sources + 2, (await measure(q)).counts.sources)
})

test('players: exactly the eleven approved complete-window reachers; no deferred 2016-class reacher, unresolved identity or transaction-value player', async () => {
  const p = await q(`select distinct pl.slug from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join public.players pl on pl.id = w.player_id
    where so.url = any($1) order by 1`, [URLS])
  assert.deepEqual(p.map((x) => x.slug), [...ELEVEN].sort())
  const forbidden = await one(`select count(*)::int as n from public.player_mlb_team_season_war w where w.record_status = 'ACTIVE'
    and (w.bref_id = any($1) or w.player_id in (select id from public.players where slug = any($2)))`,
  [['ariasga01', 'onajo01', 'garcilu04', 'moralfr02', 'garlajo01', 'grantmu01', 'versazo01', 'leyriji01'], [...DEFERRED, ...IDENTITIES]])
  assert.equal(forbidden.n, 0)
  for (const s of IDENTITIES) assert.deepEqual(await one(`select mlb_id, bref_id from public.players where slug = $1`, [s]), { mlb_id: null, bref_id: null }, `${s} stays unresolved`)
  const amundaray = await one(`select count(*)::int as n from public.players where mlb_id = 660657`)
  assert.equal(amundaray.n, 0, 'Amundaray is not resolved to MLB 660657: an official club assignment is not a signing transaction')
})

test('WAR: 54 rows, one per player, season, team stint and component; no TOT; multi-team seasons counted once; the NULL row stays NULL', async () => {
  const m = await measure(q)
  assert.deepEqual([m.war.rows - pre.war.rows, m.war.active - pre.war.active, m.war.retracted, m.war.active_players - pre.war.active_players], [54, 54, 0, 11])
  assert.equal((await one(`select count(*)::int as n from (select bref_id, season, bref_team_code, stint_ordinal, component from public.player_mlb_team_season_war
    where record_status = 'ACTIVE' group by 1, 2, 3, 4, 5 having count(*) > 1) x`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from public.player_mlb_team_season_war where bref_team_code = 'TOT'`)).n, 0)
  const stints = await q(`select bref_id, season, string_agg(stint_ordinal || ':' || bref_team_code || ':' || war, ',' order by stint_ordinal) as s from public.player_mlb_team_season_war
    where record_status = 'ACTIVE' and component = 'BAT' and (bref_id, season) in (('sotoju01', 2022), ('taverle01', 2025), ('pachecr01', 2024)) group by 1, 2 order by 1`)
  assert.deepEqual(stints.map((r) => [r.bref_id, r.season, r.s]), [['pachecr01', 2024, '1:PHI:0.06,2:BAL:0.05,3:MIA:-0.32'], ['sotoju01', 2022, '1:WSN:3.73,2:SDP:1.74'], ['taverle01', 2025, '1:TEX:0.05,2:SEA:-0.63']])
  const dejesus = await q(`select component, war::text, games, plate_appearances, ip_outs, note is not null as noted from public.player_mlb_team_season_war where bref_id = 'dejesen01' order by component`)
  assert.deepEqual(dejesus.map((r) => [r.component, r.war, r.games, r.plate_appearances, r.ip_outs, r.noted]), [['BAT', null, 0, 0, null, true], ['PITCH', '-0.18', 2, null, 19, false]])
  const sums = Object.fromEntries((await q(`select pl.slug, sum(w.war)::text as s, count(*)::int as n, oc.career_war::text as c from public.player_mlb_team_season_war w join public.players pl on pl.id = w.player_id
    join public.outcomes oc on oc.player_id = pl.id where w.record_status = 'ACTIVE' and pl.slug = any($1) group by 1, 4`, [ELEVEN])).map((r) => [r.slug, [Number(r.s), r.n, Number(r.c)]]))
  assert.deepEqual(sums, {
    'andres-gimenez': [19.37, 6, 19.37], 'cristian-pache': [-1.3, 7, -1.3], 'emmanuel-dejesus': [-0.18, 2, -0.18], 'fernando-tatis-jr': [27.34, 6, 27.34], 'gilberto-celestino': [0.24, 2, 0.24],
    'juan-soto': [42.57, 9, 42.57], 'leody-taveras': [4.7, 7, 4.7], 'miguel-amaya': [3.35, 3, 3.35], 'rafael-marchan': [1.41, 4, 1.41], 'simon-muzziotti': [-0.05, 1, -0.05], 'vladimir-guerrero-jr': [25.73, 7, 25.73],
  })
  assert.equal((await one(`select count(*)::int as n from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id where so.url = any($1)
    and (w.season > 2025 or w.organization_id is null or w.confidence <> 'VERIFIED' or w.war_system <> 'BWAR')`, [URLS])).n, 0, 'no partial 2026 season, every organization mapped')
})

test('nothing else moves: only WAR, outcomes (the eleven career values), sources and the stored evaluation change', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => now[t] !== preTables[t]).sort()
  assert.deepEqual(changed.filter((t) => !t.startsWith('product_')), ['outcome_model_evaluations', 'outcomes', 'player_mlb_team_season_war', 'sources'])
  const c = await clone(pre057Dump)
  try {
    for (const t of ['outcome_model_evaluations', 'player_mlb_team_season_war', 'sources']) {
      const a = new Set(await rowsOf(chain, t))
      assert.equal((await rowsOf(c, t)).filter((r) => !a.has(r)).length, 0, `${t}: no existing row changed or disappeared`)
    }
    const a = new Set(await rowsOf(chain, 'outcomes'))
    const gone = (await rowsOf(c, 'outcomes')).filter((r) => !a.has(r)).map((r) => JSON.parse(r))
    assert.equal(gone.length, 11)
    assert.ok(gone.every((o) => o.career_war === null), 'only the eleven NULL career bWAR values were set')
    const before = Object.fromEntries((await c.query(`select pl.slug, oc.career_war from public.outcomes oc join public.players pl on pl.id = oc.player_id where pl.slug = any($1)`, [ELEVEN])).map((r) => [r.slug, r.career_war]))
    assert.ok(ELEVEN.every((s) => before[s] === null))
  } finally { await c.close() }
  assert.deepEqual(await rowsOf(chain, 'outcome_model_evaluations', `where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`), preReach, 'the reach evaluation is byte-identical')
})

test('labels: the 041 rule decides every label from the rows; positive bWAR 8 / 3, 2+ bWAR 6 / 5; deferred reachers and identities stay NULL', async () => {
  const L = await labels()
  const by = (slug, t) => L.find((x) => x.player_slug === slug && x.target_key === t)
  const trueOf = (t) => L.filter((x) => x.target_key === t && ELEVEN.includes(x.player_slug) && x.label === true).map((x) => x.player_slug).sort()
  assert.deepEqual(trueOf(PB), ['andres-gimenez', 'fernando-tatis-jr', 'gilberto-celestino', 'juan-soto', 'leody-taveras', 'miguel-amaya', 'rafael-marchan', 'vladimir-guerrero-jr'])
  assert.deepEqual(L.filter((x) => x.target_key === PB && ELEVEN.includes(x.player_slug) && x.label === false).map((x) => x.player_slug).sort(), ['cristian-pache', 'emmanuel-dejesus', 'simon-muzziotti'])
  assert.deepEqual(trueOf(B2), ['andres-gimenez', 'fernando-tatis-jr', 'juan-soto', 'leody-taveras', 'miguel-amaya', 'vladimir-guerrero-jr'])
  assert.deepEqual(L.filter((x) => x.target_key === B2 && ELEVEN.includes(x.player_slug) && x.label === false).map((x) => x.player_slug).sort(),
    ['cristian-pache', 'emmanuel-dejesus', 'gilberto-celestino', 'rafael-marchan', 'simon-muzziotti'])
  for (const p of research.players) {
    assert.equal(Number(by(p.slug, PB).w), Number(p.window_bwar), `${p.slug}: the label reads the loaded window sum`)
    assert.equal(by(p.slug, PB).training_state, 'BENCHMARK_SAMPLE_ONLY')
  }
  for (const s of [...DEFERRED, ...IDENTITIES]) for (const t of [PB, B2]) assert.deepEqual([by(s, t).label, by(s, t).training_state], [null, 'OUTCOME_UNAUDITED'], `${s} ${t} stays NULL`)
  // before 057 every one of the eleven was NULL: missing bWAR was never zero
  for (const s of ELEVEN) assert.deepEqual(preLabels.filter((x) => x.player_slug === s).map((x) => [x.label, x.training_state]), [[null, 'OUTCOME_UNAUDITED'], [null, 'OUTCOME_UNAUDITED']])
})

test('support: benchmark positive bWAR 75 / 7 / 68 -> 86 / 15 / 71 supported; 2+ bWAR 86 / 9 / 77 not supported; Dodgers, reach and thresholds unchanged', async () => {
  const s = await sup()
  assert.deepEqual(s[`${PB}/${BENCH}`], [86, 15, 71, 'BASELINE_SUPPORTED'])
  assert.deepEqual(s[`${B2}/${BENCH}`], [86, 9, 77, 'BASELINE_NOT_SUPPORTED'])
  for (const k of Object.keys(preSupport).filter((k) => k.endsWith(`/${DODGERS}`) || k.startsWith('REACH_MLB_WITHIN_7_SEASONS/'))) assert.deepEqual(s[k], preSupport[k], `${k} does not move`)
  assert.deepEqual(s[`${PB}/${DODGERS}`], [11, 1, 10, 'BASELINE_NOT_SUPPORTED'])
  const t = await q(`select target_key, min_reference_n, min_positives, min_negatives, events_per_feature from public.outcome_targets order by 1`)
  for (const r of t) assert.deepEqual([r.min_reference_n, r.min_positives, r.min_negatives, r.events_per_feature], [50, 10, 10, 10], `${r.target_key}: thresholds are not lowered`)
})

test('models: the bWAR evaluations are stored, current and unsupported; the reach evaluation is untouched; no probability, expected value or recommendation', async () => {
  const ev = await q(`select target_key, model_key, evaluated_rows, positive_n, folds, decision, decision_reason, brier_score::float8 as brier, brier_skill_vs_base_rate::float8 as skill,
      training_fingerprint, evaluation_current from public.v_outcome_model_evaluation order by 1, 2`)
  assert.equal(ev.length, 9)
  assert.ok(ev.every((e) => e.evaluation_current && e.decision !== 'MODEL_SUPPORTED'))
  const e = (t, m) => ev.find((x) => x.target_key === t && x.model_key === m)
  assert.deepEqual(ev.filter((x) => x.target_key === PB).map((x) => [x.model_key, x.evaluated_rows, x.positive_n, x.folds, x.decision, x.training_fingerprint]), [
    ['BASE_RATE', 88, 14, 4, 'BASELINE_REFERENCE', '102c01a35d380d36493465cef1070c07'], ['LOGISTIC_L2', 88, 14, 4, 'MODEL_NOT_SUPPORTED', '102c01a35d380d36493465cef1070c07'],
    ['POPULATION_STRATIFIED_RATE', 88, 14, 4, 'MODEL_NOT_SUPPORTED', '102c01a35d380d36493465cef1070c07']])
  assert.deepEqual(ev.filter((x) => x.target_key === B2).map((x) => [x.model_key, x.evaluated_rows, x.positive_n, x.folds, x.decision, x.training_fingerprint]), [
    ['BASE_RATE', 88, 9, 4, 'BASELINE_REFERENCE', '1aa73185a9dab3071d4530ee670dd088'], ['LOGISTIC_L2', 88, 9, 4, 'MODEL_NOT_SUPPORTED', '1aa73185a9dab3071d4530ee670dd088'],
    ['POPULATION_STRATIFIED_RATE', 88, 9, 4, 'MODEL_NOT_SUPPORTED', '1aa73185a9dab3071d4530ee670dd088']])
  assert.deepEqual([e(PB, 'BASE_RATE').brier, e(PB, 'POPULATION_STRATIFIED_RATE').brier, e(PB, 'POPULATION_STRATIFIED_RATE').skill, e(PB, 'LOGISTIC_L2').skill], [0.140938, 0.142906, -0.013963, -0.085678])
  assert.match(e(PB, 'POPULATION_STRATIFIED_RATE').decision_reason, /^NO_SKILL_OVER_BASELINE/)
  assert.match(e(PB, 'LOGISTIC_L2').decision_reason, /^INSUFFICIENT_EVENTS: 14 positives for 6 feature\(s\); at least 60 are required/)
  assert.match(e(B2, 'POPULATION_STRATIFIED_RATE').decision_reason, /^INSUFFICIENT_EVENTS: 9 positives for 1 feature\(s\); at least 10 are required/)
  assert.deepEqual(ev.filter((x) => x.target_key === 'REACH_MLB_WITHIN_7_SEASONS').map((x) => [x.evaluated_rows, x.positive_n, x.folds, x.training_fingerprint]),
    Array(3).fill([173, 34, 7, '86b58f473301e2425751d853abd88e94']))
  assert.equal(evaluation.reach_check.equals_stored_056_rows, true)
  assert.deepEqual(evaluation.failures, [])
  assert.deepEqual(await one(`select count(probability)::int as nn, count(*) filter (where prediction_eligible)::int as eligible,
      count(*) filter (where model_support_state = 'MODEL_SUPPORTED')::int as model from public.v_player_outcome_probability`), { nn: 0, eligible: 0, model: 0 })
  const o = await one(`select supported_probability_targets, non_null_probabilities, supported_expected_value_models, supported_expected_values, predictive_portfolio_recommendations, supported_fitted_models, prediction_readiness_state from public.v_executive_overview`)
  assert.deepEqual(o, { supported_probability_targets: 0, non_null_probabilities: 0, supported_expected_value_models: 0, supported_expected_values: 0, predictive_portfolio_recommendations: 0,
    supported_fitted_models: 0, prediction_readiness_state: 'NO_SUPPORTED_PROBABILITY_TARGET' })
  assert.equal((await one(`select support_chain_state from public.v_disi_release_status`)).support_chain_state, 'NO_PREDICTIVE_LAYER_SUPPORTED')
  assert.equal((await one(`select count(*) filter (where probability_supported or expected_value_supported)::int as n from public.v_expected_value_support`)).n, 0)
  assert.equal((await one(`select count(*) filter (where optimization_eligible)::int as n from public.v_portfolio_candidate_readiness`)).n, 0, 'no portfolio recommendation')
  assert.equal((await one(`select count(*)::int as n from public.players p where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
    and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')`)).n, 0)
})

test('product: one refresh, zero drift; readiness and the league statement show a benchmark reference result; methodology separates it from Dodgers support', async () => {
  const gens = await q(`select distinct generation_id::text as g from public.product_executive_snapshot union select distinct generation_id::text from public.product_prediction_readiness`)
  assert.equal(gens.length, 1)
  assert.equal(Number(gens[0].g), Number(pre.counts.snapshot_generation) + 1)
  assert.deepEqual(await q(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`), [])
  const rows = await q(`select * from public.product_prediction_readiness`)
  const r = Object.fromEntries(rows.map((x) => [`${x.target_key}/${x.reference_population}`, x.readiness_state]))
  assert.equal(r[`${PB}/${BENCH}`], 'SUPPORTED')
  assert.equal(r[`${B2}/${BENCH}`], 'NOT_SUPPORTED')
  assert.ok(Object.entries(r).filter(([k]) => k.endsWith(DODGERS)).every(([, v]) => v === 'NOT_SUPPORTED'))
  assert.equal(rows.filter((x) => x.baseline_supported && x.reference_population !== DODGERS).length, 2, 'two benchmark reference baselines: reach (050) and positive bWAR (057)')
  const league = benchmarkLabelCoverage(rows).find((x) => x.target_key === PB)
  assert.equal(league.statement, '86 labelled (15 positive, 71 negative): the support minimum is met for this rank-selected sample. It is a reference result for this sample only and is never a Dodgers probability.')
  assert.equal((await q(`select * from public.product_model_evaluations`)).length, 9)
  const methodology = fs.readFileSync(path.join(root, 'app/methodology/page.js'), 'utf8')
  assert.match(methodology, /Today no Dodgers target qualifies for a published probability, and no fitted model beats the naive base rate out of time/)
  assert.match(methodology, /it describes that rank-selected sample only and is never a Dodgers probability/)
  assert.doesNotMatch(methodology, /Today no target qualifies/)
})

test('research queue: the eleven leave the label-blocked queue for both bWAR targets (18 -> 7 each); BWAR_MISSING is unchanged (it reads CAREER_BWAR metrics, which 057 does not write)', async () => {
  const m = await measure(q)
  const pq = (x, issue, t) => x.probability_queue.find((y) => y.issue === issue && y.target_key === t)?.items ?? 0
  for (const t of [PB, B2]) assert.deepEqual([pq(pre, 'LABEL_BLOCKED_BY_MISSING_AUDIT', t), pq(m, 'LABEL_BLOCKED_BY_MISSING_AUDIT', t)], [18, 7], t)
  assert.deepEqual([pq(pre, 'TARGET_REFERENCE_NOT_SUPPORTED', PB), pq(m, 'TARGET_REFERENCE_NOT_SUPPORTED', PB)], [2, 1])
  assert.deepEqual([pre.research_tasks, m.research_tasks], [[{ task_type: 'BWAR_MISSING', items: 50 }], [{ task_type: 'BWAR_MISSING', items: 50 }]])
  assert.equal(m.counts.open_research_tasks, pre.counts.open_research_tasks, 'the Dodgers research-task count does not move')
})

test('verifier: 259/259 before and after 057 with no new check and no moved pin', async () => {
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 259)
  const c = await clone(pre057Dump)
  try {
    const p = await checkInvariants(c.query, CANONICAL_EXPECTATIONS)
    assert.deepEqual(failedChecks(p).map((f) => f.name), [], 'the pre-057 state passes the same expectations 259/259')
  } finally { await c.close() }
})

test('idempotent: a rerun adds nothing, runs no second refresh and changes no table', async () => {
  const b = await tableHashes()
  const gen = (await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g
  await chain.db.exec(sql057)
  assert.deepEqual(await tableHashes(), b)
  assert.equal((await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g, gen)
})

test('guarded: 057 refuses a database it was not written for, a changed source, a deferred player, an overwrite, a changed threshold or evaluation, or an overlap', async () => {
  /** @type {Array<[string | null, RegExp, string?]>} */
  const cases = [
    [null, /057: the sources are not the two approved archived Baseball-Reference captures/, sql057.replace('ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023', '0'.repeat(64))],
    [null, /057: the scope is not exactly the eleven approved complete-window players/, sql057.replace('"deferred_bref_ids":["ariasga01"', '"deferred_bref_ids":["sotoju01"')],
    [`update public.outcomes o set career_war = 1.23 from public.players p where p.id = o.player_id and p.slug = 'juan-soto'`, /057: juan-soto already carries a different career bWAR/],
    [`insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games, source_id,
        observed_through_date, observed_through_season, retrieved_at, confidence)
      select 'sotoju01', '665742', p.id, 2018, 'WSN', (select organization_id from public.bref_team_code_map where bref_team_code = 'WSN'), 1, 'BAT', 3.00, 116, so.id, '2026-09-28', 2026, now(), 'VERIFIED'
      from public.players p, public.sources so where p.slug = 'juan-soto' and so.url = 'https://www.baseball-reference.com/data/war_daily_bat.txt'`, /057: juan-soto already has active team-season bWAR from another source/],
    [`update public.outcome_targets set min_positives = 11 where target_key = '${PB}'`, /057: the outcome-target thresholds are not the 041 ones/],
    [`update public.outcome_model_evaluations set training_fingerprint = '00000000000000000000000000000000'`, /057: the stored reach evaluation is not the current 056 one/],
    [`insert into public.signings (player_id, organization_id, signing_year, pathway, bonus_publicly_reported, record_scope)
      select p.id, o.id, 2026, 'OTHER', false, 'TRACKED' from public.players p, public.organizations o where p.slug = 'jasson-dominguez' and o.abbreviation = 'LAD'`,
    /057: a player holds both a Dodgers signing and a benchmark signing/],
    [`delete from public.signing_population_member_sources where member_id in (select m.id from public.signing_population_members m join public.signing_populations sp on sp.id = m.population_id where sp.population_key = 'MLB-2019-PIPELINE-TOP30');
      delete from public.signing_population_members where population_id in (select id from public.signing_populations where population_key = 'MLB-2019-PIPELINE-TOP30');
      delete from public.signing_populations where population_key = 'MLB-2019-PIPELINE-TOP30'`, /057: Migrations through 056 have not been applied/],
  ]
  for (const [mutate, pattern, migration] of cases) {
    const c = await clone(pre057Dump)
    try {
      if (mutate) await c.db.exec(mutate)
      await failsWith(c, migration ?? sql057, pattern)
    } finally { await c.close() }
  }
})

test('rollback: retracts exactly the 057 rows, restores career bWAR and the stored evaluation, refreshes once; 057 applies again', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(rollback057)
    const got = await tableHashes(c)
    const differs = Object.keys(preTables).filter((t) => preTables[t] !== got[t] && !t.startsWith('product_') && !['sources', 'player_mlb_team_season_war'].includes(t))
    assert.deepEqual(differs, [], 'every research table equals its pre-057 content; the sources stay as provenance')
    const pre057 = await clone(pre057Dump)
    try {
      assert.deepEqual(await rowsOf(c, 'player_mlb_team_season_war', `where record_status = 'ACTIVE'`), await rowsOf(pre057, 'player_mlb_team_season_war'), 'the active facts are exactly the pre-057 facts')
    } finally { await pre057.close() }
    const r = await c.query(`select count(*)::int as n, count(*) filter (where retraction_reason like 'Rollback of Migration 057%')::int as reason from public.player_mlb_team_season_war where record_status = 'RETRACTED'`)
    assert.deepEqual(r[0], { n: 54, reason: 54 }, 'retracted, never deleted')
    const m = await measure(async (s) => (await c.db.query(s)).rows)
    assert.deepEqual(m.support, pre.support)
    assert.deepEqual(m.evaluation, pre.evaluation)
    assert.deepEqual(await labels(c), preLabels)
    assert.deepEqual((await c.query(`select snapshot from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`)), [])
    assert.deepEqual(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name), [])
    await failsWith(c, rollback057, /rollback-057: Migration 057 is not applied/)
    await c.db.exec(sql057)
    const again = await measure(async (s) => (await c.db.query(s)).rows)
    const now = await measure(q)
    assert.deepEqual(again.support, now.support)
    assert.deepEqual(again.evaluation, now.evaluation)
    assert.deepEqual(await labels(c), await labels())
    assert.deepEqual([again.war.active, again.war.retracted], [now.war.active, 54])
    assert.deepEqual(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name), [])
  } finally { await c.close() }
})

test('rollback refuses when later research depends on the 057 evidence', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`update public.outcomes o set career_war = 9.99 from public.players p where p.id = o.player_id and p.slug = 'juan-soto'`)
    await failsWith(c, rollback057, /rollback-057: later research depends on the 057 evidence/)
  } finally { await c.close() }
})

test('reproducible: the committed migration and rollback are byte-identical to the build output', () => {
  assert.equal(assemble(evaluation), sql057)
  assert.equal(assembleRollback(evaluation), rollback057)
})
