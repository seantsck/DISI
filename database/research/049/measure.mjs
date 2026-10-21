#!/usr/bin/env node
// Prints the 049 transaction and value measures from a saved research dataset (npm run research:transactions -- --save file.json).
//   node database/research/049/measure.mjs <dataset.json>
// baseline.json is the pre-049 state read from production on 2026-10-21 (generation 6). Nothing here is stored in the database: the blocker
// classification is derived, deterministically, by lib/research/transaction-research.js.
import fs from 'node:fs'
import { assembleDataset } from '../../../lib/research/dataset.js'
import { attributionStateCounts, attributionSummary, openPackages, packageBlockerSplit, packageCompleteness, transactionResearchItems } from '../../../lib/research/transaction-research.js'

const data = assembleDataset(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))
const by = (rows, k) => Object.fromEntries(Object.entries(rows.reduce((m, r) => ({ ...m, [r[k]]: (m[r[k]] ?? 0) + 1 }), {})).sort(([a], [b]) => (a < b ? -1 : 1)))
const items = transactionResearchItems(data, {})
console.log(JSON.stringify({
  as_of: data.asOf,
  generation: data.executive?.generation_id ?? null,
  tracked_signings: data.decisions.length,
  chain_status: attributionSummary(data.decisions).chain_status,
  chains: (({ incomplete_chains, transaction_chains_incomplete, value_blocked_chains }) => ({ incomplete_chains, transaction_chains_incomplete, value_blocked_chains }))(attributionSummary(data.decisions)),
  attribution_states: attributionStateCounts(data.decisions),
  packages: { ...packageCompleteness(data), ...packageBlockerSplit(data) },
  transaction_queue: { items: data.transactionQueue.length, by_issue: by(data.transactionQueue, 'issue') },
  value_queue: { items: data.valueQueue.length, by_issue: by(data.valueQueue, 'issue') },
  items_by_bucket: by(items, 'bucket'),
  open_packages: openPackages(data).map((p) => ({ event_key: p.event_key, package_state: p.package_state, issues: p.issues })),
}, null, 2))
