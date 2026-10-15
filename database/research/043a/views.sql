-- Migration 043a: staged, plan-bounded evaluation of the four 042 / 043 views that stacked the whole 041 -> 042 -> 043 chain into
-- one statement. Spliced into 043a_template.sql by build.mjs.
--
-- Each function runs its stages as separate dynamic statements (EXECUTE): a stage is planned only when it runs, its planner memory is
-- released when it ends, and no plan is cached in a pooled connection. Intermediate results (at most a few hundred rows) are passed
-- between stages as jsonb and read back with explicit column types. Gated stages keep the original one-time-filter semantics: a
-- per-player predictive layer is read only when its upstream support exists, so while support is absent it is neither executed (as
-- before) nor planned (new). The views keep their columns, types, rows, NULLs, grants, comments and security_invoker behaviour.

-- ---------------------------------------------------------------------------
-- Realized organizational value per Dodgers signing (042): the 034 / 038 downstream realization is read in its own stage
-- ---------------------------------------------------------------------------
create or replace function public.disi_player_realized_organizational_value()
returns table (
  signing_id uuid, player_id uuid, player_slug text, full_name text, signing_year integer, pathway text, country_market text, market_group text,
  era_key text, cost_band text, population_class text, signing_route text, maturity_status text, outcome_state text, reached_mlb_verified boolean,
  organizational_realization_status text, realized_career_bwar numeric, direct_dodgers_bwar numeric, individually_attributable_trade_bwar numeric,
  realized_org_value_bwar numeric, package_first_hop_participation_bwar numeric, package_downstream_participation_bwar numeric,
  observable_not_attributable_bwar numeric, value_left_organization_bwar numeric, chain_status text, realized_value_state text,
  signing_bonus_usd numeric, posting_fee_usd numeric, transfer_fee_usd numeric, release_fee_usd numeric, other_acquisition_fee_usd numeric,
  known_acquisition_cost_usd numeric, cost_components_known text[], cost_components_required_missing text[], cost_components_possible_unknown text[],
  cost_complete boolean, cost_coverage_state text, realized_org_bwar_per_million_usd numeric, ratio_suppression_reason text, attribution_note text,
  analysis_as_of_date date
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_downstream jsonb;
begin
  -- stage 1: one SIGNING-grain row per signing from the downstream organizational realization (034 / 038)
  execute $q$
    select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb)
    from (select signing_id, total_individually_attributable_organizational_bwar, chain_status, interval_bounded_first_hop_package_bwar,
            package_participation_downstream_bwar, observable_not_attributable_bwar
          from public.v_downstream_organizational_realization where row_grain = 'SIGNING') d
  $q$ into v_downstream;
  -- stage 2: the 042 definition, with the downstream rows from stage 1
  return query execute $q$
    with r as materialized (select * from public.v_player_organizational_realization),
    d as materialized (
      select * from jsonb_to_recordset($1) as x(signing_id uuid, total_individually_attributable_organizational_bwar numeric, chain_status text,
        interval_bounded_first_hop_package_bwar numeric, package_participation_downstream_bwar numeric, observable_not_attributable_bwar numeric)
    ),
    f as materialized (select * from public.v_signing_acquisition_financials where is_dodgers),
    t as materialized (select signing_id, population_class, signing_route, market_group, era_key, cost_band from public.v_signing_time_features where is_dodgers),
    j as (
      select r.signing_id, r.player_id, r.player_slug, r.full_name, r.signing_year, r.pathway, r.country_market, t.market_group, t.era_key, t.cost_band,
        t.population_class, t.signing_route, r.maturity_status, r.outcome_state, r.reached_mlb_verified, r.organizational_realization_status,
        r.career_bwar, r.direct_dodgers_mlb_bwar, d.total_individually_attributable_organizational_bwar as total_bwar, d.chain_status,
        d.interval_bounded_first_hop_package_bwar, d.package_participation_downstream_bwar, d.observable_not_attributable_bwar,
        r.non_dodgers_mlb_bwar, r.attributable_value_basis,
        f.signing_bonus_usd, f.posting_fee_usd, f.transfer_fee_usd, f.release_fee_usd, f.other_acquisition_fee_usd, f.known_acquisition_cost_usd,
        f.known_components, f.required_components_unresolved, f.possible_components_unknown, f.acquisition_cost_completeness,
        r.analysis_as_of_date
      from r
      left join d on d.signing_id = r.signing_id
      left join f on f.signing_id = r.signing_id
      left join t on t.signing_id = r.signing_id
    ),
    s as (
      select j.*,
        case
          when j.attributable_value_basis = 'OUTCOME_NOT_OBSERVED' then 'OUTCOME_NOT_OBSERVED'
          when j.total_bwar is null then 'VALUE_UNRESOLVED'
          when j.chain_status like 'INCOMPLETE%' then 'TO_DATE_CHAIN_INCOMPLETE'
          else 'REALIZED_TO_DATE'
        end as realized_value_state
      from j
    )
    select
      s.signing_id, s.player_id, s.player_slug, s.full_name, s.signing_year, s.pathway, s.country_market, s.market_group, s.era_key, s.cost_band,
      s.population_class, s.signing_route, s.maturity_status, s.outcome_state, s.reached_mlb_verified, s.organizational_realization_status,
      s.career_bwar::numeric as realized_career_bwar,
      s.direct_dodgers_mlb_bwar as direct_dodgers_bwar,
      case when s.total_bwar is not null and s.direct_dodgers_mlb_bwar is not null then s.total_bwar - s.direct_dodgers_mlb_bwar end as individually_attributable_trade_bwar,
      s.total_bwar as realized_org_value_bwar,
      s.interval_bounded_first_hop_package_bwar as package_first_hop_participation_bwar,
      s.package_participation_downstream_bwar as package_downstream_participation_bwar,
      s.observable_not_attributable_bwar,
      s.non_dodgers_mlb_bwar as value_left_organization_bwar,
      s.chain_status, s.realized_value_state,
      s.signing_bonus_usd::numeric, s.posting_fee_usd::numeric, s.transfer_fee_usd::numeric, s.release_fee_usd, s.other_acquisition_fee_usd,
      s.known_acquisition_cost_usd, s.known_components as cost_components_known,
      s.required_components_unresolved as cost_components_required_missing, s.possible_components_unknown as cost_components_possible_unknown,
      (s.acquisition_cost_completeness = 'COMPLETE') as cost_complete,
      s.acquisition_cost_completeness as cost_coverage_state,
      case when s.acquisition_cost_completeness = 'COMPLETE' and s.known_acquisition_cost_usd > 0 and s.maturity_status = 'MATURE'
            and s.realized_value_state = 'REALIZED_TO_DATE'
           then round(s.total_bwar / (s.known_acquisition_cost_usd / 1000000.0), 2) end as realized_org_bwar_per_million_usd,
      case
        when s.acquisition_cost_completeness is distinct from 'COMPLETE' then 'ACQUISITION_COST_' || coalesce(s.acquisition_cost_completeness, 'UNKNOWN')
        when not (s.known_acquisition_cost_usd > 0) then 'ZERO_OR_UNKNOWN_COST'
        when s.maturity_status <> 'MATURE' then 'RECENT_SIGNING'
        when s.realized_value_state <> 'REALIZED_TO_DATE' then s.realized_value_state
      end as ratio_suppression_reason,
      'Package and observable-not-attributable value belong to packages and chains, not to this player; value_left_organization_bwar is MLB value for other clubs, not Dodgers value.'::text as attribution_note,
      s.analysis_as_of_date
    from s
  $q$ using v_downstream;
end
$fn$;

comment on function public.disi_player_realized_organizational_value() is
  'Plan-bounded evaluation of v_player_realized_organizational_value (Migration 043a): stage 1 reads the SIGNING-grain downstream realization, stage 2 the 042 per-signing definition. Read-only (STABLE), invoker rights, fixed search_path. Read it through the view.';

-- the function result carries no typmods; the view restores the 042 column types exactly (every value already fits them)
create or replace view public.v_player_realized_organizational_value
with (security_invoker = true)
as
select signing_id, player_id, player_slug, full_name, signing_year, pathway, country_market, market_group, era_key, cost_band, population_class,
  signing_route, maturity_status, outcome_state, reached_mlb_verified, organizational_realization_status,
  realized_career_bwar::numeric(9,3) as realized_career_bwar, direct_dodgers_bwar, individually_attributable_trade_bwar, realized_org_value_bwar,
  package_first_hop_participation_bwar, package_downstream_participation_bwar, observable_not_attributable_bwar, value_left_organization_bwar,
  chain_status, realized_value_state,
  signing_bonus_usd::numeric(14,2) as signing_bonus_usd, posting_fee_usd::numeric(14,2) as posting_fee_usd,
  transfer_fee_usd::numeric(14,2) as transfer_fee_usd, release_fee_usd, other_acquisition_fee_usd,
  known_acquisition_cost_usd, cost_components_known, cost_components_required_missing, cost_components_possible_unknown, cost_complete,
  cost_coverage_state, realized_org_bwar_per_million_usd, ratio_suppression_reason, attribution_note, analysis_as_of_date
from public.disi_player_realized_organizational_value();

-- ---------------------------------------------------------------------------
-- Expected organizational value per Dodgers signing (042): value-model support and 041 probabilities are read in their own stages
-- ---------------------------------------------------------------------------
create or replace function public.disi_player_expected_organizational_value()
returns table (
  signing_id uuid, player_id uuid, player_slug text, population_class text, value_model_key text, value_model_version text,
  probability_target_key text, probability_model_version text, decision_as_of_date date, evidence_as_of_date date, training_population text,
  probability_supported boolean, conditional_value_supported boolean, expected_value_supported boolean, probability numeric,
  expected_direct_dodgers_bwar numeric, expected_direct_dodgers_bwar_low_90 numeric, expected_direct_dodgers_bwar_high_90 numeric,
  expected_trade_realization_bwar numeric, trade_realization_exclusion_reason text, expected_org_value_bwar numeric, expected_value_basis text,
  known_acquisition_cost_usd numeric, cost_complete boolean, cost_coverage_state text, expected_org_bwar_per_million_usd numeric,
  expected_value_state text, expected_value_exclusion_reason text, provenance text
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_support jsonb;
  v_probability jsonb;
begin
  -- stage 1: one row per reviewed value model (v_expected_value_support)
  execute $q$
    select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    from (select value_model_key, value_model_version, probability_target_key, conditional_value_supported, conditional_mean_value_bwar,
            support_state, evidence_as_of_date
          from public.v_expected_value_support) s
  $q$ into v_support;
  -- stage 2: the 041 probability rows of the value models' targets (v_player_outcome_probability)
  execute $q$
    select coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb)
    from (select o.signing_id, o.target_key, o.prediction_as_of_date, o.training_population, o.model_version, o.probability, o.probability_low_90,
            o.probability_high_90, o.prediction_eligible, o.prediction_exclusion_reason
          from public.v_player_outcome_probability o
          where o.target_key in (select probability_target_key from public.expected_value_models)) o
  $q$ into v_probability;
  -- stage 3: the 042 definition, with the rows from stages 1 and 2
  return query execute $q$
    with pr as materialized (
      select * from jsonb_to_recordset($2) as x(signing_id uuid, target_key text, prediction_as_of_date date, training_population text,
        model_version text, probability numeric, probability_low_90 numeric, probability_high_90 numeric, prediction_eligible boolean,
        prediction_exclusion_reason text)
    ),
    s as materialized (
      select * from jsonb_to_recordset($1) as x(value_model_key text, value_model_version text, probability_target_key text,
        conditional_value_supported boolean, conditional_mean_value_bwar numeric, support_state text, evidence_as_of_date date)
    ),
    t as materialized (select signing_id, player_id, player_slug, population_class, signing_route, signing_cutoff_date from public.v_signing_time_features where is_dodgers),
    f as materialized (select signing_id, known_acquisition_cost_usd, acquisition_cost_completeness from public.v_signing_acquisition_financials where is_dodgers),
    j as (
      select t.signing_id, t.player_id, t.player_slug, t.population_class, s.value_model_key, s.value_model_version, s.probability_target_key,
        coalesce(pr.prediction_as_of_date, t.signing_cutoff_date) as decision_as_of_date, s.evidence_as_of_date,
        pr.training_population, pr.model_version as probability_model_version,
        pr.probability, pr.probability_low_90, pr.probability_high_90, coalesce(pr.prediction_eligible, false) as probability_supported,
        pr.prediction_exclusion_reason, s.conditional_value_supported, s.conditional_mean_value_bwar, s.support_state,
        f.known_acquisition_cost_usd, f.acquisition_cost_completeness
      from t
      cross join s
      left join pr on pr.signing_id = t.signing_id and pr.target_key = s.probability_target_key
      left join f on f.signing_id = t.signing_id
    ),
    e as (
      select j.*,
        case
          when j.prediction_exclusion_reason in ('REFERENCE_POPULATION_NOT_SUPPORTED') then 'PROBABILITY_NOT_SUPPORTED'
          when j.prediction_exclusion_reason is not null then 'OUT_OF_SCOPE'
          when not j.probability_supported then 'PROBABILITY_NOT_SUPPORTED'
          when not j.conditional_value_supported or j.conditional_mean_value_bwar is null then 'CONDITIONAL_VALUE_NOT_SUPPORTED'
          else 'EXPECTED_VALUE_SUPPORTED'
        end as expected_value_state
      from j
    )
    select e.signing_id, e.player_id, e.player_slug, e.population_class, e.value_model_key, e.value_model_version, e.probability_target_key,
      e.probability_model_version, e.decision_as_of_date, e.evidence_as_of_date, e.training_population,
      e.probability_supported, e.conditional_value_supported, (e.expected_value_state = 'EXPECTED_VALUE_SUPPORTED') as expected_value_supported,
      case when e.expected_value_state = 'EXPECTED_VALUE_SUPPORTED' then e.probability end as probability,
      case when e.expected_value_state = 'EXPECTED_VALUE_SUPPORTED' then round(e.probability * e.conditional_mean_value_bwar, 3) end as expected_direct_dodgers_bwar,
      case when e.expected_value_state = 'EXPECTED_VALUE_SUPPORTED' then round(e.probability_low_90 * e.conditional_mean_value_bwar, 3) end as expected_direct_dodgers_bwar_low_90,
      case when e.expected_value_state = 'EXPECTED_VALUE_SUPPORTED' then round(e.probability_high_90 * e.conditional_mean_value_bwar, 3) end as expected_direct_dodgers_bwar_high_90,
      null::numeric as expected_trade_realization_bwar,
      'NO_TRADE_REALIZATION_MODEL'::text as trade_realization_exclusion_reason,
      case when e.expected_value_state = 'EXPECTED_VALUE_SUPPORTED' then round(e.probability * e.conditional_mean_value_bwar, 3) end as expected_org_value_bwar,
      'DIRECT_DODGERS_BWAR_ONLY_TRADE_REALIZATION_NOT_MODELLED'::text as expected_value_basis,
      e.known_acquisition_cost_usd, (e.acquisition_cost_completeness = 'COMPLETE') as cost_complete, e.acquisition_cost_completeness as cost_coverage_state,
      case when e.expected_value_state = 'EXPECTED_VALUE_SUPPORTED' and e.acquisition_cost_completeness = 'COMPLETE' and e.known_acquisition_cost_usd > 0
           then round(e.probability * e.conditional_mean_value_bwar / (e.known_acquisition_cost_usd / 1000000.0), 3) end as expected_org_bwar_per_million_usd,
      e.expected_value_state,
      case e.expected_value_state
        when 'EXPECTED_VALUE_SUPPORTED' then null
        when 'OUT_OF_SCOPE' then 'OUT_OF_SCOPE:' || e.prediction_exclusion_reason
        when 'PROBABILITY_NOT_SUPPORTED' then 'PROBABILITY_NOT_SUPPORTED:' || coalesce(e.prediction_exclusion_reason, 'NO_PROBABILITY_ROW')
        else 'CONDITIONAL_VALUE_NOT_SUPPORTED'
      end as expected_value_exclusion_reason,
      format('value model %s (%s) x 041 target %s, reference population %s; support state %s', e.value_model_key, e.value_model_version, e.probability_target_key,
        coalesce(e.training_population, 'none'), e.support_state) as provenance
    from e
  $q$ using v_support, v_probability;
end
$fn$;

comment on function public.disi_player_expected_organizational_value() is
  'Plan-bounded evaluation of v_player_expected_organizational_value (Migration 043a): stage 1 reads the value-model support, stage 2 the 041 probability rows of the model targets, stage 3 the 042 per-signing definition. Read-only (STABLE), invoker rights, fixed search_path. Read it through the view.';

create or replace view public.v_player_expected_organizational_value
with (security_invoker = true)
as
select * from public.disi_player_expected_organizational_value();

-- ---------------------------------------------------------------------------
-- Expected-value research queue (042): unsupported value models and realized-value rows, in separate stages
-- ---------------------------------------------------------------------------
create or replace function public.disi_expected_value_research_queue()
returns table (issue_type text, priority integer, signing_id uuid, player_slug text, subject text, detail text, evidence_needed text)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
begin
  -- stage 1: unsupported value models
  return query execute $q$
    select 'EXPECTED_VALUE_NOT_SUPPORTED'::text, 1, null::uuid, null::text, s.value_model_key,
      s.blocking_reasons,
      'Audit outcomes of mature Dodgers tracked / opening-class signings and add audited class censuses so the 041 target and the conditional value reach their minimums'::text
    from public.v_expected_value_support s where not s.expected_value_supported
  $q$;
  -- stage 2: realized-value resolution and acquisition-cost rows (one pass over the realized organizational value)
  return query execute $q$
    with r as materialized (select * from public.v_player_realized_organizational_value)
    select 'REALIZED_VALUE_UNRESOLVED'::text, 2, r.signing_id, r.player_slug, r.chain_status,
      format('%s: realized organizational value is unresolved (%s)', r.full_name, coalesce(r.chain_status, 'no chain row')),
      'Resolve the transaction lineage interval (identity, timing, return, exit) so attributable bWAR can be summed'::text
    from r where r.realized_value_state = 'VALUE_UNRESOLVED' and r.maturity_status = 'MATURE'
    union all
    select 'REALIZED_VALUE_CHAIN_INCOMPLETE', 3, r.signing_id, r.player_slug, r.chain_status,
      format('%s: value known so far, but the chain is %s', r.full_name, r.chain_status),
      'Research the downstream exit or return so the chain reaches a terminal state'
    from r where r.realized_value_state = 'TO_DATE_CHAIN_INCOMPLETE'
    union all
    select 'ACQUISITION_COST_INCOMPLETE', 4, r.signing_id, r.player_slug, r.cost_coverage_state,
      format('%s: acquisition cost is %s (missing: %s)', r.full_name, r.cost_coverage_state,
        coalesce(nullif(array_to_string(r.cost_components_required_missing || r.cost_components_possible_unknown, ', '), ''), 'no component rule')),
      'Find a public report of the missing acquisition-cost components'
    from r where r.maturity_status = 'MATURE' and not r.cost_complete and r.population_class <> 'OUTCOME_SELECTED_SAMPLE'
  $q$;
end
$fn$;

comment on function public.disi_expected_value_research_queue() is
  'Plan-bounded evaluation of v_expected_value_research_queue (Migration 043a): unsupported value models and realized-value / cost rows in separate stages. Read-only (STABLE), invoker rights, fixed search_path. Read it through the view.';

create or replace view public.v_expected_value_research_queue
with (security_invoker = true)
as
select * from public.disi_expected_value_research_queue();

-- ---------------------------------------------------------------------------
-- Portfolio candidate readiness (043): support, gated expected values, comparable counts and features in separate stages
-- ---------------------------------------------------------------------------
create or replace function public.disi_portfolio_candidate_readiness()
returns table (
  signing_id uuid, player_id uuid, player_slug text, full_name text, signing_year integer, decision_as_of_date date, population_class text,
  signing_route text, pathway text, market_group text, era_key text, age_band text, position_family text, expectation_tier text, cost_band text,
  known_acquisition_cost_usd numeric, cost_complete boolean, cost_coverage_state text, core_features_known integer, core_features_total integer,
  player_data_complete boolean, historical_comparables integer, expected_value_model_supported boolean, expected_org_value_bwar numeric,
  decision_support_state text, optimization_eligible boolean, decision_blockers text[], decision_statement text, outcome_support_evidence text
)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_any_supported boolean;
  v_blockers text;
  v_expected jsonb := '[]'::jsonb;
  v_comparables jsonb;
begin
  -- stage 1: population-level expected-value support (042)
  execute $q$
    select bool_or(expected_value_supported), string_agg(blocking_reasons, '; ' order by value_model_key) from public.v_expected_value_support
  $q$ into v_any_supported, v_blockers;
  -- stage 2: per-candidate expected values, read only when some value model is supported (the 043 one-time filter)
  if v_any_supported then
    execute $q$
      select coalesce(jsonb_agg(jsonb_build_object('signing_id', e.signing_id, 'expected_org_value_bwar', e.expected_org_value_bwar,
        'expected_value_state', e.expected_value_state)), '[]'::jsonb)
      from public.v_player_expected_organizational_value e
    $q$ into v_expected;
  end if;
  -- stage 3: outcome-free comparable counts (040)
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object('target_signing_id', c.target_signing_id, 'historical_comparables', c.historical_comparables)), '[]'::jsonb)
    from (select target_signing_id, sum(comparables)::int as historical_comparables from public.v_player_comparable_summary group by target_signing_id) c
  $q$ into v_comparables;
  -- stage 4: the 043 definition over the signing-time features (039), with the stage results
  return query execute $q$
    with f as materialized (select * from public.v_signing_time_features where is_dodgers),
    s as (select $1::boolean as any_supported, $2::text as blockers),
    ev as materialized (select * from jsonb_to_recordset($3) as x(signing_id uuid, expected_org_value_bwar numeric, expected_value_state text)),
    cmp as materialized (select * from jsonb_to_recordset($4) as x(target_signing_id uuid, historical_comparables int)),
    j as (
      select f.*, coalesce(s.any_supported, false) as outcome_support, s.blockers, ev.expected_org_value_bwar, ev.expected_value_state,
        coalesce(cmp.historical_comparables, 0) as historical_comparables,
        (f.has_age and f.has_position and f.has_market) as player_data_complete,
        (f.acquisition_cost_completeness = 'COMPLETE') as cost_complete,
        (f.population_class = 'OUTCOME_SELECTED_SAMPLE' or f.signing_route = 'PROFESSIONAL_SIGNING') as out_of_scope
      from f
      cross join s
      left join ev on ev.signing_id = f.signing_id
      left join cmp on cmp.target_signing_id = f.signing_id
    ),
    d as (
      select j.*,
        case
          when j.out_of_scope then 'OUT_OF_SCOPE'
          when not j.player_data_complete then 'INSUFFICIENT_PLAYER_DATA'
          when not j.outcome_support and j.historical_comparables > 0 then 'HISTORICAL_CONTEXT_ONLY'
          when not j.outcome_support then 'INSUFFICIENT_OUTCOME_SUPPORT'
          when not j.cost_complete then 'INSUFFICIENT_COST_DATA'
          when j.expected_org_value_bwar is null then 'INSUFFICIENT_OUTCOME_SUPPORT'
          else 'PREDICTIVE_DECISION_SUPPORTED'
        end as decision_support_state,
        array_remove(array[
          case when j.population_class = 'OUTCOME_SELECTED_SAMPLE' then 'OUTCOME_SELECTED_POPULATION' end,
          case when j.signing_route = 'PROFESSIONAL_SIGNING' then 'PROFESSIONAL_ROUTE_NOT_MODELLED' end,
          case when not j.player_data_complete then 'MISSING_SIGNING_TIME_FEATURES' end,
          case when not j.outcome_support then 'EXPECTED_VALUE_NOT_SUPPORTED' end,
          case when j.outcome_support and j.expected_org_value_bwar is null then 'EXPECTED_VALUE_UNAVAILABLE:' || coalesce(j.expected_value_state, 'NO_ROW') end,
          case when not j.cost_complete then 'ACQUISITION_COST_' || coalesce(j.acquisition_cost_completeness, 'UNKNOWN') end
        ], null) as decision_blockers
      from j
    )
    select d.signing_id, d.player_id, d.player_slug, d.full_name, d.signing_year, d.signing_cutoff_date as decision_as_of_date,
      d.population_class, d.signing_route, d.pathway, d.market_group, d.era_key, d.age_band, d.position_family, d.expectation_tier, d.cost_band,
      d.known_acquisition_cost_usd, d.cost_complete, d.acquisition_cost_completeness as cost_coverage_state,
      d.core_features_known, d.core_features_total, d.player_data_complete, d.historical_comparables,
      d.outcome_support as expected_value_model_supported,
      case when d.decision_support_state = 'PREDICTIVE_DECISION_SUPPORTED' then d.expected_org_value_bwar end as expected_org_value_bwar,
      d.decision_support_state,
      (d.decision_support_state = 'PREDICTIVE_DECISION_SUPPORTED') as optimization_eligible,
      d.decision_blockers,
      case d.decision_support_state
        when 'PREDICTIVE_DECISION_SUPPORTED' then 'Expected organizational value, cost and signing-time features are supported; the candidate may enter value-based portfolio optimization.'
        when 'HISTORICAL_CONTEXT_ONLY' then 'Expected value is not supported; DISI can show this candidate''s signing-time profile and earlier comparable signings as historical context only. No ranking or predicted return.'
        when 'INSUFFICIENT_OUTCOME_SUPPORT' then 'Expected value is not supported and no earlier comparable signing is listed; DISI can describe the candidate but not evaluate it.'
        when 'INSUFFICIENT_COST_DATA' then 'Expected value is supported but the acquisition cost is incomplete, so no value-per-cost or budget decision is possible.'
        when 'INSUFFICIENT_PLAYER_DATA' then 'Age, position or market at signing is unknown; the candidate cannot be placed in a reference population.'
        else 'Outside the modelled population (outcome-selected historical record or professional signing).'
      end as decision_statement,
      coalesce(d.blockers, 'no value model recorded') as outcome_support_evidence
    from d
  $q$ using v_any_supported, v_blockers, v_expected, v_comparables;
end
$fn$;

comment on function public.disi_portfolio_candidate_readiness() is
  'Plan-bounded evaluation of v_portfolio_candidate_readiness (Migration 043a): stage 1 reads expected-value support, stage 2 the per-candidate expected values ONLY when a value model is supported, stage 3 the comparable counts, stage 4 the 043 definition over the signing-time features. Read-only (STABLE), invoker rights, fixed search_path. Read it through the view.';

create or replace view public.v_portfolio_candidate_readiness
with (security_invoker = true)
as
select * from public.disi_portfolio_candidate_readiness();

-- the four functions are reachable only as the views' bodies: no PUBLIC execute, and the API roles that may read the views may run them
do $$
declare f text;
begin
  foreach f in array array['disi_player_realized_organizational_value()', 'disi_player_expected_organizational_value()', 'disi_expected_value_research_queue()',
    'disi_portfolio_candidate_readiness()'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
