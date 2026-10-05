#!/usr/bin/env node
// Career bWAR from Baseball-Reference's WAR data files for a list of MLB ids.
// The two files are large (~50 MB) and are cached after the first download.
//
//   node scripts/mlb/bref-war.mjs --input players.json [--out dir]
//   (players.json entries need an "mlbId")

import { config, brefData } from './config.mjs'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseMlbPersonId } from './lib/normalize.mjs'
import { aggregateWar, careerBwar } from './lib/bref.mjs'
import { defaultClient, readPlayers } from './lib/fetchers.mjs'
import { writeArtifact } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const players = readPlayers(requireArg(args, 'input', 'JSON array with mlbId'))
const ids = new Set(players.map((p) => parseMlbPersonId(p.mlbId)).filter(Boolean))
const outDir = args.out || `${config.outputDir}/bref-war`
const client = defaultClient(args)
const urls = brefData()

const bat = await client.getText(urls.warBatting)
const pitch = await client.getText(urls.warPitching)
const records = careerBwar(aggregateWar(bat.body, ids), aggregateWar(pitch.body, ids), ids).map((r) => ({
  ...r,
  observedThroughSeason: r.lastYear,
  sources: [{ url: bat.url, retrievedAt: bat.retrievedAt }, { url: pitch.url, retrievedAt: pitch.retrievedAt }],
}))

const files = writeArtifact(outDir, 'bref-war', {
  meta: { command: 'bref-war', requested: ids.size, found: records.length,
    formula: 'career bWAR = sum(war_daily_bat.WAR) + sum(war_daily_pitch.WAR) by mlb_ID',
    observedThroughDate: 'Use the retrievedAt of the source files.' },
  records,
  sortKeys: ['mlbId'],
  columns: ['mlbId', 'brefId', 'careerBwar', 'firstYear', 'lastYear'],
})
process.stderr.write(`${records.length}/${ids.size} players with bWAR → ${files.join(', ')}\n`)
