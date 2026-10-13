#!/usr/bin/env node
// Assembles database/sql/041_outcome_probability_infrastructure.sql from:
//   041_template.sql   hand-written preconditions, tables, inserts, grants and postconditions
//   views.sql          the six 041 views
//   targets.json       reviewed outcome targets and support thresholds
//   evaluation.json    written by evaluate.mjs: the deterministic out-of-time model evaluation
//
//   node database/research/041/evaluate.mjs && node database/research/041/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)

/** The migration SQL for a given list of evaluation rows (evaluate.mjs assembles it with [] to measure the training set). */
export function assemble(evaluations) {
  const payload = sortKeys({ targets: read('targets.json').targets, evaluations })
  const json = JSON.stringify(payload).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  if (json.includes('$m041$')) throw new Error('payload contains the dollar-quote tag')
  let sql = fs.readFileSync(path.join(here, '041_template.sql'), 'utf8').replace(/\r\n/g, '\n')
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
  const evaluation = read('evaluation.json')
  if (evaluation.failures.length) throw new Error(`evaluation has failures: ${evaluation.failures.join('; ')}`)
  const sql = assemble(evaluation.evaluations)
  const dest = path.join(here, '../../sql/041_outcome_probability_infrastructure.sql')
  fs.writeFileSync(dest, sql)
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
}
