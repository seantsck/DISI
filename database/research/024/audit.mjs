#!/usr/bin/env node
// Reproducible audit behind migration 024: checks every reviewed progression
// decision against the canonical 001->023 database and lists the evidence the
// review relied on, plus the inversions and heuristic candidates.
//
//   node database/research/024/audit.mjs
//
// Builds 001->023 in an in-memory PGlite database (the manifest minus 024 and
// later), so it never touches a real database and needs no network. Writes
// audit-report.json and exits non-zero if any decision fails its evidence check:
//   * the decision resolves to exactly one first-appearance milestone;
//   * EARLY_CAMEO with an arrival: the arrival is later than the first
//     appearance, and a team stint at that level first appears on that date;
//   * POST_ESTABLISHMENT_APPEARANCE: a higher-level first appearance precedes it.
// Decisions are reviewed inputs (values-decisions.json); this script never
// creates one. Heuristic candidates are reported, never decided.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))
const decisions = JSON.parse(fs.readFileSync(path.join(here, 'values-decisions.json'), 'utf8')).decisions

const db = new PGlite({ extensions: { pgcrypto } })
await db.exec('create role anon nologin; create role authenticated nologin;')
for (const file of manifest.canonical_sql) {
  if (/^02[4-9]_|^0[3-9]\d_/.test(file)) break
  await db.exec(fs.readFileSync(path.join(root, 'database/sql', file), 'utf8'))
}
const query = async (sql, params) => (await db.query(sql, params)).rows

const LADDER = {
  DSL_DEBUT: { rank: 1, tier: 1, levels: ['INTERNATIONAL_ROOKIE'] },
  COMPLEX_DEBUT: { rank: 2, tier: 1, levels: ['COMPLEX_ROOKIE'] },
  A_DEBUT: { rank: 3, tier: 3, levels: ['LOW_A', 'A'] },
  HIGH_A_DEBUT: { rank: 4, tier: 4, levels: ['HIGH_A'] },
  AA_DEBUT: { rank: 5, tier: 5, levels: ['AA'] },
  AAA_DEBUT: { rank: 6, tier: 6, levels: ['AAA'] },
  MLB_DEBUT: { rank: 7, tier: 7, levels: ['MLB'] },
}
const milestones = await query(`select p.slug, m.player_id, m.id, m.event_code, m.milestone_date::text as d,
    coalesce(m.season_year, extract(year from m.milestone_date)::int) as season, m.date_precision::text as prec
  from development_milestones m join players p on p.id = m.player_id
  where m.event_code = any($1) order by 1, 4`, [Object.keys(LADDER)])
const stints = await query(`select p.slug, s.season, s.level::text as level, s.affiliate_team, coalesce(s.g, s.pg) as games,
    s.first_game_date::text as fgd, s.last_game_date::text as lgd
  from player_season_stints s join players p on p.id = s.player_id
  where s.stint_kind = 'TEAM_STINT' order by 1, 2, s.first_game_date nulls last`)
const after = (a, b) => (a.d && b.d ? a.d > b.d : a.season > b.season) // a strictly later than b

const failures = []
const evidence = []
for (const d of decisions) {
  const rule = LADDER[d.event_code]
  const found = milestones.filter((m) => m.slug === d.slug && m.event_code === d.event_code)
  if (found.length !== 1) { failures.push(`${d.slug} ${d.event_code}: ${found.length} milestones`); continue }
  const first = found[0]
  const atLevel = stints.filter((s) => s.slug === d.slug && rule.levels.includes(s.level))
  const higherBefore = milestones.filter((m) => m.slug === d.slug && LADDER[m.event_code].tier > rule.tier && after(first, m))
  const row = {
    slug: d.slug, event_code: d.event_code, progression_role: d.progression_role, review_status: d.review_status,
    first_appearance: first.d ?? String(first.season), first_appearance_precision: first.prec,
    games_at_level: atLevel.reduce((n, s) => n + (s.games ?? 0), 0),
    stints_at_level: atLevel.map((s) => `${s.season} ${s.affiliate_team} ${s.games}G ${s.fgd ?? 'undated'}`),
    higher_first_appearances_before: higherBefore.map((m) => `${m.event_code} ${m.d ?? m.season}`),
    developmental_arrival: d.developmental_arrival_date ?? d.developmental_arrival_season ?? null,
  }
  evidence.push(row)
  if (d.progression_role === 'EARLY_CAMEO' && d.developmental_arrival_date) {
    if (!(d.developmental_arrival_date > (first.d ?? `${first.season}-12-31`))) failures.push(`${d.slug} ${d.event_code}: arrival not after first appearance`)
    if (!atLevel.some((s) => s.fgd === d.developmental_arrival_date)) failures.push(`${d.slug} ${d.event_code}: no team stint at the level first appears on ${d.developmental_arrival_date}`)
    if (Number(d.developmental_arrival_date.slice(0, 4)) !== d.developmental_arrival_season) failures.push(`${d.slug} ${d.event_code}: arrival season mismatch`)
  }
  if (d.progression_role === 'POST_ESTABLISHMENT_APPEARANCE' && higherBefore.length === 0) {
    failures.push(`${d.slug} ${d.event_code}: no higher-level first appearance precedes it`)
  }
}

// Raw first-appearance inversions (rookie levels share one tier) and whether a decision covers them.
const decided = new Set(decisions.map((d) => `${d.slug}|${d.event_code}`))
const inversions = []
for (const lo of milestones) {
  for (const hi of milestones) {
    if (lo.slug !== hi.slug || LADDER[lo.event_code].tier >= LADDER[hi.event_code].tier || !after(lo, hi)) continue
    inversions.push({ slug: lo.slug, lower: `${lo.event_code} ${lo.d ?? lo.season}`, higher: `${hi.event_code} ${hi.d ?? hi.season}`,
      covered: decided.has(`${lo.slug}|${lo.event_code}`) || decided.has(`${hi.slug}|${hi.event_code}`) })
  }
}
// Heuristic level-skip cameo candidates: a High-A/AA/AAA first appearance with no
// first appearance at the level directly below on or before it and <= 2 games at
// the level. Reported for review only.
const BELOW = { HIGH_A_DEBUT: 'A_DEBUT', AA_DEBUT: 'HIGH_A_DEBUT', AAA_DEBUT: 'AA_DEBUT' }
const candidates = []
for (const m of milestones.filter((x) => BELOW[x.event_code])) {
  const below = milestones.find((x) => x.slug === m.slug && x.event_code === BELOW[m.event_code])
  if (below && !after(below, m)) continue
  const games = stints.filter((s) => s.slug === m.slug && LADDER[m.event_code].levels.includes(s.level)).reduce((n, s) => n + (s.games ?? 0), 0)
  if (games > 2) continue
  candidates.push({ slug: m.slug, event_code: m.event_code, first_appearance: m.d ?? String(m.season), games, decided: decided.has(`${m.slug}|${m.event_code}`) })
}

const report = {
  migration: '024_development_progression_decisions',
  decisions: decisions.length,
  reviewed: decisions.filter((d) => d.review_status === 'REVIEWED').length,
  pending: decisions.filter((d) => d.review_status === 'PENDING_REVIEW').length,
  failures,
  evidence,
  raw_inversions: inversions.length,
  uncovered_inversions: inversions.filter((i) => !i.covered),
  inversion_players: [...new Set(inversions.map((i) => i.slug))].sort(),
  level_skip_cameo_candidates: candidates,
  undecided_candidates: candidates.filter((c) => !c.decided).map((c) => c.slug).sort(),
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 2) + '\n')
await db.close()
console.log(`decisions ${report.decisions} (reviewed ${report.reviewed}, pending ${report.pending}); failures ${failures.length}`)
console.log(`raw inversions ${report.raw_inversions} over ${report.inversion_players.length} players; uncovered ${report.uncovered_inversions.length}`)
console.log(`level-skip cameo candidates ${candidates.length}; undecided: ${report.undecided_candidates.join(', ')}`)
if (failures.length || report.uncovered_inversions.length) {
  console.error(failures.join('\n'))
  console.error(JSON.stringify(report.uncovered_inversions))
  process.exit(1)
}
