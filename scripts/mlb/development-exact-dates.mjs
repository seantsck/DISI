#!/usr/bin/env node
// Distills cached gameLog appearances into reviewed exact-date candidates:
//   * SEASON → DAY milestone upgrades (only where the earliest verified
//     appearance at a level falls in the reviewed first season),
//   * per-stint first/last appearance dates,
//   * PROFESSIONAL_DEBUT candidates (exact evidence only),
//   * conflicts (existing exact dates that disagree with game evidence).
// Read-only over the research cache; deterministic; never connects to a
// database. Missing game logs preserve SEASON precision — absence is not
// evidence of absence.
//
//   node scripts/mlb/development-exact-dates.mjs \
//     --seasons research-output/021/player-seasons.json \
//     --milestones research-output/021/development-milestones.json \
//     --game-logs research-output/022/player-game-logs.json \
//     --out research-output/022

import fs from 'node:fs'
import { config } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { attributeAppearances, buildExactDateCandidates, PARTICIPATION_RULE } from './lib/exact-dates.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const seasonsArt = load(requireArg(args, 'seasons'))
const milestonesArt = load(requireArg(args, 'milestones'))
const gameLogsArt = load(requireArg(args, 'game-logs'))
const outDir = args.out || `${config.outputDir}/022`

const seasonsBySlug = new Map(seasonsArt.records.map((r) => [r.slug, r]))
const milestonesBySlug = new Map(milestonesArt.records.map((r) => [r.slug, r]))
const gameLogsBySlug = new Map(gameLogsArt.records.map((r) => [r.slug, r]))

const records = []
for (const seasons of seasonsArt.records) {
  const slug = seasons.slug
  if (!slug) continue
  const stints = seasons.stints ?? []
  const milestones = milestonesBySlug.get(slug)?.milestones ?? []
  const logs = gameLogsBySlug.get(slug)?.gameLogs ?? []
  const gameLogErrors = gameLogsBySlug.get(slug)?.errors ?? []

  // Flatten cached appearances and keep the (url, retrievedAt, endpoint) of the
  // fetch each appearance came from, so every candidate can cite its source.
  // The MLB plain form and the milb_all form are disjoint by league, but as a
  // safety net one dated game is deduped to one appearance per (date, group)
  // when both forms were fetched for a dual-level season; two-way players'
  // hitting and pitching records for the same game stay separate evidence
  // (different group).
  const appearances = []
  const sources = []
  const seenGames = new Set()
  for (const g of logs) {
    sources.push({ url: g.url, retrievedAt: g.retrievedAt, endpoint: g.endpoint ?? null })
    for (const a of g.appearances ?? []) {
      const gameKey = `${a.date}|${a.group}|${a.gamePk ?? `t${a.teamId ?? '?'}`}`
      if (seenGames.has(gameKey)) continue
      seenGames.add(gameKey)
      appearances.push({ ...a, sourceUrl: g.url, retrievedAt: g.retrievedAt })
    }
  }
  const attributed = attributeAppearances(stints, appearances)
  const candidates = buildExactDateCandidates({ stints, milestones, appearances })

  // Attach source citations to each upgrade / new milestone.
  const sourceOf = (date, level) => {
    const hit = attributed.find((a) => a.date === date && (!level || a.level === level))
    return hit ? { url: hit.sourceUrl, retrievedAt: hit.retrievedAt } : null
  }
  const upgrades = candidates.upgrades.map((u) => {
    const src = sourceOf(u.milestoneDate, u.level)
    return { ...u, sourceUrl: src?.url ?? null, retrievedAt: src?.retrievedAt ?? null }
  })
  const newMilestones = candidates.newMilestones.map((m) => {
    const src = sourceOf(m.eventDate, m.level)
    return { ...m, sourceUrl: src?.url ?? null, retrievedAt: src?.retrievedAt ?? null }
  })

  // Stint identity (team/league/level) rides along for the SQL keying.
  const stintById = new Map(stints.map((s) => [`${s.season}|${s.teamId}`, s]))
  const stintDates = candidates.stintDates.map((d) => {
    const s = stintById.get(`${d.season}|${d.teamId}`)
    const src = logs.find((g) => g.season === d.season && (s?.groups ?? []).includes(g.group))
      ?? logs.find((g) => g.season === d.season)
    return {
      ...d,
      teamName: s?.teamName ?? null,
      league: s?.league ?? null,
      level: s?.level ?? null,
      sourceUrl: d.first ? (src?.url ?? null) : null,
      retrievedAt: d.first ? (src?.retrievedAt ?? null) : null,
    }
  })

  records.push({
    slug,
    name: seasons.name,
    mlbId: seasons.mlbId,
    upgrades,
    stintDates,
    newMilestones,
    conflicts: candidates.conflicts,
    coverage: { ...candidates.coverage, gameLogErrors },
  })
}

const totals = records.reduce(
  (acc, r) => ({
    upgrades: acc.upgrades + r.upgrades.length,
    stintDates: acc.stintDates + r.stintDates.filter((s) => s.first).length,
    newMilestones: acc.newMilestones + r.newMilestones.length,
    conflicts: acc.conflicts + r.conflicts.length,
  }),
  { upgrades: 0, stintDates: 0, newMilestones: 0, conflicts: 0 }
)
const files = writeArtifact(outDir, 'development-exact-dates', {
  meta: {
    command: 'development-exact-dates',
    recordCount: records.length,
    totals,
    participationRule: PARTICIPATION_RULE,
    rules: [
      'SEASON → DAY only when the earliest game-verified appearance at the level falls in the reviewed first season.',
      'Existing exact dates are never overwritten; disagreements become conflicts.',
      'Missing game logs preserve SEASON precision; absence is never evidence of absence.',
    ],
  },
  records,
  sortKeys: ['slug'],
  columns: ['slug', 'mlbId', 'upgrades.length', 'stintDates.length', 'newMilestones.length', 'conflicts.length'],
})
process.stderr.write(
  `${records.length} players; upgrades ${totals.upgrades}, stint dates ${totals.stintDates}, ` +
  `new milestones ${totals.newMilestones}, conflicts ${totals.conflicts} → ${files.join(', ')}\n`
)
