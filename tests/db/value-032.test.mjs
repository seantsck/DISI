// Migration 032 - player value and organizational realization.
//
// One 001-031 database is built; 032's guards are tested on that pre-032 state in rolled-back transactions, then 032
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
import { valueQueries, VALUE_CHECK_NAMES } from '../../scripts/db/lib/value-invariants.mjs'
import { checkInvariants, failedChecks, CANONICAL_EXPECTATIONS } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FILE = '032_player_value_organizational_realization.sql'
const sql032 = fs.readFileSync(path.join(root, 'database/sql', FILE), 'utf8')
const inner = withoutTransaction(sql032)
const seed = JSON.parse(fs.readFileSync(path.join(root, 'database/research/032/war-seed.json'), 'utf8'))
const config = JSON.parse(fs.readFileSync(path.join(root, 'database/research/032/scope-config.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(path.join(root, 'database/research/032/audit-report.json'), 'utf8'))
const NEW_TABLES = ['bref_team_code_map', 'player_mlb_team_season_war']
const NEW_VIEWS = ['v_dodgers_international_value_portfolio', 'v_player_organizational_realization', 'v_trade_realization_edges', 'v_value_research_queue']

let chain
const q = (sql, params) => chain.query(sql, params)
const one = async (sql, params) => (await q(sql, params))[0]
before(async () => { chain = await buildChainThrough('031_financial_provenance_coverage_expansion.sql') }, { timeout: 180000 })
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
  for (const [name, sql] of Object.entries(valueQueries(loaded))) if ((await one(sql)).n !== 0) out.push(name)
  return out.sort()
}
const rowFor = (slug) => one(`select * from v_player_organizational_realization where player_slug = $1`, [slug])
const num = (v) => (v === null ? null : Number(v))
let pre

// ---------------------------------------------------------------------------------------------
// the pre-032 database
// ---------------------------------------------------------------------------------------------

test('baseline: a 001-031 replay is 54 tables / 97 views with no 032 object, and the legacy career-WAR stores disagree on exactly three players', async () => {
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`), { tables: 54, views: 97 })
  assert.deepEqual(await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [[...NEW_TABLES, ...NEW_VIEWS]]), [])
  const bad = await q(`select p.slug from players p join outcomes oc on oc.player_id = p.id left join v_player_war w on w.player_id = p.id
    where oc.career_war is distinct from w.career_bwar order by 1`)
  assert.deepEqual(bad.map((r) => r.slug), ['carlos-frias', 'eddys-leonard', 'roger-cedeno'])
  assert.deepEqual(await failing(false), [])
  pre = { hashes: await tableHashes(), kpi: await one(`select * from v_dodgers_executive_kpis`),
    kpiDef: md5((await one(`select pg_get_viewdef('public.v_dodgers_executive_kpis'::regclass) as d`)).d) }
})

test('preconditions: an unexpected pre-032 state aborts 032 with nothing changed', async () => {
  const cases = [
    ['a data-file source is missing', `update sources set url = url || '#x' where url = ${lit(config.files.bat.url)};`, /data file source .* is not registered/],
    ['a verified player lacks a bref_id', `update players set bref_id = null where slug = 'oneil-cruz';`, /lack a bref_id/],
    ['a return asset is missing', `delete from transaction_event_assets where asset_name = 'Tony Watson';`, /return asset Tony Watson/],
  ]
  for (const [label, drift, expected] of /** @type {Array<[string, string, RegExp]>} */ (cases)) assert.match(await attempt(`${drift}\n${inner}`), expected, label)
  assert.deepEqual(await tableHashes(), pre.hashes, 'aborted runs changed nothing')
})

test('032 applied for real: 54 -> 56 tables and 97 -> 101 views; 2 tables, 4 views, 1 guard, 1 column', async () => {
  await chain.db.exec(sql032)
  assert.deepEqual(await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
    (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`), { tables: 56, views: 101 })
  assert.deepEqual((await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) order by 1`, [[...NEW_TABLES, ...NEW_VIEWS]])).map((r) => r.relname),
    [...NEW_TABLES, ...NEW_VIEWS].sort())
  assert.deepEqual((await q(`select tgname from pg_trigger where not tgisinternal and tgrelid = 'public.player_mlb_team_season_war'::regclass`)).map((r) => r.tgname), ['player_mlb_team_season_war_guard'])
  assert.equal((await one(`select count(*)::int as n from information_schema.columns where table_name = 'transaction_event_assets' and column_name = 'bref_id'`)).n, 1)
  assert.deepEqual(await failing(), [])
})

test('only the expected tables changed; scouting, development, network and the financial layer are untouched', async () => {
  const now = await tableHashes()
  const changed = Object.keys(now).filter((t) => pre.hashes[t] !== now[t]).sort()
  assert.deepEqual(changed, ['bref_team_code_map', 'evidence', 'outcomes', 'player_metric_observations', 'player_mlb_team_season_war', 'transaction_event_assets'])
  for (const t of ['player_evaluations', 'player_evaluation_grades', 'player_evaluation_rankings', 'player_season_stints', 'development_milestones', 'development_progression_decisions',
    'network_entities', 'network_entity_aliases', 'player_network_relationships', 'signings', 'signing_financial_reports', 'signing_financial_resolutions', 'signing_environments',
    'signing_environment_financial_reports', 'transactions', 'transaction_events', 'transaction_return_metrics', 'sources', 'outcome_audits']) {
    assert.equal(now[t], pre.hashes[t], `${t} is unchanged`)
  }
})

test('rerun is a no-op: no row, grant, policy or definition changes', async () => {
  const snap = async () => ({ hashes: await tableHashes(), acl: await q(`select c.relname, coalesce(array_to_string(c.relacl, ','), '') as acl from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v') order by 1`),
    policies: await q(`select tablename, policyname, cmd from pg_policies where schemaname = 'public' order by 1, 2`),
    defs: await q(`select relname, pg_get_viewdef(oid) as d from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v' order by 1`) })
  const first = await snap()
  await chain.db.exec(sql032)
  assert.deepEqual(await snap(), first)
})

// ---------------------------------------------------------------------------------------------
// the facts
// ---------------------------------------------------------------------------------------------

test('B-Ref source and filter reproducibility: checksums, row counts and the parsed-row hash match the committed artifacts', async () => {
  assert.equal(seed.source_files.bat.sha256, config.files.bat.sha256)
  assert.equal(seed.source_files.pitch.sha256, config.files.pitch.sha256)
  assert.equal(audit.seed.parsed_rows_sha256, seed.parsed_rows_sha256)
  const body = { war_system: 'BWAR', rows: seed.rows }
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex'), seed.parsed_rows_sha256)
  assert.deepEqual([seed.row_count, seed.components.BAT, seed.components.PITCH, seed.scope.bref_ids.length], [754, 504, 250, 50])
  assert.deepEqual(await one(`select count(*)::int as n, count(*) filter (where component = 'BAT')::int as bat, count(*) filter (where component = 'PITCH')::int as pitch,
    count(distinct bref_id)::int as players, count(*) filter (where war is null)::int as null_war from player_mlb_team_season_war where record_status = 'ACTIVE'`),
    { n: 754, bat: 504, pitch: 250, players: 50, null_war: 36 })
  assert.equal(seed.scope.disi_players, 47)
  assert.equal(seed.scope.return_assets, 3)
})

test('uniqueness: BAT and PITCH coexist, traded seasons carry several stints, a duplicate ACTIVE key is refused', async () => {
  // Ryu 2013 has a BAT and a PITCH row; Kenley Jansen / others have none with two teams, but the key allows it
  assert.deepEqual((await q(`select component from player_mlb_team_season_war where bref_id = 'ryuhy01' and season = 2013 order by 1`)).map((r) => r.component), ['BAT', 'PITCH'])
  assert.equal((await one(`select count(*)::int as n from (select bref_id, season from player_mlb_team_season_war where record_status = 'ACTIVE' group by 1, 2 having count(distinct bref_team_code) > 1) t`)).n > 0, true, 'a traded season exists')
  const dup = `insert into player_mlb_team_season_war (bref_id, season, bref_team_code, organization_id, stint_ordinal, component, war, source_id, observed_through_date, observed_through_season, retrieved_at, confidence)
    select bref_id, season, bref_team_code, organization_id, stint_ordinal, component, war, source_id, observed_through_date, observed_through_season, retrieved_at, confidence
    from player_mlb_team_season_war where bref_id = 'ryuhy01' and season = 2013 and component = 'PITCH'`
  assert.match(await attempt(dup), /active_key|duplicate/)
  // the same player, season and component on a different stint is a different fact
  assert.equal(await attempt(`${dup.replace('stint_ordinal, component, war', 'stint_ordinal, component, war').replace('select bref_id, season, bref_team_code, organization_id, stint_ordinal,', 'select bref_id, season, bref_team_code, organization_id, stint_ordinal + 5,')}`), 'accepted')
})

test('team-code map: complete for every loaded row; an unmapped code stays visible and queued; a wrong organization is refused', async () => {
  assert.equal((await one(`select count(*)::int as n from player_mlb_team_season_war where organization_id is null`)).n, 0)
  assert.deepEqual((await q(`select bref_team_code, count(*)::int as n from player_mlb_team_season_war w where not exists (select 1 from bref_team_code_map m where m.bref_team_code = w.bref_team_code
    and w.season >= m.from_season and w.season <= coalesce(m.to_season, 9999)) group by 1`)), [])
  // BRO and LAD both resolve to the Dodgers franchise; MON and WSN to the Nationals; ANA, CAL and LAA to the Angels
  assert.deepEqual((await q(`select m.bref_team_code, o.franchise_key from bref_team_code_map m join organizations o on o.id = m.organization_id where m.bref_team_code in ('BRO', 'LAD', 'MON', 'WSN', 'CAL', 'ANA', 'LAA', 'FLA', 'TBD') order by 1`))
    .map((r) => `${r.bref_team_code}:${r.franchise_key}`), ['ANA:LAA', 'BRO:DODGERS', 'CAL:LAA', 'FLA:MIA', 'LAA:LAA', 'LAD:DODGERS', 'MON:WSH', 'TBD:TB', 'WSN:WSH'])
  await inTxn(async () => {
    const base = `insert into player_mlb_team_season_war (bref_id, season, bref_team_code, organization_id, stint_ordinal, component, war, source_id, observed_through_date, observed_through_season, retrieved_at, confidence)
      select 'ryuhy01', 2013, 'ZZZ', ORG, 9, 'BAT', 0.10, source_id, observed_through_date, observed_through_season, retrieved_at, confidence from player_mlb_team_season_war where bref_id = 'ryuhy01' limit 1`
    assert.equal(await attempt(base.replace('ORG', 'null')), 'accepted', 'an unmapped code is stored with organization NULL')
    assert.match(await attempt(base.replace('ORG', `(select id from organizations where abbreviation = 'LAD')`)), /does not match the team-code mapping/)
    await chain.db.exec(base.replace('ORG', 'null'))
    assert.deepEqual((await q(`select issue from v_value_research_queue where issue = 'TEAM_HISTORY_UNRESOLVED'`)).length, 1)
    assert.deepEqual(await failing(), [], 'an unresolvable code is a visible research item, not a verifier failure')
  })
})

test('career reconciliation: loaded totals agree with the legacy stores; Frias, Cedeno and Leonard are backfilled from the facts', async () => {
  const rows = await q(`select p.slug, p.bref_id, sum(w.war)::numeric as total, oc.career_war::text as outcomes_war, (select value::text from player_metric_observations m where m.player_id = p.id and m.metric_key = 'CAREER_BWAR') as metric_bwar
    from players p join player_mlb_team_season_war w on w.player_id = p.id and w.record_status = 'ACTIVE' left join outcomes oc on oc.player_id = p.id group by p.id, p.slug, p.bref_id, oc.career_war`)
  assert.equal(rows.length, 47)
  for (const r of rows) {
    const legacy = Number(r.metric_bwar ?? r.outcomes_war)
    assert.ok(Math.abs(Number(r.total) - legacy) <= 0.1, `${r.slug}: ${r.total} vs ${legacy}`)
    assert.ok(r.outcomes_war !== null && r.metric_bwar !== null, `${r.slug}: both legacy stores are populated`)
    assert.ok(Math.abs(Number(r.outcomes_war) - Number(r.metric_bwar)) <= 0.1, `${r.slug}: the stores agree`)
  }
  const by = Object.fromEntries(rows.map((r) => [r.slug, r]))
  assert.deepEqual([by['carlos-frias'].outcomes_war, by['carlos-frias'].metric_bwar, Number(by['carlos-frias'].total)], ['-0.300', '-0.300', -0.34])
  assert.deepEqual([by['roger-cedeno'].outcomes_war, by['roger-cedeno'].metric_bwar, Number(by['roger-cedeno'].total)], ['1.700', '1.700', 1.69])
  assert.deepEqual([by['eddys-leonard'].outcomes_war, by['eddys-leonard'].metric_bwar, Number(by['eddys-leonard'].total)], ['-0.200', '-0.200', -0.21])
  assert.equal((await one(`select count(*)::int as n from evidence where entity_type = 'player' and field_name = 'career_war'`)).n, 2, 'field-level provenance for the two outcomes backfills')
  assert.deepEqual(await q(`select p.slug, m.value::text as v, m.observed_through_date::text as d, m.observed_through_season as s, so.url from player_metric_observations m join players p on p.id = m.player_id
    join sources so on so.id = m.source_id where p.slug = 'eddys-leonard'`), [{ slug: 'eddys-leonard', v: '-0.200', d: '2026-09-28', s: 2026, url: config.files.bat.url }])
  // no fWAR was introduced
  assert.equal((await one(`select count(*)::int as n from player_metric_observations where metric_key = 'CAREER_FWAR'`)).n, 0)
  assert.match(await attempt(`update player_mlb_team_season_war set war_system = 'FWAR' where bref_id = 'ryuhy01'`), /sealed|war_system/)
})

test('Dodgers versus non-Dodgers: Ryu, Cruz, Alvarez and a Brooklyn / Los Angeles franchise player split exactly', async () => {
  const ryu = await rowFor('hyun-jin-ryu')
  assert.deepEqual([num(ryu.direct_dodgers_mlb_bwar), num(ryu.non_dodgers_mlb_bwar), num(ryu.team_season_career_bwar)], [15.13, 5.06, 20.19])
  assert.equal(num(ryu.direct_dodgers_mlb_bwar) + num(ryu.non_dodgers_mlb_bwar), num(ryu.team_season_career_bwar), 'the split sums to the career total')
  assert.equal(num(ryu.known_acquisition_cost_usd), 30737737.33)
  assert.equal(num(ryu.direct_dodgers_bwar_per_million), 0.492, 'the cost-aware metric uses the complete acquisition cost, not the $5M bonus')
  const cruz = await rowFor('oneil-cruz')
  assert.deepEqual([num(cruz.direct_dodgers_mlb_bwar), num(cruz.non_dodgers_mlb_bwar), cruz.organizational_realization_status], [0, 8.17, 'MLB_ELSEWHERE_ONLY'])
  const alv = await rowFor('yordan-alvarez')
  assert.deepEqual([num(alv.direct_dodgers_mlb_bwar), num(alv.non_dodgers_mlb_bwar)], [0, 30.9])
  // franchise-level organization: Brooklyn and Los Angeles seasons both count as the Dodgers
  const amoros = await one(`select sum(w.war) filter (where o.franchise_key = 'DODGERS')::text as lad, string_agg(distinct w.bref_team_code, ',' order by w.bref_team_code) as codes
    from player_mlb_team_season_war w join organizations o on o.id = w.organization_id where w.bref_id = 'amorosa01'`)
  assert.match(amoros.codes, /BRO/)
  assert.equal(num((await rowFor('sandy-amoros')).direct_dodgers_mlb_bwar), num(amoros.lad))
})

test('reacquisition-safe: every later Dodgers stint counts, and other organizations never do', async () => {
  await inTxn(async () => {
    const add = (season, team, stint, war) => `insert into player_mlb_team_season_war (bref_id, season, bref_team_code, organization_id, stint_ordinal, component, war, source_id, observed_through_date,
      observed_through_season, retrieved_at, confidence) select 'machama01', ${season}, '${team}', (select organization_id from bref_team_code_map where bref_team_code = '${team}' and ${season} between from_season and coalesce(to_season, 9999) limit 1),
      ${stint}, 'PITCH', ${war}, source_id, observed_through_date, observed_through_season, retrieved_at, confidence from player_mlb_team_season_war where bref_id = 'machama01' limit 1`
    await chain.db.exec(`${add(2019, 'SDP', 1, 3.0)}; ${add(2021, 'LAD', 1, 1.5)}`)
    const e = await one(`select incoming_dodgers_bwar::text as w from v_trade_realization_edges where incoming_asset_name = 'Manny Machado'`)
    assert.equal(e.w, '4.08', '2.58 (2018) + 1.50 (a later Dodgers stint); the 3.0 for San Diego is never credited')
  })
})

// Synthetic fixtures for the acquisition boundary. A return asset's Dodgers value starts at the acquisition in that
// specific transaction; earlier Dodgers stints belong to the player's direct career value, never to the trade return.
async function timingFixture(bref, date, rows, { outgoing = null } = {}) {
  const add = ([season, team, stint, war]) => `insert into player_mlb_team_season_war (bref_id, season, bref_team_code, organization_id, stint_ordinal, component, war, source_id,
      observed_through_date, observed_through_season, retrieved_at, confidence)
    select '${bref}', ${season}, '${team}', (select organization_id from bref_team_code_map where bref_team_code = '${team}' and ${season} between from_season and coalesce(to_season, 9999) limit 1),
      ${stint}, 'BAT', ${war}, source_id, observed_through_date, observed_through_season, retrieved_at, confidence from player_mlb_team_season_war where bref_id = 'machama01' limit 1`
  await chain.db.exec(rows.map(add).join(';\n'))
  await chain.db.exec(`insert into transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description)
    select 'TEST_${bref}', date '${date}', 'TRADE', (select id from organizations where abbreviation = 'LAD'), (select id from organizations where abbreviation = 'ATL'), 'synthetic'`)
  await chain.db.exec(`insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type, bref_id)
    select id, 'INCOMING', 'Synthetic ${bref}', 'PLAYER', '${bref}' from transaction_events where event_key = 'TEST_${bref}'`)
  if (outgoing) {
    await chain.db.exec(`insert into transaction_event_assets (event_id, asset_side, player_id, asset_name, asset_type)
      select e.id, 'OUTGOING', p.id, p.full_name, 'PLAYER' from transaction_events e, players p where e.event_key = 'TEST_${bref}' and p.slug = '${outgoing}'`)
  }
  return one(`select * from v_trade_realization_edges where event_key = 'TEST_${bref}'`)
}
const totals = (bref) => one(`select
  coalesce(sum(w.war) filter (where o.franchise_key = 'DODGERS'), 0)::text as direct,
  coalesce(sum(w.war) filter (where o.franchise_key is distinct from 'DODGERS'), 0)::text as non_dodgers
  from player_mlb_team_season_war w join organizations o on o.id = w.organization_id where w.bref_id = $1`, [bref])

test('acquisition boundary: an early same-season Dodgers stint is direct career value and never trade return; the post-acquisition stint is', async () => {
  await inTxn(async () => {
    // LAD (stint 1, 0.5) -> ATL (stint 2, 0.3, the counterparty) -> LAD again via the modeled trade (stint 3, 1.2); SDP 4.0 in 2020; LAD 0.7 in 2021
    const e = await timingFixture('synthxx01', '2019-07-15', [[2019, 'LAD', 1, 0.5], [2019, 'ATL', 2, 0.3], [2019, 'LAD', 3, 1.2], [2020, 'SDP', 1, 4.0], [2021, 'LAD', 1, 0.7]], { outgoing: 'carlos-frias' })
    assert.equal(e.acquisition_timing_status, 'RESOLVED_BY_COUNTERPARTY_STINT_ORDER')
    assert.equal(e.same_season_timing_resolved, true)
    assert.equal(e.counterparty_franchise_key, 'ATL')
    assert.equal(e.acquisition_season, 2019)
    assert.equal(e.incoming_war_status, 'LOADED')
    assert.equal(num(e.incoming_dodgers_bwar), 1.9, 'post-acquisition 2019 stint (1.2) plus the 2021 Dodgers season (0.7)')
    assert.equal(num(e.pre_acquisition_dodgers_bwar_excluded), 0.5)
    assert.equal(e.pre_acquisition_dodgers_stint_rows, 1)
    assert.equal(e.unresolved_same_season_dodgers_bwar, null)
    const t = await totals('synthxx01')
    assert.equal(num(t.direct), 2.4, 'direct Dodgers career value includes every Dodgers stint: 0.5 + 1.2 + 0.7')
    assert.equal(num(t.non_dodgers), 4.3, 'other organizations stay separate (0.3 ATL + 4.0 SDP) and are never in the return')
    assert.equal(Math.round((num(e.incoming_dodgers_bwar) + num(e.pre_acquisition_dodgers_bwar_excluded)) * 100), Math.round(num(t.direct) * 100), 'no Dodgers WAR is counted twice or dropped')
    // the sole outgoing player receives exactly the post-acquisition value
    const p = await rowFor('carlos-frias')
    assert.deepEqual([p.package_attribution_state, num(p.individually_attributable_trade_return_bwar)], ['SOLE_OUTGOING_ATTRIBUTABLE', 1.9])
    assert.deepEqual(await failing(), [])
  })
})

test('acquisition boundary: a same-season Dodgers stint that cannot be ordered leaves the return NULL, never zero and never the whole season', async () => {
  await inTxn(async () => {
    // one Dodgers stint in the acquisition season and no counterparty stint to order it against; a complete later season exists
    const e = await timingFixture('synthyy01', '2019-07-15', [[2019, 'LAD', 1, 0.9], [2020, 'LAD', 1, 2.0]], { outgoing: 'carlos-frias' })
    assert.equal(e.acquisition_timing_status, 'UNRESOLVED_SAME_SEASON_STINT_ORDER')
    assert.equal(e.same_season_timing_resolved, false)
    assert.equal(e.incoming_war_status, 'TIMING_UNRESOLVED')
    assert.equal(e.incoming_dodgers_bwar, null)
    assert.equal(num(e.dodgers_bwar_complete_seasons_after_acquisition), 2, 'complete later seasons stay countable as an auditable lower bound')
    assert.equal(num(e.unresolved_same_season_dodgers_bwar), 0.9)
    assert.equal(e.derived_minus_legacy_war, null)
    const p = await rowFor('carlos-frias')
    assert.deepEqual([p.package_attribution_state, p.individually_attributable_trade_return_bwar, p.attributable_organizational_bwar], ['RETURN_WAR_UNKNOWN', null, null])
    assert.equal(p.trade_package_return_dodgers_bwar, null, 'a package return is never a partial sum')
    assert.deepEqual(await q(`select issue, event_key from v_value_research_queue where issue = 'TRADE_RETURN_TIMING_UNRESOLVED'`), [{ issue: 'TRADE_RETURN_TIMING_UNRESOLVED', event_key: 'TEST_synthyy01' }])
    assert.deepEqual(await failing(), [])
  })
})

test('acquisition boundary: offseason trades resolve from the calendar; the canonical return assets are unchanged and none is unresolved', async () => {
  await inTxn(async () => {
    const after = await timingFixture('synthzz01', '2019-12-10', [[2019, 'LAD', 1, 0.8], [2020, 'LAD', 1, 1.1]])
    assert.deepEqual([after.acquisition_timing_status, num(after.incoming_dodgers_bwar), num(after.pre_acquisition_dodgers_bwar_excluded)], ['OFFSEASON_AFTER_SEASON', 1.1, 0.8])
    const before = await timingFixture('synthww01', '2020-01-20', [[2019, 'LAD', 1, 0.8], [2020, 'LAD', 1, 1.1]])
    assert.deepEqual([before.acquisition_timing_status, num(before.incoming_dodgers_bwar), num(before.pre_acquisition_dodgers_bwar_excluded)], ['OFFSEASON_BEFORE_SEASON', 1.1, 0.8])
  })
  const edges = Object.fromEntries((await q(`select * from v_trade_realization_edges`)).map((e) => [e.incoming_asset_name, e]))
  for (const [name, expected] of [['Josh Fields', 1.94], ['Tony Watson', 0.4], ['Manny Machado', 2.58]]) {
    assert.equal(num(edges[name].incoming_dodgers_bwar), expected, String(name))
    assert.equal(edges[name].acquisition_timing_status, 'RESOLVED_BY_COUNTERPARTY_STINT_ORDER', String(name))
    assert.equal(edges[name].pre_acquisition_dodgers_stint_rows, 0, String(name))
  }
  assert.equal((await one(`select count(*)::int as n from v_value_research_queue where issue = 'TRADE_RETURN_TIMING_UNRESOLVED'`)).n, 0)
})

test('trade realization: sole outgoing is attributable; shared packages are package-level with NULL individual credit; one hop only', async () => {
  const edges = Object.fromEntries((await q(`select * from v_trade_realization_edges`)).map((e) => [e.incoming_asset_name, e]))
  assert.deepEqual([edges['Josh Fields'].individual_attribution_permitted, edges['Josh Fields'].attribution_status], [true, 'SOLE_OUTGOING_ASSET'])
  assert.deepEqual([edges['Tony Watson'].individual_attribution_permitted, edges['Tony Watson'].outgoing_asset_count], [false, 2])
  assert.deepEqual([edges['Manny Machado'].individual_attribution_permitted, edges['Manny Machado'].outgoing_asset_count, edges['Manny Machado'].tracked_outgoing_count], [false, 5, 1])
  const alv = await rowFor('yordan-alvarez')
  assert.deepEqual([num(alv.individually_attributable_trade_return_bwar), alv.package_attribution_state, alv.flag_trade_return_attributable, num(alv.attributable_organizational_bwar)], [1.94, 'SOLE_OUTGOING_ATTRIBUTABLE', true, 1.94])
  assert.equal(alv.attributable_value_basis, 'DIRECT_PLUS_SOLE_OUTGOING_RETURN')
  const cruz = await rowFor('oneil-cruz')
  assert.deepEqual([num(cruz.trade_package_return_dodgers_bwar), cruz.individually_attributable_trade_return_bwar, cruz.package_attribution_state, cruz.flag_trade_return_package_only], [0.4, null, 'SHARED_PACKAGE_NOT_ATTRIBUTABLE', true])
  assert.equal(cruz.attributable_value_basis, 'DIRECT_ONLY_SHARED_PACKAGE_RETURN_EXCLUDED')
  assert.equal(num(cruz.attributable_organizational_bwar), 0, 'the package return is never added to the individual')
  const diaz = await rowFor('yusniel-diaz')
  assert.deepEqual([num(diaz.trade_package_return_dodgers_bwar), diaz.individually_attributable_trade_return_bwar, diaz.package_attribution_state], [2.58, null, 'SHARED_PACKAGE_NOT_ATTRIBUTABLE'])
  // return identities and the legacy comparison
  assert.deepEqual((await q(`select asset_name, bref_id from transaction_event_assets where bref_id is not null order by 1`)),
    [{ asset_name: 'Josh Fields', bref_id: 'fieldjo03' }, { asset_name: 'Manny Machado', bref_id: 'machama01' }, { asset_name: 'Tony Watson', bref_id: 'watsoto01' }])
  assert.deepEqual([num(edges['Josh Fields'].derived_minus_legacy_war), num(edges['Tony Watson'].derived_minus_legacy_war), num(edges['Manny Machado'].derived_minus_legacy_war)], [-0.06, 0, -0.02])
  // old return metrics are kept
  assert.equal((await one(`select count(*)::int as n from transaction_return_metrics`)).n, 3)
  // one hop: a later recorded transaction only raises the flag; it adds no value
  await inTxn(async () => {
    const before = await rowFor('yordan-alvarez')
    await chain.db.exec(`insert into transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description)
      select 'TEST_LATER', date '2019-07-01', 'TRADE', (select id from organizations where abbreviation = 'LAD'), (select id from organizations where abbreviation = 'ATL'), 'test'`)
    await chain.db.exec(`insert into transaction_event_assets (event_id, asset_side, asset_name, asset_type, bref_id) select id, 'OUTGOING', 'Josh Fields', 'PLAYER', 'fieldjo03' from transaction_events where event_key = 'TEST_LATER'`)
    const afterRow = await rowFor('yordan-alvarez')
    assert.equal(afterRow.downstream_asset_chain_incomplete, true)
    assert.equal(num(afterRow.attributable_organizational_bwar), num(before.attributable_organizational_bwar))
    assert.equal((await one(`select count(*)::int as n from v_value_research_queue where issue = 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE'`)).n, 1)
  })
})

test('cost gating: ratios exist only for COMPLETE mature observed rows; PARTIAL, UNKNOWN, NO_RULE and recent rows get none', async () => {
  const gate = async (slug) => one(`select acquisition_cost_completeness as c, known_acquisition_cost_usd::text as cost, cost_metric_eligible as e, ratio_suppression_reason as why, direct_dodgers_bwar_per_million::text as ratio
    from v_player_organizational_realization where player_slug = $1`, [slug])
  assert.deepEqual(await gate('julio-urias'), { c: 'PARTIAL', cost: '450000.00', e: false, why: 'ACQUISITION_COST_PARTIAL', ratio: null })
  assert.equal((await gate('carlos-frias')).ratio, null)
  assert.deepEqual([(await gate('hung-chih-kuo')).c, (await gate('hung-chih-kuo')).ratio], ['NO_RULE', null])
  assert.deepEqual([(await gate('josue-de-paula')).why, (await gate('josue-de-paula')).ratio], ['RECENT_SIGNING', null])
  assert.deepEqual([(await gate('andy-pages')).e, (await gate('andy-pages')).ratio], [true, '36.400'])
  assert.equal((await one(`select count(*)::int as n from v_player_organizational_realization where direct_dodgers_bwar_per_million is not null and acquisition_cost_completeness <> 'COMPLETE'`)).n, 0)
  assert.deepEqual(await failing(), [])
})

test('aggregate methodology: SUM(value) / SUM(cost) over the same eligible rows, never the average of ratios', async () => {
  const all = await one(`select * from v_dodgers_international_value_portfolio where grain = 'ALL'`)
  const calc = await one(`select sum(direct_dodgers_mlb_bwar)::numeric as w, sum(known_acquisition_cost_usd)::numeric as c, avg(direct_dodgers_bwar_per_million)::numeric as avg_ratio, count(*)::int as n
    from v_player_organizational_realization where cost_metric_eligible`)
  assert.equal(all.direct_ratio_eligible_signings, calc.n)
  assert.equal(Number(all.eligible_direct_dodgers_bwar), Number(calc.w))
  assert.equal(Number(all.eligible_known_acquisition_cost_usd), Number(calc.c))
  assert.equal(Number(all.aggregate_direct_dodgers_bwar_per_million), Math.round((Number(calc.w) / (Number(calc.c) / 1e6)) * 1000) / 1000)
  assert.notEqual(Number(all.aggregate_direct_dodgers_bwar_per_million), Math.round(Number(calc.avg_ratio) * 1000) / 1000, 'not an average of player ratios')
  assert.match(all.population_label, /not an organization-wide rate/)
  // small eligible sets are flagged
  const small = await one(`select direct_ratio_small_sample as s from v_dodgers_international_value_portfolio where grain = 'SIGNING_ERA' and grain_value = '2000-2011'`)
  assert.equal(small.s, true)
  // the legacy KPI definition is unchanged and still an average of ratios
  assert.equal(md5((await one(`select pg_get_viewdef('public.v_dodgers_executive_kpis'::regclass) as d`)).d), pre.kpiDef)
  const kpi = await one(`select * from v_dodgers_executive_kpis`)
  assert.equal(kpi.avg_career_war_per_million_known_bonus, pre.kpi.avg_career_war_per_million_known_bonus)
  // observed_total_career_war moves by exactly the two backfilled values (-0.3 + 1.7)
  assert.equal(Math.round((Number(kpi.observed_total_career_war) - Number(pre.kpi.observed_total_career_war)) * 10) / 10, 1.4)
})

test('maturity and status: reproducible as-of date, the legacy flag is reproduced, recent players are never failures', async () => {
  const asOf = await one(`select max(audited_through_date)::text as d from outcome_audits`)
  assert.equal((await one(`select analysis_as_of_date::text as d from v_player_organizational_realization limit 1`)).d, asOf.d)
  assert.equal((await one(`select count(*)::int as n from v_player_organizational_realization r join v_dodgers_outcome_coverage c on c.player_id = r.player_id
    where (r.maturity_status = 'MATURE') is distinct from c.mature_5yr_cohort`)).n, 0)
  const defs = (await q(`select pg_get_viewdef(c.oid) as d from pg_class c where c.relname = any($1)`, [NEW_VIEWS])).map((r) => r.d).join('\n')
  assert.doesNotMatch(defs, /current_date|now\(\)|2026-10-03/i)
  assert.deepEqual(Object.fromEntries((await q(`select organizational_realization_status as k, count(*)::int as n from v_player_organizational_realization group by 1`)).map((r) => [r.k, r.n])),
    { DIRECT_DODGERS_MLB_VALUE: 38, MLB_ELSEWHERE_ONLY: 9, NO_MLB_VALUE_OBSERVED: 41, OUTCOME_INCOMPLETE: 8, STILL_DEVELOPING: 4, TOO_RECENT_TO_EVALUATE: 120 })
  assert.equal((await one(`select count(*)::int as n from v_player_organizational_realization where maturity_status = 'RECENT' and organizational_realization_status = 'NO_MLB_VALUE_OBSERVED'`)).n, 0)
  const sasaki = await rowFor('roki-sasaki')
  assert.deepEqual([sasaki.organizational_realization_status, sasaki.maturity_status, num(sasaki.direct_dodgers_mlb_bwar), sasaki.acquisition_cost_completeness], ['DIRECT_DODGERS_MLB_VALUE', 'RECENT', 1.14, 'PARTIAL'])
  const depaula = await rowFor('josue-de-paula')
  assert.deepEqual([depaula.organizational_realization_status, depaula.maturity_status], ['DIRECT_DODGERS_MLB_VALUE', 'RECENT'])
  // value is NULL, not zero, where the outcome is open
  assert.equal((await one(`select count(*)::int as n from v_player_organizational_realization where team_history_status = 'NOT_APPLICABLE_OUTCOME_OPEN' and direct_dodgers_mlb_bwar is not null`)).n, 0)
})

test('research queue: derived issues, nothing hard-coded, no network or scouting attribution anywhere', async () => {
  assert.deepEqual(Object.fromEntries((await q(`select issue as k, count(*)::int as n from v_value_research_queue group by 1`)).map((r) => [r.k, r.n])),
    { ACQUISITION_COST_INCOMPLETE: 33, OUTCOME_INCOMPLETE: 8, TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED: 2, TRADE_RECORD_MISSING: 5 })
  assert.deepEqual((await q(`select player_slug from v_value_research_queue where issue = 'TRADE_RECORD_MISSING' order by 1`)).map((r) => r.player_slug),
    ['carlos-santana', 'jorbit-vivas', 'juan-guzman', 'roberto-clemente', 'eddys-leonard'].sort())
  // a verified player with no loaded rows is queued
  await inTxn(async () => {
    await chain.db.exec(`set local session_replication_role = replica; delete from player_mlb_team_season_war where bref_id = 'cruzon01'`)
    assert.equal((await one(`select count(*)::int as n from v_value_research_queue where issue = 'TEAM_WAR_MISSING' and player_slug = 'oneil-cruz'`)).n, 1)
    assert.equal((await rowFor('oneil-cruz')).direct_dodgers_mlb_bwar, null, 'unknown, not zero')
  })
  const cols = await q(`select c.relname, a.attname from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relname = any($1) and a.attnum > 0`, [NEW_VIEWS])
  assert.deepEqual(cols.filter((c) => /network|trainer|academy|program|fwar|scout|rank|fv\b|dollar|usd_value|surplus/i.test(c.attname)), [])
  const defs = (await q(`select pg_get_viewdef(c.oid) as d from pg_class c where c.relname = any($1)`, [NEW_VIEWS])).map((r) => r.d).join('\n')
  assert.doesNotMatch(defs, /network_|player_evaluations|CAREER_FWAR/)
})

test('security: RLS and SELECT-only grants, invoker views, invoker-rights guard with no API EXECUTE; the verifier passes with 149 checks and catches its own drift', async () => {
  const t = await q(`select c.relname, c.relrowsecurity as rls from pg_class c where c.relname = any($1) order by 1`, [NEW_TABLES])
  assert.ok(t.every((r) => r.rls))
  const acl = await q(`select c.relname, coalesce(r.rolname, 'PUBLIC') as g, string_agg(a.privilege_type, ',' order by a.privilege_type) as p from pg_class c cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    left join pg_roles r on r.oid = a.grantee where c.relname = any($1) and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC') group by 1, 2`, [[...NEW_TABLES, ...NEW_VIEWS]])
  assert.equal(acl.length, 12)
  assert.ok(acl.every((a) => a.g !== 'PUBLIC' && a.p === 'SELECT'))
  assert.deepEqual(await q(`select tablename, cmd from pg_policies where tablename = any($1) and cmd <> 'SELECT'`, [NEW_TABLES]), [])
  assert.ok((await q(`select coalesce(array_to_string(reloptions, ','), '') as o from pg_class where relname = any($1)`, [NEW_VIEWS])).every((v) => /security_invoker=(true|on)/.test(v.o)))
  const full = await checkInvariants(chain.query)
  assert.deepEqual(failedChecks(full).map((c) => c.name), [])
  assert.equal(full.hard.length, 149)
  assert.equal(VALUE_CHECK_NAMES.length, 10)
  // drift detection
  await inTxn(async () => {
    await chain.db.exec(`alter table player_mlb_team_season_war disable trigger player_mlb_team_season_war_guard;
      update player_mlb_team_season_war set organization_id = (select id from organizations where abbreviation = 'NYY') where bref_id = 'ryuhy01' and season = 2013 and component = 'PITCH'`)
    assert.ok((await failing()).includes('value_team_code_resolution_violations'))
  })
  await inTxn(async () => {
    await chain.db.exec(`alter table player_mlb_team_season_war disable trigger player_mlb_team_season_war_guard;
      update player_mlb_team_season_war set war = war + 5 where bref_id = 'cruzon01' and season = 2021`)
    assert.ok((await failing()).includes('value_career_reconciliation_violations'))
  })
  await inTxn(async () => {
    await chain.db.exec(`update transaction_event_assets set bref_id = 'zzzzzz01' where asset_name = 'Josh Fields'`)
    assert.deepEqual(await failing(), ['value_event_asset_identity_violations'])
  })
  await inTxn(async () => {
    await chain.db.exec(`grant execute on function disi_team_season_war_guard() to anon;`)
    assert.deepEqual(await failing(), ['value_guard_violations'])
  })
  await inTxn(async () => {
    await chain.db.exec(`drop trigger player_mlb_team_season_war_guard on player_mlb_team_season_war;`)
    assert.deepEqual(await failing(), ['value_guard_violations'])
  })
  // sealing
  assert.match(await attempt(`delete from player_mlb_team_season_war where bref_id = 'ryuhy01'`), /never deleted/)
  assert.match(await attempt(`update player_mlb_team_season_war set war = 1 where bref_id = 'ryuhy01' and season = 2013 and component = 'BAT'`), /sealed/)
  assert.match(await attempt(`insert into player_mlb_team_season_war (bref_id, season, bref_team_code, organization_id, stint_ordinal, component, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, war_system)
    select 'ryuhy01', 2013, 'LAD', (select organization_id from bref_team_code_map where bref_team_code = 'LAD'), 3, 'BAT', source_id, observed_through_date, observed_through_season, retrieved_at, confidence, 'FWAR' from player_mlb_team_season_war limit 1`), /war_system_check|check/)
})

test('a fresh 001-032 replay equals the 001-031 database with 032 applied', async () => {
  const fresh = await buildCanonicalChain()
  try {
    const content = async (query) => ({
      facts: await query(`select bref_id, season, bref_team_code, stint_ordinal, component, war::text as war, games, plate_appearances, ip_outs, league, war_system, record_status,
        (select abbreviation from organizations o where o.id = organization_id) as org, (select slug from players p where p.id = player_id) as slug from player_mlb_team_season_war order by 1, 2, 3, 4, 5`),
      map: await query(`select m.bref_team_code, o.abbreviation, m.from_season, m.to_season from bref_team_code_map m join organizations o on o.id = m.organization_id order by 1, 3`),
      assets: await query(`select e.event_key, a.asset_side, a.asset_name, a.bref_id from transaction_event_assets a join transaction_events e on e.id = a.event_id order by 1, 2, 3`),
      stores: await query(`select p.slug, oc.career_war::text as outcomes_war, (select value::text from player_metric_observations m where m.player_id = p.id and m.metric_key = 'CAREER_BWAR') as metric from players p join outcomes oc on oc.player_id = p.id order by 1`),
      realization: await query(`select player_slug, direct_dodgers_mlb_bwar::text as d, non_dodgers_mlb_bwar::text as n, trade_package_return_dodgers_bwar::text as p, individually_attributable_trade_return_bwar::text as i,
        organizational_realization_status as s, maturity_status as m, direct_dodgers_bwar_per_million::text as r from v_player_organizational_realization order by 1`),
      edges: await query(`select event_key, incoming_asset_name, incoming_dodgers_bwar::text as w, attribution_status from v_trade_realization_edges order by 1, 2`),
      portfolio: await query(`select grain, grain_value, tracked_signings, direct_ratio_eligible_signings, aggregate_direct_dodgers_bwar_per_million::text as r from v_dodgers_international_value_portfolio order by 1, 2`),
      queue: await query(`select issue, player_slug, detail from v_value_research_queue order by 1, 2, 3`),
    })
    assert.deepEqual(await content(fresh.query), await content(chain.query))
  } finally {
    await fresh.close()
  }
})
