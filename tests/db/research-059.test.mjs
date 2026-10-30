// Migration 059: career bWAR metric reconciliation. The 058 database is built (001-058), 059 is applied for real, and the tests prove that exactly
// the eleven benchmark players whose complete mapped team-season ledger 035 loaded from the 2026-09-28 Baseball-Reference data files gain one
// CAREER_BWAR observation each (a dated career-to-date value, derived from that ledger by the 032 pattern: ACTIVE BWAR BAT + PITCH rows, rounded to one
// decimal, through the 2026 season, citing the batting-file source with the pitching file named in the notes), that BWAR_MISSING moves 50 -> 39 and
// nothing else moves (no source, team-season row, outcome, label, evaluation, prediction output, organizational or transaction value, snapshot
// content), that the 057 eleven stay unreconciled, and that 059 is idempotent, guarded, reproducible and exactly reversible.
//   CAREER_BWAR = CAREER-TO-DATE AS OF A DATE   OUTCOME CAREER_WAR FIELD != CAREER_BWAR METRIC   CAREER_BWAR != TRANSACTION RETURN VALUE INPUT

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'
import { measure } from '../../database/research/059/measure.mjs'
import { assemble, assembleRollback, notesFor } from '../../database/research/059/build.mjs'
import { capture, verifyApply, verifyNoop, verifyRollback, VIEW_FINGERPRINTS } from '../../database/research/059/release-evidence.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '059_career_bwar_metric_reconciliation.sql'
const sql059 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback059 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-059.sql'), 'utf8')
const scope = JSON.parse(fs.readFileSync(path.join(root, 'database/research/059/scope.json'), 'utf8'))
const ELEVEN = scope.players.map((p) => p.slug)
const EXCLUDED = scope.excluded_057.map((p) => p.slug)
const BAT_URL = 'https://www.baseball-reference.com/data/war_daily_bat.txt'
const PITCH_URL = 'https://www.baseball-reference.com/data/war_daily_pitch.txt'
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']
const SNAP_DROP = ['generation_id', 'refreshed_at', 'created_at', 'generated_at', 'snapshot_at']
const EXPECTED = { 'rafael-devers': '30.6', 'gleyber-torres': '20.9', 'eloy-jimenez': '5.2', 'huascar-ynoa': '1.1', 'marcos-diplan': '0.4', 'dermis-garcia': '0.5',
  'lewin-diaz': '0.1', 'anderson-espinoza': '0.0', 'hyo-jun-park': '-0.6', 'jose-herrera': '-0.7', 'diego-castillo': '-0.8' }

let chain
let pre059Dump
let post059Dump
let pre
let post
let preTables
let preSnap
let preGen
let preVerify
let preEvidence
let postEvidence
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
const tableHashes = async (c = chain, drop = []) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5(R(await c.query(`select (to_jsonb(t) - 'updated_at' ${drop.map((k) => `- '${k}'`).join(' ')})::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const rowsOf = async (c, t, where = '') => R(await c.query(`select (to_jsonb(t) - 'updated_at')::text as r from public.${t} t ${where}`)).map((r) => r.r).sort()
const generation = async (c = chain) => R(await c.query(`select max(generation_id)::int as g from public.product_executive_snapshot`))[0].g
const drift = async (c = chain) => R(await c.query(`select count(*)::int as n from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`))[0].n
const verify = async (c = chain) => { const r = await checkInvariants(async (s, p) => R(await c.query(s, p)), CANONICAL_EXPECTATIONS); return { total: r.hard.length, failed: failedChecks(r).map((x) => x.name) } }
const careerCount = async (c = chain) => R(await c.query(`select count(*)::int as n from public.player_metric_observations where metric_key = 'CAREER_BWAR'`))[0].n
const missing = async (c = chain) => R(await c.query(`select player_slug from public.v_research_tasks where task_type = 'BWAR_MISSING' order by 1`)).map((x) => x.player_slug)

before(async () => {
  chain = await buildChainThrough('058_transaction_return_bwar_evidence.sql')
  pre059Dump = await chain.db.dumpDataDir('none')
  pre = await measure(q)
  preTables = await tableHashes()
  preSnap = await tableHashes(chain, SNAP_DROP)
  preGen = await generation()
  preVerify = await verify()
  preEvidence = (await capture(q)).evidence
  await chain.db.exec(sql059)
  post = await measure(q)
  postEvidence = (await capture(q)).evidence
  post059Dump = await chain.db.dumpDataDir('none')
}, { timeout: 900000 })

after(async () => { await chain?.close() })

test('059 follows 058 in the manifest as the last file; it is not frozen; the migration and rollback are the build output', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '058_transaction_return_bwar_evidence.sql')
  assert.equal(i, manifest.canonical_sql.length - 1)
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  assert.equal(manifest.canonical_sql.length, 63)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.equal(Object.keys(frozen).length, 62)
  assert.ok(!(FILE in frozen), '059 is not frozen while unreleased')
  assert.match(sql059, /^-- DISI v0\.44\n-- 059_career_bwar_metric_reconciliation\.sql\n/)
  assert.match(rollback059, /^-- DISI rollback of Migration 059/)
  assert.equal(assemble(), sql059)
  assert.equal(assembleRollback(), rollback059)
})

test('baseline: the 059 research was written against exactly this pre-059 state', () => {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'database/research/059/baseline.json'), 'utf8'))
  for (const k of ['metric', 'scoped_metric', 'bwar_missing', 'tasks', 'ledger', 'identity', 'war_sources', 'dossier', 'war', 'value_totals', 'executive', 'transaction_queue', 'value_queue'])
    assert.deepEqual(pre[k], b[k], k)
  assert.deepEqual([pre.metric.find((m) => m.metric_key === 'CAREER_BWAR').observations, pre.bwar_missing.length, pre.counts.sources, pre.war.active], [47, 50, 3384, 2025])
  assert.equal(pre.scoped_metric.length, 0, 'none of the eleven and none of the 057 eleven has a CAREER_BWAR observation before 059')
  assert.ok(pre.bwar_missing.every((x) => x.franchise_key !== 'DODGERS'), 'every BWAR_MISSING row is a benchmark signing')
})

test('data only: no table, view, function, grant, policy, trigger or definition changes; the provider trigger is unchanged', async () => {
  const c = await clone(pre059Dump)
  try {
    const cat = async (x) => ({
      rel: await x.query(`select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'i') order by 1`),
      fn: await x.query(`select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile, md5(p.prosrc) as h from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
      pol: await x.query(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`),
      trg: await x.query(`select c.relname, t.tgname, t.tgenabled, md5(pg_get_triggerdef(t.oid)) as d from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
      views: await x.query(`select relname, md5(pg_get_viewdef(oid)) as h from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`),
      cols: await x.query(`select table_name, column_name, data_type, column_default from information_schema.columns where table_schema = 'public' order by 1, 2`),
    })
    assert.deepEqual(await cat(chain), await cat(c))
  } finally { await c.close() }
})

test('scope: exactly eleven new CAREER_BWAR observations, for exactly the eleven reviewed benchmark players, with their stable identities', async () => {
  assert.equal(await careerCount(), 58)
  const rows = await q(`select pl.slug, pl.bref_id, pl.mlb_id::text as mlb_id, m.value::text as value from public.player_metric_observations m join public.players pl on pl.id = m.player_id
    where m.metric_key = 'CAREER_BWAR' and m.notes like 'Migration 059:%' order by 1`)
  assert.deepEqual(rows.map((r) => r.slug), [...ELEVEN].sort())
  for (const p of scope.players) {
    const r = rows.find((x) => x.slug === p.slug)
    assert.deepEqual([r.bref_id, r.mlb_id, r.value], [p.bref_id, p.mlb_id, Number(EXPECTED[p.slug]).toFixed(3)], p.slug)
  }
  const c = await clone(pre059Dump)
  try {
    for (const t of ['players', 'signings', 'outcome_audits']) assert.deepEqual(await rowsOf(chain, t), await rowsOf(c, t), `${t} unchanged`)
  } finally { await c.close() }
})

test('aggregation: each value is round(sum of ACTIVE BWAR BAT + PITCH team-season rows, 1); no TOT, no duplicate stint, negatives preserved', async () => {
  const l = await q(`select pl.slug, coalesce(sum(w.war) filter (where w.component = 'BAT'), 0) as bat, coalesce(sum(w.war) filter (where w.component = 'PITCH'), 0) as pitch,
      sum(w.war) as raw, round(sum(w.war), 1)::text as r1, count(*) filter (where w.bref_team_code = 'TOT')::int as tot, count(*)::int as n,
      count(distinct (w.season, w.bref_team_code, w.stint_ordinal, w.component))::int as keys, (select m.value::text from public.player_metric_observations m where m.player_id = pl.id and m.metric_key = 'CAREER_BWAR') as stored
    from public.players pl join public.player_mlb_team_season_war w on w.player_id = pl.id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
    where pl.slug = any($1) group by pl.id, pl.slug order by 2`, [ELEVEN])
  assert.equal(l.length, 11)
  for (const p of scope.players) {
    const x = l.find((y) => y.slug === p.slug)
    assert.equal(Number(x.bat), Number(p.bat_bwar), `${p.slug} BAT`)
    assert.equal(Number(x.pitch), Number(p.pitch_bwar), `${p.slug} PITCH`)
    assert.equal(Number(x.raw), Number(p.raw_bwar), `${p.slug} raw`)
    assert.equal(Number(x.r1), Number(EXPECTED[p.slug]), `${p.slug} rounded`)
    assert.equal(Number(x.stored), Number(EXPECTED[p.slug]), `${p.slug} stored`)
    assert.equal(x.tot, 0); assert.equal(x.keys, x.n, `${p.slug}: one row per season, team, stint and component`)
  }
  // multi-component players and negative values, exactly as reviewed
  assert.deepEqual(scope.players.filter((p) => p.pitch_rows > 0 && p.bat_rows > 0).map((p) => p.slug).sort(),
    ['anderson-espinoza', 'diego-castillo', 'huascar-ynoa', 'jose-herrera', 'marcos-diplan'])
  assert.deepEqual(['hyo-jun-park', 'jose-herrera', 'diego-castillo'].map((s) => Number(l.find((x) => x.slug === s).stored)), [-0.6, -0.7, -0.8])
  assert.equal(Number(l.find((x) => x.slug === 'anderson-espinoza').raw), -0.02)
  assert.equal(Number(l.find((x) => x.slug === 'anderson-espinoza').stored), 0)
})

test('provenance: through 2026-09-28 / the 2026 season, citing the live batting data-file source, the pitching file and both pinned hashes in the notes; no source added', async () => {
  const rows = await q(`select pl.slug, pl.bref_id, pl.mlb_id::text as mlb_id, m.observed_through_date::text as d, m.observed_through_season as s, so.url, m.confidence::text as conf, m.notes
    from public.player_metric_observations m join public.players pl on pl.id = m.player_id join public.sources so on so.id = m.source_id
    where m.metric_key = 'CAREER_BWAR' and pl.slug = any($1) order by 1`, [ELEVEN])
  assert.equal(rows.length, 11)
  for (const r of rows) {
    assert.deepEqual([r.d, r.s, r.url, r.conf], ['2026-09-28', 2026, BAT_URL, 'VERIFIED'], r.slug)
    assert.equal(r.notes, notesFor(r))
    for (const pin of [BAT_URL, PITCH_URL, 'ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8', '061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5', '2026-09-28', 'rounded to one decimal'])
      assert.ok(r.notes.includes(pin), `${r.slug} notes pin ${pin}`)
  }
  assert.equal(post.counts.sources, 3384)
  assert.equal((await tableHashes()).sources, preTables.sources, 'the sources table is byte-identical')
  assert.equal((await one(`select count(*)::int as n from public.player_metric_observations m join public.sources so on so.id = m.source_id where so.url like 'https://web.archive.org/%'`)).n, 0, 'no observation cites an archived capture')
})

test('queue: BWAR_MISSING 50 -> 39; exactly the eleven leave it; the other 39 and every other research task are unchanged', async () => {
  const before = pre.bwar_missing.map((x) => x.player_slug), after = await missing()
  assert.equal(before.length, 50); assert.equal(after.length, 39)
  assert.deepEqual(before.filter((s) => !after.includes(s)).sort(), [...ELEVEN].sort())
  assert.deepEqual(after, before.filter((s) => !ELEVEN.includes(s)))
  for (const s of EXCLUDED) assert.ok(after.includes(s), `${s} (057) stays in BWAR_MISSING`)
  assert.deepEqual(post.tasks.filter((t) => t.task_type !== 'BWAR_MISSING'), pre.tasks.filter((t) => t.task_type !== 'BWAR_MISSING'))
  assert.equal(post.isolation.other_research_tasks, pre.isolation.other_research_tasks, 'Dodgers research tasks and every other task type byte-identical')
})

test('existing metric layer: the 47 earlier observations are untouched and every observation still reconciles with its ledger within the verifier tolerance', async () => {
  const c = await clone(pre059Dump)
  try {
    const before = await rowsOf(c, 'player_metric_observations')
    const after = await rowsOf(chain, 'player_metric_observations')
    assert.equal(before.length, 47); assert.equal(after.length, 58)
    assert.deepEqual(after.filter((r) => before.includes(r)), before, 'no earlier observation changed or disappeared')
    assert.ok(after.filter((r) => !before.includes(r)).every((r) => JSON.parse(r).notes.startsWith('Migration 059:')))
  } finally { await c.close() }
  const off = await q(`select pl.slug from public.players pl join public.player_mlb_team_season_war w on w.player_id = pl.id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
    join lateral (select m.value from public.player_metric_observations m where m.player_id = pl.id and m.metric_key = 'CAREER_BWAR' order by m.observed_through_date desc limit 1) m on true
    group by pl.slug, m.value having abs(sum(w.war) - m.value) > 0.1`)
  assert.deepEqual(off, [])
})

test('nothing else moves: only player_metric_observations (and the snapshot refresh) changes; outcomes byte-identical and equal to the new values at one decimal', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => now[t] !== preTables[t] && !SNAP.includes(t))
  assert.deepEqual(changed, ['player_metric_observations'])
  const oc = await q(`select pl.slug, oc.career_war::text as cw, (round(oc.career_war, 1) = m.value) as same
    from public.outcomes oc join public.players pl on pl.id = oc.player_id join public.player_metric_observations m on m.player_id = pl.id and m.metric_key = 'CAREER_BWAR'
    where pl.slug = any($1) order by 1`, [ELEVEN])
  assert.equal(oc.length, 11)
  for (const r of oc) {
    assert.equal(r.same, true, `${r.slug}: the observation is the stored outcomes.career_war at one decimal`)
    assert.equal(Number(r.cw), Number(scope.players.find((p) => p.slug === r.slug).raw_bwar), `${r.slug}: outcomes.career_war unchanged`)
  }
  assert.equal(post.isolation.outcomes, pre.isolation.outcomes)
  assert.equal(post.isolation.team_season_war, pre.isolation.team_season_war)
})

test('prediction isolation: labels, features, training population, support, evaluations, fingerprints and every output unchanged', () => {
  for (const k of ['training_population', 'feature_matrix', 'support', 'evaluation_view', 'probabilities', 'expected_values', 'realized_outcome'])
    assert.equal(post.isolation[k], pre.isolation[k], k)
  assert.deepEqual(post.prediction, pre.prediction)
  assert.equal(post.prediction.evaluation_fingerprints, '102c01a35d380d36493465cef1070c07,1aa73185a9dab3071d4530ee670dd088,86b58f473301e2425751d853abd88e94')
  assert.deepEqual([post.prediction.supported_models, post.prediction.probabilities, post.prediction.expected_values, post.prediction.recommendations, post.prediction.supported_targets], [0, 0, 0, 0, 0])
})

test('value isolation: CAREER_BWAR is not a transaction-return input; organizational and transaction value byte-identical', () => {
  for (const k of ['realized_value', 'lineage', 'transaction_queue', 'value_queue', 'executive_overview']) assert.equal(post.isolation[k], pre.isolation[k], k)
  assert.deepEqual(post.value_totals, pre.value_totals); assert.deepEqual(post.executive, pre.executive)
  assert.deepEqual([post.war.active, post.value_totals.realized, post.value_totals.resolved, post.executive.direct, post.executive.trade, post.value_totals.pkg_first, post.value_totals.observable],
    [2025, '299.00', 88, '284.00', '15.00', '95.85', '141.71'])
  assert.deepEqual([post.transaction_queue.reduce((s, x) => s + x.items, 0), post.value_queue.reduce((s, x) => s + x.items, 0)], [57, 90])
})

test('product: the eleven dossiers read the observation through the 2026 season; the 057 eleven stay without one', () => {
  for (const s of ELEVEN) {
    const d = post.dossier.find((x) => x.player_slug === s)
    assert.deepEqual([Number(d.career_bwar), d.bwar_observed_through_season, d.bwar_observed_through_date], [Number(EXPECTED[s]), 2026, '2026-09-28'], s)
  }
  for (const s of EXCLUDED) assert.equal(post.dossier.find((x) => x.player_slug === s).career_bwar, null, s)
  assert.deepEqual(post.dossier.map((d) => [d.player_slug, d.is_active]), pre.dossier.map((d) => [d.player_slug, d.is_active]), 'active status unchanged')
})

test('snapshots: one refresh, one new generation on all eleven tables, zero drift, no business content change', async () => {
  assert.equal(await generation(), preGen + 1)
  assert.equal(await drift(), 0)
  for (const t of SNAP) assert.deepEqual((await q(`select array_agg(distinct generation_id)::int[] as g from public.${t}`))[0].g, [preGen + 1], t)
  const now = await tableHashes(chain, SNAP_DROP)
  assert.deepEqual(SNAP.filter((t) => now[t] !== preSnap[t]), [], 'every persisted snapshot is logically unchanged')
})

test('verifier: 259/259 before and after 059, with no expectation change', async () => {
  assert.deepEqual(preVerify, { total: 259, failed: [] })
  assert.deepEqual(await verify(), { total: 259, failed: [] })
})

test('idempotent: a rerun adds nothing, runs no second refresh and changes no table', async () => {
  const c = await clone(post059Dump)
  try {
    const h0 = await tableHashes(c)
    await c.db.exec(sql059)
    assert.deepEqual(await tableHashes(c), h0)
    assert.equal(await careerCount(c), 58)
    assert.equal((await missing(c)).length, 39)
  } finally { await c.close() }
})

test('guarded: 059 refuses an existing, earlier or changed observation for one of the eleven, a moved ledger or outcome, an excluded player, and a moved queue', async () => {
  /** @type {[string, RegExp][]} */
  const cases = [
    [`insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, notes)
      select id, 'CAREER_BWAR', 30.6, '2026-10-04', 2026, (select id from public.sources where url = '${BAT_URL}'), 'other' from public.players where slug = 'rafael-devers';`, /not the 059 observation/],
    [`update public.player_mlb_team_season_war set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test'
      where id = (select w.id from public.player_mlb_team_season_war w join public.players pl on pl.id = w.player_id where pl.slug = 'gleyber-torres' order by w.season limit 1);`, /team-season ledger of gleyber-torres/],
    [`update public.outcomes set career_war = 5.2 where player_id = (select id from public.players where slug = 'eloy-jimenez');`, /outcomes\.career_war of eloy-jimenez/],
    [`insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, notes)
      select id, 'CAREER_BWAR', 42.6, '2026-09-28', 2025, (select id from public.sources where url = '${BAT_URL}'), 'x' from public.players where slug = 'juan-soto';`, /a 057 player has a CAREER_BWAR observation/],
    [`update public.players set bref_id = 'deverra02' where slug = 'rafael-devers';`, /not the reviewed identity/],
  ]
  for (const [mutation, pattern] of cases) {
    const c = await clone(pre059Dump)
    try {
      await c.db.exec(mutation)
      const h = await tableHashes(c)
      await failsWith(c, sql059, pattern)
      assert.deepEqual(await tableHashes(c), h, 'a refused 059 changes nothing')
    } finally { await c.close() }
  }
})

test('rollback: deletes exactly the eleven observations, restores every pre-059 table and the queue, refreshes once; 059 applies again and reproduces its state', async () => {
  const c = await clone(post059Dump)
  try {
    const g = await generation(c)
    await c.db.exec(rollback059)
    assert.equal(await careerCount(c), 47)
    assert.deepEqual(await missing(c), pre.bwar_missing.map((x) => x.player_slug))
    const h = await tableHashes(c)
    assert.deepEqual(Object.keys(h).filter((t) => !SNAP.includes(t) && h[t] !== preTables[t]), [], 'every base table equals the pre-059 state')
    assert.equal(await generation(c), g + 1); assert.equal(await drift(c), 0)
    const hs = await tableHashes(c, SNAP_DROP)
    assert.deepEqual(SNAP.filter((t) => hs[t] !== preSnap[t]), [])
    assert.deepEqual(await verify(c), { total: 259, failed: [] })
    await failsWith(c, rollback059, /Migration 059 is not applied/)
    // reapply: the same eleven observations (surrogate ids and created_at aside), the same queue, one more generation
    await c.db.exec(sql059)
    assert.equal(await generation(c), g + 2)
    const logical = async (x) => R(await x.query(`select pl.slug, m.value::text, m.observed_through_date::text, m.observed_through_season, m.source_id::text, m.confidence::text, m.notes
      from public.player_metric_observations m join public.players pl on pl.id = m.player_id where m.metric_key = 'CAREER_BWAR' order by 1`))
    assert.deepEqual(await logical(c), await logical(chain))
    assert.deepEqual(await missing(c), await missing())
  } finally { await c.close() }
})

test('rollback refuses when a later CAREER_BWAR observation exists or a 059 row was changed, and changes nothing', async () => {
  const cases = [
    `insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, notes)
      select id, 'CAREER_BWAR', 31.0, '2027-10-01', 2027, (select id from public.sources where url = '${BAT_URL}'), 'later' from public.players where slug = 'rafael-devers';`,
    `update public.player_metric_observations set value = 20.8 where notes like 'Migration 059:%' and player_id = (select id from public.players where slug = 'gleyber-torres');`,
    `update public.player_metric_observations set notes = notes || ' ' where notes like 'Migration 059:%' and player_id = (select id from public.players where slug = 'lewin-diaz');`,
  ]
  for (const mutation of cases) {
    const c = await clone(post059Dump)
    try {
      await c.db.exec(mutation)
      const h = await tableHashes(c)
      await failsWith(c, rollback059, /not the released 059 observation/)
      assert.deepEqual(await tableHashes(c), h, 'a refused rollback changes nothing')
    } finally { await c.close() }
  }
})

test('dependency: no new source, no team-season row, nothing on the 057 archived sources; rollback-058 still guards only its own evidence', async () => {
  assert.equal(post.isolation.sources, pre.isolation.sources)
  assert.equal(post.isolation.team_season_war, pre.isolation.team_season_war)
  for (const f of fs.readdirSync(path.join(root, 'database/release/sql')).filter((x) => /^rollback-0(4|5)/.test(x) && x !== 'rollback-059.sql'))
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'database/release/sql', f), 'utf8'), /player_metric_observations/, `${f} does not read the metric layer`)
})

// ---- v3 release architecture: the transaction proves its direct result; the exhaustive isolation proof runs outside it (release-evidence.mjs)

const HOLD = (r) => r.checks.filter((c) => !c.pass).map((c) => c.name)

test('external evidence: the pre-apply capture and the post-commit capture verify the 059 transition (PASS), and a rerun as a no-op (PASS)', async () => {
  const r = verifyApply(preEvidence, postEvidence)
  assert.deepEqual(HOLD(r), [], JSON.stringify(r.checks.filter((c) => !c.pass)))
  assert.equal(r.verdict, 'PASS')
  assert.deepEqual(Object.keys(preEvidence.views).sort(), Object.keys(VIEW_FINGERPRINTS).sort())
  assert.equal(Object.keys(preEvidence.tables).length + Object.keys(preEvidence.snapshots).length,
    (await one(`select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)).n, 'every public base table is captured')
  const c = await clone(post059Dump)
  try {
    const before = (await capture(c.query)).evidence
    await c.db.exec(sql059)
    const after = (await capture(c.query)).evidence
    const n = verifyNoop(before, after)
    assert.deepEqual(HOLD(n), [])
    // the rerun is not an apply: the apply verifier refuses a transition that added nothing
    assert.equal(verifyApply(before, after).verdict, 'HOLD')
  } finally { await c.close() }
})

test('external evidence: the isolation checks removed from the transaction are still enforced after the commit (each unexpected change -> HOLD)', async () => {
  /** @type {[string, string, RegExp][]} */
  const cases = [
    ['an unrelated base table moved', `update public.development_milestones set evidence_basis = coalesce(evidence_basis, '') || ' v3 test' where id = (select id from public.development_milestones order by id limit 1);`,
      /^base tables: only player_metric_observations changed/],
    ['an earlier observation moved', `update public.player_metric_observations set notes = notes || ' v3 test' where id = (select id from public.player_metric_observations where notes not like 'Migration 059:%' order by id limit 1);`,
      /^player_metric_observations: every pre-059 row present and unchanged/],
    ['a snapshot business column moved', `update public.product_executive_snapshot set product_statement = product_statement || ' v3 test';`, /^snapshots: business content identical/],
    ['the schema moved', `create view public.v_059_v3_test as select 1 as x;`, /^schema and security catalog identical/],
  ]
  for (const [label, mutation, pattern] of cases) {
    const c = await clone(post059Dump)
    try {
      await c.db.exec(mutation)
      const r = verifyApply(preEvidence, (await capture(c.query)).evidence)
      assert.equal(r.verdict, 'HOLD', label)
      assert.ok(HOLD(r).some((n) => pattern.test(n)), `${label}: ${HOLD(r).join(' | ')}`)
    } finally { await c.close() }
  }
  // a view-level change with no base-table write of its own is caught by the view fingerprints and the measurement
  const tampered = structuredClone(postEvidence)
  tampered.views.evaluation_view = { ...tampered.views.evaluation_view, h: '0'.repeat(32) }
  assert.ok(HOLD(verifyApply(preEvidence, tampered)).some((n) => /^view fingerprints identical/.test(n)))
})

test('external evidence: rollback-059 verifies against the original pre-059 capture (PASS), and a reapply verifies as an apply again', async () => {
  const c = await clone(post059Dump)
  try {
    await c.db.exec(rollback059)
    const rolled = (await capture(c.query)).evidence
    assert.deepEqual(HOLD(verifyRollback(postEvidence, rolled, preEvidence)), [])
    await c.db.exec(sql059)
    const re = (await capture(c.query)).evidence
    assert.deepEqual(HOLD(verifyApply(rolled, re)), [])
  } finally { await c.close() }
})

test('incident regression: after the INSERT the migration runs no whole-database hash pass and no unrelated view fingerprint; the external verifier does', () => {
  const body = (sql, tag) => sql.replace(new RegExp(`\\$${tag}\\$[\\s\\S]*?\\$${tag}\\$`, 'g'), "'payload'").replace(/--.*$/gm, '')
  const isolationViews = ['v_outcome_target_support', 'v_outcome_training_population', 'v_outcome_feature_matrix', 'v_outcome_model_evaluation', 'v_player_outcome_probability',
    'v_expected_value_support', 'v_player_realized_outcome', 'v_player_realized_organizational_value', 'v_transaction_asset_lineage', 'v_transaction_research_queue',
    'v_value_research_queue', 'v_executive_overview']
  for (const [sql, tag, write] of [[sql059, 'm059', /insert into public\.player_metric_observations/], [rollback059, 'r059', /delete from public\.player_metric_observations/]]) {
    const b = body(sql, tag)
    const after = b.slice(b.search(write))
    assert.ok(after.length > 0 && after.length < b.length)
    // no loop over the public base tables except the product_* generation check, and no row-hash EXECUTE
    for (const m of b.matchAll(/for \w+ in select c\.relname from pg_class c where ([\s\S]*?) loop/g)) assert.match(m[1], /like 'product\\_%'/, 'the only pg_class loop is the snapshot generation check')
    assert.doesNotMatch(b, /execute format\('select md5/, 'no dynamic per-table row hash anywhere in the transaction')
    for (const v of isolationViews) assert.ok(!b.includes(`public.${v}`), `${tag}: ${v} is fingerprinted outside the transaction, not inside it`)
    assert.doesNotMatch(b, /_[mr]059_(tables|untouched)\b/)
    // the external verifier still fingerprints every one of them
    for (const v of isolationViews) assert.ok(Object.values(VIEW_FINGERPRINTS).some((s) => s.includes(`public.${v} `)), `release-evidence fingerprints ${v}`)
  }
})
