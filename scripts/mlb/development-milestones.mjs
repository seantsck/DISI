#!/usr/bin/env node
// Produces first-appearance milestone candidates for reviewed players.
// Read-only; every candidate names the evidence that produced it. A milestone
// is emitted only where the underlying event is supported, and a date only
// where a dated record supports it — season precision stays SEASON, never
// January 1, never a season year rewritten as a date.
//
//   node scripts/mlb/development-milestones.mjs --input players.json --out research-output/021

import { config, statsApi } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseMlbPersonId } from './lib/normalize.mjs'
import {
  buildAffiliations, dodgersAffiliationRules, distillStints, buildMilestoneCandidates,
} from './lib/development.mjs'
import { defaultClient, fetchPerson, fetchHistory, fetchSeasons, readPlayers } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const players = readPlayers(requireArg(args, 'input', 'JSON array of players with mlbId'))
const outDir = args.out || `${config.outputDir}/development-milestones`
const client = defaultClient(args)
const api = statsApi()
const affiliations = buildAffiliations(dodgersAffiliationRules())

const records = []
for (const p of players) {
  const mlbId = parseMlbPersonId(p.mlbId)
  if (!mlbId) {
    records.push({ name: p.name, slug: p.slug ?? null, signingYear: p.signingYear ?? null, mlbId: null, milestones: [], note: 'No MLB person id.' })
    continue
  }
  try {
    const { person } = await fetchPerson(client, mlbId, api)
    const { transactions } = await fetchHistory(client, mlbId, api)
    const { mlbSplits, milbSplits, sources } = await fetchSeasons(client, mlbId, api)
    const stints = distillStints([...milbSplits, ...mlbSplits], affiliations, { birthDate: person.birthDate, sources })
    const milestones = buildMilestoneCandidates({
      stints,
      transactions,
      signingDate: p.signingDate ?? null,
      mlbDebutDate: person.mlbDebutDate ?? null,
      auditedThroughSeason: Number(p.auditDate?.slice(0, 4) ?? ''),
    })
    records.push({ name: p.name, slug: p.slug ?? null, signingYear: p.signingYear ?? null, mlbId, milestones })
  } catch (error) {
    records.push({ name: p.name, slug: p.slug ?? null, signingYear: p.signingYear ?? null, mlbId, milestones: [], note: `Fetch error: ${error.message}` })
    process.stderr.write(`error for ${p.name} (${mlbId}): ${error.message}\n`)
  }
}

const milestoneCount = records.reduce((n, r) => n + (r.milestones?.length ?? 0), 0)
const files = writeArtifact(outDir, 'development-milestones', {
  meta: {
    command: 'development-milestones',
    recordCount: records.length,
    milestoneCount,
    rule: 'First-appearance candidates only. datePrecision DAY means a dated record exists; SEASON means only the season is evidenced. Missing milestones are unknown, never "not reached".',
  },
  records,
  sortKeys: ['signingYear', 'slug'],
  columns: ['signingYear', 'name', 'mlbId', 'milestones.length'],
})
process.stderr.write(`${records.length} players, ${milestoneCount} milestone candidates → ${files.join(', ')} (network ${client.stats.network}, cache ${client.stats.cache})\n`)
