#!/usr/bin/env node
// Model-readiness audit: one read-only export of a saved PGlite replay to JSON. Nothing is written to the database (every query runs inside a
// READ ONLY transaction that is rolled back). The audit itself (build.mjs) reads only the JSON this writes.
//   node database/research/model-readiness/export.mjs [--dump <pglite-data-dir.tar>] [--out <file.json>]
// Defaults: --dump ~/.cache/disi-062/post061.tar (canonical post-061 replay), --out research-output/model-readiness/replay-export.json (gitignored).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const dump = arg('dump') || path.join(process.env.HOME, '.cache/disi-062/post061.tar')
const out = arg('out') || path.join(root, 'research-output/model-readiness/replay-export.json')

// Every query is a full read of a view or table the modelling layer depends on. Rows are sorted in JS (stable JSON key order) so the
// export is deterministic whatever plan the database chooses.
export const QUERIES = {
  as_of: `select (select max(audited_through_date)::text from public.outcome_audits) as analysis_as_of_date,
      (select count(*) from public.signings)::int as signings, (select count(*) from public.players)::int as players`,
  signing_records: `select * from public.v_signing_records`,
  signings: `select s.id as signing_id, pl.slug as player_slug, s.signing_year, s.signing_date::text as signing_date, s.formal_transaction_date::text as formal_transaction_date,
      s.announced_date::text as announced_date, s.pathway::text as pathway, s.country_market, s.position_at_signing, s.record_scope, o.franchise_key,
      pl.birth_date::text as birth_date, pl.mlb_id, pl.bref_id, pl.full_name, pl.primary_position, pl.mlb_debut_date::text as mlb_debut_date
    from public.signings s join public.players pl on pl.id = s.player_id join public.organizations o on o.id = s.organization_id`,
  signing_time_features: `select * from public.v_signing_time_features`,
  realized_outcome: `select * from public.v_player_realized_outcome`,
  training_population: `select * from public.v_outcome_training_population`,
  feature_matrix: `select * from public.v_outcome_feature_matrix`,
  outcome_targets: `select * from public.outcome_targets`,
  target_support: `select * from public.v_outcome_target_support`,
  model_evaluation: `select * from public.v_outcome_model_evaluation`,
  probability_queue: `select * from public.v_outcome_probability_research_queue`,
  probability_summary: `select target_key, count(*)::int as rows, count(probability)::int as probabilities, count(*) filter (where prediction_eligible)::int as eligible,
      prediction_exclusion_reason, model_support_state, sample_state
    from public.v_player_outcome_probability group by target_key, prediction_exclusion_reason, model_support_state, sample_state`,
  prediction_readiness: `select * from public.v_prediction_readiness`,
  expected_value_support: `select * from public.v_expected_value_support`,
  financials: `select * from public.v_signing_acquisition_financials`,
  financial_queue: `select * from public.v_financial_research_queue`,
  outcome_audits: `select a.*, pl.slug as player_slug from public.outcome_audits a join public.players pl on pl.id = a.player_id`,
  outcomes: `select o.player_id, pl.slug as player_slug, o.mlb_debut_date::text as mlb_debut_date, o.career_war, o.current_status from public.outcomes o join public.players pl on pl.id = o.player_id`,
  career_bwar_metrics: `select pl.slug as player_slug, count(*)::int as observations from public.player_metric_observations m join public.players pl on pl.id = m.player_id
    where m.metric_key = 'CAREER_BWAR' group by pl.slug`,
  team_season_war: `select pl.slug as player_slug, count(*)::int as rows, min(w.season) as first_season, max(w.season) as last_season
    from public.player_mlb_team_season_war w join public.players pl on pl.bref_id = w.bref_id where w.record_status = 'ACTIVE' and w.war_system = 'BWAR' group by pl.slug`,
  research_tasks: `select * from public.v_research_tasks`,
  mature_outcome_queue: `select * from public.v_dodgers_mature_outcome_queue`,
  outcome_audit_queue: `select * from public.v_dodgers_outcome_audit_queue`,
  benchmark_queue: `select * from public.v_international_benchmark_research_queue`,
  identity_queue: `select * from public.v_dodgers_player_identity_research_queue`,
  development_summary: `select * from public.v_dodgers_player_development_summary`,
  development_pathway: `select * from public.v_player_development_pathway`,
  development_date_coverage: `select * from public.v_dodgers_development_date_coverage`,
  development_queue: `select * from public.v_dodgers_development_research_queue`,
  transaction_queue: `select * from public.v_transaction_research_queue`,
  value_queue: `select * from public.v_value_research_queue`,
  career_transactions: `select pl.slug as player_slug, count(*)::int as rows from public.player_career_transactions t join public.players pl on pl.id = t.player_id group by pl.slug`,
  rankings: `select pl.slug as player_slug, count(*)::int as rankings from public.player_evaluation_rankings r join public.player_evaluations e on e.id = r.evaluation_id
      join public.players pl on pl.id = e.player_id group by pl.slug`,
  executive_overview: `select * from public.v_executive_overview`,
}

const norm = (v) => (v instanceof Date ? v.toISOString() : typeof v === 'bigint' ? v.toString() : v)
const sortRows = (rows) => rows.map((r) => Object.fromEntries(Object.keys(r).sort().map((k) => [k, norm(r[k])])))
  .map((r) => [JSON.stringify(r), r]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((x) => x[1])

if (import.meta.url === `file://${process.argv[1]}`) {
  const R = path.join(root, 'node_modules/@electric-sql/pglite/dist/')
  const { PGlite } = await import(R + 'index.js')
  const { pgcrypto } = await import(R + 'contrib/pgcrypto.js')
  const db = new PGlite({ loadDataDir: new Blob([fs.readFileSync(dump)]), extensions: { pgcrypto } })
  const result = { generated_by: 'database/research/model-readiness/export.mjs', source: path.basename(dump), queries: {} }
  await db.query('begin transaction read only')
  for (const [k, sql] of Object.entries(QUERIES)) {
    try {
      const r = await db.query(sql)
      result.queries[k] = { columns: r.fields.map((f) => f.name).sort(), rows: sortRows(r.rows) }
    } catch (e) {
      result.queries[k] = { error: String(e.message || e) }
      await db.query('rollback'); await db.query('begin transaction read only')
    }
    process.stderr.write(`${k}: ${result.queries[k].rows ? result.queries[k].rows.length : result.queries[k].error}\n`)
  }
  await db.query('rollback')
  await db.close()
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(result) + '\n')
  process.stderr.write(`wrote ${out}\n`)
}
