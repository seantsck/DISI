-- DISI v0.46
-- 061_transaction_research_closure.sql
-- Transaction research closure: eight sourced financial facts, one known component with an unknown amount, and the two ends of Jon Garland's 2011
-- Dodgers control interval. Run after 060.
--
-- Built from database/research/061/ (research-evidence.json, baseline-build.json, build.mjs). Do not edit by hand: change the input and rebuild.
--
-- What this is. A reviewed data batch over the existing transaction tables. It adds no table, view, function, enum, trigger, grant, policy, player or
-- signing, and changes no definition.
--   * Six existing CASH assets whose amount was NULL receive their reported amount (an UPDATE of that one asset; package membership unchanged):
--     the Cardinals' cash for Jedd Gyorko ($2,938,710), the Dodgers' cash to Atlanta in the Gonzalez-Kemp package ($4,500,000), Boston's cash for
--     Betts / Price ($48,000,000), the Dodgers' cash to Cincinnati in the Puig-Kemp-Wood-Farmer package ($7,000,000), the Dodgers' guaranteed cash to
--     Minnesota for Margot ($6,000,000) and Toronto's cash for Russell Martin ($16,400,000).
--   * Three assets are added beside what is already recorded (nothing is retyped or rewritten):
--       - Arnaldo Lantigua: an INCOMING INTERNATIONAL_BONUS_POOL_SPACE asset of $1,500,000; the event's FUTURE_CONSIDERATIONS placeholder stays;
--       - Cingrani / Gyorko: an INCOMING INTERNATIONAL_BONUS_POOL_SPACE asset whose amount stays NULL (the Cardinals' announcement names the
--         2019/2020 international cap space and gives no amount; 250,000 is never inferred; unknown, never zero); the placeholder stays;
--       - Margot: a second OUTGOING CASH asset of $2,000,000, the component the original deal made conditional on Minnesota declining the 2025
--         option. The Twins declined it on 2024-11-01 and the Associated Press reports the Dodgers owe the additional $2,000,000 on 2026-12-01; the
--         asset says so and does not claim it has been paid. The guaranteed $6,000,000 stays its own asset.
--   * Two Garland events are added: FREE_AGENT_SIGNING 2010-11-26 and FREE_AGENCY 2011-10-30, each with its one PLAYER asset (no CASH asset: a
--     contract is not trade consideration). They open and close the 2011 Dodgers control interval and leave the 2009 interval untouched.
--   * Each fact carries a sources row for the real page that was read (its accessed_at is the retrieval time; a page the live site refused was read
--     through the Internet Archive snapshot named in its notes) and one evidence row per fact and source. The asset keeps its original MLB source.
--   * Not written: Maximo Martinez (the cited page says the amount was not announced), Jose Vizcaino ($500,000 is not in the cited page), Casey
--     Blake ("about" $2MM is approximate and the schema stores exact amounts), Carlos Frias and Jeral Perez (no readable source for the placeholder
--     resolution), every identity / route item and every other unknown cash amount.
-- It then refreshes the product snapshots once, only if the snapshots drift (they are not expected to).
--
-- Rerunnable: a rerun finds every fact present and changes nothing. After rollback-061 (which restores the amounts and deletes the added rows; the
-- source rows stay as provenance) a reapply records the same facts again.
--
-- Verification: this transaction proves the write and its direct result with inexpensive checks (the targeted rows, the row counts, every other
-- transaction row, source, evidence row, resolution and observation unchanged, signings, ledger, outcomes, metrics and WAR unchanged, one
-- drift-free generation). The queue effect is measured on the replay (database/research/061/before-after.json) and by the release check.

begin;
set local statement_timeout = '600s';

-- ===========================================================================
-- 0. REVIEWED INPUT (database/research/061/research-evidence.json)
-- ===========================================================================

create temporary table _m061 on commit drop as
select $m061${{payload_json}}$m061$::jsonb as j;

create temporary table _m061_src on commit drop as
select x ->> 'key' as key, x ->> 'url' as url, x ->> 'source_name' as source_name, x ->> 'source_type' as source_type, x ->> 'source_tier' as source_tier,
       x ->> 'title' as title, (x ->> 'publication_date')::date as publication_date, (x ->> 'accessed_at')::timestamptz as accessed_at, x ->> 'notes' as notes
from _m061 m, jsonb_array_elements(m.j -> 'sources') x;

create temporary table _m061_upd on commit drop as
select x ->> 'id' as id, x ->> 'event_key' as event_key, x ->> 'side' as side, x ->> 'asset_name' as asset_name, x ->> 'counterparty' as counterparty,
       (x ->> 'amount')::numeric(14,2) as amount
from _m061 m, jsonb_array_elements(m.j -> 'updates') x;

create temporary table _m061_ins on commit drop as
select x ->> 'id' as id, x ->> 'event_key' as event_key, x ->> 'side' as side, x ->> 'asset_type' as asset_type, x ->> 'asset_name' as asset_name,
       x ->> 'counterparty' as counterparty, (x ->> 'amount')::numeric(14,2) as amount, x ->> 'source' as source, x ->> 'role_note' as role_note, x ->> 'keeps_asset' as keeps_asset
from _m061 m, jsonb_array_elements(m.j -> 'inserts') x;

create temporary table _m061_ev on commit drop as
select x ->> 'id' as id, x ->> 'event_key' as event_key, (x ->> 'transaction_date')::date as transaction_date, x ->> 'transaction_type' as transaction_type,
       x ->> 'description' as description, x ->> 'historical_label' as historical_label, x ->> 'source' as source,
       x #>> '{asset,side}' as a_side, x #>> '{asset,asset_name}' as a_name, x #>> '{asset,asset_type}' as a_type, x #>> '{asset,bref_id}' as a_bref, x #>> '{asset,mlb_id}' as a_mlb
from _m061 m, jsonb_array_elements(m.j -> 'events') x;

create temporary table _m061_evd on commit drop as
select x ->> 'kind' as kind, x ->> 'ref' as ref, x ->> 'event_key' as event_key, x ->> 'field_name' as field_name, x ->> 'source' as source,
       x ->> 'confidence' as confidence, x ->> 'note' as note
from _m061 m, jsonb_array_elements(m.j -> 'evidence') x;

-- the keys the fingerprints exclude
create temporary table _m061_keys on commit drop as
select (select array_agg(distinct k) from (select event_key k from _m061_upd union select event_key from _m061_ins) z) as target_keys,
       (select array_agg(event_key) from _m061_ev) as new_keys,
       (select array_agg(url) from _m061_src) as urls;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 061 was written for, or exactly 061's own result
-- ===========================================================================

create temporary table _m061_state (applied int, total int, generation bigint, events int, assets int, sources int, evidence int, cash_unknown int, pool_unknown int,
  src_present int, garland_events int) on commit drop;

do $$
declare
  m jsonb := (select j from _m061);
  r record;
  a record;
  n int;
  eid uuid;
  dodgers uuid;
  src_present int := 0;
  applied int := 0;
  total int := 0;
  is_applied boolean;
begin
  if to_regprocedure('public.disi_refresh_product_snapshots()') is null or to_regprocedure('public.disi_product_snapshot_drift()') is null
     or not exists (select 1 from public.signing_financial_resolutions d where d.basis = 'OTHER_REVIEWED' and d.record_status = 'ACTIVE') then
    raise exception '061: Migration 060 has not been applied';
  end if;
  select id into dodgers from public.organizations where name = m ->> 'organization_name';
  if dodgers is null then
    raise exception '061: the organization % is not present', m ->> 'organization_name';
  end if;

  -- sources: absent, or exactly the reviewed row (a source rolled back earlier stays as provenance)
  for r in select * from _m061_src order by key loop
    select * into a from public.sources where url = r.url;
    if found then
      if a.source_name is distinct from r.source_name or a.source_type is distinct from r.source_type or a.source_tier is distinct from r.source_tier
         or a.title is distinct from r.title or a.publication_date is distinct from r.publication_date or a.accessed_at is distinct from r.accessed_at
         or a.notes is distinct from r.notes then
        raise exception '061: the source % exists and is not the reviewed row; it is not overwritten', r.url;
      end if;
      src_present := src_present + 1;
    end if;
  end loop;

  -- existing CASH assets that receive an amount: exactly one, NULL (or already exactly the reviewed amount)
  for r in select * from _m061_upd order by id loop
    total := total + 1;
    select count(*) into n from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
      join public.organizations o on o.id = x.counterparty_organization_id
      where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = 'CASH' and x.asset_name = r.asset_name and o.name = r.counterparty;
    if n <> 1 then
      raise exception '061: % does not match exactly one CASH asset of % (% found)', r.id, r.event_key, n;
    end if;
    select x.cash_amount_usd into a from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
      where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = 'CASH' and x.asset_name = r.asset_name;
    is_applied := coalesce(a.cash_amount_usd = r.amount, false);
    if not is_applied and a.cash_amount_usd is not null then
      raise exception '061: % already carries the amount % and it is not overwritten', r.id, a.cash_amount_usd;
    end if;
    applied := applied + is_applied::int;
  end loop;

  -- added assets: absent, or exactly the reviewed row; the asset they sit beside is present once
  for r in select * from _m061_ins order by id loop
    total := total + 1;
    select count(*) into n from public.transaction_events e where e.event_key = r.event_key;
    if n <> 1 then
      raise exception '061: the event % is not present exactly once', r.event_key;
    end if;
    select count(*) into n from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
      where e.event_key = r.event_key and x.asset_side = r.side and x.asset_name = r.keeps_asset;
    if n <> 1 then
      raise exception '061: % needs the asset "%" of % exactly once (% found)', r.id, r.keeps_asset, r.event_key, n;
    end if;
    select x.*, o.name as cp_name, so.url as source_url into a from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
      left join public.organizations o on o.id = x.counterparty_organization_id left join public.sources so on so.id = x.source_id
      where e.event_key = r.event_key and x.asset_side = r.side and x.asset_name = r.asset_name;
    if found then
      if a.asset_type <> r.asset_type or a.cp_name is distinct from r.counterparty or a.role_note is distinct from r.role_note
         or a.source_url is distinct from (select url from _m061_src where key = r.source)
         or (r.asset_type = 'CASH' and a.cash_amount_usd is distinct from r.amount) or (r.asset_type <> 'CASH' and a.pool_space_amount_usd is distinct from r.amount) then
        raise exception '061: the asset % of % exists and is not the reviewed one', r.asset_name, r.event_key;
      end if;
      applied := applied + 1;
    else
      if r.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and exists (select 1 from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
          where e.event_key = r.event_key and x.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE') then
        raise exception '061: % already has an international bonus pool asset; a second one is not added', r.event_key;
      end if;
      if r.asset_type = 'CASH' and (select count(*) from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
          where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = 'CASH') <> 1 then
        raise exception '061: % must have exactly one CASH asset on this side before the second component', r.event_key;
      end if;
    end if;
  end loop;

  -- Garland: both events absent, or exactly the reviewed events with their one asset
  for r in select * from _m061_ev order by transaction_date loop
    total := total + 1;
    select * into a from public.transaction_events e where e.event_key = r.event_key;
    if found then
      if a.transaction_date <> r.transaction_date or a.transaction_type <> r.transaction_type or a.description is distinct from r.description
         or a.historical_label is distinct from r.historical_label or a.from_organization_id is distinct from dodgers or a.to_organization_id is not null
         or a.source_id is distinct from (select so.id from public.sources so join _m061_src s on s.url = so.url where s.key = r.source)
         or (select count(*) from public.transaction_event_assets x where x.event_id = a.id) <> 1
         or not exists (select 1 from public.transaction_event_assets x where x.event_id = a.id and x.asset_side = r.a_side and x.asset_name = r.a_name
                        and x.asset_type = r.a_type and x.bref_id = r.a_bref and x.mlb_id = r.a_mlb and x.player_id is null and x.counterparty_organization_id is null
                        and x.cash_amount_usd is null and x.pool_space_amount_usd is null) then
        raise exception '061: the event % exists and is not the reviewed one', r.event_key;
      end if;
      applied := applied + 1;
    else
      if exists (select 1 from public.transaction_events e join public.transaction_event_assets x on x.event_id = e.id
                 where x.mlb_id = r.a_mlb and (e.transaction_date = r.transaction_date or e.transaction_type = r.transaction_type and e.transaction_date between r.transaction_date - 3 and r.transaction_date + 3)) then
        raise exception '061: an equivalent event for Jon Garland on % already exists', r.transaction_date;
      end if;
    end if;
  end loop;

  -- evidence: absent, or exactly the reviewed row
  for r in select * from _m061_evd order by kind, ref, source loop
    total := total + 1;
    select e.id into eid from public.transaction_events e where e.event_key = r.event_key;
    if eid is not null then
      select ev.* into a from public.evidence ev join public.sources so on so.id = ev.source_id join _m061_src s on s.url = so.url
        where ev.entity_type = 'transaction_event' and ev.entity_id = eid and ev.field_name is not distinct from r.field_name and s.key = r.source;
      if found then
        if a.confidence::text <> r.confidence or a.evidence_note is distinct from r.note then
          raise exception '061: the evidence for % (%) exists and is not the reviewed row', r.event_key, r.field_name;
        end if;
        applied := applied + 1;
      end if;
    end if;
  end loop;

  if applied not in (0, total) then
    raise exception '061: % of the % reviewed facts are present; a partial state is refused', applied, total;
  end if;
  -- on a first run the transaction state is exactly the audited baseline
  if applied = 0 then
    if (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null) <> (m #>> '{baseline,cash_unknown}')::int
       or (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null) <> (m #>> '{baseline,pool_unknown}')::int
       or (select count(*) from public.transaction_event_assets where asset_type = 'FUTURE_CONSIDERATIONS') <> (m #>> '{baseline,future_considerations}')::int
       or (select count(*) from public.transaction_event_assets where asset_type = 'PLAYER_TO_BE_NAMED') <> (m #>> '{baseline,ptbn}')::int
       or (select count(*) from public.transaction_asset_resolutions) <> (m #>> '{baseline,resolutions}')::int then
      raise exception '061: the transaction assets are not the audited baseline';
    end if;
    if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
      raise exception '061: the product snapshots drift before 061';
    end if;
  end if;
  insert into _m061_state values (applied, total, (select max(generation_id) from public.product_executive_snapshot),
    (select count(*) from public.transaction_events), (select count(*) from public.transaction_event_assets), (select count(*) from public.sources), (select count(*) from public.evidence),
    (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null),
    (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null),
    src_present, (select count(*) from public.transaction_events e join public.transaction_event_assets x on x.event_id = e.id where x.mlb_id = (select a_mlb from _m061_ev limit 1)));
  raise notice '061 phase preconditions: done at +% (% of % facts already applied)', clock_timestamp() - now(), applied, total;
end $$;

-- inexpensive before-state: fingerprints of everything 061 must not move
create temporary table _m061_before on commit drop as
select
  (select md5(coalesce(string_agg(md5(to_jsonb(e)::text), '' order by e.id), '')) from public.transaction_events e where e.event_key <> all (k.new_keys)) as other_events,
  (select md5(coalesce(string_agg(md5(to_jsonb(a)::text), '' order by a.id), '')) from public.transaction_event_assets a
     where a.event_id not in (select id from public.transaction_events where event_key = any (k.target_keys || k.new_keys))) as other_assets,
  (select md5(coalesce(string_agg(md5(to_jsonb(a)::text), '' order by a.id), '')) from public.transaction_event_assets a
     where a.event_id in (select id from public.transaction_events where event_key = any (k.target_keys)) and a.asset_type in ('PLAYER', 'FUTURE_CONSIDERATIONS', 'PLAYER_TO_BE_NAMED')) as target_event_kept_assets,
  (select md5(coalesce(string_agg(md5(to_jsonb(r)::text), '' order by r.id), '')) from public.transaction_asset_resolutions r) as resolutions,
  (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by o.id), '')) from public.dodgers_control_observations o) as control_observations,
  (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by t.id), '')) from public.transaction_asset_timing_observations t) as timing_observations,
  (select md5(coalesce(string_agg(md5(to_jsonb(s)::text), '' order by s.id), '')) from public.sources s where s.url <> all (k.urls)) as other_sources,
  (select md5(coalesce(string_agg(md5(to_jsonb(v)::text), '' order by v.id), '')) from public.evidence v
     where v.source_id not in (select id from public.sources where url = any (k.urls))) as other_evidence,
  (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
     from public.signings s) as signings,
  (select md5(coalesce(string_agg(md5(to_jsonb(f)::text), '' order by f.id), '')) from public.signing_financial_reports f) as ledger_reports,
  (select md5(coalesce(string_agg(md5(to_jsonb(d)::text), '' order by d.id), '')) from public.signing_financial_resolutions d) as ledger_resolutions,
  (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by md5(to_jsonb(o)::text)), '')) from public.outcomes o) as outcomes,
  (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by o.id), '')) from public.player_metric_observations o) as metric_observations,
  (select md5(coalesce(string_agg(md5(to_jsonb(w)::text), '' order by w.id), '')) from public.player_mlb_team_season_war w) as team_season_war,
  (select count(*) from public.players) as players
from _m061_keys k;

-- ===========================================================================
-- 2. THE REVIEWED FACTS
-- ===========================================================================

create temporary table _m061_changed (kind text) on commit drop;

do $$
declare
  m jsonb := (select j from _m061);
  r record;
  dodgers uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m061));
  eid uuid;
  n int;
begin
  -- sources: the real pages that were read
  for r in select * from _m061_src order by key loop
    if not exists (select 1 from public.sources where url = r.url) then
      insert into public.sources (source_name, source_type, title, url, publication_date, accessed_at, notes, source_tier)
      values (r.source_name, r.source_type, r.title, r.url, r.publication_date, r.accessed_at, r.notes, r.source_tier);
      insert into _m061_changed values ('source');
    end if;
  end loop;

  -- the six existing CASH assets: NULL -> the reported amount, nothing else on the row
  for r in select * from _m061_upd order by id loop
    update public.transaction_event_assets x set cash_amount_usd = r.amount
    from public.transaction_events e
    where e.id = x.event_id and e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = 'CASH' and x.asset_name = r.asset_name and x.cash_amount_usd is null;
    get diagnostics n = row_count;
    if n = 1 then insert into _m061_changed values ('amount'); end if;
  end loop;

  -- the three added assets
  for r in select * from _m061_ins order by id loop
    if not exists (select 1 from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
                   where e.event_key = r.event_key and x.asset_side = r.side and x.asset_name = r.asset_name) then
      insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, role_note, source_id, counterparty_organization_id, cash_amount_usd, pool_space_amount_usd)
      select e.id, r.side, r.asset_name, r.asset_type, r.role_note, (select so.id from public.sources so join _m061_src s on s.url = so.url where s.key = r.source),
             (select o.id from public.organizations o where o.name = r.counterparty),
             case when r.asset_type = 'CASH' then r.amount end, case when r.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' then r.amount end
      from public.transaction_events e where e.event_key = r.event_key;
      insert into _m061_changed values ('asset');
    end if;
  end loop;

  -- the two Garland events and their one PLAYER asset each
  for r in select * from _m061_ev order by transaction_date loop
    if not exists (select 1 from public.transaction_events where event_key = r.event_key) then
      insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description, source_id, historical_label)
      values (r.event_key, r.transaction_date, r.transaction_type, dodgers, null, r.description,
              (select so.id from public.sources so join _m061_src s on s.url = so.url where s.key = r.source), r.historical_label)
      returning id into eid;
      insert into public.transaction_event_assets (event_id, asset_side, asset_name, asset_type, source_id, bref_id, mlb_id)
      values (eid, r.a_side, r.a_name, r.a_type, (select so.id from public.sources so join _m061_src s on s.url = so.url where s.key = r.source), r.a_bref, r.a_mlb);
      insert into _m061_changed values ('event');
    end if;
  end loop;

  -- evidence: one row per fact and source
  for r in select * from _m061_evd order by kind, ref, source loop
    select e.id into eid from public.transaction_events e where e.event_key = r.event_key;
    if not exists (select 1 from public.evidence ev join public.sources so on so.id = ev.source_id join _m061_src s on s.url = so.url
                   where ev.entity_type = 'transaction_event' and ev.entity_id = eid and ev.field_name is not distinct from r.field_name and s.key = r.source) then
      insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
      values ('transaction_event', eid, r.field_name, (select so.id from public.sources so join _m061_src s on s.url = so.url where s.key = r.source),
              r.confidence::public.confidence_level, r.note);
      insert into _m061_changed values ('evidence');
    end if;
  end loop;
  raise notice '061 phase facts: done at +% (% written)', clock_timestamp() - now(), (select count(*) from _m061_changed where kind <> 'source');
end $$;

-- ===========================================================================
-- 3. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  m jsonb := (select j from _m061);
  st record;
  bf record;
  r record;
  ra record;
  first_run boolean;
  n int;
  dodgers uuid := (select id from public.organizations where name = (select j ->> 'organization_name' from _m061));
begin
  select * into st from _m061_state;
  select * into bf from _m061_before;
  first_run := st.applied = 0;

  -- every reviewed fact is present exactly
  for r in select * from _m061_upd order by id loop
    if (select count(*) from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
        join public.organizations o on o.id = x.counterparty_organization_id
        where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = 'CASH' and x.asset_name = r.asset_name and o.name = r.counterparty
          and x.cash_amount_usd = r.amount and x.pool_space_amount_usd is null) <> 1 then
      raise exception '061 postcondition: % must carry exactly %', r.id, r.amount;
    end if;
  end loop;
  for r in select * from _m061_ins order by id loop
    if (select count(*) from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
        join public.organizations o on o.id = x.counterparty_organization_id join public.sources so on so.id = x.source_id join _m061_src s on s.url = so.url and s.key = r.source
        where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = r.asset_type and x.asset_name = r.asset_name and o.name = r.counterparty
          and x.role_note = r.role_note and x.player_id is null
          and x.cash_amount_usd is not distinct from (case when r.asset_type = 'CASH' then r.amount end)
          and x.pool_space_amount_usd is not distinct from (case when r.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' then r.amount end)) <> 1 then
      raise exception '061 postcondition: the added asset % of % is not exactly the reviewed one', r.asset_name, r.event_key;
    end if;
    -- the asset it sits beside is untouched and still present
    if (select count(*) from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
        where e.event_key = r.event_key and x.asset_side = r.side and x.asset_name = r.keeps_asset) <> 1 then
      raise exception '061 postcondition: the asset "%" of % was not kept', r.keeps_asset, r.event_key;
    end if;
  end loop;
  for r in select * from _m061_ev order by transaction_date loop
    select e.* into ra from public.transaction_events e where e.event_key = r.event_key;
    if not found or ra.transaction_date <> r.transaction_date or ra.transaction_type <> r.transaction_type or ra.from_organization_id is distinct from dodgers
       or ra.to_organization_id is not null or (select count(*) from public.transaction_event_assets x where x.event_id = ra.id) <> 1
       or not exists (select 1 from public.transaction_event_assets x where x.event_id = ra.id and x.asset_side = r.a_side and x.asset_name = r.a_name and x.asset_type = r.a_type
                      and x.bref_id = r.a_bref and x.mlb_id = r.a_mlb) then
      raise exception '061 postcondition: the Garland event % is not exactly the reviewed one', r.event_key;
    end if;
  end loop;
  if (select min(e.transaction_date) filter (where e.transaction_type = 'FREE_AGENCY') from public.transaction_events e where e.event_key in (select event_key from _m061_ev))
     <= (select min(e.transaction_date) filter (where e.transaction_type = 'FREE_AGENT_SIGNING') from public.transaction_events e where e.event_key in (select event_key from _m061_ev)) then
    raise exception '061 postcondition: Garland''s exit must follow his signing';
  end if;
  for r in select * from _m061_evd order by kind, ref, source loop
    if (select count(*) from public.evidence ev join public.transaction_events e on e.id = ev.entity_id join public.sources so on so.id = ev.source_id join _m061_src s on s.url = so.url
        where ev.entity_type = 'transaction_event' and e.event_key = r.event_key and ev.field_name is not distinct from r.field_name and s.key = r.source
          and ev.confidence::text = r.confidence and ev.evidence_note = r.note) <> 1 then
      raise exception '061 postcondition: the evidence for % (%, %) is not present exactly once', r.event_key, r.field_name, r.source;
    end if;
  end loop;

  -- KNOWN != AMOUNT: no zero is inferred, and the Cingrani pool amount is NULL (250,000 is never inferred)
  if exists (select 1 from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
             where e.event_key in (select event_key from _m061_upd union select event_key from _m061_ins) and (x.cash_amount_usd = 0 or x.pool_space_amount_usd = 0)) then
    raise exception '061 postcondition: a zero amount was written';
  end if;
  if exists (select 1 from public.transaction_event_assets x where x.pool_space_amount_usd = 250000) then
    raise exception '061 postcondition: an unsourced 250000 pool-space amount exists';
  end if;
  if (select count(*) from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
      where e.event_key = 'LAD_STL_2019_TONY_CINGRANI' and x.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and x.pool_space_amount_usd is null) <> 1 then
    raise exception '061 postcondition: the Cingrani pool-space component must exist once with an unknown (NULL) amount';
  end if;

  -- row counts: +2 events, +5 assets, +17 evidence, the sources that were absent, and the unknown-amount counts
  if (select count(*) from public.transaction_events) <> st.events + (case when first_run then (m #>> '{delta,events}')::int else 0 end)
     or (select count(*) from public.transaction_event_assets) <> st.assets + (case when first_run then (m #>> '{delta,assets}')::int else 0 end)
     or (select count(*) from public.evidence) <> st.evidence + (case when first_run then (m #>> '{delta,evidence}')::int else 0 end)
     or (select count(*) from public.sources) <> st.sources + (select count(*) from _m061_changed where kind = 'source')
     or (select count(*) from public.sources) <> st.sources + (jsonb_array_length(m -> 'sources') - st.src_present)
     or (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null) <> st.cash_unknown + (case when first_run then (m #>> '{delta,cash_unknown}')::int else 0 end)
     or (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null) <> st.pool_unknown + (case when first_run then (m #>> '{delta,pool_unknown}')::int else 0 end)
     or (select count(*) from public.transaction_events e join public.transaction_event_assets x on x.event_id = e.id where x.mlb_id = (select a_mlb from _m061_ev limit 1)) <> st.garland_events + (case when first_run then 2 else 0 end) then
    raise exception '061 postcondition: the transaction row counts are not the reviewed ones';
  end if;
  if first_run and ((select count(*) from _m061_changed where kind <> 'source') <> st.total) then
    raise exception '061 postcondition: a first run must record exactly % facts (recorded %)', st.total, (select count(*) from _m061_changed where kind <> 'source');
  end if;
  if not first_run and exists (select 1 from _m061_changed) then
    raise exception '061 postcondition: a rerun changed a value';
  end if;

  -- nothing else moved
  if (select md5(coalesce(string_agg(md5(to_jsonb(e)::text), '' order by e.id), '')) from public.transaction_events e where e.event_key <> all ((select new_keys from _m061_keys)::text[])) <> bf.other_events
     or (select md5(coalesce(string_agg(md5(to_jsonb(ax)::text), '' order by ax.id), '')) from public.transaction_event_assets ax
         where ax.event_id not in (select id from public.transaction_events where event_key = any ((select target_keys || new_keys from _m061_keys)::text[]))) <> bf.other_assets
     or (select md5(coalesce(string_agg(md5(to_jsonb(ax)::text), '' order by ax.id), '')) from public.transaction_event_assets ax
         where ax.event_id in (select id from public.transaction_events where event_key = any ((select target_keys from _m061_keys)::text[]))
           and ax.asset_type in ('PLAYER', 'FUTURE_CONSIDERATIONS', 'PLAYER_TO_BE_NAMED')) <> bf.target_event_kept_assets
     or (select md5(coalesce(string_agg(md5(to_jsonb(rs)::text), '' order by rs.id), '')) from public.transaction_asset_resolutions rs) <> bf.resolutions
     or (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by o.id), '')) from public.dodgers_control_observations o) <> bf.control_observations
     or (select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by t.id), '')) from public.transaction_asset_timing_observations t) <> bf.timing_observations
     or (select md5(coalesce(string_agg(md5(to_jsonb(s)::text), '' order by s.id), '')) from public.sources s where s.url <> all ((select urls from _m061_keys)::text[])) <> bf.other_sources
     or (select md5(coalesce(string_agg(md5(to_jsonb(v)::text), '' order by v.id), '')) from public.evidence v
         where v.source_id not in (select id from public.sources where url = any ((select urls from _m061_keys)::text[]))) <> bf.other_evidence then
    raise exception '061 postcondition: a transaction row, resolution, observation, source or evidence row outside the reviewed facts changed';
  end if;
  if (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
      from public.signings s) <> bf.signings
     or (select md5(coalesce(string_agg(md5(to_jsonb(f)::text), '' order by f.id), '')) from public.signing_financial_reports f) <> bf.ledger_reports
     or (select md5(coalesce(string_agg(md5(to_jsonb(d)::text), '' order by d.id), '')) from public.signing_financial_resolutions d) <> bf.ledger_resolutions
     or (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by md5(to_jsonb(o)::text)), '')) from public.outcomes o) <> bf.outcomes
     or (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by o.id), '')) from public.player_metric_observations o) <> bf.metric_observations
     or (select md5(coalesce(string_agg(md5(to_jsonb(w)::text), '' order by w.id), '')) from public.player_mlb_team_season_war w) <> bf.team_season_war
     or (select count(*) from public.players) <> bf.players then
    raise exception '061 postcondition: a signing, ledger, outcome, metric, WAR or player fact changed';
  end if;
  raise notice '061 phase postconditions: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 4. GENERATION: one coherent refresh, only if the snapshots drift
-- ===========================================================================

do $$
declare
  st record;
  tn text;
  g bigint[];
  want bigint;
  refreshed boolean := false;
begin
  select * into st from _m061_state;
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    perform * from public.disi_refresh_product_snapshots();
    refreshed := true;
  end if;
  want := st.generation + refreshed::int;
  if (select max(generation_id) from public.product_executive_snapshot) <> want
     or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception '061 postcondition: expected one drift-free generation % (a refresh only when the snapshots drift)', want;
  end if;
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'product\_%' order by 1 loop
    execute format('select array_agg(distinct generation_id) from public.%I', tn) into g;
    if g is distinct from array[want] then
      raise exception '061 postcondition: snapshot % is not at the single generation %', tn, want;
    end if;
  end loop;
  raise notice '061 phase snapshots: done at +% (generation %, refreshed %)', clock_timestamp() - now(), want, refreshed;
end $$;

commit;
