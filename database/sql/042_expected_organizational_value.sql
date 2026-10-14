-- DISI v0.33
-- 042_expected_organizational_value.sql
-- Expected organizational value: the realized organizational value decomposition (direct Dodgers bWAR, individually attributable
-- trade-return bWAR, package participation, observable-not-attributable value and value produced for other clubs, all kept separate;
-- acquisition-cost components kept separate with completeness), labelled historical distributions of realized value, and expected-
-- value infrastructure that is NULL - never zero, never a historical average - unless its 041 probability and its conditional value
-- are both supported. Run after 041.
--
-- Built from database/research/042/ (models.json, views.sql, build.mjs; design in final-decision-architecture.md).
--
-- On today's data no 041 target is supported, so every expected value is NULL with a reason. That is the intended result.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED VALUE MODELS (database/research/042/models.json)
-- ===========================================================================

create temporary table _m042 on commit drop as
select $m042${"value_models":[{"conditional_statistic":"MEAN_WINDOW_DODGERS_BWAR_GIVEN_POSITIVE_LABEL","description":"Expected direct Dodgers regular-season bWAR within 10 seasons of signing: the 041 probability of positive Dodgers MLB value (the player's reference population) times the mean 10-season Dodgers bWAR of positive-labelled, training-eligible members of the same population. Supported only when the 041 target is supported AND at least min_conditional_n positive observations with a known value exist.","min_conditional_n":10,"probability_target_key":"DODGERS_MLB_VALUE_WITHIN_10_SEASONS","value_component":"DIRECT_DODGERS_BWAR","value_model_key":"EXPECTED_DIRECT_DODGERS_BWAR_V1","value_model_version":"expected-org-value-v1"}]}$m042$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
begin
  if to_regclass('public.v_player_outcome_probability') is null or to_regclass('public.outcome_targets') is null
     or to_regclass('public.v_downstream_organizational_realization') is null then
    raise exception '042: Migrations 034 and 041 have not been applied';
  end if;
end $$;

-- ===========================================================================
-- 2. TABLE (written only by migrations)
-- ===========================================================================

create table if not exists public.expected_value_models (
  value_model_key text primary key check (value_model_key ~ '^[A-Z0-9_]+$'),
  value_model_version text not null check (btrim(value_model_version) <> ''),
  probability_target_key text not null references public.outcome_targets(target_key) on delete restrict,
  value_component text not null check (value_component in ('DIRECT_DODGERS_BWAR')),
  conditional_statistic text not null check (btrim(conditional_statistic) <> ''),
  min_conditional_n integer not null check (min_conditional_n >= 10),
  description text not null check (btrim(description) <> '' and char_length(description) <= 800),
  created_at timestamptz not null default now()
);

comment on table public.expected_value_models is
  'Reviewed expected-value models (Migration 042): each names the 041 probability target it depends on, the single value component it forecasts and the minimum number of positive, value-known observations needed to estimate the conditional value. A model produces numbers only when both supports hold.';

alter table public.expected_value_models enable row level security;
revoke all on table public.expected_value_models from anon, authenticated;
grant select on table public.expected_value_models to anon, authenticated;
drop policy if exists public_read_expected_value_models on public.expected_value_models;
create policy public_read_expected_value_models on public.expected_value_models for select to anon, authenticated using (true);

insert into public.expected_value_models (value_model_key, value_model_version, probability_target_key, value_component, conditional_statistic, min_conditional_n, description)
select x ->> 'value_model_key', x ->> 'value_model_version', x ->> 'probability_target_key', x ->> 'value_component', x ->> 'conditional_statistic',
       (x ->> 'min_conditional_n')::int, x ->> 'description'
from _m042, jsonb_array_elements(j -> 'value_models') x
on conflict (value_model_key) do nothing;

-- ===========================================================================
-- 3. VIEWS
-- ===========================================================================

-- Migration 042 views: realized and expected organizational value. Spliced into 042_template.sql by build.mjs.

-- ---------------------------------------------------------------------------
-- Realized organizational value: one row per Dodgers signing, every value component kept separate
-- ---------------------------------------------------------------------------
create or replace view public.v_player_realized_organizational_value
with (security_invoker = true)
as
with r as materialized (select * from public.v_player_organizational_realization),
d as materialized (select * from public.v_downstream_organizational_realization where row_grain = 'SIGNING'),
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
  s.career_bwar as realized_career_bwar,
  s.direct_dodgers_mlb_bwar as direct_dodgers_bwar,
  case when s.total_bwar is not null and s.direct_dodgers_mlb_bwar is not null then s.total_bwar - s.direct_dodgers_mlb_bwar end as individually_attributable_trade_bwar,
  s.total_bwar as realized_org_value_bwar,
  s.interval_bounded_first_hop_package_bwar as package_first_hop_participation_bwar,
  s.package_participation_downstream_bwar as package_downstream_participation_bwar,
  s.observable_not_attributable_bwar,
  s.non_dodgers_mlb_bwar as value_left_organization_bwar,
  s.chain_status, s.realized_value_state,
  s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.release_fee_usd, s.other_acquisition_fee_usd,
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
from s;

comment on view public.v_player_realized_organizational_value is
  'Realized organizational value (Migration 042): one row per Dodgers signing. realized_org_value_bwar = direct Dodgers regular-season bWAR + individually attributable (sole-outgoing-asset) trade-return bWAR through the 034 lineage, NULL when any attributable interval is unresolved. Package participation, observable-not-attributable value and value produced for other clubs are separate columns and never added. Cost components stay separate; known_acquisition_cost_usd is the sum of KNOWN components; the per-$1M ratio needs complete cost, a mature signing and a resolved value.';

-- ---------------------------------------------------------------------------
-- Historical distributions of realized value (descriptive; not an expectation for any player)
-- ---------------------------------------------------------------------------
create or replace view public.v_historical_org_value_distribution
with (security_invoker = true)
as
with v as materialized (
  select * from public.v_player_realized_organizational_value
  where maturity_status = 'MATURE' and population_class in ('TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS') and signing_route = 'AMATEUR_OR_UNCLASSIFIED_SIGNING'
),
g as (
  select 'ALL'::text as grain, 'ALL'::text as grain_value, v.* from v
  union all select 'POPULATION_CLASS', v.population_class, v.* from v
  union all select 'MARKET_GROUP', coalesce(v.market_group, 'UNKNOWN'), v.* from v
  union all select 'SIGNING_ERA', coalesce(v.era_key, 'UNKNOWN'), v.* from v
  union all select 'COST_BAND', coalesce(v.cost_band, 'UNKNOWN'), v.* from v
),
a as (
  select g.grain, g.grain_value,
    count(*)::int as mature_members,
    count(*) filter (where g.realized_value_state = 'REALIZED_TO_DATE')::int as value_known_n,
    count(*) filter (where g.realized_value_state = 'TO_DATE_CHAIN_INCOMPLETE')::int as chain_incomplete_n,
    count(*) filter (where g.realized_value_state = 'VALUE_UNRESOLVED')::int as value_unresolved_n,
    count(*) filter (where g.realized_value_state = 'OUTCOME_NOT_OBSERVED')::int as outcome_not_observed_n,
    percentile_cont(0.25) within group (order by g.realized_org_value_bwar) filter (where g.realized_value_state = 'REALIZED_TO_DATE') as p25,
    percentile_cont(0.5) within group (order by g.realized_org_value_bwar) filter (where g.realized_value_state = 'REALIZED_TO_DATE') as p50,
    percentile_cont(0.75) within group (order by g.realized_org_value_bwar) filter (where g.realized_value_state = 'REALIZED_TO_DATE') as p75,
    count(*) filter (where g.realized_value_state = 'REALIZED_TO_DATE' and g.realized_org_value_bwar > 0)::int as positive_value_n,
    sum(g.realized_org_value_bwar) filter (where g.realized_value_state = 'REALIZED_TO_DATE') as known_value_total_bwar
  from g group by g.grain, g.grain_value
)
select a.grain, a.grain_value,
  'Mature Dodgers tracked / opening-class amateur signings (outcome-selected historical set excluded)'::text as population_label,
  a.mature_members, a.value_known_n, a.chain_incomplete_n, a.value_unresolved_n, a.outcome_not_observed_n,
  case when a.value_known_n >= 10 then round(a.p25::numeric, 2) end as historical_p25_org_bwar,
  case when a.value_known_n >= 10 then round(a.p50::numeric, 2) end as historical_median_org_bwar,
  case when a.value_known_n >= 10 then round(a.p75::numeric, 2) end as historical_p75_org_bwar,
  case when a.value_known_n >= 10 then round(a.positive_value_n::numeric / a.value_known_n, 3) end as historical_positive_value_share,
  a.positive_value_n, round(a.known_value_total_bwar, 2) as known_value_total_bwar,
  case when a.mature_members > 0 then round(a.value_known_n::numeric / a.mature_members, 3) end as value_coverage,
  case when a.value_known_n >= 10 then 'DESCRIPTIVE' else 'SMALL_SAMPLE' end as distribution_state,
  'HISTORICAL_DESCRIPTIVE'::text as statistic_kind
from a;

comment on view public.v_historical_org_value_distribution is
  'Historical realized organizational value distributions (Migration 042): quartiles and positive-value share of realized_org_value_bwar among mature Dodgers tracked / opening-class amateur signings with a resolved value, by grain. HISTORICAL_DESCRIPTIVE: it describes what happened to a past population and is not the expected value of any player. Statistics need at least 10 resolved values (else NULL, SMALL_SAMPLE); unresolved, incomplete and unobserved values are counted, never treated as zero.';

-- ---------------------------------------------------------------------------
-- Expected-value support: probability support (041) AND conditional value support, per value model
-- ---------------------------------------------------------------------------
create or replace view public.v_expected_value_support
with (security_invoker = true)
as
-- one pass over the 041 training population for the model targets: the probability support is the v_outcome_target_support rule
-- (labelled / positive / negative minimums of outcome_targets), recomputed here so the population is read once (the verifier checks
-- the two agree)
with p as materialized (
  select p.target_key, p.training_state, p.label, p.window_dodgers_bwar, p.analysis_as_of_date
  from public.v_outcome_training_population p
  where p.reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS' and p.training_state <> 'OUT_OF_SCOPE'
    and p.target_key in (select probability_target_key from public.expected_value_models)
),
agg as (
  select p.target_key,
    count(*) filter (where p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY'))::int as labelled_n,
    count(*) filter (where p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY') and p.label)::int as positive_n,
    count(*) filter (where p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY') and p.label = false)::int as negative_n,
    count(*) filter (where p.training_state = 'TRAINING_ELIGIBLE' and p.label and p.window_dodgers_bwar is not null)::int as conditional_value_n,
    avg(p.window_dodgers_bwar) filter (where p.training_state = 'TRAINING_ELIGIBLE' and p.label and p.window_dodgers_bwar is not null) as conditional_mean,
    max(p.analysis_as_of_date) as evidence_as_of_date
  from p group by p.target_key
),
x as (
  select m.value_model_key, m.value_model_version, m.probability_target_key, m.value_component, m.min_conditional_n,
    'DODGERS_TRACKED_AND_OPENING_CLASS'::text as reference_population,
    coalesce(a.labelled_n >= t.min_reference_n and a.positive_n >= t.min_positives and a.negative_n >= t.min_negatives, false) as probability_supported,
    a.labelled_n, a.positive_n,
    greatest(t.min_positives - coalesce(a.positive_n, 0), 0) as additional_positives_needed,
    greatest(t.min_reference_n - coalesce(a.labelled_n, 0), 0) as additional_labels_needed,
    coalesce(a.conditional_value_n, 0) as conditional_value_n,
    (coalesce(a.conditional_value_n, 0) >= m.min_conditional_n) as conditional_value_supported,
    a.conditional_mean,
    coalesce(a.evidence_as_of_date, (select max(audited_through_date) from public.outcome_audits)) as evidence_as_of_date
  from public.expected_value_models m
  join public.outcome_targets t on t.target_key = m.probability_target_key
  left join agg a on a.target_key = m.probability_target_key
)
select x.value_model_key, x.value_model_version, x.probability_target_key, x.value_component, x.reference_population,
  x.probability_supported, x.labelled_n, x.positive_n, x.additional_positives_needed, x.additional_labels_needed,
  x.conditional_value_n, x.min_conditional_n, greatest(x.min_conditional_n - x.conditional_value_n, 0) as additional_conditional_observations_needed,
  x.conditional_value_supported,
  case when x.probability_supported and x.conditional_value_supported then round(x.conditional_mean, 3) end as conditional_mean_value_bwar,
  (x.probability_supported and x.conditional_value_supported) as expected_value_supported,
  case
    when x.probability_supported and x.conditional_value_supported then 'EXPECTED_VALUE_SUPPORTED'
    when not x.probability_supported then 'PROBABILITY_NOT_SUPPORTED'
    else 'CONDITIONAL_VALUE_NOT_SUPPORTED'
  end as support_state,
  concat_ws('; ',
    case when not x.probability_supported then format('041 target %s is not supported for %s (%s labelled, %s positives; needs %s more positives and %s more labels)',
      x.probability_target_key, x.reference_population, coalesce(x.labelled_n, 0), coalesce(x.positive_n, 0), coalesce(x.additional_positives_needed, 0), coalesce(x.additional_labels_needed, 0)) end,
    case when not x.conditional_value_supported then format('%s mature positive observations with a known value; %s required', x.conditional_value_n, x.min_conditional_n) end
  ) as blocking_reasons,
  x.evidence_as_of_date
from x;

comment on view public.v_expected_value_support is
  'Expected-value support (Migration 042): one row per reviewed value model. Expected value is supported only when its 041 probability target is supported for the Dodgers reference population AND enough mature, positive, value-known observations exist to estimate the conditional value; otherwise support_state names the blocker and the evidence needed.';

-- ---------------------------------------------------------------------------
-- Expected organizational value per Dodgers signing: NULL unless every input is supported
-- ---------------------------------------------------------------------------
create or replace view public.v_player_expected_organizational_value
with (security_invoker = true)
as
with pr as materialized (
  select o.* from public.v_player_outcome_probability o
  where o.target_key in (select probability_target_key from public.expected_value_models)
),
s as materialized (select * from public.v_expected_value_support),
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
from e;

comment on view public.v_player_expected_organizational_value is
  'Expected organizational value (Migration 042): one row per Dodgers signing and value model. expected_org_value_bwar = 041 probability x conditional mean Dodgers bWAR of the same reference population, ONLY when the probability is eligible and the conditional value is supported; otherwise NULL - never zero, never a historical average - with expected_value_exclusion_reason. Trade realization has no model (always NULL). Decision inputs are as of decision_as_of_date (the signing cutoff); evidence as of evidence_as_of_date.';

-- ---------------------------------------------------------------------------
-- Research queue: what blocks expected value and realized-value resolution
-- ---------------------------------------------------------------------------
create or replace view public.v_expected_value_research_queue
with (security_invoker = true)
as
with s as materialized (select * from public.v_expected_value_support),
r as materialized (select * from public.v_player_realized_organizational_value)
select 'EXPECTED_VALUE_NOT_SUPPORTED'::text as issue_type, 1 as priority, null::uuid as signing_id, null::text as player_slug, s.value_model_key as subject,
  s.blocking_reasons as detail,
  'Audit outcomes of mature Dodgers tracked / opening-class signings and add audited class censuses so the 041 target and the conditional value reach their minimums'::text as evidence_needed
from s where not s.expected_value_supported
union all
select 'REALIZED_VALUE_UNRESOLVED', 2, r.signing_id, r.player_slug, r.chain_status,
  format('%s: realized organizational value is unresolved (%s)', r.full_name, coalesce(r.chain_status, 'no chain row')),
  'Resolve the transaction lineage interval (identity, timing, return, exit) so attributable bWAR can be summed'
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
from r where r.maturity_status = 'MATURE' and not r.cost_complete and r.population_class <> 'OUTCOME_SELECTED_SAMPLE';

comment on view public.v_expected_value_research_queue is
  'Expected-value research queue (Migration 042): unsupported value models (with the evidence that would activate them), mature Dodgers signings whose realized value is unresolved or whose chain is incomplete, and mature non-outcome-selected signings whose acquisition cost is incomplete.';

-- ===========================================================================
-- 4. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['v_player_realized_organizational_value', 'v_historical_org_value_distribution', 'v_expected_value_support',
                           'v_player_expected_organizational_value', 'v_expected_value_research_queue'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  n int;
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
    raise exception '042: API roles hold privileges beyond SELECT: %', bad;
  end if;
  select count(*) into n from public.expected_value_models;
  if n < (select count(*) from _m042, jsonb_array_elements(j -> 'value_models')) then
    raise exception '042 postcondition: value models missing';
  end if;
  -- an expected value exists only when every input is supported
  select count(*) into n from public.v_player_expected_organizational_value
  where (expected_org_value_bwar is not null) <> expected_value_supported
     or (expected_value_supported and not probability_supported)
     or (expected_value_state <> 'EXPECTED_VALUE_SUPPORTED' and expected_value_exclusion_reason is null);
  if n <> 0 then
    raise exception '042 postcondition: % expected-value row(s) violate the support rule', n;
  end if;
  -- realized value is one row per Dodgers signing
  if (select count(*) from public.v_player_realized_organizational_value) <> (select count(*) from public.v_player_organizational_realization) then
    raise exception '042 postcondition: realized value does not cover every Dodgers signing exactly once';
  end if;
end $$;

commit;
