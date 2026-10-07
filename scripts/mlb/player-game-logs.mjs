#!/usr/bin/env node
// Fetches dated game-level appearance rows (gameLog) for tracked players, so
// first/last appearance dates and exact level debuts can be verified. Read-only
// and cache-first: reruns reuse the on-disk cache, `--offline` uses only the
// cache and never touches the network. One unavailable endpoint is recorded as
// an error on the player record — it never fails the run.
//
// Two complementary gameLog forms are used, verified against the live API
// (2026-10): the plain form covers only MLB-level games and returns an empty
// stats array for minor leaguers; `leagueListId=milb_all` covers the
// affiliated minor leagues (complex rookie leagues included) and never MLB
// games. Each (season, group) target fetches exactly the forms its reviewed
// stints need: the plain form when the season has an MLB-level stint, the
// milb_all form otherwise. Both return regular-season entries (gameType "R")
// only, so spring training never produces a date.
//
//   node scripts/mlb/player-game-logs.mjs \
//     --input research-output/021-work/players-dev.json \
//     --seasons research-output/021/player-seasons.json \
//     --out research-output/022 [--min-season 2006] [--only <slug>]

import { config, statsApi } from './config.mjs'
import fs from 'node:fs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseMlbPersonId } from './lib/normalize.mjs'
import { extractGameAppearances, GAME_LOG_MIN_SEASON, PARTICIPATION_RULE } from './lib/exact-dates.mjs'
import { defaultClient } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const players = requireArg(args, 'input', 'JSON array of players with mlbId')
const seasonsArt = requireArg(args, 'seasons', 'player-seasons.json artifact (seasons+groups per player)')
const playersList = JSON.parse(fs.readFileSync(players, 'utf8'))
const list = Array.isArray(playersList) ? playersList : playersList.records
const seasonsBySlug = new Map(
  JSON.parse(fs.readFileSync(seasonsArt, 'utf8')).records.map((r) => [r.slug, r])
)
const outDir = args.out || `${config.outputDir}/022`
const minSeason = Number(args['min-season'] ?? GAME_LOG_MIN_SEASON)
const only = args.only ?? null
const client = defaultClient(args)
const api = statsApi()

/**
 * Distinct (season, group) fetch targets from the reviewed season stints.
 * Each target records whether it needs the MLB plain form (the season has an
 * MLB-level reviewed stint) and/or the milb_all form (any non-MLB stint).
 */
function seasonTargets(stints) {
  const byPair = new Map()
  for (const s of stints ?? []) {
    if (s.season == null || s.season < minSeason) continue
    for (const g of s.groups ?? ['hitting']) {
      const key = `${s.season}|${g}`
      const target = byPair.get(key) ?? { season: s.season, group: g, mlbLevel: false, minorLevel: false }
      if (s.level === 'MLB') target.mlbLevel = true
      else target.minorLevel = true
      byPair.set(key, target)
    }
  }
  return [...byPair.values()].sort((a, b) => a.season - b.season || a.group.localeCompare(b.group))
}

const records = []
let fetchCount = 0
for (const p of list) {
  if (only && p.slug !== only) continue
  const mlbId = parseMlbPersonId(p.mlbId)
  if (!mlbId) {
    records.push({ name: p.name, slug: p.slug ?? null, mlbId: null, gameLogs: [], errors: ['No MLB person id.'] })
    continue
  }
  const reviewed = seasonsBySlug.get(p.slug)
  if (!reviewed) {
    records.push({ name: p.name, slug: p.slug ?? null, mlbId, gameLogs: [], errors: ['No reviewed season-splits record.'] })
    continue
  }
  const gameLogs = []
  const errors = []
  for (const target of seasonTargets(reviewed.stints)) {
    const { season, group } = target
    const forms = []
    if (target.mlbLevel) forms.push({ endpoint: 'MLB_GAME_LOG', url: api.gameLog(mlbId, group, season) })
    if (target.minorLevel) forms.push({ endpoint: 'MILB_GAME_LOG', url: api.milbGameLog(mlbId, group, season) })
    for (const form of forms) {
      fetchCount += 1
      try {
        const res = await client.getJson(form.url)
        const appearances = extractGameAppearances(res.data, group)
        gameLogs.push({
          season,
          group,
          endpoint: form.endpoint,
          url: form.url,
          retrievedAt: res.retrievedAt,
          fromCache: res.fromCache,
          appearances,
        })
      } catch (error) {
        errors.push(`${season}/${group} (${form.endpoint}): ${error.message}`)
      }
    }
  }
  records.push({ name: p.name, slug: p.slug ?? null, mlbId, gameLogs, errors })
}

const appearanceCount = records.reduce((n, r) => n + r.gameLogs.reduce((m, g) => m + g.appearances.length, 0), 0)
const files = writeArtifact(outDir, 'player-game-logs', {
  meta: {
    command: 'player-game-logs',
    minSeason,
    recordCount: records.length,
    fetchCount,
    appearanceCount,
    endpoints: {
      MLB_GAME_LOG: 'stats=gameLog plain form — MLB-level games only (empty stats for minor leaguers).',
      MILB_GAME_LOG: 'stats=gameLog&leagueListId=milb_all — affiliated minor-league games, never MLB.',
    },
    participationRule: PARTICIPATION_RULE,
  },
  records,
  sortKeys: ['slug'],
  columns: ['slug', 'mlbId', 'gameLogs.length', 'errors.length'],
})
process.stderr.write(
  `${records.length} players, ${fetchCount} fetches, ${appearanceCount} dated appearances → ${files.join(', ')} ` +
  `(network ${client.stats.network}, cache ${client.stats.cache}, errors ${client.stats.errors})\n`
)
