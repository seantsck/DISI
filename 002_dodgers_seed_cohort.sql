-- DISI v0.1
-- 002_dodgers_seed_cohort.sql
-- Conservative Dodgers-specific seed cohort.
-- Values are intentionally NULL when not verified from the cited public source.

begin;

-- ---------------------------------------------------------------------------
-- ORGANIZATIONS
-- ---------------------------------------------------------------------------

insert into public.organizations (name, abbreviation, organization_type, league, country)
values
  ('Los Angeles Dodgers', 'LAD', 'MLB_CLUB', 'MLB', 'United States'),
  ('Cincinnati Reds', 'CIN', 'MLB_CLUB', 'MLB', 'United States')
on conflict (name) do update set abbreviation = excluded.abbreviation;

-- ---------------------------------------------------------------------------
-- SOURCES
-- ---------------------------------------------------------------------------

insert into public.sources (source_name, source_type, title, url, publication_date)
values
('MLB.com', 'ARTICLE', 'Dodgers open international signing period with a flurry',
 'https://www.mlb.com/dodgers/news/dodgers-sign-top-international-free-agents/c-134055834', '2015-07-07'),
('MLB.com', 'ARTICLE', 'Sources: Dodgers ink pair of Cuban prospects',
 'https://www.mlb.com/dodgers/news/dodgers-sign-pair-of-cuban-prospects/c-157908784', '2015-11-22'),
('MLB.com', 'ARTICLE', 'Dodgers have deal with Cuban OF Yordan Alvarez',
 'https://www.mlb.com/news/dodgers-have-deal-with-cuban-of-yordan-alvarez-c184312840', '2016-06-16'),
('MLB.com', 'ARTICLE', 'Dodgers agree with top international prospect Diego Cartaya',
 'https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518', '2018-07-02'),
('MLB.com', 'ARTICLE', 'Dodgers to sign pair of top international prospects',
 'https://www.mlb.com/news/dodgers-sign-pair-of-top-int-l-prospects', '2019-07-02'),
('MLB.com', 'ARTICLE', 'Dodgers 2022 international prospects',
 'https://www.mlb.com/news/dodgers-2022-international-prospects', '2022-01-16'),
('MLB.com', 'PROSPECT_PROFILE', 'Dodgers Top Prospects: Josue De Paula',
 'https://www.mlb.com/milb/prospects/2023/dodgers/josue-de-paula-800543', null),
('MLB.com', 'PRESS_RELEASE', 'Dodgers announce 2023 international signings',
 'https://www.mlb.com/press-release/press-release-dodgers-announce-2023-international-signings', '2023-01-16'),
('MLB.com', 'ARTICLE', 'MLB International Prospects Signing Day 2023',
 'https://www.mlb.com/news/mlb-international-prospects-signing-day-2023', '2023-01-21'),
('MLB.com', 'ARTICLE', 'Dodgers 2024 international prospects signings',
 'https://www.mlb.com/dodgers/news/dodgers-2024-international-prospects-signings', '2024-01-16'),
('MLB.com', 'ARTICLE', 'International Signing Day 2024',
 'https://www.mlb.com/news/mlb-international-prospects-signing-day-2024', '2024-01-15'),
('MLB.com', 'PRESS_RELEASE', 'Dodgers announce 2025 international signings',
 'https://www.mlb.com/press-release/press-release-dodgers-announce-2025-international-signings', '2025-01-28'),
('MLB.com', 'ARTICLE', 'MLB international prospects signing day 2025',
 'https://www.mlb.com/news/mlb-international-prospects-signing-day-2025', '2025-01-25'),
('MLB.com', 'ARTICLE', 'International Amateur Free Agency & Bonus Pool Money',
 'https://www.mlb.com/glossary/transactions/international-amateur-free-agency-bonus-pool-money', null),
('MLB.com', 'TRANSACTIONS', 'Los Angeles Dodgers transactions January 2025',
 'https://www.mlb.com/dodgers/roster/transactions/2025/01', null),
('MLB.com', 'ARTICLE', 'Los Angeles Dodgers 2026 international signings',
 'https://www.mlb.com/news/los-angeles-dodgers-2026-international-signings', '2026-01-16'),
('MLB.com', 'ARTICLE', '2026 MLB International Signing Day',
 'https://www.mlb.com/milb/news/mlb-international-prospects-signing-day-2026', '2026-01-15')
on conflict (url) do update
set title = excluded.title,
    publication_date = coalesce(excluded.publication_date, public.sources.publication_date);

-- ---------------------------------------------------------------------------
-- SIGNING ENVIRONMENTS
-- ---------------------------------------------------------------------------

with lad as (
  select id from public.organizations where abbreviation = 'LAD'
)
insert into public.signing_environments (
  organization_id, signing_year, signing_period_label, regime,
  club_bonus_pool_usd, pool_after_trades_usd, max_individual_bonus_usd,
  overage_tax_rate, tradeable_pool_space, penalty_status, rules_summary
)
select id, 2015, '2015-16', 'AGGRESSIVE_OVERAGE',
       2020300, 700000, null, 1.0, true,
       'Maximum overage penalty; future individual-bonus restriction triggered',
       'Dodgers exceeded the pool by more than 15%, paid a 100% tax on overage, and were barred from bonuses above $300,000 in the next two periods.'
from lad
union all
select id, 2017, '2017-18', 'PENALTY_RESTRICTED',
       null, null, 300000, null, null,
       'Individual signing bonus capped at $300,000',
       'Restriction resulted from the 2015-16 overage.'
from lad
union all
select id, 2018, '2018-19', 'MODERN_HARD_POOL',
       4983500, null, null, null, true,
       null,
       'Hard-cap pool system; Dodgers were no longer one of the clubs under the grandfathered $300,000 individual cap.'
from lad
union all
select id, 2022, '2021-22', 'MODERN_HARD_POOL',
       4644000, null, null, null, true,
       null,
       'Pool was reduced by $500,000 after the Trevor Bauer free-agent signing.'
from lad
union all
select id, 2023, '2023', 'MODERN_HARD_POOL',
       4144000, null, null, null, true,
       null,
       'MLB.com reported a $4.144M base signing pool.'
from lad
union all
select id, 2024, '2024', 'MODERN_HARD_POOL',
       5284000, null, null, null, true,
       null,
       'MLB.com reported a $5.284M base signing pool.'
from lad
union all
select id, 2025, '2025', 'MODERN_HARD_POOL',
       5146200, null, null, null, true,
       null,
       'Initial pool. Additional pool capacity was required to accommodate Roki Sasaki''s reported $6.5M bonus.'
from lad
union all
select id, 2026, '2026', 'MODERN_HARD_POOL',
       6679200, null, null, null, true,
       null,
       'MLB.com reported $6.6792M available to Los Angeles.'
from lad
on conflict (organization_id, signing_year) do update set
  signing_period_label = excluded.signing_period_label,
  regime = excluded.regime,
  club_bonus_pool_usd = excluded.club_bonus_pool_usd,
  pool_after_trades_usd = excluded.pool_after_trades_usd,
  max_individual_bonus_usd = excluded.max_individual_bonus_usd,
  overage_tax_rate = excluded.overage_tax_rate,
  penalty_status = excluded.penalty_status,
  rules_summary = excluded.rules_summary;

-- ---------------------------------------------------------------------------
-- PLAYERS
-- ---------------------------------------------------------------------------

insert into public.players (full_name, canonical_name, birth_country, primary_position, bats, throws)
select v.*
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
  select 1 from public.players p where p.full_name = v.full_name
);

insert into public.player_aliases (player_id, alias, alias_type)
select id, 'Yadiel Alvarez', 'SOURCE_VARIANT'
from public.players where full_name = 'Yadier Álvarez'
on conflict do nothing;

insert into public.player_aliases (player_id, alias, alias_type)
select id, 'Oneal Cruz', 'SOURCE_VARIANT'
from public.players where full_name = 'Oneil Cruz'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- SIGNINGS
-- ---------------------------------------------------------------------------

with
lad as (select id from public.organizations where abbreviation = 'LAD'),
env as (
  select signing_year, id
  from public.signing_environments
  where organization_id = (select id from lad)
),
seed(full_name, sy, country_market, pathway, source_league, source_club, pro_years, bonus, reported, rank) as (
  values
  ('Yadier Álvarez',2015,'Cuba','CUBAN_AMATEUR',null,null,null,16000000,true,2),
  ('Starling Heredia',2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,2600000,true,5),
  ('Ronny Brito',2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,2000000,true,21),
  ('Oneil Cruz',2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,950000,true,null),
  ('Christopher Arias',2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,500000,true,null),
  ('Carlos Rincon',2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,350000,true,null),
  ('Ramon Rosso',2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,62000,true,null),
  ('Damaso Marte Jr.',2015,'Dominican Republic','LATAM_AMATEUR',null,null,null,300000,true,null),
  ('Luis Rodriguez (2015)',2015,'Venezuela','LATAM_AMATEUR',null,null,null,62500,true,null),
  ('Aldo Espinoza',2015,'Nicaragua','LATAM_AMATEUR',null,null,null,50000,true,null),
  ('Yusniel Diaz',2015,'Cuba','CUBAN_PRO','Serie Nacional','Industriales',1,15500000,true,3),
  ('Omar Estevez',2015,'Cuba','CUBAN_AMATEUR',null,null,null,6000000,true,null),
  ('Yordan Alvarez',2016,'Cuba','CUBAN_PRO','Serie Nacional','Las Tunas',2,2000000,true,null),

  ('Diego Cartaya',2018,'Venezuela','LATAM_AMATEUR',null,null,null,2500000,true,1),
  ('Jerming Rosario',2018,'Dominican Republic','LATAM_AMATEUR',null,null,null,600000,true,null),
  ('Alex De Jesus',2018,'Dominican Republic','LATAM_AMATEUR',null,null,null,500000,true,null),

  ('Luis Rodriguez (2019)',2019,'Venezuela','LATAM_AMATEUR',null,null,null,2667500,true,4),

  ('Josue De Paula',2022,'Dominican Republic','LATAM_AMATEUR',null,null,null,397500,true,null),

  ('Joendry Vargas',2023,'Dominican Republic','LATAM_AMATEUR',null,null,null,2077500,true,3),
  ('Arnaldo Lantigua',2023,'Dominican Republic','LATAM_AMATEUR',null,null,null,null,false,23),
  ('Jesus Tillero',2023,'Venezuela','LATAM_AMATEUR',null,null,null,497500,true,null),
  ('Daniel Mielcarek',2023,'Dominican Republic','LATAM_AMATEUR',null,null,null,397500,true,null),

  ('Emil Morales',2024,'Dominican Republic','LATAM_AMATEUR',null,null,null,1900000,true,14),

  ('Roki Sasaki',2025,'Japan','POSTED_PLAYER','NPB','Chiba Lotte Marines',4,6500000,true,1),
  ('Luis Tovar',2025,'Venezuela','LATAM_AMATEUR',null,null,null,397500,true,null),
  ('Adrian Torres',2025,'Panama','LATAM_AMATEUR',null,null,null,362500,true,null),

  ('Ezequiel Melburne',2026,'Dominican Republic','LATAM_AMATEUR',null,null,null,747500,true,29),
  ('Rubel Arias',2026,'Dominican Republic','LATAM_AMATEUR',null,null,null,997500,true,null),
  ('Ariel Reynoso',2026,'Dominican Republic','LATAM_AMATEUR',null,null,null,597500,true,null),
  ('Jose Victorino',2026,'Dominican Republic','LATAM_AMATEUR',null,null,null,547500,true,null),
  ('Jose Requena',2026,'Venezuela','LATAM_AMATEUR',null,null,null,372500,true,null)
)
insert into public.signings (
  player_id, organization_id, signing_environment_id, signing_year,
  country_market, pathway, source_league, source_club,
  professional_experience_years, signing_bonus_usd, bonus_publicly_reported,
  international_rank, rank_source
)
select
  p.id, (select id from lad),
  case
    when s.sy = 2016 then (select id from env where signing_year = 2015)
    else (select id from env where signing_year = s.sy)
  end,
  s.sy, s.country_market, s.pathway::public.acquisition_pathway,
  s.source_league, s.source_club, s.pro_years, s.bonus, s.reported,
  s.rank, case when s.rank is not null then 'MLB Pipeline' else null end
from seed s
join public.players p on p.full_name = s.full_name
on conflict (player_id, organization_id, signing_year) do update set
  signing_environment_id = excluded.signing_environment_id,
  country_market = excluded.country_market,
  pathway = excluded.pathway,
  source_league = excluded.source_league,
  source_club = excluded.source_club,
  professional_experience_years = excluded.professional_experience_years,
  signing_bonus_usd = excluded.signing_bonus_usd,
  bonus_publicly_reported = excluded.bonus_publicly_reported,
  international_rank = excluded.international_rank,
  rank_source = excluded.rank_source;

-- ---------------------------------------------------------------------------
-- TRAINER / ACADEMY NETWORK
-- ---------------------------------------------------------------------------

insert into public.trainers (name, academy_name, country)
select v.name, v.academy_name, v.country
from (
  values
    ('Jaime Ramos', null::text, 'Dominican Republic'),
    ('Fausto Garcia', null::text, 'Dominican Republic')
) as v(name, academy_name, country)
where not exists (
  select 1 from public.trainers t
  where t.name = v.name
    and t.academy_name is not distinct from v.academy_name
);

insert into public.player_trainers (player_id, trainer_id, relationship_type, confidence)
select p.id, t.id, 'PRE_SIGNING_TRAINER', 'VERIFIED'
from public.players p
join public.trainers t on t.name = 'Jaime Ramos'
where p.full_name in ('Emil Morales','Ezequiel Melburne','Rubel Arias')
on conflict do nothing;

insert into public.player_trainers (player_id, trainer_id, relationship_type, confidence)
select p.id, t.id, 'PRE_SIGNING_TRAINER', 'VERIFIED'
from public.players p
join public.trainers t on t.name = 'Fausto Garcia'
where p.full_name = 'Emil Morales'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- TRANSACTION EXAMPLE: Arnaldo Lantigua
-- This demonstrates why later MLB production must not automatically be
-- credited as direct Dodgers on-field value.
-- ---------------------------------------------------------------------------

insert into public.transactions (
  player_id, transaction_date, transaction_type,
  from_organization_id, to_organization_id,
  return_description, source_id, confidence
)
select
  p.id, '2025-01-17', 'TRADE',
  lad.id, cin.id,
  'Traded to Cincinnati Reds for future considerations',
  src.id, 'VERIFIED'
from public.players p
cross join (select id from public.organizations where abbreviation='LAD') lad
cross join (select id from public.organizations where abbreviation='CIN') cin
cross join (select id from public.sources where url='https://www.mlb.com/dodgers/roster/transactions/2025/01') src
where p.full_name='Arnaldo Lantigua'
and not exists (
  select 1 from public.transactions tx
  where tx.player_id=p.id
    and tx.transaction_date='2025-01-17'
    and tx.transaction_type='TRADE'
);

-- ---------------------------------------------------------------------------
-- RECORD-LEVEL PROVENANCE
-- ---------------------------------------------------------------------------

-- 2015/16 cohort source
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'HIGH',
       'MLB.com reports signing identity, market and bonus; several deals were attributed to industry sources rather than formally confirmed by the club.'
from public.signings s
join public.players p on p.id=s.player_id
cross join (select id from public.sources where url='https://www.mlb.com/dodgers/news/dodgers-sign-pair-of-cuban-prospects/c-157908784') src
where s.signing_year in (2015,2016)
  and p.full_name in (
    'Yadier Álvarez','Starling Heredia','Ronny Brito','Oneil Cruz','Christopher Arias',
    'Carlos Rincon','Ramon Rosso','Damaso Marte Jr.','Luis Rodriguez (2015)',
    'Aldo Espinoza','Yusniel Diaz','Omar Estevez'
  )
  and not exists (
    select 1 from public.evidence e
    where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
  );

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'HIGH',
       'MLB.com reported a $2M agreement with Yordan Alvarez during the 2015-16 international period.'
from public.signings s
join public.players p on p.id=s.player_id
cross join (select id from public.sources where url='https://www.mlb.com/news/dodgers-have-deal-with-cuban-of-yordan-alvarez-c184312840') src
where p.full_name='Yordan Alvarez'
and not exists (
  select 1 from public.evidence e where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

-- 2018
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'HIGH',
       'MLB.com reported the agreements and bonuses from industry sources.'
from public.signings s
join public.players p on p.id=s.player_id
cross join (select id from public.sources where url='https://www.mlb.com/news/dodgers-to-sign-catcher-diego-cartaya-c283475518') src
where p.full_name in ('Diego Cartaya','Jerming Rosario','Alex De Jesus')
and not exists (
  select 1 from public.evidence e where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

-- 2019
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'HIGH',
       'MLB.com reported Luis Rodriguez agreement and $2.6675M bonus.'
from public.signings s
join public.players p on p.id=s.player_id
cross join (select id from public.sources where url='https://www.mlb.com/news/dodgers-sign-pair-of-top-int-l-prospects') src
where p.full_name='Luis Rodriguez (2019)'
and not exists (
  select 1 from public.evidence e where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

-- 2022
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'VERIFIED',
       'MLB prospect profile identifies De Paula as a January 2022 Dodgers signing for $397,500.'
from public.signings s
join public.players p on p.id=s.player_id
cross join (select id from public.sources where url='https://www.mlb.com/milb/prospects/2023/dodgers/josue-de-paula-800543') src
where p.full_name='Josue De Paula'
and not exists (
  select 1 from public.evidence e where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

-- 2023
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'HIGH',
       case when p.full_name='Arnaldo Lantigua'
            then 'Dodgers press release verifies signing and No. 23 MLB Pipeline rank; bonus intentionally remains NULL.'
            else 'MLB International Signing Day reports the signing and bonus.'
       end
from public.signings s
join public.players p on p.id=s.player_id
cross join lateral (
  select id from public.sources
  where url = case
    when p.full_name='Arnaldo Lantigua'
    then 'https://www.mlb.com/press-release/press-release-dodgers-announce-2023-international-signings'
    else 'https://www.mlb.com/news/mlb-international-prospects-signing-day-2023'
  end
) src
where p.full_name in ('Joendry Vargas','Arnaldo Lantigua','Jesus Tillero','Daniel Mielcarek')
and not exists (
  select 1 from public.evidence e where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

-- 2024
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'HIGH',
       'MLB Signing Day reports Morales at $1.9M; Dodgers coverage reports his market, rank and trainer relationships.'
from public.signings s
join public.players p on p.id=s.player_id
cross join (select id from public.sources where url='https://www.mlb.com/news/mlb-international-prospects-signing-day-2024') src
where p.full_name='Emil Morales'
and not exists (
  select 1 from public.evidence e where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

-- 2025
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'HIGH',
       'MLB 2025 signing coverage reports bonus and international signing.'
from public.signings s
join public.players p on p.id=s.player_id
cross join (select id from public.sources where url='https://www.mlb.com/news/mlb-international-prospects-signing-day-2025') src
where p.full_name in ('Roki Sasaki','Luis Tovar','Adrian Torres')
and not exists (
  select 1 from public.evidence e where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

-- 2026
insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'HIGH',
       'MLB 2026 signing coverage reports Dodgers agreement/bonus.'
from public.signings s
join public.players p on p.id=s.player_id
cross join (select id from public.sources where url='https://www.mlb.com/milb/news/mlb-international-prospects-signing-day-2026') src
where p.full_name in ('Rubel Arias','Ariel Reynoso','Jose Victorino','Jose Requena')
and not exists (
  select 1 from public.evidence e where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, null, src.id, 'HIGH',
       'Dodgers 2026 international coverage reports Melburne at $747,500 and identifies Jaime Ramos as trainer for Melburne and Arias.'
from public.signings s
join public.players p on p.id=s.player_id
cross join (select id from public.sources where url='https://www.mlb.com/news/los-angeles-dodgers-2026-international-signings') src
where p.full_name in ('Ezequiel Melburne','Rubel Arias')
and not exists (
  select 1 from public.evidence e where e.entity_type='signing' and e.entity_id=s.id and e.source_id=src.id
);

commit;

-- ---------------------------------------------------------------------------
-- VERIFICATION QUERIES
-- ---------------------------------------------------------------------------

-- Seed count:
-- select count(*) as seeded_dodgers_signings
-- from public.signings s
-- join public.organizations o on o.id=s.organization_id
-- where o.abbreviation='LAD';

-- By year:
-- select signing_year, count(*) n, sum(signing_bonus_usd) known_bonus
-- from public.signings s
-- join public.organizations o on o.id=s.organization_id
-- where o.abbreviation='LAD'
-- group by signing_year
-- order by signing_year;

-- Confirm unknown != zero:
-- select p.full_name, s.signing_bonus_usd, s.bonus_publicly_reported
-- from public.signings s
-- join public.players p on p.id=s.player_id
-- where p.full_name='Arnaldo Lantigua';

-- Trainer network:
-- select p.full_name, t.name as trainer
-- from public.player_trainers pt
-- join public.players p on p.id=pt.player_id
-- join public.trainers t on t.id=pt.trainer_id
-- order by t.name, p.full_name;
