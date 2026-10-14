// Read-only structural and semantic checks for portfolio decision support (Migration 043).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins how many candidates are ready or which scenario is feasible:
// both move as research lands. What is checked is the rule: a candidate is optimization-eligible only with a supported expected value
// (042), complete cost and complete signing-time features; no selection or ranking exists without eligible candidates; unknown costs
// make feasibility indeterminate rather than zero; retrospective analysis stays labelled. `loaded` says whether the 043 objects exist.

export const PORTFOLIO_CHECK_NAMES = [
  'portfolio_readiness_violations', 'portfolio_support_propagation_violations', 'portfolio_scenario_violations',
  'portfolio_decision_summary_violations', 'portfolio_retrospective_label_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const portfolioQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(PORTFOLIO_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // one row per Dodgers signing; the decision date is the signing cutoff; every non-supported state names a blocker
    portfolio_readiness_violations: `select (
        abs((select count(*) from public.v_portfolio_candidate_readiness) - (select count(*) from public.v_signing_time_features where is_dodgers))
      + (select count(*) - count(distinct signing_id) from public.v_portfolio_candidate_readiness)
      + (select count(*) from public.v_portfolio_candidate_readiness r
          join public.v_signing_time_features f on f.signing_id = r.signing_id
          where r.decision_as_of_date is distinct from f.signing_cutoff_date
             or (r.decision_support_state <> 'PREDICTIVE_DECISION_SUPPORTED' and cardinality(r.decision_blockers) = 0)
             or (r.decision_support_state = 'OUT_OF_SCOPE') <> (f.population_class = 'OUTCOME_SELECTED_SAMPLE' or f.signing_route = 'PROFESSIONAL_SIGNING'))
      )::int as n`,

    // 041 -> 042 -> 043: eligibility needs a supported value model, a non-NULL expected value, complete cost and complete features
    portfolio_support_propagation_violations: `select count(*)::int as n from public.v_portfolio_candidate_readiness r
      left join public.v_player_expected_organizational_value e on e.signing_id = r.signing_id
      where r.optimization_eligible <> (r.decision_support_state = 'PREDICTIVE_DECISION_SUPPORTED')
         or (r.optimization_eligible and (not r.expected_value_model_supported or not r.cost_complete or not r.player_data_complete
              or r.expected_org_value_bwar is null or e.expected_value_supported is not true
              or r.expected_org_value_bwar is distinct from e.expected_org_value_bwar))
         or (not r.optimization_eligible and r.expected_org_value_bwar is not null)
         or r.expected_value_model_supported is distinct from coalesce((select bool_or(expected_value_supported) from public.v_expected_value_support), false)`,

    // feasibility never treats unknown cost as zero; a selection exists only with eligible candidates and fits the budget
    portfolio_scenario_violations: `select count(*)::int as n from public.v_portfolio_scenario_evaluation s
      where (s.budget_state = 'WITHIN_BUDGET_ON_COMPLETE_COSTS' and (s.incomplete_cost_candidates > 0 or s.known_cost_usd > s.scenario_budget_usd))
         or (s.budget_headroom_usd is not null and s.incomplete_cost_candidates > 0)
         or (s.optimized_selection is not null) <> (s.value_optimization_state = 'VALUE_OPTIMIZATION_SUPPORTED')
         or (s.value_optimization_state = 'VALUE_OPTIMIZATION_SUPPORTED' and (s.optimization_eligible_candidates = 0 or s.optimized_known_cost_usd > s.scenario_budget_usd))
         or (s.optimization_eligible_candidates = 0 and (s.optimized_expected_org_bwar is not null or s.value_optimization_state <> 'VALUE_OPTIMIZATION_NOT_SUPPORTED'))
         or s.analysis_kind <> 'RETROSPECTIVE_FEASIBILITY'`,

    // the summary agrees with the candidates and counts no recommendation that is not optimization-eligible
    portfolio_decision_summary_violations: `with r as materialized (select optimization_eligible from public.v_portfolio_candidate_readiness),
        d as materialized (select * from public.v_portfolio_decision_support),
        t as (select count(*)::int as n, count(*) filter (where optimization_eligible)::int as eligible from r)
      select (
        (select abs(coalesce(sum(d.candidates), 0) - t.n) from d cross join t group by t.n)
      + (select count(*) from d cross join t where d.predictive_recommendations_total <> t.eligible)
      + (select count(*) from d where d.decision_support_state <> 'PREDICTIVE_DECISION_SUPPORTED' and d.optimization_eligible_candidates <> 0)
      )::int as n`,

    // retrospective analysis is labelled, excludes the outcome-selected set and never claims a complete spend it does not have
    portfolio_retrospective_label_violations: `select count(*)::int as n from public.v_historical_portfolio_summary h
      where h.analysis_kind <> 'RETROSPECTIVE'
         or (h.complete_cost_signings < h.signings) <> (h.spend_state = 'KNOWN_SPEND_IS_A_LOWER_BOUND')
         or (h.grain = 'ALL' and h.signings <> (select count(*) from public.v_player_realized_organizational_value
              where signing_route = 'AMATEUR_OR_UNCLASSIFIED_SIGNING' and population_class in ('TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS')))`,
  }
}

export const PORTFOLIO_QUERIES = portfolioQueries(true)
