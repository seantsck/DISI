-- DISI v0.1
-- 007_mature_bonus_efficiency_analysis.sql
-- First analytical layer for the fully audited tracked mature sample.
-- Run after 006.
--
-- WARNING:
-- This is a 17-player TRACKED SAMPLE, not a complete census of all Dodgers
-- international signings from 2015-2019. These outputs are descriptive and
-- hypothesis-generating, not causal estimates.

-- ---------------------------------------------------------------------------
-- 1. PLAYER-LEVEL MATURE SAMPLE
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_mature_player_analysis
with (security_invoker = true)
as
select
  c.player_id,
  c.full_name,
  c.signing_year,
  c.country_market,
  c.pathway,
  c.signing_bonus_usd,
  c.reached_mlb_verified,
  c.career_war,
  c.mlb_debut_org,
  case
    when c.signing_bonus_usd < 250000 then '<$250K'
    when c.signing_bonus_usd < 1000000 then '$250K-$999K'
    when c.signing_bonus_usd < 5000000 then '$1M-$4.999M'
    when c.signing_bonus_usd >= 5000000 then '$5M+'
    else 'UNKNOWN'
  end as bonus_tier,
  case
    when c.signing_bonus_usd >= 5000000 then 'PREMIUM_$5M_PLUS'
    when c.signing_bonus_usd is not null then 'SUB_$5M'
    else 'UNKNOWN'
  end as premium_group,
  case
    when c.reached_mlb_verified is true then 1 else 0
  end as mlb_hit,
  case
    when c.signing_bonus_usd is not null
      and c.signing_bonus_usd > 0
      and c.career_war is not null
    then round(
      (c.career_war / (c.signing_bonus_usd / 1000000.0))::numeric,
      3
    )
    else null
  end as player_career_war_per_million_bonus
from public.v_dodgers_outcome_coverage c
where c.mature_5yr_cohort is true
  and c.outcome_audited is true;

grant select on public.v_dodgers_mature_player_analysis to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. BONUS-TIER SUMMARY
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_mature_bonus_tiers
with (security_invoker = true)
as
select
  bonus_tier,
  count(*) as signings,
  round(sum(signing_bonus_usd)::numeric, 2) as bonus_spend_usd,
  count(*) filter (where reached_mlb_verified is true) as mlb_players,
  round(
    count(*) filter (where reached_mlb_verified is true)::numeric
    / nullif(count(*), 0),
    4
  ) as mlb_reach_rate,
  round(
    sum(signing_bonus_usd)::numeric
    / nullif(count(*) filter (where reached_mlb_verified is true), 0),
    2
  ) as bonus_spend_per_mlb_player_usd,
  round(sum(career_war) filter (where career_war is not null)::numeric, 2)
    as observed_career_war,
  round(
    sum(career_war) filter (where career_war is not null)::numeric
    / nullif(sum(signing_bonus_usd)::numeric / 1000000.0, 0),
    3
  ) as career_war_per_million_spent
from public.v_dodgers_mature_player_analysis
where bonus_tier <> 'UNKNOWN'
group by bonus_tier
order by
  case bonus_tier
    when '<$250K' then 1
    when '$250K-$999K' then 2
    when '$1M-$4.999M' then 3
    when '$5M+' then 4
    else 5
  end;

grant select on public.v_dodgers_mature_bonus_tiers to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. PREMIUM ($5M+) VS SUB-$5M COMPARISON
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_mature_premium_comparison
with (security_invoker = true)
as
select
  premium_group,
  count(*) as signings,
  round(sum(signing_bonus_usd)::numeric, 2) as bonus_spend_usd,
  round(
    100.0 * sum(signing_bonus_usd)::numeric
    / nullif(
        sum(sum(signing_bonus_usd)) over (),
        0
      ),
    2
  ) as share_of_tracked_bonus_spend_pct,
  count(*) filter (where reached_mlb_verified is true) as mlb_players,
  round(
    count(*) filter (where reached_mlb_verified is true)::numeric
    / nullif(count(*), 0),
    4
  ) as mlb_reach_rate,
  round(sum(career_war) filter (where career_war is not null)::numeric, 2)
    as observed_career_war,
  round(
    sum(career_war) filter (where career_war is not null)::numeric
    / nullif(sum(signing_bonus_usd)::numeric / 1000000.0, 0),
    3
  ) as career_war_per_million_spent
from public.v_dodgers_mature_player_analysis
where premium_group <> 'UNKNOWN'
group by premium_group
order by premium_group;

grant select on public.v_dodgers_mature_premium_comparison to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. SIGNING-YEAR SUMMARY FOR MATURE TRACKED SAMPLE
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_mature_year_analysis
with (security_invoker = true)
as
select
  signing_year,
  count(*) as signings,
  round(sum(signing_bonus_usd)::numeric, 2) as bonus_spend_usd,
  count(*) filter (where reached_mlb_verified is true) as mlb_players,
  round(
    count(*) filter (where reached_mlb_verified is true)::numeric
    / nullif(count(*), 0),
    4
  ) as mlb_reach_rate,
  round(sum(career_war) filter (where career_war is not null)::numeric, 2)
    as observed_career_war,
  round(
    sum(career_war) filter (where career_war is not null)::numeric
    / nullif(sum(signing_bonus_usd)::numeric / 1000000.0, 0),
    3
  ) as career_war_per_million_spent
from public.v_dodgers_mature_player_analysis
group by signing_year
order by signing_year;

grant select on public.v_dodgers_mature_year_analysis to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. EXECUTIVE FINDING VIEW
-- These labels deliberately describe the sample, not causal conclusions.
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_mature_executive_findings
with (security_invoker = true)
as
select
  (select count(*) from public.v_dodgers_mature_player_analysis)
    as mature_tracked_signings,

  (select round(sum(signing_bonus_usd)::numeric, 2)
   from public.v_dodgers_mature_player_analysis)
    as mature_tracked_bonus_spend_usd,

  (select count(*)
   from public.v_dodgers_mature_player_analysis
   where reached_mlb_verified is true)
    as verified_mlb_players,

  (select round(sum(career_war)::numeric, 2)
   from public.v_dodgers_mature_player_analysis
   where career_war is not null)
    as observed_career_war,

  (select round(sum(signing_bonus_usd)::numeric, 2)
   from public.v_dodgers_mature_player_analysis
   where premium_group = 'PREMIUM_$5M_PLUS')
    as premium_bonus_spend_usd,

  (select count(*)
   from public.v_dodgers_mature_player_analysis
   where premium_group = 'PREMIUM_$5M_PLUS')
    as premium_signings,

  (select count(*)
   from public.v_dodgers_mature_player_analysis
   where premium_group = 'PREMIUM_$5M_PLUS'
     and reached_mlb_verified is true)
    as premium_mlb_players,

  (select round(coalesce(sum(career_war),0)::numeric, 2)
   from public.v_dodgers_mature_player_analysis
   where premium_group = 'PREMIUM_$5M_PLUS')
    as premium_observed_career_war,

  (select round(sum(signing_bonus_usd)::numeric, 2)
   from public.v_dodgers_mature_player_analysis
   where premium_group = 'SUB_$5M')
    as sub_5m_bonus_spend_usd,

  (select count(*)
   from public.v_dodgers_mature_player_analysis
   where premium_group = 'SUB_$5M'
     and reached_mlb_verified is true)
    as sub_5m_mlb_players,

  (select round(coalesce(sum(career_war),0)::numeric, 2)
   from public.v_dodgers_mature_player_analysis
   where premium_group = 'SUB_$5M')
    as sub_5m_observed_career_war;

grant select on public.v_dodgers_mature_executive_findings to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. OUTPUTS
-- ---------------------------------------------------------------------------

select * from public.v_dodgers_mature_executive_findings;

select * from public.v_dodgers_mature_bonus_tiers;

select * from public.v_dodgers_mature_premium_comparison;

select * from public.v_dodgers_mature_year_analysis;

select
  full_name,
  signing_year,
  signing_bonus_usd,
  bonus_tier,
  reached_mlb_verified,
  mlb_debut_org,
  career_war,
  player_career_war_per_million_bonus
from public.v_dodgers_mature_player_analysis
order by signing_bonus_usd desc nulls last;
