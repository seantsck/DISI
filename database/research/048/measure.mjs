#!/usr/bin/env node
// Prints the 048 development measures from a saved research dataset that includes the stint history
// (npm run research:development -- --review --save file.json, or --mlb-coverage --save file.json).
//   node database/research/048/measure.mjs <dataset.json>
// baseline.json is the pre-048 state read from production on 2026-10-20 (generation 5).
import fs from 'node:fs'
import { developmentCoverage, developmentQueue, developmentRecords, timingFacts } from '../../../lib/research/development-research.js'
import { assembleDataset } from '../../../lib/research/dataset.js'
import { developmentNeedSummary } from '../../../lib/research/development-needs.js'
import { verifiedMlbCoverage } from '../../../lib/research/history-coverage.js'

const data = assembleDataset(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')))
if (!data.stints.length) throw new Error('This dataset has no stint history; save it with --review or --mlb-coverage.')
const stints = new Map()
for (const s of data.stints) { if (!stints.has(s.player_id)) stints.set(s.player_id, []); stints.get(s.player_id).push(s) }
const { rows, ...coverage } = verifiedMlbCoverage(data, stints, developmentRecords)
const queue = developmentQueue(data)
const tiers = {}
for (const r of queue) tiers[r.tier] = (tiers[r.tier] ?? 0) + 1
console.log(JSON.stringify({
  as_of: data.asOf,
  generation: data.executive?.generation_id ?? null,
  tracked_signings: data.signings.length,
  stints: data.stints.length,
  development_coverage: developmentCoverage(data),
  verified_mlb_coverage: coverage,
  development_queue: { signings_with_a_gap: queue.length, by_tier: tiers },
  development_needs: developmentNeedSummary(data),
  timing: timingFacts(data),
  pending_progression_decisions: data.progressionDecisions.filter((d) => d.review_status === 'PENDING_REVIEW').length,
}, null, 2))
