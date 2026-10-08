#!/usr/bin/env node
// Assembles database/sql/023_development_stint_integrity.sql from:
//   023_template.sql        hand-written schema, guards, corrections and views
//   values-decisions.json   reviewed season-total decisions from audit.mjs
//
//   node database/research/023/build.mjs
//
// The template carries the 021/022 view definitions it recreates, with the
// reviewed changes; rebuilding is deterministic.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const decisions = JSON.parse(fs.readFileSync(path.join(here, 'values-decisions.json'), 'utf8'))

const q = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)
const rows = decisions.rows.map((r) =>
  `(${q(r.slug)}, ${r.season}, ${q(r.level)}, ${q(r.source_level)}, ${q(r.league_name)}, ${q(r.basis)}, ${r.games}, ` +
  `${r.components ? `array[${r.components.map(q).join(', ')}]::text[]` : 'null::text[]'})`)
if (rows.length !== decisions.season_totals) throw new Error('decision count mismatch')

let sql = fs.readFileSync(path.join(here, '023_template.sql'), 'utf8')
if (!sql.includes('{{season_totals}}')) throw new Error('template has no {{season_totals}} placeholder')
sql = sql.replace('{{season_totals}}', () => rows.join(',\n'))
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/023_development_stint_integrity.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length} lines)\n`)
