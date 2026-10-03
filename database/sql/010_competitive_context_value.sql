-- DISI v0.1
-- 010_competitive_context_value.sql
-- Adds competitive context to international-asset conversion.
-- Run after 009.
--
-- This layer intentionally avoids a black-box "trade score."
-- It stores observable context separately from analyst judgments so a baseball
-- decision-maker can see WHY an acquisition mattered.

-- ===========================================================================
-- 1. COMPETITIVE CONTEXT TABLE
-- ===========================================================================

create table if not exists public.transaction_competitive_context (
  event_id uuid primary key references public.transaction_events(id) on delete cascade,

  club_wins integer,
  club_losses integer,
  games_played integer,
  regular_season_games_remaining integer,

  division_position integer,
  division_lead_games numeric,
  race_state text,

  need_category text,
  need_urgency smallint check (need_urgency between 1 and 5),
  need_note text,

  acquisition_horizon text,
  strategic_context_label text,

  acquisition_season_postseason_result text,
  championship_window boolean not null default false,

  standings_source_id uuid references public.sources(id) on delete set null,
  context_source_id uuid references public.sources(id) on delete set null,

  analyst_note text,
  updated_at timestamptz not null default now()
);

alter table public.transaction_competitive_context enable row level security;
revoke all on table public.transaction_competitive_context from anon, authenticated;
grant select on table public.transaction_competitive_context to anon, authenticated;

drop policy if exists public_read_transaction_competitive_context
  on public.transaction_competitive_context;

create policy public_read_transaction_competitive_context
on public.transaction_competitive_context
for select
to anon, authenticated
using (true);

-- ===========================================================================
-- 2. SOURCES
-- ===========================================================================

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('The Baseball Cube','STANDINGS_SNAPSHOT',
   'MLB standings snapshot - August 1, 2016',
   'https://www.thebaseballcube.com/content/box_date/20160801/',
   date '2016-08-01')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('Baseball-Reference','STANDINGS_SNAPSHOT',
   'MLB standings snapshot - July 31, 2017',
   'https://www.baseball-reference.com/boxes/index.fcgi?date=2017-07-31',
   date '2017-07-31')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('Baseball-Reference','STANDINGS_SNAPSHOT',
   'MLB standings snapshot - July 19, 2018',
   'https://www.baseball-reference.com/boxes/index.fcgi?date=2018-07-19',
   date '2018-07-19')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com','NEWS',
   'Dodgers Deadline haul adds bullpen depth',
   'https://www.mlb.com/dodgers/news/dodgers-acquire-josh-reddick-rich-hill-c192999766',
   date '2016-08-01')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com','NEWS',
   'Dodgers get Yu Darvish and relief help at 2017 deadline',
   'https://www.mlb.com/reds/news/dodgers-trade-for-yu-darvish-bolster-bullpen-c245570576',
   date '2017-07-31')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com','NEWS',
   'Dodgers land Manny Machado in blockbuster',
   'https://www.mlb.com/dodgers/news/manny-machado-traded-to-dodgers-c286340444',
   date '2018-07-18')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com','NEWS',
   'Corey Seager to miss rest of 2018 season',
   'https://www.mlb.com/news/corey-seager-to-have-tommy-john-surgery-c274573656',
   date '2018-04-30')
on conflict (url) do nothing;

-- ===========================================================================
-- 3. 2016: ALVAREZ -> FIELDS
-- Dodgers were 59-46, 2 games behind San Francisco on Aug. 1.
-- Fields was part of a broader deadline effort to reinforce an injury-affected
-- pitching staff and bullpen. Unlike Watson/Machado, this was not merely a
-- same-season rental return: Fields remained with Los Angeles through 2018.
-- ===========================================================================

insert into public.transaction_competitive_context (
  event_id,
  club_wins, club_losses, games_played, regular_season_games_remaining,
  division_position, division_lead_games, race_state,
  need_category, need_urgency, need_note,
  acquisition_horizon, strategic_context_label,
  acquisition_season_postseason_result, championship_window,
  standings_source_id, context_source_id, analyst_note
)
select
  e.id,
  59, 46, 105, 57,
  2, -2.0, 'TRAILING_DIVISION_LEADER',
  'BULLPEN_DEPTH', 4,
  'Los Angeles added multiple pitchers at the deadline amid rotation injuries and a taxed staff; Fields added right-handed relief depth.',
  'MULTI_YEAR_CONTROL',
  'PLAYOFF_PUSH_DEPTH',
  'LOST_NLCS',
  true,
  standings.id,
  context.id,
  'High-value pennant-race context, but the return should be evaluated over multiple seasons rather than only the 2016 stretch run.'
from public.transaction_events e
join public.sources standings
  on standings.url='https://www.thebaseballcube.com/content/box_date/20160801/'
join public.sources context
  on context.url='https://www.mlb.com/dodgers/news/dodgers-acquire-josh-reddick-rich-hill-c192999766'
where e.event_key='LAD_HOU_2016_ALVAREZ_FIELDS'
on conflict (event_id) do update set
  club_wins=excluded.club_wins,
  club_losses=excluded.club_losses,
  games_played=excluded.games_played,
  regular_season_games_remaining=excluded.regular_season_games_remaining,
  division_position=excluded.division_position,
  division_lead_games=excluded.division_lead_games,
  race_state=excluded.race_state,
  need_category=excluded.need_category,
  need_urgency=excluded.need_urgency,
  need_note=excluded.need_note,
  acquisition_horizon=excluded.acquisition_horizon,
  strategic_context_label=excluded.strategic_context_label,
  acquisition_season_postseason_result=excluded.acquisition_season_postseason_result,
  championship_window=excluded.championship_window,
  standings_source_id=excluded.standings_source_id,
  context_source_id=excluded.context_source_id,
  analyst_note=excluded.analyst_note,
  updated_at=now();

-- ===========================================================================
-- 4. 2017: CRUZ + GERMAN -> WATSON
-- Dodgers were 74-31 with a 14-game NL West lead.
-- MLB explicitly described the deadline bullpen additions as October-oriented.
-- ===========================================================================

insert into public.transaction_competitive_context (
  event_id,
  club_wins, club_losses, games_played, regular_season_games_remaining,
  division_position, division_lead_games, race_state,
  need_category, need_urgency, need_note,
  acquisition_horizon, strategic_context_label,
  acquisition_season_postseason_result, championship_window,
  standings_source_id, context_source_id, analyst_note
)
select
  e.id,
  74, 31, 105, 57,
  1, 14.0, 'DOMINANT_DIVISION_LEAD',
  'POSTSEASON_BULLPEN', 3,
  'The division was effectively under control; Watson was acquired primarily to deepen the October bullpen.',
  'SAME_SEASON_RENTAL',
  'OCTOBER_BULLPEN_OPTIMIZATION',
  'LOST_WORLD_SERIES',
  true,
  standings.id,
  context.id,
  'Regular-season standings pressure was low, but postseason leverage was high. Watson should be evaluated disproportionately on October utility rather than regular-season WAR alone.'
from public.transaction_events e
join public.sources standings
  on standings.url='https://www.baseball-reference.com/boxes/index.fcgi?date=2017-07-31'
join public.sources context
  on context.url='https://www.mlb.com/reds/news/dodgers-trade-for-yu-darvish-bolster-bullpen-c245570576'
where e.event_key='LAD_PIT_2017_CRUZ_WATSON'
on conflict (event_id) do update set
  club_wins=excluded.club_wins,
  club_losses=excluded.club_losses,
  games_played=excluded.games_played,
  regular_season_games_remaining=excluded.regular_season_games_remaining,
  division_position=excluded.division_position,
  division_lead_games=excluded.division_lead_games,
  race_state=excluded.race_state,
  need_category=excluded.need_category,
  need_urgency=excluded.need_urgency,
  need_note=excluded.need_note,
  acquisition_horizon=excluded.acquisition_horizon,
  strategic_context_label=excluded.strategic_context_label,
  acquisition_season_postseason_result=excluded.acquisition_season_postseason_result,
  championship_window=excluded.championship_window,
  standings_source_id=excluded.standings_source_id,
  context_source_id=excluded.context_source_id,
  analyst_note=excluded.analyst_note,
  updated_at=now();

-- ===========================================================================
-- 5. 2018: DIAZ PACKAGE -> MACHADO
-- Dodgers were 53-43 and held only a 0.5-game NL West lead.
-- Corey Seager had been lost for the season, creating a direct shortstop need.
-- Machado was a rental eligible for free agency after the season.
-- ===========================================================================

insert into public.transaction_competitive_context (
  event_id,
  club_wins, club_losses, games_played, regular_season_games_remaining,
  division_position, division_lead_games, race_state,
  need_category, need_urgency, need_note,
  acquisition_horizon, strategic_context_label,
  acquisition_season_postseason_result, championship_window,
  standings_source_id, context_source_id, analyst_note
)
select
  e.id,
  53, 43, 96, 66,
  1, 0.5, 'NARROW_DIVISION_LEAD',
  'STAR_SHORTSTOP_REPLACEMENT', 5,
  'Corey Seager was out for the season after Tommy John surgery; Machado directly filled an elite-value shortstop vacancy during a tight NL West race.',
  'SAME_SEASON_RENTAL',
  'DIVISION_RACE_STAR_REPLACEMENT',
  'LOST_WORLD_SERIES',
  true,
  standings.id,
  context.id,
  'This was the highest immediate roster-need case of the three tracked trades: narrow division margin, star injury replacement, and a premium rental acquired for the pennant race.'
from public.transaction_events e
join public.sources standings
  on standings.url='https://www.baseball-reference.com/boxes/index.fcgi?date=2018-07-19'
join public.sources context
  on context.url='https://www.mlb.com/dodgers/news/manny-machado-traded-to-dodgers-c286340444'
where e.event_key='LAD_BAL_2018_DIAZ_MACHADO'
on conflict (event_id) do update set
  club_wins=excluded.club_wins,
  club_losses=excluded.club_losses,
  games_played=excluded.games_played,
  regular_season_games_remaining=excluded.regular_season_games_remaining,
  division_position=excluded.division_position,
  division_lead_games=excluded.division_lead_games,
  race_state=excluded.race_state,
  need_category=excluded.need_category,
  need_urgency=excluded.need_urgency,
  need_note=excluded.need_note,
  acquisition_horizon=excluded.acquisition_horizon,
  strategic_context_label=excluded.strategic_context_label,
  acquisition_season_postseason_result=excluded.acquisition_season_postseason_result,
  championship_window=excluded.championship_window,
  standings_source_id=excluded.standings_source_id,
  context_source_id=excluded.context_source_id,
  analyst_note=excluded.analyst_note,
  updated_at=now();

-- ===========================================================================
-- 6. COMPETITIVE-CONTEXT VIEW
-- ===========================================================================

create or replace view public.v_dodgers_competitive_asset_conversion
with (security_invoker=true)
as
select
  t.event_key,
  t.transaction_date,
  t.disi_player,
  t.signing_bonus_usd,
  t.disi_player_later_career_war,
  t.incoming_asset_name,
  t.return_dodgers_regular_season_war,
  t.outgoing_asset_count,
  t.attribution_status,

  c.club_wins,
  c.club_losses,
  round(
    c.club_wins::numeric / nullif(c.club_wins + c.club_losses, 0),
    3
  ) as club_win_pct_at_trade,

  c.regular_season_games_remaining,
  c.division_position,
  c.division_lead_games,
  c.race_state,

  c.need_category,
  c.need_urgency,
  c.acquisition_horizon,
  c.strategic_context_label,
  c.acquisition_season_postseason_result,
  c.championship_window,

  case
    when c.need_urgency = 5 then 'CRITICAL_IMMEDIATE_NEED'
    when c.need_urgency = 4 then 'HIGH_IMMEDIATE_NEED'
    when c.need_urgency = 3 then 'POSTSEASON_OPTIMIZATION'
    else 'DEPTH_OR_OPTIONALITY'
  end as need_urgency_band,

  case
    when c.acquisition_horizon='SAME_SEASON_RENTAL'
         and c.acquisition_season_postseason_result='LOST_WORLD_SERIES'
      then 'HIGH_LEVERAGE_PENNANT_RETURN'
    when c.championship_window
      then 'CONTENDER_RETURN'
    else 'GENERAL_ROSTER_RETURN'
  end as realized_context_band,

  c.need_note,
  c.analyst_note,
  t.attribution_note,
  t.valuation_note

from public.v_dodgers_trade_package_conversion t
join public.transaction_events e on e.event_key=t.event_key
join public.transaction_competitive_context c on c.event_id=e.id;

grant select on public.v_dodgers_competitive_asset_conversion
to anon, authenticated;

-- ===========================================================================
-- 7. EXECUTIVE PORTFOLIO VIEW
-- One row per tracked DISI player involved in a trade conversion.
-- ===========================================================================

create or replace view public.v_dodgers_competitive_asset_brief
with (security_invoker=true)
as
select
  disi_player,
  transaction_date,
  signing_bonus_usd,
  disi_player_later_career_war,
  incoming_asset_name,
  return_dodgers_regular_season_war,

  club_wins,
  club_losses,
  division_lead_games,
  regular_season_games_remaining,

  strategic_context_label,
  need_urgency_band,
  acquisition_horizon,
  acquisition_season_postseason_result,
  attribution_status,

  case
    when disi_player_later_career_war >= 20
      then 'ELITE_IDENTIFICATION'
    when disi_player_later_career_war >= 5
      then 'HIGH_VALUE_IDENTIFICATION'
    when disi_player_later_career_war > 0
      then 'MLB_VALUE_IDENTIFICATION'
    else 'MLB_REACH_IDENTIFICATION'
  end as identification_signal,

  case
    when attribution_status='SOLE_OUTGOING_ASSET'
      and disi_player_later_career_war >= 20
      and coalesce(return_dodgers_regular_season_war,0) < 5
      then 'LARGE_EX_POST_VALUE_GAP'
    when attribution_status='SHARED_PACKAGE_RETURN'
      then 'PACKAGE_VALUE_REQUIRES_SHARED_ATTRIBUTION'
    else 'CONTEXT_DEPENDENT'
  end as ex_post_conversion_signal

from public.v_dodgers_competitive_asset_conversion;

grant select on public.v_dodgers_competitive_asset_brief
to anon, authenticated;

-- ===========================================================================
-- 8. VERIFICATION OUTPUT
-- ===========================================================================

select *
from public.v_dodgers_competitive_asset_brief
order by transaction_date;

select
  event_key,
  disi_player,
  incoming_asset_name,
  club_wins,
  club_losses,
  division_lead_games,
  regular_season_games_remaining,
  need_category,
  need_urgency,
  strategic_context_label,
  acquisition_horizon,
  acquisition_season_postseason_result,
  attribution_status
from public.v_dodgers_competitive_asset_conversion
order by transaction_date;
