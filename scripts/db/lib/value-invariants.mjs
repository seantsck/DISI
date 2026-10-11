// Read-only structural checks for player value and organizational realization (Migration 032).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins research coverage: how many players
// have team-season facts may grow. `loaded` says whether the 032 objects exist (the same checks then run on a
// canonical 031 database, where every one trivially passes). Nothing here writes.

const TOL = '0.1'

/** name -> SQL returning one row { n } = number of violations. */
export const valueQueries = (loaded) => {
  if (!loaded) {
    return Object.fromEntries(VALUE_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  }
  return {
    // fact shape: bWAR only, BAT / PITCH, season within the observed window, lifecycle consistency, one ACTIVE row per key
    value_team_season_shape_violations: `select (
        (select count(*) from public.player_mlb_team_season_war w
          where w.war_system <> 'BWAR' or w.component not in ('BAT', 'PITCH') or w.bref_id !~ '^[a-z0-9]+$' or w.season > w.observed_through_season
             or w.stint_ordinal < 1 or w.record_status not in ('ACTIVE', 'RETRACTED')
             or (w.record_status = 'RETRACTED' and (w.retracted_at is null or nullif(btrim(w.retraction_reason), '') is null))
             or (w.record_status = 'ACTIVE' and (w.retracted_at is not null or w.retraction_reason is not null))
             or (w.supersedes_record_id is not null and (w.supersedes_record_id = w.id or not exists (select 1 from public.player_mlb_team_season_war o
                  where o.id = w.supersedes_record_id and o.bref_id = w.bref_id and o.season = w.season and o.bref_team_code = w.bref_team_code
                    and o.stint_ordinal = w.stint_ordinal and o.component = w.component and o.record_status = 'RETRACTED')))
             or exists (select 1 from public.player_mlb_team_season_war x where x.supersedes_record_id = w.supersedes_record_id and x.id <> w.id and w.supersedes_record_id is not null))
      + (select count(*) from (select 1 from public.player_mlb_team_season_war where record_status = 'ACTIVE'
          group by bref_id, season, bref_team_code, stint_ordinal, component having count(*) > 1) d)
      + (select count(*) from public.player_mlb_team_season_war w where w.player_id is not null
          and not exists (select 1 from public.players p where p.id = w.player_id and p.bref_id = w.bref_id))
      )::int as n`,

    // every ACTIVE row resolves exactly as the map says; NULL only where no mapping covers the code and season
    value_team_code_resolution_violations: `select count(*)::int as n from public.player_mlb_team_season_war w
      left join lateral (select m.organization_id from public.bref_team_code_map m where m.bref_team_code = w.bref_team_code
        and w.season >= m.from_season and w.season <= coalesce(m.to_season, 9999) order by m.from_season desc limit 1) m on true
      where w.record_status = 'ACTIVE' and w.organization_id is distinct from m.organization_id`,

    // the map itself: sane ranges, no overlap for one code
    value_team_code_map_violations: `select (
        (select count(*) from public.bref_team_code_map m where m.to_season is not null and m.to_season < m.from_season)
      + (select count(*) from public.bref_team_code_map a join public.bref_team_code_map b on a.bref_team_code = b.bref_team_code and a.id < b.id
          where a.from_season <= coalesce(b.to_season, 9999) and b.from_season <= coalesce(a.to_season, 9999))
      )::int as n`,

    // loaded team-season totals reconcile with the legacy career-WAR stores, and the two legacy stores agree
    value_career_reconciliation_violations: `select count(*)::int as n from (
        select p.id, sum(w.war) as total, oc.career_war as outcomes_war,
          (select x.value from public.player_metric_observations x where x.player_id = p.id and x.metric_key = 'CAREER_BWAR' order by x.observed_through_date desc limit 1) as metric_war
        from public.players p join public.player_mlb_team_season_war w on w.player_id = p.id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
        left join public.outcomes oc on oc.player_id = p.id
        group by p.id, oc.career_war) t
      where coalesce(t.metric_war, t.outcomes_war) is null or abs(t.total - coalesce(t.metric_war, t.outcomes_war)) > ${TOL}
         or (t.metric_war is not null and t.outcomes_war is not null and abs(t.metric_war - t.outcomes_war) > ${TOL})`,

    // a bref_id on a trade asset belongs to a PLAYER asset whose identity has loaded team-season facts
    value_event_asset_identity_violations: `select count(*)::int as n from public.transaction_event_assets a
      where a.bref_id is not null and (a.asset_type <> 'PLAYER' or a.bref_id !~ '^[a-z0-9]+$'
        or not exists (select 1 from public.player_mlb_team_season_war w where w.bref_id = a.bref_id and w.record_status = 'ACTIVE'))`,

    // attribution shape: an individual trade-return share exists only for a sole outgoing asset; non-Dodgers value is never added;
    // zero is used only where the team history is loaded and reconciled or the outcome is audited as no MLB career
    value_attribution_shape_violations: `select count(*)::int as n from public.v_player_organizational_realization r
      where (r.individually_attributable_trade_return_bwar is not null and r.package_attribution_state <> 'SOLE_OUTGOING_ATTRIBUTABLE')
         or (r.package_attribution_state = 'SHARED_PACKAGE_NOT_ATTRIBUTABLE' and r.individually_attributable_trade_return_bwar is not null)
         or (r.attributable_organizational_bwar is not null and r.package_attribution_state <> 'RETURN_WAR_UNKNOWN'
             and r.attributable_organizational_bwar is distinct from r.direct_dodgers_mlb_bwar + coalesce(r.individually_attributable_trade_return_bwar, 0))
         or (r.attributable_organizational_bwar is not null and r.direct_dodgers_mlb_bwar is null)
         or (r.direct_dodgers_mlb_bwar is not null and r.team_history_status not in ('LOADED_RECONCILED', 'NOT_APPLICABLE_NO_MLB'))
         or (r.team_history_status = 'LOADED_RECONCILED' and r.direct_dodgers_mlb_bwar is null)`,

    // trade-return timing: a resolved return never includes a deterministically pre-acquisition Dodgers stint (post + excluded pre equals
    // every Dodgers row), an unresolved timing leaves the return NULL, and a LOADED return always has a value
    value_trade_return_timing_violations: `select count(*)::int as n from public.v_trade_realization_edges e
      where (e.incoming_dodgers_bwar is not null and e.same_season_timing_resolved is not true)
         or (e.incoming_war_status = 'TIMING_UNRESOLVED' and e.incoming_dodgers_bwar is not null)
         or (e.incoming_war_status = 'LOADED' and e.incoming_dodgers_bwar is null)
         or (e.incoming_dodgers_bwar is not null and e.incoming_dodgers_bwar + e.pre_acquisition_dodgers_bwar_excluded is distinct from (
              select coalesce(sum(w.war), 0) from public.player_mlb_team_season_war w join public.organizations o on o.id = w.organization_id
              where w.bref_id = e.incoming_bref_id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR' and o.franchise_key = 'DODGERS'))`,

    // cost gating: a ratio exists only for COMPLETE cost greater than zero, an observed outcome and a mature signing; and no ratio uses another denominator
    value_cost_gating_violations: `select (
        (select count(*) from public.v_player_organizational_realization r
          where (r.direct_dodgers_bwar_per_million is not null or r.attributable_organizational_bwar_per_million is not null)
            and not (r.acquisition_cost_completeness = 'COMPLETE' and r.known_acquisition_cost_usd > 0 and r.direct_dodgers_mlb_bwar is not null and r.maturity_status = 'MATURE'))
      + (select count(*) from public.v_player_organizational_realization r
          where r.direct_dodgers_bwar_per_million is not null
            and r.direct_dodgers_bwar_per_million is distinct from round(r.direct_dodgers_mlb_bwar / (r.known_acquisition_cost_usd / 1000000.0), 3))
      + (select count(*) from public.v_dodgers_international_value_portfolio p
          where (p.aggregate_direct_dodgers_bwar_per_million is not null and p.direct_ratio_eligible_signings = 0)
             or (p.aggregate_attributable_organizational_bwar_per_million is not null and p.attributable_ratio_eligible_signings = 0))
      )::int as n`,

    // status semantics: failures are never inferred from recency or openness; one row per Dodgers signing
    value_status_semantics_violations: `select (
        (select count(*) from public.v_player_organizational_realization r
          where (r.organizational_realization_status = 'NO_MLB_VALUE_OBSERVED' and not (r.outcome_state = 'NO_MLB_CAREER_ENDED' and r.maturity_status = 'MATURE'))
             or (r.organizational_realization_status = 'STILL_DEVELOPING' and r.outcome_state is distinct from 'NO_MLB_ACTIVE_IN_MINORS')
             or (r.organizational_realization_status = 'DIRECT_DODGERS_MLB_VALUE' and coalesce(r.dodgers_mlb_team_seasons, 0) = 0)
             or (r.organizational_realization_status = 'MLB_ELSEWHERE_ONLY' and (coalesce(r.dodgers_mlb_team_seasons, 0) > 0 or coalesce(r.non_dodgers_mlb_team_seasons, 0) = 0))
             or (r.organizational_realization_status = 'TOO_RECENT_TO_EVALUATE' and r.maturity_status = 'MATURE' and r.reached_mlb_verified is not true))
      + (select abs((select count(*) from public.v_player_organizational_realization) - (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id
          and o.franchise_key = 'DODGERS')))
      )::int as n`,

    // the sealing trigger covers INSERT, UPDATE and DELETE; the guard function is invoker-rights with no API EXECUTE
    value_guard_violations: `select (
        (select 1 - count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and c.relname = 'player_mlb_team_season_war' and not t.tgisinternal and t.tgenabled <> 'D' and (t.tgtype & 28) = 28
            and t.tgname = 'player_mlb_team_season_war_guard')
      + (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_team_season_war_guard'
          and (p.prosecdef or not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
               or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')))
      + (select case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_team_season_war_guard') then 0 else 1 end)
      )::int as n`,
  }
}

export const VALUE_CHECK_NAMES = [
  'value_team_season_shape_violations', 'value_team_code_resolution_violations', 'value_team_code_map_violations', 'value_career_reconciliation_violations',
  'value_event_asset_identity_violations', 'value_attribution_shape_violations', 'value_trade_return_timing_violations', 'value_cost_gating_violations', 'value_status_semantics_violations', 'value_guard_violations',
]
export const VALUE_QUERIES = valueQueries(true)
