-- DISI v0.2
-- 012_historical_census_framework.sql
-- Extends the database backward and adds explicit coverage metadata.
-- Run after 011.
--
-- IMPORTANT:
-- Historical verified records are NOT presented as a complete census.
-- Coverage status is stored explicitly so "tracked" cannot be mistaken for "all."

-- 1. Allow historical signing years before 1990.
alter table public.signing_environments
  drop constraint if exists signing_environments_signing_year_check;
alter table public.signing_environments
  add constraint signing_environments_signing_year_check
  check (signing_year between 1900 and 2100);

alter table public.signings
  drop constraint if exists signings_signing_year_check;
alter table public.signings
  add constraint signings_signing_year_check
  check (signing_year between 1900 and 2100);

-- 2. Classify why a signing row is in DISI.
alter table public.signings
  add column if not exists record_scope text not null default 'TRACKED';

alter table public.signings
  drop constraint if exists signings_record_scope_check;
alter table public.signings
  add constraint signings_record_scope_check check (
    record_scope in (
      'TRACKED',
      'TRACKED_DODGERS',
      'HISTORICAL_VERIFIED',
      'MLB_PIPELINE_TOP_PROSPECT',
      'COMPLETE_CENSUS'
    )
  );

update public.signings s
set record_scope='TRACKED_DODGERS'
from public.organizations o
where s.organization_id=o.id
  and o.abbreviation='LAD'
  and s.record_scope='TRACKED';

-- 3. Coverage registry: makes completeness inspectable.
create table if not exists public.signing_census_coverage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  period_start_year int not null,
  period_end_year int not null,
  coverage_type text not null check (
    coverage_type in ('COMPLETE_CENSUS','PARTIAL_CENSUS','TOP_PROSPECT_SAMPLE','HISTORICAL_VERIFIED')
  ),
  expected_signings integer,
  tracked_signings integer not null default 0,
  source_id uuid references public.sources(id) on delete set null,
  notes text,
  updated_at timestamptz not null default now(),
  unique(organization_id, period_start_year, period_end_year, coverage_type)
);

alter table public.signing_census_coverage enable row level security;
revoke all on table public.signing_census_coverage from anon, authenticated;
grant select on table public.signing_census_coverage to anon, authenticated;

drop policy if exists public_read_signing_census_coverage
  on public.signing_census_coverage;
create policy public_read_signing_census_coverage
on public.signing_census_coverage
for select to anon, authenticated
using (true);

-- 4. Sources.
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/friv/transactions.cgi?date=06-06')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/friv/transactions.cgi?date=08-24')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/1979-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/1984-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/1987-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/1988-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/1991-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/1994-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/1999-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/2000-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/2002-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/2003-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/2004-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('Baseball-Reference',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.baseball-reference.com/leagues/majors/2007-transactions.shtml')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.mlb.com/dodgers/news/dodgers-announce-four-international-signings/c-34332890')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.mlb.com/news/dodgers-sign-puig-to-seven-year-deal/c-33960778')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.mlb.com/news/dodgers-will-call-up-julio-urias-on-friday-c180357772')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.mlb.com/news/hideo-nomo-tornado-season/c-132379246')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.mlb.com/news/jim-callis-look-at-how-the-los-angeles-dodgers-playoff-roster-was-built/c-62031828')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com',
        'HISTORICAL_SIGNING_RECORD',
        'Historical international signing record',
        'https://www.mlb.com/pirates/news/korean-born-players-top-moments-in-mlb')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values ('MLB.com',
        'HISTORICAL_SIGNING_RECORD',
        'Fernando Valenzuela historical signing record',
        'https://www.mlb.com/es/news/fallecio-fernando-valenzuela')
on conflict (url) do nothing;

-- 5. Historical Dodgers player identities.
insert into public.players
  (full_name, canonical_name, birth_country, primary_position)
select v.full_name, v.canonical_name, v.birth_country, v.primary_position
from (
  values
  ('Fernando Valenzuela','Fernando Valenzuela','Mexico','LHP'),
('Ramon Martinez','Ramon Martinez','Dominican Republic','RHP'),
('Pedro Astacio','Pedro Astacio','Dominican Republic','RHP'),
('Raul Mondesi','Raul Mondesi','Dominican Republic','OF'),
('Pedro Martinez','Pedro Martinez','Dominican Republic','RHP'),
('Omar Daal','Omar Daal','Venezuela','LHP'),
('Roger Cedeno','Roger Cedeno','Venezuela','OF'),
('Chan Ho Park','Chan Ho Park','South Korea','RHP'),
('Adrian Beltre','Adrian Beltre','Dominican Republic','3B'),
('Hideo Nomo','Hideo Nomo','Japan','RHP'),
('Hung-Chih Kuo','Hung-Chih Kuo','Taiwan','LHP'),
('Willy Aybar','Willy Aybar','Dominican Republic','INF'),
('Ramon Troncoso','Ramon Troncoso','Dominican Republic','RHP'),
('Tony Abreu','Tony Abreu','Dominican Republic','INF'),
('Chin-lung Hu','Chin-lung Hu','Taiwan','SS'),
('Elian Herrera','Elian Herrera','Dominican Republic','UTIL'),
('Kenley Jansen','Kenley Jansen','Curacao','C'),
('Carlos Santana','Carlos Santana','Dominican Republic','C'),
('Carlos Frias','Carlos Frias','Dominican Republic','RHP'),
('Pedro Baez','Pedro Baez','Dominican Republic','3B'),
('Rubby De La Rosa','Rubby De La Rosa','Dominican Republic','RHP'),
('Jose Dominguez','Jose Dominguez','Dominican Republic','RHP'),
('Yasiel Puig','Yasiel Puig','Cuba','OF'),
('Lenix Osuna','Lenix Osuna','Mexico','RHP'),
('Victor Gonzalez','Victor Gonzalez','Mexico','LHP'),
('William Soto','William Soto','Venezuela','RHP'),
('Julian Leon','Julian Leon','Mexico','C'),
('Julio Urias','Julio Urias','Mexico','LHP'),
('Hyun-Jin Ryu','Hyun-Jin Ryu','South Korea','LHP'),
('Shakir Albert','Shakir Albert','Curacao','OF'),
('Hendrik Clementina','Hendrik Clementina','Curacao','C'),
('Julio Lugo (prospect)','Julio Lugo','Dominican Republic','OF'),
('Gersel Pitre','Gersel Pitre','Venezuela','C'),
('Misja Harcksen','Misja Harcksen','Netherlands','RHP')
) as v(full_name, canonical_name, birth_country, primary_position)
where not exists (
  select 1 from public.players p where p.full_name=v.full_name
);

-- 6. Historical Dodgers signings.
with seed(
  full_name, signing_year, signing_date, country_market, pathway,
  source_league, source_club, signing_bonus_usd, transfer_fee_usd,
  source_url, evidence_note
) as (
  values
  ('Fernando Valenzuela',1979,'1979-07-06','Mexico','MEXICAN_LEAGUE_TRANSFER','Mexican League','Yucatan',null,null,'https://www.baseball-reference.com/leagues/majors/1979-transactions.shtml','Baseball-Reference records the Dodgers purchasing Valenzuela from Yucatan.'),
('Ramon Martinez',1984,'1984-09-01','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/1984-transactions.shtml','Baseball-Reference records the Dodgers signing Ramon Martinez as an amateur free agent.'),
('Pedro Astacio',1987,'1987-11-21','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/1987-transactions.shtml','Baseball-Reference records the Dodgers signing Pedro Astacio as an amateur free agent.'),
('Raul Mondesi',1988,'1988-06-06','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/friv/transactions.cgi?date=06-06','Baseball-Reference records the Dodgers signing Raul Mondesi as an amateur free agent.'),
('Pedro Martinez',1988,'1988-06-18','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/1988-transactions.shtml','Baseball-Reference records the Dodgers signing Pedro Martinez as an amateur free agent.'),
('Omar Daal',1990,'1990-08-24','Venezuela','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/friv/transactions.cgi?date=08-24','Baseball-Reference records the Dodgers signing Omar Daal as an amateur free agent.'),
('Roger Cedeno',1991,'1991-03-03','Venezuela','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/1991-transactions.shtml','Baseball-Reference records the Dodgers signing Roger Cedeno as an amateur free agent.'),
('Chan Ho Park',1994,'1994-01-14','South Korea','KOREA_AMATEUR',null,'Hanyang University',1200000,null,'https://www.mlb.com/pirates/news/korean-born-players-top-moments-in-mlb','MLB records Park signing with the Dodgers on Jan. 14, 1994 with a $1.2 million signing bonus.'),
('Adrian Beltre',1994,'1994-07-07','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/1994-transactions.shtml','Baseball-Reference records the Dodgers signing Adrian Beltre as an amateur free agent.'),
('Hideo Nomo',1995,'1995-02-13','Japan','JAPAN_PRO','NPB','Kintetsu Buffaloes',2000000,null,'https://www.mlb.com/news/hideo-nomo-tornado-season/c-132379246','MLB reports Nomo signed with the Dodgers after retiring from Japanese professional baseball and received a $2 million signing bonus.'),
('Hung-Chih Kuo',1999,'1999-06-19','Taiwan','OTHER',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/1999-transactions.shtml','Baseball-Reference records the Dodgers signing Hung-Chih Kuo as an amateur free agent.'),
('Willy Aybar',2000,'2000-01-31','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2000-transactions.shtml','Baseball-Reference records the Dodgers signing Willy Aybar as an amateur free agent.'),
('Ramon Troncoso',2002,'2002-06-20','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2002-transactions.shtml','Baseball-Reference records the Dodgers signing Ramon Troncoso as an amateur free agent.'),
('Tony Abreu',2002,'2002-10-17','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2002-transactions.shtml','Baseball-Reference records the Dodgers signing Tony Abreu as an amateur free agent.'),
('Chin-lung Hu',2003,'2003-01-31','Taiwan','OTHER',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2003-transactions.shtml','Baseball-Reference records the Dodgers signing Chin-lung Hu as an amateur free agent.'),
('Elian Herrera',2003,'2003-05-14','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2003-transactions.shtml','Baseball-Reference records the Dodgers signing Elian Herrera as an amateur free agent.'),
('Kenley Jansen',2004,'2004-11-17','Curacao','LATAM_AMATEUR',null,null,85000,null,'https://www.mlb.com/news/jim-callis-look-at-how-the-los-angeles-dodgers-playoff-roster-was-built/c-62031828','MLB reports Jansen signed out of Curacao for $85,000 in 2004; he later converted from catcher to pitcher.'),
('Carlos Santana',2004,'2004-08-13','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2004-transactions.shtml','Baseball-Reference records the Dodgers signing Carlos Santana as an amateur free agent.'),
('Carlos Frias',2007,'2007-01-03','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2007-transactions.shtml','Baseball-Reference records the Dodgers signing Carlos Frias as an amateur free agent.'),
('Pedro Baez',2007,'2007-01-22','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2007-transactions.shtml','Baseball-Reference records the Dodgers signing Pedro Baez as an amateur free agent; he later converted to pitching.'),
('Rubby De La Rosa',2007,'2007-07-02','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2007-transactions.shtml','Baseball-Reference records the Dodgers signing Rubby De La Rosa as an amateur free agent.'),
('Jose Dominguez',2007,'2007-07-02','Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.baseball-reference.com/leagues/majors/2007-transactions.shtml','Baseball-Reference records the Dodgers signing Jose Dominguez as an amateur free agent.'),
('Yasiel Puig',2012,'2012-06-29','Cuba','CUBAN_PRO','Serie Nacional','Cienfuegos',12000000,null,'https://www.mlb.com/news/dodgers-sign-puig-to-seven-year-deal/c-33960778','MLB announced Puig''s seven-year deal; contemporaneous MLB reporting identifies a $12 million signing bonus.'),
('Lenix Osuna',2012,'2012-07-02','Mexico','LATAM_AMATEUR',null,null,null,null,'https://www.mlb.com/dodgers/news/dodgers-announce-four-international-signings/c-34332890','Dodgers announced Osuna among four July 2 international signings.'),
('Victor Gonzalez',2012,'2012-07-02','Mexico','LATAM_AMATEUR',null,null,null,null,'https://www.mlb.com/dodgers/news/dodgers-announce-four-international-signings/c-34332890','Dodgers announced Gonzalez among four July 2 international signings.'),
('William Soto',2012,'2012-07-02','Venezuela','LATAM_AMATEUR',null,null,null,null,'https://www.mlb.com/dodgers/news/dodgers-announce-four-international-signings/c-34332890','Dodgers announced Soto among four July 2 international signings.'),
('Julian Leon',2012,'2012-07-02','Mexico','LATAM_AMATEUR',null,null,null,null,'https://www.mlb.com/dodgers/news/dodgers-announce-four-international-signings/c-34332890','Dodgers announced Leon among four July 2 international signings.'),
('Julio Urias',2012,'2012-08-17','Mexico','MEXICAN_LEAGUE_TRANSFER','Mexican League','Diablos Rojos del Mexico',null,450000,'https://www.mlb.com/news/dodgers-will-call-up-julio-urias-on-friday-c180357772','MLB reports the Dodgers purchased Urias from the Diablos Rojos for a reported $450,000.'),
('Hyun-Jin Ryu',2012,'2012-12-09','South Korea','POSTED_PLAYER','KBO','Hanwha Eagles',null,null,'https://www.mlb.com/news/jim-callis-look-at-how-the-los-angeles-dodgers-playoff-roster-was-built/c-62031828','MLB reports the Dodgers paid a $25.7 million posting fee for the right to sign Ryu.'),
('Shakir Albert',2013,null,'Curacao','LATAM_AMATEUR',null,null,null,null,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced Albert among five recent international prospect signings.'),
('Hendrik Clementina',2013,null,'Curacao','LATAM_AMATEUR',null,null,null,null,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced Clementina among five recent international prospect signings.'),
('Julio Lugo (prospect)',2013,null,'Dominican Republic','LATAM_AMATEUR',null,null,null,null,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced outfielder Julio Lugo of Bani among five recent international prospect signings.'),
('Gersel Pitre',2013,null,'Venezuela','LATAM_AMATEUR',null,null,null,null,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced Pitre among five recent international prospect signings.'),
('Misja Harcksen',2013,null,'Netherlands','OTHER',null,null,null,null,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced Harcksen among five recent international prospect signings.')
)
insert into public.signings (
  player_id, organization_id, signing_date, signing_year,
  country_market, pathway, source_league, source_club,
  signing_bonus_usd, bonus_publicly_reported, transfer_fee_usd,
  record_scope, notes
)
select
  p.id, lad.id, seed.signing_date::date, seed.signing_year,
  seed.country_market, seed.pathway::public.acquisition_pathway,
  seed.source_league, seed.source_club,
  seed.signing_bonus_usd::numeric,
  seed.signing_bonus_usd is not null,
  seed.transfer_fee_usd::numeric,
  'HISTORICAL_VERIFIED',
  seed.evidence_note
from seed
join public.players p on p.full_name=seed.full_name
join public.organizations lad on lad.abbreviation='LAD'
on conflict (player_id, organization_id, signing_year) do update set
  signing_date=coalesce(excluded.signing_date, public.signings.signing_date),
  country_market=coalesce(excluded.country_market, public.signings.country_market),
  pathway=excluded.pathway,
  source_league=coalesce(excluded.source_league, public.signings.source_league),
  source_club=coalesce(excluded.source_club, public.signings.source_club),
  signing_bonus_usd=coalesce(excluded.signing_bonus_usd, public.signings.signing_bonus_usd),
  bonus_publicly_reported=excluded.bonus_publicly_reported or public.signings.bonus_publicly_reported,
  transfer_fee_usd=coalesce(excluded.transfer_fee_usd, public.signings.transfer_fee_usd),
  record_scope=case
    when public.signings.record_scope='TRACKED_DODGERS' then public.signings.record_scope
    else excluded.record_scope
  end,
  notes=coalesce(public.signings.notes, excluded.notes);


-- 6A. Source-specific acquisition costs that are not ordinary signing bonuses.
-- Fernando's $120K is stored as a transfer/acquisition fee.
update public.signings s
set transfer_fee_usd = 120000,
    posting_fee_usd = null
from public.players p, public.organizations o
where s.player_id=p.id
  and s.organization_id=o.id
  and o.abbreviation='LAD'
  and p.full_name='Fernando Valenzuela'
  and s.signing_year=1979;

insert into public.evidence (
  entity_type, entity_id, field_name, source_id, confidence, evidence_note
)
select
  'signing', s.id, 'transfer_fee_usd', src.id,
  'VERIFIED'::public.confidence_level,
  'MLB historical coverage reports a $120,000 Dodgers acquisition/signing amount for Fernando Valenzuela.'
from public.signings s
join public.players p on p.id=s.player_id
join public.organizations o on o.id=s.organization_id and o.abbreviation='LAD'
join public.sources src on src.url='https://www.mlb.com/es/news/fallecio-fernando-valenzuela'
where p.full_name='Fernando Valenzuela'
  and s.signing_year=1979
  and not exists (
    select 1 from public.evidence e
    where e.entity_type='signing'
      and e.entity_id=s.id
      and e.field_name='transfer_fee_usd'
      and e.source_id=src.id
  );

-- Ryu's $25.7M is a posting fee, not a transfer fee and not treated here
-- as a signing bonus.
update public.signings s
set posting_fee_usd = 25700000,
    transfer_fee_usd = null,
    signing_bonus_usd = null,
    bonus_publicly_reported = false
from public.players p, public.organizations o
where s.player_id=p.id
  and s.organization_id=o.id
  and o.abbreviation='LAD'
  and p.full_name='Hyun-Jin Ryu'
  and s.signing_year=2012;

insert into public.evidence (
  entity_type, entity_id, field_name, source_id, confidence, evidence_note
)
select
  'signing', s.id, 'posting_fee_usd', src.id,
  'VERIFIED'::public.confidence_level,
  'MLB reports a $25.7 million posting fee for the right to negotiate with/sign Hyun-Jin Ryu.'
from public.signings s
join public.players p on p.id=s.player_id
join public.organizations o on o.id=s.organization_id and o.abbreviation='LAD'
join public.sources src
  on src.url='https://www.mlb.com/news/jim-callis-look-at-how-the-los-angeles-dodgers-playoff-roster-was-built/c-62031828'
where p.full_name='Hyun-Jin Ryu'
  and s.signing_year=2012
  and not exists (
    select 1 from public.evidence e
    where e.entity_type='signing'
      and e.entity_id=s.id
      and e.field_name='posting_fee_usd'
      and e.source_id=src.id
  );

-- 7. Attach source evidence to each historical signing.
with seed(full_name, signing_year, source_url, evidence_note) as (
  values
  
  ('Fernando Valenzuela',1979,'https://www.baseball-reference.com/leagues/majors/1979-transactions.shtml','Baseball-Reference records the Dodgers purchasing Valenzuela from Yucatan.'),
  ('Ramon Martinez',1984,'https://www.baseball-reference.com/leagues/majors/1984-transactions.shtml','Baseball-Reference records the Dodgers signing Ramon Martinez as an amateur free agent.'),
  ('Pedro Astacio',1987,'https://www.baseball-reference.com/leagues/majors/1987-transactions.shtml','Baseball-Reference records the Dodgers signing Pedro Astacio as an amateur free agent.'),
  ('Raul Mondesi',1988,'https://www.baseball-reference.com/friv/transactions.cgi?date=06-06','Baseball-Reference records the Dodgers signing Raul Mondesi as an amateur free agent.'),
  ('Pedro Martinez',1988,'https://www.baseball-reference.com/leagues/majors/1988-transactions.shtml','Baseball-Reference records the Dodgers signing Pedro Martinez as an amateur free agent.'),
  ('Omar Daal',1990,'https://www.baseball-reference.com/friv/transactions.cgi?date=08-24','Baseball-Reference records the Dodgers signing Omar Daal as an amateur free agent.'),
  ('Roger Cedeno',1991,'https://www.baseball-reference.com/leagues/majors/1991-transactions.shtml','Baseball-Reference records the Dodgers signing Roger Cedeno as an amateur free agent.'),
  ('Chan Ho Park',1994,'https://www.mlb.com/pirates/news/korean-born-players-top-moments-in-mlb','MLB records Park signing with the Dodgers on Jan. 14, 1994 with a $1.2 million signing bonus.'),
  ('Adrian Beltre',1994,'https://www.baseball-reference.com/leagues/majors/1994-transactions.shtml','Baseball-Reference records the Dodgers signing Adrian Beltre as an amateur free agent.'),
  ('Hideo Nomo',1995,'https://www.mlb.com/news/hideo-nomo-tornado-season/c-132379246','MLB reports Nomo signed with the Dodgers after retiring from Japanese professional baseball and received a $2 million signing bonus.'),
  ('Hung-Chih Kuo',1999,'https://www.baseball-reference.com/leagues/majors/1999-transactions.shtml','Baseball-Reference records the Dodgers signing Hung-Chih Kuo as an amateur free agent.'),
  ('Willy Aybar',2000,'https://www.baseball-reference.com/leagues/majors/2000-transactions.shtml','Baseball-Reference records the Dodgers signing Willy Aybar as an amateur free agent.'),
  ('Ramon Troncoso',2002,'https://www.baseball-reference.com/leagues/majors/2002-transactions.shtml','Baseball-Reference records the Dodgers signing Ramon Troncoso as an amateur free agent.'),
  ('Tony Abreu',2002,'https://www.baseball-reference.com/leagues/majors/2002-transactions.shtml','Baseball-Reference records the Dodgers signing Tony Abreu as an amateur free agent.'),
  ('Chin-lung Hu',2003,'https://www.baseball-reference.com/leagues/majors/2003-transactions.shtml','Baseball-Reference records the Dodgers signing Chin-lung Hu as an amateur free agent.'),
  ('Elian Herrera',2003,'https://www.baseball-reference.com/leagues/majors/2003-transactions.shtml','Baseball-Reference records the Dodgers signing Elian Herrera as an amateur free agent.'),
  ('Kenley Jansen',2004,'https://www.mlb.com/news/jim-callis-look-at-how-the-los-angeles-dodgers-playoff-roster-was-built/c-62031828','MLB reports Jansen signed out of Curacao for $85,000 in 2004; he later converted from catcher to pitcher.'),
  ('Carlos Santana',2004,'https://www.baseball-reference.com/leagues/majors/2004-transactions.shtml','Baseball-Reference records the Dodgers signing Carlos Santana as an amateur free agent.'),
  ('Carlos Frias',2007,'https://www.baseball-reference.com/leagues/majors/2007-transactions.shtml','Baseball-Reference records the Dodgers signing Carlos Frias as an amateur free agent.'),
  ('Pedro Baez',2007,'https://www.baseball-reference.com/leagues/majors/2007-transactions.shtml','Baseball-Reference records the Dodgers signing Pedro Baez as an amateur free agent; he later converted to pitching.'),
  ('Rubby De La Rosa',2007,'https://www.baseball-reference.com/leagues/majors/2007-transactions.shtml','Baseball-Reference records the Dodgers signing Rubby De La Rosa as an amateur free agent.'),
  ('Jose Dominguez',2007,'https://www.baseball-reference.com/leagues/majors/2007-transactions.shtml','Baseball-Reference records the Dodgers signing Jose Dominguez as an amateur free agent.'),
  ('Yasiel Puig',2012,'https://www.mlb.com/news/dodgers-sign-puig-to-seven-year-deal/c-33960778','MLB announced Puig''s seven-year deal; contemporaneous MLB reporting identifies a $12 million signing bonus.'),
  ('Lenix Osuna',2012,'https://www.mlb.com/dodgers/news/dodgers-announce-four-international-signings/c-34332890','Dodgers announced Osuna among four July 2 international signings.'),
  ('Victor Gonzalez',2012,'https://www.mlb.com/dodgers/news/dodgers-announce-four-international-signings/c-34332890','Dodgers announced Gonzalez among four July 2 international signings.'),
  ('William Soto',2012,'https://www.mlb.com/dodgers/news/dodgers-announce-four-international-signings/c-34332890','Dodgers announced Soto among four July 2 international signings.'),
  ('Julian Leon',2012,'https://www.mlb.com/dodgers/news/dodgers-announce-four-international-signings/c-34332890','Dodgers announced Leon among four July 2 international signings.'),
  ('Julio Urias',2012,'https://www.mlb.com/news/dodgers-will-call-up-julio-urias-on-friday-c180357772','MLB reports the Dodgers purchased Urias from the Diablos Rojos for a reported $450,000.'),
  ('Hyun-Jin Ryu',2012,'https://www.mlb.com/news/jim-callis-look-at-how-the-los-angeles-dodgers-playoff-roster-was-built/c-62031828','MLB reports the Dodgers paid a $25.7 million posting fee for the right to sign Ryu.'),
  ('Shakir Albert',2013,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced Albert among five recent international prospect signings.'),
  ('Hendrik Clementina',2013,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced Clementina among five recent international prospect signings.'),
  ('Julio Lugo (prospect)',2013,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced outfielder Julio Lugo of Bani among five recent international prospect signings.'),
  ('Gersel Pitre',2013,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced Pitre among five recent international prospect signings.'),
  ('Misja Harcksen',2013,'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462','Dodgers announced Harcksen among five recent international prospect signings.')
)
insert into public.evidence (
  entity_type, entity_id, field_name, source_id, confidence, evidence_note
)
select
  'signing', s.id, null, src.id,
  'VERIFIED'::public.confidence_level,
  seed.evidence_note
from seed
join public.players p on p.full_name=seed.full_name
join public.signings s on s.player_id=p.id and s.signing_year=seed.signing_year
join public.organizations o on o.id=s.organization_id and o.abbreviation='LAD'
join public.sources src on src.url=seed.source_url
where not exists (
  select 1 from public.evidence e
  where e.entity_type='signing'
    and e.entity_id=s.id
    and e.source_id=src.id
);


-- 7A. Earlier / additional verified Dodgers international acquisitions.
-- These extend the current public-source floor to 1951 and add several
-- historically important 1980s/1990s amateur free-agent signings.
-- This remains a verified set, NOT a complete franchise census.

insert into public.sources (source_name, source_type, title, url)
values
  ('Baseball-Reference','HISTORICAL_SIGNING_RECORD','1951 MLB transaction record',
   'https://www.baseball-reference.com/leagues/majors/1951-transactions.shtml'),
  ('Baseball-Reference','HISTORICAL_SIGNING_RECORD','1950 MLB transaction record',
   'https://www.baseball-reference.com/leagues/majors/1950-transactions.shtml'),
  ('MLB.com','HISTORICAL_SIGNING_RECORD','How the Dodgers signed Roberto Clemente',
   'https://www.mlb.com/news/roberto-clemente-signed-with-dodgers-in-1954'),
  ('Baseball-Reference','HISTORICAL_SIGNING_RECORD','1985 MLB transaction record',
   'https://www.baseball-reference.com/leagues/majors/1985-transactions.shtml'),
  ('Baseball-Reference','HISTORICAL_SIGNING_RECORD','1986 MLB transaction record',
   'https://www.baseball-reference.com/leagues/majors/1986-transactions.shtml'),
  ('Baseball-Reference','HISTORICAL_SIGNING_RECORD','1992 MLB transaction record',
   'https://www.baseball-reference.com/leagues/majors/1992-transactions.shtml')
on conflict (url) do nothing;

insert into public.players
  (full_name, canonical_name, birth_country, primary_position)
select v.full_name, v.canonical_name, v.birth_country, v.primary_position
from (
  values
    ('Sandy Amoros','Sandy Amoros','Cuba','OF'),
    ('Chico Fernandez','Chico Fernandez','Cuba','SS'),
    ('Roberto Clemente','Roberto Clemente','Puerto Rico','OF'),
    ('Juan Guzman','Juan Guzman','Dominican Republic','RHP'),
    ('Jose Vizcaino','Jose Vizcaino','Dominican Republic','SS'),
    ('Jose Offerman','Jose Offerman','Dominican Republic','SS'),
    ('Antonio Osuna','Antonio Osuna','Mexico','RHP'),
    ('Ismael Valdez','Ismael Valdez','Mexico','RHP'),
    ('Juan Castro','Juan Castro','Mexico','SS'),
    ('Karim Garcia','Karim Garcia','Mexico','OF')
) as v(full_name, canonical_name, birth_country, primary_position)
where not exists (
  select 1 from public.players p where p.full_name=v.full_name
);

with seed(
  full_name, signing_year, signing_date, country_market, pathway,
  signing_bonus_usd, source_url, evidence_note
) as (
  values
    ('Sandy Amoros',1951,null,'Cuba','LATAM_AMATEUR',null,
     'https://www.baseball-reference.com/leagues/majors/1951-transactions.shtml',
     'Baseball-Reference records Brooklyn signing Sandy Amoros as an amateur free agent.'),
    ('Chico Fernandez',1951,'1951-02-06','Cuba','LATAM_AMATEUR',null,
     'https://www.baseball-reference.com/leagues/majors/1950-transactions.shtml',
     'Baseball-Reference records Brooklyn signing Chico Fernandez as an amateur free agent on February 6, 1951.'),
    ('Roberto Clemente',1954,'1954-02-19','Puerto Rico','LATAM_AMATEUR',10000,
     'https://www.mlb.com/news/roberto-clemente-signed-with-dodgers-in-1954',
     'MLB reports Brooklyn signed Roberto Clemente out of Puerto Rico on February 19, 1954 for a $10,000 signing bonus.'),
    ('Juan Guzman',1985,'1985-03-16','Dominican Republic','LATAM_AMATEUR',null,
     'https://www.baseball-reference.com/leagues/majors/1985-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Juan Guzman as an amateur free agent.'),
    ('Jose Vizcaino',1986,'1986-02-18','Dominican Republic','LATAM_AMATEUR',null,
     'https://www.baseball-reference.com/leagues/majors/1986-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Jose Vizcaino as an amateur free agent.'),
    ('Jose Offerman',1986,'1986-07-24','Dominican Republic','LATAM_AMATEUR',null,
     'https://www.baseball-reference.com/leagues/majors/1986-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Jose Offerman as an amateur free agent.'),
    ('Antonio Osuna',1991,'1991-06-12','Mexico','LATAM_AMATEUR',null,
     'https://www.baseball-reference.com/leagues/majors/1991-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Antonio Osuna as an amateur free agent.'),
    ('Ismael Valdez',1991,'1991-06-14','Mexico','LATAM_AMATEUR',null,
     'https://www.baseball-reference.com/leagues/majors/1991-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Ismael Valdez as an amateur free agent.'),
    ('Juan Castro',1991,'1991-06-18','Mexico','LATAM_AMATEUR',null,
     'https://www.baseball-reference.com/leagues/majors/1991-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Juan Castro as an amateur free agent.'),
    ('Karim Garcia',1992,'1992-07-16','Mexico','LATAM_AMATEUR',null,
     'https://www.baseball-reference.com/leagues/majors/1992-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Karim Garcia as an amateur free agent.')
)
insert into public.signings (
  player_id, organization_id, signing_date, signing_year,
  country_market, pathway, signing_bonus_usd,
  bonus_publicly_reported, record_scope, notes
)
select
  p.id, lad.id, seed.signing_date::date, seed.signing_year,
  seed.country_market, seed.pathway::public.acquisition_pathway,
  seed.signing_bonus_usd::numeric,
  seed.signing_bonus_usd is not null,
  'HISTORICAL_VERIFIED',
  seed.evidence_note
from seed
join public.players p on p.full_name=seed.full_name
join public.organizations lad on lad.abbreviation='LAD'
on conflict (player_id, organization_id, signing_year) do update set
  signing_date=coalesce(excluded.signing_date, public.signings.signing_date),
  country_market=coalesce(excluded.country_market, public.signings.country_market),
  pathway=excluded.pathway,
  signing_bonus_usd=coalesce(excluded.signing_bonus_usd, public.signings.signing_bonus_usd),
  bonus_publicly_reported=excluded.bonus_publicly_reported or public.signings.bonus_publicly_reported,
  record_scope=case
    when public.signings.record_scope='TRACKED_DODGERS' then public.signings.record_scope
    else excluded.record_scope
  end,
  notes=coalesce(public.signings.notes, excluded.notes);

with seed(full_name, signing_year, source_url, evidence_note) as (
  values
    ('Sandy Amoros',1951,'https://www.baseball-reference.com/leagues/majors/1951-transactions.shtml',
     'Baseball-Reference records Brooklyn signing Sandy Amoros as an amateur free agent.'),
    ('Chico Fernandez',1951,'https://www.baseball-reference.com/leagues/majors/1950-transactions.shtml',
     'Baseball-Reference records Brooklyn signing Chico Fernandez as an amateur free agent on February 6, 1951.'),
    ('Roberto Clemente',1954,'https://www.mlb.com/news/roberto-clemente-signed-with-dodgers-in-1954',
     'MLB reports Brooklyn signed Roberto Clemente out of Puerto Rico on February 19, 1954 for a $10,000 signing bonus.'),
    ('Juan Guzman',1985,'https://www.baseball-reference.com/leagues/majors/1985-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Juan Guzman as an amateur free agent.'),
    ('Jose Vizcaino',1986,'https://www.baseball-reference.com/leagues/majors/1986-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Jose Vizcaino as an amateur free agent.'),
    ('Jose Offerman',1986,'https://www.baseball-reference.com/leagues/majors/1986-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Jose Offerman as an amateur free agent.'),
    ('Antonio Osuna',1991,'https://www.baseball-reference.com/leagues/majors/1991-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Antonio Osuna as an amateur free agent.'),
    ('Ismael Valdez',1991,'https://www.baseball-reference.com/leagues/majors/1991-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Ismael Valdez as an amateur free agent.'),
    ('Juan Castro',1991,'https://www.baseball-reference.com/leagues/majors/1991-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Juan Castro as an amateur free agent.'),
    ('Karim Garcia',1992,'https://www.baseball-reference.com/leagues/majors/1992-transactions.shtml',
     'Baseball-Reference records the Dodgers signing Karim Garcia as an amateur free agent.')
)
insert into public.evidence (
  entity_type, entity_id, field_name, source_id, confidence, evidence_note
)
select
  'signing', s.id, null, src.id,
  'VERIFIED'::public.confidence_level,
  seed.evidence_note
from seed
join public.players p on p.full_name=seed.full_name
join public.signings s on s.player_id=p.id and s.signing_year=seed.signing_year
join public.organizations o on o.id=s.organization_id and o.abbreviation='LAD'
join public.sources src on src.url=seed.source_url
where not exists (
  select 1 from public.evidence e
  where e.entity_type='signing'
    and e.entity_id=s.id
    and e.source_id=src.id
);

-- 8. Coverage declarations.
-- MLB reported that the Dodgers signed 47 international amateurs during
-- calendar year 2013. Only five are named in the cited club announcement here.
insert into public.signing_census_coverage (
  organization_id, period_start_year, period_end_year, coverage_type,
  expected_signings, tracked_signings, source_id, notes
)
select
  lad.id, 2013, 2013, 'PARTIAL_CENSUS',
  47, 5, src.id,
  'MLB reported 47 Dodgers international amateur signings in calendar year 2013; this migration currently names five from the January 2014 club announcement.'
from public.organizations lad
join public.sources src
  on src.url='https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462'
where lad.abbreviation='LAD'
on conflict (organization_id, period_start_year, period_end_year, coverage_type)
do update set expected_signings=excluded.expected_signings,
              tracked_signings=excluded.tracked_signings,
              source_id=excluded.source_id,
              notes=excluded.notes,
              updated_at=now();

insert into public.signing_census_coverage (
  organization_id, period_start_year, period_end_year, coverage_type,
  expected_signings, tracked_signings, notes
)
select
  lad.id, 1951, 2012, 'HISTORICAL_VERIFIED',
  null,
  (select count(*) from public.signings s where s.organization_id=lad.id
     and s.signing_year between 1951 and 2012
     and s.record_scope='HISTORICAL_VERIFIED'),
  'Verified historical Dodgers international acquisitions collected from public transaction, MLB and club records. Current verified floor is 1951; this is intentionally not labeled a complete census.'
from public.organizations lad
where lad.abbreviation='LAD'
on conflict (organization_id, period_start_year, period_end_year, coverage_type)
do update set tracked_signings=excluded.tracked_signings,
              notes=excluded.notes,
              updated_at=now();

-- 9. Historical/coverage views.
create or replace view public.v_dodgers_historical_signings
with (security_invoker=true)
as
select
  p.full_name,
  s.signing_year,
  s.signing_date,
  s.country_market,
  s.pathway,
  s.source_league,
  s.source_club,
  s.signing_bonus_usd,
  s.posting_fee_usd,
  s.transfer_fee_usd,
  s.total_known_acquisition_cost_usd,
  s.record_scope,
  oc.reached_mlb,
  oa.player_id is not null as outcome_audited,
  oa.reached_mlb_verified,
  oa.audited_through_date,
  oc.mlb_debut_date,
  debut_org.abbreviation as mlb_debut_org,
  case
    when s.signing_date is not null and oc.mlb_debut_date is not null
    then round(((oc.mlb_debut_date - s.signing_date) / 365.2425)::numeric, 2)
    else null
  end as years_signing_to_mlb,
  oc.career_war
from public.signings s
join public.players p on p.id=s.player_id
join public.organizations o on o.id=s.organization_id
left join public.outcomes oc on oc.player_id=p.id
left join public.outcome_audits oa on oa.player_id=p.id
left join public.organizations debut_org on debut_org.id=oc.mlb_debut_organization_id
where o.abbreviation='LAD'
order by s.signing_year, p.full_name;

grant select on public.v_dodgers_historical_signings to anon, authenticated;

create or replace view public.v_signing_data_coverage
with (security_invoker=true)
as
select
  o.abbreviation,
  o.name as organization_name,
  c.period_start_year,
  c.period_end_year,
  c.coverage_type,
  c.expected_signings,
  c.tracked_signings,
  case
    when c.expected_signings is not null and c.expected_signings > 0
    then round(c.tracked_signings::numeric / c.expected_signings, 4)
    else null
  end as observed_coverage_rate,
  c.notes
from public.signing_census_coverage c
left join public.organizations o on o.id=c.organization_id
order by c.period_start_year, o.abbreviation nulls last;

grant select on public.v_signing_data_coverage to anon, authenticated;

-- Verification
select
  min(signing_year) as earliest_tracked_dodgers_signing,
  max(signing_year) as latest_tracked_dodgers_signing,
  count(*) as tracked_dodgers_signings
from public.v_dodgers_historical_signings;

select *
from public.v_signing_data_coverage
where abbreviation='LAD'
order by period_start_year;
