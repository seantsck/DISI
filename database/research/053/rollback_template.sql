-- DISI rollback-053.sql: logical rollback of the transaction and chronology research batch (WRITE; run only with explicit owner approval, after a
-- failed post-release verification).
--
-- Built from database/research/053/ (migration-values.json); regenerate with: node database/research/053/build.mjs
--
-- 053 inserted ten Dodgers transaction events with their assets and redefined the development research queue's MULTI_ORG_SEASON_UNVERIFIED
-- condition. It wrote no control observation, resolution or source, and neither table it wrote is sealed, so this file DELETES the assets and the
-- events and restores the 052 view text byte for byte: every canonical table returns to its exact pre-053 content.
--
-- It is guarded: it refuses to run unless every 053 event is present exactly as 053 wrote it and nothing recorded later depends on its assets (a
-- resolution, a timing observation or a control observation). One transaction. Migration 053 CAN be re-applied after this rollback. The
-- snapshots are refreshed once, so the product reads one coherent generation without the research.

begin;

create temporary table _r053 on commit drop as
select $r053${{payload_json}}$r053$::jsonb as j;

do $$
declare
  rec jsonb;
  n int;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception 'rollback-053: this is not a 045b database';
  end if;
  -- the 053 view reads the player's asset side (pg_get_viewdef drops comments); the 052 view does not
  if position('asset_side' in pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) = 0 then
    raise exception 'rollback-053: the research queue is not the 053 view; this database is not in the post-053 state';
  end if;
  for rec in select y from _r053, jsonb_array_elements(j -> 'events') y loop
    select count(*) into n from public.transaction_events e
      where e.event_key = rec ->> 'key' and e.transaction_date = (rec ->> 'date')::date and e.transaction_type = rec ->> 'type' and e.description = rec ->> 'description'
        and (select count(*) from public.transaction_event_assets a where a.event_id = e.id) = jsonb_array_length(rec -> 'assets');
    if n <> 1 then
      raise exception 'rollback-053: the event % is not in the state 053 wrote', rec ->> 'key';
    end if;
    select count(*) into n from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id
      where e.event_key = rec ->> 'key'
        and (exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id or r.resolved_asset_id = a.id)
          or exists (select 1 from public.transaction_asset_timing_observations t where t.subject_asset_id = a.id)
          or exists (select 1 from public.dodgers_control_observations o where o.subject_asset_id = a.id));
    if n > 0 then
      raise exception 'rollback-053: later research depends on the event %', rec ->> 'key';
    end if;
  end loop;
end $$;

-- 1. the assets and the events 053 wrote
delete from public.transaction_event_assets a using public.transaction_events e, _r053, jsonb_array_elements(j -> 'events') x
where a.event_id = e.id and e.event_key = x ->> 'key';
delete from public.transaction_events e using _r053, jsonb_array_elements(j -> 'events') x where e.event_key = x ->> 'key';

-- 2. the 052 research queue, byte for byte
{{queue_view_052}}

-- 3. postconditions
do $$
declare
  n int;
begin
  select count(*) into n from public.transaction_events e, _r053, jsonb_array_elements(j -> 'events') x where e.event_key = x ->> 'key';
  if n <> 0 then
    raise exception 'rollback-053 postcondition: % reviewed events remain', n;
  end if;
  if position('asset_side' in pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) > 0 then
    raise exception 'rollback-053 postcondition: the research queue is still the 053 view';
  end if;
end $$;

-- 4. one coherent generation without the research
do $$
begin
  perform * from public.disi_refresh_product_snapshots();
end $$;

commit;
