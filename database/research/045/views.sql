-- Migration 045 views: release status, research roadmap and executive metric provenance. Spliced into 045_template.sql by build.mjs.

-- ---------------------------------------------------------------------------
-- Release status: the DISI version, data freshness, model versions and the support state of every predictive layer
-- ---------------------------------------------------------------------------
create or replace view public.v_disi_release_status
with (security_invoker = true)
as
with sup as materialized (select target_key, baseline_supported from public.v_outcome_target_support),
evs as materialized (select expected_value_supported from public.v_expected_value_support),
flag as (select coalesce(bool_or(expected_value_supported), false) as any_ev from evs),
-- per-candidate recommendations are counted only when some expected value is supported (a one-time filter)
rec as (select count(*) filter (where optimization_eligible)::int as n from public.v_portfolio_candidate_readiness where (select any_ev from flag)),
c as (
  select (select count(distinct target_key) from sup)::int as targets,
    (select count(distinct target_key) from sup where baseline_supported)::int as supported_targets,
    (select count(*) from evs)::int as ev_models,
    (select count(*) from evs where expected_value_supported)::int as supported_ev_models,
    coalesce((select n from rec), 0) as recommendations
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
create or replace view public.v_research_roadmap
with (security_invoker = true)
as
with t as materialized (select task_type from public.v_research_tasks where franchise_key = 'DODGERS'),
pr as materialized (select * from public.v_prediction_readiness where reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS'),
closest as (
  select target_label, additional_positives_needed, additional_labels_needed, greatest(min_negatives - negative_n, 0) as additional_negatives_needed
  from pr where not baseline_supported
  order by additional_positives_needed + additional_labels_needed, target_key limit 1
),
chain as materialized (
  select count(*) filter (where chain_status like 'INCOMPLETE%')::int as incomplete,
    count(*) filter (where total_individually_attributable_organizational_bwar is null and chain_status in ('COMPLETE_TERMINAL', 'STILL_ACTIVE'))::int as unresolved
  from public.v_downstream_organizational_realization where row_grain = 'SIGNING'
),
gaps(gap_area, priority, open_items, item_unit, unlocks, evidence_needed, source_view) as (
  select 'OUTCOME_AUDITS', 1, (select count(*) from t where task_type = 'OUTCOME_AUDIT')::int, 'signings awaiting an outcome audit',
    'Labels for the 041 outcome targets (probability support), resolved realized value (042) and census-eligible rates (039)',
    'Audit MLB / no-MLB outcomes of mature tracked and opening-class signings first', 'v_research_tasks'
  union all
  select 'PREDICTION_SUPPORT', 2, coalesce((select additional_labels_needed from closest), 0),
    'more labelled Dodgers outcomes needed for the closest target',
    'Outcome probabilities (041) -> expected organizational value (042) -> portfolio recommendations (043)',
    coalesce((select format('Closest Dodgers target "%s": +%s labelled, +%s positive, +%s negative outcomes', target_label, additional_labels_needed,
      additional_positives_needed, additional_negatives_needed) from closest), 'Every Dodgers target is supported'),
    'v_prediction_readiness'
  union all
  select 'POPULATION_COMPLETENESS', 3, (select count(*) from t where task_type in ('CLASS_MEMBERS_MISSING', 'CLASS_SIZE_SOURCE_NOT_OFFICIAL'))::int,
    'class-population research items',
    'Complete signing-class censuses: census rates (039) and unbiased training populations (041)',
    'Add audited 2015-2019 Dodgers class censuses and confirm class sizes from official sources', 'v_research_tasks'
  union all
  select 'COST_COVERAGE', 4, (select count(*) from t where task_type = 'ACQUISITION_COST_UNKNOWN')::int, 'signings with unknown acquisition cost',
    'Complete-cost value ratios (042), budget feasibility and value-per-cost optimization (043)',
    'Find publicly reported signing bonuses (and any posting / transfer fee)', 'v_research_tasks'
  union all
  select 'BENCHMARK_DEPTH', 5, (select count(*) from public.v_international_benchmark_research_queue)::int, 'benchmark research items',
    'A deeper top-prospect reference population (041 benchmark support)', 'Resolve benchmark identities and extend to the 2015-2018 classes',
    'v_international_benchmark_research_queue'
  union all
  select 'SIGNING_TIME_FEATURES', 6, (select count(*) from t where task_type in ('MARKET_MISSING', 'SIGNING_DATE_MISSING'))::int,
    'signings missing market or signing date',
    'Complete signing-time features: archetypes and comparables (040), decision readiness (043)', 'Research market and signing date at signing',
    'v_research_tasks'
  union all
  select 'SCOUTING_COVERAGE', 7, ((select count(*) from public.v_scouting_research_queue) + (select count(*) from public.v_scouting_expectation_research_queue))::int,
    'scouting research items', 'Expectations at signing for more signings (036 calibration, 040 comparables)',
    'Archive public rankings and evaluations published before each signing', 'v_scouting_research_queue, v_scouting_expectation_research_queue'
  union all
  select 'REALIZED_VALUE_RESOLUTION', 8, ((select incomplete from chain) + (select unresolved from chain))::int, 'transaction chains incomplete or unresolved',
    'Resolved realized organizational value (042) and conditional-value support', 'Research downstream exits, returns and timing of traded assets',
    'v_downstream_organizational_realization'
)
select g.priority, g.gap_area, g.open_items, g.item_unit, g.unlocks, g.evidence_needed, g.source_view from gaps g;

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
