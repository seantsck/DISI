-- DISI v0.35
-- 044_executive_product.sql
-- The executive product contract: a one-row executive overview (coverage, known spend, realized organizational value with its
-- components separate, and the support state of every predictive layer) and per-target prediction readiness (the evidence, the
-- minimums and what is still needed). Both are bounded so application pages read them cheaply. Run after 043.
--
-- Built from database/research/044/ (views.sql, build.mjs; design in ../042/final-decision-architecture.md).
--
-- Rerunnable: every statement is idempotent. Adds views only.

begin;

do $$
begin
  if to_regclass('public.v_portfolio_candidate_readiness') is null or to_regclass('public.v_player_realized_organizational_value') is null then
    raise exception '044: Migrations 042 and 043 have not been applied';
  end if;
end $$;

-- Migration 044 views: the executive product contract. Spliced into 044_template.sql by build.mjs.
-- Both views are bounded (one row / one row per target and reference population) so pages can read them cheaply.

-- ---------------------------------------------------------------------------
-- Executive overview: one row of high-signal, denominator-carrying facts and the support state of every predictive layer
-- ---------------------------------------------------------------------------
create or replace view public.v_executive_overview
with (security_invoker = true)
as
with st as materialized (select * from public.v_database_status),
v as materialized (select * from public.v_player_realized_organizational_value),
sup as materialized (select * from public.v_outcome_target_support),
evs as materialized (select * from public.v_expected_value_support),
flags as (
  select coalesce(bool_or(baseline_supported), false) as any_probability_supported from sup
),
evflag as (select coalesce(bool_or(expected_value_supported), false) as any_ev_supported from evs),
-- per-player predictive counts are computed only when some upstream support exists (one-time filters); otherwise they are 0 by
-- construction, because the verifier guarantees no probability, expected value or recommendation exists without support
p as (select count(probability)::int as n from public.v_player_outcome_probability where (select any_probability_supported from flags)),
ev as (select count(expected_org_value_bwar)::int as n from public.v_player_expected_organizational_value where (select any_ev_supported from evflag)),
rec as (select count(*) filter (where optimization_eligible)::int as n from public.v_portfolio_candidate_readiness where (select any_ev_supported from evflag)),
a as (
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
  from v
)
select
  (select max(audited_through_date) from public.outcome_audits) as analysis_as_of_date,
  st.tracked_signings as all_tracked_signings, st.total_players, st.markets_represented, st.earliest_signing_year, st.latest_signing_year,
  a.dodgers_signings, a.dodgers_tracked_or_census_signings, a.dodgers_outcome_selected_signings, a.mature_signings, a.verified_mlb_players,
  st.outcome_audits_completed, st.outcome_audit_queue,
  a.signings_with_known_cost, a.signings_with_complete_cost, round(a.known_acquisition_spend_usd, 2) as known_acquisition_spend_usd,
  round(a.signings_with_known_cost::numeric / nullif(a.dodgers_signings, 0), 3) as cost_coverage,
  case when a.signings_with_complete_cost < a.dodgers_signings then 'KNOWN_SPEND_IS_A_LOWER_BOUND' else 'SPEND_COMPLETE' end as spend_state,
  a.signings_with_resolved_value,
  round(a.direct_dodgers_bwar, 2) as realized_direct_dodgers_bwar,
  round(a.individually_attributable_trade_bwar, 2) as realized_individually_attributable_trade_bwar,
  round(a.realized_org_value_bwar, 2) as realized_org_value_bwar,
  round(a.value_left_organization_bwar, 2) as value_left_organization_bwar, a.signings_with_other_club_value_known,
  (select count(distinct target_key) from sup)::int as probability_targets,
  (select count(distinct target_key) from sup where baseline_supported)::int as supported_probability_targets,
  (select count(*) from public.signings) * (select count(*) from public.outcome_targets) as probability_rows,
  coalesce((select n from p), 0) as non_null_probabilities,
  (select count(*) from evs)::int as expected_value_models,
  (select count(*) from evs where expected_value_supported)::int as supported_expected_value_models,
  coalesce((select n from ev), 0) as supported_expected_values,
  coalesce((select n from rec), 0) as predictive_portfolio_recommendations,
  (select count(*) from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED')::int as supported_fitted_models,
  st.open_research_tasks,
  case when (select any_probability_supported from flags) then 'PROBABILITIES_PUBLISHED_FOR_SUPPORTED_TARGETS'
       else 'NO_SUPPORTED_PROBABILITY_TARGET' end as prediction_readiness_state,
  case when (select any_probability_supported from flags)
       then 'DISI publishes outcome probabilities only for targets whose reference population meets the minimum support threshold; see Prediction readiness.'
       else 'DISI does not currently publish player outcome probabilities because the verified mature sample does not meet the minimum support threshold.' end
    as prediction_readiness_statement
from a cross join st;

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

do $$
declare t text;
begin
  foreach t in array array['v_executive_overview', 'v_prediction_readiness'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  o record;
begin
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '044: API roles hold privileges beyond SELECT: %', bad;
  end if;
  select * into o from public.v_executive_overview;
  if (select count(*) from public.v_executive_overview) <> 1 then
    raise exception '044 postcondition: the executive overview must be exactly one row';
  end if;
  -- the overview never reports a predictive output its upstream does not support
  if (o.supported_probability_targets = 0 and o.non_null_probabilities <> 0)
     or (o.supported_expected_value_models = 0 and (o.supported_expected_values <> 0 or o.predictive_portfolio_recommendations <> 0)) then
    raise exception '044 postcondition: the overview reports unsupported predictive outputs';
  end if;
end $$;

commit;
