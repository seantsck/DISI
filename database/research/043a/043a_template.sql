-- DISI v0.34.1
-- 043a_decision_engine_performance.sql
-- Post-043 performance correction, applied after 043 and before 044. Query shape only: v_player_realized_organizational_value,
-- v_player_expected_organizational_value, v_expected_value_research_queue and v_portfolio_candidate_readiness keep their columns, types, rows, NULLs, support states, grants,
-- comments and security_invoker behaviour; no table, fact or policy changes.
--
-- Why. The first production release attempt (2026-10-14) exposed a low-memory failure before any application deployment: each of these
-- views inlined the whole 041 -> 042 -> 043 stack into ONE statement, and PostgreSQL plans every inlined layer - including the per-player
-- probability and expected-value layers that a one-time filter skips at execution while support is absent. Planning alone used about
-- 70 MB (realized value), 110 MB (expected value), 125 MB (research queue) and 230 MB (candidate readiness; 255 MB for each 043 view that reads it); the 044
-- executive overview stacked all of them (about 700 MB) and its migration postcondition ran out of memory on the 1 GB instance. The
-- partial release was rolled back cleanly. Here each view becomes a thin wrapper over a staged, read-only, invoker-rights function:
-- every stage is a separate statement, planned only when it runs and released when it ends, and gated stages (per-player expected
-- values) are not planned at all while their upstream support is absent.
--
-- Built from database/research/043a/ (views.sql, build.mjs). 042 and 043 are applied as committed; they are not edited.
--
-- Rerunnable: every statement is idempotent.

begin;

do $$
begin
  if to_regclass('public.v_portfolio_candidate_readiness') is null or to_regclass('public.v_player_expected_organizational_value') is null
     or to_regclass('public.v_expected_value_research_queue') is null or to_regclass('public.portfolio_scenario_definitions') is null then
    raise exception '043a: Migrations 042 and 043 have not been applied';
  end if;
end $$;

{{views}}

-- structural postconditions only: nothing here evaluates an analytical view
do $$
declare
  bad text;
  n int;
begin
  -- relations: SELECT only for the API roles, as before
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '043a: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- the four views: same column count, still security_invoker, still readable by anon, each a wrapper over its function
  select string_agg(v.relname, ', ') into bad
  from (values ('v_player_realized_organizational_value', 41, 'disi_player_realized_organizational_value'),
               ('v_player_expected_organizational_value', 29, 'disi_player_expected_organizational_value'),
               ('v_expected_value_research_queue', 7, 'disi_expected_value_research_queue'),
               ('v_portfolio_candidate_readiness', 29, 'disi_portfolio_candidate_readiness')) as v(relname, cols, fn)
  join pg_class c on c.relnamespace = 'public'::regnamespace and c.relname = v.relname and c.relkind = 'v'
  where (select count(*) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) <> v.cols
     or coalesce(array_to_string(c.reloptions, ','), '') !~ 'security_invoker=(true|on)'
     or not has_table_privilege('anon', c.oid, 'SELECT')
     or not exists (select 1 from pg_depend d join pg_rewrite rw on rw.oid = d.objid
                    join pg_proc p on p.oid = d.refobjid and p.proname = v.fn and p.pronamespace = 'public'::regnamespace
                    where rw.ev_class = c.oid);
  if bad is not null then
    raise exception '043a postcondition: view shape, security or wrapper changed: %', bad;
  end if;
  -- the functions: read-only, invoker rights, fixed empty search_path, no PUBLIC execute, executable by the view readers
  select count(*) into n
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('disi_player_realized_organizational_value', 'disi_player_expected_organizational_value', 'disi_expected_value_research_queue',
                      'disi_portfolio_candidate_readiness')
    and p.provolatile = 's' and not p.prosecdef and coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']
    and not has_function_privilege('public', p.oid, 'EXECUTE')
    and has_function_privilege('anon', p.oid, 'EXECUTE') and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if n <> 4 then
    raise exception '043a postcondition: % of 4 staged functions are STABLE, invoker-rights, search_path-fixed and correctly granted', n;
  end if;
end $$;

commit;
