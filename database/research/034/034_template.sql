-- DISI v0.25
-- 034_downstream_organizational_value_chains.sql
-- Downstream organizational value chains: how organizational value continues beyond the first trade hop, with strict
-- package attribution, bounded Dodgers control intervals and no double-counting. Run after 033.
--
-- Built from database/research/034/ (exit-seed.json, timing-seed.json, war-seed.json, scope-config.json, audit.mjs, build.mjs).
--
-- What this is. Source-backed facts (the later exits of first-hop return assets, chronology facts, return-asset
-- team-season bWAR) and derived views. The factual transaction graph is not stored twice: lineage is derived by a
-- cycle-safe recursive traversal of canonical transaction events and assets; there is no edge table.
--
-- What it does:
--   * Extends transaction_events.transaction_type with FREE_AGENT_SIGNING (a re-signing starts a new control interval).
--   * Adds transaction_asset_timing_observations (sealed, append-only chronology facts: first / last Dodgers appearance,
--     season start after acquisition, exit bounded before a date). Distinct from dodgers_control_observations, which
--     states a bounded state through a date.
--   * Backfills the researched exit events of first-hop return assets and the second-round exits visible on the same
--     sources, their assets and stable identities, three placeholder resolutions, asset observations and timing facts.
--   * Loads Baseball-Reference team-season bWAR (same two data files and checksums as 032 / 033) for the newly surfaced
--     downstream PLAYER assets.
--   * Adds v_player_control_intervals, v_transaction_asset_lineage, v_transaction_package_lineage and
--     v_downstream_organizational_realization, and amends v_dodgers_international_value_portfolio,
--     v_value_research_queue and v_transaction_research_queue additively. The 032 / 033 first-hop columns are preserved.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/034/)
-- ===========================================================================

create temporary table _m034 on commit drop as
select $m034${{payload_json}}$m034$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
begin
  if to_regclass('public.dodgers_control_observations') is null or to_regclass('public.v_transaction_asset_chain_readiness') is null
     or to_regclass('public.v_transaction_research_queue') is null then
    raise exception '034: Migration 033 has not been applied';
  end if;
  for p in select distinct x from _m034, jsonb_array_elements(j -> 'organizations') x loop
    if not exists (select 1 from public.organizations where abbreviation = p #>> '{}') then
      raise exception '034: organization % does not exist', p #>> '{}';
    end if;
  end loop;
  for p in select x from _m034, jsonb_array_elements(j -> 'war' -> 'source_urls') x loop
    if not exists (select 1 from public.sources where url = p #>> '{}') then
      raise exception '034: the Baseball-Reference data file source % is not registered', p #>> '{}';
    end if;
  end loop;
  -- the transaction layer holds exactly the 161 events of Migration 033 plus, on a rerun, the reviewed events of this migration
  select count(*) into n from public.transaction_events e
  where not exists (select 1 from _m034, jsonb_array_elements(j -> 'events') x where x ->> 'key' = e.event_key);
  if n <> (select (j ->> 'expected_prior_events')::int from _m034) then
    raise exception '034: % pre-existing transaction events found, % expected from Migration 033', n, (select j ->> 'expected_prior_events' from _m034);
  end if;
  -- every pre-existing asset the reviewed data refers to exists
  for p in
    select x from (
      select o -> 'asset' as x from _m034, jsonb_array_elements(j -> 'asset_observations') o
      union all select t -> 'asset' from _m034, jsonb_array_elements(j -> 'timing') t
    ) q
    where not exists (select 1 from _m034, jsonb_array_elements(j -> 'events') e where e ->> 'key' = x ->> 'event')
  loop
    if not exists (select 1 from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
                   where e.event_key = p ->> 'event' and a.asset_side = p ->> 'side' and a.asset_name = p ->> 'name') then
      raise exception '034: expected existing asset % (%) was not found', p ->> 'name', p ->> 'event';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2. SCHEMA
-- ===========================================================================

alter table public.transaction_events drop constraint if exists transaction_events_transaction_type_check;
alter table public.transaction_events add constraint transaction_events_transaction_type_check
  check (transaction_type in ('TRADE', 'RELEASE', 'WAIVER', 'SALE', 'OTHER', 'RULE5_SELECTION', 'FREE_AGENCY', 'EXPANSION_DRAFT', 'FREE_AGENT_SIGNING'));

comment on column public.transaction_events.transaction_type is
  'Normalized mechanism. TRADE, RELEASE, WAIVER, SALE, RULE5_SELECTION, FREE_AGENCY and EXPANSION_DRAFT can end Dodgers control; FREE_AGENT_SIGNING begins a new control interval (a re-signing after free agency is never the return of an earlier trade). OTHER is unused.';

-- ---------------------------------------------------------------------------
-- transaction_asset_timing_observations: sourced chronology facts about one acquired asset's control interval
-- ---------------------------------------------------------------------------

create table if not exists public.transaction_asset_timing_observations (
  id uuid primary key default gen_random_uuid(),
  subject_asset_id uuid not null references public.transaction_event_assets(id) on delete restrict,
  event_id uuid not null references public.transaction_events(id) on delete restrict,
  fact_type text not null check (fact_type in
    ('FIRST_DODGERS_APPEARANCE', 'LAST_DODGERS_APPEARANCE', 'SEASON_START_CONFIRMS_POST_ACQUISITION', 'EXIT_BOUNDED_BEFORE')),
  season int check (season is null or season between 1871 and 2100),
  observed_date date not null,
  source_id uuid not null references public.sources(id) on delete restrict,
  confidence public.confidence_level not null,
  note text check (note is null or char_length(note) <= 400),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  constraint transaction_asset_timing_observations_shape_check check (
    (fact_type = 'EXIT_BOUNDED_BEFORE' and season is null)
    or (fact_type <> 'EXIT_BOUNDED_BEFORE' and season is not null and extract(year from observed_date)::int = season)),
  constraint transaction_asset_timing_observations_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
create unique index if not exists transaction_asset_timing_observations_active_key
  on public.transaction_asset_timing_observations (subject_asset_id, fact_type, coalesce(season, 0)) where record_status = 'ACTIVE';
create index if not exists transaction_asset_timing_observations_event_idx on public.transaction_asset_timing_observations (event_id);

comment on table public.transaction_asset_timing_observations is
  'Sealed, append-only chronology facts attached to an incoming PLAYER asset (the start of a Dodgers control interval): FIRST_DODGERS_APPEARANCE and SEASON_START_CONFIRMS_POST_ACQUISITION place a same-season Dodgers stint after the acquisition, LAST_DODGERS_APPEARANCE places it before the exit, EXIT_BOUNDED_BEFORE says control had ended on or before a date when the exit transaction itself is not recorded. Each is a point-in-time fact with its source; it never states a bounded state (that is dodgers_control_observations). Only retraction of an ACTIVE row is allowed.';
comment on column public.transaction_asset_timing_observations.fact_type is
  'FIRST_DODGERS_APPEARANCE: first Dodgers game on or after the acquisition (season required). LAST_DODGERS_APPEARANCE: last Dodgers game of the interval. SEASON_START_CONFIRMS_POST_ACQUISITION: the team opened its season (observed_date) after the acquisition date, so every Dodgers game of that season is post-acquisition. EXIT_BOUNDED_BEFORE: Dodgers control ended on or before observed_date (no season).';

create or replace function public.disi_timing_observation_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.transaction_event_assets%rowtype;
  ev_date date;
begin
  if tg_op = 'DELETE' then
    raise exception 'transaction timing observations are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED transaction timing observation is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE transaction timing observation is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new transaction timing observation starts ACTIVE' using errcode = '55000';
  end if;
  select * into a from public.transaction_event_assets where id = new.subject_asset_id;
  if not found or a.asset_type <> 'PLAYER' or a.asset_side <> 'INCOMING' then
    raise exception 'a timing observation must concern an incoming PLAYER asset (%)', new.subject_asset_id using errcode = '55000';
  end if;
  if new.event_id <> a.event_id then
    raise exception 'the observation event must be the acquisition event of its asset (%)', new.subject_asset_id using errcode = '55000';
  end if;
  select e.transaction_date into ev_date from public.transaction_events e where e.id = a.event_id;
  if new.observed_date < ev_date then
    raise exception 'a timing observation cannot predate the acquisition it concerns (%)', new.subject_asset_id using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_timing_observation_guard() from public, anon, authenticated;

drop trigger if exists transaction_asset_timing_observations_guard on public.transaction_asset_timing_observations;
create trigger transaction_asset_timing_observations_guard
before insert or update or delete on public.transaction_asset_timing_observations
for each row execute function public.disi_timing_observation_guard();

do $$
declare t text := 'transaction_asset_timing_observations';
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on table public.%I from anon, authenticated', t);
  execute format('grant select on table public.%I to anon, authenticated', t);
  execute format('drop policy if exists public_read_%I on public.%I', t, t);
  execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
end $$;

-- ===========================================================================
-- 3. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (j ->> 'retrieved_at')::timestamptz
from _m034, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 4. TRANSACTION EVENTS AND ASSETS
-- ===========================================================================

insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description, source_id,
  is_multi_team, historical_label)
select x ->> 'key', (x ->> 'date')::date, x ->> 'type', fo.id, tobj.id, x ->> 'description', so.id, (x ->> 'multi')::boolean, nullif(x ->> 'label', '')
from _m034, jsonb_array_elements(j -> 'events') x
left join public.organizations fo on fo.abbreviation = x ->> 'from'
left join public.organizations tobj on tobj.abbreviation = x ->> 'to'
left join public.sources so on so.url = x ->> 'source_url'
on conflict (event_key) do nothing;

insert into public.transaction_event_assets (event_id, asset_side, player_id, asset_name, asset_type, role_note, source_id, bref_id, mlb_id, bref_register_id,
  counterparty_organization_id, cash_amount_usd, pool_space_amount_usd)
select e.id, a ->> 'side', null, a ->> 'name', a ->> 'type', nullif(a ->> 'note', ''), e.source_id, nullif(a ->> 'bref_id', ''),
       nullif(a ->> 'mlb_id', ''), nullif(a ->> 'register_id', ''), co.id, (a ->> 'cash')::numeric, (a ->> 'pool')::numeric
from _m034 cross join jsonb_array_elements(j -> 'events') x cross join jsonb_array_elements(x -> 'assets') a
join public.transaction_events e on e.event_key = x ->> 'key'
left join public.organizations co on co.abbreviation = a ->> 'cp'
on conflict (event_id, asset_side, asset_name) do nothing;

-- ===========================================================================
-- 5. PLACEHOLDER RESOLUTIONS, CONTROL OBSERVATIONS AND TIMING FACTS
-- ===========================================================================

insert into public.transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence, notes)
select ph.id, rs.id, 'NAMED_PLAYER', (r ->> 'date')::date, so.id, (r ->> 'confidence')::public.confidence_level, r ->> 'note'
from _m034 cross join jsonb_array_elements(j -> 'resolutions') r
join public.transaction_events e on e.event_key = r ->> 'event'
join public.transaction_event_assets ph on ph.event_id = e.id and ph.asset_side = r #>> '{placeholder,0}' and ph.asset_name = r #>> '{placeholder,1}'
join public.transaction_event_assets rs on rs.event_id = e.id and rs.asset_side = r #>> '{resolved,0}' and rs.asset_name = r #>> '{resolved,1}'
join public.sources so on so.url = r ->> 'source_url'
where not exists (select 1 from public.transaction_asset_resolutions x where x.placeholder_asset_id = ph.id and x.record_status = 'ACTIVE');

insert into public.dodgers_control_observations (subject_asset_id, observation_type, observed_through_date, source_id, confidence, note)
select a.id, o ->> 'type', (o ->> 'observed_through')::date, so.id, (o ->> 'confidence')::public.confidence_level, o ->> 'note'
from _m034 cross join jsonb_array_elements(j -> 'asset_observations') o
join public.transaction_events e on e.event_key = o #>> '{asset,event}'
join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = o #>> '{asset,side}' and a.asset_name = o #>> '{asset,name}'
join public.sources so on so.url = o ->> 'source_url'
where not exists (select 1 from public.dodgers_control_observations x where x.subject_asset_id = a.id and x.observation_type = o ->> 'type'
                  and x.observed_through_date = (o ->> 'observed_through')::date and x.record_status = 'ACTIVE');

insert into public.transaction_asset_timing_observations (subject_asset_id, event_id, fact_type, season, observed_date, source_id, confidence, note)
select a.id, e.id, t ->> 'fact_type', nullif(t ->> 'season', '')::int, (t ->> 'observed_date')::date, so.id, (t ->> 'confidence')::public.confidence_level, t ->> 'note'
from _m034 cross join jsonb_array_elements(j -> 'timing') t
join public.transaction_events e on e.event_key = t #>> '{asset,event}'
join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = t #>> '{asset,side}' and a.asset_name = t #>> '{asset,name}'
join public.sources so on so.url = t ->> 'source_url'
where not exists (select 1 from public.transaction_asset_timing_observations x where x.subject_asset_id = a.id and x.fact_type = t ->> 'fact_type'
                  and coalesce(x.season, 0) = coalesce(nullif(t ->> 'season', '')::int, 0) and x.record_status = 'ACTIVE');

-- ===========================================================================
-- 6. TEAM-SEASON FACTS OF THE NEWLY SURFACED DOWNSTREAM PLAYER ASSETS (same Baseball-Reference files and method as 032 / 033)
-- ===========================================================================

insert into public.bref_team_code_map (bref_team_code, organization_id, from_season, to_season, note)
select x ->> 'code', o.id, (x ->> 'from')::int, (x ->> 'to')::int, x ->> 'note'
from _m034, jsonb_array_elements(j -> 'team_map') x
join public.organizations o on o.abbreviation = x ->> 'organization'
on conflict (bref_team_code, from_season) do nothing;

insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
  plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
select r ->> 0, r ->> 1, pl.id, (r ->> 2)::int, r ->> 3, m.organization_id, (r ->> 4)::int, r ->> 5, nullif(r ->> 7, '')::numeric, nullif(r ->> 8, '')::int,
       nullif(r ->> 9, '')::int, nullif(r ->> 10, '')::int, nullif(r ->> 6, ''), so.id,
       (j -> 'war' ->> 'observed_through_date')::date, (j -> 'war' ->> 'observed_through_season')::int, (j -> 'war' ->> 'retrieved_at')::timestamptz, 'VERIFIED',
       case when r ->> 7 is null then 'The data file has no WAR for this zero-plate-appearance row; stored as NULL, not zero.' end
from _m034 cross join lateral jsonb_array_elements(j -> 'war' -> 'rows') r
join public.sources so on so.url = case when r ->> 5 = 'BAT' then j -> 'war' ->> 'bat_url' else j -> 'war' ->> 'pitch_url' end
left join public.players pl on pl.bref_id = r ->> 0
left join lateral (
  select m2.organization_id from public.bref_team_code_map m2
  where m2.bref_team_code = r ->> 3 and (r ->> 2)::int >= m2.from_season and (r ->> 2)::int <= coalesce(m2.to_season, 9999)
  order by m2.from_season desc limit 1
) m on true
on conflict (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE' do nothing;

-- ===========================================================================
-- 7. VIEWS
-- ===========================================================================

{{views}}

-- ===========================================================================
-- 8. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['transaction_asset_timing_observations', 'v_player_control_intervals', 'v_transaction_asset_lineage', 'v_transaction_package_lineage',
    'v_downstream_organizational_realization', 'v_dodgers_international_value_portfolio', 'v_value_research_queue', 'v_transaction_research_queue'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  n int;
  expected int;
begin
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '034: API roles hold privileges beyond SELECT: %', bad;
  end if;

  select jsonb_array_length(j -> 'events') into expected from _m034;
  select count(*) into n from public.transaction_events e where exists (select 1 from _m034, jsonb_array_elements(j -> 'events') x where x ->> 'key' = e.event_key);
  if n <> expected then
    raise exception '034 postcondition: % of % reviewed transaction events are present', n, expected;
  end if;
  select (j ->> 'expected_total_assets')::int into expected from _m034;
  select count(*) into n from public.transaction_event_assets;
  if n <> expected then
    raise exception '034 postcondition: % transaction event assets exist, % expected', n, expected;
  end if;
  select jsonb_array_length(j -> 'timing') into expected from _m034;
  select count(*) into n from public.transaction_asset_timing_observations where record_status = 'ACTIVE';
  if n <> expected then
    raise exception '034 postcondition: % of % reviewed timing observations are present', n, expected;
  end if;
  select jsonb_array_length(j -> 'war' -> 'rows') into expected from _m034;
  select count(*) into n from public.player_mlb_team_season_war w
  where w.record_status = 'ACTIVE' and exists (select 1 from _m034, jsonb_array_elements(j -> 'war' -> 'rows') r
    where r ->> 0 = w.bref_id and (r ->> 2)::int = w.season and r ->> 3 = w.bref_team_code and (r ->> 4)::int = w.stint_ordinal and r ->> 5 = w.component);
  if n <> expected then
    raise exception '034 postcondition: % of % reviewed team-season rows are present', n, expected;
  end if;
  select count(*) into n from public.player_mlb_team_season_war where organization_id is null and record_status = 'ACTIVE';
  if n <> 0 then
    raise exception '034 postcondition: % loaded team-season row(s) have no organization', n;
  end if;
  -- no control interval ends before it starts; no lineage row exits before it was acquired
  select count(*) into n from public.v_player_control_intervals where interval_end is not null and interval_end < interval_start;
  if n <> 0 then
    raise exception '034 postcondition: % control interval(s) end before they start', n;
  end if;
end $$;

commit;
