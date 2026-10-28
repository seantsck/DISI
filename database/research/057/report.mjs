#!/usr/bin/env node
// Before / after report of Migration 057 -> database/research/057/support-before-after.json.
//
//   node database/research/057/report.mjs [--dump <post-056 PGlite data-dir tar>]
//
// Builds the canonical 001-056 chain (or loads a saved post-056 PGlite dump), measures it (measure.mjs), applies the committed 057 migration,
// measures again, and records what moved: team-season rows, the scoped bWAR labels, target support, the stored evaluation, the research
// queues, the executive and release state, the snapshot generation. Read-only towards everything but the scratch database.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure } from './measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const di = process.argv.indexOf('--dump')
let db
if (di > 0) {
  const { PGlite } = await import(['@electric-sql', 'pglite'].join('/'))
  const { pgcrypto } = await import(['@electric-sql', 'pglite', 'contrib', 'pgcrypto'].join('/'))
  db = new PGlite({ loadDataDir: new Blob([fs.readFileSync(process.argv[di + 1])]), extensions: { pgcrypto } })
} else {
  const { buildChainThrough } = await import('../../../tests/db/canonical-chain.mjs')
  db = (await buildChainThrough('056_international_benchmark_2019.sql')).db
}
const query = async (sql) => (await db.query(sql)).rows
const pick = (m) => ({
  war: m.war, sources: m.counts.sources, outcomes: m.counts.outcomes, snapshot_generation: m.counts.snapshot_generation,
  support: m.support.map((s) => ({ target_key: s.target_key, reference_population: s.reference_population, labelled_n: s.labelled_n, positive_n: s.positive_n,
    negative_n: s.negative_n, support_state: s.support_state, baseline_probability: s.baseline_probability, baseline_probability_low_90: s.baseline_probability_low_90,
    baseline_probability_high_90: s.baseline_probability_high_90 })),
  evaluation: m.evaluation, scoped_labels: m.scoped_labels, probability_queue: m.probability_queue, research_tasks: m.research_tasks, readiness: m.readiness,
  executive: m.executive, release: m.release, expected_value: m.expected_value, probabilities: m.probabilities,
})
const before = pick(await measure(query))
await db.exec(fs.readFileSync(path.join(root, 'database/sql/057_benchmark_bwar_evidence.sql'), 'utf8'))
const after = pick(await measure(query))
await db.close()
fs.writeFileSync(path.join(here, 'support-before-after.json'), JSON.stringify({ generated_by: 'database/research/057/report.mjs', before, after }, null, 1) + '\n')
const s = (x, t, p) => x.support.find((r) => r.target_key === t && r.reference_population === p)
for (const t of ['POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS']) {
  const [b, a] = [s(before, t, 'TOP_PROSPECT_SAMPLE'), s(after, t, 'TOP_PROSPECT_SAMPLE')]
  process.stderr.write(`${t} / TOP_PROSPECT_SAMPLE: ${b.labelled_n} / ${b.positive_n} / ${b.negative_n} ${b.support_state} -> ${a.labelled_n} / ${a.positive_n} / ${a.negative_n} ${a.support_state} (baseline ${a.baseline_probability ?? 'NULL'}, 90% ${a.baseline_probability_low_90 ?? '-'}-${a.baseline_probability_high_90 ?? '-'})\n`)
}
process.stderr.write(`team-season rows ${before.war.active} -> ${after.war.active}; sources ${before.sources} -> ${after.sources}; evaluations ${before.evaluation.length} -> ${after.evaluation.length}; generation ${before.snapshot_generation} -> ${after.snapshot_generation}\n`)
