#!/usr/bin/env node
// Derives database/research/058/war-evidence.json: the Baseball-Reference team-season rows of the four returned players in scope.json, read from
// the two archived data files 057 registered (database/research/057/source-capture.json; verified by 057's fetch-sources.mjs before a row is read).
//
//   node database/research/058/derive-war.mjs [raw-dir]     (default research-output/057-work/raw, gitignored)
//
// The 032 / 035 / 057 row semantics, unchanged: one row per player, season, team, stint and component (BAT from the batting file, PITCH from the
// pitching file), the file's WAR kept as its exact text (NULL stays NULL, never zero), games G, plate appearances only on BAT rows, outs pitched
// only on PITCH rows; no TOT row exists, so nothing is counted twice. Each player's complete career row set through the observed-through season
// is taken, except the rows scope.json excludes by key (Versalles 1969 WSA: an unmapped team outside his Dodgers window). Every taken row's team
// must be mapped for its season by the reviewed team-code map (team-code-map.json, read from the 032 / 033 seed). Deterministic: the same files
// always give the same output.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCapture } from '../057/fetch-sources.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const rawDir = path.resolve(process.argv[2] ?? path.join(root, 'research-output/057-work/raw'))
const rd = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
const capture = JSON.parse(fs.readFileSync(path.join(here, '../057/source-capture.json'), 'utf8'))
const scope = rd('scope.json')
const teamMap = rd('team-code-map.json').codes
const THROUGH = capture.observed_through_season

const players = new Map(scope.players.map((p) => [p.bref_id, p]))
need(players.size === 4, 'four returned players')
const key = (r) => [r.bref_id, r.season, r.team, r.stint, r.component].join('|')
const excludedKeys = new Set(scope.excluded_rows.map(key))
const mapped = (team, season) => teamMap.some((m) => m.code === team && season >= m.from && season <= (m.to ?? 9999))

const rows = []
const excluded = []
for (const spec of capture.files) {
  const lines = readCapture(spec, rawDir).split('\n').filter((l) => l.length)
  const head = lines[0].split(',')
  const idx = Object.fromEntries(head.map((h, i) => [h, i]))
  need(!lines.some((l) => l.includes('"')), `${spec.raw_file}: a quoted field; the plain comma split would not be exact`)
  for (const line of lines.slice(1)) {
    const r = line.split(',')
    need(r.length === head.length, `${spec.raw_file}: a row with ${r.length} fields, header has ${head.length}`)
    const bref = r[idx.player_ID], mlb = r[idx.mlb_ID]
    // one Baseball-Reference id per MLB id for the four, both ways, in both files
    if (players.has(bref)) need(mlb === players.get(bref).mlb_id, `${bref}: mlb_ID ${mlb} differs from the transaction asset's ${players.get(bref).mlb_id}`)
    for (const p of players.values()) if (mlb === p.mlb_id) need(bref === p.bref_id, `mlb_ID ${mlb} carries a second player_ID ${bref}`)
    if (!players.has(bref)) continue
    const season = Number(r[idx.year_ID])
    const team = r[idx.team_ID]
    need(team !== 'TOT' && /^[A-Z]{2,3}$/.test(team), `${bref} ${season}: team code ${team} is not a team stint`)
    need(season <= THROUGH, `${bref} ${season}: a season after the last complete season`)
    const num = (v) => (v === 'NULL' || v === '' ? null : Number(v))
    const row = {
      bref_id: bref, mlb_id: mlb, season, team, stint: Number(r[idx.stint_ID]), component: spec.component, league: r[idx.lg_ID] || null,
      war: r[idx.WAR] === 'NULL' || r[idx.WAR] === '' ? null : r[idx.WAR], games: num(r[idx.G]),
      pa: spec.component === 'BAT' ? num(r[idx.PA]) : null, ip_outs: spec.component === 'PITCH' ? num(r[idx.IPouts]) : null,
    }
    need(row.war === null || /^-?\d+\.\d{2}$/.test(row.war), `${bref} ${season}: WAR ${row.war} is not the file's two-decimal form`)
    if (excludedKeys.has(key(row))) { excluded.push(row); continue }
    need(mapped(team, season), `${bref} ${season} ${team}: the team code has no mapping for the season and is not a reviewed exclusion`)
    rows.push(row)
  }
}

// every reviewed exclusion was found exactly as reviewed; nothing else was excluded
need(excluded.length === scope.excluded_rows.length && scope.excluded_rows.every((x) => excluded.some((r) => key(r) === key(x) && r.war === x.war)),
  'the excluded rows are exactly the reviewed ones, with the reviewed WAR')
need(excluded.every((r) => !mapped(r.team, r.season)), 'an excluded row is an unmapped team for its season')
rows.sort((a, b) => a.bref_id.localeCompare(b.bref_id) || a.season - b.season || a.stint - b.stint || a.team.localeCompare(b.team) || a.component.localeCompare(b.component))
need(new Set(rows.map(key)).size === rows.length, 'one row per player, season, team stint and component')

const H = (w) => (w === null ? 0 : Math.round(Number(w) * 100))
const fmt = (h) => (h < 0 ? '-' : '') + `${Math.floor(Math.abs(h) / 100)}.${String(Math.abs(h) % 100).padStart(2, '0')}`
const summary = scope.players.map((p) => {
  const mine = rows.filter((r) => r.bref_id === p.bref_id)
  need(mine.length === p.rows && mine.filter((r) => r.component === 'BAT').length === p.bat_rows && mine.filter((r) => r.component === 'PITCH').length === p.pitch_rows,
    `${p.name}: ${mine.length} rows, reviewed ${p.rows}`)
  const credited = p.credited_rows.map(([b, y, t, s, c]) => {
    const r = mine.find((x) => x.bref_id === b && x.season === y && x.team === t && x.stint === s && x.component === c)
    need(r, `${p.name}: a credited row ${[b, y, t, s, c].join(' ')} is not in the file`)
    return r
  })
  const credit = fmt(credited.reduce((s, r) => s + H(r.war), 0))
  need(credit === p.credited_bwar, `${p.name}: the credited rows sum to ${credit}, reviewed ${p.credited_bwar}`)
  // the credited rows are every Dodgers row of the acquisition season after the counterparty's stint, or the next season's for a Nov / Dec trade
  const dodgers = mine.filter((r) => ['LAD', 'BRO'].includes(r.team))
  return { name: p.name, bref_id: p.bref_id, mlb_id: p.mlb_id, rows: mine.length, bat_rows: p.bat_rows, pitch_rows: p.pitch_rows,
    career_bwar_loaded: fmt(mine.reduce((s, r) => s + H(r.war), 0)), dodgers_rows: dodgers.length, dodgers_bwar_loaded: fmt(dodgers.reduce((s, r) => s + H(r.war), 0)),
    credited_rows: credited.map(key), credited_bwar: credit, teams: [...new Set(mine.map((r) => r.team))] }
})
need(rows.length === 91, `91 reviewed rows (${rows.length})`)

const out = {
  generated_by: 'database/research/058/derive-war.mjs',
  sources: capture.files.map((f) => ({ component: f.component, url: f.url, decoded_sha256: f.decoded_sha256 })),
  observed_through_season: THROUGH,
  row_format: ['bref_id', 'mlb_id', 'season', 'team', 'stint', 'component', 'league', 'war', 'games', 'pa', 'ip_outs'],
  rows: rows.map((r) => [r.bref_id, r.mlb_id, r.season, r.team, r.stint, r.component, r.league, r.war, r.games, r.pa, r.ip_outs]),
  players: summary,
  excluded_rows: excluded.map((r) => ({ ...r, reason: scope.excluded_rows.find((x) => key(x) === key(r)).reason })),
}
fs.writeFileSync(path.join(here, 'war-evidence.json'), JSON.stringify(out, null, 1) + '\n')
process.stderr.write(`war-evidence.json: ${rows.length} rows for ${summary.length} players; ${excluded.length} excluded\n`)
