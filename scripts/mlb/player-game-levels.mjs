#!/usr/bin/env node
// Resolves team/league/level classifications and, where the API supports them,
// first/last game dates at each level, from game-log endpoints. Read-only and
// cached; classification happens in lib/development.mjs.
//
//   node scripts/mlb/player-game-levels.mjs --input players.json --out research-output/021
//   --game-logs to request dated game logs (only where the API supports them)

import { config, statsApi } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseMlbPersonId } from './lib/normalize.mjs'
import { buildAffiliations, dodgersAffiliationRules, classifyLevel, eraFor } from './lib/development.mjs'
import { defaultClient, fetchSeasons, readPlayers } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const players = readPlayers(requireArg(args, 'input', 'JSON array of players with mlbId'))
const outDir = args.out || `${config.outputDir}/player-game-levels`
const wantGameLogs = Boolean(args['game-logs'])
const client = defaultClient(args)
const api = statsApi()
const affiliations = buildAffiliations(dodgersAffiliationRules())

/** Distinct (season, team, league) pairs from a player's season splits. */
function seasonTeams(splits) {
  const seen = new Map()
  for (const s of splits) {
    if (s.sportId === 21) continue
    const key = [s.season, s.teamId ?? '', s.league ?? '', s.level].join('|')
    if (!seen.has(key)) seen.set(key, s)
  }
  return [...seen.values()]
}

const records = []
for (const p of players) {
  const mlbId = parseMlbPersonId(p.mlbId)
  if (!mlbId) {
    records.push({ name: p.name, slug: p.slug ?? null, mlbId: null, levels: [], note: 'No MLB person id.' })
    continue
  }
  try {
    const { mlbSplits, milbSplits } = await fetchSeasons(client, mlbId, api)
    const levels = []
    for (const split of seasonTeams([...milbSplits, ...mlbSplits])) {
      const { canonical, classification: cls, rule } = classifyLevel(split)
      const row = {
        season: split.season,
        teamId: split.teamId ?? null,
        teamName: split.teamName ?? null,
        league: split.league ?? null,
        sourceLevel: split.level,
        level: canonical,
        classification: cls,
        classificationRule: rule,
        era: eraFor(split.season),
      }
      if (wantGameLogs && split.teamId && split.season >= 2006) {
        // Game logs are only requested where supported; a failure or an empty
        // response is recorded, never treated as "no participation".
        try {
          const url = api.gameLog(mlbId, split.group === 'pitching' ? 'pitching' : 'hitting', split.season)
          const res = await client.getJson(url)
          const dates = (res.data.stats?.[0]?.splits ?? [])
            .map((g) => g.date)
            .filter(Boolean)
            .sort()
          row.gameCount = dates.length
          row.firstGameDate = dates[0] ?? null
          row.lastGameDate = dates.at(-1) ?? null
          row.gameLogUrl = url
          row.gameLogSources = [{ url: res.url, retrievedAt: res.retrievedAt }]
        } catch (error) {
          row.gameLogError = error.message
        }
      }
      levels.push(row)
    }
    records.push({ name: p.name, slug: p.slug ?? null, mlbId, levels })
  } catch (error) {
    records.push({ name: p.name, slug: p.slug ?? null, mlbId, levels: [], note: `Fetch error: ${error.message}` })
    process.stderr.write(`error for ${p.name} (${mlbId}): ${error.message}\n`)
  }
}

const files = writeArtifact(outDir, 'player-game-levels', {
  meta: {
    command: 'player-game-levels',
    wantGameLogs,
    recordCount: records.length,
    rule: 'Classification only. Dates appear only when a dated game-level record supports them.',
  },
  records,
  sortKeys: ['slug'],
  columns: ['slug', 'mlbId', 'levels.length'],
})
process.stderr.write(`${records.length} players → ${files.join(', ')} (network ${client.stats.network}, cache ${client.stats.cache})\n`)
