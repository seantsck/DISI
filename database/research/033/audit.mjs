#!/usr/bin/env node
// Offline audit for Migration 033. Builds the canonical chain through 032 in memory (no network, no real database)
// and checks every fact the migration's preconditions, seed and derived rules depend on. Exits non-zero on any failure.
//
//   node database/research/033/audit.mjs   ->  database/research/033/audit-report.json

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(fs.readFileSync(path.join(here, 'event-seed.json'), 'utf8'))
const war = JSON.parse(fs.readFileSync(path.join(here, 'war-seed.json'), 'utf8'))
const config = JSON.parse(fs.readFileSync(path.join(here, 'scope-config.json'), 'utf8'))
const failures = []
const check = (label, ok) => { if (!ok) failures.push(label) }

const ch = await buildChainThrough('032_player_value_organizational_realization.sql')
const q = ch.query
const one = async (sql, params) => (await q(sql, params))[0]

// ---- baseline ----------------------------------------------------------------------------------------------------------
const totals = await one(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as tables,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as views`)
check('baseline is 56 tables / 101 views', totals.tables === 56 && totals.views === 101)
const present = (await q(`select relname from pg_class where relnamespace = 'public'::regnamespace and relname in ('transaction_asset_resolutions', 'dodgers_control_observations',
  'v_transaction_event_complete', 'v_transaction_asset_chain_readiness', 'v_dodgers_international_exit_summary', 'v_transaction_research_queue')`)).map((r) => r.relname)
check('no 033 object exists yet', present.length === 0)
const cols = (await q(`select column_name from information_schema.columns where table_name = 'transaction_event_assets'`)).map((r) => r.column_name)
check('transaction_event_assets has no 033 column yet', !cols.includes('mlb_id') && !cols.includes('bref_register_id') && !cols.includes('counterparty_organization_id'))
const evCols = (await q(`select column_name from information_schema.columns where table_name = 'transaction_events'`)).map((r) => r.column_name)
check('transaction_events has no 033 column yet', !evCols.includes('is_multi_team') && !evCols.includes('historical_label'))

// ---- the pre-existing transaction layer -----------------------------------------------------------------------------------
const events = await q(`select e.event_key, e.transaction_date::text as d, e.transaction_type from transaction_events e order by 1`)
check('exactly three pre-existing events', events.length === 3)
const seedByKey = new Map(seed.events.map((e) => [e.key, e]))
for (const e of events) {
  const s = seedByKey.get(e.event_key)
  check(`pre-existing event ${e.event_key} is in the reviewed data and marked existing`, Boolean(s) && s.existing === true)
  if (!s) continue
  const assets = await q(`select asset_side, asset_name, asset_type, player_id is not null as tracked from transaction_event_assets a join transaction_events x on x.id = a.event_id where x.event_key = $1`, [e.event_key])
  for (const a of assets) {
    const m = s.assets.find((x) => x.side === a.asset_side && x.name === a.asset_name)
    check(`${e.event_key}: existing asset ${a.asset_side} ${a.asset_name} is in the reviewed data`, Boolean(m) && m.type === a.asset_type)
    if (m) check(`${e.event_key}: ${a.asset_name} tracked flag agrees`, Boolean(m.player_slug) === a.tracked)
  }
  check(`${e.event_key}: asset count agrees`, assets.length === s.assets.length)
  if (e.event_key === config.date_correction.event_key) check('the corrected event is dated with the value to correct', e.d === config.date_correction.from)
  else check(`${e.event_key}: date agrees (${e.d})`, e.d === s.date)
}
check('every non-existing reviewed event key is new', seed.events.filter((e) => !e.existing).every((e) => !events.some((x) => x.event_key === e.key)))
const legacy = await q(`select p.slug, t.transaction_date::text as d, t.transaction_type as type from transactions t join players p on p.id = t.player_id order by 1`)
check('five legacy transaction rows', legacy.length === 5)
for (const l of config.legacy_transactions) {
  const m = legacy.find((x) => x.slug === l.slug)
  const expected = l.slug === config.date_correction.player_slug ? config.date_correction.from : l.date
  check(`legacy row ${l.slug} is present with the date to reconcile`, Boolean(m) && m.d === expected && m.type === l.type)
}

// ---- tracked players and organizations -----------------------------------------------------------------------------------
const players = await q(`select slug, mlb_id, bref_id from players where slug = any($1)`, [[...new Set([...seed.events.flatMap((e) => e.assets.map((a) => a.player_slug)).filter(Boolean), ...seed.player_observations.map((o) => o.slug)])]])
const pmap = new Map(players.map((p) => [p.slug, p]))
for (const e of seed.events) for (const a of e.assets) {
  if (!a.player_slug) continue
  const p = pmap.get(a.player_slug)
  check(`${a.player_slug} exists`, Boolean(p))
  if (p) {
    check(`${a.player_slug}: MLB id agrees`, String(p.mlb_id) === a.mlb_id)
    if (a.bref_id) check(`${a.player_slug}: B-Ref id agrees`, p.bref_id === a.bref_id)
  }
}
const orgs = new Set((await q(`select abbreviation from organizations`)).map((r) => r.abbreviation))
for (const e of seed.events) {
  check(`${e.key}: organizations exist`, orgs.has(e.from_org) && (!e.to_org || orgs.has(e.to_org)))
  for (const a of e.assets) if (a.counterparty) check(`${e.key}: counterparty ${a.counterparty} exists`, orgs.has(a.counterparty))
}
for (const m of config.team_code_map_additions) check(`team code ${m.code} organization ${m.organization} exists`, orgs.has(m.organization))

// ---- partition and counts ------------------------------------------------------------------------------------------------
const dodgers = await one(`select count(*)::int as n from v_signing_acquisition_financials where is_dodgers`)
const exitSlugs = new Set(seed.events.flatMap((e) => e.assets.filter((a) => a.side === 'OUTGOING' && a.player_slug).map((a) => a.player_slug)))
const still = seed.player_observations.filter((o) => o.type === 'DODGERS_CONTROL_OBSERVED' || o.type === 'STILL_DODGERS_CONTROLLED')
const unavailable = seed.player_observations.filter((o) => o.type === 'HISTORY_UNAVAILABLE')
check('220 Dodgers signings', dodgers.n === 220)
check('no player is both exited and observed as still controlled', still.every((o) => !exitSlugs.has(o.slug)) && unavailable.every((o) => !exitSlugs.has(o.slug)))
const typeCounts = seed.events.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {})
check('161 events', seed.events.length === 161)
check('event types', JSON.stringify(typeCounts) === JSON.stringify({ RELEASE: 84, TRADE: 48, FREE_AGENCY: 26, RULE5_SELECTION: 1, EXPANSION_DRAFT: 1, WAIVER: 1 }) || (typeCounts.TRADE === 48 && typeCounts.RELEASE === 84 && typeCounts.FREE_AGENCY === 26 && typeCounts.RULE5_SELECTION === 1 && typeCounts.EXPANSION_DRAFT === 1 && typeCounts.WAIVER === 1))
check('138 exited players', exitSlugs.size === 138)
check('64 observed still controlled', still.length === 64)
check('2 history unavailable', unavailable.length === 2)
check('138 + 64 + 2 + 16 unverified = 220', exitSlugs.size + still.length + unavailable.length + (220 - exitSlugs.size - still.length - unavailable.length) === 220 && 220 - exitSlugs.size - still.length - unavailable.length === 16)

// ---- WAR seed ------------------------------------------------------------------------------------------------------------
check('40 persons / 573 rows', war.scope.persons === 40 && war.row_count === 573)
const loaded = new Set((await q(`select distinct bref_id from player_mlb_team_season_war`)).map((r) => r.bref_id))
check('no seeded WAR person is already loaded', war.scope.bref_ids.every((b) => !loaded.has(b)))
const srcUrls = (await q(`select url from sources where url = any($1)`, [Object.values(config.files).map((f) => f.url)])).map((r) => r.url)
check('both Baseball-Reference data file sources are registered', srcUrls.length === 2)

// ---- snapshot of the 032 analytics the migration is allowed to change ---------------------------------------------------------
const portfolio = await one(`select * from v_dodgers_international_value_portfolio where grain = 'ALL'`)
const perPlayer = await q(`select player_slug, direct_dodgers_mlb_bwar::text as direct, non_dodgers_mlb_bwar::text as non_dodgers, package_attribution_state,
  trade_package_return_dodgers_bwar::text as package_return, individually_attributable_trade_return_bwar::text as individual_return,
  attributable_organizational_bwar::text as attributable, downstream_asset_chain_incomplete as downstream from v_player_organizational_realization order by 1`)
const queue = await q(`select issue, count(*)::int as n from v_value_research_queue group by 1 order by 1`)
await ch.close()

const md5 = (v) => crypto.createHash('md5').update(JSON.stringify(v)).digest('hex')
const report = {
  audited_against: 'canonical replay 001-032 (in memory)',
  baseline: totals,
  seed: { events: seed.events.length, event_types: typeCounts, assets: seed.events.reduce((n, e) => n + e.assets.length, 0), exited_players: exitSlugs.size,
    still_controlled: still.length, history_unavailable: unavailable.length, resolutions: seed.resolutions.length, asset_observations: seed.asset_observations.length },
  war_seed: { persons: war.scope.persons, rows: war.row_count, components: war.components, parsed_rows_sha256: war.parsed_rows_sha256 },
  baseline_032: { portfolio_all: portfolio, per_player_md5: md5(perPlayer), per_player: perPlayer, queue },
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ baseline: totals, seed: report.seed, war_seed: report.war_seed, failures }, null, 2))
if (failures.length) { console.error(`audit failed (${failures.length})`); process.exit(1) }
