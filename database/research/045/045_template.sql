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
select $m045${{payload_json}}$m045$::jsonb as j;

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

{{views}}

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
