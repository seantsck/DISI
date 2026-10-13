#!/usr/bin/env node
// Derives database/research/035/war-seed.json: the Baseball-Reference team-season rows of the benchmark players whose MLB debut is
// confirmed by benchmark-outcomes.json (identified by the data file's mlb_ID, cross-checked against players.bref_id in the seed).
//
//   node database/research/035/derive-war.mjs [path-to-directory-holding-the-two-files]
//
// The two raw files are the same ones Migrations 032 / 033 / 034 used (same SHA-256 values in scope-config.json). They are NOT
// committed; they live under research-output/032-work/raw/ (gitignored). Same filters and BAT / PITCH split as 032. Deterministic.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const rawDir = path.resolve(process.argv[2] ?? path.join(root, 'research-output/032-work/raw'))
const rd = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const config = rd('scope-config.json')
const outcomes = rd('benchmark-outcomes.json').players
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const files = {}
for (const [kind, spec] of Object.entries(config.files)) {
  const name = spec.url.split('/').pop()
  const buf = fs.readFileSync(path.join(rawDir, name))
  if (sha256(buf) !== spec.sha256) throw new Error(`${name}: sha256 does not match scope-config`)
  const lines = buf.toString('utf8').split('\n')
  const idx = Object.fromEntries(lines[0].replace(/\r$/, '').split(',').map((h, i) => [h, i]))
  const rows = lines.slice(1).filter((l) => l.length).map((l) => l.replace(/\r$/, '').split(','))
  if (rows.length !== spec.rows) throw new Error(`${name}: ${rows.length} rows, expected ${spec.rows}`)
  files[kind] = { idx, rows }
}

const reached = outcomes.filter((p) => p.mlb_debut_date)
const wanted = new Map(reached.map((p) => [String(p.mlb_id), p]))
const brefByMlb = new Map()
const out = []
for (const [component, f] of [['BAT', files.bat], ['PITCH', files.pitch]]) {
  for (const r of f.rows) {
    const mlb = r[f.idx.mlb_ID]
    if (!wanted.has(mlb)) continue
    const bref = r[f.idx.player_ID]
    if (brefByMlb.has(mlb) && brefByMlb.get(mlb) !== bref) throw new Error(`mlb_ID ${mlb} maps to two player_IDs`)
    brefByMlb.set(mlb, bref)
    out.push({
      bref_id: bref, mlb_id: mlb, season: Number(r[f.idx.year_ID]), team: r[f.idx.team_ID], stint: Number(r[f.idx.stint_ID]), component,
      league: r[f.idx.lg_ID], war: r[f.idx.WAR] === 'NULL' ? null : r[f.idx.WAR], games: r[f.idx.G] === 'NULL' ? null : Number(r[f.idx.G]),
      pa: component === 'BAT' ? (r[f.idx.PA] === 'NULL' ? null : Number(r[f.idx.PA])) : null,
      ip_outs: component === 'PITCH' ? (r[f.idx.IPouts] === 'NULL' ? null : Number(r[f.idx.IPouts])) : null,
    })
  }
}
out.sort((a, b) => a.bref_id.localeCompare(b.bref_id) || a.season - b.season || a.stint - b.stint || a.component.localeCompare(b.component) || a.team.localeCompare(b.team))
const missing = [...wanted.keys()].filter((m) => !brefByMlb.has(m))
const seed032 = rd('../032/scope-config.json')
const codes = new Set([...seed032.team_code_map.map((m) => m.code), ...rd('../033/scope-config.json').team_code_map_additions.map((m) => m.code), ...rd('../034/scope-config.json').team_code_map_additions.map((m) => m.code)])
const unmapped = [...new Set(out.map((r) => r.team))].filter((t) => !codes.has(t)).sort()
const body = { war_system: config.war_system, rows: out }
const seed = {
  generated_by: 'database/research/035/derive-war.mjs',
  source_files: config.files,
  retrieved_at: config.retrieved_at,
  file_last_modified: config.file_last_modified,
  scope: { persons: wanted.size, players: Object.fromEntries([...wanted.entries()].map(([m, p]) => [p.slug, { mlb_id: m, bref_id: brefByMlb.get(m) ?? null }])) },
  coverage: { persons_without_rows: missing, unmapped_team_codes: unmapped },
  row_count: out.length,
  components: out.reduce((m, r) => ((m[r.component] = (m[r.component] || 0) + 1), m), {}),
  null_war_rows: out.filter((r) => r.war === null).length,
  parsed_rows_sha256: sha256(Buffer.from(JSON.stringify(body))),
  ...body,
}
fs.writeFileSync(path.join(here, 'war-seed.json'), JSON.stringify(seed, null, 1) + '\n')
console.log(JSON.stringify({ persons: wanted.size, rows: out.length, components: seed.components, missing, unmapped }, null, 1))
if (unmapped.length || missing.length) process.exit(1)
