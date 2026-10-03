-- DISI repair: restore Dodgers signing rows only.
-- Safe to run after 001-004. Does not delete data.

-- 1) Ensure canonical Dodgers organization exists.
insert into public.organizations
  (name, abbreviation, organization_type, league, country)
values
  ('Los Angeles Dodgers', 'LAD', 'MLB_CLUB', 'MLB', 'United States')
on conflict (name) do update
set abbreviation = 'LAD';


-- 1A) Restore any missing tracked player identities.
insert into public.players
  (full_name, canonical_name, birth_country, primary_position, bats, throws)
select v.full_name, v.canonical_name, v.birth_country, v.primary_position, v.bats, v.throws
from (
  values
  ('Yadier Álvarez','Yadier Alvarez','Cuba','RHP',null,'R'),
  ('Starling Heredia','Starling Heredia','Dominican Republic','OF','R','R'),
  ('Ronny Brito','Ronny Brito','Dominican Republic','SS','R','R'),
  ('Oneil Cruz','Oneil Cruz','Dominican Republic','SS','L','R'),
  ('Christopher Arias','Christopher Arias','Dominican Republic','OF','L','L'),
  ('Carlos Rincon','Carlos Rincon','Dominican Republic','OF','R','R'),
  ('Ramon Rosso','Ramon Rosso','Dominican Republic','RHP',null,'R'),
  ('Damaso Marte Jr.','Damaso Marte Jr.','Dominican Republic','SS',null,null),
  ('Luis Rodriguez (2015)','Luis Rodriguez','Venezuela','SS','S','R'),
  ('Aldo Espinoza','Aldo Espinoza','Nicaragua','2B','R','R'),
  ('Yusniel Diaz','Yusniel Diaz','Cuba','OF',null,null),
  ('Omar Estevez','Omar Estevez','Cuba','2B',null,null),
  ('Yordan Alvarez','Yordan Alvarez','Cuba','OF','L','R'),
  ('Diego Cartaya','Diego Cartaya','Venezuela','C',null,null),
  ('Jerming Rosario','Jerming Rosario','Dominican Republic','RHP',null,'R'),
  ('Alex De Jesus','Alex De Jesus','Dominican Republic','INF',null,null),
  ('Luis Rodriguez (2019)','Luis Rodriguez','Venezuela','OF',null,null),
  ('Josue De Paula','Josue De Paula','Dominican Republic','OF','L','L'),
  ('Joendry Vargas','Joendry Vargas','Dominican Republic','SS','R','R'),
  ('Arnaldo Lantigua','Arnaldo Lantigua','Dominican Republic','OF','R',null),
  ('Jesus Tillero','Jesus Tillero','Venezuela','RHP',null,'R'),
  ('Daniel Mielcarek','Daniel Mielcarek','Dominican Republic','SS',null,null),
  ('Emil Morales','Emil Morales','Spain','SS','R','R'),
  ('Roki Sasaki','Roki Sasaki','Japan','RHP','R','R'),
  ('Luis Tovar','Luis Tovar','Venezuela','INF',null,null),
  ('Adrian Torres','Adrian Torres','Panama','LHP',null,'L'),
  ('Ezequiel Melburne','Ezequiel Melburne','Dominican Republic','SS','S',null),
  ('Rubel Arias','Rubel Arias','Dominican Republic','OF','L',null),
  ('Ariel Reynoso','Ariel Reynoso','Dominican Republic','INF',null,null),
  ('Jose Victorino','Jose Victorino','Dominican Republic','INF',null,null),
  ('Jose Requena','Jose Requena','Venezuela','OF',null,null)
) as v(full_name, canonical_name, birth_country, primary_position, bats, throws)
where not exists (
  select 1
  from public.players p
  where p.full_name = v.full_name
);

-- 2) Reinsert the tracked Dodgers signing cohort.
--    env_year lets 2016 Yordan Alvarez use the 2015-16 signing environment.
with seed(
  full_name, signing_year, env_year, country_market, pathway,
  source_league, source_club, pro_years, bonus, bonus_reported, intl_rank
) as (
  values
  ('Yadier Álvarez',2015,2015,'Cuba','CUBAN_AMATEUR',null,null,null,16000000::numeric,true,2::numeric),
  ('Starling Heredia',2015,2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,2600000,true,5),
  ('Ronny Brito',2015,2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,2000000,true,21),
  ('Oneil Cruz',2015,2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,950000,true,null),
  ('Christopher Arias',2015,2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,500000,true,null),
  ('Carlos Rincon',2015,2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,350000,true,null),
  ('Ramon Rosso',2015,2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,62000,true,null),
  ('Damaso Marte Jr.',2015,2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,300000,true,null),
  ('Luis Rodriguez (2015)',2015,2015,'Venezuela','LATAM_AMATEUR',null,null,null,62500,true,null),
  ('Aldo Espinoza',2015,2015,'Nicaragua','LATAM_AMATEUR',null,null,null,50000,true,null),
  ('Yusniel Diaz',2015,2015,'Cuba','CUBAN_PRO','Serie Nacional','Industriales',1::numeric,15500000,true,3),
  ('Omar Estevez',2015,2015,'Cuba','CUBAN_AMATEUR',null,null,null,6000000,true,null),
  ('Yordan Alvarez',2016,2015,'Cuba','CUBAN_PRO','Serie Nacional','Las Tunas',2::numeric,2000000,true,null),

  ('Diego Cartaya',2018,2018,'Venezuela','LATAM_AMATEUR',null,null,null,2500000,true,1),
  ('Jerming Rosario',2018,2018,'Dominican Republic','LATAM_AMATEUR',null,null,null,600000,true,null),
  ('Alex De Jesus',2018,2018,'Dominican Republic','LATAM_AMATEUR',null,null,null,500000,true,null),

  ('Luis Rodriguez (2019)',2019,2019,'Venezuela','LATAM_AMATEUR',null,null,null,2667500,true,4),

  ('Josue De Paula',2022,2022,'Dominican Republic','LATAM_AMATEUR',null,null,null,397500,true,null),

  ('Joendry Vargas',2023,2023,'Dominican Republic','LATAM_AMATEUR',null,null,null,2077500,true,3),
  ('Arnaldo Lantigua',2023,2023,'Dominican Republic','LATAM_AMATEUR',null,null,null,null::numeric,false,23),
  ('Jesus Tillero',2023,2023,'Venezuela','LATAM_AMATEUR',null,null,null,497500,true,null),
  ('Daniel Mielcarek',2023,2023,'Dominican Republic','LATAM_AMATEUR',null,null,null,397500,true,null),

  ('Emil Morales',2024,2024,'Dominican Republic','LATAM_AMATEUR',null,null,null,1900000,true,14),

  ('Roki Sasaki',2025,2025,'Japan','POSTED_PLAYER','NPB','Chiba Lotte Marines',4::numeric,6500000,true,1),
  ('Luis Tovar',2025,2025,'Venezuela','LATAM_AMATEUR',null,null,null,397500,true,null),
  ('Adrian Torres',2025,2025,'Panama','LATAM_AMATEUR',null,null,null,362500,true,null),

  ('Ezequiel Melburne',2026,2026,'Dominican Republic','LATAM_AMATEUR',null,null,null,747500,true,29),
  ('Rubel Arias',2026,2026,'Dominican Republic','LATAM_AMATEUR',null,null,null,997500,true,null),
  ('Ariel Reynoso',2026,2026,'Dominican Republic','LATAM_AMATEUR',null,null,null,597500,true,null),
  ('Jose Victorino',2026,2026,'Dominican Republic','LATAM_AMATEUR',null,null,null,547500,true,null),
  ('Jose Requena',2026,2026,'Venezuela','LATAM_AMATEUR',null,null,null,372500,true,null)
),
lad as (
  select id
  from public.organizations
  where name = 'Los Angeles Dodgers'
  limit 1
)
insert into public.signings (
  player_id,
  organization_id,
  signing_environment_id,
  signing_year,
  country_market,
  pathway,
  source_league,
  source_club,
  professional_experience_years,
  signing_bonus_usd,
  bonus_publicly_reported,
  international_rank,
  rank_source
)
select
  p.id,
  lad.id,
  se.id,
  seed.signing_year,
  seed.country_market,
  seed.pathway::public.acquisition_pathway,
  seed.source_league,
  seed.source_club,
  seed.pro_years,
  seed.bonus,
  seed.bonus_reported,
  seed.intl_rank,
  case when seed.intl_rank is not null then 'MLB Pipeline' else null end
from seed
join public.players p
  on p.full_name = seed.full_name
cross join lad
left join public.signing_environments se
  on se.organization_id = lad.id
 and se.signing_year = seed.env_year
on conflict (player_id, organization_id, signing_year) do update
set signing_environment_id = excluded.signing_environment_id,
    country_market = excluded.country_market,
    pathway = excluded.pathway,
    source_league = excluded.source_league,
    source_club = excluded.source_club,
    professional_experience_years = excluded.professional_experience_years,
    signing_bonus_usd = excluded.signing_bonus_usd,
    bonus_publicly_reported = excluded.bonus_publicly_reported,
    international_rank = excluded.international_rank,
    rank_source = excluded.rank_source;

-- 3) Verify the repair.
select
  count(*) as tracked_player_rows
from public.players
where full_name in (
  'Yadier Álvarez','Starling Heredia','Ronny Brito','Oneil Cruz','Christopher Arias',
  'Carlos Rincon','Ramon Rosso','Damaso Marte Jr.','Luis Rodriguez (2015)','Aldo Espinoza',
  'Yusniel Diaz','Omar Estevez','Yordan Alvarez','Diego Cartaya','Jerming Rosario',
  'Alex De Jesus','Luis Rodriguez (2019)','Josue De Paula','Joendry Vargas','Arnaldo Lantigua',
  'Jesus Tillero','Daniel Mielcarek','Emil Morales','Roki Sasaki','Luis Tovar','Adrian Torres',
  'Ezequiel Melburne','Rubel Arias','Ariel Reynoso','Jose Victorino','Jose Requena'
);

select
  count(*) as dodgers_signing_rows
from public.signings s
join public.organizations o on o.id = s.organization_id
where o.abbreviation = 'LAD';

-- 4) Re-run the executive KPI view.
select *
from public.v_dodgers_executive_kpis;
