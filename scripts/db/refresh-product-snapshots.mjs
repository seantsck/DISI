// Refreshes the DISI product snapshots (Migration 045a): one validated generation, in one transaction.
//
// Usage:
//   npm run refresh:product-snapshots           -> node --env-file-if-exists=.env.local scripts/db/refresh-product-snapshots.mjs
//   node scripts/db/refresh-product-snapshots.mjs [--drift]
//
//   DISI_REFRESH_DB_URL       privileged connection URL (the database owner); required, never printed. Nothing else is read.
//   DISI_EXPECTED_PROJECT_REF optional: refuse unless the URL's host or user names this Supabase project
//   DISI_DB_CA_FILE           optional: CA certificate for TLS verification of a remote database (TLS is always verified remotely)
//   --drift                   read-only: report each snapshot's drift from its analytical source; writes nothing
//
// Run it explicitly after DISI research data changes - never from a page request, never on a schedule the product depends on.
// Readers keep seeing the previous complete generation until the refresh commits; a failed validation changes nothing.
// Prints counts and timings only.

import fs from 'node:fs'

const fail = (msg, code = 2) => { console.error(msg); process.exit(code) }
const drift = process.argv.includes('--drift')
const url = process.env.DISI_REFRESH_DB_URL
if (!url) fail('DISI_REFRESH_DB_URL is not set (use npm run refresh:product-snapshots, which loads .env.local). Nothing was done.')

let parsed
try { parsed = new URL(url) } catch { fail('DISI_REFRESH_DB_URL is not a valid connection URL. Nothing was done.') }
const host = parsed.hostname
const local = ['localhost', '127.0.0.1', '::1'].includes(host)
const ref = process.env.DISI_EXPECTED_PROJECT_REF
if (ref && !(host.includes(ref) || decodeURIComponent(parsed.username).endsWith(`.${ref}`))) fail('The URL does not name the expected project. Nothing was done.')
/** @type {false | { rejectUnauthorized: boolean, ca?: string }} */
const ssl = local ? false
  : { rejectUnauthorized: true, ...(process.env.DISI_DB_CA_FILE ? { ca: fs.readFileSync(process.env.DISI_DB_CA_FILE, 'utf8') } : {}) }

// 'pg' is an untyped devDependency used only by ops scripts; the split specifier keeps tsc (checkJs) out of its internals
const pgSpecifier = ['p', 'g'].join('')
const { Client } = await import(pgSpecifier)
const client = new Client({ connectionString: url, ssl, application_name: 'disi-product-snapshot-refresh' })
client.on('error', () => {})
try { await client.connect() } catch (e) { fail(`Could not connect (${e.code || 'connection error'}). Nothing was done.`) }
const q = async (sql) => (await client.query(sql)).rows

let code = 0
try {
  const [who] = await q(`select current_user as role,
      to_regprocedure('public.disi_refresh_product_snapshots()') is not null as installed,
      coalesce(has_function_privilege(current_user, to_regprocedure('public.disi_refresh_product_snapshots()'), 'EXECUTE'), false) as may_refresh`)
  if (!who.installed) fail('The product snapshot layer (Migration 045a) is not installed on this database. Nothing was done.')
  if (['anon', 'authenticated'].includes(who.role) || !who.may_refresh) fail('These credentials cannot refresh the product snapshots (privileged database credentials are required). Nothing was done.')
  console.log(`target: ${local ? 'local database' : 'remote database (TLS verified)'}; role ${who.role === 'postgres' ? 'postgres (owner)' : 'privileged'}`)

  if (drift) {
    await q('begin read only')
    const rows = await q(`select snapshot, missing_rows, extra_rows from public.disi_product_snapshot_drift()`)
    await q('rollback')
    for (const r of rows) console.log(`  ${r.snapshot.padEnd(36)} missing ${r.missing_rows}  extra ${r.extra_rows}`)
    const total = rows.reduce((a, r) => a + r.missing_rows + r.extra_rows, 0)
    console.log(total === 0 ? 'snapshots are current' : `snapshots differ from their sources in ${total} row(s): run the refresh`)
    code = total === 0 ? 0 : 1
  } else {
    const t = performance.now()
    await q('begin')
    await q(`set local statement_timeout = '600s'`)
    const stages = await q(`select snapshot, row_count, elapsed_ms from public.disi_refresh_product_snapshots()`)
    const [g] = await q(`select generation_id, source_data_as_of_date, product_version, schema_version, support_chain_state from public.product_executive_snapshot`)
    await q('commit')
    for (const s of stages) console.log(`  ${s.snapshot.padEnd(36)} ${String(s.row_count).padStart(5)} rows  ${String(s.elapsed_ms).padStart(6)} ms`)
    console.log(`generation ${g.generation_id} committed in ${Math.round(performance.now() - t)} ms: ${g.product_version} (schema ${g.schema_version}), source data as of ${g.source_data_as_of_date instanceof Date ? g.source_data_as_of_date.toISOString().slice(0, 10) : g.source_data_as_of_date}, ${g.support_chain_state}`)
  }
} catch (e) {
  await client.query('rollback').catch(() => {})
  // our own validation message is safe to show; anything else is reported by its SQLSTATE only
  const msg = String(e.message || '')
  console.error(msg.startsWith('product snapshot refresh refused') ? msg : `Refresh failed (SQLSTATE ${e.code || 'unknown'}); the previous generation is unchanged.`)
  code = 1
} finally {
  await client.end().catch(() => {})
}
process.exit(code)
