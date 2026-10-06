#!/usr/bin/env node
// Assembles database/sql/020_player_identity_and_biography_enrichment.sql from:
//   020_template.sql   hand-written schema / application logic
//   values.sql         reviewed VALUES from scripts/mlb/identity-sql-values.mjs
//   views.sql          view definitions
//
//   node database/research/020/build.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8')
const values = read('values.sql')

const blocks = {}
for (const m of values.matchAll(/^-- (\w+)\(.*?\)\n([\s\S]*?)(?=\n\n-- \w+\(|\s*(?![\s\S]))/gm)) blocks[m[1]] = m[2].trim()

// Function replacers insert text literally ("$$" in a replacement string would collapse to "$").
let sql = read('020_template.sql')
  .replace('{{views}}', () => read('views.sql').trim())
sql = sql.replace(/\{\{(\w+)\}\}/g, (_, name) => {
  if (!blocks[name]) throw new Error(`values.sql has no "${name}" block`)
  return blocks[name]
})

const dest = path.join(here, '../../sql/020_player_identity_and_biography_enrichment.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length} lines)\n`)
