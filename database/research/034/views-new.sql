-- ===========================================================================
-- Migration 034 views: control intervals, transaction asset lineage, package lineage, downstream organizational realization
-- ===========================================================================

-- One row per continuous Dodgers organizational tenure of one player identity: the original tracked signing, or an incoming
-- PLAYER asset of any acquisition event (trade, free-agent signing). An interval ends at the first later canonical exit event
-- of the same identity; a later re-entry is a new interval and is never reconnected to an earlier one. Dodgers bWAR is bounded
-- to the interval (acquisition-relative as in 032; exit-relative here); nothing outside the interval is credited.
create or replace view public.v_player_control_intervals
with (security_invoker = true)
as
with recursive as_of as (
  select max(audited_through_date) as analysis_as_of_date from public.outcome_audits
),
pa as (
  select a.id as asset_id, a.event_id, a.asset_side, a.asset_name, a.player_id, a.mlb_id, a.bref_id, a.bref_register_id, a.counterparty_organization_id,
    e.event_key, e.transaction_date, e.transaction_type, e.historical_label as event_label
  from public.transaction_event_assets a
  join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'PLAYER'
),
sg as (
  select distinct on (f.player_id) f.player_id, p.slug as player_slug, p.full_name, p.mlb_id::text as mlb_id, p.bref_id,
    coalesce(f.signing_date, make_date(f.signing_year, 1, 1)) as start_date
  from public.v_signing_acquisition_financials f
  join public.players p on p.id = f.player_id
  where f.is_dodgers
  order by f.player_id, f.signing_date nulls last, f.signing_year
),
starts as (
  select 'SIGNING:' || s.player_slug as interval_key, 'TRACKED_SIGNING'::text as start_method, null::uuid as start_asset_id, null::uuid as start_event_id,
    null::text as start_event_key, s.start_date, s.player_id, s.player_slug, s.full_name as display_name, s.mlb_id, s.bref_id,
    null::text as bref_register_id, null::uuid as cp_org_id
  from sg s
  union all
  select pa.event_key || ':' || coalesce(ps.slug, pa.mlb_id, pa.bref_id, pa.bref_register_id, pa.asset_name),
    case when pa.transaction_type = 'TRADE' then 'TRADE_ACQUISITION' else pa.transaction_type end,
    pa.asset_id, pa.event_id, pa.event_key, pa.transaction_date, pa.player_id, ps.slug, pa.asset_name, pa.mlb_id, pa.bref_id, pa.bref_register_id,
    pa.counterparty_organization_id
  from pa
  left join public.players ps on ps.id = pa.player_id
  where pa.asset_side = 'INCOMING'
),
-- first later exit of the same identity (the control interval's end)
ex as (
  select * from (
    select s.interval_key, x.asset_id as exit_asset_id, x.event_id as exit_event_id, x.event_key as exit_event_key, x.transaction_date as exit_date,
      x.transaction_type as exit_type, x.event_label as exit_label,
      row_number() over (partition by s.interval_key order by x.transaction_date, x.event_key) as rn
    from starts s
    join pa x on x.asset_side = 'OUTGOING'
      and x.transaction_type in ('TRADE', 'RELEASE', 'WAIVER', 'FREE_AGENCY', 'RULE5_SELECTION', 'EXPANSION_DRAFT', 'SALE')
      and x.event_id is distinct from s.start_event_id
      and x.transaction_date >= s.start_date
      and ((s.player_id is not null and x.player_id = s.player_id) or (s.mlb_id is not null and x.mlb_id = s.mlb_id)
        or (s.bref_id is not null and x.bref_id = s.bref_id) or (s.bref_register_id is not null and x.bref_register_id = s.bref_register_id))
  ) q where q.rn = 1
),
-- a later interval of the same identity that starts inside the exit season makes the exit-season stint order ambiguous
reentry as (
  select x.interval_key,
    exists (
      select 1 from starts s2
      join starts s1 on s1.interval_key = x.interval_key
      where s2.interval_key <> s1.interval_key and s2.start_date > x.exit_date
        and extract(year from s2.start_date) = extract(year from x.exit_date)
        and extract(month from s2.start_date) between 3 and 10
        and ((s1.player_id is not null and s2.player_id = s1.player_id) or (s1.mlb_id is not null and s2.mlb_id = s1.mlb_id)
          or (s1.bref_id is not null and s2.bref_id = s1.bref_id) or (s1.bref_register_id is not null and s2.bref_register_id = s1.bref_register_id))
    ) as reentry_same_season
  from ex x
),
roots as (
  select e.id as event_id, e.event_key, e.event_key || '|' || string_agg(p.slug, ',' order by p.slug) as root_key
  from public.transaction_events e
  join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = 'OUTGOING' and a.player_id is not null
  join public.players p on p.id = a.player_id
  where e.transaction_type = 'TRADE'
  group by e.id, e.event_key
),
-- which root packages an interval descends from (reachability only; attribution levels are computed in the lineage view)
reach(root_key, interval_key) as (
  select r.root_key, s.interval_key
  from roots r
  join starts s on s.start_event_id = r.event_id and s.start_method <> 'TRACKED_SIGNING'
  union
  select re.root_key, c.interval_key
  from reach re
  join ex on ex.interval_key = re.interval_key and ex.exit_type = 'TRADE'
  join starts c on c.start_event_id = ex.exit_event_id and c.start_method <> 'TRACKED_SIGNING'
),
lr as (
  select interval_key, array_agg(distinct root_key order by root_key) as lineage_root_keys from reach group by interval_key
),
tfacts as (
  select t.subject_asset_id, t.fact_type, t.season, t.observed_date
  from public.transaction_asset_timing_observations t where t.record_status = 'ACTIVE'
)
select
  s.interval_key,
  s.player_id, s.player_slug, s.display_name, s.mlb_id, s.bref_id, s.bref_register_id,
  s.start_method, s.start_event_key, s.start_date as interval_start,
  x.exit_event_key, x.exit_type as exit_method, x.exit_date as interval_end,
  case
    when x.exit_event_id is not null then 'CLOSED_EXIT_RECORDED'
    when ob.observation_type = 'DODGERS_CONTROL_OBSERVED' then 'OPEN_CONTROL_OBSERVED'
    when ob.observation_type = 'CAREER_ENDED_WITH_DODGERS' then 'CLOSED_CAREER_ENDED'
    when ob.observation_type = 'EXIT_MECHANISM_UNRECORDED' or tb.bound_date is not null then 'EXIT_UNRECORDED_BOUNDED'
    when ob.observation_type = 'HISTORY_UNAVAILABLE' then 'HISTORY_UNAVAILABLE'
    else 'EXIT_NOT_RESEARCHED' end as interval_status,
  tb.bound_date as exit_bounded_before_date,
  ao.analysis_as_of_date,
  coalesce(lr.lineage_root_keys, array[]::text[]) as lineage_root_keys,
  (lr.interval_key is not null) as is_lineage_interval,
  case
    when s.player_id is null and s.mlb_id is null and s.bref_id is null and s.bref_register_id is null then 'IDENTITY_UNRESOLVED'
    when coalesce(w.team_rows, 0) > 0 then case when w.ambiguous_rows > 0 then 'TIMING_UNRESOLVED' else 'LOADED' end
    when nm.observed_through is not null then 'NO_MLB_APPEARANCE_OBSERVED'
    when s.start_method = 'TRACKED_SIGNING' then 'NO_TEAM_SEASON_FACTS'
    else 'WAR_NOT_LOADED' end as war_state,
  case
    when s.player_id is null and s.mlb_id is null and s.bref_id is null and s.bref_register_id is null then null
    when coalesce(w.team_rows, 0) > 0 then case when w.ambiguous_rows > 0 then null else coalesce(w.in_war, 0) end
    when nm.observed_through is not null then 0::numeric
    end as interval_bounded_dodgers_bwar,
  w.ambiguous_war as unresolved_dodgers_bwar,
  case when coalesce(w.team_rows, 0) > 0 then w.timing_basis end as timing_resolution_basis,
  case when coalesce(w.team_rows, 0) > 0 then w.exit_basis end as exit_resolution_basis,
  (x.exit_event_id is not null and coalesce(x.exit_label !~* '(approximate|exact date unknown)', true)) as exit_date_is_exact,
  coalesce(w.in_rows, 0) as dodgers_rows_in_interval,
  coalesce(w.out_rows, 0) as dodgers_rows_outside_interval,
  w.out_war as dodgers_bwar_outside_interval,
  nm.observed_through as no_mlb_appearance_observed_through,
  s.start_asset_id, s.start_event_id, x.exit_asset_id, x.exit_event_id
from starts s
cross join as_of ao
left join ex x on x.interval_key = s.interval_key
left join reentry re on re.interval_key = s.interval_key
left join lr on lr.interval_key = s.interval_key
left join lateral (
  select o.observation_type, o.observed_through_date from public.dodgers_control_observations o
  where o.record_status = 'ACTIVE' and o.observation_type <> 'NO_MLB_APPEARANCE_OBSERVED'
    and ((s.start_asset_id is not null and o.subject_asset_id = s.start_asset_id)
      or (s.start_asset_id is null and s.player_id is not null and o.subject_player_id = s.player_id))
  order by o.observed_through_date desc, o.observation_type limit 1
) ob on true
left join lateral (
  select o.observed_through_date as observed_through from public.dodgers_control_observations o
  where o.record_status = 'ACTIVE' and o.observation_type = 'NO_MLB_APPEARANCE_OBSERVED' and s.start_asset_id is not null and o.subject_asset_id = s.start_asset_id
  order by o.observed_through_date desc limit 1
) nm on true
left join lateral (
  select min(t.observed_date) as bound_date from tfacts t where t.fact_type = 'EXIT_BOUNDED_BEFORE' and s.start_asset_id is not null and t.subject_asset_id = s.start_asset_id
) tb on true
left join lateral (
  with t as (
    select wr.season, wr.stint_ordinal, wr.war, o.franchise_key
    from public.player_mlb_team_season_war wr
    left join public.organizations o on o.id = wr.organization_id
    where s.bref_id is not null and wr.bref_id = s.bref_id and wr.record_status = 'ACTIVE' and wr.war_system = 'BWAR'
  ),
  k as (
    select extract(year from s.start_date)::int as ys, extract(month from s.start_date)::int as ms,
      extract(year from x.exit_date)::int as ye, extract(month from x.exit_date)::int as me
  ),
  cpf as (
    select o2.franchise_key from public.organizations o2 where o2.id = s.cp_org_id
  ),
  dr as (
    select t.season, count(distinct t.stint_ordinal) filter (where t.franchise_key = 'DODGERS')::int as d_rows from t group by t.season
  ),
  -- B-Ref stint order is chronological within a season: a same-season Dodgers stint is placed against the acquisition through
  -- the counterparty's single stint (the 032 rule, asset-level counterparty)
  cp as (
    select count(distinct t.stint_ordinal)::int as cp_stints, max(t.stint_ordinal) as cp_ord
    from t cross join k cross join cpf
    where t.season = k.ys and cpf.franchise_key is not null and t.franchise_key = cpf.franchise_key
  ),
  an as (
    select coalesce(bool_or(t.franchise_key = 'DODGERS' and t.stint_ordinal = cp.cp_ord + 1), false) as anchored
    from t cross join k cross join cp where t.season = k.ys
  ),
  ff as (
    select
      coalesce(bool_or(f.fact_type = 'SEASON_START_CONFIRMS_POST_ACQUISITION' and f.season = k.ys), false) as season_start_ok,
      coalesce(bool_or(f.fact_type = 'FIRST_DODGERS_APPEARANCE' and f.season = k.ys and f.observed_date >= s.start_date), false) as first_app_ok
    from k left join tfacts f on s.start_asset_id is not null and f.subject_asset_id = s.start_asset_id
  ),
  cls as (
    select t.*,
      case when t.franchise_key is distinct from 'DODGERS' then null
           when s.start_method = 'TRACKED_SIGNING' then 'IN'
           when t.season < k.ys then 'PRE'
           when t.season > k.ys then 'IN'
           when k.ms >= 11 then 'PRE'
           when k.ms <= 2 then 'IN'
           when ff.season_start_ok then 'IN'
           when ff.first_app_ok and coalesce((select d.d_rows from dr d where d.season = t.season), 0) = 1 then 'IN'
           when an.anchored and cp.cp_stints = 1 and t.stint_ordinal > cp.cp_ord then 'IN'
           when an.anchored and cp.cp_stints = 1 and t.stint_ordinal < cp.cp_ord then 'PRE'
           else 'AMBIG' end as sp,
      case when t.franchise_key is distinct from 'DODGERS' then null
           when x.exit_date is null then 'IN'
           when t.season < k.ye then 'IN'
           when t.season > k.ye then 'OUT'
           when k.me >= 11 then 'IN'
           when k.me <= 2 then 'OUT'
           when x.exit_label ~* '(approximate|exact date unknown)' then 'AMBIG'
           when coalesce((select d.d_rows from dr d where d.season = t.season), 0) = 1 and not coalesce(re.reentry_same_season, false) then 'IN'
           else 'AMBIG' end as ep
    from t cross join k cross join ff cross join an cross join cp
  )
  select
    (select count(*) from t)::int as team_rows,
    case
      when x.exit_date is null then null
      when coalesce((select d.d_rows from dr d, k where d.season = k.ye), 0) = 0 then 'NO_EXIT_SEASON_DODGERS_STINT'
      when (select me from k) >= 11 then 'OFFSEASON_AFTER_SEASON'
      when (select me from k) <= 2 then 'OFFSEASON_BEFORE_SEASON'
      when x.exit_label ~* '(approximate|exact date unknown)' then 'UNRESOLVED'
      when coalesce((select d.d_rows from dr d, k where d.season = k.ye), 0) = 1 and not coalesce(re.reentry_same_season, false) then 'SINGLE_STINT_BEFORE_EXIT'
      else 'UNRESOLVED' end as exit_basis,
    case
      when s.start_method = 'TRACKED_SIGNING' then 'TRACKED_SIGNING'
      when coalesce((select d.d_rows from dr d, k where d.season = k.ys), 0) = 0 then 'NO_ACQUISITION_SEASON_DODGERS_STINT'
      when (select ms from k) >= 11 or (select ms from k) <= 2 then 'CALENDAR'
      when (select season_start_ok from ff) or ((select first_app_ok from ff) and coalesce((select d.d_rows from dr d, k where d.season = k.ys), 0) = 1) then 'TIMING_OBSERVATION'
      when (select anchored from an) and (select cp_stints from cp) = 1 then 'COUNTERPARTY_STINT_ORDER'
      else 'UNRESOLVED' end as timing_basis,
    (select count(*) from cls c where c.sp = 'IN' and c.ep = 'IN')::int as in_rows,
    (select sum(c.war) from cls c where c.sp = 'IN' and c.ep = 'IN') as in_war,
    (select count(*) from cls c where c.sp = 'PRE' or c.ep = 'OUT')::int as out_rows,
    (select sum(c.war) from cls c where c.sp = 'PRE' or c.ep = 'OUT') as out_war,
    (select count(*) from cls c where c.franchise_key = 'DODGERS' and c.sp <> 'PRE' and c.ep <> 'OUT' and (c.sp = 'AMBIG' or c.ep = 'AMBIG'))::int as ambiguous_rows,
    (select sum(c.war) from cls c where c.franchise_key = 'DODGERS' and c.sp <> 'PRE' and c.ep <> 'OUT' and (c.sp = 'AMBIG' or c.ep = 'AMBIG')) as ambiguous_war
) w on true;

comment on view public.v_player_control_intervals is
  'One row per continuous Dodgers organizational tenure of one player identity: the original tracked signing (TRACKED_SIGNING) or an incoming PLAYER asset of a canonical acquisition event (TRADE_ACQUISITION, FREE_AGENT_SIGNING). The interval ends at the first later exit event of the same identity (matched on player_id, mlb_id, bref_id or bref_register_id, never on names); a later re-entry is a new interval and is never reconnected to the earlier one. interval_bounded_dodgers_bwar sums Baseball-Reference bWAR of Dodgers stints inside the interval only: acquisition-relative with the 032 counterparty stint rule, the calendar, or a sourced chronology fact (transaction_asset_timing_observations) - timing_resolution_basis names which; the absence of an earlier modeled interval or a single team row is never accepted as chronology evidence - and exit-relative by an exact-dated exit (offseason, no Dodgers stint that season, or one contiguous Dodgers stint with no same-season re-entry; exit_resolution_basis names which; an approximate exit date never resolves a mid-season stint); a stint that cannot be placed leaves the value NULL (TIMING_UNRESOLVED), never zero. Open intervals report realized bWAR through analysis_as_of_date and may grow.';

-- One row per root package x path x hop: the factual lineage of every Dodgers control interval that descends from a trade of
-- tracked signings. Derived by a cycle-safe recursive traversal of canonical transaction events; no edge is stored.
create or replace view public.v_transaction_asset_lineage
with (security_invoker = true)
as
with recursive iv as (
  select * from public.v_player_control_intervals
),
roots as (
  select e.id as event_id, e.event_key, e.transaction_date,
    e.event_key || '|' || string_agg(p.slug, ',' order by p.slug) as root_key,
    array_agg(p.slug order by p.slug) as slugs,
    (select count(*) from public.transaction_event_assets x where x.event_id = e.id and x.asset_side = 'OUTGOING')::int as out_count
  from public.transaction_events e
  join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = 'OUTGOING' and a.player_id is not null
  join public.players p on p.id = a.player_id
  where e.transaction_type = 'TRADE'
  group by e.id, e.event_key, e.transaction_date
),
-- composition of an exit trade relative to a root: 0 the parent asset alone, 1 consideration or same-root co-members,
-- 2 another root's lineage, a lineage-less player or another tracked signing
parents as (
  select distinct r.root_key, i.exit_event_id
  from iv i cross join lateral unnest(i.lineage_root_keys) as r(root_key)
  where i.exit_method = 'TRADE'
),
outg as (
  select a.id as asset_id, a.event_id, a.asset_type, a.player_id, oi.lineage_root_keys as o_roots
  from public.transaction_event_assets a
  left join iv oi on oi.exit_asset_id = a.id
  where a.asset_side = 'OUTGOING'
),
comp as (
  select p.root_key, p.exit_event_id,
    case when count(*) = 1 then 0
         else greatest(1, max(case when o.asset_type <> 'PLAYER' then 0
                                   when o.player_id is not null then 2
                                   when o.o_roots = array[p.root_key] then 0
                                   else 2 end)) end as class_level
  from parents p
  join outg o on o.event_id = p.exit_event_id
  group by p.root_key, p.exit_event_id
),
lin(root_key, root_event_key, root_slugs, hop, interval_key, path_key, parent_path_key, path_intervals, path_events, lvl, prior_lvl) as (
  select r.root_key, r.event_key, r.slugs, 1, i.interval_key, r.root_key || ' > ' || i.interval_key, null::text,
    array[i.interval_key], array[r.event_key],
    greatest(case when r.out_count = 1 then 0 else 1 end,
             case when i.war_state in ('IDENTITY_UNRESOLVED', 'TIMING_UNRESOLVED') then 3 else 0 end),
    null::int
  from roots r
  join iv i on i.start_event_id = r.event_id and i.start_method <> 'TRACKED_SIGNING'
  union all
  select l.root_key, l.root_event_key, l.root_slugs, l.hop + 1, c.interval_key, l.path_key || ' > ' || c.interval_key, l.path_key,
    l.path_intervals || c.interval_key, l.path_events || p.exit_event_key,
    greatest(l.lvl, cm.class_level, case when c.war_state in ('IDENTITY_UNRESOLVED', 'TIMING_UNRESOLVED') then 3 else 0 end),
    l.lvl
  from lin l
  join iv p on p.interval_key = l.interval_key and p.exit_method = 'TRADE'
  join iv c on c.start_event_id = p.exit_event_id and c.start_method <> 'TRACKED_SIGNING'
  join comp cm on cm.root_key = l.root_key and cm.exit_event_id = p.exit_event_id
  where not (p.exit_event_key = any (l.path_events)) and not (c.interval_key = any (l.path_intervals))
),
lvl_name(n, name) as (
  values (0, 'PLAYER_ATTRIBUTABLE'), (1, 'PACKAGE_ATTRIBUTABLE'), (2, 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'), (3, 'UNRESOLVED')
)
select
  l.root_key as root_package_key, l.root_event_key, l.root_slugs as root_signing_slugs, cardinality(l.root_slugs) as root_signing_count,
  l.path_key, l.parent_path_key, l.hop as hop_number,
  i.interval_key, i.player_slug, i.display_name as asset_name, i.mlb_id, i.bref_id, i.bref_register_id,
  i.start_event_key as acquisition_event_key, i.interval_start as acquisition_date,
  i.exit_event_key, i.interval_end as exit_date, i.exit_method as exit_type,
  i.interval_status,
  ln.name as attribution_level,
  case when ln.name = 'UNRESOLVED' then 'UNRESOLVED' else 'RESOLVED' end as attribution_resolution,
  case i.war_state when 'LOADED' then 'VALUE_RESOLVED' when 'NO_MLB_APPEARANCE_OBSERVED' then 'ZERO_OBSERVED_THROUGH_DATE'
    when 'WAR_NOT_LOADED' then 'VALUE_NOT_LOADED' when 'TIMING_UNRESOLVED' then 'VALUE_TIMING_UNRESOLVED'
    else 'VALUE_IDENTITY_UNRESOLVED' end as value_resolution,
  i.timing_resolution_basis,
  pn.name as prior_attribution_level,
  case
    when i.war_state = 'IDENTITY_UNRESOLVED' then 'IDENTITY_UNRESOLVED'
    when exists (select 1 from lin c where c.parent_path_key = l.path_key) then 'CONTINUES'
    when i.war_state = 'TIMING_UNRESOLVED' then 'TIMING_UNRESOLVED'
    when i.exit_event_id is not null and i.exit_method = 'TRADE' then
      case when ec.unresolved_ptbnl > 0 then 'PENDING_CONSIDERATION'
           when ec.incoming_count = 0 then 'RETURN_UNRECORDED'
           else 'TERMINAL_NON_PLAYER_RETURN' end
    when i.exit_event_id is not null then 'TERMINAL_NO_RETURN'
    when i.interval_status = 'OPEN_CONTROL_OBSERVED' then 'STILL_ACTIVE'
    when i.interval_status = 'CLOSED_CAREER_ENDED' then 'COMPLETE_TERMINAL'
    when i.interval_status = 'EXIT_UNRECORDED_BOUNDED' then 'EXIT_UNRECORDED_BOUNDED'
    when i.interval_status = 'HISTORY_UNAVAILABLE' then 'HISTORY_INCOMPLETE'
    when i.war_state = 'NO_MLB_APPEARANCE_OBSERVED' then 'NO_MLB_APPEARANCE'
    else 'EXIT_NOT_RESEARCHED' end as branch_status,
  i.war_state,
  i.interval_bounded_dodgers_bwar,
  i.unresolved_dodgers_bwar,
  i.analysis_as_of_date,
  l.path_events as path_event_keys,
  i.start_asset_id, i.exit_event_id, i.start_event_id
from lin l
join iv i on i.interval_key = l.interval_key
join lvl_name ln on ln.n = l.lvl
left join lvl_name pn on pn.n = l.prior_lvl
left join lateral (
  select count(*) filter (where a.asset_side = 'INCOMING')::int as incoming_count,
    count(*) filter (where a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER_TO_BE_NAMED' and r.id is null)::int as unresolved_ptbnl
  from public.transaction_event_assets a
  left join public.transaction_asset_resolutions r on r.placeholder_asset_id = a.id and r.record_status = 'ACTIVE'
  where a.event_id = i.exit_event_id
) ec on i.exit_event_id is not null;

comment on view public.v_transaction_asset_lineage is
  'One row per root package x path x hop. A root package is a trade event with at least one tracked signing outgoing, keyed event_key | sorted tracked slugs. Hop 1 is an incoming PLAYER asset of that trade; hop N+1 is an incoming PLAYER asset of the trade in which the hop-N asset left Dodgers control (first exit of the same identity). attribution_level degrades and never improves: PLAYER_ATTRIBUTABLE (the root is the sole outgoing asset and every exit on the path sent the asset alone), PACKAGE_ATTRIBUTABLE (one root package, but a boundary carries other outgoing assets or consideration), CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE (another root lineage, another tracked signing or a lineage-less player participates; visible, never added to a root), UNRESOLVED (identity or timing unresolved). Two dimensions are explicit: attribution_resolution (is the attribution level determinable) and value_resolution (is the bWAR value determinable; VALUE_NOT_LOADED means the WAR source has no row for the player, which does not make the attribution unresolved and is never zero without a dated no-MLB-appearance observation). Outgoing cash, pool space and placeholders always degrade at least to PACKAGE_ATTRIBUTABLE. Events and intervals are visited once per path. interval_bounded_dodgers_bwar is NULL when unresolved, never zero.';

-- One row per root package x downstream control interval, deduplicated across tracked signings and across paths. This is the
-- canonical basis of package-level aggregates: every interval contributes its bWAR once.
create or replace view public.v_transaction_package_lineage
with (security_invoker = true)
as
with lvl_n(name, n) as (
  values ('PLAYER_ATTRIBUTABLE', 0), ('PACKAGE_ATTRIBUTABLE', 1), ('CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE', 2), ('UNRESOLVED', 3)
),
ranked as (
  select l.*, ln.n as lvl,
    row_number() over (partition by l.root_package_key, l.interval_key order by ln.n desc, l.hop_number, l.path_key) as rn,
    count(*) over (partition by l.root_package_key, l.interval_key)::int as path_count,
    min(l.hop_number) over (partition by l.root_package_key, l.interval_key) as min_hop,
    max(l.hop_number) over (partition by l.root_package_key, l.interval_key) as max_hop
  from public.v_transaction_asset_lineage l
  join lvl_n ln on ln.name = l.attribution_level
)
select
  r.root_package_key, r.root_event_key, r.root_signing_slugs, r.root_signing_count,
  r.interval_key, r.asset_name, r.player_slug, r.mlb_id, r.bref_id, r.bref_register_id,
  r.min_hop as hop_number, r.max_hop as max_hop_number, r.path_count,
  r.acquisition_event_key, r.acquisition_date, r.exit_event_key, r.exit_date, r.exit_type, r.interval_status,
  r.attribution_level, r.attribution_resolution, r.value_resolution, r.timing_resolution_basis, r.branch_status, r.war_state,
  r.interval_bounded_dodgers_bwar,
  (r.min_hop = 1) as is_first_hop,
  (r.attribution_level in ('PLAYER_ATTRIBUTABLE', 'PACKAGE_ATTRIBUTABLE') and r.interval_bounded_dodgers_bwar is not null) as is_additive_to_package_total,
  r.analysis_as_of_date
from ranked r
where r.rn = 1;

comment on view public.v_transaction_package_lineage is
  'One row per root package x downstream acquisition interval, deduplicated from per-signing membership and from alternative paths (the most degraded attribution level and the nearest hop are kept; path_count says how many paths reach it). is_additive_to_package_total is true only for PLAYER_ATTRIBUTABLE and PACKAGE_ATTRIBUTABLE intervals with a resolved value: those belong to exactly one root package, so a package total never counts an interval twice and never counts one for several packages. CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE intervals are visible under every root they descend from and additive to none.';

-- Signing-level and package-level downstream organizational realization side by side (row_grain). Signing rows carry only
-- value that is defensibly the signing's own; package rows carry package value once. The two are never merged.
create or replace view public.v_downstream_organizational_realization
with (security_invoker = true)
as
with pk0 as (
  select p.root_package_key,
    min(p.root_event_key) as root_event_key,
    count(*)::int as intervals,
    sum(p.interval_bounded_dodgers_bwar) filter (where p.is_first_hop) as first_hop_sum,
    count(*) filter (where p.is_first_hop and p.interval_bounded_dodgers_bwar is null) as first_hop_unresolved,
    sum(p.interval_bounded_dodgers_bwar) filter (where p.is_first_hop and p.attribution_level = 'PLAYER_ATTRIBUTABLE') as first_hop_player_sum,
    count(*) filter (where p.is_first_hop and p.attribution_level = 'PLAYER_ATTRIBUTABLE' and p.interval_bounded_dodgers_bwar is null) as first_hop_player_unresolved,
    sum(p.interval_bounded_dodgers_bwar) filter (where not p.is_first_hop and p.attribution_level = 'PLAYER_ATTRIBUTABLE') as down_player_sum,
    count(*) filter (where not p.is_first_hop and p.attribution_level = 'PLAYER_ATTRIBUTABLE' and p.interval_bounded_dodgers_bwar is null) as down_player_unresolved,
    sum(p.interval_bounded_dodgers_bwar) filter (where not p.is_first_hop and p.attribution_level = 'PACKAGE_ATTRIBUTABLE') as down_package_sum,
    sum(p.interval_bounded_dodgers_bwar) filter (where p.attribution_level = 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE') as observable_sum,
    max(p.max_hop_number) as max_hop,
    count(*) filter (where not p.is_first_hop)::int as downstream_intervals,
    case
      when bool_or(p.branch_status = 'IDENTITY_UNRESOLVED') then 'INCOMPLETE_IDENTITY'
      when bool_or(p.branch_status = 'TIMING_UNRESOLVED') then 'INCOMPLETE_TIMING'
      when bool_or(p.branch_status = 'PENDING_CONSIDERATION') then 'INCOMPLETE_PENDING_CONSIDERATION'
      when bool_or(p.branch_status = 'RETURN_UNRECORDED') then 'INCOMPLETE_RETURN_UNRECORDED'
      when bool_or(p.branch_status = 'EXIT_NOT_RESEARCHED') then 'INCOMPLETE_EXIT_NOT_RESEARCHED'
      when bool_or(p.branch_status in ('EXIT_UNRECORDED_BOUNDED', 'HISTORY_INCOMPLETE')) then 'INCOMPLETE_EXIT_UNRECORDED'
      when bool_or(p.war_state = 'WAR_NOT_LOADED') then 'INCOMPLETE_WAR_NOT_LOADED'
      when bool_or(p.branch_status = 'STILL_ACTIVE') then 'STILL_ACTIVE'
      else 'COMPLETE_TERMINAL' end as chain_status
  from public.v_transaction_package_lineage p
  group by p.root_package_key
),
rp as (
  select e.event_key, e.event_key || '|' || string_agg(pl.slug, ',' order by pl.slug) as root_package_key
  from public.transaction_events e
  join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = 'OUTGOING' and a.player_id is not null
  join public.players pl on pl.id = a.player_id
  where e.transaction_type = 'TRADE'
  group by e.event_key
),
-- a trade with no incoming PLAYER asset has no lineage; its state is the first-hop return state
rs as (
  select distinct on (x.event_key) x.event_key, x.return_state
  from public.v_trade_realization_edges x where x.incoming_asset_id is null
  order by x.event_key
),
pk as (
  select r.root_package_key,
    r.event_key as root_event_key,
    string_to_array(split_part(r.root_package_key, '|', 2), ',') as root_signing_slugs,
    case when k.root_package_key is not null then k.first_hop_unresolved
         when rs.return_state = 'NO_PLAYER_RETURN' then 0 else 1 end as first_hop_unresolved,
    case when k.root_package_key is null and rs.return_state = 'NO_PLAYER_RETURN' then 0 else k.first_hop_sum end as first_hop_value,
    k.first_hop_player_sum, coalesce(k.first_hop_player_unresolved, 0) as first_hop_player_unresolved,
    k.down_player_sum, coalesce(k.down_player_unresolved, 0) as down_player_unresolved,
    k.down_package_sum, k.observable_sum,
    coalesce(k.max_hop, 0) as max_hop,
    coalesce(k.downstream_intervals, 0) as downstream_intervals,
    coalesce(k.chain_status,
      case rs.return_state when 'NO_PLAYER_RETURN' then 'COMPLETE_TERMINAL'
                           when 'PLAYER_RETURN_PENDING' then 'INCOMPLETE_PENDING_CONSIDERATION'
                           when 'RETURN_UNRECORDED' then 'INCOMPLETE_RETURN_UNRECORDED'
                           else 'INCOMPLETE_RETURN_UNRECORDED' end) as chain_status
  from rp r
  left join pk0 k on k.root_package_key = r.root_package_key
  left join rs on rs.event_key = r.event_key
),
sign as (
  select r.player_id, r.player_slug, r.full_name, r.signing_id, r.signing_year, r.pathway, r.country_market, r.known_acquisition_cost_usd,
    r.acquisition_cost_completeness, r.cost_metric_eligible, r.maturity_status, r.analysis_as_of_date,
    r.direct_dodgers_mlb_bwar, r.trade_package_return_dodgers_bwar as legacy_first_hop_return_bwar,
    r.individually_attributable_trade_return_bwar as legacy_individually_attributable_first_hop_bwar,
    r.attributable_organizational_bwar as legacy_attributable_organizational_bwar,
    r.package_attribution_state as legacy_package_attribution_state,
    r.downstream_asset_chain_incomplete as legacy_downstream_asset_chain_incomplete
  from public.v_player_organizational_realization r
),
mine as (
  select s.player_id, k.*
  from sign s
  join pk k on s.player_slug = any (k.root_signing_slugs)
),
agg as (
  select m.player_id,
    array_agg(m.root_package_key order by m.root_package_key) as root_package_keys,
    count(*)::int as root_package_count,
    sum(m.first_hop_value) as first_hop_sum, sum(m.first_hop_unresolved) as first_hop_unresolved,
    sum(m.first_hop_player_sum) as first_hop_player_sum, sum(m.first_hop_player_unresolved) as first_hop_player_unresolved,
    sum(m.down_player_sum) as down_player_sum, sum(m.down_player_unresolved) as down_player_unresolved,
    sum(m.down_package_sum) as down_package_sum,
    sum(m.observable_sum) as observable_sum,
    max(m.max_hop) as max_hop,
    sum(m.downstream_intervals)::int as downstream_intervals,
    (array_agg(m.chain_status order by case m.chain_status when 'INCOMPLETE_IDENTITY' then 1 when 'INCOMPLETE_TIMING' then 2
       when 'INCOMPLETE_PENDING_CONSIDERATION' then 3 when 'INCOMPLETE_RETURN_UNRECORDED' then 4 when 'INCOMPLETE_EXIT_NOT_RESEARCHED' then 5
       when 'INCOMPLETE_EXIT_UNRECORDED' then 6 when 'INCOMPLETE_WAR_NOT_LOADED' then 7 when 'STILL_ACTIVE' then 8 else 9 end))[1] as chain_status
  from mine m
  group by m.player_id
),
signing_rows as (
  select 'SIGNING'::text as row_grain,
    s.player_slug, s.full_name, s.player_id, s.signing_id, s.signing_year, s.pathway, s.country_market,
    s.known_acquisition_cost_usd, s.acquisition_cost_completeness, s.cost_metric_eligible, s.maturity_status,
    null::text as root_package_key, null::text as root_event_key, coalesce(a.root_package_keys, array[]::text[]) as root_package_keys,
    coalesce(a.root_package_count, 0) as root_package_count,
    s.direct_dodgers_mlb_bwar,
    s.legacy_first_hop_return_bwar, s.legacy_individually_attributable_first_hop_bwar, s.legacy_package_attribution_state, s.legacy_downstream_asset_chain_incomplete,
    case when a.player_id is not null and a.first_hop_unresolved = 0 then a.first_hop_sum end as interval_bounded_first_hop_package_bwar,
    case when a.player_id is not null and a.first_hop_player_unresolved = 0 then coalesce(a.first_hop_player_sum, 0) end as interval_bounded_individually_attributable_first_hop_bwar,
    case when a.player_id is not null and a.down_player_unresolved = 0 then coalesce(a.down_player_sum, 0) end as downstream_individually_attributable_bwar,
    a.down_package_sum as package_participation_downstream_bwar,
    a.observable_sum as observable_not_attributable_bwar,
    case when s.direct_dodgers_mlb_bwar is null then null
         when a.player_id is null then s.direct_dodgers_mlb_bwar
         when a.first_hop_player_unresolved > 0 or a.down_player_unresolved > 0 then null
         else s.direct_dodgers_mlb_bwar + coalesce(a.first_hop_player_sum, 0) + coalesce(a.down_player_sum, 0) end as total_individually_attributable_organizational_bwar,
    a.max_hop as max_observed_hop,
    case when a.player_id is null then 'NO_TRADE_CHAIN' else a.chain_status end as chain_status,
    s.analysis_as_of_date
  from sign s
  left join agg a on a.player_id = s.player_id
),
package_rows as (
  select 'PACKAGE'::text as row_grain,
    null::text, null::text, null::uuid, null::uuid, null::int, null::text, null::text,
    null::numeric, null::text, null::boolean, null::text,
    k.root_package_key, k.root_event_key, array[k.root_package_key], 1,
    null::numeric,
    null::numeric, null::numeric, null::text, null::boolean,
    case when k.first_hop_unresolved = 0 then k.first_hop_value end,
    case when k.first_hop_player_unresolved = 0 then coalesce(k.first_hop_player_sum, 0) end,
    case when k.down_player_unresolved = 0 then coalesce(k.down_player_sum, 0) end,
    k.down_package_sum,
    k.observable_sum,
    null::numeric,
    k.max_hop,
    k.chain_status,
    (select max(audited_through_date) from public.outcome_audits)
  from pk k
)
select * from signing_rows
union all
select * from package_rows;

comment on view public.v_downstream_organizational_realization is
  'Downstream organizational realization beside the 032/033 first-hop columns, which are preserved unchanged (legacy_*). row_grain SIGNING: one row per tracked signing; individually attributable value only (interval_bounded_individually_attributable_first_hop_bwar and downstream_individually_attributable_bwar), the package value the signing participated in (package_participation_downstream_bwar, non-additive across the package members) and observable_not_attributable_bwar (mixed lineage, visible only). total_individually_attributable_organizational_bwar = direct Dodgers bWAR + interval-bounded PLAYER_ATTRIBUTABLE first-hop return + downstream PLAYER_ATTRIBUTABLE bWAR; package-attributable, mixed-lineage and unresolved value are never added; it is NULL when any PLAYER_ATTRIBUTABLE interval is unresolved. row_grain PACKAGE: one row per root package, deduplicated, never merged into a signing total. chain_status: COMPLETE_TERMINAL, STILL_ACTIVE (open chains grow), or INCOMPLETE_* (a data deficiency); a known attribution boundary is not incompleteness. Realized value is through analysis_as_of_date.';
