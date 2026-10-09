#!/usr/bin/env node
// Reproducible audit behind migration 023: finds and classifies every
// season-total (aggregate) stint in the canonical 001->022 database and writes
// the reviewed decisions that the migration tags.
//
//   node database/research/023/audit.mjs
//
// Builds 001->022 in an in-memory PGlite database (the manifest minus 023 and
// later), so it never touches a real database and needs no network. Evidence:
//   1. Source structure. The MLB Stats API emits a team-less aggregate split
//      (numTeams >= 2) when a player appears for several teams in one sport
//      season. The 021 ingest stored these with no affiliate and no team id
//      (organizationBasis NO_TEAM_NAME).
//   2. Arithmetic. A candidate is a season total ONLY when every additive stat
//      it reports equals the sum of same-season team stints at its source level
//      (all of them, or - for a split-season label - an exact subset).
// A team-less row that fails the arithmetic would be reported as NO_MATCH and
// stays out of the decisions file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec('create role anon nologin; create role authenticated nologin;')
for (const file of manifest.canonical_sql) {
  if (/^02[3-9]_|^0[3-9]\d_/.test(file)) break
  await db.exec(fs.readFileSync(path.join(root, 'database/sql', file), 'utf8'))
}
const query = async (sql, params) => (await db.query(sql, params)).rows

const HIT = ['g', 'pa', 'ab', 'h', 'b2', 'b3', 'hr', 'bb', 'so', 'sb', 'cs']
const PIT = ['pg', 'gs', 'bf', 'h_allowed', 'r', 'er', 'hr_allowed', 'pbb', 'pso']
const cols = [...HIT, ...PIT].map((k) => `s.${k}`).join(', ')
const thirds = (ip) => (ip == null ? null : Math.round(Number(ip) * 3))

const statKeys = (row) => [...HIT, ...PIT].filter((k) => row[k] != null)
const matches = (row, parts) => {
  const keys = statKeys(row)
  const sum = (k) => parts.reduce((a, r) => a + (r[k] == null ? 0 : Number(r[k])), 0)
  const ipOk = row.ip == null || thirds(row.ip) === parts.reduce((a, r) => a + (thirds(r.ip) ?? 0), 0)
  return keys.length > 0 && keys.every((k) => Number(row[k]) === sum(k)) && ipOk
}
const subsets = (arr) => {
  const out = []
  for (let mask = 1; mask < 1 << arr.length; mask++) out.push(arr.filter((_, i) => mask & (1 << i)))
  return out
}

const candidates = await query(`select s.id, p.slug, s.season, s.level::text level, s.source_level, s.league_name,
  s.affiliated, s.detail->>'organizationBasis' org_basis, ${cols}, s.ip
  from player_season_stints s join players p on p.id = s.player_id
  where s.affiliate_team is null or s.team_id is null
  order by p.slug, s.season, s.level::text, coalesce(s.league_name, '')`)

const rows = []
const noMatch = []
for (const c of candidates) {
  const parts = await query(`select s.affiliate_team, s.level::text level, s.source_level, ${cols}, s.ip
    from player_season_stints s join players p on p.id = s.player_id
    where p.slug = $1 and s.season = $2 and s.team_id is not null and s.affiliate_team is not null
    order by s.affiliate_team`, [c.slug, c.season])
  const pitching = c.pg != null || c.bf != null
  const sameSport = parts.filter((p) => p.source_level === c.source_level && (pitching ? p.pg != null || p.bf != null : p.g != null || p.pa != null))
  let basis = null
  let used = []
  if (sameSport.length >= 2 && matches(c, sameSport)) {
    used = sameSport
    basis = new Set(used.map((p) => p.level)).size === 1 && used[0].level === c.level ? 'SAME_LEVEL' : 'CROSS_LEVEL'
  } else {
    const hit = subsets(sameSport).filter((s) => s.length >= 2 && s.length < sameSport.length).find((s) => matches(c, s))
    if (hit) { used = hit; basis = 'SUB_SEASON' }
  }
  if (!basis) { noMatch.push(`${c.slug} ${c.season} ${c.level}`); continue }
  rows.push({
    slug: c.slug,
    season: c.season,
    level: c.level,
    source_level: c.source_level,
    league_name: c.league_name,
    basis,
    games: c.g ?? c.pg,
    organization_basis: c.org_basis,
    // Only a proper subset needs its components named; otherwise "all
    // same-source-level team stints of the season" is the component set.
    components: basis === 'SUB_SEASON' ? used.map((p) => p.affiliate_team).sort() : null,
    components_matched: used.map((p) => p.affiliate_team).sort(),
    stats_compared: statKeys(c).length + (c.ip != null ? 1 : 0),
    source_note: /** @type {string | null} */ (null),
  })
}
const SOURCE_NOTES = {
  'lenix-osuna|2018': 'MLB Stats API (people/624646 yearByYear, milb_all, retrieved 2026-10-07) lists the Mexican League 2018 as season 2018.1 (Diablos Rojos + Oaxaca, with a team-less numTeams=2 aggregate of 7 G / 26 BF) and 2018.2 (Durango 21 G). The aggregate covers only the 2018.1 teams.',
}
for (const r of rows) r.source_note = SOURCE_NOTES[`${r.slug}|${r.season}`] ?? null

const tally = rows.reduce((t, r) => ((t[r.basis] = (t[r.basis] || 0) + 1), t), {})
const out = {
  migration: '023_development_stint_integrity',
  rule: 'A team-less stint is a SEASON_TOTAL only when its additive stats equal the sum of same-season team stints at its source level (all of them, or an exact subset for a split-season label).',
  candidates: candidates.length,
  season_totals: rows.length,
  tally,
  no_match: noMatch,
  rows,
}
fs.writeFileSync(path.join(here, 'values-decisions.json'), JSON.stringify(out, null, 2) + '\n')
await db.close()
console.log(`candidates ${candidates.length}; season totals ${rows.length} ${JSON.stringify(tally)}; no-match ${noMatch.length}`)
if (noMatch.length || rows.length !== candidates.length) {
  console.error(`UNPROVEN team-less rows: ${noMatch.join('; ')}`)
  process.exit(1)
}
