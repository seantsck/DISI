#!/usr/bin/env node
// Derives database/research/032/war-seed.json from the two Baseball-Reference WAR data files.
//
//   node database/research/032/derive-seed.mjs [path-to-directory-holding-the-two-files]
//
// The raw files (about 51 MB together) are NOT committed. They live under research-output/032-work/raw/ (gitignored)
// and are re-downloadable from the URLs in scope-config.json. This script:
//   1. verifies each raw file against the SHA-256 recorded in scope-config.json (fail loudly on mismatch);
//   2. builds the canonical 001-031 chain in memory to read the bref_id of every verified MLB-reached player
//      (offline; no network and no real database);
//   3. keeps only the rows whose player_ID is one of those players or one of the three return assets;
//   4. writes the rows deterministically (sorted) with their own checksum.
// Re-running with the same raw files always reproduces the same war-seed.json.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const rawDir = path.resolve(process.argv[2] ?? path.join(root, 'research-output/032-work/raw'))
const config = JSON.parse(fs.readFileSync(path.join(here, 'scope-config.json'), 'utf8'))
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

const files = {}
for (const [kind, spec] of Object.entries(config.files)) {
  const name = spec.url.split('/').pop()
  const buf = fs.readFileSync(path.join(rawDir, name))
  const actual = sha256(buf)
  if (actual !== spec.sha256) throw new Error(`${name}: sha256 ${actual} does not match scope-config (${spec.sha256})`)
  const lines = buf.toString('utf8').split('\n')
  const header = lines[0].replace(/\r$/, '').split(',')
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  const rows = lines.slice(1).filter((l) => l.length).map((l) => l.replace(/\r$/, '').split(','))
  if (rows.length !== spec.rows) throw new Error(`${name}: ${rows.length} rows, expected ${spec.rows}`)
  files[kind] = { idx, rows }
}

// scope: verified MLB-reached players from the canonical replay
const ch = await buildChainThrough('031_financial_provenance_coverage_expansion.sql')
const scope = (await ch.query(`select p.slug, p.bref_id, p.mlb_id from outcome_audits a join players p on p.id = a.player_id where a.reached_mlb_verified order by p.slug`))
await ch.close()
if (scope.length !== 47 || scope.some((s) => !s.bref_id)) throw new Error('expected 47 verified players, each with a bref_id')
const refs = new Map(scope.map((s) => [s.bref_id, { kind: 'DISI_SIGNING', slug: s.slug, mlb_id: s.mlb_id }]))
for (const r of config.return_assets) refs.set(r.bref_id, { kind: 'RETURN_ASSET', slug: null, mlb_id: r.mlb_id })

const out = []
for (const [component, f] of [['BAT', files.bat], ['PITCH', files.pitch]]) {
  for (const r of f.rows) {
    const bref = r[f.idx.player_ID]
    if (!refs.has(bref)) continue
    const ref = refs.get(bref)
    const mlb = r[f.idx.mlb_ID]
    if (ref.mlb_id && mlb !== String(ref.mlb_id)) throw new Error(`${bref}: file mlb_ID ${mlb} differs from the DISI / verified id ${ref.mlb_id}`)
    out.push({
      bref_id: bref, mlb_id: mlb, season: Number(r[f.idx.year_ID]), team: r[f.idx.team_ID], stint: Number(r[f.idx.stint_ID]), component,
      league: r[f.idx.lg_ID], war: r[f.idx.WAR] === 'NULL' ? null : r[f.idx.WAR], games: r[f.idx.G] === 'NULL' ? null : Number(r[f.idx.G]),
      pa: component === 'BAT' ? (r[f.idx.PA] === 'NULL' ? null : Number(r[f.idx.PA])) : null,
      ip_outs: component === 'PITCH' ? (r[f.idx.IPouts] === 'NULL' ? null : Number(r[f.idx.IPouts])) : null,
    })
  }
}
out.sort((a, b) => a.bref_id.localeCompare(b.bref_id) || a.season - b.season || a.stint - b.stint || a.component.localeCompare(b.component) || a.team.localeCompare(b.team))

// every in-scope player must have rows; every code must be mapped
const covered = new Set(out.map((r) => r.bref_id))
const missing = [...refs.keys()].filter((b) => !covered.has(b))
const mapped = new Set(config.team_code_map.map((m) => m.code))
const unmapped = [...new Set(out.map((r) => r.team))].filter((t) => !mapped.has(t)).sort()
const seedBody = { war_system: config.war_system, rows: out }
const seed = {
  generated_by: 'database/research/032/derive-seed.mjs',
  source_files: config.files,
  retrieved_at: config.retrieved_at,
  file_last_modified: config.file_last_modified,
  scope: { disi_players: scope.length, return_assets: config.return_assets.length, bref_ids: [...refs.keys()].sort() },
  coverage: { players_without_rows: missing, unmapped_team_codes: unmapped },
  row_count: out.length,
  components: out.reduce((m, r) => ((m[r.component] = (m[r.component] || 0) + 1), m), {}),
  null_war_rows: out.filter((r) => r.war === null).length,
  parsed_rows_sha256: sha256(Buffer.from(JSON.stringify(seedBody))),
  ...seedBody,
}
fs.writeFileSync(path.join(here, 'war-seed.json'), JSON.stringify(seed, null, 1) + '\n')
console.log(JSON.stringify({ rows: out.length, components: seed.components, players: covered.size, null_war_rows: seed.null_war_rows, missing, unmapped, parsed_rows_sha256: seed.parsed_rows_sha256 }, null, 1))
if (missing.length || unmapped.length) process.exit(1)
