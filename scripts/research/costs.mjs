#!/usr/bin/env node
// research:costs - the acquisition-cost research queue. Read-only. UNKNOWN is never $0.
//
//   npm run research:costs -- --missing [--mature] [--mlb yes|no] [--year 2018] [--market Venezuela] [--limit 25]

import { costQueue, costSummary } from '../../lib/research/cost-research.js'
import { parseArgs, emit, run, int } from './lib/cli.mjs'
import { loadDataset } from './lib/source.mjs'

run(async () => {
  const args = parseArgs(process.argv.slice(2))
  const { data } = await loadDataset(args)
  const mlb = args.mlb === 'yes' ? true : args.mlb === 'no' ? false : undefined
  const rows = costQueue(data.decisions, {
    populations: data.populations, missing: args.missing === true, mature: args.mature === true ? true : undefined, mlb,
    year: int(args.year), market: args.market && args.market !== true ? String(args.market) : undefined, limit: int(args.limit),
  })
  emit(args, {
    title: `Acquisition-cost research queue as of ${data.asOf}`,
    rows,
    summary: costSummary(data.decisions),
    columns: ['tier', 'signing_year', 'full_name', 'country_market', 'maturity', 'outcome_state', 'realized_career_bwar', 'cost_state', 'known_acquisition_cost_usd', 'components_missing'],
  })
})
