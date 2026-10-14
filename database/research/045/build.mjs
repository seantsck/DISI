#!/usr/bin/env node
// Assembles database/sql/045_final_integration_release.sql from:
//   045_template.sql   hand-written preconditions, the product-contract table, inserts, grants and postconditions
//   views.sql          the three 045 views
//   contract.json      the reviewed product contract and the DISI product / schema / decision-engine versions
//   metrics.json       executive metric provenance (rendered as a VALUES list)
//
//   node database/research/045/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const literal = (s) => {
  if (typeof s !== 'string' || /[^\x20-\x7e]/.test(s)) throw new Error(`metric text must be printable ASCII: ${s}`)
  return `'${s.replace(/'/g, "''")}'`
}
const VERSION = /^[A-Za-z0-9 .-]+$/

/** The migration SQL. */
export function assemble() {
  const contract = read('contract.json')
  const metrics = read('metrics.json').metrics
  for (const k of ['product_version', 'schema_version', 'decision_engine_version']) if (!VERSION.test(contract[k])) throw new Error(`bad ${k}`)
  const json = JSON.stringify(sortKeys({ contract: contract.contract })).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  if (json.includes('$m045$')) throw new Error('payload contains the dollar-quote tag')
  const cols = ['metric_key', 'label', 'definition', 'denominator_column', 'provenance', 'eligibility_rule', 'metric_kind']
  const metricValues = metrics.map((m) => `  (${cols.map((c) => literal(m[c])).join(', ')})`).join(',\n')
  let sql = fs.readFileSync(path.join(here, '045_template.sql'), 'utf8').replace(/\r\n/g, '\n')
  let views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
  for (const [name, value] of [['product_version', contract.product_version], ['schema_version', contract.schema_version],
    ['decision_engine_version', contract.decision_engine_version], ['metric_values', metricValues]]) {
    const token = `{{${name}}}`
    if (!views.includes(token)) throw new Error(`views have no ${token}`)
    views = views.split(token).join(value)
  }
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
  const dest = path.join(here, '../../sql/045_final_integration_release.sql')
  fs.writeFileSync(dest, sql)
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
}
