#!/usr/bin/env node
// Audits the 039 inputs against the canonical 001-038a replay (in memory, PGlite) and writes audit-report.json.
//
//   node database/research/039/audit.mjs
//
// Checks that every recorded signing market has exactly one reviewed market group (and no group names an unused market), that the
// eras are contiguous and non-overlapping, and that each player has one signing; measures the at-signing feature coverage.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ref = JSON.parse(fs.readFileSync(path.join(here, 'reference.json'), 'utf8'))
const failures = []
const chain = await buildChainThrough('038a_network_outcome_view_performance.sql')
const q = (s) => chain.query(s)

const markets = (await q(`select country_market, count(*)::int as n from signings where country_market is not null group by 1 order by 1`))
const mapped = new Map(ref.market_groups.map((m) => [m.country_market, m]))
if (mapped.size !== ref.market_groups.length) failures.push('a market is mapped twice')
for (const m of markets) if (!mapped.has(m.country_market)) failures.push(`market ${m.country_market} has no group`)
for (const k of mapped.keys()) if (!markets.some((m) => m.country_market === k)) failures.push(`group for unused market ${k}`)
const eras = [...ref.eras].sort((a, b) => a.era_order - b.era_order)
for (let i = 1; i < eras.length; i++) {
  const prevEnd = new Date(eras[i - 1].ends_on + 'T00:00:00Z'); const start = new Date(eras[i].starts_on + 'T00:00:00Z')
  if (start.getTime() - prevEnd.getTime() !== 86400000) failures.push(`eras ${eras[i - 1].era_key} / ${eras[i].era_key} are not contiguous`)
}
if (eras[0].starts_on !== null || eras.at(-1).ends_on !== null) failures.push('the era scale must be open at both ends')
const multi = (await q('select count(*)::int as n from (select player_id from signings group by 1 having count(*) > 1) d'))[0].n
if (multi) failures.push(`${multi} player(s) with more than one signing`)
const coverage = (await q(`select count(*)::int as signings, count(country_market)::int as market, count(position_at_signing)::int as position_at_signing,
  count(signing_date)::int as signing_date from signings`))[0]
const byGroup = {}
for (const m of markets) { const g = mapped.get(m.country_market)?.market_group ?? 'UNMAPPED'; byGroup[g] = (byGroup[g] ?? 0) + m.n }
await chain.close()

const report = { markets: markets.length, signings_by_market_group: Object.fromEntries(Object.entries(byGroup).sort()), coverage, eras: eras.map((e) => e.era_key), failures }
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 1) + '\n')
console.log(JSON.stringify(report))
if (failures.length) process.exitCode = 1
