#!/usr/bin/env node
// Local 029-only harness: builds 001-028 in PGlite, then runs 029 to surface
// the exact error with its character position. Not part of npm test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))
const target = '029_signing_network_intelligence.sql'
const db = new PGlite({ extensions: { pgcrypto } })
await db.exec('create role anon nologin; create role authenticated nologin;')
for (const file of manifest.canonical_sql) {
  if (file === target) break
  try { await db.exec(fs.readFileSync(path.join(root, 'database/sql', file), 'utf8')) }
  catch (e) { console.error(`${file}: ${e.message}`); process.exit(1) }
}
const sqlText = fs.readFileSync(path.join(root, 'database/sql', target), 'utf8')
try {
  await db.exec(sqlText)
  console.log('029 OK')
  await db.exec(sqlText)
  console.log('029 rerun OK')
} catch (e) {
  console.error('029 FAIL:', e.message)
  if (e.position) {
    const pos = Number(e.position)
    console.error(`...${sqlText.slice(Math.max(0, pos - 200), pos)} >>>HERE>>> ${sqlText.slice(pos, pos + 120)}`)
  }
  if (e.where) console.error('WHERE:', e.where)
  process.exitCode = 1
}
await db.close()
