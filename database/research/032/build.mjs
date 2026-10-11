#!/usr/bin/env node
// Assembles database/sql/032_player_value_organizational_realization.sql from:
//   032_template.sql   hand-written schema, guard, reconciliation steps and postconditions
//   views.sql          the four derived views
//   war-seed.json      Baseball-Reference team-season rows (written by derive-seed.mjs)
//   scope-config.json  files, team-code map and return-asset identities
//   audit-report.json  written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/032/audit.mjs && node database/research/032/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(fs.readFileSync(path.join(here, 'war-seed.json'), 'utf8'))
const config = JSON.parse(fs.readFileSync(path.join(here, 'scope-config.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(path.join(here, 'audit-report.json'), 'utf8'))
if (audit.failures.length) throw new Error(`audit has failures: ${audit.failures.join('; ')}`)
if (seed.coverage.players_without_rows.length || seed.coverage.unmapped_team_codes.length) throw new Error('the seed has uncovered players or unmapped team codes')

// ---- validation (fail loudly, never guess) ---------------------------------------------------------------------------
const keys = new Set()
for (const r of seed.rows) {
  if (!['BAT', 'PITCH'].includes(r.component)) throw new Error(`bad component ${r.component}`)
  if (!/^[a-z0-9]+$/.test(r.bref_id)) throw new Error(`bad bref_id ${r.bref_id}`)
  if (r.war !== null && !/^-?\d+(\.\d{1,2})?$/.test(r.war)) throw new Error(`bad war ${r.war}`)
  const k = [r.bref_id, r.season, r.team, r.stint, r.component].join('|')
  if (keys.has(k)) throw new Error(`duplicate team-season key ${k}`)
  keys.add(k)
  const m = config.team_code_map.find((x) => x.code === r.team && r.season >= x.from && (x.to === null || r.season <= x.to))
  if (!m) throw new Error(`no team-code mapping covers ${r.bref_id} ${r.season} ${r.team}`)
}
const codes = new Set()
for (const m of config.team_code_map) {
  const same = config.team_code_map.filter((x) => x.code === m.code && x !== m)
  for (const o of same) if (!(m.to !== null && m.to < o.from) && !(o.to !== null && o.to < m.from)) throw new Error(`overlapping ranges for ${m.code}`)
  codes.add(m.code)
}

// ---- payload ---------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const payload = sortKeys({
  bat_url: config.files.bat.url,
  pitch_url: config.files.pitch.url,
  source_urls: [config.files.bat.url, config.files.pitch.url],
  retrieved_at: config.retrieved_at,
  observed_through_date: config.file_last_modified,
  observed_through_season: Number(config.file_last_modified.slice(0, 4)),
  team_map: config.team_code_map.map((m) => ({ code: m.code, organization: m.organization, from: m.from, to: m.to, note: m.note })),
  return_assets: config.return_assets.map((a) => ({ event_key: a.event_key, asset_name: a.asset_name, bref_id: a.bref_id })),
  backfills: audit.backfills,
})
// rows stay arrays (not key-sorted objects) to keep the payload compact and positional
payload.rows = seed.rows.map((r) => [r.bref_id, r.mlb_id, r.season, r.team, r.stint, r.component, r.league, r.war, r.games, r.pa, r.ip_outs])
const json = JSON.stringify(payload)
if (json.includes('$m032$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '032_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const fill = (name, value) => {
  const token = `{{${name}}}`
  if (!sql.includes(token)) throw new Error(`template has no ${token}`)
  sql = sql.split(token).join(value)
}
fill('views', views)
fill('payload_json', json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/032_player_value_organizational_realization.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
