#!/usr/bin/env node
// Official league-season facts from the MLB Stats API (052). Read-only and cache-first.
//   * schedules: how many regular-season games the official schedule holds for a sport (level) in a season. A season with no scheduled
//     regular-season game at any affiliated minor-league level is a league season that was not played: a player's missing affiliated record for
//     it is explained by the league, never by the player. A control season is read beside it so an empty answer is not an endpoint failure.
//   * leagues: which sport (level grouping) a league belonged to in a season. A league's classification is a fact about a season; the
//     Pioneer League, for one, was in the Rookie sport while affiliated and in the Independent sport from 2021.
//
//   node scripts/mlb/league-seasons.mjs --input league-seasons-input.json --out <dir> [--offline]
//
// input: { "schedules": [{ "sportId": 11, "season": 2020 }, ...], "leagues": [{ "leagueId": 128, "season": 2015 }, ...] }

import fs from 'node:fs'
import { config } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { defaultClient } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const input = JSON.parse(fs.readFileSync(requireArg(args, 'input', '{ schedules: [{sportId, season}], leagues: [{leagueId, season}] }'), 'utf8'))
const outDir = args.out || `${config.outputDir}/052`
const client = defaultClient(args)
const base = config.statsApiBase

const scheduleUrl = (sportId, season) => `${base}/schedule?sportId=${sportId}&season=${season}&gameType=R&fields=totalGames`
const leagueUrl = (leagueId, season) => `${base}/league/${leagueId}?season=${season}`

const records = []
const uniq = (rows, key) => [...new Map(rows.map((r) => [key(r), r])).values()]
for (const { sportId, season } of uniq(input.schedules ?? [], (r) => `${r.sportId}|${r.season}`).sort((a, b) => a.sportId - b.sportId || a.season - b.season)) {
  const url = scheduleUrl(sportId, season)
  try {
    const res = await client.getJson(url)
    records.push({ kind: 'SCHEDULE', key: `${sportId}|${season}`, sportId, season, regularSeasonGames: Number(res.data.totalGames ?? 0), leagueId: null, leagueName: null,
      leagueSportId: null, source: { url: res.url, retrievedAt: res.retrievedAt }, error: null })
  } catch (e) {
    records.push({ kind: 'SCHEDULE', key: `${sportId}|${season}`, sportId, season, regularSeasonGames: null, leagueId: null, leagueName: null, leagueSportId: null,
      source: { url, retrievedAt: null }, error: String(e.message ?? e) })
  }
}
for (const { leagueId, season } of uniq(input.leagues ?? [], (r) => `${r.leagueId}|${r.season}`).sort((a, b) => a.leagueId - b.leagueId || a.season - b.season)) {
  const url = leagueUrl(leagueId, season)
  try {
    const res = await client.getJson(url)
    const l = res.data.leagues?.[0] ?? null
    records.push({ kind: 'LEAGUE', key: `${leagueId}|${season}`, sportId: null, season, regularSeasonGames: null, leagueId, leagueName: l?.name ?? null,
      leagueSportId: l?.sport?.id ?? null, source: { url: res.url, retrievedAt: res.retrievedAt }, error: null })
  } catch (e) {
    records.push({ kind: 'LEAGUE', key: `${leagueId}|${season}`, sportId: null, season, regularSeasonGames: null, leagueId, leagueName: null, leagueSportId: null,
      source: { url, retrievedAt: null }, error: String(e.message ?? e) })
  }
}

writeArtifact(outDir, 'league-seasons', {
  meta: { generatedBy: 'scripts/mlb/league-seasons.mjs', requests: records.length, errors: records.filter((r) => r.error).length },
  records,
  columns: null,
  sortKeys: ['kind', 'key'],
})
process.stderr.write(`league-seasons: ${records.length} records, ${records.filter((r) => r.error).length} errors\n`)
