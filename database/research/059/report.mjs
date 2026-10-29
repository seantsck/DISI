#!/usr/bin/env node
// Writes database/research/059/before-after.json: the measured state before and after Migration 059 on a canonical replay (001-058, then 059
// applied for real), restricted to the facts 059 is about (the CAREER_BWAR observations, BWAR_MISSING, the eleven dossiers) and the fingerprints
// of everything it must not move (outcomes, team-season WAR, sources, prediction, organizational and transaction value, the other research tasks).
//   node database/research/059/report.mjs [--dump <post-058 PGlite tar>]     (without --dump it builds the 001-058 chain, about three minutes)

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
else db = (await (await import('../../../tests/db/canonical-chain.mjs')).buildChainThrough('058_transaction_return_bwar_evidence.sql')).db
const query = async (sql) => (await db.query(sql)).rows
const KEYS = ['metric', 'scoped_metric', 'bwar_missing', 'tasks', 'dossier', 'isolation', 'war', 'value_totals', 'executive', 'transaction_queue', 'value_queue', 'prediction', 'snapshots']
const pick = (m) => Object.fromEntries(KEYS.map((k) => [k, m[k]]))
const before = pick(await measure(query))
await db.exec(fs.readFileSync(path.join(root, 'database/sql/059_career_bwar_metric_reconciliation.sql'), 'utf8'))
const after = pick(await measure(query))
await db.close()
const total = (q) => q.reduce((s, x) => s + x.items, 0)
const career = (m) => m.metric.find((x) => x.metric_key === 'CAREER_BWAR').observations
const same = (k) => JSON.stringify(before[k]) === JSON.stringify(after[k])
const out = {
  generated_by: 'database/research/059/report.mjs',
  note: 'Canonical replay. Production differs only in the snapshot generation (14 before 059, so 15 after) and in surrogate ids and timestamps; every value, queue and fingerprint here is logical.',
  summary: {
    career_bwar_observations: [career(before), career(after)], bwar_missing: [before.bwar_missing.length, after.bwar_missing.length],
    removed_from_bwar_missing: before.bwar_missing.map((x) => x.player_slug).filter((s) => !after.bwar_missing.some((x) => x.player_slug === s)),
    unchanged: Object.fromEntries(Object.keys(before.isolation).map((k) => [k, before.isolation[k] === after.isolation[k]])),
    prediction_identical: same('prediction'), value_identical: same('value_totals') && same('executive') && same('transaction_queue') && same('value_queue'),
    war_active: [before.war.active, after.war.active], realized_org_value_bwar: [before.value_totals.realized, after.value_totals.realized],
    transaction_queue: [total(before.transaction_queue), total(after.transaction_queue)], value_queue: [total(before.value_queue), total(after.value_queue)],
    snapshot_generation: [before.snapshots.generation, after.snapshots.generation], drift_after: after.snapshots.drifting,
  },
  before, after,
}
fs.writeFileSync(path.join(here, 'before-after.json'), JSON.stringify(out, null, 1) + '\n')
process.stdout.write(JSON.stringify(out.summary, null, 1) + '\n')
