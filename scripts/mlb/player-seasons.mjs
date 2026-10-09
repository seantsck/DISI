#!/usr/bin/env node
// Fetches season and level histories for reviewed player ids and distills them
// into player/team/level/season stints. Read-only: public endpoints, on-disk
// cache, no database writes.
//
//   node scripts/mlb/player-seasons.mjs --input players.json --out research-output/021
//   players.json: [{ "name": "...", "slug": "...", "signingYear": 2018, "mlbId": 123456 }]

import { config, statsApi } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseMlbPersonId } from './lib/normalize.mjs'
import { normalizePerson } from './lib/normalize.mjs'
import {
  dodgersAffiliationRules, buildAffiliations, distillStints,
} from './lib/development.mjs'
import { defaultClient, fetchPerson, fetchSeasons, readPlayers } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const players = readPlayers(requireArg(args, 'input', 'JSON array of players with mlbId'))
const outDir = args.out || `${config.outputDir}/player-seasons`
const client = defaultClient(args)
const api = statsApi()
const affiliations = buildAffiliations(dodgersAffiliationRules())

const records = []
for (const p of players) {
  const mlbId = parseMlbPersonId(p.mlbId)
  if (!mlbId) {
    records.push({ name: p.name, slug: p.slug ?? null, signingYear: p.signingYear ?? null, mlbId: null, stints: [], note: 'No MLB person id; no development record fetched.' })
    continue
  }
  try {
    const { person, sources: ps } = await fetchPerson(client, mlbId, api)
    const { mlbSplits, milbSplits, sources: ss } = await fetchSeasons(client, mlbId, api)
    const full = normalizePerson(person.raw ?? person)
    const birthDate = person.birthDate ?? full?.birthDate ?? null
    const allSplits = [...milbSplits, ...mlbSplits]
    const stints = distillStints(allSplits, affiliations, { birthDate, sources: [...ps, ...ss] })
    records.push({
      name: p.name,
      slug: p.slug ?? null,
      signingYear: p.signingYear ?? null,
      mlbId,
      mlbFullName: person.fullName ?? null,
      birthDate,
      stints,
      sources: [...ps, ...ss],
    })
  } catch (error) {
    records.push({ name: p.name, slug: p.slug ?? null, signingYear: p.signingYear ?? null, mlbId, stints: [], note: `Fetch error: ${error.message}` })
    process.stderr.write(`error for ${p.name} (${mlbId}): ${error.message}\n`)
  }
}

const stintCount = records.reduce((n, r) => n + (r.stints?.length ?? 0), 0)
const files = writeArtifact(outDir, 'player-seasons', {
  meta: {
    command: 'player-seasons',
    recordCount: records.length,
    stintCount,
    rule: 'One row per player/team/league/level/season stint. Season splits prove appearance, not dates; first/last game dates come only from game-level records.',
  },
  records,
  sortKeys: ['signingYear', 'slug'],
  columns: ['signingYear', 'name', 'mlbId', 'stints.length'],
})
process.stderr.write(`${records.length} players, ${stintCount} stints → ${files.join(', ')} (network ${client.stats.network}, cache ${client.stats.cache})\n`)
