-- DISI 042-045 bundle: logical rollback of the DATABASE part (WRITE; run only with explicit owner approval, after a failed post-release
-- verification).
--
-- The bundle (042, 043, 043a, 044, 045, 045a) is derived only: it adds three tables (expected_value_models, portfolio_scenario_definitions,
-- disi_product_contract - reviewed rows that exist nowhere else and are rebuilt by re-applying 042 / 043 / 045 - and no other), ten
-- product snapshot tables (045a: derived read models, rebuilt by its refresh), fifteen views, six staged read-only functions (043a: four,
-- 044: one, 045: one) and two serving functions (045a), and writes, redefines or re-grants nothing that existed before. Dropping those
-- thirty-six objects in reverse dependency order (each wrapper view before its function) returns the database
-- to its exact 001-041 state (proven on PostgreSQL 17 by database/release/pg17/validate-042-045.mjs). Every drop is "if exists", so it
-- also completes a partial release: on 2026-10-14 the previous version of this file (without the functions) rolled production back
-- from 042 + 043 to the exact 001-041 state after the interrupted first release attempt.
--
-- It cannot undo anything written after the release by other work, and it does not roll back the application: the 044 pages read
-- 042-045 views, so a database rollback must be paired with a revert of the application merge (or the pages report "Data unavailable").
--
-- One transaction; guarded: it refuses to run while anything outside the bundle depends on a bundle object.

begin;

do $$
declare
  bad text;
  bundle text[] := array['expected_value_models', 'portfolio_scenario_definitions', 'disi_product_contract',
    'v_player_realized_organizational_value', 'v_historical_org_value_distribution', 'v_expected_value_support',
    'v_player_expected_organizational_value', 'v_expected_value_research_queue',
    'v_portfolio_candidate_readiness', 'v_historical_portfolio_summary', 'v_portfolio_scenario_evaluation', 'v_portfolio_decision_support',
    'v_portfolio_research_queue', 'v_executive_overview', 'v_prediction_readiness',
    'v_disi_release_status', 'v_research_roadmap', 'v_executive_metric_provenance',
    'product_database_status', 'product_executive_snapshot', 'product_prediction_readiness', 'product_model_evaluations', 'product_expected_value_support', 'product_portfolio_decision_support', 'product_portfolio_history', 'product_portfolio_scenarios', 'product_player_decision', 'product_player_expected_value', 'product_player_comparables'];
begin
  if to_regclass('public.v_player_outcome_probability') is null then
    raise exception 'rollback-042-045: 041 is not present; this is not a 042-045 database';
  end if;
  select string_agg(distinct dependent.relname, ', ') into bad
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class dependent on dependent.oid = rw.ev_class
  join pg_class referenced on referenced.oid = d.refobjid
  where referenced.relnamespace = 'public'::regnamespace and dependent.relnamespace = 'public'::regnamespace
    and dependent.oid <> referenced.oid and referenced.relname = any(bundle) and not (dependent.relname = any(bundle));
  if bad is not null then
    raise exception 'rollback-042-045: objects outside the bundle depend on it: %', bad;
  end if;
  select string_agg(distinct c.conrelid::regclass::text, ', ') into bad
  from pg_constraint c
  join pg_class t on t.oid = c.confrelid
  join pg_class s on s.oid = c.conrelid
  where c.contype = 'f' and t.relnamespace = 'public'::regnamespace and t.relname = any(bundle) and not (s.relname = any(bundle));
  if bad is not null then
    raise exception 'rollback-042-045: tables outside the bundle reference it: %', bad;
  end if;
end $$;

-- 045b (the home-page status snapshot; v_database_status is public again in the 001-041 state)
drop table if exists public.product_database_status;
grant select on table public.v_database_status to anon, authenticated;
-- 045a (snapshot tables first: nothing depends on them; then the serving functions)
drop table if exists public.product_executive_snapshot;
drop table if exists public.product_prediction_readiness;
drop table if exists public.product_model_evaluations;
drop table if exists public.product_expected_value_support;
drop table if exists public.product_portfolio_decision_support;
drop table if exists public.product_portfolio_history;
drop table if exists public.product_portfolio_scenarios;
drop table if exists public.product_player_decision;
drop table if exists public.product_player_expected_value;
drop table if exists public.product_player_comparables;
drop function if exists public.disi_refresh_product_snapshots();
drop function if exists public.disi_product_snapshot_drift();
-- 045
drop view if exists public.v_executive_metric_provenance;
drop view if exists public.v_research_roadmap;
drop view if exists public.v_disi_release_status;
drop function if exists public.disi_research_roadmap();
drop table if exists public.disi_product_contract;
-- 044
drop view if exists public.v_prediction_readiness;
drop view if exists public.v_executive_overview;
drop function if exists public.disi_executive_overview();
-- 043
drop view if exists public.v_portfolio_research_queue;
drop view if exists public.v_portfolio_decision_support;
drop view if exists public.v_portfolio_scenario_evaluation;
drop view if exists public.v_historical_portfolio_summary;
drop view if exists public.v_portfolio_candidate_readiness;
drop table if exists public.portfolio_scenario_definitions;
-- 042
drop view if exists public.v_expected_value_research_queue;
drop view if exists public.v_player_expected_organizational_value;
drop view if exists public.v_expected_value_support;
drop view if exists public.v_historical_org_value_distribution;
drop view if exists public.v_player_realized_organizational_value;
-- 043a (its four functions are the bodies of 042 / 043 views dropped above)
drop function if exists public.disi_portfolio_candidate_readiness();
drop function if exists public.disi_expected_value_research_queue();
drop function if exists public.disi_player_expected_organizational_value();
drop function if exists public.disi_player_realized_organizational_value();
drop table if exists public.expected_value_models;

do $$
begin
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v') <> 140
     or (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 64
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                and proname in ('disi_player_realized_organizational_value', 'disi_player_expected_organizational_value', 'disi_expected_value_research_queue',
                                'disi_portfolio_candidate_readiness', 'disi_executive_overview', 'disi_research_roadmap',
                                'disi_refresh_product_snapshots', 'disi_product_snapshot_drift')) then
    raise exception 'rollback-042-045 postcondition: the public schema is not back to 64 tables / 140 views without the staged functions';
  end if;
end $$;

commit;
