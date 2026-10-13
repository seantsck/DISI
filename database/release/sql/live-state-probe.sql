-- DISI hosted database: read-only migration-state probe (034 / 035 release).
--
-- Run as ONE statement batch in a read-only transaction, e.g.
--   psql "$DISI_VERIFY_DB_URL" -X -v ON_ERROR_STOP=1 -f database/release/sql/live-state-probe.sql
-- Every statement is a SELECT inside `begin read only` ... `rollback`; nothing can be written.
-- Compare the output with the expected values in database/release/034-release-checklist.md (section 2).

begin read only;
set local statement_timeout = '30s';

-- 1. server and role
select version() as server_version, current_user as connected_as, current_setting('transaction_read_only') as read_only;

-- 2. which migrations' marker objects exist (033 / 034 / 035)
select m.migration, m.object, to_regclass(m.object) is not null as present
from (values
  ('033', 'public.v_transaction_research_queue'),
  ('033', 'public.v_transaction_asset_chain_readiness'),
  ('034', 'public.transaction_asset_timing_observations'),
  ('034', 'public.v_player_control_intervals'),
  ('034', 'public.v_downstream_organizational_realization'),
  ('035', 'public.v_international_benchmark_player_outcomes'),
  ('035', 'public.v_international_benchmark_class_coverage'),
  ('035', 'public.v_international_benchmark_research_queue')
) as m(migration, object)
order by 1, 2;

-- 3. which 034 revision the view definitions match (d3d9e85 / 1ac2f75 / b0c7f37 / 1edf314 = frozen)
select c.relname as view_name,
  (select count(*) from regexp_matches(pg_get_viewdef(c.oid), 'as materialized', 'gi'))::int as materialized_ctes,
  (select count(*) from regexp_matches(pg_get_viewdef(c.oid), 'v_downstream_organizational_realization', 'g'))::int as realization_refs
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  and c.relname in ('v_dodgers_international_value_portfolio', 'v_downstream_organizational_realization', 'v_player_control_intervals',
    'v_transaction_asset_lineage', 'v_transaction_package_lineage', 'v_transaction_research_queue', 'v_value_research_queue')
order by 1;

-- 4. row counts of every table 034 or 035 writes (NULL when the table does not exist; never an error)
select t.table_name,
  case when to_regclass('public.' || t.table_name) is null then null
       else (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.table_name), false, true, '')))[1]::text::int
  end as row_count
from (values ('outcome_audits'), ('outcome_evidence'), ('outcomes'), ('player_mlb_team_season_war'), ('sources'),
  ('transaction_events'), ('transaction_event_assets'), ('transaction_asset_resolutions'), ('dodgers_control_observations'),
  ('bref_team_code_map'), ('transaction_asset_timing_observations')) as t(table_name)
order by 1;

-- 5. analysis as-of date (035 must not move it)
select max(audited_through_date)::text as analysis_as_of_date from public.outcome_audits;

-- 6. Supabase CLI migration history, if the project uses it (NULL when the table does not exist)
select to_regclass('supabase_migrations.schema_migrations') as cli_migration_table;

-- 7. API surface: public tables / views and anything granted beyond SELECT to anon / authenticated
select
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r')::int as public_tables,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v')::int as public_views,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity)::int as tables_without_rls,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v'
     and not coalesce(array_to_string(reloptions, ',') ~ 'security_invoker=(true|on)', false))::int as views_not_security_invoker;

rollback;
