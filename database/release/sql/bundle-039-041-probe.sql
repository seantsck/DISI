-- DISI hosted database: read-only migration-state probe for the 039-041 bundle release.
--
-- Run as ONE statement batch in a read-only transaction, e.g. through the secret-safe runner (credential in the environment only):
--   psql -X -v ON_ERROR_STOP=1 -f database/release/sql/bundle-036-038-probe.sql
-- Every statement is a SELECT inside `begin read only` ... `rollback`; nothing can be written.
-- Expected values: database/release/039-041-release-plan.md (section 3).

begin read only;
set local statement_timeout = '30s';

-- 1. server and role
select version() as server_version, current_user as connected_as, current_setting('transaction_read_only') as read_only;

-- 2. marker objects of 038a (must be present before the release) and 039 / 040 / 041 (absent before, present after)
select m.migration, m.object, to_regclass(m.object) is not null as present
from (values
  ('038', 'public.v_network_player_outcomes'),
  ('039', 'public.market_groups'),
  ('039', 'public.international_signing_eras'),
  ('039', 'public.v_signing_time_features'),
  ('039', 'public.v_market_pathway_player_context'),
  ('039', 'public.v_market_pathway_summary'),
  ('039', 'public.v_market_research_queue'),
  ('040', 'public.v_player_historical_archetype'),
  ('040', 'public.v_player_comparables'),
  ('040', 'public.v_player_comparable_summary'),
  ('040', 'public.v_archetype_outcome_summary'),
  ('040', 'public.v_archetype_research_queue'),
  ('041', 'public.outcome_targets'),
  ('041', 'public.outcome_model_evaluations'),
  ('041', 'public.v_outcome_training_population'),
  ('041', 'public.v_outcome_feature_matrix'),
  ('041', 'public.v_outcome_target_support'),
  ('041', 'public.v_outcome_model_evaluation'),
  ('041', 'public.v_player_outcome_probability'),
  ('041', 'public.v_outcome_probability_research_queue')
) as m(migration, object)
order by 1, 2;

-- 038a is in place (the query shape that reads the outcome spine once)
select position('rel as materialized' in lower(pg_get_viewdef('public.v_network_player_outcomes'::regclass))) > 0 as network_view_is_038a;

-- 3. row counts of the facts the bundle reads (it writes none of them; the bands table is NULL before 036)
select t.table_name,
  case when to_regclass('public.' || t.table_name) is null then null
       else (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.table_name), false, true, '')))[1]::text::int
  end as row_count
from (values ('market_groups'), ('international_signing_eras'), ('outcome_targets'), ('outcome_model_evaluations'), ('scouting_expectation_bands'), ('signings'), ('player_evaluations'), ('player_evaluation_rankings'), ('player_evaluation_grades'),
  ('player_season_stints'), ('development_progression_decisions'), ('player_network_relationships'), ('network_entities'),
  ('outcome_audits'), ('outcomes'), ('player_mlb_team_season_war')) as t(table_name)
order by 1;

-- 4. analysis as-of date (the bundle must not move it)
select max(audited_through_date)::text as analysis_as_of_date from public.outcome_audits;

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
select case when to_regclass('public.v_player_outcome_probability') is null then 'bundle not applied' else 'bundle applied' end as bundle_state;

rollback;
