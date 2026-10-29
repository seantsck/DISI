#!/usr/bin/env node
// Measures the 059 state of a DISI database (read-only) and prints it as JSON: the 058 measurement (database/research/058/measure.mjs, unchanged)
// plus the career bWAR metric facts 059 is about: every CAREER_BWAR observation, the BWAR_MISSING queue, the eleven reviewed players' team-season
// ledgers and outcome values, the excluded 057 eleven, and fingerprints of everything 059 must not move.
//   node database/research/059/measure.mjs --dump <pglite-data-dir.tar>     a saved PGlite replay
//   node database/research/059/measure.mjs --chain <last-migration.sql>     a fresh canonical PGlite replay through that migration
//   DISI_VERIFY_DB_URL=... node database/research/059/measure.mjs           a PostgreSQL database (read-only transaction)
// With --baseline the output is written to database/research/059/baseline.json; with --out <file> to that file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure as measure058 } from '../058/measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const scope = JSON.parse(fs.readFileSync(path.join(here, 'scope.json'), 'utf8'))
const list = (xs) => xs.map((x) => `'${x}'`).join(', ')
const SCOPE = list(scope.players.map((p) => p.slug))
const EXCLUDED = list(scope.excluded_057.map((p) => p.slug))

// collation-independent fingerprint: md5 per row, rows ordered by their md5
const fp = (from, drop = []) => `(select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5((to_jsonb(t) - 'updated_at' ${drop.map((k) => `- '${k}'`).join(' ')})::text) as h from ${from} t) z)`

export const MEASURE_059_SQL = {
  metric: `select metric_key, count(*)::int as observations, count(distinct player_id)::int as players from public.player_metric_observations group by 1 order by 1`,
  scoped_metric: `select p.slug, m.value::text as value, m.observed_through_date::text as observed_through_date, m.observed_through_season, s.url as source_url, m.confidence::text as confidence, m.notes
    from public.player_metric_observations m join public.players p on p.id = m.player_id join public.sources s on s.id = m.source_id
    where m.metric_key = 'CAREER_BWAR' and p.slug in (${SCOPE}, ${EXCLUDED}) order by 1, 3`,
  bwar_missing: `select t.player_slug, t.franchise_key, t.signing_year from public.v_research_tasks t where t.task_type = 'BWAR_MISSING' order by 1`,
  tasks: `select task_type, franchise_key = 'DODGERS' as dodgers, count(*)::int as items from public.v_research_tasks group by 1, 2 order by 1, 2`,
  ledger: `select pl.slug, pl.bref_id, pl.mlb_id::text as mlb_id, count(*)::int as rows, count(*) filter (where w.component = 'BAT')::int as bat_rows,
      count(*) filter (where w.component = 'PITCH')::int as pitch_rows, count(*) filter (where w.war is null)::int as null_war_rows,
      coalesce(sum(w.war) filter (where w.component = 'BAT'), 0)::text as bat, coalesce(sum(w.war) filter (where w.component = 'PITCH'), 0)::text as pitch,
      sum(w.war)::text as total, round(sum(w.war), 1)::text as total_1dp, min(w.season) as first_season, max(w.season) as last_season,
      count(distinct w.season)::int as seasons, string_agg(distinct w.bref_team_code, ',' order by w.bref_team_code) as teams,
      count(*) filter (where w.organization_id is null)::int as unmapped, count(*) filter (where w.bref_team_code = 'TOT')::int as tot,
      string_agg(distinct s.url, ' ' order by s.url) as sources, string_agg(distinct w.observed_through_date::text || '/' || w.observed_through_season, ',') as observed,
      oc.career_war::text as outcome_career_war, oc.current_status
    from public.players pl join public.player_mlb_team_season_war w on w.player_id = pl.id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
    join public.sources s on s.id = w.source_id left join public.outcomes oc on oc.player_id = pl.id
    where pl.slug in (${SCOPE}, ${EXCLUDED}) group by pl.slug, pl.bref_id, pl.mlb_id, oc.career_war, oc.current_status order by 1`,
  identity: `select pl.slug, pl.bref_id, pl.mlb_id::text as mlb_id, pl.full_name, string_agg(sg.record_scope, ',' order by sg.record_scope) as record_scope,
      string_agg(o.franchise_key, ',' order by o.franchise_key) as franchise, count(sg.id)::int as signings
    from public.players pl join public.signings sg on sg.player_id = pl.id join public.organizations o on o.id = sg.organization_id
    where pl.slug in (${SCOPE}, ${EXCLUDED}) group by 1, 2, 3, 4 order by 1`,
  war_sources: `select url, source_type::text as source_type, source_tier::text as source_tier from public.sources where url like '%baseball-reference.com/data/war_daily_%' order by url`,
  dossier: `select player_slug, career_bwar::text as career_bwar, bwar_observed_through_season, bwar_observed_through_date::text as bwar_observed_through_date, is_active
    from public.v_player_dossier where player_slug in (${SCOPE}, ${EXCLUDED}) order by 1`,
  isolation: `select ${fp('public.outcomes')} as outcomes, ${fp('public.player_mlb_team_season_war')} as team_season_war, ${fp('public.sources')} as sources,
      ${fp('public.v_outcome_training_population')} as training_population, ${fp('public.v_outcome_feature_matrix')} as feature_matrix,
      ${fp('public.v_outcome_target_support')} as support, ${fp('public.v_outcome_model_evaluation')} as evaluation_view,
      ${fp('public.v_player_outcome_probability')} as probabilities, ${fp('public.v_expected_value_support')} as expected_values,
      ${fp('public.v_player_realized_outcome')} as realized_outcome, ${fp('public.v_player_realized_organizational_value')} as realized_value,
      ${fp('public.v_transaction_asset_lineage')} as lineage, ${fp('public.v_transaction_research_queue')} as transaction_queue,
      ${fp('public.v_value_research_queue')} as value_queue, ${fp('public.v_executive_overview')} as executive_overview,
      (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(t)::text) as h from public.v_research_tasks t where t.task_type <> 'BWAR_MISSING' or t.franchise_key = 'DODGERS') z) as other_research_tasks`,
}

export async function measure(query) {
  const base = await measure058(query)
  const out = {}
  for (const [k, sql] of Object.entries(MEASURE_059_SQL)) out[k] = await query(sql)
  return { ...base, metric: out.metric, scoped_metric: out.scoped_metric, bwar_missing: out.bwar_missing, tasks: out.tasks, ledger: out.ledger, identity: out.identity,
    war_sources: out.war_sources, dossier: out.dossier, isolation: out.isolation[0] }
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
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-059-measure' })
    await client.connect()
    await client.query('begin read only')
    query = async (sql) => (await client.query(sql)).rows
    close = async () => { await client.query('rollback'); await client.end() }
  }
  const m = await measure(query)
  await close()
  const text = JSON.stringify(m, null, 1) + '\n'
  if (process.argv.includes('--baseline')) fs.writeFileSync(path.join(here, 'baseline.json'), text)
  if (arg('out')) fs.writeFileSync(path.resolve(arg('out')), text)
  process.stdout.write(text)
}
