// Read-only dataset loader for the research commands.
//
//   --input <file.json>      a dataset saved earlier with --save (raw query results); no database is contacted
//   --history                also read the per-stint history and the progression decisions (048; larger, only the commands that need it ask)
//   DISI_RESEARCH_DB_URL     otherwise: a connection URL, falling back to DISI_VERIFY_DB_URL; never printed
//
// A database session is opened READ ONLY and switches to the public `anon` role, so the commands can only ever see what the website
// can see: the product snapshots and public views. They never write.

import fs from 'node:fs'
import { DATASET_QUERIES, HISTORY_QUERIES, assembleDataset } from '../../../lib/research/dataset.js'
import { stableJson } from '../../../lib/research/format.js'

export async function loadDataset(args) {
  if (args.input) {
    const raw = JSON.parse(fs.readFileSync(String(args.input), 'utf8'))
    return { raw, data: assembleDataset(raw) }
  }
  const url = process.env.DISI_RESEARCH_DB_URL || process.env.DISI_VERIFY_DB_URL
  if (!url) {
    throw new Error('No dataset: pass --input <dataset.json> or set DISI_RESEARCH_DB_URL (read-only; the commands connect as the public anon role).')
  }
  let host
  try { host = new URL(url).hostname } catch { throw new Error('DISI_RESEARCH_DB_URL is not a valid connection URL.') }
  const local = ['localhost', '127.0.0.1', '::1'].includes(host)
  const pgSpecifier = ['p', 'g'].join('')
  const pg = (await import(pgSpecifier)).default
  // DATE columns stay ISO strings (the default parser builds a local-time Date and shifts the day)
  const types = { getTypeParser: (oid, format) => (oid === 1082 ? (v) => v : pg.types.getTypeParser(oid, format)) }
  const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, application_name: 'disi-research-readonly', types })
  client.on('error', () => {})
  try { await client.connect() } catch (e) { throw new Error(`Could not connect (${e.code || 'connection error'}).`) }
  /** @type {Record<string, any[]>} */
  const raw = {}
  try {
    await client.query('begin read only')
    await client.query('set local role anon')
    await client.query("set local statement_timeout = '15s'")
    const queries = args.history === true ? { ...DATASET_QUERIES, ...HISTORY_QUERIES } : DATASET_QUERIES
    for (const [key, sql] of Object.entries(queries)) raw[key] = (await client.query(sql)).rows
    await client.query('rollback')
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw new Error(`Read failed (SQLSTATE ${e.code || 'unknown'}).`)
  } finally {
    await client.end().catch(() => {})
  }
  if (args.save) fs.writeFileSync(String(args.save), stableJson(raw) + '\n')
  return { raw, data: assembleDataset(raw) }
}
