#!/usr/bin/env node
// Assembles database/sql/021_player_development_history.sql from:
//   021_template.sql   hand-written schema / application logic
//   values.sql         reviewed VALUES from scripts/mlb/development-sql-values.mjs
//
//   node database/research/021/build.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const values = fs.readFileSync(path.join(here, 'values.sql'), 'utf8')

const blocks = {}
for (const m of values.matchAll(/^-- (\w+)\(.*?\)\n([\s\S]*?)(?=\n\n-- \w+\(|\s*(?![\s\S]))/gm)) blocks[m[1]] = m[2].trim()
if (!blocks.stints?.startsWith('(')) {
  throw new Error(`values.sql stints block looks empty (got ${JSON.stringify((blocks.stints ?? '').slice(0, 20))})`)
}

// An empty research block arrives as the "-- none" sentinel line; swap in a
// single all-NULL row that the template's joins / where clauses drop. The
// explicit casts keep the VALUES row usable both as a direct insert into the
// typed temp tables and inside the select-from-values wrappers.
const noneRow = {
  milestones: '(null::text, null::bigint, null::text, null::date, null::text, null::int, null::text, null::text, null::text, null::text, null::date)',
  conflicts: '(null::text, null::text, null::text, null::date, null::text)',
  sources: '(null::text, null::timestamptz)',
}

let sql = fs.readFileSync(path.join(here, '021_template.sql'), 'utf8')
sql = sql.replace(/\{\{(\w+)\}\}/g, (_, name) => {
  if (!(name in blocks)) throw new Error(`values.sql has no "${name}" block`)
  const block = blocks[name]
  if (block && block !== '-- none') return block
  if (noneRow[name]) return noneRow[name]
  throw new Error(`values.sql "${name}" block is empty and has no NULL-row fallback`)
})

const dest = path.join(here, '../../sql/021_player_development_history.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length} lines)\n`)
