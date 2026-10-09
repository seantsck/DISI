#!/usr/bin/env node
// Assembles database/sql/025_public_view_grant_hardening.sql from:
//   025_template.sql      hand-written guards, hardening loop and postcondition
//   view-inventory.json   reviewed inventory of every public view
//
//   node database/research/025/build.mjs
//
// Only views classified READ_ONLY_ANALYTICS are hardened to SELECT; an
// INTENTIONALLY_WRITABLE view would have to be listed explicitly (none exist).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const inventory = JSON.parse(fs.readFileSync(path.join(here, 'view-inventory.json'), 'utf8'))

const names = inventory.views.map((v) => v.view)
if (new Set(names).size !== names.length) throw new Error('duplicate view in inventory')
const other = inventory.views.filter((v) => v.classification !== 'READ_ONLY_ANALYTICS')
if (other.length) throw new Error(`non read-only views need an explicit decision: ${other.map((v) => v.view).join(', ')}`)
if (inventory.views.some((v) => v.api_privileges.join(',') !== 'SELECT')) throw new Error('every read-only view must require SELECT only')

const list = [...names].sort().map((n) => `    '${n.replace(/'/g, "''")}'`).join(',\n')
let sql = fs.readFileSync(path.join(here, '025_template.sql'), 'utf8')
if (sql.split('{{views}}').length !== 3) throw new Error('template must use {{views}} exactly twice')
sql = sql.split('{{views}}').join(list)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/025_public_view_grant_hardening.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
