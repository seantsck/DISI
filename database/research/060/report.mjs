#!/usr/bin/env node
// Writes database/research/060/before-after.json: the full 060 measurement (measure.mjs) before and after Migration 060 on a canonical replay
// (001-059, then 060 applied for real), every section compared, with the changed paths listed so a reviewer sees exactly what moved.
//   node database/research/060/report.mjs [--dump <post-059 PGlite tar>]     (without --dump it builds the 001-059 chain, several minutes)

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
else db = (await (await import('../../../tests/db/canonical-chain.mjs')).buildChainThrough('059_career_bwar_metric_reconciliation.sql')).db
const query = async (sql) => (await db.query(sql)).rows
const before = await measure(query)
await db.exec(fs.readFileSync(path.join(root, 'database/sql/060_owner_reviewed_acquisition_costs.sql'), 'utf8'))
const after = await measure(query)
await db.close()

/** The leaf paths at which two values differ (arrays compared by index; at most `limit` paths). */
export function changedPaths(a, b, prefix = '', out = [], limit = 200) {
  if (out.length >= limit) return out
  if (JSON.stringify(a) === JSON.stringify(b)) return out
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = Array.isArray(a) ? [...Array(Math.max(a.length, b.length)).keys()] : [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    for (const k of keys) changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : String(k), out, limit)
    return out
  }
  out.push(prefix)
  return out
}

const sections = Object.keys(before)
const changed = Object.fromEntries(sections.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => [k, changedPaths(before[k], after[k], k)]))
const key = (x) => `${x.player_slug}|${x.signing_year}`
const out = {
  generated_by: 'database/research/060/report.mjs',
  note: 'Canonical replay. Production differs in the snapshot generation (15 before 060, so 16 after) and in surrogate ids and timestamps; every value, count and fingerprint here is logical.',
  summary: {
    dodgers_signings: [before.cost_counts.signings, after.cost_counts.signings],
    known_cost: [before.cost_counts.known, after.cost_counts.known],
    unknown_cost: [before.cost_counts.unknown, after.cost_counts.unknown],
    known_usd: [before.cost_counts.known_usd, after.cost_counts.known_usd],
    zero_bonuses: [before.all_zero_bonuses, after.all_zero_bonuses],
    left_missing_cost: before.missing_cost.map(key).filter((k) => !after.missing_cost.some((x) => key(x) === k)),
    entered_missing_cost: after.missing_cost.map(key).filter((k) => !before.missing_cost.some((x) => key(x) === k)),
    beltre: [before.reviewed.find((r) => r.slug === 'adrian-beltre'), after.reviewed.find((r) => r.slug === 'adrian-beltre')].map((r) => ({
      bonus: r.signing_bonus_usd, bonus_status: r.bonus_status, resolved_components: r.resolved_components, active_reports: r.bonus_reports.filter((x) => x.status === 'ACTIVE').length, active_resolutions: r.active_resolutions })),
    astacio: [before.reviewed.find((r) => r.slug === 'pedro-astacio'), after.reviewed.find((r) => r.slug === 'pedro-astacio')].map((r) => ({
      bonus: r.signing_bonus_usd, bonus_status: r.bonus_status, cost_completeness: r.acquisition_cost_completeness, known_cost: r.known_acquisition_cost_usd })),
    reviewed_source_status: [...new Set(after.reviewed.filter((r) => r.slug !== 'adrian-beltre').map((r) => r.bonus_source_status))],
    isolation_unchanged: Object.fromEntries(Object.keys(before.isolation).map((k) => [k, before.isolation[k] === after.isolation[k]])),
    other_fingerprints_unchanged: Object.fromEntries(['other_signings', 'other_reports', 'environment_reports', 'other_resolutions'].map((k) => [k, before.fingerprints[k] === after.fingerprints[k]])),
    snapshot_generation: [before.snapshots.generation, after.snapshots.generation], drift_after: after.snapshots.drifting,
    unchanged_sections: sections.filter((k) => !(k in changed)),
    changed_sections: Object.keys(changed),
  },
  changed_paths: changed,
  before, after,
}
fs.writeFileSync(path.join(here, 'before-after.json'), JSON.stringify(out, null, 1) + '\n')
process.stdout.write(JSON.stringify({ ...out.summary, changed_paths: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.slice(0, 12)])) }, null, 1) + '\n')
