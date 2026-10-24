#!/usr/bin/env node
// Reads the research dataset (the same queries as `npm run research:development -- --needs --history --save`) from the canonical chain, read-only
// as the public anon role, so a before/after comparison reads both states the same way. No hosted database is contacted.
//
//   node database/research/053/canonical-dataset.mjs <out.json> [--datadir <pglite-dump.tar>]
//
// Without --datadir the whole canonical chain (database/manifest.json) is built in an in-process Postgres (PGlite) first.

import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { buildCanonicalChain } from '../../../tests/db/canonical-chain.mjs'
import { CAREER_QUERIES, CAREER_RELATION, DATASET_QUERIES, HISTORY_QUERIES } from '../../../lib/research/dataset.js'
import { stableJson } from '../../../lib/research/format.js'

const args = process.argv.slice(2)
const out = args[0]
if (!out) throw new Error('usage: node database/research/053/canonical-dataset.mjs <out.json> [--datadir <pglite-dump.tar>]')
const i = args.indexOf('--datadir')
const db = i > 0 ? new PGlite({ loadDataDir: new Blob([fs.readFileSync(args[i + 1])]), extensions: { pgcrypto } }) : (await buildCanonicalChain()).db
// as the hosted read returns them: DATE columns (type oid 1082) as ISO day strings, bigint (20) and numeric (1700) as text
const DATE_OID = 1082
const TEXT_OIDS = new Set([20, 1700])
/** @type {Record<string, any[]>} */
const raw = {}
await db.exec('begin read only; set local role anon;')
const hasCareer = (await db.query('select to_regclass($1) is not null as ok', [`public.${CAREER_RELATION}`])).rows[0].ok
for (const [k, sql] of Object.entries({ ...DATASET_QUERIES, ...HISTORY_QUERIES, ...(hasCareer ? CAREER_QUERIES : {}) })) {
  const res = await db.query(sql)
  const dates = new Set(res.fields.filter((f) => f.dataTypeID === DATE_OID).map((f) => f.name))
  const texts = new Set(res.fields.filter((f) => TEXT_OIDS.has(f.dataTypeID)).map((f) => f.name))
  const cell = (c, v) => (v === null ? v : dates.has(c) && v instanceof Date ? v.toISOString().slice(0, 10) : texts.has(c) ? String(v) : v)
  raw[k] = res.rows.map((r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, cell(c, v)])))
}
await db.exec('rollback')
await db.close()
fs.writeFileSync(out, stableJson(raw) + '\n')
process.stderr.write(`wrote ${out} (${Object.keys(raw).length} queries)\n`)
