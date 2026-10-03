-- DISI v0.1
-- 005_outcome_completeness_and_rosso.sql
-- Adds Ramón Rosso's verified MLB outcome and replaces misleading "hit rate"
-- interpretation with outcome-coverage-aware analytics.
-- Run after 001-004c.

-- ---------------------------------------------------------------------------
-- 1. PHILADELPHIA PHILLIES ORGANIZATION
-- ---------------------------------------------------------------------------

insert into public.organizations
  (name, abbreviation, organization_type, league, country)
values
  ('Philadelphia Phillies', 'PHI', 'MLB_CLUB', 'MLB', 'United States')
on conflict (name) do update
set abbreviation = 'PHI';

-- ---------------------------------------------------------------------------
-- 2. RAMON ROSSO SOURCE
-- ---------------------------------------------------------------------------

insert into public.sources
  (source_name, source_type, title, url)
values
  ('Baseball-Reference', 'PLAYER_PAGE', 'Ramon Rosso Stats',
   'https://www.baseball-reference.com/players/r/rossora01.shtml')
on conflict (url) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RAMON ROSSO BIO / SIGNING DATE
-- ---------------------------------------------------------------------------

update public.players
set birth_date = date '1996-06-09',
    canonical_name = 'Ramon Rosso'
where full_name = 'Ramon Rosso';

update public.signings s
set signing_date = date '2015-07-02'
from public.players p
where s.player_id = p.id
  and p.full_name = 'Ramon Rosso'
  and s.signing_year = 2015;

-- ---------------------------------------------------------------------------
-- 4. VERIFIED MLB OUTCOME
-- ---------------------------------------------------------------------------

insert into public.outcomes (
  player_id,
  reached_mlb,
  mlb_debut_date,
  mlb_debut_organization_id,
  mlb_games,
  mlb_ip,
  career_war,
  current_status,
  outcome_through_season,
  source_id,
  confidence
)
select
  p.id,
  true,
  date '2020-07-24',
  phi.id,
  14,
  17.2,
  -0.1,
  'LAST_MLB_APPEARANCE_2021',
  2026,
  src.id,
  'VERIFIED'::public.confidence_level
from public.players p
join public.organizations phi on phi.abbreviation = 'PHI'
join public.sources src
  on src.url = 'https://www.baseball-reference.com/players/r/rossora01.shtml'
where p.full_name = 'Ramon Rosso'
on conflict (player_id) do update set
  reached_mlb = excluded.reached_mlb,
  mlb_debut_date = excluded.mlb_debut_date,
  mlb_debut_organization_id = excluded.mlb_debut_organization_id,
  mlb_games = excluded.mlb_games,
  mlb_ip = excluded.mlb_ip,
  career_war = excluded.career_war,
  current_status = excluded.current_status,
  outcome_through_season = excluded.outcome_through_season,
  source_id = excluded.source_id,
  confidence = excluded.confidence;

-- ---------------------------------------------------------------------------
-- 5. OUTCOME AUDIT TABLE
-- This table separates "we verified no MLB debut" from "we have not checked yet".
-- ---------------------------------------------------------------------------

create table if not exists public.outcome_audits (
  player_id uuid primary key references public.players(id) on delete cascade,
  audited_through_date date not null,
  reached_mlb_verified boolean not null,
  source_id uuid references public.sources(id) on delete set null,
  confidence public.confidence_level not null default 'MEDIUM',
  audit_note text,
  updated_at timestamptz not null default now()
);

alter table public.outcome_audits enable row level security;
revoke all on table public.outcome_audits from anon, authenticated;
grant select on table public.outcome_audits to anon, authenticated;

drop policy if exists public_read_outcome_audits on public.outcome_audits;
create policy public_read_outcome_audits
on public.outcome_audits
for select
to anon, authenticated
using (true);

-- Automatically treat existing verified positive MLB outcomes as audited positives.
insert into public.outcome_audits (
  player_id,
  audited_through_date,
  reached_mlb_verified,
  source_id,
  confidence,
  audit_note
)
select
  oc.player_id,
  date '2026-10-03',
  true,
  oc.source_id,
  oc.confidence,
  'MLB debut verified from outcome source.'
from public.outcomes oc
where oc.reached_mlb is true
on conflict (player_id) do update set
  audited_through_date = excluded.audited_through_date,
  reached_mlb_verified = excluded.reached_mlb_verified,
  source_id = excluded.source_id,
  confidence = excluded.confidence,
  audit_note = excluded.audit_note,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 6. COVERAGE-AWARE COHORT VIEW
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_outcome_coverage
with (security_invoker = true)
as
select
  c.player_id,
  c.full_name,
  c.signing_year,
  c.signing_date,
  c.country_market,
  c.pathway,
  c.signing_bonus_usd,
  c.reached_mlb,
  c.mlb_debut_date,
  c.mlb_debut_org,
  c.career_war,
  a.audited_through_date,
  a.reached_mlb_verified,
  (a.player_id is not null) as outcome_audited,
  case
    when a.player_id is not null then 'AUDITED'
    else 'NOT_YET_AUDITED'
  end as outcome_coverage_status,
  case
    when c.signing_date is not null
      then c.signing_date <= (date '2026-10-03' - interval '5 years')::date
    else c.signing_year <= 2021
  end as mature_5yr_cohort
from public.v_dodgers_signing_cohort c
left join public.outcome_audits a on a.player_id = c.player_id;

grant select on public.v_dodgers_outcome_coverage to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. SAFER EXECUTIVE KPI VIEW
-- Does NOT call unreviewed players "misses".
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_executive_kpis_v2
with (security_invoker = true)
as
select
  count(*) as tracked_signings,

  count(*) filter (where outcome_audited) as outcome_audited_signings,

  round(
    count(*) filter (where outcome_audited)::numeric
    / nullif(count(*), 0),
    4
  ) as outcome_audit_coverage,

  count(*) filter (
    where outcome_audited
      and reached_mlb_verified is true
  ) as verified_mlb_players,

  count(*) filter (
    where mature_5yr_cohort
  ) as mature_5yr_signings,

  count(*) filter (
    where mature_5yr_cohort and outcome_audited
  ) as mature_5yr_audited,

  round(
    count(*) filter (
      where mature_5yr_cohort and outcome_audited
    )::numeric
    /
    nullif(
      count(*) filter (where mature_5yr_cohort),
      0
    ),
    4
  ) as mature_outcome_audit_coverage,

  case
    when count(*) filter (
      where mature_5yr_cohort and not outcome_audited
    ) = 0
    then round(
      count(*) filter (
        where mature_5yr_cohort
          and reached_mlb_verified is true
      )::numeric
      /
      nullif(
        count(*) filter (where mature_5yr_cohort),
        0
      ),
      4
    )
    else null
  end as mature_verified_mlb_reach_rate,

  round(
    sum(signing_bonus_usd)
      filter (where signing_bonus_usd is not null)::numeric,
    2
  ) as known_bonus_spend_usd,

  round(
    sum(career_war)
      filter (where career_war is not null)::numeric,
    2
  ) as verified_observed_career_war

from public.v_dodgers_outcome_coverage;

grant select on public.v_dodgers_executive_kpis_v2 to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. AUDIT QUEUE
-- Mature, unaudited players come first.
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_outcome_audit_queue
with (security_invoker = true)
as
select
  player_id,
  full_name,
  signing_year,
  country_market,
  pathway,
  signing_bonus_usd,
  mature_5yr_cohort
from public.v_dodgers_outcome_coverage
where outcome_audited is false
order by mature_5yr_cohort desc, signing_year, full_name;

grant select on public.v_dodgers_outcome_audit_queue to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. FINAL OUTPUT
-- ---------------------------------------------------------------------------

select * from public.v_dodgers_executive_kpis_v2;

select *
from public.v_dodgers_outcome_audit_queue
limit 50;
