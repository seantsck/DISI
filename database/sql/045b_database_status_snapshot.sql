-- DISI v0.36.1
-- 045b_database_status_snapshot.sql
-- Post-v1 home-page hardening: the home page no longer evaluates v_database_status on a request.
--
-- Why. v_database_status is one row of 25 scalar subqueries over a stack of views and tables (signing records, class coverage,
-- population coverage, research tasks) and repeats per-player work. A production audit after DISI v1.0.0 measured it as the slowest
-- remaining public read: under four concurrent full-page visitors it approached the 3 s statement timeout. Since 045a a page request must
-- never recompute an analytical graph; this is the last legacy read that did.
--
-- What. One typed snapshot table, product_database_status (generation id, generation metadata of the executive snapshot, and the 26
-- v_database_status columns), readable by anon / authenticated under RLS. The refresh and drift functions are re-issued with the eleventh
-- snapshot (written in the same transaction and generation as the other ten; validated against the executive snapshot). v_database_status
-- itself is unchanged and stays the source, but is closed to anon / authenticated. The product contract swaps the view for the snapshot.
-- No metric, research datum, threshold or prediction changes. The release status (schema v0.36.1, canonical through 045a) is not touched.
--
-- Built from database/research/045b/ (snapshots.mjs, build.mjs on top of ../045a/build.mjs).
--
-- Rerunnable: every statement is idempotent; the generation refresh runs only while the new snapshot is empty.

begin;

do $$
begin
  if to_regclass('public.product_executive_snapshot') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null
     or to_regclass('public.v_database_status') is null then
    raise exception '045b: Migration 045a (product snapshots) has not been applied';
  end if;
end $$;

-- ===========================================================================
-- 1. PRODUCT SNAPSHOT TABLE (derived read model; written only by the refresh)
-- ===========================================================================

-- product_database_status: one row: the database status shown on the home page (v_database_status), with the generation metadata of the executive snapshot
create table if not exists public.product_database_status as
select null::bigint as generation_id, x.* from (
  select e.generated_at, e.source_data_as_of_date, e.product_version, e.schema_version, s.*
    from public.v_database_status s cross join public.product_executive_snapshot e
) x
with no data;
alter table public.product_database_status alter column generation_id set not null;
alter table public.product_database_status enable row level security;
comment on table public.product_database_status is
  'DISI product snapshot (Migration 045b): one row: the database status shown on the home page (v_database_status), with the generation metadata of the executive snapshot. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Home-page database status: tracked signings, outcome audits, known cost, class coverage and open research tasks (persisted; refreshed explicitly).';
revoke all on table public.product_database_status from anon, authenticated;
grant select on table public.product_database_status to anon, authenticated;
drop policy if exists public_read_product_database_status on public.product_database_status;
create policy public_read_product_database_status on public.product_database_status for select to anon, authenticated using (true);

-- ===========================================================================
-- 2. REFRESH AND DRIFT (owner only): the 045a functions with the eleventh snapshot
-- ===========================================================================

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
  -- product_database_status
  v_t := clock_timestamp();
  execute 'delete from public.product_database_status';
  execute $q$
    insert into public.product_database_status
    select $1, x.* from (
      select e.generated_at, e.source_data_as_of_date, e.product_version, e.schema_version, s.*
        from public.v_database_status s cross join public.product_executive_snapshot e
    ) x
  $q$ using v_gen;
  get diagnostics v_n = row_count;
  snapshot := 'product_database_status'; row_count := v_n; elapsed_ms := (extract(epoch from clock_timestamp() - v_t) * 1000)::int;
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
      case when exists (select 1 from public.product_player_expected_value where expected_org_value_bwar is not null and not expected_value_supported) then 'expected value published for an unsupported row' end,
      case when (select count(*) from public.product_database_status) <> 1 then 'status snapshot is not one row' end,
      case when exists (select 1 from e join public.product_database_status s on s.tracked_signings is distinct from e.dodgers_signings) then 'status snapshot disagrees with the executive snapshot' end
    )
  $q$ into v_bad;
  if v_bad <> '' then
    raise exception 'product snapshot refresh refused (generation %): %', v_gen, v_bad;
  end if;
end
$fn$;

comment on function public.disi_refresh_product_snapshots() is
  'Rebuilds every DISI product snapshot (Migration 045b) as one new generation: one staged statement per snapshot, then support-chain validation derived from the snapshot itself; any violation raises and nothing changes. Run it explicitly in its own transaction after DISI research data changes - never from a page request. Owner only: no PUBLIC, anon or authenticated EXECUTE.';

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
  execute $q$
    with s as materialized (select to_jsonb(t) - array['generation_id', 'generated_at', 'source_data_as_of_date', 'product_version', 'schema_version']::text[] as j from public.product_database_status t),
    v as materialized (select to_jsonb(x) - array['generated_at', 'source_data_as_of_date', 'product_version', 'schema_version']::text[] as j from (
      select e.generated_at, e.source_data_as_of_date, e.product_version, e.schema_version, s.*
        from public.v_database_status s cross join public.product_executive_snapshot e
    ) x)
    select (select count(*) from (select j from v except all select j from s) a)::int, (select count(*) from (select j from s except all select j from v) b)::int
  $q$ into v_missing, v_extra;
  snapshot := 'product_database_status'; missing_rows := v_missing; extra_rows := v_extra;
  return next;
end
$fn$;

comment on function public.disi_product_snapshot_drift() is
  'For the verifier (Migration 045b): per product snapshot, the rows its analytical source would produce now that the snapshot lacks (missing_rows) and the snapshot rows it would not produce (extra_rows), ignoring generation metadata. Both 0 = the snapshot is current. Owner only.';

-- ===========================================================================
-- 3. PRODUCT CONTRACT: the home page reads the snapshot, not the view
-- ===========================================================================

delete from public.disi_product_contract where relation_name in ('v_database_status');
insert into public.disi_product_contract (relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in) values
  ('product_database_status', 'TABLE', 'EXECUTIVE', 'EXECUTIVE', array['/'], 'Home-page database status: tracked signings, outcome audits, known cost, class coverage and open research tasks (persisted; refreshed explicitly)', '045b')
on conflict (relation_name) do nothing;

-- ===========================================================================
-- 4. API FIREWALL: v_database_status is internal
-- ===========================================================================

do $$
declare v text;
begin
  foreach v in array array['v_database_status'] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
  end loop;
end $$;

-- ===========================================================================
-- 5. GENERATION (only while the new snapshot is empty; later generations come from the explicit refresh command)
-- ===========================================================================

do $$
begin
  if not exists (select 1 from public.product_database_status) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

-- ===========================================================================
-- 6. STRUCTURAL POSTCONDITIONS (no analytical view is evaluated here)
-- ===========================================================================

do $$
declare
  bad text;
begin
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '045b: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- the snapshot: RLS, readable by anon and authenticated, one row, the generation of the executive snapshot
  select string_agg(t.n, ', ') into bad
  from unnest(array['product_database_status']) t(n)
  left join pg_class c on c.relname = t.n and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  where c.oid is null or not c.relrowsecurity or not has_table_privilege('anon', c.oid, 'SELECT') or not has_table_privilege('authenticated', c.oid, 'SELECT');
  if bad is not null then
    raise exception '045b postcondition: snapshot missing, without RLS or not readable: %', bad;
  end if;
  if (select count(*) from public.product_database_status) <> 1
     or (select max(generation_id) from public.product_database_status) is distinct from (select max(generation_id) from public.product_executive_snapshot) then
    raise exception '045b postcondition: the status snapshot must be one row of the executive snapshot''s generation';
  end if;
  -- the source is closed to the API roles
  select string_agg(v.n, ', ') into bad
  from unnest(array['v_database_status']) v(n)
  where has_table_privilege('anon', 'public.' || v.n, 'SELECT') or has_table_privilege('authenticated', 'public.' || v.n, 'SELECT');
  if bad is not null then
    raise exception '045b postcondition: internal views still readable by an API role: %', bad;
  end if;
  -- the serving functions stay owner-only
  select string_agg(f.n, ', ') into bad
  from unnest(array['disi_refresh_product_snapshots', 'disi_product_snapshot_drift']) f(n)
  where to_regprocedure('public.' || f.n || '()') is null
     or has_function_privilege('public', ('public.' || f.n || '()')::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', ('public.' || f.n || '()')::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', ('public.' || f.n || '()')::regprocedure, 'EXECUTE');
  if bad is not null then
    raise exception '045b postcondition: functions missing or executable by an API role: %', bad;
  end if;
  -- the contract names only existing relations the API roles can read
  select string_agg(p.relation_name, ', ') into bad
  from public.disi_product_contract p
  left join pg_class c on c.relname = p.relation_name and c.relnamespace = 'public'::regnamespace
  where c.oid is null or (p.relation_kind = 'VIEW') <> (c.relkind = 'v') or not has_table_privilege('anon', c.oid, 'SELECT');
  if bad is not null then
    raise exception '045b postcondition: contract relations missing, of the wrong kind or not readable: %', bad;
  end if;
end $$;

commit;
