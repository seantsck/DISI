-- DISI v0.5
-- 016_historical_positive_outcomes_and_rate_guardrail.sql
-- Adds a large batch of verified MLB-reaching outcomes while preventing
-- individually researched successes from becoming a misleading "hit rate".
-- Run after 015.

-- ===========================================================================
-- 1. FRANCHISE IDENTITY
-- Brooklyn and Los Angeles are the same Dodgers franchise for value-realization
-- purposes, while preserving historically accurate debut organization labels.
-- ===========================================================================

alter table public.organizations
  add column if not exists franchise_key text;

update public.organizations
set franchise_key = case
  when abbreviation in ('BRO','LAD') then 'DODGERS'
  else coalesce(abbreviation, name)
end
where franchise_key is null
   or abbreviation in ('BRO','LAD');

insert into public.organizations
  (name, abbreviation, organization_type, league, country, franchise_key)
values
  ('Brooklyn Dodgers','BRO','MLB_CLUB','MLB','United States','DODGERS'),
  ('Pittsburgh Pirates','PIT','MLB_CLUB','MLB','United States','PIT'),
  ('Toronto Blue Jays','TOR','MLB_CLUB','MLB','Canada','TOR'),
  ('Cleveland Guardians','CLE','MLB_CLUB','MLB','United States','CLE'),
  ('New York Yankees','NYY','MLB_CLUB','MLB','United States','NYY'),
  ('San Francisco Giants','SFG','MLB_CLUB','MLB','United States','SFG')
on conflict (name) do update
set abbreviation=excluded.abbreviation,
    franchise_key=excluded.franchise_key;

update public.organizations
set franchise_key='DODGERS'
where abbreviation in ('BRO','LAD');

-- ===========================================================================
-- 2. PLAYER OUTCOME SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Sandy Amoros MLB record',
        'https://www.baseball-reference.com/players/a/amorosa01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Chico Fernandez MLB record',
        'https://www.baseball-reference.com/leagues/majors/1956-debuts.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Roberto Clemente MLB record',
        'https://www.baseball-reference.com/players/c/clemero01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Fernando Valenzuela MLB record',
        'https://www.baseball-reference.com/players/v/valenfe01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Ramon Martinez MLB record',
        'https://www.baseball-reference.com/players/m/martira02.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Juan Guzman MLB record',
        'https://www.baseball-reference.com/players/g/guzmaju01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Jose Vizcaino MLB record',
        'https://www.baseball-reference.com/players/v/vizcajo01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Jose Offerman MLB record',
        'https://www.baseball-reference.com/leagues/majors/1990-debuts.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Pedro Astacio MLB record',
        'https://www.baseball-reference.com/players/a/astacpe01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Pedro Martinez MLB record',
        'https://www.baseball-reference.com/players/m/martipe02.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Raul Mondesi MLB record',
        'https://www.baseball-reference.com/players/m/mondera01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Omar Daal MLB record',
        'https://www.baseball-reference.com/players/d/daalom01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Antonio Osuna MLB record',
        'https://www.baseball-reference.com/players/o/osunaan01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Ismael Valdez MLB record',
        'https://www.baseball-reference.com/players/v/valdeis01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Juan Castro MLB record',
        'https://www.baseball-reference.com/players/c/castrju01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Karim Garcia MLB record',
        'https://www.baseball-reference.com/players/g/garcika01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Chan Ho Park MLB record',
        'https://www.baseball-reference.com/players/p/parkch01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Adrian Beltre MLB record',
        'https://www.baseball-reference.com/players/b/beltrad01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Hideo Nomo MLB record',
        'https://www.baseball-reference.com/players/n/nomohi01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Hung-Chih Kuo MLB record',
        'https://www.baseball-reference.com/players/k/kuoho01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Willy Aybar MLB record',
        'https://www.baseball-reference.com/players/a/aybarwi01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Ramon Troncoso MLB record',
        'https://www.baseball-reference.com/players/t/troncra01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Tony Abreu MLB record',
        'https://www.baseball-reference.com/players/a/abreuto01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Chin-lung Hu MLB record',
        'https://www.baseball-reference.com/players/h/huch01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Elian Herrera MLB record',
        'https://www.baseball-reference.com/players/h/herreel01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Kenley Jansen MLB record',
        'https://www.baseball-reference.com/players/j/janseke01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Carlos Santana MLB record',
        'https://www.baseball-reference.com/players/s/santaca01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Pedro Baez MLB record',
        'https://www.baseball-reference.com/players/b/baezpe01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Rubby De La Rosa MLB record',
        'https://www.baseball-reference.com/players/d/delarru01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Jose Dominguez MLB record',
        'https://www.baseball-reference.com/players/d/dominjo01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Yasiel Puig MLB record',
        'https://www.baseball-reference.com/players/p/puigya01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Victor Gonzalez MLB record',
        'https://www.baseball-reference.com/players/g/gonzavi02.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Julio Urias MLB record',
        'https://www.baseball-reference.com/players/u/uriasju01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Hyun-Jin Ryu MLB record',
        'https://www.baseball-reference.com/players/r/ryuhy01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Keibert Ruiz MLB record',
        'https://www.baseball-reference.com/players/r/ruizke01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Andy Pages MLB record',
        'https://www.baseball-reference.com/players/p/pagesan01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Miguel Vargas MLB record',
        'https://www.baseball-reference.com/players/v/vargami01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'PLAYER_PAGE',
        'Jorbit Vivas MLB record',
        'https://www.baseball-reference.com/players/v/vivasjo01.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com',
        'PLAYER_PAGE',
        'Eddys Leonard MLB record',
        'https://www.mlb.com/player/eddys-leonard-678760')
on conflict (url) do nothing;

-- ===========================================================================
-- 3. VERIFIED POSITIVE MLB OUTCOMES
-- career_war is observed Baseball-Reference WAR through the cited source's
-- current 2026 snapshot; for active players it is not a final-career value.
-- ===========================================================================

with seed(
  full_name, mlb_debut_date, debut_org_abbr, career_war,
  source_url, current_status
) as (
  values
('Sandy Amoros','1952-08-22','BRO',7.4,'https://www.baseball-reference.com/players/a/amorosa01.shtml','RETIRED'),
('Chico Fernandez','1956-07-14','BRO',-2.4,'https://www.baseball-reference.com/leagues/majors/1956-debuts.shtml','RETIRED'),
('Roberto Clemente','1955-04-17','PIT',95.0,'https://www.baseball-reference.com/players/c/clemero01.shtml','HOF'),
('Fernando Valenzuela','1980-09-15','LAD',41.5,'https://www.baseball-reference.com/players/v/valenfe01.shtml','RETIRED'),
('Ramon Martinez','1988-08-13','LAD',25.9,'https://www.baseball-reference.com/players/m/martira02.shtml','RETIRED'),
('Juan Guzman','1991-06-07','TOR',24.3,'https://www.baseball-reference.com/players/g/guzmaju01.shtml','RETIRED'),
('Jose Vizcaino','1989-09-10','LAD',7.0,'https://www.baseball-reference.com/players/v/vizcajo01.shtml','RETIRED'),
('Jose Offerman','1990-08-19','LAD',17.1,'https://www.baseball-reference.com/leagues/majors/1990-debuts.shtml','RETIRED'),
('Pedro Astacio','1992-07-03','LAD',25.6,'https://www.baseball-reference.com/players/a/astacpe01.shtml','RETIRED'),
('Pedro Martinez','1992-09-24','LAD',83.9,'https://www.baseball-reference.com/players/m/martipe02.shtml','HOF'),
('Raul Mondesi','1993-07-19','LAD',29.5,'https://www.baseball-reference.com/players/m/mondera01.shtml','RETIRED'),
('Omar Daal','1993-04-23','LAD',8.7,'https://www.baseball-reference.com/players/d/daalom01.shtml','RETIRED'),
('Antonio Osuna','1995-04-25','LAD',6.1,'https://www.baseball-reference.com/players/o/osunaan01.shtml','RETIRED'),
('Ismael Valdez','1994-06-15','LAD',24.1,'https://www.baseball-reference.com/players/v/valdeis01.shtml','RETIRED'),
('Juan Castro','1995-09-02','LAD',-5.4,'https://www.baseball-reference.com/players/c/castrju01.shtml','RETIRED'),
('Karim Garcia','1995-09-02','LAD',-3.3,'https://www.baseball-reference.com/players/g/garcika01.shtml','RETIRED'),
('Chan Ho Park','1994-04-08','LAD',19.9,'https://www.baseball-reference.com/players/p/parkch01.shtml','RETIRED'),
('Adrian Beltre','1998-06-24','LAD',93.7,'https://www.baseball-reference.com/players/b/beltrad01.shtml','HOF'),
('Hideo Nomo','1995-05-02','LAD',20.9,'https://www.baseball-reference.com/players/n/nomohi01.shtml','RETIRED'),
('Hung-Chih Kuo','2005-09-02','LAD',5.1,'https://www.baseball-reference.com/players/k/kuoho01.shtml','RETIRED'),
('Willy Aybar','2005-08-31','LAD',2.7,'https://www.baseball-reference.com/players/a/aybarwi01.shtml','RETIRED'),
('Ramon Troncoso','2008-04-01','LAD',0.8,'https://www.baseball-reference.com/players/t/troncra01.shtml','RETIRED'),
('Tony Abreu','2007-05-22','LAD',-0.4,'https://www.baseball-reference.com/players/a/abreuto01.shtml','RETIRED'),
('Chin-lung Hu','2007-09-01','LAD',-0.3,'https://www.baseball-reference.com/players/h/huch01.shtml','RETIRED'),
('Elian Herrera','2012-05-15','LAD',0.7,'https://www.baseball-reference.com/players/h/herreel01.shtml','RETIRED'),
('Kenley Jansen','2010-07-24','LAD',24.9,'https://www.baseball-reference.com/players/j/janseke01.shtml','ACTIVE_MLB_2026'),
('Carlos Santana','2010-06-11','CLE',38.8,'https://www.baseball-reference.com/players/s/santaca01.shtml','ACTIVE_MLB_2026'),
('Pedro Baez','2014-05-05','LAD',3.5,'https://www.baseball-reference.com/players/b/baezpe01.shtml','LAST_MLB_2022'),
('Rubby De La Rosa','2011-05-24','LAD',1.3,'https://www.baseball-reference.com/players/d/delarru01.shtml','LAST_MLB_2017'),
('Jose Dominguez','2013-06-30','LAD',-0.4,'https://www.baseball-reference.com/players/d/dominjo01.shtml','LAST_MLB_2016'),
('Yasiel Puig','2013-06-03','LAD',18.8,'https://www.baseball-reference.com/players/p/puigya01.shtml','LAST_MLB_2019'),
('Victor Gonzalez','2020-07-31','LAD',1.4,'https://www.baseball-reference.com/players/g/gonzavi02.shtml','LAST_MLB_2024'),
('Julio Urias','2016-05-27','LAD',13.8,'https://www.baseball-reference.com/players/u/uriasju01.shtml','LAST_MLB_2023'),
('Hyun-Jin Ryu','2013-04-02','LAD',20.2,'https://www.baseball-reference.com/players/r/ryuhy01.shtml','LAST_MLB_2023'),
('Keibert Ruiz','2020-08-16','LAD',6.9,'https://www.baseball-reference.com/players/r/ruizke01.shtml','ACTIVE_MLB_2026'),
('Andy Pages','2024-04-16','LAD',10.9,'https://www.baseball-reference.com/players/p/pagesan01.shtml','ACTIVE_MLB_2026'),
('Miguel Vargas','2022-08-03','LAD',6.2,'https://www.baseball-reference.com/players/v/vargami01.shtml','ACTIVE_MLB_2026'),
('Jorbit Vivas','2025-05-02','NYY',0.5,'https://www.baseball-reference.com/players/v/vivasjo01.shtml','ACTIVE_MLB_2026'),
('Eddys Leonard','2026-08-04','SFG',-0.2,'https://www.mlb.com/player/eddys-leonard-678760','ACTIVE_MLB_2026')
)
insert into public.outcomes (
  player_id,
  reached_mlb,
  mlb_debut_date,
  mlb_debut_organization_id,
  career_war,
  current_status,
  outcome_through_season,
  source_id,
  confidence
)
select
  p.id,
  true,
  seed.mlb_debut_date::date,
  debut.id,
  seed.career_war::numeric,
  seed.current_status,
  2026,
  src.id,
  'VERIFIED'::public.confidence_level
from seed
join public.players p on p.full_name=seed.full_name
join public.organizations debut on debut.abbreviation=seed.debut_org_abbr
join public.sources src on src.url=seed.source_url
where exists (
  select 1
  from public.signings s
  join public.organizations o on o.id=s.organization_id
  where s.player_id=p.id and o.abbreviation='LAD'
)
on conflict (player_id) do update set
  reached_mlb=true,
  mlb_debut_date=coalesce(public.outcomes.mlb_debut_date, excluded.mlb_debut_date),
  mlb_debut_organization_id=coalesce(public.outcomes.mlb_debut_organization_id, excluded.mlb_debut_organization_id),
  career_war=excluded.career_war,
  current_status=excluded.current_status,
  outcome_through_season=greatest(coalesce(public.outcomes.outcome_through_season,0), excluded.outcome_through_season),
  source_id=excluded.source_id,
  confidence='VERIFIED'::public.confidence_level;

with seed(full_name, source_url) as (
  values
('Sandy Amoros','https://www.baseball-reference.com/players/a/amorosa01.shtml'),
('Chico Fernandez','https://www.baseball-reference.com/leagues/majors/1956-debuts.shtml'),
('Roberto Clemente','https://www.baseball-reference.com/players/c/clemero01.shtml'),
('Fernando Valenzuela','https://www.baseball-reference.com/players/v/valenfe01.shtml'),
('Ramon Martinez','https://www.baseball-reference.com/players/m/martira02.shtml'),
('Juan Guzman','https://www.baseball-reference.com/players/g/guzmaju01.shtml'),
('Jose Vizcaino','https://www.baseball-reference.com/players/v/vizcajo01.shtml'),
('Jose Offerman','https://www.baseball-reference.com/leagues/majors/1990-debuts.shtml'),
('Pedro Astacio','https://www.baseball-reference.com/players/a/astacpe01.shtml'),
('Pedro Martinez','https://www.baseball-reference.com/players/m/martipe02.shtml'),
('Raul Mondesi','https://www.baseball-reference.com/players/m/mondera01.shtml'),
('Omar Daal','https://www.baseball-reference.com/players/d/daalom01.shtml'),
('Antonio Osuna','https://www.baseball-reference.com/players/o/osunaan01.shtml'),
('Ismael Valdez','https://www.baseball-reference.com/players/v/valdeis01.shtml'),
('Juan Castro','https://www.baseball-reference.com/players/c/castrju01.shtml'),
('Karim Garcia','https://www.baseball-reference.com/players/g/garcika01.shtml'),
('Chan Ho Park','https://www.baseball-reference.com/players/p/parkch01.shtml'),
('Adrian Beltre','https://www.baseball-reference.com/players/b/beltrad01.shtml'),
('Hideo Nomo','https://www.baseball-reference.com/players/n/nomohi01.shtml'),
('Hung-Chih Kuo','https://www.baseball-reference.com/players/k/kuoho01.shtml'),
('Willy Aybar','https://www.baseball-reference.com/players/a/aybarwi01.shtml'),
('Ramon Troncoso','https://www.baseball-reference.com/players/t/troncra01.shtml'),
('Tony Abreu','https://www.baseball-reference.com/players/a/abreuto01.shtml'),
('Chin-lung Hu','https://www.baseball-reference.com/players/h/huch01.shtml'),
('Elian Herrera','https://www.baseball-reference.com/players/h/herreel01.shtml'),
('Kenley Jansen','https://www.baseball-reference.com/players/j/janseke01.shtml'),
('Carlos Santana','https://www.baseball-reference.com/players/s/santaca01.shtml'),
('Pedro Baez','https://www.baseball-reference.com/players/b/baezpe01.shtml'),
('Rubby De La Rosa','https://www.baseball-reference.com/players/d/delarru01.shtml'),
('Jose Dominguez','https://www.baseball-reference.com/players/d/dominjo01.shtml'),
('Yasiel Puig','https://www.baseball-reference.com/players/p/puigya01.shtml'),
('Victor Gonzalez','https://www.baseball-reference.com/players/g/gonzavi02.shtml'),
('Julio Urias','https://www.baseball-reference.com/players/u/uriasju01.shtml'),
('Hyun-Jin Ryu','https://www.baseball-reference.com/players/r/ryuhy01.shtml'),
('Keibert Ruiz','https://www.baseball-reference.com/players/r/ruizke01.shtml'),
('Andy Pages','https://www.baseball-reference.com/players/p/pagesan01.shtml'),
('Miguel Vargas','https://www.baseball-reference.com/players/v/vargami01.shtml'),
('Jorbit Vivas','https://www.baseball-reference.com/players/v/vivasjo01.shtml'),
('Eddys Leonard','https://www.mlb.com/player/eddys-leonard-678760')
)
insert into public.outcome_audits (
  player_id,
  audited_through_date,
  reached_mlb_verified,
  source_id,
  confidence,
  audit_note
)
select
  p.id,
  date '2026-10-03',
  true,
  src.id,
  'VERIFIED'::public.confidence_level,
  'MLB regular-season debut verified from cited player record.'
from seed
join public.players p on p.full_name=seed.full_name
join public.sources src on src.url=seed.source_url
where exists (
  select 1
  from public.signings s
  join public.organizations o on o.id=s.organization_id
  where s.player_id=p.id and o.abbreviation='LAD'
)
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=true,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

-- ===========================================================================
-- 4. KNOWN MLB OUTCOME VIEW
-- This is a CASE-STUDY / VALUE view. It is not a denominator for hit rates.
-- ===========================================================================

create or replace view public.v_dodgers_known_mlb_outcomes
with (security_invoker=true)
as
select
  u.player_id,
  u.full_name,
  u.signing_year,
  u.signing_date,
  u.country_market,
  u.pathway,
  u.primary_position,
  u.total_known_acquisition_cost_usd,
  u.record_scope,
  u.mlb_debut_date,
  u.mlb_debut_org,
  debut_org.franchise_key as debut_franchise_key,
  (debut_org.franchise_key='DODGERS') as direct_dodgers_franchise_debut,
  u.career_war,
  o.current_status,
  o.outcome_through_season
from public.v_dodgers_portfolio_universe u
join public.outcomes o on o.player_id=u.player_id
left join public.organizations debut_org
  on debut_org.abbreviation=u.mlb_debut_org
where u.reached_mlb_verified is true
order by u.career_war desc nulls last, u.signing_year;

grant select on public.v_dodgers_known_mlb_outcomes
to anon, authenticated;

-- ===========================================================================
-- 5. CLASS-LEVEL RATE ELIGIBILITY
-- A signing-year hit rate is eligible only when:
--   a) the signing population is explicitly complete,
--   b) every tracked player in that class has an outcome audit, and
--   c) the class is at least five years old.
-- Historical verified / top-prospect samples can never silently become rates.
-- ===========================================================================

create or replace view public.v_dodgers_class_analysis_eligibility
with (security_invoker=true)
as
with coverage as (
  select
    c.period_start_year as signing_year,
    bool_or(
      c.coverage_type='COMPLETE_CENSUS'
      and c.expected_signings is not null
      and c.tracked_signings >= c.expected_signings
    ) as signing_population_complete,
    max(c.expected_signings) filter (where c.coverage_type='COMPLETE_CENSUS')
      as expected_signings
  from public.signing_census_coverage c
  join public.organizations o on o.id=c.organization_id
  where o.abbreviation='LAD'
    and c.period_start_year=c.period_end_year
  group by c.period_start_year
)
select
  p.signing_year,
  p.tracked_signings,
  p.audited_outcomes,
  p.verified_mlb_players,
  p.outcome_queue,
  p.audit_completion_pct,
  coalesce(c.signing_population_complete,false)
    as signing_population_complete,
  (p.audited_outcomes=p.tracked_signings and p.tracked_signings>0)
    as outcome_population_complete,
  (p.signing_year <= extract(year from current_date)::int - 5)
    as mature_5yr,
  (
    coalesce(c.signing_population_complete,false)
    and p.audited_outcomes=p.tracked_signings
    and p.tracked_signings>0
    and p.signing_year <= extract(year from current_date)::int - 5
  ) as rate_eligible,
  case
    when p.signing_year > extract(year from current_date)::int - 5
      then 'NOT_YET_FIVE_YEAR_MATURE'
    when not coalesce(c.signing_population_complete,false)
      then 'SIGNING_POPULATION_INCOMPLETE'
    when p.audited_outcomes <> p.tracked_signings
      then 'OUTCOME_AUDIT_INCOMPLETE'
    else 'RATE_ELIGIBLE'
  end as exclusion_reason
from public.v_dodgers_class_research_progress p
left join coverage c on c.signing_year=p.signing_year
order by p.signing_year;

grant select on public.v_dodgers_class_analysis_eligibility
to anon, authenticated;

create or replace view public.v_dodgers_rate_eligible_player_analysis
with (security_invoker=true)
as
select u.*
from public.v_dodgers_portfolio_universe u
join public.v_dodgers_class_analysis_eligibility e
  on e.signing_year=u.signing_year
where e.rate_eligible;

grant select on public.v_dodgers_rate_eligible_player_analysis
to anon, authenticated;

create or replace view public.v_dodgers_rate_eligible_summary
with (security_invoker=true)
as
select
  count(distinct e.signing_year) filter (where e.rate_eligible)
    as rate_eligible_classes,
  count(r.player_id) as rate_eligible_signings,
  count(r.player_id) filter (where r.reached_mlb_verified is true)
    as verified_mlb_players,
  case
    when count(r.player_id)>0
    then round(
      count(r.player_id) filter (where r.reached_mlb_verified is true)::numeric
      / count(r.player_id),
      4
    )
    else null
  end as verified_mlb_reach_rate,
  round(sum(r.total_known_acquisition_cost_usd)::numeric,2)
    as known_acquisition_cost_usd,
  round(sum(r.career_war) filter (where r.career_war is not null)::numeric,2)
    as observed_career_war
from public.v_dodgers_class_analysis_eligibility e
left join public.v_dodgers_rate_eligible_player_analysis r
  on r.signing_year=e.signing_year;

grant select on public.v_dodgers_rate_eligible_summary
to anon, authenticated;

-- ===========================================================================
-- 6. FRANCHISE-AWARE ASSET REALIZATION
-- ===========================================================================

create or replace view public.v_dodgers_mature_asset_realization
with (security_invoker = true)
as
select
  m.player_id,
  m.full_name,
  m.signing_year,
  m.signing_bonus_usd,
  m.reached_mlb_verified,
  m.mlb_debut_org,
  m.career_war,
  tx.transaction_date as pre_mlb_disposition_date,
  tx.transaction_type as pre_mlb_disposition_type,
  tx.return_description,
  case
    when m.reached_mlb_verified is false
      then 'NO_VERIFIED_MLB_DEBUT'
    when debut_org.franchise_key='DODGERS'
      then 'DIRECT_DODGERS_MLB_DEBUT'
    when tx.transaction_type='TRADE'
      then 'TRADED_BEFORE_MLB_DEBUT'
    when tx.transaction_type='RELEASE'
      then 'RELEASED_BEFORE_MLB_DEBUT'
    when coalesce(debut_org.franchise_key,m.mlb_debut_org) <> 'DODGERS'
      then 'LEFT_ORGANIZATION_BEFORE_MLB_DEBUT'
    else 'OTHER'
  end as realization_channel
from public.v_dodgers_mature_player_analysis m
left join public.organizations debut_org
  on debut_org.abbreviation=m.mlb_debut_org
left join lateral (
  select
    t.transaction_date,
    t.transaction_type,
    t.return_description
  from public.transactions t
  join public.organizations o
    on o.id=t.from_organization_id
  where t.player_id=m.player_id
    and o.franchise_key='DODGERS'
  order by t.transaction_date
  limit 1
) tx on true;

grant select on public.v_dodgers_mature_asset_realization
to anon, authenticated;

-- ===========================================================================
-- 7. VERIFICATION
-- ===========================================================================

select
  (select count(*) from public.v_dodgers_portfolio_universe) as tracked_signings,
  (select count(*) from public.outcome_audits) as total_outcome_audits,
  (select count(*) from public.v_dodgers_known_mlb_outcomes) as verified_mlb_outcomes,
  (select rate_eligible_classes from public.v_dodgers_rate_eligible_summary)
    as rate_eligible_classes;

select *
from public.v_dodgers_rate_eligible_summary;

select
  signing_year,
  tracked_signings,
  audited_outcomes,
  signing_population_complete,
  outcome_population_complete,
  mature_5yr,
  rate_eligible,
  exclusion_reason
from public.v_dodgers_class_analysis_eligibility
order by signing_year;

select
  full_name,
  signing_year,
  country_market,
  mlb_debut_org,
  direct_dodgers_franchise_debut,
  career_war
from public.v_dodgers_known_mlb_outcomes
order by career_war desc nulls last
limit 50;
