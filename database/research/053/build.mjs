#!/usr/bin/env node
// Assembles database/sql/053_transaction_chronology_resolution.sql and database/release/sql/rollback-053.sql from:
//   053_template.sql / rollback_template.sql   hand-written guards, steps, proofs and postconditions
//   migration-values.json                      the reviewed transactions (derive.mjs)
//   multi-org-detector.sql                     the 053 MULTI_ORG_SEASON_UNVERIFIED condition
//   database/sql/052_...sql                    the 052 research-queue view, read from the frozen file: the 053 view is that text with only the
//                                              multi-organization condition replaced, and the rollback restores it byte for byte
//
//   node database/research/053/build.mjs
//
// Deterministic: the same inputs always produce the same files. The build refuses anything the research rules do not allow.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => fs.readFileSync(path.resolve(here, f), 'utf8').replace(/\r\n/g, '\n')
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
const v = JSON.parse(read('migration-values.json'))

// ---- the research rules ---------------------------------------------------------------------------------------------------------
need(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(v.retrieved_at), 'retrieved_at must be a UTC date')
const keys = new Set()
for (const e of v.events) {
  need(!keys.has(e.key), `duplicate event ${e.key}`)
  keys.add(e.key)
  need(/^\d{4}-\d{2}-\d{2}$/.test(e.date), `${e.key}: an exact date`)
  need(e.from === 'LAD', `${e.key}: DISI's ledger records Dodgers transactions only`)
  need(['TRADE', 'FREE_AGENCY', 'FREE_AGENT_SIGNING'].includes(e.type), `${e.key}: a reviewed type`)
  need(e.type === 'TRADE' ? Boolean(e.to) : e.to === '', `${e.key}: a trade has a counterparty; a signing or a free agency has none`)
  need(e.description && e.source_url, `${e.key}: a description citing its evidence and a source`)
  const sides = e.assets.map((a) => a.side)
  if (e.type === 'FREE_AGENT_SIGNING') need(e.assets.length === 1 && sides[0] === 'INCOMING', `${e.key}: a signing brings one player in`)
  if (e.type === 'FREE_AGENCY') need(e.assets.length === 1 && sides[0] === 'OUTGOING', `${e.key}: a free agency lets one player go`)
  if (e.type === 'TRADE') need(sides.includes('INCOMING') && sides.includes('OUTGOING'), `${e.key}: a trade moves assets both ways`)
  for (const a of e.assets) {
    need(['PLAYER', 'CASH'].includes(a.type), `${e.key}: ${a.name}: a reviewed asset type`)
    if (a.type === 'CASH') need(!a.mlb_id && !a.bref_id && !a.player_slug, `${e.key}: cash carries no identity (and no amount: unknown, never zero)`)
    if (a.type === 'PLAYER') need(/^\d+$/.test(a.mlb_id), `${e.key}: ${a.name}: an MLB id`)
    need(e.type !== 'TRADE' || a.counterparty === e.to, `${e.key}: ${a.name}: every traded asset names the counterparty`)
  }
}
need(!('observations' in v) && !('sources' in v), '053 writes no control observation (the table is sealed) and adds no source')
for (const e of v.events) need(v.existing_source_urls.includes(e.source_url), `${e.key}: cites a source DISI already holds`)

// ---- the research-queue view ----------------------------------------------------------------------------------------------------
const sql052 = read('../../sql/052_development_taxonomy_chronology_resolution.sql')
const start = sql052.indexOf('create or replace view public.v_dodgers_development_research_queue')
const end = sql052.indexOf('\n-- ===========================================================================\n-- 8. POSTCONDITIONS')
need(start > 0 && end > start, 'the 052 research-queue view')
const view052 = sql052.slice(start, end).replace(/\n+$/, '')
need(view052.endsWith(';'), 'the 052 view statement ends with a semicolon')
const blockStart = view052.indexOf('    -- 052: a season with two or more organizations stays a research need')
const blockEnd = view052.indexOf(') as has_unverified_multi_org_season') + ') as has_unverified_multi_org_season'.length
need(blockStart > 0 && blockEnd > blockStart && view052.indexOf(') as has_unverified_multi_org_season', blockEnd) < 0, 'exactly one 052 multi-organization condition')
const detector = read('multi-org-detector.sql').replace(/\n+$/, '')
need(detector.endsWith(') as has_unverified_multi_org_season') && detector.includes("053: the direction is the player's"), 'the 053 condition')
const view053 = view052.slice(0, blockStart) + detector + view052.slice(blockEnd)
need(view053.split('MULTI_ORG_SEASON_UNVERIFIED').length === view052.split('MULTI_ORG_SEASON_UNVERIFIED').length, 'only the condition changes')

// ---- payload ----------------------------------------------------------------------------------------------------------------------
const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x)
const json = JSON.stringify(sortKeys(v))
for (const tag of ['$m053$', '$r053$']) need(!json.includes(tag), `payload contains the dollar-quote tag ${tag}`)
const fill = (template, values) => {
  let out = template
  for (const [k, val] of Object.entries(values)) out = out.split(`{{${k}}}`).join(val)
  need(!/\{\{\w+\}\}/.test(out), 'unreplaced placeholder')
  return out
}

const sql = fill(read('053_template.sql'), { payload_json: json, queue_view_053: view053 })
const dest = path.join(here, '../../sql/053_transaction_chronology_resolution.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines, ${v.events.length} events)\n`)

const rollback = fill(read('rollback_template.sql'), { payload_json: json, queue_view_052: view052 })
const rdest = path.join(here, '../../release/sql/rollback-053.sql')
fs.writeFileSync(rdest, rollback)
process.stderr.write(`wrote ${path.relative(process.cwd(), rdest)}\n`)
