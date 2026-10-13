#!/usr/bin/env node
// Assembles database/sql/036_scouting_expectation_outcomes.sql from:
//   036_template.sql   hand-written preconditions, table, band insert, grants and postconditions
//   views.sql          the five 036 views
//   bands.json         reviewed expectation bands
//   audit-report.json  written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/036/audit.mjs && node database/research/036/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const bands = read('bands.json')
const audit = read('audit-report.json')
if (audit.failures.length) throw new Error(`audit has failures: ${audit.failures.join('; ')}`)

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const payload = sortKeys({ families: bands.families })
const json = JSON.stringify(payload).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
if (json.includes('$m036$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '036_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const fill = (name, value) => {
  const token = `{{${name}}}`
  if (!sql.includes(token)) throw new Error(`template has no ${token}`)
  sql = sql.split(token).join(value)
}
fill('views', views)
fill('payload_json', json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/036_scouting_expectation_outcomes.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
