-- DISI v0.30
-- 039_market_pathway_intelligence.sql
-- Market / country / pathway intelligence: a leakage-safe signing-time feature record shared by 039-041, two small reviewed reference
-- tables (market groups, league eras for international amateur signings) and descriptive market / pathway / era context against
-- realized outcomes. Run after 038a.
--
-- Built from database/research/039/ (reference.json, views.sql, audit.mjs, build.mjs; design in architecture-report.md).
--
-- What this is. Derived, read-only intelligence: no signing, outcome, cost or value fact is added or changed. Populations are never
-- pooled (an outcome-selected historical set is never compared with a sample or a census), no market, route or era is ranked, no
-- value-per-cost ratio is computed, and nothing is causal.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED REFERENCE DATA (database/research/039/reference.json)
-- ===========================================================================

create temporary table _m039 on commit drop as
select $m039${{payload_json}}$m039$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
begin
  if to_regclass('public.v_network_player_outcomes') is null or to_regclass('public.v_player_development_pathway') is null
     or to_regclass('public.v_player_realized_outcome') is null then
    raise exception '039: Migrations 036-038a have not been applied';
  end if;
  if exists (select 1 from public.signings group by player_id having count(*) > 1) then
    raise exception '039: a player has more than one signing; the signing-time feature record needs an explicit signing choice first';
  end if;
end $$;

-- ===========================================================================
-- 2. REFERENCE TABLES (written only by migrations)
-- ===========================================================================

create table if not exists public.market_groups (
  country_market text primary key check (btrim(country_market) <> ''),
  market_group text not null check (market_group ~ '^[A-Z_]+$'),
  region text not null check (region ~ '^[A-Z_]+$'),
  created_at timestamptz not null default now()
);

comment on table public.market_groups is
  'Reviewed market groups (Migration 039): each observed signings.country_market mapped to a group justified by the data (the four largest markets on their own, then regional groups). A NULL market is UNKNOWN in the views, never guessed.';

create table if not exists public.international_signing_eras (
  era_key text primary key check (era_key ~ '^[A-Z_]+$'),
  era_order integer not null unique check (era_order >= 1),
  label text not null check (btrim(label) <> ''),
  starts_on date,
  ends_on date,
  rule_summary text not null check (btrim(rule_summary) <> '' and char_length(rule_summary) <= 500),
  source_reference text not null check (btrim(source_reference) <> ''),
  created_at timestamptz not null default now(),
  constraint international_signing_eras_range_check check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

comment on table public.international_signing_eras is
  'League rule eras for international amateur signings (Migration 039): before bonus pools, soft-capped pools from the 2012-13 signing period, hard-capped pools from the 2017-18 period. Professional routes (posting, foreign professional transfers) are not placed on this scale.';

do $$
declare t text;
begin
  foreach t in array array['market_groups', 'international_signing_eras'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

insert into public.market_groups (country_market, market_group, region)
select x ->> 'country_market', x ->> 'market_group', x ->> 'region'
from _m039, jsonb_array_elements(j -> 'market_groups') x
on conflict (country_market) do nothing;

insert into public.international_signing_eras (era_key, era_order, label, starts_on, ends_on, rule_summary, source_reference)
select x ->> 'era_key', (x ->> 'era_order')::int, x ->> 'label', (x ->> 'starts_on')::date, (x ->> 'ends_on')::date, x ->> 'rule_summary', x ->> 'source_reference'
from _m039, jsonb_array_elements(j -> 'eras') x
on conflict (era_key) do nothing;

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
  foreach t in array array['v_signing_time_features', 'v_market_pathway_player_context', 'v_market_pathway_summary', 'v_market_research_queue'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  n int;
  expected int;
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
    raise exception '039: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- the reviewed reference rows are present exactly as researched
  select count(*) into expected from _m039, jsonb_array_elements(j -> 'market_groups');
  select count(*) into n from public.market_groups g join _m039 on true
  where exists (select 1 from jsonb_array_elements(j -> 'market_groups') x where x ->> 'country_market' = g.country_market
    and x ->> 'market_group' = g.market_group and x ->> 'region' = g.region);
  if n <> expected then
    raise exception '039 postcondition: % of % market groups match the reviewed definitions', n, expected;
  end if;
  select count(*) into expected from _m039, jsonb_array_elements(j -> 'eras');
  select count(*) into n from public.international_signing_eras e join _m039 on true
  where exists (select 1 from jsonb_array_elements(j -> 'eras') x where x ->> 'era_key' = e.era_key
    and (x ->> 'starts_on')::date is not distinct from e.starts_on and (x ->> 'ends_on')::date is not distinct from e.ends_on);
  if n <> expected then
    raise exception '039 postcondition: % of % eras match the reviewed definitions', n, expected;
  end if;
  -- eras never overlap
  select count(*) into n from public.international_signing_eras a join public.international_signing_eras b on a.era_key < b.era_key
   and coalesce(a.starts_on, '-infinity'::date) <= coalesce(b.ends_on, 'infinity'::date) and coalesce(b.starts_on, '-infinity'::date) <= coalesce(a.ends_on, 'infinity'::date);
  if n <> 0 then
    raise exception '039 postcondition: % overlapping era pair(s)', n;
  end if;
  -- one feature row per signing; every recorded market is mapped
  select count(*) into n from public.v_signing_time_features;
  select count(*) into expected from public.signings;
  if n <> expected then
    raise exception '039 postcondition: % feature rows for % signings', n, expected;
  end if;
  select count(*) into n from public.v_signing_time_features where market_group = 'UNMAPPED';
  if n <> 0 then
    raise exception '039 postcondition: % signing(s) with an unmapped market', n;
  end if;
end $$;

commit;
