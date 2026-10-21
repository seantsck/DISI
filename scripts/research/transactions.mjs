#!/usr/bin/env node
// research:transactions - transaction chain, trade-package and value-attribution work. Read-only. Package value is never credited to one signing.
//
// KNOWN TRANSACTION != KNOWN RETURN VALUE: what is missing is classified, never merged. Every item carries its blocker bucket:
//   CHAIN_OR_MEMBERSHIP  DISI does not know what happened to the asset or who was in the package
//   TERMS                the players are known; a cash or pool-space amount is not
//   VALUE                the transaction is known; the value of the return, or its attribution, is not
//
//   npm run research:transactions -- --missing [--traded] [--unresolved-attribution] [--limit 30]
//   npm run research:transactions -- --chains                    chains whose TRANSACTION history is open, with the work that completes each
//   npm run research:transactions -- --chains --value-blocked    chains whose history is recorded and whose returned players' value is unavailable
//   npm run research:transactions -- --packages [--membership | --terms]   trade packages with an open issue, and what would close each
//   npm run research:transactions -- --ptbnl | --future-consideration | --cash-unknown | --value-blocked    one issue family, item by item
//   npm run research:transactions -- --bucket CHAIN_OR_MEMBERSHIP | TERMS | VALUE | OTHER

import { attributionSummary, attributionStateCounts, BLOCKER_BUCKETS, incompleteChains, openPackages, packageBlockerSplit, packageCompleteness, transactionResearchItems } from '../../lib/research/transaction-research.js'
import { parseArgs, emit, run, int } from './lib/cli.mjs'
import { loadDataset } from './lib/source.mjs'

run(async () => {
  const args = parseArgs(process.argv.slice(2))
  const { data } = await loadDataset(args)
  const summary = { ...attributionSummary(data.decisions), attribution_states: attributionStateCounts(data.decisions), ...packageCompleteness(data), ...packageBlockerSplit(data) }
  if (args.chains) {
    const valueBlocked = args['value-blocked'] === true
    emit(args, {
      title: valueBlocked ? 'Chains whose transaction history is recorded and whose value is unavailable' : 'Chains whose transaction history is open',
      rows: incompleteChains(data.decisions, { bucket: valueBlocked ? 'VALUE' : 'CHAIN_OR_MEMBERSHIP' }),
      summary,
      columns: ['chain_status', 'signing_year', 'full_name', 'bucket', 'attribution_state', 'work'],
    })
    return
  }
  if (args.packages === true) {
    emit(args, {
      title: 'Trade packages with an open issue',
      rows: openPackages(data, { membership: args.membership === true, terms: args.terms === true }),
      summary,
      columns: ['package_state', 'priority', 'event_key', 'issues', 'open_assets', 'next_evidence'],
    })
    return
  }
  const families = { ptbnl: ['PTBNL_UNRESOLVED'], 'future-consideration': ['FUTURE_CONSIDERATIONS_UNRESOLVED'], 'cash-unknown': ['CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN'],
    'value-blocked': ['DOWNSTREAM_WAR_NOT_LOADED', 'OUTCOME_INCOMPLETE'] }
  const family = Object.keys(families).find((k) => args[k] === true)
  const bucket = args.bucket && args.bucket !== true ? String(args.bucket) : undefined
  if (bucket && !BLOCKER_BUCKETS.includes(bucket)) throw new Error(`--bucket is one of ${BLOCKER_BUCKETS.join(', ')}`)
  const rows = transactionResearchItems(data, {
    missing: args.missing === true, traded: args.traded === true, unresolvedAttribution: args['unresolved-attribution'] === true, limit: int(args.limit),
    issues: family ? families[family] : undefined, bucket,
  })
  emit(args, { title: 'Transaction and value research items', rows, summary, columns: ['priority', 'rank', 'bucket', 'queue', 'issue', 'player_slug', 'event_key', 'asset_name', 'next_evidence'] })
})
