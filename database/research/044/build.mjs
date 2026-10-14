#!/usr/bin/env node
// Assembles database/sql/044_executive_product.sql from 044_template.sql and views.sql (the two executive views).
//
//   node database/research/044/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** The migration SQL. */
export function assemble() {
  let sql = fs.readFileSync(path.join(here, '044_template.sql'), 'utf8').replace(/\r\n/g, '\n')
  const views = fs.readFileSync(path.join(here, 'views.sql'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
  if (!sql.includes('{{views}}')) throw new Error('template has no {{views}}')
  sql = sql.split('{{views}}').join(views)
  if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')
  return sql
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  const sql = assemble()
  const dest = path.join(here, '../../sql/044_executive_product.sql')
  fs.writeFileSync(dest, sql)
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
}
