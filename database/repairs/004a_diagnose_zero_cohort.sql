-- DISI diagnostic / repair after 004 returned zero tracked signings.
-- Safe to run after 001-004.

-- 1) Normalize the Dodgers organization identity.
update public.organizations
set abbreviation = 'LAD',
    name = 'Los Angeles Dodgers'
where lower(name) = 'los angeles dodgers'
   or abbreviation = 'LAD';

-- 2) Show all organizations that currently own signing rows.
select
  o.id,
  o.name,
  o.abbreviation,
  count(s.id) as signing_rows
from public.organizations o
left join public.signings s on s.organization_id = o.id
group by o.id, o.name, o.abbreviation
having count(s.id) > 0
order by signing_rows desc, o.name;

-- 3) Core row counts.
select
  (select count(*) from public.players) as players_total,
  (select count(*) from public.signings) as signings_total,
  (select count(*)
   from public.signings s
   join public.organizations o on o.id = s.organization_id
   where o.name = 'Los Angeles Dodgers') as dodgers_signings_by_name,
  (select count(*)
   from public.signings s
   join public.organizations o on o.id = s.organization_id
   where o.abbreviation = 'LAD') as dodgers_signings_by_abbreviation;

-- 4) Sample signing rows with organization identity.
select
  p.full_name,
  s.signing_year,
  s.signing_bonus_usd,
  o.name as organization_name,
  o.abbreviation
from public.signings s
join public.players p on p.id = s.player_id
join public.organizations o on o.id = s.organization_id
order by s.signing_year, p.full_name
limit 50;

-- 5) Re-test the cohort view.
select count(*) as tracked_signings
from public.v_dodgers_signing_cohort;

-- 6) Re-test executive KPIs.
select * from public.v_dodgers_executive_kpis;
