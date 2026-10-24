// Migration 034: downstream organizational value chains. The 033 database is replayed (001-033), 034 is applied for real, and
// the derived intervals, lineage, package aggregates, timing facts and verifier are checked against the reviewed research.

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from './canonical-chain.mjs'
import { lit, withoutTransaction } from './drift-027.mjs'
import { downstreamQueries, DOWNSTREAM_CHECK_NAMES } from '../../scripts/db/lib/downstream-invariants.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_046 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '034_downstream_organizational_value_chains.sql'
const sql034 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const inner = withoutTransaction(sql034)
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/034', f), 'utf8'))
const seed = rd('exit-seed.json')
const timing = rd('timing-seed.json')
const war = rd('war-seed.json')
const audit = rd('audit-report.json')
const NEW_VIEWS = ['v_player_control_intervals', 'v_transaction_asset_lineage', 'v_transaction_package_lineage', 'v_downstream_organizational_realization']
const NEW_TABLE = 'transaction_asset_timing_observations'

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
before(async () => { chain = await buildChainThrough('033_transaction_asset_chain_completion.sql') }, { timeout: 240000 })
after(async () => { await chain.close() })

const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
let depth = 0
async function inTxn(body) {
  await chain.db.exec('begin;')
  depth++
  try { return await body() } finally { depth--; await chain.db.exec('rollback;') }
}
async function attempt(sql) {
  if (depth > 0) {
    await chain.db.exec('savepoint attempt_sp;')
    try { await chain.db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await chain.db.exec('rollback to savepoint attempt_sp; release savepoint attempt_sp;') }
  }
  await chain.db.exec('begin;')
  try { await chain.db.exec(sql); return 'accepted' } catch (e) { return String(e.message) } finally { await chain.db.exec('rollback;') }
}
const tableHashes = async () => {
  const tables = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5((await q(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const failing = async () => {
  const out = []
  for (const [name, sql] of Object.entries(downstreamQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
  return out.sort()
}
const num = (v) => (v === null || v === undefined ? null : Number(v))
const interval = (name, start) => one(`select * from v_player_control_intervals where display_name = $1 ${start ? 'and interval_start = $2' : ''} order by interval_start limit 1`, start ? [name, start] : [name])
const lineage = (rootLike, asset) => q(`select * from v_transaction_asset_lineage where root_package_key like $1 ${asset ? 'and asset_name = $2' : ''} order by hop_number, asset_name, path_key`, asset ? [rootLike, asset] : [rootLike])
let pre

// ---------------------------------------------------------------------------------------------
// the pre-034 database
// ---------------------------------------------------------------------------------------------

test('baseline: a 001-033 replay is 58 tables / 105 views, 161 events, 291 assets and has no 034 object', async () => {
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`), { tables: 58, views: 105 })
  assert.deepEqual(await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [[...NEW_VIEWS, NEW_TABLE]]), [])
  assert.deepEqual(await one(`select (select count(*) from transaction_events)::int as events, (select count(*) from transaction_event_assets)::int as assets,
    (select count(*) from transaction_asset_resolutions)::int as resolutions, (select count(*) from dodgers_control_observations)::int as observations,
    (select count(*) from player_mlb_team_season_war)::int as war`), { events: 161, assets: 291, resolutions: 4, observations: 90, war: 1327 })
  assert.deepEqual(audit.baseline, { events: 161, assets: 291, war_rows: 1327, resolutions: 4, observations: 90, downstream_flag: 20 })
  pre = {
    hashes: await tableHashes(),
    realization: await q(`select * from v_player_organizational_realization order by player_slug`),
    edges: await q(`select event_key, incoming_asset_name, return_state, incoming_dodgers_bwar::text as w, incoming_war_status from v_trade_realization_edges order by 1, 2`),
    portfolio: await one(`select * from v_dodgers_international_value_portfolio where grain = 'ALL'`),
  }
  assert.equal(pre.edges.filter((e) => e.return_state === 'TIMING_UNRESOLVED').length, 3, 'Valo, Edman and McDermott are unresolved before 034')
})

test('preconditions: an unexpected pre-034 state aborts 034 with nothing changed', async () => {
  const cases = [
    ['an unknown transaction event exists', `insert into transaction_events (event_key, transaction_date, transaction_type, description) values ('UNKNOWN_EVENT', date '2020-01-01', 'TRADE', 'x');`, /pre-existing transaction events found/],
    ['an expected organization is missing', `update organizations set abbreviation = 'ZZZ' where abbreviation = 'NYM';`, /organization NYM does not exist/],
    ['a data-file source is missing', `update sources set url = url || '#x' where url = 'https://www.baseball-reference.com/data/war_daily_bat.txt';`, /data file source .* is not registered/],
    ['an expected asset is missing', `update transaction_event_assets set asset_name = 'Renamed' where asset_name = 'Tommy Edman';`, /expected existing asset Tommy Edman/],
    ['033 is not applied', `drop view v_transaction_research_queue;`, /Migration 033 has not been applied/],
  ]
  for (const [label, drift, expected] of /** @type {Array<[string, string, RegExp]>} */ (cases)) assert.match(await attempt(`${drift}\n${inner}`), expected, label)
  assert.deepEqual(await tableHashes(), pre.hashes, 'aborted runs changed nothing')
})

test('034 applied for real: 58 -> 59 tables and 105 -> 109 views; one table, four views, one guard', async () => {
  await chain.db.exec(sql034)
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`), { tables: 59, views: 109 })
  assert.deepEqual((await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`, [[...NEW_VIEWS, NEW_TABLE]])).map((r) => r.relname),
    [...NEW_VIEWS, NEW_TABLE].sort())
  assert.deepEqual(await q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname = 'disi_timing_observation_guard'`), [{ proname: 'disi_timing_observation_guard' }])
  assert.deepEqual(await failing(), [])
})

test('only the expected tables changed; 032 / 033 outcome, financial, scouting, development and network stores are untouched', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => pre.hashes[t] !== now[t]).sort()
  assert.deepEqual(changed, ['dodgers_control_observations', 'evidence', 'player_mlb_team_season_war', 'sources', 'transaction_asset_resolutions',
    'transaction_asset_timing_observations', 'transaction_event_assets', 'transaction_events'].filter((t) => t !== 'evidence' || changed.includes('evidence')))
  for (const t of ['player_evaluations', 'player_season_stints', 'development_milestones', 'network_entities', 'player_network_relationships', 'signings',
    'signing_financial_reports', 'signing_financial_resolutions', 'signing_environments', 'transaction_return_metrics', 'transaction_competitive_context',
    'outcome_audits', 'outcomes', 'players', 'organizations', 'player_metric_observations', 'transactions', 'bref_team_code_map']) {
    assert.equal(now[t], pre.hashes[t], `${t} is unchanged`)
  }
})

test('rerun is a no-op: no row, grant, policy or definition changes', async () => {
  const snap = async () => ({ hashes: await tableHashes(), acl: await q(`select c.relname, coalesce(array_to_string(c.relacl, ','), '') as acl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') order by 1`),
    policies: await q(`select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2`),
    defs: await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`) })
  const first = await snap()
  await chain.db.exec(sql034)
  assert.deepEqual(await snap(), first)
})

// ---------------------------------------------------------------------------------------------
// seeded facts
// ---------------------------------------------------------------------------------------------

test('events and assets: the 43 researched events and their assets are present exactly once; re-signings use FREE_AGENT_SIGNING', async () => {
  const added = seed.events.length
  const addedAssets = seed.events.reduce((n, e) => n + e.assets.length, 0)
  assert.deepEqual(await one(`select count(*)::int as events from transaction_events`), { events: 161 + added })
  assert.deepEqual(await one(`select count(*)::int as assets from transaction_event_assets`), { assets: 291 + addedAssets })
  for (const e of seed.events) {
    assert.equal((await one(`select count(*)::int as n from transaction_events where event_key = $1 and transaction_date = $2::date and transaction_type = $3`, [e.key, e.date, e.type])).n, 1, e.key)
  }
  assert.deepEqual((await q(`select event_key as k from transaction_events where transaction_type = 'FREE_AGENT_SIGNING' order by 1`)).map((r) => r.k),
    ['LAD_FREE_AGENT_SIGNING_1994_MIKE_SHARPERSON', 'LAD_FREE_AGENT_SIGNING_2008_CASEY_BLAKE'])
  // the three placeholder resolutions are beside their preserved placeholders
  assert.equal((await one(`select count(*)::int as n from transaction_asset_resolutions`)).n, 4 + seed.resolutions.length)
  assert.equal((await one(`select count(*)::int as n from transaction_asset_resolutions r join transaction_event_assets ph on ph.id = r.placeholder_asset_id
    where ph.asset_side = 'OUTGOING' and ph.asset_type = 'PLAYER_TO_BE_NAMED'`)).n, 5, 'two Boston 2012 placeholders (033) plus Navarro 2006 and Maddux 2008 (x2)')
})

test('identities: every seeded PLAYER asset has a stable identity; Register ids stay in their own namespace', async () => {
  assert.equal((await one(`select count(*)::int as n from transaction_event_assets where asset_type = 'PLAYER' and player_id is null and mlb_id is null and bref_id is null and bref_register_id is null`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from transaction_event_assets where bref_id ~ '[0-9]{3}[a-z]+$' or bref_register_id !~ '^[a-z][a-z-]{2,5}[0-9]{3}[a-z]{1,4}$'`)).n, 0)
  // exact researched ids
  const ids = await q(`select asset_name, mlb_id, bref_id, bref_register_id from transaction_event_assets where asset_name in ('Greg Maddux', 'Jim Fridley', 'Apostol Garcia') order by asset_name`)
  assert.ok(ids.some((r) => r.asset_name === 'Greg Maddux' && r.bref_id === 'maddugr01' && r.mlb_id === '118120'))
  assert.ok(ids.some((r) => r.asset_name === 'Jim Fridley' && r.bref_id === 'fridlji01'))
  assert.ok(ids.some((r) => r.asset_name === 'Apostol Garcia' && r.bref_id === null && r.bref_register_id === 'garcia002apo'))
})

test('timing observations: ten sourced chronology facts; sealed, append-only, bound to an incoming PLAYER asset of the named event', async () => {
  assert.equal((await one(`select count(*)::int as n from transaction_asset_timing_observations where record_status = 'ACTIVE'`)).n, timing.facts.length)
  const types = await q(`select fact_type, count(*)::int as n from transaction_asset_timing_observations group by 1 order by 1`)
  assert.deepEqual(types, [{ fact_type: 'EXIT_BOUNDED_BEFORE', n: 2 }, { fact_type: 'FIRST_DODGERS_APPEARANCE', n: 6 }, { fact_type: 'LAST_DODGERS_APPEARANCE', n: 1 },
    { fact_type: 'SEASON_START_CONFIRMS_POST_ACQUISITION', n: 1 }])
  await inTxn(async () => {
    const asset = `(select a.id from transaction_event_assets a join transaction_events e on e.id = a.event_id where e.event_key = 'LAD_CWS_2024_JERAL_PEREZ' and a.asset_side = 'INCOMING' and a.asset_name = 'Michael Kopech')`
    const ev = `(select id from transaction_events where event_key = 'LAD_CWS_2024_JERAL_PEREZ')`
    const src = `(select id from sources limit 1)`
    const ins = (type, season, date, a = asset, e = ev) => `insert into transaction_asset_timing_observations (subject_asset_id, event_id, fact_type, season, observed_date, source_id, confidence)
      values (${a}, ${e}, ${lit(type)}, ${season}, date ${lit(date)}, ${src}, 'HIGH')`
    // shape
    assert.match(await attempt(ins('FIRST_DODGERS_APPEARANCE', 'null', '2024-08-01')), /shape_check/)
    assert.match(await attempt(ins('EXIT_BOUNDED_BEFORE', '2024', '2024-08-01')), /shape_check/)
    assert.match(await attempt(ins('FIRST_DODGERS_APPEARANCE', '2023', '2024-08-01')), /shape_check/)
    assert.match(await attempt(ins('NEVER_REACHED_MLB', 'null', '2024-08-01')), /fact_type_check|check/)
    // chronology and subject
    assert.match(await attempt(ins('FIRST_DODGERS_APPEARANCE', '2024', '2024-07-01')), /cannot predate/)
    assert.match(await attempt(ins('FIRST_DODGERS_APPEARANCE', '2024', '2024-08-01', `(select a.id from transaction_event_assets a join transaction_events e on e.id = a.event_id
      where e.event_key = 'LAD_CWS_2024_JERAL_PEREZ' and a.asset_side = 'OUTGOING' and a.asset_name = 'Miguel Vargas')`)), /incoming PLAYER asset/)
    assert.match(await attempt(ins('FIRST_DODGERS_APPEARANCE', '2024', '2024-08-01', asset, `(select id from transaction_events where event_key = 'LAD_BAL_2018_DIAZ_MACHADO')`)), /acquisition event of its asset/)
    // a correct fact is accepted once; sealed afterwards; retraction is the only change
    await chain.db.exec(ins('FIRST_DODGERS_APPEARANCE', '2024', '2024-08-01'))
    assert.match(await attempt(ins('FIRST_DODGERS_APPEARANCE', '2024', '2024-08-02')), /active_key|duplicate/)
    assert.match(await attempt(`update transaction_asset_timing_observations set observed_date = date '2024-08-05' where fact_type = 'FIRST_DODGERS_APPEARANCE' and subject_asset_id = ${asset}`), /sealed/)
    assert.match(await attempt(`delete from transaction_asset_timing_observations`), /never deleted/)
    assert.equal(await attempt(`update transaction_asset_timing_observations set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test' where subject_asset_id = ${asset}`), 'accepted')
  })
  assert.match(await attempt(`delete from transaction_asset_timing_observations`), /never deleted/)
  assert.match(await attempt(`update transaction_asset_timing_observations set note = 'x'`), /sealed/)
})

test('WAR: 28 downstream return persons, 494 BAT / PITCH rows (312 / 182), bWAR only, the same source files as 032 / 033, nothing unmapped', async () => {
  assert.equal(war.scope.persons, 28)
  assert.equal(war.row_count, 494)
  assert.deepEqual(war.components, { BAT: 312, PITCH: 182 })
  assert.deepEqual(war.coverage, { persons_without_rows: [], unmapped_team_codes: [] })
  assert.deepEqual(await one(`select count(*)::int as rows, count(distinct bref_id)::int as persons from player_mlb_team_season_war`), { rows: 1327 + 494, persons: 90 + 28 })
  assert.equal((await one(`select count(*)::int as n from player_mlb_team_season_war where war_system <> 'BWAR' or organization_id is null`)).n, 0)
  const files = rd('scope-config.json').files
  assert.deepEqual(files, JSON.parse(fs.readFileSync(path.join(root, 'database/research/033/scope-config.json'), 'utf8')).files, 'same two data files and checksums')
  assert.deepEqual(files, JSON.parse(fs.readFileSync(path.join(root, 'database/research/032/scope-config.json'), 'utf8')).files)
})

// ---------------------------------------------------------------------------------------------
// preservation of 032 / 033
// ---------------------------------------------------------------------------------------------

test('preservation: the first-hop columns, direct and non-Dodgers bWAR, return states and the legacy portfolio columns are unchanged', async () => {
  // downstream_asset_chain_incomplete is a function of recorded exits: it is true for more return assets now that more exits are recorded
  const strip = (rows) => rows.map(({ downstream_asset_chain_incomplete, ...rest }) => rest)
  assert.deepEqual(strip(await q(`select * from v_player_organizational_realization order by player_slug`)), strip(pre.realization))
  const flags = await q(`select player_slug, downstream_asset_chain_incomplete as f from v_player_organizational_realization order by 1`)
  for (const r of pre.realization) assert.ok(!r.downstream_asset_chain_incomplete || flags.find((x) => x.player_slug === r.player_slug).f, `${r.player_slug}: a recorded flag is never cleared`)
  assert.deepEqual(await q(`select event_key, incoming_asset_name, return_state, incoming_dodgers_bwar::text as w, incoming_war_status from v_trade_realization_edges order by 1, 2`), pre.edges)
  const now = await one(`select * from v_dodgers_international_value_portfolio where grain = 'ALL'`)
  for (const [k, v] of Object.entries(pre.portfolio)) assert.deepEqual(now[k], v, `portfolio column ${k}`)
  assert.equal(num(now.aggregate_direct_dodgers_bwar_per_million), 0.977)
  assert.equal(num(now.aggregate_attributable_organizational_bwar_per_million), 0.993)
  assert.equal(num(now.attributable_trade_return_bwar), 15.07)
  assert.equal(now.attributable_ratio_eligible_signings, 26)
})

// ---------------------------------------------------------------------------------------------
// control intervals
// ---------------------------------------------------------------------------------------------

test('control intervals: a free-agent re-signing or reacquisition is a new interval and never part of the earlier trade return (Blake, Hundley, Sharperson, Maddux, Valdez)', async () => {
  const blake1 = await interval('Casey Blake', '2008-07-26')
  const blake2 = await interval('Casey Blake', '2008-12-09')
  assert.deepEqual([num(blake1.interval_bounded_dodgers_bwar), blake1.interval_end.toISOString().slice(0, 10), blake1.start_method], [0.94, '2008-10-30', 'TRADE_ACQUISITION'])
  assert.deepEqual([num(blake2.interval_bounded_dodgers_bwar), blake2.start_method, blake2.interval_status], [8.22, 'FREE_AGENT_SIGNING', 'CLOSED_CAREER_ENDED'])
  assert.equal(num(blake1.dodgers_bwar_outside_interval), 8.22)
  const legacy = await one(`select incoming_dodgers_bwar::text as w from v_trade_realization_edges where incoming_asset_name = 'Casey Blake'`)
  assert.equal(num(legacy.w), 9.16, 'the legacy first-hop figure is preserved beside the bounded one')
  const h1 = await interval('Todd Hundley', '1998-12-01')
  const h2 = await interval('Todd Hundley', '2002-12-04')
  assert.deepEqual([num(h1.interval_bounded_dodgers_bwar), num(h2.interval_bounded_dodgers_bwar)], [2.33, 0.02])
  assert.equal(num((await one(`select incoming_dodgers_bwar::text as w from v_trade_realization_edges where incoming_asset_name = 'Todd Hundley'`)).w), 2.35)
  const s = await q(`select interval_start::text as s, interval_end::text as e, start_method, interval_bounded_dodgers_bwar::text as w from v_player_control_intervals where display_name = 'Mike Sharperson' order by 1`)
  assert.deepEqual(s.map((r) => [r.s, r.e, r.start_method, num(r.w)]), [['1987-09-22', '1993-10-08', 'TRADE_ACQUISITION', 5.91], ['1994-02-23', '1994-04-02', 'FREE_AGENT_SIGNING', 0]])
  const m = await q(`select interval_start::text as s, interval_end::text as e, interval_bounded_dodgers_bwar::text as w from v_player_control_intervals where display_name = 'Greg Maddux' order by 1`)
  assert.deepEqual(m.map((r) => [r.s, r.e, num(r.w)]), [['2006-07-31', '2006-10-31', 1.93], ['2008-08-19', '2008-10-30', -0.25]])
  const v = await q(`select interval_start::text as s, interval_end::text as e, start_method, interval_bounded_dodgers_bwar::text as w from v_player_control_intervals where display_name = 'Ismael Valdez' order by 1`)
  assert.deepEqual(v.map((r) => [r.start_method, r.e, num(r.w)]), [['TRACKED_SIGNING', '1999-12-12', 18.68], ['TRADE_ACQUISITION', '2000-10-30', -0.49]])
  // the second Valdez interval has no tracked-root lineage: it is not a child of the 1999 trade
  assert.equal((await q(`select 1 from v_transaction_asset_lineage where acquisition_event_key = 'CHC_LAD_2000_VALDEZ_REACQ'`)).length, 0)
  assert.equal((await q(`select 1 from v_transaction_asset_lineage where asset_name = 'Todd Hundley' and acquisition_event_key = 'CHC_LAD_2002_TODD_HUNDLEY'`)).length, 0)
})

test('exit-side chronology: a stint is placed before an exit only from an exact-dated exit, an offseason, no stint that season, or one contiguous stint', async () => {
  const bases = await q(`select exit_resolution_basis as b, count(*)::int as n from v_player_control_intervals where exit_event_key is not null and exit_resolution_basis is not null group by 1 order by 1`)
  assert.deepEqual(bases.map((r) => r.b), ['NO_EXIT_SEASON_DODGERS_STINT', 'OFFSEASON_AFTER_SEASON', 'SINGLE_STINT_BEFORE_EXIT'])
  assert.equal((await q(`select 1 from v_player_control_intervals where exit_resolution_basis = 'UNRESOLVED'`)).length, 0)
  // the two approximate exit dates (Valo, Fridley) never rest on the mid-season stint rule
  const imprecise = await q(`select display_name, exit_date_is_exact, exit_resolution_basis from v_player_control_intervals
    where exit_event_key in ('LAD_RELEASE_1958_ELMER_VALO', 'LAD_DET_1958_JIM_FRIDLEY') order by 1`)
  assert.deepEqual(imprecise.map((r) => [r.display_name, r.exit_date_is_exact, r.exit_resolution_basis]),
    [['Elmer Valo', false, 'OFFSEASON_AFTER_SEASON'], ['Jim Fridley', false, 'NO_EXIT_SEASON_DODGERS_STINT']])
  assert.equal((await q(`select 1 from v_player_control_intervals where exit_resolution_basis = 'SINGLE_STINT_BEFORE_EXIT' and not exit_date_is_exact`)).length, 0)
  // an approximate mid-season exit date leaves a same-season stint unresolved, never counted
  await inTxn(async () => {
    await chain.db.exec(`update transaction_events set historical_label = 'Released (date approximate)', transaction_date = date '2013-07-15' where event_key = 'LAD_FREE_AGENCY_2014_JOSH_BECKETT'`)
    const r = await one(`select war_state, exit_resolution_basis, interval_bounded_dodgers_bwar from v_player_control_intervals where display_name = 'Josh Beckett' and exit_event_key = 'LAD_FREE_AGENCY_2014_JOSH_BECKETT'`)
    assert.deepEqual([r.war_state, r.exit_resolution_basis, r.interval_bounded_dodgers_bwar], ['TIMING_UNRESOLVED', 'UNRESOLVED', null])
  })
  // a Dodgers stint after a recorded exit with no recorded acquisition is surfaced, not credited
  const returns = await q(`select asset_name from v_transaction_research_queue where issue = 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION' order by 1`)
  assert.deepEqual(returns.map((r) => r.asset_name), ['Chan Ho Park', 'Dioner Navarro', 'Guillermo Mota', 'Hideo Nomo', 'Juan Castro', 'Omar Daal', 'José Vizcaíno'].sort())
})

test('control intervals: bounded exits and open intervals are stated, never invented', async () => {
  const punto = await interval('Nick Punto')
  const bailey = await interval('Homer Bailey')
  for (const [p, d] of [[punto, '2013-11-13'], [bailey, '2019-02-09']]) {
    assert.equal(p.interval_status, 'EXIT_UNRECORDED_BOUNDED')
    assert.equal(p.interval_end, null, 'no exit date is invented')
    assert.equal(p.exit_bounded_before_date.toISOString().slice(0, 10), d)
  }
  const edman = await interval('Tommy Edman')
  assert.deepEqual([edman.interval_status, num(edman.interval_bounded_dodgers_bwar), edman.analysis_as_of_date.toISOString().slice(0, 10)], ['OPEN_CONTROL_OBSERVED', 3.58, '2026-10-05'])
  const open = await q(`select count(*)::int as n from v_player_control_intervals where interval_status = 'OPEN_CONTROL_OBSERVED' and interval_end is not null`)
  assert.equal(open[0].n, 0)
})

// ---------------------------------------------------------------------------------------------
// timing
// ---------------------------------------------------------------------------------------------

test('timing: every acquisition-season chronology rests on an accepted basis; the seven sourced cases are resolved by timing facts, never by a single team row', async () => {
  const cases = ['Elmer Valo', 'Tommy Edman', 'Chayce McDermott', 'Ben Rortvedt', 'Guillermo Mota', 'Wilkin Ruan', 'Robinson Checo']
  const got = await q(`select display_name, war_state, timing_resolution_basis, interval_bounded_dodgers_bwar::text as w from v_player_control_intervals
    where display_name = any($1) and start_method <> 'TRACKED_SIGNING' order by display_name`, [cases])
  assert.equal(got.length, cases.length)
  for (const r of got) assert.deepEqual([r.war_state, r.timing_resolution_basis], ['LOADED', 'TIMING_OBSERVATION'], r.display_name)
  const w = Object.fromEntries(got.map((r) => [r.display_name, num(r.w)]))
  assert.deepEqual([w['Elmer Valo'], w['Tommy Edman'], w['Chayce McDermott'], w['Ben Rortvedt']], [0.17, 3.58, -0.03, -0.12])
  assert.equal((await q(`select 1 from v_player_control_intervals where war_state = 'TIMING_UNRESOLVED'`)).length, 0)
  const bases = await q(`select distinct timing_resolution_basis as b from v_player_control_intervals where timing_resolution_basis is not null order by 1`)
  assert.deepEqual(bases.map((r) => r.b), ['CALENDAR', 'COUNTERPARTY_STINT_ORDER', 'NO_ACQUISITION_SEASON_DODGERS_STINT', 'TIMING_OBSERVATION', 'TRACKED_SIGNING'])
  assert.deepEqual((await q(`select issue from v_transaction_research_queue where issue = 'TRADE_RETURN_TIMING_UNRESOLVED'`)), [])
  assert.deepEqual((await q(`select issue from v_value_research_queue where issue = 'TRADE_RETURN_TIMING_UNRESOLVED'`)), [])
  assert.equal((await q(`select 1 from v_trade_realization_edges where return_state = 'TIMING_UNRESOLVED'`)).length, 3, 'the 033 edge view is preserved')
  // without its sourced fact the same interval is unresolved, never zero and never inferred from a single Dodgers team row
  await inTxn(async () => {
    for (const name of ['Ben Rortvedt', 'Guillermo Mota']) {
      await chain.db.exec(`update transaction_asset_timing_observations set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test'
        where subject_asset_id = (select a.id from transaction_event_assets a where a.asset_name = '${name}' and a.asset_side = 'INCOMING')`)
    }
    const r = await one(`select war_state, timing_resolution_basis, interval_bounded_dodgers_bwar from v_player_control_intervals where display_name = 'Ben Rortvedt'`)
    assert.deepEqual([r.war_state, r.timing_resolution_basis, r.interval_bounded_dodgers_bwar], ['TIMING_UNRESOLVED', 'UNRESOLVED', null])
    const l = await one(`select attribution_level, attribution_resolution, value_resolution, interval_bounded_dodgers_bwar from v_transaction_asset_lineage where asset_name = 'Ben Rortvedt'`)
    assert.deepEqual([l.attribution_level, l.attribution_resolution, l.value_resolution, l.interval_bounded_dodgers_bwar], ['UNRESOLVED', 'UNRESOLVED', 'VALUE_TIMING_UNRESOLVED', null])
    const m = await one(`select war_state from v_player_control_intervals where display_name = 'Guillermo Mota'`)
    assert.equal(m.war_state, 'TIMING_UNRESOLVED')
  })
})

// ---------------------------------------------------------------------------------------------
// lineage: proof chains
// ---------------------------------------------------------------------------------------------

test('proof chain: Alvarez -> Fields is PLAYER_ATTRIBUTABLE 1.94 and terminal', async () => {
  const [r] = await lineage('LAD_HOU_2016_ALVAREZ_FIELDS|%')
  assert.deepEqual([r.asset_name, r.hop_number, r.attribution_level, num(r.interval_bounded_dodgers_bwar), r.branch_status, r.exit_type, r.exit_date.toISOString().slice(0, 10)],
    ['Josh Fields', 1, 'PLAYER_ATTRIBUTABLE', 1.94, 'TERMINAL_NO_RETURN', 'RELEASE', '2019-03-10'])
  const s = await one(`select * from v_downstream_organizational_realization where row_grain = 'SIGNING' and player_slug = 'yordan-alvarez'`)
  assert.deepEqual([num(s.direct_dodgers_mlb_bwar), num(s.total_individually_attributable_organizational_bwar), s.chain_status, s.max_observed_hop], [0, 1.94, 'COMPLETE_TERMINAL', 1])
})

test('proof chains: Cruz -> Watson and Diaz -> Machado are PACKAGE_ATTRIBUTABLE, never credited to the signing, and terminal', async () => {
  for (const [rootLike, asset, w, slug] of [['LAD_PIT_2017_CRUZ_WATSON|%', 'Tony Watson', 0.4, 'oneil-cruz'], ['LAD_BAL_2018_DIAZ_MACHADO|%', 'Manny Machado', 2.58, 'yusniel-diaz']]) {
    const [r] = await lineage(rootLike, asset)
    assert.deepEqual([r.attribution_level, num(r.interval_bounded_dodgers_bwar), r.branch_status, r.exit_type], ['PACKAGE_ATTRIBUTABLE', w, 'TERMINAL_NO_RETURN', 'FREE_AGENCY'])
    const s = await one(`select * from v_downstream_organizational_realization where row_grain = 'SIGNING' and player_slug = $1`, [slug])
    assert.equal(num(s.interval_bounded_individually_attributable_first_hop_bwar), 0, 'no individual credit')
    assert.equal(num(s.interval_bounded_first_hop_package_bwar), w, 'the package value is shown separately')
    assert.equal(num(s.total_individually_attributable_organizational_bwar), num(s.direct_dodgers_mlb_bwar))
  }
  assert.equal((await one(`select transaction_date::text as d from transaction_events where event_key = 'LAD_BAL_2018_DIAZ_MACHADO'`)).d, '2018-07-18')
})

test('proof chain: Puig -> Gray -> Washington: the first hop is package-level, Scherzer and Turner are mixed-lineage for Puig and not attributable', async () => {
  const rows = await lineage('LAD_CIN_2018_YASIEL_PUIG|%')
  const by = Object.fromEntries(rows.map((r) => [`${r.hop_number}:${r.asset_name}`, r]))
  for (const n of ['Homer Bailey', 'Jeter Downs', 'Josiah Gray']) assert.equal(by[`1:${n}`].attribution_level, 'PACKAGE_ATTRIBUTABLE', n)
  for (const n of ['Max Scherzer', 'Trea Turner']) {
    assert.equal(by[`2:${n}`].attribution_level, 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE', n)
    assert.equal(by[`2:${n}`].prior_attribution_level, 'PACKAGE_ATTRIBUTABLE')
  }
  assert.equal(by['1:Homer Bailey'].branch_status, 'EXIT_UNRECORDED_BOUNDED')
  const s = await one(`select * from v_downstream_organizational_realization where row_grain = 'SIGNING' and player_slug = 'yasiel-puig'`)
  assert.deepEqual([num(s.direct_dodgers_mlb_bwar), num(s.interval_bounded_individually_attributable_first_hop_bwar), num(s.downstream_individually_attributable_bwar),
    num(s.total_individually_attributable_organizational_bwar)], [17.8, 0, 0, 17.8])
  assert.ok(num(s.observable_not_attributable_bwar) > 40, 'the mixed-lineage value is visible')
  // the Washington trade is Ruiz's own package: Scherzer and Turner are package value there, counted once
  const ruiz = await lineage('LAD_WSH_2021_KEIBERT_RUIZ|%')
  assert.deepEqual(ruiz.map((r) => [r.asset_name, r.attribution_level, r.hop_number]), [['Max Scherzer', 'PACKAGE_ATTRIBUTABLE', 1], ['Trea Turner', 'PACKAGE_ATTRIBUTABLE', 1]])
})

test('proof chain: Vivas / Gonzalez -> Sweeney -> Flaherty: Sweeney is package-level, Flaherty is mixed (another tracked root left with Sweeney), no individual credit', async () => {
  const rows = await lineage('LAD_NYY_2023_JORBIT_VIVAS|%')
  assert.deepEqual(rows.map((r) => [r.hop_number, r.asset_name, r.attribution_level, r.branch_status]),
    [[1, 'Trey Sweeney', 'PACKAGE_ATTRIBUTABLE', 'CONTINUES'], [2, 'Jack Flaherty', 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE', 'TERMINAL_NO_RETURN']])
  assert.deepEqual(rows[0].root_signing_slugs, ['jorbit-vivas', 'victor-gonzalez'])
  for (const slug of ['jorbit-vivas', 'victor-gonzalez']) {
    const s = await one(`select * from v_downstream_organizational_realization where row_grain = 'SIGNING' and player_slug = $1`, [slug])
    assert.equal(num(s.downstream_individually_attributable_bwar), 0)
    assert.ok(Math.abs(num(s.total_individually_attributable_organizational_bwar) - num(s.direct_dodgers_mlb_bwar)) < 0.001)
  }
})

test('proof chain: Axel Perez -> McDermott -> Rortvedt is PLAYER_ATTRIBUTABLE at every hop (sole outgoing asset each time) and the chain stays open', async () => {
  const rows = await lineage('LAD_BAL_2026_AXEL_PEREZ|%')
  assert.deepEqual(rows.map((r) => [r.hop_number, r.asset_name, r.attribution_level, num(r.interval_bounded_dodgers_bwar), r.branch_status]),
    [[1, 'Chayce McDermott', 'PLAYER_ATTRIBUTABLE', -0.03, 'CONTINUES'], [2, 'Ben Rortvedt', 'PLAYER_ATTRIBUTABLE', -0.12, 'STILL_ACTIVE']])
  const s = await one(`select * from v_downstream_organizational_realization where row_grain = 'SIGNING' and player_slug = 'axel-perez'`)
  assert.deepEqual([num(s.downstream_individually_attributable_bwar), s.chain_status], [-0.12, 'STILL_ACTIVE'])
  // negative bWAR stays negative and counts
  assert.equal(num(s.interval_bounded_individually_attributable_first_hop_bwar), -0.03)
})

test('outgoing consideration: a player traded with cash is at best PACKAGE_ATTRIBUTABLE; attribution never improves downstream', async () => {
  await inTxn(async () => {
    const ev = `(select id from transaction_events where event_key = 'LAD_NYM_2026_CHAYCE_MCDERMOTT')`
    await chain.db.exec(`insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type, source_id, counterparty_organization_id)
      select e.id, 'OUTGOING', 'Cash', 'CASH', e.source_id, e.to_organization_id from transaction_events e where e.id = ${ev}`)
    const r = await one(`select attribution_level, prior_attribution_level from v_transaction_asset_lineage where asset_name = 'Ben Rortvedt'`)
    assert.deepEqual([r.attribution_level, r.prior_attribution_level], ['PACKAGE_ATTRIBUTABLE', 'PLAYER_ATTRIBUTABLE'])
  })
  await inTxn(async () => {
    // cash in the root trade degrades the first hop
    await chain.db.exec(`insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type, source_id, counterparty_organization_id)
      select e.id, 'OUTGOING', 'Cash', 'CASH', e.source_id, e.to_organization_id from transaction_events e where e.event_key = 'LAD_BAL_2026_AXEL_PEREZ'`)
    const rows = await q(`select asset_name, attribution_level from v_transaction_asset_lineage where root_package_key like 'LAD_BAL_2026_AXEL_PEREZ|%' order by hop_number`)
    assert.deepEqual(rows.map((r) => r.attribution_level), ['PACKAGE_ATTRIBUTABLE', 'PACKAGE_ATTRIBUTABLE'])
  })
  // never improves: no row is better than its parent
  assert.equal((await one(`select count(*)::int as n from v_transaction_asset_lineage l join v_transaction_asset_lineage p on p.path_key = l.parent_path_key
    where case l.attribution_level when 'PLAYER_ATTRIBUTABLE' then 0 when 'PACKAGE_ATTRIBUTABLE' then 1 when 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE' then 2 else 3 end
        < case p.attribution_level when 'PLAYER_ATTRIBUTABLE' then 0 when 'PACKAGE_ATTRIBUTABLE' then 1 when 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE' then 2 else 3 end`)).n, 0)
})

test('deeper chains: De La Rosa reaches depth 4 and degrades; Astacio -> Young -> Ricketts -> Izturis -> Maddux; Mondesi -> Green -> Navarro; Nunez -> Mota -> Murphy -> Finley / Mayne', async () => {
  const dlr = await lineage('BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD|%')
  assert.equal(Math.max(...dlr.map((r) => r.hop_number)), 4)
  const path = (rows, name) => rows.filter((r) => r.asset_name === name).map((r) => [r.hop_number, r.attribution_level])
  assert.deepEqual(path(dlr, 'Matt Kemp'), [[2, 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE']])
  assert.deepEqual(path(dlr, 'Mookie Betts'), [[4, 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE']])
  for (const n of ['Adrian Gonzalez', 'Carl Crawford', 'Josh Beckett']) assert.deepEqual(path(dlr, n), [[1, 'PACKAGE_ATTRIBUTABLE']])
  const ast = await lineage('LAD_COL_1997_ASTACIO|%')
  assert.deepEqual(ast.map((r) => [r.hop_number, r.asset_name, r.attribution_level]).filter((x) => ['Eric Young Sr.', 'Chad Ricketts', 'César Izturis', 'Greg Maddux'].includes(x[1])),
    [[1, 'Eric Young Sr.', 'PLAYER_ATTRIBUTABLE'], [2, 'Chad Ricketts', 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'], [3, 'César Izturis', 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'], [4, 'Greg Maddux', 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE']])
  const mon = await lineage('LAD_TOR_1999_MONDESI_GREEN|%')
  assert.ok(mon.some((r) => r.asset_name === 'Dioner Navarro' && r.hop_number === 2 && r.attribution_level === 'PACKAGE_ATTRIBUTABLE'), 'Green left alone: the Arizona return is package-level')
  assert.ok(mon.some((r) => r.asset_name === 'Hee-Seop Choi' && r.hop_number === 3 && r.attribution_level === 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'), 'Mota left with other players')
  assert.ok(mon.some((r) => r.asset_name === 'Steve Finley' && r.hop_number === 4 && r.attribution_level === 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE' && r.branch_status === 'EXIT_NOT_RESEARCHED'))
  // the sole-outgoing downstream cases of the research
  const fer = await lineage('BRO_PHI_1957_FERNANDEZ|%', 'Jim Fridley')
  assert.deepEqual(fer.map((r) => [r.attribution_level, r.hop_number]), [['PLAYER_ATTRIBUTABLE', 2]])
  const off = await lineage('LAD_KCR_1995_OFFERMAN|%', 'Mike Judd')
  assert.deepEqual(off.map((r) => [r.attribution_level, r.branch_status]), [['PLAYER_ATTRIBUTABLE', 'RETURN_UNRECORDED']])
})

// ---------------------------------------------------------------------------------------------
// package aggregates and double counting
// ---------------------------------------------------------------------------------------------

test('package lineage: one row per package x interval; a shared package contributes once; mixed-lineage value is additive to no package', async () => {
  assert.equal((await one(`select count(*)::int as n from (select root_package_key, interval_key from v_transaction_package_lineage group by 1, 2 having count(*) > 1) d`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from v_transaction_package_lineage where attribution_level in ('CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE', 'UNRESOLVED') and is_additive_to_package_total`)).n, 0)
  // the 2024 Vargas / Albertus / Perez package: three tracked signings, one package, 4.89 once
  const members = await q(`select player_slug, interval_bounded_first_hop_package_bwar::text as w from v_downstream_organizational_realization
    where row_grain = 'SIGNING' and player_slug in ('miguel-vargas', 'alexander-albertus', 'jeral-perez') order by 1`)
  assert.deepEqual(members.map((m) => num(m.w)), [4.89, 4.89, 4.89])
  const pkgRows = await q(`select interval_bounded_first_hop_package_bwar::text as w from v_downstream_organizational_realization where row_grain = 'PACKAGE' and root_package_key like 'LAD_CWS_2024_JERAL_PEREZ|%'`)
  assert.deepEqual(pkgRows.map((r) => num(r.w)), [4.89])
  // the legacy portfolio sum repeats a multi-signing package; the new package-deduplicated measure groups by package first
  const p = await one(`select * from v_dodgers_international_value_portfolio where grain = 'ALL'`)
  const direct = await one(`select sum(interval_bounded_first_hop_package_bwar)::text as s, count(*)::int as n from v_downstream_organizational_realization where row_grain = 'PACKAGE'`)
  assert.equal(num(p.interval_bounded_first_hop_package_bwar), num(direct.s))
  assert.equal(p.root_packages, direct.n)
  const dedup = await one(`select sum(v)::text as s from (select distinct on (interval_key) interval_key, interval_bounded_dodgers_bwar as v from v_transaction_package_lineage order by interval_key) x`)
  assert.equal(num(p.package_deduplicated_total_bwar), num(dedup.s))
  const sumPerSigning = await one(`select sum(interval_bounded_first_hop_package_bwar)::text as s from v_downstream_organizational_realization where row_grain = 'SIGNING'`)
  assert.ok(num(sumPerSigning.s) > num(direct.s), 'adding per-signing copies would double count the shared packages')
})

test('regression fixture: several tracked signings sharing a package with nonzero WAR are counted once at package level', async () => {
  await inTxn(async () => {
    // make the Pittsburgh co-outgoing player a tracked signing too: the 2017 Cruz package now has two tracked signings
    await chain.db.exec(`update transaction_event_assets set player_id = (select id from players where slug = 'abel-lorenzo')
      where asset_name = 'Angel German' and event_id = (select id from transaction_events where event_key = 'LAD_PIT_2017_CRUZ_WATSON')`)
    const pkg = await q(`select root_package_key, interval_bounded_first_hop_package_bwar::text as w
      from v_downstream_organizational_realization where row_grain = 'PACKAGE' and root_package_key like 'LAD_PIT_2017_CRUZ_WATSON|%'`)
    assert.deepEqual(pkg.map((r) => [r.root_package_key, num(r.w)]), [['LAD_PIT_2017_CRUZ_WATSON|abel-lorenzo,oneil-cruz', 0.4]])
    const members = await q(`select player_slug, interval_bounded_first_hop_package_bwar::text as w, interval_bounded_individually_attributable_first_hop_bwar::text as ind
      from v_downstream_organizational_realization where row_grain = 'SIGNING' and player_slug in ('abel-lorenzo', 'oneil-cruz') order by 1`)
    assert.deepEqual(members.map((m) => [m.player_slug, num(m.w), num(m.ind)]), [['abel-lorenzo', 0.4, 0], ['oneil-cruz', 0.4, 0]])
    const p = await one(`select root_packages, interval_bounded_first_hop_package_bwar::text as w from v_dodgers_international_value_portfolio where grain = 'ALL'`)
    const once = await one(`select count(*)::int as n, sum(interval_bounded_first_hop_package_bwar)::text as s from v_downstream_organizational_realization where row_grain = 'PACKAGE'`)
    assert.deepEqual([p.root_packages, num(p.w)], [once.n, num(once.s)])
  })
})

// ---------------------------------------------------------------------------------------------
// completeness, queues and zero semantics
// ---------------------------------------------------------------------------------------------

test('chain completeness: terminal exits clear the 033 downstream flag; only genuine data deficiencies remain; known attribution boundaries are informational', async () => {
  const flag = await one(`select count(*)::int as n from v_player_organizational_realization where downstream_asset_chain_incomplete`)
  assert.ok(flag.n >= 20, 'the legacy flag (any recorded later exit, terminal or not) never falls below its 033 value')
  const pkgs = await q(`select chain_status, count(*)::int as n from v_downstream_organizational_realization where row_grain = 'PACKAGE' group by 1 order by 1`)
  const rootEvents = await one(`select count(distinct e.event_key)::int as n from transaction_events e join transaction_event_assets a on a.event_id = e.id
    where e.transaction_type = 'TRADE' and a.asset_side = 'OUTGOING' and a.player_id is not null`)
  assert.equal(pkgs.reduce((x, r) => x + r.n, 0), rootEvents.n, 'the completeness unit is the root package')
  assert.equal(pkgs.filter((r) => r.chain_status.startsWith('INCOMPLETE')).reduce((x, r) => x + r.n, 0), 9)
  const now = await q(`select chain_status, count(*)::int as n from v_downstream_organizational_realization where row_grain = 'SIGNING' group by 1 order by 1`)
  const incomplete = now.filter((r) => r.chain_status.startsWith('INCOMPLETE')).reduce((s, r) => s + r.n, 0)
  assert.equal(incomplete, 9)
  assert.equal((await one(`select count(*)::int as n from v_value_research_queue where issue = 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE'`)).n, 9)
  assert.ok(now.find((r) => r.chain_status === 'STILL_ACTIVE').n >= 1)
  const boundary = await one(`select count(*)::int as n, min(priority)::int as p from v_value_research_queue where issue = 'LINEAGE_BOUNDARY_NOTED'`)
  assert.ok(boundary.n > 0 && boundary.p === 4, 'informational')
  const rows = await q(`select issue, count(*)::int as n from v_transaction_research_queue where issue like 'DOWNSTREAM%' or issue like 'EXIT_NOT_RESEARCHED%' or issue = 'RETURN_ASSET_EXIT_MISSING' group by 1 order by 1`)
  assert.deepEqual(rows, [{ issue: 'DOWNSTREAM_WAR_NOT_LOADED', n: 4 }, { issue: 'EXIT_NOT_RESEARCHED_DOWNSTREAM', n: 9 }, { issue: 'RETURN_ASSET_EXIT_MISSING', n: 3 }])
})

test('zero semantics: observed zero only through a dated observation; missing, unresolved and unloaded intervals are never zero', async () => {
  const z = await q(`select war_state, count(*)::int as n, count(*) filter (where interval_bounded_dodgers_bwar = 0)::int as zero, count(*) filter (where interval_bounded_dodgers_bwar is null)::int as nul
    from v_player_control_intervals group by 1 order by 1`)
  const by = Object.fromEntries(z.map((r) => [r.war_state, r]))
  assert.equal(by.NO_MLB_APPEARANCE_OBSERVED.n, 13)
  assert.equal(by.NO_MLB_APPEARANCE_OBSERVED.zero, 13)
  assert.equal(by.WAR_NOT_LOADED.nul, by.WAR_NOT_LOADED.n)
  assert.equal(by.NO_TEAM_SEASON_FACTS.nul, by.NO_TEAM_SEASON_FACTS.n)
  assert.equal((await one(`select count(*)::int as n from v_player_control_intervals where war_state = 'NO_MLB_APPEARANCE_OBSERVED' and no_mlb_appearance_observed_through is null`)).n, 0)
  // lineage resolution and value resolution are separate dimensions: a minor with no WAR row has a resolved attribution and an unloaded value
  const garcia = await one(`select attribution_level, attribution_resolution, value_resolution, war_state, interval_bounded_dodgers_bwar from v_transaction_asset_lineage where asset_name = 'Apostol Garcia'`)
  assert.deepEqual([garcia.attribution_level, garcia.attribution_resolution, garcia.value_resolution, garcia.war_state, garcia.interval_bounded_dodgers_bwar],
    ['CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE', 'RESOLVED', 'VALUE_NOT_LOADED', 'WAR_NOT_LOADED', null])
  assert.equal((await one(`select count(*)::int as n from v_transaction_asset_lineage where war_state = 'WAR_NOT_LOADED' and attribution_level = 'UNRESOLVED'`)).n, 0)
  // a terminal non-player return is explicit
  const rincon = await one(`select branch_status from v_transaction_asset_lineage where asset_name = 'Billy McKinney'`)
  assert.equal(rincon.branch_status, 'TERMINAL_NON_PLAYER_RETURN')
})

// ---------------------------------------------------------------------------------------------
// convergence, security and verifier
// ---------------------------------------------------------------------------------------------

test('convergence: a fresh 001-034 replay equals the 001-033 database with 034 applied (rows, definitions, grants)', async () => {
  const fresh = await buildChainThrough('034_downstream_organizational_value_chains.sql')
  try {
    const business = async (query) => ({
      events: await query(`select event_key, transaction_date::text as d, transaction_type, historical_label from transaction_events order by 1`),
      assets: await query(`select e.event_key, a.asset_side, a.asset_name, a.asset_type, a.mlb_id, a.bref_id, a.bref_register_id,
        (select abbreviation from organizations o where o.id = a.counterparty_organization_id) as cp from transaction_event_assets a join transaction_events e on e.id = a.event_id order by 1, 2, 3`),
      timing: await query(`select t.fact_type, t.season, t.observed_date::text as d, a.asset_name, e.event_key from transaction_asset_timing_observations t
        join transaction_event_assets a on a.id = t.subject_asset_id join transaction_events e on e.id = a.event_id order by 1, 4, 2`),
      war: await query(`select bref_id, season, bref_team_code, stint_ordinal, component, war::text as war from player_mlb_team_season_war order by 1, 2, 3, 4, 5`),
      intervals: await query(`select interval_key, interval_start::text as s, interval_end::text as e, interval_status, war_state, interval_bounded_dodgers_bwar::text as w from v_player_control_intervals order by 1`),
      lineage: await query(`select path_key, attribution_level, branch_status, interval_bounded_dodgers_bwar::text as w from v_transaction_asset_lineage order by 1`),
      realization: await query(`select row_grain, player_slug, root_package_key, chain_status, total_individually_attributable_organizational_bwar::text as t from v_downstream_organizational_realization order by 1, 2, 3`),
      portfolio: await query(`select * from v_dodgers_international_value_portfolio order by grain, grain_value`),
    })
    assert.deepEqual(await business(fresh.query), await business(q))
    const defs = (query) => query(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)
    const acl = (query) => query(`select c.relname, coalesce(array_to_string(c.relacl, ','), '') as acl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') order by 1`)
    const funcs = (query) => query(`select p.proname, md5(pg_get_functiondef(p.oid)) as def, coalesce(p.proacl::text, '') as acl from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)
    assert.deepEqual(await defs(fresh.query), await defs(q))
    assert.deepEqual(await acl(fresh.query), await acl(q))
    assert.deepEqual(await funcs(fresh.query), await funcs(q))
  } finally {
    await fresh.close()
  }
})

test('security: the timing table is RLS + SELECT-only, the guard is invoker-rights with no API EXECUTE, new views are security_invoker SELECT-only', async () => {
  const acl = await q(`select c.relname, c.relkind::text as kind, c.relrowsecurity as rls, coalesce(array_to_string(c.reloptions, ','), '') as opts,
      coalesce((select string_agg(distinct a.privilege_type, ',') from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
        left join pg_roles r on r.oid = a.grantee where coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated')), '') as privs,
      exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where a.grantee = 0) as public_grant
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1) order by 1`, [[...NEW_VIEWS, NEW_TABLE]])
  assert.equal(acl.length, 5)
  for (const r of acl) {
    assert.equal(r.privs, 'SELECT', r.relname)
    assert.equal(r.public_grant, false, r.relname)
    if (r.kind === 'v') assert.match(r.opts, /security_invoker=(true|on)/, r.relname)
    else assert.equal(r.rls, true)
  }
  assert.deepEqual(await q(`select cmd from pg_policies where schemaname = 'public' and tablename = $1`, [NEW_TABLE]), [{ cmd: 'SELECT' }])
  const fn = await one(`select prosecdef, proconfig::text as cfg, has_function_privilege('anon', oid, 'execute') as anon, has_function_privilege('authenticated', oid, 'execute') as auth,
      has_function_privilege('public', oid, 'execute') as pub from pg_proc where proname = 'disi_timing_observation_guard'`)
  assert.match(fn.cfg, /search_path/)
  assert.deepEqual([fn.prosecdef, fn.anon, fn.auth, fn.pub], [false, false, false, false])
  assert.equal((await one(`select count(*)::int as n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('v_player_control_intervals')`)).n, 0, 'no helper function: pure SQL views')
})

test('verifier: the 18 downstream checks pass and catch their own drift; the full verifier passes with 186 checks (178 through 034 plus 8 for 035, which pass trivially without their views)', async () => {
  assert.deepEqual(await failing(), [])
  assert.equal(DOWNSTREAM_CHECK_NAMES.length, 18)
  const full = await checkInvariants(q, { ...CANONICAL_EXPECTATIONS, public_views_total: 109, public_tables_total: 59 })
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 255)
  const drifts = {
    downstream_timing_observation_violations: `alter table transaction_asset_timing_observations disable trigger transaction_asset_timing_observations_guard;
      update transaction_asset_timing_observations set observed_date = date '1900-01-01', season = 1900 where fact_type = 'FIRST_DODGERS_APPEARANCE' and season = 2024;`,
    downstream_interval_overlap_violations: `insert into transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id)
      select 'OVERLAP_EVENT', date '2013-05-01', 'FREE_AGENT_SIGNING', o.id, 'x', (select id from sources limit 1) from organizations o where o.abbreviation = 'LAD';
      insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id, bref_id, source_id)
      select e.id, 'INCOMING', 'Josh Beckett', 'PLAYER', '277417', 'beckejo02', e.source_id from transaction_events e where e.event_key = 'OVERLAP_EVENT';`,
    downstream_guard_violations: `drop trigger transaction_asset_timing_observations_guard on transaction_asset_timing_observations;`,
  }
  for (const [name, drift] of Object.entries(drifts)) {
    await inTxn(async () => {
      await chain.db.exec(drift)
      assert.ok((await one(downstreamQueries(true)[name])).n > 0, `${name} fires`)
    })
  }
  assert.deepEqual(await failing(), [])
})
