#!/usr/bin/env node
// Local 022-only harness: builds 001-021 in PGlite, then runs 022 to surface
// the exact error with its character position. Not part of npm test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8'))
const db = new PGlite({ extensions: { pgcrypto } })
await db.exec('create role anon nologin; create role authenticated nologin;')
for (const file of manifest.canonical_sql) {
  if (file === '022_player_development_exact_dates.sql') break
  try { await db.exec(fs.readFileSync(path.join(root, 'database/sql', file), 'utf8')) }
  catch (e) { console.error(`${file}: ${e.message}`); process.exit(1) }
}
try {
  await db.exec(fs.readFileSync(path.join(root, 'database/sql/022_player_development_exact_dates.sql'), 'utf8'))
  console.log('022 OK')
} catch (e) {
  console.error('022 FAIL:', e.message)
  if (e.position) {
    const sql = fs.readFileSync(path.join(root, 'database/sql/022_player_development_exact_dates.sql'), 'utf8')
    const pos = Number(e.position)
    const before = sql.slice(Math.max(0, pos - 200), pos)
    const after = sql.slice(pos, pos + 120)
    console.error(`...${before} >>>HERE>>> ${after}`)
  }
  if (e.where) console.error('WHERE:', e.where)
}
await db.close()
