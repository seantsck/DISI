#!/usr/bin/env node
// Assembles database/sql/024_development_progression_decisions.sql from:
//   024_template.sql        hand-written schema, guards, derivation and views
//   values-decisions.json   reviewed progression decisions
//
//   node database/research/024/build.mjs
//
// Deterministic: the same reviewed inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const input = JSON.parse(fs.readFileSync(path.join(here, 'values-decisions.json'), 'utf8'))

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const rows = input.decisions.map((d) => `(${[
  q(d.slug), q(d.event_code), q(d.progression_role),
  d.developmental_arrival_date ? `date ${q(d.developmental_arrival_date)}` : 'null',
  q(d.developmental_arrival_precision), d.developmental_arrival_season ?? 'null',
  q(d.decision_basis), q(d.review_status), q(d.confidence), q(d.notes),
  `timestamptz ${q(input.reviewed_at)}`, `date ${q(input.as_of_date)}`,
].join(', ')})`)
const keys = new Set(input.decisions.map((d) => `${d.slug}|${d.event_code}`))
if (keys.size !== rows.length) throw new Error('duplicate (slug, event_code) decision')

let sql = fs.readFileSync(path.join(here, '024_template.sql'), 'utf8')
if (!sql.includes('{{decisions}}')) throw new Error('template has no {{decisions}} placeholder')
sql = sql.replace('{{decisions}}', () => rows.join(',\n'))
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/024_development_progression_decisions.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
