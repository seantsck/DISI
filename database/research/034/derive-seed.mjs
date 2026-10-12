#!/usr/bin/env node
// Derives database/research/034/war-seed.json: the Baseball-Reference team-season rows of the PLAYER assets that Migration 034
// newly surfaces downstream (incoming PLAYER assets of the researched exit events, plus the canonical hop >= 2 incoming assets
// named in scope-config.json) that 032 / 033 did not already load.
//
//   node database/research/034/derive-seed.mjs [path-to-directory-holding-the-two-files]
//
// The two raw files are the same ones Migrations 032 / 033 used (same SHA-256 values in scope-config.json). They are NOT
// committed; they live under research-output/032-work/raw/ (gitignored). Same filters and the same BAT / PITCH split as
// 032 / 033. Re-running with the same raw files reproduces the same war-seed.json.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const rawDir = path.resolve(process.argv[2] ?? path.join(root, 'research-output/032-work/raw'))
const rd = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const config = rd('scope-config.json')
const seed = rd('exit-seed.json')
const seed032 = rd('../032/war-seed.json')
const seed033 = rd('../033/war-seed.json')
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const files = {}
for (const [kind, spec] of Object.entries(config.files)) {
  const name = spec.url.split('/').pop()
  const buf = fs.readFileSync(path.join(rawDir, name))
  const actual = sha256(buf)
  if (actual !== spec.sha256) throw new Error(`${name}: sha256 ${actual} does not match scope-config (${spec.sha256})`)
  const lines = buf.toString('utf8').split('\n')
  const idx = Object.fromEntries(lines[0].replace(/\r$/, '').split(',').map((h, i) => [h, i]))
  const rows = lines.slice(1).filter((l) => l.length).map((l) => l.replace(/\r$/, '').split(','))
  if (rows.length !== spec.rows) throw new Error(`${name}: ${rows.length} rows, expected ${spec.rows}`)
  files[kind] = { idx, rows }
}

const loaded = new Set([...seed032.rows, ...seed033.rows].map((r) => r.bref_id))
const refs = new Map()
for (const e of seed.events) {
  for (const a of e.assets) {
    if (a.side !== 'INCOMING' || a.type !== 'PLAYER' || !a.bref_id || loaded.has(a.bref_id)) continue
    refs.set(a.bref_id, { mlb_id: a.mlb_id, name: a.name, why: `incoming at ${e.key}` })
  }
}
for (const x of config.extra_downstream_bref_ids) if (!loaded.has(x.bref_id)) refs.set(x.bref_id, { mlb_id: x.mlb_id, name: x.name, why: x.why })

const out = []
for (const [component, f] of [['BAT', files.bat], ['PITCH', files.pitch]]) {
  for (const r of f.rows) {
    const bref = r[f.idx.player_ID]
    if (!refs.has(bref)) continue
    const mlb = r[f.idx.mlb_ID]
    const ref = refs.get(bref)
    if (ref.mlb_id && mlb !== String(ref.mlb_id)) throw new Error(`${bref}: file mlb_ID ${mlb} differs from the seed identity ${ref.mlb_id}`)
    out.push({
      bref_id: bref, mlb_id: mlb, season: Number(r[f.idx.year_ID]), team: r[f.idx.team_ID], stint: Number(r[f.idx.stint_ID]), component,
      league: r[f.idx.lg_ID], war: r[f.idx.WAR] === 'NULL' ? null : r[f.idx.WAR], games: r[f.idx.G] === 'NULL' ? null : Number(r[f.idx.G]),
      pa: component === 'BAT' ? (r[f.idx.PA] === 'NULL' ? null : Number(r[f.idx.PA])) : null,
      ip_outs: component === 'PITCH' ? (r[f.idx.IPouts] === 'NULL' ? null : Number(r[f.idx.IPouts])) : null,
    })
  }
}
out.sort((a, b) => a.bref_id.localeCompare(b.bref_id) || a.season - b.season || a.stint - b.stint || a.component.localeCompare(b.component) || a.team.localeCompare(b.team))

const covered = new Set(out.map((r) => r.bref_id))
const missing = [...refs.keys()].filter((b) => !covered.has(b)).sort()
const codes = new Set([...rd('../032/scope-config.json').team_code_map.map((m) => m.code), ...rd('../033/scope-config.json').team_code_map_additions.map((m) => m.code),
  ...config.team_code_map_additions.map((m) => m.code)])
const unmappedBySeason = {}
for (const r of out) if (!codes.has(r.team)) (unmappedBySeason[r.team] ??= []).push(r.season)
const unmapped = Object.keys(unmappedBySeason).sort()
const seedBody = { war_system: config.war_system, rows: out }
const body = {
  generated_by: 'database/research/034/derive-seed.mjs',
  source_files: config.files,
  retrieved_at: config.retrieved_at,
  file_last_modified: config.file_last_modified,
  scope: { persons: refs.size, bref_ids: [...refs.keys()].sort(), names: Object.fromEntries([...refs.entries()].sort().map(([k, v]) => [k, v.name])) },
  coverage: { persons_without_rows: missing, unmapped_team_codes: unmapped },
  row_count: out.length,
  components: out.reduce((m, r) => ((m[r.component] = (m[r.component] || 0) + 1), m), {}),
  null_war_rows: out.filter((r) => r.war === null).length,
  parsed_rows_sha256: sha256(Buffer.from(JSON.stringify(seedBody))),
  ...seedBody,
}
fs.writeFileSync(path.join(here, 'war-seed.json'), JSON.stringify(body, null, 1) + '\n')
console.log(JSON.stringify({ persons: refs.size, rows: out.length, components: body.components, null_war_rows: body.null_war_rows, missing, unmapped, unmappedBySeason: Object.fromEntries(Object.entries(unmappedBySeason).map(([k, v]) => [k, [Math.min(...v), Math.max(...v)]])), parsed_rows_sha256: body.parsed_rows_sha256 }, null, 1))
