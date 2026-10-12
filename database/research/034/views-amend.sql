create or replace view public.v_dodgers_international_value_portfolio
with (security_invoker = true)
as
with m as materialized (
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
),
core as (
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
group by g.grain, g.grain_value, g.sort_key
),
dor as materialized (
  select * from public.v_downstream_organizational_realization
),
dsr as (
  select * from dor where row_grain = 'SIGNING'
),
pkr as (
  select * from dor where row_grain = 'PACKAGE'
),
sg as (
  select g.grain, g.grain_value,
    sum(d.interval_bounded_individually_attributable_first_hop_bwar) as interval_bounded_individually_attributable_first_hop_bwar,
    sum(d.downstream_individually_attributable_bwar) as downstream_individually_attributable_bwar,
    (count(*) filter (where g.cost_metric_eligible and d.total_individually_attributable_organizational_bwar is not null))::int as total_attributable_ratio_eligible_signings,
    sum(g.known_acquisition_cost_usd) filter (where g.cost_metric_eligible and d.total_individually_attributable_organizational_bwar is not null) as total_attributable_eligible_known_acquisition_cost_usd,
    sum(d.total_individually_attributable_organizational_bwar) filter (where g.cost_metric_eligible and d.total_individually_attributable_organizational_bwar is not null) as eligible_total_individually_attributable_bwar
  from grains g
  join dsr d on d.player_id = g.player_id
  group by g.grain, g.grain_value
),
pk as (
  select distinct g.grain, g.grain_value, k.root_key
  from grains g
  join dsr d on d.player_id = g.player_id
  cross join lateral unnest(d.root_package_keys) as k(root_key)
),
pkv as (
  select pk.grain, pk.grain_value, p.*
  from pk join pkr p on p.root_package_key = pk.root_key
),
plx as (
  select pk.grain, pk.grain_value, l.*
  from pk join public.v_transaction_package_lineage l on l.root_package_key = pk.root_key
),
dd as (
  select distinct on (x.grain, x.grain_value, x.interval_key) x.grain, x.grain_value, x.interval_key, x.interval_bounded_dodgers_bwar, x.attribution_level
  from plx x
  order by x.grain, x.grain_value, x.interval_key, case when x.is_first_hop then 0 else 1 end
),
dds as (
  select d.grain, d.grain_value,
    sum(d.interval_bounded_dodgers_bwar) as package_deduplicated_total_bwar,
    sum(d.interval_bounded_dodgers_bwar) filter (where d.attribution_level = 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE') as observable_not_attributable_bwar
  from dd d group by d.grain, d.grain_value
),
pm as (
  select v.grain, v.grain_value,
    count(*)::int as root_packages,
    sum(v.interval_bounded_first_hop_package_bwar) as interval_bounded_first_hop_package_bwar,
    sum(v.package_participation_downstream_bwar) as downstream_package_attributable_bwar,
    (count(*) filter (where v.chain_status like 'INCOMPLETE%'))::int as packages_incomplete,
    (count(*) filter (where v.chain_status = 'STILL_ACTIVE'))::int as packages_open,
    max(v.max_observed_hop) as max_observed_depth
  from pkv v group by v.grain, v.grain_value
),
pq as (
  select x.grain, x.grain_value,
    (count(distinct x.root_package_key) filter (where not x.is_first_hop and x.interval_bounded_dodgers_bwar is not null))::int as packages_with_downstream_realization,
    (count(distinct x.root_package_key) filter (where x.attribution_level = 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'))::int as packages_blocked_by_mixed_lineage
  from plx x group by x.grain, x.grain_value
)
select core.*,
  sg.interval_bounded_individually_attributable_first_hop_bwar,
  sg.downstream_individually_attributable_bwar,
  sg.total_attributable_ratio_eligible_signings,
  sg.total_attributable_eligible_known_acquisition_cost_usd,
  sg.eligible_total_individually_attributable_bwar,
  round(sg.eligible_total_individually_attributable_bwar / nullif(sg.total_attributable_eligible_known_acquisition_cost_usd / 1000000.0, 0), 3) as aggregate_total_individually_attributable_bwar_per_million,
  pm.root_packages,
  pm.interval_bounded_first_hop_package_bwar,
  pm.downstream_package_attributable_bwar,
  dds.package_deduplicated_total_bwar,
  dds.observable_not_attributable_bwar,
  pq.packages_with_downstream_realization,
  pq.packages_blocked_by_mixed_lineage,
  pm.packages_incomplete,
  pm.packages_open,
  pm.max_observed_depth
from core
left join sg on sg.grain = core.grain and sg.grain_value = core.grain_value
left join pm on pm.grain = core.grain and pm.grain_value = core.grain_value
left join dds on dds.grain = core.grain and dds.grain_value = core.grain_value
left join pq on pq.grain = core.grain and pq.grain_value = core.grain_value
)
select * from m;

comment on view public.v_dodgers_international_value_portfolio is
  'Migration 034 appends downstream columns and leaves every earlier column unchanged (package_return_dodgers_bwar still sums per signing, so a package with several tracked signings repeats; the package-deduplicated measures group by root_package_key first). package_deduplicated_total_bwar is an observed lineage total (first-hop package value + downstream PLAYER_ATTRIBUTABLE + downstream PACKAGE_ATTRIBUTABLE + CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE intervals, each interval once), not an individually attributable total; only the individually-attributable and total_individually_attributable columns are attributable to a signing. Aggregate value per $1M by grain (all, signing year, era, market, pathway) using SUM(value) / SUM(cost) over the same eligible rows: mature, COMPLETE acquisition cost, outcome observed. The eligible counts and cost are explicit. These are tracked / verified-set analytics, not organization-wide hit rates (no signing period is rate-eligible), and they differ from the legacy average-of-ratios KPI by design.';

create or replace view public.v_value_research_queue
with (security_invoker = true)
as
with m as materialized (
with lin as materialized (select * from public.v_transaction_asset_lineage),
  ivl as materialized (select * from public.v_player_control_intervals),
  dor as materialized (select * from public.v_downstream_organizational_realization),
r as (select * from public.v_player_organizational_realization),
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
  select 'TRADE_RETURN_TIMING_UNRESOLVED', 2, null::text, null::uuid, l.acquisition_event_key,
    format('Incoming %s has a Dodgers stint in the acquisition season that cannot be placed against the acquisition; no sourced chronology fact exists, so the return is not counted', l.asset_name)
  from lin l where l.hop_number = 1 and l.war_state = 'TIMING_UNRESOLVED'
  union all
  select 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE', 3, d.player_slug, d.signing_id, null,
    format('The downstream chain is %s: incomplete data, not a known attribution boundary', d.chain_status)
  from dor d where d.row_grain = 'SIGNING' and d.chain_status like 'INCOMPLETE%'
  union all
  select 'LINEAGE_BOUNDARY_NOTED', 4, null::text, null::uuid, b.acquisition_event_key,
    format('Informational: %s is %s (it was %s earlier on the path); the value is visible and not added to a single root', b.asset_name, b.attribution_level, b.prior_attribution_level)
  from (
    select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name, l.attribution_level, l.prior_attribution_level
    from lin l
    where l.prior_attribution_level is not null and l.attribution_level = 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE' and l.prior_attribution_level <> l.attribution_level
    order by l.interval_key
  ) b
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
select i.issue, i.priority, i.player_slug, i.signing_id, i.event_key, i.detail from issues i
)
select * from m;

comment on view public.v_value_research_queue is
  'Unresolved value research, derived from the facts: missing team-season WAR, unmapped team codes, career-total reconciliation, shared-package attribution, downstream chains, incomplete acquisition cost for verified MLB outcomes, incomplete outcomes, and exits with no recorded transaction. Migration 034 recomputes the trade-return timing and downstream-chain issues from control intervals and lineage, and notes attribution boundaries informationally (LINEAGE_BOUNDARY_NOTED is not missing research). Nothing is queued from unverified snippets.';

create or replace view public.v_transaction_research_queue
with (security_invoker = true)
as
with m as materialized (
with lin as materialized (select * from public.v_transaction_asset_lineage),
  ivl as materialized (select * from public.v_player_control_intervals),
  dor as materialized (select * from public.v_downstream_organizational_realization),
issues as (
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
  select 'TRADE_RETURN_TIMING_UNRESOLVED', 2, null::text, l.acquisition_event_key, l.asset_name,
    'The incoming player has a Dodgers stint in the acquisition season that cannot be placed against the acquisition; no sourced chronology fact exists, so the return is not counted'
  from lin l where l.hop_number = 1 and l.war_state = 'TIMING_UNRESOLVED'
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
  union all
  select 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION', 3, null::text, d.exit_event_key, d.display_name,
    'The identity has Dodgers team-season rows after a recorded exit and no recorded acquisition event; the later stint is outside every interval and is not credited to any trade return'
  from (select distinct on (e.interval_key) e.interval_key, e.exit_event_key, e.display_name from ivl e
        where e.interval_end is not null and e.bref_id is not null and exists (
          select 1 from public.player_mlb_team_season_war w join public.organizations o on o.id = w.organization_id
          where w.bref_id = e.bref_id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR' and o.franchise_key = 'DODGERS'
            and (w.season > extract(year from e.interval_end)::int
                 or (w.season = extract(year from e.interval_end)::int and extract(month from e.interval_end) <= 2))
            and not exists (select 1 from ivl j where j.bref_id = e.bref_id and j.interval_key <> e.interval_key
                  and j.interval_start > e.interval_end and extract(year from j.interval_start) <= w.season
                  and (j.interval_end is null or extract(year from j.interval_end) >= w.season)))
        order by e.interval_key) d
  union all
  select 'DOWNSTREAM_TIMING_UNRESOLVED', 2, null::text, d.acquisition_event_key, d.asset_name,
    'A downstream asset has a Dodgers stint that cannot be placed inside its control interval; its value is not counted'
  from (select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name from lin l
        where l.hop_number > 1 and l.war_state = 'TIMING_UNRESOLVED' order by l.interval_key) d
  union all
  select 'EXIT_NOT_RESEARCHED_DOWNSTREAM', 3, null::text, d.acquisition_event_key, d.asset_name,
    'A downstream asset acquired in a recorded trade has no recorded exit and no observation of continued control'
  from (select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name from lin l
        where l.hop_number > 1 and l.branch_status = 'EXIT_NOT_RESEARCHED' and l.war_state <> 'NO_MLB_APPEARANCE_OBSERVED' order by l.interval_key) d
  union all
  select 'DOWNSTREAM_WAR_NOT_LOADED', 3, null::text, d.acquisition_event_key, d.asset_name,
    'A downstream asset has no loaded team-season facts and no dated no-MLB-appearance observation; its value is unknown, not zero'
  from (select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name from lin l
        where l.hop_number > 1 and l.war_state = 'WAR_NOT_LOADED' order by l.interval_key) d
)
select i.issue, i.priority, i.player_slug, i.event_key, i.asset_name, i.detail from issues i
)
select * from m;

comment on view public.v_transaction_research_queue is
  'Unresolved transaction research, derived from the facts (Migration 034 adds the downstream issues EXIT_NOT_RESEARCHED_DOWNSTREAM, DOWNSTREAM_WAR_NOT_LOADED, DOWNSTREAM_TIMING_UNRESOLVED and DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION and recomputes the first-hop timing issue from control intervals): players with no exit evidence or unavailable history, unresolved players to be named later and future considerations, unknown cash and pool-space amounts, assets with no stable identity, return assets with no recorded exit, unresolved trade-return timing, unrecorded returns, and legacy / canonical date conflicts. Nothing is queued from unverified snippets.';
