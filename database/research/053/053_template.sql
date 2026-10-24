-- DISI v0.38
-- 053_transaction_chronology_resolution.sql
-- A reviewed transaction and chronology research batch. Run after 052.
--
-- Built from database/research/053/ (migration-values.json, build.mjs). Do not edit by hand: change the research and rebuild.
--
-- What this is. A research-data migration with one detector correction. It adds no table, function, grant or policy, changes no outcome audit,
-- no acquisition cost, no WAR row and no development stint, milestone or progression decision, and values nothing.
--   TEAM CHANGE != CANONICAL TRANSACTION   ORGANIZATION CHANGE != TRANSACTION TYPE   KNOWN DESTINATION != KNOWN TRANSACTION MECHANISM
--   KNOWN EXIT DATE != KNOWN RETURN   WAIVER CLAIM != TRADE   FREE-AGENT SIGNING != TRADE RETURN   CONTRACT PURCHASE != TRADE WITHOUT EVIDENCE
--   SOURCE SILENCE != RELEASE   UNKNOWN AMOUNT != ZERO   MISSING BWAR != ZERO BWAR
--   * Ten Dodgers transactions the official MLB transaction log or the Retrosheet transaction database states and DISI lacked: the 2022
--     re-signing of Pedro Baez; Chan Ho Park's 2008 signing and free agency; Jose Vizcaino's 1997 re-signing and his 2000 trade to the Yankees for
--     Jim Leyritz (with cash of unstated amount), and Leyritz's free agency; Omar Daal's 2001 re-acquisition from the Phillies and his 2002 free
--     agency; Juan Castro's 2010 signing and free agency. Each identity is matched across the Chadwick Register, the official person record and
--     BIOFILE by an exact birth date. Where the two sources give different dates, the official log is used and the other date is kept in the
--     description. Every event cites a source DISI already holds; 053 adds no source.
--   * The development research queue reads a canonical transaction in the player's own direction and recognizes the Dodgers end of a move (a
--     release or free agency before the other club's first game, a free-agent signing after the other club's last game). A move between two
--     other clubs is not a Dodgers transaction and is never recorded here.
--   * Not recorded, on purpose: Juan Castro's 2000 trade to Cincinnati, 2009 and December 2010 signings and 2011 retirement (stated by the sources,
--     but recording the trade's return needs a sealed control observation, which no rollback can remove), every cash amount, and every move
--     between two other clubs.
-- Jim Leyritz's Dodgers bWAR is NOT loaded (the Baseball-Reference WAR files answer 403): his return stays RETURN_WAR_UNKNOWN.
-- It then runs the explicit snapshot refresh once, only when this run changed a transaction row.
--
-- Rerunnable: every statement is idempotent; the refresh runs only when a row was added.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m053 on commit drop as
select $m053${{payload_json}}$m053$::jsonb as j;

create temporary table _m053_before on commit drop as
select
  (select count(*) from public.transaction_events) as events,
  (select count(*) from public.transaction_event_assets) as assets,
  (select count(*) from public.transaction_asset_resolutions) as resolutions,
  (select count(*) from public.dodgers_control_observations) as observations,
  (select count(*) from public.sources) as sources,
  (select md5(string_agg(t::text, '|' order by t.id::text)) from (
     select e.id, e::text from public.transaction_events e union all select a.id, a::text from public.transaction_event_assets a
     union all select r.id, r::text from public.transaction_asset_resolutions r ) t(id, t)) as transactions_hash,
  (select md5(string_agg(e::text, '|' order by e.event_key)) from public.transaction_events e
    where e.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y)) as other_events_hash,
  (select md5(string_agg(a::text, '|' order by a.id::text)) from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
    where e.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y)) as other_assets_hash,
  (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) as war_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t) as stints_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t) as milestones_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t) as decisions_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t) as audits_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from (select r::text from public.signing_financial_reports r union all select s::text from public.signing_financial_resolutions s) t(t)) as costs_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.transactions t) as legacy_hash
from _m053;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 053 was written for
-- ===========================================================================

do $$
declare
  p jsonb;
  a jsonb;
  n int;
  k text;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception '053: Migration 045b has not been applied';
  end if;
  -- the 052 view is the first to read transaction_events (pg_get_viewdef drops comments); the 053 view also reads asset_side
  if position('transaction_events' in pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) = 0 then
    raise exception '053: Migration 052 has not been applied';
  end if;
  for k in select unnest(array['LAD', 'NYY', 'PHI', 'CIN']) loop
    if not exists (select 1 from public.organizations where abbreviation = k) then
      raise exception '053: the organization % is missing', k;
    end if;
  end loop;
  for k in select jsonb_array_elements_text(j -> 'existing_source_urls') from _m053 loop
    if not exists (select 1 from public.sources where url = k) then
      raise exception '053: the source % is missing', k;
    end if;
  end loop;
  -- the existing events the research reads are present (053 changes none of them)
  for k in select jsonb_array_elements_text(j -> 'existing_events') from _m053 loop
    if (select count(*) from public.transaction_events where event_key = k) <> 1 then
      raise exception '053: the event % is not in the state the research was written for', k;
    end if;
  end loop;
  -- every tracked player is the DISI player with the reviewed MLB id; no event key is taken by anything else
  for p in select y from _m053, jsonb_array_elements(j -> 'events') y loop
    for a in select x from jsonb_array_elements(p -> 'assets') x where x ->> 'player_slug' <> '' loop
      if (select count(*) from public.players pl where pl.slug = a ->> 'player_slug' and pl.mlb_id::text = a ->> 'mlb_id') <> 1 then
        raise exception '053: % is not the DISI player with MLB id %', a ->> 'player_slug', a ->> 'mlb_id';
      end if;
    end loop;
    select count(*) into n from public.transaction_events e
      where e.event_key = p ->> 'key' and (e.transaction_date <> (p ->> 'date')::date or e.transaction_type <> p ->> 'type');
    if n > 0 then
      raise exception '053: the event key % already holds a different transaction', p ->> 'key';
    end if;
    -- the transaction is not already recorded under another key (same player, date and type)
    select count(*) into n from public.transaction_events e join public.transaction_event_assets x on x.event_id = e.id
      where e.event_key <> p ->> 'key' and e.transaction_date = (p ->> 'date')::date and e.transaction_type = p ->> 'type'
        and x.mlb_id in (select y ->> 'mlb_id' from jsonb_array_elements(p -> 'assets') y where y ->> 'mlb_id' <> '');
    if n > 0 then
      raise exception '053: the transaction % is already recorded under another key', p ->> 'key';
    end if;
  end loop;
  -- the returned and outgoing non-DISI players are not recorded in any other transaction
  select count(*) into n from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id, _m053
    where x.player_id is null and x.mlb_id in (select y ->> 'mlb_id' from jsonb_array_elements(j -> 'events') v, jsonb_array_elements(v -> 'assets') y where y ->> 'player_slug' = '' and y ->> 'mlb_id' <> '')
      and e.event_key not in (select v ->> 'key' from jsonb_array_elements(j -> 'events') v);
  if n > 0 then
    raise exception '053: a reviewed non-DISI player is already recorded in another transaction';
  end if;
end $$;

-- ===========================================================================
-- 2. TRANSACTIONS (Dodgers transactions only; a recorded trade does not wait for its value)
-- ===========================================================================

insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description, source_id,
  is_multi_team, historical_label)
select x ->> 'key', (x ->> 'date')::date, x ->> 'type', fo.id, too.id, x ->> 'description', so.id, false, nullif(x ->> 'historical_label', '')
from _m053 cross join jsonb_array_elements(j -> 'events') x
join public.organizations fo on fo.abbreviation = x ->> 'from'
left join public.organizations too on too.abbreviation = nullif(x ->> 'to', '')
join public.sources so on so.url = x ->> 'source_url'
on conflict (event_key) do nothing;

insert into public.transaction_event_assets (event_id, asset_side, player_id, asset_name, asset_type, role_note, source_id, bref_id, mlb_id, bref_register_id,
  counterparty_organization_id, cash_amount_usd, pool_space_amount_usd)
select e.id, a ->> 'side', pl.id, a ->> 'name', a ->> 'type', nullif(a ->> 'role_note', ''), so.id, nullif(a ->> 'bref_id', ''), nullif(a ->> 'mlb_id', ''),
  nullif(a ->> 'bref_register_id', ''), (select o.id from public.organizations o where o.abbreviation = nullif(a ->> 'counterparty', '')), null, null
from _m053 cross join jsonb_array_elements(j -> 'events') x cross join jsonb_array_elements(x -> 'assets') a
join public.transaction_events e on e.event_key = x ->> 'key'
join public.sources so on so.url = x ->> 'source_url'
left join public.players pl on pl.slug = nullif(a ->> 'player_slug', '')
on conflict (event_id, asset_side, asset_name) do nothing;

-- ===========================================================================
-- 3. RESEARCH QUEUE: the 052 view with the MULTI_ORG_SEASON_UNVERIFIED condition read in the player's direction
-- ===========================================================================

{{queue_view_053}}

-- ===========================================================================
-- 4. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  rec jsonb;
  n int;
  b record;
begin
  select * into b from _m053_before;
  -- every reviewed event exists once with the reviewed date, type, counterparty and assets
  for rec in select y from _m053, jsonb_array_elements(j -> 'events') y loop
    select count(*) into n from public.transaction_events e
      left join public.organizations too on too.id = e.to_organization_id
      where e.event_key = rec ->> 'key' and e.transaction_date = (rec ->> 'date')::date and e.transaction_type = rec ->> 'type'
        and coalesce(too.abbreviation, '') = rec ->> 'to'
        and (select count(*) from public.transaction_event_assets a where a.event_id = e.id) = jsonb_array_length(rec -> 'assets');
    if n <> 1 then
      raise exception '053 postcondition: the event % is not recorded exactly as reviewed', rec ->> 'key';
    end if;
  end loop;
  -- a tracked asset is linked to its DISI player; no amount was invented
  select count(*) into n from _m053, jsonb_array_elements(j -> 'events') v, jsonb_array_elements(v -> 'assets') y
    where y ->> 'player_slug' <> '' and not exists (select 1 from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id
      join public.players pl on pl.id = a.player_id where e.event_key = v ->> 'key' and pl.slug = y ->> 'player_slug' and a.asset_side = y ->> 'side');
  if n > 0 then
    raise exception '053 postcondition: % tracked assets are not linked to their player', n;
  end if;
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _m053
    where e.event_key in (select v ->> 'key' from jsonb_array_elements(j -> 'events') v) and (a.cash_amount_usd is not null or a.pool_space_amount_usd is not null);
  if n > 0 then
    raise exception '053 postcondition: an amount was recorded; 053 records none';
  end if;
  -- nothing else changed: no other event or asset, no control observation, resolution, source, WAR, development, outcome, cost or legacy row
  if b.other_events_hash is distinct from (select md5(string_agg(e::text, '|' order by e.event_key)) from public.transaction_events e
      where e.event_key not in (select y ->> 'key' from _m053, jsonb_array_elements(j -> 'events') y)) then
    raise exception '053 postcondition: an event outside the reviewed set changed';
  end if;
  if b.other_assets_hash is distinct from (select md5(string_agg(a::text, '|' order by a.id::text)) from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
      where e.event_key not in (select y ->> 'key' from _m053, jsonb_array_elements(j -> 'events') y)) then
    raise exception '053 postcondition: an asset outside the reviewed events changed';
  end if;
  if b.war_hash is distinct from (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) then
    raise exception '053 postcondition: a WAR row changed; 053 loads no Baseball-Reference WAR';
  end if;
  if b.stints_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t)
     or b.milestones_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t)
     or b.decisions_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t) then
    raise exception '053 postcondition: a development row changed; a transaction never creates a stint, a milestone or a decision';
  end if;
  if b.audits_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t)
     or b.costs_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from (select r::text from public.signing_financial_reports r union all select s::text from public.signing_financial_resolutions s) t(t))
     or b.legacy_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.transactions t) then
    raise exception '053 postcondition: an outcome audit, an acquisition cost or a legacy transaction changed';
  end if;
  select (select count(*) from public.transaction_events) - b.events into n;
  if n > (select jsonb_array_length(j -> 'events') from _m053) then
    raise exception '053 postcondition: % events were added, at most % were reviewed', n, (select jsonb_array_length(j -> 'events') from _m053);
  end if;
  select (select count(*) from public.transaction_event_assets) - b.assets into n;
  if n > (select sum(jsonb_array_length(y -> 'assets')) from _m053, jsonb_array_elements(j -> 'events') y) then
    raise exception '053 postcondition: % assets were added, more than were reviewed', n;
  end if;
  if (select count(*) from public.transaction_asset_resolutions) <> b.resolutions or (select count(*) from public.dodgers_control_observations) <> b.observations
     or (select count(*) from public.sources) <> b.sources then
    raise exception '053 postcondition: a resolution, a control observation or a source was added; 053 adds none';
  end if;
end $$;

-- ===========================================================================
-- 5. GENERATION: one coherent refresh, only when this run added a transaction row
-- ===========================================================================

do $$
declare
  b record;
begin
  select * into b from _m053_before;
  if b.transactions_hash is distinct from (select md5(string_agg(t::text, '|' order by t.id::text)) from (
       select e.id, e::text from public.transaction_events e union all select a.id, a::text from public.transaction_event_assets a
       union all select r.id, r::text from public.transaction_asset_resolutions r) t(id, t)) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

commit;
