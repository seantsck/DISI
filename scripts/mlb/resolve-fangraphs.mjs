#!/usr/bin/env node
// FanGraphs ids from MLB's official cross-reference on the person record.
// No fWAR is collected here: metric collection is a separate operation.
//
//   node scripts/mlb/resolve-fangraphs.mjs --identities research-output/020/player-identities.json [--out dir]

import fs from 'node:fs'
import { config } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { resolveFangraphs, findIdCollisions } from './lib/identity.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const identities = JSON.parse(fs.readFileSync(requireArg(args, 'identities'), 'utf8')).records.filter((r) => r.status === 'FOUND')
const records = identities.map((r) => ({
  slug: r.slug,
  name: r.name,
  mlbId: r.mlbId,
  ...resolveFangraphs(r),
  sources: r.sources.filter((s) => /hydrate=xrefId/.test(s.url)),
}))
const collisions = findIdCollisions(records, 'fangraphsId')
for (const c of collisions) {
  for (const r of records) {
    if (r.fangraphsId === c.id) { r.status = 'CONFLICT'; r.fangraphsId = null; r.note = `FanGraphs id ${c.id} shared by ${c.players.join(', ')}` }
  }
}
const outDir = args.out || `${config.outputDir}/resolve-fangraphs`
const files = writeArtifact(outDir, 'resolve-fangraphs', {
  meta: { command: 'resolve-fangraphs', recordCount: records.length, collisions },
  records,
  sortKeys: ['slug'],
  columns: ['slug', 'name', 'mlbId', 'status', 'fangraphsId', 'method'],
})
process.stderr.write(`${records.filter((r) => r.status === 'RESOLVED').length}/${records.length} FanGraphs ids → ${files.join(', ')}\n`)
