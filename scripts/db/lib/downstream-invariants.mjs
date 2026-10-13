// Read-only structural and semantic checks for downstream organizational value chains (Migration 034).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins research coverage or a mutable total: how many chains,
// intervals or packages exist may grow, and a chain that is incomplete for lack of data is a research-queue item, not a
// verifier failure. `loaded` says whether the 034 objects exist (the same checks then run on a canonical 033 database,
// where every one trivially passes). Nothing here writes.

const LEVELS = `(values ('PLAYER_ATTRIBUTABLE', 0), ('PACKAGE_ATTRIBUTABLE', 1), ('CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE', 2), ('UNRESOLVED', 3))`

export const DOWNSTREAM_CHECK_NAMES = [
  'downstream_timing_observation_violations', 'downstream_interval_chronology_violations', 'downstream_interval_overlap_violations',
  'downstream_lineage_path_violations', 'downstream_reacquisition_lineage_violations', 'downstream_attribution_monotonic_violations',
  'downstream_player_attribution_boundary_violations', 'downstream_outgoing_consideration_violations', 'downstream_unresolved_attribution_violations',
  'downstream_package_additivity_violations', 'downstream_package_key_violations', 'downstream_observed_zero_violations',
  'downstream_interval_war_double_count_violations', 'downstream_legacy_column_violations', 'downstream_total_attributable_violations',
  'downstream_guard_violations', 'downstream_timing_basis_violations', 'downstream_exit_basis_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const downstreamQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(DOWNSTREAM_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // timing facts: shape by type, an incoming PLAYER asset of the named event, never dated before the acquisition, one ACTIVE fact per
    // asset / type / season, retraction consistent
    downstream_timing_observation_violations: `select (
        (select count(*) from public.transaction_asset_timing_observations t
          join public.transaction_event_assets a on a.id = t.subject_asset_id
          join public.transaction_events e on e.id = a.event_id
          where a.asset_type <> 'PLAYER' or a.asset_side <> 'INCOMING' or t.event_id <> a.event_id or t.observed_date < e.transaction_date
             or (t.fact_type = 'EXIT_BOUNDED_BEFORE') <> (t.season is null)
             or (t.season is not null and extract(year from t.observed_date)::int <> t.season)
             or (t.record_status = 'RETRACTED') <> (t.retracted_at is not null))
      + (select count(*) from (select subject_asset_id, fact_type, coalesce(season, 0) from public.transaction_asset_timing_observations
          where record_status = 'ACTIVE' group by 1, 2, 3 having count(*) > 1) d)
      )::int as n`,

    // an interval never ends before it starts
    downstream_interval_chronology_violations: `select count(*)::int as n from public.v_player_control_intervals i
      where (i.interval_end is not null and i.interval_end <= i.interval_start)
         or (i.exit_event_key is not null and i.interval_end is null)
         or (i.exit_bounded_before_date is not null and i.interval_end is not null)`,

    // intervals of one identity never overlap: a later interval starts only after the earlier one ended
    downstream_interval_overlap_violations: `select count(*)::int as n from public.v_player_control_intervals a
      join public.v_player_control_intervals b on b.interval_key <> a.interval_key and b.interval_start > a.interval_start
        and ((a.player_id is not null and b.player_id = a.player_id) or (a.mlb_id is not null and b.mlb_id = a.mlb_id)
          or (a.bref_id is not null and b.bref_id = a.bref_id) or (a.bref_register_id is not null and b.bref_register_id = a.bref_register_id))
      where a.interval_end is null or a.interval_end > b.interval_start`,

    // lineage paths: hop equals path length, no event twice in one path, parent paths exist, a path key is unique
    downstream_lineage_path_violations: `select (
        (select count(*) from public.v_transaction_asset_lineage l
          where cardinality(l.path_event_keys) <> l.hop_number
             or (select count(distinct x) from unnest(l.path_event_keys) x) <> cardinality(l.path_event_keys))
      + (select count(*) from (select path_key from public.v_transaction_asset_lineage group by 1 having count(*) > 1) d)
      + (select count(*) from public.v_transaction_asset_lineage l
          where l.parent_path_key is not null and not exists (select 1 from public.v_transaction_asset_lineage p where p.path_key = l.parent_path_key and p.hop_number = l.hop_number - 1))
      )::int as n`,

    // a downstream asset is acquired in the very event in which its parent left, never earlier than the parent's acquisition; a later
    // reacquisition (a different acquisition event of the same identity) is never a child of the earlier interval
    downstream_reacquisition_lineage_violations: `select (
        (select count(*) from public.v_transaction_asset_lineage l
          join public.v_transaction_asset_lineage p on p.path_key = l.parent_path_key
          where l.acquisition_event_key is distinct from p.exit_event_key or l.acquisition_date < p.acquisition_date
             or p.exit_type <> 'TRADE')
      + (select count(*) from public.v_transaction_asset_lineage l
          join public.transaction_events e on e.event_key = l.acquisition_event_key
          where e.transaction_type <> 'TRADE')
      )::int as n`,

    // attribution only degrades along a path
    downstream_attribution_monotonic_violations: `select count(*)::int as n from public.v_transaction_asset_lineage l
      join public.v_transaction_asset_lineage p on p.path_key = l.parent_path_key
      join ${LEVELS} lv(name, n) on lv.name = l.attribution_level
      join ${LEVELS} pv(name, n) on pv.name = p.attribution_level
      where lv.n < pv.n`,

    // PLAYER_ATTRIBUTABLE only where the event that brought the asset sent exactly one outgoing asset (the root, or the parent alone)
    downstream_player_attribution_boundary_violations: `select count(*)::int as n from public.v_transaction_asset_lineage l
      join public.transaction_events e on e.event_key = l.acquisition_event_key
      where l.attribution_level = 'PLAYER_ATTRIBUTABLE'
        and ((select count(*) from public.transaction_event_assets x where x.event_id = e.id and x.asset_side = 'OUTGOING') <> 1
             or l.root_signing_count <> 1)`,

    // outgoing cash, pool space, placeholders and any other consideration always degrade at least to PACKAGE_ATTRIBUTABLE
    downstream_outgoing_consideration_violations: `select count(*)::int as n from public.v_transaction_asset_lineage l
      join public.transaction_events e on e.event_key = l.acquisition_event_key
      where l.attribution_level = 'PLAYER_ATTRIBUTABLE'
        and exists (select 1 from public.transaction_event_assets x where x.event_id = e.id and x.asset_side = 'OUTGOING' and x.asset_type <> 'PLAYER')`,

    // an interval with unresolved identity or timing is UNRESOLVED and carries no value; UNRESOLVED is never additive
    downstream_unresolved_attribution_violations: `select count(*)::int as n from public.v_transaction_asset_lineage l
      where (l.war_state in ('IDENTITY_UNRESOLVED', 'TIMING_UNRESOLVED') and (l.attribution_level <> 'UNRESOLVED' or l.interval_bounded_dodgers_bwar is not null))
         or (l.war_state in ('WAR_NOT_LOADED') and l.interval_bounded_dodgers_bwar is not null)`,

    // package lineage: one row per package x interval, additive only for PLAYER / PACKAGE attribution with a value, and the
    // package row of the realization view agrees with it (a shared package contributes once)
    downstream_package_additivity_violations: `select (
        (select count(*) from (select root_package_key, interval_key from public.v_transaction_package_lineage group by 1, 2 having count(*) > 1) d)
      + (select count(*) from public.v_transaction_package_lineage p
          where p.is_additive_to_package_total is distinct from (p.attribution_level in ('PLAYER_ATTRIBUTABLE', 'PACKAGE_ATTRIBUTABLE') and p.interval_bounded_dodgers_bwar is not null))
      + (select count(*) from (select root_package_key from public.v_downstream_organizational_realization where row_grain = 'PACKAGE' group by 1 having count(*) > 1) d)
      + (select count(*) from public.v_downstream_organizational_realization r
          where r.row_grain = 'PACKAGE' and r.interval_bounded_first_hop_package_bwar is not null
            and abs(r.interval_bounded_first_hop_package_bwar - coalesce((select sum(p.interval_bounded_dodgers_bwar) from public.v_transaction_package_lineage p
              where p.root_package_key = r.root_package_key and p.is_first_hop), 0)) > 0.005)
      + (select count(*) from public.v_downstream_organizational_realization r
          where r.row_grain = 'PACKAGE' and r.root_package_key not in (select root_package_key from public.v_transaction_asset_lineage)
            and r.max_observed_hop <> 0)
      )::int as n`,

    // the package key is the root event plus the sorted tracked outgoing slugs, nothing else, and is unique per event
    downstream_package_key_violations: `select (
        (select count(*) from (
          select e.event_key || '|' || string_agg(p.slug, ',' order by p.slug) as k
          from public.transaction_events e
          join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = 'OUTGOING' and a.player_id is not null
          join public.players p on p.id = a.player_id
          where e.transaction_type = 'TRADE' group by e.event_key) r
          where not exists (select 1 from public.v_downstream_organizational_realization d where d.row_grain = 'PACKAGE' and d.root_package_key = r.k))
      + (select count(*) from public.v_downstream_organizational_realization d
          where d.row_grain = 'PACKAGE' and d.root_package_key !~ '^[^|]+[|][a-z0-9-]+(,[a-z0-9-]+)*$')
      )::int as n`,

    // a verified zero is valid only through a dated observation; an unresolved, unloaded or unidentified interval is never zero
    downstream_observed_zero_violations: `select count(*)::int as n from public.v_player_control_intervals i
      where (i.war_state = 'NO_MLB_APPEARANCE_OBSERVED' and (i.no_mlb_appearance_observed_through is null or i.interval_bounded_dodgers_bwar is distinct from 0))
         or (i.war_state in ('TIMING_UNRESOLVED', 'WAR_NOT_LOADED', 'IDENTITY_UNRESOLVED', 'NO_TEAM_SEASON_FACTS') and i.interval_bounded_dodgers_bwar is not null)
         or (i.war_state = 'LOADED' and i.interval_bounded_dodgers_bwar is null)`,

    // a team-season row is credited to at most one interval of an identity: the interval row counts never add up to more than the
    // identity's loaded Dodgers team-season rows (so re-entry and outside-lineage value cannot leak into another interval)
    downstream_interval_war_double_count_violations: `select count(*)::int as n from (
        select i.bref_id, sum(i.dodgers_rows_in_interval) as s
        from public.v_player_control_intervals i
        where i.bref_id is not null
        group by i.bref_id
      ) q
      join lateral (
        select count(*) as total
        from public.player_mlb_team_season_war w join public.organizations o on o.id = w.organization_id
        where w.bref_id = q.bref_id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR' and o.franchise_key = 'DODGERS'
      ) t on true
      where q.s > t.total`,

    // the 032 / 033 first-hop columns and the direct value are preserved, and the portfolio keeps its legacy columns
    downstream_legacy_column_violations: `select (
        (select count(*) from public.v_downstream_organizational_realization d
          join public.v_player_organizational_realization r on r.player_id = d.player_id
          where d.row_grain = 'SIGNING'
            and (d.direct_dodgers_mlb_bwar is distinct from r.direct_dodgers_mlb_bwar
              or d.legacy_first_hop_return_bwar is distinct from r.trade_package_return_dodgers_bwar
              or d.legacy_individually_attributable_first_hop_bwar is distinct from r.individually_attributable_trade_return_bwar
              or d.legacy_package_attribution_state is distinct from r.package_attribution_state))
      + (select count(*) from public.v_player_organizational_realization r
          where r.player_id not in (select d.player_id from public.v_downstream_organizational_realization d where d.row_grain = 'SIGNING'))
      + (select 12 - count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'v_dodgers_international_value_portfolio'
            and column_name in ('grain', 'grain_value', 'tracked_signings', 'direct_ratio_eligible_signings', 'attributable_ratio_eligible_signings',
              'aggregate_direct_dodgers_bwar_per_million', 'aggregate_attributable_organizational_bwar_per_million', 'attributable_trade_return_bwar',
              'package_return_dodgers_bwar', 'non_dodgers_mlb_bwar_observed', 'eligible_direct_dodgers_bwar', 'eligible_attributable_organizational_bwar'))
      )::int as n`,

    // total individually attributable = direct + PLAYER_ATTRIBUTABLE first hop + PLAYER_ATTRIBUTABLE downstream; package, mixed and
    // unresolved value are never added; negative values stay negative
    downstream_total_attributable_violations: `select count(*)::int as n from public.v_downstream_organizational_realization d
      where d.row_grain = 'SIGNING'
        and ((d.total_individually_attributable_organizational_bwar is not null and d.direct_dodgers_mlb_bwar is null)
          or (d.total_individually_attributable_organizational_bwar is not null and d.direct_dodgers_mlb_bwar is not null
              and abs(d.total_individually_attributable_organizational_bwar - (d.direct_dodgers_mlb_bwar
                + coalesce(d.interval_bounded_individually_attributable_first_hop_bwar, 0) + coalesce(d.downstream_individually_attributable_bwar, 0))) > 0.005))`,

    // acquisition-season chronology is resolved only on an accepted basis: the calendar, no Dodgers stint that season, the counterparty
    // stint order, or a sourced timing fact; a single team row, a single stint or the absence of an earlier modeled interval is not evidence
    downstream_timing_basis_violations: `select count(*)::int as n from public.v_player_control_intervals i
      where (i.war_state = 'LOADED' and (i.timing_resolution_basis is null or i.timing_resolution_basis not in
              ('TRACKED_SIGNING', 'NO_ACQUISITION_SEASON_DODGERS_STINT', 'CALENDAR', 'TIMING_OBSERVATION', 'COUNTERPARTY_STINT_ORDER')))
         or (i.timing_resolution_basis = 'UNRESOLVED' and (i.war_state <> 'TIMING_UNRESOLVED' or i.interval_bounded_dodgers_bwar is not null))
         or (i.timing_resolution_basis = 'TIMING_OBSERVATION' and not exists (
              select 1 from public.transaction_asset_timing_observations t where t.subject_asset_id = i.start_asset_id and t.record_status = 'ACTIVE'
                and t.fact_type in ('FIRST_DODGERS_APPEARANCE', 'SEASON_START_CONFIRMS_POST_ACQUISITION')))`,

    // exit-side chronology: a Dodgers stint is placed before an exit only from an exact-dated exit event, in an offseason, with no Dodgers
    // stint that season, or as one contiguous stint with no same-season re-entry; never from an approximate exit date
    downstream_exit_basis_violations: `select count(*)::int as n from public.v_player_control_intervals i
      where i.exit_event_key is not null
        and ((i.war_state = 'LOADED' and (i.exit_resolution_basis is null or i.exit_resolution_basis not in
              ('NO_EXIT_SEASON_DODGERS_STINT', 'OFFSEASON_AFTER_SEASON', 'OFFSEASON_BEFORE_SEASON', 'SINGLE_STINT_BEFORE_EXIT')))
          or (i.exit_resolution_basis = 'SINGLE_STINT_BEFORE_EXIT' and not i.exit_date_is_exact)
          or (i.exit_resolution_basis = 'UNRESOLVED' and (i.war_state <> 'TIMING_UNRESOLVED' or i.interval_bounded_dodgers_bwar is not null)))`,

    // sealing trigger on INSERT / UPDATE / DELETE, invoker-rights guard with no API EXECUTE, RLS and SELECT-only access
    downstream_guard_violations: `select (
        (select 1 - count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and c.relname = 'transaction_asset_timing_observations'
            and not t.tgisinternal and t.tgenabled <> 'D' and (t.tgtype & 28) = 28 and t.tgname = 'transaction_asset_timing_observations_guard')
      + (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_timing_observation_guard'
          and (p.prosecdef or not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
               or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')))
      + (select 1 - count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_timing_observation_guard')
      + (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = 'transaction_asset_timing_observations' and not c.relrowsecurity)
      + (select count(*) from pg_policies where schemaname = 'public' and tablename = 'transaction_asset_timing_observations' and cmd <> 'SELECT')
      )::int as n`,
  }
}

export const DOWNSTREAM_QUERIES = downstreamQueries(true)
