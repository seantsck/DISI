// Migration 049: the reviewed transaction-package research batch. The 048 database is built (001-048), 049 is applied for real, and the tests prove
// that it adds research DATA only (no object, grant or policy changes), that a verified transaction is recorded although the Baseball-Reference WAR of
// what came back is not loaded (the return then reads RETURN_WAR_UNKNOWN, NULL and never zero), that the Abreu trade is corrected forward without
// losing the date DISI stored before, that no unknown became a zero, a cash amount, an exit or an attribution, that the snapshots move to one coherent
// generation with zero drift, and that it is idempotent, guarded, reproducible and reversible.
//   KNOWN TRANSACTION != KNOWN RETURN VALUE   KNOWN PACKAGE != INDIVIDUALLY ATTRIBUTABLE VALUE   MISSING BWAR != ZERO BWAR
//   CASH AMOUNT UNKNOWN != CASH AMOUNT ZERO   PTBNL UNRESOLVED != NO PLAYER RETURN   UNKNOWN TRANSACTION != RELEASED

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
import { productSnapshotQueries } from '../../scripts/db/lib/product-snapshot-invariants.mjs'
import { ALL_SNAPSHOT_TABLES } from '../../database/research/045b/snapshots.mjs'
import { attributionState, attributionStateCounts, attributionSummary, openPackages, packageBlockerSplit, packageCompleteness } from '../../lib/research/transaction-research.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '049_transaction_package_completion.sql'
const sql049 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const rollback049 = fs.readFileSync(path.join(root, 'database/release/sql/rollback-049.sql'), 'utf8')
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'database/research/049/transaction-evidence.json'), 'utf8'))

const NEW_EVENTS = ['LAD_MIN_1967_BOB_MILLER', 'LAD_FREE_AGENCY_2009_JON_GARLAND', 'LAD_MON_1968_GRANT_EXPANSION', 'LAD_SD_1968_VERSALLES_EXPANSION']
const ABREU = 'LAD_ARI_2009_TONY_ABREU'
const RESEARCH_TABLES = ['sources', 'transaction_event_assets', 'transaction_events']
const IDS = { garland: '279782', grant: '115046', versalles: '123713', miller: '119112', roseboro: '121456', perranoski: '120430', abreu: '473234' }

let chain
let pre049Dump
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
const R = (x) => (Array.isArray(x) ? x : x.rows)
const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const tableHashes = async (c = chain) => {
  const tables = R(await c.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).map((r) => r.relname)
  const out = {}
  for (const t of tables) out[t] = md5(R(await c.query(`select t::text as r from public.${t} t`)).map((r) => r.r).sort())
  return out
}
const catalog = async () => ({
  views: await q(`select relname, pg_get_viewdef(oid) as d, coalesce(relacl::text, '') as acl from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`),
  tables: await q(`select relname, coalesce(relacl::text, '') as acl, relrowsecurity as rls from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`),
  functions: await q(`select p.oid::regprocedure::text as f, md5(pg_get_functiondef(p.oid)) as h, coalesce(p.proacl::text, '') as acl, p.prosecdef as secdef from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`),
  policies: await q(`select tablename, policyname, cmd, roles::text as roles from pg_policies where schemaname = 'public' order by 1, 2`),
  triggers: await q(`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal order by 1, 2`),
})
const drift = async (c = chain) => R(await c.query(`select snapshot, missing_rows + extra_rows as n from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0`))
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
// the dataset the research commands read, from a database (same relations, same columns)
const dataset = async (c = chain) => {
  const rows = async (s) => R(await c.query(s))
  return {
    decisions: await rows(`select * from public.product_player_decision order by signing_id`),
    transactionQueue: await rows(`select issue, priority, player_slug, event_key, asset_name, detail from public.v_transaction_research_queue order by issue, player_slug, event_key, asset_name`),
    valueQueue: await rows(`select issue, priority, player_slug, event_key, detail from public.v_value_research_queue order by issue, player_slug, event_key`),
  }
}
const countBy = (rows, k) => rows.reduce((m, r) => ({ ...m, [r[k]]: (m[r[k]] ?? 0) + 1 }), {})
const edge = async (c, eventKey) => (await c.query(`select incoming_asset_name, return_state, incoming_war_status, incoming_dodgers_bwar, individual_attribution_permitted, attribution_status, outgoing_asset_count
  from public.v_trade_realization_edges where event_key = $1 order by incoming_asset_name`, [eventKey]))

let pre
let post
before(async () => {
  chain = await buildChainThrough('048_verified_mlb_development_coverage.sql')
  pre049Dump = await chain.db.dumpDataDir('none')
  pre = {
    hashes: await tableHashes(), catalog: await catalog(), data: await dataset(),
    generation: (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g,
    counts: await one(`select (select count(*)::int from public.transaction_events) as events, (select count(*)::int from public.transaction_event_assets) as assets,
      (select count(*)::int from public.transaction_asset_resolutions) as resolutions, (select count(*)::int from public.sources) as sources, (select count(*)::int from public.player_mlb_team_season_war) as war_rows,
      (select count(*)::int from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is not null) as cash_known`),
    status: await one(`select tracked_signings, signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks, outcome_audit_queue, outcome_audits_completed from product_database_status`),
    executive: await one(`select signings_with_resolved_value::int as resolved, realized_direct_dodgers_bwar::numeric as direct, realized_org_value_bwar::numeric as org, realized_individually_attributable_trade_bwar::numeric as attributable from product_executive_snapshot`),
    abreu: await q(`select e.transaction_date::text d, e.description, a.asset_side, a.asset_name, a.role_note from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id where e.event_key = $1 order by 3, 4`, [ABREU]),
    considerations: await one(`select md5(string_agg(a::text, '|' order by a.id::text)) as h from public.transaction_event_assets a where a.asset_type in ('CASH', 'INTERNATIONAL_BONUS_POOL_SPACE', 'FUTURE_CONSIDERATIONS', 'PLAYER_TO_BE_NAMED')`),
    edges: await q(`select event_key, incoming_asset_name, return_state, outgoing_asset_count, attribution_status from public.v_trade_realization_edges order by 1, 2`),
  }
  await chain.db.exec(sql049)
  post = { hashes: await tableHashes(), catalog: await catalog(), data: await dataset() }
}, { timeout: 900000 })
after(async () => { await chain?.close() })

test('049 is registered last in the manifest and sorts after 048', () => {
  assert.equal(manifest.canonical_sql.at(-1), FILE)
  assert.equal(manifest.canonical_sql.at(-2), '048_verified_mlb_development_coverage.sql')
  assert.equal(manifest.notes.canonical_build_count, manifest.canonical_sql.length)
  assert.equal(manifest.canonical_sql.length, 53)
})

test('049 adds research DATA only: no table, view, function, trigger, policy or privilege changes', async () => {
  assert.deepEqual(post.catalog, pre.catalog)
  assert.equal(post.catalog.tables.length, 78)
  assert.equal(post.catalog.views.length, 155)
  const changed = Object.keys(post.hashes).filter((t) => post.hashes[t] !== pre.hashes[t]).sort()
  assert.deepEqual(changed, [...RESEARCH_TABLES, ...ALL_SNAPSHOT_TABLES].sort())
  assert.equal(ALL_SNAPSHOT_TABLES.length, 11)
  // research that must not move: no value is loaded, no audit, cost, development row, sealed resolution or observation changes
  for (const t of ['outcome_audits', 'outcome_evidence', 'outcomes', 'signings', 'signing_financial_reports', 'players', 'transaction_asset_resolutions', 'transaction_asset_timing_observations',
    'dodgers_control_observations', 'player_mlb_team_season_war', 'research_source_conflicts', 'player_season_stints', 'development_milestones', 'development_progression_decisions', 'transaction_return_metrics']) {
    assert.equal(post.hashes[t], pre.hashes[t], `${t} must not change`)
  }
  for (const t of RESEARCH_TABLES) {
    const r = await one(`select has_table_privilege('anon', 'public.${t}', 'INSERT') or has_table_privilege('anon', 'public.${t}', 'UPDATE') or has_table_privilege('anon', 'public.${t}', 'DELETE')
      or has_table_privilege('authenticated', 'public.${t}', 'INSERT') or has_table_privilege('authenticated', 'public.${t}', 'UPDATE') or has_table_privilege('authenticated', 'public.${t}', 'DELETE') as api_write`)
    assert.equal(r.api_write, false, t)
  }
  // security: exactly the same SECURITY DEFINER functions as before, and none new
  assert.deepEqual(post.catalog.functions.filter((f) => f.secdef), pre.catalog.functions.filter((f) => f.secdef))
  assert.equal(post.catalog.functions.length, pre.catalog.functions.length)
})

test('the Abreu trade is corrected forward: agreement 2009-08-31, Garland the return, Abreu the player named later and delivered 2009-10-09; the old date is kept', async () => {
  const [was] = pre.abreu
  assert.equal(was.d, '2009-10-09')
  assert.equal(pre.abreu.length, 1, 'before 049 the trade recorded one outgoing asset and no return')
  assert.match(was.description, /traded 2B Tony Abreu to Arizona/)
  const e = await one(`select e.transaction_date::text d, e.description, e.transaction_type t, fo.abbreviation f, too.abbreviation tt from public.transaction_events e
    join public.organizations fo on fo.id = e.from_organization_id join public.organizations too on too.id = e.to_organization_id where e.event_key = $1`, [ABREU])
  assert.equal(e.d, '2009-08-31', 'the event carries the agreement date, which is the date the return is measured from')
  assert.equal(e.t, 'TRADE')
  assert.deepEqual([e.f, e.tt], ['LAD', 'ARI'])
  assert.match(e.description, /2009-08-31/)
  assert.match(e.description, /2009-10-09/, 'the completion date is not lost')
  assert.match(e.description, /player to be named later/)
  assert.match(e.description, /Retrosheet transaction 64131/)
  assert.ok(e.description.includes(was.description.replace(/\.$/, '')), 'the text DISI stored before is quoted, so the correction explains itself')
  const assets = await q(`select a.asset_side, a.asset_name, a.asset_type, a.mlb_id, a.bref_id, a.player_id is not null as tracked, a.role_note, so.source_tier, cp.abbreviation as cp
    from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id join public.sources so on so.id = a.source_id
    left join public.organizations cp on cp.id = a.counterparty_organization_id where e.event_key = $1 order by 1, 2`, [ABREU])
  assert.equal(assets.length, 2)
  const [inc, out] = assets
  assert.deepEqual([inc.asset_side, inc.asset_name, inc.asset_type, inc.mlb_id, inc.bref_id, inc.tracked, inc.cp, inc.source_tier], ['INCOMING', 'Jon Garland', 'PLAYER', IDS.garland, 'garlajo01', false, 'ARI', 'MLB_TRANSACTION_LOG'])
  assert.deepEqual([out.asset_side, out.asset_name, out.mlb_id, out.bref_id, out.tracked], ['OUTGOING', 'Tony Abreu', IDS.abreu, 'abreuto01', true])
  assert.match(out.role_note, /player to be named later/)
  assert.match(out.role_note, /2009-10-09/)
  assert.equal(pre.abreu[0].role_note, 'DISI tracked international signing.', 'the earlier note is what the rollback restores')
  assert.equal((await one(`select count(*)::int as n from public.transaction_asset_resolutions r join public.transaction_event_assets a on a.id = r.placeholder_asset_id join public.transaction_events e on e.id = a.event_id where e.event_key = $1`, [ABREU])).n, 0,
    'no placeholder asset is added: it would be counted as a second outgoing asset and turn a one-player trade into a "shared package"')
})

test('KNOWN TRANSACTION != KNOWN RETURN VALUE: Garland is recorded and his return reads RETURN_WAR_UNKNOWN, NULL and never zero; attribution stays withheld', async () => {
  const [g] = await edge(chain, ABREU)
  assert.equal(g.incoming_asset_name, 'Jon Garland')
  assert.equal(g.return_state, 'RETURN_WAR_UNKNOWN')
  assert.equal(g.incoming_war_status, 'NO_TEAM_SEASON_FACTS')
  assert.equal(g.incoming_dodgers_bwar, null, 'a missing bWAR is not a zero bWAR')
  // Abreu is the ONLY outgoing asset, so the trade stays sole-outgoing and becomes individually attributable the day Garland's WAR is loaded
  assert.equal(g.individual_attribution_permitted, true)
  assert.equal(g.attribution_status, 'SOLE_OUTGOING_ASSET')
  assert.equal(Number(g.outgoing_asset_count), 1)
  const r = await one(`select package_attribution_state, individually_attributable_trade_return_bwar, trade_package_return_dodgers_bwar from public.v_player_organizational_realization where player_slug = 'tony-abreu'`)
  assert.equal(r.package_attribution_state, 'RETURN_WAR_UNKNOWN')
  assert.equal(r.individually_attributable_trade_return_bwar, null)
  assert.equal(r.trade_package_return_dodgers_bwar, null)
  // product snapshot: before 049 the unrecorded return read as a recorded 0.00 individually attributable amount; now it is NULL
  const was = pre.data.decisions.find((d) => d.player_slug === 'tony-abreu')
  const now = post.data.decisions.find((d) => d.player_slug === 'tony-abreu')
  assert.equal(was.chain_status, 'INCOMPLETE_RETURN_UNRECORDED')
  assert.equal(Number(was.individually_attributable_trade_bwar), 0)
  assert.equal(now.chain_status, 'INCOMPLETE_WAR_NOT_LOADED')
  assert.equal(now.individually_attributable_trade_bwar, null, 'UNKNOWN TRADE RETURN != ZERO VALUE')
  assert.equal(now.package_first_hop_participation_bwar, null)
  assert.equal(attributionState(now), 'VALUE_NOT_DETERMINED')
  assert.equal(Number(now.direct_dodgers_bwar), Number(was.direct_dodgers_bwar), 'his own Dodgers value is untouched')
  // Garland's exit closes his interval; his Dodgers bWAR is not loaded, so the interval value is NULL, not zero
  const iv = await one(`select exit_event_key, exit_type, interval_status, war_state, interval_bounded_dodgers_bwar, branch_status from public.v_transaction_package_lineage where mlb_id = $1`, [IDS.garland])
  assert.deepEqual([iv.exit_event_key, iv.exit_type, iv.interval_status, iv.war_state, iv.interval_bounded_dodgers_bwar, iv.branch_status], ['LAD_FREE_AGENCY_2009_JON_GARLAND', 'FREE_AGENCY', 'CLOSED_EXIT_RECORDED', 'WAR_NOT_LOADED', null, 'TERMINAL_NO_RETURN'])
})

test('the 1967 Dodgers-Twins trade is recorded although the WAR of both returned players is not: the package, the identities and the exits are known, the value is not', async () => {
  const assets = await q(`select a.asset_side, a.asset_name, a.mlb_id, a.bref_id, cp.abbreviation as cp, a.player_id is not null as tracked from public.transaction_event_assets a
    join public.transaction_events e on e.id = a.event_id left join public.organizations cp on cp.id = a.counterparty_organization_id where e.event_key = 'LAD_MIN_1967_BOB_MILLER' order by 1, 2`)
  assert.deepEqual(assets.map((a) => [a.asset_side, a.asset_name, a.mlb_id, a.bref_id, a.cp, a.tracked]), [
    ['INCOMING', 'Mudcat Grant', IDS.grant, 'grantmu01', 'MIN', false], ['INCOMING', 'Zoilo Versalles', IDS.versalles, 'versazo01', 'MIN', false],
    ['OUTGOING', 'Bob Miller', IDS.miller, 'millebo04', 'MIN', false], ['OUTGOING', 'John Roseboro', IDS.roseboro, 'rosebjo01', 'MIN', false], ['OUTGOING', 'Ron Perranoski', IDS.perranoski, 'perraro01', 'MIN', false]])
  const e = await one(`select transaction_date::text d, transaction_type t, description from public.transaction_events where event_key = 'LAD_MIN_1967_BOB_MILLER'`)
  assert.equal(e.d, '1967-11-28')
  assert.equal(e.t, 'TRADE')
  assert.match(e.description, /Retrosheet transaction 60573/)
  assert.match(e.description, /SABR/)
  assert.match(e.description, /November 27/, 'the day-of-month disagreement between sources is kept in the record')
  // Miller (acquired 1962) now has a recorded exit; Grant and Versalles have recorded intervals whose value is NULL, never 0
  const ivs = await q(`select asset_name, acquisition_event_key, exit_event_key, exit_type, interval_status, war_state, interval_bounded_dodgers_bwar, branch_status from public.v_transaction_package_lineage
    where root_package_key like 'BRO_PHI_1957_FERNANDEZ%' and mlb_id = any($1) order by asset_name`, [[IDS.miller, IDS.grant, IDS.versalles]])
  const by = Object.fromEntries(ivs.map((r) => [r.asset_name, r]))
  assert.equal(by['Bob Miller'].exit_event_key, 'LAD_MIN_1967_BOB_MILLER')
  assert.equal(by['Bob Miller'].exit_type, 'TRADE')
  assert.equal(by['Bob Miller'].interval_status, 'CLOSED_EXIT_RECORDED')
  assert.equal(by['Bob Miller'].war_state, 'LOADED', 'his loaded WAR is untouched')
  assert.notEqual(by['Bob Miller'].interval_bounded_dodgers_bwar, null)
  for (const [name, exitKey] of [['Mudcat Grant', 'LAD_MON_1968_GRANT_EXPANSION'], ['Zoilo Versalles', 'LAD_SD_1968_VERSALLES_EXPANSION']]) {
    assert.equal(by[name].acquisition_event_key, 'LAD_MIN_1967_BOB_MILLER', name)
    assert.equal(by[name].exit_event_key, exitKey, name)
    assert.equal(by[name].exit_type, 'EXPANSION_DRAFT', name)
    assert.equal(by[name].war_state, 'WAR_NOT_LOADED', name)
    assert.equal(by[name].interval_bounded_dodgers_bwar, null, `${name}: missing bWAR is not zero bWAR`)
  }
  // the chain that reaches them: Chico Fernandez was INCOMPLETE_EXIT_NOT_RESEARCHED; his transaction history is now recorded to its end and only value is missing
  const was = pre.data.decisions.find((d) => d.player_slug === 'chico-fernandez')
  const now = post.data.decisions.find((d) => d.player_slug === 'chico-fernandez')
  assert.equal(was.chain_status, 'INCOMPLETE_EXIT_NOT_RESEARCHED')
  assert.equal(now.chain_status, 'INCOMPLETE_WAR_NOT_LOADED')
  assert.equal(attributionState(now), 'VALUE_NOT_DETERMINED')
  for (const k of ['direct_dodgers_bwar', 'individually_attributable_trade_bwar', 'package_first_hop_participation_bwar', 'value_left_organization_bwar']) assert.equal(now[k], was[k], `${k} does not move`)
})

test('the three exits are exact source rows: Garland (official log + Retrosheet), Grant and Versalles (the 1968 expansion draft, Retrosheet + SABR)', async () => {
  const rows = await q(`select e.event_key, e.transaction_date::text d, e.transaction_type t, e.historical_label l, e.description, fo.abbreviation f, too.abbreviation tt, so.source_tier, so.url,
      (select count(*)::int from public.transaction_event_assets a where a.event_id = e.id) n, cp.abbreviation as cp
    from public.transaction_events e join public.organizations fo on fo.id = e.from_organization_id left join public.organizations too on too.id = e.to_organization_id join public.sources so on so.id = e.source_id
    left join public.transaction_event_assets a on a.event_id = e.id left join public.organizations cp on cp.id = a.counterparty_organization_id
    where e.event_key = any($1) and e.event_key <> 'LAD_MIN_1967_BOB_MILLER' order by 1`, [NEW_EVENTS])
  const by = Object.fromEntries(rows.map((r) => [r.event_key, r]))
  const garland = by.LAD_FREE_AGENCY_2009_JON_GARLAND
  assert.deepEqual([garland.d, garland.t, garland.l, garland.f, garland.tt, garland.source_tier, garland.n], ['2009-11-05', 'FREE_AGENCY', 'Granted free agency', 'LAD', null, 'MLB_TRANSACTION_LOG', 1])
  assert.match(garland.description, /Retrosheet transaction 18248/)
  const grant = by.LAD_MON_1968_GRANT_EXPANSION
  assert.deepEqual([grant.d, grant.t, grant.f, grant.tt, grant.cp, grant.n], ['1968-10-14', 'EXPANSION_DRAFT', 'LAD', 'WSH', 'WSH', 1])
  assert.equal(grant.l, '1968 expansion draft (Montreal Expos), pick 36')
  assert.match(grant.description, /Retrosheet transaction 19808/)
  const versalles = by.LAD_SD_1968_VERSALLES_EXPANSION
  assert.deepEqual([versalles.d, versalles.t, versalles.f, versalles.tt, versalles.cp, versalles.n], ['1968-10-14', 'EXPANSION_DRAFT', 'LAD', 'SD', 'SD', 1])
  assert.equal(versalles.l, '1968 expansion draft (San Diego Padres), pick 20')
  assert.match(versalles.description, /Retrosheet transaction 54511/)
  assert.equal(grant.url, 'https://www.retrosheet.org/transactions/tranDB.zip')
  // Retrosheet stays a low tier: it is not promoted to an authority it does not have
  assert.equal(grant.source_tier, 'OTHER')
})

test('nothing is inferred: only the reviewed rows were added, and no exit, cash, player or value appeared for any unresolved asset', async () => {
  const now = await one(`select (select count(*)::int from public.transaction_events) as events, (select count(*)::int from public.transaction_event_assets) as assets,
    (select count(*)::int from public.transaction_asset_resolutions) as resolutions, (select count(*)::int from public.sources) as sources, (select count(*)::int from public.player_mlb_team_season_war) as war_rows`)
  assert.equal(now.events - pre.counts.events, 4)
  assert.equal(now.assets - pre.counts.assets, 9, 'five in the 1967 package, one asset in each of the three exit events, and Garland as the Abreu return')
  assert.equal(now.resolutions, pre.counts.resolutions)
  assert.equal(now.war_rows, pre.counts.war_rows, 'no Baseball-Reference WAR row was loaded')
  assert.equal(now.sources - pre.counts.sources, 5, 'the Garland log, the identity crosswalk and three SABR biographies were read')
  // cash, pool space, future considerations and players-to-be-named are exactly as they were: an unnamed amount is NULL, never 0
  assert.equal((await one(`select md5(string_agg(a::text, '|' order by a.id::text)) as h from public.transaction_event_assets a where a.asset_type in ('CASH', 'INTERNATIONAL_BONUS_POOL_SPACE', 'FUTURE_CONSIDERATIONS', 'PLAYER_TO_BE_NAMED')`)).h, pre.considerations.h)
  assert.equal((await one(`select count(*)::int as n from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is not null`)).n, pre.counts.cash_known, 'no cash amount was added')
  assert.equal((await one(`select count(*)::int as n from public.transaction_event_assets where cash_amount_usd = 0 or pool_space_amount_usd = 0`)).n, 0, 'no cash or pool-space amount is zero')
  // no asset the research could not place gained an exit: each is still only an INCOMING asset of its original trade
  for (const [name, ev] of [['Gail Harris', 'LAD_DET_1960_AMOROS'], ['Robinson Checo', 'LAD_DET_1999_DAVE_MLICKI'], ['Apostol Garcia', 'LAD_DET_1999_DAVE_MLICKI'], ['Rick Roberts', 'LAD_DET_1999_DAVE_MLICKI'],
    ['Danny Muegge', 'LAD_ARI_2005_SHAWN_GREEN'], ['William Juárez', 'LAD_ARI_2005_SHAWN_GREEN']]) {
    const rows = await q(`select e.event_key, a.asset_side from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id where a.asset_name = $1`, [name])
    assert.deepEqual(rows, [{ event_key: ev, asset_side: 'INCOMING' }], `${name}: acquired, with no exit inferred from his disappearance`)
  }
  // the chains 049 could not close are exactly as open as before
  const now2 = Object.fromEntries(post.data.decisions.map((d) => [d.player_slug, d.chain_status]))
  assert.equal(now2['jose-offerman'], 'INCOMPLETE_RETURN_UNRECORDED', 'an unnamed conditional return is not zero, cash or no return')
  assert.equal(now2['carlos-frias'], 'INCOMPLETE_PENDING_CONSIDERATION', 'a player-to-be-named-or-cash is not assumed to be cash')
  for (const s of ['raul-mondesi', 'hideo-nomo', 'sandy-amoros']) assert.equal(now2[s], 'INCOMPLETE_EXIT_NOT_RESEARCHED', s)
  // no tracked signing's value, audit or cost moved
  assert.deepEqual(await one(`select tracked_signings, signings_with_known_cost, known_acquisition_cost_usd::text as cost, open_research_tasks, outcome_audit_queue, outcome_audits_completed from product_database_status`), pre.status)
})

test('four named-only assets gain an MLB id, reconciled by affiliations that bracket the trade; the id is unique and no other column of the asset changes', async () => {
  const ids = await q(`select e.event_key, a.asset_name, a.mlb_id, a.bref_id, a.asset_side from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
    where a.asset_name in ('Apostol Garcia', 'Rick Roberts', 'Danny Muegge', 'William Juárez') order by 2`)
  assert.deepEqual(ids.map((r) => [r.asset_name, r.mlb_id, r.bref_id, r.asset_side]), [['Apostol Garcia', '472796', null, 'INCOMING'], ['Danny Muegge', '458260', null, 'INCOMING'],
    ['Rick Roberts', '425540', null, 'INCOMING'], ['William Juárez', '452705', null, 'INCOMING']])
  for (const id of ['472796', '458260', '425540', '452705']) assert.equal((await one(`select count(*)::int as n from public.transaction_event_assets where mlb_id = $1`, [id])).n, 1, `${id} identifies exactly one asset`)
  // a minor leaguer has no Baseball-Reference id here: none is invented, so none of the four can be given WAR by accident
  assert.equal(evidence.identities.filter((i) => i.register_key_bbref_minors).length, 4)
})

test('transaction chains vs value chains: the seven incomplete chains split into five whose history is open and two whose history is recorded and whose value is not', async () => {
  const was = countBy(pre.data.decisions, 'chain_status')
  const now = countBy(post.data.decisions, 'chain_status')
  assert.deepEqual(was, { COMPLETE_TERMINAL: 28, INCOMPLETE_EXIT_NOT_RESEARCHED: 4, INCOMPLETE_PENDING_CONSIDERATION: 1, INCOMPLETE_RETURN_UNRECORDED: 2, NO_TRADE_CHAIN: 175, STILL_ACTIVE: 10 })
  assert.deepEqual(now, { COMPLETE_TERMINAL: 28, INCOMPLETE_EXIT_NOT_RESEARCHED: 3, INCOMPLETE_PENDING_CONSIDERATION: 1, INCOMPLETE_RETURN_UNRECORDED: 1, INCOMPLETE_WAR_NOT_LOADED: 2, NO_TRADE_CHAIN: 175, STILL_ACTIVE: 10 })
  const a = attributionSummary(pre.data.decisions)
  const b = attributionSummary(post.data.decisions)
  assert.deepEqual([a.incomplete_chains, a.transaction_chains_incomplete, a.value_blocked_chains], [7, 7, 0])
  assert.deepEqual([b.incomplete_chains, b.transaction_chains_incomplete, b.value_blocked_chains], [7, 5, 2])
  assert.deepEqual(attributionStateCounts(pre.data.decisions), { CHAIN_INCOMPLETE: 7, INDIVIDUALLY_ATTRIBUTED: 6, NOT_A_TRADE_EXIT: 175, PACKAGE_LEVEL_ONLY: 13, RECORDED_ZERO_RETURN: 5, RETURN_STILL_ACCRUING: 10, VALUE_NOT_DETERMINED: 4 })
  assert.deepEqual(attributionStateCounts(post.data.decisions), { CHAIN_INCOMPLETE: 5, INDIVIDUALLY_ATTRIBUTED: 6, NOT_A_TRADE_EXIT: 175, PACKAGE_LEVEL_ONLY: 13, RECORDED_ZERO_RETURN: 5, RETURN_STILL_ACCRUING: 10, VALUE_NOT_DETERMINED: 6 })
  // no shared package gained an individual attribution, and no individually attributed amount changed for anyone but Abreu
  for (const d of post.data.decisions) {
    const w = pre.data.decisions.find((x) => x.signing_id === d.signing_id)
    if (d.player_slug === 'tony-abreu') continue
    assert.equal(d.individually_attributable_trade_bwar, w.individually_attributable_trade_bwar, `${d.player_slug}: individually attributable amount`)
    assert.equal(d.package_first_hop_participation_bwar, w.package_first_hop_participation_bwar, `${d.player_slug}: package amount`)
  }
})

test('queues: the transaction queue keeps its 59 items with a different composition, the value queue its 91, and both are deterministic', async () => {
  const t0 = countBy(pre.data.transactionQueue, 'issue')
  const t1 = countBy(post.data.transactionQueue, 'issue')
  assert.equal(pre.data.transactionQueue.length, 59)
  assert.equal(post.data.transactionQueue.length, 59)
  assert.equal(pre.data.valueQueue.length, 91)
  assert.equal(post.data.valueQueue.length, 91)
  assert.deepEqual(countBy(post.data.valueQueue, 'issue'), countBy(pre.data.valueQueue, 'issue'), 'attribution stays withheld by rule, so the value queue does not move')
  assert.equal(t0.TRADE_RETURN_UNRECORDED, 1)
  assert.equal(t1.TRADE_RETURN_UNRECORDED, undefined, 'the Abreu return is recorded')
  assert.equal(t1.EXIT_NOT_RESEARCHED_DOWNSTREAM, t0.EXIT_NOT_RESEARCHED_DOWNSTREAM - 1, "Miller's exit is recorded")
  assert.equal(t1.DOWNSTREAM_WAR_NOT_LOADED, t0.DOWNSTREAM_WAR_NOT_LOADED + 2, 'Grant and Versalles are known players whose WAR is not loaded')
  for (const i of ['CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN', 'FUTURE_CONSIDERATIONS_UNRESOLVED', 'PTBNL_UNRESOLVED', 'EXIT_TRANSACTION_MISSING', 'EXIT_STATUS_UNVERIFIED', 'RETURN_ASSET_EXIT_MISSING']) assert.equal(t1[i], t0[i], i)
  const again = await dataset()
  assert.deepEqual(again.transactionQueue, post.data.transactionQueue)
  assert.deepEqual(again.valueQueue, post.data.valueQueue)
  // packages: 21 -> 20; the cash, pool-space, player-to-be-named and future-consideration packages are untouched
  const p0 = packageCompleteness(pre.data)
  const p1 = packageCompleteness(post.data)
  assert.equal(p0.packages_with_open_issues, 21)
  assert.equal(p1.packages_with_open_issues, 20)
  const { TRADE_RETURN_UNRECORDED: recorded, ...stillOpen } = p0.packages_with_open_issues_by_issue
  assert.equal(recorded, 1)
  assert.deepEqual(p1.packages_with_open_issues_by_issue, stillOpen)
  assert.deepEqual(packageBlockerSplit(pre.data), { packages_with_open_issues: 21, packages_with_open_membership: 6, packages_with_open_terms: 17, packages_with_only_open_terms: 15 })
  assert.deepEqual(packageBlockerSplit(post.data), { packages_with_open_issues: 20, packages_with_open_membership: 5, packages_with_open_terms: 17, packages_with_only_open_terms: 15 })
  assert.deepEqual(openPackages(post.data), openPackages({ transactionQueue: [...post.data.transactionQueue].reverse() }))
})

test('the package is a package, not a share: no outgoing-asset count changed anywhere, and a shared package is still never credited to one player', async () => {
  const now = await q(`select event_key, incoming_asset_name, return_state, outgoing_asset_count, attribution_status from public.v_trade_realization_edges order by 1, 2`)
  const keep = (rows) => rows.filter((r) => r.event_key !== ABREU)
  assert.deepEqual(keep(now), keep(pre.edges), 'every other trade edge is identical')
  assert.equal(now.filter((r) => r.event_key === ABREU).length, 1)
})

test('one coherent snapshot generation: +1, all eleven snapshots carry it, zero drift, and the support chain is unchanged', async () => {
  const g = (await one(`select max(generation_id)::int as g from product_executive_snapshot`)).g
  assert.equal(g, pre.generation + 1)
  for (const t of ALL_SNAPSHOT_TABLES) assert.equal((await one(`select count(*) filter (where generation_id <> $1)::int as n from public.${t}`, [g])).n, 0, t)
  assert.deepEqual(await drift(), [])
  const e = await one(`select support_chain_state, supported_expected_value_models, predictive_portfolio_recommendations from product_executive_snapshot`)
  assert.equal(e.support_chain_state, 'NO_PREDICTIVE_LAYER_SUPPORTED')
  assert.equal(Number(e.supported_expected_value_models), 0)
  assert.equal(Number(e.predictive_portfolio_recommendations), 0)
  assert.equal((await one(`select count(*)::int as n from public.product_prediction_readiness where baseline_supported`)).n, 0, 'no probability target became supported; no threshold moved')
})

test('the one published figure that moves: Abreu leaves the resolved-value set while his return is unknown, so the realized totals drop by exactly his 1.23 direct bWAR', async () => {
  const now = await one(`select signings_with_resolved_value::int as resolved, realized_direct_dodgers_bwar::numeric as direct, realized_org_value_bwar::numeric as org, realized_individually_attributable_trade_bwar::numeric as attributable from product_executive_snapshot`)
  assert.deepEqual(pre.executive, { resolved: 88, direct: '284.00', org: '298.83', attributable: '14.83' }, 'the same figures production published after 048')
  assert.equal(now.resolved, pre.executive.resolved - 1)
  assert.equal(Number(now.direct), 282.77)
  assert.equal(Number(now.org), 297.6)
  assert.equal(Math.round((Number(now.direct) - Number(pre.executive.direct)) * 100) / 100, -1.23, "exactly Abreu's direct Dodgers bWAR")
  assert.equal(Number(now.attributable), Number(pre.executive.attributable), 'no individually attributable amount was added or removed from the total')
  const abreu = post.data.decisions.find((d) => d.player_slug === 'tony-abreu')
  const was = pre.data.decisions.find((d) => d.player_slug === 'tony-abreu')
  assert.equal(was.realized_value_state, 'TO_DATE_CHAIN_INCOMPLETE')
  assert.equal(Number(was.realized_org_value_bwar), 1.23, 'before 049 the unrecorded return was read as a 0.00 return, so his organizational value looked resolved')
  assert.equal(abreu.realized_value_state, 'VALUE_UNRESOLVED')
  assert.equal(abreu.realized_org_value_bwar, null, 'with the return recorded and its WAR unknown, his organizational value is unresolved, not his direct value alone')
  assert.equal(Number(abreu.direct_dodgers_bwar), 1.23, 'his own Dodgers value is unchanged and still shown separately')
  // no other signing's realized value moved
  for (const d of post.data.decisions) {
    if (d.player_slug === 'tony-abreu') continue
    const w = pre.data.decisions.find((x) => x.signing_id === d.signing_id)
    assert.deepEqual([d.realized_value_state, d.realized_org_value_bwar, d.direct_dodgers_bwar], [w.realized_value_state, w.realized_org_value_bwar, w.direct_dodgers_bwar], d.player_slug)
  }
})

test('the verifier passes on 001-049 (247 hard checks); the identity check accepts a returned player without WAR only for the pinned id', async () => {
  for (const [name, sql] of Object.entries(productSnapshotQueries(true, true))) assert.equal((await one(sql)).n, 0, name)
  const full = await checkInvariants(q, CANONICAL_EXPECTATIONS)
  assert.deepEqual(failedChecks(full), [])
  assert.equal(full.hard.length, 247)
  assert.deepEqual(CANONICAL_EXPECTATIONS.transaction_war_unavailable_mlb_ids, [IDS.garland])
  // without the pin the same data is a violation: the relaxation is explicit, narrow and reviewed
  const unpinned = await checkInvariants(q, { ...CANONICAL_EXPECTATIONS, transaction_war_unavailable_mlb_ids: [] })
  assert.deepEqual(failedChecks(unpinned).map((c) => c.name), ['transaction_asset_identity_consistency_violations'])
  // any OTHER returned player of a tracked-signing trade without WAR is still a violation, even with the pin in place
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`update public.transaction_event_assets set bref_id = 'nowarloaded' where id = (select a.id from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
      where a.asset_type = 'PLAYER' and a.asset_side = 'INCOMING' and a.bref_id is not null and a.player_id is null and e.transaction_type = 'TRADE'
        and exists (select 1 from public.transaction_event_assets t where t.event_id = e.id and t.asset_side = 'OUTGOING' and t.player_id is not null)
        and exists (select 1 from public.player_mlb_team_season_war w where w.bref_id = a.bref_id and w.record_status = 'ACTIVE') order by a.id limit 1)`)
    const bad = await checkInvariants(async (s) => (await c.db.query(s)).rows, CANONICAL_EXPECTATIONS)
    assert.ok(failedChecks(bad).some((f) => f.name === 'transaction_asset_identity_consistency_violations'))
  } finally { await c.close() }
})

test('value stays Baseball-Reference based: fWAR cannot be stored as team-season WAR, FanGraphs cannot back CAREER_BWAR, and loading the real rows values Garland by the existing timing rule', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const code = async (abbr, season) => (await c.query(`select organization_id as id from public.bref_team_code_map where bref_team_code = $1 and from_season <= $2 order by from_season desc limit 1`, [abbr, season]))[0]?.id
    const src = (await c.query(`select id from public.sources where url ilike '%baseball-reference.com%' limit 1`))[0].id
    const ari = await code('ARI', 2009)
    const lad = await code('LAD', 2009)
    const row = (team, org, stint, war, extra = '') => `insert into public.player_mlb_team_season_war (bref_id, mlb_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games, league, war_system, source_id, observed_through_date, observed_through_season, retrieved_at, confidence)
      values ('garlajo01', '${IDS.garland}', 2009, '${team}', ${org ? `'${org}'` : 'null'}, ${stint}, 'PITCH', ${war}, 10, 'NL', ${extra || "'BWAR'"}, '${src}', date '2026-10-01', 2026, now(), 'VERIFIED')`
    // fWAR is a different metric and has no place in the Baseball-Reference table
    await failsWith(c, row('LAD', lad, 2, 0.5, "'FWAR'"), /war_system_check/)
    // a FanGraphs observation cannot stand in for CAREER_BWAR
    const fg = (await c.query(`select id from public.sources where url ilike '%fangraphs.com%' limit 1`))[0]
    assert.ok(fg, 'a FanGraphs source exists to test with')
    await failsWith(c, `insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence)
      select p.id, 'CAREER_BWAR', 9.9, date '2026-10-01', 2026, '${fg.id}', 'HIGH' from public.players p where p.slug = 'tony-abreu'`, /CAREER_BWAR must cite a Baseball-Reference source/)
    // (1) same-season order cannot be resolved (only a Dodgers row, no counterparty stint to anchor against): TIMING_UNRESOLVED, NULL, not zero
    await c.db.exec(row('LAD', lad, 1, 0.5))
    let [g] = await edge(c, ABREU)
    assert.equal(g.return_state, 'TIMING_UNRESOLVED')
    assert.equal(g.incoming_dodgers_bwar, null, 'an unresolved same-season order is NULL, not zero, and the rule is not altered to make it resolvable')
    await c.db.exec(`update public.player_mlb_team_season_war set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'test: replace with the full season' where bref_id = 'garlajo01'`)
    // (2) Arizona stint 1 then Dodgers stint 2: the existing counterparty-order rule anchors the Dodgers stint after the trade
    await c.db.exec(row('ARI', ari, 1, 2.0))
    await c.db.exec(row('LAD', lad, 2, 0.5))
    ;[g] = await edge(c, ABREU)
    assert.equal(g.return_state, 'LOADED')
    assert.equal(Number(g.incoming_dodgers_bwar), 0.5, 'only the Dodgers WAR produced after the acquisition counts; the Arizona stint is never credited')
    const r = (await c.query(`select package_attribution_state, individually_attributable_trade_return_bwar from public.v_player_organizational_realization where player_slug = 'tony-abreu'`))[0]
    assert.equal(r.package_attribution_state, 'SOLE_OUTGOING_ATTRIBUTABLE', 'Abreu was the only outgoing asset, so the loaded return is individually attributable')
    assert.equal(Number(r.individually_attributable_trade_return_bwar), 0.5)
  } finally { await c.close() }
})

test('idempotent: a rerun adds nothing, runs no second refresh and changes no table', async () => {
  const before = await tableHashes()
  await chain.db.exec(sql049)
  assert.deepEqual(await tableHashes(), before)
})

test('guards: 049 refuses a database where its facts no longer apply, and changes nothing when it refuses', async () => {
  const a = await clone(pre049Dump)
  try {
    // the Abreu trade already records a different return
    await a.db.exec(`insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id, bref_id)
      select e.id, 'INCOMING', 'Somebody Else', 'PLAYER', '999999', 'elsesom01' from public.transaction_events e where e.event_key = '${ABREU}'`)
    const before = await tableHashes(a)
    await failsWith(a, sql049, /049: the Abreu trade already records a different return/)
    assert.deepEqual(await tableHashes(a), before)
  } finally { await a.close() }
  const b = await clone(pre049Dump)
  try {
    await b.db.exec(`update public.transaction_events set transaction_date = date '2009-10-10' where event_key = '${ABREU}'`)
    await failsWith(b, sql049, /049: the Abreu trade is not in the state the research was written for/)
  } finally { await b.close() }
  const c = await clone(pre049Dump)
  try {
    // a later Dodgers exit is already recorded for Bob Miller
    await c.db.exec(`insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id)
      select 'LAD_RELEASE_1965_BOB_MILLER_EARLIER', date '1965-06-01', 'RELEASE', o.id, 'earlier research', (select id from public.sources limit 1) from public.organizations o where o.abbreviation = 'LAD'`)
    await c.db.exec(`insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id, bref_id)
      select e.id, 'OUTGOING', 'Bob Miller', 'PLAYER', '${IDS.miller}', 'millebo04' from public.transaction_events e where e.event_key = 'LAD_RELEASE_1965_BOB_MILLER_EARLIER'`)
    await failsWith(c, sql049, /049: a later Dodgers exit is already recorded for Bob Miller/)
  } finally { await c.close() }
  const d = await clone(pre049Dump)
  try {
    await d.db.exec(`update public.transaction_event_assets set mlb_id = '1' where asset_name = 'Danny Muegge'`)
    await failsWith(d, sql049, /049: the asset Danny Muegge in LAD_ARI_2005_SHAWN_GREEN is not in the state the identity research was written for/)
  } finally { await d.close() }
  const e = await clone(pre049Dump)
  try {
    await e.db.exec(`insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id)
      select 'LAD_OTHER_GARLAND', date '2010-11-26', 'FREE_AGENT_SIGNING', o.id, 'Garland signed', (select id from public.sources limit 1) from public.organizations o where o.abbreviation = 'LAD'`)
    await e.db.exec(`insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id, bref_id)
      select ev.id, 'INCOMING', 'Jon Garland', 'PLAYER', '${IDS.garland}', 'garlajo01' from public.transaction_events ev where ev.event_key = 'LAD_OTHER_GARLAND'`)
    await failsWith(e, sql049, /049: Garland, Grant or Versalles is already recorded in another transaction/)
  } finally { await e.close() }
})

test('rollback: restores the three transaction tables exactly, refreshes once, leaves no drift, and 049 can be applied again', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    const gen0 = (await c.query(`select max(generation_id)::int as g from product_executive_snapshot`))[0].g
    await c.db.exec(rollback049)
    assert.equal((await c.query(`select count(*)::int as n from public.transaction_events where event_key = any($1)`, [NEW_EVENTS]))[0].n, 0)
    const hashes = await tableHashes(c)
    for (const t of ['transaction_events', 'transaction_event_assets', 'transaction_asset_resolutions', 'player_mlb_team_season_war']) assert.equal(hashes[t], pre.hashes[t], `${t} is exactly as it was before 049`)
    assert.equal((await c.query(`select max(generation_id)::int as g from product_executive_snapshot`))[0].g, gen0 + 1)
    assert.deepEqual(await drift(c), [])
    const was = await dataset(c)
    assert.deepEqual(countBy(was.decisions, 'chain_status'), countBy(pre.data.decisions, 'chain_status'))
    assert.deepEqual(was.transactionQueue.map((r) => [r.issue, r.event_key, r.asset_name]), pre.data.transactionQueue.map((r) => [r.issue, r.event_key, r.asset_name]))
    // a second rollback refuses; unlike 046 the migration can be applied again, and the content equals the first application
    await failsWith(c, rollback049, /rollback-049: the event .* is not present/)
    await c.db.exec(sql049)
    const content = async (cc) => ({
      events: await cc.query(`select e.event_key, e.transaction_date::text d, e.transaction_type t, e.description, a.asset_side, a.asset_name, a.mlb_id, a.role_note from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id
        where e.event_key = any($1) order by 1, 5, 6`, [[...NEW_EVENTS, ABREU]]),
      ids: await cc.query(`select asset_name, mlb_id from public.transaction_event_assets where asset_name in ('Apostol Garcia', 'Rick Roberts', 'Danny Muegge', 'William Juárez') order by 1`),
    })
    assert.deepEqual(await content(c), await content({ query: q }))
    assert.deepEqual(await drift(c), [])
  } finally { await c.close() }
})

test('rollback refuses when later research depends on what it would delete', async () => {
  const c = await clone(await chain.db.dumpDataDir('none'))
  try {
    await c.db.exec(`insert into public.dodgers_control_observations (subject_asset_id, observation_type, observed_through_date, source_id, confidence)
      select a.id, 'DODGERS_CONTROL_OBSERVED', date '2009-10-01', (select id from public.sources limit 1), 'HIGH' from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
      where e.event_key = '${ABREU}' and a.mlb_id = '${IDS.garland}'`)
    await failsWith(c, rollback049, /rollback-049: later research depends on the Garland asset/)
  } finally { await c.close() }
  const d = await clone(await chain.db.dumpDataDir('none'))
  try {
    await d.db.exec(`insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, description, source_id)
      select 'LAD_LATER_GRANT', date '1969-06-01', 'RELEASE', o.id, 'later', (select id from public.sources limit 1) from public.organizations o where o.abbreviation = 'LAD'`)
    await d.db.exec(`insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, mlb_id, bref_id)
      select ev.id, 'OUTGOING', 'Mudcat Grant', 'PLAYER', '${IDS.grant}', 'grantmu01' from public.transaction_events ev where ev.event_key = 'LAD_LATER_GRANT'`)
    await failsWith(d, rollback049, /rollback-049: a later transaction was recorded for Garland, Grant or Versalles/)
  } finally { await d.close() }
})

test('reproducible: the committed migration and rollback are byte-identical to the build output', () => {
  const build = fs.readFileSync(path.join(root, 'database/research/049/build.mjs'), 'utf8')
  assert.match(build, /database\/sql\/049_transaction_package_completion\.sql|\.\.\/\.\.\/sql\/049_transaction_package_completion\.sql/)
  assert.ok(sql049.length > 20000 && rollback049.length > 5000)
  assert.ok(sql049.includes('KNOWN TRANSACTION != KNOWN RETURN VALUE'))
  assert.ok(rollback049.includes('rollback-049'))
})
