// Read-only structural and semantic checks for the outcome-probability infrastructure (Migration 041).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins how many labels exist or whether a target is supported:
// support moves as outcomes are audited. A stale model evaluation (the live training set no longer matches the recorded fingerprint)
// is a research-queue item, not a verifier failure. `loaded` says whether the 041 objects exist.

export const PROBABILITY_CHECK_NAMES = [
  'outcome_label_state_violations', 'outcome_no_negative_coercion_violations', 'outcome_feature_leakage_violations',
  'outcome_support_violations', 'outcome_probability_eligibility_violations', 'outcome_model_registry_violations',
  'outcome_population_isolation_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const probabilityQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(PROBABILITY_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // one row per signing and target; a label only after the horizon; training states agree with the label and the population
    outcome_label_state_violations: `select (
        abs((select count(*) from public.v_outcome_training_population) - (select count(*) from public.signings) * (select count(*) from public.outcome_targets))
      + (select count(*) from public.v_outcome_training_population p
          where (not p.exposure_complete and p.label is not null)
             or (p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY') and p.label is null)
             or (p.training_state = 'OUTCOME_UNAUDITED' and p.label is not null)
             or (p.training_state = 'CENSORED' and p.exposure_complete)
             or (p.population_class = 'OUTCOME_SELECTED_SAMPLE' and p.training_state <> 'OUT_OF_SCOPE')
             or (p.signing_route = 'PROFESSIONAL_SIGNING' and p.training_state <> 'OUT_OF_SCOPE')
             or (p.training_state = 'BENCHMARK_SAMPLE_ONLY' and p.population_class <> 'TOP_PROSPECT_SAMPLE')
             or (p.training_state = 'TRAINING_ELIGIBLE' and p.population_class not in ('TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS')))
      )::int as n`,

    // unknown is never negative: an unaudited outcome never carries a FALSE label; a reached player's MLB label is never FALSE within its horizon
    outcome_no_negative_coercion_violations: `select count(*)::int as n from public.v_outcome_training_population p
      where (p.reached_mlb_verified is null and p.label is not null)
         or (p.target_key = 'REACH_MLB_WITHIN_7_SEASONS' and p.label is false and p.reached_mlb_verified and p.years_signing_to_debut_season <= p.horizon_seasons)`,

    // features are the signing-time features as of the cutoff, never anything later
    outcome_feature_leakage_violations: `select count(*)::int as n from public.v_outcome_feature_matrix x
      join public.v_signing_time_features f on f.signing_id = x.signing_id
      where x.feature_as_of_date is distinct from f.signing_cutoff_date or x.age_in_signing_year is distinct from f.age_in_signing_year
         or x.position_family is distinct from f.position_family or x.market_group is distinct from f.market_group
         or x.expectation_tier is distinct from f.expectation_tier
         or x.model_features_complete is distinct from (f.has_age and f.has_position and f.has_market)`,

    // a baseline only at the documented thresholds, inside its interval, counted from rows that can train
    outcome_support_violations: `select count(*)::int as n from public.v_outcome_target_support s
      where (s.baseline_probability is not null) <> s.baseline_supported
         or (s.baseline_supported and (s.labelled_n < s.min_reference_n or s.positive_n < s.min_positives or s.negative_n < s.min_negatives))
         or (s.baseline_supported and not (s.baseline_probability_low_90 <= s.baseline_probability and s.baseline_probability <= s.baseline_probability_high_90))
         or s.labelled_n <> s.positive_n + s.negative_n
         or s.labelled_n <> (select count(*) from public.v_outcome_training_population p where p.target_key = s.target_key
              and p.reference_population = s.reference_population and p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY'))`,

    // a probability only for an eligible row (open outcome, Dodgers tracked / opening-class population, amateur route, supported
    // baseline), equal to that baseline, never zero-filled
    outcome_probability_eligibility_violations: `select count(*)::int as n from public.v_player_outcome_probability o
      left join public.v_outcome_training_population p on p.signing_id = o.signing_id and p.target_key = o.target_key
      left join public.v_outcome_target_support s on s.target_key = o.target_key and s.reference_population = o.training_population
      where (o.probability is not null) <> o.prediction_eligible
         or (o.prediction_eligible and (p.exposure_complete or p.population_class not in ('TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS')
              or p.signing_route = 'PROFESSIONAL_SIGNING' or s.baseline_supported is not true or o.probability is distinct from s.baseline_probability))
         or (not o.prediction_eligible and o.prediction_exclusion_reason is null)`,

    // a model is supported only with enough events per feature and positive out-of-time skill; the base rate is only a reference
    outcome_model_registry_violations: `select count(*)::int as n from public.outcome_model_evaluations e
      join public.outcome_targets t on t.target_key = e.target_key
      where (e.decision = 'MODEL_SUPPORTED' and (e.positive_n < t.events_per_feature * greatest(cardinality(e.feature_list), 1) or not (e.brier_skill_vs_base_rate > 0)))
         or ((e.model_key = 'BASE_RATE') <> (e.decision = 'BASELINE_REFERENCE'))
         or e.validation_method <> 'LEAVE_ONE_SIGNING_YEAR_OUT'`,

    // 050: BENCHMARK SUPPORT != DODGERS SUPPORT. Populations are never pooled: a baseline supported in the rank-selected Top-prospect sample
    // never produces a probability (for a benchmark row or a Dodgers row) and never makes a Dodgers row eligible; a Dodgers row is eligible
    // only through the Dodgers population's own support. (042's expected_value_support_violations already ties expected value to that
    // population's support.)
    outcome_population_isolation_violations: `select (
        (select count(*) from public.v_player_outcome_probability o
          where (o.probability is not null or o.prediction_eligible) and o.training_population is distinct from 'DODGERS_TRACKED_AND_OPENING_CLASS')
      + (select count(*) from public.v_player_outcome_probability o
          where o.prediction_eligible and not exists (select 1 from public.v_outcome_target_support s
            where s.target_key = o.target_key and s.reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS' and s.baseline_supported))
      )::int as n`,
  }
}

export const PROBABILITY_QUERIES = probabilityQueries(true)
