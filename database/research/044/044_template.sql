-- DISI v0.35
-- 044_executive_product.sql
-- The executive product contract: a one-row executive overview (coverage, known spend, realized organizational value with its
-- components separate, and the support state of every predictive layer) and per-target prediction readiness (the evidence, the
-- minimums and what is still needed). Both are bounded so application pages read them cheaply; the overview is computed by a staged,
-- read-only function so that a page load never plans the whole 041 -> 042 -> 043 stack at once. Run after 043a.
--
-- Built from database/research/044/ (views.sql, build.mjs; design in ../042/final-decision-architecture.md).
--
-- Rerunnable: every statement is idempotent. Adds two views and the overview function; changes nothing that exists.

begin;

do $$
begin
  if to_regclass('public.v_portfolio_candidate_readiness') is null or to_regclass('public.v_player_realized_organizational_value') is null
     or to_regprocedure('public.disi_portfolio_candidate_readiness()') is null then
    raise exception '044: Migrations 042, 043 and 043a have not been applied';
  end if;
end $$;

{{views}}

do $$
declare t text;
begin
  foreach t in array array['v_executive_overview', 'v_prediction_readiness'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
  -- the overview function is reachable only as the view's body: no PUBLIC execute; the API roles that read the view may run it
  revoke all on function public.disi_executive_overview() from public;
  grant execute on function public.disi_executive_overview() to anon, authenticated;
end $$;

-- structural postconditions only: nothing here evaluates the executive stack (the first release attempt showed that evaluating it
-- inside the migration transaction could exhaust a 1 GB instance; the verifier checks the overview's figures after the release)
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
    raise exception '044: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- both views exist, security_invoker, readable by anon, with their full column lists
  select string_agg(v.relname, ', ') into bad
  from (values ('v_executive_overview', 36), ('v_prediction_readiness', 24)) as v(relname, cols)
  left join pg_class c on c.relnamespace = 'public'::regnamespace and c.relname = v.relname and c.relkind = 'v'
  where c.oid is null
     or (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) <> v.cols
     or coalesce(array_to_string(c.reloptions, ','), '') !~ 'security_invoker=(true|on)'
     or not has_table_privilege('anon', c.oid, 'SELECT');
  if bad is not null then
    raise exception '044 postcondition: view missing, reshaped or not readable: %', bad;
  end if;
  -- the overview is a wrapper over its staged function, which is read-only, invoker-rights, search_path-fixed and correctly granted
  if not exists (select 1 from pg_depend d join pg_rewrite rw on rw.oid = d.objid join pg_proc p on p.oid = d.refobjid
                 where rw.ev_class = 'public.v_executive_overview'::regclass and p.proname = 'disi_executive_overview'
                   and p.pronamespace = 'public'::regnamespace)
     or not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'disi_executive_overview'
                      and p.provolatile = 's' and not p.prosecdef and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
                      and not has_function_privilege('public', p.oid, 'EXECUTE')
                      and has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE')) then
    raise exception '044 postcondition: the executive overview function is missing, not a wrapper target, or not read-only invoker-rights';
  end if;
end $$;

commit;
