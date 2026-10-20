#!/usr/bin/env node
// research:readiness - exact blockers for rates, probabilities, expected value and recommendations. Read-only.
// Derived deterministically from the persisted snapshots; nothing is estimated.

import { readinessBlockers, evidenceBlockers } from '../../lib/research/readiness-blockers.js'
import { buildOutcomeCohort, cohortSummary } from '../../lib/research/outcome-cohort.js'
import { developmentCoverage } from '../../lib/research/development-research.js'
import { packageCompleteness } from '../../lib/research/transaction-research.js'
import { parseArgs, run } from './lib/cli.mjs'
import { stableJson } from '../../lib/research/format.js'
import { loadDataset } from './lib/source.mjs'

run(async () => {
  const args = parseArgs(process.argv.slice(2))
  const { data } = await loadDataset(args)
  const cohort = buildOutcomeCohort({ signings: data.signings, directory: data.directory, matureQueue: data.matureQueue, sourceCounts: data.sourceCounts, asOf: data.asOf })
  const result = readinessBlockers({ ...data, matureNotAudited: cohortSummary(cohort).mature_not_audited })
  const evidence = evidenceBlockers({ decisions: data.decisions, development: developmentCoverage(data), packages: packageCompleteness(data) })
  if (args.format === 'json') { console.log(stableJson({ ...result, evidence })); return }
  console.log(`Analytical readiness as of ${data.asOf}\n`)
  for (const l of result.layers) {
    console.log(`${l.label}: ${l.state}`)
    for (const f of l.facts) console.log(`  fact     ${f.statement}`)
    for (const b of l.blockers) console.log(`  blocker  [${b.code}] ${b.statement}`)
    console.log('')
  }
  console.log('Development and transaction evidence gaps (reported, not gates: no probability, expected-value or recommendation layer depends on them)')
  for (const b of evidence) console.log(`  gap      [${b.code}] ${b.statement}`)
})
