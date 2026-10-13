-- Read-only: identifies which Migration 034 revision a database holds (d3d9e85 / 1ac2f75 / b0c7f37 / 1edf314) from view definitions.
select c.relname as view_name,
  (select count(*) from regexp_matches(pg_get_viewdef(c.oid), 'as materialized', 'gi'))::int as materialized_ctes,
  (select count(*) from regexp_matches(pg_get_viewdef(c.oid), 'v_downstream_organizational_realization', 'g'))::int as realization_refs
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
  and c.relname in ('v_dodgers_international_value_portfolio', 'v_downstream_organizational_realization', 'v_player_control_intervals',
    'v_transaction_asset_lineage', 'v_transaction_package_lineage', 'v_transaction_research_queue', 'v_value_research_queue')
order by 1;
