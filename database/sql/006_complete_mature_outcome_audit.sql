-- DISI v0.1
-- 006_complete_mature_outcome_audit.sql
-- Completes the MLB-debut audit for the 13 remaining mature tracked signings.
-- "No MLB debut" means no MLB regular-season appearance verified through
-- 2026-10-03 from the cited player record.
--
-- IMPORTANT:
-- This completes the 17-player TRACKED mature sample only. It is not yet a
-- complete census of every Dodgers international signing from 2015-2019.

-- ---------------------------------------------------------------------------
-- 1. SOURCES FOR THE 13 NEGATIVE MLB-DEBUT AUDITS
-- ---------------------------------------------------------------------------

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Aldo Espinoza player record',
 'https://www.mlb.com/player/aldo-espinoza-665852')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Carlos Rincon player record',
 'https://www.mlb.com/player/carlos-rincon-665779')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('Baseball-Reference','MINOR_LEAGUE_PLAYER_PAGE','Christopher Arias minor-league record',
 'https://www.baseball-reference.com/register/player.fcgi?id=arias-000chr')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MiLB.com','PLAYER_PAGE','Damaso Marte Jr. player record',
 'https://www.milb.com/player/damaso-marte-jr-666006')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Luis Rodriguez 2015 player record',
 'https://www.mlb.com/player/luis-rodriguez-665960')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Omar Estevez player record',
 'https://www.mlb.com/player/omar-estevez-666784')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Ronny Brito player record',
 'https://www.mlb.com/player/ronny-brito-665798')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Starling Heredia player record',
 'https://www.mlb.com/player/starling-heredia-665752')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Yadier Alvarez player record',
 'https://www.mlb.com/player/yadier-alvarez-665751')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Alex De Jesus player record',
 'https://www.mlb.com/player/alex-de-jesus-682942')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Diego Cartaya player record',
 'https://www.mlb.com/player/diego-cartaya-682616')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Jerming Rosario player record',
 'https://www.mlb.com/player/682645')
on conflict (url) do nothing;

insert into public.sources (source_name, source_type, title, url)
values
('MLB.com','PLAYER_PAGE','Luis Rodriguez 2019 player record',
 'https://www.mlb.com/player/luis-rodriguez-691177')
on conflict (url) do nothing;

-- ---------------------------------------------------------------------------
-- 2. AUDIT THE 13 REMAINING MATURE PLAYERS
-- ---------------------------------------------------------------------------

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select
  p.id,
  date '2026-10-03',
  false,
  src.id,
  'VERIFIED'::public.confidence_level,
  'No MLB regular-season appearance found in the cited player record through 2026-10-03.'
from public.players p
join public.sources src
  on src.url = 'https://www.mlb.com/player/aldo-espinoza-665852'
where p.full_name = 'Aldo Espinoza'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'No MLB regular-season appearance found in the cited player record through 2026-10-03.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/carlos-rincon-665779'
where p.full_name='Carlos Rincon'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Baseball-Reference register page shows only minor-league history; no MLB regular-season appearance through 2026-10-03.'
from public.players p
join public.sources src
  on src.url='https://www.baseball-reference.com/register/player.fcgi?id=arias-000chr'
where p.full_name='Christopher Arias'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'MiLB player record shows release from the AZL Dodgers in 2017 and no MLB regular-season appearance.'
from public.players p
join public.sources src
  on src.url='https://www.milb.com/player/damaso-marte-jr-666006'
where p.full_name='Damaso Marte Jr.'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Player record shows minor-league history and release in 2019; no MLB regular-season appearance.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/luis-rodriguez-665960'
where p.full_name='Luis Rodriguez (2015)'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Player record shows minor-league/foreign-league history and free agency in 2022; no MLB regular-season appearance.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/omar-estevez-666784'
where p.full_name='Omar Estevez'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Player record shows minor-league history and release in 2021; no MLB regular-season appearance.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/ronny-brito-665798'
where p.full_name='Ronny Brito'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Player record shows minor-league history and release in 2020; no MLB regular-season appearance.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/starling-heredia-665752'
where p.full_name='Starling Heredia'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Reached the Dodgers 40-man/was recalled but no MLB regular-season appearance is recorded; later elected free agency in 2022.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/yadier-alvarez-665751'
where p.full_name='Yadier Álvarez'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Player record shows minor-league assignments after trade to Toronto; no MLB regular-season appearance through the audit date.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/alex-de-jesus-682942'
where p.full_name='Alex De Jesus'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Player record shows minor-league history and release by Eugene in April 2026; no MLB regular-season appearance.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/diego-cartaya-682616'
where p.full_name='Diego Cartaya'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Active with Triple-A Oklahoma City in 2026; no MLB regular-season appearance through the audit date.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/682645'
where p.full_name='Jerming Rosario'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

insert into public.outcome_audits (
  player_id, audited_through_date, reached_mlb_verified,
  source_id, confidence, audit_note
)
select p.id, date '2026-10-03', false, src.id,
       'VERIFIED'::public.confidence_level,
       'Player record shows minor-league history after the 2019 signing; no MLB regular-season appearance through the audit date.'
from public.players p
join public.sources src
  on src.url='https://www.mlb.com/player/luis-rodriguez-691177'
where p.full_name='Luis Rodriguez (2019)'
on conflict (player_id) do update set
  audited_through_date=excluded.audited_through_date,
  reached_mlb_verified=excluded.reached_mlb_verified,
  source_id=excluded.source_id,
  confidence=excluded.confidence,
  audit_note=excluded.audit_note,
  updated_at=now();

-- ---------------------------------------------------------------------------
-- 3. MATURE TRACKED-SAMPLE SUMMARY
-- ---------------------------------------------------------------------------

create or replace view public.v_dodgers_mature_tracked_sample
with (security_invoker = true)
as
select
  count(*) filter (where mature_5yr_cohort) as mature_tracked_signings,
  count(*) filter (where mature_5yr_cohort and outcome_audited)
    as mature_audited_signings,
  count(*) filter (
    where mature_5yr_cohort
      and reached_mlb_verified is true
  ) as mature_verified_mlb_players,
  round(
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
  ) as mature_tracked_mlb_reach_rate,
  round(
    sum(signing_bonus_usd)
      filter (where mature_5yr_cohort and signing_bonus_usd is not null)::numeric,
    2
  ) as mature_known_bonus_spend_usd,
  round(
    sum(career_war)
      filter (where mature_5yr_cohort and career_war is not null)::numeric,
    2
  ) as mature_observed_career_war
from public.v_dodgers_outcome_coverage;

grant select on public.v_dodgers_mature_tracked_sample to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. FINAL OUTPUTS
-- ---------------------------------------------------------------------------

select * from public.v_dodgers_executive_kpis_v2;

select * from public.v_dodgers_mature_tracked_sample;

select
  full_name,
  signing_year,
  signing_bonus_usd,
  reached_mlb_verified,
  outcome_coverage_status
from public.v_dodgers_outcome_coverage
where mature_5yr_cohort
order by signing_year, full_name;
