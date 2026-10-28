#!/usr/bin/env node
// Measures the 057 state of a DISI database (read-only) and prints it as JSON: the 056 measurement (database/research/056/measure.mjs, unchanged)
// plus the bWAR facts 057 is about: the active team-season rows, the bWAR labels of the scoped players, the research-queue items that read them.
//   node database/research/057/measure.mjs --dump <pglite-data-dir.tar>     a saved PGlite replay
//   node database/research/057/measure.mjs --chain <last-migration.sql>     a fresh canonical PGlite replay through that migration
//   DISI_VERIFY_DB_URL=... node database/research/057/measure.mjs           a PostgreSQL database (read-only transaction)
// With --baseline the output is written to database/research/057/baseline.json (the pre-057 state the migration proves before it writes).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure as measure056 } from '../056/measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const scope = JSON.parse(fs.readFileSync(path.join(here, 'scope.json'), 'utf8'))
const list = (xs) => xs.map((x) => `'${x}'`).join(', ')
const SCOPED = list([...scope.approved, ...scope.deferred_incomplete_window, ...scope.identity_unresolved].map((p) => p.slug))

export const MEASURE_057_SQL = {
  war: `select count(*)::int as rows, count(*) filter (where record_status = 'ACTIVE')::int as active, count(*) filter (where record_status = 'RETRACTED')::int as retracted,
      count(distinct bref_id) filter (where record_status = 'ACTIVE')::int as active_players
    from public.player_mlb_team_season_war`,
  scoped_labels: `select p.player_slug, p.target_key, p.label, p.training_state, p.window_bwar::text as window_bwar, o.career_war::text as career_war
    from public.v_outcome_training_population p left join public.outcomes o on o.player_id = p.player_id
    where p.player_slug in (${SCOPED}) and p.target_key in ('POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS') order by 1, 2`,
  research_tasks: `select task_type, count(*)::int as items from public.v_research_tasks where task_type = 'BWAR_MISSING' group by 1 order by 1`,
  probability_queue: `select issue, target_key, count(*)::int as items from public.v_outcome_probability_research_queue group by 1, 2 order by 1, 2`,
  readiness: `select target_key, reference_population, readiness_state, labelled_n, positive_n, negative_n, fitted_model_supported from public.v_prediction_readiness order by 1, 2`,
}

export async function measure(query) {
  const base = await measure056(query)
  const out = {}
  for (const [k, sql] of Object.entries(MEASURE_057_SQL)) out[k] = await query(sql)
  return { ...base, war: out.war[0], scoped_labels: out.scoped_labels, research_tasks: out.research_tasks, probability_queue: out.probability_queue, readiness: out.readiness }
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
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-057-measure' })
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
