#!/usr/bin/env node
// Assembles database/sql/033_transaction_asset_chain_completion.sql from:
//   033_template.sql   hand-written schema, guards, backfill steps and postconditions
//   views.sql          the amended trade-realization chain and the four new transaction views
//   event-seed.json    the reviewed transaction events, assets, identities, resolutions and observations
//   war-seed.json      Baseball-Reference team-season rows of the first-hop incoming PLAYER assets (derive-seed.mjs)
//   scope-config.json  data-file checksums, team-code map additions and the date correction
//   audit-report.json  written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/033/audit.mjs && node database/research/033/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const seed = read('event-seed.json')
const war = read('war-seed.json')
const config = read('scope-config.json')
const audit = read('audit-report.json')
const config032 = read('../032/scope-config.json')
if (audit.failures.length) throw new Error(`audit has failures: ${audit.failures.join('; ')}`)
if (war.coverage.persons_without_rows.length || war.coverage.unmapped_team_codes.length) throw new Error('the WAR seed has uncovered persons or unmapped team codes')

// ---- validation (fail loudly, never guess) ----------------------------------------------------------------------------
const keys = new Set()
const ASSET_TYPES = ['PLAYER', 'CASH', 'PLAYER_TO_BE_NAMED', 'FUTURE_CONSIDERATIONS', 'INTERNATIONAL_BONUS_POOL_SPACE']
const EVENT_TYPES = ['TRADE', 'RELEASE', 'WAIVER', 'RULE5_SELECTION', 'FREE_AGENCY', 'EXPANSION_DRAFT']
for (const e of seed.events) {
  if (keys.has(e.key)) throw new Error(`duplicate event key ${e.key}`)
  keys.add(e.key)
  if (!EVENT_TYPES.includes(e.type)) throw new Error(`${e.key}: bad type ${e.type}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new Error(`${e.key}: bad date`)
  if (!e.source_url) throw new Error(`${e.key}: no source`)
  const names = new Set()
  for (const a of e.assets) {
    if (!ASSET_TYPES.includes(a.type)) throw new Error(`${e.key}: bad asset type ${a.type}`)
    const k = `${a.side}|${a.name}`
    if (names.has(k)) throw new Error(`${e.key}: duplicate asset ${k}`)
    names.add(k)
    if (a.type !== 'PLAYER' && (a.mlb_id || a.bref_id || a.bref_register_id || a.player_slug)) throw new Error(`${e.key}: non-player asset ${a.name} carries a player identity`)
    if (a.bref_id && !/^[a-z0-9]+$/.test(a.bref_id)) throw new Error(`${e.key}: bad bref_id ${a.bref_id}`)
    if (a.bref_register_id && !/^[a-z][a-z-]{2,5}[0-9]{3}[a-z]{1,4}$/.test(a.bref_register_id)) throw new Error(`${e.key}: bad register id ${a.bref_register_id}`)
    if (a.mlb_id && !/^[0-9]+$/.test(a.mlb_id)) throw new Error(`${e.key}: bad mlb_id ${a.mlb_id}`)
    if (a.cash_amount_usd != null && a.type !== 'CASH') throw new Error(`${e.key}: amount on ${a.type}`)
    if (a.pool_space_amount_usd != null && a.type !== 'INTERNATIONAL_BONUS_POOL_SPACE') throw new Error(`${e.key}: pool amount on ${a.type}`)
  }
}
const sourceUrls = new Set(seed.sources.map((s) => s.url))
for (const e of seed.events) {
  for (const u of [e.source_url, ...e.assets.map((a) => a.source_url).filter(Boolean)]) if (!sourceUrls.has(u)) throw new Error(`${e.key}: unregistered source ${u}`)
}
for (const r of seed.resolutions) if (!sourceUrls.has(r.source_url)) throw new Error(`resolution source ${r.source_url} unregistered`)
for (const o of [...seed.asset_observations, ...seed.player_observations]) if (!sourceUrls.has(o.source_url) && !Object.values(config.files).some((f) => f.url === o.source_url)) throw new Error(`observation source ${o.source_url} unregistered`)
for (const r of war.rows) {
  const add = config.team_code_map_additions.find((x) => x.code === r.team && r.season >= x.from && r.season <= x.to)
  const base = config032.team_code_map.find((x) => x.code === r.team && r.season >= x.from && (x.to === null || r.season <= x.to))
  if (!add && !base) throw new Error(`no team-code mapping covers ${r.bref_id} ${r.season} ${r.team}`)
}

// ---- payload ---------------------------------------------------------------------------------------------------------
const tracked = new Map()
for (const e of seed.events) for (const a of e.assets) if (a.player_slug) tracked.set(a.player_slug, a.mlb_id)
const organizations = new Set(config.team_code_map_additions.map((m) => m.organization))
for (const e of seed.events) {
  organizations.add(e.from_org)
  if (e.to_org) organizations.add(e.to_org)
  for (const a of e.assets) if (a.counterparty) organizations.add(a.counterparty)
}
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const payload = sortKeys({
  retrieved_at: '2026-10-11T00:00:00Z',
  organizations: [...organizations].sort(),
  tracked_players: [...tracked.entries()].sort().map(([slug, mlb_id]) => ({ slug, mlb_id })),
  sources: seed.sources.map((s) => ({ url: s.url, source_name: s.source_name, source_type: s.source_type, title: s.title, source_tier: s.source_tier, notes: s.notes })),
  team_map: config.team_code_map_additions.map((m) => ({ code: m.code, organization: m.organization, from: m.from, to: m.to, note: m.note })),
  date_correction: { event_key: config.date_correction.event_key, player_slug: config.date_correction.player_slug, legacy_transaction_type: config.date_correction.legacy_transaction_type,
    from: config.date_correction.from, to: config.date_correction.to, evidence_source_url: config.date_correction.evidence_source_url, note: config.date_correction.note },
  events: seed.events.map((e) => ({
    key: e.key, existing: e.existing, date: e.date, type: e.type, label: e.historical_label, multi: e.is_multi_team, from: e.from_org, to: e.to_org,
    description: e.description, source_url: e.source_url,
    assets: e.assets.map((a) => ({ side: a.side, type: a.type, name: a.name, slug: a.player_slug, mlb_id: a.mlb_id, bref_id: a.bref_id, register_id: a.bref_register_id,
      cp: a.counterparty, cash: a.cash_amount_usd, pool: a.pool_space_amount_usd, note: a.role_note, source_url: a.source_url ?? null })),
  })),
  resolutions: seed.resolutions.map((r) => ({ event: r.event, placeholder: r.placeholder, resolved: r.resolved, date: r.date, source_url: r.source_url, confidence: r.confidence, note: r.note })),
  asset_observations: seed.asset_observations.map((o) => ({ asset: o.asset, type: o.type, observed_through: o.observed_through, confidence: o.confidence, source_url: o.source_url, note: o.note })),
  player_observations: seed.player_observations.map((o) => ({ slug: o.slug, type: o.type, observed_through: o.observed_through, confidence: o.confidence, source_url: o.source_url, note: o.note })),
  war: {
    bat_url: config.files.bat.url,
    pitch_url: config.files.pitch.url,
    source_urls: [config.files.bat.url, config.files.pitch.url],
    retrieved_at: config.retrieved_at,
    observed_through_date: config.file_last_modified,
    observed_through_season: Number(config.file_last_modified.slice(0, 4)),
    rows: war.rows.map((r) => [r.bref_id, r.mlb_id, r.season, r.team, r.stint, r.component, r.league, r.war, r.games, r.pa, r.ip_outs]),
  },
})
// escape non-ASCII so the SQL file stays ASCII
const json = JSON.stringify(payload).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
if (json.includes('$m033$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '033_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const fill = (name, value) => {
  const token = `{{${name}}}`
  if (!sql.includes(token)) throw new Error(`template has no ${token}`)
  sql = sql.split(token).join(value)
}
fill('views', views)
fill('payload_json', json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/033_transaction_asset_chain_completion.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
