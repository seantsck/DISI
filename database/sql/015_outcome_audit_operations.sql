-- DISI v0.4
-- 015_outcome_audit_operations.sql
-- Turns the 181-player universe into an explicit research/audit work queue.
-- Run after 014.
--
-- No player is classified as a failure because an outcome is missing.
-- This layer only prioritizes research; it does not fabricate outcomes.

-- ===========================================================================
-- 1. AUDIT PRIORITY VIEW
-- ===========================================================================

create or replace view public.v_dodgers_outcome_audit_operations
with (security_invoker=true)
as
select
  u.player_id,
  u.full_name,
  u.primary_position,
  u.signing_year,
  u.signing_date,
  u.country_market,
  u.pathway,
  u.total_known_acquisition_cost_usd,
  u.record_scope,
  u.outcome_audited,
  u.reached_mlb_verified,
  u.mlb_debut_date,
  u.mlb_debut_org,
  u.career_war,

  case
    when u.outcome_audited then 'AUDITED'
    when u.signing_year <= extract(year from current_date)::int - 10 then 'MATURE_10_PLUS_YEARS'
    when u.signing_year <= extract(year from current_date)::int - 5 then 'MATURE_5_TO_9_YEARS'
    else 'RECENT_DEVELOPMENT_WINDOW'
  end as audit_bucket,

  case
    when u.outcome_audited then 0
    when u.signing_year <= extract(year from current_date)::int - 10 then 100
    when u.signing_year <= extract(year from current_date)::int - 5 then 70
    else 30
  end
  +
  case
    when u.total_known_acquisition_cost_usd >= 5000000 then 25
    when u.total_known_acquisition_cost_usd >= 1000000 then 15
    when u.total_known_acquisition_cost_usd >= 250000 then 8
    else 0
  end
  +
  case
    when u.record_scope='HISTORICAL_VERIFIED' then 10
    when u.record_scope='COMPLETE_CENSUS' then 5
    else 0
  end as audit_priority_score,

  case
    when u.outcome_audited then 'Outcome already audited'
    when u.signing_year <= extract(year from current_date)::int - 10
      then 'Long-mature player; outcome should be resolvable from MLB/minor-league historical records'
    when u.signing_year <= extract(year from current_date)::int - 5
      then 'Five-year-mature player; prioritize for MLB reach and disposition audit'
    else 'Recent player; development status may still be evolving'
  end as audit_reason

from public.v_dodgers_portfolio_universe u;

grant select on public.v_dodgers_outcome_audit_operations
to anon, authenticated;

-- ===========================================================================
-- 2. AUDIT PIPELINE SUMMARY
-- ===========================================================================

create or replace view public.v_dodgers_audit_pipeline_summary
with (security_invoker=true)
as
select
  count(*) as tracked_signings,
  count(*) filter (where outcome_audited) as audited,
  count(*) filter (where not outcome_audited) as unaudited,
  count(*) filter (
    where not outcome_audited
      and signing_year <= extract(year from current_date)::int - 10
  ) as unaudited_10_plus_years,
  count(*) filter (
    where not outcome_audited
      and signing_year between
          extract(year from current_date)::int - 9
          and extract(year from current_date)::int - 5
  ) as unaudited_5_to_9_years,
  count(*) filter (
    where not outcome_audited
      and signing_year > extract(year from current_date)::int - 5
  ) as unaudited_recent,
  count(*) filter (where reached_mlb_verified is true) as verified_mlb_reach,
  round(
    100.0 * count(*) filter (where outcome_audited)::numeric
    / nullif(count(*),0),
    1
  ) as audit_completion_pct
from public.v_dodgers_portfolio_universe;

grant select on public.v_dodgers_audit_pipeline_summary
to anon, authenticated;

-- ===========================================================================
-- 3. CLASS-LEVEL RESEARCH PROGRESS
-- ===========================================================================

create or replace view public.v_dodgers_class_research_progress
with (security_invoker=true)
as
select
  signing_year,
  count(*) as tracked_signings,
  count(*) filter (where outcome_audited) as audited_outcomes,
  count(*) filter (where reached_mlb_verified is true) as verified_mlb_players,
  count(*) filter (where not outcome_audited) as outcome_queue,
  round(
    100.0 * count(*) filter (where outcome_audited)::numeric
    / nullif(count(*),0),
    1
  ) as audit_completion_pct,
  round(sum(total_known_acquisition_cost_usd)::numeric,2)
    as known_acquisition_cost_usd
from public.v_dodgers_portfolio_universe
group by signing_year
order by signing_year;

grant select on public.v_dodgers_class_research_progress
to anon, authenticated;

-- ===========================================================================
-- 4. MARKET-LEVEL RESEARCH PROGRESS
-- ===========================================================================

create or replace view public.v_dodgers_market_research_progress
with (security_invoker=true)
as
select
  coalesce(country_market,'Unknown') as country_market,
  count(*) as tracked_signings,
  count(*) filter (where outcome_audited) as audited_outcomes,
  count(*) filter (where reached_mlb_verified is true) as verified_mlb_players,
  count(*) filter (where not outcome_audited) as outcome_queue,
  round(
    100.0 * count(*) filter (where outcome_audited)::numeric
    / nullif(count(*),0),
    1
  ) as audit_completion_pct,
  round(sum(total_known_acquisition_cost_usd)::numeric,2)
    as known_acquisition_cost_usd
from public.v_dodgers_portfolio_universe
group by coalesce(country_market,'Unknown')
order by tracked_signings desc, country_market;

grant select on public.v_dodgers_market_research_progress
to anon, authenticated;

-- ===========================================================================
-- 5. NEXT-AUDIT QUEUE
-- The view is deliberately transparent. It is a research queue, not a model.
-- ===========================================================================

create or replace view public.v_dodgers_next_outcome_audits
with (security_invoker=true)
as
select
  full_name,
  signing_year,
  country_market,
  primary_position,
  total_known_acquisition_cost_usd,
  record_scope,
  audit_bucket,
  audit_priority_score,
  audit_reason
from public.v_dodgers_outcome_audit_operations
where not outcome_audited
order by audit_priority_score desc,
         signing_year,
         total_known_acquisition_cost_usd desc nulls last,
         full_name;

grant select on public.v_dodgers_next_outcome_audits
to anon, authenticated;

-- ===========================================================================
-- 6. VERIFICATION
-- ===========================================================================

select * from public.v_dodgers_audit_pipeline_summary;

select *
from public.v_dodgers_next_outcome_audits
limit 40;

select *
from public.v_dodgers_class_research_progress
order by signing_year;
