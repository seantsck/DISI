#!/usr/bin/env node
// research:queue - the open research queues by category. Read-only; queue priorities are reported, never changed.

import { queueBreakdown } from '../../lib/research/queue-analysis.js'
import { parseArgs, emit, run } from './lib/cli.mjs'
import { loadDataset } from './lib/source.mjs'

run(async () => {
  const args = parseArgs(process.argv.slice(2))
  const { data } = await loadDataset(args)
  const b = queueBreakdown(data)
  emit(args, {
    title: `Research queue breakdown as of ${data.asOf}`,
    rows: b.rows,
    summary: { ...b.totals, unmapped_types: b.unmapped },
    columns: ['category', 'source', 'type', 'count', 'priorities', 'affecting_mature', 'blocking_analytical_eligibility', 'blocking_class_completeness', 'blocking_cost_value_analysis'],
  })
})
