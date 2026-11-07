#!/usr/bin/env node
// Measures the 062 state of a DISI database (read-only) and prints it as JSON: the 061 measurement (database/research/061/measure.mjs, unchanged)
// plus the career bWAR facts 062 is about: every CAREER_BWAR observation, the BWAR_MISSING queue with each player's identity, team-season WAR
// ledger, outcome and sources, the team-season WAR state, the CAREER_BWAR source rows the provider trigger accepts, and fingerprints of the
// metric and WAR tables. The fingerprints are collation-independent (md5 per row, ordered by md5), exclude only updated_at, and include surrogate ids, so they
// compare two states of one database (before / after), never two separate builds.
//   node database/research/062/measure.mjs --dump <pglite-data-dir.tar>     a saved PGlite replay
//   node database/research/062/measure.mjs --chain <last-migration.sql>     a fresh canonical PGlite replay through that migration
//   DISI_VERIFY_DB_URL=... node database/research/062/measure.mjs           a PostgreSQL database (read-only transaction)
// With --baseline the output is written to database/research/062/baseline-build.json; with --out <file> to that file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure as measure061 } from '../061/measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const fp = (from) => `(select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5((to_jsonb(t) - 'updated_at')::text) as h from ${from} t) z)`

export const MEASURE_062_SQL = {
  career_bwar: `select p.slug, p.bref_id, p.mlb_id::text as mlb_id, m.value::text as value, m.observed_through_date::text as observed_through_date, m.observed_through_season,
      s.url as source_url, m.confidence::text as confidence
    from public.player_metric_observations m join public.players p on p.id = m.player_id join public.sources s on s.id = m.source_id
    where m.metric_key = 'CAREER_BWAR' order by 1, 5`,
  backlog: `select t.player_slug as slug, p.full_name, p.bref_id, p.mlb_id::text as mlb_id, p.birth_date::text as birth_date, p.birth_country, p.mlb_debut_date::text as mlb_debut_date,
      t.franchise_key, t.signing_year, t.detail,
      r.reached_mlb_verified, r.career_bwar::text as career_bwar,
      o.career_war::text as outcome_career_war, o.outcome_through_season, o.current_status, os.url as outcome_source_url,
      (select count(*) from public.player_mlb_team_season_war w where w.player_id = p.id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR')::int as war_rows,
      (select min(w.season) from public.player_mlb_team_season_war w where w.player_id = p.id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR') as war_first_season,
      (select max(w.season) from public.player_mlb_team_season_war w where w.player_id = p.id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR') as war_last_season,
      (select sum(w.war)::text from public.player_mlb_team_season_war w where w.player_id = p.id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR') as war_sum,
      (select string_agg(distinct s.url, ' ' order by s.url) from public.player_mlb_team_season_war w join public.sources s on s.id = w.source_id
        where w.player_id = p.id and w.record_status = 'ACTIVE') as war_sources,
      (select count(*) from public.player_metric_observations m where m.player_id = p.id)::int as metric_observations
    from public.v_research_tasks t join public.players p on p.id = t.player_id join public.v_signing_records r on r.player_id = p.id and r.signing_year = t.signing_year
      and r.franchise_key = t.franchise_key
    left join public.outcomes o on o.player_id = p.id left join public.sources os on os.id = o.source_id
    where t.task_type = 'BWAR_MISSING' order by 1`,
  war_sources: `select s.url, s.source_type::text as source_type, s.source_tier::text as source_tier, s.accessed_at::text as accessed_at, s.publication_date::text as publication_date,
      s.url ~* '^https?://(www\\.)?baseball-reference\\.com/' as accepted_for_career_bwar,
      (select count(*) from public.player_mlb_team_season_war w where w.source_id = s.id)::int as team_season_rows,
      (select count(*) from public.player_metric_observations m where m.source_id = s.id)::int as metric_rows
    from public.sources s where s.source_type::text = 'WAR_DATA_FILE' order by 1`,
  team_season_war: `select war_system, component, record_status, count(*)::int as rows, count(distinct player_id)::int as players, sum(war)::text as war
    from public.player_mlb_team_season_war group by 1, 2, 3 order by 1, 2, 3`,
  provider_rule: `select pg_get_functiondef(p.oid) ~ 'baseball-reference' as bwar_requires_baseball_reference_url, md5(p.prosrc) as prosrc_md5, p.prosecdef,
      p.proconfig::text as proconfig, (select count(*) from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal)::int as triggers
    from pg_proc p where p.oid = 'public.player_metric_observations_check_provider()'::regprocedure`,
  fingerprints: `select ${fp('public.player_metric_observations')} as metric_observations, ${fp('public.player_mlb_team_season_war')} as team_season_war,
      ${fp('public.outcomes')} as outcomes, ${fp('public.players')} as players, ${fp('public.signings')} as signings`,
}

export async function measure(query) {
  const base = await measure061(query)
  const out = {}
  for (const [k, sql] of Object.entries(MEASURE_062_SQL)) out[k] = await query(sql)
  return {
    headline: { ...base.headline, career_bwar_observations: out.career_bwar.length, bwar_missing: out.backlog.length },
    career_bwar: out.career_bwar, backlog: out.backlog, war_sources: out.war_sources, team_season_war: out.team_season_war,
    provider_rule: out.provider_rule[0], fingerprints_062: out.fingerprints[0],
    isolation_061: { counts: base.counts, fingerprints: base.fingerprints, transaction_queue: base.transaction_queue_rows.length, value_queue: base.value_queue_rows.length },
    isolation_060: base.isolation_060,
  }
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
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-062-measure' })
    await client.connect()
    await client.query('begin read only')
    query = async (sql) => (await client.query(sql)).rows
    close = async () => { await client.query('rollback'); await client.end() }
  }
  const m = await measure(query)
  await close()
  const text = JSON.stringify(m, null, 1) + '\n'
  if (process.argv.includes('--baseline')) fs.writeFileSync(path.join(here, 'baseline-build.json'), text)
  if (arg('out')) fs.writeFileSync(path.resolve(arg('out')), text)
  process.stdout.write(text)
}
