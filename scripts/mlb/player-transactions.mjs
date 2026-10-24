#!/usr/bin/env node
// Fetches the official MLB Stats API transaction log of each player (053): every dated transaction the log carries, with its type code, the
// clubs on each side and the log's own description, and the player's person record (name, birth date, major-league debut, used to check an
// identity and to observe that a player never appeared in the majors). Read-only and cache-first. The log is evidence of a transaction only where it states one: a
// player's appearing for another club is never read as a transaction (TEAM CHANGE != CANONICAL TRANSACTION), and a player the log is silent about
// is never read as released (SOURCE SILENCE != RELEASE).
//
//   node scripts/mlb/player-transactions.mjs --input players.json --out <dir> [--offline]
//
// players.json: [{ "slug": "yasiel-puig", "mlbId": 624577 }, ...]. Writes <dir>/player-transactions.json.

import fs from 'node:fs'
import { config } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { defaultClient } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const input = JSON.parse(fs.readFileSync(requireArg(args, 'input', 'JSON array of { slug, mlbId }'), 'utf8'))
const outDir = args.out || `${config.outputDir}/053`
const client = defaultClient(args)

const transactionsUrl = (mlbId) => `${config.statsApiBase}/transactions?playerId=${mlbId}`
const personUrl = (mlbId) => `${config.statsApiBase}/people/${mlbId}`
const team = (t) => (t ? { id: t.id ?? null, name: t.name ?? null } : null)

const players = [...new Map(input.map((p) => [Number(p.mlbId), { slug: String(p.slug), mlbId: Number(p.mlbId) }])).values()].sort((a, b) => a.mlbId - b.mlbId)

const records = []
for (const { slug, mlbId } of players) {
  const url = transactionsUrl(mlbId)
  let person = null
  try {
    const pr = await client.getJson(personUrl(mlbId))
    const p = pr.data.people?.[0] ?? null
    person = p ? { id: p.id, fullName: p.fullName ?? null, birthDate: p.birthDate ?? null, mlbDebutDate: p.mlbDebutDate ?? null, source: { url: pr.url, retrievedAt: pr.retrievedAt } } : null
  } catch (e) {
    person = { id: mlbId, error: String(e.message ?? e), source: { url: personUrl(mlbId), retrievedAt: null } }
  }
  try {
    const res = await client.getJson(url)
    const rows = (res.data.transactions ?? []).filter((t) => Number(t.person?.id) === mlbId).map((t) => ({
      id: t.id ?? null,
      date: t.date ?? null,
      effectiveDate: t.effectiveDate ?? null,
      resolutionDate: t.resolutionDate ?? null,
      typeCode: t.typeCode ?? null,
      typeDesc: t.typeDesc ?? null,
      fromTeam: team(t.fromTeam),
      toTeam: team(t.toTeam),
      description: t.description ?? null,
    })).sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.id) - Number(b.id))
    records.push({ slug, mlbId, person, transactions: rows, source: { url: res.url, retrievedAt: res.retrievedAt }, error: null })
  } catch (e) {
    records.push({ slug, mlbId, person, transactions: [], source: { url, retrievedAt: null }, error: String(e.message ?? e) })
  }
}

writeArtifact(outDir, 'player-transactions', {
  meta: {
    generatedBy: 'scripts/mlb/player-transactions.mjs',
    endpoint: `${config.statsApiBase}/transactions?playerId={mlbId}`,
    personEndpoint: `${config.statsApiBase}/people/{mlbId}`,
    requests: records.length * 2,
    errors: records.filter((r) => r.error || r.person?.error).length,
  },
  records,
  columns: null,
  sortKeys: ['mlbId'],
})
process.stderr.write(`player-transactions: ${records.length} players, ${records.filter((r) => r.error).length} errors, ${JSON.stringify(client.stats ?? {})}\n`)
