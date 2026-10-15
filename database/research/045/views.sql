-- Migration 045 views: release status, research roadmap and executive metric provenance. Spliced into 045_template.sql by build.mjs.

-- ---------------------------------------------------------------------------
-- Release status: the DISI version, data freshness, model versions and the support state of every predictive layer
-- ---------------------------------------------------------------------------
create or replace view public.v_disi_release_status
with (security_invoker = true)
as
-- the support counts are the executive overview's (044): the same definitions - 041 targets, 042 value models, and recommendations
-- counted only when some expected value is supported - computed once by its staged function instead of re-planning every layer here
with c as materialized (
  select o.probability_targets as targets, o.supported_probability_targets as supported_targets,
    o.expected_value_models as ev_models, o.supported_expected_value_models as supported_ev_models,
    o.predictive_portfolio_recommendations as recommendations
  from public.v_executive_overview o
)
select
  '{{product_version}}'::text as product_version,
  '{{schema_version}}'::text as schema_version,
  '045_final_integration_release.sql'::text as canonical_through,
  (select max(audited_through_date) from public.outcome_audits) as analysis_as_of_date,
  (select max(audited_through_date) from public.outcome_audits) as latest_outcome_audit_date,
  (select max(as_of_date) from public.player_season_stints) as latest_development_data_date,
  (select max(data_as_of_date) from public.outcome_model_evaluations) as model_evaluation_data_as_of,
  (select string_agg(distinct model_version, ', ') from public.outcome_model_evaluations) as probability_model_version,
  (select string_agg(value_model_version, ', ' order by value_model_key) from public.expected_value_models) as value_model_version,
  '{{decision_engine_version}}'::text as decision_engine_version,
  c.targets as probability_targets, c.supported_targets as supported_probability_targets,
  c.ev_models as expected_value_models, c.supported_ev_models as supported_expected_value_models,
  c.recommendations as predictive_portfolio_recommendations,
  case
    when c.supported_targets = 0 then 'NO_PREDICTIVE_LAYER_SUPPORTED'
    when c.supported_ev_models = 0 then 'PROBABILITY_ONLY'
    when c.recommendations = 0 then 'EXPECTED_VALUE_SUPPORTED_NO_ELIGIBLE_CANDIDATE'
    else 'PREDICTIVE_DECISIONS_SUPPORTED'
  end as support_chain_state,
  (select count(*) from public.disi_product_contract)::int as product_contract_relations,
  'Provenance-first international signing intelligence and decision support. DISI publishes an estimate only when its evidence meets the documented support threshold.'::text as product_statement
from c;

comment on view public.v_disi_release_status is
  'DISI release status (Migration 045): one row with the product and schema version, data freshness (analysis as-of date, latest outcome audit, latest development data, model evaluation data date), the probability, value and decision-engine versions, and the support state of each predictive layer (041 targets, 042 expected-value models, 043 recommendations) summarized as support_chain_state.';

-- ---------------------------------------------------------------------------
-- Research roadmap: the highest-value research gaps and what each would unlock
-- ---------------------------------------------------------------------------
-- Staged like the executive overview: each research queue is counted by its own statement, so the roadmap never plans every queue in
-- one statement.
create or replace function public.disi_research_roadmap()
returns table (priority integer, gap_area text, open_items integer, item_unit text, unlocks text, evidence_needed text, source_view text)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_audits int;
  v_population int;
  v_cost int;
  v_features int;
  c record;
  v_closest_found boolean;
  v_incomplete int;
  v_unresolved int;
  v_benchmark int;
  v_scouting int;
  v_scouting_expectation int;
  v_rows int;
begin
  execute $q$
    with t as materialized (select task_type from public.v_research_tasks where franchise_key = 'DODGERS')
    select (select count(*) from t where task_type = 'OUTCOME_AUDIT')::int,
      (select count(*) from t where task_type in ('CLASS_MEMBERS_MISSING', 'CLASS_SIZE_SOURCE_NOT_OFFICIAL'))::int,
      (select count(*) from t where task_type = 'ACQUISITION_COST_UNKNOWN')::int,
      (select count(*) from t where task_type in ('MARKET_MISSING', 'SIGNING_DATE_MISSING'))::int
  $q$ into v_audits, v_population, v_cost, v_features;
  -- the closest unsupported Dodgers target
  execute $q$
    select target_label, additional_positives_needed, additional_labels_needed, greatest(min_negatives - negative_n, 0) as additional_negatives_needed
    from public.v_prediction_readiness
    where reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS' and not baseline_supported
    order by additional_positives_needed + additional_labels_needed, target_key limit 1
  $q$ into c;
  get diagnostics v_rows = row_count;
  v_closest_found := v_rows = 1;
  execute $q$
    select count(*) filter (where chain_status like 'INCOMPLETE%')::int,
      count(*) filter (where total_individually_attributable_organizational_bwar is null and chain_status in ('COMPLETE_TERMINAL', 'STILL_ACTIVE'))::int
    from public.v_downstream_organizational_realization where row_grain = 'SIGNING'
  $q$ into v_incomplete, v_unresolved;
  execute $q$ select count(*)::int from public.v_international_benchmark_research_queue $q$ into v_benchmark;
  execute $q$ select count(*)::int from public.v_scouting_research_queue $q$ into v_scouting;
  execute $q$ select count(*)::int from public.v_scouting_expectation_research_queue $q$ into v_scouting_expectation;
  return query
  select 1, 'OUTCOME_AUDITS'::text, v_audits, 'signings awaiting an outcome audit'::text,
    'Labels for the 041 outcome targets (probability support), resolved realized value (042) and census-eligible rates (039)'::text,
    'Audit MLB / no-MLB outcomes of mature tracked and opening-class signings first'::text, 'v_research_tasks'::text
  union all
  select 2, 'PREDICTION_SUPPORT', case when v_closest_found then coalesce(c.additional_labels_needed, 0) else 0 end,
    'more labelled Dodgers outcomes needed for the closest target',
    'Outcome probabilities (041) -> expected organizational value (042) -> portfolio recommendations (043)',
    case when v_closest_found then format('Closest Dodgers target "%s": +%s labelled, +%s positive, +%s negative outcomes', c.target_label,
      c.additional_labels_needed, c.additional_positives_needed, c.additional_negatives_needed) else 'Every Dodgers target is supported' end,
    'v_prediction_readiness'
  union all
  select 3, 'POPULATION_COMPLETENESS', v_population, 'class-population research items',
    'Complete signing-class censuses: census rates (039) and unbiased training populations (041)',
    'Add audited 2015-2019 Dodgers class censuses and confirm class sizes from official sources', 'v_research_tasks'
  union all
  select 4, 'COST_COVERAGE', v_cost, 'signings with unknown acquisition cost',
    'Complete-cost value ratios (042), budget feasibility and value-per-cost optimization (043)',
    'Find publicly reported signing bonuses (and any posting / transfer fee)', 'v_research_tasks'
  union all
  select 5, 'BENCHMARK_DEPTH', v_benchmark, 'benchmark research items',
    'A deeper top-prospect reference population (041 benchmark support)', 'Resolve benchmark identities and extend to the 2015-2018 classes',
    'v_international_benchmark_research_queue'
  union all
  select 6, 'SIGNING_TIME_FEATURES', v_features, 'signings missing market or signing date',
    'Complete signing-time features: archetypes and comparables (040), decision readiness (043)', 'Research market and signing date at signing',
    'v_research_tasks'
  union all
  select 7, 'SCOUTING_COVERAGE', (v_scouting + v_scouting_expectation)::int, 'scouting research items',
    'Expectations at signing for more signings (036 calibration, 040 comparables)',
    'Archive public rankings and evaluations published before each signing', 'v_scouting_research_queue, v_scouting_expectation_research_queue'
  union all
  select 8, 'REALIZED_VALUE_RESOLUTION', (v_incomplete + v_unresolved)::int, 'transaction chains incomplete or unresolved',
    'Resolved realized organizational value (042) and conditional-value support', 'Research downstream exits, returns and timing of traded assets',
    'v_downstream_organizational_realization';
end
$fn$;

comment on function public.disi_research_roadmap() is
  'Staged evaluation of v_research_roadmap (Migration 045): each research queue counted by its own statement. Read-only (STABLE), invoker rights, fixed search_path. Read it through the view.';

create or replace view public.v_research_roadmap
with (security_invoker = true)
as
select * from public.disi_research_roadmap();

comment on view public.v_research_roadmap is
  'Research roadmap (Migration 045): the highest-value research gaps in priority order, each with its open items (from the research queues), what it would unlock in the DISI stack and the evidence needed. Priorities follow the support chain: outcome audits and population completeness come first because prediction support depends on them.';

-- ---------------------------------------------------------------------------
-- Executive metric provenance: every executive figure with its population, denominator, provenance and eligibility rule
-- ---------------------------------------------------------------------------
create or replace view public.v_executive_metric_provenance
with (security_invoker = true)
as
select m.metric_key, m.label, m.definition, m.denominator_column, m.provenance, m.eligibility_rule, m.metric_kind,
  'v_executive_overview'::text as reported_in
from (values
{{metric_values}}
) as m(metric_key, label, definition, denominator_column, provenance, eligibility_rule, metric_kind);

comment on view public.v_executive_metric_provenance is
  'Executive metric provenance (Migration 045): every figure in v_executive_overview with its definition, the overview column holding its denominator, its provenance (source views / tables) and its eligibility rule. The verifier checks every named column exists.';
