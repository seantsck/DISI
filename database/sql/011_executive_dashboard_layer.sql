-- DISI v0.1
-- 011_executive_dashboard_layer.sql
-- Executive-facing analytical layer for the tracked mature Dodgers
-- international-signing sample.
-- Run after 010.
--
-- Design principle:
-- Keep observation, interpretation, and uncertainty visible. This is a
-- portfolio / decision-support layer, not a black-box ranking model.

-- ===========================================================================
-- 1. EXECUTIVE CASE-STUDY VIEW
-- One row per verified MLB player in the mature tracked sample.
-- ===========================================================================

create or replace view public.v_dodgers_executive_case_studies
with (security_invoker=true)
as
select
  m.full_name,
  m.signing_year,
  m.signing_bonus_usd,
  m.bonus_tier,
  m.career_war as later_career_war,
  m.player_career_war_per_million_bonus as identification_war_per_million,

  a.realization_channel,
  a.pre_mlb_disposition_date,
  a.pre_mlb_disposition_type,
  a.return_description,

  c.incoming_asset_name,
  c.return_dodgers_regular_season_war,
  c.outgoing_asset_count,
  c.attribution_status,

  c.club_wins,
  c.club_losses,
  c.division_lead_games,
  c.regular_season_games_remaining,
  c.need_category,
  c.need_urgency,
  c.need_urgency_band,
  c.acquisition_horizon,
  c.strategic_context_label,
  c.acquisition_season_postseason_result,

  case
    when m.career_war >= 20 then 'ELITE_IDENTIFICATION'
    when m.career_war >= 5 then 'HIGH_VALUE_IDENTIFICATION'
    when m.career_war > 0 then 'MLB_VALUE_IDENTIFICATION'
    when m.reached_mlb_verified then 'MLB_REACH_IDENTIFICATION'
    else 'NO_VERIFIED_MLB_DEBUT'
  end as identification_signal,

  case
    when a.realization_channel='RELEASED_BEFORE_MLB_DEBUT'
      then 'TALENT_IDENTIFIED_BUT_NO_DIRECT_RETURN'
    when c.attribution_status='SOLE_OUTGOING_ASSET'
      and m.career_war >= 20
      and coalesce(c.return_dodgers_regular_season_war,0) < 5
      then 'LARGE_EX_POST_VALUE_GAP'
    when c.attribution_status='SHARED_PACKAGE_RETURN'
      and c.need_urgency >= 5
      then 'HIGH_LEVERAGE_PACKAGE_CONVERSION'
    when c.attribution_status='SHARED_PACKAGE_RETURN'
      and c.need_urgency = 3
      then 'POSTSEASON_OPTIMIZATION_CONVERSION'
    when c.attribution_status='SHARED_PACKAGE_RETURN'
      then 'PACKAGE_CONVERSION_REQUIRES_SHARED_ATTRIBUTION'
    else 'CONTEXT_DEPENDENT'
  end as conversion_signal,

  case
    when a.realization_channel='RELEASED_BEFORE_MLB_DEBUT'
      then 'No trade return was realized by Los Angeles; later MLB reach occurred after the player left the organization.'
    when c.attribution_status='SOLE_OUTGOING_ASSET'
      then 'The tracked international signing was the sole outgoing asset, so the observed return can be associated directly with this disposition, while still requiring context beyond WAR.'
    when c.attribution_status='SHARED_PACKAGE_RETURN'
      then 'The tracked international signing was one component of a multi-player package; the full incoming return must not be attributed to this player alone.'
    else 'Additional transaction context is required before assigning realized value.'
  end as attribution_caution

from public.v_dodgers_mature_player_analysis m
join public.v_dodgers_mature_asset_realization a
  on a.player_id=m.player_id
left join public.v_dodgers_competitive_asset_conversion c
  on c.disi_player=m.full_name
where m.reached_mlb_verified is true;

grant select on public.v_dodgers_executive_case_studies
to anon, authenticated;

-- ===========================================================================
-- 2. PORTFOLIO SIGNALS
-- One-row dashboard summary for the currently tracked mature sample.
-- ===========================================================================

create or replace view public.v_dodgers_portfolio_signals
with (security_invoker=true)
as
select
  -- Sample coverage
  (select count(*)
   from public.v_dodgers_mature_player_analysis)
    as mature_tracked_signings,

  (select count(*)
   from public.v_dodgers_mature_player_analysis
   where reached_mlb_verified is true)
    as verified_mlb_players,

  round(
    (
      select count(*) filter (where reached_mlb_verified is true)::numeric
      / nullif(count(*),0)
      from public.v_dodgers_mature_player_analysis
    ),
    4
  ) as mature_tracked_mlb_reach_rate,

  -- Capital
  (select round(sum(signing_bonus_usd)::numeric,2)
   from public.v_dodgers_mature_player_analysis)
    as mature_tracked_bonus_spend_usd,

  (select round(sum(signing_bonus_usd)::numeric,2)
   from public.v_dodgers_mature_player_analysis
   where premium_group='PREMIUM_$5M_PLUS')
    as premium_5m_plus_bonus_spend_usd,

  round(
    100.0 *
    (select sum(signing_bonus_usd)::numeric
     from public.v_dodgers_mature_player_analysis
     where premium_group='PREMIUM_$5M_PLUS')
    /
    nullif(
      (select sum(signing_bonus_usd)::numeric
       from public.v_dodgers_mature_player_analysis),
      0
    ),
    1
  ) as premium_5m_plus_share_of_bonus_spend_pct,

  -- Outcome concentration
  (select round(coalesce(sum(career_war),0)::numeric,2)
   from public.v_dodgers_mature_player_analysis)
    as observed_later_career_war,

  (select round(coalesce(sum(career_war),0)::numeric,2)
   from public.v_dodgers_mature_player_analysis
   where premium_group='PREMIUM_$5M_PLUS')
    as premium_5m_plus_observed_career_war,

  -- Asset realization
  (select count(*)
   from public.v_dodgers_mature_asset_realization
   where reached_mlb_verified is true
     and mlb_debut_org <> 'LAD')
    as verified_mlb_players_debuting_elsewhere,

  (select count(*)
   from public.v_dodgers_mature_asset_realization
   where reached_mlb_verified is true
     and realization_channel='TRADED_BEFORE_MLB_DEBUT')
    as traded_before_mlb_debut,

  (select count(*)
   from public.v_dodgers_mature_asset_realization
   where reached_mlb_verified is true
     and realization_channel='RELEASED_BEFORE_MLB_DEBUT')
    as released_before_mlb_debut,

  -- Return context
  (select count(*)
   from public.v_dodgers_competitive_asset_conversion)
    as tracked_trade_conversions,

  (select count(*)
   from public.v_dodgers_competitive_asset_conversion
   where attribution_status='SOLE_OUTGOING_ASSET')
    as sole_asset_trade_conversions,

  (select count(*)
   from public.v_dodgers_competitive_asset_conversion
   where attribution_status='SHARED_PACKAGE_RETURN')
    as shared_package_trade_conversions,

  (select round(sum(return_dodgers_regular_season_war)::numeric,2)
   from public.v_dodgers_competitive_asset_conversion)
    as observed_dodgers_regular_season_war_from_tracked_trade_returns;

grant select on public.v_dodgers_portfolio_signals
to anon, authenticated;

-- ===========================================================================
-- 3. EXECUTIVE FINDINGS
-- Human-readable, but still generated from transparent rules.
-- ===========================================================================

create or replace view public.v_dodgers_executive_findings_v2
with (security_invoker=true)
as
select
  1 as finding_order,
  'CAPITAL_ALLOCATION'::text as finding_category,
  'Premium bonus concentration did not translate into observed career WAR in the tracked mature sample.'::text as finding,
  concat(
    '$',
    to_char(premium_5m_plus_bonus_spend_usd, 'FM999,999,999'),
    ' of $',
    to_char(mature_tracked_bonus_spend_usd, 'FM999,999,999'),
    ' (',
    premium_5m_plus_share_of_bonus_spend_pct,
    '%) went to $5M+ signings, which produced ',
    premium_5m_plus_observed_career_war,
    ' observed career WAR.'
  ) as evidence,
  'Small, selectively tracked sample; descriptive rather than causal.'::text
    as analytical_caution
from public.v_dodgers_portfolio_signals

union all

select
  2,
  'TALENT_IDENTIFICATION',
  'The mature tracked sample contains MLB talent that was identified by Los Angeles but realized its MLB debut elsewhere.',
  concat(
    verified_mlb_players_debuting_elsewhere,
    ' of ',
    verified_mlb_players,
    ' verified MLB players debuted for another organization.'
  ),
  'Debuting elsewhere does not mean the asset failed; trade return and competitive context must be evaluated separately.'
from public.v_dodgers_portfolio_signals

union all

select
  3,
  'ASSET_CONVERSION',
  'Most MLB-reaching assets in the mature tracked sample were converted through trades rather than lost outright.',
  concat(
    traded_before_mlb_debut,
    ' were traded before MLB debut; ',
    released_before_mlb_debut,
    ' was released before MLB debut.'
  ),
  'Trade outcomes are package-dependent; shared-package returns cannot be assigned fully to one prospect.'
from public.v_dodgers_portfolio_signals

union all

select
  4,
  'COMPETITIVE_CONTEXT',
  'International prospect capital was used in materially different competitive situations.',
  'Fields added multi-year pitching depth in a 2016 division chase; Watson was an October-bullpen optimization move for a dominant 2017 club; Machado filled a critical star-shortstop vacancy in a tight 2018 division race.',
  'Competitive context explains why equal WAR does not imply equal organizational value.'
from public.v_dodgers_portfolio_signals;

grant select on public.v_dodgers_executive_findings_v2
to anon, authenticated;

-- ===========================================================================
-- 4. EXECUTIVE DASHBOARD FEED
-- Compact player-case table intended for a BI/dashboard frontend.
-- ===========================================================================

create or replace view public.v_dodgers_executive_dashboard_feed
with (security_invoker=true)
as
select
  full_name as player,
  signing_year,
  signing_bonus_usd,
  later_career_war,
  identification_war_per_million,
  realization_channel,
  incoming_asset_name as return_asset,
  return_dodgers_regular_season_war as return_lad_regular_season_war,
  strategic_context_label,
  need_urgency,
  acquisition_horizon,
  acquisition_season_postseason_result,
  attribution_status,
  identification_signal,
  conversion_signal,
  attribution_caution
from public.v_dodgers_executive_case_studies
order by later_career_war desc nulls last;

grant select on public.v_dodgers_executive_dashboard_feed
to anon, authenticated;

-- ===========================================================================
-- 5. VERIFICATION OUTPUTS
-- ===========================================================================

select *
from public.v_dodgers_portfolio_signals;

select
  finding_order,
  finding_category,
  finding,
  evidence,
  analytical_caution
from public.v_dodgers_executive_findings_v2
order by finding_order;

select *
from public.v_dodgers_executive_dashboard_feed;
