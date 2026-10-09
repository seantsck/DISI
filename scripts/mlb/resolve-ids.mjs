#!/usr/bin/env node
// Proposes MLB person ids for players that do not have one. Strongest evidence
// is a Dodgers "signed free agent" transaction for a player with the same
// (accent-folded) name around the signing year. Name-search hits are reported
// separately and never treated as resolved.
//
//   node scripts/mlb/resolve-ids.mjs --input players.json [--team 119] [--out dir]
//   players.json: [{ "name": "Gregory Pereira", "signingYear": 2018, "aliases": [], "teamAbbr": "LAD" }, ...]
//   teamAbbr (optional) matches against that club's transactions instead of --team.

import { config, statsApi } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { foldText } from '../../lib/text.js'
import { defaultClient, fetchPerson, fetchTeamIds, fetchTeamTransactions, readPlayers } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const players = readPlayers(requireArg(args, 'input', 'JSON array of players'))
const team = Number(args.team || config.dodgersTeamId)
const outDir = args.out || `${config.outputDir}/resolve-ids`
const client = defaultClient(args)
const api = statsApi()
// Folded, separator-free name without parenthetical qualifiers such as "(prospect)":
// "De Leon" = "DeLeon", "Miguel Angel" = "Miguelangel".
const key = (s) => foldText(String(s).replace(/\([^)]*\)/g, ' ')).replace(/[^a-z0-9]/g, '')
const describedName = (t) => t.description.match(/signed (?:free agent )?\S+ (.+?)(?: to a|\.$)/i)?.[1] ?? ''
const SIGNING_CODES = new Set(['SFA', 'SGN'])

const windows = new Map()
async function teamYear(teamId, year) {
  const k = `${teamId}:${year}`
  if (!windows.has(k)) windows.set(k, await fetchTeamTransactions(client, teamId, `${year}-01-01`, `${year}-12-31`, api))
  return windows.get(k)
}
let teamIds = null
async function teamFor(p) {
  if (!p.teamAbbr) return team
  teamIds ??= (await fetchTeamIds(client, 2024, api)).map
  return teamIds[p.teamAbbr] ?? null
}

const records = []
for (const p of players) {
  if (p.mlbId) continue
  const names = [p.name, ...(p.aliases || [])].map(key)
  const hits = new Map()
  const sources = []
  const teamId = await teamFor(p)
  if (!teamId) {
    records.push({ name: p.name, slug: p.slug ?? null, signingYear: p.signingYear, status: 'NOT_FOUND', candidates: [], note: `Unknown club ${p.teamAbbr}`, sources })
    continue
  }
  for (const year of [p.signingYear - 1, p.signingYear, p.signingYear + 1]) {
    const w = await teamYear(teamId, year)
    sources.push(...w.sources)
    for (const t of w.transactions) {
      if (SIGNING_CODES.has(t.typeCode) && t.toTeamId === teamId
        && (names.includes(key(t.playerName || '')) || names.includes(key(describedName(t))))) {
        hits.set(t.mlbId, { mlbId: t.mlbId, date: t.date, description: t.description })
      }
    }
  }
  let status
  let candidates = [...hits.values()]
  const matchStatus = teamId === config.dodgersTeamId ? 'DODGERS_TRANSACTION_MATCH' : 'CLUB_TRANSACTION_MATCH'
  if (candidates.length === 1) status = matchStatus
  else if (candidates.length > 1) status = 'AMBIGUOUS_TRANSACTION_MATCH'
  else {
    const res = await client.getJson(api.peopleSearch(p.name))
    sources.push({ url: res.url, retrievedAt: res.retrievedAt })
    candidates = (res.data.people || []).map((x) => ({ mlbId: x.id, fullName: x.fullName, birthDate: x.birthDate ?? null, birthCountry: x.birthCountry ?? null }))
    status = candidates.length ? 'NAME_SEARCH_ONLY' : 'NOT_FOUND'
  }
  const detail = []
  if (status === matchStatus) {
    const { person, sources: ps } = await fetchPerson(client, candidates[0].mlbId, api)
    sources.push(...ps)
    detail.push({ ...candidates[0], fullName: person.fullName, birthCountry: person.birthCountry, birthDate: person.birthDate, mlbDebutDate: person.mlbDebutDate })
  }
  records.push({ name: p.name, slug: p.slug ?? null, signingYear: p.signingYear, teamAbbr: p.teamAbbr ?? null, status, candidates: detail.length ? detail : candidates, sources })
}

const files = writeArtifact(outDir, 'resolve-ids', {
  meta: { command: 'resolve-ids', team, recordCount: records.length, rule: 'Only DODGERS_TRANSACTION_MATCH / CLUB_TRANSACTION_MATCH are proposed resolutions; every other status requires manual research.' },
  records,
  sortKeys: ['signingYear', 'name'],
  columns: ['signingYear', 'name', 'status', 'candidates'],
})
process.stderr.write(`${records.length} players → ${files.join(', ')}\n`)
