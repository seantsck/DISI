// Read-only structural and semantic checks for the signing-network outcome layer (Migration 038).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins how many associations are documented: network research may
// grow. `loaded` says whether the 038 views exist (the same checks then trivially pass on a canonical 037 database).

export const NETWORK_OUTCOME_CHECK_NAMES = [
  'network_outcome_row_violations', 'network_outcome_passthrough_violations', 'network_outcome_attribution_violations',
  'network_outcome_census_claim_violations', 'network_outcome_cost_gating_violations', 'network_outcome_coverage_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const networkOutcomeQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(NETWORK_OUTCOME_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // exactly one row per ACTIVE relationship; RETRACTED rows are never read
    network_outcome_row_violations: `select (
        abs((select count(*) from public.v_network_player_outcomes) - (select count(*) from public.player_network_relationships where record_status = 'ACTIVE'))
      + (select count(*) from public.v_network_player_outcomes x join public.player_network_relationships pr on pr.id = x.relationship_id where pr.record_status <> 'ACTIVE')
      + (select count(*) from (select relationship_id from public.v_network_player_outcomes group by 1 having count(*) > 1) d)
      )::int as n`,

    // outcome columns are the spine's, unchanged
    network_outcome_passthrough_violations: `select count(*)::int as n from public.v_network_player_outcomes x
      join public.v_player_realized_outcome r on r.player_id = x.player_id
      where x.reached_mlb_verified is distinct from r.reached_mlb_verified or x.career_bwar is distinct from r.career_bwar
         or x.dodgers_bwar is distinct from r.signing_org_bwar or x.non_dodgers_bwar is distinct from r.elsewhere_bwar
         or x.outcome_maturity is distinct from r.outcome_maturity`,

    // the association grade follows its stated rule; HIGH needs a signing link, a pre/at-signing stage and HIGH / VERIFIED confidence
    network_outcome_attribution_violations: `select count(*)::int as n from public.v_network_player_outcomes x
      where x.attribution_confidence is distinct from case
        when x.signing_linked and x.stage in ('PRE_SIGNING', 'AT_SIGNING') and x.relationship_confidence in ('VERIFIED', 'HIGH') then 'HIGH'
        when x.signing_linked or x.relationship_confidence in ('VERIFIED', 'HIGH') then 'MEDIUM'
        else 'LOW' end`,

    // no entity summary claims a denominator, a census or a comparison; the sample state follows the mature audited count
    network_outcome_census_claim_violations: `select count(*)::int as n from public.v_network_outcome_summary s
      where s.denominator_known or s.comparison_label <> 'NO_COMPARISON_DENOMINATOR_UNKNOWN'
         or s.network_sample_state is distinct from case when s.mature_audited_signees < 3 then 'ANECDOTAL'
              when s.mature_audited_signees < 10 then 'SMALL_SAMPLE' else 'DESCRIPTIVE_SAMPLE' end
         or s.mature_audited_signees > s.mature_signees or s.mature_signees > s.tracked_signees or s.reached_mlb > s.audited_signees`,

    // a cost total only when every signee's acquisition cost is COMPLETE
    network_outcome_cost_gating_violations: `select count(*)::int as n from public.v_network_outcome_summary s
      where (s.complete_acquisition_cost_usd is not null and s.cost_complete_signees <> s.tracked_signees)
         or (s.cost_coverage = 'COMPLETE') <> (s.cost_complete_signees = s.tracked_signees)
         or (s.cost_coverage = 'NONE') <> (s.cost_complete_signees = 0)`,

    // every segment shows both states, partitions the Dodgers signings, and is labelled selection-biased
    network_outcome_coverage_violations: `select (
        (select count(*) from public.v_network_outcome_coverage where comparison_label <> 'DESCRIPTIVE_ONLY_SELECTION_BIASED')
      + (select count(*) from (select segment_kind, segment_value from public.v_network_outcome_coverage group by 1, 2 having count(*) <> 2) d)
      + (select count(*) from (select segment_kind, sum(signings) as n from public.v_network_outcome_coverage group by 1) d
          where d.n <> (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS'))
      + abs((select signings from public.v_network_outcome_coverage where segment_kind = 'ALL' and network_state = 'KNOWN_NETWORK_SAMPLE')
          - (select count(distinct pr.player_id) from public.player_network_relationships pr join public.signings s on s.player_id = pr.player_id
              join public.organizations o on o.id = s.organization_id where pr.record_status = 'ACTIVE' and o.franchise_key = 'DODGERS'))
      )::int as n`,
  }
}

export const NETWORK_OUTCOME_QUERIES = networkOutcomeQueries(true)
