#!/usr/bin/env node
// Assembles database/sql/028_residual_canonical_drift_reconciliation.sql from:
//   028_template.sql               hand-written guarded steps
//   reconciliation-manifest.json   the four reviewed corrections (stable natural selectors)
//   audit-report.json              written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/028/audit.mjs && node database/research/028/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'reconciliation-manifest.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(path.join(here, 'audit-report.json'), 'utf8'))
if (audit.failures.length) throw new Error(`audit has failures: ${audit.failures.join('; ')}`)

const cats = manifest.categories
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const slim = (name) => cats[name].entries.map((e) => ({ selector: e.selector, canonical: e.canonical, live: e.live }))
const json = JSON.stringify(sortKeys({ transaction_descriptions: slim('transaction_descriptions'), class_membership_confidence: slim('class_membership_confidence') }))
if (json.includes('$m028$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '028_template.sql'), 'utf8').replace(/\r\n/g, '\n')
if (!sql.includes('{{payload_json}}')) throw new Error('template has no {{payload_json}}')
sql = sql.split('{{payload_json}}').join(json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/028_residual_canonical_drift_reconciliation.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
