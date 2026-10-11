-- One-hop trade realization: trade event -> outgoing package -> incoming player asset -> its Dodgers bWAR.
-- Attribution to a DISI player is permitted only when that player is the sole outgoing asset of the event.
create or replace view public.v_trade_realization_edges
with (security_invoker = true)
as
with ev as (
  select e.id as event_id, e.event_key, e.transaction_date, e.description,
    (select o2.franchise_key from public.organizations o2
      where o2.id = case when fo.franchise_key = 'DODGERS' then e.to_organization_id else e.from_organization_id end) as counterparty_franchise_key,
    count(a.id) filter (where a.asset_side = 'OUTGOING')::int as outgoing_asset_count,
    count(a.id) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null)::int as tracked_outgoing_count,
    array_agg(p.slug order by p.slug) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null) as tracked_outgoing_slugs,
    array_agg(a.player_id) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null) as tracked_outgoing_player_ids
  from public.transaction_events e
  left join public.organizations fo on fo.id = e.from_organization_id
  join public.transaction_event_assets a on a.event_id = e.id
  left join public.players p on p.id = a.player_id
  where e.transaction_type = 'TRADE'
  group by e.id, e.event_key, e.transaction_date, e.description, fo.franchise_key, e.to_organization_id, e.from_organization_id
)
select
  ev.event_key, ev.transaction_date, ev.description as event_description,
  ev.outgoing_asset_count, ev.tracked_outgoing_count, ev.tracked_outgoing_slugs, ev.tracked_outgoing_player_ids,
  (ev.outgoing_asset_count = 1 and ev.tracked_outgoing_count = 1) as individual_attribution_permitted,
  case when ev.outgoing_asset_count = 1 then 'SOLE_OUTGOING_ASSET' else 'SHARED_PACKAGE_RETURN' end as attribution_status,
  i.id as incoming_asset_id, i.asset_name as incoming_asset_name, i.bref_id as incoming_bref_id,
  case when i.bref_id is null then 'NO_BREF_IDENTITY' when coalesce(w.team_season_rows, 0) = 0 then 'NO_TEAM_SEASON_FACTS'
       when w.timing_resolved is not true then 'TIMING_UNRESOLVED' else 'LOADED' end as incoming_war_status,
  w.team_season_rows as incoming_team_season_rows,
  extract(year from ev.transaction_date)::int as acquisition_season,
  ev.counterparty_franchise_key,
  case when coalesce(w.team_season_rows, 0) > 0 then w.timing_status end as acquisition_timing_status,
  case when coalesce(w.team_season_rows, 0) > 0 then w.timing_resolved end as same_season_timing_resolved,
  case when coalesce(w.team_season_rows, 0) > 0 then w.pre_rows end as pre_acquisition_dodgers_stint_rows,
  case when coalesce(w.team_season_rows, 0) > 0 then coalesce(w.pre_war, 0) end as pre_acquisition_dodgers_bwar_excluded,
  case when coalesce(w.team_season_rows, 0) > 0 and w.timing_resolved then coalesce(w.post_war, 0) end as incoming_dodgers_bwar,
  case when coalesce(w.team_season_rows, 0) > 0 then coalesce(w.later_seasons_war, 0) end as dodgers_bwar_complete_seasons_after_acquisition,
  w.ambiguous_war as unresolved_same_season_dodgers_bwar,
  w.later_non_dodgers_rows as incoming_later_non_dodgers_team_seasons,
  exists (
    select 1 from public.transaction_event_assets x join public.transaction_events e2 on e2.id = x.event_id
    where x.asset_side = 'OUTGOING' and x.bref_id = i.bref_id and e2.transaction_date > ev.transaction_date
  ) as downstream_asset_chain_incomplete,
  m.dodgers_regular_season_war as legacy_return_dodgers_war,
  case when coalesce(w.team_season_rows, 0) > 0 and w.timing_resolved then round(coalesce(w.post_war, 0) - m.dodgers_regular_season_war, 2) end as derived_minus_legacy_war
from ev
join public.transaction_event_assets i on i.event_id = ev.event_id and i.asset_side = 'INCOMING' and i.asset_type = 'PLAYER'
left join lateral (
  with k as (
    select extract(year from ev.transaction_date)::int as y, extract(month from ev.transaction_date)::int as mo
  ),
  t as (
    select x.season, x.stint_ordinal, x.war, x.organization_id, o.franchise_key
    from public.player_mlb_team_season_war x
    left join public.organizations o on o.id = x.organization_id
    where x.bref_id = i.bref_id and x.record_status = 'ACTIVE' and x.war_system = 'BWAR'
  ),
  -- B-Ref stint order is chronological within a season. A same-season Dodgers stint is placed relative to the
  -- acquisition only through the counterparty's single stint that season: the trade is the move out of the counterparty,
  -- so the Dodgers stint that immediately follows it is the first post-acquisition stint. Otherwise the season is left
  -- unresolved, never counted whole and never zeroed.
  cp as (
    select count(distinct t.stint_ordinal)::int as cp_stints, max(t.stint_ordinal) as cp_ord
    from t cross join k where t.season = k.y and ev.counterparty_franchise_key is not null and t.franchise_key = ev.counterparty_franchise_key
  ),
  s as (
    select count(*) filter (where t.franchise_key = 'DODGERS')::int as d_rows,
      coalesce(bool_or(t.franchise_key = 'DODGERS' and t.stint_ordinal = cp.cp_ord + 1), false) as anchor
    from t cross join k cross join cp where t.season = k.y
  ),
  g as (
    select k.y, k.mo, coalesce(s.d_rows, 0) as d_rows, (coalesce(cp.cp_stints, 0) = 1 and coalesce(s.anchor, false)) as anchored, cp.cp_ord
    from k cross join cp left join s on true
  ),
  cls as (
    select t.*, g.mo,
      case when t.franchise_key is distinct from 'DODGERS' then null
           when t.season > g.y then 'POST'
           when t.season < g.y then 'PRE'
           when g.mo >= 11 then 'PRE'
           when g.mo <= 2 then 'POST'
           when g.anchored and t.stint_ordinal > g.cp_ord then 'POST'
           when g.anchored and t.stint_ordinal < g.cp_ord then 'PRE'
           else 'AMBIGUOUS' end as placement,
      (t.season > g.y) as later_season
    from t cross join g
  )
  select
    (select count(*) from t)::int as team_season_rows,
    case when g.mo >= 11 then 'OFFSEASON_AFTER_SEASON'
         when g.mo <= 2 then 'OFFSEASON_BEFORE_SEASON'
         when g.d_rows = 0 then 'NO_ACQUISITION_SEASON_DODGERS_STINT'
         when ev.counterparty_franchise_key is null then 'NO_COUNTERPARTY_ORGANIZATION'
         when g.anchored then 'RESOLVED_BY_COUNTERPARTY_STINT_ORDER'
         else 'UNRESOLVED_SAME_SEASON_STINT_ORDER' end as timing_status,
    (g.mo >= 11 or g.mo <= 2 or g.d_rows = 0 or g.anchored) as timing_resolved,
    (select sum(c.war) filter (where c.placement = 'POST') from cls c) as post_war,
    (select sum(c.war) filter (where c.later_season and c.franchise_key = 'DODGERS') from cls c) as later_seasons_war,
    (select count(*) filter (where c.placement = 'PRE') from cls c)::int as pre_rows,
    (select sum(c.war) filter (where c.placement = 'PRE') from cls c) as pre_war,
    (select sum(c.war) filter (where c.placement = 'AMBIGUOUS') from cls c) as ambiguous_war,
    (select count(*) filter (where c.franchise_key is distinct from 'DODGERS' and c.organization_id is not null and c.season >= g.y) from t c)::int as later_non_dodgers_rows
  from g
) w on true
left join public.transaction_return_metrics m on m.event_id = ev.event_id and m.incoming_asset_name = i.asset_name;

comment on view public.v_trade_realization_edges is
  'One hop only: a modeled trade, its outgoing package and each incoming player asset with the bWAR it produced for the Dodgers after that specific acquisition. Dodgers stints before the acquisition are never credited: earlier seasons, the same season after it ended, and same-season stints ordered before the counterparty stint (B-Ref stint order is chronological) are excluded. A same-season Dodgers stint that cannot be ordered against the counterparty stint leaves the return NULL with acquisition_timing_status UNRESOLVED_SAME_SEASON_STINT_ORDER, never zero and never the whole season. A DISI player is individually attributable only as the sole outgoing asset; a shared package is exposed at package level and never split. downstream_asset_chain_incomplete is true only where a recorded later transaction sends the incoming asset away; descendants are never attributed. legacy_return_dodgers_war is the hand-entered transaction_return_metrics figure kept for comparison.';

-- One row per Dodgers international signing: acquisition cost and its completeness, direct and non-Dodgers MLB value
-- from team-season facts, one-hop trade return with attribution state, maturity and a single organizational status.
create or replace view public.v_player_organizational_realization
with (security_invoker = true)
as
with as_of as (
  select max(audited_through_date) as analysis_as_of_date from public.outcome_audits
),
ts as (
  select w.bref_id,
    count(*)::int as team_season_rows,
    count(*) filter (where w.organization_id is null)::int as unresolved_rows,
    count(*) filter (where w.war is null)::int as null_war_rows,
    sum(w.war) as team_season_career_bwar,
    count(*) filter (where o.franchise_key = 'DODGERS')::int as dodgers_rows,
    sum(w.war) filter (where o.franchise_key = 'DODGERS') as dodgers_war,
    count(*) filter (where o.franchise_key is distinct from 'DODGERS' and w.organization_id is not null)::int as non_dodgers_rows,
    sum(w.war) filter (where o.franchise_key is distinct from 'DODGERS' and w.organization_id is not null) as non_dodgers_war,
    min(w.season) as first_mlb_season,
    (array_agg(o.franchise_key order by w.season, w.stint_ordinal))[1] as first_mlb_franchise
  from public.player_mlb_team_season_war w
  left join public.organizations o on o.id = w.organization_id
  where w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
  group by w.bref_id
),
pkg as (
  select u.player_id,
    count(distinct u.event_key)::int as trade_events,
    bool_and(u.individual_attribution_permitted) as individual_permitted,
    bool_and(u.incoming_war_status = 'LOADED') as return_complete,
    case when bool_and(u.incoming_war_status = 'LOADED') then sum(u.incoming_dodgers_bwar) end as package_return_bwar,
    bool_or(u.downstream_asset_chain_incomplete) as downstream_flag
  from (select unnest(e.tracked_outgoing_player_ids) as player_id, e.* from public.v_trade_realization_edges e) u
  group by u.player_id
),
base as (
  select f.signing_id, f.player_id, f.player_slug, f.full_name, f.signing_year, f.signing_date, f.pathway, f.country_market,
    f.known_acquisition_cost_usd, f.acquisition_cost_completeness,
    pl.bref_id,
    a.reached_mlb_verified, a.outcome_state, a.audited_through_date,
    coalesce(wv.career_bwar, oc.career_war) as legacy_career_bwar,
    wv.career_bwar as metric_career_bwar, oc.career_war as outcomes_career_war, oc.current_status,
    ts.team_season_rows, ts.unresolved_rows, ts.null_war_rows, ts.team_season_career_bwar, ts.dodgers_rows, ts.dodgers_war, ts.non_dodgers_rows, ts.non_dodgers_war,
    ts.first_mlb_season, ts.first_mlb_franchise,
    pkg.trade_events, pkg.individual_permitted, pkg.return_complete, pkg.package_return_bwar, pkg.downstream_flag,
    as_of.analysis_as_of_date,
    case when f.signing_date is not null then f.signing_date <= (as_of.analysis_as_of_date - interval '5 years')::date
         else f.signing_year <= extract(year from as_of.analysis_as_of_date)::int - 5 end as is_mature
  from public.v_signing_acquisition_financials f
  join public.players pl on pl.id = f.player_id
  cross join as_of
  left join public.outcome_audits a on a.player_id = f.player_id
  left join public.outcomes oc on oc.player_id = f.player_id
  left join public.v_player_war wv on wv.player_id = f.player_id
  left join ts on ts.bref_id = pl.bref_id
  left join pkg on pkg.player_id = f.player_id
  where f.is_dodgers
),
state as (
  select b.*,
    case
      when b.reached_mlb_verified is true and coalesce(b.team_season_rows, 0) > 0 and b.unresolved_rows = 0
           and b.legacy_career_bwar is not null and abs(b.team_season_career_bwar - b.legacy_career_bwar) <= 0.1 then 'LOADED_RECONCILED'
      when b.reached_mlb_verified is true and coalesce(b.team_season_rows, 0) > 0 then 'LOADED_NEEDS_REVIEW'
      when b.reached_mlb_verified is true then 'MISSING'
      when b.outcome_state = 'NO_MLB_CAREER_ENDED' then 'NOT_APPLICABLE_NO_MLB'
      else 'NOT_APPLICABLE_OUTCOME_OPEN'
    end as team_history_status
  from base b
),
vals as (
  select s.*,
    case when s.team_history_status = 'LOADED_RECONCILED' then coalesce(s.dodgers_war, 0)
         when s.team_history_status = 'NOT_APPLICABLE_NO_MLB' then 0 end as direct_dodgers_mlb_bwar,
    case when s.team_history_status = 'LOADED_RECONCILED' then coalesce(s.non_dodgers_war, 0)
         when s.team_history_status = 'NOT_APPLICABLE_NO_MLB' then 0 end as non_dodgers_mlb_bwar,
    case when s.trade_events is null then 'NO_MODELED_TRADE_EVENT'
         when not s.individual_permitted then 'SHARED_PACKAGE_NOT_ATTRIBUTABLE'
         when not s.return_complete then 'RETURN_WAR_UNKNOWN'
         else 'SOLE_OUTGOING_ATTRIBUTABLE' end as package_attribution_state
  from state s
),
calc as (
  select v.*,
    case when v.package_attribution_state = 'SOLE_OUTGOING_ATTRIBUTABLE' then v.package_return_bwar end as individually_attributable_trade_return_bwar
  from vals v
)
select
  c.signing_id, c.player_id, c.player_slug, c.full_name, c.bref_id,
  c.signing_year, c.signing_date, c.pathway, c.country_market,
  c.known_acquisition_cost_usd, c.acquisition_cost_completeness,
  c.analysis_as_of_date,
  case when c.is_mature then 'MATURE' else 'RECENT' end as maturity_status,
  case when c.signing_date is not null then 'SIGNING_DATE_PLUS_5_YEARS' else 'SIGNING_YEAR_PLUS_5_YEARS' end as maturity_basis,
  c.outcome_state, c.reached_mlb_verified, c.current_status, c.team_history_status,
  c.first_mlb_season, c.first_mlb_franchise,
  c.legacy_career_bwar as career_bwar,
  c.team_season_career_bwar,
  c.direct_dodgers_mlb_bwar,
  c.non_dodgers_mlb_bwar,
  c.dodgers_rows as dodgers_mlb_team_seasons,
  c.non_dodgers_rows as non_dodgers_mlb_team_seasons,
  c.package_return_bwar as trade_package_return_dodgers_bwar,
  c.individually_attributable_trade_return_bwar,
  c.package_attribution_state,
  coalesce(c.downstream_flag, false) as downstream_asset_chain_incomplete,
  case when c.direct_dodgers_mlb_bwar is null then null
       when c.package_attribution_state = 'RETURN_WAR_UNKNOWN' then null
       else c.direct_dodgers_mlb_bwar + coalesce(c.individually_attributable_trade_return_bwar, 0) end as attributable_organizational_bwar,
  case when c.direct_dodgers_mlb_bwar is null then 'OUTCOME_NOT_OBSERVED'
       when c.package_attribution_state = 'SHARED_PACKAGE_NOT_ATTRIBUTABLE' then 'DIRECT_ONLY_SHARED_PACKAGE_RETURN_EXCLUDED'
       when c.package_attribution_state = 'RETURN_WAR_UNKNOWN' then 'RETURN_WAR_UNKNOWN'
       when c.package_attribution_state = 'SOLE_OUTGOING_ATTRIBUTABLE' then 'DIRECT_PLUS_SOLE_OUTGOING_RETURN'
       else 'DIRECT_ONLY' end as attributable_value_basis,
  case
    when c.reached_mlb_verified is true and c.team_history_status <> 'LOADED_RECONCILED' then 'OUTCOME_INCOMPLETE'
    when c.reached_mlb_verified is true and c.dodgers_rows > 0 then 'DIRECT_DODGERS_MLB_VALUE'
    when c.reached_mlb_verified is true then 'MLB_ELSEWHERE_ONLY'
    when c.outcome_state = 'NO_MLB_ACTIVE_IN_MINORS' then 'STILL_DEVELOPING'
    when c.outcome_state = 'NO_MLB_CAREER_ENDED' and c.is_mature then 'NO_MLB_VALUE_OBSERVED'
    when not c.is_mature then 'TOO_RECENT_TO_EVALUATE'
    else 'OUTCOME_INCOMPLETE'
  end as organizational_realization_status,
  (c.package_attribution_state = 'SOLE_OUTGOING_ATTRIBUTABLE' and c.individually_attributable_trade_return_bwar is not null) as flag_trade_return_attributable,
  (c.package_attribution_state = 'SHARED_PACKAGE_NOT_ATTRIBUTABLE') as flag_trade_return_package_only,
  (coalesce(c.non_dodgers_rows, 0) > 0) as flag_has_non_dodgers_mlb_value,
  (c.acquisition_cost_completeness = 'COMPLETE' and c.known_acquisition_cost_usd > 0 and c.direct_dodgers_mlb_bwar is not null and c.is_mature) as cost_metric_eligible,
  case when c.acquisition_cost_completeness <> 'COMPLETE' or c.known_acquisition_cost_usd is null or c.known_acquisition_cost_usd <= 0 then 'ACQUISITION_COST_' || c.acquisition_cost_completeness
       when c.direct_dodgers_mlb_bwar is null then 'OUTCOME_NOT_OBSERVED'
       when not c.is_mature then 'RECENT_SIGNING'
       end as ratio_suppression_reason,
  case when c.acquisition_cost_completeness = 'COMPLETE' and c.known_acquisition_cost_usd > 0 and c.direct_dodgers_mlb_bwar is not null and c.is_mature
       then round(c.direct_dodgers_mlb_bwar / (c.known_acquisition_cost_usd / 1000000.0), 3) end as direct_dodgers_bwar_per_million,
  case when c.acquisition_cost_completeness = 'COMPLETE' and c.known_acquisition_cost_usd > 0 and c.direct_dodgers_mlb_bwar is not null and c.is_mature
        and c.package_attribution_state <> 'RETURN_WAR_UNKNOWN'
       then round((c.direct_dodgers_mlb_bwar + coalesce(c.individually_attributable_trade_return_bwar, 0)) / (c.known_acquisition_cost_usd / 1000000.0), 3) end as attributable_organizational_bwar_per_million
from calc c;

comment on view public.v_player_organizational_realization is
  'One row per Dodgers international signing. direct_dodgers_mlb_bwar sums bWAR over MLB team-seasons of the Dodgers franchise (never career WAR, never the debut organization); non_dodgers_mlb_bwar is value produced for other organizations and is never credited to Los Angeles. Zero is used only where MLB team history is loaded and reconciled or the outcome is audited as no MLB career; otherwise NULL. A trade return is individually attributable only when the player was the sole outgoing asset; a shared package is exposed at package level and its individual share is NULL. Cost-aware ratios exist only for COMPLETE acquisition cost. maturity uses the existing 5-year rule against analysis_as_of_date (the latest outcome-audit date), not CURRENT_DATE.';

-- Tracked / verified-set aggregates, SUM(value) / SUM(cost) over the same eligible rows. Never an organization-wide rate.
create or replace view public.v_dodgers_international_value_portfolio
with (security_invoker = true)
as
with base as (
  select r.*,
    r.cost_metric_eligible as direct_ratio_eligible,
    (r.cost_metric_eligible and r.attributable_organizational_bwar is not null) as attributable_ratio_eligible
  from public.v_player_organizational_realization r
),
grains as (
  select 'ALL'::text as grain, 'All tracked Dodgers signings'::text as grain_value, 0 as sort_key, b.* from base b
  union all select 'SIGNING_YEAR', b.signing_year::text, b.signing_year, b.* from base b
  union all select 'SIGNING_ERA', case when b.signing_year < 2000 then 'Before 2000' when b.signing_year < 2012 then '2000-2011'
      when b.signing_year < 2018 then '2012-2017' else '2018 and later' end,
      case when b.signing_year < 2000 then 1 when b.signing_year < 2012 then 2 when b.signing_year < 2018 then 3 else 4 end, b.* from base b
  union all select 'MARKET', coalesce(b.country_market, 'Unknown'), 0, b.* from base b
  union all select 'PATHWAY', b.pathway, 0, b.* from base b
)
select
  g.grain, g.grain_value,
  count(*)::int as tracked_signings,
  count(*) filter (where g.maturity_status = 'MATURE')::int as mature_signings,
  count(*) filter (where g.direct_dodgers_mlb_bwar is not null)::int as outcome_observed_signings,
  count(*) filter (where g.reached_mlb_verified is true)::int as verified_mlb_reached,
  count(*) filter (where g.acquisition_cost_completeness = 'COMPLETE')::int as complete_cost_signings,
  count(*) filter (where g.direct_ratio_eligible)::int as direct_ratio_eligible_signings,
  count(*) filter (where g.attributable_ratio_eligible)::int as attributable_ratio_eligible_signings,
  sum(g.known_acquisition_cost_usd) filter (where g.direct_ratio_eligible) as eligible_known_acquisition_cost_usd,
  sum(g.direct_dodgers_mlb_bwar) filter (where g.direct_ratio_eligible) as eligible_direct_dodgers_bwar,
  round(sum(g.direct_dodgers_mlb_bwar) filter (where g.direct_ratio_eligible)
        / nullif(sum(g.known_acquisition_cost_usd) filter (where g.direct_ratio_eligible) / 1000000.0, 0), 3) as aggregate_direct_dodgers_bwar_per_million,
  sum(g.known_acquisition_cost_usd) filter (where g.attributable_ratio_eligible) as attributable_eligible_known_acquisition_cost_usd,
  sum(g.attributable_organizational_bwar) filter (where g.attributable_ratio_eligible) as eligible_attributable_organizational_bwar,
  round(sum(g.attributable_organizational_bwar) filter (where g.attributable_ratio_eligible)
        / nullif(sum(g.known_acquisition_cost_usd) filter (where g.attributable_ratio_eligible) / 1000000.0, 0), 3) as aggregate_attributable_organizational_bwar_per_million,
  (count(*) filter (where g.direct_ratio_eligible) < 5) as direct_ratio_small_sample,
  sum(g.individually_attributable_trade_return_bwar) as attributable_trade_return_bwar,
  sum(g.trade_package_return_dodgers_bwar) as package_return_dodgers_bwar,
  sum(g.non_dodgers_mlb_bwar) as non_dodgers_mlb_bwar_observed,
  'Tracked / verified-set analytic over the eligible rows named above; not an organization-wide rate. Eligible rows: mature, COMPLETE acquisition cost greater than zero, direct Dodgers bWAR observed.'::text as population_label
from grains g
group by g.grain, g.grain_value, g.sort_key;

comment on view public.v_dodgers_international_value_portfolio is
  'Aggregate value per $1M by grain (all, signing year, era, market, pathway) using SUM(value) / SUM(cost) over the same eligible rows: mature, COMPLETE acquisition cost, outcome observed. The eligible counts and cost are explicit. These are tracked / verified-set analytics, not organization-wide hit rates (no signing period is rate-eligible), and they differ from the legacy average-of-ratios KPI by design.';

-- Unresolved value research. Counts are derived, never fixed.
create or replace view public.v_value_research_queue
with (security_invoker = true)
as
with r as (select * from public.v_player_organizational_realization),
issues as (
  select 'TEAM_WAR_MISSING'::text as issue, 1 as priority, r.player_slug, r.signing_id, null::text as event_key,
    format('Verified MLB-reached %s signing (%s) has no loaded team-season bWAR facts', r.signing_year, r.pathway) as detail
  from r where r.team_history_status = 'MISSING'
  union all
  select 'TEAM_HISTORY_UNRESOLVED', 1, p.slug, null, null,
    format('%s %s team code %s has no organization mapping', w.season, w.component, w.bref_team_code)
  from public.player_mlb_team_season_war w left join public.players p on p.id = w.player_id
  where w.record_status = 'ACTIVE' and w.organization_id is null
  union all
  select 'CAREER_WAR_RECONCILIATION_REQUIRED', 1, r.player_slug, r.signing_id, null,
    format('Team-season total %s versus career bWAR %s', r.team_season_career_bwar, r.career_bwar)
  from r where r.team_history_status = 'LOADED_NEEDS_REVIEW'
  union all
  select 'CAREER_WAR_RECONCILIATION_REQUIRED', 2, r.player_slug, r.signing_id, null,
    format('Legacy career-WAR stores disagree: outcomes %s versus metric %s', r.outcomes_career_bwar, r.metric_career_bwar)
  from (select r2.player_slug, r2.signing_id, oc.career_war as outcomes_career_bwar, wv.career_bwar as metric_career_bwar
        from public.v_player_organizational_realization r2
        join public.outcomes oc on oc.player_id = r2.player_id left join public.v_player_war wv on wv.player_id = r2.player_id
        where (oc.career_war is null) <> (wv.career_bwar is null) or abs(coalesce(oc.career_war, 0) - coalesce(wv.career_bwar, 0)) > 0.1) r
  union all
  select 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED', 2, r.player_slug, r.signing_id, null,
    format('Traded in a shared outgoing package; the package returned %s Dodgers bWAR and no individual share is assigned', r.trade_package_return_dodgers_bwar)
  from r where r.package_attribution_state = 'SHARED_PACKAGE_NOT_ATTRIBUTABLE'
  union all
  select 'TRADE_RETURN_TIMING_UNRESOLVED', 2, null::text, null::uuid, e.event_key,
    format('Incoming %s has a same-season Dodgers stint that cannot be ordered against the %s stint; the trade return is not counted until the acquisition boundary is sourced', e.incoming_asset_name, coalesce(e.counterparty_franchise_key, 'counterparty'))
  from public.v_trade_realization_edges e where e.incoming_war_status = 'TIMING_UNRESOLVED'
  union all
  select 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE', 3, r.player_slug, r.signing_id, null,
    'A return asset later left in a recorded transaction; descendants are not attributed'
  from r where r.downstream_asset_chain_incomplete
  union all
  select 'ACQUISITION_COST_INCOMPLETE', 3, r.player_slug, r.signing_id, null,
    format('%s %s signing with a verified MLB outcome has %s acquisition cost; no cost-aware ratio is computed', r.signing_year, r.pathway, r.acquisition_cost_completeness)
  from r where r.reached_mlb_verified is true and r.acquisition_cost_completeness <> 'COMPLETE'
  union all
  select 'OUTCOME_INCOMPLETE', 2, r.player_slug, r.signing_id, null,
    format('%s signing: %s', r.signing_year, case when r.outcome_state is null then 'outcome never audited although the signing is mature'
                                                   when r.outcome_state = 'NO_MLB_STATUS_UNKNOWN' then 'outcome audited as status unknown' else r.organizational_realization_status end)
  from r where r.organizational_realization_status = 'OUTCOME_INCOMPLETE' and r.reached_mlb_verified is not true
  union all
  select 'TRADE_RECORD_MISSING', 3, r.player_slug, r.signing_id, null,
    format('First MLB season (%s) was with another organization and no exit transaction is recorded', r.first_mlb_season)
  from r
  where r.reached_mlb_verified is true and r.first_mlb_franchise is not null and r.first_mlb_franchise is distinct from 'DODGERS'
    and not exists (select 1 from public.transactions t where t.player_id = r.player_id)
    and not exists (select 1 from public.transaction_event_assets a where a.player_id = r.player_id)
)
select i.issue, i.priority, i.player_slug, i.signing_id, i.event_key, i.detail from issues i;

comment on view public.v_value_research_queue is
  'Unresolved value research, derived from the facts: missing team-season WAR, unmapped team codes, career-total reconciliation, shared-package attribution, downstream chains, incomplete acquisition cost for verified MLB outcomes, incomplete outcomes, and exits with no recorded transaction. Nothing is queued from unverified snippets.';
