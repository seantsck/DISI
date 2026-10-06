#!/usr/bin/env node
// Identity and biography records for players with MLB ids: canonical MLB name,
// birth date and place, bats / throws, height / weight, position, MLB
// cross-reference ids, and the position in the club's signing transaction.
//
//   node scripts/mlb/player-identities.mjs --input players.json [--out dir]
//   players.json: [{ "slug": "...", "name": "...", "mlbId": 682946, "signingYear": 2018,
//                    "signingDate": "2018-07-02", "teamAbbr": "LAD" }, ...]

import { config, statsApi } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseMlbPersonId } from './lib/normalize.mjs'
import { signingPosition } from './lib/identity.mjs'
import { defaultClient, fetchIdentity, fetchHistory, fetchTeamIds, readPlayers } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const players = readPlayers(requireArg(args, 'input', 'JSON array of players with mlbId'))
const outDir = args.out || `${config.outputDir}/player-identities`
const client = defaultClient(args)
const api = statsApi()
const { map: teamIds, sources: teamSources } = await fetchTeamIds(client, 2024, api)

const records = []
for (const p of players) {
  const mlbId = parseMlbPersonId(p.mlbId)
  if (!mlbId) {
    records.push({ slug: p.slug ?? null, name: p.name, mlbId: null, status: 'NO_MLB_ID' })
    continue
  }
  try {
    const { person, sources: ps } = await fetchIdentity(client, mlbId, api)
    const { transactions, sources: hs } = await fetchHistory(client, mlbId, api)
    const teamId = teamIds[p.teamAbbr || 'LAD'] ?? config.dodgersTeamId
    const atSigning = p.signingYear ? signingPosition(transactions, { teamId, signingYear: p.signingYear, signingDate: p.signingDate }) : null
    records.push({
      slug: p.slug ?? null,
      name: p.name,
      status: 'FOUND',
      mlbId,
      mlbFullName: person.fullName,
      birthDate: person.birthDate,
      birthCity: person.birthCity,
      birthStateProvince: person.birthStateProvince,
      birthCountry: person.birthCountry,
      rawBirthCountry: person.rawBirthCountry,
      bats: person.bats,
      throws: person.throws,
      heightIn: person.heightIn,
      weightLb: person.weightLb,
      currentPosition: person.position,
      mlbDebutDate: person.mlbDebutDate,
      xref: person.xref,
      positionAtSigning: atSigning,
      sources: [...ps, ...hs, ...(atSigning ? teamSources : [])],
    })
  } catch (error) {
    records.push({ slug: p.slug ?? null, name: p.name, mlbId, status: 'ERROR', error: error.message })
    process.stderr.write(`error for ${p.name} (${mlbId}): ${error.message}\n`)
  }
}

const files = writeArtifact(outDir, 'player-identities', {
  meta: { command: 'player-identities', recordCount: records.length, endpoint: api.personIdentity('{id}') },
  records,
  sortKeys: ['slug', 'mlbId'],
  columns: ['slug', 'name', 'mlbId', 'status', 'mlbFullName', 'birthDate', 'birthCity', 'birthStateProvince', 'birthCountry',
    'bats', 'throws', 'heightIn', 'weightLb', 'currentPosition', 'mlbDebutDate'],
})
process.stderr.write(`${records.length} players → ${files.join(', ')} (network ${client.stats.network}, cache ${client.stats.cache})\n`)
