-- DISI v0.1
-- 004_dodgers_analytics_views.sql
-- Dodgers-focused analytical views and executive-facing summary metrics.
-- Run after 001, 002, and 003.

-- ---------------------------------------------------------------------------
-- 1. DODGERS INTERNATIONAL SIGNING COHORT VIEW
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_signing_cohort
with (security_invoker = true)
as
select
  p.id as player_id,
  p.full_name,
  p.birth_date,
  p.birth_country,
  p.primary_position,
  s.signing_year,
  s.signing_date,
  s.country_market,
  s.pathway,
  s.source_league,
  s.source_club,
  s.professional_experience_years,
  s.signing_bonus_usd,
  s.bonus_publicly_reported,
  s.international_rank,
  se.regime as signing_regime,
  se.club_bonus_pool_usd,
  oc.reached_mlb,
  oc.mlb_debut_date,
  debut_org.abbreviation as mlb_debut_org,
  oc.career_war,
  oc.current_status,
  case
    when s.signing_date is not null
     and oc.mlb_debut_date is not null
    then round(((oc.mlb_debut_date - s.signing_date) / 365.2425)::numeric, 2)
    else null
  end as years_signing_to_mlb,
  case
    when s.signing_bonus_usd is not null
     and s.signing_bonus_usd > 0
     and oc.career_war is not null
    then round((oc.career_war / (s.signing_bonus_usd / 1000000.0))::numeric, 3)
    else null
  end as career_war_per_million_bonus
from public.players p
join public.signings s on s.player_id = p.id
join public.organizations org on org.id = s.organization_id
left join public.signing_environments se on se.id = s.signing_environment_id
left join public.outcomes oc on oc.player_id = p.id
left join public.organizations debut_org on debut_org.id = oc.mlb_debut_organization_id
where org.abbreviation = 'LAD';

grant select on public.v_dodgers_signing_cohort to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. SIGNING-YEAR PERFORMANCE VIEW
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_signing_year_summary
with (security_invoker = true)
as
select
  signing_year,
  signing_regime,
  count(*) as tracked_signings,
  count(*) filter (where signing_bonus_usd is not null) as signings_with_known_bonus,
  round(sum(signing_bonus_usd)::numeric, 2) as known_bonus_spend_usd,
  round(avg(signing_bonus_usd)::numeric, 2) as avg_known_bonus_usd,
  count(*) filter (where reached_mlb is true) as reached_mlb,
  round(
    (
      count(*) filter (where reached_mlb is true)::numeric
      / nullif(count(*), 0)
    ),
    4
  ) as observed_mlb_reach_rate,
  round(avg(years_signing_to_mlb) filter (where years_signing_to_mlb is not null), 2)
    as avg_years_to_mlb,
  round(sum(career_war) filter (where career_war is not null), 2)
    as observed_career_war
from public.v_dodgers_signing_cohort
group by signing_year, signing_regime
order by signing_year;

grant select on public.v_dodgers_signing_year_summary to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. MARKET / COUNTRY SUMMARY
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_market_summary
with (security_invoker = true)
as
select
  country_market,
  count(*) as tracked_signings,
  count(*) filter (where signing_bonus_usd is not null) as known_bonus_count,
  round(sum(signing_bonus_usd)::numeric, 2) as known_bonus_spend_usd,
  round(avg(signing_bonus_usd)::numeric, 2) as avg_known_bonus_usd,
  count(*) filter (where reached_mlb is true) as observed_mlb_players,
  round(
    count(*) filter (where reached_mlb is true)::numeric
    / nullif(count(*), 0),
    4
  ) as observed_mlb_reach_rate,
  round(sum(career_war) filter (where career_war is not null), 2)
    as observed_career_war,
  round(avg(years_signing_to_mlb) filter (where years_signing_to_mlb is not null), 2)
    as avg_years_to_mlb
from public.v_dodgers_signing_cohort
group by country_market
order by tracked_signings desc, country_market;

grant select on public.v_dodgers_market_summary to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. ACQUISITION PATHWAY SUMMARY
-- Important for separating teenage amateur markets from established-pro paths.
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_pathway_summary
with (security_invoker = true)
as
select
  pathway,
  count(*) as tracked_signings,
  round(sum(signing_bonus_usd)::numeric, 2) as known_bonus_spend_usd,
  count(*) filter (where reached_mlb is true) as observed_mlb_players,
  round(
    count(*) filter (where reached_mlb is true)::numeric
    / nullif(count(*), 0),
    4
  ) as observed_mlb_reach_rate,
  round(avg(years_signing_to_mlb) filter (where years_signing_to_mlb is not null), 2)
    as avg_years_to_mlb,
  round(sum(career_war) filter (where career_war is not null), 2)
    as observed_career_war
from public.v_dodgers_signing_cohort
group by pathway
order by tracked_signings desc;

grant select on public.v_dodgers_pathway_summary to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. TRAINER / ACADEMY NETWORK VIEW
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_trainer_network
with (security_invoker = true)
as
select
  t.id as trainer_id,
  t.name as trainer_name,
  t.academy_name,
  t.country as trainer_country,
  count(distinct p.id) as tracked_players,
  round(sum(s.signing_bonus_usd)::numeric, 2) as known_bonus_spend_usd,
  count(distinct p.id) filter (where oc.reached_mlb is true) as observed_mlb_players,
  round(sum(oc.career_war) filter (where oc.career_war is not null), 2)
    as observed_career_war
from public.trainers t
join public.player_trainers pt on pt.trainer_id = t.id
join public.players p on p.id = pt.player_id
join public.signings s on s.player_id = p.id
join public.organizations org on org.id = s.organization_id
left join public.outcomes oc on oc.player_id = p.id
where org.abbreviation = 'LAD'
group by t.id, t.name, t.academy_name, t.country
order by tracked_players desc, trainer_name;

grant select on public.v_dodgers_trainer_network to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. TALENT IDENTIFICATION VS. VALUE REALIZATION
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_asset_realization
with (security_invoker = true)
as
select
  v.player_id,
  v.full_name,
  v.signing_year,
  v.signing_bonus_usd,
  v.reached_mlb,
  v.mlb_debut_org,
  v.debuted_with_signing_org,
  v.career_war,
  v.years_signing_to_mlb,
  v.traded_before_mlb_debut,
  v.first_trade_date,
  v.first_trade_return,
  v.career_war_per_million_bonus,
  case
    when v.reached_mlb is true and v.debuted_with_signing_org is true
      then 'DIRECT_MLB_VALUE'
    when v.reached_mlb is true and v.traded_before_mlb_debut is true
      then 'IDENTIFIED_TALENT_TRADED_PRE_DEBUT'
    when v.reached_mlb is true
      then 'IDENTIFIED_MLB_TALENT_OTHER_PATH'
    when v.first_trade_date is not null
      then 'TRADED_BEFORE_MLB_OUTCOME'
    else 'NO_OBSERVED_MLB_OUTCOME_YET'
  end as value_realization_category
from public.v_signing_asset_outcomes v
where v.signing_org = 'LAD';

grant select on public.v_dodgers_asset_realization to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. EXECUTIVE KPI VIEW
-- IMPORTANT: This is descriptive of the TRACKED COHORT only.
-- It is not yet a club-wide estimate until historical coverage is complete.
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_executive_kpis
with (security_invoker = true)
as
select
  count(*) as tracked_signings,
  count(*) filter (where signing_bonus_usd is not null) as signings_with_known_bonus,
  round(sum(signing_bonus_usd)::numeric, 2) as known_bonus_spend_usd,

  count(*) filter (where reached_mlb is true) as observed_mlb_players,
  round(
    count(*) filter (where reached_mlb is true)::numeric
    / nullif(count(*), 0),
    4
  ) as observed_mlb_reach_rate,

  count(*) filter (
    where reached_mlb is true
      and mlb_debut_org = 'LAD'
  ) as observed_dodgers_debuts,

  count(*) filter (
    where reached_mlb is true
      and mlb_debut_org <> 'LAD'
  ) as observed_mlb_players_debuting_elsewhere,

  round(sum(career_war) filter (where career_war is not null), 2)
    as observed_total_career_war,

  round(avg(years_signing_to_mlb) filter (where years_signing_to_mlb is not null), 2)
    as avg_years_signing_to_mlb,

  round(
    avg(career_war_per_million_bonus)
      filter (where career_war_per_million_bonus is not null),
    3
  ) as avg_career_war_per_million_known_bonus

from public.v_dodgers_signing_cohort;

grant select on public.v_dodgers_executive_kpis to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. PLAYER LEADERBOARD VIEW
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_signing_leaderboard
with (security_invoker = true)
as
select
  c.*,
  case
    when c.career_war is null then null
    when c.career_war >= 20 then 'STAR_OUTCOME'
    when c.career_war >= 10 then 'HIGH_VALUE_OUTCOME'
    when c.career_war >= 5 then 'REGULAR_OR_BETTER'
    when c.career_war > 0 then 'MLB_CONTRIBUTOR'
    when c.reached_mlb is true then 'REACHED_MLB'
    else 'NO_OBSERVED_MLB_OUTCOME_YET'
  end as observed_outcome_band
from public.v_dodgers_signing_cohort c;

grant select on public.v_dodgers_signing_leaderboard to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. FIRST EXECUTIVE REPORT QUERY
-- ---------------------------------------------------------------------------

select * from public.v_dodgers_executive_kpis;

select
  full_name,
  signing_year,
  country_market,
  pathway,
  signing_bonus_usd,
  reached_mlb,
  mlb_debut_org,
  career_war,
  years_signing_to_mlb,
  career_war_per_million_bonus,
  observed_outcome_band
from public.v_dodgers_signing_leaderboard
where career_war is not null
order by career_war desc, signing_year;

select
  full_name,
  signing_year,
  reached_mlb,
  mlb_debut_org,
  career_war,
  value_realization_category,
  first_trade_return
from public.v_dodgers_asset_realization
where reached_mlb is true
order by career_war desc nulls last;
