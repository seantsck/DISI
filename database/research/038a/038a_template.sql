-- DISI v0.29.1
-- 038a_network_outcome_view_performance.sql
-- Post-038 performance correction, applied after 038 and before any 039. Query shape only: v_network_player_outcomes keeps its
-- columns, types, rows, NULLs, labels, grants, comment and security_invoker behaviour; no table, fact, grant or policy changes.
--
-- Why. On the hosted database the 038 definition computed the 036 realized-outcome spine three times, plus the 036 expectation layer
-- and the 037 pathway layer for every tracked signing, before selecting the few documented network players; as anon it, and the
-- v_network_outcome_summary / v_network_outcome_research_queue views that read it, could exceed the 3 s statement timeout. This
-- definition reads the spine once and applies the 036 anchor and 037 pathway-class rules to the documented players only.
--
-- Built from database/research/038a/ (views.sql, build.mjs). The 038 file itself is applied and frozen in place; it is not edited.
--
-- Rerunnable: every statement is idempotent.

begin;

do $$
begin
  if to_regclass('public.v_network_player_outcomes') is null or to_regclass('public.v_network_outcome_summary') is null then
    raise exception '038a: Migration 038 has not been applied';
  end if;
end $$;

{{views}}

do $$
declare
  bad text;
  n int;
  expected int;
begin
  -- the public API surface is unchanged: SELECT only for anon / authenticated, the view still security_invoker
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '038a: API roles hold privileges beyond SELECT: %', bad;
  end if;
  if not has_table_privilege('anon', 'public.v_network_player_outcomes', 'SELECT')
     or not exists (select 1 from pg_class where oid = 'public.v_network_player_outcomes'::regclass and array_to_string(reloptions, ',') ~ 'security_invoker=(true|on)') then
    raise exception '038a postcondition: v_network_player_outcomes lost its anon SELECT grant or security_invoker';
  end if;
  -- one row per ACTIVE relationship, as before
  select count(*) into expected from public.player_network_relationships where record_status = 'ACTIVE';
  select count(*) into n from public.v_network_player_outcomes;
  if n <> expected then
    raise exception '038a postcondition: % network outcome rows for % ACTIVE relationships', n, expected;
  end if;
end $$;

commit;
