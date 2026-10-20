#!/usr/bin/env node
// Prints the 047 development / transaction measures from a saved research dataset (npm run research:development -- --save file.json).
//   node database/research/047/measure.mjs <dataset.json>
import fs from 'node:fs'
import { developmentCoverage, developmentQueue, timingFacts } from '../../../lib/research/development-research.js'
import { assembleDataset } from '../../../lib/research/dataset.js'
import { attributionStateCounts, attributionSummary, packageCompleteness } from '../../../lib/research/transaction-research.js'

const data = assembleDataset(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))
const queue = developmentQueue(data)
const tiers = {}
for (const r of queue) tiers[r.tier] = (tiers[r.tier] ?? 0) + 1
console.log(JSON.stringify({
  as_of: data.asOf,
  generation: data.executive?.generation_id ?? null,
  tracked_signings: data.signings.length,
  development_coverage: developmentCoverage(data),
  development_queue: { signings_with_a_gap: queue.length, by_tier: tiers },
  timing: timingFacts(data),
  transactions: { ...attributionSummary(data.decisions), attribution_states: attributionStateCounts(data.decisions), packages: packageCompleteness(data) },
  research_queue_items: { tasks: data.tasks.length, transaction: data.transactionQueue.length, value: data.valueQueue.length, development: data.developmentQueue.length },
}, null, 2))
