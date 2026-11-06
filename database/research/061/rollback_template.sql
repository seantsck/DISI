-- DISI rollback of Migration 061 (transaction research closure). WRITE: run only with explicit owner approval.
--
-- Built from database/research/061/ (research-evidence.json, baseline-build.json); regenerate with: node database/research/061/build.mjs
--
-- 061 filled six existing CASH assets, added three assets beside what was recorded (two international bonus pool assets and Margot's second cash
-- component), added the two Garland events with their assets, registered twelve sources and recorded one evidence row per fact and source. None of
-- those tables is sealed and 061 wrote no transaction_asset_resolutions row (the Frias and Perez placeholders are untouched), so this file:
--   * returns the six CASH amounts to NULL (unknown), only where they are exactly the reviewed amounts;
--   * DELETES the three added assets, the two Garland events and their assets, and the 17 evidence rows 061 wrote;
--   * keeps the twelve source rows as provenance (what was read stays on record; a reapply finds them and does not duplicate them);
--   * leaves every other transaction row, source, evidence row, resolution, observation, signing, ledger row, outcome, metric and WAR row as it was.
-- It is guarded: it refuses unless all of 061 is present exactly as written, and unless nothing depends on what is removed (no control observation,
-- timing observation, resolution, return metric or competitive-context row on the added assets or events, and no later transaction recorded for
-- Garland). One transaction. Unlike 060, nothing is retracted, so Migration 061 CAN be reapplied after this rollback and reproduces the same state.
-- Consequence documented in the other direction: while 061 is applied, rollback-049 is unavailable (it refuses when a later transaction exists for
-- Jon Garland); rolling back 061 first restores it.

begin;
set local statement_timeout = '600s';

create temporary table _r061 on commit drop as
select $r061${{payload_json}}$r061$::jsonb as j;

create temporary table _r061_src on commit drop as
select x ->> 'key' as key, x ->> 'url' as url from _r061 m, jsonb_array_elements(m.j -> 'sources') x;

create temporary table _r061_upd on commit drop as
select x ->> 'id' as id, x ->> 'event_key' as event_key, x ->> 'side' as side, x ->> 'asset_name' as asset_name, x ->> 'counterparty' as counterparty,
       (x ->> 'amount')::numeric(14,2) as amount
from _r061 m, jsonb_array_elements(m.j -> 'updates') x;

create temporary table _r061_ins on commit drop as
select x ->> 'id' as id, x ->> 'event_key' as event_key, x ->> 'side' as side, x ->> 'asset_type' as asset_type, x ->> 'asset_name' as asset_name,
       x ->> 'counterparty' as counterparty, (x ->> 'amount')::numeric(14,2) as amount, x ->> 'source' as source, x ->> 'role_note' as role_note
from _r061 m, jsonb_array_elements(m.j -> 'inserts') x;

create temporary table _r061_ev on commit drop as
select x ->> 'id' as id, x ->> 'event_key' as event_key, (x ->> 'transaction_date')::date as transaction_date, x ->> 'transaction_type' as transaction_type,
       x #>> '{asset,side}' as a_side, x #>> '{asset,asset_name}' as a_name, x #>> '{asset,mlb_id}' as a_mlb
from _r061 m, jsonb_array_elements(m.j -> 'events') x;

create temporary table _r061_evd on commit drop as
select x ->> 'event_key' as event_key, x ->> 'field_name' as field_name, x ->> 'source' as source, x ->> 'confidence' as confidence, x ->> 'note' as note
from _r061 m, jsonb_array_elements(m.j -> 'evidence') x;

create temporary table _r061_keys on commit drop as
select (select array_agg(distinct k) from (select event_key k from _r061_upd union select event_key from _r061_ins) z) as target_keys,
       (select array_agg(event_key) from _r061_ev) as new_keys,
       (select array_agg(url) from _r061_src) as urls;

-- ===========================================================================
-- 1. GUARDS
-- ===========================================================================

do $$
declare
  m jsonb := (select j from _r061);
  r record;
  n int;
  applied int := 0;
begin
  if to_regprocedure('public.disi_refresh_product_snapshots()') is null or to_regprocedure('public.disi_product_snapshot_drift()') is null then
    raise exception 'rollback-061: this is not a post-060 database';
  end if;
  for r in select * from _r061_upd order by id loop
    select count(*) into n from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
      join public.organizations o on o.id = x.counterparty_organization_id
      where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = 'CASH' and x.asset_name = r.asset_name and o.name = r.counterparty and x.cash_amount_usd = r.amount;
    applied := applied + n;
  end loop;
  for r in select * from _r061_ins order by id loop
    select count(*) into n from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
      join public.sources so on so.id = x.source_id join _r061_src s on s.url = so.url and s.key = r.source
      where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = r.asset_type and x.asset_name = r.asset_name and x.role_note = r.role_note
        and x.cash_amount_usd is not distinct from (case when r.asset_type = 'CASH' then r.amount end)
        and x.pool_space_amount_usd is not distinct from (case when r.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' then r.amount end);
    applied := applied + n;
  end loop;
  for r in select * from _r061_ev order by transaction_date loop
    select count(*) into n from public.transaction_events e where e.event_key = r.event_key and e.transaction_date = r.transaction_date and e.transaction_type = r.transaction_type
      and (select count(*) from public.transaction_event_assets x where x.event_id = e.id) = 1;
    applied := applied + n;
  end loop;
  for r in select * from _r061_evd order by event_key, field_name, source loop
    select count(*) into n from public.evidence ev join public.transaction_events e on e.id = ev.entity_id join public.sources so on so.id = ev.source_id join _r061_src s on s.url = so.url
      where ev.entity_type = 'transaction_event' and e.event_key = r.event_key and ev.field_name is not distinct from r.field_name and s.key = r.source
        and ev.confidence::text = r.confidence and ev.evidence_note = r.note;
    applied := applied + n;
  end loop;
  if applied = 0 then
    raise exception 'rollback-061: Migration 061 is not applied';
  end if;
  if applied <> (select count(*) from _r061_upd) + (select count(*) from _r061_ins) + (select count(*) from _r061_ev) + (select count(*) from _r061_evd) then
    raise exception 'rollback-061: % of the % facts 061 wrote are present exactly as written; a partial state or a later change is refused',
      applied, (select count(*) from _r061_upd) + (select count(*) from _r061_ins) + (select count(*) from _r061_ev) + (select count(*) from _r061_evd);
  end if;
  -- nothing may depend on what is removed
  if exists (select 1 from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
             where (e.event_key = any ((select new_keys from _r061_keys)::text[]) or x.id in (select x2.id from public.transaction_event_assets x2 join public.transaction_events e2 on e2.id = x2.event_id
                      join _r061_ins i on i.event_key = e2.event_key and i.side = x2.asset_side and i.asset_name = x2.asset_name))
               and (exists (select 1 from public.dodgers_control_observations o where o.subject_asset_id = x.id)
                 or exists (select 1 from public.transaction_asset_resolutions rs where rs.placeholder_asset_id = x.id or rs.resolved_asset_id = x.id)
                 or exists (select 1 from public.transaction_asset_timing_observations t where t.subject_asset_id = x.id))) then
    raise exception 'rollback-061: later research depends on an asset 061 added; rollback refused';
  end if;
  if exists (select 1 from public.transaction_events e where e.event_key = any ((select new_keys from _r061_keys)::text[])
             and (exists (select 1 from public.transaction_asset_timing_observations t where t.event_id = e.id)
               or exists (select 1 from public.transaction_return_metrics t where t.event_id = e.id)
               or exists (select 1 from public.transaction_competitive_context t where t.event_id = e.id))) then
    raise exception 'rollback-061: later research depends on a Garland event 061 added; rollback refused';
  end if;
  -- no later transaction was recorded for Garland, and no evidence beyond the reviewed rows hangs on the removed events
  if exists (select 1 from public.transaction_events e join public.transaction_event_assets x on x.event_id = e.id
             where x.mlb_id = (select a_mlb from _r061_ev limit 1) and e.transaction_date > (select min(transaction_date) from _r061_ev) and e.event_key <> all ((select new_keys from _r061_keys)::text[])) then
    raise exception 'rollback-061: a later transaction was recorded for Jon Garland; rollback refused';
  end if;
  if (select count(*) from public.evidence ev where ev.entity_type = 'transaction_event'
        and ev.entity_id in (select id from public.transaction_events where event_key = any ((select new_keys from _r061_keys)::text[]))) <> (select count(*) from _r061_evd where event_key = any ((select new_keys from _r061_keys)::text[])) then
    raise exception 'rollback-061: evidence beyond the reviewed rows exists on a Garland event; rollback refused';
  end if;
  raise notice 'rollback-061 phase guards: done at +%', clock_timestamp() - now();
end $$;

create temporary table _r061_before on commit drop as
select
  (select max(generation_id) from public.product_executive_snapshot) as generation,
  (select count(*) from public.transaction_events) as events,
  (select count(*) from public.transaction_event_assets) as assets,
  (select count(*) from public.evidence) as evidence,
  (select count(*) from public.sources) as sources,
  (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null) as cash_unknown,
  (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null) as pool_unknown,
  (select md5(coalesce(string_agg(md5(to_jsonb(e)::text), '' order by e.id), '')) from public.transaction_events e where e.event_key <> all (k.new_keys)) as other_events,
  (select md5(coalesce(string_agg(md5(to_jsonb(a)::text), '' order by a.id), '')) from public.transaction_event_assets a
     where a.event_id not in (select id from public.transaction_events where event_key = any (k.target_keys || k.new_keys))) as other_assets,
  (select md5(coalesce(string_agg(md5(to_jsonb(a)::text), '' order by a.id), '')) from public.transaction_event_assets a
     where a.event_id in (select id from public.transaction_events where event_key = any (k.target_keys)) and a.asset_type in ('PLAYER', 'FUTURE_CONSIDERATIONS', 'PLAYER_TO_BE_NAMED')) as target_event_kept_assets,
  (select md5(coalesce(string_agg(md5(to_jsonb(r)::text), '' order by r.id), '')) from public.transaction_asset_resolutions r) as resolutions,
  (select md5(coalesce(string_agg(md5(to_jsonb(s)::text), '' order by s.id), '')) from public.sources s) as sources_all,
  (select md5(coalesce(string_agg(md5(to_jsonb(v)::text), '' order by v.id), '')) from public.evidence v
     where v.source_id not in (select id from public.sources where url = any (k.urls))) as other_evidence,
  (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
     from public.signings s) as signings,
  (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by md5(to_jsonb(o)::text)), '')) from public.outcomes o) as outcomes
from _r061_keys k;

-- ===========================================================================
-- 2. RESTORE AND REMOVE
-- ===========================================================================

-- the six amounts return to unknown (only where they are exactly the reviewed amounts)
update public.transaction_event_assets x set cash_amount_usd = null
from public.transaction_events e, _r061_upd u
where e.id = x.event_id and e.event_key = u.event_key and x.asset_side = u.side and x.asset_type = 'CASH' and x.asset_name = u.asset_name and x.cash_amount_usd = u.amount;

-- the evidence 061 wrote
delete from public.evidence ev
using _r061_evd d, public.transaction_events e, public.sources so, _r061_src s
where ev.entity_type = 'transaction_event' and e.id = ev.entity_id and e.event_key = d.event_key and so.id = ev.source_id and so.url = s.url and s.key = d.source
  and ev.field_name is not distinct from d.field_name and ev.confidence::text = d.confidence and ev.evidence_note = d.note;

-- the three added assets (the asset each sits beside is untouched)
delete from public.transaction_event_assets x
using public.transaction_events e, _r061_ins i
where e.id = x.event_id and e.event_key = i.event_key and x.asset_side = i.side and x.asset_name = i.asset_name and x.asset_type = i.asset_type and x.role_note = i.role_note;

-- the two Garland events and their assets
delete from public.transaction_event_assets x using public.transaction_events e, _r061_ev v where x.event_id = e.id and e.event_key = v.event_key;
delete from public.transaction_events e using _r061_ev v where e.event_key = v.event_key;

do $$
begin
  raise notice 'rollback-061 phase restore: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 3. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  m jsonb := (select j from _r061);
  bf record;
  r record;
begin
  select * into bf from _r061_before;
  for r in select * from _r061_upd order by id loop
    if (select count(*) from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
        where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = 'CASH' and x.asset_name = r.asset_name and x.cash_amount_usd is null) <> 1 then
      raise exception 'rollback-061 postcondition: % is not unknown again', r.id;
    end if;
  end loop;
  if exists (select 1 from public.transaction_events where event_key = any ((select new_keys from _r061_keys)::text[]))
     or exists (select 1 from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id join _r061_ins i on i.event_key = e.event_key and i.side = x.asset_side and i.asset_name = x.asset_name) then
    raise exception 'rollback-061 postcondition: an added event or asset remains';
  end if;
  if (select count(*) from public.transaction_events) <> bf.events - (m #>> '{delta,events}')::int
     or (select count(*) from public.transaction_event_assets) <> bf.assets - (m #>> '{delta,assets}')::int
     or (select count(*) from public.evidence) <> bf.evidence - (m #>> '{delta,evidence}')::int
     or (select count(*) from public.sources) <> bf.sources
     or (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null) <> bf.cash_unknown - (m #>> '{delta,cash_unknown}')::int
     or (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null) <> bf.pool_unknown - (m #>> '{delta,pool_unknown}')::int
     or (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null) <> (m #>> '{baseline,cash_unknown}')::int
     or (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null) <> (m #>> '{baseline,pool_unknown}')::int then
    raise exception 'rollback-061 postcondition: the transaction state is not the pre-061 baseline';
  end if;
  if (select md5(coalesce(string_agg(md5(to_jsonb(e)::text), '' order by e.id), '')) from public.transaction_events e where e.event_key <> all ((select new_keys from _r061_keys)::text[])) <> bf.other_events
     or (select md5(coalesce(string_agg(md5(to_jsonb(ax)::text), '' order by ax.id), '')) from public.transaction_event_assets ax
         where ax.event_id not in (select id from public.transaction_events where event_key = any ((select target_keys || new_keys from _r061_keys)::text[]))) <> bf.other_assets
     or (select md5(coalesce(string_agg(md5(to_jsonb(ax)::text), '' order by ax.id), '')) from public.transaction_event_assets ax
         where ax.event_id in (select id from public.transaction_events where event_key = any ((select target_keys from _r061_keys)::text[]))
           and ax.asset_type in ('PLAYER', 'FUTURE_CONSIDERATIONS', 'PLAYER_TO_BE_NAMED')) <> bf.target_event_kept_assets
     or (select md5(coalesce(string_agg(md5(to_jsonb(rs)::text), '' order by rs.id), '')) from public.transaction_asset_resolutions rs) <> bf.resolutions
     or (select md5(coalesce(string_agg(md5(to_jsonb(s)::text), '' order by s.id), '')) from public.sources s) <> bf.sources_all
     or (select md5(coalesce(string_agg(md5(to_jsonb(v)::text), '' order by v.id), '')) from public.evidence v
         where v.source_id not in (select id from public.sources where url = any ((select urls from _r061_keys)::text[]))) <> bf.other_evidence
     or (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
         from public.signings s) <> bf.signings
     or (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by md5(to_jsonb(o)::text)), '')) from public.outcomes o) <> bf.outcomes then
    raise exception 'rollback-061 postcondition: something outside the facts 061 wrote changed';
  end if;
  raise notice 'rollback-061 phase postconditions: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 4. GENERATION: one coherent refresh, only if the snapshots drift
-- ===========================================================================

do $$
declare
  bf record;
  tn text;
  g bigint[];
  want bigint;
  refreshed boolean := false;
begin
  select * into bf from _r061_before;
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    perform * from public.disi_refresh_product_snapshots();
    refreshed := true;
  end if;
  want := bf.generation + refreshed::int;
  if (select max(generation_id) from public.product_executive_snapshot) <> want
     or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception 'rollback-061 postcondition: expected one drift-free generation % (a refresh only when the snapshots drift)', want;
  end if;
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'product\_%' order by 1 loop
    execute format('select array_agg(distinct generation_id) from public.%I', tn) into g;
    if g is distinct from array[want] then
      raise exception 'rollback-061 postcondition: snapshot % is not at the single generation %', tn, want;
    end if;
  end loop;
  raise notice 'rollback-061 phase snapshots: done at +% (generation %, refreshed %)', clock_timestamp() - now(), want, refreshed;
end $$;

commit;
