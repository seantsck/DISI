#!/usr/bin/env node
// Applies 061 to a replay of the canonical chain through 060 and writes before-after.json: the transaction rows 061 touches, both queues by issue
// (and the rows that left or entered them), the headline numbers that must not move, the Garland control intervals, and which fingerprints held.
//   node database/research/061/report.mjs [--dump <post-060 PGlite tar>]     (without --dump the chain is built, about three minutes)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure } from './measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const sql = fs.readFileSync(path.join(here, '../../sql/061_transaction_research_closure.sql'), 'utf8')
const dump = arg('dump')
let db
if (dump) {
  const { PGlite } = await import(['@electric-sql', 'pglite'].join('/'))
  const { pgcrypto } = await import(['@electric-sql', 'pglite', 'contrib', 'pgcrypto'].join('/'))
  db = new PGlite({ loadDataDir: new Blob([fs.readFileSync(dump)]), extensions: { pgcrypto } })
} else {
  const { buildChainThrough } = await import('../../../tests/db/canonical-chain.mjs')
  db = (await buildChainThrough('060_owner_reviewed_acquisition_costs.sql')).db
}
const query = async (s) => (await db.query(s)).rows
const before = await measure(query)
await db.exec(sql)
const after = await measure(query)
await db.close()

const byIssue = (rows) => Object.fromEntries(Object.entries(rows.reduce((a, r) => ({ ...a, [r.issue]: (a[r.issue] ?? 0) + 1 }), {})).sort())
const key = (r) => JSON.stringify([r.issue, r.event_key, r.asset_name ?? null, r.player_slug ?? null])
const diff = (a, b) => {
  const A = new Map(a.map((r) => [key(r), r])), B = new Map(b.map((r) => [key(r), r]))
  return { left: [...A].filter(([k]) => !B.has(k)).map(([, r]) => r), entered: [...B].filter(([k]) => !A.has(k)).map(([, r]) => r) }
}
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y)
const out = {
  note: 'Measured on the canonical replay (001-060) with 061 applied once. The replay is one snapshot generation behind production (15 against 16); every logical value is the same.',
  headline: { cost_counts: [before.headline.cost_counts, after.headline.cost_counts], career_bwar: [before.headline.metric, after.headline.metric], bwar_missing: [before.headline.bwar_missing, after.headline.bwar_missing],
    research_task_types: [before.headline.research_task_types, after.headline.research_task_types], snapshots: [before.headline.snapshots, after.headline.snapshots],
    prediction_unchanged: same(before.headline.prediction, after.headline.prediction), value_totals_unchanged: same(before.headline.value_totals, after.headline.value_totals),
    unchanged: Object.fromEntries(['cost_counts', 'metric', 'bwar_missing', 'research_task_types', 'prediction', 'value_totals'].map((k) => [k, same(before.headline[k], after.headline[k])])) },
  transaction_queue: { before: before.transaction_queue_rows.length, after: after.transaction_queue_rows.length, by_issue: [byIssue(before.transaction_queue_rows), byIssue(after.transaction_queue_rows)], ...diff(before.transaction_queue_rows, after.transaction_queue_rows) },
  value_queue: { before: before.value_queue_rows.length, after: after.value_queue_rows.length, by_issue: [byIssue(before.value_queue_rows), byIssue(after.value_queue_rows)], rows_unchanged: same(before.value_queue_rows, after.value_queue_rows) },
  counts: { before: before.counts, after: after.counts },
  transaction_rows: { targets: [before.transaction_rows.targets, after.transaction_rows.targets], garland: [before.transaction_rows.garland, after.transaction_rows.garland], garland_intervals: [before.transaction_rows.garland_intervals, after.transaction_rows.garland_intervals],
    sources: after.transaction_rows.sources, evidence: after.transaction_rows.evidence },
  fingerprints_held: Object.fromEntries(Object.keys(before.fingerprints).map((k) => [k, before.fingerprints[k] === after.fingerprints[k]])),
  isolation_060_unchanged: { ledger: same(before.isolation_060.ledger, after.isolation_060.ledger), resolutions: same(before.isolation_060.resolutions, after.isolation_060.resolutions),
    fingerprints: same(before.isolation_060.fingerprints, after.isolation_060.fingerprints),
    // one flag per table-group hash: transactions_hash is EXPECTED to move (061 writes the transaction tables); every other group must hold
    hashes: Object.fromEntries(Object.keys(before.isolation_060.hashes).map((k) => [k, before.isolation_060.hashes[k] === after.isolation_060.hashes[k]])),
    executive_overview_body_md5: before.isolation_060.executive_overview_body_md5 === after.isolation_060.executive_overview_body_md5 },
}
fs.writeFileSync(path.join(here, 'before-after.json'), JSON.stringify(out, null, 1) + '\n')
process.stdout.write(JSON.stringify({ tq: [out.transaction_queue.before, out.transaction_queue.after], vq: [out.value_queue.before, out.value_queue.after], left: out.transaction_queue.left.length, entered: out.transaction_queue.entered.length, held: out.fingerprints_held }) + '\n')
