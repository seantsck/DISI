-- DISI rollback-054.sql: logical rollback of the full-career transaction history (WRITE; run only with explicit owner approval, after a failed
-- post-release verification).
--
-- Built from database/research/054/ (migration-values.json); regenerate with: node database/research/054/build.mjs
--
-- 054 created player_career_transactions with 46 reviewed rows, the view v_player_career_transactions, one product-contract row and two sources,
-- and redefined the development research queue's MULTI_ORG_SEASON_UNVERIFIED condition. This file restores the 053 queue text byte for byte,
-- drops the view and the table, deletes the contract row and the two sources (only where nothing else cites them), and refreshes the snapshots once:
-- every canonical table returns to its exact pre-054 content and the catalog to its pre-054 shape.
--
-- It is guarded: it refuses unless the table holds exactly the reviewed rows, and unless no object other than the 054 view and the research queue
-- depends on the table or the view. One transaction. Migration 054 CAN be applied again after this rollback.

begin;

create temporary table _r054 on commit drop as
select $r054${{payload_json}}$r054$::jsonb as j;

do $$
declare
  n int;
begin
  if to_regclass('public.player_career_transactions') is null or to_regclass('public.v_player_career_transactions') is null then
    raise exception 'rollback-054: the 054 table or view is missing; this database is not in the post-054 state';
  end if;
  select count(*) into n from public.player_career_transactions c, _r054
    where c.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y);
  if n > 0 then
    raise exception 'rollback-054: player_career_transactions holds % rows 054 did not write; later research depends on it', n;
  end if;
  if (select count(*) from public.player_career_transactions) <> (select jsonb_array_length(j -> 'events') from _r054) then
    raise exception 'rollback-054: player_career_transactions does not hold exactly the reviewed rows';
  end if;
  select count(*) into n from (
    select distinct v.oid from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
    where d.refobjid in ('public.player_career_transactions'::regclass, 'public.v_player_career_transactions'::regclass)
      and v.relname not in ('player_career_transactions', 'v_player_career_transactions', 'v_dodgers_development_research_queue')) x;
  if n > 0 then
    raise exception 'rollback-054: % other objects depend on the career-history table or view', n;
  end if;
  select count(*) into n from pg_constraint where confrelid = 'public.player_career_transactions'::regclass;
  if n > 0 then
    raise exception 'rollback-054: % foreign keys reference player_career_transactions', n;
  end if;
end $$;

-- 1. the 053 research queue, byte for byte (it no longer reads career history)
{{queue_view_053}}

-- 2. the view, the contract row, the table, the sources 054 added
drop view public.v_player_career_transactions;
delete from public.disi_product_contract where relation_name = 'v_player_career_transactions' and introduced_in = '054';
drop table public.player_career_transactions;
delete from public.sources s using _r054, jsonb_array_elements(j -> 'sources') x
where s.url = x ->> 'url'
  and not exists (select 1 from public.transaction_events e where e.source_id = s.id)
  and not exists (select 1 from public.transaction_event_assets a where a.source_id = s.id)
  and not exists (select 1 from public.dodgers_control_observations o where o.source_id = s.id);

-- 3. postconditions
do $$
declare
  n int;
begin
  if to_regclass('public.player_career_transactions') is not null or to_regclass('public.v_player_career_transactions') is not null then
    raise exception 'rollback-054 postcondition: the 054 table or view remains';
  end if;
  if exists (select 1 from public.disi_product_contract where relation_name = 'v_player_career_transactions') then
    raise exception 'rollback-054 postcondition: the contract row remains';
  end if;
  select count(*) into n from public.sources s, _r054, jsonb_array_elements(j -> 'sources') x where s.url = x ->> 'url';
  if n <> 0 then
    raise exception 'rollback-054 postcondition: % 054 sources remain', n;
  end if;
  if position('player_career_transactions' in pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) > 0 then
    raise exception 'rollback-054 postcondition: the research queue still reads career history';
  end if;
end $$;

-- 4. one coherent generation without the career history
do $$
begin
  perform * from public.disi_refresh_product_snapshots();
end $$;

commit;
