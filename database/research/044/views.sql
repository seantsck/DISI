-- Migration 044 views: the executive product contract. Spliced into 044_template.sql by build.mjs.
-- Both views are bounded (one row / one row per target and reference population) so pages can read them cheaply.

-- ---------------------------------------------------------------------------
-- Executive overview: one row of high-signal, denominator-carrying facts and the support state of every predictive layer
-- ---------------------------------------------------------------------------
-- Computed by a staged, read-only function: each aggregate is a separate statement over the layer it summarizes, planned only when it
-- runs and released when it ends, so a page load never plans the whole 041 -> 042 -> 043 stack at once (Migration 043a explains the
-- low-memory failure this prevents). Per-player predictive counts are read only when their upstream support exists (one-time
-- filters, as before); otherwise they are 0 by construction, because the verifier guarantees no probability, expected value or
-- recommendation exists without support - and the gated layers are then neither executed nor planned.
create or replace function public.disi_executive_overview()
returns table (
  analysis_as_of_date date, all_tracked_signings integer, total_players integer, markets_represented integer, earliest_signing_year integer,
  latest_signing_year integer, dodgers_signings integer, dodgers_tracked_or_census_signings integer, dodgers_outcome_selected_signings integer,
  mature_signings integer, verified_mlb_players integer, outcome_audits_completed integer, outcome_audit_queue integer,
  signings_with_known_cost integer, signings_with_complete_cost integer, known_acquisition_spend_usd numeric, cost_coverage numeric,
  spend_state text, signings_with_resolved_value integer, realized_direct_dodgers_bwar numeric, realized_individually_attributable_trade_bwar numeric,
  realized_org_value_bwar numeric, value_left_organization_bwar numeric, signings_with_other_club_value_known integer,
  probability_targets integer, supported_probability_targets integer, probability_rows bigint, non_null_probabilities integer,
  expected_value_models integer, supported_expected_value_models integer, supported_expected_values integer,
  predictive_portfolio_recommendations integer, supported_fitted_models integer, open_research_tasks integer,
  prediction_readiness_state text, prediction_readiness_statement text
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  st record;
  a record;
  v_as_of date;
  v_targets int;
  v_supported_targets int;
  v_any_probability boolean;
  v_ev_models int;
  v_supported_ev_models int;
  v_any_ev boolean;
  v_probabilities int := 0;
  v_expected_values int := 0;
  v_recommendations int := 0;
  v_probability_rows bigint;
  v_fitted int;
  v_rows int;
begin
  -- coverage (v_database_status, one row)
  execute $q$
    select tracked_signings, total_players, markets_represented, earliest_signing_year, latest_signing_year, outcome_audits_completed,
      outcome_audit_queue, open_research_tasks
    from public.v_database_status
  $q$ into st;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    return;
  end if;
  -- Dodgers signings, known spend and realized organizational value (042), components kept separate
  execute $q$
    select count(*)::int as dodgers_signings,
      count(*) filter (where population_class <> 'OUTCOME_SELECTED_SAMPLE')::int as dodgers_tracked_or_census_signings,
      count(*) filter (where population_class = 'OUTCOME_SELECTED_SAMPLE')::int as dodgers_outcome_selected_signings,
      count(*) filter (where maturity_status = 'MATURE')::int as mature_signings,
      count(*) filter (where reached_mlb_verified)::int as verified_mlb_players,
      count(known_acquisition_cost_usd)::int as signings_with_known_cost,
      count(*) filter (where cost_complete)::int as signings_with_complete_cost,
      sum(known_acquisition_cost_usd) as known_acquisition_spend_usd,
      count(*) filter (where realized_value_state in ('REALIZED_TO_DATE', 'TO_DATE_CHAIN_INCOMPLETE'))::int as signings_with_resolved_value,
      sum(direct_dodgers_bwar) filter (where realized_value_state in ('REALIZED_TO_DATE', 'TO_DATE_CHAIN_INCOMPLETE')) as direct_dodgers_bwar,
      sum(individually_attributable_trade_bwar) filter (where realized_value_state in ('REALIZED_TO_DATE', 'TO_DATE_CHAIN_INCOMPLETE')) as individually_attributable_trade_bwar,
      sum(realized_org_value_bwar) as realized_org_value_bwar,
      sum(value_left_organization_bwar) as value_left_organization_bwar,
      count(value_left_organization_bwar)::int as signings_with_other_club_value_known
    from public.v_player_realized_organizational_value
  $q$ into a;
  -- 041 probability support
  execute $q$
    select count(distinct target_key)::int, (count(distinct target_key) filter (where baseline_supported))::int,
      coalesce(bool_or(baseline_supported), false)
    from public.v_outcome_target_support
  $q$ into v_targets, v_supported_targets, v_any_probability;
  -- 042 expected-value support
  execute $q$
    select count(*)::int, (count(*) filter (where expected_value_supported))::int, coalesce(bool_or(expected_value_supported), false)
    from public.v_expected_value_support
  $q$ into v_ev_models, v_supported_ev_models, v_any_ev;
  -- per-player predictive outputs, only when their upstream support exists
  if v_any_probability then
    execute $q$ select count(probability)::int from public.v_player_outcome_probability $q$ into v_probabilities;
  end if;
  if v_any_ev then
    execute $q$ select count(expected_org_value_bwar)::int from public.v_player_expected_organizational_value $q$ into v_expected_values;
    execute $q$ select (count(*) filter (where optimization_eligible))::int from public.v_portfolio_candidate_readiness $q$ into v_recommendations;
  end if;
  execute $q$ select max(audited_through_date) from public.outcome_audits $q$ into v_as_of;
  execute $q$ select (select count(*) from public.signings) * (select count(*) from public.outcome_targets) $q$ into v_probability_rows;
  execute $q$ select count(*)::int from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED' $q$ into v_fitted;
  return query select
    v_as_of,
    st.tracked_signings, st.total_players, st.markets_represented, st.earliest_signing_year, st.latest_signing_year,
    a.dodgers_signings, a.dodgers_tracked_or_census_signings, a.dodgers_outcome_selected_signings, a.mature_signings, a.verified_mlb_players,
    st.outcome_audits_completed, st.outcome_audit_queue,
    a.signings_with_known_cost, a.signings_with_complete_cost, round(a.known_acquisition_spend_usd, 2),
    round(a.signings_with_known_cost::numeric / nullif(a.dodgers_signings, 0), 3),
    case when a.signings_with_complete_cost < a.dodgers_signings then 'KNOWN_SPEND_IS_A_LOWER_BOUND' else 'SPEND_COMPLETE' end,
    a.signings_with_resolved_value,
    round(a.direct_dodgers_bwar, 2),
    round(a.individually_attributable_trade_bwar, 2),
    round(a.realized_org_value_bwar, 2),
    round(a.value_left_organization_bwar, 2), a.signings_with_other_club_value_known,
    v_targets, v_supported_targets, v_probability_rows, v_probabilities,
    v_ev_models, v_supported_ev_models, v_expected_values, v_recommendations,
    v_fitted,
    st.open_research_tasks,
    case when v_any_probability then 'PROBABILITIES_PUBLISHED_FOR_SUPPORTED_TARGETS' else 'NO_SUPPORTED_PROBABILITY_TARGET' end,
    case when v_any_probability
         then 'DISI publishes outcome probabilities only for targets whose reference population meets the minimum support threshold; see Prediction readiness.'
         else 'DISI does not currently publish player outcome probabilities because the verified mature sample does not meet the minimum support threshold.' end;
end
$fn$;

comment on function public.disi_executive_overview() is
  'Staged evaluation of v_executive_overview (Migration 044): coverage, realized value, 041 and 042 support and the support-gated predictive counts, each a separate statement. Read-only (STABLE), invoker rights, fixed search_path. Read it through the view.';

create or replace view public.v_executive_overview
with (security_invoker = true)
as
select * from public.disi_executive_overview();

comment on view public.v_executive_overview is
  'Executive overview (Migration 044): one row. Coverage, known acquisition spend (a lower bound unless every cost is complete), realized organizational value with its components separate (value produced for other clubs is NOT Dodgers value), and the support state of every predictive layer: supported probability targets (041), expected values (042) and predictive portfolio recommendations (043). Predictive counts are 0 by construction while their upstream support is absent. Every figure carries its denominator.';

-- ---------------------------------------------------------------------------
-- Prediction readiness: per target and reference population, how far the evidence is from the support threshold
-- ---------------------------------------------------------------------------
create or replace view public.v_prediction_readiness
with (security_invoker = true)
as
with sup as materialized (select * from public.v_outcome_target_support),
ev as (
  select target_key,
    max(evaluated_rows) as evaluated_rows, max(positive_n) as evaluated_positives,
    min(brier_score) filter (where model_key = 'BASE_RATE') as base_rate_brier,
    min(brier_score) filter (where model_key <> 'BASE_RATE' and decision = 'MODEL_SUPPORTED') as best_supported_model_brier,
    min(brier_score) filter (where model_key <> 'BASE_RATE') as best_fitted_model_brier,
    bool_or(decision = 'MODEL_SUPPORTED') as fitted_model_supported
  from public.outcome_model_evaluations group by target_key
)
select s.target_key, s.target_label, s.horizon_seasons, s.reference_population,
  s.labelled_n, s.positive_n, s.negative_n, s.censored_n, s.unaudited_n,
  s.min_reference_n, s.min_positives, s.min_negatives,
  s.additional_labels_needed, s.additional_positives_needed, greatest(s.min_negatives - s.negative_n, 0) as additional_negatives_needed,
  s.baseline_supported, s.support_state,
  e.evaluated_rows, e.evaluated_positives, e.base_rate_brier, e.best_fitted_model_brier, coalesce(e.fitted_model_supported, false) as fitted_model_supported,
  case
    when s.baseline_supported then 'SUPPORTED'
    when s.labelled_n = 0 then 'NO_LABELLED_OUTCOMES'
    else 'NOT_SUPPORTED'
  end as readiness_state,
  case
    when s.baseline_supported then format('Supported: %s labelled outcomes (%s positive, %s negative) meet the %s / %s / %s minimum.',
      s.labelled_n, s.positive_n, s.negative_n, s.min_reference_n, s.min_positives, s.min_negatives)
    else format('Not supported: %s labelled outcomes (%s positive, %s negative); needs %s more labelled, %s more positive and %s more negative outcomes. %s open-horizon and %s unaudited members cannot be labelled yet.',
      s.labelled_n, s.positive_n, s.negative_n, coalesce(s.additional_labels_needed, 0), coalesce(s.additional_positives_needed, 0),
      greatest(s.min_negatives - s.negative_n, 0), s.censored_n, s.unaudited_n)
  end as readiness_statement
from sup s left join ev e on e.target_key = s.target_key;

comment on view public.v_prediction_readiness is
  'Prediction readiness (Migration 044): one row per outcome target and reference population with the labelled evidence, the support minimums, what is still needed, and the recorded model evaluation (no fitted model is promoted unless MODEL_SUPPORTED). Written for the executive product: it explains why probabilities are or are not published.';
