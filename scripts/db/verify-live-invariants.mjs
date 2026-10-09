// Read-only drift verifier for the DISI research database.
//
// Usage:
//   npm run verify:db        -> node scripts/db/verify-live-invariants.mjs --local
//                               local canonical chain (PGlite); ignores every DB URL
//   npm run verify:db:live   -> node --env-file=.env.local scripts/db/verify-live-invariants.mjs --live
//                               live database; requires DISI_VERIFY_DB_URL (or DATABASE_URL)
//                               and never falls back to the local chain
//   node scripts/db/verify-live-invariants.mjs   (no flag: legacy behaviour - live when a URL
//                               is set in the environment, otherwise local)
//
// The connection URL is read from DISI_VERIFY_DB_URL (falling back to
// DATABASE_URL). Nothing is hardcoded and nothing is ever written to the
// database: every statement executed is a SELECT.
//
// Exit status: 0 when every hard invariant passes, 1 otherwise. Informational
// coverage metrics are reported but never fail the run.

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { checkInvariants, formatReport, failedChecks } from './lib/invariants.mjs'

/**
 * Runs the invariant battery against a read-only query function and prints
 * the report. Returns the process exit code: 0 when every hard invariant
 * passes, 1 otherwise.
 */
export async function runVerifier(query, mode) {
  console.log(`DISI canonical drift verifier — ${mode}`)
  console.log('')
  const report = await checkInvariants(query)
  for (const line of formatReport(report)) console.log(line)
  const failures = failedChecks(report)
  console.log('')
  console.log(
    `${report.hard.length - failures.length}/${report.hard.length} hard invariants passed` +
      (failures.length ? ` — ${failures.length} FAILED` : '')
  )
  return failures.length ? 1 : 0
}

const invokedDirectly = Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  const wantLocal = process.argv.includes('--local')
  const wantLive = process.argv.includes('--live')
  if (wantLocal && wantLive) {
    console.error('Pass either --local or --live, not both.')
    process.exit(2)
  }
  const envUrl = process.env.DISI_VERIFY_DB_URL || process.env.DATABASE_URL
  if (wantLive && !envUrl) {
    console.error('--live needs DISI_VERIFY_DB_URL (or DATABASE_URL); use npm run verify:db:live, which loads .env.local. Refusing to fall back to the local chain.')
    process.exit(2)
  }
  const url = wantLocal ? null : envUrl
  let query
  let mode
  let close = async () => {}

  if (url) {
    // 'pg' is an untyped devDependency used only by this ops script; the split
    // specifier keeps tsc (checkJs) from type-checking pg's vendored internals.
    const pgSpecifier = ['p', 'g'].join('')
    const { Client } = await import(pgSpecifier)
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
    await client.connect()
    query = async (sql) => (await client.query(sql)).rows
    close = () => client.end()
    mode = 'live database (pg)'
  } else {
    const { buildCanonicalChain } = await import('../../tests/db/canonical-chain.mjs')
    const chain = await buildCanonicalChain()
    query = chain.query
    close = chain.close
    mode = 'local canonical 001→027 chain (PGlite)'
  }

  try {
    process.exitCode = await runVerifier(query, mode)
  } finally {
    await close()
  }
}
