-- DISI rollback-054a.sql
-- Restores the exact 054 definition of v_dodgers_development_research_queue (the materialized team_stints CTE). 054a changed nothing else,
-- so nothing else is restored: no row, grant, comment, option or snapshot moves.
--
-- Built from database/research/054a/ (rollback_template.sql, build.mjs), which read the view from the frozen 054 file. Do not edit by hand.
-- Refuses a database that does not hold the 054a definition.

begin;

create temporary view _q054 as
{{queue_query_054}};

create temporary view _q054a as
{{queue_query_054a}};

create temporary table _r054a_before on commit drop as
select coalesce(c.relacl::text, '') as acl, coalesce(array_to_string(c.reloptions, ','), '') as opts,
  obj_description(c.oid, 'pg_class') as note, c.relowner
from pg_class c where c.oid = 'public.v_dodgers_development_research_queue'::regclass;

do $$
begin
  if pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass) is distinct from pg_get_viewdef('pg_temp._q054a'::regclass) then
    raise exception 'rollback-054a: v_dodgers_development_research_queue is not the 054a definition';
  end if;
end $$;

{{queue_view_054}}

do $$
declare
  n bigint;
  b record;
begin
  select * into b from _r054a_before;
  if pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass) is distinct from pg_get_viewdef('pg_temp._q054'::regclass) then
    raise exception 'rollback-054a postcondition: the research queue is not the 054 definition';
  end if;
  select count(*) into n from (
    (select * from public.v_dodgers_development_research_queue except all select * from pg_temp._q054a)
    union all
    (select * from pg_temp._q054a except all select * from public.v_dodgers_development_research_queue)) x;
  if n <> 0 then
    raise exception 'rollback-054a postcondition: % rows differ', n;
  end if;
  if (select row(coalesce(c.relacl::text, ''), coalesce(array_to_string(c.reloptions, ','), ''), obj_description(c.oid, 'pg_class'), c.relowner)
        from pg_class c where c.oid = 'public.v_dodgers_development_research_queue'::regclass)
     is distinct from row(b.acl, b.opts, b.note, b.relowner) then
    raise exception 'rollback-054a postcondition: a grant, option, comment or owner of the research queue changed';
  end if;
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception 'rollback-054a postcondition: a product snapshot drifted';
  end if;
end $$;

drop view pg_temp._q054a;
drop view pg_temp._q054;

commit;
