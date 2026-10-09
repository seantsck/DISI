#!/usr/bin/env node
// Adds the reviewed MLB-id proposals to the player export, recording the basis
// of each id. Only unambiguous matches are taken:
//   EXISTING                          id already in DISI
//   CLUB_TRANSACTION_MATCH            resolve-ids.mjs: name + signing club + signing year
//   BREF_CITED_BREF_PAGE              resolve-bref.mjs (stage 1): B-Ref page DISI cites → mlb_ID
//   BREF_NAME_DEBUT_YEAR_DEBUT_TEAM   resolve-bref.mjs (stage 1): name + debut year + debut franchise
//   MANUAL_LINKED_SIGNING_TRANSACTION a documented decision (identity-decisions.json) with its evidence
// Players with no such match keep mlbId = null and go to the identity queue.
//
//   node database/research/020/merge-ids.mjs \
//     --players research-output/020/players.json \
//     --league-ids research-output/020/league/resolve-ids.json \
//     --bref research-output/020/bref-stage1/resolve-bref.json \
//     [--decisions database/research/020/identity-decisions.json] \
//     --out research-output/020/players-with-ids.json

import fs from 'node:fs'
import { parseArgs, requireArg } from '../../../scripts/mlb/lib/args.mjs'

const args = parseArgs(process.argv.slice(2))
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const players = load(requireArg(args, 'players'))
const league = new Map(load(requireArg(args, 'league-ids')).records
  .filter((r) => r.status === 'CLUB_TRANSACTION_MATCH' && r.candidates?.length === 1)
  .map((r) => [r.slug, { id: r.candidates[0].mlbId, basis: 'CLUB_TRANSACTION_MATCH' }]))
const bref = new Map(load(requireArg(args, 'bref')).records
  .filter((r) => r.status === 'RESOLVED' && r.mlbId)
  .map((r) => [r.slug, { id: r.mlbId, basis: `BREF_${r.method}` }]))

const decisions = new Map((args.decisions ? load(args.decisions).records : [])
  .map((d) => [d.slug, { id: d.mlbId, basis: d.basis, aliases: d.aliases.map((a) => a.alias) }]))

const out = players.map((p) => {
  if (p.mlbId) return { ...p, idBasis: 'EXISTING' }
  const decision = decisions.get(p.slug)
  if (decision) return { ...p, aliases: [...p.aliases, ...decision.aliases], mlbId: decision.id, idBasis: decision.basis }
  const match = league.get(p.slug) ?? bref.get(p.slug)
  return match ? { ...p, mlbId: match.id, idBasis: match.basis } : { ...p, idBasis: null }
})
fs.writeFileSync(requireArg(args, 'out'), JSON.stringify(out, null, 1))
const count = (b) => out.filter((p) => p.idBasis === b).length
process.stderr.write(`existing ${count('EXISTING')}; club transaction ${count('CLUB_TRANSACTION_MATCH')}; ` +
  `B-Ref ${out.filter((p) => p.idBasis?.startsWith('BREF_')).length}; manual ${out.filter((p) => p.idBasis?.startsWith('MANUAL_')).length}; ` +
  `unresolved ${count(null)}\n`)
