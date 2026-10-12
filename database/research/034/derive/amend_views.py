#!/usr/bin/env python3
"""Generates database/research/034/views-amend.sql: the additive amendments of the 033 portfolio and research-queue views.

    python database/research/034/derive/amend_views.py

Reads the three 033 view definitions out of database/research/033/views.sql and applies the documented Migration 034 changes
(appended portfolio columns computed per package; the recomputed timing and downstream-chain queue issues). Deterministic.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '033', 'views.sql')
DEST = os.path.join(HERE, '..', 'views-amend.sql')
t = open(SRC, encoding='utf8').read().replace('\r\n', '\n')


def grab(name):
    i = t.index(f'create or replace view public.{name}\n')
    j = t.index(f'comment on view public.{name} is', i)
    k = t.index(';\n', j) + 2
    return t[i:k]


port = grab('v_dodgers_international_value_portfolio')
vq = grab('v_value_research_queue')
tq = grab('v_transaction_research_queue')

# ---- portfolio: the 033 select becomes the CTE core; new columns are appended ------------------------------------------------
head, rest = port.split('select\n  g.grain, g.grain_value,', 1)
rest = 'select\n  g.grain, g.grain_value,' + rest
sel, comment = rest.split('\ncomment on view', 1)
sel = sel.rstrip().rstrip(';')
comment = 'comment on view' + comment

EXTRA = """dor as materialized (
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
left join pq on pq.grain = core.grain and pq.grain_value = core.grain_value;
"""
comment = comment.replace(
    "comment on view public.v_dodgers_international_value_portfolio is\n  '",
    "comment on view public.v_dodgers_international_value_portfolio is\n  'Migration 034 appends downstream columns and leaves every earlier column unchanged (package_return_dodgers_bwar still sums per signing, so a package with several tracked signings repeats; the package-deduplicated measures group by root_package_key first). package_deduplicated_total_bwar is an observed lineage total (first-hop package value + downstream PLAYER_ATTRIBUTABLE + downstream PACKAGE_ATTRIBUTABLE + CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE intervals, each interval once), not an individually attributable total; only the individually-attributable and total_individually_attributable columns are attributable to a signing. ", 1)
new_port = head.rstrip() + ',\ncore as (\n' + sel + '\n),\n' + EXTRA + '\n' + comment

# ---- value research queue ----------------------------------------------------------------------------------------------------
a = vq.index("  select 'TRADE_RETURN_TIMING_UNRESOLVED'")
c = vq.index("  union all\n  select 'ACQUISITION_COST_INCOMPLETE'")
vq_new = vq[:a] + """  select 'TRADE_RETURN_TIMING_UNRESOLVED', 2, null::text, null::uuid, l.acquisition_event_key,
    format('Incoming %s has a Dodgers stint in the acquisition season that cannot be placed against the acquisition; no sourced chronology fact exists, so the return is not counted', l.asset_name)
  from public.v_transaction_asset_lineage l where l.hop_number = 1 and l.war_state = 'TIMING_UNRESOLVED'
  union all
  select 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE', 3, d.player_slug, d.signing_id, null,
    format('The downstream chain is %s: incomplete data, not a known attribution boundary', d.chain_status)
  from public.v_downstream_organizational_realization d where d.row_grain = 'SIGNING' and d.chain_status like 'INCOMPLETE%'
  union all
  select 'LINEAGE_BOUNDARY_NOTED', 4, null::text, null::uuid, b.acquisition_event_key,
    format('Informational: %s is %s (it was %s earlier on the path); the value is visible and not added to a single root', b.asset_name, b.attribution_level, b.prior_attribution_level)
  from (
    select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name, l.attribution_level, l.prior_attribution_level
    from public.v_transaction_asset_lineage l
    where l.prior_attribution_level is not null and l.attribution_level = 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE' and l.prior_attribution_level <> l.attribution_level
    order by l.interval_key
  ) b
""" + vq[c:]
vq_new = vq_new.replace(
    "incomplete outcomes, and exits with no recorded transaction.",
    "incomplete outcomes, and exits with no recorded transaction. Migration 034 recomputes the trade-return timing and downstream-chain issues from control intervals and lineage, and notes attribution boundaries informationally (LINEAGE_BOUNDARY_NOTED is not missing research).", 1)

# ---- transaction research queue ----------------------------------------------------------------------------------------------
a = tq.index("  select 'TRADE_RETURN_TIMING_UNRESOLVED'")
b = tq.index("  union all\n  select 'TRADE_RETURN_UNRECORDED'")
tq_new = tq[:a] + """  select 'TRADE_RETURN_TIMING_UNRESOLVED', 2, null::text, l.acquisition_event_key, l.asset_name,
    'The incoming player has a Dodgers stint in the acquisition season that cannot be placed against the acquisition; no sourced chronology fact exists, so the return is not counted'
  from public.v_transaction_asset_lineage l where l.hop_number = 1 and l.war_state = 'TIMING_UNRESOLVED'
""" + tq[b:]
marker = "\n)\nselect i.issue, i.priority, i.player_slug, i.event_key, i.asset_name, i.detail from issues i;"
assert marker in tq_new
tq_new = tq_new.replace(marker, """
  union all
  select 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION', 3, null::text, d.exit_event_key, d.display_name,
    'The identity has Dodgers team-season rows after a recorded exit and no recorded acquisition event; the later stint is outside every interval and is not credited to any trade return'
  from (select distinct on (e.interval_key) e.interval_key, e.exit_event_key, e.display_name from public.v_player_control_intervals e
        where e.interval_end is not null and e.bref_id is not null and exists (
          select 1 from public.player_mlb_team_season_war w join public.organizations o on o.id = w.organization_id
          where w.bref_id = e.bref_id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR' and o.franchise_key = 'DODGERS'
            and (w.season > extract(year from e.interval_end)::int
                 or (w.season = extract(year from e.interval_end)::int and extract(month from e.interval_end) <= 2))
            and not exists (select 1 from public.v_player_control_intervals j where j.bref_id = e.bref_id and j.interval_key <> e.interval_key
                  and j.interval_start > e.interval_end and extract(year from j.interval_start) <= w.season
                  and (j.interval_end is null or extract(year from j.interval_end) >= w.season)))
        order by e.interval_key) d
  union all
  select 'DOWNSTREAM_TIMING_UNRESOLVED', 2, null::text, d.acquisition_event_key, d.asset_name,
    'A downstream asset has a Dodgers stint that cannot be placed inside its control interval; its value is not counted'
  from (select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name from public.v_transaction_asset_lineage l
        where l.hop_number > 1 and l.war_state = 'TIMING_UNRESOLVED' order by l.interval_key) d
  union all
  select 'EXIT_NOT_RESEARCHED_DOWNSTREAM', 3, null::text, d.acquisition_event_key, d.asset_name,
    'A downstream asset acquired in a recorded trade has no recorded exit and no observation of continued control'
  from (select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name from public.v_transaction_asset_lineage l
        where l.hop_number > 1 and l.branch_status = 'EXIT_NOT_RESEARCHED' and l.war_state <> 'NO_MLB_APPEARANCE_OBSERVED' order by l.interval_key) d
  union all
  select 'DOWNSTREAM_WAR_NOT_LOADED', 3, null::text, d.acquisition_event_key, d.asset_name,
    'A downstream asset has no loaded team-season facts and no dated no-MLB-appearance observation; its value is unknown, not zero'
  from (select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name from public.v_transaction_asset_lineage l
        where l.hop_number > 1 and l.war_state = 'WAR_NOT_LOADED' order by l.interval_key) d""" + marker, 1)
tq_new = tq_new.replace(
    "'Unresolved transaction research, derived from the facts:",
    "'Unresolved transaction research, derived from the facts (Migration 034 adds the downstream issues EXIT_NOT_RESEARCHED_DOWNSTREAM, DOWNSTREAM_WAR_NOT_LOADED, DOWNSTREAM_TIMING_UNRESOLVED and DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION and recomputes the first-hop timing issue from control intervals):", 1)



def shared(view_sql, ctes):
    # inject shared CTEs ahead of the first CTE and reference them instead of the views; materialize the whole query
    head, body = view_sql.split('\nas\n', 1)
    comment_at = body.index('\ncomment on view')
    q = body[:comment_at].rstrip().rstrip(';')
    tail = body[comment_at:]
    first = q.index('with ') + len('with ')
    q = q[:first] + ctes + q[first:]
    return head + '\nas\nwith m as materialized (\n' + q + '\n)\nselect * from m;\n' + tail


SHARED = "lin as materialized (select * from public.v_transaction_asset_lineage),\n  ivl as materialized (select * from public.v_player_control_intervals),\n  dor as materialized (select * from public.v_downstream_organizational_realization),\n"
vq_new = vq_new.replace('public.v_transaction_asset_lineage l', 'lin l').replace('public.v_downstream_organizational_realization d', 'dor d')
tq_new = tq_new.replace('public.v_transaction_asset_lineage l', 'lin l').replace('public.v_player_control_intervals e', 'ivl e').replace('public.v_player_control_intervals j', 'ivl j')
def wrap(view_sql):
    head, body = view_sql.split('\nas\n', 1)
    comment_at = body.index('\ncomment on view')
    q = body[:comment_at].rstrip().rstrip(';')
    return head + '\nas\nwith m as materialized (\n' + q + '\n)\nselect * from m;\n' + body[comment_at:]


new_port = wrap(new_port)
vq_new = shared(vq_new, SHARED)
tq_new = shared(tq_new, SHARED)
out = new_port.rstrip() + '\n\n' + vq_new.rstrip() + '\n\n' + tq_new.rstrip() + '\n'
open(DEST, 'w', encoding='utf8').write(out)
print('wrote', os.path.relpath(DEST), len(out.split('\n')), 'lines')
