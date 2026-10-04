-- DISI v0.2
-- 013_league_benchmark_seed.sql
-- Starts the league-wide comparison layer using MLB Pipeline's published
-- international Top 30 signing trackers for 2013 and 2014.
-- Run after 012.
--
-- This is a TOP-PROSPECT BENCHMARK, not a complete league census.

-- 1. Canonical MLB organizations.
insert into public.organizations
  (name, abbreviation, organization_type, league, country)
values
('Arizona Diamondbacks','ARI','MLB_CLUB','MLB','United States'),
('Atlanta Braves','ATL','MLB_CLUB','MLB','United States'),
('Baltimore Orioles','BAL','MLB_CLUB','MLB','United States'),
('Boston Red Sox','BOS','MLB_CLUB','MLB','United States'),
('Chicago Cubs','CHC','MLB_CLUB','MLB','United States'),
('Chicago White Sox','CWS','MLB_CLUB','MLB','United States'),
('Cincinnati Reds','CIN','MLB_CLUB','MLB','United States'),
('Cleveland Guardians','CLE','MLB_CLUB','MLB','United States'),
('Colorado Rockies','COL','MLB_CLUB','MLB','United States'),
('Detroit Tigers','DET','MLB_CLUB','MLB','United States'),
('Houston Astros','HOU','MLB_CLUB','MLB','United States'),
('Kansas City Royals','KC','MLB_CLUB','MLB','United States'),
('Los Angeles Angels','LAA','MLB_CLUB','MLB','United States'),
('Los Angeles Dodgers','LAD','MLB_CLUB','MLB','United States'),
('Miami Marlins','MIA','MLB_CLUB','MLB','United States'),
('Milwaukee Brewers','MIL','MLB_CLUB','MLB','United States'),
('Minnesota Twins','MIN','MLB_CLUB','MLB','United States'),
('New York Mets','NYM','MLB_CLUB','MLB','United States'),
('New York Yankees','NYY','MLB_CLUB','MLB','United States'),
('Athletics','OAK','MLB_CLUB','MLB','United States'),
('Philadelphia Phillies','PHI','MLB_CLUB','MLB','United States'),
('Pittsburgh Pirates','PIT','MLB_CLUB','MLB','United States'),
('San Diego Padres','SD','MLB_CLUB','MLB','United States'),
('San Francisco Giants','SF','MLB_CLUB','MLB','United States'),
('Seattle Mariners','SEA','MLB_CLUB','MLB','United States'),
('St. Louis Cardinals','STL','MLB_CLUB','MLB','United States'),
('Tampa Bay Rays','TB','MLB_CLUB','MLB','United States'),
('Texas Rangers','TEX','MLB_CLUB','MLB','United States'),
('Toronto Blue Jays','TOR','MLB_CLUB','MLB','United States'),
('Washington Nationals','WSH','MLB_CLUB','MLB','United States')
on conflict (name) do update
set abbreviation=excluded.abbreviation,
    organization_type='MLB_CLUB',
    league='MLB';

-- 2. Sources.
insert into public.sources (source_name, source_type, title, url, publication_date)
values
  ('MLB.com','INTERNATIONAL_TRACKER',
   '2013 Top 30 international prospect signings',
   'https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782',
   date '2013-07-03'),
  ('MLB.com','INTERNATIONAL_TRACKER',
   '2014 Top 30 international prospect signings',
   'https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266',
   date '2014-07-07')
on conflict (url) do nothing;

-- 3. Player identities.
insert into public.players
  (full_name, canonical_name, birth_country, primary_position)
select v.full_name, v.canonical_name, v.birth_country, v.primary_position
from (
  values
  ('Eloy Jimenez','Eloy Jimenez','Dominican Republic','OF'),
('Micker Zapata','Micker Zapata','Dominican Republic','OF'),
('Gleyber Torres','Gleyber Torres','Venezuela','SS'),
('Marten Gasparini','Marten Gasparini','Italy','SS'),
('Rafael Devers','Rafael Devers','Dominican Republic','3B'),
('Jose Herrera','Jose Herrera','Venezuela','C'),
('Marcos Diplan','Marcos Diplan','Dominican Republic','RHP'),
('Lewin Diaz','Lewin Diaz','Dominican Republic','OF'),
('Yeltsin Gudino','Yeltsin Gudino','Venezuela','SS'),
('Jose Almonte','Jose Almonte','Dominican Republic','OF'),
('Erick Julio','Erick Julio','Colombia','RHP'),
('Carlos Herrera','Carlos Herrera','Venezuela','SS'),
('Erling Moreno','Erling Moreno','Colombia','RHP'),
('Greifer Andrade','Greifer Andrade','Venezuela','OF'),
('Franly Mallen','Franly Mallen','Dominican Republic','SS'),
('Yeyson Yrizarry','Yeyson Yrizarry','Dominican Republic','SS'),
('Emmanuel DeJesus','Emmanuel DeJesus','Venezuela','LHP'),
('Carlos Hiciano','Carlos Hiciano','Dominican Republic','SS'),
('Michael DeLeon','Michael DeLeon','Dominican Republic','SS'),
('Nicolas Pierre','Nicolas Pierre','Dominican Republic','OF'),
('Dermis Garcia','Dermis Garcia','Dominican Republic','SS'),
('Nelson Gomez','Nelson Gomez','Dominican Republic','3B'),
('Adrian Rondon','Adrian Rondon','Dominican Republic','SS'),
('Gilbert Lara','Gilbert Lara','Dominican Republic','SS'),
('Juan DeLeon','Juan DeLeon','Dominican Republic','OF'),
('Christopher Acosta','Christopher Acosta','Dominican Republic','RHP'),
('Jonathan Amundaray','Jonathan Amundaray','Venezuela','OF'),
('Brayan Hernandez','Brayan Hernandez','Venezuela','OF'),
('Antonio Arias','Antonio Arias','Venezuela','OF'),
('Anderson Espinoza','Anderson Espinoza','Venezuela','RHP'),
('Juan Meza','Juan Meza','Venezuela','RHP'),
('Pedro Gonzalez','Pedro Gonzalez','Dominican Republic','SS'),
('Hyo-Jun Park','Hyo-Jun Park','South Korea','SS'),
('Wilkerman Garcia','Wilkerman Garcia','Venezuela','SS'),
('Arquimedes Gamboa','Arquimedes Gamboa','Venezuela','SS'),
('Diego Castillo','Diego Castillo','Venezuela','SS'),
('Huascar Ynoa','Huascar Ynoa','Dominican Republic','RHP'),
('Julio Martinez','Julio Martinez','Dominican Republic','OF'),
('Ronny Rafael','Ronny Rafael','Dominican Republic','OF'),
('Franklin Perez','Franklin Perez','Venezuela','RHP'),
('Yeremy Rosario','Yeremy Rosario','Dominican Republic','SS'),
('Miguel Angel Sierra','Miguel Angel Sierra','Venezuela','SS'),
('Ricky Aracena','Ricky Aracena','Dominican Republic','SS'),
('Miguel Flames','Miguel Flames','Venezuela','C'),
('Amado Nunez','Amado Nunez','Dominican Republic','SS'),
('Kenny Hernandez','Kenny Hernandez','Venezuela','SS'),
('Jhoandro Alfaro','Jhoandro Alfaro','Colombia','C'),
('Ricardo Rodriguez','Ricardo Rodriguez','Venezuela','C')
) as v(full_name, canonical_name, birth_country, primary_position)
where not exists (
  select 1 from public.players p where p.full_name=v.full_name
);

-- 4. Signed Top-30 players reported by MLB.
with seed(
  signing_year, full_name, primary_position, country_market,
  org_abbr, bonus, intl_rank, confidence_text, source_url, evidence_note
) as (
  values
  (2013,'Eloy Jimenez','OF','Dominican Republic','CHC',2800000,1,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Micker Zapata','OF','Dominican Republic','CWS',1600000,2,'VERIFIED','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Club-confirmed in source.'),
(2013,'Gleyber Torres','SS','Venezuela','CHC',1700000,3,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Marten Gasparini','SS','Italy','KC',1300000,4,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Rafael Devers','3B','Dominican Republic','BOS',1500000,6,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Jose Herrera','C','Venezuela','ARI',1060000,7,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Marcos Diplan','RHP','Dominican Republic','TEX',1300000,8,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Lewin Diaz','OF','Dominican Republic','MIN',1400000,10,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Yeltsin Gudino','SS','Venezuela','TOR',1290000,11,'VERIFIED','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Club-confirmed in source.'),
(2013,'Jose Almonte','OF','Dominican Republic','TEX',1800000,13,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Erick Julio','RHP','Colombia','COL',700000,14,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Carlos Herrera','SS','Venezuela','COL',1200000,15,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Erling Moreno','RHP','Colombia','CHC',650000,17,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Greifer Andrade','OF','Venezuela','SEA',1050000,20,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Franly Mallen','SS','Dominican Republic','MIL',800000,22,'VERIFIED','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Club-confirmed in source.'),
(2013,'Yeyson Yrizarry','SS','Dominican Republic','TEX',1350000,23,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Emmanuel DeJesus','LHP','Venezuela','BOS',780000,24,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Carlos Hiciano','SS','Dominican Republic','OAK',750000,26,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Michael DeLeon','SS','Dominican Republic','TEX',550000,27,'HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
(2013,'Nicolas Pierre','OF','Dominican Republic','MIL',800000,28,'VERIFIED','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Club-confirmed in source.'),
(2014,'Dermis Garcia','SS','Dominican Republic','NYY',3000000,1,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Nelson Gomez','3B','Dominican Republic','NYY',2250000,2,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Adrian Rondon','SS','Dominican Republic','TB',2950000,3,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Gilbert Lara','SS','Dominican Republic','MIL',3100000,4,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Juan DeLeon','OF','Dominican Republic','NYY',2000000,5,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Christopher Acosta','RHP','Dominican Republic','BOS',1500000,6,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Jonathan Amundaray','OF','Venezuela','NYY',1500000,7,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Brayan Hernandez','OF','Venezuela','SEA',1850000,8,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Antonio Arias','OF','Venezuela','NYY',800000,9,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Anderson Espinoza','RHP','Venezuela','BOS',2000000,10,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Juan Meza','RHP','Venezuela','TOR',1600000,11,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Pedro Gonzalez','SS','Dominican Republic','COL',1300000,12,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Hyo-Jun Park','SS','South Korea','NYY',1100000,13,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Wilkerman Garcia','SS','Venezuela','NYY',1350000,14,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Arquimedes Gamboa','SS','Venezuela','PHI',900000,15,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Diego Castillo','SS','Venezuela','NYY',750000,16,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Huascar Ynoa','RHP','Dominican Republic','MIN',800000,17,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Julio Martinez','OF','Dominican Republic','DET',600000,19,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Ronny Rafael','OF','Dominican Republic','HOU',1500000,20,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Franklin Perez','RHP','Venezuela','HOU',1000000,21,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Yeremy Rosario','SS','Dominican Republic','COL',800000,22,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Miguel Angel Sierra','SS','Venezuela','HOU',1000000,23,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Ricky Aracena','SS','Dominican Republic','KC',850000,24,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Miguel Flames','C','Venezuela','NYY',1000000,25,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Amado Nunez','SS','Dominican Republic','CWS',900000,26,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Kenny Hernandez','SS','Venezuela','NYM',1000000,27,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Jhoandro Alfaro','C','Colombia','CWS',750000,28,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
(2014,'Ricardo Rodriguez','C','Venezuela','SD',null,30,'VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.')
)
insert into public.signings (
  player_id, organization_id, signing_year, country_market, pathway,
  signing_bonus_usd, bonus_publicly_reported,
  international_rank, rank_source, record_scope, notes
)
select
  p.id,
  o.id,
  seed.signing_year,
  seed.country_market,
  case
    when seed.country_market in ('Dominican Republic','Venezuela','Colombia')
      then 'LATAM_AMATEUR'::public.acquisition_pathway
    when seed.country_market='South Korea'
      then 'KOREA_AMATEUR'::public.acquisition_pathway
    else 'OTHER'::public.acquisition_pathway
  end,
  seed.bonus::numeric,
  seed.bonus is not null,
  seed.intl_rank::numeric,
  'MLB Pipeline',
  'MLB_PIPELINE_TOP_PROSPECT',
  seed.evidence_note
from seed
join public.players p on p.full_name=seed.full_name
join public.organizations o on o.abbreviation=seed.org_abbr
on conflict (player_id, organization_id, signing_year) do update set
  signing_bonus_usd=coalesce(excluded.signing_bonus_usd, public.signings.signing_bonus_usd),
  bonus_publicly_reported=excluded.bonus_publicly_reported or public.signings.bonus_publicly_reported,
  international_rank=coalesce(excluded.international_rank, public.signings.international_rank),
  rank_source='MLB Pipeline',
  record_scope=case
    when public.signings.record_scope in ('TRACKED_DODGERS','HISTORICAL_VERIFIED','COMPLETE_CENSUS')
      then public.signings.record_scope
    else 'MLB_PIPELINE_TOP_PROSPECT'
  end,
  notes=coalesce(public.signings.notes, excluded.notes);

-- 5. Evidence and confidence.
with seed(
  signing_year, full_name, org_abbr, confidence_text, source_url, evidence_note
) as (
  values
  
  (2013,'Eloy Jimenez','CHC','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Micker Zapata','CWS','VERIFIED','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Club-confirmed in source.'),
  (2013,'Gleyber Torres','CHC','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Marten Gasparini','KC','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Rafael Devers','BOS','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Jose Herrera','ARI','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Marcos Diplan','TEX','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Lewin Diaz','MIN','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Yeltsin Gudino','TOR','VERIFIED','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Club-confirmed in source.'),
  (2013,'Jose Almonte','TEX','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Erick Julio','COL','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Carlos Herrera','COL','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Erling Moreno','CHC','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Greifer Andrade','SEA','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Franly Mallen','MIL','VERIFIED','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Club-confirmed in source.'),
  (2013,'Yeyson Yrizarry','TEX','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Emmanuel DeJesus','BOS','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Carlos Hiciano','OAK','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Michael DeLeon','TEX','HIGH','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Agreement reported by MLB source; club had not confirmed at publication.'),
  (2013,'Nicolas Pierre','MIL','VERIFIED','https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782','Club-confirmed in source.'),
  (2014,'Dermis Garcia','NYY','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Nelson Gomez','NYY','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Adrian Rondon','TB','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Gilbert Lara','MIL','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Juan DeLeon','NYY','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Christopher Acosta','BOS','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Jonathan Amundaray','NYY','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Brayan Hernandez','SEA','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Antonio Arias','NYY','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Anderson Espinoza','BOS','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Juan Meza','TOR','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Pedro Gonzalez','COL','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Hyo-Jun Park','NYY','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Wilkerman Garcia','NYY','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Arquimedes Gamboa','PHI','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Diego Castillo','NYY','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Huascar Ynoa','MIN','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Julio Martinez','DET','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Ronny Rafael','HOU','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Franklin Perez','HOU','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Yeremy Rosario','COL','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Miguel Angel Sierra','HOU','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Ricky Aracena','KC','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Miguel Flames','NYY','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Amado Nunez','CWS','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Kenny Hernandez','NYM','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Jhoandro Alfaro','CWS','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.'),
  (2014,'Ricardo Rodriguez','SD','VERIFIED','https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266','Club-confirmed in source.')
)
insert into public.evidence (
  entity_type, entity_id, field_name, source_id, confidence, evidence_note
)
select
  'signing', s.id, null, src.id,
  seed.confidence_text::public.confidence_level,
  seed.evidence_note
from seed
join public.players p on p.full_name=seed.full_name
join public.organizations o on o.abbreviation=seed.org_abbr
join public.signings s
  on s.player_id=p.id and s.organization_id=o.id and s.signing_year=seed.signing_year
join public.sources src on src.url=seed.source_url
where not exists (
  select 1 from public.evidence e
  where e.entity_type='signing'
    and e.entity_id=s.id
    and e.source_id=src.id
);

-- 6. League benchmark coverage.
insert into public.signing_census_coverage (
  organization_id, period_start_year, period_end_year, coverage_type,
  expected_signings, tracked_signings, source_id, notes
)
select
  null, 2013, 2013, 'TOP_PROSPECT_SAMPLE',
  30,
  (select count(*) from public.signings where signing_year=2013 and record_scope='MLB_PIPELINE_TOP_PROSPECT'),
  src.id,
  'League-wide MLB Pipeline Top 30 benchmark. Only players with a reported club agreement/signing in the cited tracker are inserted; this is not a census of all international signings.'
from public.sources src
where src.url='https://www.mlb.com/news/flurry-of-top-international-prospects-inked-on-first-day/c-52530782'
  and not exists (
    select 1
    from public.signing_census_coverage c
    where c.organization_id is null
      and c.period_start_year=2013
      and c.period_end_year=2013
      and c.coverage_type='TOP_PROSPECT_SAMPLE'
  );

insert into public.signing_census_coverage (
  organization_id, period_start_year, period_end_year, coverage_type,
  expected_signings, tracked_signings, source_id, notes
)
select
  null, 2014, 2014, 'TOP_PROSPECT_SAMPLE',
  30,
  (select count(*) from public.signings where signing_year=2014 and record_scope='MLB_PIPELINE_TOP_PROSPECT'),
  src.id,
  'League-wide MLB Pipeline Top 30 benchmark. Only players with a reported club agreement/signing in the cited tracker are inserted; this is not a census of all international signings.'
from public.sources src
where src.url='https://www.mlb.com/news/clubs-agree-to-terms-with-top-international-prospects/c-82709266'
  and not exists (
    select 1
    from public.signing_census_coverage c
    where c.organization_id is null
      and c.period_start_year=2014
      and c.period_end_year=2014
      and c.coverage_type='TOP_PROSPECT_SAMPLE'
  );

-- 7. League views.
create or replace view public.v_league_signing_benchmark
with (security_invoker=true)
as
select
  s.signing_year,
  o.abbreviation as organization,
  o.name as organization_name,
  p.full_name,
  p.primary_position,
  s.country_market,
  s.pathway,
  s.signing_bonus_usd,
  s.international_rank,
  s.rank_source,
  s.record_scope,
  oc.reached_mlb,
  oc.mlb_debut_date,
  debut_org.abbreviation as mlb_debut_org,
  oc.career_war
from public.signings s
join public.players p on p.id=s.player_id
join public.organizations o on o.id=s.organization_id
left join public.outcomes oc on oc.player_id=p.id
left join public.organizations debut_org on debut_org.id=oc.mlb_debut_organization_id
where s.record_scope='MLB_PIPELINE_TOP_PROSPECT'
order by s.signing_year, s.international_rank nulls last, p.full_name;

grant select on public.v_league_signing_benchmark to anon, authenticated;

create or replace view public.v_league_org_benchmark
with (security_invoker=true)
as
select
  s.signing_year,
  o.abbreviation as organization,
  o.name as organization_name,
  count(*) as tracked_top_prospect_signings,
  count(*) filter (where s.signing_bonus_usd is not null) as known_bonus_count,
  round(sum(s.signing_bonus_usd)::numeric,2) as known_bonus_spend_usd,
  round(avg(s.international_rank)::numeric,2) as avg_pipeline_rank,
  min(s.international_rank) as best_pipeline_rank
from public.signings s
join public.organizations o on o.id=s.organization_id
where s.record_scope='MLB_PIPELINE_TOP_PROSPECT'
group by s.signing_year, o.abbreviation, o.name
order by s.signing_year, tracked_top_prospect_signings desc, o.abbreviation;

grant select on public.v_league_org_benchmark to anon, authenticated;

-- Verification
select signing_year, count(*) as signed_top30_rows
from public.v_league_signing_benchmark
group by signing_year
order by signing_year;

select *
from public.v_league_org_benchmark
order by signing_year, tracked_top_prospect_signings desc, organization;
