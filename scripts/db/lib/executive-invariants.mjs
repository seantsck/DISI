// Read-only checks for the executive product contract (Migration 044).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). The executive overview must be one row whose figures equal what the
// underlying layers say (no figure is computed differently for the executive), and whose predictive counts never exceed what their
// upstream support allows. Prediction readiness must mirror the 041 support exactly. `loaded` says whether the 044 objects exist.

export const EXECUTIVE_CHECK_NAMES = ['executive_overview_violations', 'executive_support_propagation_violations', 'prediction_readiness_violations']

/** name -> SQL returning one row { n } = number of violations. */
export const executiveQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(EXECUTIVE_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // one row; coverage and realized-value figures equal the 042 per-signing rows they summarize
    executive_overview_violations: `with o as materialized (select * from public.v_executive_overview),
        v as materialized (select * from public.v_player_realized_organizational_value)
      select (
        abs((select count(*) from o) - 1)
      + (select count(*) from o where o.dodgers_signings <> (select count(*) from v)
          or o.known_acquisition_spend_usd is distinct from (select round(sum(known_acquisition_cost_usd), 2) from v)
          or o.realized_org_value_bwar is distinct from (select round(sum(realized_org_value_bwar), 2) from v)
          or o.value_left_organization_bwar is distinct from (select round(sum(value_left_organization_bwar), 2) from v)
          or o.analysis_as_of_date is distinct from (select max(audited_through_date) from public.outcome_audits)
          or (o.signings_with_complete_cost < o.dodgers_signings) <> (o.spend_state = 'KNOWN_SPEND_IS_A_LOWER_BOUND'))
      )::int as n`,

    // 041 -> 042 -> 043 -> 044: every predictive count equals the layer it reports, and is 0 whenever its upstream is unsupported. A supported
    // probability target is one supported for the population predictions are made for (the rule of v_player_outcome_probability); a baseline
    // supported only in the rank-selected benchmark sample is never counted as one (050: BENCHMARK SUPPORT != DODGERS SUPPORT).
    executive_support_propagation_violations: `with o as materialized (select * from public.v_executive_overview)
      select count(*)::int as n from o
      where o.supported_probability_targets <> (select count(distinct target_key) from public.v_outcome_target_support
              where baseline_supported and reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS')
         or o.non_null_probabilities <> (select count(probability) from public.v_player_outcome_probability)
         or o.supported_expected_value_models <> (select count(*) from public.v_expected_value_support where expected_value_supported)
         or o.supported_expected_values <> (select count(expected_org_value_bwar) from public.v_player_expected_organizational_value)
         or o.predictive_portfolio_recommendations <> (select count(*) from public.v_portfolio_candidate_readiness where optimization_eligible)
         or (o.supported_probability_targets = 0 and (o.non_null_probabilities <> 0 or o.prediction_readiness_state <> 'NO_SUPPORTED_PROBABILITY_TARGET'))
         or (o.supported_expected_value_models = 0 and (o.supported_expected_values <> 0 or o.predictive_portfolio_recommendations <> 0))`,

    // one readiness row per 041 support row, with the same support decision and a statement
    prediction_readiness_violations: `select (
        abs((select count(*) from public.v_prediction_readiness) - (select count(*) from public.v_outcome_target_support))
      + (select count(*) from public.v_prediction_readiness r
          left join public.v_outcome_target_support s on s.target_key = r.target_key and s.reference_population = r.reference_population
          where s.target_key is null or r.baseline_supported is distinct from s.baseline_supported
             or (r.readiness_state = 'SUPPORTED') <> s.baseline_supported
             or r.readiness_statement is null or r.labelled_n <> s.labelled_n or r.positive_n <> s.positive_n)
      )::int as n`,
  }
}

export const EXECUTIVE_QUERIES = executiveQueries(true)
