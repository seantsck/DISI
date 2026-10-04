-- DISI v0.3
-- 014_portfolio_universe_and_source_pipeline.sql
-- Broadens the Dodgers player universe and makes the public-data ingestion
-- pipeline explicit. Run after 013.
--
-- Key rule: a player is never treated as a failed outcome merely because
-- outcome research has not yet been completed.

-- ===========================================================================
-- 1. SOURCE REGISTRY
-- ===========================================================================
create table if not exists public.international_signing_source_registry (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  title text not null,
  url text not null unique,
  period_start_year integer,
  period_end_year integer,
  coverage_level text not null check (
    coverage_level in (
      'COMPLETE_CENSUS',
      'PARTIAL_CENSUS',
      'ORG_PERIOD_COMPLETE',
      'TOP_PROSPECT_SAMPLE',
      'HISTORICAL_VERIFIED'
    )
  ),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.international_signing_source_registry enable row level security;
revoke all on table public.international_signing_source_registry from anon, authenticated;
grant select on table public.international_signing_source_registry to anon, authenticated;
drop policy if exists public_read_international_signing_source_registry
  on public.international_signing_source_registry;
create policy public_read_international_signing_source_registry
on public.international_signing_source_registry
for select to anon, authenticated using (true);

insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','DODGERS_CLASS_RELEASE','2017 class release','https://www.mlb.com/news/dodgers-sign-26-international-prospects-c240715336')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','DODGERS_CLASS_RELEASE','2018 opening class','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','MLB_SIGNING_ROUNDUP','2019-20 all-club roundup','https://www.mlb.com/news/international-signing-period-roundup-2019-2020')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','DODGERS_CLASS_RELEASE','2021 Dodgers class','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','DODGERS_TRANSACTION_LOG','2022 Dodgers transaction log','https://www.mlb.com/dodgers/roster/transactions/2022/01')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','DODGERS_CLASS_RELEASE','2023 Dodgers class','https://www.mlb.com/news/dodgers-2023-international-prospects-signings')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','DODGERS_TRANSACTION_LOG','2024 Dodgers transaction log','https://www.mlb.com/dodgers/roster/transactions/2024/01')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','DODGERS_TRANSACTION_LOG','2025 Dodgers transaction log','https://www.mlb.com/dodgers/roster/transactions/2025/01')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','MLB_PIPELINE_TRACKER','2025 Top 50 signing tracker','https://www.mlb.com/news/mlb-international-prospects-signing-day-2025')
on conflict (url) do nothing;
insert into public.sources (source_name, source_type, title, url)
values ('MLB.com','MLB_PIPELINE_TRACKER','2026 Top 50 signing tracker','https://www.mlb.com/news/mlb-international-prospects-signing-day-2026')
on conflict (url) do nothing;

insert into public.international_signing_source_registry
  (source_type,title,url,period_start_year,period_end_year,coverage_level)
values
('DODGERS_CLASS_RELEASE','2017 class release','https://www.mlb.com/news/dodgers-sign-26-international-prospects-c240715336',2017,2017,'PARTIAL_CENSUS'),
('DODGERS_CLASS_RELEASE','2018 opening class','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518',2018,2018,'PARTIAL_CENSUS'),
('MLB_SIGNING_ROUNDUP','2019-20 all-club roundup','https://www.mlb.com/news/international-signing-period-roundup-2019-2020',2019,2020,'ORG_PERIOD_COMPLETE'),
('DODGERS_CLASS_RELEASE','2021 Dodgers class','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings',2021,2021,'COMPLETE_CENSUS'),
('DODGERS_TRANSACTION_LOG','2022 Dodgers transaction log','https://www.mlb.com/dodgers/roster/transactions/2022/01',2022,2022,'PARTIAL_CENSUS'),
('DODGERS_CLASS_RELEASE','2023 Dodgers class','https://www.mlb.com/news/dodgers-2023-international-prospects-signings',2023,2023,'COMPLETE_CENSUS'),
('DODGERS_TRANSACTION_LOG','2024 Dodgers transaction log','https://www.mlb.com/dodgers/roster/transactions/2024/01',2024,2024,'PARTIAL_CENSUS'),
('DODGERS_TRANSACTION_LOG','2025 Dodgers transaction log','https://www.mlb.com/dodgers/roster/transactions/2025/01',2025,2025,'PARTIAL_CENSUS'),
('MLB_PIPELINE_TRACKER','2025 Top 50 signing tracker','https://www.mlb.com/news/mlb-international-prospects-signing-day-2025',2025,2025,'TOP_PROSPECT_SAMPLE'),
('MLB_PIPELINE_TRACKER','2026 Top 50 signing tracker','https://www.mlb.com/news/mlb-international-prospects-signing-day-2026',2026,2026,'TOP_PROSPECT_SAMPLE')
on conflict (url) do update set
  source_type=excluded.source_type,
  title=excluded.title,
  period_start_year=excluded.period_start_year,
  period_end_year=excluded.period_end_year,
  coverage_level=excluded.coverage_level;

-- ===========================================================================
-- 2. ORGANIZATION-PERIOD ROLLUPS
-- ===========================================================================
create table if not exists public.international_org_period_summary (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  period_start_year integer not null,
  period_end_year integer not null,
  period_label text not null,
  pool_amount_usd numeric,
  pool_spent_usd numeric,
  signed_count integer,
  source_id uuid references public.sources(id) on delete set null,
  coverage_level text not null default 'ORG_PERIOD_COMPLETE',
  notes text,
  unique(organization_id, period_start_year, period_end_year)
);

alter table public.international_org_period_summary enable row level security;
revoke all on table public.international_org_period_summary from anon, authenticated;
grant select on table public.international_org_period_summary to anon, authenticated;
drop policy if exists public_read_international_org_period_summary
  on public.international_org_period_summary;
create policy public_read_international_org_period_summary
on public.international_org_period_summary
for select to anon, authenticated using (true);

with seed(org_abbr,period_start_year,period_end_year,period_label,pool_amount_usd,pool_spent_usd,signed_count) as (
  values
('ARI',2019,2020,'2019-20',6231200,6219500,45),
('ATL',2019,2020,'2019-20',0,null,17),
('BAL',2019,2020,'2019-20',5731200,4876000,44),
('BOS',2019,2020,'2019-20',5559500,5402001,38),
('CHC',2019,2020,'2019-20',5148300,5148300,34),
('CIN',2019,2020,'2019-20',5508000,5508000,29),
('CLE',2019,2020,'2019-20',4981200,4861500,43),
('COL',2019,2020,'2019-20',6070000,6070000,25),
('CWS',2019,2020,'2019-20',3905000,3905000,17),
('DET',2019,2020,'2019-20',5398300,5240000,30),
('HOU',2019,2020,'2019-20',5398300,5398300,20),
('KC',2019,2020,'2019-20',6322000,6319500,30),
('LAD',2019,2020,'2019-20',5366400,5354000,50),
('LAA',2019,2020,'2019-20',5398300,5395000,30),
('MIA',2019,2020,'2019-20',5939800,5939000,21),
('MIL',2019,2020,'2019-20',5689800,5689800,38),
('MIN',2019,2020,'2019-20',5939800,5880000,22),
('NYM',2019,2020,'2019-20',5398300,5325000,61),
('NYY',2019,2020,'2019-20',5835800,5762000,38),
('OAK',2019,2020,'2019-20',5807000,5807000,23),
('PHI',2019,2020,'2019-20',4571400,4571000,35),
('PIT',2019,2020,'2019-20',8488700,8406000,49),
('SD',2019,2020,'2019-20',8231200,8230000,31),
('SEA',2019,2020,'2019-20',5370000,5370000,21),
('SF',2019,2020,'2019-20',5398300,5398300,50),
('STL',2019,2020,'2019-20',5467000,5467000,37),
('TB',2019,2020,'2019-20',6439800,6420000,38),
('TEX',2019,2020,'2019-20',6781100,6773000,44),
('TOR',2019,2020,'2019-20',5580100,5490000,47),
('WSH',2019,2020,'2019-20',4321400,4315000,16)
)
insert into public.international_org_period_summary (
  organization_id,period_start_year,period_end_year,period_label,
  pool_amount_usd,pool_spent_usd,signed_count,source_id,coverage_level,notes
)
select
  o.id,seed.period_start_year,seed.period_end_year,seed.period_label,
  seed.pool_amount_usd::numeric,seed.pool_spent_usd::numeric,seed.signed_count,
  src.id,'ORG_PERIOD_COMPLETE',
  'Source-reported organization totals from MLB 2019-20 international signing-period roundup.'
from seed
join public.organizations o on o.abbreviation=seed.org_abbr
join public.sources src
  on src.url='https://www.mlb.com/news/international-signing-period-roundup-2019-2020'
on conflict (organization_id,period_start_year,period_end_year) do update set
  pool_amount_usd=excluded.pool_amount_usd,
  pool_spent_usd=excluded.pool_spent_usd,
  signed_count=excluded.signed_count,
  source_id=excluded.source_id,
  coverage_level=excluded.coverage_level,
  notes=excluded.notes;

-- ===========================================================================
-- 3. ADD / NORMALIZE PLAYER IDENTITIES
-- ===========================================================================
insert into public.players (full_name, canonical_name, birth_country, primary_position)
select v.full_name,v.canonical_name,v.birth_country,v.primary_position
from (
  values
('Keibert Ruiz','Keibert Ruiz','Venezuela','C'),
('Jorbit Vivas','Jorbit Vivas','Venezuela','2B'),
('Eddys Leonard','Eddys Leonard','Dominican Republic','INF'),
('Miguel Vargas','Miguel Vargas','Cuba','3B'),
('Andy Pages','Andy Pages','Cuba','OF'),
('Diego Cartaya','Diego Cartaya','Venezuela','C'),
('Jerming Rosario','Jerming Rosario','Dominican Republic','RHP'),
('Alex De Jesus','Alex De Jesus','Dominican Republic','INF'),
('Ender Avendano','Ender Avendano','Venezuela','INF'),
('Miguel Droz','Miguel Droz','Venezuela','INF'),
('Luis Izturis','Luis Izturis','Venezuela','INF'),
('Jerami Rodriguez','Jerami Rodriguez',null,'RHP'),
('Rafael Tua','Rafael Tua',null,'RHP'),
('Christian Suarez','Christian Suarez',null,'LHP'),
('Gregory Pereira','Gregory Pereira','Venezuela','OF'),
('Yeiner Fernandez','Yeiner Fernandez','Venezuela','C'),
('Lesther Medrano','Lesther Medrano','Nicaragua','RHP'),
('Roque Gutierrez','Roque Gutierrez','Mexico','RHP'),
('Dailoui Abad','Dailoui Abad','Dominican Republic','RHP'),
('Juan Alonso','Juan Alonso','Panama','OF'),
('Carlos Avila','Carlos Avila','Venezuela','C'),
('Isaac Barreto','Isaac Barreto','Colombia','OF'),
('Miguel Bastardo','Miguel Bastardo','Venezuela','RHP'),
('Elio Campos','Elio Campos','Venezuela','SS'),
('Jorge Carpintero','Jorge Carpintero','Venezuela','LHP'),
('Wilman Diaz','Wilman Diaz','Venezuela','SS'),
('Brian Diaz','Brian Diaz','Venezuela','RHP'),
('Rayne Doncon','Rayne Doncon','Dominican Republic','SS'),
('Jesus Galiz','Jesus Galiz','Venezuela','C'),
('Luis Guerra','Luis Guerra','Venezuela','SS'),
('Jhonny Jimenez','Jhonny Jimenez','Dominican Republic','RHP'),
('Sebastian Jimenez','Sebastian Jimenez','Venezuela','LHP'),
('Roger Lasso','Roger Lasso','Panama','OF'),
('Thayron Liranzo','Thayron Liranzo','Dominican Republic','C'),
('Maximo Martinez','Maximo Martinez','Venezuela','RHP'),
('Kelvin Ramirez','Kelvin Ramirez','Venezuela','RHP'),
('Christian Romero','Christian Romero','Mexico','RHP'),
('Pedro Santillan','Pedro Santillan','Mexico','RHP'),
('Missael Soto','Missael Soto','Dominican Republic','RHP'),
('Michael Vilchez','Michael Vilchez','Curacao','RHP'),
('Yorfran Medina','Yorfran Medina','Venezuela','OF'),
('Jeral Perez','Jeral Perez','Dominican Republic','SS'),
('Edgar Leon','Edgar Leon','Venezuela','RHP'),
('Callum Wallace','Callum Wallace','Australia','RHP'),
('Yuliangel De La Cruz','Yuliangel De La Cruz','Dominican Republic','RHP'),
('Oswaldo Osorio','Oswaldo Osorio','Venezuela','SS'),
('Jholbran Herder','Jholbran Herder','Venezuela','RHP'),
('Roiger Mujica','Roiger Mujica','Venezuela','RHP'),
('Kosuke Matsuda','Kosuke Matsuda','Japan','RHP'),
('Luciano Romero','Luciano Romero','Venezuela','RHP'),
('Yoryi Simarra','Yoryi Simarra','Colombia','RHP'),
('Enrike Sevilya','Enrike Sevilya','Russia','RHP'),
('Yhonaider Gudino','Yhonaider Gudino',null,'SS'),
('Josue De Paula','Josue De Paula','Dominican Republic','OF'),
('Victor Rodrigues','Victor Rodrigues','Venezuela','C'),
('Daniel Arrias','Daniel Arrias','Venezuela','OF'),
('Raynerd Ortega','Raynerd Ortega','Venezuela','SS'),
('Domingo Geronimo','Domingo Geronimo','Dominican Republic','RHP'),
('Samuel Munoz','Samuel Munoz','Dominican Republic','1B'),
('Miguel Dominguez','Miguel Dominguez','Panama','C'),
('Natanael Castillo','Natanael Castillo','Dominican Republic','SS'),
('Nicolas Cruz','Nicolas Cruz','Venezuela','RHP'),
('Accimias Morales','Accimias Morales','Venezuela','RHP'),
('Mairoshendrick Martinus','Mairoshendrick Martinus','Curacao','SS'),
('Sean Linan','Sean Linan','Colombia','RHP'),
('Javier Pena','Javier Pena','Dominican Republic','C'),
('Steven Castillo','Steven Castillo','Nicaragua','RHP'),
('Peter Bonilla','Peter Bonilla','Spain','LHP'),
('Eduardo Guerrero','Eduardo Guerrero','Venezuela','SS'),
('Joendry Vargas','Joendry Vargas','Dominican Republic','SS'),
('Arnaldo Lantigua','Arnaldo Lantigua','Dominican Republic','OF'),
('Erick Batista','Erick Batista','Dominican Republic','RHP'),
('Anderson Jerez','Anderson Jerez','Dominican Republic','RHP'),
('Elias Medina','Elias Medina','Dominican Republic','SS'),
('Daniel Mielcarek','Daniel Mielcarek','Dominican Republic','SS'),
('Luis Carias','Luis Carias','Venezuela','RHP'),
('Harold Gonzalez','Harold Gonzalez','Venezuela','SS'),
('Javier Herrera','Javier Herrera','Venezuela','SS'),
('Eduardo Quintero','Eduardo Quintero','Venezuela','C'),
('Samuel Sanchez','Samuel Sanchez','Venezuela','RHP'),
('Jesus Tillero','Jesus Tillero','Venezuela','RHP'),
('Robinson Ventura','Robinson Ventura','Venezuela','RHP'),
('Leider Padilla','Leider Padilla',null,'OF'),
('Erny Orellana','Erny Orellana',null,'OF'),
('Emil Morales','Emil Morales',null,'SS'),
('Francisco Espinoza','Francisco Espinoza',null,'C'),
('Heudy Pena','Heudy Pena',null,'SS'),
('Jose Lopez','Jose Lopez',null,'RHP'),
('Allen Ajoti','Allen Ajoti',null,'C'),
('Euri Rosa','Euri Rosa',null,'C'),
('Carlos Sardina','Carlos Sardina',null,'RHP'),
('David Romero','David Romero',null,'2B'),
('Michael Ramirez','Michael Ramirez',null,'LHP'),
('Christian Muniz','Christian Muniz',null,'RHP'),
('Rafy Peguero','Rafy Peguero',null,'OF'),
('Reyli Mariano','Reyli Mariano',null,'2B'),
('Axel Perez','Axel Perez',null,'RHP'),
('Angel Ramirez','Angel Ramirez',null,'RHP'),
('Yojackson Laya','Yojackson Laya',null,'SS'),
('Alexis Dominguez','Alexis Dominguez',null,'RHP'),
('Roki Sasaki','Roki Sasaki','Japan','RHP'),
('Adrian Torres','Adrian Torres','Panama','LHP'),
('Luis Tovar','Luis Tovar','Venezuela','3B'),
('Joseph Deng Thon','Joseph Deng Thon','South Sudan','RHP'),
('Jose Rivas','Jose Rivas',null,'C'),
('Carlos Ramirez','Carlos Ramirez',null,'RHP'),
('Derik Aquino','Derik Aquino',null,'RHP'),
('Ezequiel Aparicio','Ezequiel Aparicio',null,'C'),
('Jhon Gil','Jhon Gil',null,'C'),
('Jose Villegas','Jose Villegas',null,'RHP'),
('Degerson Diaz','Degerson Diaz',null,'OF'),
('Ricardo Roman','Ricardo Roman',null,'RHP'),
('Juan Macero','Juan Macero',null,'SS'),
('Devlyn Bautista','Devlyn Bautista',null,'OF'),
('Moises Rangel','Moises Rangel',null,'C'),
('Moises Acacio','Moises Acacio',null,'SS'),
('Luis Luna','Luis Luna',null,'SS'),
('Jhosman Theran','Jhosman Theran',null,'OF')
) as v(full_name,canonical_name,birth_country,primary_position)
where not exists (
  select 1 from public.players p where p.full_name=v.full_name
);

-- Fill missing player metadata only; do not overwrite known values.
with v(full_name,birth_country,primary_position) as (
  values
('Keibert Ruiz','Venezuela','C'),
('Jorbit Vivas','Venezuela','2B'),
('Eddys Leonard','Dominican Republic','INF'),
('Miguel Vargas','Cuba','3B'),
('Andy Pages','Cuba','OF'),
('Diego Cartaya','Venezuela','C'),
('Jerming Rosario','Dominican Republic','RHP'),
('Alex De Jesus','Dominican Republic','INF'),
('Ender Avendano','Venezuela','INF'),
('Miguel Droz','Venezuela','INF'),
('Luis Izturis','Venezuela','INF'),
('Jerami Rodriguez',null,'RHP'),
('Rafael Tua',null,'RHP'),
('Christian Suarez',null,'LHP'),
('Gregory Pereira','Venezuela','OF'),
('Yeiner Fernandez','Venezuela','C'),
('Lesther Medrano','Nicaragua','RHP'),
('Roque Gutierrez','Mexico','RHP'),
('Dailoui Abad','Dominican Republic','RHP'),
('Juan Alonso','Panama','OF'),
('Carlos Avila','Venezuela','C'),
('Isaac Barreto','Colombia','OF'),
('Miguel Bastardo','Venezuela','RHP'),
('Elio Campos','Venezuela','SS'),
('Jorge Carpintero','Venezuela','LHP'),
('Wilman Diaz','Venezuela','SS'),
('Brian Diaz','Venezuela','RHP'),
('Rayne Doncon','Dominican Republic','SS'),
('Jesus Galiz','Venezuela','C'),
('Luis Guerra','Venezuela','SS'),
('Jhonny Jimenez','Dominican Republic','RHP'),
('Sebastian Jimenez','Venezuela','LHP'),
('Roger Lasso','Panama','OF'),
('Thayron Liranzo','Dominican Republic','C'),
('Maximo Martinez','Venezuela','RHP'),
('Kelvin Ramirez','Venezuela','RHP'),
('Christian Romero','Mexico','RHP'),
('Pedro Santillan','Mexico','RHP'),
('Missael Soto','Dominican Republic','RHP'),
('Michael Vilchez','Curacao','RHP'),
('Yorfran Medina','Venezuela','OF'),
('Jeral Perez','Dominican Republic','SS'),
('Edgar Leon','Venezuela','RHP'),
('Callum Wallace','Australia','RHP'),
('Yuliangel De La Cruz','Dominican Republic','RHP'),
('Oswaldo Osorio','Venezuela','SS'),
('Jholbran Herder','Venezuela','RHP'),
('Roiger Mujica','Venezuela','RHP'),
('Kosuke Matsuda','Japan','RHP'),
('Luciano Romero','Venezuela','RHP'),
('Yoryi Simarra','Colombia','RHP'),
('Enrike Sevilya','Russia','RHP'),
('Yhonaider Gudino',null,'SS'),
('Josue De Paula','Dominican Republic','OF'),
('Victor Rodrigues','Venezuela','C'),
('Daniel Arrias','Venezuela','OF'),
('Raynerd Ortega','Venezuela','SS'),
('Domingo Geronimo','Dominican Republic','RHP'),
('Samuel Munoz','Dominican Republic','1B'),
('Miguel Dominguez','Panama','C'),
('Natanael Castillo','Dominican Republic','SS'),
('Nicolas Cruz','Venezuela','RHP'),
('Accimias Morales','Venezuela','RHP'),
('Mairoshendrick Martinus','Curacao','SS'),
('Sean Linan','Colombia','RHP'),
('Javier Pena','Dominican Republic','C'),
('Steven Castillo','Nicaragua','RHP'),
('Peter Bonilla','Spain','LHP'),
('Eduardo Guerrero','Venezuela','SS'),
('Joendry Vargas','Dominican Republic','SS'),
('Arnaldo Lantigua','Dominican Republic','OF'),
('Erick Batista','Dominican Republic','RHP'),
('Anderson Jerez','Dominican Republic','RHP'),
('Elias Medina','Dominican Republic','SS'),
('Daniel Mielcarek','Dominican Republic','SS'),
('Luis Carias','Venezuela','RHP'),
('Harold Gonzalez','Venezuela','SS'),
('Javier Herrera','Venezuela','SS'),
('Eduardo Quintero','Venezuela','C'),
('Samuel Sanchez','Venezuela','RHP'),
('Jesus Tillero','Venezuela','RHP'),
('Robinson Ventura','Venezuela','RHP'),
('Leider Padilla',null,'OF'),
('Erny Orellana',null,'OF'),
('Emil Morales',null,'SS'),
('Francisco Espinoza',null,'C'),
('Heudy Pena',null,'SS'),
('Jose Lopez',null,'RHP'),
('Allen Ajoti',null,'C'),
('Euri Rosa',null,'C'),
('Carlos Sardina',null,'RHP'),
('David Romero',null,'2B'),
('Michael Ramirez',null,'LHP'),
('Christian Muniz',null,'RHP'),
('Rafy Peguero',null,'OF'),
('Reyli Mariano',null,'2B'),
('Axel Perez',null,'RHP'),
('Angel Ramirez',null,'RHP'),
('Yojackson Laya',null,'SS'),
('Alexis Dominguez',null,'RHP'),
('Roki Sasaki','Japan','RHP'),
('Adrian Torres','Panama','LHP'),
('Luis Tovar','Venezuela','3B'),
('Joseph Deng Thon','South Sudan','RHP'),
('Jose Rivas',null,'C'),
('Carlos Ramirez',null,'RHP'),
('Derik Aquino',null,'RHP'),
('Ezequiel Aparicio',null,'C'),
('Jhon Gil',null,'C'),
('Jose Villegas',null,'RHP'),
('Degerson Diaz',null,'OF'),
('Ricardo Roman',null,'RHP'),
('Juan Macero',null,'SS'),
('Devlyn Bautista',null,'OF'),
('Moises Rangel',null,'C'),
('Moises Acacio',null,'SS'),
('Luis Luna',null,'SS'),
('Jhosman Theran',null,'OF')
)
update public.players p
set birth_country=coalesce(p.birth_country,v.birth_country),
    primary_position=coalesce(p.primary_position,v.primary_position),
    updated_at=now()
from v
where p.full_name=v.full_name;

-- ===========================================================================
-- 4. SIGNING RECORD EXPANSION
-- ===========================================================================
with seed(
  full_name, signing_date, signing_year, country_market, primary_position,
  signing_bonus_usd, international_rank, record_scope, source_url, evidence_note
) as (
  values
('Keibert Ruiz','2014-07-20',2014,'Venezuela','C',140000,null,'HISTORICAL_VERIFIED','https://www.mlb.com/news/best-international-signing-prospect-for-every-team','MLB identifies Ruiz as a 2014 Dodgers international signing from Venezuela for $140,000.'),
('Jorbit Vivas','2017-07-04',2017,'Venezuela','2B',null,null,'HISTORICAL_VERIFIED','https://www.mlb.com/news/washington-nationals-acquire-infielder-jorbit-vivas','MLB records Vivas as originally signed by the Dodgers as an international free agent on July 4, 2017.'),
('Eddys Leonard','2017-07-03',2017,'Dominican Republic','INF',200000,null,'HISTORICAL_VERIFIED','https://www.mlb.com/milb/prospects/2022/dodgers/eddys-leonard-678760','MLB Pipeline identifies Leonard as a 2017 Dodgers international signing for $200,000.'),
('Miguel Vargas','2017-09-07',2017,'Cuba','3B',null,null,'HISTORICAL_VERIFIED','https://www.mlb.com/press-release/press-release-dodgers-select-miguel-vargas','Dodgers press release states Vargas was originally signed as an international free agent on Sept. 7, 2017.'),
('Andy Pages','2017-10-18',2017,'Cuba','OF',300000,null,'HISTORICAL_VERIFIED','https://www.mlb.com/milb/prospects/2023/dodgers/andy-pages-681624/','MLB Pipeline identifies Pages as a Cuban international signing by LAD for $300,000 on Oct. 18, 2017.'),
('Diego Cartaya','2018-07-02',2018,'Venezuela','C',2500000,1,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Jerming Rosario','2018-07-02',2018,'Dominican Republic','RHP',600000,null,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Alex De Jesus','2018-07-02',2018,'Dominican Republic','INF',500000,null,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Ender Avendano','2018-07-02',2018,'Venezuela','INF',null,null,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Miguel Droz','2018-07-02',2018,'Venezuela','INF',null,null,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Luis Izturis','2018-07-02',2018,'Venezuela','INF',null,null,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Jerami Rodriguez','2018-07-02',2018,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Rafael Tua','2018-07-02',2018,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Christian Suarez','2018-07-02',2018,null,'LHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Gregory Pereira','2018-07-02',2018,'Venezuela','OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Yeiner Fernandez','2019-07-02',2019,'Venezuela','C',717500,null,'TRACKED_DODGERS','https://www.mlb.com/news/international-signing-period-roundup-2019-2020','Named in MLB''s 2019-20 signing-period roundup.'),
('Lesther Medrano','2019-07-02',2019,'Nicaragua','RHP',472500,null,'TRACKED_DODGERS','https://www.mlb.com/news/international-signing-period-roundup-2019-2020','Named in MLB''s 2019-20 signing-period roundup.'),
('Roque Gutierrez',null,2019,'Mexico','RHP',10000,null,'TRACKED_DODGERS','https://www.mlb.com/news/international-signing-period-roundup-2019-2020','Named in MLB''s 2019-20 signing-period roundup.'),
('Dailoui Abad','2021-01-15',2021,'Dominican Republic','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Juan Alonso','2021-01-15',2021,'Panama','OF',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Carlos Avila','2021-01-15',2021,'Venezuela','C',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Isaac Barreto','2021-01-15',2021,'Colombia','OF',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Miguel Bastardo','2021-01-15',2021,'Venezuela','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Elio Campos','2021-01-15',2021,'Venezuela','SS',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Jorge Carpintero','2021-01-15',2021,'Venezuela','LHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Wilman Diaz','2021-01-15',2021,'Venezuela','SS',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Brian Diaz','2021-01-15',2021,'Venezuela','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Rayne Doncon','2021-01-15',2021,'Dominican Republic','SS',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Jesus Galiz','2021-01-15',2021,'Venezuela','C',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Luis Guerra','2021-01-15',2021,'Venezuela','SS',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Jhonny Jimenez','2021-01-15',2021,'Dominican Republic','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Sebastian Jimenez','2021-01-15',2021,'Venezuela','LHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Roger Lasso','2021-01-15',2021,'Panama','OF',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Thayron Liranzo','2021-01-15',2021,'Dominican Republic','C',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Maximo Martinez','2021-01-15',2021,'Venezuela','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Kelvin Ramirez','2021-01-15',2021,'Venezuela','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Christian Romero','2021-01-15',2021,'Mexico','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Pedro Santillan','2021-01-15',2021,'Mexico','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Missael Soto','2021-01-15',2021,'Dominican Republic','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Michael Vilchez','2021-01-15',2021,'Curacao','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Yorfran Medina','2022-01-15',2022,'Venezuela','OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Jeral Perez','2022-01-15',2022,'Dominican Republic','SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Edgar Leon','2022-01-15',2022,'Venezuela','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Callum Wallace','2022-01-15',2022,'Australia','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Yuliangel De La Cruz','2022-01-15',2022,'Dominican Republic','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Oswaldo Osorio','2022-01-15',2022,'Venezuela','SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Jholbran Herder','2022-01-15',2022,'Venezuela','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Roiger Mujica','2022-01-15',2022,'Venezuela','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Kosuke Matsuda','2022-01-15',2022,'Japan','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Luciano Romero','2022-01-15',2022,'Venezuela','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Yoryi Simarra','2022-01-15',2022,'Colombia','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Enrike Sevilya','2022-01-15',2022,'Russia','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Yhonaider Gudino','2022-01-15',2022,null,'SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Josue De Paula','2022-01-15',2022,'Dominican Republic','OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Victor Rodrigues','2022-01-15',2022,'Venezuela','C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Daniel Arrias','2022-01-15',2022,'Venezuela','OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Raynerd Ortega','2022-01-15',2022,'Venezuela','SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Domingo Geronimo','2022-01-15',2022,'Dominican Republic','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Samuel Munoz','2022-01-15',2022,'Dominican Republic','1B',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Miguel Dominguez','2022-01-15',2022,'Panama','C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Natanael Castillo','2022-01-15',2022,'Dominican Republic','SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Nicolas Cruz','2022-01-15',2022,'Venezuela','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Accimias Morales','2022-01-15',2022,'Venezuela','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Mairoshendrick Martinus','2022-01-15',2022,'Curacao','SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Sean Linan','2022-01-15',2022,'Colombia','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Javier Pena','2022-01-15',2022,'Dominican Republic','C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Steven Castillo','2022-01-15',2022,'Nicaragua','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Peter Bonilla','2022-01-15',2022,'Spain','LHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Eduardo Guerrero','2022-01-15',2022,'Venezuela','SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Joendry Vargas','2023-01-15',2023,'Dominican Republic','SS',2077500,3,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Arnaldo Lantigua','2023-01-15',2023,'Dominican Republic','OF',null,23,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Erick Batista','2023-01-15',2023,'Dominican Republic','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Anderson Jerez','2023-01-15',2023,'Dominican Republic','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Elias Medina','2023-01-15',2023,'Dominican Republic','SS',null,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Daniel Mielcarek','2023-01-15',2023,'Dominican Republic','SS',397500,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Luis Carias','2023-01-15',2023,'Venezuela','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Harold Gonzalez','2023-01-15',2023,'Venezuela','SS',null,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Javier Herrera','2023-01-15',2023,'Venezuela','SS',null,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Eduardo Quintero','2023-01-15',2023,'Venezuela','C',null,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Samuel Sanchez','2023-01-15',2023,'Venezuela','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Jesus Tillero','2023-01-15',2023,'Venezuela','RHP',497500,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Robinson Ventura','2023-01-15',2023,'Venezuela','RHP',null,null,'COMPLETE_CENSUS','https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Leider Padilla','2024-01-15',2024,null,'OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Erny Orellana','2024-01-15',2024,null,'OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Emil Morales','2024-01-15',2024,null,'SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Francisco Espinoza','2024-01-15',2024,null,'C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Heudy Pena','2024-01-15',2024,null,'SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Jose Lopez','2024-01-15',2024,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Allen Ajoti','2024-01-15',2024,null,'C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Euri Rosa','2024-01-15',2024,null,'C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Carlos Sardina','2024-01-15',2024,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('David Romero','2024-01-15',2024,null,'2B',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Michael Ramirez','2024-01-15',2024,null,'LHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Christian Muniz','2024-01-15',2024,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Rafy Peguero','2024-01-15',2024,null,'OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Reyli Mariano','2024-01-15',2024,null,'2B',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Axel Perez','2024-01-15',2024,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Angel Ramirez','2024-01-15',2024,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Yojackson Laya','2024-01-15',2024,null,'SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Alexis Dominguez','2024-01-15',2024,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Roki Sasaki','2025-01-22',2025,'Japan','RHP',6500000,1,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Adrian Torres',null,2025,'Panama','LHP',362500,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Luis Tovar',null,2025,'Venezuela','3B',397500,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Joseph Deng Thon',null,2025,'South Sudan','RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Jose Rivas',null,2025,null,'C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Carlos Ramirez',null,2025,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Derik Aquino',null,2025,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Ezequiel Aparicio',null,2025,null,'C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Jhon Gil',null,2025,null,'C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Jose Villegas',null,2025,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Degerson Diaz',null,2025,null,'OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Ricardo Roman',null,2025,null,'RHP',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Juan Macero',null,2025,null,'SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Devlyn Bautista',null,2025,null,'OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Moises Rangel',null,2025,null,'C',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Moises Acacio',null,2025,null,'SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Luis Luna',null,2025,null,'SS',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Jhosman Theran',null,2025,null,'OF',null,null,'TRACKED_DODGERS','https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.')
)
insert into public.signings (
  player_id, organization_id, signing_date, signing_year, country_market,
  pathway, signing_bonus_usd, bonus_publicly_reported,
  international_rank, rank_source, record_scope, notes
)
select
  p.id, lad.id, seed.signing_date::date, seed.signing_year,
  seed.country_market,
  case
    when seed.country_market='Cuba' then 'CUBAN_AMATEUR'::public.acquisition_pathway
    when seed.country_market='Japan' and seed.full_name='Roki Sasaki'
      then 'POSTED_PLAYER'::public.acquisition_pathway
    when seed.country_market='Japan' then 'JAPAN_AMATEUR'::public.acquisition_pathway
    when seed.country_market='South Korea' then 'KOREA_AMATEUR'::public.acquisition_pathway
    when seed.country_market='Mexico' then 'LATAM_AMATEUR'::public.acquisition_pathway
    when seed.country_market in ('Dominican Republic','Venezuela','Colombia','Curacao','Panama','Nicaragua')
      then 'LATAM_AMATEUR'::public.acquisition_pathway
    else 'OTHER'::public.acquisition_pathway
  end,
  seed.signing_bonus_usd::numeric,
  seed.signing_bonus_usd is not null,
  seed.international_rank::numeric,
  case when seed.international_rank is not null then 'MLB Pipeline' else null end,
  seed.record_scope,
  seed.evidence_note
from seed
join public.players p on p.full_name=seed.full_name
join public.organizations lad on lad.abbreviation='LAD'
on conflict (player_id,organization_id,signing_year) do update set
  signing_date=coalesce(public.signings.signing_date,excluded.signing_date),
  country_market=coalesce(public.signings.country_market,excluded.country_market),
  signing_bonus_usd=coalesce(public.signings.signing_bonus_usd,excluded.signing_bonus_usd),
  bonus_publicly_reported=public.signings.bonus_publicly_reported or excluded.bonus_publicly_reported,
  international_rank=coalesce(public.signings.international_rank,excluded.international_rank),
  rank_source=coalesce(public.signings.rank_source,excluded.rank_source),
  record_scope=case
    when public.signings.record_scope='COMPLETE_CENSUS' then 'COMPLETE_CENSUS'
    when excluded.record_scope='COMPLETE_CENSUS' then 'COMPLETE_CENSUS'
    else public.signings.record_scope
  end,
  notes=coalesce(public.signings.notes,excluded.notes);

-- Evidence for new/reconstructed signing rows.
with seed(full_name, signing_year, source_url, evidence_note) as (
  values
('Keibert Ruiz',2014,'https://www.mlb.com/news/best-international-signing-prospect-for-every-team','MLB identifies Ruiz as a 2014 Dodgers international signing from Venezuela for $140,000.'),
('Jorbit Vivas',2017,'https://www.mlb.com/news/washington-nationals-acquire-infielder-jorbit-vivas','MLB records Vivas as originally signed by the Dodgers as an international free agent on July 4, 2017.'),
('Eddys Leonard',2017,'https://www.mlb.com/milb/prospects/2022/dodgers/eddys-leonard-678760','MLB Pipeline identifies Leonard as a 2017 Dodgers international signing for $200,000.'),
('Miguel Vargas',2017,'https://www.mlb.com/press-release/press-release-dodgers-select-miguel-vargas','Dodgers press release states Vargas was originally signed as an international free agent on Sept. 7, 2017.'),
('Andy Pages',2017,'https://www.mlb.com/milb/prospects/2023/dodgers/andy-pages-681624/','MLB Pipeline identifies Pages as a Cuban international signing by LAD for $300,000 on Oct. 18, 2017.'),
('Diego Cartaya',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Jerming Rosario',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Alex De Jesus',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Ender Avendano',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Miguel Droz',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Luis Izturis',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Jerami Rodriguez',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Rafael Tua',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Christian Suarez',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Gregory Pereira',2018,'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518','Dodgers-announced 2018 international signing.'),
('Yeiner Fernandez',2019,'https://www.mlb.com/news/international-signing-period-roundup-2019-2020','Named in MLB''s 2019-20 signing-period roundup.'),
('Lesther Medrano',2019,'https://www.mlb.com/news/international-signing-period-roundup-2019-2020','Named in MLB''s 2019-20 signing-period roundup.'),
('Roque Gutierrez',2019,'https://www.mlb.com/news/international-signing-period-roundup-2019-2020','Named in MLB''s 2019-20 signing-period roundup.'),
('Dailoui Abad',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Juan Alonso',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Carlos Avila',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Isaac Barreto',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Miguel Bastardo',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Elio Campos',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Jorge Carpintero',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Wilman Diaz',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Brian Diaz',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Rayne Doncon',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Jesus Galiz',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Luis Guerra',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Jhonny Jimenez',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Sebastian Jimenez',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Roger Lasso',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Thayron Liranzo',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Maximo Martinez',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Kelvin Ramirez',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Christian Romero',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Pedro Santillan',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Missael Soto',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Michael Vilchez',2021,'https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings','Member of Dodgers'' announced 22-player 2021 international class.'),
('Yorfran Medina',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Jeral Perez',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Edgar Leon',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Callum Wallace',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Yuliangel De La Cruz',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Oswaldo Osorio',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Jholbran Herder',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Roiger Mujica',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Kosuke Matsuda',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Luciano Romero',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Yoryi Simarra',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Enrike Sevilya',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Yhonaider Gudino',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Josue De Paula',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Victor Rodrigues',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Daniel Arrias',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Raynerd Ortega',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Domingo Geronimo',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Samuel Munoz',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Miguel Dominguez',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Natanael Castillo',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Nicolas Cruz',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Accimias Morales',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Mairoshendrick Martinus',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Sean Linan',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Javier Pena',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Steven Castillo',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Peter Bonilla',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Eduardo Guerrero',2022,'https://www.mlb.com/dodgers/roster/transactions/2022/01','MLB Dodgers transaction log records the signing on Jan. 15, 2022.'),
('Joendry Vargas',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Arnaldo Lantigua',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Erick Batista',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Anderson Jerez',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Elias Medina',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Daniel Mielcarek',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Luis Carias',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Harold Gonzalez',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Javier Herrera',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Eduardo Quintero',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Samuel Sanchez',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Jesus Tillero',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Robinson Ventura',2023,'https://www.mlb.com/news/dodgers-2023-international-prospects-signings','Member of Dodgers'' announced 13-player 2023 international class.'),
('Leider Padilla',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Erny Orellana',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Emil Morales',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Francisco Espinoza',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Heudy Pena',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Jose Lopez',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Allen Ajoti',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Euri Rosa',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Carlos Sardina',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('David Romero',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Michael Ramirez',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Christian Muniz',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Rafy Peguero',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Reyli Mariano',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Axel Perez',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Angel Ramirez',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Yojackson Laya',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Alexis Dominguez',2024,'https://www.mlb.com/dodgers/roster/transactions/2024/01','MLB Dodgers transaction log records the signing on Jan. 15, 2024.'),
('Roki Sasaki',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Adrian Torres',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Luis Tovar',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Joseph Deng Thon',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Jose Rivas',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Carlos Ramirez',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Derik Aquino',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Ezequiel Aparicio',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Jhon Gil',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Jose Villegas',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Degerson Diaz',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Ricardo Roman',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Juan Macero',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Devlyn Bautista',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Moises Rangel',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Moises Acacio',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Luis Luna',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.'),
('Jhosman Theran',2025,'https://www.mlb.com/dodgers/roster/transactions/2025/01','MLB Dodgers transaction log records this January 2025 signing; class membership should be audited against the club''s announced 29-player class.')
)
insert into public.evidence (
  entity_type, entity_id, field_name, source_id, confidence, evidence_note
)
select
  'signing',s.id,null,src.id,'VERIFIED'::public.confidence_level,seed.evidence_note
from seed
join public.players p on p.full_name=seed.full_name
join public.signings s on s.player_id=p.id and s.signing_year=seed.signing_year
join public.organizations o on o.id=s.organization_id and o.abbreviation='LAD'
join public.sources src on src.url=seed.source_url
where not exists (
  select 1 from public.evidence e
  where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

-- ===========================================================================
-- 5. COVERAGE DECLARATIONS
-- ===========================================================================
-- 2017: club says 26 for the completed period; this DB still has only a subset.
insert into public.signing_census_coverage (
  organization_id,period_start_year,period_end_year,coverage_type,
  expected_signings,tracked_signings,source_id,notes
)
select lad.id,2017,2017,'PARTIAL_CENSUS',26,
       (select count(*) from public.signings s where s.organization_id=lad.id and s.signing_year=2017),
       src.id,
       'Dodgers reported 26 international signings in the completed 2017 period. DISI currently reconstructs a subset and must continue transaction-log backfill.'
from public.organizations lad
join public.sources src on src.url='https://www.mlb.com/news/dodgers-sign-26-international-prospects-c240715336'
where lad.abbreviation='LAD'
on conflict (organization_id,period_start_year,period_end_year,coverage_type) do update set
  expected_signings=excluded.expected_signings,
  tracked_signings=excluded.tracked_signings,
  source_id=excluded.source_id,
  notes=excluded.notes,
  updated_at=now();

-- 2021 complete announced class.
insert into public.signing_census_coverage (
  organization_id,period_start_year,period_end_year,coverage_type,
  expected_signings,tracked_signings,source_id,notes
)
select lad.id,2021,2021,'COMPLETE_CENSUS',22,
       (select count(*) from public.signings s where s.organization_id=lad.id and s.signing_year=2021),
       src.id,'Dodgers press release provides the complete announced 22-player class.'
from public.organizations lad
join public.sources src on src.url='https://www.mlb.com/press-release/press-release-dodgers-announce-international-signings'
where lad.abbreviation='LAD'
on conflict (organization_id,period_start_year,period_end_year,coverage_type) do update set
  expected_signings=excluded.expected_signings,tracked_signings=excluded.tracked_signings,
  source_id=excluded.source_id,notes=excluded.notes,updated_at=now();

-- 2022: announced 30; 29 opening-day transaction rows reconstructed here.
insert into public.signing_census_coverage (
  organization_id,period_start_year,period_end_year,coverage_type,
  expected_signings,tracked_signings,source_id,notes
)
select lad.id,2022,2022,'PARTIAL_CENSUS',30,
       (select count(*) from public.signings s where s.organization_id=lad.id and s.signing_year=2022),
       src.id,'Dodgers announced 30 international players; DISI currently has the transaction-verified Jan. 15 set plus any previously tracked rows.'
from public.organizations lad
join public.sources src on src.url='https://www.mlb.com/dodgers/roster/transactions/2022/01'
where lad.abbreviation='LAD'
on conflict (organization_id,period_start_year,period_end_year,coverage_type) do update set
  expected_signings=excluded.expected_signings,tracked_signings=excluded.tracked_signings,
  source_id=excluded.source_id,notes=excluded.notes,updated_at=now();

-- 2023 complete announced class.
insert into public.signing_census_coverage (
  organization_id,period_start_year,period_end_year,coverage_type,
  expected_signings,tracked_signings,source_id,notes
)
select lad.id,2023,2023,'COMPLETE_CENSUS',13,
       (select count(*) from public.signings s where s.organization_id=lad.id and s.signing_year=2023),
       src.id,'Dodgers article names the entire announced 13-player 2023 class.'
from public.organizations lad
join public.sources src on src.url='https://www.mlb.com/news/dodgers-2023-international-prospects-signings'
where lad.abbreviation='LAD'
on conflict (organization_id,period_start_year,period_end_year,coverage_type) do update set
  expected_signings=excluded.expected_signings,tracked_signings=excluded.tracked_signings,
  source_id=excluded.source_id,notes=excluded.notes,updated_at=now();

-- 2024: announced 19; MLB transaction log exposes 18 Jan. 15 rows used here.
insert into public.signing_census_coverage (
  organization_id,period_start_year,period_end_year,coverage_type,
  expected_signings,tracked_signings,source_id,notes
)
select lad.id,2024,2024,'PARTIAL_CENSUS',19,
       (select count(*) from public.signings s where s.organization_id=lad.id and s.signing_year=2024),
       src.id,'Dodgers announced 19 international amateur free agents. The transaction-log reconstruction currently identifies 18 Jan. 15 signings.'
from public.organizations lad
join public.sources src on src.url='https://www.mlb.com/dodgers/roster/transactions/2024/01'
where lad.abbreviation='LAD'
on conflict (organization_id,period_start_year,period_end_year,coverage_type) do update set
  expected_signings=excluded.expected_signings,tracked_signings=excluded.tracked_signings,
  source_id=excluded.source_id,notes=excluded.notes,updated_at=now();

-- 2025: announced 29; only transaction-confirmed subset is inserted here.
insert into public.signing_census_coverage (
  organization_id,period_start_year,period_end_year,coverage_type,
  expected_signings,tracked_signings,source_id,notes
)
select lad.id,2025,2025,'PARTIAL_CENSUS',29,
       (select count(*) from public.signings s where s.organization_id=lad.id and s.signing_year=2025),
       src.id,'Dodgers announced 29 international amateur free agents. Current DISI player-level reconstruction is partial.'
from public.organizations lad
join public.sources src on src.url='https://www.mlb.com/dodgers/roster/transactions/2025/01'
where lad.abbreviation='LAD'
on conflict (organization_id,period_start_year,period_end_year,coverage_type) do update set
  expected_signings=excluded.expected_signings,tracked_signings=excluded.tracked_signings,
  source_id=excluded.source_id,notes=excluded.notes,updated_at=now();

-- ===========================================================================
-- 6. PORTFOLIO-WIDE VIEWS (NOT ONLY MLB-REACHING PLAYERS)
-- ===========================================================================
create or replace view public.v_dodgers_portfolio_universe
with (security_invoker=true)
as
select
  p.id as player_id,
  p.full_name,
  p.primary_position,
  s.signing_year,
  s.signing_date,
  s.country_market,
  s.pathway,
  s.signing_bonus_usd,
  s.posting_fee_usd,
  s.transfer_fee_usd,
  s.total_known_acquisition_cost_usd,
  s.international_rank,
  s.record_scope,
  oa.player_id is not null as outcome_audited,
  oa.reached_mlb_verified,
  oa.audited_through_date,
  oc.mlb_debut_date,
  debut.abbreviation as mlb_debut_org,
  oc.career_war
from public.signings s
join public.players p on p.id=s.player_id
join public.organizations o on o.id=s.organization_id
left join public.outcome_audits oa on oa.player_id=p.id
left join public.outcomes oc on oc.player_id=p.id
left join public.organizations debut on debut.id=oc.mlb_debut_organization_id
where o.abbreviation='LAD'
order by s.signing_year,p.full_name;

grant select on public.v_dodgers_portfolio_universe to anon, authenticated;

create or replace view public.v_dodgers_universe_summary
with (security_invoker=true)
as
select
  count(*) as tracked_signings,
  min(signing_year) as earliest_signing_year,
  max(signing_year) as latest_signing_year,
  count(distinct country_market) filter (where country_market is not null) as tracked_markets,
  count(*) filter (where outcome_audited) as audited_outcomes,
  count(*) filter (where reached_mlb_verified is true) as verified_mlb_reach,
  count(*) filter (where not outcome_audited) as outcome_audit_queue,
  round(sum(total_known_acquisition_cost_usd)::numeric,2) as known_acquisition_cost_usd
from public.v_dodgers_portfolio_universe;

grant select on public.v_dodgers_universe_summary to anon, authenticated;

create or replace view public.v_dodgers_class_coverage
with (security_invoker=true)
as
select
  c.period_start_year as signing_year,
  c.coverage_type,
  c.expected_signings,
  c.tracked_signings,
  case
    when c.expected_signings is not null and c.expected_signings > 0
      then round(c.tracked_signings::numeric/c.expected_signings,4)
    else null
  end as coverage_rate,
  c.notes
from public.signing_census_coverage c
join public.organizations o on o.id=c.organization_id
where o.abbreviation='LAD'
order by signing_year;

grant select on public.v_dodgers_class_coverage to anon, authenticated;

create or replace view public.v_league_period_org_summary
with (security_invoker=true)
as
select
  s.period_label,
  s.period_start_year,
  s.period_end_year,
  o.abbreviation as organization,
  o.name as organization_name,
  s.pool_amount_usd,
  s.pool_spent_usd,
  s.signed_count,
  case
    when s.pool_amount_usd is not null and s.pool_amount_usd > 0
      then round(s.pool_spent_usd/s.pool_amount_usd,4)
    else null
  end as pool_utilization_rate,
  s.coverage_level
from public.international_org_period_summary s
join public.organizations o on o.id=s.organization_id
order by s.period_start_year,s.signed_count desc,o.abbreviation;

grant select on public.v_league_period_org_summary to anon, authenticated;

-- Verification outputs
select * from public.v_dodgers_universe_summary;
select * from public.v_dodgers_class_coverage order by signing_year;
select * from public.v_league_period_org_summary where period_label='2019-20'
order by signed_count desc, organization;
