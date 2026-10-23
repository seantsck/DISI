#!/usr/bin/env node
// Fetches the official MLB Stats API team record for each (team id, season) pair: the team's own name that season, its sport (level grouping),
// its league and, for a minor-league affiliate, the parent organization that season (052). Read-only and cache-first. An affiliate name is never
// enough to name an organization: the same team name has belonged to different organizations in different seasons, so the record is keyed by
// the stint's own team id AND season, and nothing here is carried to another season.
//
//   node scripts/mlb/team-seasons.mjs --input pairs.json --out <dir> [--offline]
//
// pairs.json: [{ "teamId": 530, "season": 2015 }, ...]. Writes <dir>/team-seasons.json.

import fs from 'node:fs'
import { config } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { defaultClient } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const input = JSON.parse(fs.readFileSync(requireArg(args, 'input', 'JSON array of { teamId, season }'), 'utf8'))
const outDir = args.out || `${config.outputDir}/052`
const client = defaultClient(args)

/** The team-season URL (the hydrate adds the sport and league objects to the team record). */
const teamSeasonUrl = (teamId, season) => `${config.statsApiBase}/teams/${teamId}?season=${season}&hydrate=league,sport`

const pairs = [...new Map(input.map((p) => [`${Number(p.teamId)}|${Number(p.season)}`, { teamId: Number(p.teamId), season: Number(p.season) }])).values()]
  .sort((a, b) => a.teamId - b.teamId || a.season - b.season)

const records = []
for (const { teamId, season } of pairs) {
  const url = teamSeasonUrl(teamId, season)
  try {
    const res = await client.getJson(url)
    const t = res.data.teams?.[0] ?? null
    records.push({
      teamId,
      season,
      found: Boolean(t),
      teamName: t?.name ?? null,
      sportId: t?.sport?.id ?? null,
      sportName: t?.sport?.name ?? null,
      sportAbbr: t?.sport?.abbreviation ?? null,
      leagueId: t?.league?.id ?? null,
      leagueName: t?.league?.name ?? null,
      // a major-league club is its own organization; an affiliate names its parent for that season
      parentOrgId: t ? (t.sport?.id === 1 ? t.id : t.parentOrgId ?? null) : null,
      parentOrgName: t ? (t.sport?.id === 1 ? t.name : t.parentOrgName ?? null) : null,
      source: { url: res.url, retrievedAt: res.retrievedAt },
      error: null,
    })
  } catch (e) {
    records.push({ teamId, season, found: false, teamName: null, sportId: null, sportName: null, sportAbbr: null, leagueId: null, leagueName: null,
      parentOrgId: null, parentOrgName: null, source: { url, retrievedAt: null }, error: String(e.message ?? e) })
  }
}

writeArtifact(outDir, 'team-seasons', {
  meta: {
    generatedBy: 'scripts/mlb/team-seasons.mjs',
    endpoint: `${config.statsApiBase}/teams/{teamId}?season={season}&hydrate=league,sport`,
    requests: records.length,
    errors: records.filter((r) => r.error).length,
  },
  records,
  columns: null,
  sortKeys: ['teamId', 'season'],
})
process.stderr.write(`team-seasons: ${records.length} pairs, ${records.filter((r) => r.error).length} errors, ${JSON.stringify(client.stats ?? {})}\n`)
