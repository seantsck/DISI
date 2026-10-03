-- DISI v0.1
-- 003_observed_outcomes_and_asset_value.sql
-- Simplified / Supabase SQL Editor-safe version.
-- Run this whole file after 001 and 002.

-- ---------------------------------------------------------------------------
-- 1. SCHEMA EXTENSION
-- ---------------------------------------------------------------------------

alter table public.outcomes
  add column if not exists mlb_debut_organization_id uuid
  references public.organizations(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. ORGANIZATIONS
-- ---------------------------------------------------------------------------

insert into public.organizations
  (name, abbreviation, organization_type, league, country)
values
  ('Houston Astros', 'HOU', 'MLB_CLUB', 'MLB', 'United States')
on conflict (name) do update
set abbreviation = excluded.abbreviation;

insert into public.organizations
  (name, abbreviation, organization_type, league, country)
values
  ('Pittsburgh Pirates', 'PIT', 'MLB_CLUB', 'MLB', 'United States')
on conflict (name) do update
set abbreviation = excluded.abbreviation;

insert into public.organizations
  (name, abbreviation, organization_type, league, country)
values
  ('Baltimore Orioles', 'BAL', 'MLB_CLUB', 'MLB', 'United States')
on conflict (name) do update
set abbreviation = excluded.abbreviation;

-- ---------------------------------------------------------------------------
-- 3. SOURCES
-- ---------------------------------------------------------------------------

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('Baseball-Reference', 'PLAYER_PAGE', 'Yordan Alvarez Stats',
   'https://www.baseball-reference.com/players/a/alvaryo01.shtml', null)
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('Baseball-Reference', 'PLAYER_PAGE', 'Oneil Cruz Stats',
   'https://www.baseball-reference.com/players/c/cruzon01.shtml', null)
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('Baseball-Reference', 'PLAYER_PAGE', 'Yusniel Diaz Stats',
   'https://www.baseball-reference.com/players/d/diazyu01.shtml', null)
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('Baseball-Reference', 'PLAYER_PAGE', 'Roki Sasaki Stats',
   'https://www.baseball-reference.com/players/s/sasakro01.shtml', null)
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('Baseball-Reference', 'PLAYER_PAGE', 'Josue De Paula Stats',
   'https://www.baseball-reference.com/players/d/depaujo03.shtml', null)
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com', 'PRESS_RELEASE', 'Dodgers acquire Josh Fields from Houston',
   'https://www.mlb.com/press-release/dodgers-acquire-josh-fields-from-houston-193028122',
   date '2016-08-01')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com', 'PRESS_RELEASE', 'Dodgers acquire Tony Watson from Pirates',
   'https://www.mlb.com/press-release/dodgers-acquire-tony-watson-from-pirates-245586558',
   date '2017-07-31')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com', 'PRESS_RELEASE', 'Dodgers acquire Manny Machado',
   'https://www.mlb.com/press-release/dodgers-acquire-manny-machado-286394692',
   date '2018-07-19')
on conflict (url) do nothing;

-- ---------------------------------------------------------------------------
-- 4. PLAYER NORMALIZATION
-- ---------------------------------------------------------------------------

update public.players
set birth_date = date '1997-06-27',
    canonical_name = 'Yordan Alvarez'
where full_name = 'Yordan Alvarez';

update public.players
set birth_date = date '1998-10-04',
    canonical_name = 'Oneil Cruz'
where full_name = 'Oneil Cruz';

update public.players
set birth_date = date '1996-10-07',
    canonical_name = 'Yusniel Diaz'
where full_name = 'Yusniel Diaz';

update public.players
set birth_date = date '2001-11-03',
    canonical_name = 'Roki Sasaki'
where full_name = 'Roki Sasaki';

update public.players
set birth_date = date '2005-05-24',
    canonical_name = 'Josue De Paula'
where full_name = 'Josue De Paula';

-- ---------------------------------------------------------------------------
-- 5. SIGNING DATES
-- ---------------------------------------------------------------------------

update public.signings s
set signing_date = date '2015-07-02'
from public.players p
where s.player_id = p.id
  and p.full_name = 'Oneil Cruz'
  and s.signing_year = 2015;

update public.signings s
set signing_date = date '2016-06-15'
from public.players p
where s.player_id = p.id
  and p.full_name = 'Yordan Alvarez'
  and s.signing_year = 2016;

update public.signings s
set signing_date = date '2022-01-15'
from public.players p
where s.player_id = p.id
  and p.full_name = 'Josue De Paula'
  and s.signing_year = 2022;

update public.signings s
set signing_date = date '2025-01-22'
from public.players p
where s.player_id = p.id
  and p.full_name = 'Roki Sasaki'
  and s.signing_year = 2025;

-- ---------------------------------------------------------------------------
-- 6. OBSERVED OUTCOMES
-- Each statement is independent and rerunnable.
-- ---------------------------------------------------------------------------

insert into public.outcomes
  (player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
   career_war, current_status, outcome_through_season, source_id, confidence)
select
  p.id,
  true,
  date '2019-06-09',
  o.id,
  30.9,
  'ACTIVE_MLB',
  2026,
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation = 'HOU'
join public.sources src
  on src.url = 'https://www.baseball-reference.com/players/a/alvaryo01.shtml'
where p.full_name = 'Yordan Alvarez'
on conflict (player_id) do update
set reached_mlb = excluded.reached_mlb,
    mlb_debut_date = excluded.mlb_debut_date,
    mlb_debut_organization_id = excluded.mlb_debut_organization_id,
    career_war = excluded.career_war,
    current_status = excluded.current_status,
    outcome_through_season = excluded.outcome_through_season,
    source_id = excluded.source_id,
    confidence = excluded.confidence;

insert into public.outcomes
  (player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
   career_war, current_status, outcome_through_season, source_id, confidence)
select
  p.id,
  true,
  date '2021-10-02',
  o.id,
  8.2,
  'ACTIVE_MLB',
  2026,
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation = 'PIT'
join public.sources src
  on src.url = 'https://www.baseball-reference.com/players/c/cruzon01.shtml'
where p.full_name = 'Oneil Cruz'
on conflict (player_id) do update
set reached_mlb = excluded.reached_mlb,
    mlb_debut_date = excluded.mlb_debut_date,
    mlb_debut_organization_id = excluded.mlb_debut_organization_id,
    career_war = excluded.career_war,
    current_status = excluded.current_status,
    outcome_through_season = excluded.outcome_through_season,
    source_id = excluded.source_id,
    confidence = excluded.confidence;

insert into public.outcomes
  (player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
   mlb_games, mlb_pa, career_war, current_status,
   outcome_through_season, source_id, confidence)
select
  p.id,
  true,
  date '2022-08-02',
  o.id,
  1,
  1,
  0.0,
  'LAST_MLB_APPEARANCE_2022',
  2026,
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation = 'BAL'
join public.sources src
  on src.url = 'https://www.baseball-reference.com/players/d/diazyu01.shtml'
where p.full_name = 'Yusniel Diaz'
on conflict (player_id) do update
set reached_mlb = excluded.reached_mlb,
    mlb_debut_date = excluded.mlb_debut_date,
    mlb_debut_organization_id = excluded.mlb_debut_organization_id,
    mlb_games = excluded.mlb_games,
    mlb_pa = excluded.mlb_pa,
    career_war = excluded.career_war,
    current_status = excluded.current_status,
    outcome_through_season = excluded.outcome_through_season,
    source_id = excluded.source_id,
    confidence = excluded.confidence;

insert into public.outcomes
  (player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
   mlb_games, mlb_ip, career_war, current_status,
   outcome_through_season, source_id, confidence)
select
  p.id,
  true,
  date '2025-03-19',
  o.id,
  36,
  158.2,
  1.1,
  'ACTIVE_MLB',
  2026,
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation = 'LAD'
join public.sources src
  on src.url = 'https://www.baseball-reference.com/players/s/sasakro01.shtml'
where p.full_name = 'Roki Sasaki'
on conflict (player_id) do update
set reached_mlb = excluded.reached_mlb,
    mlb_debut_date = excluded.mlb_debut_date,
    mlb_debut_organization_id = excluded.mlb_debut_organization_id,
    mlb_games = excluded.mlb_games,
    mlb_ip = excluded.mlb_ip,
    career_war = excluded.career_war,
    current_status = excluded.current_status,
    outcome_through_season = excluded.outcome_through_season,
    source_id = excluded.source_id,
    confidence = excluded.confidence;

insert into public.outcomes
  (player_id, reached_mlb, mlb_debut_date, mlb_debut_organization_id,
   mlb_games, career_war, current_status,
   outcome_through_season, source_id, confidence)
select
  p.id,
  true,
  date '2026-09-11',
  o.id,
  11,
  0.5,
  'REACHED_MLB_2026',
  2026,
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
join public.organizations o on o.abbreviation = 'LAD'
join public.sources src
  on src.url = 'https://www.baseball-reference.com/players/d/depaujo03.shtml'
where p.full_name = 'Josue De Paula'
on conflict (player_id) do update
set reached_mlb = excluded.reached_mlb,
    mlb_debut_date = excluded.mlb_debut_date,
    mlb_debut_organization_id = excluded.mlb_debut_organization_id,
    mlb_games = excluded.mlb_games,
    career_war = excluded.career_war,
    current_status = excluded.current_status,
    outcome_through_season = excluded.outcome_through_season,
    source_id = excluded.source_id,
    confidence = excluded.confidence;

-- ---------------------------------------------------------------------------
-- 7. MLB DEBUT MILESTONES
-- ---------------------------------------------------------------------------

insert into public.development_milestones
  (player_id, milestone, milestone_date, age_at_milestone,
   organization_id, source_id, confidence)
select
  p.id,
  'MLB_DEBUT'::public.milestone_type,
  oc.mlb_debut_date,
  round(
    ((oc.mlb_debut_date - p.birth_date) / 365.2425)::numeric,
    2
  ),
  oc.mlb_debut_organization_id,
  oc.source_id,
  'VERIFIED'::public.confidence_level
from public.players p
join public.outcomes oc on oc.player_id = p.id
where p.full_name in
  ('Yordan Alvarez','Oneil Cruz','Yusniel Diaz','Roki Sasaki','Josue De Paula')
  and p.birth_date is not null
  and oc.mlb_debut_date is not null
on conflict (player_id, milestone, milestone_date) do update
set age_at_milestone = excluded.age_at_milestone,
    organization_id = excluded.organization_id,
    source_id = excluded.source_id,
    confidence = excluded.confidence;

-- ---------------------------------------------------------------------------
-- 8. ASSET DISPOSITION TRANSACTIONS
-- ---------------------------------------------------------------------------

insert into public.transactions
  (player_id, transaction_date, transaction_type,
   from_organization_id, to_organization_id,
   return_description, source_id, confidence)
select
  p.id,
  date '2016-08-01',
  'TRADE',
  lad.id,
  hou.id,
  'Traded to Houston Astros for RHP Josh Fields',
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
cross join public.organizations lad
cross join public.organizations hou
cross join public.sources src
where p.full_name = 'Yordan Alvarez'
  and lad.abbreviation = 'LAD'
  and hou.abbreviation = 'HOU'
  and src.url = 'https://www.mlb.com/press-release/dodgers-acquire-josh-fields-from-houston-193028122'
  and not exists (
    select 1 from public.transactions tx
    where tx.player_id = p.id
      and tx.transaction_date = date '2016-08-01'
      and tx.transaction_type = 'TRADE'
  );

insert into public.transactions
  (player_id, transaction_date, transaction_type,
   from_organization_id, to_organization_id,
   return_description, source_id, confidence)
select
  p.id,
  date '2017-07-31',
  'TRADE',
  lad.id,
  pit.id,
  'Traded with RHP Angel German to Pittsburgh Pirates for LHP Tony Watson',
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
cross join public.organizations lad
cross join public.organizations pit
cross join public.sources src
where p.full_name = 'Oneil Cruz'
  and lad.abbreviation = 'LAD'
  and pit.abbreviation = 'PIT'
  and src.url = 'https://www.mlb.com/press-release/dodgers-acquire-tony-watson-from-pirates-245586558'
  and not exists (
    select 1 from public.transactions tx
    where tx.player_id = p.id
      and tx.transaction_date = date '2017-07-31'
      and tx.transaction_type = 'TRADE'
  );

insert into public.transactions
  (player_id, transaction_date, transaction_type,
   from_organization_id, to_organization_id,
   return_description, source_id, confidence)
select
  p.id,
  date '2018-07-19',
  'TRADE',
  lad.id,
  bal.id,
  'Traded as part of a five-player package to Baltimore Orioles for SS Manny Machado',
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
cross join public.organizations lad
cross join public.organizations bal
cross join public.sources src
where p.full_name = 'Yusniel Diaz'
  and lad.abbreviation = 'LAD'
  and bal.abbreviation = 'BAL'
  and src.url = 'https://www.mlb.com/press-release/dodgers-acquire-manny-machado-286394692'
  and not exists (
    select 1 from public.transactions tx
    where tx.player_id = p.id
      and tx.transaction_date = date '2018-07-19'
      and tx.transaction_type = 'TRADE'
  );

-- ---------------------------------------------------------------------------
-- 9. ANALYTICAL VIEW
-- ---------------------------------------------------------------------------

create or replace view public.v_signing_asset_outcomes
with (security_invoker = true)
as
select
  p.id as player_id,
  p.full_name,
  s.signing_year,
  s.signing_date,
  s.pathway,
  s.country_market,
  s.signing_bonus_usd,
  signing_org.id as signing_organization_id,
  signing_org.abbreviation as signing_org,
  oc.reached_mlb,
  oc.mlb_debut_date,
  debut_org.abbreviation as mlb_debut_org,
  (oc.mlb_debut_organization_id = signing_org.id) as debuted_with_signing_org,
  oc.career_war,
  case
    when s.signing_date is not null and oc.mlb_debut_date is not null
    then round(((oc.mlb_debut_date - s.signing_date) / 365.2425)::numeric, 2)
    else null
  end as years_signing_to_mlb,
  first_trade.transaction_date as first_trade_date,
  first_trade.return_description as first_trade_return,
  case
    when first_trade.transaction_date is not null
     and oc.mlb_debut_date is not null
     and first_trade.transaction_date < oc.mlb_debut_date
    then true
    else false
  end as traded_before_mlb_debut,
  case
    when s.signing_bonus_usd is not null
     and s.signing_bonus_usd > 0
     and oc.career_war is not null
    then round((oc.career_war / (s.signing_bonus_usd / 1000000.0))::numeric, 3)
    else null
  end as career_war_per_million_bonus
from public.players p
join public.signings s on s.player_id = p.id
join public.organizations signing_org on signing_org.id = s.organization_id
left join public.outcomes oc on oc.player_id = p.id
left join public.organizations debut_org
  on debut_org.id = oc.mlb_debut_organization_id
left join lateral (
  select
    tx.transaction_date,
    tx.return_description
  from public.transactions tx
  where tx.player_id = p.id
    and tx.from_organization_id = signing_org.id
    and tx.transaction_type = 'TRADE'
  order by tx.transaction_date
  limit 1
) first_trade on true;

grant select on public.v_signing_asset_outcomes to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. FINAL CHECK
-- ---------------------------------------------------------------------------

select
  full_name,
  signing_year,
  signing_bonus_usd,
  reached_mlb,
  mlb_debut_date,
  mlb_debut_org,
  career_war,
  years_signing_to_mlb,
  traded_before_mlb_debut,
  first_trade_return,
  career_war_per_million_bonus
from public.v_signing_asset_outcomes
where full_name in
  ('Yordan Alvarez','Oneil Cruz','Yusniel Diaz','Roki Sasaki','Josue De Paula')
order by signing_year;
