// Migration 058: transaction-return bWAR evidence. The 057 database is built (001-057), 058 is applied for real, and the tests prove that exactly
// the four returned players of existing Dodgers trades (Garland, Leyritz, Grant, Versalles) gain Baseball-Reference team-season bWAR from the two
// archived captures 057 registered (no source row, no players row, no team-code mapping; Versalles's 1969 WSA stint not loaded), that the existing
// interval-bounded rules value them (Abreu realized 1.40; Leyritz shared-package only; Grant and Versalles chain-observable only), that the queues
// move exactly as reviewed, that the prediction layer is byte-identical, that the verifier's unavailable-WAR pins move to the 057 layer, and that
// 058 is idempotent, guarded, reproducible and reversible, with the intended dependency on the 057 sources.
//   KNOWN RETURN WAR != ATTRIBUTABLE SIGNING VALUE   PACKAGE VALUE != PLAYER ATTRIBUTION   OLDER VIEW != VALUE OF RECORD

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildChainThrough, manifest } from './canonical-chain.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS, EXPECTATIONS_THROUGH_057 } from '../../scripts/db/lib/invariants.mjs'
import { measure } from '../../database/research/058/measure.mjs'
import { assemble, assembleRollback } from '../../database/research/058/build.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '058_transaction_return_bwar_evidence.sql'
const sql058 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback058 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-058.sql'), 'utf8')
const sql057 = fs.readFileSync(path.join(root, 'database/sql/057_benchmark_bwar_evidence.sql'), 'utf8')
const rollback057 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-057.sql'), 'utf8')
const scope = JSON.parse(fs.readFileSync(path.join(root, 'database/research/058/scope.json'), 'utf8'))
const URLS = ['https://web.archive.org/web/20260911214553id_/https://www.baseball-reference.com/data/war_daily_bat.txt',
  'https://web.archive.org/web/20260210222101id_/https://www.baseball-reference.com/data/war_daily_pitch.txt']
const FOUR = ['garlajo01', 'leyriji01', 'grantmu01', 'versazo01']
const SNAP = ['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support',
  'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables', 'product_database_status']

let chain
let pre058Dump
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
const tableHashes = async (c = chain, drop = []) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5(R(await c.query(`select (to_jsonb(t) - 'updated_at' ${drop.map((k) => `- '${k}'`).join(' ')})::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const rowsOf = async (c, t, where = '') => R(await c.query(`select (to_jsonb(t) - 'updated_at')::text as r from public.${t} t ${where}`)).map((r) => r.r).sort()
const issues = (m, queue) => Object.fromEntries(m[queue].map((x) => [x.issue, x.items]))
const total = (m, queue) => m[queue].reduce((s, x) => s + x.items, 0)
const signing = (m, slug) => m.signings.find((s) => s.player_slug === slug)
const SNAP_DROP = ['generation_id', 'refreshed_at', 'created_at', 'generated_at', 'snapshot_at']

let preSnap
before(async () => {
  chain = await buildChainThrough('057_benchmark_bwar_evidence.sql')
  pre058Dump = await chain.db.dumpDataDir('none')
  pre = await measure(q)
  preTables = await tableHashes()
  preSnap = await tableHashes(chain, SNAP_DROP)
  await chain.db.exec(sql058)
}, { timeout: 900000 })

after(async () => { await chain?.close() })

test('058 follows 057 in the manifest as the last file, is frozen at its released hash; the migration and rollback are the build output', () => {
  const i = manifest.canonical_sql.indexOf(FILE)
  assert.equal(manifest.canonical_sql[i - 1], '057_benchmark_bwar_evidence.sql')
  assert.equal(i, manifest.canonical_sql.length - 1)
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.equal(Object.keys(frozen).length, 62)
  assert.equal(frozen[FILE], crypto.createHash('sha1').update(sql058.replace(/\r\n/g, '\n')).digest('hex'))
  assert.equal(frozen[FILE], '0e58c9c269770cd3c4f2c6577cd68e382bb75708')
  assert.equal(crypto.createHash('sha256').update(sql058).digest('hex'), 'b65c0c4aa8759ee197bee789937fb529e195c5fd1ea02cf8ea32bb069c3807ae')
  assert.equal(crypto.createHash('sha256').update(rollback058).digest('hex'), 'bb8c2aaa12675de3f7568bb03801506d001ba173623e65bedaee211a5a75dd0d')
  assert.match(sql058, /^-- DISI v0\.43\n-- 058_transaction_return_bwar_evidence\.sql\n/)
  assert.match(rollback058, /^-- DISI rollback of Migration 058/)
  assert.equal(assemble(), sql058)
  assert.equal(assembleRollback(), rollback058)
})

test('baseline: the 058 research was written against exactly this pre-058 state', () => {
  const b = JSON.parse(fs.readFileSync(path.join(root, 'database/research/058/baseline.json'), 'utf8'))
  for (const k of ['war', 'value_totals', 'executive', 'signings', 'transaction_queue', 'value_queue', 'research_task_types', 'lineage', 'intervals', 'edges', 'war_not_loaded', 'scoped_war', 'support'])
    assert.deepEqual(pre[k], b[k], k)
  assert.deepEqual([pre.war.active, pre.counts.sources, pre.value_totals.realized, pre.value_totals.resolved], [1934, 3384, '297.60', 87])
  assert.deepEqual(pre.war_not_loaded.map((x) => x.asset_name), ['Apostol Garcia', 'Danny Muegge', 'Jim Leyritz', 'Jon Garland', 'Mudcat Grant', 'Rick Roberts', 'William Juárez', 'Zoilo Versalles'])
})

test('data only: no table, view, function, grant, policy, trigger, definition or team-code mapping changes', async () => {
  const c = await clone(pre058Dump)
  try {
    const cat = async (x) => ({
      rel: await x.query(`select relname, relkind, coalesce(relacl::text, '') as acl, relrowsecurity as rls, coalesce(array_to_string(reloptions, ','), '') as opts from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'v', 'm', 'i') order by 1`),
      fn: await x.query(`select p.oid::regprocedure::text as f, coalesce(p.proacl::text, '') as acl, p.prosecdef, p.provolatile, md5(p.prosrc) as h from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
      pol: await x.query(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`),
      trg: await x.query(`select c.relname, t.tgname, t.tgenabled from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
      views: await x.query(`select relname, md5(pg_get_viewdef(oid)) as h from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`),
      map: await x.query(`select bref_team_code, from_season, to_season from public.bref_team_code_map order by 1, 2`),
    })
    assert.deepEqual(await cat(chain), await cat(c))
    assert.equal((await one(`select count(*)::int as n from public.bref_team_code_map where bref_team_code = 'WSA'`)).n, 0, 'no WSA mapping')
  } finally { await c.close() }
})

test('sources: the two 057 captures are reused; no source row is added; every 058 row cites one of them', async () => {
  const m = await measure(q)
  assert.equal(m.counts.sources, pre.counts.sources)
  assert.equal(m.counts.sources, 3384)
  const w = await q(`select so.url, count(*)::int as n from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id
    where w.bref_id = any($1) and w.record_status = 'ACTIVE' group by 1 order by 1`, [FOUR])
  assert.deepEqual(w.map((x) => [x.url === URLS[0] ? 'BAT' : 'PITCH', x.n]), [['PITCH', 32], ['BAT', 59]])
  assert.equal((await one(`select count(*)::int as n from public.sources where url = any($1)`, [URLS])).n, 2)
})

test('scope: exactly the four returned assets (MLBAM and Baseball-Reference ids), no players row created, joined by bref_id with player_id NULL', async () => {
  const ids = { garlajo01: '279782', leyriji01: '117747', grantmu01: '115046', versazo01: '123713' }
  const a = await q(`select a.asset_name, a.asset_side, a.mlb_id, a.bref_id, a.player_id, e.event_key from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
    where a.bref_id = any($1) order by a.bref_id, e.transaction_date`, [FOUR])
  assert.equal(a.length, 8)
  for (const p of scope.players) {
    const mine = a.filter((x) => x.bref_id === p.bref_id)
    assert.deepEqual(mine.map((x) => [x.asset_side, x.event_key, x.mlb_id, x.player_id]),
      [['INCOMING', p.acquisition_event_key, ids[p.bref_id], null], ['OUTGOING', p.exit_event_key, ids[p.bref_id], null]], p.name)
  }
  assert.equal((await one(`select count(*)::int as n from public.players where bref_id = any($1) or mlb_id::text = any($2)`, [FOUR, Object.values(ids)])).n, 0)
  assert.equal((await one(`select count(*)::int as n from public.player_mlb_team_season_war where bref_id = any($1) and player_id is not null`, [FOUR])).n, 0)
  assert.equal((await measure(q)).counts.players, 398)
})

test('WAR: +91 ACTIVE rows (Garland 28, Leyritz 15, Grant 36, Versalles 12), BAT / PITCH shape, every team mapped, no WSA, the 057 rows untouched', async () => {
  const m = await measure(q)
  assert.deepEqual([m.war.rows - pre.war.rows, m.war.active - pre.war.active, m.war.retracted], [91, 91, 0])
  assert.equal(m.war.active, 2025)
  assert.deepEqual(m.scoped_war.map((r) => [r.bref_id, r.rows, r.bat, r.pitch, r.unmapped]),
    [['garlajo01', 28, 14, 14, 0], ['grantmu01', 36, 18, 18, 0], ['leyriji01', 15, 15, 0, 0], ['versazo01', 12, 12, 0, 0]])
  assert.equal((await one(`select count(*)::int as n from public.player_mlb_team_season_war where bref_team_code = 'WSA'`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from public.player_mlb_team_season_war where record_status = 'ACTIVE' and organization_id is null`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from (select bref_id, season, bref_team_code, stint_ordinal, component from public.player_mlb_team_season_war
    where record_status = 'ACTIVE' group by 1, 2, 3, 4, 5 having count(*) > 1) x`)).n, 0)
  const s057 = await one(`select count(*)::int as n, count(distinct w.bref_id)::int as p from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id
    where so.url = any($1) and w.record_status = 'ACTIVE' and w.bref_id <> all($2)`, [URLS, FOUR])
  assert.deepEqual(s057, { n: 54, p: 11 }, 'the 54 rows of the eleven 057 players stay ACTIVE')
  const stints = await q(`select bref_id, season, string_agg(stint_ordinal || ':' || bref_team_code || ':' || component || ':' || war, ',' order by stint_ordinal, component) as s
    from public.player_mlb_team_season_war where record_status = 'ACTIVE' and (bref_id, season) in (('garlajo01', 2009), ('leyriji01', 2000), ('versazo01', 1969)) group by 1, 2 order by 1`)
  assert.deepEqual(stints.map((r) => [r.bref_id, r.season, r.s]), [['garlajo01', 2009, '1:ARI:BAT:-0.42,1:ARI:PITCH:1.31,2:LAD:BAT:-0.12,2:LAD:PITCH:0.29'],
    ['leyriji01', 2000, '1:NYY:BAT:-0.23,2:LAD:BAT:-0.61'], ['versazo01', 1969, '1:CLE:BAT:0.30']])
})

test('nothing else moves: only the team-season facts (and the snapshots) change; no existing row changed or disappeared', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => now[t] !== preTables[t]).sort()
  assert.deepEqual(changed.filter((t) => !t.startsWith('product_')), ['player_mlb_team_season_war'])
  const c = await clone(pre058Dump)
  try {
    const a = new Set(await rowsOf(chain, 'player_mlb_team_season_war'))
    assert.equal((await rowsOf(c, 'player_mlb_team_season_war')).filter((r) => !a.has(r)).length, 0, 'no existing team-season row changed or disappeared')
  } finally { await c.close() }
})

test('value: the existing interval-bounded rules value each player by its reviewed rows at its reviewed attribution level', async () => {
  const m = await measure(q)
  assert.deepEqual(m.lineage.map((l) => [l.asset_name, l.hop_number, l.attribution_level, l.war_state, l.value_resolution, l.bwar]), [
    ['Mudcat Grant', 3, 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE', 'LOADED', 'VALUE_RESOLVED', '1.39'],
    ['Zoilo Versalles', 3, 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE', 'LOADED', 'VALUE_RESOLVED', '-1.12'],
    ['Jon Garland', 1, 'PLAYER_ATTRIBUTABLE', 'LOADED', 'VALUE_RESOLVED', '0.17'],
    ['Jim Leyritz', 1, 'PACKAGE_ATTRIBUTABLE', 'LOADED', 'VALUE_RESOLVED', '-0.61']])
  const iv = Object.fromEntries(m.intervals.map((x) => [x.interval_key.split(':')[1], x]))
  assert.deepEqual([iv['279782'].bwar, iv['279782'].timing_resolution_basis, iv['279782'].exit_resolution_basis, iv['279782'].dodgers_rows_in_interval, iv['279782'].dodgers_rows_outside_interval, iv['279782'].outside_bwar],
    ['0.17', 'COUNTERPARTY_STINT_ORDER', 'OFFSEASON_AFTER_SEASON', 2, 2, '0.14'], 'Garland: 2009 ARI stint 1 then LAD stint 2 (cp_ord + 1); the 2011 stint is outside the interval')
  assert.deepEqual([iv['117747'].bwar, iv['117747'].timing_resolution_basis], ['-0.61', 'COUNTERPARTY_STINT_ORDER'], 'Leyritz: 2000 NYY stint 1 then LAD stint 2')
  assert.deepEqual([iv['115046'].bwar, iv['115046'].timing_resolution_basis, iv['115046'].exit_resolution_basis], ['1.39', 'NO_ACQUISITION_SEASON_DODGERS_STINT', 'SINGLE_STINT_BEFORE_EXIT'])
  assert.deepEqual([iv['123713'].bwar, iv['123713'].timing_resolution_basis, iv['123713'].exit_resolution_basis], ['-1.12', 'NO_ACQUISITION_SEASON_DODGERS_STINT', 'SINGLE_STINT_BEFORE_EXIT'])
  // KNOWN RETURN WAR != ATTRIBUTABLE SIGNING VALUE
  assert.deepEqual(['tony-abreu', 'jose-vizcaino', 'chico-fernandez'].map((s) => { const x = signing(m, s); return [s, x.realized_value_state, x.chain_status, x.direct, x.trade, x.realized, x.pkg_first, x.observable] }), [
    ['tony-abreu', 'REALIZED_TO_DATE', 'COMPLETE_TERMINAL', '1.23', '0.17', '1.40', '0.17', null],
    ['jose-vizcaino', 'REALIZED_TO_DATE', 'COMPLETE_TERMINAL', '0.19', '-0.10', '0.09', '-0.71', null],
    ['chico-fernandez', 'REALIZED_TO_DATE', 'COMPLETE_TERMINAL', '0.00', '0.62', '0.62', '0.62', '5.17']])
  for (const s of ['jose-vizcaino', 'chico-fernandez']) assert.equal(signing(m, s).realized, signing(pre, s).realized, `${s}: the realized value does not move (package / chain value is not the player's)`)
  // PACKAGE VALUE != PLAYER ATTRIBUTION: Leyritz stays a shared-package return; Grant and Versalles belong to no tracked-signing edge
  const e = Object.fromEntries(m.edges.map((x) => [x.incoming_asset_name, x]))
  assert.deepEqual(Object.keys(e).sort(), ['Jim Leyritz', 'Jon Garland'])
  assert.deepEqual([e['Jon Garland'].attribution_status, e['Jon Garland'].return_state, e['Jim Leyritz'].attribution_status, e['Jim Leyritz'].return_state],
    ['SOLE_OUTGOING_ASSET', 'LOADED', 'SHARED_PACKAGE_RETURN', 'LOADED'])
})

test('OLDER VIEW != VALUE OF RECORD: the unbounded 033 edge shows Garland 0.31; the value of record, the executive totals and the product read 0.17', async () => {
  const m = await measure(q)
  assert.equal(m.edges.find((x) => x.incoming_asset_name === 'Jon Garland').edge_bwar, '0.31', 'the 033 edge includes the 2011 stint after the exit')
  const older = m.older_view.find((x) => x.player_slug === 'tony-abreu')
  assert.deepEqual([older.trade, older.org], ['0.31', '1.54'], 'v_player_organizational_realization repeats the unbounded edge')
  assert.equal(signing(m, 'tony-abreu').realized, '1.40', 'the value of record is direct 1.23 + the interval-bounded 0.17')
  const d = await one(`select realized_org_value_bwar::text as v, individually_attributable_trade_bwar::text as t from public.product_player_decision where player_slug = 'tony-abreu'`)
  assert.deepEqual(d, { v: '1.40', t: '0.17' })
  // the same split already existed before 058 (Casey Blake), so 058 adds no new kind of disagreement
  const blake = await one(`select e.incoming_dodgers_bwar::text as edge, i.interval_bounded_dodgers_bwar::text as bounded from public.v_trade_realization_edges e
    join public.v_player_control_intervals i on i.start_asset_id = e.incoming_asset_id where e.incoming_asset_name = 'Casey Blake'`)
  assert.deepEqual(blake, { edge: '9.16', bounded: '0.94' })
  // no application code reads the older per-signing figures
  let hits = ''
  try {
    hits = execFileSync('git', ['grep', '-l', '-E', 'attributable_organizational_bwar|individually_attributable_trade_return_bwar|v_trade_realization_edges|v_player_organizational_realization', '--', 'app', 'lib'],
      { cwd: root, encoding: 'utf8' }).trim()
  } catch (e) { if (e.status !== 1) throw e } // git grep exits 1 when nothing matches
  assert.equal(hits, '', 'app/ and lib/ never read the 033 figures')
})

test('value totals: realized 297.60 -> 299.00, resolved 87 -> 88, 80 / 7 / 1 -> 83 / 5 / 0, direct 282.77 -> 284.00, trade 14.83 -> 15.00', async () => {
  const m = await measure(q)
  assert.deepEqual(pre.value_totals, { resolved: 87, realized: '297.60', realized_to_date: 80, chain_incomplete: 7, unresolved: 1, pkg_first: '96.39', pkg_down: '2.99', observable: '141.44' })
  assert.deepEqual(m.value_totals, { resolved: 88, realized: '299.00', realized_to_date: 83, chain_incomplete: 5, unresolved: 0, pkg_first: '95.85', pkg_down: '2.99', observable: '141.71' })
  assert.deepEqual([m.executive.signings_with_resolved_value, m.executive.direct, m.executive.trade, m.executive.realized], [88, '284.00', '15.00', '299.00'])
  assert.deepEqual([pre.executive.direct, pre.executive.trade], ['282.77', '14.83'])
  assert.equal(m.executive.value_left, pre.executive.value_left, 'value for other clubs is not Dodgers value and does not move')
})

test('Versalles: his Dodgers transaction value is -1.12 with or without the excluded 1969 WSA row (which would only raise TEAM_HISTORY_UNRESOLVED)', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
        plate_appearances, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence)
      select 'versazo01', '123713', null, 1969, 'WSA', null, 2, 'BAT', 0.36, 31, 79, 'AL', so.id, '2026-09-11', 2025, now(), 'VERIFIED' from public.sources so where so.url = '${URLS[0]}'`)
    const v = await c.query(`select interval_bounded_dodgers_bwar::text as v from public.v_player_control_intervals where bref_id = 'versazo01'`)
    assert.deepEqual(v, [{ v: '-1.12' }])
    const th = await c.query(`select detail from public.v_value_research_queue where issue = 'TEAM_HISTORY_UNRESOLVED'`)
    assert.deepEqual(th.map((x) => x.detail), ['1969 BAT team code WSA has no organization mapping'])
  } finally { await c.close() }
})

test('queues: transaction 58 -> 57 (DOWNSTREAM_WAR_NOT_LOADED 6 -> 4, DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION 5 -> 6), value 93 -> 90 (DOWNSTREAM_ASSET_CHAIN_INCOMPLETE 8 -> 5)', async () => {
  const m = await measure(q)
  assert.deepEqual([total(pre, 'transaction_queue'), total(m, 'transaction_queue'), total(pre, 'value_queue'), total(m, 'value_queue')], [58, 57, 93, 90])
  const [tb, ta, vb, va] = [issues(pre, 'transaction_queue'), issues(m, 'transaction_queue'), issues(pre, 'value_queue'), issues(m, 'value_queue')]
  assert.deepEqual([tb.DOWNSTREAM_WAR_NOT_LOADED, ta.DOWNSTREAM_WAR_NOT_LOADED, tb.DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION, ta.DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION], [6, 4, 5, 6])
  assert.deepEqual([vb.DOWNSTREAM_ASSET_CHAIN_INCOMPLETE, va.DOWNSTREAM_ASSET_CHAIN_INCOMPLETE], [8, 5])
  for (const k of Object.keys(tb)) if (!['DOWNSTREAM_WAR_NOT_LOADED', 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION'].includes(k)) assert.equal(ta[k], tb[k], k)
  for (const k of Object.keys(vb)) if (k !== 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE') assert.equal(va[k], vb[k], k)
  const sq = m.scoped_queue.map((x) => [x.queue, x.issue, x.key, x.subject])
  assert.ok(sq.some((x) => JSON.stringify(x) === JSON.stringify(['TRANSACTION', 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION', 'LAD_FREE_AGENCY_2009_JON_GARLAND', 'Jon Garland'])), 'Garland 2011 is exposed, not credited')
  assert.ok(sq.some((x) => JSON.stringify(x) === JSON.stringify(['TRANSACTION', 'CASH_AMOUNT_UNKNOWN', 'LAD_NYY_2000_JOSE_VIZCAINO', 'Cash'])), 'the Vizcaino cash amount stays open')
  assert.ok(!sq.some((x) => x[1] === 'DOWNSTREAM_WAR_NOT_LOADED'), 'Grant and Versalles leave the downstream WAR blocker')
  const pkg = m.scoped_queue.find((x) => x.issue === 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED' && x.key === 'jose-vizcaino')
  assert.match(pkg.detail, /the package returned -0\.71 Dodgers bWAR and no individual share is assigned/)
  assert.match(pre.scoped_queue.find((x) => x.issue === 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED' && x.key === 'jose-vizcaino').detail, /the package returned  Dodgers bWAR/)
  // the other four WAR_NOT_LOADED assets are untouched: still unknown, never zero, no observation created
  assert.deepEqual(m.war_not_loaded.map((x) => x.asset_name), ['Apostol Garcia', 'Danny Muegge', 'Rick Roberts', 'William Juárez'])
})

test('prediction isolation: support, labels, features, evaluations and outcomes byte-identical; no model, probability, expected value or recommendation; BWAR_MISSING 50', async () => {
  const m = await measure(q)
  assert.deepEqual(m.prediction, pre.prediction)
  assert.deepEqual(m.support, pre.support)
  assert.equal(m.prediction.evaluation_fingerprints, '102c01a35d380d36493465cef1070c07,1aa73185a9dab3071d4530ee670dd088,86b58f473301e2425751d853abd88e94')
  assert.deepEqual([m.prediction.supported_models, m.prediction.probabilities, m.prediction.expected_values, m.prediction.recommendations, m.prediction.supported_targets], [0, 0, 0, 0, 0])
  assert.deepEqual(m.research_task_types, pre.research_task_types)
  assert.equal(m.research_task_types.find((t) => t.task_type === 'BWAR_MISSING').items, 50)
  assert.equal((await one(`select count(*)::int as n from public.player_metric_observations where metric_key = 'CAREER_BWAR'`)).n,
    (await (async () => { const c = await clone(pre058Dump); try { return (await c.query(`select count(*)::int as n from public.player_metric_observations where metric_key = 'CAREER_BWAR'`))[0].n } finally { await c.close() } })()))
})

test('snapshots: one refresh, one new generation for all eleven tables, zero drift; only the executive and player-decision snapshots change content', async () => {
  const m = await measure(q)
  assert.equal(m.snapshots.generation, pre.snapshots.generation + 1)
  assert.equal(m.snapshots.drifting, 0)
  for (const t of SNAP) assert.deepEqual((await q(`select distinct generation_id::int as g from public.${t}`)).map((r) => r.g), [m.snapshots.generation], t)
  const now = await tableHashes(chain, SNAP_DROP)
  assert.deepEqual(SNAP.filter((t) => now[t] !== preSnap[t]).sort(), ['product_executive_snapshot', 'product_player_decision'])
})

test('verifier: 259/259 at the 058 head with no unavailable-WAR pin; the 057 layer keeps both pins for every earlier state', async () => {
  assert.deepEqual(CANONICAL_EXPECTATIONS.transaction_war_unavailable_mlb_ids, [])
  assert.deepEqual(EXPECTATIONS_THROUGH_057.transaction_war_unavailable_mlb_ids, ['279782', '117747'])
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full).map((f) => f.name), [])
  assert.equal(full.hard.length, 259)
  const c = await clone(pre058Dump)
  try {
    const p = await checkInvariants(c.query, EXPECTATIONS_THROUGH_057)
    assert.deepEqual(failedChecks(p).map((f) => f.name), [], 'the pre-058 state passes its own pins 259/259')
    const head = await checkInvariants(c.query, CANONICAL_EXPECTATIONS)
    assert.deepEqual(failedChecks(head).map((f) => f.name), ['transaction_asset_identity_consistency_violations'],
      'without the pins the pre-058 data is a violation: Garland and Leyritz were accepted only by name')
  } finally { await c.close() }
})

test('idempotent: a rerun adds nothing, runs no second refresh and changes no table', async () => {
  const b = await tableHashes()
  const gen = (await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g
  await chain.db.exec(sql058)
  assert.deepEqual(await tableHashes(), b)
  assert.equal((await one(`select max(generation_id)::text as g from public.product_executive_snapshot`)).g, gen)
})

test('guarded: 058 refuses a database without 057, a changed source, an excluded or unmapped row, a players row, other evidence, a moved value, queue or output', async () => {
  /** @type {Array<[string | null, RegExp, string?]>} */
  const cases = [
    [null, /058: the sources are not the two approved archived Baseball-Reference captures/, sql058.replace('ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023', '0'.repeat(64))],
    [`update public.player_mlb_team_season_war set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test'
      where source_id in (select id from public.sources where url like 'https://web.archive.org/web/2026%war_daily_%')`, /058: the 057 team-season rows are not the 54 ACTIVE rows of its eleven players/],
    [null, /058: a row is not a complete 2025-or-earlier team-season stint of a mapped team/, sql058.replace('["versazo01","123713",1969,"CLE",1,"BAT"', '["versazo01","123713",1969,"WSA",1,"BAT"')],
    [`insert into public.bref_team_code_map (bref_team_code, organization_id, from_season, to_season, note) select 'WSA', organization_id, 1961, 1971, 'test' from public.bref_team_code_map where bref_team_code = 'TEX'`,
      /058: a team code has no team-code mapping for its season, or a reviewed exclusion is loaded/],
    [null, /058: the rows are not exactly the 91 reviewed rows of the four returned players/, sql058.replace('["garlajo01","279782",2013,"COL",1,"BAT"', '["sotoju01","279782",2013,"COL",1,"BAT"')],
    [`insert into public.players (full_name, slug, mlb_id, bref_id) values ('Jon Garland', 'jon-garland', 279782, 'garlajo01')`, /058: Jon Garland has a DISI players row/],
    [`insert into public.player_mlb_team_season_war (bref_id, mlb_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games, source_id,
        observed_through_date, observed_through_season, retrieved_at, confidence)
      select 'leyriji01', '117747', 2000, 'LAD', (select organization_id from public.bref_team_code_map where bref_team_code = 'LAD'), 2, 'BAT', -0.61, 41, so.id, '2026-09-28', 2026, now(), 'VERIFIED'
      from public.sources so where so.url = 'https://www.baseball-reference.com/data/war_daily_bat.txt'`, /058: Jim Leyritz already has active team-season bWAR from another source/],
    [`update public.transaction_event_assets set bref_id = null where bref_id = 'grantmu01'`, /058: Mudcat Grant is not the reviewed returned asset/],
    // a corrected (superseding) fact for Elmer Valo, Fernandez's own first-hop return: the active count stays 1934, the value moves
    [`insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games, plate_appearances,
        ip_outs, league, war_system, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, supersedes_record_id)
      select bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war + 1, games, plate_appearances, ip_outs, league, war_system, source_id,
        observed_through_date, observed_through_season, retrieved_at, confidence, id
      from public.player_mlb_team_season_war where bref_id = 'valoel01' and season = 1957 and record_status = 'ACTIVE' order by component limit 1;
      select * from public.disi_refresh_product_snapshots()`,
    /058: the three originating signings are not in the value state the research was written for/],
    [`update public.outcome_model_evaluations set training_fingerprint = '00000000000000000000000000000000' where target_key = 'REACH_MLB_WITHIN_7_SEASONS'`, /058: the prediction layer is not in the state the research was written for/],
    [`insert into public.signings (player_id, organization_id, signing_year, pathway, bonus_publicly_reported, record_scope)
      select p.id, o.id, 2026, 'OTHER', false, 'TRACKED' from public.players p, public.organizations o where p.slug = 'jasson-dominguez' and o.abbreviation = 'LAD'`,
    /058: a player holds both a Dodgers signing and a benchmark signing/],
  ]
  for (const [mutate, pattern, migration] of cases) {
    const c = await clone(pre058Dump)
    try {
      if (mutate) await c.db.exec(mutate)
      await failsWith(c, migration ?? sql058, pattern)
    } finally { await c.close() }
  }
})

test('rollback: retracts exactly the 91 rows (the 057 rows stay ACTIVE, the sources stay), restores value, queues and verifier state, refreshes once; 058 applies again', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const genApplied = (await c.query(`select max(generation_id)::int as g from public.product_executive_snapshot`))[0].g
    await c.db.exec(rollback058)
    const got = await tableHashes(c)
    const differs = Object.keys(preTables).filter((t) => preTables[t] !== got[t] && !t.startsWith('product_') && t !== 'player_mlb_team_season_war')
    assert.deepEqual(differs, [], 'every other table equals its pre-058 content')
    const p = await clone(pre058Dump)
    try {
      assert.deepEqual(await rowsOf(c, 'player_mlb_team_season_war', `where record_status = 'ACTIVE'`), await rowsOf(p, 'player_mlb_team_season_war', `where record_status = 'ACTIVE'`),
        'the active facts are exactly the pre-058 facts')
    } finally { await p.close() }
    const r = await c.query(`select count(*)::int as n, count(*) filter (where retraction_reason like 'Rollback of Migration 058%')::int as reason, count(*) filter (where bref_id <> all($1))::int as other
      from public.player_mlb_team_season_war where record_status = 'RETRACTED'`, [FOUR])
    assert.deepEqual(r[0], { n: 91, reason: 91, other: 0 }, 'retracted, never deleted; nothing of 057 touched')
    const m = await measure(async (s) => (await c.db.query(s)).rows)
    for (const k of ['value_totals', 'executive', 'signings', 'transaction_queue', 'value_queue', 'lineage', 'prediction', 'research_task_types']) assert.deepEqual(m[k], pre[k], k)
    assert.deepEqual([m.war.active, m.counts.sources], [1934, 3384])
    assert.deepEqual([m.snapshots.generation, m.snapshots.drifting], [genApplied + 1, 0], 'one refresh')
    assert.deepEqual(failedChecks(await checkInvariants(c.query, EXPECTATIONS_THROUGH_057)).map((f) => f.name), [])
    await failsWith(c, rollback058, /rollback-058: Migration 058 is not applied/)
    await c.db.exec(sql058)
    const again = await measure(async (s) => (await c.db.query(s)).rows)
    const now = await measure(q)
    for (const k of ['value_totals', 'executive', 'signings', 'transaction_queue', 'value_queue', 'lineage', 'intervals', 'scoped_war', 'prediction']) assert.deepEqual(again[k], now[k], k)
    assert.deepEqual([again.war.active, again.war.retracted, again.snapshots.generation], [2025, 91, genApplied + 2])
    assert.deepEqual(failedChecks(await checkInvariants(c.query, CANONICAL_EXPECTATIONS)).map((f) => f.name), [])
  } finally { await c.close() }
})

test('source sharing: after 058 the frozen 057 refuses to re-run and rollback-057 refuses, while 058 is active and after rollback-058; both leave the database unchanged', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const b = await tableHashes(c)
    await failsWith(c, sql057, /057 postcondition: 145 active rows cite the 057 sources; 54 were reviewed/)
    await failsWith(c, rollback057, /rollback-057: later research depends on the 057 evidence/)
    assert.deepEqual(await tableHashes(c), b, 'a refused run changes nothing')
    await c.db.exec(rollback058)
    const r = await tableHashes(c)
    await failsWith(c, sql057, /057 postcondition: a 057 row is a partial season or belongs to a player outside the eleven/)
    await failsWith(c, rollback057, /rollback-057: later research depends on the 057 evidence/)
    assert.deepEqual(await tableHashes(c), r, 'a refused run changes nothing')
  } finally { await c.close() }
  // the frozen files are untouched
  const frozen = JSON.parse(fs.readFileSync(path.join(root, 'tests/db/frozen-migrations.json'), 'utf8')).files
  assert.equal(frozen['057_benchmark_bwar_evidence.sql'], crypto.createHash('sha1').update(sql057.replace(/\r\n/g, '\n')).digest('hex'))
  assert.equal(crypto.createHash('sha256').update(rollback057).digest('hex'), 'f78599adb51fcaa887d1bc1e614c08cc1bc245e01adc4be8eb26d0967ee2f965')
})

test('rollback refuses when later research depends on the 058 evidence', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`insert into public.player_mlb_team_season_war (bref_id, mlb_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games, source_id,
        observed_through_date, observed_through_season, retrieved_at, confidence)
      select 'garlajo01', '279782', 2026, 'LAD', (select organization_id from public.bref_team_code_map where bref_team_code = 'LAD'), 1, 'BAT', 0.10, 1, so.id, '2026-10-28', 2026, now(), 'VERIFIED'
      from public.sources so where so.url = 'https://www.baseball-reference.com/data/war_daily_bat.txt'`)
    await failsWith(c, rollback058, /rollback-058: later research depends on the 058 evidence/)
  } finally { await c.close() }
})
