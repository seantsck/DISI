// Read-only checks for the DISI product snapshots and the API boundary (Migration 045a).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0):
// - the API boundary: every snapshot table has RLS and is readable by anon / authenticated; no 042-045 analytical view is readable by
//   them; no staged or serving function is executable by them or by PUBLIC; the serving functions are invoker-rights with a fixed
//   search_path (refresh VOLATILE, drift STABLE);
// - one generation: exactly one executive row, every snapshot row carries its generation_id, every Dodgers signing is covered;
// - no drift: every snapshot equals a fresh evaluation of its analytical source (disi_product_snapshot_drift, one statement per
//   snapshot), so a stale snapshot - research data changed, refresh not yet run - is reported;
// - the snapshot's own support chain: its predictive counts equal its rows and no layer is supported beyond the layer below it.
// `loaded` says whether the 045a objects exist; `statusLoaded` whether 045b's home-page status snapshot does (it adds product_database_status to
// the snapshots and closes v_database_status).

import { SNAPSHOT_TABLES, INTERNAL_VIEWS, STAGED_FUNCTIONS, SERVING_FUNCTIONS } from '../../../database/research/045a/snapshots.mjs'
import { STATUS_SNAPSHOT, NEWLY_INTERNAL_VIEWS } from '../../../database/research/045b/snapshots.mjs'

export const PRODUCT_SNAPSHOT_CHECK_NAMES = [
  'product_snapshot_api_violations', 'product_snapshot_generation_violations', 'product_snapshot_drift_violations', 'product_snapshot_support_violations',
]

const list = (xs) => xs.map((x) => `'${x}'`).join(', ')

/** name -> SQL returning one row { n } = number of violations. */
export const productSnapshotQueries = (loaded, statusLoaded = false) => {
  if (!loaded) return Object.fromEntries(PRODUCT_SNAPSHOT_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  const TABLES = statusLoaded ? [...SNAPSHOT_TABLES, STATUS_SNAPSHOT.table] : SNAPSHOT_TABLES
  const INTERNAL = statusLoaded ? [...INTERNAL_VIEWS, ...NEWLY_INTERNAL_VIEWS] : INTERNAL_VIEWS
  return {
    product_snapshot_api_violations: `select (
        (select count(*) from unnest(array[${list(TABLES)}]) t(n)
          left join pg_class c on c.relname = t.n and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
          where c.oid is null or not c.relrowsecurity
             or not has_table_privilege('anon', c.oid, 'SELECT') or not has_table_privilege('authenticated', c.oid, 'SELECT'))
      + (select count(*) from unnest(array[${list(INTERNAL)}]) v(n)
          join pg_class c on c.relname = v.n and c.relnamespace = 'public'::regnamespace
          where has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))
      + (select count(*) from unnest(array[${list([...STAGED_FUNCTIONS, ...SERVING_FUNCTIONS])}]) f(n)
          left join pg_proc p on p.proname = f.n and p.pronamespace = 'public'::regnamespace and p.pronargs = 0
          where p.oid is null or has_function_privilege('public', p.oid, 'EXECUTE')
             or has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE')
             or p.prosecdef or not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']))
      + (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
          and ((p.proname = 'disi_refresh_product_snapshots' and p.provolatile <> 'v') or (p.proname = 'disi_product_snapshot_drift' and p.provolatile <> 's')))
      )::int as n`,

    product_snapshot_generation_violations: `with e as materialized (select * from public.product_executive_snapshot)
      select (
        abs((select count(*) from e) - 1)
      ${TABLES.filter((t) => t !== 'product_executive_snapshot').map((t) => `+ (select count(*) from public.${t} x where x.generation_id is distinct from (select max(generation_id) from e))`).join('\n      ')}
      + (select count(*) from e where e.dodgers_signings <> (select count(distinct signing_id) from public.product_player_decision))
      + (select count(*) from e where e.generated_at is null or e.source_data_as_of_date is null or e.product_version is null or e.schema_version is null)
      )::int as n`,

    product_snapshot_drift_violations: `select coalesce(sum(missing_rows + extra_rows), 0)::int as n from public.disi_product_snapshot_drift()`,

    product_snapshot_support_violations: `with e as materialized (select * from public.product_executive_snapshot)
      select (
        (select count(*) from e where e.supported_probability_targets <> (select count(distinct target_key) from public.product_prediction_readiness where baseline_supported)
           or e.supported_expected_value_models <> (select count(*) from public.product_expected_value_support where expected_value_supported)
           or e.supported_expected_values <> (select count(expected_org_value_bwar) from public.product_player_expected_value)
           or e.predictive_portfolio_recommendations <> (select count(*) from public.product_player_decision where optimization_eligible)
           or (e.supported_probability_targets = 0) <> (e.support_chain_state = 'NO_PREDICTIVE_LAYER_SUPPORTED')
           or (e.supported_probability_targets = 0 and e.supported_expected_value_models > 0)
           or (e.supported_expected_value_models = 0 and (e.supported_expected_values > 0 or e.predictive_portfolio_recommendations > 0)))
      + (select count(*) from public.product_portfolio_scenarios where optimized_selection is not null and optimization_eligible_candidates = 0)
      + (select count(*) from public.product_player_expected_value where expected_org_value_bwar is not null and not expected_value_supported)
      )::int as n`,
  }
}
