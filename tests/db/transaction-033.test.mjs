// Migration 033 - transaction and asset-chain completion.
//
// One 001-032 database is built; 033's preconditions are tested on that pre-033 state in rolled-back transactions, then 033
// is applied for real (committed) and the remaining tests run on the result, again in rolled-back transactions.
// Test order matters.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough, buildCanonicalChain } from './canonical-chain.mjs'
import { lit, withoutTransaction } from './drift-027.mjs'
import { transactionQueries, TRANSACTION_CHECK_NAMES } from '../../scripts/db/lib/transaction-invariants.mjs'
import { valueQueries } from '../../scripts/db/lib/value-invariants.mjs'
import { checkInvariants, failedChecks, EXPECTATIONS_THROUGH_046 as CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '033_transaction_asset_chain_completion.sql'
const sql033 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const inner = withoutTransaction(sql033)
const rd = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/033', f), 'utf8'))
const seed = rd('event-seed.json')
const war = rd('war-seed.json')
const config = rd('scope-config.json')
const audit = rd('audit-report.json')
// the chain under test stops at 033: 58 tables / 105 views
const EXPECT033 = { ...CANONICAL_EXPECTATIONS, public_views_total: 105, public_tables_total: 58 }
const NEW_TABLES = ['transaction_asset_resolutions', 'dodgers_control_observations']
const NEW_VIEWS = ['v_transaction_event_complete', 'v_transaction_asset_chain_readiness', 'v_dodgers_international_exit_summary', 'v_transaction_research_queue']

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
before(async () => { chain = await buildChainThrough('032_player_value_organizational_realization.sql') }, { timeout: 180000 })
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
const failing = async (loaded = true) => {
  const out = []
  for (const [name, sql] of Object.entries(transactionQueries(loaded))) if ((await one(sql)).n !== 0) out.push(name)
  for (const [name, sql] of Object.entries(valueQueries(true))) if ((await one(sql)).n !== 0) out.push(name)
  return out.sort()
}
const num = (v) => (v === null || v === undefined ? null : Number(v))
const EVENT = (key) => `(select id from transaction_events where event_key = ${lit(key)})`
const ASSET = (key, side, name) => `(select a.id from transaction_event_assets a where a.event_id = ${EVENT(key)} and a.asset_side = ${lit(side)} and a.asset_name = ${lit(name)})`
const edge = (key, incoming = null) => one(`select * from v_trade_realization_edges where event_key = $1 and incoming_asset_name is not distinct from $2`, [key, incoming])
let pre

// ---------------------------------------------------------------------------------------------
// the pre-033 database
// ---------------------------------------------------------------------------------------------

test('baseline: a 001-032 replay is 56 tables / 101 views, three modeled events, eleven assets, no 033 object', async () => {
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`), { tables: 56, views: 101 })
  assert.deepEqual(await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [[...NEW_TABLES, ...NEW_VIEWS]]), [])
  assert.deepEqual(await one(`select (select count(*) from transaction_events)::int as events, (select count(*) from transaction_event_assets)::int as assets,
    (select count(*) from transactions)::int as legacy`), { events: 3, assets: 11, legacy: 5 })
  assert.equal((await one(`select transaction_date::text as d from transaction_events where event_key = 'LAD_BAL_2018_DIAZ_MACHADO'`)).d, '2018-07-19')
  assert.deepEqual(await failing(false), [])
  const snap = async (sql) => md5(await q(sql))
  pre = {
    hashes: await tableHashes(),
    realization: await q(`select player_slug, direct_dodgers_mlb_bwar::text as direct, non_dodgers_mlb_bwar::text as non_dodgers, team_season_career_bwar::text as career,
      package_attribution_state as state, trade_package_return_dodgers_bwar::text as package_return from v_player_organizational_realization order by 1`),
    war: await snap(`select bref_id, season, bref_team_code, stint_ordinal, component, war::text from player_mlb_team_season_war order by 1, 2, 3, 4, 5`),
  }
})

test('preconditions: an unexpected pre-033 state aborts 033 with nothing changed', async () => {
  const cases = [
    ['an unknown transaction event exists', `insert into transaction_events (event_key, transaction_date, transaction_type, description) values ('UNKNOWN_EVENT', date '2020-01-01', 'TRADE', 'x');`, /event\(s\) exist that the reviewed data does not know/],
    ['a tracked player has a different MLB id', `update players set mlb_id = 1 where slug = 'oneil-cruz';`, /tracked player oneil-cruz does not exist with MLB id/],
    ['a data-file source is missing', `update sources set url = url || '#x' where url = ${lit(config.files.bat.url)};`, /data file source .* is not registered/],
    ['an expected organization is missing', `update organizations set abbreviation = 'ZZZ' where abbreviation = 'STL';`, /organization STL does not exist/],
    ['032 is not applied', `drop view v_value_research_queue; drop view v_dodgers_international_value_portfolio; drop view v_player_organizational_realization; drop view v_trade_realization_edges;`, /Migration 032 has not been applied/],
  ]
  for (const [label, drift, expected] of /** @type {Array<[string, string, RegExp]>} */ (cases)) assert.match(await attempt(`${drift}\n${inner}`), expected, label)
  assert.deepEqual(await tableHashes(), pre.hashes, 'aborted runs changed nothing')
})

test('033 applied for real: 56 -> 58 tables and 101 -> 105 views; 2 tables, 4 views, 2 guards, 6 columns', async () => {
  await chain.db.exec(sql033)
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`), { tables: 58, views: 105 })
  assert.deepEqual((await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`, [[...NEW_TABLES, ...NEW_VIEWS]])).map((r) => r.relname),
    [...NEW_TABLES, ...NEW_VIEWS].sort())
  assert.deepEqual((await q(`select column_name from information_schema.columns where table_name = 'transaction_event_assets' and column_name in
    ('mlb_id', 'bref_register_id', 'counterparty_organization_id', 'cash_amount_usd', 'pool_space_amount_usd', 'bref_id', 'player_id') order by 1`)).map((r) => r.column_name),
    ['bref_id', 'bref_register_id', 'cash_amount_usd', 'counterparty_organization_id', 'mlb_id', 'player_id', 'pool_space_amount_usd'])
  assert.deepEqual((await q(`select column_name from information_schema.columns where table_name = 'transaction_events' and column_name in ('is_multi_team', 'historical_label') order by 1`))
    .map((r) => r.column_name), ['historical_label', 'is_multi_team'])
  assert.deepEqual(await failing(), [])
})

test('only the expected tables changed; scouting, development, network, financial and the 032 outcome stores are untouched', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => pre.hashes[t] !== now[t]).sort()
  assert.deepEqual(changed, ['bref_team_code_map', 'dodgers_control_observations', 'evidence', 'player_mlb_team_season_war', 'sources', 'transaction_asset_resolutions',
    'transaction_event_assets', 'transaction_events', 'transactions'])
  for (const t of ['player_evaluations', 'player_season_stints', 'development_milestones', 'network_entities', 'player_network_relationships', 'signings',
    'signing_financial_reports', 'signing_financial_resolutions', 'signing_environments', 'transaction_return_metrics', 'transaction_competitive_context',
    'outcome_audits', 'outcomes', 'players', 'organizations', 'player_metric_observations']) {
    assert.equal(now[t], pre.hashes[t], `${t} is unchanged`)
  }
})

test('rerun is a no-op: no row, grant, policy or definition changes', async () => {
  const snap = async () => ({ hashes: await tableHashes(), acl: await q(`select c.relname, coalesce(array_to_string(c.relacl, ','), '') as acl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') order by 1`),
    policies: await q(`select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2`),
    defs: await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`) })
  const first = await snap()
  await chain.db.exec(sql033)
  assert.deepEqual(await snap(), first)
})

// ---------------------------------------------------------------------------------------------
// events, exit partition and historical cases
// ---------------------------------------------------------------------------------------------

test('events: 161 in total (TRADE 48, RELEASE 84, FREE_AGENCY 26, RULE5_SELECTION 1, EXPANSION_DRAFT 1, WAIVER 1): 140 tracked-player exits, 1 re-entry, 20 return-asset exits', async () => {
  assert.deepEqual(Object.fromEntries((await q(`select transaction_type as t, count(*)::int as n from transaction_events group by 1 order by 1`)).map((r) => [r.t, r.n])),
    { EXPANSION_DRAFT: 1, FREE_AGENCY: 26, RELEASE: 84, RULE5_SELECTION: 1, TRADE: 48, WAIVER: 1 })
  assert.equal((await one(`select count(*)::int as n from transaction_events`)).n, 161)
  const exits = await one(`select count(*)::int as n from transaction_events e where exists (select 1 from transaction_event_assets a where a.event_id = e.id and a.asset_side = 'OUTGOING' and a.player_id is not null)`)
  assert.equal(exits.n, 140, '140 events send a tracked signing out of Dodgers control')
  assert.equal((await one(`select count(*)::int as n from transaction_events e where exists (select 1 from transaction_event_assets a where a.event_id = e.id and a.asset_side = 'INCOMING' and a.player_id is not null)`)).n, 1,
    'one event brings a tracked signing back (Valdez reacquired 2000-07-26)')
  assert.equal((await one(`select count(*)::int as n from transaction_events e where not exists (select 1 from transaction_event_assets a where a.event_id = e.id and a.player_id is not null)`)).n, 20,
    '20 first-hop return-asset exit events')
  assert.equal((await one(`select count(*)::int as n from transaction_event_assets where asset_side = 'OUTGOING' and player_id is not null`)).n, 144, '144 tracked outgoing player-event rows')
  assert.equal((await one(`select count(*)::int as n from transaction_events where is_multi_team`)).n, 1)
})

test('exit partition: 220 players = 138 left + 64 still controlled + 16 no exit evidence + 2 history unavailable, mutually exclusive', async () => {
  assert.deepEqual(Object.fromEntries((await q(`select control_state as s, count(*)::int as n from v_dodgers_international_exit_summary group by 1`)).map((r) => [r.s, r.n])),
    { HISTORY_UNAVAILABLE: 2, LEFT_DODGERS_CONTROL: 138, NO_EXIT_EVIDENCE: 16, STILL_DODGERS_CONTROLLED: 64 })
  assert.equal((await one(`select count(*)::int as n from v_dodgers_international_exit_summary`)).n, 220)
  assert.equal((await one(`select count(distinct player_id)::int as n from v_dodgers_international_exit_summary`)).n, 220)
  assert.deepEqual(Object.fromEntries((await q(`select first_exit_mechanism as m, count(*)::int as n from v_dodgers_international_exit_summary
    where control_state = 'LEFT_DODGERS_CONTROL' group by 1`)).map((r) => [r.m, r.n])), { EXPANSION_DRAFT: 1, FREE_AGENCY: 13, RELEASE: 77, RULE5_SELECTION: 1, TRADE: 45, WAIVER: 1 })
  // verified exits never become unknown; a still-controlled player has no exit event; absence is not an exit
  assert.equal((await one(`select count(*)::int as n from v_dodgers_international_exit_summary where control_state <> 'LEFT_DODGERS_CONTROL' and exit_event_count > 0`)).n, 0)
  assert.equal((await one(`select count(*)::int as n from v_dodgers_international_exit_summary s where s.control_state = 'LEFT_DODGERS_CONTROL'
    and not exists (select 1 from transaction_event_assets a where a.player_id = s.player_id and a.asset_side = 'OUTGOING')`)).n, 0)
  assert.deepEqual((await q(`select player_slug from v_dodgers_international_exit_summary where control_state = 'HISTORY_UNAVAILABLE' order by 1`)).map((r) => r.player_slug), ['julian-leon', 'lenix-osuna'])
  assert.equal((await one(`select count(*)::int as n from v_dodgers_international_exit_summary where control_state in ('NO_EXIT_EVIDENCE', 'HISTORY_UNAVAILABLE') and unresolved_status`)).n, 18)
})

test('free agency is an exit only where Dodgers control ended: Baez 2020 is a true exit; Ryu 2018, Jansen 2016 and the re-signed cases are not events', async () => {
  const fa = async (slug) => (await q(`select e.transaction_date::text as d from transaction_events e join transaction_event_assets a on a.event_id = e.id join players p on p.id = a.player_id
    where p.slug = $1 and e.transaction_type = 'FREE_AGENCY' and a.asset_side = 'OUTGOING' order by 1`, [slug])).map((r) => r.d)
  assert.deepEqual(await fa('pedro-baez'), ['2020-10-28'])
  assert.deepEqual(await fa('hyun-jin-ryu'), ['2019-10-31'], 'the 2018 qualifying-offer acceptance is not an exit')
  assert.deepEqual(await fa('kenley-jansen'), ['2021-11-03'], 'the 2016 re-signing is not an exit')
  assert.deepEqual(await fa('ismael-valdez'), ['2000-10-30'])
  assert.deepEqual(await fa('christian-suarez'), [], 'elected free agency 2025-11-06 and re-signed 2025-12-15: control continued')
  // Baez later returned: the second exit is the 2022 release and the return is a new state, not a cancelled exit
  assert.deepEqual((await q(`select e.transaction_type as t, e.transaction_date::text as d from transaction_events e join transaction_event_assets a on a.event_id = e.id join players p on p.id = a.player_id
    where p.slug = 'pedro-baez' and a.asset_side = 'OUTGOING' order by 2`)), [{ t: 'FREE_AGENCY', d: '2020-10-28' }, { t: 'RELEASE', d: '2022-08-20' }])
  // a return asset: Frasso elected free agency 2025-11-21 and re-signed; only the 2026-07-20 trade is an exit
  assert.deepEqual((await q(`select e.transaction_type as t, e.transaction_date::text as d from transaction_events e join transaction_event_assets a on a.event_id = e.id
    where a.mlb_id = '693308' and a.asset_side = 'OUTGOING' order by 2`)), [{ t: 'TRADE', d: '2026-07-20' }])
})

test('historical cases: Clemente is a RULE5_SELECTION with the 1954 minor-league wording and a $4,000 consideration; Karim Garcia is an EXPANSION_DRAFT', async () => {
  const c = await one(`select e.transaction_type as t, e.historical_label as label, e.transaction_date::text as d, o.abbreviation as org, e.description from transaction_events e
    join organizations o on o.id = e.from_organization_id where e.event_key = 'BRO_PIT_1954_CLEMENTE_RULE5'`)
  assert.deepEqual([c.t, c.label, c.d, c.org], ['RULE5_SELECTION', 'minor-league ("Rule 5") draft', '1954-11-22', 'BRO'])
  const cash = await one(`select a.asset_type as t, a.cash_amount_usd::text as amount, a.asset_side as side from transaction_event_assets a where a.event_id = ${EVENT('BRO_PIT_1954_CLEMENTE_RULE5')} and a.asset_type = 'CASH'`)
  assert.deepEqual(cash, { t: 'CASH', amount: '4000.00', side: 'INCOMING' })
  // the consideration is transaction consideration, not player acquisition cost: the financial layer is untouched (see the changed-tables test)
  const g = await one(`select e.transaction_type as t, e.historical_label as label, e.transaction_date::text as d, o.abbreviation as org from transaction_events e
    join organizations o on o.id = e.to_organization_id where e.event_key = 'LAD_ARI_1997_GARCIA_EXPANSION'`)
  assert.deepEqual(g, { t: 'EXPANSION_DRAFT', label: '1997 expansion draft, 9th pick', d: '1997-11-18', org: 'ARI' })
})

test('Diaz / Machado: the transaction is dated 2018-07-18 in both stores, the old value is preserved as evidence, the press release keeps 2018-07-19, and nothing else moved', async () => {
  assert.equal((await one(`select transaction_date::text as d from transaction_events where event_key = 'LAD_BAL_2018_DIAZ_MACHADO'`)).d, '2018-07-18')
  assert.equal((await one(`select t.transaction_date::text as d from transactions t join players p on p.id = t.player_id where p.slug = 'yusniel-diaz'`)).d, '2018-07-18')
  const ev = await q(`select entity_type, confidence::text as c, evidence_note from evidence where field_name = 'transaction_date' order by 1`)
  assert.equal(ev.length, 2)
  assert.ok(ev.every((e) => e.c === 'VERIFIED' && /2018-07-18/.test(e.evidence_note) && /Previously recorded as 2018-07-19/.test(e.evidence_note)))
  assert.equal((await one(`select publication_date::text as d from sources where url = 'https://www.mlb.com/press-release/dodgers-acquire-manny-machado-286394692'`)).d, '2018-07-19')
  // no acquisition-timing or return change
  const e = await edge('LAD_BAL_2018_DIAZ_MACHADO', 'Manny Machado')
  assert.deepEqual([e.acquisition_timing_status, num(e.incoming_dodgers_bwar), e.return_state], ['RESOLVED_BY_COUNTERPARTY_STINT_ORDER', 2.58, 'LOADED'])
  // forward-only: a rerun does not change the corrected date and the correction is refused if the event carries another date
  assert.match(await attempt(`update transaction_events set transaction_date = date '2018-07-20' where event_key = 'LAD_BAL_2018_DIAZ_MACHADO';\n${inner}`), /is dated 2018-07-20/)
})

test('legacy transactions: all five legacy rows have a matching canonical event; the legacy table is kept', async () => {
  assert.equal((await one(`select count(*)::int as n from transactions`)).n, 5)
  const matched = await q(`select p.slug, e.event_key from transactions t join players p on p.id = t.player_id join transaction_event_assets a on a.player_id = t.player_id and a.asset_side = 'OUTGOING'
    join transaction_events e on e.id = a.event_id and e.transaction_date = t.transaction_date and e.transaction_type = t.transaction_type order by 1`)
  assert.deepEqual(matched.map((r) => r.slug), ['arnaldo-lantigua', 'oneil-cruz', 'ramon-rosso', 'yordan-alvarez', 'yusniel-diaz'])
  assert.equal((await one(`select count(*)::int as n from v_transaction_event_complete where legacy_transaction_matches`)).n, 5)
  assert.deepEqual((await q(`select issue from v_transaction_research_queue where issue in ('LEGACY_TRANSACTION_WITHOUT_EVENT', 'TRANSACTION_DATE_CONFLICT')`)), [])
  await inTxn(async () => {
    await chain.db.exec(`update transactions set transaction_date = date '2016-07-16' where player_id = (select id from players where slug = 'ramon-rosso')`)
    assert.deepEqual((await q(`select issue, player_slug from v_transaction_research_queue where issue = 'TRANSACTION_DATE_CONFLICT'`)), [{ issue: 'TRANSACTION_DATE_CONFLICT', player_slug: 'ramon-rosso' }])
    assert.ok((await failing()).includes('transaction_legacy_reconciliation_violations'))
  })
})

// ---------------------------------------------------------------------------------------------
// assets and identities
// ---------------------------------------------------------------------------------------------

test('assets: 291 in total (266 PLAYER, 25 non-player: 15 CASH, 6 PLAYER_TO_BE_NAMED, 3 FUTURE_CONSIDERATIONS, 1 INTERNATIONAL_BONUS_POOL_SPACE); the asset-type list is closed', async () => {
  assert.deepEqual(Object.fromEntries((await q(`select asset_type as t, count(*)::int as n from transaction_event_assets group by 1`)).map((r) => [r.t, r.n])),
    { CASH: 15, FUTURE_CONSIDERATIONS: 3, INTERNATIONAL_BONUS_POOL_SPACE: 1, PLAYER: 266, PLAYER_TO_BE_NAMED: 6 })
  assert.equal(seed.events.reduce((n, e) => n + e.assets.length, 0), 291)
  assert.match(await attempt(`insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type) values (${EVENT('LAD_ATL_2024_ELIO_CAMPOS')}, 'INCOMING', 'Draft pick', 'DRAFT_PICK')`), /asset_type_check/)
  assert.match(await attempt(`insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type) values (${EVENT('LAD_ATL_2024_ELIO_CAMPOS')}, 'INCOMING', 'Other', 'OTHER')`), /asset_type_check/)
  assert.match(await attempt(`insert into transaction_events (event_key, transaction_date, transaction_type, description) values ('X', date '2020-01-01', 'SIGNING', 'x')`), /transaction_type_check/)
})

test('stable identities: every PLAYER asset carries a DISI player, MLB id, Baseball-Reference id or Register id; coverage and the exact researched ids', async () => {
  assert.deepEqual(await one(`select count(*) filter (where player_id is not null)::int as player_id, count(*) filter (where mlb_id is not null)::int as mlb,
    count(*) filter (where bref_id is not null)::int as bref, count(*) filter (where bref_register_id is not null)::int as register,
    count(*) filter (where player_id is null and mlb_id is null and bref_id is null and bref_register_id is null)::int as unresolved
    from transaction_event_assets where asset_type = 'PLAYER'`), { player_id: 145, mlb: 257, bref: 150, register: 9, unresolved: 0 })
  assert.equal((await one(`select count(*)::int as n from v_transaction_research_queue where issue = 'EVENT_ASSET_IDENTITY_MISSING'`)).n, 0)
  const ids = Object.fromEntries((await q(`select asset_name, mlb_id from transaction_event_assets where asset_side = 'OUTGOING' and asset_name in
    ('Angel German', 'Breyvic Valera', 'Dean Kremer', 'Rylan Bannon', 'Zach Pop')`)).map((r) => [r.asset_name, r.mlb_id]))
  assert.deepEqual(ids, { 'Angel German': '642549', 'Breyvic Valera': '591971', 'Dean Kremer': '665152', 'Rylan Bannon': '676625', 'Zach Pop': '647315' })
  // the Antonini naming variant resolves to one canonical identity, not a duplicate name
  assert.deepEqual(await q(`select asset_name, mlb_id, bref_id from transaction_event_assets where mlb_id = '502103'`), [{ asset_name: 'Mike Antonini', mlb_id: '502103', bref_id: null }])
  assert.equal((await one(`select count(*)::int as n from transaction_event_assets where asset_name = 'Michael Antonini'`)).n, 0)
  // tracked assets agree with their DISI players
  assert.equal((await one(`select count(*)::int as n from transaction_event_assets a join players p on p.id = a.player_id where a.mlb_id is distinct from p.mlb_id::text`)).n, 0)
})

test('B-Ref id versus Register id: separate namespaces with their own constraints', async () => {
  assert.deepEqual((await q(`select asset_name, bref_register_id from transaction_event_assets where bref_register_id is not null order by 1`)).map((r) => `${r.asset_name}:${r.bref_register_id}`),
    ['Andre Simpson:simpso001and', 'Arnie Gooch:gooch-001arn', 'Brian Stephenson:stephe002bri', 'Carlos Ortega:ortega001car', 'Chad Ricketts:ricket001rob',
      'Jorge Nunez:nunez-001jor', 'Melvin Geho:geho--001mel', 'Orlando Rodriguez:rodrig005orl', 'Rick Clelland:clella001ric'])
  assert.equal((await one(`select count(*)::int as n from transaction_event_assets where bref_register_id is not null and bref_id is not null`)).n, 0)
  const ev = EVENT('LAD_ATL_2024_ELIO_CAMPOS')
  const ins = (cols, vals) => `insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type, ${cols}) values (${ev}, 'INCOMING', 'T', 'PLAYER', ${vals})`
  assert.match(await attempt(ins('bref_id', `'gooch-001arn'`)), /bref_id_check/, 'a Register id never fits bref_id')
  assert.match(await attempt(ins('bref_register_id', `'gonzaad01'`)), /bref_register_id_check/, 'a career id never fits bref_register_id')
  assert.match(await attempt(ins('bref_register_id', `'Gooch-001arn'`)), /bref_register_id_check/)
  assert.equal(await attempt(ins('bref_register_id', `'gooch-001arn'`)), 'accepted')
  assert.match(await attempt(ins('mlb_id', `'abc'`)), /mlb_id_check/)
  // the major-league regex was not relaxed
  assert.match((await one(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'transaction_event_assets_bref_id_check'`)).d, /\^\[a-z0-9\]\+\$/)
})

test('amounts: cash only on CASH, pool space only on INTERNATIONAL_BONUS_POOL_SPACE, unknown stays NULL (never zero)', async () => {
  const ev = EVENT('LAD_ATL_2024_ELIO_CAMPOS')
  const ins = (type, cols, vals) => `insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type, ${cols}) values (${ev}, 'INCOMING', 'T', '${type}', ${vals})`
  assert.match(await attempt(ins('PLAYER', 'cash_amount_usd', '100')), /cash_amount_check/)
  assert.match(await attempt(ins('PLAYER', 'pool_space_amount_usd', '100')), /pool_amount_check/)
  assert.match(await attempt(ins('CASH', 'pool_space_amount_usd', '100')), /pool_amount_check/)
  assert.match(await attempt(ins('INTERNATIONAL_BONUS_POOL_SPACE', 'cash_amount_usd', '100')), /cash_amount_check/)
  assert.match(await attempt(ins('CASH', 'cash_amount_usd', '-1')), /cash_amount_check/)
  assert.match(await attempt(ins('CASH', 'mlb_id', `'1'`)), /mlb_id_check/)
  assert.equal(await attempt(ins('CASH', 'cash_amount_usd', '4000')), 'accepted')
  assert.deepEqual(await q(`select asset_name, cash_amount_usd::text as amount from transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is not null order by 1`),
    [{ asset_name: 'Cash', amount: '75000.00' }, { asset_name: 'Draft price', amount: '4000.00' }])
  assert.deepEqual(await one(`select count(*) filter (where asset_type = 'CASH')::int as cash, count(*) filter (where asset_type = 'CASH' and cash_amount_usd is null)::int as unknown,
    count(*) filter (where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE')::int as pool, count(*) filter (where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null)::int as pool_unknown
    from transaction_event_assets`), { cash: 15, unknown: 13, pool: 1, pool_unknown: 1 })
  assert.deepEqual(await q(`select asset_name from transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE'`), [{ asset_name: 'International signing bonus slot money' }])
})

// ---------------------------------------------------------------------------------------------
// multi-team, placeholders, resolutions
// ---------------------------------------------------------------------------------------------

test('multi-team 2024-07-29: asset-level counterparties, Dodgers-only flows, no White Sox / Cardinals asset rows', async () => {
  const e = await one(`select is_multi_team, transaction_date::text as d from transaction_events where event_key = 'LAD_CWS_2024_JERAL_PEREZ'`)
  assert.deepEqual(e, { is_multi_team: true, d: '2024-07-29' })
  const rows = await q(`select a.asset_side as side, a.asset_type as type, a.asset_name as name, o.abbreviation as cp from transaction_event_assets a
    left join organizations o on o.id = a.counterparty_organization_id where a.event_id = ${EVENT('LAD_CWS_2024_JERAL_PEREZ')} order by 1, 3`)
  assert.deepEqual(rows.map((r) => `${r.side}:${r.name}:${r.cp}`), [
    'INCOMING:Michael Kopech:CWS', 'INCOMING:Oliver Gonzalez:STL', 'INCOMING:Tommy Edman:STL',
    'OUTGOING:Alexander Albertus:CWS', 'OUTGOING:Jeral Perez:CWS', 'OUTGOING:Miguel Vargas:CWS', 'OUTGOING:Player to be named later or cash considerations:CWS'])
  assert.equal(rows.filter((r) => ['Erick Fedde', 'Tommy Pham'].includes(r.name)).length, 0)
  // every other event names a single counterparty on every asset
  assert.equal((await one(`select count(*)::int as n from transaction_events e where not e.is_multi_team and e.transaction_type in ('TRADE', 'RULE5_SELECTION', 'EXPANSION_DRAFT')
    and (select count(distinct a.counterparty_organization_id) from transaction_event_assets a where a.event_id = e.id) <> 1`)).n, 0)
  // Edman's acquisition boundary is ordered against St. Louis (asset-level), not Chicago: his same-season stints cannot be ordered
  const ed = await edge('LAD_CWS_2024_JERAL_PEREZ', 'Tommy Edman')
  assert.deepEqual([ed.counterparty_franchise_key, ed.return_state], ['STL', 'TIMING_UNRESOLVED'])
  assert.equal((await edge('LAD_CWS_2024_JERAL_PEREZ', 'Michael Kopech')).counterparty_franchise_key, 'CWS')
})

test('placeholders and resolutions: six placeholder assets are preserved; four are resolved beside them; Frias and the 2024 PTBNL-or-cash stay unresolved', async () => {
  const ph = await q(`select e.event_key, a.asset_name, a.asset_side, r.resolution_date::text as d, rs.asset_name as resolved
    from transaction_event_assets a join transaction_events e on e.id = a.event_id left join transaction_asset_resolutions r on r.placeholder_asset_id = a.id
    left join transaction_event_assets rs on rs.id = r.resolved_asset_id where a.asset_type = 'PLAYER_TO_BE_NAMED' order by 1, 2`)
  assert.deepEqual(ph.map((r) => `${r.event_key}|${r.asset_name}|${r.resolved ?? 'UNRESOLVED'}`), [
    'BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD|Player to be named later #1|Rubby De La Rosa',
    'BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD|Player to be named later #2|Jerry Sands',
    'BRO_PHI_1957_FERNANDEZ|Player to be named later|Ben Flowers',
    'LAD_CHC_1999_VALDEZ|Player to be named later|Brian Stephenson',
    'LAD_CLE_2017_CARLOS_FRIAS|Player to be named later|UNRESOLVED',
    'LAD_CWS_2024_JERAL_PEREZ|Player to be named later or cash considerations|UNRESOLVED'])
  assert.equal((await one(`select count(*)::int as n from transaction_asset_resolutions`)).n, 4)
  assert.deepEqual((await q(`select e.event_key from v_transaction_research_queue e where issue = 'PTBNL_UNRESOLVED' order by 1`)).map((r) => r.event_key), ['LAD_CLE_2017_CARLOS_FRIAS', 'LAD_CWS_2024_JERAL_PEREZ'])
  assert.deepEqual((await q(`select event_key from v_transaction_research_queue where issue = 'FUTURE_CONSIDERATIONS_UNRESOLVED' order by 1`)).map((r) => r.event_key),
    ['LAD_CIN_2025_ARNALDO_LANTIGUA', 'LAD_CWS_2023_MAXIMO_MARTINEZ', 'LAD_STL_2019_TONY_CINGRANI'])
  // the placeholder asset itself was not rewritten (its name carries no resolved name)
  assert.equal((await one(`select count(*)::int as n from transaction_event_assets where asset_type = 'PLAYER_TO_BE_NAMED' and (asset_name ~* 'rosa|sands|flowers|stephenson')`)).n, 0)
})

test('resolution integrity: sealed, append-only, no self-resolution, no incompatible or duplicate resolutions; retraction is the only change', async () => {
  await inTxn(async () => {
    const frias = ASSET('LAD_CLE_2017_CARLOS_FRIAS', 'INCOMING', 'Player to be named later')
    const src = `(select id from sources limit 1)`
    const ins = (resolved, extra = '') => `insert into transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence${extra ? ', ' + extra.split('=')[0] : ''})
      values (${frias}, ${resolved}, 'NAMED_PLAYER', date '2017-02-01', ${src}, 'HIGH'${extra ? ', ' + extra.split('=')[1] : ''})`
    assert.match(await attempt(ins(frias)), /resolve to itself|self_check/)
    assert.match(await attempt(ins(ASSET('LAD_CLE_2017_CARLOS_FRIAS', 'OUTGOING', 'Carlos Frias'))), /same event and side/)
    assert.match(await attempt(ins(ASSET('LAD_ATL_2024_ELIO_CAMPOS', 'INCOMING', 'Cash'))), /same event and side/)
    assert.match(await attempt(`insert into transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence)
      values (${ASSET('LAD_ATL_2024_ELIO_CAMPOS', 'INCOMING', 'Cash')}, null, 'CASH_SETTLEMENT', date '2024-06-02', ${src}, 'HIGH')`), /only a player to be named later or future considerations/)
    // a resolution cannot predate the trade
    await chain.db.exec(`insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id, counterparty_organization_id)
      select e.id, 'INCOMING', 'Named Player', 'PLAYER', '999001', e.to_organization_id from transaction_events e where e.event_key = 'LAD_CLE_2017_CARLOS_FRIAS'`)
    const named = ASSET('LAD_CLE_2017_CARLOS_FRIAS', 'INCOMING', 'Named Player')
    assert.match(await attempt(`insert into transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence)
      values (${frias}, ${named}, 'NAMED_PLAYER', date '2017-01-01', ${src}, 'HIGH')`), /predate/)
    // a named-player resolution must name a player, a cash settlement must not
    assert.match(await attempt(`insert into transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence)
      values (${frias}, null, 'NAMED_PLAYER', date '2017-02-01', ${src}, 'HIGH')`), /shape_check/)
    // a correct resolution is accepted once; a contradictory second ACTIVE one is refused
    await chain.db.exec(`insert into transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence)
      values (${frias}, ${named}, 'NAMED_PLAYER', date '2017-02-01', ${src}, 'HIGH')`)
    assert.match(await attempt(`insert into transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence)
      values (${frias}, null, 'CASH_SETTLEMENT', date '2017-02-02', ${src}, 'HIGH')`), /already has an ACTIVE resolution|active_placeholder_key|duplicate/)
    // sealed: no edit, no delete; retraction is allowed, after which a correction can be inserted
    assert.match(await attempt(`update transaction_asset_resolutions set resolution_date = date '2017-03-01' where placeholder_asset_id = ${frias}`), /sealed/)
    assert.match(await attempt(`delete from transaction_asset_resolutions where placeholder_asset_id = ${frias}`), /never deleted/)
    assert.equal(await attempt(`update transaction_asset_resolutions set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test' where placeholder_asset_id = ${frias}`), 'accepted')
    await chain.db.exec(`update transaction_asset_resolutions set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test' where placeholder_asset_id = ${frias}`)
    assert.match(await attempt(`update transaction_asset_resolutions set record_status = 'ACTIVE', retracted_at = null, retraction_reason = null where placeholder_asset_id = ${frias}`), /sealed/)
    assert.equal(await attempt(`insert into transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence)
      values (${frias}, null, 'CASH_SETTLEMENT', date '2017-02-02', ${src}, 'HIGH')`), 'accepted')
    // the fixture's named player has an MLB id but neither loaded WAR nor an observed zero: the identity check correctly flags only that
    assert.deepEqual(await failing(), ['transaction_asset_identity_consistency_violations'])
  })
  // the seeded resolutions are sealed too
  assert.match(await attempt(`delete from transaction_asset_resolutions`), /never deleted/)
  assert.match(await attempt(`update transaction_asset_resolutions set notes = 'x'`), /sealed/)
})

// ---------------------------------------------------------------------------------------------
// trade-return states, observed zero, timing
// ---------------------------------------------------------------------------------------------

test('return states: cash-only and no-player returns are explicit; Abreu is unrecorded and Frias pending, never zero', async () => {
  const leonard = await edge('LAD_DET_2023_EDDYS_LEONARD')
  assert.deepEqual([leonard.return_state, num(leonard.incoming_dodgers_bwar), leonard.individual_attribution_permitted], ['NO_PLAYER_RETURN', 0, true])
  const campos = await edge('LAD_ATL_2024_ELIO_CAMPOS')
  assert.deepEqual([campos.return_state, num(campos.incoming_dodgers_bwar)], ['NO_PLAYER_RETURN', 0])
  const batista = await edge('LAD_CWS_2023_MAXIMO_MARTINEZ')
  assert.deepEqual([batista.return_state, num(batista.incoming_dodgers_bwar), batista.individual_attribution_permitted, batista.attribution_status], ['NO_PLAYER_RETURN', 0, false, 'SHARED_PACKAGE_RETURN'])
  const lantigua = await edge('LAD_CIN_2025_ARNALDO_LANTIGUA')
  assert.deepEqual([lantigua.return_state, num(lantigua.incoming_dodgers_bwar)], ['NO_PLAYER_RETURN', 0])
  const abreu = await edge('LAD_ARI_2009_TONY_ABREU')
  assert.deepEqual([abreu.return_state, abreu.incoming_dodgers_bwar], ['RETURN_UNRECORDED', null])
  const frias = await edge('LAD_CLE_2017_CARLOS_FRIAS')
  assert.deepEqual([frias.return_state, frias.incoming_dodgers_bwar], ['PLAYER_RETURN_PENDING', null])
  // "no player return" means no player came back; it is not a statement about total transaction value
  const leo = await one(`select package_attribution_state as s, individually_attributable_trade_return_bwar::text as r, attributable_organizational_bwar::text as a from v_player_organizational_realization where player_slug = 'eddys-leonard'`)
  assert.deepEqual(leo, { s: 'SOLE_OUTGOING_ATTRIBUTABLE', r: '0', a: '0' })
  assert.deepEqual((await q(`select player_slug, package_attribution_state as s from v_player_organizational_realization where player_slug in ('carlos-frias', 'tony-abreu')`)).map((r) => r.s), ['RETURN_WAR_UNKNOWN', 'RETURN_WAR_UNKNOWN'])
  assert.deepEqual(Object.fromEntries((await q(`select return_state as s, count(*)::int as n from v_trade_realization_edges group by 1`)).map((r) => [r.s, r.n])),
    { LOADED: 40, NO_MLB_APPEARANCE_OBSERVED: 13, NO_PLAYER_RETURN: 4, PLAYER_RETURN_PENDING: 1, RETURN_UNRECORDED: 1, TIMING_UNRESOLVED: 3 })
})

test('observed zero: no-MLB-appearance observations carry an observation boundary; zero is valid only through it, never for missing evidence', async () => {
  const obs = await q(`select a.asset_name, o.observed_through_date::text as d, o.confidence::text as c from dodgers_control_observations o join transaction_event_assets a on a.id = o.subject_asset_id
    where o.observation_type = 'NO_MLB_APPEARANCE_OBSERVED' and a.mlb_id is not null order by 1`)
  assert.deepEqual(obs.map((r) => r.asset_name), ['Jose Vasquez', 'Mike Antonini', 'Moises Brito', 'Noah Miller', 'Oliver Gonzalez'])
  assert.ok(obs.every((r) => r.d === '2026-10-11' && r.c === 'VERIFIED'))
  assert.deepEqual((await q(`select a.mlb_id from dodgers_control_observations o join transaction_event_assets a on a.id = o.subject_asset_id where o.observation_type = 'NO_MLB_APPEARANCE_OBSERVED' and a.asset_name in ('Jose Vasquez', 'Noah Miller', 'Moises Brito', 'Oliver Gonzalez') order by 1`)).map((r) => r.mlb_id),
    ['695653', '804975', '807833', '823860'])
  for (const [key, name] of [['LAD_MIN_2025_DIEGO_CARTAYA', 'Jose Vasquez'], ['LAD_MIN_2024_RAYNE_DONCON', 'Noah Miller'], ['LAD_TOR_2022_ALEX_DE_JESUS', 'Moises Brito'], ['LAD_CWS_2024_JERAL_PEREZ', 'Oliver Gonzalez']]) {
    const e = await edge(key, name)
    assert.deepEqual([e.return_state, num(e.incoming_dodgers_bwar), e.no_mlb_appearance_observed_through?.toISOString?.().slice(0, 10) ?? String(e.no_mlb_appearance_observed_through)], ['NO_MLB_APPEARANCE_OBSERVED', 0, '2026-10-11'], name)
  }
  // an identity with no observation and no loaded facts is unknown, not zero
  await inTxn(async () => {
    await chain.db.exec(`insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id) values (${EVENT('LAD_ATL_2024_ELIO_CAMPOS')}, 'INCOMING', 'Unobserved Prospect', 'PLAYER', '999999')`)
    const e = await edge('LAD_ATL_2024_ELIO_CAMPOS', 'Unobserved Prospect')
    assert.deepEqual([e.return_state, e.incoming_dodgers_bwar], ['RETURN_WAR_UNKNOWN', null])
    // a player with loaded MLB team-seasons cannot carry a no-MLB-appearance observation
    await chain.db.exec(`insert into dodgers_control_observations (subject_asset_id, observation_type, observed_through_date, source_id, confidence)
      select ${ASSET('LAD_HOU_2016_ALVAREZ_FIELDS', 'INCOMING', 'Josh Fields')}, 'NO_MLB_APPEARANCE_OBSERVED', date '2026-10-11', id, 'LOW' from sources limit 1`)
    assert.ok((await failing()).includes('transaction_observation_violations'))
  })
})

test('trade-return timing reuses the 032 rule: Valo, Edman and McDermott stay unresolved and queued; nothing is invented', async () => {
  assert.deepEqual((await q(`select event_key, incoming_asset_name from v_trade_realization_edges where return_state = 'TIMING_UNRESOLVED' order by 1`)).map((r) => `${r.event_key}:${r.incoming_asset_name}`),
    ['BRO_PHI_1957_FERNANDEZ:Elmer Valo', 'LAD_BAL_2026_AXEL_PEREZ:Chayce McDermott', 'LAD_CWS_2024_JERAL_PEREZ:Tommy Edman'])
  assert.equal((await q(`select 1 from v_transaction_research_queue where issue = 'TRADE_RETURN_TIMING_UNRESOLVED'`)).length, 3)
  assert.equal((await q(`select 1 from v_value_research_queue where issue = 'TRADE_RETURN_TIMING_UNRESOLVED'`)).length, 3)
  assert.deepEqual(Object.fromEntries((await q(`select acquisition_timing_status as s, count(*)::int as n from v_trade_realization_edges where incoming_asset_id is not null and return_state <> 'NO_MLB_APPEARANCE_OBSERVED' group by 1`)).map((r) => [r.s, r.n])),
    { NO_ACQUISITION_SEASON_DODGERS_STINT: 7, OFFSEASON_AFTER_SEASON: 12, OFFSEASON_BEFORE_SEASON: 1, RESOLVED_BY_COUNTERPARTY_STINT_ORDER: 20, UNRESOLVED_SAME_SEASON_STINT_ORDER: 3 })
  for (const e of await q(`select incoming_asset_name, incoming_dodgers_bwar from v_trade_realization_edges where return_state = 'TIMING_UNRESOLVED'`)) assert.equal(e.incoming_dodgers_bwar, null)
})

// ---------------------------------------------------------------------------------------------
// return-player WAR
// ---------------------------------------------------------------------------------------------

test('return-player WAR: 40 persons / 573 rows (406 BAT, 167 PITCH), reproducible from the committed seed; four new team codes; no fWAR', async () => {
  assert.equal(war.source_files.bat.sha256, config.files.bat.sha256)
  assert.equal(audit.war_seed.parsed_rows_sha256, war.parsed_rows_sha256)
  assert.equal(crypto.createHash('sha256').update(JSON.stringify({ war_system: 'BWAR', rows: war.rows })).digest('hex'), war.parsed_rows_sha256)
  assert.deepEqual([war.row_count, war.components.BAT, war.components.PITCH, war.scope.persons], [573, 406, 167, 40])
  assert.deepEqual(await one(`select count(*)::int as n, count(distinct bref_id)::int as persons from player_mlb_team_season_war where bref_id = any($1)`, [war.scope.bref_ids]), { n: 573, persons: 40 })
  assert.deepEqual(await one(`select count(*)::int as n, count(distinct bref_id)::int as persons from player_mlb_team_season_war`), { n: 1327, persons: 90 })
  assert.equal((await one(`select count(*)::int as n from player_mlb_team_season_war where war_system <> 'BWAR' or organization_id is null`)).n, 0)
  assert.deepEqual((await q(`select m.bref_team_code, o.abbreviation, m.from_season, m.to_season from bref_team_code_map m join organizations o on o.id = m.organization_id
    where m.bref_team_code in ('NYG', 'PHA', 'KCA', 'WSH') order by 1`)).map((r) => `${r.bref_team_code}:${r.abbreviation}:${r.from_season}-${r.to_season}`),
    ['KCA:OAK:1955-1967', 'NYG:SFG:1883-1957', 'PHA:OAK:1901-1954', 'WSH:MIN:1901-1960'])
  assert.equal((await one(`select count(*)::int as n from bref_team_code_map`)).n, 40)
  // the 032 rows are unchanged
  const rows032 = await one(`select count(*)::int as n from player_mlb_team_season_war where bref_id <> all($1)`, [war.scope.bref_ids])
  assert.equal(rows032.n, 754)
  assert.equal(pre.war, md5(await q(`select bref_id, season, bref_team_code, stint_ordinal, component, war::text from player_mlb_team_season_war where bref_id <> all($1) order by 1, 2, 3, 4, 5`, [war.scope.bref_ids])))
})

// ---------------------------------------------------------------------------------------------
// chain readiness, queue, analytics
// ---------------------------------------------------------------------------------------------

test('chain readiness: one row per incoming PLAYER asset of a tracked trade, factual statuses only, no downstream value column', async () => {
  const dist = Object.fromEntries((await q(`select chain_readiness_status as s, count(*)::int as n from v_transaction_asset_chain_readiness group by 1`)).map((r) => [r.s, r.n]))
  assert.deepEqual(dist, { CAREER_ENDED_WITH_DODGERS: 4, EXIT_EVENT_RECORDED: 24, EXIT_NOT_RESEARCHED: 22, HISTORY_INCOMPLETE: 2, STILL_WITH_DODGERS: 5 })
  assert.equal((await one(`select count(*)::int as n from v_transaction_asset_chain_readiness`)).n, 57)
  const cols = (await q(`select column_name from information_schema.columns where table_name = 'v_transaction_asset_chain_readiness'`)).map((r) => r.column_name)
  assert.ok(!cols.some((c) => /bwar|war_per|organizational|second|recursive|value/.test(c.replace('dodgers_war_exists', ''))), 'no value is calculated')
  // a later exit is matched by stable identity, not by name
  assert.deepEqual(await one(`select later_exit_type as t, later_exit_date::text as d from v_transaction_asset_chain_readiness where asset_name = 'Josiah Gray'`), { t: 'TRADE', d: '2021-07-30' })
  assert.deepEqual((await q(`select asset_name, chain_readiness_status as s from v_transaction_asset_chain_readiness where asset_name in ('Nick Punto', 'Homer Bailey', 'Tommy Edman') order by 1`)),
    [{ asset_name: 'Homer Bailey', s: 'HISTORY_INCOMPLETE' }, { asset_name: 'Nick Punto', s: 'HISTORY_INCOMPLETE' }, { asset_name: 'Tommy Edman', s: 'STILL_WITH_DODGERS' }])
})

test('research queue: the transaction deficiencies are derived and match the facts', async () => {
  assert.deepEqual(Object.fromEntries((await q(`select issue, count(*)::int as n from v_transaction_research_queue group by 1`)).map((r) => [r.issue, r.n])), {
    CASH_AMOUNT_UNKNOWN: 13, EXIT_STATUS_UNVERIFIED: 16, EXIT_TRANSACTION_MISSING: 2, FUTURE_CONSIDERATIONS_UNRESOLVED: 3, POOL_SPACE_AMOUNT_UNKNOWN: 1,
    PTBNL_UNRESOLVED: 2, RETURN_ASSET_EXIT_MISSING: 15, TRADE_RETURN_TIMING_UNRESOLVED: 3, TRADE_RETURN_UNRECORDED: 1 })
  assert.equal((await one(`select count(*)::int as n from v_transaction_research_queue where issue = 'TRANSACTION_DATE_CONFLICT'`)).n, 0)
  // never-MLB minor leaguers are not queued as return assets with missing exits
  assert.equal((await one(`select count(*)::int as n from v_transaction_research_queue where issue = 'RETURN_ASSET_EXIT_MISSING' and asset_name in ('Melvin Geho', 'Rick Clelland', 'Mike Antonini')`)).n, 0)
})

test('event completeness view: one row per event with Dodgers side, counterparties, package and identity completeness', async () => {
  assert.equal((await one(`select count(*)::int as n from v_transaction_event_complete`)).n, 161)
  assert.deepEqual(Object.fromEntries((await q(`select package_completeness as s, count(*)::int as n from v_transaction_event_complete group by 1`)).map((r) => [r.s, r.n])),
    { COMPLETE: 154, NO_PLAYER_RETURN: 5, RETURN_PENDING_PLACEHOLDER: 1, RETURN_UNRECORDED: 1 })
  assert.equal((await one(`select count(*)::int as n from v_transaction_event_complete where identity_completeness <> 'COMPLETE'`)).n, 0)
  const m = await one(`select counterparties, dodgers_organization, is_multi_team, outgoing_asset_count as o, incoming_asset_count as i, tracked_outgoing_count as t, unresolved_ptbnl_count as p
    from v_transaction_event_complete where event_key = 'LAD_CWS_2024_JERAL_PEREZ'`)
  assert.deepEqual(m, { counterparties: 'CWS, STL', dodgers_organization: 'LAD', is_multi_team: true, o: 4, i: 3, t: 3, p: 1 })
  assert.equal((await one(`select dodgers_organization from v_transaction_event_complete where event_key = 'BRO_PHI_1957_FERNANDEZ'`)).dodgers_organization, 'BRO')
})

test('032 metrics: direct and non-Dodgers bWAR are unchanged for every player; 032-modeled attribution is unchanged; new trade facts change only trade-return columns', async () => {
  const now = await q(`select player_slug, direct_dodgers_mlb_bwar::text as direct, non_dodgers_mlb_bwar::text as non_dodgers, team_season_career_bwar::text as career,
    package_attribution_state as state, trade_package_return_dodgers_bwar::text as package_return from v_player_organizational_realization order by 1`)
  assert.equal(now.length, pre.realization.length)
  for (let i = 0; i < now.length; i++) {
    assert.deepEqual([now[i].player_slug, now[i].direct, now[i].non_dodgers, now[i].career], [pre.realization[i].player_slug, pre.realization[i].direct, pre.realization[i].non_dodgers, pre.realization[i].career])
  }
  // the three events 032 modeled keep their attribution and package return
  const by = Object.fromEntries(now.map((r) => [r.player_slug, r]))
  assert.deepEqual([by['yordan-alvarez'].state, by['yordan-alvarez'].package_return], ['SOLE_OUTGOING_ATTRIBUTABLE', '1.94'])
  assert.deepEqual([by['oneil-cruz'].state, by['oneil-cruz'].package_return], ['SHARED_PACKAGE_NOT_ATTRIBUTABLE', '0.40'])
  assert.deepEqual([by['yusniel-diaz'].state, by['yusniel-diaz'].package_return], ['SHARED_PACKAGE_NOT_ATTRIBUTABLE', '2.58'])
  // sole vs shared package semantics: a shared package never produces an individual share
  assert.equal((await one(`select count(*)::int as n from v_player_organizational_realization where package_attribution_state = 'SHARED_PACKAGE_NOT_ATTRIBUTABLE' and individually_attributable_trade_return_bwar is not null`)).n, 0)
  // the one new individually attributed negative return: Rincon
  assert.deepEqual(await one(`select individually_attributable_trade_return_bwar::text as r, attributable_organizational_bwar::text as a from v_player_organizational_realization where player_slug = 'carlos-rincon'`), { r: '-0.35', a: '-0.35' })
  // the portfolio moves only because of newly modeled facts
  const p = await one(`select eligible_direct_dodgers_bwar::text as direct, aggregate_direct_dodgers_bwar_per_million::text as direct_pm, eligible_attributable_organizational_bwar::text as attr,
    aggregate_attributable_organizational_bwar_per_million::text as attr_pm, attributable_ratio_eligible_signings as n from v_dodgers_international_value_portfolio where grain = 'ALL'`)
  assert.deepEqual(p, { direct: '96.60', direct_pm: '0.977', attr: '98.19', attr_pm: '0.993', n: 26 })
  assert.equal(audit.baseline_032.portfolio_all.aggregate_attributable_organizational_bwar_per_million, '0.997')
})

test('downstream chain: more tracked players are flagged because return assets now have recorded exits; no downstream value is credited', async () => {
  assert.equal((await one(`select count(*)::int as n from v_player_organizational_realization where downstream_asset_chain_incomplete`)).n, 20)
  assert.equal((await q(`select 1 from v_value_research_queue where issue = 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE'`)).length, 20)
  // a flagged player's attributable value is unchanged by the flag
  const r = await one(`select direct_dodgers_mlb_bwar::text as d, attributable_organizational_bwar::text as a, downstream_asset_chain_incomplete as f from v_player_organizational_realization where player_slug = 'yasiel-puig'`)
  assert.deepEqual(r, { d: '17.80', a: '17.80', f: true })
})

// ---------------------------------------------------------------------------------------------
// security, verifier
// ---------------------------------------------------------------------------------------------

test('convergence: a fresh 001-033 replay equals the 001-032 database with 033 applied (rows, definitions, grants)', async () => {
  const fresh = await buildChainThrough('033_transaction_asset_chain_completion.sql')
  try {
    const hashesOf = async (query) => {
      const tables = (await query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
      const out = {}
      for (const t of tables) out[t] = md5((await query(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
      return out
    }
    const strip = (rows) => rows.map((r) => ({ ...r }))
    const defs = (query) => query(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`)
    const acl = (query) => query(`select c.relname, coalesce(array_to_string(c.relacl, ','), '') as acl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') order by 1`)
    const funcs = (query) => query(`select p.proname, md5(pg_get_functiondef(p.oid)) as def, coalesce(p.proacl::text, '') as acl from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)
    // generated ids and timestamps differ between two replays, so rows are compared on their stable business columns
    const business = async (query) => ({
      events: await query(`select event_key, transaction_date::text as d, transaction_type, is_multi_team, historical_label, description from transaction_events order by 1`),
      assets: await query(`select e.event_key, a.asset_side, a.asset_name, a.asset_type, a.mlb_id, a.bref_id, a.bref_register_id, a.cash_amount_usd::text as cash, a.pool_space_amount_usd::text as pool,
        (select abbreviation from organizations o where o.id = a.counterparty_organization_id) as cp, a.player_id is not null as tracked from transaction_event_assets a join transaction_events e on e.id = a.event_id order by 1, 2, 3`),
      resolutions: await query(`select e.event_key, ph.asset_name as ph, rs.asset_name as rs, r.resolution_date::text as d, r.resolution_type from transaction_asset_resolutions r
        join transaction_event_assets ph on ph.id = r.placeholder_asset_id join transaction_events e on e.id = ph.event_id left join transaction_event_assets rs on rs.id = r.resolved_asset_id order by 1, 2`),
      observations: await query(`select o.observation_type, o.observed_through_date::text as d, a.asset_name, p.slug from dodgers_control_observations o
        left join transaction_event_assets a on a.id = o.subject_asset_id left join players p on p.id = o.subject_player_id order by 1, 3, 4, 2`),
      war: await query(`select bref_id, season, bref_team_code, stint_ordinal, component, war::text as war from player_mlb_team_season_war order by 1, 2, 3, 4, 5`),
      realization: await query(`select player_slug, direct_dodgers_mlb_bwar::text as d, attributable_organizational_bwar::text as a, package_attribution_state as s from v_player_organizational_realization order by 1`),
    })
    assert.deepEqual(await business(fresh.query), await business(q))
    assert.deepEqual(strip(await defs(fresh.query)), strip(await defs(q)))
    assert.deepEqual(await acl(fresh.query), await acl(q))
    assert.deepEqual(await funcs(fresh.query), await funcs(q))
    const a = await hashesOf(fresh.query)
    const b = await hashesOf(q)
    for (const t of ['transaction_events', 'transaction_event_assets', 'transaction_asset_resolutions', 'dodgers_control_observations']) assert.ok(t in a && t in b)
  } finally {
    await fresh.close()
  }
})

test('security: RLS and SELECT-only grants, invoker views, invoker-rights guards with no API EXECUTE, no write policy', async () => {
  const acl = await q(`select c.relname, c.relkind::text as kind, c.relrowsecurity as rls, coalesce(array_to_string(c.reloptions, ','), '') as opts,
      coalesce(r.rolname, case when a.grantee = 0 then 'PUBLIC' end) as grantee, a.privilege_type as privilege
    from pg_class c left join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a on true left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relname = any($1)`, [[...NEW_TABLES, ...NEW_VIEWS, 'v_trade_realization_edges', 'v_player_organizational_realization']])
  assert.ok(acl.filter((a) => a.kind === 'r').every((a) => a.rls === true))
  assert.ok(acl.filter((a) => a.kind === 'v').every((a) => /security_invoker=(true|on)/.test(a.opts)))
  assert.ok(acl.filter((a) => ['anon', 'authenticated'].includes(a.grantee)).every((a) => a.privilege === 'SELECT'))
  assert.deepEqual(acl.filter((a) => a.grantee === 'PUBLIC'), [])
  const policies = await q(`select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1)`, [NEW_TABLES])
  assert.equal(policies.length, 2)
  assert.ok(policies.every((p) => p.cmd === 'SELECT'))
  const fns = await q(`select p.proname, p.prosecdef as secdef, coalesce(array_to_string(p.proconfig, ','), '') as cfg, has_function_privilege('anon', p.oid, 'EXECUTE') as a,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as b, has_function_privilege('public', p.oid, 'EXECUTE') as c
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('disi_asset_resolution_guard', 'disi_control_observation_guard') order by 1`)
  assert.equal(fns.length, 2)
  for (const f of fns) assert.deepEqual([f.secdef, f.a, f.b, f.c, /search_path/.test(f.cfg)], [false, false, false, false, true], f.proname)
  assert.deepEqual((await q(`select tgname from pg_trigger where not tgisinternal and tgrelid = any(array['public.transaction_asset_resolutions'::regclass, 'public.dodgers_control_observations'::regclass]) order by 1`)).map((r) => r.tgname),
    ['dodgers_control_observations_guard', 'transaction_asset_resolutions_guard'])
  // no whole-schema regression: nothing in public holds more than SELECT for the API roles
  const beyond = await q(`select c.relname from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a left join pg_roles r on r.oid = a.grantee
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') and (r.rolname in ('anon', 'authenticated') or a.grantee = 0) and a.privilege_type <> 'SELECT'`)
  assert.deepEqual(beyond, [])
})

test('observation guard: sealed facts, asset observations only on PLAYER assets, type and subject agree', async () => {
  await inTxn(async () => {
    const src = `(select id from sources limit 1)`
    assert.match(await attempt(`insert into dodgers_control_observations (subject_asset_id, observation_type, observed_through_date, source_id, confidence)
      values (${ASSET('LAD_ATL_2024_ELIO_CAMPOS', 'INCOMING', 'Cash')}, 'NO_MLB_APPEARANCE_OBSERVED', date '2026-10-11', ${src}, 'HIGH')`), /PLAYER asset|asset observation/)
    assert.match(await attempt(`insert into dodgers_control_observations (subject_player_id, observation_type, observed_through_date, source_id, confidence)
      select id, 'NO_MLB_APPEARANCE_OBSERVED', date '2026-10-11', ${src}, 'HIGH' from players limit 1`), /type_check/)
    assert.match(await attempt(`insert into dodgers_control_observations (observation_type, observed_through_date, source_id, confidence) values ('DODGERS_CONTROL_OBSERVED', date '2026-10-11', ${src}, 'HIGH')`), /subject_check/)
    assert.match(await attempt(`update dodgers_control_observations set note = 'x'`), /sealed/)
    assert.match(await attempt(`delete from dodgers_control_observations`), /never deleted/)
  })
})

test('verifier: the 11 transaction checks pass on the canonical state and the data-level ones catch their own drift; the full verifier passes with 178 checks (160 through 033 plus 18 for 034)', async () => {
  assert.deepEqual(await failing(), [])
  const full = await checkInvariants(q, EXPECT033)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 248, '160 through 033 plus the eighteen 034, eight 035, eight 036, seven 037, six 038, five 039, five 040 and seven 041 checks, which pass trivially without their tables')
  assert.equal(TRANSACTION_CHECK_NAMES.length, 11)
  const drifts = {
    transaction_asset_shape_violations: `alter table transaction_event_assets drop constraint transaction_event_assets_mlb_id_check;
      update transaction_event_assets set mlb_id = 'x' where asset_name = 'Cash' and mlb_id is null;`,
    transaction_bref_register_semantics_violations: `alter table transaction_event_assets drop constraint transaction_event_assets_bref_id_check;
      update transaction_event_assets set bref_id = 'aaaaaa001bbb' where asset_name = 'Ben Flowers';`,
    transaction_event_shape_violations: `update transaction_events set is_multi_team = true where event_key = 'LAD_ATL_2024_ELIO_CAMPOS';`,
    transaction_legacy_reconciliation_violations: `update transactions set transaction_date = date '2000-01-01' where player_id = (select id from players where slug = 'ramon-rosso');`,
    transaction_multi_team_counterparty_violations: `update transaction_event_assets set counterparty_organization_id = null where asset_name = 'Elio Campos';`,
    transaction_asset_identity_consistency_violations: `update transaction_event_assets set mlb_id = '1' where asset_name = 'Yordan Alvarez';`,
    transaction_observation_violations: `alter table dodgers_control_observations disable trigger dodgers_control_observations_guard;
      update dodgers_control_observations set observed_through_date = observed_through_date where false;
      insert into dodgers_control_observations (subject_player_id, observation_type, observed_through_date, source_id, confidence)
        select p.id, 'DODGERS_CONTROL_OBSERVED', date '2026-10-11', (select id from sources limit 1), 'HIGH' from players p where p.slug = 'ramon-rosso';`,
    transaction_placeholder_resolution_violations: `alter table transaction_asset_resolutions disable trigger transaction_asset_resolutions_guard;
      update transaction_asset_resolutions set resolution_date = date '1900-01-01' where id = (select id from transaction_asset_resolutions limit 1);`,
  }
  for (const [name, drift] of Object.entries(drifts)) {
    await inTxn(async () => {
      await chain.db.exec(drift)
      assert.ok((await failing()).includes(name), `${name} fires`)
    })
  }
  assert.deepEqual(await failing(), [])
})

test('identity verifier: a relevant incoming player needs resolved WAR or an observed zero; inconsistent identity and wrong zero are caught; the 028 date check is state aware', async () => {
  const loaded = `(select a.id from transaction_event_assets a join transaction_events e on e.id = a.event_id
    where a.asset_type = 'PLAYER' and a.asset_side = 'INCOMING' and a.bref_id is not null and a.player_id is null and e.transaction_type = 'TRADE'
      and exists (select 1 from transaction_event_assets t where t.event_id = e.id and t.asset_side = 'OUTGOING' and t.player_id is not null)
      and exists (select 1 from player_mlb_team_season_war w where w.bref_id = a.bref_id and w.record_status = 'ACTIVE') order by a.id limit 1)`
  const drifts = {
    'resolved B-Ref identity without loaded WAR or observed zero': [['transaction_asset_identity_consistency_violations'],
      `update transaction_event_assets set bref_id = 'nowarloaded' where id = ${loaded};`],
    'unresolved identity where realization needs one': [['transaction_asset_identity_consistency_violations'],
      `update transaction_event_assets set mlb_id = null, bref_id = null, bref_register_id = null where id = ${loaded};`],
    'inappropriate zero for an identity with loaded WAR': [['transaction_observation_violations'],
      `alter table dodgers_control_observations disable trigger dodgers_control_observations_guard;
       insert into dodgers_control_observations (subject_asset_id, observation_type, observed_through_date, source_id, confidence)
         values (${loaded}, 'NO_MLB_APPEARANCE_OBSERVED', date '2026-10-11', (select id from sources limit 1), 'HIGH');`],
    'inconsistent identity (one MLB id, two B-Ref ids)': [['transaction_asset_identity_consistency_violations'],
      `update transaction_event_assets set mlb_id = (select mlb_id from transaction_event_assets where id = ${loaded}), bref_id = 'otheridxx'
         where id = (select id from transaction_event_assets where mlb_id is not null and id <> ${loaded} and asset_type = 'PLAYER' limit 1);`],
  }
  for (const [label, [names, drift]] of Object.entries(drifts)) {
    await inTxn(async () => {
      await chain.db.exec(drift)
      const failed = await failing()
      for (const n of names) assert.ok(failed.includes(n), `${label}: ${n} fires`)
    })
  }
  // post-033 the corrected date is required; drifting back to the press-release date fails the verifier
  await inTxn(async () => {
    await chain.db.exec(`update transactions set transaction_date = date '2018-07-19' where player_id = (select id from players where slug = 'yusniel-diaz') and transaction_type = 'TRADE';`)
    assert.ok(failedChecks(await checkInvariants(q, EXPECT033)).some((c) => c.name === 'reconciliation_trade_wording_violations'))
  })
  assert.deepEqual(failedChecks(await checkInvariants(q, EXPECT033)), [])
})
