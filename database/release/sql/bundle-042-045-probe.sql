-- DISI hosted database: read-only migration-state probe for the 042-045 bundle release.
--
-- Run as ONE statement batch in a read-only transaction, e.g. through the secret-safe runner (credential in the environment only):
--   psql -X -v ON_ERROR_STOP=1 -f database/release/sql/bundle-042-045-probe.sql
-- Every statement is a SELECT inside `begin read only` ... `rollback`; nothing can be written.
-- Expected values: database/release/042-045-release-plan.md (section 3).

begin read only;
set local statement_timeout = '30s';

-- 1. server and role
select version() as server_version, current_user as connected_as, current_setting('transaction_read_only') as read_only;

-- 2. marker objects of 041 (must be present before the release) and 042 / 043 / 044 / 045 (absent before, present after)
select m.migration, m.object, to_regclass(m.object) is not null as present
from (values
  ('041', 'public.v_player_outcome_probability'),
  ('042', 'public.expected_value_models'),
  ('042', 'public.v_player_realized_organizational_value'),
  ('042', 'public.v_historical_org_value_distribution'),
  ('042', 'public.v_expected_value_support'),
  ('042', 'public.v_player_expected_organizational_value'),
  ('042', 'public.v_expected_value_research_queue'),
  ('043', 'public.portfolio_scenario_definitions'),
  ('043', 'public.v_portfolio_candidate_readiness'),
  ('043', 'public.v_historical_portfolio_summary'),
  ('043', 'public.v_portfolio_scenario_evaluation'),
  ('043', 'public.v_portfolio_decision_support'),
  ('043', 'public.v_portfolio_research_queue'),
  ('044', 'public.v_executive_overview'),
  ('044', 'public.v_prediction_readiness'),
  ('045', 'public.disi_product_contract'),
  ('045', 'public.v_disi_release_status'),
  ('045', 'public.v_research_roadmap'),
  ('045', 'public.v_executive_metric_provenance')
) as m(migration, object)
order by 1, 2;

-- 3. row counts of the bundle tables (NULL before) and of the facts the bundle reads (it writes none of them)
select t.table_name,
  case when to_regclass('public.' || t.table_name) is null then null
       else (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.table_name), false, true, '')))[1]::text::int
  end as row_count
from (values ('expected_value_models'), ('portfolio_scenario_definitions'), ('disi_product_contract'), ('outcome_targets'), ('outcome_model_evaluations'),
  ('market_groups'), ('international_signing_eras'), ('signings'), ('outcome_audits'), ('outcomes'), ('player_mlb_team_season_war'),
  ('signing_environments'), ('player_season_stints'), ('portfolio_scenarios'), ('model_predictions')) as t(table_name)
order by 1;

-- 4. analysis as-of date (the bundle must not move it) and the 041 support state the bundle builds on
select max(audited_through_date)::text as analysis_as_of_date from public.outcome_audits;
select count(distinct target_key) filter (where baseline_supported)::int as supported_targets_041,
  (select count(*) from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED')::int as supported_models_041
from public.v_outcome_target_support;

-- 5. API surface: public tables / views, RLS, security_invoker, and anything granted beyond SELECT to anon / authenticated
select
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as public_tables,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as public_views,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity)::int as tables_without_rls,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'
     and not coalesce(array_to_string(reloptions, ',') ~ 'security_invoker=(true|on)', false))::int as views_not_security_invoker,
  (select count(*) from pg_class c cross join (values ('anon'), ('authenticated')) r(role)
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm')
       and (has_table_privilege(r.role, c.oid, 'INSERT') or has_table_privilege(r.role, c.oid, 'UPDATE') or has_table_privilege(r.role, c.oid, 'DELETE')
         or has_table_privilege(r.role, c.oid, 'TRUNCATE') or has_table_privilege(r.role, c.oid, 'REFERENCES') or has_table_privilege(r.role, c.oid, 'TRIGGER')))::int as api_beyond_select;

-- 6. bundle state
select case when to_regclass('public.v_disi_release_status') is null then 'bundle not applied' else 'bundle applied' end as bundle_state;

rollback;
