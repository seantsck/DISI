-- DISI v0.9
-- 018_signing_class_coverage_and_backfill.sql
-- Signing-population semantics, class-membership provenance, and verified
-- 2022 / 2024 / 2025 backfill. Run after 017.
--
-- Methodological correction:
--   An official club announcement of an international class (e.g. "29 international
--   amateur free agents") usually describes the class announced when the signing
--   period OPENS. Clubs keep signing players for the rest of the period. So
--     opening announced class complete  !=  full signing-period census complete.
--   This migration makes the population an explicit dimension and only lets a
--   FULL_SIGNING_PERIOD population feed organization-wide MLB reach rates.
--
-- Also separates three facts that were previously one field:
--   signings.signing_year             signing class year (unchanged meaning)
--   signings.announced_date           date the club announced the player in its class
--   signings.formal_transaction_date  date of the MLB transaction record
--   (signings.signing_date is preserved and never overwritten; it is only filled
--    where NULL, with the verified MLB transaction date.)
--
-- Sources consulted 2026-10-05 (each fact below cites the source that states it):
--   * MLB Stats API transaction and person records (statsapi.mlb.com), per player.
--   * Official Dodgers releases: 2021 (22), 2024 (19), 2025 (29) class sizes.
--   * MLB.com, 2022-01-16: list of 31 players under a "30 players" headline.
--   * MLB.com, 2017-07-06: 26 signings in the *completed* 2016-17 period.
--   * True Blue LA 2024 and 2025 class tables; Dodgers Digest 2025 class article
--     (secondary class reconstructions: class membership, published position and
--     country only; never bonus, transaction date or class size).
--
-- Nothing is deleted. No bonus, date, country, trainer or outcome is invented.
-- bWAR provenance rules from 017 are unchanged. Rerunnable.

begin;

-- ===========================================================================
-- 1. SOURCE TIERS
-- ===========================================================================

insert into public.source_tiers
  (tier_code, priority, label, authoritative_for, not_authoritative_for, notes)
values
('SECONDARY_CLASS_RECONSTRUCTION', 8, 'Reputable secondary class reconstruction',
 array['CLASS_MEMBERSHIP_SUPPLEMENT','PUBLISHED_POSITION','PUBLISHED_COUNTRY'],
 array['CLASS_SIZE','BONUS','SIGNING_DATE','MLB_OUTCOME'],
 'Club-beat / prospect-site class tables. Used for member names when an official release states only the class size. Superseded by any official or MLB record for the same fact.')
on conflict (tier_code) do update set
  priority = excluded.priority, label = excluded.label,
  authoritative_for = excluded.authoritative_for,
  not_authoritative_for = excluded.not_authoritative_for, notes = excluded.notes;

create or replace function public.disi_infer_source_tier(p_url text, p_source_type text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_url ~* '^https?://(www\.)?baseball-reference\.com/' then 'BASEBALL_REFERENCE'
    when p_url ~* '^https?://(www\.)?fangraphs\.com/' then 'FANGRAPHS'
    when p_url ~* '^https?://statsapi\.mlb\.com/api/v1/transactions' then 'MLB_TRANSACTION_LOG'
    when p_url ~* '^https?://statsapi\.mlb\.com/api/v1/people' then 'MILB_MLB_PLAYER_RECORD'
    when p_source_type in ('DODGERS_CLASS_RELEASE', 'PRESS_RELEASE')
      or p_url ~* 'mlb\.com/(amp/)?press-release/' then 'OFFICIAL_CLUB_RELEASE'
    when p_source_type in ('DODGERS_TRANSACTION_LOG', 'TRANSACTIONS')
      or p_url ~* 'mlb\.com/[a-z]+/roster/transactions/' then 'MLB_TRANSACTION_LOG'
    when p_source_type in ('MLB_PIPELINE_TRACKER', 'INTERNATIONAL_TRACKER', 'PROSPECT_PROFILE')
      or p_url ~* 'mlb\.com/milb/prospects/' then 'MLB_PIPELINE'
    when p_url ~* '^https?://(www\.)?(mlb|milb)\.com/player/' then 'MILB_MLB_PLAYER_RECORD'
    when p_url ~* '^https?://(www\.)?mlb\.com/' then 'MLB_COM_REPORTING'
    when p_source_type = 'SECONDARY_CLASS_RECONSTRUCTION' then 'SECONDARY_CLASS_RECONSTRUCTION'
    else 'OTHER'
  end
$$;

-- ===========================================================================
-- 2. SCHEMA: signing dates, alias provenance, coverage population scope
-- ===========================================================================

alter table public.signings add column if not exists announced_date date;
alter table public.signings add column if not exists formal_transaction_date date;
alter table public.signings add column if not exists transaction_source_id uuid
  references public.sources(id) on delete set null;

comment on column public.signings.signing_year is
  'Signing class year: the international class / signing period the player is counted in.';
comment on column public.signings.signing_date is
  'Preserved legacy signing date. Never overwritten; filled only where NULL with the verified formal MLB transaction date (018).';
comment on column public.signings.announced_date is
  'Date the club announced the player as part of its international class (Pacific date of the announcing source).';
comment on column public.signings.formal_transaction_date is
  'Date of the formal MLB transaction record for this signing. Can differ from the announcement date.';

alter table public.player_aliases add column if not exists source_id uuid
  references public.sources(id) on delete set null;

alter table public.signing_census_coverage add column if not exists population_scope text;
alter table public.signing_census_coverage add column if not exists population_note text;
alter table public.signing_census_coverage drop constraint if exists signing_census_coverage_population_scope_check;
alter table public.signing_census_coverage add constraint signing_census_coverage_population_scope_check
  check (population_scope is null or population_scope in (
    'OPENING_CLASS','FULL_SIGNING_PERIOD','HISTORICAL_VERIFIED_SET','TOP_PROSPECT_SAMPLE','OTHER_DEFINED_POPULATION'));

-- ===========================================================================
-- 3. POPULATIONS, MEMBERSHIP PROVENANCE, CONFLICTS, CANDIDATES
-- ===========================================================================

create table if not exists public.signing_populations (
  id uuid primary key default gen_random_uuid(),
  population_key text not null unique,
  franchise_key text,
  population_scope text not null check (population_scope in (
    'OPENING_CLASS','FULL_SIGNING_PERIOD','HISTORICAL_VERIFIED_SET','TOP_PROSPECT_SAMPLE','OTHER_DEFINED_POPULATION')),
  class_year_start integer not null,
  class_year_end integer not null,
  period_label text not null,
  period_start_date date,
  period_end_date date,
  announced_on date,
  expected_size integer check (expected_size is null or expected_size >= 0),
  expected_size_source_id uuid references public.sources(id) on delete set null,
  stated_composition jsonb,
  rate_analysis_suitable boolean not null default false,
  legacy_coverage_id uuid references public.signing_census_coverage(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  check (class_year_end >= class_year_start),
  -- Only a full signing-period population can ever be a denominator for an
  -- organization-wide MLB reach rate.
  check (not rate_analysis_suitable or population_scope = 'FULL_SIGNING_PERIOD')
);

create table if not exists public.signing_population_members (
  id uuid primary key default gen_random_uuid(),
  population_id uuid not null references public.signing_populations(id) on delete cascade,
  signing_id uuid not null references public.signings(id) on delete cascade,
  membership_status text not null default 'MEMBER' check (membership_status in ('MEMBER','PROVISIONAL')),
  note text,
  created_at timestamptz not null default now(),
  unique (population_id, signing_id)
);

create index if not exists signing_population_members_signing_idx
  on public.signing_population_members(signing_id);

-- Why DISI believes a signing belongs to a population. supports_fields lists the
-- facts this source supports; a membership source never implicitly verifies other
-- fields (bonus, transaction date, nationality ...).
create table if not exists public.signing_population_member_sources (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.signing_population_members(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  membership_basis text not null check (membership_basis in (
    'OFFICIAL_CLUB_ANNOUNCEMENT','MLB_TRANSACTION_LOG','MLB_SIGNING_PERIOD_ARTICLE',
    'MLB_PLAYER_TRANSACTION_HISTORY','SECONDARY_CLASS_RECONSTRUCTION','HISTORICAL_RECORD','PROSPECT_TRACKER')),
  supports_fields text[] not null default array['CLASS_MEMBERSHIP'] check (supports_fields <@ array[
    'CLASS_MEMBERSHIP','FORMAL_TRANSACTION_DATE','ANNOUNCED_DATE','PUBLISHED_POSITION','PUBLISHED_COUNTRY']),
  confidence public.confidence_level not null default 'HIGH',
  note text,
  unique (member_id, source_id)
);

create table if not exists public.research_source_conflicts (
  id uuid primary key default gen_random_uuid(),
  conflict_key text not null unique,
  conflict_type text not null check (conflict_type in (
    'NAME_SPELLING','POSITION','BIRTH_COUNTRY','COUNTRY_MARKET','CLASS_MEMBERSHIP',
    'POPULATION_COUNT','PERIOD_ASSIGNMENT','POPULATION_DEFINITION')),
  player_id uuid references public.players(id) on delete cascade,
  signing_id uuid references public.signings(id) on delete cascade,
  population_id uuid references public.signing_populations(id) on delete cascade,
  field_name text,
  value_a text,
  source_a_id uuid references public.sources(id) on delete set null,
  value_b text,
  source_b_id uuid references public.sources(id) on delete set null,
  status text not null default 'UNRESOLVED' check (status in ('UNRESOLVED','RESOLVED')),
  resolution text,
  note text,
  created_at timestamptz not null default now()
);

-- MLB transaction signees that are not (yet) DISI signing rows.
create table if not exists public.signing_period_candidates (
  id uuid primary key default gen_random_uuid(),
  mlb_person_id bigint not null,
  full_name text not null,
  franchise_key text not null,
  transaction_date date not null,
  period_year integer,
  birth_country text,
  position text,
  first_professional_contract boolean,
  classification text not null check (classification in (
    'INGESTED_LATER_PERIOD_SIGNING','PRIOR_PROFESSIONAL_CONTRACT','IDENTIFIED_NOT_INGESTED')),
  source_id uuid references public.sources(id) on delete set null,
  note text,
  unique (mlb_person_id, transaction_date)
);

do $$
declare t text;
begin
  foreach t in array array['signing_populations','signing_population_members',
    'signing_population_member_sources','research_source_conflicts','signing_period_candidates']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'public_read_' || t, t);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', 'public_read_' || t, t);
  end loop;
end $$;

-- ===========================================================================
-- 4. VERIFIED INPUT DATA (generated from MLB Stats API records and class lists)
-- ===========================================================================

create temporary table _m018_existing (full_name text, signing_year int, mlb_id bigint, formal_transaction_date date) on commit drop;
insert into _m018_existing values
('Accimias Morales',2022,703193,'2022-01-15'),
('Callum Wallace',2022,800527,'2022-01-15'),
('Daniel Arrias',2022,800328,'2022-01-15'),
('Domingo Geronimo',2022,800383,'2022-01-15'),
('Edgar Leon',2022,800453,'2022-01-15'),
('Eduardo Guerrero',2022,800370,'2022-01-15'),
('Enrike Sevilya',2022,800288,'2022-01-15'),
('Javier Pena',2022,800351,'2022-01-15'),
('Jeral Perez',2022,800419,'2022-01-15'),
('Jholbran Herder',2022,800408,'2022-01-15'),
('Josue De Paula',2022,800543,'2022-01-15'),
('Kosuke Matsuda',2022,800494,'2022-01-15'),
('Luciano Romero',2022,800355,'2022-01-15'),
('Mairoshendrick Martinus',2022,800302,'2022-01-15'),
('Miguel Dominguez',2022,800399,'2022-01-15'),
('Natanael Castillo',2022,800390,'2022-01-15'),
('Nicolas Cruz',2022,800395,'2022-01-15'),
('Oswaldo Osorio',2022,800424,'2022-01-15'),
('Peter Bonilla',2022,800361,'2022-01-15'),
('Raynerd Ortega',2022,800380,'2022-01-15'),
('Roiger Mujica',2022,800487,'2022-01-15'),
('Samuel Munoz',2022,703153,'2022-01-15'),
('Sean Linan',2022,800344,'2022-01-15'),
('Steven Castillo',2022,800481,'2022-01-15'),
('Victor Rodrigues',2022,800332,'2022-01-15'),
('Yhonaider Gudino',2022,800521,'2022-01-15'),
('Yorfran Medina',2022,800337,'2022-01-15'),
('Yoryi Simarra',2022,800366,'2022-01-15'),
('Yuliangel De La Cruz',2022,800447,'2022-01-15'),
('Alexis Dominguez',2024,821826,'2024-01-15'),
('Allen Ajoti',2024,821808,'2024-01-15'),
('Angel Ramirez',2024,821633,'2024-01-15'),
('Axel Perez',2024,821612,'2024-01-15'),
('Carlos Sardina',2024,821658,'2024-01-15'),
('Christian Muniz',2024,821650,'2024-01-15'),
('David Romero',2024,821661,'2024-01-15'),
('Emil Morales',2024,815896,'2024-01-15'),
('Erny Orellana',2024,821786,'2024-01-15'),
('Euri Rosa',2024,821817,'2024-01-15'),
('Francisco Espinoza',2024,821689,'2024-01-15'),
('Heudy Pena',2024,821263,'2024-01-15'),
('Jose Lopez',2024,821653,'2024-01-15'),
('Leider Padilla',2024,821636,'2024-01-15'),
('Michael Ramirez',2024,821679,'2024-01-15'),
('Rafy Peguero',2024,821801,'2024-01-15'),
('Reyli Mariano',2024,821697,'2024-01-15'),
('Yojackson Laya',2024,821684,'2024-01-15'),
('Adrian Torres',2025,830397,'2025-01-17'),
('Carlos Ramirez',2025,830439,'2025-01-17'),
('Degerson Diaz',2025,830481,'2025-01-18'),
('Derik Aquino',2025,830468,'2025-01-18'),
('Devlyn Bautista',2025,830426,'2025-01-18'),
('Ezequiel Aparicio',2025,830452,'2025-01-18'),
('Jhon Gil',2025,830459,'2025-01-18'),
('Jhosman Theran',2025,830420,'2025-01-20'),
('Jose Rivas',2025,830449,'2025-01-17'),
('Jose Villegas',2025,830413,'2025-01-18'),
('Joseph Deng Thon',2025,830188,'2025-01-18'),
('Juan Macero',2025,830471,'2025-01-18'),
('Luis Luna',2025,830463,'2025-01-19'),
('Luis Tovar',2025,830434,'2025-01-18'),
('Moises Acacio',2025,830432,'2025-01-18'),
('Moises Rangel',2025,830404,'2025-01-18'),
('Ricardo Roman',2025,830429,'2025-01-18'),
('Roki Sasaki',2025,808963,'2025-01-22');

create temporary table _m018_person (full_name text, mlb_id bigint, birth_date date, birth_country text, bats text, throws text, mlb_full_name text, mlb_position text) on commit drop;
insert into _m018_person values
('Accimias Morales',703193,'2004-09-13','Venezuela','R','R','Accimias Morales','RHP'),
('Callum Wallace',800527,'2004-04-06','Australia','R','R','Callum Wallace','RHP'),
('Daniel Arrias',800328,'2003-11-30','Venezuela','L','L','Daniel Arrias','OF'),
('Domingo Geronimo',800383,'2004-10-07','Dominican Republic','R','R','Domingo Geronimo','RHP'),
('Edgar Leon',800453,'2004-12-29','Venezuela','R','R','Edgar Leon','RHP'),
('Eduardo Guerrero',800370,'2005-05-09','Venezuela','S','R','Eduardo Guerrero','1B'),
('Enrike Sevilya',800288,'2005-07-27',null,'R','R','Enrike Sevilya','RHP'),
('Javier Pena',800351,'2004-09-10','Dominican Republic','R','R','Javier Pena','C'),
('Jeral Perez',800419,'2004-11-06','Dominican Republic','R','R','Jeral Perez','3B'),
('Jholbran Herder',800408,'2004-11-02','Venezuela','R','R','Jholbran Herder','RHP'),
('Josue De Paula',800543,'2005-05-24','United States','L','L','Josue De Paula','DH'),
('Kosuke Matsuda',800494,'1998-10-14','Japan','R','R','Kosuke Matsuda','RHP'),
('Luciano Romero',800355,'2005-01-08','Dominican Republic','R','R','Luciano Romero','RHP'),
('Mairoshendrick Martinus',800302,'2005-02-03','Curacao','R','R','Mairo Martinus','3B'),
('Miguel Dominguez',800399,'2004-02-20','Panama','R','R','Miguel Dominguez','C'),
('Natanael Castillo',800390,'2004-11-06','Dominican Republic','R','R','Natanael Castillo','SS'),
('Nicolas Cruz',800395,'2004-04-23','Venezuela','R','R','Nicolas Cruz','RHP'),
('Oswaldo Osorio',800424,'2005-04-12','Venezuela','L','R','Oswaldo Osorio','1B'),
('Peter Bonilla',800361,'2004-12-16','Spain','L','L','Peter Bonilla','LHP'),
('Raynerd Ortega',800380,'2005-07-08','Venezuela','R','R','Raynerd Ortega','SS'),
('Roiger Mujica',800487,'2005-07-24','Venezuela','R','R','Roiger Mujica','RHP'),
('Samuel Munoz',703153,'2004-09-22','Dominican Republic','L','R','Samuel Munoz','OF'),
('Sean Linan',800344,'2004-11-07','Colombia','R','R','Sean Paul Liñan','RHP'),
('Steven Castillo',800481,'2004-09-15','Nicaragua','R','R','Steven Castillo','RHP'),
('Victor Rodrigues',800332,'2004-09-23','Venezuela','R','R','Victor Rodrigues','C'),
('Yhonaider Gudino',800521,'2004-09-20','Venezuela','R','R','Yhonaider Gudino','SS'),
('Yorfran Medina',800337,'2005-01-25','Venezuela','R','R','Yorfran Medina','OF'),
('Yoryi Simarra',800366,'2004-11-18','Colombia','R','R','Yoryi Simarra','RHP'),
('Yuliangel De La Cruz',800447,'2005-01-24','Dominican Republic','R','R','Yuliangel De La Cruz','RHP'),
('Alexis Dominguez',821826,'2005-11-03','Dominican Republic','R','R','Alexis Dominguez','RHP'),
('Allen Ajoti',821808,'2005-11-08','Uganda','R','R','Allen Ajoti','RHP'),
('Angel Ramirez',821633,'2006-03-01','Mexico','R','R','Angel Ramirez','RHP'),
('Axel Perez',821612,'2005-08-13','Dominican Republic','R','R','Axel Perez','RHP'),
('Carlos Sardina',821658,'2007-03-10','Venezuela','R','R','Carlos Sardina','RHP'),
('Christian Muniz',821650,'2006-08-16','Mexico','R','R','Christian Muniz','RHP'),
('David Romero',821661,'2007-01-06','Venezuela','S','R','David Romero','2B'),
('Emil Morales',815896,'2006-09-22','Spain','R','R','Emil Morales','SS'),
('Erny Orellana',821786,'2007-03-03','Venezuela','R','R','Erny Orellana','OF'),
('Euri Rosa',821817,'2007-07-04','Dominican Republic','R','R','Euri Rosa','C'),
('Francisco Espinoza',821689,'2007-03-16','Venezuela','R','R','Francisco Espinoza','C'),
('Heudy Pena',821263,'2007-03-09','Dominican Republic','L','R','Heudy Pena','SS'),
('Jose Lopez',821653,'2005-11-13','Venezuela','R','R','Jose Lopez','RHP'),
('Leider Padilla',821636,'2006-11-25','Venezuela','R','R','Leider Padilla','OF'),
('Michael Ramirez',821679,'2005-04-21','Venezuela','L','L','Michael Ramirez','LHP'),
('Rafy Peguero',821801,'2006-09-26','United States','R','R','Rafy Peguero','OF'),
('Reyli Mariano',821697,'2006-11-07','Dominican Republic','S','R','Reyli Mariano','2B'),
('Yojackson Laya',821684,'2006-11-12','Venezuela','R','R','Yojackson Laya','SS'),
('Adrian Torres',830397,'2008-01-23','Panama','L','L','Adrian Torres','LHP'),
('Carlos Ramirez',830439,'2008-07-18','Venezuela','R','R','Carlos Ramirez','RHP'),
('Degerson Diaz',830481,'2008-01-31','Venezuela','R','R','Degerson Diaz','OF'),
('Derik Aquino',830468,'2007-04-18','Dominican Republic','R','R','Derik Aquino','RHP'),
('Devlyn Bautista',830426,'2006-12-04','Dominican Republic','R','R','Devlyn Bautista','OF'),
('Ezequiel Aparicio',830452,'2008-02-24','Venezuela','R','R','Ezequiel Aparicio','C'),
('Jhon Gil',830459,'2007-12-15','Venezuela','R','R','Jhon Gil','C'),
('Jhosman Theran',830420,'2007-10-03','Colombia','R','R','Jhosman Theran','OF'),
('Jose Rivas',830449,'2008-03-27','Venezuela','R','R','Jose Rivas','C'),
('Jose Villegas',830413,'2006-11-08','Venezuela','R','R','Jose Villegas','RHP'),
('Joseph Deng Thon',830188,'2007-08-05','Sudan','R','R','Joseph Deng Thon','RHP'),
('Juan Macero',830471,'2007-11-27','Venezuela','R','R','Juan Macero','SS'),
('Luis Luna',830463,'2008-06-09','Colombia','R','R','Luis Luna','SS'),
('Luis Tovar',830434,'2007-10-06','Venezuela','R','R','Luis Tovar','3B'),
('Moises Acacio',830432,'2008-01-24','Venezuela','R','R','Moises Acacio','SS'),
('Moises Rangel',830404,'2008-05-23','Venezuela','R','R','Moises Rangel','C'),
('Ricardo Roman',830429,'2006-08-17','Venezuela','R','R','Ricardo Roman','RHP'),
('Roki Sasaki',808963,'2001-11-03','Japan','R','R','Roki Sasaki','RHP');

create temporary table _m018_new (full_name text, signing_year int, mlb_id bigint, formal_transaction_date date, country_market text, list_key text, alias text, birth_date date, birth_country text, bats text, throws text, primary_position text, first_contract boolean) on commit drop;
insert into _m018_new values
('Alexander Albertus',2022,800316,'2022-06-01','Aruba','MLB_2022_LIST',null,'2004-10-27','Aruba','R','R','SS',true),
('Ilmerson Colon',2022,805623,'2022-06-20','Venezuela','MLB_2022_LIST',null,'2005-03-10','Venezuela','L','L','LHP',true),
('Edgar Aviles',2022,800530,'2022-04-14','Mexico','MLB_2022_LIST',null,'2005-01-20','Mexico','R','R','RHP',true),
('Eduardo Rojas',2024,821672,'2024-05-30','Venezuela','TBLA_2024',null,'2007-02-14','Venezuela','S','R','C',true),
('Aneudy Almonte',2025,825160,'2024-12-16','Dominican Republic','TBLA_2025',null,'2007-08-31','Dominican Republic','L','L','LHP',true),
('Hendry Arvelo',2025,829498,'2024-12-16','Dominican Republic','TBLA_2025',null,'2006-12-03','Dominican Republic','L','R','2B',true),
('Luis Gamez',2025,830800,'2025-01-30','Mexico','TBLA_2025',null,'2006-08-30','Mexico','R','R','RHP',true),
('Bryan Lara',2025,832440,'2025-01-28','Mexico','TBLA_2025',null,'2008-05-15','Mexico','R','R','RHP',true),
('Andres Luna',2025,831322,'2025-01-27','Mexico','TBLA_2025',null,'2007-10-12','Mexico','R','R','RHP',true),
('Ivan Pacheco',2025,830612,'2025-01-29','Mexico','TBLA_2025',null,'2006-10-21','Mexico','R','R','RHP',true),
('Alexis Reyes',2025,829490,'2024-12-16','Venezuela','TBLA_2025',null,'2007-03-05','Venezuela','R','R','RHP',true),
('Shai Romero',2025,829476,'2024-12-16','Dominican Republic','TBLA_2025',null,'2007-08-22','Dominican Republic','R','R','RHP',true),
('Cesar Sanchez',2025,829479,'2024-12-16','Dominican Republic','TBLA_2025',null,'2006-06-16','Dominican Republic','R','R','RHP',true),
('Samuel Savinon',2025,829493,'2024-12-16','Dominican Republic','TBLA_2025',null,'2006-11-28','Dominican Republic','R','R','RHP',true),
('Antoni Urena',2025,829482,'2024-12-16','Dominican Republic','TBLA_2025','Antoni Ureña','2006-11-30','Dominican Republic','S','R','SS',true),
('Ben Serunkuma',2022,805205,'2022-01-28',null,'LATER_2022',null,'2001-09-19','Uganda','R','R','RHP',true),
('Umar Male',2022,805773,'2022-01-28',null,'LATER_2022',null,'2001-05-14','Uganda','R','R','C',true),
('Anderson Estevez',2022,802740,'2022-02-17',null,'LATER_2022',null,'2004-12-12','Dominican Republic','R','R','RHP',true),
('Arod McKenzie',2022,803242,'2022-02-20',null,'LATER_2022',null,'2005-05-25','Panama','L','L','LHP',true),
('Agustin Acosta',2022,802528,'2022-02-21',null,'LATER_2022',null,'2004-09-07','Mexico','L','R','OF',true),
('Joseilyn Gonzalez',2022,805120,'2022-06-01',null,'LATER_2022',null,'2002-04-08','Dominican Republic','R','R','RHP',true),
('Ricardo Montero',2022,805110,'2022-06-01',null,'LATER_2022',null,'2004-02-17','Dominican Republic','R','R','RHP',true),
('Aldrin Batista',2022,702881,'2022-06-01',null,'LATER_2022',null,'2003-05-04','Dominican Republic','R','R','RHP',true),
('Angel Cruz',2022,807654,'2022-07-02',null,'LATER_2022',null,'2004-10-12','Dominican Republic','R','R','RHP',true),
('Franderly Morel',2022,806918,'2022-07-02',null,'LATER_2022',null,'2003-09-12','Dominican Republic','L','L','LHP',true),
('Rodmar Angela',2022,806791,'2022-07-02',null,'LATER_2022',null,'2004-09-20','Curacao','L','L','OF',true),
('Jose Torrez',2022,807404,'2022-07-02',null,'LATER_2022',null,'2004-10-05','Nicaragua','R','R','C',true),
('Railin Familia',2022,812747,'2022-07-02',null,'LATER_2022',null,'2004-09-15','Dominican Republic','R','R','C',true),
('Abel Lorenzo',2022,806867,'2022-07-02',null,'LATER_2022',null,'2005-08-14','Dominican Republic','L','R','OF',true),
('Jecsua Liborius',2022,807403,'2022-07-02',null,'LATER_2022',null,'2005-05-28','Venezuela','R','R','RHP',true),
('Paris Johnson',2022,807379,'2022-07-02',null,'LATER_2022',null,'2005-03-09','Bahamas','R','R','OF',true),
('Jeremy Castro',2022,812746,'2022-07-02',null,'LATER_2022',null,'2005-01-27','Germany','R','R','RHP',true),
('Jose Gonzalez',2022,806919,'2022-07-02',null,'LATER_2022',null,'2005-01-29','Venezuela','L','R','OF',true),
('Marco Corcho',2022,806866,'2022-07-03',null,'LATER_2022',null,'2005-05-02','Colombia','R','R','RHP',true),
('Tim Fischer',2022,808444,'2022-07-06',null,'LATER_2022',null,'2004-09-08','Germany','R','R','RHP',true),
('Juan Hernandez',2022,806638,'2022-07-28',null,'LATER_2022',null,'2002-11-19','Dominican Republic','R','R','RHP',true),
('Javier Bartolozzi',2022,812745,'2022-08-03',null,'LATER_2022',null,'2005-04-14','Venezuela','R','R','RHP',true),
('Erick Nava',2022,812748,'2022-08-05',null,'LATER_2022',null,'2005-01-09','Venezuela','R','R','RHP',true),
('Edgar Gomez',2022,807626,'2022-11-04',null,'LATER_2022',null,'2005-04-07','Mexico','R','R','RHP',true);

create temporary table _m018_candidates (full_name text, mlb_id bigint, transaction_date date, period_year int, first_contract boolean, birth_country text, position text, ingested boolean) on commit drop;
insert into _m018_candidates values
('Ben Serunkuma',805205,'2022-01-28',2022,true,'Uganda','RHP',true),
('Umar Male',805773,'2022-01-28',2022,true,'Uganda','C',true),
('Anderson Estevez',802740,'2022-02-17',2022,true,'Dominican Republic','RHP',true),
('Arod McKenzie',803242,'2022-02-20',2022,true,'Panama','LHP',true),
('Agustin Acosta',802528,'2022-02-21',2022,true,'Mexico','OF',true),
('Joseilyn Gonzalez',805120,'2022-06-01',2022,true,'Dominican Republic','RHP',true),
('Ricardo Montero',805110,'2022-06-01',2022,true,'Dominican Republic','RHP',true),
('Aldrin Batista',702881,'2022-06-01',2022,true,'Dominican Republic','RHP',true),
('Angel Cruz',807654,'2022-07-02',2022,true,'Dominican Republic','RHP',true),
('Franderly Morel',806918,'2022-07-02',2022,true,'Dominican Republic','LHP',true),
('Rodmar Angela',806791,'2022-07-02',2022,true,'Curacao','OF',true),
('Jose Torrez',807404,'2022-07-02',2022,true,'Nicaragua','C',true),
('Railin Familia',812747,'2022-07-02',2022,true,'Dominican Republic','C',true),
('Abel Lorenzo',806867,'2022-07-02',2022,true,'Dominican Republic','OF',true),
('Jecsua Liborius',807403,'2022-07-02',2022,true,'Venezuela','RHP',true),
('Paris Johnson',807379,'2022-07-02',2022,true,'Bahamas','OF',true),
('Jeremy Castro',812746,'2022-07-02',2022,true,'Germany','RHP',true),
('Jose Gonzalez',806919,'2022-07-02',2022,true,'Venezuela','OF',true),
('Marco Corcho',806866,'2022-07-03',2022,true,'Colombia','RHP',true),
('Tim Fischer',808444,'2022-07-06',2022,true,'Germany','RHP',true),
('Juan Hernandez',806638,'2022-07-28',2022,true,'Dominican Republic','RHP',true),
('Javier Bartolozzi',812745,'2022-08-03',2022,true,'Venezuela','RHP',true),
('Erick Nava',812748,'2022-08-05',2022,true,'Venezuela','RHP',true),
('Rancer Adon',800094,'2022-11-04',2022,false,'Dominican Republic','RHP',false),
('Edgar Gomez',807626,'2022-11-04',2022,true,'Mexico','RHP',true),
('Angel Paredes',823819,'2024-01-24',2024,true,'Dominican Republic','RHP',false),
('Josehp Marte',824213,'2024-04-16',2024,true,'Dominican Republic','RHP',false),
('Ching-Hsien Ko',828667,'2024-06-04',2024,true,'Taiwan','OF',false),
('Gregg Ferrera',828305,'2024-06-25',2024,true,'Nicaragua','RHP',false),
('Jeremy Florian',828361,'2024-07-01',2024,true,'Dominican Republic','RHP',false),
('Jesus Villaflor',834565,'2025-05-15',2025,true,'Mexico','OF',false),
('Albert Feliz',833184,'2025-05-20',2025,true,'Dominican Republic','RHP',false),
('Logan Tinkam',835198,'2025-05-29',2025,true,'Nicaragua','RHP',false),
('Jose Taveras',835617,'2025-06-15',2025,true,'Dominican Republic','RHP',false),
('Randy Maria',835912,'2025-07-01',2025,true,'Dominican Republic','RHP',false),
('Roimer Rosas',836099,'2025-07-14',2025,true,'Venezuela','RHP',false),
('Enmanuel De La Rosa',836342,'2025-08-01',2025,true,'Dominican Republic','RHP',false),
('Junior Pena',825605,'2025-10-09',2025,true,'Dominican Republic','LHP',false),
('Micheal Morfe',837314,'2025-10-20',2025,true,'Venezuela','RHP',false),
('Angel Medina',837317,'2025-12-10',2025,true,'Dominican Republic','LHP',false);

create temporary table _m018_list (mlb_id bigint, signing_year int, listed_name text, listed_country text, published_spelling text) on commit drop;
insert into _m018_list values
(703153,2022,'Samuel Munoz','Dominican Republic','Samuel Munoz'),
(800355,2022,'Luciano Romero','Venezuela','Luciano Romero'),
(703193,2022,'Accimias Morales','Venezuela','Accimias Morales'),
(800543,2022,'Josue De Paula','United States','Josue De Paula'),
(800419,2022,'Jeral Perez','Dominican Republic','Jeral Perez'),
(800380,2022,'Raynerd Ortega','Venezuela','Raynerd Ortega'),
(800351,2022,'Javier Pena','Dominican Republic','Javier Pena'),
(800302,2022,'Mairoshendrick Martinus','Curacao','Mairoshendrick Martinus'),
(800332,2022,'Victor Rodrigues','Venezuela','Victor Rodrigues'),
(800408,2022,'Jholbran Herder','Venezuela','Jholbran Herder'),
(800337,2022,'Yorfran Medina','Venezuela','Yorfran Medina'),
(800361,2022,'Peter Bonilla','Spain','Peter Bonilla'),
(800316,2022,'Alexander Albertus','Aruba','Alexander Albertus'),
(800370,2022,'Eduardo Guerrero','Venezuela','Eduardo Guerrero'),
(800527,2022,'Callum Wallace','Australia','Callum Wallace'),
(800424,2022,'Oswaldo Osorio','Venezuela','Oswaldo Osorio'),
(800399,2022,'Miguel Dominguez','Panama','Miguel Dominguez'),
(805623,2022,'Ilmerson Colon','Venezuela','Ilmerson Colon'),
(800487,2022,'Roiger Mujica','Venezuela','Roiger Mujica'),
(800366,2022,'Yoryi Simarra','Colombia','Yoryi Simarra'),
(800344,2022,'Sean Linan','Colombia','Sean Linan'),
(800383,2022,'Domingo Geronimo','Dominican Republic','Domingo Geronimo'),
(800390,2022,'Natanael Castillo','Dominican Republic','Natanael Castillo'),
(800447,2022,'Yuliangel De La Cruz','Dominican Republic','Yuliangel De La Cruz'),
(800288,2022,'Enrike Sevilya','Russia','Enrike Sevilya'),
(800530,2022,'Edgar Aviles','Mexico','Edgar Aviles'),
(800481,2022,'Steven Castillo','Nicaragua','Steven Castillo'),
(800328,2022,'Daniel Arrias','Venezuela','Daniel Arrias'),
(800453,2022,'Edgar Leon','Venezuela','Edgar Leon'),
(800494,2022,'Kosuke Matsuda','Japan','Kosuke Matsuda'),
(800395,2022,'Nicolas Cruz','Venezuela','Nicolas Cruz'),
(815896,2024,'Emil Morales','Dominican Republic','Emil Morales'),
(821801,2024,'Rafy Peguero','Dominican Republic','Rafy Peguero'),
(821808,2024,'Allen Ajoti','Uganda','Allan Atoji'),
(821826,2024,'Alexis Dominguez','Dominican Republic','Alexis Dominguez'),
(821689,2024,'Francisco Espinoza','Venezuela','Francisco Esponoza'),
(821684,2024,'Yojackson Laya','Venezuela','Yojackson Laya'),
(821653,2024,'Jose Lopez','Dominican Republic','Jose Lopez'),
(821697,2024,'Reyli Mariano','Dominican Republic','Reyli Mariano'),
(821650,2024,'Christian Muniz','Mexico','Christian Muñiz'),
(821786,2024,'Erny Orellana','Venezuela','Erny Orellana'),
(821636,2024,'Leider Padilla','Venezuela','Leider Padilla'),
(821263,2024,'Heudy Pena','Dominican Republic','Heudy Peña'),
(821612,2024,'Axel Perez','Dominican Republic','Axel Perez'),
(821633,2024,'Angel Ramirez','Mexico','Angel Ramirez'),
(821679,2024,'Michael Ramirez','Venezuela','Michael Ramírez'),
(821672,2024,'Eduardo Rojas','Venezuela','Eduardo Rojas'),
(821661,2024,'David Romero','Venezuela','David Romero'),
(821817,2024,'Euri Rosa','Dominican Republic','Eury Rosa'),
(821658,2024,'Carlos Sardina','Venezuela','Carlos Sardiña'),
(808963,2025,'Roki Sasaki','Japan','Roki Sasaki'),
(830397,2025,'Adrian Torres','Panama','Adrian Torres'),
(830434,2025,'Luis Tovar','Venezuela','Luis Tovar'),
(830463,2025,'Luis Luna','Colombia','Luis Luna'),
(830420,2025,'Jhosman Theran','Colombia','Jhosman Theran'),
(830432,2025,'Moises Acacio','Venezuela','Moises Acacio'),
(825160,2025,'Aneudy Almonte','Dominican Republic','Aneudy Almonte'),
(830452,2025,'Ezequiel Aparicio','Venezuela','Ezequiel Aparicio'),
(830468,2025,'Derik Aquino','Dominican Republic','Derik Aquino'),
(829498,2025,'Hendry Arvelo','Dominican Republic','Hendry Arvelo'),
(830426,2025,'Devlyn Bautista','Dominican Republic','Devlyn Bautista'),
(830481,2025,'Degerson Diaz','Venezuela','Degerson Diaz'),
(830800,2025,'Luis Gamez','Mexico','Luis Gamez'),
(830459,2025,'Jhon Gil','Venezuela','Jhon Gil'),
(832440,2025,'Bryan Lara','Mexico','Bryan Lara'),
(831322,2025,'Andres Luna','Mexico','Andres Luna'),
(830471,2025,'Juan Macero','Venezuela','Juan Macero'),
(830612,2025,'Ivan Pacheco','Mexico','Ivan Pacheco'),
(830439,2025,'Carlos Ramirez','Venezuela','Carlos Ramirez'),
(830404,2025,'Moises Rangel','Venezuela','Moises Rangel'),
(829490,2025,'Alexis Reyes','Venezuela','Alexis Reyes'),
(830449,2025,'Jose Rivas','Venezuela','Jose Rivas'),
(830429,2025,'Ricardo Roman','Venezuela','Ricardo Roman'),
(829476,2025,'Shai Romero','Dominican Republic','Shai Romero'),
(829479,2025,'Cesar Sanchez','Dominican Republic','Cesar Sanchez'),
(829493,2025,'Samuel Savinon','Dominican Republic','Samuel Savinon'),
(830188,2025,'Joseph Deng Thon','South Sudan','Joseph Deng Thon'),
(829482,2025,'Antoni Urena','Dominican Republic','Antoni Ureña'),
(830413,2025,'Jose Villegas','Venezuela','Jose Villegas');

create temporary table _m018_market (mlb_id bigint, signing_year int, country_market text) on commit drop;
insert into _m018_market values
(821801,2024,'Dominican Republic'),
(821808,2024,'Uganda'),
(821826,2024,'Dominican Republic'),
(821689,2024,'Venezuela'),
(821684,2024,'Venezuela'),
(821697,2024,'Dominican Republic'),
(821650,2024,'Mexico'),
(821786,2024,'Venezuela'),
(821636,2024,'Venezuela'),
(821263,2024,'Dominican Republic'),
(821612,2024,'Dominican Republic'),
(821633,2024,'Mexico'),
(821679,2024,'Venezuela'),
(821661,2024,'Venezuela'),
(821817,2024,'Dominican Republic'),
(821658,2024,'Venezuela'),
(830463,2025,'Colombia'),
(830420,2025,'Colombia'),
(830432,2025,'Venezuela'),
(830452,2025,'Venezuela'),
(830468,2025,'Dominican Republic'),
(830426,2025,'Dominican Republic'),
(830481,2025,'Venezuela'),
(830459,2025,'Venezuela'),
(830471,2025,'Venezuela'),
(830439,2025,'Venezuela'),
(830404,2025,'Venezuela'),
(830449,2025,'Venezuela'),
(830429,2025,'Venezuela'),
(830413,2025,'Venezuela');

-- ===========================================================================
-- 5. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, publication_date, accessed_at, notes, source_tier)
values
('True Blue LA', 'SECONDARY_CLASS_RECONSTRUCTION', 'Dodgers 2024 international signings (class table)',
 'https://www.truebluela.com/2024/1/16/24039199/dodgers-international-signing-period-2024-emil-morales-rafy-peguero',
 date '2024-01-16', timestamptz '2026-10-05 00:00:00+00',
 'Lists the Dodgers'' initial 19 signings: seven pitchers, five infielders, four catchers, three outfielders. Spells the Ugandan catcher "Allan Atoji" (MLB: Allen Ajoti). Its country totals (9 Venezuela, 7 Dominican Republic) disagree with its own table for Jose Lopez.',
 'SECONDARY_CLASS_RECONSTRUCTION'),
('True Blue LA', 'SECONDARY_CLASS_RECONSTRUCTION', 'Dodgers 2025 international signings (class table)',
 'https://www.truebluela.com/2025/1/27/24353426/dodgers-2025-international-signings',
 date '2025-01-27', timestamptz '2026-10-05 00:00:00+00',
 'Lists all 29 players with position and country: 12 Venezuela, 8 Dominican Republic, 4 Mexico, 2 Colombia, 1 each Japan, Panama, South Sudan.',
 'SECONDARY_CLASS_RECONSTRUCTION'),
('Dodgers Digest', 'SECONDARY_CLASS_RECONSTRUCTION', 'Dodgers sign 29 players in IFA class',
 'https://dodgersdigest.com/2025/01/28/dodgers-sign-29-players-in-ifa-class-trade-two-prospects-for-bonus-pool-money/',
 date '2025-01-28', timestamptz '2026-10-05 00:00:00+00',
 'Full 29-player list. States seven players agreed to terms before the end of the 2024 signing period (bonuses from the 2024 pool) yet were announced with the 2025 class.',
 'SECONDARY_CLASS_RECONSTRUCTION')
on conflict (url) do update set
  title = excluded.title, source_type = excluded.source_type, notes = excluded.notes,
  publication_date = coalesce(public.sources.publication_date, excluded.publication_date),
  source_tier = excluded.source_tier;

-- Publication dates verified on the live pages.
update public.sources s set publication_date = v.d
from (values
  ('https://www.mlb.com/news/dodgers-sign-26-international-prospects-c240715336', date '2017-07-06'),
  ('https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings', date '2021-01-15'),
  ('https://www.mlb.com/news/dodgers-2023-international-prospects-signings', date '2023-01-16')
) as v(url, d)
where s.url = v.url and s.publication_date is null;

update public.sources
set notes = coalesce(notes || ' ', '') || 'Verified 2026-10-05: reports 26 signings during the recently completed 2016-17 international signing period (11 pitchers, 15 position players).'
where url = 'https://www.mlb.com/news/dodgers-sign-26-international-prospects-c240715336'
  and coalesce(notes, '') not like '%2016-17 international signing period%';

update public.sources
set notes = coalesce(notes || ' ', '') || 'Verified 2026-10-05: the article lists 31 player names under "agreed to deals ... in the 2022 international signing period" while reporting 30 players.'
where url = 'https://www.mlb.com/news/dodgers-2022-international-prospects'
  and coalesce(notes, '') not like '%lists 31 player names%';

-- One MLB transaction-history and one MLB person-record source per player.
insert into public.sources (source_name, source_type, title, url, accessed_at, source_tier)
select distinct 'MLB Stats API', 'MLB_PLAYER_TRANSACTIONS', 'MLB transaction history: ' || x.name,
       'https://statsapi.mlb.com/api/v1/transactions?playerId=' || x.mlb_id,
       timestamptz '2026-10-05 00:00:00+00', 'MLB_TRANSACTION_LOG'
from (
  select mlb_id, full_name as name from _m018_existing
  union select mlb_id, full_name from _m018_new
  union select mlb_id, full_name from _m018_candidates
) x
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url, accessed_at, source_tier)
select distinct 'MLB Stats API', 'MLB_PLAYER_RECORD', 'MLB player record: ' || x.name,
       'https://statsapi.mlb.com/api/v1/people/' || x.mlb_id,
       timestamptz '2026-10-05 00:00:00+00', 'MILB_MLB_PLAYER_RECORD'
from (select mlb_id, mlb_full_name as name from _m018_person union select mlb_id, full_name from _m018_new) x
on conflict (url) do nothing;

update public.sources set source_tier = public.disi_infer_source_tier(url, source_type) where source_tier is null;

-- ===========================================================================
-- 6. IDENTITY: MLB ids and MLB person facts for existing players (fill NULLs only)
-- ===========================================================================

update public.players p
set mlb_id = e.mlb_id
from _m018_existing e
join public.signings s on s.signing_year = e.signing_year
join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
where s.player_id = p.id
  and p.full_name = e.full_name
  and p.mlb_id is null
  and not exists (select 1 from public.players other where other.mlb_id = e.mlb_id);

update public.players p
set birth_date = coalesce(p.birth_date, f.birth_date),
    birth_country = coalesce(p.birth_country, f.birth_country),
    bats = coalesce(p.bats, f.bats),
    throws = coalesce(p.throws, f.throws)
from _m018_person f
where p.mlb_id = f.mlb_id;

-- Evidence for each person fact that now matches the MLB record.
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', p.id, v.field, src.id, 'VERIFIED'::public.confidence_level, 'MLB person record (statsapi.mlb.com).'
from _m018_person f
join public.players p on p.mlb_id = f.mlb_id
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || f.mlb_id
cross join lateral (values
  ('mlb_id', true),
  ('birth_date', p.birth_date is not distinct from f.birth_date and f.birth_date is not null),
  ('birth_country', p.birth_country is not distinct from f.birth_country and f.birth_country is not null),
  ('bats', p.bats is not distinct from f.bats and f.bats is not null),
  ('throws', p.throws is not distinct from f.throws and f.throws is not null)
) as v(field, applies)
where v.applies
  and not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = p.id
                  and e.field_name = v.field and e.source_id = src.id);

-- MLB's own spelling becomes an alias when DISI's canonical name differs.
insert into public.player_aliases (player_id, alias, alias_type, source_id)
select p.id, f.mlb_full_name, 'MLB_RECORD_NAME', src.id
from _m018_person f
join public.players p on p.mlb_id = f.mlb_id
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/people/' || f.mlb_id
where f.mlb_full_name <> p.full_name
on conflict (player_id, alias) do nothing;

-- ===========================================================================
-- 7. FORMAL TRANSACTION DATES FOR EXISTING SIGNINGS
-- ===========================================================================

update public.signings s
set formal_transaction_date = coalesce(s.formal_transaction_date, e.formal_transaction_date),
    transaction_source_id = coalesce(s.transaction_source_id, src.id),
    signing_date = coalesce(s.signing_date, e.formal_transaction_date)
from _m018_existing e
join public.players p on p.mlb_id = e.mlb_id
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/transactions?playerId=' || e.mlb_id
where s.player_id = p.id
  and s.signing_year = e.signing_year
  and s.organization_id in (select id from public.organizations where franchise_key = 'DODGERS');

-- ===========================================================================
-- 8. NEW PLAYERS AND SIGNINGS (keyed by MLB person id, never by name)
-- ===========================================================================

insert into public.players (full_name, canonical_name, birth_date, birth_country, primary_position, bats, throws, mlb_id)
select n.full_name, n.full_name, n.birth_date, n.birth_country, n.primary_position, n.bats, n.throws, n.mlb_id
from _m018_new n
where not exists (select 1 from public.players p where p.mlb_id = n.mlb_id);

insert into public.signings (
  player_id, organization_id, signing_date, signing_year, country_market, pathway,
  bonus_publicly_reported, record_scope, formal_transaction_date, transaction_source_id, notes
)
select
  p.id, lad.id, n.formal_transaction_date, n.signing_year, n.country_market,
  case
    when coalesce(n.country_market, n.birth_country) in
      ('Dominican Republic','Venezuela','Colombia','Curacao','Aruba','Panama','Nicaragua','Mexico','Cuba')
      then 'LATAM_AMATEUR'::public.acquisition_pathway
    else 'OTHER'::public.acquisition_pathway
  end,
  false, 'TRACKED_DODGERS', n.formal_transaction_date, src.id,
  case n.list_key
    when 'LATER_2022' then 'Later 2022-period signing: MLB transaction record shows this as the player''s first professional contract (international amateur free agent by birth country, draft status and transaction history). Bonus and bonus-pool treatment not established.'
    when 'MLB_2022_LIST' then 'Named in MLB.com''s 2022 Dodgers class list; formal MLB transaction recorded later in the period.'
    when 'TBLA_2024' then 'Announced 2024 class member; formal MLB transaction recorded later in the period.'
    else 'Announced 2025 class member.'
  end
from _m018_new n
join public.players p on p.mlb_id = n.mlb_id
join public.organizations lad on lad.abbreviation = 'LAD'
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/transactions?playerId=' || n.mlb_id
on conflict (player_id, organization_id, signing_year) do nothing;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id,
       case when n.list_key = 'LATER_2022' then 'HIGH' else 'VERIFIED' end::public.confidence_level,
       'MLB transaction record: signed as free agent on ' || to_char(n.formal_transaction_date, 'YYYY-MM-DD') || '.'
from _m018_new n
join public.players p on p.mlb_id = n.mlb_id
join public.signings s on s.player_id = p.id and s.signing_year = n.signing_year
join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/transactions?playerId=' || n.mlb_id
where not exists (select 1 from public.evidence e where e.entity_type = 'signing' and e.entity_id = s.id
                  and e.source_id = src.id and e.field_name is null);

-- Transaction-date evidence for every signing that now has an MLB transaction
-- record (runs after the inserts above so a single run reaches the final state).
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, 'formal_transaction_date', s.transaction_source_id, 'VERIFIED'::public.confidence_level,
       'MLB transaction record: signed as free agent on ' || to_char(s.formal_transaction_date, 'YYYY-MM-DD') || '.'
from public.signings s
where s.transaction_source_id is not null
  and not exists (select 1 from public.evidence e where e.entity_type = 'signing' and e.entity_id = s.id
                  and e.field_name = 'formal_transaction_date' and e.source_id = s.transaction_source_id);

-- ===========================================================================
-- 9. MARKETS AND ALIASES FROM CLASS LISTS (fill NULL markets only)
-- ===========================================================================

update public.signings s
set country_market = m.country_market
from _m018_market m
join public.players p on p.mlb_id = m.mlb_id
where s.player_id = p.id and s.signing_year = m.signing_year and s.country_market is null;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, 'country_market', src.id, 'HIGH'::public.confidence_level,
       'Country published in the class list: ' || l.listed_country || '.'
from _m018_list l
join public.players p on p.mlb_id = l.mlb_id
join public.signings s on s.player_id = p.id and s.signing_year = l.signing_year
join public.sources src on src.url = case l.signing_year
  when 2022 then 'https://www.mlb.com/news/dodgers-2022-international-prospects'
  when 2024 then 'https://www.truebluela.com/2024/1/16/24039199/dodgers-international-signing-period-2024-emil-morales-rafy-peguero'
  else 'https://www.truebluela.com/2025/1/27/24353426/dodgers-2025-international-signings' end
where s.country_market = l.listed_country
  and not exists (select 1 from public.evidence e where e.entity_type = 'signing' and e.entity_id = s.id
                  and e.field_name = 'country_market' and e.source_id = src.id);

-- Published spellings that differ from the canonical MLB name become aliases
-- (e.g. "Allan Atoji" for MLB's Allen Ajoti; "Antoni Ureña" for Antoni Urena).
insert into public.player_aliases (player_id, alias, alias_type, source_id)
select p.id, l.published_spelling, 'PUBLISHED_SPELLING', src.id
from _m018_list l
join public.players p on p.mlb_id = l.mlb_id
join public.sources src on src.url = case l.signing_year
  when 2024 then 'https://www.truebluela.com/2024/1/16/24039199/dodgers-international-signing-period-2024-emil-morales-rafy-peguero'
  else 'https://www.truebluela.com/2025/1/27/24353426/dodgers-2025-international-signings' end
where l.signing_year in (2024, 2025)
  and l.published_spelling is not null
  and l.published_spelling <> p.full_name
on conflict (player_id, alias) do nothing;

-- ===========================================================================
-- 10. ANNOUNCED DATES (Pacific date of the announcing source; fill NULL only)
-- ===========================================================================

update public.signings s
set announced_date = v.announced
from _m018_list l
join public.players p on p.mlb_id = l.mlb_id
join (values (2022, date '2022-01-16'), (2024, date '2024-01-15'), (2025, date '2025-01-27')) v(yr, announced)
  on v.yr = l.signing_year
where s.player_id = p.id and s.signing_year = l.signing_year and s.announced_date is null;

update public.signings s
set announced_date = v.announced
from (values
  ('https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings', 2021, date '2021-01-15'),
  ('https://www.mlb.com/news/dodgers-2023-international-prospects-signings', 2023, date '2023-01-15')
) v(url, yr, announced)
join public.sources src on src.url = v.url
join public.evidence e on e.source_id = src.id and e.entity_type = 'signing'
where e.entity_id = s.id and s.signing_year = v.yr and s.announced_date is null;

-- ===========================================================================
-- 11. LEGACY COVERAGE ROWS: explicit population scope (documented, not silent)
-- ===========================================================================

update public.signing_census_coverage c
set population_scope = v.scope, population_note = v.note
from (values
  ('LAD', 1951, 2012, 'HISTORICAL_VERIFIED', 'HISTORICAL_VERIFIED_SET',
   'Individually verified historical acquisitions; not a census.'),
  ('LAD', 2013, 2013, 'PARTIAL_CENSUS', 'OTHER_DEFINED_POPULATION',
   'The 47 reported signings are calendar-year 2013, not a signing period. Membership of the five named players in that calendar-year population is provisional.'),
  ('LAD', 2017, 2017, 'PARTIAL_CENSUS', 'FULL_SIGNING_PERIOD',
   'The source reports 26 signings in the completed 2016-17 period (July 2, 2016 - June 15, 2017). The 2017 rows in DISI (Vivas, Vargas, Pages, Leonard) belong to the 2017-18 period, so this row compared two different populations. 018 models it as population DODGERS-2016-17-FULL-PERIOD.'),
  ('LAD', 2021, 2021, 'COMPLETE_CENSUS', 'OPENING_CLASS',
   'Official release at the opening of the 2021 period (22 players). Completeness applies to the announced opening class only, not the full signing period.'),
  ('LAD', 2022, 2022, 'PARTIAL_CENSUS', 'OPENING_CLASS',
   'Announced 2022 opening class (30 reported; 31 names listed). Not the full signing period.'),
  ('LAD', 2023, 2023, 'COMPLETE_CENSUS', 'OPENING_CLASS',
   'Announced 2023 opening class (13). Not the full signing period.'),
  ('LAD', 2024, 2024, 'PARTIAL_CENSUS', 'OPENING_CLASS',
   'Announced 2024 opening class (19). Not the full signing period.'),
  ('LAD', 2025, 2025, 'PARTIAL_CENSUS', 'OPENING_CLASS',
   'Announced 2025 opening class (29). Not the full signing period.')
) as v(abbr, y1, y2, ctype, scope, note)
join public.organizations o on o.abbreviation = v.abbr
where c.organization_id = o.id and c.period_start_year = v.y1 and c.period_end_year = v.y2
  and c.coverage_type = v.ctype;

update public.signing_census_coverage
set population_scope = 'TOP_PROSPECT_SAMPLE',
    population_note = 'MLB Pipeline Top 30 tracker: a prospect sample, never a league signing census.'
where organization_id is null and coverage_type = 'TOP_PROSPECT_SAMPLE';

-- ===========================================================================
-- 12. POPULATION DEFINITIONS
-- ===========================================================================

with defs (population_key, franchise_key, scope, y1, y2, period_label, start_date, end_date, announced_on,
           expected, source_url, composition, rate_suitable, legacy_abbr, legacy_y1, legacy_y2, legacy_type, notes) as (
  values
  ('DODGERS-1951-2012-HISTORICAL', 'DODGERS', 'HISTORICAL_VERIFIED_SET', 1951, 2012, '1951–2012', null::date, null::date, null::date,
   null::int, null::text, null::jsonb, false, 'LAD', 1951, 2012, 'HISTORICAL_VERIFIED',
   'Individually verified historical Dodgers international acquisitions. A sample, not a census.'),
  ('DODGERS-2013-CALENDAR-YEAR', 'DODGERS', 'OTHER_DEFINED_POPULATION', 2013, 2013, 'Calendar year 2013', date '2013-01-01', date '2013-12-31', null,
   47, 'https://www.mlb.com/dodgers/news/dodgers-sign-five-international-prospects/c-66376462', null, false, 'LAD', 2013, 2013, 'PARTIAL_CENSUS',
   'MLB reported 47 Dodgers international amateur signings in calendar year 2013 (spans two signing periods). Named members are provisional.'),
  ('DODGERS-2016-17-FULL-PERIOD', 'DODGERS', 'FULL_SIGNING_PERIOD', 2016, 2016, '2016-17', date '2016-07-02', date '2017-06-15', null,
   26, 'https://www.mlb.com/news/dodgers-sign-26-international-prospects-c240715336',
   '{"positions": {"P": 11, "position_players": 15}}'::jsonb, true, 'LAD', 2017, 2017, 'PARTIAL_CENSUS',
   'Completed 2016-17 period (July 2, 2016 - June 15, 2017). Mapped to class year 2016, when the period opened. No player-level members are recorded yet.'),
  ('DODGERS-2018-OPENING', 'DODGERS', 'OPENING_CLASS', 2018, 2018, '2018-19 opening', date '2018-07-02', null, null,
   null, null, null, false, null, null, null, null,
   'Players named in the Dodgers'' July 2018 opening-day announcement. Class size not stated by the source.'),
  ('DODGERS-2019-20-FULL-PERIOD', 'DODGERS', 'FULL_SIGNING_PERIOD', 2019, 2019, '2019-20', date '2019-07-02', null, null,
   50, 'https://www.mlb.com/news/international-signing-period-roundup-2019-2020', null, true, null, null, null, null,
   'MLB''s 2019-20 roundup reports 50 Dodgers signings for the period. Only players named in that roundup are members here.'),
  ('DODGERS-2021-OPENING', 'DODGERS', 'OPENING_CLASS', 2021, 2021, '2021 opening', date '2021-01-15', null, date '2021-01-15',
   22, 'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings',
   '{"positions": {"P": 12, "C": 3, "IF": 4, "OF": 3}}'::jsonb, false, 'LAD', 2021, 2021, 'COMPLETE_CENSUS',
   'Official release, 2021-01-15: agreed to terms with 22 international players at the opening of the period.'),
  ('DODGERS-2021-FULL-PERIOD', 'DODGERS', 'FULL_SIGNING_PERIOD', 2021, 2021, '2021', date '2021-01-15', date '2021-12-15', null,
   null, null, null, true, null, null, null, null,
   'Full 2021 signing period. No source for the full-period total has been found; later-period signings not yet researched.'),
  ('DODGERS-2022-OPENING', 'DODGERS', 'OPENING_CLASS', 2022, 2022, '2022 opening', date '2022-01-15', null, date '2022-01-16',
   30, 'https://www.mlb.com/news/dodgers-2022-international-prospects', null, false, 'LAD', 2022, 2022, 'PARTIAL_CENSUS',
   'MLB.com, 2022-01-16: reports 30 players but lists 31 names. Three listed players (Aviles, Albertus, Colon) have MLB transactions dated later in the period.'),
  ('DODGERS-2022-FULL-PERIOD', 'DODGERS', 'FULL_SIGNING_PERIOD', 2022, 2022, '2022', date '2022-01-15', date '2022-12-15', null,
   null, null, null, true, null, null, null, null,
   'Full 2022 period (Jan 15 - Dec 15, 2022). Members are signings with an MLB transaction in the period. No source states the full-period total.'),
  ('DODGERS-2023-OPENING', 'DODGERS', 'OPENING_CLASS', 2023, 2023, '2023 opening', date '2023-01-15', null, date '2023-01-15',
   13, 'https://www.mlb.com/news/dodgers-2023-international-prospects-signings',
   '{"countries": {"Dominican Republic": 6, "Venezuela": 7}}'::jsonb, false, 'LAD', 2023, 2023, 'COMPLETE_CENSUS',
   'Club announcement at the opening of the 2023 period (13 players).'),
  ('DODGERS-2023-FULL-PERIOD', 'DODGERS', 'FULL_SIGNING_PERIOD', 2023, 2023, '2023', date '2023-01-15', date '2023-12-15', null,
   null, null, null, true, null, null, null, null,
   'Full 2023 signing period. Later-period signings not yet researched.'),
  ('DODGERS-2024-OPENING', 'DODGERS', 'OPENING_CLASS', 2024, 2024, '2024 opening', date '2024-01-15', null, date '2024-01-15',
   19, 'https://www.mlb.com/press-release/press-release-dodgers-announce-2024-international-signings',
   '{"positions": {"P": 7, "C": 4, "IF": 5, "OF": 3}}'::jsonb, false, 'LAD', 2024, 2024, 'PARTIAL_CENSUS',
   'Official release: 19 international amateur free agents (7 P, 4 C, 5 IF, 3 OF). Names from the True Blue LA class table.'),
  ('DODGERS-2024-FULL-PERIOD', 'DODGERS', 'FULL_SIGNING_PERIOD', 2024, 2024, '2024', date '2024-01-15', date '2024-12-15', null,
   null, null, null, true, null, null, null, null,
   'Full 2024 period (Jan 15 - Dec 15, 2024). No source states the full-period total; see signing_period_candidates for unclassified later signees.'),
  ('DODGERS-2025-OPENING', 'DODGERS', 'OPENING_CLASS', 2025, 2025, '2025 opening', date '2025-01-15', null, date '2025-01-27',
   29, 'https://www.mlb.com/press-release/press-release-dodgers-announce-2025-international-signings',
   '{"positions": {"P": 16, "C": 4, "IF": 6, "OF": 3}, "countries": {"Venezuela": 12, "Dominican Republic": 8, "Mexico": 4, "Colombia": 2, "Japan": 1, "Panama": 1, "South Sudan": 1}}'::jsonb,
   false, 'LAD', 2025, 2025, 'PARTIAL_CENSUS',
   'Official release: 29 international amateur free agents (16 P, 4 C, 6 IF, 3 OF; seven countries). Names from True Blue LA and Dodgers Digest.'),
  ('DODGERS-2025-FULL-PERIOD', 'DODGERS', 'FULL_SIGNING_PERIOD', 2025, 2025, '2025', date '2025-01-15', date '2025-12-15', null,
   null, null, null, true, null, null, null, null,
   'Full 2025 period (Jan 15 - Dec 15, 2025). Seven announced players have MLB transactions dated 2024-12-16 and are not assigned to either period. No source states the full-period total.'),
  ('MLB-2013-PIPELINE-TOP30', null, 'TOP_PROSPECT_SAMPLE', 2013, 2013, '2013 MLB Pipeline Top 30', null, null, null,
   30, null, null, false, null, 2013, 2013, 'TOP_PROSPECT_SAMPLE', 'League-wide prospect sample, not a census.'),
  ('MLB-2014-PIPELINE-TOP30', null, 'TOP_PROSPECT_SAMPLE', 2014, 2014, '2014 MLB Pipeline Top 30', null, null, null,
   30, null, null, false, null, 2014, 2014, 'TOP_PROSPECT_SAMPLE', 'League-wide prospect sample, not a census.')
)
insert into public.signing_populations (
  population_key, franchise_key, population_scope, class_year_start, class_year_end, period_label,
  period_start_date, period_end_date, announced_on, expected_size, expected_size_source_id,
  stated_composition, rate_analysis_suitable, legacy_coverage_id, notes
)
select d.population_key, d.franchise_key, d.scope, d.y1, d.y2, d.period_label, d.start_date, d.end_date, d.announced_on,
       d.expected, src.id, d.composition, d.rate_suitable,
       (select c.id from public.signing_census_coverage c
          left join public.organizations o on o.id = c.organization_id
        where c.period_start_year = d.legacy_y1 and c.period_end_year = d.legacy_y2
          and c.coverage_type = d.legacy_type
          and ((d.legacy_abbr is null and c.organization_id is null) or o.abbreviation = d.legacy_abbr)
        limit 1),
       d.notes
from defs d
left join public.sources src on src.url = d.source_url
on conflict (population_key) do update set
  franchise_key = excluded.franchise_key, population_scope = excluded.population_scope,
  class_year_start = excluded.class_year_start, class_year_end = excluded.class_year_end,
  period_label = excluded.period_label, period_start_date = excluded.period_start_date,
  period_end_date = excluded.period_end_date, announced_on = excluded.announced_on,
  expected_size = excluded.expected_size, expected_size_source_id = excluded.expected_size_source_id,
  stated_composition = excluded.stated_composition, rate_analysis_suitable = excluded.rate_analysis_suitable,
  legacy_coverage_id = excluded.legacy_coverage_id, notes = excluded.notes;

-- ===========================================================================
-- 13. POPULATION MEMBERSHIP AND ITS PROVENANCE
-- ===========================================================================

create temporary table _m018_membership (
  population_key text, signing_id uuid, membership_status text, source_id uuid,
  membership_basis text, supports_fields text[], confidence text, note text
) on commit drop;

-- 13a. Announced class lists (2022 MLB.com list; 2024 / 2025 secondary class tables).
insert into _m018_membership
select 'DODGERS-' || l.signing_year || '-OPENING', s.id, 'MEMBER', src.id,
       case when l.signing_year = 2022 then 'MLB_SIGNING_PERIOD_ARTICLE' else 'SECONDARY_CLASS_RECONSTRUCTION' end,
       array['CLASS_MEMBERSHIP','PUBLISHED_POSITION','PUBLISHED_COUNTRY'], 'HIGH',
       'Listed as ' || l.listed_name || ' (' || l.listed_country || ').'
from _m018_list l
join public.players p on p.mlb_id = l.mlb_id
join public.signings s on s.player_id = p.id and s.signing_year = l.signing_year
join public.sources src on src.url = case l.signing_year
  when 2022 then 'https://www.mlb.com/news/dodgers-2022-international-prospects'
  when 2024 then 'https://www.truebluela.com/2024/1/16/24039199/dodgers-international-signing-period-2024-emil-morales-rafy-peguero'
  else 'https://www.truebluela.com/2025/1/27/24353426/dodgers-2025-international-signings' end;

insert into _m018_membership
select 'DODGERS-2025-OPENING', s.id, 'MEMBER', src.id, 'SECONDARY_CLASS_RECONSTRUCTION',
       array['CLASS_MEMBERSHIP'], 'HIGH', null
from _m018_list l
join public.players p on p.mlb_id = l.mlb_id
join public.signings s on s.player_id = p.id and s.signing_year = l.signing_year
join public.sources src on src.url = 'https://dodgersdigest.com/2025/01/28/dodgers-sign-29-players-in-ifa-class-trade-two-prospects-for-bonus-pool-money/'
where l.signing_year = 2025;

-- 13b. Announcements already cited as evidence (2018, 2021, 2023 opening; 2019-20 roundup).
insert into _m018_membership
select v.population_key, s.id, 'MEMBER', src.id, v.basis, array['CLASS_MEMBERSHIP'], e.confidence::text, null
from (values
  ('DODGERS-2018-OPENING', 2018, 'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518', 'OFFICIAL_CLUB_ANNOUNCEMENT'),
  ('DODGERS-2019-20-FULL-PERIOD', 2019, 'https://www.mlb.com/news/international-signing-period-roundup-2019-2020', 'MLB_SIGNING_PERIOD_ARTICLE'),
  ('DODGERS-2021-OPENING', 2021, 'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings', 'OFFICIAL_CLUB_ANNOUNCEMENT'),
  ('DODGERS-2023-OPENING', 2023, 'https://www.mlb.com/news/dodgers-2023-international-prospects-signings', 'OFFICIAL_CLUB_ANNOUNCEMENT')
) v(population_key, yr, url, basis)
join public.sources src on src.url = v.url
join public.evidence e on e.source_id = src.id and e.entity_type = 'signing'
join public.signings s on s.id = e.entity_id and s.signing_year = v.yr;

-- 13c. Full signing periods: an MLB transaction dated inside the period.
insert into _m018_membership
select pop.population_key, s.id, 'MEMBER', s.transaction_source_id, 'MLB_PLAYER_TRANSACTION_HISTORY',
       array['CLASS_MEMBERSHIP','FORMAL_TRANSACTION_DATE'],
       case when n.list_key = 'LATER_2022' then 'HIGH' else 'VERIFIED' end,
       case when n.list_key = 'LATER_2022'
         then 'First professional contract per MLB transaction history; bonus-pool treatment not established.' end
from public.signing_populations pop
join public.signings s on s.signing_year = pop.class_year_start
  and s.formal_transaction_date between pop.period_start_date and pop.period_end_date
join public.organizations o on o.id = s.organization_id and o.franchise_key = pop.franchise_key
left join public.players p on p.id = s.player_id
left join _m018_new n on n.mlb_id = p.mlb_id
where pop.population_scope = 'FULL_SIGNING_PERIOD'
  and pop.population_key in ('DODGERS-2022-FULL-PERIOD', 'DODGERS-2024-FULL-PERIOD', 'DODGERS-2025-FULL-PERIOD')
  and s.transaction_source_id is not null;

-- ... and the club transaction-log pages already cited for the opening-day signings.
insert into _m018_membership
select pop.population_key, s.id, 'MEMBER', src.id, 'MLB_TRANSACTION_LOG', array['CLASS_MEMBERSHIP','FORMAL_TRANSACTION_DATE'], 'VERIFIED', null
from public.signing_populations pop
join public.signings s on s.signing_year = pop.class_year_start
join public.evidence e on e.entity_type = 'signing' and e.entity_id = s.id
join public.sources src on src.id = e.source_id and src.url ~* 'mlb\.com/dodgers/roster/transactions/'
where pop.population_key in ('DODGERS-2022-FULL-PERIOD', 'DODGERS-2024-FULL-PERIOD', 'DODGERS-2025-FULL-PERIOD')
  and s.formal_transaction_date between pop.period_start_date and pop.period_end_date;

-- 13d. Samples: historical verified set, calendar-2013 (provisional), MLB Pipeline trackers.
insert into _m018_membership
select 'DODGERS-1951-2012-HISTORICAL', s.id, 'MEMBER', e.source_id, 'HISTORICAL_RECORD', array['CLASS_MEMBERSHIP'], coalesce(e.confidence::text, 'MEDIUM'),
       case when e.source_id is null then 'Member by record scope; no source is linked to this signing yet.' end
from public.signings s
join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
left join public.evidence e on e.entity_type = 'signing' and e.entity_id = s.id and e.field_name is null
where s.record_scope = 'HISTORICAL_VERIFIED' and s.signing_year between 1951 and 2012;

insert into _m018_membership
select 'DODGERS-2013-CALENDAR-YEAR', s.id, 'PROVISIONAL', e.source_id, 'MLB_SIGNING_PERIOD_ARTICLE', array['CLASS_MEMBERSHIP'], 'MEDIUM',
       'Named in a Dodgers signing announcement; inclusion in the calendar-2013 population of 47 is not established.'
from public.signings s
join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
join public.evidence e on e.entity_type = 'signing' and e.entity_id = s.id and e.field_name is null
where s.signing_year = 2013;

insert into _m018_membership
select 'MLB-' || s.signing_year || '-PIPELINE-TOP30', s.id, 'MEMBER', e.source_id, 'PROSPECT_TRACKER', array['CLASS_MEMBERSHIP'], e.confidence::text, null
from public.signings s
join public.evidence e on e.entity_type = 'signing' and e.entity_id = s.id and e.field_name is null
where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT' and s.signing_year in (2013, 2014);

insert into public.signing_population_members (population_id, signing_id, membership_status, note)
select distinct on (pop.id, m.signing_id) pop.id, m.signing_id, m.membership_status, null
from _m018_membership m
join public.signing_populations pop on pop.population_key = m.population_key
order by pop.id, m.signing_id, (m.membership_status = 'MEMBER') desc
on conflict (population_id, signing_id) do nothing;

insert into public.signing_population_member_sources
  (member_id, source_id, membership_basis, supports_fields, confidence, note)
select distinct on (pm.id, m.source_id)
       pm.id, m.source_id, m.membership_basis, m.supports_fields, m.confidence::public.confidence_level, m.note
from _m018_membership m
join public.signing_populations pop on pop.population_key = m.population_key
join public.signing_population_members pm on pm.population_id = pop.id and pm.signing_id = m.signing_id
where m.source_id is not null
order by pm.id, m.source_id
on conflict (member_id, source_id) do nothing;

-- ===========================================================================
-- 14. SOURCE CONFLICTS (explicit; nothing is deleted or overwritten)
-- ===========================================================================

with conflicts (conflict_key, conflict_type, mlb_id, signing_year, population_key, field_name,
                value_a, source_a_url, value_b, source_b_url, status, resolution, note) as (
  values
  ('NAME:ajoti', 'NAME_SPELLING', 821808::bigint, 2024, null::text, 'full_name',
   'Allen Ajoti', 'https://statsapi.mlb.com/api/v1/people/821808',
   'Allan Atoji', 'https://www.truebluela.com/2024/1/16/24039199/dodgers-international-signing-period-2024-emil-morales-rafy-peguero',
   'RESOLVED', 'MLB canonical name kept; secondary spelling stored as an alias.', null::text),
  ('POSITION:ajoti', 'POSITION', 821808, 2024, null, 'primary_position',
   'C', 'https://www.truebluela.com/2024/1/16/24039199/dodgers-international-signing-period-2024-emil-morales-rafy-peguero',
   'P', 'https://statsapi.mlb.com/api/v1/people/821808',
   'UNRESOLVED', null, 'Signed and announced as a catcher (the announced 4-catcher composition counts him as C); MLB currently lists him as a pitcher. DISI keeps C as the position at signing.'),
  ('BIRTH_COUNTRY:deng-thon', 'BIRTH_COUNTRY', 830188, 2025, null, 'birth_country',
   'South Sudan', 'https://www.truebluela.com/2025/1/27/24353426/dodgers-2025-international-signings',
   'Sudan', 'https://statsapi.mlb.com/api/v1/people/830188',
   'UNRESOLVED', null, 'Club and class sources say South Sudan; the MLB person record says Sudan. DISI keeps South Sudan.'),
  ('MARKET:jose-lopez-2024', 'COUNTRY_MARKET', 821653, 2024, null, 'country_market',
   'Dominican Republic', 'https://www.truebluela.com/2024/1/16/24039199/dodgers-international-signing-period-2024-emil-morales-rafy-peguero',
   'Venezuela', 'https://statsapi.mlb.com/api/v1/people/821653',
   'UNRESOLVED', null, 'The class table says Dominican Republic, but the same article''s country totals (9 Venezuela, 7 Dominican Republic) only reconcile if he is Venezuelan, and MLB lists Venezuela as birth country. Market left unknown.'),
  ('MARKET:luciano-romero-2022', 'COUNTRY_MARKET', 800355, 2022, null, 'country_market',
   'Venezuela', 'https://www.mlb.com/news/dodgers-2022-international-prospects',
   'Dominican Republic', 'https://statsapi.mlb.com/api/v1/people/800355',
   'UNRESOLVED', null, 'Class list gives Venezuela; MLB person record gives birth country Dominican Republic. May be signing market vs birth country.'),
  ('MEMBERSHIP:gudino-2022', 'CLASS_MEMBERSHIP', 800521, 2022, 'DODGERS-2022-OPENING', 'opening_class_membership',
   'Signed Jan. 15, 2022', 'https://statsapi.mlb.com/api/v1/transactions?playerId=800521',
   'Not in the 31-name MLB.com class list', 'https://www.mlb.com/news/dodgers-2022-international-prospects',
   'UNRESOLVED', null, 'Kept as a 2022 signing (full-period member); not counted in the announced opening class.'),
  ('COUNT:2022-opening', 'POPULATION_COUNT', null, 2022, 'DODGERS-2022-OPENING', 'expected_size',
   '30 players reported', 'https://www.mlb.com/news/dodgers-2022-international-prospects',
   '31 names listed', 'https://www.mlb.com/news/dodgers-2022-international-prospects',
   'UNRESOLVED', null, 'The announced 2022 class cannot be marked complete until the 30-vs-31 discrepancy is resolved.'),
  ('DEFINITION:2017-coverage', 'POPULATION_DEFINITION', null, 2017, 'DODGERS-2016-17-FULL-PERIOD', 'period',
   'Legacy 2017 coverage row: 4 of 26', null,
   '26 signings belong to the 2016-17 period', 'https://www.mlb.com/news/dodgers-sign-26-international-prospects-c240715336',
   'RESOLVED', 'Population redefined as the 2016-17 full period (class year 2016). The 2017 rows are 2017-18 signings and are not members.', null)
)
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, signing_id, population_id, field_name,
  value_a, source_a_id, value_b, source_b_id, status, resolution, note
)
select c.conflict_key, c.conflict_type, p.id, s.id, pop.id, c.field_name,
       c.value_a, sa.id, c.value_b, sb.id, c.status, c.resolution, c.note
from conflicts c
left join public.players p on p.mlb_id = c.mlb_id
left join public.signings s on s.player_id = p.id and s.signing_year = c.signing_year
left join public.signing_populations pop on pop.population_key = c.population_key
left join public.sources sa on sa.url = c.source_a_url
left join public.sources sb on sb.url = c.source_b_url
on conflict (conflict_key) do update set
  status = excluded.status, resolution = excluded.resolution, note = excluded.note,
  value_a = excluded.value_a, value_b = excluded.value_b;

-- The seven announced 2025 players whose MLB transactions are dated 2024-12-16.
insert into public.research_source_conflicts (
  conflict_key, conflict_type, player_id, signing_id, field_name,
  value_a, source_a_id, value_b, source_b_id, status, note
)
select 'PERIOD:' || p.slug, 'PERIOD_ASSIGNMENT', p.id, s.id, 'signing_period',
       'Announced in the 2025 class', sa.id,
       'MLB transaction 2024-12-16 (after the 2024 period closed, before the 2025 period opened)', s.transaction_source_id,
       'UNRESOLVED',
       'Dodgers Digest reports these players agreed before the end of the 2024 period using 2024 pool money. Counted in the announced 2025 class; not assigned to either full signing period.'
from public.signings s
join public.players p on p.id = s.player_id
join public.sources sa on sa.url = 'https://dodgersdigest.com/2025/01/28/dodgers-sign-29-players-in-ifa-class-trade-two-prospects-for-bonus-pool-money/'
where s.signing_year = 2025 and s.formal_transaction_date = date '2024-12-16'
on conflict (conflict_key) do nothing;

-- ===========================================================================
-- 15. SIGNING-PERIOD CANDIDATES (MLB transaction signees not yet classified)
-- ===========================================================================

insert into public.signing_period_candidates (
  mlb_person_id, full_name, franchise_key, transaction_date, period_year, birth_country, position,
  first_professional_contract, classification, source_id, note
)
select c.mlb_id, c.full_name, 'DODGERS', c.transaction_date, c.period_year, c.birth_country, c.position, c.first_contract,
       case when c.ingested then 'INGESTED_LATER_PERIOD_SIGNING'
            when not c.first_contract then 'PRIOR_PROFESSIONAL_CONTRACT'
            else 'IDENTIFIED_NOT_INGESTED' end,
       src.id,
       case when c.ingested then 'Added as a 2022 later-period signing.'
            when not c.first_contract then 'Earlier MLB-organization contract exists; not treated as an international amateur first contract.'
            else 'Profile fits an international amateur first contract (non-US birth, undrafted, first professional contract). Not yet classified or added.' end
from _m018_candidates c
left join public.sources src on src.url = 'https://statsapi.mlb.com/api/v1/transactions?playerId=' || c.mlb_id
on conflict (mlb_person_id, transaction_date) do update set
  classification = excluded.classification, note = excluded.note, source_id = excluded.source_id;

-- ===========================================================================
-- 16. VIEWS
-- ===========================================================================

create or replace function public.disi_position_group(p_position text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_position in ('RHP', 'LHP', 'P') then 'P'
    when p_position = 'C' then 'C'
    when p_position in ('1B', '2B', '3B', 'SS', 'INF', 'IF', 'UTIL') then 'IF'
    when p_position in ('OF', 'CF', 'LF', 'RF') then 'OF'
  end
$$;

-- 16a. Coverage per population (all franchises).
create or replace view public.v_signing_population_coverage
with (security_invoker = true)
as
with m as (
  select pm.population_id,
         count(*) filter (where pm.membership_status = 'MEMBER')::int as member_count,
         count(*) filter (where pm.membership_status = 'PROVISIONAL')::int as provisional_count,
         count(*) filter (where pm.membership_status = 'MEMBER' and oa.player_id is not null)::int as audited_members,
         count(*) filter (where pm.membership_status = 'MEMBER' and oa.reached_mlb_verified)::int as verified_mlb_members
  from public.signing_population_members pm
  join public.signings s on s.id = pm.signing_id
  left join public.outcome_audits oa on oa.player_id = s.player_id
  group by pm.population_id
),
c as (
  select population_id, count(*) filter (where status = 'UNRESOLVED')::int as unresolved_conflicts
  from public.research_source_conflicts
  where population_id is not null
  group by population_id
),
base as (
  select
    p.id as population_id,
    p.population_key,
    p.franchise_key,
    p.population_scope,
    p.class_year_start,
    p.class_year_end,
    p.period_label,
    p.period_start_date,
    p.period_end_date,
    p.announced_on,
    p.expected_size,
    coalesce(m.member_count, 0) as member_count,
    coalesce(m.provisional_count, 0) as provisional_count,
    coalesce(m.audited_members, 0) as audited_members,
    coalesce(m.verified_mlb_members, 0) as verified_mlb_members,
    coalesce(c.unresolved_conflicts, 0) as unresolved_conflicts,
    p.rate_analysis_suitable,
    p.stated_composition,
    src.title as source_title,
    src.url as source_url,
    src.publication_date as source_published,
    coalesce(src.source_tier, public.disi_infer_source_tier(src.url, src.source_type)) as source_tier,
    p.notes
  from public.signing_populations p
  left join m on m.population_id = p.id
  left join c on c.population_id = p.id
  left join public.sources src on src.id = p.expected_size_source_id
)
select
  base.*,
  case when expected_size > 0 then round(member_count::numeric / expected_size, 4) end as coverage_rate,
  (expected_size is not null and member_count = expected_size and unresolved_conflicts = 0) as population_complete,
  case
    when expected_size is null and population_scope in ('HISTORICAL_VERIFIED_SET', 'TOP_PROSPECT_SAMPLE') then 'SAMPLE_NOT_CENSUS'
    when expected_size is null then 'SIZE_UNKNOWN'
    when unresolved_conflicts > 0 then 'UNRESOLVED_CONFLICT'
    when member_count > expected_size then 'EXCEEDS_STATED_SIZE'
    when member_count = expected_size then 'COMPLETE'
    else 'PARTIAL'
  end as completeness_status,
  (class_year_end <= extract(year from current_date)::int - 5) as mature_5yr,
  (rate_analysis_suitable
    and expected_size is not null and member_count = expected_size and unresolved_conflicts = 0
    and audited_members = member_count
    and class_year_end <= extract(year from current_date)::int - 5) as rate_eligible,
  case
    when not rate_analysis_suitable then 'SCOPE_NOT_A_FULL_SIGNING_PERIOD'
    when expected_size is null then 'FULL_PERIOD_SIZE_UNKNOWN'
    when member_count <> expected_size or unresolved_conflicts > 0 then 'POPULATION_INCOMPLETE'
    when audited_members < member_count then 'OUTCOME_AUDIT_INCOMPLETE'
    when class_year_end > extract(year from current_date)::int - 5 then 'NOT_YET_FIVE_YEAR_MATURE'
    else 'RATE_ELIGIBLE'
  end as rate_exclusion_reason
from base;

create or replace view public.v_dodgers_signing_population_coverage
with (security_invoker = true)
as
select
  class_year_start as signing_year,
  period_label,
  population_key,
  population_scope,
  expected_size as expected_population,
  member_count as tracked_population,
  provisional_count as provisional_members,
  coverage_rate,
  population_complete,
  completeness_status,
  unresolved_conflicts,
  source_title,
  source_url,
  source_published,
  source_tier,
  stated_composition,
  rate_analysis_suitable,
  audited_members,
  verified_mlb_members,
  mature_5yr,
  rate_eligible,
  rate_exclusion_reason,
  period_start_date,
  period_end_date,
  announced_on,
  notes
from public.v_signing_population_coverage
where franchise_key = 'DODGERS';

-- 16b. Membership per signing (used by player pages and reconciliation).
create or replace view public.v_signing_population_memberships
with (security_invoker = true)
as
select
  pm.signing_id,
  s.player_id,
  pc.population_key,
  pc.population_scope,
  pc.period_label,
  pc.completeness_status,
  pm.membership_status,
  count(ms.id)::int as source_count,
  array_agg(distinct ms.membership_basis) filter (where ms.membership_basis is not null) as membership_bases,
  array_agg(distinct src.url) filter (where src.url is not null) as source_urls
from public.signing_population_members pm
join public.signings s on s.id = pm.signing_id
join public.v_signing_population_coverage pc on pc.population_id = pm.population_id
left join public.signing_population_member_sources ms on ms.member_id = pm.id
left join public.sources src on src.id = ms.source_id
group by pm.signing_id, s.player_id, pc.population_key, pc.population_scope, pc.period_label,
         pc.completeness_status, pm.membership_status;

-- 16c. Per-player class/source reconciliation (Dodgers years with a defined class population).
create or replace view public.v_dodgers_class_source_reconciliation
with (security_invoker = true)
as
with years as (
  select distinct class_year_start as signing_year
  from public.signing_populations
  where franchise_key = 'DODGERS' and population_scope in ('OPENING_CLASS', 'FULL_SIGNING_PERIOD')
),
opening as (
  select class_year_start as signing_year, id as population_id, announced_on, period_start_date
  from public.signing_populations
  where franchise_key = 'DODGERS' and population_scope = 'OPENING_CLASS'
),
full_period as (
  select class_year_start as signing_year, id as population_id, period_start_date, period_end_date
  from public.signing_populations
  where franchise_key = 'DODGERS' and population_scope = 'FULL_SIGNING_PERIOD'
),
mem as (
  select pm.signing_id, pm.population_id, count(ms.id)::int as source_count,
         bool_or(ms.membership_basis in ('MLB_TRANSACTION_LOG', 'MLB_PLAYER_TRANSACTION_HISTORY')) as transaction_backed
  from public.signing_population_members pm
  left join public.signing_population_member_sources ms on ms.member_id = pm.id
  group by pm.signing_id, pm.population_id
),
conf as (
  select signing_id, player_id,
         count(*) filter (where status = 'UNRESOLVED')::int as unresolved,
         array_agg(distinct conflict_type) filter (where status = 'UNRESOLVED') as unresolved_types
  from public.research_source_conflicts
  group by signing_id, player_id
),
signing_rows as (
  select
    s.signing_year,
    s.id as signing_id,
    p.id as player_id,
    p.slug as player_slug,
    p.full_name,
    s.announced_date,
    s.formal_transaction_date,
    op.population_id is not null as opening_class_defined,
    om.signing_id is not null as in_opening_class,
    coalesce(om.source_count, 0) as opening_class_source_count,
    (s.formal_transaction_date is not null or coalesce(fm.transaction_backed, false)) as in_transaction_record,
    fm.signing_id is not null as in_full_period,
    (fm.signing_id is not null and s.formal_transaction_date > coalesce(op.announced_on, op.period_start_date)) as later_period_signing,
    (select count(distinct ms.source_id)::int
       from public.signing_population_members pm2
       join public.signing_population_member_sources ms on ms.member_id = pm2.id
      where pm2.signing_id = s.id) as source_count,
    coalesce(cs.unresolved, 0) + coalesce(cp.unresolved, 0) as unresolved_conflicts,
    coalesce(cs.unresolved_types, array[]::text[]) || coalesce(cp.unresolved_types, array[]::text[]) as conflict_types
  from public.signings s
  join years y on y.signing_year = s.signing_year
  join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
  join public.players p on p.id = s.player_id
  left join opening op on op.signing_year = s.signing_year
  left join mem om on om.signing_id = s.id and om.population_id = op.population_id
  left join full_period fp on fp.signing_year = s.signing_year
  left join mem fm on fm.signing_id = s.id and fm.population_id = fp.population_id
  left join conf cs on cs.signing_id = s.id
  left join conf cp on cp.player_id = p.id and cp.signing_id is null
)
select
  signing_rows.*,
  case
    when 'PERIOD_ASSIGNMENT' = any(conflict_types) then 'PERIOD_ASSIGNMENT_AMBIGUOUS'
    when in_opening_class and later_period_signing then 'ANNOUNCED_TRANSACTION_LATER'
    when in_opening_class and in_transaction_record then 'ANNOUNCED_AND_TRANSACTION'
    when in_opening_class then 'ANNOUNCED_NO_TRANSACTION_FOUND'
    when opening_class_defined and in_full_period and later_period_signing then 'LATER_PERIOD_SIGNING'
    when opening_class_defined and in_transaction_record then 'TRANSACTION_NOT_IN_ANNOUNCEMENT'
    when in_full_period then 'FULL_PERIOD_TRANSACTION'
    else 'NO_CLASS_SOURCE'
  end as classification,
  (unresolved_conflicts > 0
    or (opening_class_defined and not in_opening_class and in_transaction_record and not coalesce(later_period_signing, false))
    or (in_opening_class and not in_transaction_record)) as unresolved_flag
from signing_rows;

-- 16d. Research queue for signing populations.
create or replace view public.v_dodgers_signing_period_research_queue
with (security_invoker = true)
as
select 'FULL_PERIOD_POPULATION_INCOMPLETE' as task_type, 100 as priority, signing_year, population_key,
       null::uuid as player_id, null::text as player_slug, null::text as full_name,
       period_label || ': ' || tracked_population || ' signings tracked; ' ||
       case when expected_population is null then 'no source states the full-period total.'
            else (expected_population - tracked_population) || ' of ' || expected_population || ' not yet identified.' end as detail
from public.v_dodgers_signing_population_coverage
where population_scope = 'FULL_SIGNING_PERIOD' and not population_complete

union all
select 'OPENING_CLASS_INCOMPLETE', 95, signing_year, population_key, null, null, null,
       period_label || ': ' || tracked_population || ' of ' || coalesce(expected_population::text, 'unknown') || ' (' || completeness_status || ').'
from public.v_dodgers_signing_population_coverage
where population_scope = 'OPENING_CLASS' and not population_complete

union all
select 'SOURCE_CONFLICT', case c.conflict_type when 'NAME_SPELLING' then 85 when 'POPULATION_COUNT' then 85 else 80 end,
       coalesce(s.signing_year, pop.class_year_start), pop.population_key, p.id, p.slug, p.full_name,
       replace(initcap(c.conflict_type), '_', ' ') || ': ' || coalesce(c.value_a, '?') || ' vs ' || coalesce(c.value_b, '?')
         || coalesce('. ' || c.note, '')
from public.research_source_conflicts c
left join public.players p on p.id = c.player_id
left join public.signings s on s.id = c.signing_id
left join public.signing_populations pop on pop.id = c.population_id
where c.status = 'UNRESOLVED'

union all
select 'TRANSACTION_NOT_IN_ANNOUNCEMENT', 75, r.signing_year, null, r.player_id, r.player_slug, r.full_name,
       'MLB transaction in the opening-day set, but not in the announced class list.'
from public.v_dodgers_class_source_reconciliation r
where r.classification = 'TRANSACTION_NOT_IN_ANNOUNCEMENT'

union all
select 'ANNOUNCED_MEMBER_NO_TRANSACTION', 70, r.signing_year, null, r.player_id, r.player_slug, r.full_name,
       'Announced class member without a verified MLB transaction record.'
from public.v_dodgers_class_source_reconciliation r
where r.classification = 'ANNOUNCED_NO_TRANSACTION_FOUND'

union all
select 'TRANSACTION_PLAYER_UNCLASSIFIED', case c.classification when 'IDENTIFIED_NOT_INGESTED' then 60 else 40 end,
       c.period_year, null, null, null, c.full_name,
       'MLB transaction ' || to_char(c.transaction_date, 'YYYY-MM-DD') || coalesce(' · born ' || c.birth_country, '')
         || coalesce(' · ' || c.position, '') || '. ' || c.note
from public.signing_period_candidates c
where c.franchise_key = 'DODGERS' and c.classification <> 'INGESTED_LATER_PERIOD_SIGNING'

union all
select 'UNKNOWN_COUNTRY', 30, s.signing_year, null, p.id, p.slug, p.full_name,
       'Signing market unknown' || coalesce('; MLB birth country: ' || p.birth_country, '') || '.'
from public.signings s
join public.players p on p.id = s.player_id
join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
where s.country_market is null

union all
select 'UNKNOWN_POSITION', 30, s.signing_year, null, p.id, p.slug, p.full_name, 'Position unknown.'
from public.signings s
join public.players p on p.id = s.player_id
join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
where p.primary_position is null;

-- 16e. Opening-class cohort rates: always labelled as such, never an organization rate.
create or replace view public.v_dodgers_opening_class_cohort_rates
with (security_invoker = true)
as
select
  signing_year,
  population_key,
  'OPENING_CLASS_COHORT_RATE' as rate_label,
  'Share of the announced opening class only. Not the organization''s full international signing hit rate.' as rate_caveat,
  expected_population,
  tracked_population,
  audited_members,
  verified_mlb_members,
  (population_complete and audited_members = tracked_population and mature_5yr) as cohort_rate_eligible,
  case when population_complete and audited_members = tracked_population and mature_5yr and tracked_population > 0
    then round(verified_mlb_members::numeric / tracked_population, 4) end as opening_class_cohort_mlb_rate,
  case
    when not population_complete then 'OPENING_CLASS_INCOMPLETE'
    when audited_members < tracked_population then 'OUTCOME_AUDIT_INCOMPLETE'
    when not mature_5yr then 'NOT_YET_FIVE_YEAR_MATURE'
    else 'ELIGIBLE'
  end as exclusion_reason
from public.v_dodgers_signing_population_coverage
where population_scope = 'OPENING_CLASS';

-- 16f. Rate eligibility (replaces 016): only a complete, fully audited, mature
-- FULL_SIGNING_PERIOD population is eligible. Existing columns are kept.
create or replace view public.v_dodgers_class_analysis_eligibility
with (security_invoker = true)
as
with fp as (
  select * from public.v_dodgers_signing_population_coverage where population_scope = 'FULL_SIGNING_PERIOD'
),
op as (
  select * from public.v_dodgers_signing_population_coverage where population_scope = 'OPENING_CLASS'
)
select
  p.signing_year,
  p.tracked_signings,
  p.audited_outcomes,
  p.verified_mlb_players,
  p.outcome_queue,
  p.audit_completion_pct,
  coalesce(fp.population_complete, false) as signing_population_complete,
  coalesce(fp.population_complete and fp.audited_members = fp.tracked_population, false) as outcome_population_complete,
  (p.signing_year <= extract(year from current_date)::int - 5) as mature_5yr,
  coalesce(fp.rate_eligible, false) as rate_eligible,
  case
    when p.signing_year > extract(year from current_date)::int - 5 then 'NOT_YET_FIVE_YEAR_MATURE'
    when fp.population_key is null and coalesce(op.population_complete, false) then 'ONLY_OPENING_CLASS_COMPLETE'
    when fp.population_key is null then 'NO_FULL_SIGNING_PERIOD_POPULATION'
    when not fp.population_complete then 'SIGNING_POPULATION_INCOMPLETE'
    when fp.audited_members < fp.tracked_population then 'OUTCOME_AUDIT_INCOMPLETE'
    else 'RATE_ELIGIBLE'
  end as exclusion_reason,
  fp.population_key as rate_population_key,
  fp.expected_population as full_period_expected,
  fp.tracked_population as full_period_tracked,
  op.population_key as opening_class_population_key,
  coalesce(op.population_complete, false) as opening_class_complete,
  op.expected_population as opening_class_expected,
  op.tracked_population as opening_class_tracked
from public.v_dodgers_class_research_progress p
left join fp on fp.signing_year = p.signing_year
left join op on op.signing_year = p.signing_year
order by p.signing_year;

-- Only members of an eligible full-period population enter rate analysis.
create or replace view public.v_dodgers_rate_eligible_player_analysis
with (security_invoker = true)
as
select
  u.player_id, u.full_name, u.primary_position, u.signing_year, u.signing_date, u.country_market,
  u.pathway, u.signing_bonus_usd, u.posting_fee_usd, u.transfer_fee_usd, u.total_known_acquisition_cost_usd,
  u.international_rank, u.record_scope, u.outcome_audited, u.reached_mlb_verified, u.audited_through_date,
  u.mlb_debut_date, u.mlb_debut_org, u.career_war
from public.v_dodgers_portfolio_universe u
join public.signings s on s.player_id = u.player_id and s.signing_year = u.signing_year
join public.organizations o on o.id = s.organization_id and o.franchise_key = 'DODGERS'
join public.signing_population_members pm on pm.signing_id = s.id and pm.membership_status = 'MEMBER'
join public.v_signing_population_coverage pc on pc.population_id = pm.population_id
where pc.rate_eligible and pc.franchise_key = 'DODGERS';

-- 16g. Year-level coverage (replaces 017; same leading columns, population-aware).
create or replace view public.v_class_research_coverage
with (security_invoker = true)
as
with tracked as (
  select
    o.franchise_key,
    s.signing_year,
    count(*)::int as tracked_class_size,
    count(*) filter (where s.signing_bonus_usd is not null)::int as known_bonus_count,
    count(*) filter (where s.total_known_acquisition_cost_usd is not null)::int as known_cost_count,
    count(oa.player_id)::int as outcome_audit_count,
    count(*) filter (where oa.reached_mlb_verified)::int as verified_mlb_count,
    count(w.career_bwar)::int as bwar_count,
    count(*) filter (where oa.reached_mlb_verified and w.career_bwar is null)::int as mlb_missing_bwar_count,
    count(*) filter (where s.signing_date is null)::int as missing_signing_date_count,
    count(*) filter (where s.country_market is null)::int as missing_market_count
  from public.signings s
  join public.organizations o on o.id = s.organization_id
  left join public.outcome_audits oa on oa.player_id = s.player_id
  left join public.v_player_war w on w.player_id = s.player_id
  where o.franchise_key is not null
  group by o.franchise_key, s.signing_year
),
pops as (
  select pc.*, y.signing_year,
         row_number() over (
           partition by pc.franchise_key, y.signing_year
           order by case
             when pc.population_scope = 'FULL_SIGNING_PERIOD' and pc.expected_size is not null then 1
             when pc.population_scope = 'OPENING_CLASS' then 2
             when pc.population_scope = 'OTHER_DEFINED_POPULATION' then 3
             when pc.population_scope = 'FULL_SIGNING_PERIOD' then 4
             when pc.population_scope = 'HISTORICAL_VERIFIED_SET' then 5
             else 6 end
         ) as rn
  from public.v_signing_population_coverage pc
  cross join lateral generate_series(pc.class_year_start, pc.class_year_end) as y(signing_year)
  where pc.franchise_key is not null
),
by_scope as (
  select franchise_key, signing_year,
    max(expected_size) filter (where population_scope = 'OPENING_CLASS') as opening_class_expected,
    max(member_count) filter (where population_scope = 'OPENING_CLASS') as opening_class_member_count,
    bool_or(population_complete) filter (where population_scope = 'OPENING_CLASS') as opening_class_complete,
    max(expected_size) filter (where population_scope = 'FULL_SIGNING_PERIOD') as full_period_expected,
    max(member_count) filter (where population_scope = 'FULL_SIGNING_PERIOD') as full_period_member_count,
    bool_or(population_complete) filter (where population_scope = 'FULL_SIGNING_PERIOD') as full_period_complete
  from pops
  group by franchise_key, signing_year
),
years as (
  select franchise_key, signing_year from tracked
  union
  select franchise_key, signing_year from pops where rn = 1 and expected_size is not null
),
base as (
  select
    y.franchise_key,
    y.signing_year,
    pr.population_scope as coverage_declaration,
    pr.period_label as declaration_period,
    pr.expected_size as expected_class_size,
    pr.source_title as expected_size_source_title,
    pr.source_url as expected_size_source_url,
    pr.source_published as expected_size_source_published,
    case when pr.expected_size is null then null else pr.source_tier end as expected_size_source_tier,
    pr.notes as coverage_notes,
    coalesce(t.tracked_class_size, 0) as tracked_class_size,
    coalesce(t.known_bonus_count, 0) as known_bonus_count,
    coalesce(t.known_cost_count, 0) as known_cost_count,
    coalesce(t.outcome_audit_count, 0) as outcome_audit_count,
    coalesce(t.verified_mlb_count, 0) as verified_mlb_count,
    coalesce(t.bwar_count, 0) as bwar_count,
    coalesce(t.mlb_missing_bwar_count, 0) as mlb_missing_bwar_count,
    coalesce(t.missing_signing_date_count, 0) as missing_signing_date_count,
    coalesce(t.missing_market_count, 0) as missing_market_count,
    pr.coverage_rate,
    case when pr.expected_size is not null then greatest(pr.expected_size - pr.member_count, 0) end as missing_from_expected,
    (pr.expected_size is not null and pr.source_tier is distinct from 'OFFICIAL_CLUB_RELEASE') as needs_official_size_source,
    coalesce(t.tracked_class_size, 0) - coalesce(t.outcome_audit_count, 0) as outcome_audit_queue,
    case
      when pr.population_key is null then 'POPULATION_UNKNOWN'
      when pr.population_scope = 'HISTORICAL_VERIFIED_SET' then 'VERIFIED_SAMPLE_POPULATION_UNKNOWN'
      when pr.population_scope = 'FULL_SIGNING_PERIOD' and pr.population_complete then 'COMPLETE'
      when pr.population_scope = 'OPENING_CLASS' and pr.population_complete then 'OPENING_CLASS_COMPLETE'
      when pr.completeness_status in ('UNRESOLVED_CONFLICT', 'EXCEEDS_STATED_SIZE') then 'COUNT_CONFLICT'
      when pr.expected_size is null then 'POPULATION_UNKNOWN'
      when pr.population_scope = 'OPENING_CLASS' then 'OPENING_CLASS_PARTIAL'
      else 'PARTIAL'
    end as class_status,
    pr.population_key,
    pr.population_scope,
    pr.member_count as population_member_count,
    coalesce(pr.population_complete, false) as population_complete,
    bs.opening_class_expected,
    bs.opening_class_member_count,
    coalesce(bs.opening_class_complete, false) as opening_class_complete,
    bs.full_period_expected,
    bs.full_period_member_count,
    coalesce(bs.full_period_complete, false) as full_period_complete
  from years y
  left join tracked t on t.franchise_key = y.franchise_key and t.signing_year = y.signing_year
  left join pops pr on pr.franchise_key = y.franchise_key and pr.signing_year = y.signing_year and pr.rn = 1
  left join by_scope bs on bs.franchise_key = y.franchise_key and bs.signing_year = y.signing_year
)
select
  franchise_key, signing_year, coverage_declaration, declaration_period, expected_class_size,
  expected_size_source_title, expected_size_source_url, expected_size_source_published, expected_size_source_tier,
  coverage_notes, tracked_class_size, known_bonus_count, known_cost_count, outcome_audit_count, verified_mlb_count,
  bwar_count, mlb_missing_bwar_count, missing_signing_date_count, missing_market_count,
  coverage_rate, missing_from_expected, needs_official_size_source, outcome_audit_queue, class_status,
  coalesce(missing_from_expected, 0) + outcome_audit_queue + mlb_missing_bwar_count
    + case when needs_official_size_source then 1 else 0 end as research_queue_items,
  population_key, population_scope, population_member_count, population_complete,
  opening_class_expected, opening_class_member_count, opening_class_complete,
  full_period_expected, full_period_member_count, full_period_complete
from base;

-- 16h. Signing records (replaces 017): coverage_type now names the population a
-- signing belongs to; class-membership and transaction dates appended.
create or replace view public.v_signing_records
with (security_invoker = true)
as
with pop as materialized (
  select pm.signing_id,
    case
      when bool_or(pc.population_scope = 'FULL_SIGNING_PERIOD' and pc.population_complete) then 'FULL_PERIOD_COMPLETE'
      when bool_or(pc.population_scope = 'OPENING_CLASS' and pc.population_complete) then 'OPENING_CLASS_COMPLETE'
      when bool_or(pc.population_scope = 'OPENING_CLASS') then 'OPENING_CLASS_PARTIAL'
      when bool_or(pc.population_scope = 'FULL_SIGNING_PERIOD') then 'FULL_PERIOD_PARTIAL'
      when bool_or(pc.population_scope = 'HISTORICAL_VERIFIED_SET') then 'HISTORICAL_VERIFIED_SET'
      when bool_or(pc.population_scope = 'TOP_PROSPECT_SAMPLE') then 'TOP_PROSPECT_SAMPLE'
      when bool_or(pc.population_scope = 'OTHER_DEFINED_POPULATION') then 'OTHER_DEFINED_POPULATION'
    end as population_label,
    bool_or(pc.population_scope = 'OPENING_CLASS' and pm.membership_status = 'MEMBER') as opening_class_member,
    bool_or(pc.population_scope = 'FULL_SIGNING_PERIOD' and pm.membership_status = 'MEMBER') as full_period_member,
    array_agg(pc.population_key order by pc.population_key) as population_keys
  from public.signing_population_members pm
  join public.v_signing_population_coverage pc on pc.population_id = pm.population_id
  group by pm.signing_id
)
select
  s.id as signing_id,
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  public.disi_ascii_fold(p.full_name) as player_sort_name,
  coalesce(pa.aliases, array[]::text[]) as aliases,
  public.disi_ascii_fold(concat_ws(' ', p.full_name, p.canonical_name, array_to_string(pa.aliases, ' '))) as search_text,
  s.signing_year,
  s.signing_date,
  o.abbreviation as organization,
  case
    when o.franchise_key = 'DODGERS' and s.signing_year < 1958 then 'Brooklyn Dodgers'
    else o.name
  end as organization_name,
  o.franchise_key,
  coalesce(o.franchise_key = 'DODGERS', false) as is_dodgers_franchise,
  s.country_market,
  p.primary_position,
  s.pathway::text as pathway,
  s.source_league,
  s.source_club,
  s.professional_experience_years,
  s.age_at_signing,
  s.signing_bonus_usd,
  s.bonus_publicly_reported,
  s.posting_fee_usd,
  s.transfer_fee_usd,
  s.total_known_acquisition_cost_usd,
  s.international_rank,
  s.rank_source,
  s.record_scope,
  pop.population_label as coverage_type,
  case
    when oa.player_id is null then 'NOT_AUDITED'
    when oa.reached_mlb_verified then 'VERIFIED_MLB'
    else 'VERIFIED_NO_MLB'
  end as outcome_audit_status,
  oa.player_id is not null as outcome_audited,
  oa.reached_mlb_verified,
  oa.audited_through_date,
  oc.mlb_debut_date,
  debut.abbreviation as mlb_debut_org,
  debut.name as mlb_debut_org_name,
  case when debut.id is null then null else debut.franchise_key = 'DODGERS' end
    as direct_dodgers_franchise_debut,
  case when debut.id is null then null else debut.franchise_key = o.franchise_key end
    as direct_signing_franchise_debut,
  case
    when s.signing_date is not null and oc.mlb_debut_date is not null
      then round(((oc.mlb_debut_date - s.signing_date) / 365.2425)::numeric, 2)
    else null
  end as years_signing_to_mlb,
  w.career_bwar,
  w.bwar_observed_through_date,
  w.bwar_observed_through_season,
  oc.current_status,
  s.notes as signing_notes,
  s.announced_date,
  s.formal_transaction_date,
  pop.opening_class_member,
  pop.full_period_member,
  coalesce(pop.population_keys, array[]::text[]) as population_keys
from public.signings s
join public.players p on p.id = s.player_id
join public.organizations o on o.id = s.organization_id
left join lateral (
  select array_agg(a.alias order by a.alias) as aliases
  from public.player_aliases a
  where a.player_id = p.id
) pa on true
left join public.outcome_audits oa on oa.player_id = p.id
left join public.outcomes oc on oc.player_id = p.id
left join public.organizations debut on debut.id = oc.mlb_debut_organization_id
left join public.v_player_war w on w.player_id = p.id
left join pop on pop.signing_id = s.id;

-- 16i. Database status (replaces 017; appended population columns).
create or replace view public.v_database_status
with (security_invoker = true)
as
with d as (
  select * from public.v_signing_records where is_dodgers_franchise
),
c as (
  select * from public.v_class_research_coverage where franchise_key = 'DODGERS'
),
pc as (
  select * from public.v_dodgers_signing_population_coverage
)
select
  (select count(*) from d)::int as tracked_signings,
  (select min(signing_year) from d) as earliest_signing_year,
  (select max(signing_year) from d) as latest_signing_year,
  (select count(distinct signing_year) from d)::int as years_represented,
  (select count(distinct country_market) from d where country_market is not null)::int as markets_represented,
  (select count(*) from d where country_market is null)::int as signings_with_unknown_market,
  (select count(*) from c where expected_class_size is not null)::int as classes_with_known_population,
  (select count(*) from c where class_status = 'COMPLETE')::int as complete_classes,
  (select count(*) from d where outcome_audited)::int as outcome_audits_completed,
  (select count(*) from d where outcome_audit_status = 'VERIFIED_MLB')::int as verified_mlb_outcomes,
  (select count(*) from d where outcome_audit_status = 'VERIFIED_NO_MLB')::int as verified_no_mlb_outcomes,
  (select count(*) from d where not outcome_audited)::int as outcome_audit_queue,
  (select round(sum(total_known_acquisition_cost_usd)::numeric, 2) from d) as known_acquisition_cost_usd,
  (select count(*) from d where total_known_acquisition_cost_usd is not null)::int as signings_with_known_cost,
  (select count(*) from d where career_bwar is not null)::int as signings_with_bwar,
  (select coalesce(sum(missing_from_expected), 0) from c)::int as class_members_missing,
  (select count(*) from public.v_research_tasks where franchise_key = 'DODGERS')::int as open_research_tasks,
  (select count(*) from public.players)::int as total_players,
  (select count(*) from public.v_signing_records where not is_dodgers_franchise)::int as league_signing_records,
  (select count(*) from pc where population_scope = 'OPENING_CLASS' and population_complete)::int as opening_classes_complete,
  (select count(*) from pc where population_scope = 'OPENING_CLASS' and expected_population is not null)::int as opening_classes_with_known_size,
  (select count(*) from pc where population_scope = 'FULL_SIGNING_PERIOD' and expected_population is not null)::int as full_periods_with_known_size,
  (select count(*) from pc where population_scope = 'FULL_SIGNING_PERIOD' and population_complete)::int as full_periods_complete,
  (select count(*) from pc where rate_eligible)::int as rate_eligible_populations;

-- 16j. Player timeline (replaces 017): adds the class announcement as its own event.
create or replace view public.v_player_timeline
with (security_invoker = true)
as
select
  s.player_id,
  s.signing_date as event_date,
  s.signing_year as event_year,
  case when s.signing_date is null then 'YEAR' else 'DAY' end as date_precision,
  10 as event_order,
  'SIGNING' as event_type,
  'Signed by ' || case
    when o.franchise_key = 'DODGERS' and s.signing_year < 1958 then 'Brooklyn Dodgers'
    else o.name
  end as title,
  concat_ws(' · ',
    nullif(s.country_market, ''),
    replace(initcap(s.pathway::text), '_', ' '),
    case when s.signing_bonus_usd is not null
      then 'bonus $' || to_char(s.signing_bonus_usd, 'FM999,999,999,990') end,
    case when s.formal_transaction_date is not null
      then 'MLB transaction ' || to_char(s.formal_transaction_date, 'YYYY-MM-DD') end
  ) as detail,
  o.abbreviation as organization,
  coalesce(tx.url, ev.url) as source_url,
  coalesce(tx.title, ev.title) as source_title
from public.signings s
join public.organizations o on o.id = s.organization_id
left join public.sources tx on tx.id = s.transaction_source_id
left join lateral (
  select src.url, src.title
  from public.evidence e
  join public.sources src on src.id = e.source_id
  where e.entity_type = 'signing' and e.entity_id = s.id
  order by e.field_name nulls first, e.created_at
  limit 1
) ev on true

union all

select
  s.player_id,
  s.announced_date,
  extract(year from s.announced_date)::int,
  'DAY',
  5,
  'CLASS_ANNOUNCEMENT',
  'Announced in the ' || o.name || ' ' || s.signing_year || ' international class',
  case when s.formal_transaction_date is not null and s.formal_transaction_date <> s.announced_date
    then 'Formal MLB transaction dated ' || to_char(s.formal_transaction_date, 'YYYY-MM-DD') end,
  o.abbreviation,
  src.url,
  src.title
from public.signings s
join public.organizations o on o.id = s.organization_id
left join lateral (
  select src.url, src.title
  from public.signing_population_members pm
  join public.signing_populations pop on pop.id = pm.population_id and pop.population_scope = 'OPENING_CLASS'
  join public.signing_population_member_sources ms on ms.member_id = pm.id
  join public.sources src on src.id = ms.source_id
  where pm.signing_id = s.id
  order by src.publication_date nulls last
  limit 1
) src on true
where s.announced_date is not null
  and s.announced_date is distinct from s.signing_date

union all

select
  m.player_id,
  m.milestone_date,
  extract(year from m.milestone_date)::int,
  case when m.milestone_date is null then 'YEAR' else 'DAY' end,
  20,
  'DEVELOPMENT',
  replace(initcap(m.milestone::text), '_', ' '),
  concat_ws(' · ', m.affiliate, m.notes),
  mo.abbreviation,
  src.url,
  src.title
from public.development_milestones m
left join public.organizations mo on mo.id = m.organization_id
left join public.sources src on src.id = m.source_id
where m.milestone not in ('SIGNED', 'MLB_DEBUT')

union all

select
  t.player_id,
  t.transaction_date,
  extract(year from t.transaction_date)::int,
  case when t.transaction_date is null then 'YEAR' else 'DAY' end,
  30,
  'TRANSACTION',
  initcap(t.transaction_type) || coalesce(' from ' || t.from_organization, '')
    || coalesce(' to ' || t.to_organization, ''),
  t.description,
  t.from_organization,
  t.source_url,
  t.source_title
from public.v_player_transactions t

union all

select
  oc.player_id,
  oc.mlb_debut_date,
  extract(year from oc.mlb_debut_date)::int,
  'DAY',
  40,
  'MLB_DEBUT',
  'MLB debut' || coalesce(' with ' || debut.name, ''),
  case
    when debut.franchise_key = 'DODGERS' then 'Debut directly with the Dodgers franchise'
    when debut.id is not null then 'Debut with another organization'
  end,
  debut.abbreviation,
  src.url,
  src.title
from public.outcomes oc
left join public.organizations debut on debut.id = oc.mlb_debut_organization_id
left join public.sources src on src.id = oc.source_id
where oc.mlb_debut_date is not null

union all

select
  oa.player_id,
  oa.audited_through_date,
  extract(year from oa.audited_through_date)::int,
  'DAY',
  50,
  'OUTCOME_AUDIT',
  case when oa.reached_mlb_verified
    then 'Outcome audit: MLB debut verified'
    else 'Outcome audit: no MLB debut found'
  end,
  'Audited through ' || to_char(oa.audited_through_date, 'YYYY-MM-DD')
    || coalesce(' · ' || oa.audit_note, ''),
  null,
  src.url,
  src.title
from public.outcome_audits oa
left join public.sources src on src.id = oa.source_id

union all

select
  m.player_id,
  m.observed_through_date,
  coalesce(m.observed_through_season, extract(year from m.observed_through_date)::int),
  'DAY',
  60,
  'METRIC',
  case m.metric_key
    when 'CAREER_BWAR' then 'Career bWAR ' || to_char(m.value, 'FM990.0')
    else 'Career fWAR ' || to_char(m.value, 'FM990.0')
  end,
  concat_ws(' · ',
    case m.metric_key when 'CAREER_BWAR' then 'Baseball-Reference WAR' else 'FanGraphs WAR' end,
    'through ' || coalesce(m.observed_through_season::text || ' season, ', '')
      || 'observed ' || to_char(m.observed_through_date, 'YYYY-MM-DD')
  ),
  null,
  src.url,
  src.title
from public.player_metric_observations m
join public.sources src on src.id = m.source_id;

-- 16k. Player provenance (replaces 017): adds class-membership sources.
create or replace view public.v_player_sources
with (security_invoker = true)
as
with facts as (
  select s.player_id,
         'Signing ' || s.signing_year || coalesce(' · ' || replace(e.field_name, '_usd', ''), '') as fact,
         e.source_id, e.confidence::text as confidence, e.evidence_note as note
  from public.evidence e
  join public.signings s on s.id = e.entity_id
  where e.entity_type = 'signing'
  union all
  select e.entity_id, 'Player record' || coalesce(' · ' || e.field_name, ''),
         e.source_id, e.confidence::text, e.evidence_note
  from public.evidence e
  where e.entity_type = 'player'
  union all
  select oc.player_id, 'MLB outcome', oc.source_id, oc.confidence::text, null
  from public.outcomes oc where oc.source_id is not null
  union all
  select oa.player_id, 'Outcome audit', oa.source_id, oa.confidence::text, oa.audit_note
  from public.outcome_audits oa where oa.source_id is not null
  union all
  select m.player_id,
         case m.metric_key when 'CAREER_BWAR' then 'Career bWAR' else 'Career fWAR' end
           || ' through ' || to_char(m.observed_through_date, 'YYYY-MM-DD'),
         m.source_id, m.confidence::text, m.notes
  from public.player_metric_observations m
  union all
  select t.player_id, 'Transaction ' || coalesce(to_char(t.transaction_date, 'YYYY-MM-DD'), ''),
         t.source_id, t.confidence::text, t.return_description
  from public.transactions t where t.source_id is not null
  union all
  select a.player_id, 'Transaction ' || to_char(e.transaction_date, 'YYYY-MM-DD'),
         coalesce(a.source_id, e.source_id), null, e.description
  from public.transaction_event_assets a
  join public.transaction_events e on e.id = a.event_id
  where a.player_id is not null and coalesce(a.source_id, e.source_id) is not null
  union all
  select a.player_id, 'Trade return metrics', r.source_id, null, r.valuation_note
  from public.transaction_event_assets a
  join public.transaction_return_metrics r on r.event_id = a.event_id
  where a.player_id is not null and r.source_id is not null
  union all
  select m.player_id, 'Development · ' || replace(initcap(m.milestone::text), '_', ' '),
         m.source_id, m.confidence::text, m.notes
  from public.development_milestones m where m.source_id is not null
  union all
  select s.player_id, 'Signing class ' || s.signing_year || ' size', c.source_id, null, c.notes
  from public.signings s
  join public.organizations o on o.id = s.organization_id
  join public.signing_census_coverage c
    on s.signing_year between c.period_start_year and c.period_end_year
  join public.organizations co on co.id = c.organization_id and co.franchise_key = o.franchise_key
  where c.source_id is not null
  union all
  select s.player_id,
         'Class membership · ' || pop.period_label || ' (' || replace(initcap(ms.membership_basis), '_', ' ') || ')',
         ms.source_id, ms.confidence::text,
         concat_ws(' ', ms.note, 'Supports: ' || array_to_string(ms.supports_fields, ', ') || '.')
  from public.signing_population_member_sources ms
  join public.signing_population_members pm on pm.id = ms.member_id
  join public.signing_populations pop on pop.id = pm.population_id
  join public.signings s on s.id = pm.signing_id
  union all
  select a.player_id, 'Alias · ' || a.alias, a.source_id, null, null
  from public.player_aliases a where a.source_id is not null
)
select distinct
  f.player_id,
  f.fact,
  src.id as source_id,
  src.source_name,
  src.source_type,
  coalesce(src.source_tier, public.disi_infer_source_tier(src.url, src.source_type)) as source_tier,
  st.priority as tier_priority,
  src.title,
  src.url,
  src.publication_date,
  (src.accessed_at at time zone 'UTC')::date as accessed_date,
  f.confidence,
  f.note
from facts f
join public.sources src on src.id = f.source_id
left join public.source_tiers st
  on st.tier_code = coalesce(src.source_tier, public.disi_infer_source_tier(src.url, src.source_type));

-- 16l. Legacy tracked-sample rates: label them so they are never read as organization rates.
comment on view public.v_dodgers_market_summary is
  'Legacy (004). Rates are observed over the original tracked seed cohort, not a defined signing population. Not an organization reach rate.';
comment on view public.v_dodgers_pathway_summary is
  'Legacy (004). Rates are observed over the original tracked seed cohort, not a defined signing population. Not an organization reach rate.';
comment on view public.v_dodgers_signing_year_summary is
  'Legacy (004). Rates are observed over the original tracked seed cohort, not a defined signing population. Not an organization reach rate.';
comment on view public.v_dodgers_executive_kpis is
  'Legacy (004). Rates are observed over the original tracked seed cohort, not a defined signing population. Not an organization reach rate.';
comment on view public.v_dodgers_mature_tracked_sample is
  'Legacy (006). The mature reach rate is over a 17-player tracked sample, not a signing population.';
comment on view public.v_dodgers_rate_eligible_summary is
  'Organization MLB reach rate. Counts only complete, fully audited, five-year-mature FULL_SIGNING_PERIOD populations (018). Opening-class statistics live in v_dodgers_opening_class_cohort_rates.';

-- ===========================================================================
-- 17. GRANTS
-- ===========================================================================

do $$
declare v text;
begin
  foreach v in array array[
    'v_signing_population_coverage', 'v_dodgers_signing_population_coverage',
    'v_signing_population_memberships', 'v_dodgers_class_source_reconciliation',
    'v_dodgers_signing_period_research_queue', 'v_dodgers_opening_class_cohort_rates',
    'v_dodgers_class_analysis_eligibility', 'v_dodgers_rate_eligible_player_analysis',
    'v_class_research_coverage', 'v_signing_records', 'v_database_status',
    'v_player_timeline', 'v_player_sources'
  ]
  loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to anon, authenticated', v);
  end loop;
end $$;

commit;

-- ===========================================================================
-- 18. VERIFICATION (read-only)
-- ===========================================================================

select signing_year, population_key, population_scope, expected_population, tracked_population,
       completeness_status, rate_analysis_suitable, rate_eligible, rate_exclusion_reason
from public.v_dodgers_signing_population_coverage
order by signing_year, population_scope;

select classification, count(*) from public.v_dodgers_class_source_reconciliation
group by classification order by classification;

select rate_eligible_classes, rate_eligible_signings from public.v_dodgers_rate_eligible_summary;
