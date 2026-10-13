#!/usr/bin/env node
// Assembles database/sql/038a_network_outcome_view_performance.sql from:
//   038a_template.sql  hand-written precondition and postconditions
//   views.sql          the rewritten v_network_player_outcomes
//
//   node database/research/038a/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

let sql = fs.readFileSync(path.join(here, '038a_template.sql'), 'utf8').replace(/\r\n/g, '\n')
const views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const token = '{{views}}'
if (!sql.includes(token)) throw new Error(`template has no ${token}`)
sql = sql.split(token).join(views)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/038a_network_outcome_view_performance.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
