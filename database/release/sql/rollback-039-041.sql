-- DISI 039-041 bundle: logical rollback (WRITE; run only with explicit owner approval, after a failed post-release verification).
--
-- The bundle is derived only: it adds four reference tables (market_groups, international_signing_eras, outcome_targets,
-- outcome_model_evaluations - reviewed rows that exist nowhere else and are rebuilt by re-applying 039 / 041) and fifteen views, and
-- writes, redefines or re-grants nothing that existed before. Dropping those nineteen objects in reverse dependency order returns
-- the database to its exact 001-038a state (proven on PostgreSQL 17 by database/release/pg17/validate-039-041.mjs).
--
-- One transaction; guarded: it refuses to run while anything outside the bundle depends on a bundle object.

begin;

do $$
declare
  bad text;
  bundle text[] := array['market_groups', 'international_signing_eras', 'outcome_targets', 'outcome_model_evaluations',
    'v_signing_time_features', 'v_market_pathway_player_context', 'v_market_pathway_summary', 'v_market_research_queue',
    'v_player_historical_archetype', 'v_player_comparables', 'v_player_comparable_summary', 'v_archetype_outcome_summary', 'v_archetype_research_queue',
    'v_outcome_training_population', 'v_outcome_feature_matrix', 'v_outcome_target_support', 'v_outcome_model_evaluation',
    'v_player_outcome_probability', 'v_outcome_probability_research_queue'];
begin
  if to_regclass('public.v_network_player_outcomes') is null then
    raise exception 'rollback-039-041: 038 is not present; this is not a 039-041 database';
  end if;
  select string_agg(distinct dependent.relname, ', ') into bad
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class dependent on dependent.oid = rw.ev_class
  join pg_class referenced on referenced.oid = d.refobjid
  where referenced.relnamespace = 'public'::regnamespace and dependent.relnamespace = 'public'::regnamespace
    and dependent.oid <> referenced.oid and referenced.relname = any(bundle) and not (dependent.relname = any(bundle));
  if bad is not null then
    raise exception 'rollback-039-041: objects outside the bundle depend on it: %', bad;
  end if;
  -- foreign keys from outside the bundle into a bundle table
  select string_agg(distinct c.conrelid::regclass::text, ', ') into bad
  from pg_constraint c
  where c.contype = 'f' and c.confrelid::regclass::text in ('public.outcome_targets', 'outcome_targets', 'public.market_groups', 'market_groups',
      'public.international_signing_eras', 'international_signing_eras', 'public.outcome_model_evaluations', 'outcome_model_evaluations')
    and c.conrelid::regclass::text not in ('outcome_model_evaluations', 'public.outcome_model_evaluations');
  if bad is not null then
    raise exception 'rollback-039-041: tables outside the bundle reference it: %', bad;
  end if;
end $$;

-- 041
drop view if exists public.v_outcome_probability_research_queue;
drop view if exists public.v_player_outcome_probability;
drop view if exists public.v_outcome_model_evaluation;
drop view if exists public.v_outcome_target_support;
drop view if exists public.v_outcome_feature_matrix;
drop view if exists public.v_outcome_training_population;
drop table if exists public.outcome_model_evaluations;
drop table if exists public.outcome_targets;
-- 040
drop view if exists public.v_archetype_research_queue;
drop view if exists public.v_archetype_outcome_summary;
drop view if exists public.v_player_comparable_summary;
drop view if exists public.v_player_comparables;
drop view if exists public.v_player_historical_archetype;
-- 039
drop view if exists public.v_market_research_queue;
drop view if exists public.v_market_pathway_summary;
drop view if exists public.v_market_pathway_player_context;
drop view if exists public.v_signing_time_features;
drop table if exists public.international_signing_eras;
drop table if exists public.market_groups;

do $$
begin
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v') <> 125
     or (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 60 then
    raise exception 'rollback-039-041 postcondition: the public schema is not back to 60 tables / 125 views';
  end if;
end $$;

commit;
