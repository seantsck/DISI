-- DISI v0.34
-- 043_portfolio_decision_engine.sql
-- Portfolio decision support: candidate readiness at the decision date (signing-time features, outcome-free comparable counts and
-- POPULATION-level expected-value support - never the candidate's own outcome), retrospective portfolio analysis (capital allocation,
-- concentration, cost coverage, realized value), reviewed budget scenarios with honest feasibility states, and a value-maximizing
-- selection that exists only for optimization-eligible candidates. Run after 042.
--
-- Built from database/research/043/ (scenarios.json, views.sql, build.mjs; design in ../042/final-decision-architecture.md).
--
-- On today's data expected value is unsupported (042), so no candidate is optimization-eligible: every scenario reports
-- VALUE_OPTIMIZATION_NOT_SUPPORTED and no ranking or selection is produced. That is the intended result.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED SCENARIOS (database/research/043/scenarios.json)
-- ===========================================================================

create temporary table _m043 on commit drop as
select $m043${"scenarios":[{"budget_multiplier":1,"description":"The club's reported international bonus pool for the signing period (after trades when reported).","reserve_share":0,"scenario_key":"BASE_POOL","scenario_label":"Reported pool"},{"budget_multiplier":1,"description":"30% of the reported pool held back for in-period opportunities; 70% available to the candidate set.","reserve_share":0.3,"scenario_key":"RESERVE_30","scenario_label":"Reported pool, 30% reserved"},{"budget_multiplier":1.25,"description":"Reported pool increased by 25%, as if additional pool space had been acquired by trade.","reserve_share":0,"scenario_key":"POOL_PLUS_25","scenario_label":"Pool +25% (acquired pool space)"},{"budget_multiplier":0.75,"description":"Reported pool reduced by 25%, as if pool space had been traded away or forfeited.","reserve_share":0,"scenario_key":"POOL_MINUS_25","scenario_label":"Pool -25% (traded away or penalty)"}]}$m043$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
begin
  if to_regclass('public.v_player_expected_organizational_value') is null or to_regclass('public.v_expected_value_support') is null then
    raise exception '043: Migration 042 has not been applied';
  end if;
end $$;

-- ===========================================================================
-- 2. TABLE (written only by migrations)
-- ===========================================================================

create table if not exists public.portfolio_scenario_definitions (
  scenario_key text primary key check (scenario_key ~ '^[A-Z0-9_]+$'),
  scenario_label text not null check (btrim(scenario_label) <> ''),
  budget_multiplier numeric not null check (budget_multiplier > 0 and budget_multiplier <= 3),
  reserve_share numeric not null check (reserve_share >= 0 and reserve_share < 1),
  description text not null check (btrim(description) <> '' and char_length(description) <= 600),
  created_at timestamptz not null default now()
);

comment on table public.portfolio_scenario_definitions is
  'Reviewed portfolio budget scenarios (Migration 043): a multiplier on the reported international pool and a reserve share. Applied to every Dodgers signing year with a reported pool by v_portfolio_scenario_evaluation. The legacy, unused portfolio_scenarios table (001) is not touched.';

alter table public.portfolio_scenario_definitions enable row level security;
revoke all on table public.portfolio_scenario_definitions from anon, authenticated;
grant select on table public.portfolio_scenario_definitions to anon, authenticated;
drop policy if exists public_read_portfolio_scenario_definitions on public.portfolio_scenario_definitions;
create policy public_read_portfolio_scenario_definitions on public.portfolio_scenario_definitions for select to anon, authenticated using (true);

insert into public.portfolio_scenario_definitions (scenario_key, scenario_label, budget_multiplier, reserve_share, description)
select x ->> 'scenario_key', x ->> 'scenario_label', (x ->> 'budget_multiplier')::numeric, (x ->> 'reserve_share')::numeric, x ->> 'description'
from _m043, jsonb_array_elements(j -> 'scenarios') x
on conflict (scenario_key) do nothing;

-- ===========================================================================
-- 3. VIEWS
-- ===========================================================================

-- Migration 043 views: portfolio decision support. Spliced into 043_template.sql by build.mjs.

-- ---------------------------------------------------------------------------
-- Candidate readiness: what DISI can responsibly say about each Dodgers signing at its decision date
-- ---------------------------------------------------------------------------
create or replace view public.v_portfolio_candidate_readiness
with (security_invoker = true)
as
with f as materialized (select * from public.v_signing_time_features where is_dodgers),
s as materialized (select bool_or(expected_value_supported) as any_supported, string_agg(blocking_reasons, '; ' order by value_model_key) as blockers
                   from public.v_expected_value_support),
-- per-player expected values are read only when some value model is supported (a one-time filter: never computed otherwise)
ev as materialized (
  select e.signing_id, e.expected_org_value_bwar, e.expected_value_state
  from public.v_player_expected_organizational_value e
  where (select any_supported from s)
),
cmp as materialized (
  select target_signing_id, sum(comparables)::int as historical_comparables
  from public.v_player_comparable_summary group by target_signing_id
),
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
from d;

comment on view public.v_portfolio_candidate_readiness is
  'Portfolio candidate readiness (Migration 043): one row per Dodgers signing at its decision date (the signing cutoff). Inputs are signing-time features (039), comparable counts (040, outcome-free) and POPULATION-level expected-value support (042) - never the candidate''s own outcome. Only PREDICTIVE_DECISION_SUPPORTED candidates (supported expected value, complete cost, complete features, in scope) are optimization_eligible; every other state names its blockers. No ranking.';

-- ---------------------------------------------------------------------------
-- Historical portfolio analysis (RETROSPECTIVE): capital allocation, concentration, coverage and realized value
-- ---------------------------------------------------------------------------
create or replace view public.v_historical_portfolio_summary
with (security_invoker = true)
as
with v as materialized (
  select * from public.v_player_realized_organizational_value where signing_route = 'AMATEUR_OR_UNCLASSIFIED_SIGNING'
),
p as (select * from v where population_class in ('TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS')),
g as (
  select 'ALL'::text as grain, 'ALL'::text as grain_value, p.* from p
  union all select 'SIGNING_YEAR', p.signing_year::text, p.* from p
  union all select 'MARKET_GROUP', coalesce(p.market_group, 'UNKNOWN'), p.* from p
  union all select 'COST_BAND', coalesce(p.cost_band, 'UNKNOWN'), p.* from p
  union all select 'SIGNING_ERA', coalesce(p.era_key, 'UNKNOWN'), p.* from p
),
total as (select sum(known_acquisition_cost_usd) as known_spend from p),
a as (
  select g.grain, g.grain_value,
    count(*)::int as signings,
    count(g.known_acquisition_cost_usd)::int as known_cost_signings,
    count(*) filter (where g.cost_complete)::int as complete_cost_signings,
    sum(g.known_acquisition_cost_usd) as known_spend_usd,
    max(g.known_acquisition_cost_usd) as largest_known_cost_usd,
    sum((g.known_acquisition_cost_usd)^2) as sum_sq_cost,
    count(distinct g.market_group)::int as markets_represented,
    count(*) filter (where g.maturity_status = 'MATURE')::int as mature_signings,
    count(*) filter (where g.maturity_status = 'MATURE' and g.realized_value_state = 'REALIZED_TO_DATE')::int as mature_value_resolved,
    sum(g.realized_org_value_bwar) filter (where g.maturity_status = 'MATURE' and g.realized_value_state = 'REALIZED_TO_DATE') as mature_realized_org_bwar,
    count(*) filter (where g.maturity_status = 'MATURE' and g.realized_value_state = 'REALIZED_TO_DATE' and g.realized_org_value_bwar > 0)::int as mature_positive_value_signings
  from g group by g.grain, g.grain_value
),
excluded as (
  select count(*) filter (where population_class = 'OUTCOME_SELECTED_SAMPLE')::int as notable from v
)
select a.grain, a.grain_value, 'RETROSPECTIVE'::text as analysis_kind,
  'Dodgers tracked / opening-class amateur signings (outcome-selected historical set excluded)'::text as population_label,
  a.signings, a.known_cost_signings, a.complete_cost_signings,
  round(a.known_spend_usd, 2) as known_spend_usd,
  round(a.known_cost_signings::numeric / nullif(a.signings, 0), 3) as cost_coverage,
  case when a.grain <> 'ALL' and t.known_spend > 0 then round(a.known_spend_usd / t.known_spend, 3) end as share_of_known_spend,
  case when a.known_cost_signings >= 2 and a.known_spend_usd > 0 then round(a.largest_known_cost_usd / a.known_spend_usd, 3) end as largest_signing_share_of_known_spend,
  case when a.known_cost_signings >= 2 and a.known_spend_usd > 0 then round(a.sum_sq_cost / a.known_spend_usd ^ 2, 3) end as known_spend_concentration_hhi,
  a.markets_represented, a.mature_signings, a.mature_value_resolved,
  round(a.mature_realized_org_bwar, 2) as mature_realized_org_bwar, a.mature_positive_value_signings,
  case when a.complete_cost_signings < a.signings then 'KNOWN_SPEND_IS_A_LOWER_BOUND' else 'SPEND_COMPLETE' end as spend_state,
  e.notable as outcome_selected_signings_excluded,
  'Retrospective description of what was spent and realized. It does not imply that a better allocation was knowable at signing.'::text as interpretation_note
from a cross join total t cross join excluded e;

comment on view public.v_historical_portfolio_summary is
  'Historical portfolio analysis (Migration 043), RETROSPECTIVE: capital allocation (known spend, share of known spend, largest-signing share and HHI concentration of KNOWN costs), cost coverage, market diversification and mature realized organizational value by signing year, market group, cost band and era, for Dodgers tracked / opening-class amateur signings. Known spend is a lower bound whenever any cost is incomplete; nothing here claims a hindsight-optimal portfolio was knowable.';

-- ---------------------------------------------------------------------------
-- Scenario evaluation: budget feasibility for each reviewed scenario and Dodgers signing year; value optimization only when supported
-- ---------------------------------------------------------------------------
create or replace view public.v_portfolio_scenario_evaluation
with (security_invoker = true)
as
with r as materialized (
  select * from public.v_portfolio_candidate_readiness where signing_route = 'AMATEUR_OR_UNCLASSIFIED_SIGNING'
),
pool as materialized (
  select e.signing_year, coalesce(e.pool_after_trades_usd, e.club_bonus_pool_usd) as reported_pool_usd,
    case when e.pool_after_trades_usd is not null then 'POOL_AFTER_TRADES' when e.club_bonus_pool_usd is not null then 'BASE_POOL' end as pool_basis,
    e.regime::text as signing_regime
  from public.signing_environments e join public.organizations o on o.id = e.organization_id
  where o.franchise_key = 'DODGERS'
),
sc as (
  select d.scenario_key, d.scenario_label, d.budget_multiplier, d.reserve_share, p.signing_year, p.reported_pool_usd, p.pool_basis, p.signing_regime,
    round(p.reported_pool_usd * d.budget_multiplier * (1 - d.reserve_share), 2) as scenario_budget_usd
  from public.portfolio_scenario_definitions d cross join pool p
),
c as (
  select sc.scenario_key, sc.signing_year,
    count(r.signing_id)::int as candidates,
    count(r.signing_id) filter (where r.cost_complete)::int as complete_cost_candidates,
    count(r.signing_id) filter (where not r.cost_complete)::int as incomplete_cost_candidates,
    sum(r.known_acquisition_cost_usd) as known_cost_usd,
    count(r.signing_id) filter (where r.optimization_eligible)::int as optimization_eligible_candidates
  from sc left join r on r.signing_year = sc.signing_year
  group by sc.scenario_key, sc.signing_year
),
-- exact value-maximizing selection among optimization-eligible candidates (subset enumeration, at most 12 candidates); it runs only when
-- at least one candidate is eligible and never includes a candidate whose expected value is unknown
elig as materialized (
  select r.signing_year, r.player_slug, r.known_acquisition_cost_usd as cost, r.expected_org_value_bwar as ev,
    row_number() over (partition by r.signing_year order by r.player_slug) as k
  from r where r.optimization_eligible and r.expected_org_value_bwar is not null and r.known_acquisition_cost_usd is not null
    and (select count(*) from r where optimization_eligible) > 0
),
subsets as (
  with recursive s(scenario_key, signing_year, last_k, picks, cost, ev) as (
    select sc.scenario_key, sc.signing_year, 0::bigint, array[]::text[], 0::numeric, 0::numeric
    from sc where exists (select 1 from elig e where e.signing_year = sc.signing_year)
      and (select count(*) from elig e where e.signing_year = sc.signing_year) <= 12
    union all
    select s.scenario_key, s.signing_year, e.k, s.picks || e.player_slug, s.cost + e.cost, s.ev + e.ev
    from s join elig e on e.signing_year = s.signing_year and e.k > s.last_k
    join sc on sc.scenario_key = s.scenario_key and sc.signing_year = s.signing_year
    where s.cost + e.cost <= sc.scenario_budget_usd
  )
  select * from s
),
best as (
  select distinct on (scenario_key, signing_year) scenario_key, signing_year, picks, cost, ev
  from subsets where cardinality(picks) > 0 order by scenario_key, signing_year, ev desc, cost asc, picks
)
select sc.scenario_key, sc.scenario_label, sc.signing_year, sc.signing_regime, sc.pool_basis, sc.reported_pool_usd, sc.budget_multiplier, sc.reserve_share, sc.scenario_budget_usd,
  c.candidates, c.complete_cost_candidates, c.incomplete_cost_candidates, round(c.known_cost_usd, 2) as known_cost_usd,
  case when c.incomplete_cost_candidates = 0 and c.candidates > 0 then round(sc.scenario_budget_usd - c.known_cost_usd, 2) end as budget_headroom_usd,
  case
    when sc.reported_pool_usd is null then 'NO_POOL_REPORTED'
    when c.candidates = 0 then 'NO_CANDIDATES'
    when coalesce(c.known_cost_usd, 0) > sc.scenario_budget_usd then 'EXCEEDS_BUDGET_ON_KNOWN_COSTS'
    when c.incomplete_cost_candidates > 0 then 'INDETERMINATE_UNKNOWN_COSTS'
    else 'WITHIN_BUDGET_ON_COMPLETE_COSTS'
  end as budget_state,
  c.optimization_eligible_candidates,
  case
    when c.optimization_eligible_candidates = 0 then 'VALUE_OPTIMIZATION_NOT_SUPPORTED'
    when c.optimization_eligible_candidates > 12 then 'VALUE_OPTIMIZATION_TOO_LARGE_FOR_EXACT_SEARCH'
    else 'VALUE_OPTIMIZATION_SUPPORTED'
  end as value_optimization_state,
  case when c.optimization_eligible_candidates between 1 and 12 then b.picks end as optimized_selection,
  case when c.optimization_eligible_candidates between 1 and 12 then round(b.ev, 3) end as optimized_expected_org_bwar,
  case when c.optimization_eligible_candidates between 1 and 12 then round(b.cost, 2) end as optimized_known_cost_usd,
  c.candidates - c.optimization_eligible_candidates as candidates_excluded_from_optimization,
  'RETROSPECTIVE_FEASIBILITY'::text as analysis_kind,
  'Known acquisition costs of amateur signings compared with the reported international pool; an approximation of pool usage, not a reconciled pool ledger. Unsupported candidates never enter the value optimization and are never treated as zero.'::text as interpretation_note
from sc
join c on c.scenario_key = sc.scenario_key and c.signing_year = sc.signing_year
left join best b on b.scenario_key = sc.scenario_key and b.signing_year = sc.signing_year;

comment on view public.v_portfolio_scenario_evaluation is
  'Portfolio scenarios (Migration 043): each reviewed scenario (pool multiplier, reserve share) applied to every Dodgers signing year with a reported international pool. budget_state compares KNOWN acquisition costs with the scenario budget and is INDETERMINATE when unknown costs could change the answer. A value-maximizing selection (exact subset search, at most 12 candidates) exists only when candidates are optimization_eligible; today none is, so value_optimization_state is VALUE_OPTIMIZATION_NOT_SUPPORTED and no selection or ranking is produced.';

-- ---------------------------------------------------------------------------
-- Decision support summary: what DISI may and may not say, per decision-support state
-- ---------------------------------------------------------------------------
create or replace view public.v_portfolio_decision_support
with (security_invoker = true)
as
with r as materialized (select decision_support_state, optimization_eligible from public.v_portfolio_candidate_readiness),
states(decision_support_state, state_order, may_say, may_not_say) as (values
  ('PREDICTIVE_DECISION_SUPPORTED', 1, 'Expected organizational value with its interval, value per complete cost, and membership of a value-maximizing feasible portfolio.', 'Certainty about any individual outcome; anything beyond the supported reference population.'),
  ('HISTORICAL_CONTEXT_ONLY', 2, 'Signing-time profile, earlier comparable signings and their realized outcomes, labelled historical.', 'A predicted outcome, expected value, ranking or recommendation.'),
  ('INSUFFICIENT_OUTCOME_SUPPORT', 3, 'Signing-time profile and the evidence needed to support an expected value.', 'A predicted outcome, expected value, ranking or recommendation.'),
  ('INSUFFICIENT_COST_DATA', 4, 'Expected value (if supported) without any value-per-cost or budget conclusion.', 'Value per cost, net value or budget optimization.'),
  ('INSUFFICIENT_PLAYER_DATA', 5, 'Which signing-time facts are missing.', 'Any population-based statement about the candidate.'),
  ('OUT_OF_SCOPE', 6, 'Facts and realized history only.', 'Any predictive or decision statement.')
),
tot as (select count(*) filter (where optimization_eligible)::int as eligible from r)
select s.decision_support_state, s.state_order,
  count(r.decision_support_state)::int as candidates,
  count(*) filter (where r.optimization_eligible)::int as optimization_eligible_candidates,
  s.may_say, s.may_not_say,
  tot.eligible as predictive_recommendations_total
from states s cross join tot left join r on r.decision_support_state = s.decision_support_state
group by s.decision_support_state, s.state_order, s.may_say, s.may_not_say, tot.eligible;

comment on view public.v_portfolio_decision_support is
  'Portfolio decision support (Migration 043): one row per decision-support state with the number of Dodgers candidates in it, what DISI may say and what it may not say. predictive_recommendations_total counts optimization-eligible candidates across all states (0 while expected value is unsupported).';

-- ---------------------------------------------------------------------------
-- Research queue: what blocks portfolio decision support
-- ---------------------------------------------------------------------------
create or replace view public.v_portfolio_research_queue
with (security_invoker = true)
as
with rr as materialized (select * from public.v_portfolio_candidate_readiness),
r as (select * from rr where decision_support_state <> 'OUT_OF_SCOPE'),
-- the BASE_POOL feasibility of each signing year, from the same single readiness pass (same rule as v_portfolio_scenario_evaluation)
sc as (
  select e.signing_year, round(coalesce(e.pool_after_trades_usd, e.club_bonus_pool_usd) * d.budget_multiplier * (1 - d.reserve_share), 2) as budget,
    count(rr.signing_id)::int as candidates, count(rr.signing_id) filter (where not rr.cost_complete)::int as incomplete_cost_candidates,
    coalesce(sum(rr.known_acquisition_cost_usd), 0) as known_cost
  from public.signing_environments e
  join public.organizations o on o.id = e.organization_id and o.franchise_key = 'DODGERS'
  join public.portfolio_scenario_definitions d on d.scenario_key = 'BASE_POOL'
  left join rr on rr.signing_year = e.signing_year and rr.signing_route = 'AMATEUR_OR_UNCLASSIFIED_SIGNING'
  group by e.signing_year, e.pool_after_trades_usd, e.club_bonus_pool_usd, d.budget_multiplier, d.reserve_share
)
select 'EXPECTED_VALUE_NOT_SUPPORTED'::text as issue_type, 1 as priority, null::uuid as signing_id, null::text as player_slug, null::int as signing_year,
  format('%s in-scope candidates cannot enter value optimization: %s', count(*), max(r.outcome_support_evidence)) as detail,
  'Raise the 041 / 042 support: audit mature tracked and opening-class outcomes and add audited class censuses'::text as evidence_needed
from r where not r.expected_value_model_supported having count(*) > 0
union all
select 'CANDIDATE_COST_INCOMPLETE', 2, r.signing_id, r.player_slug, r.signing_year,
  format('%s (%s): acquisition cost %s', r.full_name, r.signing_year, r.cost_coverage_state),
  'Find the publicly reported signing bonus (and any required fee)'
from r where not r.cost_complete
union all
select 'CANDIDATE_FEATURES_MISSING', 3, r.signing_id, r.player_slug, r.signing_year,
  format('%s (%s): signing-time features known %s of %s', r.full_name, r.signing_year, r.core_features_known, r.core_features_total),
  'Research age, position and market at signing'
from r where not r.player_data_complete
union all
select 'SCENARIO_BUDGET_INDETERMINATE', 4, null, null, sc.signing_year,
  format('%s: %s of %s candidates have incomplete cost, so pool feasibility is indeterminate', sc.signing_year, sc.incomplete_cost_candidates, sc.candidates),
  'Complete the acquisition costs of that signing year'
from sc where sc.budget is not null and sc.candidates > 0 and sc.known_cost <= sc.budget and sc.incomplete_cost_candidates > 0;

comment on view public.v_portfolio_research_queue is
  'Portfolio research queue (Migration 043): the expected-value blocker, in-scope candidates with incomplete cost or missing signing-time features, and signing years whose pool feasibility is indeterminate because of unknown costs.';

-- ===========================================================================
-- 4. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['v_portfolio_candidate_readiness', 'v_historical_portfolio_summary', 'v_portfolio_scenario_evaluation',
                           'v_portfolio_decision_support', 'v_portfolio_research_queue'] loop
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
    raise exception '043: API roles hold privileges beyond SELECT: %', bad;
  end if;
  if (select count(*) from public.portfolio_scenario_definitions) < (select count(*) from _m043, jsonb_array_elements(j -> 'scenarios')) then
    raise exception '043 postcondition: scenarios missing';
  end if;
  -- a candidate is optimization-eligible only with a supported expected value; no selection without an eligible candidate
  select count(*) into n from public.v_portfolio_candidate_readiness
  where optimization_eligible <> (decision_support_state = 'PREDICTIVE_DECISION_SUPPORTED')
     or (optimization_eligible and (expected_org_value_bwar is null or not cost_complete or not expected_value_model_supported));
  if n <> 0 then
    raise exception '043 postcondition: % candidate row(s) violate the eligibility rule', n;
  end if;
  select count(*) into n from public.v_portfolio_scenario_evaluation
  where (optimized_selection is not null) and optimization_eligible_candidates = 0;
  if n <> 0 then
    raise exception '043 postcondition: % scenario(s) select candidates without eligible expected values', n;
  end if;
end $$;

commit;
