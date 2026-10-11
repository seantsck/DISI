-- DISI v0.24
-- 033_transaction_asset_chain_completion.sql
-- Transaction and asset-chain completion: the factual transaction history of the 220 tracked Dodgers international
-- signings, stable identities for every asset, and the evidence needed to say what is and is not known about each
-- return asset. Run after 032.
--
-- Built from database/research/033/ (event-seed.json, war-seed.json, scope-config.json, audit.mjs, build.mjs).
--
-- What this is. Facts, plus derived views that expose completeness. It does not implement recursive or downstream
-- organizational value (second-hop bWAR, second-generation credit and transaction trees are Migration 034), and it does
-- not value cash, pool space or prospects.
--
-- What it does:
--   * Extends transaction_events (is_multi_team, historical_label, and the RULE5_SELECTION / FREE_AGENCY /
--     EXPANSION_DRAFT normalized types) and transaction_event_assets (mlb_id, bref_register_id,
--     counterparty_organization_id, cash_amount_usd, pool_space_amount_usd, a constrained asset_type).
--   * Adds transaction_asset_resolutions (append-only: a placeholder consideration is preserved and its later
--     resolution recorded beside it) and dodgers_control_observations (dated observations about Dodgers control, never
--     timeless claims).
--   * Backfills 158 new transaction events (141 tracked-player exits + 20 first-hop return-asset exits, 3 already
--     existed), their assets and stable identities, and fills the identity of the 11 pre-existing assets.
--   * Corrects the Diaz / Machado transaction date 2018-07-19 -> 2018-07-18 forward-only (the earlier value was the
--     press-release publication date) in transaction_events and the legacy transactions row, with evidence.
--   * Loads Baseball-Reference team-season bWAR for the first-hop incoming PLAYER assets of the newly modeled trades
--     (same two data files and checksums as 032) and four new team-code map rows.
--   * Amends v_trade_realization_edges (cash-only / no-player-return trades, explicit return states, asset-level
--     counterparty) and adds v_transaction_event_complete, v_transaction_asset_chain_readiness,
--     v_dodgers_international_exit_summary and v_transaction_research_queue.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/033/)
-- ===========================================================================

create temporary table _m033 on commit drop as
select $m033${{payload_json}}$m033$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
begin
  if to_regclass('public.player_mlb_team_season_war') is null or to_regclass('public.v_trade_realization_edges') is null
     or to_regclass('public.bref_team_code_map') is null then
    raise exception '033: Migration 032 has not been applied';
  end if;
  -- every organization the data names exists
  for p in select distinct x from _m033, jsonb_array_elements(j -> 'organizations') x loop
    if not exists (select 1 from public.organizations where abbreviation = p #>> '{}') then
      raise exception '033: organization % does not exist', p #>> '{}';
    end if;
  end loop;
  -- every tracked player exists with the MLB id the research recorded
  for p in select distinct x from _m033, jsonb_array_elements(j -> 'tracked_players') x loop
    if not exists (select 1 from public.players pl where pl.slug = p ->> 'slug' and pl.mlb_id = (p ->> 'mlb_id')::bigint) then
      raise exception '033: tracked player % does not exist with MLB id %', p ->> 'slug', p ->> 'mlb_id';
    end if;
  end loop;
  -- both Baseball-Reference data file sources are registered (loaded by 032)
  for p in select x from _m033, jsonb_array_elements(j -> 'war' -> 'source_urls') x loop
    if not exists (select 1 from public.sources where url = p #>> '{}') then
      raise exception '033: the Baseball-Reference data file source % is not registered', p #>> '{}';
    end if;
  end loop;
  -- the transaction layer holds only events this migration knows about
  select count(*) into n from public.transaction_events e
  where not exists (select 1 from _m033, jsonb_array_elements(j -> 'events') x where x ->> 'key' = e.event_key);
  if n <> 0 then
    raise exception '033: % transaction event(s) exist that the reviewed data does not know', n;
  end if;
  -- the pre-existing events the reviewed data marks as existing must exist (the other events are new or already loaded)
  for p in select x from _m033, jsonb_array_elements(j -> 'events') x where (x ->> 'existing')::boolean loop
    if not exists (select 1 from public.transaction_events where event_key = p ->> 'key') then
      raise exception '033: expected existing transaction event % was not found', p ->> 'key';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2. SCHEMA
-- ===========================================================================

alter table public.transaction_events add column if not exists is_multi_team boolean not null default false;
alter table public.transaction_events add column if not exists historical_label text;

alter table public.transaction_events drop constraint if exists transaction_events_transaction_type_check;
alter table public.transaction_events add constraint transaction_events_transaction_type_check
  check (transaction_type in ('TRADE', 'RELEASE', 'WAIVER', 'SALE', 'OTHER', 'RULE5_SELECTION', 'FREE_AGENCY', 'EXPANSION_DRAFT'));
alter table public.transaction_events drop constraint if exists transaction_events_historical_label_check;
alter table public.transaction_events add constraint transaction_events_historical_label_check
  check (historical_label is null or char_length(btrim(historical_label)) between 1 and 200);

alter table public.transaction_event_assets add column if not exists mlb_id text;
alter table public.transaction_event_assets add column if not exists bref_register_id text;
alter table public.transaction_event_assets add column if not exists counterparty_organization_id uuid references public.organizations(id) on delete restrict;
alter table public.transaction_event_assets add column if not exists cash_amount_usd numeric(14,2);
alter table public.transaction_event_assets add column if not exists pool_space_amount_usd numeric(14,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.transaction_event_assets'::regclass and conname = 'transaction_event_assets_asset_type_check') then
    alter table public.transaction_event_assets add constraint transaction_event_assets_asset_type_check
      check (asset_type in ('PLAYER', 'CASH', 'PLAYER_TO_BE_NAMED', 'FUTURE_CONSIDERATIONS', 'INTERNATIONAL_BONUS_POOL_SPACE'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.transaction_event_assets'::regclass and conname = 'transaction_event_assets_mlb_id_check') then
    alter table public.transaction_event_assets add constraint transaction_event_assets_mlb_id_check
      check (mlb_id is null or (mlb_id ~ '^[0-9]+$' and asset_type = 'PLAYER'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.transaction_event_assets'::regclass and conname = 'transaction_event_assets_bref_register_id_check') then
    -- Baseball-Reference Register (minor-league) ids: up to six letters or hyphens, three digits, up to four letters.
    -- Deliberately a separate namespace from bref_id (the major-league / career identifier, which never holds a hyphen).
    alter table public.transaction_event_assets add constraint transaction_event_assets_bref_register_id_check
      check (bref_register_id is null or (bref_register_id ~ '^[a-z][a-z-]{2,5}[0-9]{3}[a-z]{1,4}$' and asset_type = 'PLAYER'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.transaction_event_assets'::regclass and conname = 'transaction_event_assets_cash_amount_check') then
    alter table public.transaction_event_assets add constraint transaction_event_assets_cash_amount_check
      check (cash_amount_usd is null or (asset_type = 'CASH' and cash_amount_usd >= 0));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.transaction_event_assets'::regclass and conname = 'transaction_event_assets_pool_amount_check') then
    alter table public.transaction_event_assets add constraint transaction_event_assets_pool_amount_check
      check (pool_space_amount_usd is null or (asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd >= 0));
  end if;
end $$;
create index if not exists transaction_event_assets_mlb_id_idx on public.transaction_event_assets (mlb_id) where mlb_id is not null;
create index if not exists transaction_event_assets_bref_id_idx on public.transaction_event_assets (bref_id) where bref_id is not null;
create index if not exists transaction_event_assets_player_id_idx on public.transaction_event_assets (player_id) where player_id is not null;

comment on column public.transaction_events.is_multi_team is
  'True when the event moved Dodgers assets with more than one counterparty organization (for example the 2024-07-29 White Sox / Cardinals deal). Flows that never entered or left Dodgers control are not modeled; each asset names its own counterparty.';
comment on column public.transaction_events.historical_label is
  'The historical mechanism wording where it differs from the normalized transaction_type (for example a 1954 minor-league "Rule 5" draft, or "elected free agency").';
comment on column public.transaction_event_assets.mlb_id is
  'Official MLBAM person id of a PLAYER asset when verified (against the official transaction log person ids). A DISI players row is never created to hold it.';
comment on column public.transaction_event_assets.bref_id is
  'Baseball-Reference major-league / career id (the /players/ identifier the team-season WAR layer joins on). Never holds a Register (minor-league) id.';
comment on column public.transaction_event_assets.bref_register_id is
  'Baseball-Reference Register (minor-league) id of a PLAYER asset that has no /players/ page. A separate namespace from bref_id.';
comment on column public.transaction_event_assets.counterparty_organization_id is
  'The organization this asset moved from (INCOMING) or to (OUTGOING), relative to the Dodgers. Required to read multi-team events.';
comment on column public.transaction_event_assets.cash_amount_usd is
  'Sourced cash amount of a CASH asset. NULL means the amount is unknown, never zero.';
comment on column public.transaction_event_assets.pool_space_amount_usd is
  'Sourced international bonus-pool space of an INTERNATIONAL_BONUS_POOL_SPACE asset. NULL means unknown, never zero.';

-- ---------------------------------------------------------------------------
-- transaction_asset_resolutions: the factual resolution of a placeholder consideration
-- ---------------------------------------------------------------------------

create table if not exists public.transaction_asset_resolutions (
  id uuid primary key default gen_random_uuid(),
  placeholder_asset_id uuid not null references public.transaction_event_assets(id) on delete restrict,
  resolved_asset_id uuid references public.transaction_event_assets(id) on delete restrict,
  resolution_type text not null check (resolution_type in ('NAMED_PLAYER', 'CASH_SETTLEMENT')),
  cash_amount_usd numeric(14,2) check (cash_amount_usd is null or cash_amount_usd >= 0),
  resolution_date date not null,
  source_id uuid not null references public.sources(id) on delete restrict,
  confidence public.confidence_level not null,
  notes text check (notes is null or char_length(notes) <= 400),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  constraint transaction_asset_resolutions_shape_check check (
    (resolution_type = 'NAMED_PLAYER' and resolved_asset_id is not null and cash_amount_usd is null)
    or (resolution_type = 'CASH_SETTLEMENT' and resolved_asset_id is null)),
  constraint transaction_asset_resolutions_self_check check (resolved_asset_id is null or resolved_asset_id <> placeholder_asset_id),
  constraint transaction_asset_resolutions_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
create unique index if not exists transaction_asset_resolutions_active_placeholder_key on public.transaction_asset_resolutions (placeholder_asset_id)
  where record_status = 'ACTIVE';
create unique index if not exists transaction_asset_resolutions_active_resolved_key on public.transaction_asset_resolutions (resolved_asset_id)
  where record_status = 'ACTIVE' and resolved_asset_id is not null;

comment on table public.transaction_asset_resolutions is
  'Append-only factual resolution of a placeholder consideration (a player to be named later, or future considerations). The original placeholder asset is never rewritten; this row records what it later became, when, and on what source. Only a retraction of an ACTIVE row is allowed; a correction retracts and re-inserts.';

-- ---------------------------------------------------------------------------
-- dodgers_control_observations: dated observations about Dodgers control and MLB appearance
-- ---------------------------------------------------------------------------

create table if not exists public.dodgers_control_observations (
  id uuid primary key default gen_random_uuid(),
  subject_player_id uuid references public.players(id) on delete restrict,
  subject_asset_id uuid references public.transaction_event_assets(id) on delete restrict,
  observation_type text not null check (observation_type in
    ('DODGERS_CONTROL_OBSERVED', 'HISTORY_UNAVAILABLE', 'NO_MLB_APPEARANCE_OBSERVED', 'CAREER_ENDED_WITH_DODGERS', 'EXIT_MECHANISM_UNRECORDED')),
  observed_through_date date not null,
  source_id uuid not null references public.sources(id) on delete restrict,
  confidence public.confidence_level not null,
  note text check (note is null or char_length(note) <= 400),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  constraint dodgers_control_observations_subject_check check ((subject_player_id is null) <> (subject_asset_id is null)),
  constraint dodgers_control_observations_type_check check (
    (observation_type = 'HISTORY_UNAVAILABLE' and subject_player_id is not null)
    or (observation_type in ('NO_MLB_APPEARANCE_OBSERVED', 'CAREER_ENDED_WITH_DODGERS', 'EXIT_MECHANISM_UNRECORDED') and subject_asset_id is not null)
    or observation_type = 'DODGERS_CONTROL_OBSERVED'),
  constraint dodgers_control_observations_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
create unique index if not exists dodgers_control_observations_active_player_key on public.dodgers_control_observations
  (subject_player_id, observation_type, observed_through_date) where record_status = 'ACTIVE' and subject_player_id is not null;
create unique index if not exists dodgers_control_observations_active_asset_key on public.dodgers_control_observations
  (subject_asset_id, observation_type, observed_through_date) where record_status = 'ACTIVE' and subject_asset_id is not null;

comment on table public.dodgers_control_observations is
  'Dated, sourced observations about Dodgers control and MLB appearance. Every fact carries its observation boundary (observed_through_date): NO_MLB_APPEARANCE_OBSERVED means no MLB appearance was observed through that date, never that the player will never reach MLB. Sealed ACTIVE rows; the only change allowed is retraction.';
comment on column public.dodgers_control_observations.observation_type is
  'DODGERS_CONTROL_OBSERVED: the official log shows continued Dodgers-organization activity and no exit through the date. HISTORY_UNAVAILABLE: the log does not establish the control history (tracked signing only). NO_MLB_APPEARANCE_OBSERVED, CAREER_ENDED_WITH_DODGERS, EXIT_MECHANISM_UNRECORDED: facts about an incoming PLAYER asset.';

-- ---------------------------------------------------------------------------
-- guards: sealed facts, invoker rights, no API EXECUTE
-- ---------------------------------------------------------------------------

create or replace function public.disi_asset_resolution_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ph public.transaction_event_assets%rowtype;
  rs public.transaction_event_assets%rowtype;
  ev_date date;
begin
  if tg_op = 'DELETE' then
    raise exception 'transaction asset resolutions are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED transaction asset resolution is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE transaction asset resolution is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new transaction asset resolution starts ACTIVE' using errcode = '55000';
  end if;
  select * into ph from public.transaction_event_assets where id = new.placeholder_asset_id;
  if not found or ph.asset_type not in ('PLAYER_TO_BE_NAMED', 'FUTURE_CONSIDERATIONS') then
    raise exception 'only a player to be named later or future considerations can be resolved (%)', new.placeholder_asset_id using errcode = '55000';
  end if;
  if new.resolved_asset_id is not null then
    if new.resolved_asset_id = new.placeholder_asset_id then
      raise exception 'a placeholder cannot resolve to itself' using errcode = '55000';
    end if;
    select * into rs from public.transaction_event_assets where id = new.resolved_asset_id;
    if not found or rs.event_id <> ph.event_id or rs.asset_side <> ph.asset_side or rs.asset_type <> 'PLAYER' then
      raise exception 'a resolution must name a PLAYER asset of the same event and side as the placeholder (%)', new.resolved_asset_id using errcode = '55000';
    end if;
  end if;
  select e.transaction_date into ev_date from public.transaction_events e where e.id = ph.event_id;
  if new.resolution_date < ev_date then
    raise exception 'a resolution cannot predate the transaction it completes' using errcode = '55000';
  end if;
  if exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = new.placeholder_asset_id and r.record_status = 'ACTIVE' and r.id <> new.id) then
    raise exception 'the placeholder already has an ACTIVE resolution (%)', new.placeholder_asset_id using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_asset_resolution_guard() from public, anon, authenticated;

drop trigger if exists transaction_asset_resolutions_guard on public.transaction_asset_resolutions;
create trigger transaction_asset_resolutions_guard
before insert or update or delete on public.transaction_asset_resolutions
for each row execute function public.disi_asset_resolution_guard();

create or replace function public.disi_control_observation_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.transaction_event_assets%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'Dodgers control observations are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED Dodgers control observation is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE Dodgers control observation is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new Dodgers control observation starts ACTIVE' using errcode = '55000';
  end if;
  if new.subject_asset_id is not null then
    select * into a from public.transaction_event_assets where id = new.subject_asset_id;
    if not found or a.asset_type <> 'PLAYER' then
      raise exception 'an asset observation must concern a PLAYER asset (%)', new.subject_asset_id using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_control_observation_guard() from public, anon, authenticated;

drop trigger if exists dodgers_control_observations_guard on public.dodgers_control_observations;
create trigger dodgers_control_observations_guard
before insert or update or delete on public.dodgers_control_observations
for each row execute function public.disi_control_observation_guard();

do $$
declare t text;
begin
  foreach t in array array['transaction_asset_resolutions', 'dodgers_control_observations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

-- ===========================================================================
-- 3. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (j ->> 'retrieved_at')::timestamptz
from _m033, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 4. TRANSACTION EVENTS AND ASSETS
-- ===========================================================================

insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description, source_id,
  is_multi_team, historical_label)
select x ->> 'key', (x ->> 'date')::date, x ->> 'type', fo.id, tobj.id, x ->> 'description', so.id, (x ->> 'multi')::boolean, nullif(x ->> 'label', '')
from _m033, jsonb_array_elements(j -> 'events') x
left join public.organizations fo on fo.abbreviation = x ->> 'from'
left join public.organizations tobj on tobj.abbreviation = x ->> 'to'
left join public.sources so on so.url = x ->> 'source_url'
where not (x ->> 'existing')::boolean
on conflict (event_key) do nothing;

-- the multi-team flag and the historical label for pre-existing events
update public.transaction_events e set is_multi_team = (x ->> 'multi')::boolean, historical_label = nullif(x ->> 'label', '')
from _m033, jsonb_array_elements(j -> 'events') x
where (x ->> 'existing')::boolean and e.event_key = x ->> 'key'
  and (e.is_multi_team is distinct from (x ->> 'multi')::boolean or e.historical_label is distinct from nullif(x ->> 'label', ''));

insert into public.transaction_event_assets (event_id, asset_side, player_id, asset_name, asset_type, role_note, source_id, bref_id, mlb_id, bref_register_id,
  counterparty_organization_id, cash_amount_usd, pool_space_amount_usd)
select e.id, a ->> 'side', pl.id, a ->> 'name', a ->> 'type', nullif(a ->> 'note', ''), coalesce(sa.id, e.source_id), nullif(a ->> 'bref_id', ''),
       nullif(a ->> 'mlb_id', ''), nullif(a ->> 'register_id', ''), co.id, (a ->> 'cash')::numeric, (a ->> 'pool')::numeric
from _m033 cross join jsonb_array_elements(j -> 'events') x cross join jsonb_array_elements(x -> 'assets') a
join public.transaction_events e on e.event_key = x ->> 'key'
left join public.players pl on pl.slug = a ->> 'slug'
left join public.organizations co on co.abbreviation = a ->> 'cp'
left join public.sources sa on sa.url = a ->> 'source_url'
on conflict (event_id, asset_side, asset_name) do nothing;

-- identity of assets that already existed (never overwrites a different value)
do $$
declare
  r record;
  n int;
begin
  for r in
    select e.event_key, a ->> 'side' as side, a ->> 'name' as name, nullif(a ->> 'mlb_id', '') as mlb_id, nullif(a ->> 'bref_id', '') as bref_id,
           nullif(a ->> 'register_id', '') as register_id, co.id as cp_id, pl.id as player_id
    from _m033 cross join jsonb_array_elements(j -> 'events') x cross join jsonb_array_elements(x -> 'assets') a
    join public.transaction_events e on e.event_key = x ->> 'key'
    left join public.organizations co on co.abbreviation = a ->> 'cp'
    left join public.players pl on pl.slug = a ->> 'slug'
    where (x ->> 'existing')::boolean
  loop
    update public.transaction_event_assets t
    set mlb_id = coalesce(t.mlb_id, r.mlb_id), bref_id = coalesce(t.bref_id, r.bref_id), bref_register_id = coalesce(t.bref_register_id, r.register_id),
        counterparty_organization_id = coalesce(t.counterparty_organization_id, r.cp_id), player_id = coalesce(t.player_id, r.player_id)
    from public.transaction_events ev
    where t.event_id = ev.id and ev.event_key = r.event_key and t.asset_side = r.side and t.asset_name = r.name
      and (t.mlb_id is null or t.bref_id is null and r.bref_id is not null or t.counterparty_organization_id is null or t.player_id is null and r.player_id is not null
           or t.bref_register_id is null and r.register_id is not null);
    select count(*) into n from public.transaction_event_assets t join public.transaction_events ev on ev.id = t.event_id
    where ev.event_key = r.event_key and t.asset_side = r.side and t.asset_name = r.name
      and (t.mlb_id is distinct from coalesce(r.mlb_id, t.mlb_id) or t.bref_id is distinct from coalesce(r.bref_id, t.bref_id)
           or t.player_id is distinct from coalesce(r.player_id, t.player_id));
    if n <> 0 then
      raise exception '033: existing asset % (%) carries a different identity than the reviewed data', r.name, r.event_key;
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 5. DIAZ / MACHADO DATE CORRECTION (forward-only; the frozen migrations that seeded 2018-07-19 are untouched)
-- ===========================================================================

do $$
declare
  c jsonb;
  ev public.transaction_events%rowtype;
  tx public.transactions%rowtype;
  src uuid;
  d_from date;
  d_to date;
begin
  select j -> 'date_correction' into c from _m033;
  d_from := (c ->> 'from')::date;
  d_to := (c ->> 'to')::date;
  select id into src from public.sources where url = c ->> 'evidence_source_url';
  if src is null then
    raise exception '033: the date-correction evidence source is not registered';
  end if;
  select * into ev from public.transaction_events where event_key = c ->> 'event_key';
  if ev.id is null then
    raise exception '033: the corrected event % does not exist', c ->> 'event_key';
  end if;
  if ev.transaction_date = d_from then
    update public.transaction_events set transaction_date = d_to where id = ev.id;
  elsif ev.transaction_date <> d_to then
    raise exception '033: event % is dated % (expected % or %)', ev.event_key, ev.transaction_date, d_from, d_to;
  end if;
  select t.* into tx from public.transactions t join public.players p on p.id = t.player_id
  where p.slug = c ->> 'player_slug' and t.transaction_type = c ->> 'legacy_transaction_type' and t.transaction_date in (d_from, d_to);
  if tx.id is null then
    raise exception '033: the legacy transaction of % was not found', c ->> 'player_slug';
  end if;
  if tx.transaction_date = d_from then
    update public.transactions set transaction_date = d_to where id = tx.id;
  end if;
  insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
  select 'transaction_event', ev.id, 'transaction_date', src, 'VERIFIED',
         (c ->> 'note') || ' Previously recorded as ' || (c ->> 'from') || '.'
  where not exists (select 1 from public.evidence where entity_type = 'transaction_event' and entity_id = ev.id and field_name = 'transaction_date' and source_id = src);
  insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
  select 'transaction', tx.id, 'transaction_date', src, 'VERIFIED',
         (c ->> 'note') || ' Previously recorded as ' || (c ->> 'from') || '.'
  where not exists (select 1 from public.evidence where entity_type = 'transaction' and entity_id = tx.id and field_name = 'transaction_date' and source_id = src);
end $$;

-- ===========================================================================
-- 6. PLACEHOLDER RESOLUTIONS AND CONTROL OBSERVATIONS
-- ===========================================================================

insert into public.transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence, notes)
select ph.id, rs.id, 'NAMED_PLAYER', (r ->> 'date')::date, so.id, (r ->> 'confidence')::public.confidence_level, r ->> 'note'
from _m033 cross join jsonb_array_elements(j -> 'resolutions') r
join public.transaction_events e on e.event_key = r ->> 'event'
join public.transaction_event_assets ph on ph.event_id = e.id and ph.asset_side = r #>> '{placeholder,0}' and ph.asset_name = r #>> '{placeholder,1}'
join public.transaction_event_assets rs on rs.event_id = e.id and rs.asset_side = r #>> '{resolved,0}' and rs.asset_name = r #>> '{resolved,1}'
join public.sources so on so.url = r ->> 'source_url'
where not exists (select 1 from public.transaction_asset_resolutions x where x.placeholder_asset_id = ph.id and x.record_status = 'ACTIVE');

insert into public.dodgers_control_observations (subject_asset_id, observation_type, observed_through_date, source_id, confidence, note)
select a.id, o ->> 'type', (o ->> 'observed_through')::date, so.id, (o ->> 'confidence')::public.confidence_level, o ->> 'note'
from _m033 cross join jsonb_array_elements(j -> 'asset_observations') o
join public.transaction_events e on e.event_key = o #>> '{asset,event}'
join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = o #>> '{asset,side}' and a.asset_name = o #>> '{asset,name}'
join public.sources so on so.url = o ->> 'source_url'
where not exists (select 1 from public.dodgers_control_observations x where x.subject_asset_id = a.id and x.observation_type = o ->> 'type'
                  and x.observed_through_date = (o ->> 'observed_through')::date and x.record_status = 'ACTIVE');

insert into public.dodgers_control_observations (subject_player_id, observation_type, observed_through_date, source_id, confidence, note)
select p.id, o ->> 'type', (o ->> 'observed_through')::date, so.id, (o ->> 'confidence')::public.confidence_level, o ->> 'note'
from _m033 cross join jsonb_array_elements(j -> 'player_observations') o
join public.players p on p.slug = o ->> 'slug'
join public.sources so on so.url = o ->> 'source_url'
where not exists (select 1 from public.dodgers_control_observations x where x.subject_player_id = p.id and x.observation_type = o ->> 'type'
                  and x.observed_through_date = (o ->> 'observed_through')::date and x.record_status = 'ACTIVE');

-- ===========================================================================
-- 7. TEAM-CODE MAP AND RETURN-ASSET TEAM-SEASON FACTS (same Baseball-Reference files and method as 032)
-- ===========================================================================

insert into public.bref_team_code_map (bref_team_code, organization_id, from_season, to_season, note)
select x ->> 'code', o.id, (x ->> 'from')::int, (x ->> 'to')::int, x ->> 'note'
from _m033, jsonb_array_elements(j -> 'team_map') x
join public.organizations o on o.abbreviation = x ->> 'organization'
on conflict (bref_team_code, from_season) do nothing;

insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
  plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
select r ->> 0, r ->> 1, pl.id, (r ->> 2)::int, r ->> 3, m.organization_id, (r ->> 4)::int, r ->> 5, nullif(r ->> 7, '')::numeric, nullif(r ->> 8, '')::int,
       nullif(r ->> 9, '')::int, nullif(r ->> 10, '')::int, nullif(r ->> 6, ''), so.id,
       (j -> 'war' ->> 'observed_through_date')::date, (j -> 'war' ->> 'observed_through_season')::int, (j -> 'war' ->> 'retrieved_at')::timestamptz, 'VERIFIED',
       case when r ->> 7 is null then 'The data file has no WAR for this zero-plate-appearance row; stored as NULL, not zero.' end
from _m033 cross join lateral jsonb_array_elements(j -> 'war' -> 'rows') r
join public.sources so on so.url = case when r ->> 5 = 'BAT' then j -> 'war' ->> 'bat_url' else j -> 'war' ->> 'pitch_url' end
left join public.players pl on pl.bref_id = r ->> 0
left join lateral (
  select m2.organization_id from public.bref_team_code_map m2
  where m2.bref_team_code = r ->> 3 and (r ->> 2)::int >= m2.from_season and (r ->> 2)::int <= coalesce(m2.to_season, 9999)
  order by m2.from_season desc limit 1
) m on true
on conflict (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE' do nothing;

-- ===========================================================================
-- 8. VIEWS
-- ===========================================================================

-- dependents first (a rerun finds the new views, which depend on the edges view)
drop view if exists public.v_transaction_research_queue;
drop view if exists public.v_dodgers_international_exit_summary;
drop view if exists public.v_transaction_asset_chain_readiness;
drop view if exists public.v_transaction_event_complete;
drop view if exists public.v_dodgers_international_value_portfolio;
drop view if exists public.v_value_research_queue;
drop view if exists public.v_player_organizational_realization;
drop view if exists public.v_trade_realization_edges;

{{views}}

-- ===========================================================================
-- 9. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['transaction_asset_resolutions', 'dodgers_control_observations', 'v_trade_realization_edges', 'v_player_organizational_realization',
    'v_dodgers_international_value_portfolio', 'v_value_research_queue', 'v_transaction_event_complete', 'v_transaction_asset_chain_readiness',
    'v_dodgers_international_exit_summary', 'v_transaction_research_queue'] loop
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
    raise exception '033: API roles hold privileges beyond SELECT: %', bad;
  end if;

  -- every reviewed event exists exactly once and carries every reviewed asset
  select jsonb_array_length(j -> 'events') into expected from _m033;
  select count(*) into n from public.transaction_events e where exists (select 1 from _m033, jsonb_array_elements(j -> 'events') x where x ->> 'key' = e.event_key);
  if n <> expected then
    raise exception '033 postcondition: % of % reviewed transaction events are present', n, expected;
  end if;
  select count(*) into expected from _m033, jsonb_array_elements(j -> 'events') x, jsonb_array_elements(x -> 'assets') a;
  select count(*) into n from public.transaction_event_assets;
  if n <> expected then
    raise exception '033 postcondition: % transaction event assets exist, % reviewed', n, expected;
  end if;
  -- reviewed team-season rows are all present and every row resolves to an organization
  select jsonb_array_length(j -> 'war' -> 'rows') into expected from _m033;
  select count(*) into n from public.player_mlb_team_season_war w
  where w.record_status = 'ACTIVE' and exists (select 1 from _m033, jsonb_array_elements(j -> 'war' -> 'rows') r
    where r ->> 0 = w.bref_id and (r ->> 2)::int = w.season and r ->> 3 = w.bref_team_code and (r ->> 4)::int = w.stint_ordinal and r ->> 5 = w.component);
  if n <> expected then
    raise exception '033 postcondition: % of % reviewed team-season rows are present', n, expected;
  end if;
  select count(*) into n from public.player_mlb_team_season_war where organization_id is null and record_status = 'ACTIVE';
  if n <> 0 then
    raise exception '033 postcondition: % loaded team-season row(s) have no organization', n;
  end if;
  -- the corrected transaction date holds in both places
  select count(*) into n from public.transaction_events where event_key = (select j -> 'date_correction' ->> 'event_key' from _m033)
    and transaction_date = (select (j -> 'date_correction' ->> 'to')::date from _m033);
  if n <> 1 then
    raise exception '033 postcondition: the corrected event date does not hold';
  end if;
  -- every legacy transaction has a matching canonical event
  select count(*) into n from public.transactions t
  where not exists (select 1 from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
    where a.player_id = t.player_id and a.asset_side = 'OUTGOING' and e.transaction_date = t.transaction_date and e.transaction_type = t.transaction_type);
  if n <> 0 then
    raise exception '033 postcondition: % legacy transaction(s) have no matching canonical event', n;
  end if;
end $$;

commit;
