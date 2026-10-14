#!/usr/bin/env node
// Assembles database/sql/042_expected_organizational_value.sql from:
//   042_template.sql   hand-written preconditions, the value-model table, inserts, grants and postconditions
//   views.sql          the five 042 views
//   models.json        reviewed expected-value models
//
//   node database/research/042/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)

/** The migration SQL. */
export function assemble() {
  const json = JSON.stringify(sortKeys(read('models.json'))).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  if (json.includes('$m042$')) throw new Error('payload contains the dollar-quote tag')
  let sql = fs.readFileSync(path.join(here, '042_template.sql'), 'utf8').replace(/\r\n/g, '\n')
  const views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
  for (const [name, value] of [['views', views], ['payload_json', json]]) {
    const token = `{{${name}}}`
    if (!sql.includes(token)) throw new Error(`template has no ${token}`)
    sql = sql.split(token).join(value)
  }
  if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')
  return sql
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  const sql = assemble()
  const dest = path.join(here, '../../sql/042_expected_organizational_value.sql')
  fs.writeFileSync(dest, sql)
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
}
