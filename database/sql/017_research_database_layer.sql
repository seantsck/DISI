-- DISI v0.8
-- 017_research_database_layer.sql
-- Research-database layer for the DISI web application. Run after 016.
--
-- Adds:
--   1. ASCII folding / slug helpers and a canonical, unique players.slug.
--   2. A source-tier registry that encodes the ingestion source priority.
--   3. Official class-size sources for 2022, 2024 and 2025.
--   4. Metric-specific WAR provenance (player_metric_observations):
--      Baseball-Reference bWAR and FanGraphs fWAR are stored separately and
--      can never be blended or substituted. Legacy outcomes.career_war is kept
--      for backward compatibility only.
--   5. Read-only research views used by the application (signing records,
--      player directory, player dossier, timeline, provenance, class coverage,
--      research tasks, database status, filter facets).
--
-- Rules carried forward:
--   * Missing is never zero. Unknown values stay NULL.
--   * Unaudited is never failure.
--   * A class is COMPLETE only when it is declared a complete census by a source
--     AND every expected row is present.
--   * Brooklyn and Los Angeles share franchise_key DODGERS.
--   * Public-read / private-write: every new table has RLS with a select-only
--     policy; every new view is security_invoker.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 1. TEXT HELPERS
-- ===========================================================================

-- Lower-cases and strips common Latin diacritics. The two translate() argument
-- strings are kept the same length on purpose; a longer first argument would
-- delete characters instead of replacing them.
create or replace function public.disi_ascii_fold(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(
    lower(coalesce(input, '')),
    'áàâäãåāăąéèêëēėęěíìîïīįóòôöõøōőúùûüūůűñńçćčýÿšžłđ',
    'aaaaaaaaaeeeeeeeeiiiiiioooooooouuuuuuunncccyyszld'
  )
$$;

create or replace function public.disi_slugify(input text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    trim(both '-' from regexp_replace(public.disi_ascii_fold(input), '[^a-z0-9]+', '-', 'g')),
    ''
  )
$$;

-- ===========================================================================
-- 2. CANONICAL PLAYER SLUGS
-- Slugs are assigned once and are not rewritten when a name is edited, so
-- research links stay stable. Collisions get the birth year, then -2, -3 ...
-- ===========================================================================

alter table public.players
  add column if not exists slug text;

create or replace function public.disi_unique_player_slug(
  p_full_name text,
  p_birth_date date,
  p_player_id uuid
)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  base text := coalesce(public.disi_slugify(p_full_name), 'player');
  candidate text := base;
  n integer := 2;
begin
  if not exists (select 1 from public.players where slug = candidate and id <> p_player_id) then
    return candidate;
  end if;

  if p_birth_date is not null then
    candidate := base || '-' || extract(year from p_birth_date)::int;
    if not exists (select 1 from public.players where slug = candidate and id <> p_player_id) then
      return candidate;
    end if;
  end if;

  loop
    candidate := base || '-' || n;
    exit when not exists (select 1 from public.players where slug = candidate and id <> p_player_id);
    n := n + 1;
  end loop;
  return candidate;
end;
$$;

create or replace function public.players_assign_slug()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.slug is null or btrim(new.slug) = '' then
    new.slug := public.disi_unique_player_slug(new.full_name, new.birth_date, new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists players_assign_slug on public.players;
create trigger players_assign_slug
before insert or update of slug on public.players
for each row execute function public.players_assign_slug();

-- Backfill one row at a time so each assignment sees the previous ones.
do $$
declare
  r record;
begin
  for r in
    select id, full_name, birth_date
    from public.players
    where slug is null
    order by created_at, full_name, id
  loop
    update public.players
    set slug = public.disi_unique_player_slug(r.full_name, r.birth_date, r.id)
    where id = r.id;
  end loop;
end $$;

create unique index if not exists players_slug_key on public.players(slug);
alter table public.players alter column slug set not null;
alter table public.players drop constraint if exists players_slug_format_check;
alter table public.players
  add constraint players_slug_format_check
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

revoke execute on function public.disi_unique_player_slug(text, date, uuid) from public, anon, authenticated;
revoke execute on function public.players_assign_slug() from public, anon, authenticated;

-- ===========================================================================
-- 3. SOURCE TIERS (INGESTION PRIORITY)
-- Each tier states which kinds of fact it is authoritative for. A lower
-- priority number wins when two sources disagree about the same fact type.
-- ===========================================================================

create table if not exists public.source_tiers (
  tier_code text primary key,
  priority smallint not null unique,
  label text not null,
  authoritative_for text[] not null default '{}',
  not_authoritative_for text[] not null default '{}',
  notes text
);

alter table public.source_tiers enable row level security;
revoke all on table public.source_tiers from anon, authenticated;
grant select on table public.source_tiers to anon, authenticated;
drop policy if exists public_read_source_tiers on public.source_tiers;
create policy public_read_source_tiers
on public.source_tiers
for select to anon, authenticated using (true);

insert into public.source_tiers
  (tier_code, priority, label, authoritative_for, not_authoritative_for, notes)
values
('OFFICIAL_CLUB_RELEASE', 1, 'Official Dodgers / MLB club release',
 array['CLASS_MEMBERSHIP','CLASS_SIZE','CLUB_TRANSACTION'], array[]::text[],
 'Use complete class releases whenever available instead of transaction-log reconstruction.'),
('MLB_TRANSACTION_LOG', 2, 'Official MLB transaction log',
 array['SIGNING_DATE','CLASS_MEMBERSHIP_SUPPLEMENT','CLUB_TRANSACTION'], array['CLASS_SIZE'],
 'Dates and additional players. A transaction log alone does not establish a class total.'),
('MLB_PIPELINE', 3, 'MLB Pipeline international tracker / prospect profile',
 array['PROSPECT_RANK','REPORTED_BONUS','POSITION','MARKET'], array['CLASS_SIZE','LEAGUE_CENSUS'],
 'Top 30/50 trackers are prospect samples, never league signing censuses.'),
('BASEBALL_REFERENCE', 4, 'Baseball-Reference',
 array['MLB_DEBUT','MLB_OUTCOME','CAREER_BWAR','HISTORICAL_TRANSACTION'], array['CAREER_FWAR'],
 'Primary source for MLB outcomes and bWAR (Baseball-Reference WAR, also called rWAR).'),
('FANGRAPHS', 5, 'FanGraphs',
 array['CAREER_FWAR'], array['CAREER_BWAR'],
 'fWAR only. Never substituted for or blended with bWAR.'),
('MILB_MLB_PLAYER_RECORD', 6, 'MiLB / MLB player record',
 array['DEVELOPMENT_MILESTONE','MINOR_LEAGUE_PROGRESSION','BIOGRAPHY'], array['CAREER_BWAR'],
 'Minor-league and development verification.'),
('MLB_COM_REPORTING', 7, 'MLB.com news reporting',
 array['CONTEXT','REPORTED_CLASS_SIZE'], array[]::text[],
 'Club-beat and league news. Useful context; superseded by an official release for the same fact.'),
('OTHER', 9, 'Other public source',
 array['CONTEXT'], array[]::text[],
 'Unclassified sources. Review before relying on them.')
on conflict (tier_code) do update set
  priority = excluded.priority,
  label = excluded.label,
  authoritative_for = excluded.authoritative_for,
  not_authoritative_for = excluded.not_authoritative_for,
  notes = excluded.notes;

alter table public.sources
  add column if not exists source_tier text references public.source_tiers(tier_code);

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
    when p_source_type in ('DODGERS_CLASS_RELEASE', 'PRESS_RELEASE')
      or p_url ~* 'mlb\.com/(amp/)?press-release/' then 'OFFICIAL_CLUB_RELEASE'
    when p_source_type in ('DODGERS_TRANSACTION_LOG', 'TRANSACTIONS')
      or p_url ~* 'mlb\.com/[a-z]+/roster/transactions/' then 'MLB_TRANSACTION_LOG'
    when p_source_type in ('MLB_PIPELINE_TRACKER', 'INTERNATIONAL_TRACKER', 'PROSPECT_PROFILE')
      or p_url ~* 'mlb\.com/milb/prospects/' then 'MLB_PIPELINE'
    when p_url ~* '^https?://(www\.)?(mlb|milb)\.com/player/' then 'MILB_MLB_PLAYER_RECORD'
    when p_url ~* '^https?://(www\.)?mlb\.com/' then 'MLB_COM_REPORTING'
    else 'OTHER'
  end
$$;

-- ===========================================================================
-- 4. OFFICIAL CLASS-SIZE SOURCES
-- Verified 2026-10-03 against the live pages. The releases state class size
-- and composition but do not list every signee by name, so they support
-- expected_signings, not player-level class membership.
-- ===========================================================================

insert into public.sources
  (source_name, source_type, title, url, publication_date, accessed_at, notes, source_tier)
values
('MLB.com', 'DODGERS_CLASS_RELEASE', 'Dodgers announce 2025 international signings',
 'https://www.mlb.com/press-release/press-release-dodgers-announce-2025-international-signings',
 date '2025-01-28', timestamptz '2026-10-03 00:00:00+00',
 'States the Dodgers agreed to terms with 29 international amateur free agents (16 pitchers, four catchers, six infielders, three outfielders; seven countries, led by Venezuela 12, Dominican Republic 8, Mexico 4). Does not list every signee.',
 'OFFICIAL_CLUB_RELEASE'),
('MLB.com', 'DODGERS_CLASS_RELEASE', 'Dodgers announce 2024 international signings',
 'https://www.mlb.com/press-release/press-release-dodgers-announce-2024-international-signings',
 date '2024-01-16', timestamptz '2026-10-03 00:00:00+00',
 'States the Dodgers agreed to terms with 19 international amateur free agents (seven pitchers, four catchers, five infielders, three outfielders; four countries). Does not list every signee.',
 'OFFICIAL_CLUB_RELEASE'),
('MLB.com', 'ARTICLE', 'No. 7 int''l prospect leads Dodgers'' signings',
 'https://www.mlb.com/news/dodgers-2022-international-prospects',
 date '2022-01-16', timestamptz '2026-10-03 00:00:00+00',
 'MLB.com reports the club agreed to terms with 30 players in the 2022 period. News reporting, not an official club release.',
 'MLB_COM_REPORTING')
on conflict (url) do update set
  title = excluded.title,
  source_type = excluded.source_type,
  publication_date = coalesce(public.sources.publication_date, excluded.publication_date),
  notes = coalesce(public.sources.notes, excluded.notes),
  source_tier = excluded.source_tier;

-- Classify every remaining source by rule; explicit tiers are never overwritten.
update public.sources
set source_tier = public.disi_infer_source_tier(url, source_type)
where source_tier is null;

-- Point expected class sizes at the source that actually states them.
update public.signing_census_coverage c
set source_id = src.id,
    notes = v.notes,
    updated_at = now()
from (values
  (2025, 'https://www.mlb.com/press-release/press-release-dodgers-announce-2025-international-signings',
   'Official Dodgers release (2025-01-28) states 29 international amateur free agents. The release does not name every signee; DISI player-level reconstruction comes from the January 2025 transaction log and remains partial.'),
  (2024, 'https://www.mlb.com/press-release/press-release-dodgers-announce-2024-international-signings',
   'Official Dodgers release (2024-01-16) states 19 international amateur free agents. Player-level reconstruction comes from the Jan. 15, 2024 transaction log and remains partial.'),
  (2022, 'https://www.mlb.com/news/dodgers-2022-international-prospects',
   'MLB.com (2022-01-16) reports 30 signings. An official club release for the full 2022 class has not yet been registered. Player-level reconstruction comes from the Jan. 15, 2022 transaction log.')
) as v(signing_year, url, notes)
join public.sources src on src.url = v.url
join public.organizations lad on lad.abbreviation = 'LAD'
where c.organization_id = lad.id
  and c.period_start_year = v.signing_year
  and c.period_end_year = v.signing_year;

-- Keep the stored per-class tracked counts in step with the signing rows.
-- (v_dodgers_class_analysis_eligibility from 016 reads the stored value.)
update public.signing_census_coverage c
set tracked_signings = live.n,
    updated_at = now()
from (
  select c2.id, count(s.id)::int as n
  from public.signing_census_coverage c2
  join public.organizations co on co.id = c2.organization_id
  left join public.organizations so on so.franchise_key = co.franchise_key
  left join public.signings s
    on s.organization_id = so.id
   and s.signing_year = c2.period_start_year
  where c2.period_start_year = c2.period_end_year
    and c2.coverage_type in ('COMPLETE_CENSUS', 'PARTIAL_CENSUS')
  group by c2.id
) live
where live.id = c.id
  and c.tracked_signings is distinct from live.n;

-- ===========================================================================
-- 5. METRIC-SPECIFIC WAR PROVENANCE
-- ===========================================================================

create table if not exists public.player_metric_observations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  metric_key text not null check (metric_key in ('CAREER_BWAR', 'CAREER_FWAR')),
  value numeric(9,3) not null,
  observed_through_date date not null,
  observed_through_season integer check (observed_through_season between 1871 and 2100),
  source_id uuid not null references public.sources(id) on delete restrict,
  confidence public.confidence_level not null default 'VERIFIED',
  notes text,
  created_at timestamptz not null default now(),
  unique (player_id, metric_key, observed_through_date)
);

create index if not exists player_metric_observations_player_idx
  on public.player_metric_observations(player_id, metric_key, observed_through_date desc);

comment on table public.player_metric_observations is
  'Metric-specific career value observations. CAREER_BWAR = Baseball-Reference WAR; CAREER_FWAR = FanGraphs WAR. One row per player, metric and observation date so active-player totals keep their history. Never convert or blend metrics.';

alter table public.player_metric_observations enable row level security;
revoke all on table public.player_metric_observations from anon, authenticated;
grant select on table public.player_metric_observations to anon, authenticated;
drop policy if exists public_read_player_metric_observations on public.player_metric_observations;
create policy public_read_player_metric_observations
on public.player_metric_observations
for select to anon, authenticated using (true);

-- A bWAR row must cite Baseball-Reference and an fWAR row must cite FanGraphs.
create or replace function public.player_metric_observations_check_provider()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_url text;
begin
  select url into v_url from public.sources where id = new.source_id;
  if v_url is null then
    raise exception 'player_metric_observations: source % does not exist', new.source_id;
  end if;
  if new.metric_key = 'CAREER_BWAR'
     and v_url !~* '^https?://(www\.)?baseball-reference\.com/' then
    raise exception 'CAREER_BWAR must cite a Baseball-Reference source, got %', v_url;
  end if;
  if new.metric_key = 'CAREER_FWAR'
     and v_url !~* '^https?://(www\.)?fangraphs\.com/' then
    raise exception 'CAREER_FWAR must cite a FanGraphs source, got %', v_url;
  end if;
  return new;
end;
$$;

revoke execute on function public.player_metric_observations_check_provider() from public, anon, authenticated;

drop trigger if exists player_metric_observations_check_provider on public.player_metric_observations;
create trigger player_metric_observations_check_provider
before insert or update on public.player_metric_observations
for each row execute function public.player_metric_observations_check_provider();

-- Backfill bWAR from legacy outcomes.career_war ONLY where the outcome cites a
-- Baseball-Reference page. The observation date is the date the cited source
-- was accessed; the season is outcome_through_season. Values citing any other
-- source (e.g. an MLB.com player page) stay out and appear as research tasks.
insert into public.player_metric_observations (
  player_id, metric_key, value, observed_through_date, observed_through_season,
  source_id, confidence, notes
)
select
  oc.player_id,
  'CAREER_BWAR',
  oc.career_war,
  (src.accessed_at at time zone 'UTC')::date,
  oc.outcome_through_season,
  src.id,
  oc.confidence,
  'Backfilled in 017 from outcomes.career_war; the cited source is a Baseball-Reference page.'
from public.outcomes oc
join public.sources src on src.id = oc.source_id
where oc.career_war is not null
  and src.url ~* '^https?://(www\.)?baseball-reference\.com/'
on conflict (player_id, metric_key, observed_through_date) do nothing;

comment on column public.outcomes.career_war is
  'LEGACY, metric unspecified. Kept for backward compatibility with 001-016 views. Use player_metric_observations / v_player_war.career_bwar for Baseball-Reference WAR.';

create or replace view public.v_player_war
with (security_invoker = true)
as
with latest as (
  select distinct on (m.player_id, m.metric_key)
    m.player_id,
    m.metric_key,
    m.value,
    m.source_id,
    s.url as source_url,
    m.observed_through_date,
    m.observed_through_season,
    m.confidence
  from public.player_metric_observations m
  join public.sources s on s.id = m.source_id
  order by m.player_id, m.metric_key, m.observed_through_date desc, m.created_at desc
)
select
  p.id as player_id,
  b.value as career_bwar,
  b.source_id as bwar_source_id,
  b.source_url as bwar_source_url,
  b.observed_through_date as bwar_observed_through_date,
  b.observed_through_season as bwar_observed_through_season,
  f.value as career_fwar,
  f.source_id as fwar_source_id,
  f.source_url as fwar_source_url,
  f.observed_through_date as fwar_observed_through_date,
  f.observed_through_season as fwar_observed_through_season
from public.players p
left join latest b on b.player_id = p.id and b.metric_key = 'CAREER_BWAR'
left join latest f on f.player_id = p.id and f.metric_key = 'CAREER_FWAR'
where b.player_id is not null or f.player_id is not null;

-- ===========================================================================
-- 6. BACKWARD-COMPATIBLE UPDATES TO EXISTING VIEWS
-- Existing columns keep their names, types and order; bWAR columns and slugs
-- are appended. The universe now selects the Dodgers franchise (BRO + LAD).
-- ===========================================================================

create or replace view public.v_dodgers_portfolio_universe
with (security_invoker = true)
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
  oc.career_war,
  p.slug as player_slug,
  w.career_bwar,
  w.bwar_observed_through_date,
  w.bwar_observed_through_season
from public.signings s
join public.players p on p.id = s.player_id
join public.organizations o on o.id = s.organization_id
left join public.outcome_audits oa on oa.player_id = p.id
left join public.outcomes oc on oc.player_id = p.id
left join public.organizations debut on debut.id = oc.mlb_debut_organization_id
left join public.v_player_war w on w.player_id = p.id
where o.franchise_key = 'DODGERS'
order by s.signing_year, p.full_name;

create or replace view public.v_dodgers_known_mlb_outcomes
with (security_invoker = true)
as
select
  u.player_id,
  u.full_name,
  u.signing_year,
  u.signing_date,
  u.country_market,
  u.pathway,
  u.primary_position,
  u.total_known_acquisition_cost_usd,
  u.record_scope,
  u.mlb_debut_date,
  u.mlb_debut_org,
  debut_org.franchise_key as debut_franchise_key,
  (debut_org.franchise_key = 'DODGERS') as direct_dodgers_franchise_debut,
  u.career_war,
  o.current_status,
  o.outcome_through_season,
  u.player_slug,
  u.career_bwar,
  u.bwar_observed_through_date,
  u.bwar_observed_through_season
from public.v_dodgers_portfolio_universe u
join public.outcomes o on o.player_id = u.player_id
left join public.organizations debut_org on debut_org.abbreviation = u.mlb_debut_org
where u.reached_mlb_verified is true
order by u.career_bwar desc nulls last, u.signing_year;

-- ===========================================================================
-- 7. SIGNING RECORDS (one row per signing, every organization)
-- Text-typed codes so sorting is alphabetical (enum columns sort by
-- declaration order). reached_mlb_verified is NULL when not audited.
-- ===========================================================================

create or replace view public.v_signing_records
with (security_invoker = true)
as
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
  cov.coverage_type,
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
  s.notes as signing_notes
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
left join lateral (
  select c.coverage_type
  from public.signing_census_coverage c
  left join public.organizations co on co.id = c.organization_id
  where s.signing_year between c.period_start_year and c.period_end_year
    and (
      (c.organization_id is not null and co.franchise_key = o.franchise_key)
      or (c.organization_id is null and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')
    )
  order by
    (c.organization_id is null),
    case c.coverage_type
      when 'COMPLETE_CENSUS' then 1
      when 'PARTIAL_CENSUS' then 2
      when 'HISTORICAL_VERIFIED' then 3
      else 4
    end
  limit 1
) cov on true;

-- ===========================================================================
-- 8. PLAYER DIRECTORY (one row per player)
-- ===========================================================================

create or replace view public.v_player_directory
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  public.disi_ascii_fold(p.full_name) as player_sort_name,
  upper(left(public.disi_ascii_fold(p.full_name), 1)) as name_initial,
  coalesce(pa.aliases, array[]::text[]) as aliases,
  public.disi_ascii_fold(concat_ws(' ', p.full_name, p.canonical_name, array_to_string(pa.aliases, ' '))) as search_text,
  p.birth_country,
  p.nationality,
  p.primary_position,
  sg.first_signing_year,
  sg.latest_signing_year,
  (sg.first_signing_year / 10) * 10 as first_signing_decade,
  coalesce(sg.signing_count, 0) as signing_count,
  coalesce(sg.organizations, array[]::text[]) as organizations,
  coalesce(sg.has_dodgers_signing, false) as has_dodgers_signing,
  sg.first_signing_market,
  array(
    select distinct x
    from unnest(array[p.birth_country] || coalesce(sg.signing_markets, array[]::text[])) as x
    where x is not null
    order by x
  ) as countries,
  case
    when oa.player_id is null then 'NOT_AUDITED'
    when oa.reached_mlb_verified then 'VERIFIED_MLB'
    else 'VERIFIED_NO_MLB'
  end as outcome_audit_status,
  oa.reached_mlb_verified,
  oc.mlb_debut_date,
  debut.abbreviation as mlb_debut_org,
  case when debut.id is null then null else debut.franchise_key = 'DODGERS' end
    as direct_dodgers_franchise_debut,
  w.career_bwar,
  w.bwar_observed_through_season,
  oc.current_status
from public.players p
left join lateral (
  select array_agg(a.alias order by a.alias) as aliases
  from public.player_aliases a
  where a.player_id = p.id
) pa on true
left join lateral (
  select
    min(s.signing_year) as first_signing_year,
    max(s.signing_year) as latest_signing_year,
    count(*)::int as signing_count,
    array_agg(distinct o.abbreviation) filter (where o.abbreviation is not null) as organizations,
    bool_or(o.franchise_key = 'DODGERS') as has_dodgers_signing,
    array_agg(distinct s.country_market) filter (where s.country_market is not null) as signing_markets,
    (array_agg(s.country_market order by s.signing_year, s.signing_date nulls last)
      filter (where s.country_market is not null))[1] as first_signing_market
  from public.signings s
  join public.organizations o on o.id = s.organization_id
  where s.player_id = p.id
) sg on true
left join public.outcome_audits oa on oa.player_id = p.id
left join public.outcomes oc on oc.player_id = p.id
left join public.organizations debut on debut.id = oc.mlb_debut_organization_id
left join public.v_player_war w on w.player_id = p.id;

-- ===========================================================================
-- 9. PLAYER DOSSIER (biography + outcome + metric provenance)
-- ===========================================================================

create or replace view public.v_player_dossier
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  p.canonical_name,
  coalesce(pa.aliases, array[]::text[]) as aliases,
  p.birth_date,
  p.birth_city,
  p.birth_country,
  p.nationality,
  p.primary_position,
  p.secondary_positions,
  p.bats,
  p.throws,
  p.height_in,
  p.weight_lb,
  p.mlb_id,
  p.bref_id,
  p.fangraphs_id,
  case
    when oa.player_id is null then 'NOT_AUDITED'
    when oa.reached_mlb_verified then 'VERIFIED_MLB'
    else 'VERIFIED_NO_MLB'
  end as outcome_audit_status,
  oa.reached_mlb_verified,
  oa.audited_through_date,
  oa.audit_note,
  oa.confidence::text as audit_confidence,
  oc.mlb_debut_date,
  debut.abbreviation as mlb_debut_org,
  debut.name as mlb_debut_org_name,
  case when debut.id is null then null else debut.franchise_key = 'DODGERS' end
    as direct_dodgers_franchise_debut,
  oc.mlb_games,
  oc.mlb_pa,
  oc.mlb_ip,
  oc.years_of_mlb_service,
  oc.current_status,
  oc.outcome_through_season,
  (oc.current_status ilike 'ACTIVE%' or oc.current_status ilike 'REACHED_MLB_%') as is_active,
  w.career_bwar,
  w.bwar_source_id,
  w.bwar_source_url,
  w.bwar_observed_through_date,
  w.bwar_observed_through_season,
  w.career_fwar,
  w.fwar_source_id,
  w.fwar_source_url,
  w.fwar_observed_through_date,
  w.fwar_observed_through_season
from public.players p
left join lateral (
  select array_agg(a.alias order by a.alias) as aliases
  from public.player_aliases a
  where a.player_id = p.id
) pa on true
left join public.outcome_audits oa on oa.player_id = p.id
left join public.outcomes oc on oc.player_id = p.id
left join public.organizations debut on debut.id = oc.mlb_debut_organization_id
left join public.v_player_war w on w.player_id = p.id;

create or replace view public.v_player_trainers
with (security_invoker = true)
as
select
  pt.player_id,
  t.name as trainer_name,
  t.academy_name,
  t.country,
  t.city,
  pt.relationship_type,
  pt.start_date,
  pt.end_date,
  pt.confidence::text as confidence
from public.player_trainers pt
join public.trainers t on t.id = pt.trainer_id;

-- ===========================================================================
-- 10. TRANSACTIONS AND TRADE PACKAGES (package-aware)
-- The full return of a multi-player trade is shown at package level and is
-- never attributed to a single outgoing player.
-- ===========================================================================

create or replace view public.v_player_transactions
with (security_invoker = true)
as
with package as (
  select
    a.event_id,
    count(*) filter (where a.asset_side = 'OUTGOING') as outgoing_asset_count,
    count(*) filter (where a.asset_side = 'INCOMING') as incoming_asset_count,
    jsonb_agg(jsonb_build_object('name', a.asset_name, 'slug', ap.slug, 'type', a.asset_type)
              order by a.asset_name) filter (where a.asset_side = 'OUTGOING') as outgoing_assets,
    jsonb_agg(jsonb_build_object('name', a.asset_name, 'slug', ap.slug, 'type', a.asset_type)
              order by a.asset_name) filter (where a.asset_side = 'INCOMING') as incoming_assets
  from public.transaction_event_assets a
  left join public.players ap on ap.id = a.player_id
  group by a.event_id
)
select
  a.player_id,
  p.slug as player_slug,
  p.full_name,
  e.event_key,
  e.transaction_date,
  e.transaction_type,
  e.description,
  fo.abbreviation as from_organization,
  fo.franchise_key as from_franchise_key,
  tor.abbreviation as to_organization,
  a.asset_side as player_side,
  a.role_note,
  pk.outgoing_asset_count,
  pk.incoming_asset_count,
  pk.outgoing_assets,
  pk.incoming_assets,
  case
    when e.transaction_type <> 'TRADE' then null
    when pk.outgoing_asset_count = 1 then 'SOLE_OUTGOING_ASSET'
    else 'SHARED_PACKAGE_RETURN'
  end as attribution_status,
  r.incoming_asset_name as return_asset_name,
  r.dodgers_regular_season_war as return_dodgers_regular_season_bwar,
  r.world_series_roster as return_world_series_roster,
  r.observed_through_date as return_observed_through_date,
  r.valuation_note,
  c.club_wins,
  c.club_losses,
  c.division_position,
  c.division_lead_games,
  c.race_state,
  c.regular_season_games_remaining,
  c.need_category,
  c.need_urgency,
  c.acquisition_horizon,
  c.strategic_context_label,
  c.acquisition_season_postseason_result,
  c.championship_window,
  src.url as source_url,
  src.title as source_title,
  'PACKAGE_EVENT' as record_kind
from public.transaction_event_assets a
join public.transaction_events e on e.id = a.event_id
join public.players p on p.id = a.player_id
left join package pk on pk.event_id = e.id
left join public.organizations fo on fo.id = e.from_organization_id
left join public.organizations tor on tor.id = e.to_organization_id
left join public.transaction_return_metrics r on r.event_id = e.id
left join public.transaction_competitive_context c on c.event_id = e.id
left join public.sources src on src.id = coalesce(a.source_id, e.source_id)
where a.player_id is not null

union all

-- Legacy single-player transaction rows that have no package-level event.
select
  t.player_id,
  p.slug,
  p.full_name,
  null,
  t.transaction_date,
  t.transaction_type,
  t.return_description,
  fo.abbreviation,
  fo.franchise_key,
  tor.abbreviation,
  'OUTGOING',
  t.notes,
  null, null, null, null,
  null,
  null, null, null, null, null,
  null, null, null, null, null, null, null, null, null, null, null, null,
  src.url,
  src.title,
  'TRANSACTION'
from public.transactions t
join public.players p on p.id = t.player_id
left join public.organizations fo on fo.id = t.from_organization_id
left join public.organizations tor on tor.id = t.to_organization_id
left join public.sources src on src.id = t.source_id
where not exists (
  select 1
  from public.transaction_event_assets a
  join public.transaction_events e on e.id = a.event_id
  where a.player_id = t.player_id
    and e.transaction_date = t.transaction_date
);

-- ===========================================================================
-- 11. PLAYER TIMELINE
-- signing -> development milestones -> transactions -> MLB debut -> later
-- outcomes. date_precision is DAY when an exact date is known, else YEAR.
-- ===========================================================================

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
      then 'bonus $' || to_char(s.signing_bonus_usd, 'FM999,999,999,990') end
  ) as detail,
  o.abbreviation as organization,
  ev.url as source_url,
  ev.title as source_title
from public.signings s
join public.organizations o on o.id = s.organization_id
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

-- ===========================================================================
-- 12. PLAYER PROVENANCE (every source attached to a player's facts)
-- ===========================================================================

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

-- ===========================================================================
-- 13. CLASS-LEVEL RESEARCH COVERAGE (one row per franchise and signing year)
-- tracked counts are always computed live from signings.
-- ===========================================================================

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
declarations as (
  select
    co.franchise_key,
    y.signing_year,
    c.coverage_type,
    c.period_start_year,
    c.period_end_year,
    case when c.period_start_year = c.period_end_year then c.expected_signings end as expected_class_size,
    c.source_id,
    c.notes,
    row_number() over (
      partition by co.franchise_key, y.signing_year
      order by
        (c.period_start_year = c.period_end_year) desc,
        case c.coverage_type
          when 'COMPLETE_CENSUS' then 1
          when 'PARTIAL_CENSUS' then 2
          when 'HISTORICAL_VERIFIED' then 3
          else 4
        end
    ) as rn
  from public.signing_census_coverage c
  join public.organizations co on co.id = c.organization_id
  cross join lateral generate_series(c.period_start_year, c.period_end_year) as y(signing_year)
  where co.franchise_key is not null
),
best as (
  select * from declarations where rn = 1
),
years as (
  select franchise_key, signing_year from tracked
  union
  select franchise_key, signing_year from best where expected_class_size is not null
),
base as (
  select
    y.franchise_key,
    y.signing_year,
    b.coverage_type as coverage_declaration,
    case when b.period_start_year is null then null
         when b.period_start_year = b.period_end_year then b.period_start_year::text
         else b.period_start_year || '–' || b.period_end_year end as declaration_period,
    b.expected_class_size,
    src.title as expected_size_source_title,
    src.url as expected_size_source_url,
    src.publication_date as expected_size_source_published,
    case when b.expected_class_size is null then null
         else coalesce(src.source_tier, public.disi_infer_source_tier(src.url, src.source_type)) end
      as expected_size_source_tier,
    b.notes as coverage_notes,
    coalesce(t.tracked_class_size, 0) as tracked_class_size,
    coalesce(t.known_bonus_count, 0) as known_bonus_count,
    coalesce(t.known_cost_count, 0) as known_cost_count,
    coalesce(t.outcome_audit_count, 0) as outcome_audit_count,
    coalesce(t.verified_mlb_count, 0) as verified_mlb_count,
    coalesce(t.bwar_count, 0) as bwar_count,
    coalesce(t.mlb_missing_bwar_count, 0) as mlb_missing_bwar_count,
    coalesce(t.missing_signing_date_count, 0) as missing_signing_date_count,
    coalesce(t.missing_market_count, 0) as missing_market_count
  from years y
  left join tracked t on t.franchise_key = y.franchise_key and t.signing_year = y.signing_year
  left join best b on b.franchise_key = y.franchise_key and b.signing_year = y.signing_year
  left join public.sources src on src.id = b.source_id
)
select
  base.*,
  case when expected_class_size > 0
    then round(tracked_class_size::numeric / expected_class_size, 4) end as coverage_rate,
  case when expected_class_size is not null
    then greatest(expected_class_size - tracked_class_size, 0) end as missing_from_expected,
  (expected_class_size is not null
    and expected_size_source_tier is distinct from 'OFFICIAL_CLUB_RELEASE') as needs_official_size_source,
  tracked_class_size - outcome_audit_count as outcome_audit_queue,
  case
    when expected_class_size is null and coverage_declaration = 'HISTORICAL_VERIFIED'
      then 'VERIFIED_SAMPLE_POPULATION_UNKNOWN'
    when expected_class_size is null then 'POPULATION_UNKNOWN'
    when coverage_declaration = 'COMPLETE_CENSUS' and tracked_class_size >= expected_class_size
      then 'COMPLETE'
    when coverage_declaration = 'COMPLETE_CENSUS' then 'DECLARED_COMPLETE_ROWS_MISSING'
    else 'PARTIAL'
  end as class_status,
  coalesce(greatest(expected_class_size - tracked_class_size, 0), 0)
    + (tracked_class_size - outcome_audit_count)
    + mlb_missing_bwar_count
    + case when expected_class_size is not null
             and expected_size_source_tier is distinct from 'OFFICIAL_CLUB_RELEASE' then 1 else 0 end
    as research_queue_items
from base;

-- ===========================================================================
-- 14. RESEARCH TASKS (player- and class-level work queue)
-- A task is missing research, never a negative outcome.
-- ===========================================================================

create or replace view public.v_research_tasks
with (security_invoker = true)
as
select
  'OUTCOME_AUDIT' as task_type,
  case
    when r.signing_year <= extract(year from current_date)::int - 10 then 100
    when r.signing_year <= extract(year from current_date)::int - 5 then 70
    else 30
  end
  + case
      when r.total_known_acquisition_cost_usd >= 5000000 then 25
      when r.total_known_acquisition_cost_usd >= 1000000 then 15
      when r.total_known_acquisition_cost_usd >= 250000 then 8
      else 0
    end as priority,
  r.franchise_key,
  r.signing_year,
  r.player_id,
  r.player_slug,
  r.full_name,
  case
    when r.signing_year <= extract(year from current_date)::int - 10
      then 'Long-mature signing: MLB reach should be resolvable from historical records.'
    when r.signing_year <= extract(year from current_date)::int - 5
      then 'Five-year-mature signing: audit MLB reach and disposition.'
    else 'Recent signing: development status may still be evolving.'
  end as detail
from public.v_signing_records r
where not r.outcome_audited

union all

select
  'BWAR_MISSING', 90, r.franchise_key, r.signing_year, r.player_id, r.player_slug, r.full_name,
  case when oc.career_war is not null
    then 'Verified MLB player. Legacy WAR value (' || oc.career_war
         || ') does not cite Baseball-Reference, so it is not shown as bWAR.'
    else 'Verified MLB player with no Baseball-Reference bWAR observation.' end
from public.v_signing_records r
left join public.outcomes oc on oc.player_id = r.player_id
where r.reached_mlb_verified is true and r.career_bwar is null

union all

select
  'SIGNING_DATE_MISSING', 20, r.franchise_key, r.signing_year, r.player_id, r.player_slug, r.full_name,
  'Exact signing date unknown; use the official transaction log.'
from public.v_signing_records r
where r.signing_date is null

union all

select
  'MARKET_MISSING', 25, r.franchise_key, r.signing_year, r.player_id, r.player_slug, r.full_name,
  'Signing country / market unknown.'
from public.v_signing_records r
where r.country_market is null

union all

select
  'ACQUISITION_COST_UNKNOWN', 10, r.franchise_key, r.signing_year, r.player_id, r.player_slug, r.full_name,
  'No signing bonus, posting fee or transfer fee is recorded. Unknown, not $0.'
from public.v_signing_records r
where r.total_known_acquisition_cost_usd is null

union all

select
  'CLASS_MEMBERS_MISSING', 95, c.franchise_key, c.signing_year, null, null, null,
  c.missing_from_expected || ' of ' || c.expected_class_size
    || ' expected signees are not yet in the database.'
from public.v_class_research_coverage c
where c.missing_from_expected > 0

union all

select
  'CLASS_SIZE_SOURCE_NOT_OFFICIAL', 60, c.franchise_key, c.signing_year, null, null, null,
  'Expected class size (' || c.expected_class_size || ') is supported by '
    || coalesce(c.expected_size_source_tier, 'no source')
    || '; register the official club release.'
from public.v_class_research_coverage c
where c.needs_official_size_source;

-- ===========================================================================
-- 15. DATABASE STATUS (homepage)
-- Reports counts only. No reach rate is computed here; rates are available
-- only through the 016 rate-eligibility views.
-- ===========================================================================

create or replace view public.v_database_status
with (security_invoker = true)
as
with d as (
  select * from public.v_signing_records where is_dodgers_franchise
),
c as (
  select * from public.v_class_research_coverage where franchise_key = 'DODGERS'
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
  (select count(*) from public.v_signing_records where not is_dodgers_franchise)::int as league_signing_records;

-- ===========================================================================
-- 16. MARKET / PATHWAY SUMMARIES (full franchise universe, bWAR only)
-- ===========================================================================

create or replace view public.v_market_research_summary
with (security_invoker = true)
as
select
  franchise_key,
  country_market,
  count(*)::int as tracked_signings,
  count(*) filter (where total_known_acquisition_cost_usd is not null)::int as known_cost_count,
  round(sum(total_known_acquisition_cost_usd)::numeric, 2) as known_acquisition_cost_usd,
  count(*) filter (where outcome_audited)::int as audited_outcomes,
  count(*) filter (where outcome_audit_status = 'VERIFIED_MLB')::int as verified_mlb_players,
  count(*) filter (where outcome_audit_status = 'VERIFIED_NO_MLB')::int as verified_no_mlb,
  count(*) filter (where not outcome_audited)::int as not_audited,
  count(career_bwar)::int as players_with_bwar,
  round(sum(career_bwar)::numeric, 1) as observed_career_bwar
from public.v_signing_records
group by franchise_key, country_market;

create or replace view public.v_pathway_research_summary
with (security_invoker = true)
as
select
  franchise_key,
  pathway,
  count(*)::int as tracked_signings,
  count(*) filter (where total_known_acquisition_cost_usd is not null)::int as known_cost_count,
  round(sum(total_known_acquisition_cost_usd)::numeric, 2) as known_acquisition_cost_usd,
  count(*) filter (where outcome_audited)::int as audited_outcomes,
  count(*) filter (where outcome_audit_status = 'VERIFIED_MLB')::int as verified_mlb_players,
  count(*) filter (where outcome_audit_status = 'VERIFIED_NO_MLB')::int as verified_no_mlb,
  count(*) filter (where not outcome_audited)::int as not_audited,
  count(career_bwar)::int as players_with_bwar,
  round(sum(career_bwar)::numeric, 1) as observed_career_bwar
from public.v_signing_records
group by franchise_key, pathway;

-- ===========================================================================
-- 17. FILTER FACETS
-- Lets the UI build filter menus without downloading every row.
-- ===========================================================================

create or replace view public.v_signing_filter_options
with (security_invoker = true)
as
select facet, value, is_dodgers_franchise, count(*)::int as row_count
from (
  select 'country_market' as facet, country_market as value, is_dodgers_franchise from public.v_signing_records
  union all select 'primary_position', primary_position, is_dodgers_franchise from public.v_signing_records
  union all select 'pathway', pathway, is_dodgers_franchise from public.v_signing_records
  union all select 'record_scope', record_scope, is_dodgers_franchise from public.v_signing_records
  union all select 'coverage_type', coverage_type, is_dodgers_franchise from public.v_signing_records
  union all select 'outcome_audit_status', outcome_audit_status, is_dodgers_franchise from public.v_signing_records
  union all select 'organization', organization, is_dodgers_franchise from public.v_signing_records
  union all select 'signing_year', signing_year::text, is_dodgers_franchise from public.v_signing_records
) f
group by facet, value, is_dodgers_franchise;

create or replace view public.v_player_filter_options
with (security_invoker = true)
as
select facet, value, count(*)::int as row_count
from (
  select 'country' as facet, unnest(countries) as value from public.v_player_directory
  union all select 'primary_position', primary_position from public.v_player_directory
  union all select 'first_signing_decade', first_signing_decade::text from public.v_player_directory
  union all select 'name_initial', name_initial from public.v_player_directory
  union all select 'outcome_audit_status', outcome_audit_status from public.v_player_directory
) f
group by facet, value;

-- ===========================================================================
-- 18. GRANTS (select only; views run with the caller's privileges)
-- ===========================================================================

do $$
declare
  v text;
begin
  foreach v in array array[
    'v_player_war',
    'v_dodgers_portfolio_universe',
    'v_dodgers_known_mlb_outcomes',
    'v_signing_records',
    'v_player_directory',
    'v_player_dossier',
    'v_player_trainers',
    'v_player_transactions',
    'v_player_timeline',
    'v_player_sources',
    'v_class_research_coverage',
    'v_research_tasks',
    'v_database_status',
    'v_market_research_summary',
    'v_pathway_research_summary',
    'v_signing_filter_options',
    'v_player_filter_options'
  ]
  loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to anon, authenticated', v);
  end loop;
end $$;

commit;

-- ===========================================================================
-- 19. VERIFICATION (read-only)
-- ===========================================================================

select * from public.v_database_status;

select signing_year, coverage_declaration, expected_class_size, tracked_class_size,
       coverage_rate, class_status, expected_size_source_tier, research_queue_items
from public.v_class_research_coverage
where franchise_key = 'DODGERS'
order by signing_year;

select count(*) as bwar_observations,
       count(*) filter (where o.career_war is distinct from m.value) as mismatched_with_legacy
from public.player_metric_observations m
join public.outcomes o on o.player_id = m.player_id
where m.metric_key = 'CAREER_BWAR';
