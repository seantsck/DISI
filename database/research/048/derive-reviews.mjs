#!/usr/bin/env node
// Finds the cohort players whose level sequence is ambiguous and writes their PENDING progression reviews into development-cohort.json.
//
//   node database/research/048/derive-reviews.mjs <pipeline-output-dir>
//
// A developmental inversion is two first appearances that run backward: a lower ladder level first recorded in a LATER season than a higher
// one (rookie levels share one tier, the same rule as Migration 024's v_player_development_progression). The pipeline records first
// appearances at season precision, so the comparison is by season. Every event named in an inversion becomes a REVIEW_REQUIRED /
// PENDING_REVIEW decision: this script never decides whether a later lower-level appearance was a rehabilitation or a reassignment, or an
// earlier higher-level one an early cameo. A reviewer decides, from the evidence the note lists. Deterministic.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(process.argv[2])
const cohortPath = path.join(here, 'development-cohort.json')
const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'))
// players Migration 021 already researched keep their reviewed (024) decisions; 048 adds nothing for them, so it asks for no review
const ALREADY = new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(here, 'existing-development.json'), 'utf8')).players))
const slugs = new Set(cohort.players.map((p) => p.slug).filter((s) => !ALREADY.has(s)))
const seasons = JSON.parse(fs.readFileSync(path.join(dir, 'player-seasons.json'), 'utf8')).records.filter((r) => slugs.has(r.slug))
const milestones = JSON.parse(fs.readFileSync(path.join(dir, 'development-milestones.json'), 'utf8')).records.filter((r) => slugs.has(r.slug))

// the ladder of Migration 024: event, canonical level, tier (rookie levels share tier 1)
const LADDER = [
  ['DSL_DEBUT', 'INTERNATIONAL_ROOKIE', 1], ['COMPLEX_DEBUT', 'COMPLEX_ROOKIE', 1], ['A_DEBUT', 'LOW_A', 3],
  ['HIGH_A_DEBUT', 'HIGH_A', 4], ['AA_DEBUT', 'AA', 5], ['AAA_DEBUT', 'AAA', 6],
]
const LABEL = { INTERNATIONAL_ROOKIE: 'DSL', COMPLEX_ROOKIE: 'Complex', LOW_A: 'Low-A', HIGH_A: 'High-A', AA: 'Double-A', AAA: 'Triple-A' }
/** @type {Record<string, string>} */
const LEVEL_OF = Object.fromEntries(LADDER.map(([e, l]) => [e, String(l)]))
/** @type {Record<string, number>} */
const TIER = Object.fromEntries(LADDER.map(([e, , t]) => [e, Number(t)]))
const games = (s) => s.batting?.games ?? s.pitchingLine?.games ?? s.pitching?.games ?? null

const reviews = []
const report = []
for (const m of milestones.sort((a, b) => (a.slug < b.slug ? -1 : 1))) {
  const debut = m.milestones.find((x) => x.milestone === 'MLB_DEBUT')
  // the same rule as derive-development.mjs: a level debut dated after the MLB debut season is a rehab or demotion, not a milestone
  const first = Object.fromEntries(m.milestones.filter((x) => TIER[x.milestone] != null && x.season <= debut.season).map((x) => [x.milestone, x.season]))
  const events = Object.keys(first)
  /** @type {Set<string>} */
  const flagged = new Set()
  for (const lo of events) {
    for (const hi of events) if (TIER[hi] > TIER[lo] && first[lo] > first[hi]) { flagged.add(lo); flagged.add(hi) }
  }
  if (flagged.size === 0) continue
  const rec = seasons.find((r) => r.slug === m.slug)
  const byKey = new Map()
  for (const s of rec.stints.filter((x) => x.stintKind === 'TEAM_STINT' && x.season <= debut.season && LEVEL_OF && Object.values(LEVEL_OF).includes(x.level))) {
    const k = `${s.season}|${s.level}`
    const cur = byKey.get(k) ?? { season: s.season, level: s.level, g: 0, teams: new Set() }
    cur.g += games(s) ?? 0
    if (s.teamName) cur.teams.add(s.teamName)
    byKey.set(k, cur)
  }
  const path_ = [...byKey.values()].sort((a, b) => a.season - b.season || LADDER.findIndex((x) => x[1] === a.level) - LADDER.findIndex((x) => x[1] === b.level))
    .map((x) => `${x.season} ${LABEL[x.level]} ${x.g} G`).join('; ')
  const named = [...flagged].sort((a, b) => TIER[a] - TIER[b] || (a < b ? -1 : 1)).map((e) => `${LABEL[LEVEL_OF[e]]} (first recorded ${first[e]})`).join(', ')
  const note = `Unresolved sequence before the MLB debut on ${debut.eventDate ?? debut.season}: ${path_}. First appearances run backward: ${named}. ` +
    'Whether the later lower-level appearance was a rehabilitation or a reassignment, or the earlier higher-level one an early cameo, is not decided; ' +
    'none of these levels is accepted as a developmental arrival until a reviewer decides.'
  for (const e of [...flagged].sort()) {
    reviews.push({ slug: m.slug, event_code: e, decision_basis: 'STINT_CHRONOLOGY_REVIEW', confidence: 'LOW', as_of_date: cohort.as_of_date, notes: note })
  }
  report.push(`${m.slug}: ${[...flagged].sort().join(', ')}`)
}
// keep the 047 convention: reviews ordered by player then event
reviews.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.event_code < b.event_code ? -1 : 1))
cohort.progression_reviews = reviews
fs.writeFileSync(cohortPath, JSON.stringify(cohort, null, 2) + '\n')
console.log(`${report.length} players, ${reviews.length} pending reviews\n${report.join('\n')}`)
