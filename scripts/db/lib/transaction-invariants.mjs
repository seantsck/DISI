// Read-only structural checks for transaction and asset-chain completion (Migration 033).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins research coverage: how many events, resolutions or
// observations exist may grow, and an asset whose identity genuinely cannot be sourced is a research-queue item
// (v_transaction_research_queue), not a verifier failure. `loaded` says whether the 033 objects exist (the same checks then
// run on a canonical 032 database, where every one trivially passes). Nothing here writes.

const EXIT_TYPES = `('TRADE', 'RELEASE', 'WAIVER', 'FREE_AGENCY', 'RULE5_SELECTION', 'EXPANSION_DRAFT', 'SALE')`

export const TRANSACTION_CHECK_NAMES = [
  'transaction_event_shape_violations', 'transaction_asset_shape_violations', 'transaction_asset_identity_consistency_violations',
  'transaction_bref_register_semantics_violations', 'transaction_placeholder_resolution_violations', 'transaction_legacy_reconciliation_violations',
  'transaction_multi_team_counterparty_violations', 'transaction_exit_summary_partition_violations', 'transaction_observation_violations',
  'transaction_return_state_violations', 'transaction_guard_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const transactionQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(TRANSACTION_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // event shape: normalized type from the closed list, a source, a date, and the multi-team flag agrees with the asset counterparties
    transaction_event_shape_violations: `select (
        (select count(*) from public.transaction_events e
          where e.transaction_type not in ('TRADE', 'RELEASE', 'WAIVER', 'SALE', 'OTHER', 'RULE5_SELECTION', 'FREE_AGENCY', 'EXPANSION_DRAFT')
             or e.source_id is null or e.transaction_date is null or e.from_organization_id is null
             or (e.historical_label is not null and nullif(btrim(e.historical_label), '') is null))
      + (select count(*) from public.transaction_events e
          where e.is_multi_team is distinct from (
            (select count(distinct a.counterparty_organization_id) from public.transaction_event_assets a
             where a.event_id = e.id and a.counterparty_organization_id is not null) > 1))
      )::int as n`,

    // asset shape: the closed asset-type list, identity columns only on PLAYER assets, amount columns only on their own asset type
    transaction_asset_shape_violations: `select count(*)::int as n from public.transaction_event_assets a
      where a.asset_type not in ('PLAYER', 'CASH', 'PLAYER_TO_BE_NAMED', 'FUTURE_CONSIDERATIONS', 'INTERNATIONAL_BONUS_POOL_SPACE')
         or a.asset_side not in ('OUTGOING', 'INCOMING')
         or (a.asset_type <> 'PLAYER' and (a.player_id is not null or a.mlb_id is not null or a.bref_id is not null or a.bref_register_id is not null))
         or (a.mlb_id is not null and a.mlb_id !~ '^[0-9]+$')
         or (a.cash_amount_usd is not null and (a.asset_type <> 'CASH' or a.cash_amount_usd < 0))
         or (a.pool_space_amount_usd is not null and (a.asset_type <> 'INTERNATIONAL_BONUS_POOL_SPACE' or a.pool_space_amount_usd < 0))`,

    // identity consistency: a tracked asset agrees with its DISI player; one MLB id is one Baseball-Reference identity and vice versa
    transaction_asset_identity_consistency_violations: `select (
        (select count(*) from public.transaction_event_assets a join public.players p on p.id = a.player_id
          where (a.mlb_id is not null and p.mlb_id is not null and a.mlb_id <> p.mlb_id::text)
             or (a.bref_id is not null and p.bref_id is not null and a.bref_id <> p.bref_id))
      + (select count(*) from (select a.mlb_id from public.transaction_event_assets a where a.mlb_id is not null and a.bref_id is not null
          group by a.mlb_id having count(distinct a.bref_id) > 1) d)
      + (select count(*) from (select a.bref_id from public.transaction_event_assets a where a.bref_id is not null and a.mlb_id is not null
          group by a.bref_id having count(distinct a.mlb_id) > 1) d)
      + (select count(*) from (select a.mlb_id from public.transaction_event_assets a where a.mlb_id is not null and a.bref_register_id is not null
          group by a.mlb_id having count(distinct a.bref_register_id) > 1) d)
      + (select count(*) from public.transaction_event_assets a
          where a.asset_type = 'PLAYER'
            and not (a.bref_id is not null and exists (select 1 from public.player_mlb_team_season_war w where w.bref_id = a.bref_id and w.record_status = 'ACTIVE'))
            and not exists (select 1 from public.dodgers_control_observations o where o.subject_asset_id = a.id and o.record_status = 'ACTIVE'
                            and o.observation_type = 'NO_MLB_APPEARANCE_OBSERVED' and o.observed_through_date is not null)
            and a.asset_side = 'INCOMING' and exists (select 1 from public.transaction_event_assets t where t.event_id = a.event_id and t.asset_side = 'OUTGOING' and t.player_id is not null)
            and exists (select 1 from public.transaction_events e where e.id = a.event_id and e.transaction_type = 'TRADE'))
      )::int as n`,

    // bref_id and bref_register_id are separate namespaces: a Register id never sits in bref_id and a career id never in bref_register_id
    transaction_bref_register_semantics_violations: `select count(*)::int as n from public.transaction_event_assets a
      where (a.bref_id is not null and (a.bref_id !~ '^[a-z0-9]+$' or a.bref_id ~ '[0-9]{3}[a-z]+$'))
         or (a.bref_register_id is not null and (a.bref_register_id !~ '^[a-z][a-z-]{2,5}[0-9]{3}[a-z]{1,4}$' or a.bref_register_id ~ '^[a-z]+[0-9]{2}$'))`,

    // placeholder resolutions: a PTBNL / future-considerations placeholder, the same event and side, an existing PLAYER asset, never itself,
    // at most one ACTIVE resolution per placeholder and per resolved asset, dated no earlier than the transaction, never a rewrite of the placeholder
    transaction_placeholder_resolution_violations: `select (
        (select count(*) from public.transaction_asset_resolutions r
          join public.transaction_event_assets ph on ph.id = r.placeholder_asset_id
          join public.transaction_events e on e.id = ph.event_id
          left join public.transaction_event_assets rs on rs.id = r.resolved_asset_id
          where ph.asset_type not in ('PLAYER_TO_BE_NAMED', 'FUTURE_CONSIDERATIONS')
             or r.resolved_asset_id = r.placeholder_asset_id
             or (r.resolved_asset_id is not null and (rs.id is null or rs.event_id <> ph.event_id or rs.asset_side <> ph.asset_side or rs.asset_type <> 'PLAYER'))
             or (r.resolution_type = 'NAMED_PLAYER' and r.resolved_asset_id is null)
             or (r.resolution_type = 'CASH_SETTLEMENT' and r.resolved_asset_id is not null)
             or r.resolution_date < e.transaction_date
             or (r.record_status = 'RETRACTED') <> (r.retracted_at is not null))
      + (select count(*) from (select placeholder_asset_id from public.transaction_asset_resolutions where record_status = 'ACTIVE'
          group by 1 having count(*) > 1) d)
      + (select count(*) from (select resolved_asset_id from public.transaction_asset_resolutions where record_status = 'ACTIVE' and resolved_asset_id is not null
          group by 1 having count(*) > 1) d)
      )::int as n`,

    // every legacy transaction has a canonical event for the same player, date and type
    transaction_legacy_reconciliation_violations: `select count(*)::int as n from public.transactions t
      where not exists (select 1 from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
        where a.player_id = t.player_id and a.asset_side = 'OUTGOING' and e.transaction_date = t.transaction_date and e.transaction_type = t.transaction_type)`,

    // multi-team events: an event that moved Dodgers assets with one counterparty names it on every asset it moved and agrees with the event's
    // other organization; an exchange with several counterparties is flagged
    transaction_multi_team_counterparty_violations: `select (
        (select count(*) from public.transaction_events e
          where e.transaction_type in ('TRADE', 'RULE5_SELECTION', 'EXPANSION_DRAFT')
            and exists (select 1 from public.transaction_event_assets a where a.event_id = e.id and a.counterparty_organization_id is null))
      + (select count(*) from public.transaction_events e
          where e.transaction_type in ('TRADE', 'RULE5_SELECTION', 'EXPANSION_DRAFT') and not e.is_multi_team
            and exists (select 1 from public.transaction_event_assets a where a.event_id = e.id and a.counterparty_organization_id is distinct from e.to_organization_id))
      + (select count(*) from public.transaction_events e
          where e.is_multi_team and e.to_organization_id is not null
            and not exists (select 1 from public.transaction_event_assets a where a.event_id = e.id and a.counterparty_organization_id = e.to_organization_id))
      )::int as n`,

    // the exit summary is a partition of the tracked Dodgers signings: one row each, exactly one control state, a state consistent with the facts
    transaction_exit_summary_partition_violations: `select (
        (select abs((select count(*) from public.v_dodgers_international_exit_summary) - (select count(*) from public.v_signing_acquisition_financials where is_dodgers)))
      + (select count(*) from (select player_id from public.v_dodgers_international_exit_summary group by 1 having count(*) > 1) d)
      + (select count(*) from public.v_dodgers_international_exit_summary s
          where s.control_state not in ('LEFT_DODGERS_CONTROL', 'STILL_DODGERS_CONTROLLED', 'NO_EXIT_EVIDENCE', 'HISTORY_UNAVAILABLE')
             or (s.control_state = 'LEFT_DODGERS_CONTROL') <> (s.first_exit_event_key is not null)
             or (s.control_state <> 'LEFT_DODGERS_CONTROL' and s.exit_event_count <> 0)
             or (s.control_state = 'LEFT_DODGERS_CONTROL' and s.first_exit_mechanism not in ('TRADE', 'RELEASE', 'WAIVER', 'FREE_AGENCY', 'RULE5_SELECTION', 'EXPANSION_DRAFT', 'SALE')))
      )::int as n`,

    // observations: subject and type agree, boundaries present, one ACTIVE fact per subject / type / boundary, and an observation never contradicts
    // the facts it sits beside (no continued control observed after a recorded exit, no "no MLB appearance" for an identity with loaded MLB team-seasons)
    transaction_observation_violations: `select (
        (select count(*) from public.dodgers_control_observations o
          where (o.subject_player_id is null) = (o.subject_asset_id is null)
             or (o.observation_type = 'HISTORY_UNAVAILABLE' and o.subject_player_id is null)
             or (o.observation_type in ('NO_MLB_APPEARANCE_OBSERVED', 'CAREER_ENDED_WITH_DODGERS', 'EXIT_MECHANISM_UNRECORDED') and o.subject_asset_id is null)
             or o.observed_through_date is null
             or (o.record_status = 'RETRACTED') <> (o.retracted_at is not null)
             or (o.subject_asset_id is not null and not exists (select 1 from public.transaction_event_assets a where a.id = o.subject_asset_id and a.asset_type = 'PLAYER')))
      + (select count(*) from (select subject_player_id, observation_type, observed_through_date from public.dodgers_control_observations
          where record_status = 'ACTIVE' and subject_player_id is not null group by 1, 2, 3 having count(*) > 1) d)
      + (select count(*) from (select subject_asset_id, observation_type, observed_through_date from public.dodgers_control_observations
          where record_status = 'ACTIVE' and subject_asset_id is not null group by 1, 2, 3 having count(*) > 1) d)
      + (select count(*) from public.dodgers_control_observations o
          where o.record_status = 'ACTIVE' and o.observation_type in ('DODGERS_CONTROL_OBSERVED', 'HISTORY_UNAVAILABLE') and o.subject_player_id is not null
            and exists (select 1 from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
                        where a.player_id = o.subject_player_id and a.asset_side = 'OUTGOING' and e.transaction_type in ${EXIT_TYPES}))
      + (select count(*) from public.dodgers_control_observations o join public.transaction_event_assets a on a.id = o.subject_asset_id
          where o.record_status = 'ACTIVE' and o.observation_type = 'DODGERS_CONTROL_OBSERVED'
            and exists (select 1 from public.transaction_event_assets x join public.transaction_events e2 on e2.id = x.event_id
                        join public.transaction_events e1 on e1.id = a.event_id
                        where x.asset_side = 'OUTGOING' and e2.transaction_date > e1.transaction_date and e2.transaction_type in ${EXIT_TYPES}
                          and ((a.mlb_id is not null and x.mlb_id = a.mlb_id) or (a.bref_id is not null and x.bref_id = a.bref_id))))
      + (select count(*) from public.dodgers_control_observations o join public.transaction_event_assets a on a.id = o.subject_asset_id
          where o.record_status = 'ACTIVE' and o.observation_type = 'NO_MLB_APPEARANCE_OBSERVED' and a.bref_id is not null
            and exists (select 1 from public.player_mlb_team_season_war w where w.bref_id = a.bref_id and w.record_status = 'ACTIVE'))
      )::int as n`,

    // return states: a no-player return is verified (an incoming package with no PLAYER and no unresolved player placeholder) and contributes 0;
    // an unrecorded or pending return and a timing-unresolved one are never zero; a zero from observation carries its boundary
    transaction_return_state_violations: `select count(*)::int as n from public.v_trade_realization_edges e
      where e.return_state not in ('LOADED', 'NO_MLB_APPEARANCE_OBSERVED', 'NO_PLAYER_RETURN', 'PLAYER_RETURN_PENDING', 'RETURN_UNRECORDED', 'RETURN_WAR_UNKNOWN', 'TIMING_UNRESOLVED')
         or (e.return_state = 'NO_PLAYER_RETURN' and (e.incoming_asset_id is not null or e.incoming_asset_count = 0 or e.incoming_unresolved_ptbnl_count > 0
              or e.incoming_dodgers_bwar is distinct from 0))
         or (e.return_state in ('RETURN_UNRECORDED', 'PLAYER_RETURN_PENDING') and (e.incoming_asset_id is not null or e.incoming_dodgers_bwar is not null))
         or (e.return_state = 'RETURN_UNRECORDED' and e.incoming_asset_count <> 0)
         or (e.return_state = 'PLAYER_RETURN_PENDING' and e.incoming_unresolved_ptbnl_count = 0)
         or (e.return_state in ('TIMING_UNRESOLVED', 'RETURN_WAR_UNKNOWN') and e.incoming_dodgers_bwar is not null)
         or (e.return_state = 'NO_MLB_APPEARANCE_OBSERVED' and (e.no_mlb_appearance_observed_through is null or e.incoming_dodgers_bwar is distinct from 0))`,

    // sealing triggers cover INSERT, UPDATE and DELETE on both tables; guards are invoker-rights with no API EXECUTE; RLS and SELECT-only grants
    transaction_guard_violations: `select (
        (select 2 - count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
          where c.relnamespace = 'public'::regnamespace and c.relname in ('transaction_asset_resolutions', 'dodgers_control_observations')
            and not t.tgisinternal and t.tgenabled <> 'D' and (t.tgtype & 28) = 28
            and t.tgname in ('transaction_asset_resolutions_guard', 'dodgers_control_observations_guard'))
      + (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('disi_asset_resolution_guard', 'disi_control_observation_guard')
          and (p.prosecdef or not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
               or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')))
      + (select 2 - count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('disi_asset_resolution_guard', 'disi_control_observation_guard'))
      + (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('transaction_asset_resolutions', 'dodgers_control_observations') and not c.relrowsecurity)
      )::int as n`,
  }
}

export const TRANSACTION_QUERIES = transactionQueries(true)
