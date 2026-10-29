#!/usr/bin/env node
// Measures the 058 state of a DISI database (read-only) and prints it as JSON: the 057 measurement (database/research/057/measure.mjs, unchanged)
// plus the transaction-return value facts 058 is about: the four returned players' rows, lineage and intervals, the three originating signings'
// realized value, the value and executive totals, the transaction and value research queues, and the prediction-layer fingerprints that must not move.
//   node database/research/058/measure.mjs --dump <pglite-data-dir.tar>     a saved PGlite replay
//   node database/research/058/measure.mjs --chain <last-migration.sql>     a fresh canonical PGlite replay through that migration
//   DISI_VERIFY_DB_URL=... node database/research/058/measure.mjs           a PostgreSQL database (read-only transaction)
// With --baseline the output is written to database/research/058/baseline.json (the pre-058 state the migration proves before it writes).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure as measure057 } from '../057/measure.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null }
const scope = JSON.parse(fs.readFileSync(path.join(here, 'scope.json'), 'utf8'))
const list = (xs) => xs.map((x) => `'${x}'`).join(', ')
const BREFS = list(scope.players.map((p) => p.bref_id))
const SIGNINGS = list([...new Set(scope.players.map((p) => p.originating_signing_slug))])

// prediction-layer fingerprints: collation-independent (md5 per row, rows ordered by their md5), so the same data gives the same hash anywhere
const fp = (from) => `(select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5((to_jsonb(t) - 'updated_at')::text) as h from ${from} t) z)`

export const MEASURE_058_SQL = {
  scoped_war: `select bref_id, count(*)::int as rows, count(*) filter (where component = 'BAT')::int as bat, count(*) filter (where component = 'PITCH')::int as pitch,
      count(*) filter (where organization_id is null)::int as unmapped, sum(war)::text as bwar
    from public.player_mlb_team_season_war where record_status = 'ACTIVE' and bref_id in (${BREFS}) group by 1 order by 1`,
  lineage: `select root_package_key, hop_number, asset_name, attribution_level, value_resolution, branch_status, war_state, interval_bounded_dodgers_bwar::text as bwar
    from public.v_transaction_asset_lineage where bref_id in (${BREFS}) order by 1, 2, 3`,
  war_not_loaded: `select asset_name, mlb_id, bref_id from public.v_transaction_asset_lineage where war_state = 'WAR_NOT_LOADED' group by 1, 2, 3 order by 1`,
  intervals: `select interval_key, interval_status, war_state, interval_bounded_dodgers_bwar::text as bwar, timing_resolution_basis, exit_resolution_basis,
      dodgers_rows_in_interval, dodgers_rows_outside_interval, dodgers_bwar_outside_interval::text as outside_bwar
    from public.v_player_control_intervals where bref_id in (${BREFS}) order by 1`,
  edges: `select event_key, incoming_asset_name, attribution_status, return_state, incoming_war_status, acquisition_timing_status, incoming_dodgers_bwar::text as edge_bwar
    from public.v_trade_realization_edges where incoming_bref_id in (${BREFS}) order by 1, 2`,
  signings: `select player_slug, realized_value_state, chain_status, direct_dodgers_bwar::text as direct, individually_attributable_trade_bwar::text as trade,
      realized_org_value_bwar::text as realized, package_first_hop_participation_bwar::text as pkg_first, package_downstream_participation_bwar::text as pkg_down,
      observable_not_attributable_bwar::text as observable
    from public.v_player_realized_organizational_value where player_slug in (${SIGNINGS}) order by 1`,
  older_view: `select player_slug, package_attribution_state, attributable_value_basis, individually_attributable_trade_return_bwar::text as trade, attributable_organizational_bwar::text as org
    from public.v_player_organizational_realization where player_slug in (${SIGNINGS}) order by 1`,
  value_totals: `select count(*) filter (where realized_org_value_bwar is not null)::int as resolved, sum(realized_org_value_bwar)::text as realized,
      count(*) filter (where realized_value_state = 'REALIZED_TO_DATE')::int as realized_to_date, count(*) filter (where realized_value_state = 'TO_DATE_CHAIN_INCOMPLETE')::int as chain_incomplete,
      count(*) filter (where realized_value_state = 'VALUE_UNRESOLVED')::int as unresolved, sum(package_first_hop_participation_bwar)::text as pkg_first,
      sum(package_downstream_participation_bwar)::text as pkg_down, sum(observable_not_attributable_bwar)::text as observable
    from public.v_player_realized_organizational_value`,
  executive: `select signings_with_resolved_value, realized_direct_dodgers_bwar::text as direct, realized_individually_attributable_trade_bwar::text as trade,
      realized_org_value_bwar::text as realized, value_left_organization_bwar::text as value_left, open_research_tasks
    from public.v_executive_overview`,
  transaction_queue: `select issue, count(*)::int as items from public.v_transaction_research_queue group by 1 order by 1`,
  value_queue: `select issue, count(*)::int as items from public.v_value_research_queue group by 1 order by 1`,
  scoped_queue: `select 'TRANSACTION' as queue, issue, event_key as key, asset_name as subject, detail from public.v_transaction_research_queue
      where event_key in (select event_key from public.transaction_events where event_key in (${list(scope.players.flatMap((p) => [p.acquisition_event_key, p.exit_event_key]))}))
    union all select 'VALUE', issue, player_slug, null, detail from public.v_value_research_queue where player_slug in (${SIGNINGS}) order by 1, 2, 3, 4`,
  research_task_types: `select task_type, count(*)::int as items from public.v_research_tasks group by 1 order by 1`,
  prediction: `select ${fp('public.outcomes')} as outcomes, ${fp('public.outcome_audits')} as outcome_audits, ${fp('public.outcome_targets')} as outcome_targets,
      ${fp('public.outcome_model_evaluations')} as evaluations, ${fp('public.v_outcome_target_support')} as support,
      ${fp('public.v_outcome_training_population')} as training_population, ${fp('public.v_outcome_feature_matrix')} as feature_matrix,
      (select count(*)::int from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED') as supported_models,
      (select count(probability)::int from public.v_player_outcome_probability) as probabilities,
      (select count(*)::int from public.v_expected_value_support where probability_supported or expected_value_supported) as expected_values,
      (select predictive_portfolio_recommendations from public.v_executive_overview) as recommendations,
      (select supported_probability_targets from public.v_executive_overview) as supported_targets,
      (select string_agg(distinct training_fingerprint, ',' order by training_fingerprint) from public.outcome_model_evaluations) as evaluation_fingerprints`,
  snapshots: `select (select max(generation_id)::int from public.product_executive_snapshot) as generation,
      (select count(*)::int from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) as drifting`,
}

export async function measure(query) {
  const base = await measure057(query)
  const out = {}
  for (const [k, sql] of Object.entries(MEASURE_058_SQL)) out[k] = await query(sql)
  return { ...base, scoped_war: out.scoped_war, lineage: out.lineage, war_not_loaded: out.war_not_loaded, intervals: out.intervals, edges: out.edges,
    signings: out.signings, older_view: out.older_view, value_totals: out.value_totals[0], executive: out.executive[0], transaction_queue: out.transaction_queue,
    value_queue: out.value_queue, scoped_queue: out.scoped_queue, research_task_types: out.research_task_types, prediction: out.prediction[0], snapshots: out.snapshots[0] }
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
    const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, application_name: 'disi-058-measure' })
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
