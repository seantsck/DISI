-- DISI v0.39.1
-- 054a_development_queue_performance.sql
-- Post-054 performance correction, applied after 054 and before any 055. Query shape only: v_dodgers_development_research_queue keeps its
-- columns, types, rows, labels, grants, comment and security_invoker behaviour; no table, fact, function, index, policy, grant, contract or
-- snapshot changes.
--
-- Why. The 054 definition names its team_stints CTE about forty times, so PostgreSQL materializes it once and every per-player subquery rescans
-- the whole materialized set (1739 team stints) without an index. On the hosted database (work_mem 2 MB) that set spills to disk: as anon the view
-- ran about 1.3 s with about 687,810 temp buffers read (about 5.4 GB) per read, and the first /development request after the 054 freeze deployment
-- exceeded the anon 3 s statement timeout (57014). Marking the CTE NOT MATERIALIZED lets the planner inline it into each subquery and use
-- player_season_stints_player_idx (player_id, season): about 55 ms with no temp I/O, planning about 18 MB, the same 128 rows.
--
-- The one change: `with team_stints as (` becomes `with team_stints as not materialized (`. Every other byte of the view is the 054 text.
-- Built from database/research/054a/ (054a_template.sql, build.mjs), which read the view from the frozen 054 file. Do not edit by hand.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. THE TWO DEFINITIONS, AS TEMPORARY VIEWS (deparsed by this server, so the comparison holds on any PostgreSQL version)
-- ===========================================================================

create temporary view _q054 as
{{queue_query_054}};

create temporary view _q054a as
{{queue_query_054a}};

create temporary table _m054a_before on commit drop as
select coalesce(c.relacl::text, '') as acl, coalesce(array_to_string(c.reloptions, ','), '') as opts,
  obj_description(c.oid, 'pg_class') as note, c.relowner
from pg_class c where c.oid = 'public.v_dodgers_development_research_queue'::regclass;

-- ===========================================================================
-- 1. PRECONDITIONS: exactly the 054 view (or this one, on a rerun)
-- ===========================================================================

do $$
declare
  d text;
begin
  if to_regclass('public.player_career_transactions') is null or to_regclass('public.v_player_career_transactions') is null then
    raise exception '054a: Migration 054 has not been applied';
  end if;
  d := pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass);
  if d is distinct from pg_get_viewdef('pg_temp._q054'::regclass) and d is distinct from pg_get_viewdef('pg_temp._q054a'::regclass) then
    raise exception '054a: v_dodgers_development_research_queue is not the 054 definition';
  end if;
  if (select opts from _m054a_before) !~ 'security_invoker=(true|on)' then
    raise exception '054a: v_dodgers_development_research_queue is not security_invoker';
  end if;
end $$;

-- ===========================================================================
-- 2. THE RESEARCH QUEUE: the 054 view with team_stints NOT MATERIALIZED
-- ===========================================================================

{{queue_view_054a}}

-- ===========================================================================
-- 3. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  n bigint;
  b record;
begin
  select * into b from _m054a_before;
  if pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass) is distinct from pg_get_viewdef('pg_temp._q054a'::regclass) then
    raise exception '054a postcondition: the research queue is not the 054a definition';
  end if;
  -- the same rows as the 054 query on this database, as a multiset (every column, duplicates counted)
  select count(*) into n from (
    (select * from public.v_dodgers_development_research_queue except all select * from pg_temp._q054)
    union all
    (select * from pg_temp._q054 except all select * from public.v_dodgers_development_research_queue)) x;
  if n <> 0 then
    raise exception '054a postcondition: % rows differ from the 054 research queue', n;
  end if;
  if (select count(*) from public.v_dodgers_development_research_queue) <> (select count(*) from pg_temp._q054) then
    raise exception '054a postcondition: the row count differs from the 054 research queue';
  end if;
  -- grants, options, comment and owner are what they were
  if (select row(coalesce(c.relacl::text, ''), coalesce(array_to_string(c.reloptions, ','), ''), obj_description(c.oid, 'pg_class'), c.relowner)
        from pg_class c where c.oid = 'public.v_dodgers_development_research_queue'::regclass)
     is distinct from row(b.acl, b.opts, b.note, b.relowner) then
    raise exception '054a postcondition: a grant, option, comment or owner of the research queue changed';
  end if;
  -- no snapshot reads a different answer, so none is refreshed (the generation stays)
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception '054a postcondition: a product snapshot drifted';
  end if;
end $$;

drop view pg_temp._q054a;
drop view pg_temp._q054;

commit;
