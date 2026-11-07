#!/usr/bin/env node
// Applies 062 to a replay of the canonical chain through 061 and writes before-after.json: the headline numbers, the CAREER_BWAR and BWAR_MISSING
// movement, the twelve observations as v_player_war reads them, the 27 that stay NULL, the provider rule before and after, and which fingerprints held.
//   node database/research/062/report.mjs [--dump <post-061 PGlite tar>]     (without --dump the chain is built, about three and a half minutes)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure } from './measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const sql = fs.readFileSync(path.join(here, '../../sql/062_bwar_backlog_closure.sql'), 'utf8')
const dump = arg('dump')
let db
if (dump) {
  const { PGlite } = await import(['@electric-sql', 'pglite'].join('/'))
  const { pgcrypto } = await import(['@electric-sql', 'pglite', 'contrib', 'pgcrypto'].join('/'))
  db = new PGlite({ loadDataDir: new Blob([fs.readFileSync(dump)]), extensions: { pgcrypto } })
} else {
  const { buildChainThrough } = await import('../../../tests/db/canonical-chain.mjs')
  db = (await buildChainThrough('061_transaction_research_closure.sql')).db
}
const query = async (s) => (await db.query(s)).rows
const before = await measure(query)
await db.exec(sql)
const after = await measure(query)
await db.close()

const same = (x, y) => JSON.stringify(x) === JSON.stringify(y)
const slugs = (rows) => rows.map((r) => r.slug)
const left = slugs(before.backlog).filter((s) => !slugs(after.backlog).includes(s))
const out = {
  note: 'Measured on the canonical replay (001-061) with 062 applied once. The replay is one snapshot generation behind production (15 against 16); every logical value is the same.',
  headline: {
    career_bwar_observations: [before.headline.career_bwar_observations, after.headline.career_bwar_observations],
    bwar_missing: [before.headline.bwar_missing, after.headline.bwar_missing],
    cost_counts: [before.headline.cost_counts, after.headline.cost_counts],
    snapshots: [before.headline.snapshots, after.headline.snapshots],
    unchanged: Object.fromEntries(['cost_counts', 'research_task_types', 'prediction', 'value_totals', 'transaction_queue', 'value_queue'].map((k) => [k, same(before.headline[k], after.headline[k])])),
  },
  research_task_types: [before.headline.research_task_types, after.headline.research_task_types],
  provider_rule: [before.provider_rule, after.provider_rule],
  bwar_missing_left: left,
  bwar_missing_remaining: slugs(after.backlog),
  written: after.career_bwar.filter((r) => left.includes(r.slug)),
  remaining_without_observation: after.backlog.every((b) => b.metric_observations === 0 && b.career_bwar === null),
  war_sources: [before.war_sources, after.war_sources],
  team_season_war_unchanged: same(before.team_season_war, after.team_season_war),
  fingerprints_held: Object.fromEntries(Object.keys(before.fingerprints_062).map((k) => [k, before.fingerprints_062[k] === after.fingerprints_062[k]])),
  isolation_061_unchanged: { counts: same(before.isolation_061.counts, after.isolation_061.counts), fingerprints: same(before.isolation_061.fingerprints, after.isolation_061.fingerprints),
    queues: [before.isolation_061.transaction_queue, after.isolation_061.transaction_queue, before.isolation_061.value_queue, after.isolation_061.value_queue] },
  isolation_060_unchanged: { ledger: same(before.isolation_060.ledger, after.isolation_060.ledger), resolutions: same(before.isolation_060.resolutions, after.isolation_060.resolutions),
    fingerprints: same(before.isolation_060.fingerprints, after.isolation_060.fingerprints),
    hashes: Object.fromEntries(Object.keys(before.isolation_060.hashes).map((k) => [k, before.isolation_060.hashes[k] === after.isolation_060.hashes[k]])),
    executive_overview_body_md5: before.isolation_060.executive_overview_body_md5 === after.isolation_060.executive_overview_body_md5 },
}
fs.writeFileSync(path.join(here, 'before-after.json'), JSON.stringify(out, null, 1) + '\n')
process.stdout.write(JSON.stringify({ career_bwar: out.headline.career_bwar_observations, bwar_missing: out.headline.bwar_missing, unchanged: out.headline.unchanged, fingerprints_held: out.fingerprints_held, gen: out.headline.snapshots }) + '\n')
