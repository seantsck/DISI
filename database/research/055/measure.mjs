#!/usr/bin/env node
// Measures the 055 state of a DISI database (read-only) and prints it as JSON: the 050 measurement (database/research/050/measure.mjs,
// unchanged) plus the benchmark labels per Top-prospect population and target.
//   node database/research/055/measure.mjs --dump <pglite-data-dir.tar>     a saved PGlite replay
//   node database/research/055/measure.mjs --chain <last-migration.sql>     a fresh canonical PGlite replay through that migration
//   DISI_VERIFY_DB_URL=... node database/research/055/measure.mjs           a PostgreSQL database (read-only transaction)
// With --baseline the output is written to database/research/055/baseline.json (the pre-055 state the migration proves before it writes).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure as measure050 } from '../050/measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }

export const LABELS_SQL = `select pm.population_key, p.target_key, count(*)::int as rows,
    count(*) filter (where p.label is true)::int as positive, count(*) filter (where p.label is false)::int as negative,
    count(*) filter (where p.training_state = 'CENSORED')::int as censored, count(*) filter (where p.training_state = 'OUTCOME_UNAUDITED')::int as unaudited,
    count(*) filter (where p.training_state = 'OUT_OF_SCOPE')::int as out_of_scope
  from public.v_outcome_training_population p
  join (select s.id as signing_id, sp.population_key from public.signings s
        join public.signing_population_members m on m.signing_id = s.id join public.signing_populations sp on sp.id = m.population_id
        where sp.population_scope = 'TOP_PROSPECT_SAMPLE') pm on pm.signing_id = p.signing_id
  group by 1, 2 order by 1, 2`

export async function measure(query) {
  return { ...(await measure050(query)), benchmark_labels: await query(LABELS_SQL) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let query, close
  const dump = arg('dump'), chainTo = arg('chain')
  if (dump || chainTo) {
    let db
    if (dump) {
      const { PGlite } = await import(['@electric-sql', 'pglite'].join('/'))
      const { pgcrypto } = await import(['@electric-sql', 'pglite', 'contrib', 'pgcrypto'].join('/'))
      db = new PGlite({ loadDataDir: new Blob([fs.readFileSync(dump)]), extensions: { pgcrypto } })
    } else {
      const { buildChainThrough } = await import('../../../tests/db/canonical-chain.mjs')
      db = (await buildChainThrough(chainTo)).db
    }
    query = async (sql) => (await db.query(sql)).rows
    close = () => db.close()
  } else {
    const url = process.env.DISI_VERIFY_DB_URL
    if (!url) throw new Error('pass --dump <tar>, --chain <migration> or set DISI_VERIFY_DB_URL')
    const { Client } = (await import(['p', 'g'].join(''))).default
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-055-measure' })
    await client.connect()
    await client.query('begin read only')
    query = async (sql) => (await client.query(sql)).rows
    close = async () => { await client.query('rollback'); await client.end() }
  }
  const m = await measure(query)
  await close()
  const text = JSON.stringify(m, null, 1) + '\n'
  if (process.argv.includes('--baseline')) fs.writeFileSync(path.join(here, 'baseline.json'), text)
  process.stdout.write(text)
}
