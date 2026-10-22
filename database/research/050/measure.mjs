#!/usr/bin/env node
// Measures the 050 state of a DISI database (read-only) and prints it as JSON:
//   node database/research/050/measure.mjs --dump <pglite-data-dir.tar>     a saved PGlite replay
//   DISI_VERIFY_DB_URL=... node database/research/050/measure.mjs           a PostgreSQL database (read-only transaction)
// With --baseline the output is written to database/research/050/baseline.json (the pre-050 state the migration proves before it writes).
// Counts are measured, never typed: the Dodgers-facing figures 050 must not move, the benchmark population, the support of every target per
// reference population, the stored model evaluation and whether it is current, the probabilities by population, and the executive function.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }

export const MEASURE_SQL = {
  counts: `select
      (select count(*) from public.players)::int as players,
      (select league_benchmark_players from public.v_database_status)::int as benchmark_players,
      (select dodgers_players from public.v_database_status)::int as dodgers_players,
      (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS')::int as dodgers_signings,
      (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id
         join public.outcome_audits a on a.player_id = s.player_id where o.franchise_key = 'DODGERS')::int as dodgers_audits,
      (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id
         join public.outcome_audits a on a.player_id = s.player_id where o.franchise_key = 'DODGERS' and a.reached_mlb_verified)::int as dodgers_verified_mlb,
      (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id
         join public.outcome_audits a on a.player_id = s.player_id where o.franchise_key = 'DODGERS' and not a.reached_mlb_verified)::int as dodgers_verified_no_mlb,
      (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id
         where o.franchise_key = 'DODGERS' and not exists (select 1 from public.outcome_audits a where a.player_id = s.player_id))::int as dodgers_not_audited,
      (select signings_with_known_cost from public.v_executive_overview)::int as known_costs,
      (select known_acquisition_spend_usd from public.v_executive_overview)::text as known_spend_usd,
      (select open_research_tasks from public.v_executive_overview)::int as open_research_tasks,
      (select count(*) from public.outcome_audits)::int as outcome_audits,
      (select count(*) from public.outcomes)::int as outcomes,
      (select count(*) from public.player_evaluations)::int as player_evaluations,
      (select count(*) from public.signings)::int as signings,
      (select count(*) from public.signings where record_scope = 'MLB_PIPELINE_TOP_PROSPECT')::int as benchmark_signings,
      (select count(*) from public.signing_populations)::int as signing_populations,
      (select count(*) from public.signing_population_members)::int as population_members,
      (select count(*) from public.signing_census_coverage)::int as census_coverage_rows,
      (select count(*) from public.sources)::int as sources,
      (select count(*) from public.player_mlb_team_season_war)::int as war_rows,
      (select count(*) from public.player_season_stints)::int as stints,
      (select count(*) from public.development_milestones)::int as milestones,
      (select count(*) from public.transaction_events)::int as transaction_events,
      (select count(*) from public.transaction_event_assets)::int as transaction_assets,
      (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')::int as tables,
      (select count(*) from information_schema.views where table_schema = 'public')::int as views,
      (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace)::int as functions,
      (select max(generation_id)::text from public.product_executive_snapshot) as snapshot_generation`,
  hashes: `select
      (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) as dodgers_signings_hash,
      (select md5(string_agg(t, '|' order by t)) from (select a::text as t from public.outcome_audits a join public.signings s on s.player_id = a.player_id
         join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) as dodgers_audits_hash,
      (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) as war_hash,
      (select md5(string_agg(t, '|' order by t)) from (select r::text as t from public.signing_financial_reports r) x) as financial_reports_hash,
      (select md5(string_agg(t, '|' order by t)) from (select e::text as t from public.transaction_events e union all select a::text from public.transaction_event_assets a) x) as transactions_hash,
      (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.player_season_stints s union all select m::text from public.development_milestones m) x) as development_hash,
      (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.signings s where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT') x) as benchmark_signings_hash`,
  support: `select target_key, reference_population, labelled_n, positive_n, negative_n, censored_n, unaudited_n, min_reference_n, min_positives, min_negatives,
      baseline_supported, support_state, baseline_probability::text, baseline_probability_low_90::text, baseline_probability_high_90::text,
      additional_positives_needed, additional_labels_needed
    from public.v_outcome_target_support order by target_key, reference_population`,
  evaluation: `select target_key, model_key, model_version, evaluated_rows, positive_n, folds, brier_score::text, log_loss::text, auc::text,
      brier_skill_vs_base_rate::text, decision, training_fingerprint, data_as_of_date::text, evaluation_current, live_rows
    from public.v_outcome_model_evaluation order by target_key, model_key`,
  probabilities: `select coalesce(training_population, 'NONE') as training_population, count(*)::int as rows, count(probability)::int as non_null
    from public.v_player_outcome_probability group by 1 order by 1`,
  probability_reasons: `select coalesce(training_population, 'NONE') as training_population, coalesce(prediction_exclusion_reason, 'ELIGIBLE') as reason, count(*)::int as rows
    from public.v_player_outcome_probability group by 1, 2 order by 1, 2`,
  executive: `select probability_targets, supported_probability_targets, non_null_probabilities, supported_expected_value_models, supported_expected_values,
      predictive_portfolio_recommendations, supported_fitted_models, prediction_readiness_state
    from public.v_executive_overview`,
  release: `select support_chain_state, supported_probability_targets, supported_expected_value_models, predictive_portfolio_recommendations from public.v_disi_release_status`,
  expected_value: `select value_model_key, probability_supported, expected_value_supported, support_state from public.v_expected_value_support order by 1`,
  benchmark_classes: `select population_key, expected_size, members, members_identity_resolved, members_audited, members_reached, dodgers_members, census_state, comparison_label
    from public.v_international_benchmark_class_coverage where population_scope = 'TOP_PROSPECT_SAMPLE' order by 1`,
  benchmark_queue: `select issue, count(*)::int as items from public.v_international_benchmark_research_queue group by 1 order by 1`,
  executive_function: `select md5(prosrc) as body_md5 from pg_proc where proname = 'disi_executive_overview' and pronamespace = 'public'::regnamespace`,
  refresh_function: `select md5(prosrc) as body_md5 from pg_proc where proname = 'disi_refresh_product_snapshots' and pronamespace = 'public'::regnamespace`,
}

export async function measure(query) {
  const out = {}
  for (const [k, sql] of Object.entries(MEASURE_SQL)) out[k] = await query(sql)
  return {
    counts: out.counts[0], hashes: out.hashes[0], support: out.support,
    evaluation: out.evaluation, probabilities: out.probabilities, probability_reasons: out.probability_reasons,
    executive: out.executive[0], release: out.release[0], expected_value: out.expected_value,
    benchmark_classes: out.benchmark_classes, benchmark_queue: out.benchmark_queue,
    executive_overview_body_md5: out.executive_function[0]?.body_md5 ?? null,
    refresh_function_body_md5: out.refresh_function[0]?.body_md5 ?? null,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let query, close
  const dump = arg('dump')
  if (dump) {
    const { PGlite } = await import(['@electric-sql', 'pglite'].join('/'))
    const { pgcrypto } = await import(['@electric-sql', 'pglite', 'contrib', 'pgcrypto'].join('/'))
    const db = new PGlite({ loadDataDir: new Blob([fs.readFileSync(dump)]), extensions: { pgcrypto } })
    query = async (sql) => (await db.query(sql)).rows
    close = () => db.close()
  } else {
    const url = process.env.DISI_VERIFY_DB_URL
    if (!url) throw new Error('pass --dump <tar> or set DISI_VERIFY_DB_URL')
    const { Client } = (await import(['p', 'g'].join(''))).default
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-050-measure' })
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
