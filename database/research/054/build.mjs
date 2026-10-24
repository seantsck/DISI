#!/usr/bin/env node
// Assembles database/sql/054_full_career_transaction_history.sql and database/release/sql/rollback-054.sql from:
//   054_template.sql / rollback_template.sql   hand-written guards, steps, proofs and postconditions
//   migration-values.json                      the reviewed career moves and the two sources they need (derive.mjs)
//   multi-org-detector.sql                     the 054 MULTI_ORG_SEASON_UNVERIFIED condition
//   database/sql/053_...sql                    the 053 research-queue view, read from its file: the 054 view is that text with only the
//                                              multi-organization condition replaced, and the rollback restores it byte for byte
//
//   node database/research/054/build.mjs
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
const DODGERS = ['BRO', 'LAD']
need(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(v.retrieved_at), 'retrieved_at must be a UTC date')
const keys = new Set()
for (const e of v.events) {
  need(!keys.has(e.key), `duplicate event ${e.key}`)
  keys.add(e.key)
  need(/^\d{4}-\d{2}-\d{2}$/.test(e.date), `${e.key}: an exact date`)
  need(!DODGERS.includes(e.from) && !DODGERS.includes(e.to), `${e.key}: a Dodgers transaction belongs in the Dodgers ledger, never in career history`)
  const shape = ['TRADE', 'WAIVER_CLAIM', 'PURCHASE'].includes(e.type) ? e.from && e.to && e.from !== e.to
    : e.type === 'RELEASE' ? e.from && !e.to : e.type === 'FREE_AGENT_SIGNING' ? !e.from && e.to : false
  need(shape, `${e.key}: the mechanism fixes the shape`)
  need(/^(MLB transaction|Retrosheet transaction) \d+$/.test(e.source_reference) && e.description && e.source_url, `${e.key}: a cited source row`)
  need([...v.existing_source_urls, ...v.sources.map((s) => s.url)].includes(e.source_url), `${e.key}: its source is reused or added`)
}
for (const s of v.sources) need(!v.existing_source_urls.includes(s.url), `${s.url}: a source 054 adds is new`)

// ---- the research-queue view ----------------------------------------------------------------------------------------------------
const sql053 = read('../../sql/053_transaction_chronology_resolution.sql')
const start = sql053.indexOf('create or replace view public.v_dodgers_development_research_queue')
const end = sql053.indexOf('\n-- ===========================================================================\n-- 4. POSTCONDITIONS')
need(start > 0 && end > start, 'the 053 research-queue view')
const view053 = sql053.slice(start, end).replace(/\n+$/, '')
need(view053.endsWith(';'), 'the 053 view statement ends with a semicolon')
const old = read('../053/multi-org-detector.sql').replace(/\n+$/, '')
need(view053.split(old).length === 2, 'the 053 view holds the 053 condition exactly once')
const detector = read('multi-org-detector.sql').replace(/\n+$/, '')
need(detector.includes('player_career_transactions') && detector.endsWith(') as has_unverified_multi_org_season'), 'the 054 condition')
const view054 = view053.replace(old, detector)

// ---- payload ----------------------------------------------------------------------------------------------------------------------
const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x)
const json = JSON.stringify(sortKeys(v))
for (const tag of ['$m054$', '$r054$']) need(!json.includes(tag), `payload contains the dollar-quote tag ${tag}`)
const fill = (template, values) => {
  let out = template
  for (const [k, val] of Object.entries(values)) out = out.split(`{{${k}}}`).join(val)
  need(!/\{\{\w+\}\}/.test(out), 'unreplaced placeholder')
  return out
}

const sql = fill(read('054_template.sql'), { payload_json: json, queue_view_054: view054 })
const dest = path.join(here, '../../sql/054_full_career_transaction_history.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines, ${v.events.length} career moves, ${v.sources.length} sources)\n`)

const rollback = fill(read('rollback_template.sql'), { payload_json: json, queue_view_053: view053 })
const rdest = path.join(here, '../../release/sql/rollback-054.sql')
fs.writeFileSync(rdest, rollback)
process.stderr.write(`wrote ${path.relative(process.cwd(), rdest)}\n`)
