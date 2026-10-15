-- DISI v0.36.1
-- 045a_product_snapshot_serving.sql
-- Post-045 serving-layer correction: the public product reads persisted, bounded snapshots instead of the 042-045 analytical graph.
--
-- Why. The second production release attempt (2026-10-14) showed that single reads of the staged 042-045 views were acceptable
-- (about 0.5-0.7 s for the executive layer) but that four simultaneous anonymous executive-overview reads stalled the 1 GB instance
-- and hit the 3 s statement timeout; the bundle was rolled back. A page request must never recompute the analytical graph.
--
-- What. Ten typed snapshot tables (product_*), each a column-exact projection of the analytical view it replaces plus generation
-- metadata, readable by anon / authenticated under RLS; disi_refresh_product_snapshots() rebuilds them as one validated generation,
-- one staged statement per snapshot, in the caller's transaction (readers keep the previous committed generation until it commits);
-- disi_product_snapshot_drift() lets the verifier prove the snapshots equal their sources. The snapshots are a derived product cache:
-- canonical facts stay in the DISI tables, and the 042-045 analytical layer stays the only computation. The product contract now
-- names what the application reads; the 042-045 analytical views and the staged functions are closed to anon and authenticated
-- (owner / privileged refresh only). The release status reports schema v0.36.1 and canonical file 045a. Nothing earlier is written.
--
-- Built from database/research/045a/ (snapshots.mjs, build.mjs; design in ../045/serving-layer-architecture.md).
--
-- Rerunnable: every statement is idempotent; the initial refresh runs only when no generation exists yet.

begin;

do $$
begin
  if to_regclass('public.disi_product_contract') is null or to_regclass('public.v_disi_release_status') is null
     or to_regprocedure('public.disi_research_roadmap()') is null or to_regprocedure('public.disi_portfolio_candidate_readiness()') is null then
    raise exception '045a: Migrations 042-045 (with 043a) have not been applied';
  end if;
end $$;

-- ===========================================================================
-- 1. PRODUCT SNAPSHOT TABLES (derived read models; written only by the refresh)
-- ===========================================================================

{{tables}}

-- ===========================================================================
-- 2. REFRESH AND DRIFT (owner only)
-- ===========================================================================

{{refresh_function}}

{{drift_function}}

-- ===========================================================================
-- 3. RELEASE STATUS: schema v0.36.1, canonical through 045a (same columns and rules as 045)
-- ===========================================================================

{{release_status}}

-- ===========================================================================
-- 4. PRODUCT CONTRACT: exactly what the application reads
-- ===========================================================================

{{contract}}

-- ===========================================================================
-- 5. API FIREWALL: the analytical layer is internal
-- ===========================================================================

{{firewall}}

-- ===========================================================================
-- 6. FIRST GENERATION (only when none exists; later generations come from the explicit refresh command)
-- ===========================================================================

do $$
begin
  if not exists (select 1 from public.product_executive_snapshot) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

-- ===========================================================================
-- 7. STRUCTURAL POSTCONDITIONS (no analytical view is evaluated here)
-- ===========================================================================

do $$
declare
  bad text;
begin
  -- relations: SELECT only for the API roles
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '045a: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- every snapshot: RLS, readable by anon and authenticated, one generation
  select string_agg(t.n, ', ') into bad
  from unnest(array[{{snapshot_tables}}]) as t(n)
  left join pg_class c on c.relname = t.n and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  where c.oid is null or not c.relrowsecurity or not has_table_privilege('anon', c.oid, 'SELECT') or not has_table_privilege('authenticated', c.oid, 'SELECT');
  if bad is not null then
    raise exception '045a postcondition: snapshot missing, without RLS or not readable: %', bad;
  end if;
  if (select count(*) from public.product_executive_snapshot) <> 1 then
    raise exception '045a postcondition: the executive snapshot must hold exactly one generation row';
  end if;
  -- the analytical layer is closed: no API role reads an internal view or runs a staged / serving function
  select string_agg(v.n, ', ') into bad
  from unnest(array[{{internal_views}}]) as v(n)
  where has_table_privilege('anon', 'public.' || v.n, 'SELECT') or has_table_privilege('authenticated', 'public.' || v.n, 'SELECT');
  if bad is not null then
    raise exception '045a postcondition: internal views still readable by an API role: %', bad;
  end if;
  select string_agg(f.n, ', ') into bad
  from unnest(array[{{closed_functions}}]) as f(n)
  where to_regprocedure('public.' || f.n || '()') is null
     or has_function_privilege('public', ('public.' || f.n || '()')::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', ('public.' || f.n || '()')::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', ('public.' || f.n || '()')::regprocedure, 'EXECUTE');
  if bad is not null then
    raise exception '045a postcondition: functions missing or executable by an API role: %', bad;
  end if;
  -- the contract names only existing relations the API roles can read
  select string_agg(p.relation_name, ', ') into bad
  from public.disi_product_contract p
  left join pg_class c on c.relname = p.relation_name and c.relnamespace = 'public'::regnamespace
  where c.oid is null or (p.relation_kind = 'VIEW') <> (c.relkind = 'v') or not has_table_privilege('anon', c.oid, 'SELECT');
  if bad is not null then
    raise exception '045a postcondition: contract relations missing, of the wrong kind or not readable: %', bad;
  end if;
end $$;

commit;
