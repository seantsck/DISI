#!/usr/bin/env node
// Writes database/research/058/value-before-after.json: the measured state before and after Migration 058 on a canonical replay (001-057, then
// 058 applied for real), restricted to the facts 058 is about: the four players' rows, lineage, intervals and edges, the three originating
// signings, the value and executive totals, the queues, the prediction fingerprints and the snapshot generation.
//   node database/research/058/report.mjs [--dump <post-057 PGlite tar>]     (without --dump it builds the 001-057 chain, about two minutes)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure } from './measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const { PGlite } = await import(['@electric-sql', 'pglite'].join('/'))
const { pgcrypto } = await import(['@electric-sql', 'pglite', 'contrib', 'pgcrypto'].join('/'))
let db
if (arg('dump')) db = new PGlite({ loadDataDir: new Blob([fs.readFileSync(arg('dump'))]), extensions: { pgcrypto } })
else db = (await (await import('../../../tests/db/canonical-chain.mjs')).buildChainThrough('057_benchmark_bwar_evidence.sql')).db
const query = async (sql) => (await db.query(sql)).rows
const KEYS = ['war', 'scoped_war', 'lineage', 'intervals', 'edges', 'signings', 'older_view', 'value_totals', 'executive', 'transaction_queue', 'value_queue', 'scoped_queue',
  'war_not_loaded', 'research_task_types', 'prediction', 'snapshots']
const pick = (m) => Object.fromEntries(KEYS.map((k) => [k, m[k]]))
const before = pick(await measure(query))
await db.exec(fs.readFileSync(path.join(root, 'database/sql/058_transaction_return_bwar_evidence.sql'), 'utf8'))
const after = pick(await measure(query))
await db.close()
const total = (q) => q.reduce((s, x) => s + x.items, 0)
const out = {
  generated_by: 'database/research/058/report.mjs',
  note: 'Canonical replay. Production differs only in the snapshot generation (13 before 058, so 14 after) and in surrogate ids and timestamps; every value, queue and fingerprint here is logical.',
  summary: {
    war_active: [before.war.active, after.war.active], realized_org_value_bwar: [before.value_totals.realized, after.value_totals.realized],
    signings_with_resolved_value: [before.value_totals.resolved, after.value_totals.resolved],
    realized_incomplete_unresolved: [[before.value_totals.realized_to_date, before.value_totals.chain_incomplete, before.value_totals.unresolved],
      [after.value_totals.realized_to_date, after.value_totals.chain_incomplete, after.value_totals.unresolved]],
    executive_direct_trade: [[before.executive.direct, before.executive.trade], [after.executive.direct, after.executive.trade]],
    package_first_hop_participation_bwar: [before.value_totals.pkg_first, after.value_totals.pkg_first],
    observable_not_attributable_bwar: [before.value_totals.observable, after.value_totals.observable],
    transaction_queue: [total(before.transaction_queue), total(after.transaction_queue)], value_queue: [total(before.value_queue), total(after.value_queue)],
    prediction_identical: JSON.stringify(before.prediction) === JSON.stringify(after.prediction),
    snapshot_generation: [before.snapshots.generation, after.snapshots.generation], drift_after: after.snapshots.drifting,
  },
  before, after,
}
fs.writeFileSync(path.join(here, 'value-before-after.json'), JSON.stringify(out, null, 1) + '\n')
process.stdout.write(JSON.stringify(out.summary, null, 1) + '\n')
