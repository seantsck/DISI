-- DISI 036-038 bundle: logical rollback (WRITE; run only with explicit owner approval, after a failed post-release verification).
--
-- The bundle is derived only: it adds one reference table (scouting_expectation_bands, 15 reviewed rows that exist nowhere else and
-- are rebuilt by re-applying 036) and thirteen views, and writes, redefines or re-grants nothing that existed before. Removing those
-- fourteen objects in reverse dependency order returns the database to its exact 001-035 state (proven on PostgreSQL 17 by
-- database/release/pg17/validate-036-038.mjs and the rollback check in database/release/036-038-release-plan.md).
--
-- One transaction; guarded: it refuses to run unless exactly the bundle's objects depend on what it drops.

begin;

do $$
declare
  bad text;
begin
  if to_regclass('public.v_international_benchmark_player_outcomes') is null then
    raise exception 'rollback-036-038: 035 is not present; this is not a 036-038 database';
  end if;
  -- nothing outside the bundle may depend on a bundle object
  select string_agg(distinct dependent.relname, ', ') into bad
  from pg_depend d
  join pg_rewrite rw on rw.oid = d.objid
  join pg_class dependent on dependent.oid = rw.ev_class
  join pg_class referenced on referenced.oid = d.refobjid
  where referenced.relnamespace = 'public'::regnamespace and dependent.relnamespace = 'public'::regnamespace
    and dependent.oid <> referenced.oid
    and referenced.relname in ('scouting_expectation_bands', 'v_player_realized_outcome', 'v_scouting_expectation_observations',
      'v_player_expectation_vs_outcome', 'v_scouting_calibration_summary', 'v_scouting_expectation_research_queue',
      'v_player_development_season_path', 'v_player_development_pathway', 'v_development_pathway_summary', 'v_development_pathway_research_queue',
      'v_network_player_outcomes', 'v_network_outcome_summary', 'v_network_outcome_coverage', 'v_network_outcome_research_queue')
    and dependent.relname not in ('v_player_realized_outcome', 'v_scouting_expectation_observations',
      'v_player_expectation_vs_outcome', 'v_scouting_calibration_summary', 'v_scouting_expectation_research_queue',
      'v_player_development_season_path', 'v_player_development_pathway', 'v_development_pathway_summary', 'v_development_pathway_research_queue',
      'v_network_player_outcomes', 'v_network_outcome_summary', 'v_network_outcome_coverage', 'v_network_outcome_research_queue');
  if bad is not null then
    raise exception 'rollback-036-038: objects outside the bundle depend on it: %', bad;
  end if;
end $$;

-- 038
drop view if exists public.v_network_outcome_research_queue;
drop view if exists public.v_network_outcome_coverage;
drop view if exists public.v_network_outcome_summary;
drop view if exists public.v_network_player_outcomes;
-- 037
drop view if exists public.v_development_pathway_research_queue;
drop view if exists public.v_development_pathway_summary;
drop view if exists public.v_player_development_pathway;
drop view if exists public.v_player_development_season_path;
-- 036
drop view if exists public.v_scouting_expectation_research_queue;
drop view if exists public.v_scouting_calibration_summary;
drop view if exists public.v_player_expectation_vs_outcome;
drop view if exists public.v_scouting_expectation_observations;
drop view if exists public.v_player_realized_outcome;
drop table if exists public.scouting_expectation_bands;

do $$
begin
  if (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'v') <> 112
     or (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') <> 59 then
    raise exception 'rollback-036-038 postcondition: the public schema is not back to 59 tables / 112 views';
  end if;
end $$;

commit;
