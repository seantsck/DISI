#!/usr/bin/env node
// Assembles database/sql/043a_decision_engine_performance.sql from:
//   043a_template.sql  hand-written precondition and postconditions
//   views.sql          the staged functions and the three wrapper views
//
//   node database/research/043a/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

let sql = fs.readFileSync(path.join(here, '043a_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const token = '{{views}}'
if (!sql.includes(token)) throw new Error(`template has no ${token}`)
sql = sql.split(token).join(views)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/043a_decision_engine_performance.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
