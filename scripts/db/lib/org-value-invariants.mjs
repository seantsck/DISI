// Read-only structural and semantic checks for realized and expected organizational value (Migration 042).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins how much value exists or whether an expected value is
// supported: support moves as outcomes are audited. What is checked is the rule: realized components stay separate, cost ratios need
// complete cost, historical distributions stay descriptive, and an expected value exists only when every upstream input is supported.
// `loaded` says whether the 042 objects exist.

export const ORG_VALUE_CHECK_NAMES = [
  'realized_value_row_violations', 'realized_value_cost_violations', 'historical_value_distribution_violations',
  'expected_value_support_violations', 'expected_value_propagation_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const orgValueQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(ORG_VALUE_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // one row per Dodgers signing; the realized total is direct + individually attributable only, and exists only for a resolved value
    realized_value_row_violations: `select (
        abs((select count(*) from public.v_player_realized_organizational_value) - (select count(*) from public.v_player_organizational_realization))
      + (select count(*) - count(distinct signing_id) from public.v_player_realized_organizational_value)
      + (select count(*) from public.v_player_realized_organizational_value v
          where (v.realized_value_state in ('OUTCOME_NOT_OBSERVED', 'VALUE_UNRESOLVED') and v.realized_org_value_bwar is not null)
             or (v.realized_value_state in ('REALIZED_TO_DATE', 'TO_DATE_CHAIN_INCOMPLETE') and v.realized_org_value_bwar is null)
             or (v.realized_org_value_bwar is not null and v.direct_dodgers_bwar is not null
                 and v.realized_org_value_bwar is distinct from v.direct_dodgers_bwar + v.individually_attributable_trade_bwar))
      )::int as n`,

    // cost components stay separate; the known cost is the sum of known components; a ratio needs complete cost and a resolved, mature value
    realized_value_cost_violations: `select count(*)::int as n from public.v_player_realized_organizational_value v
      where v.cost_complete is distinct from (v.cost_coverage_state = 'COMPLETE')
         or (v.realized_org_bwar_per_million_usd is not null and (not v.cost_complete or v.maturity_status <> 'MATURE'
              or v.realized_value_state <> 'REALIZED_TO_DATE' or not (v.known_acquisition_cost_usd > 0)))
         or (v.realized_org_bwar_per_million_usd is null) = (v.ratio_suppression_reason is null)
         or (v.known_acquisition_cost_usd is not null and v.known_acquisition_cost_usd <> coalesce(v.signing_bonus_usd, 0) + coalesce(v.posting_fee_usd, 0)
              + coalesce(v.transfer_fee_usd, 0) + coalesce(v.release_fee_usd, 0) + coalesce(v.other_acquisition_fee_usd, 0))`,

    // distributions are descriptive, need 10 resolved values, never include the outcome-selected set, and count unknowns as unknown
    historical_value_distribution_violations: `select (
        (select count(*) from public.v_historical_org_value_distribution d
          where d.statistic_kind <> 'HISTORICAL_DESCRIPTIVE'
             or (d.value_known_n < 10 and (d.historical_median_org_bwar is not null or d.historical_p25_org_bwar is not null
                  or d.historical_p75_org_bwar is not null or d.historical_positive_value_share is not null))
             or (d.value_known_n >= 10) <> (d.distribution_state = 'DESCRIPTIVE')
             or d.mature_members <> d.value_known_n + d.chain_incomplete_n + d.value_unresolved_n + d.outcome_not_observed_n)
      + (select abs(coalesce((select mature_members from public.v_historical_org_value_distribution where grain = 'ALL'), 0)
          - (select count(*) from public.v_player_realized_organizational_value where maturity_status = 'MATURE'
              and population_class in ('TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS') and signing_route = 'AMATEUR_OR_UNCLASSIFIED_SIGNING')))
      )::int as n`,

    // a value model is supported only when its 041 target is supported for the Dodgers reference population AND its conditional value is
    expected_value_support_violations: `select count(*)::int as n from public.v_expected_value_support s
      left join public.v_outcome_target_support t on t.target_key = s.probability_target_key and t.reference_population = s.reference_population
      where s.expected_value_supported is distinct from (s.probability_supported and s.conditional_value_supported)
         or s.probability_supported is distinct from coalesce(t.baseline_supported, false)
         or s.conditional_value_supported is distinct from (s.conditional_value_n >= s.min_conditional_n)
         or (s.conditional_mean_value_bwar is not null) <> s.expected_value_supported
         or (s.expected_value_supported) <> (s.support_state = 'EXPECTED_VALUE_SUPPORTED')`,

    // no expected value without an eligible probability and a supported model; never zero-filled; trade realization never forecast
    expected_value_propagation_violations: `select count(*)::int as n from public.v_player_expected_organizational_value e
      left join public.v_player_outcome_probability p on p.signing_id = e.signing_id and p.target_key = e.probability_target_key
      left join public.v_expected_value_support s on s.value_model_key = e.value_model_key
      where (e.expected_org_value_bwar is not null) <> e.expected_value_supported
         or (e.expected_value_supported and (p.prediction_eligible is not true or s.expected_value_supported is not true or p.probability is null))
         or (e.expected_value_supported and e.expected_org_value_bwar is distinct from round(p.probability * s.conditional_mean_value_bwar, 3))
         or (not e.expected_value_supported and (e.expected_value_exclusion_reason is null or e.probability is not null
              or e.expected_direct_dodgers_bwar is not null or e.expected_org_bwar_per_million_usd is not null))
         or e.expected_trade_realization_bwar is not null
         or (e.expected_org_bwar_per_million_usd is not null and not e.cost_complete)`,
  }
}

export const ORG_VALUE_QUERIES = orgValueQueries(true)
