// Builds the complete canonical SQL lineage (database/manifest.json) in an
// in-process Postgres (PGlite). Shared by the DB test suites and the drift
// verifier's local mode so every consumer checks the same clean 001→021 state.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'database/manifest.json'), 'utf8')
)

/**
 * Applies every canonical migration to a fresh PGlite database.
 * Returns the PGlite handle plus a rows() helper. The caller owns close().
 */
export async function buildCanonicalChain() {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec('create role anon nologin; create role authenticated nologin;')
  for (const file of manifest.canonical_sql) {
    try {
      await db.exec(fs.readFileSync(path.join(root, 'database/sql', file), 'utf8'))
    } catch (error) {
      await db.close()
      throw new Error(`${file} failed: ${error.message}`)
    }
  }
  const query = async (sql, params) => (await db.query(sql, params)).rows
  return { db, query, close: () => db.close() }
}
