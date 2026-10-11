-- One-hop trade realization: trade event -> outgoing package -> incoming player asset -> its Dodgers bWAR.
-- Rows exist only for trade events that contain at least one tracked (DISI player_id) outgoing asset. A trade with no
-- incoming PLAYER asset still has an explicit row (incoming_asset_id NULL) whose state says why there is no player return.
-- Attribution to a DISI player is permitted only when that player is the sole outgoing asset of the event.
create or replace view public.v_trade_realization_edges
with (security_invoker = true)
as
with ev as (
  select e.id as event_id, e.event_key, e.transaction_date, e.description, e.is_multi_team,
    case when fo.franchise_key = 'DODGERS' then e.to_organization_id else e.from_organization_id end as counterparty_org_id,
    count(a.id) filter (where a.asset_side = 'OUTGOING')::int as outgoing_asset_count,
    count(a.id) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null)::int as tracked_outgoing_count,
    array_agg(p.slug order by p.slug) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null) as tracked_outgoing_slugs,
    array_agg(a.player_id) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null) as tracked_outgoing_player_ids,
    count(a.id) filter (where a.asset_side = 'INCOMING')::int as incoming_asset_count,
    count(a.id) filter (where a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER')::int as incoming_player_count,
    count(a.id) filter (where a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER_TO_BE_NAMED' and r.id is null)::int as incoming_unresolved_ptbnl_count
  from public.transaction_events e
  left join public.organizations fo on fo.id = e.from_organization_id
  join public.transaction_event_assets a on a.event_id = e.id
  left join public.players p on p.id = a.player_id
  left join public.transaction_asset_resolutions r on r.placeholder_asset_id = a.id and r.record_status = 'ACTIVE'
  where e.transaction_type = 'TRADE'
  group by e.id, e.event_key, e.transaction_date, e.description, e.is_multi_team, fo.franchise_key, e.to_organization_id, e.from_organization_id
  having count(a.id) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null) > 0
),
pi as (
  select ev.*, i.id as incoming_asset_id, i.asset_name, i.bref_id, i.mlb_id, i.bref_register_id, i.player_id as incoming_player_id,
    (select o2.franchise_key from public.organizations o2 where o2.id = coalesce(i.counterparty_organization_id, ev.counterparty_org_id)) as counterparty_franchise_key
  from ev
  join public.transaction_event_assets i on i.event_id = ev.event_id and i.asset_side = 'INCOMING' and i.asset_type = 'PLAYER'
),
pr as (
  select
    pi.event_key, pi.transaction_date, pi.description as event_description,
    pi.outgoing_asset_count, pi.tracked_outgoing_count, pi.tracked_outgoing_slugs, pi.tracked_outgoing_player_ids,
    (pi.outgoing_asset_count = 1 and pi.tracked_outgoing_count = 1) as individual_attribution_permitted,
    case when pi.outgoing_asset_count = 1 then 'SOLE_OUTGOING_ASSET' else 'SHARED_PACKAGE_RETURN' end as attribution_status,
    pi.incoming_asset_id, pi.asset_name as incoming_asset_name, pi.bref_id as incoming_bref_id,
    case when coalesce(w.team_season_rows, 0) > 0 then (case when w.timing_resolved is not true then 'TIMING_UNRESOLVED' else 'LOADED' end)
         when nm.observed_through is not null then 'NO_MLB_APPEARANCE_OBSERVED'
         when pi.bref_id is null then 'NO_BREF_IDENTITY'
         else 'NO_TEAM_SEASON_FACTS' end as incoming_war_status,
    w.team_season_rows as incoming_team_season_rows,
    extract(year from pi.transaction_date)::int as acquisition_season,
    pi.counterparty_franchise_key,
    case when coalesce(w.team_season_rows, 0) > 0 then w.timing_status
         when nm.observed_through is not null then 'NOT_APPLICABLE_NO_MLB_APPEARANCE' end as acquisition_timing_status,
    case when coalesce(w.team_season_rows, 0) > 0 then w.timing_resolved when nm.observed_through is not null then true end as same_season_timing_resolved,
    case when coalesce(w.team_season_rows, 0) > 0 then w.pre_rows when nm.observed_through is not null then 0 end as pre_acquisition_dodgers_stint_rows,
    case when coalesce(w.team_season_rows, 0) > 0 then coalesce(w.pre_war, 0) when nm.observed_through is not null then 0 end as pre_acquisition_dodgers_bwar_excluded,
    case when coalesce(w.team_season_rows, 0) > 0 and w.timing_resolved then coalesce(w.post_war, 0)
         when coalesce(w.team_season_rows, 0) = 0 and nm.observed_through is not null then 0 end as incoming_dodgers_bwar,
    case when coalesce(w.team_season_rows, 0) > 0 then coalesce(w.later_seasons_war, 0) end as dodgers_bwar_complete_seasons_after_acquisition,
    w.ambiguous_war as unresolved_same_season_dodgers_bwar,
    w.later_non_dodgers_rows as incoming_later_non_dodgers_team_seasons,
    exists (
      select 1 from public.transaction_event_assets x join public.transaction_events e2 on e2.id = x.event_id
      where x.asset_side = 'OUTGOING' and x.id <> pi.incoming_asset_id and e2.transaction_date > pi.transaction_date
        and ((pi.bref_id is not null and x.bref_id = pi.bref_id) or (pi.mlb_id is not null and x.mlb_id = pi.mlb_id)
          or (pi.incoming_player_id is not null and x.player_id = pi.incoming_player_id)
          or (pi.bref_register_id is not null and x.bref_register_id = pi.bref_register_id))
    ) as downstream_asset_chain_incomplete,
    m.dodgers_regular_season_war as legacy_return_dodgers_war,
    case when coalesce(w.team_season_rows, 0) > 0 and w.timing_resolved then round(coalesce(w.post_war, 0) - m.dodgers_regular_season_war, 2) end as derived_minus_legacy_war,
    pi.mlb_id as incoming_mlb_id, pi.bref_register_id as incoming_bref_register_id,
    pi.is_multi_team, pi.incoming_asset_count, pi.incoming_unresolved_ptbnl_count,
    nm.observed_through as no_mlb_appearance_observed_through
  from pi
  left join lateral (
    with k as (
      select extract(year from pi.transaction_date)::int as y, extract(month from pi.transaction_date)::int as mo
    ),
    t as (
      select x.season, x.stint_ordinal, x.war, x.organization_id, o.franchise_key
      from public.player_mlb_team_season_war x
      left join public.organizations o on o.id = x.organization_id
      where x.bref_id = pi.bref_id and x.record_status = 'ACTIVE' and x.war_system = 'BWAR'
    ),
    -- B-Ref stint order is chronological within a season. A same-season Dodgers stint is placed relative to the
    -- acquisition only through the counterparty's single stint that season: the trade is the move out of the counterparty,
    -- so the Dodgers stint that immediately follows it is the first post-acquisition stint. The counterparty is the
    -- organization this asset itself came from (asset-level, which differs from the event's other team in a multi-team deal).
    -- Otherwise the season is left unresolved, never counted whole and never zeroed.
    cp as (
      select count(distinct t.stint_ordinal)::int as cp_stints, max(t.stint_ordinal) as cp_ord
      from t cross join k where t.season = k.y and pi.counterparty_franchise_key is not null and t.franchise_key = pi.counterparty_franchise_key
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
           when pi.counterparty_franchise_key is null then 'NO_COUNTERPARTY_ORGANIZATION'
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
  left join lateral (
    select o.observed_through_date as observed_through from public.dodgers_control_observations o
    where o.subject_asset_id = pi.incoming_asset_id and o.observation_type = 'NO_MLB_APPEARANCE_OBSERVED' and o.record_status = 'ACTIVE'
    order by o.observed_through_date desc limit 1
  ) nm on true
  left join public.transaction_return_metrics m on m.event_id = pi.event_id and m.incoming_asset_name = pi.asset_name
),
er as (
  -- events with no incoming PLAYER asset, or an unresolved incoming player to be named later: the return is not a loaded player
  select
    ev.event_key, ev.transaction_date, ev.description as event_description,
    ev.outgoing_asset_count, ev.tracked_outgoing_count, ev.tracked_outgoing_slugs, ev.tracked_outgoing_player_ids,
    (ev.outgoing_asset_count = 1 and ev.tracked_outgoing_count = 1) as individual_attribution_permitted,
    case when ev.outgoing_asset_count = 1 then 'SOLE_OUTGOING_ASSET' else 'SHARED_PACKAGE_RETURN' end as attribution_status,
    null::uuid as incoming_asset_id, null::text as incoming_asset_name, null::text as incoming_bref_id,
    case when ev.incoming_unresolved_ptbnl_count > 0 then 'PLAYER_RETURN_PENDING'
         when ev.incoming_asset_count = 0 then 'RETURN_UNRECORDED'
         else 'NO_PLAYER_RETURN' end as incoming_war_status,
    null::int as incoming_team_season_rows,
    extract(year from ev.transaction_date)::int as acquisition_season,
    (select o2.franchise_key from public.organizations o2 where o2.id = ev.counterparty_org_id) as counterparty_franchise_key,
    case when ev.incoming_unresolved_ptbnl_count = 0 and ev.incoming_asset_count > 0 then 'NOT_APPLICABLE_NO_PLAYER_RETURN' end as acquisition_timing_status,
    case when ev.incoming_unresolved_ptbnl_count = 0 and ev.incoming_asset_count > 0 then true end as same_season_timing_resolved,
    case when ev.incoming_unresolved_ptbnl_count = 0 and ev.incoming_asset_count > 0 then 0 end as pre_acquisition_dodgers_stint_rows,
    case when ev.incoming_unresolved_ptbnl_count = 0 and ev.incoming_asset_count > 0 then 0::numeric end as pre_acquisition_dodgers_bwar_excluded,
    case when ev.incoming_unresolved_ptbnl_count = 0 and ev.incoming_asset_count > 0 then 0::numeric end as incoming_dodgers_bwar,
    null::numeric as dodgers_bwar_complete_seasons_after_acquisition,
    null::numeric as unresolved_same_season_dodgers_bwar,
    null::int as incoming_later_non_dodgers_team_seasons,
    false as downstream_asset_chain_incomplete,
    null::numeric as legacy_return_dodgers_war,
    null::numeric as derived_minus_legacy_war,
    null::text as incoming_mlb_id, null::text as incoming_bref_register_id,
    ev.is_multi_team, ev.incoming_asset_count, ev.incoming_unresolved_ptbnl_count,
    null::date as no_mlb_appearance_observed_through
  from ev
  where ev.incoming_player_count = 0 or ev.incoming_unresolved_ptbnl_count > 0
)
select u.*,
  case u.incoming_war_status
    when 'LOADED' then 'LOADED'
    when 'NO_MLB_APPEARANCE_OBSERVED' then 'NO_MLB_APPEARANCE_OBSERVED'
    when 'TIMING_UNRESOLVED' then 'TIMING_UNRESOLVED'
    when 'NO_PLAYER_RETURN' then 'NO_PLAYER_RETURN'
    when 'PLAYER_RETURN_PENDING' then 'PLAYER_RETURN_PENDING'
    when 'RETURN_UNRECORDED' then 'RETURN_UNRECORDED'
    else 'RETURN_WAR_UNKNOWN' end as return_state
from (select * from pr union all select * from er) u;

comment on view public.v_trade_realization_edges is
  'One hop only: a modeled trade that sent at least one tracked DISI signing, its outgoing package and what came back. A row per incoming PLAYER asset carries the bWAR it produced for the Dodgers after that specific acquisition; a trade with no incoming PLAYER asset has one row with return_state NO_PLAYER_RETURN (the complete incoming package is verified to contain no player: player return 0, not a statement about total transaction value), PLAYER_RETURN_PENDING (a player to be named later is unresolved) or RETURN_UNRECORDED (no incoming consideration is recorded). NO_MLB_APPEARANCE_OBSERVED is a dated observation, valid as a zero only through no_mlb_appearance_observed_through. Dodgers stints before the acquisition are never credited; a same-season stint that cannot be ordered against the counterparty stint (the counterparty is the asset-level organization) leaves the return NULL with TIMING_UNRESOLVED. A DISI player is individually attributable only as the sole outgoing asset; a shared package is exposed at package level and never split. downstream_asset_chain_incomplete is true only where a recorded later transaction sends the incoming asset away; descendants are never attributed. legacy_return_dodgers_war is the hand-entered figure kept for comparison.';

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
    bool_and(u.return_state in ('LOADED', 'NO_MLB_APPEARANCE_OBSERVED', 'NO_PLAYER_RETURN')) as return_complete,
    case when bool_and(u.return_state in ('LOADED', 'NO_MLB_APPEARANCE_OBSERVED', 'NO_PLAYER_RETURN')) then sum(u.incoming_dodgers_bwar) end as package_return_bwar,
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

-- ===========================================================================
-- Migration 033 views: transaction completeness, chain readiness, exit summary, research queue
-- ===========================================================================

-- One row per canonical transaction event: what moved, who it moved with, and how complete the record is. No value is
-- calculated here.
create or replace view public.v_transaction_event_complete
with (security_invoker = true)
as
with asset_facts as (
  select a.event_id,
    count(*) filter (where a.asset_side = 'OUTGOING')::int as outgoing_asset_count,
    count(*) filter (where a.asset_side = 'INCOMING')::int as incoming_asset_count,
    count(*) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null)::int as tracked_outgoing_count,
    count(*) filter (where a.asset_type = 'PLAYER')::int as player_asset_count,
    count(*) filter (where a.asset_type <> 'PLAYER')::int as non_player_asset_count,
    count(*) filter (where a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER')::int as incoming_player_count,
    count(*) filter (where a.asset_type = 'PLAYER' and a.player_id is null and a.mlb_id is null and a.bref_id is null and a.bref_register_id is null)::int as player_assets_without_identity,
    count(*) filter (where a.asset_type = 'PLAYER_TO_BE_NAMED' and r.id is null)::int as unresolved_ptbnl_count,
    count(*) filter (where a.asset_type = 'FUTURE_CONSIDERATIONS' and r.id is null)::int as unresolved_future_considerations_count,
    count(*) filter (where a.asset_type = 'CASH' and a.cash_amount_usd is null)::int as cash_amount_unknown_count,
    count(*) filter (where a.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and a.pool_space_amount_usd is null)::int as pool_space_amount_unknown_count,
    count(*) filter (where a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER_TO_BE_NAMED' and r.id is null)::int as incoming_unresolved_ptbnl_count,
    string_agg(distinct co.abbreviation, ', ' order by co.abbreviation) as asset_counterparties
  from public.transaction_event_assets a
  left join public.organizations co on co.id = a.counterparty_organization_id
  left join public.transaction_asset_resolutions r on r.placeholder_asset_id = a.id and r.record_status = 'ACTIVE'
  group by a.event_id
)
select
  e.id as event_id, e.event_key, e.transaction_date, e.transaction_type, e.historical_label, e.is_multi_team,
  fo.abbreviation as from_organization, tobj.abbreviation as to_organization,
  case when fo.franchise_key = 'DODGERS' then fo.abbreviation else tobj.abbreviation end as dodgers_organization,
  coalesce(f.asset_counterparties, case when fo.franchise_key = 'DODGERS' then tobj.abbreviation else fo.abbreviation end) as counterparties,
  coalesce(f.outgoing_asset_count, 0) as outgoing_asset_count, coalesce(f.incoming_asset_count, 0) as incoming_asset_count,
  coalesce(f.tracked_outgoing_count, 0) as tracked_outgoing_count,
  coalesce(f.player_asset_count, 0) as player_asset_count, coalesce(f.non_player_asset_count, 0) as non_player_asset_count,
  case when e.transaction_type = 'TRADE' and coalesce(f.incoming_asset_count, 0) = 0 then 'RETURN_UNRECORDED'
       when coalesce(f.incoming_unresolved_ptbnl_count, 0) > 0 then 'RETURN_PENDING_PLACEHOLDER'
       when e.transaction_type = 'TRADE' and coalesce(f.incoming_player_count, 0) = 0 then 'NO_PLAYER_RETURN'
       else 'COMPLETE' end as package_completeness,
  case when coalesce(f.player_assets_without_identity, 0) = 0 then 'COMPLETE' else 'INCOMPLETE' end as identity_completeness,
  coalesce(f.player_assets_without_identity, 0) as player_assets_without_identity,
  coalesce(f.unresolved_ptbnl_count, 0) as unresolved_ptbnl_count,
  coalesce(f.unresolved_future_considerations_count, 0) as unresolved_future_considerations_count,
  (coalesce(f.unresolved_ptbnl_count, 0) + coalesce(f.unresolved_future_considerations_count, 0) > 0) as has_unresolved_placeholder,
  coalesce(f.cash_amount_unknown_count, 0) as cash_amount_unknown_count,
  coalesce(f.pool_space_amount_unknown_count, 0) as pool_space_amount_unknown_count,
  so.source_name, so.source_tier, so.url as source_url,
  exists (select 1 from public.transactions t join public.transaction_event_assets a on a.player_id = t.player_id and a.event_id = e.id and a.asset_side = 'OUTGOING'
          where t.transaction_date = e.transaction_date and t.transaction_type = e.transaction_type) as legacy_transaction_matches
from public.transaction_events e
left join public.organizations fo on fo.id = e.from_organization_id
left join public.organizations tobj on tobj.id = e.to_organization_id
left join public.sources so on so.id = e.source_id
left join asset_facts f on f.event_id = e.id;

comment on view public.v_transaction_event_complete is
  'One row per canonical transaction event with its Dodgers side, counterparties, asset counts, return-package completeness (COMPLETE, NO_PLAYER_RETURN, RETURN_PENDING_PLACEHOLDER, RETURN_UNRECORDED), identity completeness, unresolved placeholders, unknown cash / pool amounts and provenance. No transaction value is calculated.';

-- One row per incoming PLAYER asset of a trade that involved a tracked signing: acquisition, identity, WAR availability and
-- what is known about its later exit. It states readiness only; downstream organizational value is not calculated.
create or replace view public.v_transaction_asset_chain_readiness
with (security_invoker = true)
as
with inc as (
  select a.id as asset_id, a.asset_name, a.player_id, a.mlb_id, a.bref_id, a.bref_register_id, e.id as event_id, e.event_key, e.transaction_date,
    (a.player_id is not null or a.mlb_id is not null or a.bref_id is not null or a.bref_register_id is not null) as identity_resolved
  from public.transaction_event_assets a
  join public.transaction_events e on e.id = a.event_id and e.transaction_type = 'TRADE'
  where a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER'
    and exists (select 1 from public.transaction_event_assets t where t.event_id = e.id and t.player_id is not null)
)
select
  i.event_key as acquisition_event_key, i.transaction_date as acquisition_date,
  i.asset_id, i.asset_name, i.player_id, i.mlb_id, i.bref_id, i.bref_register_id, i.identity_resolved,
  coalesce(w.rows_total, 0) as team_season_rows,
  coalesce(w.dodgers_rows, 0) as dodgers_team_season_rows,
  (coalesce(w.dodgers_rows, 0) > 0) as dodgers_war_exists,
  x.event_key as later_exit_event_key, x.transaction_date as later_exit_date, x.transaction_type as later_exit_type,
  ob.observation_type as latest_observation_type, ob.observed_through_date as latest_observation_through,
  case
    when not i.identity_resolved then 'IDENTITY_UNRESOLVED'
    when x.event_key is not null then 'EXIT_EVENT_RECORDED'
    when ob.observation_type = 'DODGERS_CONTROL_OBSERVED' then 'STILL_WITH_DODGERS'
    when ob.observation_type = 'CAREER_ENDED_WITH_DODGERS' then 'CAREER_ENDED_WITH_DODGERS'
    when ob.observation_type = 'EXIT_MECHANISM_UNRECORDED' then 'HISTORY_INCOMPLETE'
    else 'EXIT_NOT_RESEARCHED' end as chain_readiness_status,
  (nm.observed_through_date is not null) as no_mlb_appearance_observed,
  nm.observed_through_date as no_mlb_appearance_observed_through
from inc i
left join lateral (
  select count(*)::int as rows_total,
    count(*) filter (where o.franchise_key = 'DODGERS')::int as dodgers_rows
  from public.player_mlb_team_season_war w left join public.organizations o on o.id = w.organization_id
  where w.bref_id = i.bref_id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
) w on i.bref_id is not null
left join lateral (
  select e2.event_key, e2.transaction_date, e2.transaction_type
  from public.transaction_event_assets x2 join public.transaction_events e2 on e2.id = x2.event_id
  where x2.asset_side = 'OUTGOING' and x2.id <> i.asset_id and e2.transaction_date > i.transaction_date
    and e2.transaction_type in ('TRADE', 'RELEASE', 'WAIVER', 'FREE_AGENCY', 'RULE5_SELECTION', 'EXPANSION_DRAFT', 'SALE')
    and ((i.bref_id is not null and x2.bref_id = i.bref_id) or (i.mlb_id is not null and x2.mlb_id = i.mlb_id)
      or (i.player_id is not null and x2.player_id = i.player_id) or (i.bref_register_id is not null and x2.bref_register_id = i.bref_register_id))
  order by e2.transaction_date, e2.event_key limit 1
) x on true
left join lateral (
  select o.observation_type, o.observed_through_date from public.dodgers_control_observations o
  where o.subject_asset_id = i.asset_id and o.record_status = 'ACTIVE' and o.observation_type <> 'NO_MLB_APPEARANCE_OBSERVED'
  order by o.observed_through_date desc, o.observation_type limit 1
) ob on true
left join lateral (
  select o.observed_through_date from public.dodgers_control_observations o
  where o.subject_asset_id = i.asset_id and o.record_status = 'ACTIVE' and o.observation_type = 'NO_MLB_APPEARANCE_OBSERVED'
  order by o.observed_through_date desc limit 1
) nm on true;

comment on view public.v_transaction_asset_chain_readiness is
  'One row per incoming PLAYER asset of a trade that involved a tracked Dodgers signing. chain_readiness_status states only what is known about the asset''s later exit (EXIT_EVENT_RECORDED, STILL_WITH_DODGERS, CAREER_ENDED_WITH_DODGERS, HISTORY_INCOMPLETE, EXIT_NOT_RESEARCHED, IDENTITY_UNRESOLVED). It is readiness for a later recursive analysis; no downstream organizational value is calculated or credited.';

-- One row per tracked Dodgers international signing: has Dodgers control ended, how, and how complete is the evidence.
create or replace view public.v_dodgers_international_exit_summary
with (security_invoker = true)
as
with sign as (
  select f.signing_id, f.player_id, f.player_slug, f.full_name, f.signing_year, f.signing_date, f.pathway, f.country_market
  from public.v_signing_acquisition_financials f where f.is_dodgers
),
exits as (
  select a.player_id, e.id as event_id, e.event_key, e.transaction_date, e.transaction_type, e.historical_label, e.description,
    row_number() over (partition by a.player_id order by e.transaction_date, e.event_key) as rn,
    count(*) over (partition by a.player_id) as exit_events
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_side = 'OUTGOING' and a.player_id is not null
    and e.transaction_type in ('TRADE', 'RELEASE', 'WAIVER', 'FREE_AGENCY', 'RULE5_SELECTION', 'EXPANSION_DRAFT', 'SALE')
),
first_exit as (select * from exits where rn = 1),
ec as (
  select e.id as event_id,
    count(*) filter (where a.asset_side = 'OUTGOING')::int as outgoing_asset_count,
    count(*) filter (where a.asset_side = 'INCOMING')::int as incoming_asset_count,
    count(*) filter (where a.asset_type in ('PLAYER_TO_BE_NAMED', 'FUTURE_CONSIDERATIONS') and r.id is null)::int as unresolved_placeholders,
    string_agg(distinct co.abbreviation, ', ' order by co.abbreviation) filter (where a.asset_side = 'OUTGOING') as outgoing_counterparties
  from public.transaction_events e
  join public.transaction_event_assets a on a.event_id = e.id
  left join public.organizations co on co.id = a.counterparty_organization_id
  left join public.transaction_asset_resolutions r on r.placeholder_asset_id = a.id and r.record_status = 'ACTIVE'
  group by e.id
)
select
  s.signing_id, s.player_id, s.player_slug, s.full_name, pl.mlb_id, s.signing_year, s.signing_date, s.pathway, s.country_market,
  case when fx.event_id is not null then 'LEFT_DODGERS_CONTROL'
       when ob.observation_type = 'DODGERS_CONTROL_OBSERVED' then 'STILL_DODGERS_CONTROLLED'
       when ob.observation_type = 'HISTORY_UNAVAILABLE' then 'HISTORY_UNAVAILABLE'
       else 'NO_EXIT_EVIDENCE' end as control_state,
  fx.event_key as first_exit_event_key, fx.transaction_date as first_exit_date, fx.transaction_type as first_exit_mechanism,
  fx.historical_label as first_exit_historical_label,
  case when fx.event_id is not null then ec.outgoing_counterparties end as first_exit_counterparties,
  coalesce(fx.exit_events, 0)::int as exit_event_count,
  (fx.transaction_type = 'TRADE' and ec.outgoing_asset_count > 1) as exit_in_shared_package,
  (fx.transaction_type = 'TRADE' and ec.incoming_asset_count > 0) as return_package_modeled,
  case when fx.event_id is not null then so.source_tier else ob.source_tier end as evidence_source_tier,
  case when fx.event_id is not null then 'VERIFIED' else ob.confidence::text end as evidence_confidence,
  ob.observed_through_date as observed_through_date,
  (fx.event_id is null and coalesce(ob.observation_type, '') <> 'DODGERS_CONTROL_OBSERVED') as unresolved_status,
  coalesce(ec.unresolved_placeholders, 0) > 0 as exit_event_has_unresolved_placeholder
from sign s
join public.players pl on pl.id = s.player_id
left join first_exit fx on fx.player_id = s.player_id
left join ec on ec.event_id = fx.event_id
left join public.transaction_events fe on fe.id = fx.event_id
left join public.sources so on so.id = fe.source_id
left join lateral (
  select o.observation_type, o.observed_through_date, o.confidence, src.source_tier
  from public.dodgers_control_observations o join public.sources src on src.id = o.source_id
  where o.subject_player_id = s.player_id and o.record_status = 'ACTIVE'
  order by o.observed_through_date desc limit 1
) ob on true;

comment on view public.v_dodgers_international_exit_summary is
  'One row per tracked Dodgers international signing. control_state is exactly one of LEFT_DODGERS_CONTROL (a recorded exit event; first exit shown), STILL_DODGERS_CONTROLLED (dated observation of continued Dodgers control, no exit), NO_EXIT_EVIDENCE (no sourced exit and no verification of continued control) and HISTORY_UNAVAILABLE (the log does not establish the history). Absence from recent seasons is never treated as an exit. A free-agency event is recorded only where Dodgers control actually ended.';

-- Transaction-data deficiencies, derived from the facts. Counts are never fixed.
create or replace view public.v_transaction_research_queue
with (security_invoker = true)
as
with issues as (
  select 'EXIT_TRANSACTION_MISSING'::text as issue, 1 as priority, s.player_slug, null::text as event_key, null::text as asset_name,
    'The transaction history is unavailable from the official log; no exit was inferred'::text as detail
  from public.v_dodgers_international_exit_summary s where s.control_state = 'HISTORY_UNAVAILABLE'
  union all
  select 'EXIT_STATUS_UNVERIFIED', 2, s.player_slug, null, null,
    'No sourced exit and no verification that Dodgers control continues; absence from recent seasons is not proof of an exit'
  from public.v_dodgers_international_exit_summary s where s.control_state = 'NO_EXIT_EVIDENCE'
  union all
  select 'PTBNL_UNRESOLVED', 2, null, e.event_key, a.asset_name,
    format('%s %s consideration is a player to be named later with no sourced resolution', a.asset_side, e.transaction_date)
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'PLAYER_TO_BE_NAMED'
    and not exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id and r.record_status = 'ACTIVE')
  union all
  select 'FUTURE_CONSIDERATIONS_UNRESOLVED', 3, null, e.event_key, a.asset_name,
    format('%s future considerations on %s are unspecified in the sources', a.asset_side, e.transaction_date)
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'FUTURE_CONSIDERATIONS'
    and not exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id and r.record_status = 'ACTIVE')
  union all
  select 'POOL_SPACE_AMOUNT_UNKNOWN', 3, null, e.event_key, a.asset_name,
    format('International bonus-pool space moved on %s with no sourced amount', e.transaction_date)
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and a.pool_space_amount_usd is null
  union all
  select 'CASH_AMOUNT_UNKNOWN', 3, null, e.event_key, a.asset_name,
    format('Cash moved on %s with no sourced amount', e.transaction_date)
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'CASH' and a.cash_amount_usd is null
  union all
  select 'EVENT_ASSET_IDENTITY_MISSING', 2, null, e.event_key, a.asset_name,
    'A PLAYER asset has no DISI player, MLB id, Baseball-Reference id or Register id'
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'PLAYER' and a.player_id is null and a.mlb_id is null and a.bref_id is null and a.bref_register_id is null
  union all
  select 'RETURN_ASSET_EXIT_MISSING', 3, null, c.acquisition_event_key, c.asset_name,
    format('Return asset acquired %s has no recorded exit and no observation of continued control (%s)', c.acquisition_date, c.chain_readiness_status)
  from public.v_transaction_asset_chain_readiness c
  where c.chain_readiness_status in ('EXIT_NOT_RESEARCHED', 'HISTORY_INCOMPLETE') and not c.no_mlb_appearance_observed
  union all
  select 'TRADE_RETURN_TIMING_UNRESOLVED', 2, null, e.event_key, e.incoming_asset_name,
    'The incoming player has a same-season Dodgers stint that cannot be ordered against the counterparty stint; the return is not counted'
  from public.v_trade_realization_edges e where e.return_state = 'TIMING_UNRESOLVED'
  union all
  select 'TRADE_RETURN_UNRECORDED', 2, null, e.event_key, null,
    'No incoming consideration is recorded for this trade; the return is unknown, not zero'
  from public.v_trade_realization_edges e where e.return_state = 'RETURN_UNRECORDED'
  union all
  select 'TRANSACTION_DATE_CONFLICT', 1, p.slug, e.event_key, null,
    format('Legacy transaction dated %s but the canonical event is dated %s', t.transaction_date, e.transaction_date)
  from public.transactions t
  join public.players p on p.id = t.player_id
  join public.transaction_event_assets a on a.player_id = t.player_id and a.asset_side = 'OUTGOING'
  join public.transaction_events e on e.id = a.event_id and e.transaction_type = t.transaction_type
  where e.transaction_date <> t.transaction_date
    and not exists (select 1 from public.transaction_event_assets a2 join public.transaction_events e2 on e2.id = a2.event_id
      where a2.player_id = t.player_id and a2.asset_side = 'OUTGOING' and e2.transaction_type = t.transaction_type and e2.transaction_date = t.transaction_date)
  union all
  select 'LEGACY_TRANSACTION_WITHOUT_EVENT', 1, p.slug, null, null,
    format('Legacy %s transaction on %s has no canonical event', t.transaction_type, t.transaction_date)
  from public.transactions t join public.players p on p.id = t.player_id
  where not exists (select 1 from public.transaction_event_assets a2 join public.transaction_events e2 on e2.id = a2.event_id
      where a2.player_id = t.player_id and a2.asset_side = 'OUTGOING' and e2.transaction_type = t.transaction_type)
)
select i.issue, i.priority, i.player_slug, i.event_key, i.asset_name, i.detail from issues i;

comment on view public.v_transaction_research_queue is
  'Unresolved transaction research, derived from the facts: players with no exit evidence or unavailable history, unresolved players to be named later and future considerations, unknown cash and pool-space amounts, assets with no stable identity, return assets with no recorded exit, unresolved trade-return timing, unrecorded returns, and legacy / canonical date conflicts. Nothing is queued from unverified snippets.';
