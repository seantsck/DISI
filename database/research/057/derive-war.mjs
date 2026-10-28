#!/usr/bin/env node
// Derives database/research/057/war-evidence.json: the Baseball-Reference team-season rows of the eleven approved benchmark reachers (scope.json),
// read from the two archived data files pinned in source-capture.json (verified by fetch-sources.mjs before a row is read).
//
//   node database/research/057/derive-war.mjs [raw-dir]     (default research-output/057-work/raw, gitignored)
//
// The 032 / 035 row semantics, unchanged: one row per player, season, team, stint and component (BAT from the batting file, PITCH from the
// pitching file), the file's WAR kept as its exact text (NULL stays NULL, never zero), games G, plate appearances only on BAT rows, outs pitched
// only on PITCH rows. A player who changed clubs in a season has one row per team stint; the files hold no TOT (season total) row, so nothing is
// counted twice. Only seasons up to observed_through_season (2025) are taken: the batting capture's 2026 rows are mid-season and are recorded
// here only as excluded. The deferred 2016-class reachers, the unresolved identities and the transaction-value players are never selected.
// Deterministic: the same files always give the same output.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCapture } from './fetch-sources.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const rawDir = path.resolve(process.argv[2] ?? path.join(root, 'research-output/057-work/raw'))
const rd = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
const capture = rd('source-capture.json')
const scope = rd('scope.json')
const THROUGH = capture.observed_through_season

const approved = new Map(scope.approved.map((p) => [p.bref_id, p]))
const forbidden = new Set([...scope.deferred_incomplete_window.map((p) => p.bref_id), 'garlajo01', 'grantmu01', 'versazo01', 'leyriji01'])
need(approved.size === 11 && [...approved.keys()].every((b) => !forbidden.has(b)), 'the approved scope is exactly the eleven complete-window reachers')
need(scope.approved.every((p) => p.horizon_end_season === p.signing_year + 10 && p.horizon_end_season <= THROUGH), 'every approved horizon ends by the last complete season')
need(scope.deferred_incomplete_window.every((p) => p.horizon_end_season > THROUGH), 'every deferred horizon ends after the last complete season')

const rows = []
const excluded = []
const mlbOfBref = new Map()
for (const spec of capture.files) {
  const lines = readCapture(spec, rawDir).split('\n').filter((l) => l.length)
  const head = lines[0].split(',')
  const idx = Object.fromEntries(head.map((h, i) => [h, i]))
  need(!lines.some((l) => l.includes('"')), `${spec.raw_file}: a quoted field; the plain comma split would not be exact`)
  for (const line of lines.slice(1)) {
    const r = line.split(',')
    need(r.length === head.length, `${spec.raw_file}: a row with ${r.length} fields, header has ${head.length}`)
    const bref = r[idx.player_ID], mlb = r[idx.mlb_ID]
    // one Baseball-Reference id per MLB id among the approved players, both ways, in both files
    if (approved.has(bref)) need(mlb === approved.get(bref).mlb_id, `${bref}: mlb_ID ${mlb} differs from the DISI record ${approved.get(bref).mlb_id}`)
    for (const p of approved.values()) if (mlb === p.mlb_id) need(bref === p.bref_id, `mlb_ID ${mlb} carries a second player_ID ${bref}`)
    if (!approved.has(bref)) continue
    mlbOfBref.set(bref, mlb)
    const season = Number(r[idx.year_ID])
    const team = r[idx.team_ID]
    need(team !== 'TOT' && /^[A-Z]{2,3}$/.test(team), `${bref} ${season}: team code ${team} is not a team stint`)
    const num = (v) => (v === 'NULL' || v === '' ? null : Number(v))
    const row = {
      bref_id: bref, mlb_id: mlb, season, team, stint: Number(r[idx.stint_ID]), component: spec.component, league: r[idx.lg_ID] || null,
      war: r[idx.WAR] === 'NULL' || r[idx.WAR] === '' ? null : r[idx.WAR], games: num(r[idx.G]),
      pa: spec.component === 'BAT' ? num(r[idx.PA]) : null, ip_outs: spec.component === 'PITCH' ? num(r[idx.IPouts]) : null,
    }
    need(row.war === null || /^-?\d+\.\d{2}$/.test(row.war), `${bref} ${season}: WAR ${row.war} is not the file's two-decimal form`)
    if (season > THROUGH) excluded.push({ ...row, reason: `season ${season} is after the last complete season ${THROUGH} (mid-season in the capture)` })
    else rows.push(row)
  }
}
need([...approved.keys()].every((b) => mlbOfBref.has(b)), 'every approved player has rows in the files')
const order = (a, b) => a.bref_id.localeCompare(b.bref_id) || a.season - b.season || a.stint - b.stint || a.component.localeCompare(b.component) || a.team.localeCompare(b.team)
rows.sort(order)
excluded.sort(order)
const keys = rows.map((r) => [r.bref_id, r.season, r.team, r.stint, r.component].join('|'))
need(new Set(keys).size === keys.length, 'one row per player, season, team, stint and component')
need(rows.every((r) => !forbidden.has(r.bref_id)), 'no deferred or transaction-value player is selected')

// exact sums in hundredths (the file's precision), per player: the 041 window (seasons <= signing year + 10) and every loaded season
const hundredths = (w) => (w === null ? 0 : Math.round(Number(w) * 100))
const fmt = (h) => (h < 0 ? '-' : '') + `${Math.floor(Math.abs(h) / 100)}.${String(Math.abs(h) % 100).padStart(2, '0')}`
const players = scope.approved.map((p) => {
  const mine = rows.filter((r) => r.bref_id === p.bref_id)
  const inWindow = mine.filter((r) => r.season <= p.horizon_end_season)
  const window = inWindow.reduce((s, r) => s + hundredths(r.war), 0)
  const seasons = [...new Set(mine.map((r) => r.season))]
  const multiTeam = seasons.filter((y) => new Set(mine.filter((r) => r.season === y).map((r) => r.team)).size > 1)
    .map((y) => ({ season: y, stints: mine.filter((r) => r.season === y && r.component === 'BAT').map((r) => [r.stint, r.team, r.war]) }))
  return {
    slug: p.slug, bref_id: p.bref_id, mlb_id: p.mlb_id, signing_year: p.signing_year, horizon_end_season: p.horizon_end_season,
    rows: mine.length, window_rows: inWindow.length, seasons, multi_team_seasons: multiTeam,
    window_bwar: fmt(window), loaded_bwar: fmt(mine.reduce((s, r) => s + hundredths(r.war), 0)),
    positive_bwar_label: window > 0, bwar_2_label: window >= 200,
    excluded_partial_rows: excluded.filter((r) => r.bref_id === p.bref_id).length,
  }
})

const out = {
  generated_by: 'database/research/057/derive-war.mjs',
  sources: capture.files.map((f) => ({ component: f.component, url: f.url, decoded_sha256: f.decoded_sha256 })),
  observed_through_season: THROUGH,
  row_format: ['bref_id', 'mlb_id', 'season', 'team', 'stint', 'component', 'league', 'war', 'games', 'pa', 'ip_outs'],
  rows: rows.map((r) => [r.bref_id, r.mlb_id, r.season, r.team, r.stint, r.component, r.league, r.war, r.games, r.pa, r.ip_outs]),
  players,
  excluded_rows: excluded.map((r) => ({ bref_id: r.bref_id, season: r.season, team: r.team, stint: r.stint, component: r.component, war: r.war, reason: r.reason })),
}
fs.writeFileSync(path.join(here, 'war-evidence.json'), JSON.stringify(out, null, 1) + '\n')
process.stderr.write(`war-evidence.json: ${rows.length} rows for ${players.length} players; ${excluded.length} partial-season rows excluded\n`)
for (const p of players) process.stderr.write(`  ${p.slug.padEnd(22)} ${String(p.rows).padStart(2)} rows  window ${p.window_bwar.padStart(6)}  POSITIVE ${p.positive_bwar_label}  BWAR_2 ${p.bwar_2_label}\n`)
