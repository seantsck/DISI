#!/usr/bin/env node
// research:transactions - transaction chain and trade-package attribution work. Read-only. Package value is never credited to one signing.
//
//   npm run research:transactions -- --missing [--traded] [--unresolved-attribution] [--limit 30]
//   npm run research:transactions -- --chains          incomplete exit chains with the work that completes each

import { attributionSummary, incompleteChains, transactionResearchItems } from '../../lib/research/transaction-research.js'
import { parseArgs, emit, run, int } from './lib/cli.mjs'
import { loadDataset } from './lib/source.mjs'

run(async () => {
  const args = parseArgs(process.argv.slice(2))
  const { data } = await loadDataset(args)
  const summary = attributionSummary(data.decisions)
  if (args.chains) {
    emit(args, { title: 'Incomplete transaction chains', rows: incompleteChains(data.decisions), summary, columns: ['chain_status', 'signing_year', 'full_name', 'work'] })
    return
  }
  const rows = transactionResearchItems(data, { missing: args.missing === true, traded: args.traded === true, unresolvedAttribution: args['unresolved-attribution'] === true, limit: int(args.limit) })
  emit(args, { title: 'Transaction and value research items', rows, summary, columns: ['priority', 'rank', 'queue', 'category', 'issue', 'player_slug', 'event_key', 'asset_name'] })
})
