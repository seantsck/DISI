#!/usr/bin/env node
// Lists an organization's "signed free agent" transactions in a date window and
// classifies each signee (international-amateur profile, first professional
// contract). Output is a review artifact; nothing is written to a database.
//
//   node scripts/mlb/org-signings.mjs --year 2022 --start 2022-01-15 --end 2022-12-15
//   node scripts/mlb/org-signings.mjs --team 119 --year 2025 --out research-output/2025

import { config } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseIsoDate } from './lib/normalize.mjs'
import { dedupeBy, firstProfessionalContract, internationalAmateurProfile } from './lib/classify.mjs'
import { defaultClient, fetchPerson, fetchHistory, fetchTeamTransactions } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const team = Number(args.team || config.dodgersTeamId)
const year = Number(requireArg(args, 'year', 'signing year'))
const start = parseIsoDate(args.start || `${year}-01-01`)
const end = parseIsoDate(args.end || `${year}-12-31`)
if (!start || !end) throw new Error('--start/--end must be YYYY-MM-DD')
const outDir = args.out || `${config.outputDir}/org-signings-${team}-${year}`
const client = defaultClient(args)

const window = await fetchTeamTransactions(client, team, start, end)
const signings = dedupeBy(window.transactions.filter((t) => t.typeCode === 'SFA' && t.toTeamId === team), (t) => t.transactionId)

const records = []
for (const tx of signings) {
  try {
    const { person, sources: ps } = await fetchPerson(client, tx.mlbId)
    const { transactions, sources: hs } = await fetchHistory(client, tx.mlbId)
    const profile = internationalAmateurProfile(person, tx.date)
    const contract = firstProfessionalContract(transactions, tx)
    records.push({
      mlbId: tx.mlbId,
      fullName: person.fullName,
      birthDate: person.birthDate,
      birthCountry: person.birthCountry,
      position: person.position,
      transactionId: tx.transactionId,
      transactionDate: tx.date,
      description: tx.description,
      ageAtSigning: profile.ageAtSigning,
      internationalAmateurProfile: profile.fits,
      profileReasons: profile.reasons,
      firstProfessionalContract: contract.first,
      priorContracts: contract.priorContracts.map((t) => ({ date: t.date, typeCode: t.typeCode, description: t.description })),
      sources: [...window.sources, ...ps, ...hs],
    })
  } catch (error) {
    records.push({ mlbId: tx.mlbId, fullName: tx.playerName, transactionDate: tx.date, error: error.message, sources: window.sources })
    process.stderr.write(`error for ${tx.playerName} (${tx.mlbId}): ${error.message}\n`)
  }
}

const files = writeArtifact(outDir, 'org-signings', {
  meta: { command: 'org-signings', team, year, start, end, endpoint: window.sources[0].url, recordCount: records.length },
  records,
  sortKeys: ['transactionDate', 'fullName', 'mlbId'],
  columns: ['transactionDate', 'mlbId', 'fullName', 'position', 'birthCountry', 'birthDate', 'ageAtSigning',
    'internationalAmateurProfile', 'profileReasons', 'firstProfessionalContract', 'error'],
})
process.stderr.write(`${records.length} signings → ${files.join(', ')} (network ${client.stats.network}, cache ${client.stats.cache})\n`)
