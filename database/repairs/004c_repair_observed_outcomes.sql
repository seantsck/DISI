-- DISI repair: observed MLB outcomes after signing cohort repair.
-- Safe to run after 004b. Does not delete or replace signing rows.

-- 1) Ensure outcome organizations exist.
insert into public.organizations
  (name, abbreviation, organization_type, league, country)
values
  ('Houston Astros', 'HOU', 'MLB_CLUB', 'MLB', 'United States')
on conflict (name) do update set abbreviation='HOU';

insert into public.organizations
  (name, abbreviation, organization_type, league, country)
values
  ('Pittsburgh Pirates', 'PIT', 'MLB_CLUB', 'MLB', 'United States')
on conflict (name) do update set abbreviation='PIT';

insert into public.organizations
  (name, abbreviation, organization_type, league, country)
values
  ('Baltimore Orioles', 'BAL', 'MLB_CLUB', 'MLB', 'United States')
on conflict (name) do update set abbreviation='BAL';

-- 2) Ensure source rows exist.
insert into public.sources
  (source_name, source_type, title, url)
values
  ('Baseball-Reference','PLAYER_PAGE','Yordan Alvarez Stats',
   'https://www.baseball-reference.com/players/a/alvaryo01.shtml')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url)
values
  ('Baseball-Reference','PLAYER_PAGE','Oneil Cruz Stats',
   'https://www.baseball-reference.com/players/c/cruzon01.shtml')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url)
values
  ('Baseball-Reference','PLAYER_PAGE','Yusniel Diaz Stats',
   'https://www.baseball-reference.com/players/d/diazyu01.shtml')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url)
values
  ('Baseball-Reference','PLAYER_PAGE','Roki Sasaki Stats',
   'https://www.baseball-reference.com/players/s/sasakro01.shtml')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url)
values
  ('Baseball-Reference','PLAYER_PAGE','Josue De Paula Stats',
   'https://www.baseball-reference.com/players/d/depaujo03.shtml')
on conflict (url) do nothing;

-- 3) Normalize player DOBs used in time-to-MLB calculations.
update public.players set birth_date=date '1997-06-27'
where full_name='Yordan Alvarez';

update public.players set birth_date=date '1998-10-04'
where full_name='Oneil Cruz';

update public.players set birth_date=date '1996-10-07'
where full_name='Yusniel Diaz';

update public.players set birth_date=date '2001-11-03'
where full_name='Roki Sasaki';

update public.players set birth_date=date '2005-05-24'
where full_name='Josue De Paula';

-- 4) Restore signing dates needed for development-speed metrics.
update public.signings s
set signing_date=date '2015-07-02'
from public.players p
where s.player_id=p.id and p.full_name='Oneil Cruz';

update public.signings s
set signing_date=date '2016-06-15'
from public.players p
where s.player_id=p.id and p.full_name='Yordan Alvarez';

update public.signings s
set signing_date=date '2022-01-15'
from public.players p
where s.player_id=p.id and p.full_name='Josue De Paula';

update public.signings s
set signing_date=date '2025-01-22'
from public.players p
where s.player_id=p.id and p.full_name='Roki Sasaki';

-- 5) Upsert observed MLB outcomes.
insert into public.outcomes (
  player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
  career_war, current_status, outcome_through_season, source_id, confidence
)
select p.id, true, date '2019-06-09', o.id,
       30.9, 'ACTIVE_MLB', 2026, src.id,
       'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation='HOU'
join public.sources src
  on src.url='https://www.baseball-reference.com/players/a/alvaryo01.shtml'
where p.full_name='Yordan Alvarez'
on conflict (player_id) do update set
  reached_mlb=excluded.reached_mlb,
  mlb_debut_date=excluded.mlb_debut_date,
  mlb_debut_organization_id=excluded.mlb_debut_organization_id,
  career_war=excluded.career_war,
  current_status=excluded.current_status,
  outcome_through_season=excluded.outcome_through_season,
  source_id=excluded.source_id,
  confidence=excluded.confidence;

insert into public.outcomes (
  player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
  career_war, current_status, outcome_through_season, source_id, confidence
)
select p.id, true, date '2021-10-02', o.id,
       8.2, 'ACTIVE_MLB', 2026, src.id,
       'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation='PIT'
join public.sources src
  on src.url='https://www.baseball-reference.com/players/c/cruzon01.shtml'
where p.full_name='Oneil Cruz'
on conflict (player_id) do update set
  reached_mlb=excluded.reached_mlb,
  mlb_debut_date=excluded.mlb_debut_date,
  mlb_debut_organization_id=excluded.mlb_debut_organization_id,
  career_war=excluded.career_war,
  current_status=excluded.current_status,
  outcome_through_season=excluded.outcome_through_season,
  source_id=excluded.source_id,
  confidence=excluded.confidence;

insert into public.outcomes (
  player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
  mlb_games, mlb_pa, career_war, current_status,
  outcome_through_season, source_id, confidence
)
select p.id, true, date '2022-08-02', o.id,
       1, 1, 0.0, 'LAST_MLB_APPEARANCE_2022',
       2026, src.id, 'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation='BAL'
join public.sources src
  on src.url='https://www.baseball-reference.com/players/d/diazyu01.shtml'
where p.full_name='Yusniel Diaz'
on conflict (player_id) do update set
  reached_mlb=excluded.reached_mlb,
  mlb_debut_date=excluded.mlb_debut_date,
  mlb_debut_organization_id=excluded.mlb_debut_organization_id,
  mlb_games=excluded.mlb_games,
  mlb_pa=excluded.mlb_pa,
  career_war=excluded.career_war,
  current_status=excluded.current_status,
  outcome_through_season=excluded.outcome_through_season,
  source_id=excluded.source_id,
  confidence=excluded.confidence;

insert into public.outcomes (
  player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
  mlb_games, mlb_ip, career_war, current_status,
  outcome_through_season, source_id, confidence
)
select p.id, true, date '2025-03-19', o.id,
       36, 158.2, 1.1, 'ACTIVE_MLB',
       2026, src.id, 'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation='LAD'
join public.sources src
  on src.url='https://www.baseball-reference.com/players/s/sasakro01.shtml'
where p.full_name='Roki Sasaki'
on conflict (player_id) do update set
  reached_mlb=excluded.reached_mlb,
  mlb_debut_date=excluded.mlb_debut_date,
  mlb_debut_organization_id=excluded.mlb_debut_organization_id,
  mlb_games=excluded.mlb_games,
  mlb_ip=excluded.mlb_ip,
  career_war=excluded.career_war,
  current_status=excluded.current_status,
  outcome_through_season=excluded.outcome_through_season,
  source_id=excluded.source_id,
  confidence=excluded.confidence;

insert into public.outcomes (
  player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
  mlb_games, career_war, current_status,
  outcome_through_season, source_id, confidence
)
select p.id, true, date '2026-09-11', o.id,
       11, 0.5, 'REACHED_MLB_2026',
       2026, src.id, 'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation='LAD'
join public.sources src
  on src.url='https://www.baseball-reference.com/players/d/depaujo03.shtml'
where p.full_name='Josue De Paula'
on conflict (player_id) do update set
  reached_mlb=excluded.reached_mlb,
  mlb_debut_date=excluded.mlb_debut_date,
  mlb_debut_organization_id=excluded.mlb_debut_organization_id,
  mlb_games=excluded.mlb_games,
  career_war=excluded.career_war,
  current_status=excluded.current_status,
  outcome_through_season=excluded.outcome_through_season,
  source_id=excluded.source_id,
  confidence=excluded.confidence;

-- 6) Verify outcome rows exist.
select
  p.full_name,
  oc.reached_mlb,
  oc.mlb_debut_date,
  o.abbreviation as debut_org,
  oc.career_war
from public.outcomes oc
join public.players p on p.id=oc.player_id
left join public.organizations o on o.id=oc.mlb_debut_organization_id
where p.full_name in (
  'Yordan Alvarez','Oneil Cruz','Yusniel Diaz','Roki Sasaki','Josue De Paula'
)
order by oc.mlb_debut_date;

-- 7) Re-run Dodgers KPI view.
select *
from public.v_dodgers_executive_kpis;
