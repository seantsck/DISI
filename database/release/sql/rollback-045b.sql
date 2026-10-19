-- DISI 045b: logical rollback of the DATABASE part back to the exact 045a state (WRITE; run only with explicit owner approval, after a
-- failed post-release verification of 045b).
--
-- 045b adds one derived table (product_database_status), re-issues the two serving functions with the eleventh snapshot, swaps one
-- product-contract row and closes v_database_status to the API roles; it changes nothing else. This file reverses exactly that:
-- the table is dropped (a derived read model, rebuilt by the refresh), the 045a bodies of disi_refresh_product_snapshots() /
-- disi_product_snapshot_drift() are restored, the contract row for v_database_status is restored (the snapshot row removed) and SELECT on
-- v_database_status is granted again to anon and authenticated. It cannot undo anything written after the release by other work, and it
-- does not roll back the application: the home page reads product_database_status, so a database rollback must be paired with a revert
-- of the application merge (or the home page reports "Data unavailable" for the status block).
--
-- One transaction; guarded: it refuses to run unless 045b is present and nothing outside it depends on the snapshot.

begin;

do $$
declare
  bad text;
begin
  if to_regclass('public.product_database_status') is null then
    raise exception 'rollback-045b: product_database_status is not present; this is not a 045b database';
  end if;
  if to_regclass('public.product_executive_snapshot') is null or to_regclass('public.v_database_status') is null then
    raise exception 'rollback-045b: 045a is not present';
  end if;
  select string_agg(distinct dependent.relname, ', ') into bad
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class dependent on dependent.oid = rw.ev_class
  join pg_class referenced on referenced.oid = d.refobjid
  where referenced.relnamespace = 'public'::regnamespace and dependent.relnamespace = 'public'::regnamespace
    and dependent.oid <> referenced.oid and referenced.relname = 'product_database_status';
  if bad is not null then
    raise exception 'rollback-045b: views depend on the status snapshot: %', bad;
  end if;
end $$;

drop table if exists public.product_database_status;

create or replace function public.disi_refresh_product_snapshots()
returns table (snapshot text, row_count integer, elapsed_ms integer)
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_gen bigint;
  v_t timestamptz;
  v_n int;
  v_bad text;
begin
  -- one refresh at a time; EXCLUSIVE mode still lets readers (ACCESS SHARE) read the previous generation until this transaction commits
  lock table public.product_executive_snapshot in exclusive mode;
  select coalesce(max(generation_id), 0) + 1 into v_gen from public.product_executive_snapshot;
  -- each snapshot is its own statement: planned when it runs and released when it ends (the analytical views are staged since 043a)
  -- product_executive_snapshot
  v_t := clock_timestamp();
  execute 'delete from public.product_executive_snapshot';
  execute $q$
    insert into public.product_executive_snapshot
    select $1, x.* from (
      select current_timestamp as generated_at, (current_timestamp at time zone 'UTC')::date as snapshot_as_of_date,
          rs.analysis_as_of_date as source_data_as_of_date, rs.latest_development_data_date as source_development_data_as_of_date,
          rs.product_version, rs.schema_version, rs.support_chain_state, o.*,
          rs.canonical_through, rs.latest_outcome_audit_date, rs.model_evaluation_data_as_of, rs.probability_model_version, rs.value_model_version,
          rs.decision_engine_version, rs.product_contract_relations, rs.product_statement
        from public.v_executive_overview o cross join public.v_disi_release_status rs
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_executive_snapshot'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- product_prediction_readiness
  v_t := clock_timestamp();
  execute 'delete from public.product_prediction_readiness';
  execute $q$
    insert into public.product_prediction_readiness
    select $1, x.* from (
      select * from public.v_prediction_readiness
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_prediction_readiness'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- product_model_evaluations
  v_t := clock_timestamp();
  execute 'delete from public.product_model_evaluations';
  execute $q$
    insert into public.product_model_evaluations
    select $1, x.* from (
      select * from public.v_outcome_model_evaluation
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_model_evaluations'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- product_expected_value_support
  v_t := clock_timestamp();
  execute 'delete from public.product_expected_value_support';
  execute $q$
    insert into public.product_expected_value_support
    select $1, x.* from (
      select * from public.v_expected_value_support
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_expected_value_support'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- product_portfolio_decision_support
  v_t := clock_timestamp();
  execute 'delete from public.product_portfolio_decision_support';
  execute $q$
    insert into public.product_portfolio_decision_support
    select $1, x.* from (
      select * from public.v_portfolio_decision_support
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_portfolio_decision_support'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- product_portfolio_history
  v_t := clock_timestamp();
  execute 'delete from public.product_portfolio_history';
  execute $q$
    insert into public.product_portfolio_history
    select $1, x.* from (
      select * from public.v_historical_portfolio_summary
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_portfolio_history'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- product_portfolio_scenarios
  v_t := clock_timestamp();
  execute 'delete from public.product_portfolio_scenarios';
  execute $q$
    insert into public.product_portfolio_scenarios
    select $1, x.* from (
      select * from public.v_portfolio_scenario_evaluation
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_portfolio_scenarios'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- product_player_decision
  v_t := clock_timestamp();
  execute 'delete from public.product_player_decision';
  execute $q$
    insert into public.product_player_decision
    select $1, x.* from (
      select r.*, c.decision_as_of_date, c.decision_support_state, c.optimization_eligible, c.decision_blockers, c.decision_statement,
          c.expected_value_model_supported, c.historical_comparables, c.cost_complete as readiness_cost_complete,
          c.cost_coverage_state as readiness_cost_coverage_state, c.player_data_complete
        from public.v_player_realized_organizational_value r
        left join public.v_portfolio_candidate_readiness c on c.signing_id = r.signing_id
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_player_decision'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- product_player_expected_value
  v_t := clock_timestamp();
  execute 'delete from public.product_player_expected_value';
  execute $q$
    insert into public.product_player_expected_value
    select $1, x.* from (
      select * from public.v_player_expected_organizational_value
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_player_expected_value'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- product_player_comparables
  v_t := clock_timestamp();
  execute 'delete from public.product_player_comparables';
  execute $q$
    insert into public.product_player_comparables
    select $1, x.* from (
      select s.* from public.v_player_comparable_summary s
        where s.target_signing_id in (select signing_id from public.v_player_realized_organizational_value)
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_player_comparables'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
  return next;
  -- validate the new generation before it can commit; every rule is derived from the snapshot itself, none is a fixed answer
  execute $q$
    with e as (select * from public.product_executive_snapshot)
    select concat_ws('; ',
      case when (select count(*) from e) <> 1 then 'executive snapshot is not one row' end,
      case when exists (select 1 from e where e.dodgers_signings <> (select count(distinct signing_id) from public.product_player_decision)) then 'player snapshot does not cover every Dodgers signing' end,
      case when exists (select 1 from e where e.supported_probability_targets <> (select count(distinct target_key) from public.product_prediction_readiness where baseline_supported)) then 'supported targets disagree with prediction readiness' end,
      case when exists (select 1 from e where e.supported_expected_value_models <> (select count(*) from public.product_expected_value_support where expected_value_supported)) then 'supported value models disagree with expected-value support' end,
      case when exists (select 1 from e where e.supported_expected_values <> (select count(expected_org_value_bwar) from public.product_player_expected_value)) then 'supported expected values disagree with the player snapshot' end,
      case when exists (select 1 from e where e.predictive_portfolio_recommendations <> (select count(*) from public.product_player_decision where optimization_eligible)) then 'recommendations disagree with the player snapshot' end,
      case when exists (select 1 from e where (e.supported_probability_targets = 0) <> (e.support_chain_state = 'NO_PREDICTIVE_LAYER_SUPPORTED')) then 'support-chain state disagrees with probability support' end,
      case when exists (select 1 from e where e.supported_probability_targets = 0 and e.supported_expected_value_models > 0) then 'expected value supported without probability support' end,
      case when exists (select 1 from e where e.supported_expected_value_models = 0 and (e.supported_expected_values > 0 or e.predictive_portfolio_recommendations > 0)) then 'predictive outputs without a supported value model' end,
      case when exists (select 1 from public.product_portfolio_scenarios where optimized_selection is not null and optimization_eligible_candidates = 0) then 'optimized selection without eligible candidates' end,
      case when exists (select 1 from public.product_player_expected_value where expected_org_value_bwar is not null and not expected_value_supported) then 'expected value published for an unsupported row' end
    )
  $q$ into v_bad;
  if v_bad <> '' then
    raise exception 'product snapshot refresh refused (generation %): %', v_gen, v_bad;
  end if;
end
$fn$;

comment on function public.disi_refresh_product_snapshots() is
  'Rebuilds every DISI product snapshot (Migration 045a) as one new generation: one staged statement per snapshot, then support-chain validation derived from the snapshot itself; any violation raises and nothing changes. Run it explicitly in its own transaction after DISI research data changes - never from a page request. Owner only: no PUBLIC, anon or authenticated EXECUTE.';

create or replace function public.disi_product_snapshot_drift()
returns table (snapshot text, missing_rows integer, extra_rows integer)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_missing int;
  v_extra int;
begin
  -- each snapshot compared with a fresh evaluation of its analytical source, one statement at a time
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id', 'generated_at', 'snapshot_as_of_date']::text[] as j from public.product_executive_snapshot t),
    v as materialized (select to_jsonb(x) - array['generated_at', 'snapshot_as_of_date']::text[] as j from (
      select current_timestamp as generated_at, (current_timestamp at time zone 'UTC')::date as snapshot_as_of_date,
          rs.analysis_as_of_date as source_data_as_of_date, rs.latest_development_data_date as source_development_data_as_of_date,
          rs.product_version, rs.schema_version, rs.support_chain_state, o.*,
          rs.canonical_through, rs.latest_outcome_audit_date, rs.model_evaluation_data_as_of, rs.probability_model_version, rs.value_model_version,
          rs.decision_engine_version, rs.product_contract_relations, rs.product_statement
        from public.v_executive_overview o cross join public.v_disi_release_status rs
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_executive_snapshot'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id']::text[] as j from public.product_prediction_readiness t),
    v as materialized (select to_jsonb(x) - array['']::text[] as j from (
      select * from public.v_prediction_readiness
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_prediction_readiness'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id']::text[] as j from public.product_model_evaluations t),
    v as materialized (select to_jsonb(x) - array['']::text[] as j from (
      select * from public.v_outcome_model_evaluation
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_model_evaluations'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id']::text[] as j from public.product_expected_value_support t),
    v as materialized (select to_jsonb(x) - array['']::text[] as j from (
      select * from public.v_expected_value_support
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_expected_value_support'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id']::text[] as j from public.product_portfolio_decision_support t),
    v as materialized (select to_jsonb(x) - array['']::text[] as j from (
      select * from public.v_portfolio_decision_support
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_portfolio_decision_support'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id']::text[] as j from public.product_portfolio_history t),
    v as materialized (select to_jsonb(x) - array['']::text[] as j from (
      select * from public.v_historical_portfolio_summary
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_portfolio_history'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id']::text[] as j from public.product_portfolio_scenarios t),
    v as materialized (select to_jsonb(x) - array['']::text[] as j from (
      select * from public.v_portfolio_scenario_evaluation
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_portfolio_scenarios'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id']::text[] as j from public.product_player_decision t),
    v as materialized (select to_jsonb(x) - array['']::text[] as j from (
      select r.*, c.decision_as_of_date, c.decision_support_state, c.optimization_eligible, c.decision_blockers, c.decision_statement,
          c.expected_value_model_supported, c.historical_comparables, c.cost_complete as readiness_cost_complete,
          c.cost_coverage_state as readiness_cost_coverage_state, c.player_data_complete
        from public.v_player_realized_organizational_value r
        left join public.v_portfolio_candidate_readiness c on c.signing_id = r.signing_id
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_player_decision'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id']::text[] as j from public.product_player_expected_value t),
    v as materialized (select to_jsonb(x) - array['']::text[] as j from (
      select * from public.v_player_expected_organizational_value
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_player_expected_value'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id']::text[] as j from public.product_player_comparables t),
    v as materialized (select to_jsonb(x) - array['']::text[] as j from (
      select s.* from public.v_player_comparable_summary s
        where s.target_signing_id in (select signing_id from public.v_player_realized_organizational_value)
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_player_comparables'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
end
$fn$;

comment on function public.disi_product_snapshot_drift() is
  'For the verifier (Migration 045a): per product snapshot, the rows its analytical source would produce now that the snapshot lacks (missing_rows) and the snapshot rows it would not produce (extra_rows), ignoring generation metadata. Both 0 = the snapshot is current. Owner only.';

delete from public.disi_product_contract where relation_name = 'product_database_status';
insert into public.disi_product_contract (relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in) values
  ('v_database_status', 'VIEW', 'COVERAGE', 'EXECUTIVE', array['/'], 'Database coverage summary', '017')
on conflict (relation_name) do nothing;

grant select on table public.v_database_status to anon, authenticated;

do $$
begin
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v') <> 155
     or (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 77
     or to_regclass('public.product_database_status') is not null
     or not has_table_privilege('anon', 'public.v_database_status', 'SELECT') or not has_table_privilege('authenticated', 'public.v_database_status', 'SELECT')
     or (select count(*) from public.disi_product_contract) <> 47 then
    raise exception 'rollback-045b postcondition: the public schema is not back to the 045a state (77 tables / 155 views, v_database_status readable, 47 contract relations)';
  end if;
end $$;

commit;
