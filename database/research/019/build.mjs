#!/usr/bin/env node
// Assembles database/sql/019_mature_outcome_audit_expansion.sql from:
//   019_template.sql   hand-written schema / application logic
//   values.sql         reviewed VALUES from scripts/mlb/outcome-sql-values.mjs
//   views.sql          view definitions
//
//   node database/research/019/build.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8')
const values = read('values.sql')

const blocks = {}
for (const m of values.matchAll(/^-- (\w+)\(.*?\)\n([\s\S]*?)(?=\n\n-- \w+\(|\s*(?![\s\S]))/gm)) blocks[m[1]] = m[2].trim()

const bwar = blocks.bwar ? `insert into _m019_bwar values\n${blocks.bwar};` : '-- no bWAR rows'
// Function replacers insert text literally ("$$" in a replacement string would collapse to "$").
let sql = read('019_template.sql')
  .replace('{{bwar_insert}}', () => bwar)
  .replace('{{views}}', () => read('views.sql').trim())
sql = sql.replace(/\{\{(\w+)\}\}/g, (_, name) => {
  if (!blocks[name]) throw new Error(`values.sql has no "${name}" block`)
  return blocks[name]
})

const dest = path.join(here, '../../sql/019_mature_outcome_audit_expansion.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length} lines)\n`)
