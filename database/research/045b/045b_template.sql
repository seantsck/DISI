-- DISI v0.36.1
-- 045b_database_status_snapshot.sql
-- Post-v1 home-page hardening: the home page no longer evaluates v_database_status on a request.
--
-- Why. v_database_status is one row of 25 scalar subqueries over a stack of views and tables (signing records, class coverage,
-- population coverage, research tasks) and repeats per-player work. A production audit after DISI v1.0.0 measured it as the slowest
-- remaining public read: under four concurrent full-page visitors it approached the 3 s statement timeout. Since 045a a page request must
-- never recompute an analytical graph; this is the last legacy read that did.
--
-- What. One typed snapshot table, product_database_status (generation id, generation metadata of the executive snapshot, and the 26
-- v_database_status columns), readable by anon / authenticated under RLS. The refresh and drift functions are re-issued with the eleventh
-- snapshot (written in the same transaction and generation as the other ten; validated against the executive snapshot). v_database_status
-- itself is unchanged and stays the source, but is closed to anon / authenticated. The product contract swaps the view for the snapshot.
-- No metric, research datum, threshold or prediction changes. The release status (schema v0.36.1, canonical through 045a) is not touched.
--
-- Built from database/research/045b/ (snapshots.mjs, build.mjs on top of ../045a/build.mjs).
--
-- Rerunnable: every statement is idempotent; the generation refresh runs only while the new snapshot is empty.

begin;

do $$
begin
  if to_regclass('public.product_executive_snapshot') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null
     or to_regclass('public.v_database_status') is null then
    raise exception '045b: Migration 045a (product snapshots) has not been applied';
  end if;
end $$;

-- ===========================================================================
-- 1. PRODUCT SNAPSHOT TABLE (derived read model; written only by the refresh)
-- ===========================================================================

{{tables}}

-- ===========================================================================
-- 2. REFRESH AND DRIFT (owner only): the 045a functions with the eleventh snapshot
-- ===========================================================================

{{refresh_function}}

{{drift_function}}

-- ===========================================================================
-- 3. PRODUCT CONTRACT: the home page reads the snapshot, not the view
-- ===========================================================================

{{contract}}

-- ===========================================================================
-- 4. API FIREWALL: v_database_status is internal
-- ===========================================================================

{{firewall}}

-- ===========================================================================
-- 5. GENERATION (only while the new snapshot is empty; later generations come from the explicit refresh command)
-- ===========================================================================

do $$
begin
  if not exists (select 1 from public.product_database_status) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

-- ===========================================================================
-- 6. STRUCTURAL POSTCONDITIONS (no analytical view is evaluated here)
-- ===========================================================================

do $$
declare
  bad text;
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
    raise exception '045b: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- the snapshot: RLS, readable by anon and authenticated, one row, the generation of the executive snapshot
  select string_agg(t.n, ', ') into bad
  from unnest(array['product_database_status']) t(n)
  left join pg_class c on c.relname = t.n and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  where c.oid is null or not c.relrowsecurity or not has_table_privilege('anon', c.oid, 'SELECT') or not has_table_privilege('authenticated', c.oid, 'SELECT');
  if bad is not null then
    raise exception '045b postcondition: snapshot missing, without RLS or not readable: %', bad;
  end if;
  if (select count(*) from public.product_database_status) <> 1
     or (select max(generation_id) from public.product_database_status) is distinct from (select max(generation_id) from public.product_executive_snapshot) then
    raise exception '045b postcondition: the status snapshot must be one row of the executive snapshot''s generation';
  end if;
  -- the source is closed to the API roles
  select string_agg(v.n, ', ') into bad
  from unnest(array[{{newly_internal_views}}]) v(n)
  where has_table_privilege('anon', 'public.' || v.n, 'SELECT') or has_table_privilege('authenticated', 'public.' || v.n, 'SELECT');
  if bad is not null then
    raise exception '045b postcondition: internal views still readable by an API role: %', bad;
  end if;
  -- the serving functions stay owner-only
  select string_agg(f.n, ', ') into bad
  from unnest(array[{{serving_functions}}]) f(n)
  where to_regprocedure('public.' || f.n || '()') is null
     or has_function_privilege('public', ('public.' || f.n || '()')::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', ('public.' || f.n || '()')::regprocedure, 'EXECUTE')
     or has_function_privilege('authenticated', ('public.' || f.n || '()')::regprocedure, 'EXECUTE');
  if bad is not null then
    raise exception '045b postcondition: functions missing or executable by an API role: %', bad;
  end if;
  -- the contract names only existing relations the API roles can read
  select string_agg(p.relation_name, ', ') into bad
  from public.disi_product_contract p
  left join pg_class c on c.relname = p.relation_name and c.relnamespace = 'public'::regnamespace
  where c.oid is null or (p.relation_kind = 'VIEW') <> (c.relkind = 'v') or not has_table_privilege('anon', c.oid, 'SELECT');
  if bad is not null then
    raise exception '045b postcondition: contract relations missing, of the wrong kind or not readable: %', bad;
  end if;
end $$;

commit;
