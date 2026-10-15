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
select $m043${{payload_json}}$m043$::jsonb as j;

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

{{views}}

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
