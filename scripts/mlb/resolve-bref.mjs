#!/usr/bin/env node
// Resolves Baseball-Reference ids from Baseball-Reference's own WAR files
// (mlb_ID → player_ID), cross-checked against MLB's Lahman cross-reference and
// any B-Ref page DISI already cites. Ambiguous or name-only matches are never
// selected automatically.
//
//   node scripts/mlb/resolve-bref.mjs --input players.json [--identities player-identities.json] [--out dir]
//   players.json entries: { slug, name, aliases?, mlbId?, brefHint?, reachedMlb?, debutDate?, debutTeam? }

import { config, brefData } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseMlbPersonId } from './lib/normalize.mjs'
import { indexWarFiles, resolveBref, findIdCollisions } from './lib/identity.mjs'
import { defaultClient, readPlayers } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'
import fs from 'node:fs'

const args = parseArgs(process.argv.slice(2))
const players = readPlayers(requireArg(args, 'input'))
const identities = args.identities
  ? new Map(JSON.parse(fs.readFileSync(args.identities, 'utf8')).records.map((r) => [r.slug, r]))
  : new Map()
const outDir = args.out || `${config.outputDir}/resolve-bref`
const client = defaultClient(args)
const urls = brefData()
const bat = await client.getText(urls.warBatting)
const pitch = await client.getText(urls.warPitching)
const index = indexWarFiles(bat.body, pitch.body)
const fileSources = [{ url: bat.url, retrievedAt: bat.retrievedAt }, { url: pitch.url, retrievedAt: pitch.retrievedAt }]

const records = players.map((p) => {
  const ident = identities.get(p.slug)
  const result = resolveBref({
    mlbId: parseMlbPersonId(p.mlbId ?? ident?.mlbId),
    brefHint: p.brefHint ?? null,
    lahman: ident?.xref?.lahman ?? null,
    name: p.name,
    aliases: [...(p.aliases || []), ...(ident?.mlbFullName ? [ident.mlbFullName] : [])],
    debutDate: p.debutDate ?? ident?.mlbDebutDate ?? null,
    debutTeam: p.debutTeam ?? null,
    // Only a resolved MLB identity can establish "no MLB debut"; an unresolved player stays open.
    reachedMlb: p.reachedMlb ?? (ident?.status === 'FOUND' ? Boolean(ident.mlbDebutDate) : undefined),
  }, index)
  return {
    slug: p.slug ?? null,
    name: p.name,
    ...result,
    query: { mlbId: p.mlbId ?? ident?.mlbId ?? null, brefHint: p.brefHint ?? null, lahman: ident?.xref?.lahman ?? null, debutDate: p.debutDate ?? null, debutTeam: p.debutTeam ?? null },
    sources: fileSources,
  }
})

// One B-Ref id may belong to one DISI player only.
const collisions = findIdCollisions(records.filter((r) => r.status === 'RESOLVED'), 'brefId')
for (const c of collisions) {
  for (const r of records) {
    if (r.brefId === c.id) { r.status = 'CONFLICT'; r.note = `B-Ref id ${c.id} matched to several DISI players: ${c.players.join(', ')}` }
  }
}

const files = writeArtifact(outDir, 'resolve-bref', {
  meta: { command: 'resolve-bref', recordCount: records.length, collisions,
    rule: 'Only RESOLVED is applied. AMBIGUOUS / NEEDS_REVIEW / CONFLICT go to the identity research queue.' },
  records,
  sortKeys: ['slug'],
  columns: ['slug', 'name', 'status', 'brefId', 'mlbId', 'method', 'confidence', 'signals', 'note'],
})
const count = (s) => records.filter((r) => r.status === s).length
process.stderr.write(`resolved ${count('RESOLVED')}, ambiguous ${count('AMBIGUOUS')}, review ${count('NEEDS_REVIEW')}, conflict ${count('CONFLICT')}, not found ${count('NOT_FOUND')}, n/a ${count('NOT_APPLICABLE')} → ${files.join(', ')}\n`)
