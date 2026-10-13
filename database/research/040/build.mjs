#!/usr/bin/env node
// Assembles database/sql/040_historical_archetypes_comparables.sql from:
//   040_template.sql   hand-written preconditions, grants and postconditions
//   views.sql          the five 040 views
//   audit-report.json  written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/040/audit.mjs && node database/research/040/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const audit = JSON.parse(fs.readFileSync(path.join(here, 'audit-report.json'), 'utf8'))
if (audit.failures.length) throw new Error(`audit has failures: ${audit.failures.join('; ')}`)

let sql = fs.readFileSync(path.join(here, '040_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const token = '{{views}}'
if (!sql.includes(token)) throw new Error(`template has no ${token}`)
sql = sql.split(token).join(views)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/040_historical_archetypes_comparables.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
