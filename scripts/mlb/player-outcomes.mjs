#!/usr/bin/env node
// Builds outcome-audit candidates for players with MLB ids: MLB debut, highest
// affiliated level, last affiliated season and team, final transaction, and a
// recommended audit state with its reason. Review before turning into SQL.
//
//   node scripts/mlb/player-outcomes.mjs --input players.json --audit-date 2026-10-05
//   players.json: [{ "name": "...", "signingYear": 2018, "mlbId": 123456 }, ...]

import { config, statsApi } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseIsoDate, parseMlbPersonId } from './lib/normalize.mjs'
import { summarizeOutcome } from './lib/classify.mjs'
import { defaultClient, fetchPerson, fetchHistory, fetchSeasons, readPlayers } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const players = readPlayers(requireArg(args, 'input', 'JSON array of players with mlbId'))
const auditDate = parseIsoDate(requireArg(args, 'audit-date', 'YYYY-MM-DD'))
if (!auditDate) throw new Error('--audit-date must be YYYY-MM-DD')
const outDir = args.out || `${config.outputDir}/player-outcomes`
const client = defaultClient(args)
const api = statsApi()

const records = []
for (const p of players) {
  const mlbId = parseMlbPersonId(p.mlbId)
  if (!mlbId) {
    records.push({ name: p.name, slug: p.slug ?? null, signingYear: p.signingYear, mlbId: null, recommendation: 'INSUFFICIENT_EVIDENCE', reason: 'No MLB person id.' })
    continue
  }
  try {
    const { person, sources: ps } = await fetchPerson(client, mlbId, api)
    const { transactions, sources: hs } = await fetchHistory(client, mlbId, api)
    const { mlbSplits, milbSplits, sources: ss } = await fetchSeasons(client, mlbId, api)
    const summary = summarizeOutcome({ person, mlbSplits, milbSplits, transactions, auditDate })
    records.push({
      name: p.name,
      slug: p.slug ?? null,
      signingYear: p.signingYear,
      mlbFullName: person.fullName,
      birthCountry: person.birthCountry,
      ...summary,
      sources: [...ps, ...hs, ...ss],
    })
  } catch (error) {
    records.push({ name: p.name, slug: p.slug ?? null, signingYear: p.signingYear, mlbId, recommendation: 'INSUFFICIENT_EVIDENCE', reason: `Fetch error: ${error.message}` })
    process.stderr.write(`error for ${p.name} (${mlbId}): ${error.message}\n`)
  }
}

const files = writeArtifact(outDir, 'player-outcomes', {
  meta: { command: 'player-outcomes', auditDate, recordCount: records.length,
    rule: 'Recommendations only. INSUFFICIENT_EVIDENCE is never a negative outcome; NO_MLB_ACTIVE_IN_MINORS is not a failure.' },
  records,
  sortKeys: ['signingYear', 'name'],
  columns: ['signingYear', 'name', 'mlbId', 'recommendation', 'mlbDebutDate', 'mlbDebutTeam', 'highestLevel',
    'highestLevelSeason', 'lastAffiliatedSeason', 'lastAffiliatedTeam', 'disposition', 'reason'],
})
process.stderr.write(`${records.length} players → ${files.join(', ')} (network ${client.stats.network}, cache ${client.stats.cache})\n`)
