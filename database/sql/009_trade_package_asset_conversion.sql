-- DISI v0.1
-- 009_trade_package_asset_conversion.sql
-- Package-aware trade valuation for international signing assets.
-- Run after 008.
--
-- Purpose:
-- 1) Separate talent identification from asset realization.
-- 2) Avoid crediting an entire multi-player trade return to one DISI player.
-- 3) Record the MLB value Los Angeles received from the incoming asset.
--
-- Public-data observations used here are descriptive, not causal valuation.

-- ===========================================================================
-- 1. PACKAGE-AWARE TRANSACTION TABLES
-- ===========================================================================

create table if not exists public.transaction_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  transaction_date date not null,
  transaction_type text not null check (
    transaction_type in ('TRADE','RELEASE','WAIVER','SALE','OTHER')
  ),
  from_organization_id uuid references public.organizations(id) on delete set null,
  to_organization_id uuid references public.organizations(id) on delete set null,
  description text not null,
  source_id uuid references public.sources(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.transaction_event_assets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.transaction_events(id) on delete cascade,
  asset_side text not null check (asset_side in ('OUTGOING','INCOMING')),
  player_id uuid references public.players(id) on delete set null,
  asset_name text not null,
  asset_type text not null default 'PLAYER',
  role_note text,
  source_id uuid references public.sources(id) on delete set null,
  unique(event_id, asset_side, asset_name)
);

create table if not exists public.transaction_return_metrics (
  event_id uuid primary key references public.transaction_events(id) on delete cascade,
  incoming_asset_name text not null,
  dodgers_regular_season_war numeric,
  dodgers_games integer,
  dodgers_pa integer,
  dodgers_ip numeric,
  postseason_games integer,
  postseason_pa integer,
  postseason_ip numeric,
  world_series_roster boolean,
  valuation_note text,
  source_id uuid references public.sources(id) on delete set null,
  observed_through_date date not null default date '2026-10-03'
);

-- ===========================================================================
-- 2. SECURITY
-- ===========================================================================

alter table public.transaction_events enable row level security;
alter table public.transaction_event_assets enable row level security;
alter table public.transaction_return_metrics enable row level security;

revoke all on table public.transaction_events from anon, authenticated;
revoke all on table public.transaction_event_assets from anon, authenticated;
revoke all on table public.transaction_return_metrics from anon, authenticated;

grant select on table public.transaction_events to anon, authenticated;
grant select on table public.transaction_event_assets to anon, authenticated;
grant select on table public.transaction_return_metrics to anon, authenticated;

drop policy if exists public_read_transaction_events on public.transaction_events;
create policy public_read_transaction_events
on public.transaction_events
for select
to anon, authenticated
using (true);

drop policy if exists public_read_transaction_event_assets on public.transaction_event_assets;
create policy public_read_transaction_event_assets
on public.transaction_event_assets
for select
to anon, authenticated
using (true);

drop policy if exists public_read_transaction_return_metrics on public.transaction_return_metrics;
create policy public_read_transaction_return_metrics
on public.transaction_return_metrics
for select
to anon, authenticated
using (true);

-- ===========================================================================
-- 3. SOURCES FOR RETURN PERFORMANCE
-- ===========================================================================

insert into public.sources
  (source_name, source_type, title, url)
values
  ('Baseball-Reference','PLAYER_PAGE','Josh Fields Stats',
   'https://www.baseball-reference.com/players/f/fieldjo03.shtml')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url)
values
  ('Baseball-Reference','PLAYER_PAGE','Tony Watson Stats',
   'https://www.baseball-reference.com/players/w/watsoto01.shtml')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url)
values
  ('Baseball-Reference','PLAYER_PAGE','Manny Machado Stats',
   'https://www.baseball-reference.com/players/m/machama01.shtml')
on conflict (url) do nothing;

-- ===========================================================================
-- 4. TRANSACTION EVENTS
-- ===========================================================================

insert into public.transaction_events (
  event_key, transaction_date, transaction_type,
  from_organization_id, to_organization_id,
  description, source_id
)
select
  'LAD_HOU_2016_ALVAREZ_FIELDS',
  date '2016-08-01',
  'TRADE',
  lad.id,
  hou.id,
  'Los Angeles traded Yordan Alvarez to Houston for RHP Josh Fields.',
  src.id
from public.organizations lad
join public.organizations hou on hou.abbreviation='HOU'
join public.sources src
  on src.url='https://www.mlb.com/press-release/dodgers-acquire-josh-fields-from-houston-193028122'
where lad.abbreviation='LAD'
on conflict (event_key) do update set
  transaction_date=excluded.transaction_date,
  description=excluded.description,
  source_id=excluded.source_id;

insert into public.transaction_events (
  event_key, transaction_date, transaction_type,
  from_organization_id, to_organization_id,
  description, source_id
)
select
  'LAD_PIT_2017_CRUZ_WATSON',
  date '2017-07-31',
  'TRADE',
  lad.id,
  pit.id,
  'Los Angeles traded Oneil Cruz and Angel German to Pittsburgh for LHP Tony Watson.',
  src.id
from public.organizations lad
join public.organizations pit on pit.abbreviation='PIT'
join public.sources src
  on src.url='https://www.mlb.com/press-release/dodgers-acquire-tony-watson-from-pirates-245586558'
where lad.abbreviation='LAD'
on conflict (event_key) do update set
  transaction_date=excluded.transaction_date,
  description=excluded.description,
  source_id=excluded.source_id;

insert into public.transaction_events (
  event_key, transaction_date, transaction_type,
  from_organization_id, to_organization_id,
  description, source_id
)
select
  'LAD_BAL_2018_DIAZ_MACHADO',
  date '2018-07-19',
  'TRADE',
  lad.id,
  bal.id,
  'Los Angeles traded Yusniel Diaz, Rylan Bannon, Dean Kremer, Zach Pop and Breyvic Valera to Baltimore for SS Manny Machado.',
  src.id
from public.organizations lad
join public.organizations bal on bal.abbreviation='BAL'
join public.sources src
  on src.url='https://www.mlb.com/press-release/dodgers-acquire-manny-machado-286394692'
where lad.abbreviation='LAD'
on conflict (event_key) do update set
  transaction_date=excluded.transaction_date,
  description=excluded.description,
  source_id=excluded.source_id;

-- ===========================================================================
-- 5. OUTGOING / INCOMING PACKAGE ASSETS
-- ===========================================================================

-- Alvarez <-> Fields
insert into public.transaction_event_assets (
  event_id, asset_side, player_id, asset_name, role_note, source_id
)
select e.id, 'OUTGOING', p.id, 'Yordan Alvarez',
       'DISI tracked international signing; sole outgoing player in this deal.',
       e.source_id
from public.transaction_events e
join public.players p on p.full_name='Yordan Alvarez'
where e.event_key='LAD_HOU_2016_ALVAREZ_FIELDS'
on conflict (event_id, asset_side, asset_name) do nothing;

insert into public.transaction_event_assets (
  event_id, asset_side, asset_name, role_note, source_id
)
select e.id, 'INCOMING', 'Josh Fields',
       'Major-league relief pitcher acquired by Los Angeles.',
       e.source_id
from public.transaction_events e
where e.event_key='LAD_HOU_2016_ALVAREZ_FIELDS'
on conflict (event_id, asset_side, asset_name) do nothing;

-- Cruz + German <-> Watson
insert into public.transaction_event_assets (
  event_id, asset_side, player_id, asset_name, role_note, source_id
)
select e.id, 'OUTGOING', p.id, 'Oneil Cruz',
       'DISI tracked international signing; one of two outgoing players.',
       e.source_id
from public.transaction_events e
join public.players p on p.full_name='Oneil Cruz'
where e.event_key='LAD_PIT_2017_CRUZ_WATSON'
on conflict (event_id, asset_side, asset_name) do nothing;

insert into public.transaction_event_assets (
  event_id, asset_side, asset_name, role_note, source_id
)
select e.id, 'OUTGOING', 'Angel German',
       'Second outgoing prospect; return cannot be attributed solely to Oneil Cruz.',
       e.source_id
from public.transaction_events e
where e.event_key='LAD_PIT_2017_CRUZ_WATSON'
on conflict (event_id, asset_side, asset_name) do nothing;

insert into public.transaction_event_assets (
  event_id, asset_side, asset_name, role_note, source_id
)
select e.id, 'INCOMING', 'Tony Watson',
       'Major-league left-handed reliever acquired for 2017 stretch/postseason.',
       e.source_id
from public.transaction_events e
where e.event_key='LAD_PIT_2017_CRUZ_WATSON'
on conflict (event_id, asset_side, asset_name) do nothing;

-- Five-player Machado package
insert into public.transaction_event_assets (
  event_id, asset_side, player_id, asset_name, role_note, source_id
)
select e.id, 'OUTGOING', p.id, 'Yusniel Diaz',
       'DISI tracked international signing; one of five outgoing players.',
       e.source_id
from public.transaction_events e
join public.players p on p.full_name='Yusniel Diaz'
where e.event_key='LAD_BAL_2018_DIAZ_MACHADO'
on conflict (event_id, asset_side, asset_name) do nothing;

insert into public.transaction_event_assets (
  event_id, asset_side, asset_name, role_note, source_id
)
select e.id, 'OUTGOING', x.asset_name,
       'Additional outgoing asset in five-player Machado package.',
       e.source_id
from public.transaction_events e
cross join (
  values
    ('Rylan Bannon'),
    ('Dean Kremer'),
    ('Zach Pop'),
    ('Breyvic Valera')
) as x(asset_name)
where e.event_key='LAD_BAL_2018_DIAZ_MACHADO'
on conflict (event_id, asset_side, asset_name) do nothing;

insert into public.transaction_event_assets (
  event_id, asset_side, asset_name, role_note, source_id
)
select e.id, 'INCOMING', 'Manny Machado',
       'Four-time All-Star shortstop acquired as 2018 pennant-race rental.',
       e.source_id
from public.transaction_events e
where e.event_key='LAD_BAL_2018_DIAZ_MACHADO'
on conflict (event_id, asset_side, asset_name) do nothing;

-- ===========================================================================
-- 6. OBSERVED DODGERS RETURN VALUE
-- Baseball-Reference bWAR. Postseason fields are observational context only.
-- ===========================================================================

insert into public.transaction_return_metrics (
  event_id, incoming_asset_name,
  dodgers_regular_season_war, dodgers_games, dodgers_ip,
  world_series_roster, valuation_note, source_id
)
select
  e.id,
  'Josh Fields',
  2.0,
  124,
  117.1,
  true,
  'Fields produced 2.0 bWAR across three Dodgers regular seasons (2016-18). He also appeared in the 2017 postseason. This is return value to Los Angeles, not a claim that the trade was favorable relative to Alvarez.',
  src.id
from public.transaction_events e
join public.sources src
  on src.url='https://www.baseball-reference.com/players/f/fieldjo03.shtml'
where e.event_key='LAD_HOU_2016_ALVAREZ_FIELDS'
on conflict (event_id) do update set
  incoming_asset_name=excluded.incoming_asset_name,
  dodgers_regular_season_war=excluded.dodgers_regular_season_war,
  dodgers_games=excluded.dodgers_games,
  dodgers_ip=excluded.dodgers_ip,
  world_series_roster=excluded.world_series_roster,
  valuation_note=excluded.valuation_note,
  source_id=excluded.source_id;

insert into public.transaction_return_metrics (
  event_id, incoming_asset_name,
  dodgers_regular_season_war, dodgers_games, dodgers_ip,
  postseason_games, postseason_ip, world_series_roster,
  valuation_note, source_id
)
select
  e.id,
  'Tony Watson',
  0.4,
  24,
  20.0,
  11,
  7.0,
  true,
  'Watson produced 0.4 bWAR in 20 regular-season innings for Los Angeles, then appeared in 11 postseason games during the 2017 World Series run. The return was acquired for a two-player prospect package.',
  src.id
from public.transaction_events e
join public.sources src
  on src.url='https://www.baseball-reference.com/players/w/watsoto01.shtml'
where e.event_key='LAD_PIT_2017_CRUZ_WATSON'
on conflict (event_id) do update set
  incoming_asset_name=excluded.incoming_asset_name,
  dodgers_regular_season_war=excluded.dodgers_regular_season_war,
  dodgers_games=excluded.dodgers_games,
  dodgers_ip=excluded.dodgers_ip,
  postseason_games=excluded.postseason_games,
  postseason_ip=excluded.postseason_ip,
  world_series_roster=excluded.world_series_roster,
  valuation_note=excluded.valuation_note,
  source_id=excluded.source_id;

insert into public.transaction_return_metrics (
  event_id, incoming_asset_name,
  dodgers_regular_season_war, dodgers_games, dodgers_pa,
  postseason_games, postseason_pa, world_series_roster,
  valuation_note, source_id
)
select
  e.id,
  'Manny Machado',
  2.6,
  66,
  296,
  16,
  72,
  true,
  'Machado produced 2.6 bWAR in 66 regular-season games for Los Angeles and played all 16 Dodgers postseason games during the 2018 World Series run. The return was acquired for a five-player package, so the full return cannot be attributed to Yusniel Diaz alone.',
  src.id
from public.transaction_events e
join public.sources src
  on src.url='https://www.baseball-reference.com/players/m/machama01.shtml'
where e.event_key='LAD_BAL_2018_DIAZ_MACHADO'
on conflict (event_id) do update set
  incoming_asset_name=excluded.incoming_asset_name,
  dodgers_regular_season_war=excluded.dodgers_regular_season_war,
  dodgers_games=excluded.dodgers_games,
  dodgers_pa=excluded.dodgers_pa,
  postseason_games=excluded.postseason_games,
  postseason_pa=excluded.postseason_pa,
  world_series_roster=excluded.world_series_roster,
  valuation_note=excluded.valuation_note,
  source_id=excluded.source_id;

-- ===========================================================================
-- 7. PACKAGE-AWARE DISI VIEW
-- ===========================================================================

create or replace view public.v_dodgers_trade_package_conversion
with (security_invoker=true)
as
with package_counts as (
  select
    event_id,
    count(*) filter (where asset_side='OUTGOING') as outgoing_asset_count,
    count(*) filter (where asset_side='INCOMING') as incoming_asset_count
  from public.transaction_event_assets
  group by event_id
)
select
  e.event_key,
  e.transaction_date,
  tracked.full_name as disi_player,
  tracked.signing_bonus_usd,
  tracked.career_war as disi_player_later_career_war,
  r.incoming_asset_name,
  r.dodgers_regular_season_war as return_dodgers_regular_season_war,
  r.world_series_roster,
  pc.outgoing_asset_count,
  pc.incoming_asset_count,
  case
    when pc.outgoing_asset_count = 1
      then 'SOLE_OUTGOING_ASSET'
    else 'SHARED_PACKAGE_RETURN'
  end as attribution_status,
  case
    when pc.outgoing_asset_count = 1
      then 'Return may be directly associated with the tracked DISI asset, while still requiring context beyond WAR.'
    else 'Do not attribute the full incoming return to this DISI player; the player was one component of a multi-asset package.'
  end as attribution_note,
  e.description,
  r.valuation_note
from public.transaction_events e
join public.transaction_event_assets a
  on a.event_id=e.id
 and a.asset_side='OUTGOING'
 and a.player_id is not null
join public.v_dodgers_mature_player_analysis tracked
  on tracked.player_id=a.player_id
join package_counts pc on pc.event_id=e.id
left join public.transaction_return_metrics r on r.event_id=e.id
where e.transaction_type='TRADE';

grant select on public.v_dodgers_trade_package_conversion to anon, authenticated;

-- ===========================================================================
-- 8. PORTFOLIO EXECUTIVE VIEW
-- ===========================================================================

create or replace view public.v_dodgers_asset_conversion_brief
with (security_invoker=true)
as
select
  disi_player,
  signing_bonus_usd,
  disi_player_later_career_war,
  incoming_asset_name,
  return_dodgers_regular_season_war,
  world_series_roster,
  outgoing_asset_count,
  attribution_status,
  case
    when disi_player_later_career_war >= 20
      then 'ELITE_TALENT_IDENTIFICATION'
    when disi_player_later_career_war >= 5
      then 'HIGH_VALUE_TALENT_IDENTIFICATION'
    when disi_player_later_career_war > 0
      then 'MLB_TALENT_IDENTIFICATION'
    else 'MLB_REACH_WITH_LIMITED_OBSERVED_WAR'
  end as talent_identification_signal,
  attribution_note
from public.v_dodgers_trade_package_conversion;

grant select on public.v_dodgers_asset_conversion_brief to anon, authenticated;

-- ===========================================================================
-- 9. VERIFICATION OUTPUTS
-- ===========================================================================

select *
from public.v_dodgers_asset_conversion_brief
order by disi_player_later_career_war desc nulls last;

select
  event_key,
  transaction_date,
  incoming_asset_name,
  dodgers_regular_season_war,
  dodgers_games,
  dodgers_pa,
  dodgers_ip,
  postseason_games,
  postseason_pa,
  postseason_ip,
  world_series_roster
from public.transaction_events e
join public.transaction_return_metrics r on r.event_id=e.id
order by transaction_date;
