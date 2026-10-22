-- DISI 049: logical rollback of the transaction-package batch (WRITE; run only with explicit owner approval, after a failed post-release verification).
--
-- Built from database/research/049/ (transaction-evidence.json); regenerate with: node database/research/049/build.mjs
--
-- 049 inserted four transaction events (the 1967 Dodgers-Twins trade, Jon Garland's free agency and the 1968 expansion-draft selections of
-- Mudcat Grant and Zoilo Versalles) with their assets, re-dated and re-described the 2009 Tony Abreu trade, added Jon Garland as its return, and added
-- four MLB identifiers. None of those tables is sealed and 049 added no resolution, so this file DELETES the events and assets, restores the Abreu event's
-- stored date, description and asset note, and clears the four identifiers: the three transaction tables return to their exact pre-049 content. The source
-- rows (what was read) stay as provenance.
--
-- It is guarded: it refuses to run unless the four events are present and the Abreu trade is in the state 049 wrote, unless nothing depends on the
-- assets being removed (no control observation, timing observation or resolution), and unless no later transaction was recorded for the players involved.
-- One transaction. Unlike 046, nothing is retracted instead of deleted, so Migration 049 CAN be re-applied after this rollback.

begin;

create temporary table _r049 on commit drop as
select $r049${{payload_json}}$r049$::jsonb as j;

do $$
declare
  rec jsonb;
  n int;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception 'rollback-049: this is not a 045b database';
  end if;
  for rec in select y from _r049, jsonb_array_elements(j -> 'events') y loop
    select count(*) into n from public.transaction_events e where e.event_key = rec ->> 'key';
    if n <> 1 then
      raise exception 'rollback-049: the event % is not present; this database is not in the post-049 state', rec ->> 'key';
    end if;
    -- nothing may depend on the assets being removed
    select count(*) into n from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id
      where e.event_key = rec ->> 'key'
        and (exists (select 1 from public.dodgers_control_observations o where o.subject_asset_id = a.id)
          or exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id or r.resolved_asset_id = a.id)
          or exists (select 1 from public.transaction_asset_timing_observations t where t.subject_asset_id = a.id));
    if n > 0 then
      raise exception 'rollback-049: later research depends on the event %', rec ->> 'key';
    end if;
  end loop;
  -- the Abreu trade is in the state 049 wrote
  select count(*) into n from public.transaction_events e, _r049
    where e.event_key = j ->> 'abreu_event' and e.transaction_date = (j #>> '{abreu,initiated}')::date and e.description = j #>> '{abreu,description}';
  if n <> 1 then
    raise exception 'rollback-049: the Abreu trade is not in the post-049 state';
  end if;
  -- Garland (as the Abreu return) has no dependent observation
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _r049
    where e.event_key = j ->> 'abreu_event' and a.mlb_id = j #>> '{abreu,incoming,mlb_id}'
      and (exists (select 1 from public.dodgers_control_observations o where o.subject_asset_id = a.id)
        or exists (select 1 from public.transaction_asset_timing_observations t where t.subject_asset_id = a.id)
        or exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id or r.resolved_asset_id = a.id));
  if n > 0 then
    raise exception 'rollback-049: later research depends on the Garland asset';
  end if;
  -- no later transaction was recorded for the players involved
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _r049
    where a.mlb_id in ('279782', '115046', '123713') and e.event_key <> j ->> 'abreu_event'
      and e.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y);
  if n > 0 then
    raise exception 'rollback-049: a later transaction was recorded for Garland, Grant or Versalles';
  end if;
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _r049
    where a.mlb_id = '119112' and a.asset_side = 'OUTGOING' and e.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y);
  if n > 0 then
    raise exception 'rollback-049: a later transaction was recorded for Bob Miller';
  end if;
end $$;

-- 1. Garland leaves the Abreu trade, and the trade returns to the date, description and note DISI stored before 049
delete from public.transaction_event_assets a using _r049, public.transaction_events e
where e.event_key = j ->> 'abreu_event' and a.event_id = e.id and a.asset_side = 'INCOMING' and a.mlb_id = j #>> '{abreu,incoming,mlb_id}';

update public.transaction_events e
set transaction_date = (j #>> '{abreu,original_date}')::date, description = j #>> '{abreu,original_description}'
from _r049 where e.event_key = j ->> 'abreu_event';

update public.transaction_event_assets a
set role_note = j #>> '{abreu,original_ptbnl_role_note}'
from _r049, public.transaction_events e
where e.event_key = j ->> 'abreu_event' and a.event_id = e.id and a.asset_side = 'OUTGOING' and a.asset_type = 'PLAYER' and a.mlb_id = j #>> '{abreu,ptbnl,mlb_id}';

-- 2. the four events and their assets
delete from public.transaction_event_assets a using public.transaction_events e, _r049, jsonb_array_elements(j -> 'events') x
where a.event_id = e.id and e.event_key = x ->> 'key';
delete from public.transaction_events e using _r049, jsonb_array_elements(j -> 'events') x where e.event_key = x ->> 'key';

-- 3. the four identifiers (only where they are exactly the reviewed ones)
update public.transaction_event_assets a
set mlb_id = null
from _r049, jsonb_array_elements(j -> 'identities') x, public.transaction_events e
where e.event_key = x ->> 'event' and a.event_id = e.id and a.asset_side = 'INCOMING' and a.asset_name = x ->> 'asset' and a.mlb_id = x ->> 'mlb_id';

-- 4. postconditions
do $$
declare
  n int;
begin
  select count(*) into n from public.transaction_events e, _r049, jsonb_array_elements(j -> 'events') x where e.event_key = x ->> 'key';
  if n <> 0 then
    raise exception 'rollback-049 postcondition: % reviewed events remain', n;
  end if;
  select count(*) into n from public.transaction_events e, _r049
    where e.event_key = j ->> 'abreu_event' and e.transaction_date = (j #>> '{abreu,original_date}')::date and e.description = j #>> '{abreu,original_description}';
  if n <> 1 then
    raise exception 'rollback-049 postcondition: the Abreu trade is not back to its stored date and description';
  end if;
  select count(*) into n from public.transaction_event_assets a, _r049 where a.mlb_id in (j #>> '{abreu,incoming,mlb_id}', '115046', '123713');
  if n <> 0 then
    raise exception 'rollback-049 postcondition: % Garland, Grant or Versalles assets remain', n;
  end if;
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _r049, jsonb_array_elements(j -> 'identities') x
    where e.event_key = x ->> 'event' and a.asset_name = x ->> 'asset' and a.mlb_id = x ->> 'mlb_id';
  if n <> 0 then
    raise exception 'rollback-049 postcondition: % identifiers remain', n;
  end if;
end $$;

-- 5. one coherent generation without the research
do $$
begin
  perform * from public.disi_refresh_product_snapshots();
end $$;

commit;
