-- DISI v0.1
-- 008_mature_asset_realization.sql
-- Separates talent identification from direct Dodgers MLB value realization.
-- Run after 007.
--
-- Important:
-- A player who later produces MLB WAR elsewhere is not automatically a failed
-- Dodgers asset. Trade returns must be evaluated separately. This migration
-- therefore tracks the disposition channel instead of equating destination WAR
-- with value lost.

-- ---------------------------------------------------------------------------
-- 1. OFFICIAL TRANSACTION SOURCES
-- ---------------------------------------------------------------------------

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com','PRESS_RELEASE','Dodgers acquire Josh Fields from Houston',
   'https://www.mlb.com/press-release/dodgers-acquire-josh-fields-from-houston-193028122',
   date '2016-08-01')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com','PRESS_RELEASE','Dodgers acquire Tony Watson from Pirates',
   'https://www.mlb.com/press-release/dodgers-acquire-tony-watson-from-pirates-245586558',
   date '2017-07-31')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url, publication_date)
values
  ('MLB.com','PRESS_RELEASE','Dodgers acquire Manny Machado',
   'https://www.mlb.com/press-release/dodgers-acquire-manny-machado-286394692',
   date '2018-07-19')
on conflict (url) do nothing;

insert into public.sources
  (source_name, source_type, title, url)
values
  ('MLB.com','PLAYER_PAGE','Ramon Rosso transaction record',
   'https://www.mlb.com/player/ramon-rosso-665759')
on conflict (url) do nothing;

-- ---------------------------------------------------------------------------
-- 2. RESTORE / VERIFY PRE-DEBUT ASSET DISPOSITIONS
-- ---------------------------------------------------------------------------

insert into public.transactions (
  player_id, transaction_date, transaction_type,
  from_organization_id, to_organization_id,
  return_description, source_id, confidence
)
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
join public.organizations lad on lad.abbreviation='LAD'
join public.organizations hou on hou.abbreviation='HOU'
join public.sources src
  on src.url='https://www.mlb.com/press-release/dodgers-acquire-josh-fields-from-houston-193028122'
where p.full_name='Yordan Alvarez'
  and not exists (
    select 1 from public.transactions tx
    where tx.player_id=p.id
      and tx.transaction_date=date '2016-08-01'
      and tx.transaction_type='TRADE'
  );

insert into public.transactions (
  player_id, transaction_date, transaction_type,
  from_organization_id, to_organization_id,
  return_description, source_id, confidence
)
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
join public.organizations lad on lad.abbreviation='LAD'
join public.organizations pit on pit.abbreviation='PIT'
join public.sources src
  on src.url='https://www.mlb.com/press-release/dodgers-acquire-tony-watson-from-pirates-245586558'
where p.full_name='Oneil Cruz'
  and not exists (
    select 1 from public.transactions tx
    where tx.player_id=p.id
      and tx.transaction_date=date '2017-07-31'
      and tx.transaction_type='TRADE'
  );

insert into public.transactions (
  player_id, transaction_date, transaction_type,
  from_organization_id, to_organization_id,
  return_description, source_id, confidence
)
select
  p.id,
  date '2018-07-19',
  'TRADE',
  lad.id,
  bal.id,
  'Traded in five-player package to Baltimore Orioles for SS Manny Machado',
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
join public.organizations lad on lad.abbreviation='LAD'
join public.organizations bal on bal.abbreviation='BAL'
join public.sources src
  on src.url='https://www.mlb.com/press-release/dodgers-acquire-manny-machado-286394692'
where p.full_name='Yusniel Diaz'
  and not exists (
    select 1 from public.transactions tx
    where tx.player_id=p.id
      and tx.transaction_date=date '2018-07-19'
      and tx.transaction_type='TRADE'
  );

insert into public.transactions (
  player_id, transaction_date, transaction_type,
  from_organization_id, to_organization_id,
  return_description, source_id, confidence
)
select
  p.id,
  date '2016-07-15',
  'RELEASE',
  lad.id,
  null,
  'Released by DSL Dodgers; later signed by Philadelphia on June 2, 2017',
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
join public.organizations lad on lad.abbreviation='LAD'
join public.sources src
  on src.url='https://www.mlb.com/player/ramon-rosso-665759'
where p.full_name='Ramon Rosso'
  and not exists (
    select 1 from public.transactions tx
    where tx.player_id=p.id
      and tx.transaction_date=date '2016-07-15'
      and tx.transaction_type='RELEASE'
  );

-- ---------------------------------------------------------------------------
-- 3. MATURE ASSET-REALIZATION VIEW
-- ---------------------------------------------------------------------------

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
    when m.mlb_debut_org = 'LAD'
      then 'DIRECT_DODGERS_MLB_DEBUT'
    when tx.transaction_type = 'TRADE'
      then 'TRADED_BEFORE_MLB_DEBUT'
    when tx.transaction_type = 'RELEASE'
      then 'RELEASED_BEFORE_MLB_DEBUT'
    when m.mlb_debut_org is distinct from 'LAD'
      then 'LEFT_ORGANIZATION_BEFORE_MLB_DEBUT'
    else 'OTHER'
  end as realization_channel
from public.v_dodgers_mature_player_analysis m
left join lateral (
  select
    t.transaction_date,
    t.transaction_type,
    t.return_description
  from public.transactions t
  join public.organizations o
    on o.id=t.from_organization_id
  where t.player_id=m.player_id
    and o.abbreviation='LAD'
  order by t.transaction_date
  limit 1
) tx on true;

grant select on public.v_dodgers_mature_asset_realization to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. EXECUTIVE SUMMARY
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_mature_asset_summary
with (security_invoker = true)
as
select
  count(*) filter (where reached_mlb_verified) as verified_mlb_players,

  count(*) filter (
    where reached_mlb_verified
      and realization_channel='DIRECT_DODGERS_MLB_DEBUT'
  ) as direct_dodgers_mlb_debuts,

  count(*) filter (
    where reached_mlb_verified
      and realization_channel='TRADED_BEFORE_MLB_DEBUT'
  ) as traded_before_mlb_debut,

  count(*) filter (
    where reached_mlb_verified
      and realization_channel='RELEASED_BEFORE_MLB_DEBUT'
  ) as released_before_mlb_debut,

  round(
    sum(career_war)
      filter (where reached_mlb_verified and career_war is not null)::numeric,
    2
  ) as observed_career_war_of_mlb_players,

  round(
    sum(career_war)
      filter (
        where reached_mlb_verified
          and mlb_debut_org <> 'LAD'
          and career_war is not null
      )::numeric,
    2
  ) as observed_career_war_debuting_elsewhere,

  round(
    100.0 *
    count(*) filter (
      where reached_mlb_verified and mlb_debut_org <> 'LAD'
    )::numeric
    /
    nullif(count(*) filter (where reached_mlb_verified),0),
    1
  ) as pct_verified_mlb_players_debuting_elsewhere

from public.v_dodgers_mature_asset_realization;

grant select on public.v_dodgers_mature_asset_summary to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. OUTPUTS
-- ---------------------------------------------------------------------------

select * from public.v_dodgers_mature_asset_summary;

select
  full_name,
  signing_bonus_usd,
  reached_mlb_verified,
  mlb_debut_org,
  career_war,
  realization_channel,
  pre_mlb_disposition_date,
  return_description
from public.v_dodgers_mature_asset_realization
where reached_mlb_verified is true
order by career_war desc nulls last;
