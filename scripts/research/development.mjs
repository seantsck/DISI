#!/usr/bin/env node
// research:development - the player-development research queue. Read-only. UNKNOWN DEVELOPMENT HISTORY is never "no development".
//
//   npm run research:development -- --missing [--mature] [--mlb yes|no] [--year 2018] [--market Venezuela] [--player slug] [--limit 25]
//   npm run research:development -- --coverage      # per-dimension coverage with denominators
//   npm run research:development -- --timing        # descriptive signing-to-MLB / highest-level facts (no rates, no scores)

import { developmentCoverage, developmentQueue, timingFacts } from '../../lib/research/development-research.js'
import { stableJson } from '../../lib/research/format.js'
import { parseArgs, emit, run, int } from './lib/cli.mjs'
import { loadDataset } from './lib/source.mjs'

run(async () => {
  const args = parseArgs(process.argv.slice(2))
  const { data } = await loadDataset(args)
  if (args.coverage === true || args.timing === true) {
    const result = args.coverage === true ? developmentCoverage(data) : timingFacts(data)
    console.log(args.format === 'json' ? stableJson(result) : `${args.coverage === true ? 'Development-history coverage' : 'Descriptive development timing'} as of ${data.asOf}\n\n${JSON.stringify(result, null, 2)}`)
    return
  }
  const mlb = args.mlb === 'yes' ? true : args.mlb === 'no' ? false : undefined
  const rows = developmentQueue(data, {
    missing: args.missing === true, mature: args.mature === true ? true : undefined, mlb,
    year: int(args.year), market: args.market && args.market !== true ? String(args.market) : undefined,
    player: args.player && args.player !== true ? String(args.player) : undefined, limit: int(args.limit),
  })
  const view = rows.map((r) => ({ ...r, missing_fields: r.missing.join(' '), exit_status: r.exit }))
  emit(args, {
    title: `Development research queue as of ${data.asOf}`,
    rows: view,
    summary: developmentCoverage(data),
    columns: ['rank', 'tier', 'signing_year', 'full_name', 'outcome', 'highest_level', 'mlb_debut_date', 'exit_status', 'source_count', 'missing_fields'],
  })
})
