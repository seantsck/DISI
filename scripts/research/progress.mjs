#!/usr/bin/env node
// research:progress - 046 progress against a saved baseline. Read-only.
//
//   npm run research:progress -- --baseline database/research/046/baseline.json [--input current-dataset.json]

import fs from 'node:fs'
import { progressReport } from '../../lib/research/progress.js'
import { parseArgs, emit, run } from './lib/cli.mjs'
import { loadDataset } from './lib/source.mjs'

run(async () => {
  const args = parseArgs(process.argv.slice(2))
  if (!args.baseline || args.baseline === true) throw new Error('--baseline <file.json> is required (a product_database_status row, or a dataset with a `status` array).')
  const b = JSON.parse(fs.readFileSync(String(args.baseline), 'utf8'))
  const baseline = Array.isArray(b.status) ? b.status[0] : b
  const { data } = await loadDataset(args)
  const report = progressReport(baseline, data.status)
  emit(args, { title: `046 progress (baseline generation ${baseline.generation_id ?? '?'} -> current generation ${data.status?.generation_id ?? '?'})`, rows: report.rows, summary: { changed_measures: report.changed }, columns: ['label', 'baseline', 'current', 'change'] })
})
