-- DISI v0.36.1
-- 045a_product_snapshot_serving.sql
-- Post-045 serving-layer correction: the public product reads persisted, bounded snapshots instead of the 042-045 analytical graph.
--
-- Why. The second production release attempt (2026-10-14) showed that single reads of the staged 042-045 views were acceptable
-- (about 0.5-0.7 s for the executive layer) but that four simultaneous anonymous executive-overview reads stalled the 1 GB instance
-- and hit the 3 s statement timeout; the bundle was rolled back. A page request must never recompute the analytical graph.
--
-- What. Ten typed snapshot tables (product_*), each a column-exact projection of the analytical view it replaces plus generation
-- metadata, readable by anon / authenticated under RLS; disi_refresh_product_snapshots() rebuilds them as one validated generation,
-- one staged statement per snapshot, in the caller's transaction (readers keep the previous committed generation until it commits);
-- disi_product_snapshot_drift() lets the verifier prove the snapshots equal their sources. The snapshots are a derived product cache:
-- canonical facts stay in the DISI tables, and the 042-045 analytical layer stays the only computation. The product contract now
-- names what the application reads; the 042-045 analytical views and the staged functions are closed to anon and authenticated
-- (owner / privileged refresh only). The release status reports schema v0.36.1 and canonical file 045a. Nothing earlier is written.
--
-- Built from database/research/045a/ (snapshots.mjs, build.mjs; design in ../045/serving-layer-architecture.md).
--
-- Rerunnable: every statement is idempotent; the initial refresh runs only when no generation exists yet.

begin;

do $$
begin
  if to_regclass('public.disi_product_contract') is null or to_regclass('public.v_disi_release_status') is null
     or to_regprocedure('public.disi_research_roadmap()') is null or to_regprocedure('public.disi_portfolio_candidate_readiness()') is null then
    raise exception '045a: Migrations 042-045 (with 043a) have not been applied';
  end if;
end $$;

-- ===========================================================================
-- 1. PRODUCT SNAPSHOT TABLES (derived read models; written only by the refresh)
-- ===========================================================================

-- product_executive_snapshot: one row: the executive overview (044), the release status (045) and the generation metadata
create table if not exists public.product_executive_snapshot as
select null::bigint as generation_id, x.* from (
  select current_timestamp as generated_at, (current_timestamp at time zone 'UTC')::date as snapshot_as_of_date,
      rs.analysis_as_of_date as source_data_as_of_date, rs.latest_development_data_date as source_development_data_as_of_date,
      rs.product_version, rs.schema_version, rs.support_chain_state, o.*,
      rs.canonical_through, rs.latest_outcome_audit_date, rs.model_evaluation_data_as_of, rs.probability_model_version, rs.value_model_version,
      rs.decision_engine_version, rs.product_contract_relations, rs.product_statement
    from public.v_executive_overview o cross join public.v_disi_release_status rs
) x
with no data;
alter table public.product_executive_snapshot alter column generation_id set not null;
alter table public.product_executive_snapshot enable row level security;
comment on table public.product_executive_snapshot is
  'DISI product snapshot (Migration 045a): one row: the executive overview (044), the release status (045) and the generation metadata. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Executive summary, product / schema version, support-chain state and snapshot freshness (persisted; refreshed explicitly).';
revoke all on table public.product_executive_snapshot from anon, authenticated;
grant select on table public.product_executive_snapshot to anon, authenticated;
drop policy if exists public_read_product_executive_snapshot on public.product_executive_snapshot;
create policy public_read_product_executive_snapshot on public.product_executive_snapshot for select to anon, authenticated using (true);

-- product_prediction_readiness: one row per outcome target and reference population
create table if not exists public.product_prediction_readiness as
select null::bigint as generation_id, x.* from (
  select * from public.v_prediction_readiness
) x
with no data;
alter table public.product_prediction_readiness alter column generation_id set not null;
alter table public.product_prediction_readiness enable row level security;
comment on table public.product_prediction_readiness is
  'DISI product snapshot (Migration 045a): one row per outcome target and reference population. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Evidence, minimums and what is still needed per outcome target and reference population (persisted).';
revoke all on table public.product_prediction_readiness from anon, authenticated;
grant select on table public.product_prediction_readiness to anon, authenticated;
drop policy if exists public_read_product_prediction_readiness on public.product_prediction_readiness;
create policy public_read_product_prediction_readiness on public.product_prediction_readiness for select to anon, authenticated using (true);

-- product_model_evaluations: one row per recorded model evaluation
create table if not exists public.product_model_evaluations as
select null::bigint as generation_id, x.* from (
  select * from public.v_outcome_model_evaluation
) x
with no data;
alter table public.product_model_evaluations alter column generation_id set not null;
alter table public.product_model_evaluations enable row level security;
comment on table public.product_model_evaluations is
  'DISI product snapshot (Migration 045a): one row per recorded model evaluation. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Recorded out-of-time model evaluation with currency check (persisted).';
revoke all on table public.product_model_evaluations from anon, authenticated;
grant select on table public.product_model_evaluations to anon, authenticated;
drop policy if exists public_read_product_model_evaluations on public.product_model_evaluations;
create policy public_read_product_model_evaluations on public.product_model_evaluations for select to anon, authenticated using (true);

-- product_expected_value_support: one row per reviewed value model
create table if not exists public.product_expected_value_support as
select null::bigint as generation_id, x.* from (
  select * from public.v_expected_value_support
) x
with no data;
alter table public.product_expected_value_support alter column generation_id set not null;
alter table public.product_expected_value_support enable row level security;
comment on table public.product_expected_value_support is
  'DISI product snapshot (Migration 045a): one row per reviewed value model. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Expected-value model support and blockers (persisted).';
revoke all on table public.product_expected_value_support from anon, authenticated;
grant select on table public.product_expected_value_support to anon, authenticated;
drop policy if exists public_read_product_expected_value_support on public.product_expected_value_support;
create policy public_read_product_expected_value_support on public.product_expected_value_support for select to anon, authenticated using (true);

-- product_portfolio_decision_support: one row per decision-support state
create table if not exists public.product_portfolio_decision_support as
select null::bigint as generation_id, x.* from (
  select * from public.v_portfolio_decision_support
) x
with no data;
alter table public.product_portfolio_decision_support alter column generation_id set not null;
alter table public.product_portfolio_decision_support enable row level security;
comment on table public.product_portfolio_decision_support is
  'DISI product snapshot (Migration 045a): one row per decision-support state. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Candidates per decision-support state with what DISI may and may not say (persisted).';
revoke all on table public.product_portfolio_decision_support from anon, authenticated;
grant select on table public.product_portfolio_decision_support to anon, authenticated;
drop policy if exists public_read_product_portfolio_decision_support on public.product_portfolio_decision_support;
create policy public_read_product_portfolio_decision_support on public.product_portfolio_decision_support for select to anon, authenticated using (true);

-- product_portfolio_history: one row per grain and grain value
create table if not exists public.product_portfolio_history as
select null::bigint as generation_id, x.* from (
  select * from public.v_historical_portfolio_summary
) x
with no data;
alter table public.product_portfolio_history alter column generation_id set not null;
alter table public.product_portfolio_history enable row level security;
comment on table public.product_portfolio_history is
  'DISI product snapshot (Migration 045a): one row per grain and grain value. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Retrospective capital allocation, concentration and realized value (persisted).';
revoke all on table public.product_portfolio_history from anon, authenticated;
grant select on table public.product_portfolio_history to anon, authenticated;
drop policy if exists public_read_product_portfolio_history on public.product_portfolio_history;
create policy public_read_product_portfolio_history on public.product_portfolio_history for select to anon, authenticated using (true);

-- product_portfolio_scenarios: one row per scenario and Dodgers signing year
create table if not exists public.product_portfolio_scenarios as
select null::bigint as generation_id, x.* from (
  select * from public.v_portfolio_scenario_evaluation
) x
with no data;
alter table public.product_portfolio_scenarios alter column generation_id set not null;
alter table public.product_portfolio_scenarios enable row level security;
comment on table public.product_portfolio_scenarios is
  'DISI product snapshot (Migration 045a): one row per scenario and Dodgers signing year. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Pool scenarios: budget feasibility and (when supported) value optimization (persisted).';
revoke all on table public.product_portfolio_scenarios from anon, authenticated;
grant select on table public.product_portfolio_scenarios to anon, authenticated;
drop policy if exists public_read_product_portfolio_scenarios on public.product_portfolio_scenarios;
create policy public_read_product_portfolio_scenarios on public.product_portfolio_scenarios for select to anon, authenticated using (true);

-- product_player_decision: one row per Dodgers signing: realized organizational value (042) and decision support at the signing date (043)
create table if not exists public.product_player_decision as
select null::bigint as generation_id, x.* from (
  select r.*, c.decision_as_of_date, c.decision_support_state, c.optimization_eligible, c.decision_blockers, c.decision_statement,
      c.expected_value_model_supported, c.historical_comparables, c.cost_complete as readiness_cost_complete,
      c.cost_coverage_state as readiness_cost_coverage_state, c.player_data_complete
    from public.v_player_realized_organizational_value r
    left join public.v_portfolio_candidate_readiness c on c.signing_id = r.signing_id
) x
with no data;
alter table public.product_player_decision alter column generation_id set not null;
alter table public.product_player_decision enable row level security;
comment on table public.product_player_decision is
  'DISI product snapshot (Migration 045a): one row per Dodgers signing: realized organizational value (042) and decision support at the signing date (043). A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Realized organizational value (components separate) and decision-support state per Dodgers signing (persisted).';
revoke all on table public.product_player_decision from anon, authenticated;
grant select on table public.product_player_decision to anon, authenticated;
drop policy if exists public_read_product_player_decision on public.product_player_decision;
create policy public_read_product_player_decision on public.product_player_decision for select to anon, authenticated using (true);
create index if not exists product_player_decision_player_id_idx on public.product_player_decision (player_id);

-- product_player_expected_value: one row per Dodgers signing and value model
create table if not exists public.product_player_expected_value as
select null::bigint as generation_id, x.* from (
  select * from public.v_player_expected_organizational_value
) x
with no data;
alter table public.product_player_expected_value alter column generation_id set not null;
alter table public.product_player_expected_value enable row level security;
comment on table public.product_player_expected_value is
  'DISI product snapshot (Migration 045a): one row per Dodgers signing and value model. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Expected organizational value state per Dodgers signing - NULL with its reason unless supported (persisted).';
revoke all on table public.product_player_expected_value from anon, authenticated;
grant select on table public.product_player_expected_value to anon, authenticated;
drop policy if exists public_read_product_player_expected_value on public.product_player_expected_value;
create policy public_read_product_player_expected_value on public.product_player_expected_value for select to anon, authenticated using (true);
create index if not exists product_player_expected_value_player_id_idx on public.product_player_expected_value (player_id);

-- product_player_comparables: one row per Dodgers target signing and comparable population class
create table if not exists public.product_player_comparables as
select null::bigint as generation_id, x.* from (
  select s.* from public.v_player_comparable_summary s
    where s.target_signing_id in (select signing_id from public.v_player_realized_organizational_value)
) x
with no data;
alter table public.product_player_comparables alter column generation_id set not null;
alter table public.product_player_comparables enable row level security;
comment on table public.product_player_comparables is
  'DISI product snapshot (Migration 045a): one row per Dodgers target signing and comparable population class. A derived, persisted read model of the 042-045 analytical layer - not a source of facts; rebuilt only by disi_refresh_product_snapshots(). Earlier comparable signings by population class for Dodgers signings (historical context; persisted).';
revoke all on table public.product_player_comparables from anon, authenticated;
grant select on table public.product_player_comparables to anon, authenticated;
drop policy if exists public_read_product_player_comparables on public.product_player_comparables;
create policy public_read_product_player_comparables on public.product_player_comparables for select to anon, authenticated using (true);
create index if not exists product_player_comparables_target_signing_id_idx on public.product_player_comparables (target_signing_id);

-- ===========================================================================
-- 2. REFRESH AND DRIFT (owner only)
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

-- ===========================================================================
-- 3. RELEASE STATUS: schema v0.36.1, canonical through 045a (same columns and rules as 045)
-- ===========================================================================

create or replace view public.v_disi_release_status
with (security_invoker = true)
as
-- the support counts are the executive overview's (044): the same definitions - 041 targets, 042 value models, and recommendations
-- counted only when some expected value is supported - computed once by its staged function instead of re-planning every layer here
with c as materialized (
  select o.probability_targets as targets, o.supported_probability_targets as supported_targets,
    o.expected_value_models as ev_models, o.supported_expected_value_models as supported_ev_models,
    o.predictive_portfolio_recommendations as recommendations
  from public.v_executive_overview o
)
select
  'DISI v1.0.0'::text as product_version,
  'v0.36.1'::text as schema_version,
  '045a_product_snapshot_serving.sql'::text as canonical_through,
  (select max(audited_through_date) from public.outcome_audits) as analysis_as_of_date,
  (select max(audited_through_date) from public.outcome_audits) as latest_outcome_audit_date,
  (select max(as_of_date) from public.player_season_stints) as latest_development_data_date,
  (select max(data_as_of_date) from public.outcome_model_evaluations) as model_evaluation_data_as_of,
  (select string_agg(distinct model_version, ', ') from public.outcome_model_evaluations) as probability_model_version,
  (select string_agg(value_model_version, ', ' order by value_model_key) from public.expected_value_models) as value_model_version,
  'portfolio-decision-v1'::text as decision_engine_version,
  c.targets as probability_targets, c.supported_targets as supported_probability_targets,
  c.ev_models as expected_value_models, c.supported_ev_models as supported_expected_value_models,
  c.recommendations as predictive_portfolio_recommendations,
  case
    when c.supported_targets = 0 then 'NO_PREDICTIVE_LAYER_SUPPORTED'
    when c.supported_ev_models = 0 then 'PROBABILITY_ONLY'
    when c.recommendations = 0 then 'EXPECTED_VALUE_SUPPORTED_NO_ELIGIBLE_CANDIDATE'
    else 'PREDICTIVE_DECISIONS_SUPPORTED'
  end as support_chain_state,
  (select count(*) from public.disi_product_contract)::int as product_contract_relations,
  'Provenance-first international signing intelligence and decision support. DISI publishes an estimate only when its evidence meets the documented support threshold.'::text as product_statement
from c;

comment on view public.v_disi_release_status is
  'DISI release status (Migration 045): one row with the product and schema version, data freshness (analysis as-of date, latest outcome audit, latest development data, model evaluation data date), the probability, value and decision-engine versions, and the support state of each predictive layer (041 targets, 042 expected-value models, 043 recommendations) summarized as support_chain_state.';

-- ===========================================================================
-- 4. PRODUCT CONTRACT: exactly what the application reads
-- ===========================================================================

delete from public.disi_product_contract where relation_name in ('v_player_realized_organizational_value', 'v_historical_org_value_distribution', 'v_expected_value_support', 'v_player_expected_organizational_value', 'v_expected_value_research_queue', 'v_portfolio_candidate_readiness', 'v_historical_portfolio_summary', 'v_portfolio_scenario_evaluation', 'v_portfolio_decision_support', 'v_portfolio_research_queue', 'v_executive_overview', 'v_prediction_readiness', 'v_disi_release_status', 'v_research_roadmap', 'v_outcome_model_evaluation', 'v_player_comparable_summary');
insert into public.disi_product_contract (relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in) values
  ('product_executive_snapshot', 'TABLE', 'EXECUTIVE', 'EXECUTIVE', array['/', '/prediction-readiness'], 'Executive summary, product / schema version, support-chain state and snapshot freshness (persisted; refreshed explicitly)', '045a'),
  ('product_prediction_readiness', 'TABLE', 'PREDICTION_READINESS', 'PAGE', array['/prediction-readiness'], 'Evidence, minimums and what is still needed per outcome target and reference population (persisted)', '045a'),
  ('product_model_evaluations', 'TABLE', 'PREDICTION_READINESS', 'PAGE', array['/prediction-readiness'], 'Recorded out-of-time model evaluation with currency check (persisted)', '045a'),
  ('product_expected_value_support', 'TABLE', 'ORGANIZATIONAL_VALUE', 'PAGE', array['/portfolio', '/prediction-readiness'], 'Expected-value model support and blockers (persisted)', '045a'),
  ('product_portfolio_decision_support', 'TABLE', 'PORTFOLIO', 'EXECUTIVE', array['/portfolio'], 'Candidates per decision-support state with what DISI may and may not say (persisted)', '045a'),
  ('product_portfolio_history', 'TABLE', 'PORTFOLIO', 'PAGE', array['/portfolio'], 'Retrospective capital allocation, concentration and realized value (persisted)', '045a'),
  ('product_portfolio_scenarios', 'TABLE', 'PORTFOLIO', 'PAGE', array['/portfolio'], 'Pool scenarios: budget feasibility and (when supported) value optimization (persisted)', '045a'),
  ('product_player_decision', 'TABLE', 'ORGANIZATIONAL_VALUE', 'DOSSIER', array['/players/[slug]'], 'Realized organizational value (components separate) and decision-support state per Dodgers signing (persisted)', '045a'),
  ('product_player_expected_value', 'TABLE', 'ORGANIZATIONAL_VALUE', 'DOSSIER', array['/players/[slug]'], 'Expected organizational value state per Dodgers signing - NULL with its reason unless supported (persisted)', '045a'),
  ('product_player_comparables', 'TABLE', 'COMPARABLES', 'DOSSIER', array['/players/[slug]'], 'Earlier comparable signings by population class for Dodgers signings (historical context; persisted)', '045a')
on conflict (relation_name) do nothing;

-- ===========================================================================
-- 5. API FIREWALL: the analytical layer is internal
-- ===========================================================================

do $$
declare v text;
begin
  foreach v in array array['v_player_realized_organizational_value', 'v_historical_org_value_distribution', 'v_expected_value_support', 'v_player_expected_organizational_value', 'v_expected_value_research_queue', 'v_portfolio_candidate_readiness', 'v_historical_portfolio_summary', 'v_portfolio_scenario_evaluation', 'v_portfolio_decision_support', 'v_portfolio_research_queue', 'v_executive_overview', 'v_prediction_readiness', 'v_disi_release_status', 'v_research_roadmap'] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['disi_player_realized_organizational_value', 'disi_player_expected_organizational_value', 'disi_expected_value_research_queue', 'disi_portfolio_candidate_readiness', 'disi_executive_overview', 'disi_research_roadmap', 'disi_refresh_product_snapshots', 'disi_product_snapshot_drift'] loop
    execute format('revoke all on function public.%I() from public, anon, authenticated', f);
  end loop;
end $$;

-- ===========================================================================
-- 6. FIRST GENERATION (only when none exists; later generations come from the explicit refresh command)
-- ===========================================================================

do $$
begin
  if not exists (select 1 from public.product_executive_snapshot) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

-- ===========================================================================
-- 7. STRUCTURAL POSTCONDITIONS (no analytical view is evaluated here)
-- ===========================================================================

do $$
declare
  bad text;
begin
  -- relations: SELECT only for the API roles
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '045a: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- every snapshot: RLS, readable by anon and authenticated, one generation
  select string_agg(t.n, ', ') into bad
  from unnest(array['product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support', 'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables']) as t(n)
  left join pg_class c on c.relname = t.n and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  where c.oid is null or not c.relrowsecurity or not has_table_privilege('anon', c.oid, 'SELECT') or not has_table_privilege('authenticated', c.oid, 'SELECT');
  if bad is not null then
    raise exception '045a postcondition: snapshot missing, without RLS or not readable: %', bad;
  end if;
  if (select count(*) from public.product_executive_snapshot) <> 1 then
    raise exception '045a postcondition: the executive snapshot must hold exactly one generation row';
  end if;
  -- the analytical layer is closed: no API role reads an internal view or runs a staged / serving function
  select string_agg(v.n, ', ') into bad
  from unnest(array['v_player_realized_organizational_value', 'v_historical_org_value_distribution', 'v_expected_value_support', 'v_player_expected_organizational_value', 'v_expected_value_research_queue', 'v_portfolio_candidate_readiness', 'v_historical_portfolio_summary', 'v_portfolio_scenario_evaluation', 'v_portfolio_decision_support', 'v_portfolio_research_queue', 'v_executive_overview', 'v_prediction_readiness', 'v_disi_release_status', 'v_research_roadmap']) as v(n)
  where has_table_privilege('anon', 'public.' || v.n, 'SELECT') or has_table_privilege('authenticated', 'public.' || v.n, 'SELECT');
  if bad is not null then
    raise exception '045a postcondition: internal views still readable by an API role: %', bad;
  end if;
  select string_agg(f.n, ', ') into bad
  from unnest(array['disi_player_realized_organizational_value', 'disi_player_expected_organizational_value', 'disi_expected_value_research_queue', 'disi_portfolio_candidate_readiness', 'disi_executive_overview', 'disi_research_roadmap', 'disi_refresh_product_snapshots', 'disi_product_snapshot_drift']) as f(n)
  where to_regprocedure('public.' || f.n || '()') is null
     or has_function_privilege('public', ('public.' || f.n || '()')::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', ('public.' || f.n || '()')::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', ('public.' || f.n || '()')::regprocedure, 'EXECUTE');
  if bad is not null then
    raise exception '045a postcondition: functions missing or executable by an API role: %', bad;
  end if;
  -- the contract names only existing relations the API roles can read
  select string_agg(p.relation_name, ', ') into bad
  from public.disi_product_contract p
  left join pg_class c on c.relname = p.relation_name and c.relnamespace = 'public'::regnamespace
  where c.oid is null or (p.relation_kind = 'VIEW') <> (c.relkind = 'v') or not has_table_privilege('anon', c.oid, 'SELECT');
  if bad is not null then
    raise exception '045a postcondition: contract relations missing, of the wrong kind or not readable: %', bad;
  end if;
end $$;

commit;
