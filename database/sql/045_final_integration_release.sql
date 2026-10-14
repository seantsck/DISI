-- DISI v0.36
-- 045_final_integration_release.sql
-- Final integration (DISI v1.0.0): the product contract (the relations the application reads, each with its area, tier, routes and
-- the migration that introduced it), the release status (version, data freshness, model / value / decision-engine versions and the
-- support state of every predictive layer), the research roadmap (the highest-value gaps and what each unlocks) and executive metric
-- provenance (population, denominator, provenance and eligibility of every executive figure). Run after 044. The release status reads
-- its support counts from the executive overview and the roadmap is a staged function, so neither plans the whole stack at once.
--
-- Built from database/research/045/ (contract.json, metrics.json, views.sql, build.mjs; design in
-- ../042/final-decision-architecture.md).
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED PRODUCT CONTRACT (database/research/045/contract.json)
-- ===========================================================================

create temporary table _m045 on commit drop as
select $m045${"contract":[{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"017","product_area":"OUTCOMES","purpose":"bWAR / fWAR observations with source and date (never blended)","relation_kind":"TABLE","relation_name":"player_metric_observations"},{"app_routes":["/research"],"contract_tier":"PAGE","introduced_in":"017","product_area":"PROVENANCE","purpose":"Source priority tiers","relation_kind":"TABLE","relation_name":"source_tiers"},{"app_routes":["/research"],"contract_tier":"PAGE","introduced_in":"017","product_area":"RESEARCH","purpose":"Class research coverage","relation_kind":"VIEW","relation_name":"v_class_research_coverage"},{"app_routes":["/"],"contract_tier":"EXECUTIVE","introduced_in":"017","product_area":"COVERAGE","purpose":"Database coverage summary","relation_kind":"VIEW","relation_name":"v_database_status"},{"app_routes":["/research"],"contract_tier":"PAGE","introduced_in":"018","product_area":"RESEARCH","purpose":"Unresolved class source conflicts","relation_kind":"VIEW","relation_name":"v_dodgers_class_source_reconciliation"},{"app_routes":["/development"],"contract_tier":"PAGE","introduced_in":"021","product_area":"DEVELOPMENT","purpose":"Development by bonus band","relation_kind":"VIEW","relation_name":"v_dodgers_development_by_bonus_band"},{"app_routes":["/development"],"contract_tier":"PAGE","introduced_in":"021","product_area":"DEVELOPMENT","purpose":"Development by market","relation_kind":"VIEW","relation_name":"v_dodgers_development_by_market"},{"app_routes":["/development"],"contract_tier":"PAGE","introduced_in":"021","product_area":"DEVELOPMENT","purpose":"Development by signing class","relation_kind":"VIEW","relation_name":"v_dodgers_development_by_signing_class"},{"app_routes":["/development"],"contract_tier":"PAGE","introduced_in":"021","product_area":"DEVELOPMENT","purpose":"Development data coverage","relation_kind":"VIEW","relation_name":"v_dodgers_development_coverage"},{"app_routes":["/development"],"contract_tier":"PAGE","introduced_in":"021","product_area":"DEVELOPMENT","purpose":"Development research queue","relation_kind":"VIEW","relation_name":"v_dodgers_development_research_queue"},{"app_routes":["/"],"contract_tier":"PAGE","introduced_in":"016","product_area":"OUTCOMES","purpose":"Verified MLB outcomes of Dodgers signings","relation_kind":"VIEW","relation_name":"v_dodgers_known_mlb_outcomes"},{"app_routes":["/research"],"contract_tier":"PAGE","introduced_in":"019","product_area":"OUTCOMES","purpose":"Outcome audit progress","relation_kind":"VIEW","relation_name":"v_dodgers_outcome_audit_progress"},{"app_routes":["/research"],"contract_tier":"PAGE","introduced_in":"019","product_area":"OUTCOMES","purpose":"Outcome audits by signing class","relation_kind":"VIEW","relation_name":"v_dodgers_outcome_by_signing_class"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"021","product_area":"DEVELOPMENT","purpose":"Per-player development summary","relation_kind":"VIEW","relation_name":"v_dodgers_player_development_summary"},{"app_routes":["/"],"contract_tier":"PAGE","introduced_in":"016","product_area":"OUTCOMES","purpose":"Rate-eligible class summary (no organization-wide rate otherwise)","relation_kind":"VIEW","relation_name":"v_dodgers_rate_eligible_summary"},{"app_routes":["/research"],"contract_tier":"PAGE","introduced_in":"018","product_area":"RESEARCH","purpose":"Signing-period research queue","relation_kind":"VIEW","relation_name":"v_dodgers_signing_period_research_queue"},{"app_routes":["/research"],"contract_tier":"PAGE","introduced_in":"018","product_area":"RESEARCH","purpose":"Signing-population coverage","relation_kind":"VIEW","relation_name":"v_dodgers_signing_population_coverage"},{"app_routes":["/","/prediction-readiness"],"contract_tier":"EXECUTIVE","introduced_in":"044","product_area":"EXECUTIVE","purpose":"One-row executive summary: coverage, known spend, realized organizational value and predictive support states","relation_kind":"VIEW","relation_name":"v_executive_overview"},{"app_routes":["/portfolio","/prediction-readiness"],"contract_tier":"PAGE","introduced_in":"042","product_area":"ORGANIZATIONAL_VALUE","purpose":"Expected-value model support and blockers","relation_kind":"VIEW","relation_name":"v_expected_value_support"},{"app_routes":["/portfolio"],"contract_tier":"PAGE","introduced_in":"043","product_area":"PORTFOLIO","purpose":"Retrospective capital allocation, concentration and realized value","relation_kind":"VIEW","relation_name":"v_historical_portfolio_summary"},{"app_routes":["/league"],"contract_tier":"PAGE","introduced_in":"013","product_area":"LEAGUE","purpose":"Cross-organization signing volume","relation_kind":"VIEW","relation_name":"v_league_org_benchmark"},{"app_routes":["/league"],"contract_tier":"PAGE","introduced_in":"014","product_area":"LEAGUE","purpose":"Organization period summaries","relation_kind":"VIEW","relation_name":"v_league_period_org_summary"},{"app_routes":["/markets"],"contract_tier":"PAGE","introduced_in":"017","product_area":"MARKETS","purpose":"Signings, cost and outcomes by market","relation_kind":"VIEW","relation_name":"v_market_research_summary"},{"app_routes":["/prediction-readiness"],"contract_tier":"PAGE","introduced_in":"041","product_area":"PREDICTION_READINESS","purpose":"Recorded out-of-time model evaluation with currency check","relation_kind":"VIEW","relation_name":"v_outcome_model_evaluation"},{"app_routes":["/markets"],"contract_tier":"PAGE","introduced_in":"017","product_area":"MARKETS","purpose":"Signings, cost and outcomes by pathway","relation_kind":"VIEW","relation_name":"v_pathway_research_summary"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"040","product_area":"COMPARABLES","purpose":"Earlier comparable signings by population class (historical context)","relation_kind":"VIEW","relation_name":"v_player_comparable_summary"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"021","product_area":"DEVELOPMENT","purpose":"Development milestones","relation_kind":"VIEW","relation_name":"v_player_development_milestones"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"021","product_area":"DEVELOPMENT","purpose":"Season-level development stints","relation_kind":"VIEW","relation_name":"v_player_development_stints"},{"app_routes":["/players","/asset-conversion","/api/player-search"],"contract_tier":"PAGE","introduced_in":"017","product_area":"PLAYERS","purpose":"Player directory and search","relation_kind":"VIEW","relation_name":"v_player_directory"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"017","product_area":"PLAYERS","purpose":"One row per player: identity, acquisition, outcome","relation_kind":"VIEW","relation_name":"v_player_dossier"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"042","product_area":"ORGANIZATIONAL_VALUE","purpose":"Expected organizational value state per Dodgers signing","relation_kind":"VIEW","relation_name":"v_player_expected_organizational_value"},{"app_routes":["/players"],"contract_tier":"PAGE","introduced_in":"017","product_area":"PLAYERS","purpose":"Player directory filter facets","relation_kind":"VIEW","relation_name":"v_player_filter_options"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"042","product_area":"ORGANIZATIONAL_VALUE","purpose":"Realized organizational value per Dodgers signing, components separate","relation_kind":"VIEW","relation_name":"v_player_realized_organizational_value"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"026","product_area":"SCOUTING","purpose":"External scouting evaluations over time","relation_kind":"VIEW","relation_name":"v_player_scouting_timeline"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"029","product_area":"NETWORK","purpose":"Source-stated trainer / academy associations","relation_kind":"VIEW","relation_name":"v_player_signing_network"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"017","product_area":"PROVENANCE","purpose":"Sources and provenance per fact","relation_kind":"VIEW","relation_name":"v_player_sources"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"017","product_area":"PLAYERS","purpose":"Player event timeline","relation_kind":"VIEW","relation_name":"v_player_timeline"},{"app_routes":["/players/[slug]","/asset-conversion"],"contract_tier":"DOSSIER","introduced_in":"017","product_area":"TRANSACTIONS","purpose":"Transactions and trade packages","relation_kind":"VIEW","relation_name":"v_player_transactions"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"043","product_area":"PORTFOLIO","purpose":"Decision-support state at the signing date","relation_kind":"VIEW","relation_name":"v_portfolio_candidate_readiness"},{"app_routes":["/portfolio"],"contract_tier":"EXECUTIVE","introduced_in":"043","product_area":"PORTFOLIO","purpose":"Candidates per decision-support state with what DISI may and may not say","relation_kind":"VIEW","relation_name":"v_portfolio_decision_support"},{"app_routes":["/portfolio"],"contract_tier":"PAGE","introduced_in":"043","product_area":"PORTFOLIO","purpose":"Pool scenarios: budget feasibility and (when supported) value optimization","relation_kind":"VIEW","relation_name":"v_portfolio_scenario_evaluation"},{"app_routes":["/prediction-readiness"],"contract_tier":"EXECUTIVE","introduced_in":"044","product_area":"PREDICTION_READINESS","purpose":"Evidence, minimums and what is still needed per outcome target and reference population","relation_kind":"VIEW","relation_name":"v_prediction_readiness"},{"app_routes":["/research"],"contract_tier":"PAGE","introduced_in":"017","product_area":"RESEARCH","purpose":"Open research tasks","relation_kind":"VIEW","relation_name":"v_research_tasks"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"020","product_area":"PLAYERS","purpose":"Derived ages at signing","relation_kind":"VIEW","relation_name":"v_signing_ages"},{"app_routes":["/league"],"contract_tier":"PAGE","introduced_in":"012","product_area":"LEAGUE","purpose":"Signing data coverage by period","relation_kind":"VIEW","relation_name":"v_signing_data_coverage"},{"app_routes":["/signings"],"contract_tier":"PAGE","introduced_in":"017","product_area":"SIGNINGS","purpose":"Signing table filter facets","relation_kind":"VIEW","relation_name":"v_signing_filter_options"},{"app_routes":["/players/[slug]"],"contract_tier":"DOSSIER","introduced_in":"018","product_area":"POPULATIONS","purpose":"Signing-population memberships","relation_kind":"VIEW","relation_name":"v_signing_population_memberships"},{"app_routes":["/","/signings","/development","/league","/players/[slug]"],"contract_tier":"PAGE","introduced_in":"017","product_area":"SIGNINGS","purpose":"One row per signing record","relation_kind":"VIEW","relation_name":"v_signing_records"}]}$m045$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
begin
  if to_regclass('public.v_executive_overview') is null or to_regclass('public.v_prediction_readiness') is null
     or to_regprocedure('public.disi_executive_overview()') is null then
    raise exception '045: Migration 044 has not been applied';
  end if;
end $$;

-- ===========================================================================
-- 2. TABLE (written only by migrations)
-- ===========================================================================

create table if not exists public.disi_product_contract (
  relation_name text primary key check (relation_name ~ '^[a-z][a-z0-9_]*$'),
  relation_kind text not null check (relation_kind in ('VIEW', 'TABLE')),
  product_area text not null check (product_area ~ '^[A-Z_]+$'),
  contract_tier text not null check (contract_tier in ('EXECUTIVE', 'PAGE', 'DOSSIER', 'RESEARCH')),
  app_routes text[] not null check (cardinality(app_routes) > 0),
  purpose text not null check (btrim(purpose) <> '' and char_length(purpose) <= 400),
  introduced_in text not null check (introduced_in ~ '^[0-9]{3}[a-z]?$'),
  created_at timestamptz not null default now()
);

comment on table public.disi_product_contract is
  'The DISI v1 product contract (Migration 045): every relation the application reads, with its product area, tier (EXECUTIVE = bounded summary, PAGE, DOSSIER = filtered per player, RESEARCH), the routes that read it and the migration that introduced it. Other public views remain readable research views but are not product API.';

alter table public.disi_product_contract enable row level security;
revoke all on table public.disi_product_contract from anon, authenticated;
grant select on table public.disi_product_contract to anon, authenticated;
drop policy if exists public_read_disi_product_contract on public.disi_product_contract;
create policy public_read_disi_product_contract on public.disi_product_contract for select to anon, authenticated using (true);

insert into public.disi_product_contract (relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in)
select x ->> 'relation_name', x ->> 'relation_kind', x ->> 'product_area', x ->> 'contract_tier',
       array(select jsonb_array_elements_text(x -> 'app_routes')), x ->> 'purpose', x ->> 'introduced_in'
from _m045, jsonb_array_elements(j -> 'contract') x
on conflict (relation_name) do nothing;

-- ===========================================================================
-- 3. VIEWS
-- ===========================================================================

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
  'DISI v1.0.0'::text as product_version,
  'v0.36'::text as schema_version,
  '045_final_integration_release.sql'::text as canonical_through,
  (select max(audited_through_date) from public.outcome_audits) as analysis_as_of_date,
  (select max(audited_through_date) from public.outcome_audits) as latest_outcome_audit_date,
  (select max(as_of_date) from public.player_season_stints) as latest_development_data_date,
  (select max(data_as_of_date) from public.outcome_model_evaluations) as model_evaluation_data_as_of,
  (select string_agg(distinct model_version, ', ') from public.outcome_model_evaluations) as probability_model_version,
  (select string_agg(value_model_version, ', ' order by value_model_key) from public.expected_value_models) as value_model_version,
  'portfolio-decision-v1'::text as decision_engine_version,
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
  ('dodgers_signings', 'Dodgers international signings', 'All Dodgers-franchise signing records in DISI (tracked, opening-class census and outcome-selected historical records)', 'dodgers_signings', 'v_player_realized_organizational_value (one row per Dodgers signing)', 'Every Dodgers signing; populations are labelled, never pooled into a rate', 'FACT'),
  ('dodgers_outcome_selected_signings', 'Outcome-selected historical signings', 'Dodgers signings recorded because they became notable', 'dodgers_signings', 'v_signing_time_features.population_class', 'Excluded from every rate, distribution and training population', 'FACT'),
  ('verified_mlb_players', 'Verified MLB players', 'Dodgers signings with an audited MLB debut', 'dodgers_signings', 'v_player_realized_outcome / outcome_audits', 'Unaudited signings are unknown, never failures; a count, not a rate', 'FACT'),
  ('known_acquisition_spend_usd', 'Known acquisition spend', 'Sum of KNOWN acquisition-cost components (bonus, posting, transfer, release, other) of Dodgers signings', 'signings_with_known_cost', 'v_signing_acquisition_financials; acquisition_cost_component_rules', 'A lower bound while spend_state = KNOWN_SPEND_IS_A_LOWER_BOUND; unknown cost is never $0; pool charges are not acquisition cost', 'FACT'),
  ('realized_org_value_bwar', 'Realized organizational value', 'Regular-season bWAR the Dodgers obtained: direct Dodgers bWAR + individually attributable (sole-outgoing-asset) trade-return bWAR', 'signings_with_resolved_value', 'v_player_realized_organizational_value <- v_downstream_organizational_realization (034) <- player_mlb_team_season_war', 'Resolved values only (realized_value_state REALIZED_TO_DATE / TO_DATE_CHAIN_INCOMPLETE); package and observable-not-attributable value never added; bWAR only', 'FACT'),
  ('value_left_organization_bwar', 'MLB value produced for other clubs', 'MLB bWAR of Dodgers signings in non-Dodgers team-seasons', 'signings_with_other_club_value_known', 'v_player_organizational_realization.non_dodgers_mlb_bwar', 'Not Dodgers organizational value; reported separately', 'FACT'),
  ('supported_probability_targets', 'Supported outcome targets', 'Outcome targets whose reference population meets the 50 / 10 / 10 support minimum', 'probability_targets', 'v_outcome_target_support (041)', 'Support rule fixed in outcome_targets; populations never pooled', 'SUPPORT_STATE'),
  ('non_null_probabilities', 'Published player probabilities', 'Player x target probabilities that are not NULL', 'probability_rows', 'v_player_outcome_probability (041)', 'Only eligible, open-outcome Dodgers amateur rows of a supported population', 'SUPPORT_STATE'),
  ('supported_expected_values', 'Supported expected organizational values', 'Player expected values that are not NULL', 'dodgers_signings', 'v_player_expected_organizational_value (042)', 'Requires a supported 041 probability AND a supported conditional value', 'SUPPORT_STATE'),
  ('predictive_portfolio_recommendations', 'Predictive portfolio recommendations', 'Candidates eligible for value-based portfolio optimization', 'dodgers_signings', 'v_portfolio_candidate_readiness (043)', 'Requires a supported expected value, complete cost and complete signing-time features', 'SUPPORT_STATE'),
  ('open_research_tasks', 'Open research tasks', 'Open items in the DISI research queue', 'dodgers_signings', 'v_database_status / v_research_tasks', 'Research needs, not data errors', 'COVERAGE')
) as m(metric_key, label, definition, denominator_column, provenance, eligibility_rule, metric_kind);

comment on view public.v_executive_metric_provenance is
  'Executive metric provenance (Migration 045): every figure in v_executive_overview with its definition, the overview column holding its denominator, its provenance (source views / tables) and its eligibility rule. The verifier checks every named column exists.';

-- ===========================================================================
-- 4. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['v_disi_release_status', 'v_research_roadmap', 'v_executive_metric_provenance'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
  -- the roadmap function is reachable only as the view's body: no PUBLIC execute; the API roles that read the view may run it
  revoke all on function public.disi_research_roadmap() from public;
  grant execute on function public.disi_research_roadmap() to anon, authenticated;
end $$;

do $$
declare
  bad text;
  missing text;
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
    raise exception '045: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- every contract relation exists with the declared kind
  select string_agg(p.relation_name, ', ') into missing
  from public.disi_product_contract p
  left join pg_class c on c.relname = p.relation_name and c.relnamespace = 'public'::regnamespace
  where c.oid is null or (p.relation_kind = 'VIEW') <> (c.relkind = 'v');
  if missing is not null then
    raise exception '045 postcondition: contract relations missing or of the wrong kind: %', missing;
  end if;
  -- structural only: nothing here evaluates the release status or roadmap (each reads the analytical stack; the verifier checks them)
  select string_agg(v.relname, ', ') into missing
  from (values ('v_disi_release_status'), ('v_research_roadmap'), ('v_executive_metric_provenance')) as v(relname)
  left join pg_class c on c.relnamespace = 'public'::regnamespace and c.relname = v.relname and c.relkind = 'v'
  where c.oid is null or coalesce(array_to_string(c.reloptions, ','), '') !~ 'security_invoker=(true|on)' or not has_table_privilege('anon', c.oid, 'SELECT');
  if missing is not null then
    raise exception '045 postcondition: views missing, not security_invoker or not readable: %', missing;
  end if;
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_research_roadmap'
                   and p.provolatile = 's' and not p.prosecdef and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
                   and not has_function_privilege('public', p.oid, 'EXECUTE')
                   and has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')) then
    raise exception '045 postcondition: the roadmap function is missing or not read-only invoker-rights';
  end if;
end $$;

commit;
