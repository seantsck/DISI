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
select $m042${{payload_json}}$m042$::jsonb as j;

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

{{views}}

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
