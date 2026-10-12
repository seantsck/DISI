#!/usr/bin/env node
// Audits the 034 research inputs against the canonical 001-033 replay (in memory, PGlite) and writes audit-report.json,
// including the 033 analytics baseline that Migration 034 is compared against.
//
//   node database/research/034/audit.mjs
//
// Checks: nothing the seed adds exists yet; every pre-existing asset the seed refers to exists exactly once; every researched
// outgoing PLAYER asset matches an existing or seeded incoming asset by stable identity (no name matching); every incoming
// PLAYER asset has an identity; the WAR seed covers every incoming asset with a Baseball-Reference id.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const seed = read('exit-seed.json')
const timing = read('timing-seed.json')
const war = read('war-seed.json')
const failures = []

const chain = await buildChainThrough('033_transaction_asset_chain_completion.sql')
const q = (s, p) => chain.query(s, p)
const baseline = {
  events: (await q('select count(*)::int as n from transaction_events'))[0].n,
  assets: (await q('select count(*)::int as n from transaction_event_assets'))[0].n,
  war_rows: (await q('select count(*)::int as n from player_mlb_team_season_war'))[0].n,
  resolutions: (await q('select count(*)::int as n from transaction_asset_resolutions'))[0].n,
  observations: (await q('select count(*)::int as n from dodgers_control_observations'))[0].n,
  downstream_flag: (await q('select count(*)::int as n from v_player_organizational_realization where downstream_asset_chain_incomplete'))[0].n,
}
if (baseline.events !== 161 || baseline.assets !== 291) failures.push(`unexpected 033 baseline: ${JSON.stringify(baseline)}`)

const existingKeys = new Set((await q('select event_key from transaction_events')).map((r) => r.event_key))
for (const e of seed.events) if (existingKeys.has(e.key)) failures.push(`event ${e.key} already exists`)

// identities known before 034 (incoming and outgoing assets of the 033 graph)
const known = await q(`select a.asset_side, a.asset_name, a.mlb_id, a.bref_id, a.bref_register_id from transaction_event_assets a where a.asset_type = 'PLAYER'`)
const incoming = new Map()
const idKeys = (a) => [a.mlb_id && `m:${a.mlb_id}`, a.bref_id && `b:${a.bref_id}`, a.bref_register_id && `r:${a.bref_register_id}`].filter(Boolean)
for (const a of known) if (a.asset_side === 'INCOMING') for (const k of idKeys(a)) incoming.set(k, a.asset_name)
for (const e of seed.events) for (const a of e.assets) if (a.side === 'INCOMING' && a.type === 'PLAYER') for (const k of idKeys(a)) incoming.set(k, a.name)
const unmatched = []
for (const e of seed.events) {
  for (const a of e.assets) {
    if (a.side !== 'OUTGOING' || a.type !== 'PLAYER') continue
    if (!idKeys(a).some((k) => incoming.has(k))) unmatched.push(`${e.key}: ${a.name}`)
  }
}

const seededAssetRefs = [...seed.asset_observations.map((o) => o.asset), ...timing.facts.map((t) => t.asset)]
for (const ref of seededAssetRefs) {
  if (seed.events.some((e) => e.key === ref.event)) continue
  const n = (await q(`select count(*)::int as n from transaction_event_assets a join transaction_events e on e.id = a.event_id where e.event_key = $1 and a.asset_side = $2 and a.asset_name = $3`,
    [ref.event, ref.side, ref.name]))[0].n
  if (n !== 1) failures.push(`asset ${ref.name} (${ref.event}) found ${n} times`)
}

const warPersons = new Set(war.rows.map((r) => r.bref_id))
const loaded = new Set((await q('select distinct bref_id from player_mlb_team_season_war')).map((r) => r.bref_id))
const alreadyLoaded = [...warPersons].filter((b) => loaded.has(b))
if (alreadyLoaded.length) failures.push(`WAR persons already loaded: ${alreadyLoaded.join(', ')}`)
const needWar = []
for (const e of seed.events) for (const a of e.assets) if (a.side === 'INCOMING' && a.type === 'PLAYER' && a.bref_id && !loaded.has(a.bref_id) && !warPersons.has(a.bref_id)) needWar.push(a.bref_id)
if (needWar.length) failures.push(`incoming assets without team-season facts: ${[...new Set(needWar)].join(', ')}`)

// the 033 analytics baseline the migration is compared against
const portfolio = (await q(`select * from v_dodgers_international_value_portfolio where grain = 'ALL'`))[0]
const legacy = await q(`select player_slug, direct_dodgers_mlb_bwar::text as direct, trade_package_return_dodgers_bwar::text as package_return,
  individually_attributable_trade_return_bwar::text as individually_attributable, package_attribution_state as state, downstream_asset_chain_incomplete as downstream_flag
  from v_player_organizational_realization order by player_slug`)
const edges = await q(`select event_key, incoming_asset_name, return_state, incoming_dodgers_bwar::text as bwar from v_trade_realization_edges order by event_key, incoming_asset_name`)
await chain.close()

const report = {
  generated_by: 'database/research/034/audit.mjs',
  baseline,
  failures,
  unmatched_outgoing_assets: unmatched.sort(),
  seed: { events: seed.events.length, assets: seed.events.reduce((n, e) => n + e.assets.length, 0), resolutions: seed.resolutions.length,
    asset_observations: seed.asset_observations.length, timing_facts: timing.facts.length, war_persons: warPersons.size, war_rows: war.rows.length },
  baseline_033: { portfolio_all: portfolio, per_player: legacy, first_hop_edges: edges },
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 1) + '\n')
console.log(JSON.stringify({ baseline, failures, seed: report.seed, unmatched_outgoing_assets: unmatched }, null, 1))
if (failures.length) process.exit(1)
