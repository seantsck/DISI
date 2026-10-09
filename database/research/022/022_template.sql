-- DISI v0.13
-- 022_player_development_exact_dates.sql
-- Exact development dates from game-level evidence. Run after 021.
--
-- Built from reviewed research artifacts (database/research/022/), produced by
-- scripts/mlb/player-game-logs.mjs, development-exact-dates.mjs and
-- development-date-sql-values.mjs against the official MLB Stats API gameLog
-- endpoint. Retrieved 2026-10-06.
--
-- What this does:
--   * Upgrades supported SEASON-precision debut milestones to DAY with the
--     player's actual first appearance date, in place — never as a duplicate
--     row. The replaced season-level evidence basis is preserved in the new
--     prior_evidence_basis column, and the season remains structurally present
--     (season_year).
--   * Populates player_season_stints.first_game_date / last_game_date with the
--     player's verified first/last appearance for that specific stint
--     (player / team / league / level / season), with game_date_basis =
--     GAME_LOG and the gameLog endpoint cited in source_urls.
--   * Adds PROFESSIONAL_DEBUT milestones (exact evidence only; no season-only
--     rows are invented) and re-derives FIRST_DODGERS_MLB_APPEARANCE from the
--     now-dated MLB stints.
--   * Extends the research queue with date-coverage issues and adds
--     v_dodgers_development_date_coverage.
--
-- Rules (identical in spirit to 021, now with dated evidence):
--   * A dated entry in the official gameLog endpoint with a stat block is a
--     recorded appearance. Roster lists, transactions, promotions, options,
--     assignments and team schedules are never appearances.
--   * A SEASON milestone is upgraded only when the earliest game-verified
--     appearance at its level falls in the milestone's own season_year — game
--     logs that begin later cannot prove what came before them.
--   * Existing exact dates are never overwritten; a disagreeing game-log date
--     becomes a research_source_conflicts row (EXACT_DATE_CONFLICT).
--   * Foreign professional leagues stay FOREIGN_PRO in every era; game-level
--     classification reuses the 021 taxonomy unchanged.
--   * Stints in seasons the gameLog does not cover (pre-2006, gaps) keep NULL
--     dates and SEASON milestones — unknown, never invented, never zero.
--   * Every statement is idempotent: rerunning changes nothing.
--
-- Rerunnable.

begin;

-- ===========================================================================
-- 1. SCHEMA ADDITION: prior evidence basis for upgraded milestones
-- ===========================================================================
-- development_milestones carries a single evidence_basis value, so upgrading a
-- season-precision milestone to an exact date would otherwise erase the
-- provenance that the earlier evidence was season-level. The prior basis is
-- preserved explicitly; the season itself stays in season_year.

alter table public.development_milestones add column if not exists prior_evidence_basis text;

comment on column public.development_milestones.prior_evidence_basis is
  'The evidence basis this milestone had before migration 022 upgraded it to an exact game-log date (e.g. SEASON_SPLITS). Null for milestones never upgraded. The season-level fact stays structurally present in season_year.';

-- ===========================================================================
-- 2. REVIEWED RESEARCH DATA (scripts/mlb/development-date-sql-values.mjs output)
-- ===========================================================================

create temporary table _m022_players (id uuid, slug text, mlb_id bigint, birth_date date) on commit drop;
insert into _m022_players
select p.id, p.slug, p.mlb_id, p.birth_date
from public.players p;

create temporary table _m022_orgs (id uuid, name text) on commit drop;
insert into _m022_orgs select o.id, o.name from public.organizations o;

-- ---- milestone upgrades (SEASON -> DAY) -----------------------------------
create temporary table _m022_upgrades (
  slug text, mlb_id bigint, event_code text, milestone_date date,
  prior_evidence_basis text, prior_date_precision text, season_year int,
  note text, source_url text, retrieved_at timestamptz, as_of_date date
) on commit drop;

-- values inserted here by the 022 research pipeline (an empty block arrives
-- as a single NULL sentinel row; the joins and where clauses below drop it)
insert into _m022_upgrades
values
{{upgrades}};

-- ---- stint first/last appearance dates ------------------------------------
create temporary table _m022_stint_dates (
  slug text, mlb_id bigint, season int, affiliate_team text, league_name text,
  level text, first_game_date date, last_game_date date, game_date_basis text,
  source_url text, retrieved_at timestamptz, as_of_date date
) on commit drop;

insert into _m022_stint_dates
values
{{stint_dates}};

-- ---- new exact milestones (PROFESSIONAL_DEBUT) ----------------------------
create temporary table _m022_new_milestones (
  slug text, mlb_id bigint, event_code text, event_date date, season_year int,
  organization_name text, level text, evidence_basis text, note text,
  as_of_date date, source_url text, retrieved_at timestamptz
) on commit drop;

insert into _m022_new_milestones
values
{{new_milestones}};

-- ---- conflicts (existing exact dates that disagree with game evidence) ----
create temporary table _m022_conflicts (
  slug text, conflict_type text, field_name text, value_a text, value_b text,
  note text, as_of_date date
) on commit drop;

insert into _m022_conflicts
values
{{conflicts}};

-- ---- sources referenced by the rows above ---------------------------------
create temporary table _m022_sources (url text, retrieved_at timestamptz) on commit drop;

insert into _m022_sources
values
{{sources}};

-- ===========================================================================
-- 3. SOURCES (gameLog endpoints cited by the rows below)
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, accessed_at, notes, source_tier)
select
  'MLB Stats API',
  'MLB_GAME_LOG',
  'MLB Stats API: gameLog appearance endpoint',
  v.url,
  coalesce(v.retrieved_at, now()),
  'Referenced by migration 022 (exact development dates).',
  public.disi_infer_source_tier(v.url, null)
from _m022_sources v
where v.url is not null
on conflict (url) do nothing;

-- ===========================================================================
-- 4. MILESTONE UPGRADES (SEASON -> DAY, in place, guarded)
-- ===========================================================================
-- The values only contain upgrades whose game-log evidence falls in the
-- milestone's own reviewed season. The update additionally requires the stored
-- row to still be SEASON with a null date, so an already-exact milestone is
-- never overwritten and a rerun is a no-op. The replaced season-level basis is
-- preserved in prior_evidence_basis; season_year keeps the season.

update public.development_milestones m
set milestone_date = u.milestone_date,
    date_precision = 'DAY'::public.date_precision,
    season_year = u.season_year,
    evidence_basis = 'GAME_LOG',
    prior_evidence_basis = coalesce(m.evidence_basis, u.prior_evidence_basis),
    age_at_milestone = public.disi_age_decimal(pl.birth_date, u.milestone_date),
    as_of_date = greatest(coalesce(m.as_of_date, u.as_of_date), u.as_of_date),
    notes = u.note
from _m022_upgrades u
join _m022_players pl on pl.slug = u.slug
where m.player_id = pl.id
  and m.event_code = u.event_code
  and m.date_precision = 'SEASON'
  and m.milestone_date is null
  and (m.season_year = u.season_year or m.season_year is null);

-- ===========================================================================
-- 5. NEW EXACT MILESTONES (PROFESSIONAL_DEBUT, exact evidence only)
-- ===========================================================================
-- No season-only PROFESSIONAL_DEBUT rows are invented: 021's debut milestones
-- already carry the season-level facts, and a first professional game without
-- a dated record stays unknown.

-- 021 typed PROFESSIONAL_SIGNING rows with the generic 'OTHER' milestone type
-- (its uses_milestone_type was null), although 001's enum already contains the
-- dedicated 'SIGNED' value for exactly that fact. 022 makes the first
-- professional GAME a dated milestone too (PROFESSIONAL_DEBUT, which the 021
-- map types 'OTHER'), and two 'OTHER' rows of the same day — a player who
-- signed and debuted the same day — would collide under 001's unique
-- (player_id, milestone, milestone_date). The signing moves to 'SIGNED': the
-- enum value exists, is unused, and names the fact honestly. Existing rows move
-- with the map, so the correction is complete and rerun-safe.
insert into public.development_event_codes (event_code, description, uses_milestone_type)
values ('PROFESSIONAL_SIGNING', 'First professional contract with any club (dated signing record).', 'SIGNED'::public.milestone_type)
on conflict (event_code) do update
set uses_milestone_type = excluded.uses_milestone_type;

update public.development_milestones
set milestone = 'SIGNED'::public.milestone_type
where event_code = 'PROFESSIONAL_SIGNING'
  and milestone <> 'SIGNED'::public.milestone_type;

insert into public.development_milestones (
  player_id, milestone, milestone_date, age_at_milestone,
  organization_id, affiliate, notes, source_id, confidence,
  event_code, date_precision, season_year, evidence_basis, as_of_date
)
select
  pl.id,
  coalesce(ec.uses_milestone_type, 'OTHER'::public.milestone_type),
  nm.event_date,
  public.disi_age_decimal(pl.birth_date, nm.event_date),
  org.id,
  nm.organization_name,
  nm.note,
  src.id,
  'HIGH'::public.confidence_level,
  nm.event_code,
  'DAY'::public.date_precision,
  nm.season_year,
  nm.evidence_basis,
  nm.as_of_date
from _m022_new_milestones nm
join _m022_players pl on pl.slug = nm.slug
left join public.development_event_codes ec on ec.event_code = nm.event_code
left join _m022_orgs org on org.name = nm.organization_name
left join public.sources src on src.url = nm.source_url
where nm.event_date is not null
on conflict do nothing;

-- ===========================================================================
-- 6. CONFLICTS (existing exact dates that disagree with game evidence)
-- ===========================================================================
-- A disagreeing game-log date never overwrites an existing exact date: the
-- conflict is recorded instead, and the research queue keeps it visible.

alter table public.research_source_conflicts drop constraint if exists research_source_conflicts_conflict_type_check;
alter table public.research_source_conflicts add constraint research_source_conflicts_conflict_type_check
  check (conflict_type in ('NAME_SPELLING','POSITION','BIRTH_COUNTRY','COUNTRY_MARKET','CLASS_MEMBERSHIP',
    'POPULATION_COUNT','PERIOD_ASSIGNMENT','POPULATION_DEFINITION','OUTCOME','IDENTITY',
    'STINT_EXCLUDED_BY_REVIEW','GAME_DATES_CONFLICT','EXACT_DATE_CONFLICT'));

insert into public.research_source_conflicts (conflict_key, conflict_type, player_id, field_name, value_a, value_b, status, note)
select
  'DEV022:' || c.conflict_type || ':' || c.slug || ':' || c.field_name || ':' || coalesce(c.value_a, '') || ':' || coalesce(c.value_b, ''),
  c.conflict_type, pl.id, c.field_name, c.value_a, c.value_b, 'UNRESOLVED', c.note
from _m022_conflicts c
join _m022_players pl on pl.slug = c.slug
where c.slug is not null
on conflict (conflict_key) do nothing;

-- ===========================================================================
-- 7. STINT FIRST/LAST APPEARANCE DATES
-- ===========================================================================
-- Only for the specific stint (player / team / league / level / season) the
-- games belong to; multi-team, multi-level and multi-organization seasons stay
-- separate. NULL dates are filled; an existing date is never overwritten. The
-- gameLog endpoint is appended to source_urls.

update public.player_season_stints s
set first_game_date = d.first_game_date,
    last_game_date = d.last_game_date,
    game_date_basis = d.game_date_basis,
    source_urls = case
      when d.source_url is null then s.source_urls
      when s.source_urls @> to_jsonb(array[d.source_url]) then s.source_urls
      else coalesce(s.source_urls, '[]'::jsonb) || to_jsonb(array[d.source_url])
    end
from _m022_stint_dates d
join _m022_players pl on pl.slug = d.slug
where s.player_id = pl.id
  and s.season = d.season
  and coalesce(s.affiliate_team, '') = coalesce(d.affiliate_team, '')
  and coalesce(s.league_name, '') = coalesce(d.league_name, '')
  and s.level::text = d.level
  and s.first_game_date is null
  and d.first_game_date is not null;

-- ===========================================================================
-- 8. DERIVED MILESTONE EDGES (first Dodgers MLB appearance when different)
-- ===========================================================================
-- Same derivation as 021, now fed by the game-log-dated MLB stints; the
-- evidence basis reflects that the date is game-verified.

insert into public.development_milestones (
  player_id, milestone, milestone_date, age_at_milestone,
  organization_id, affiliate, notes, confidence,
  event_code, date_precision, season_year, evidence_basis, as_of_date
)
select distinct
  mlb.player_id,
  'MLB_DEBUT'::public.milestone_type,
  dodgers.first_date,
  public.disi_age_decimal(pl.birth_date, dodgers.first_date),
  dodgers.org_id,
  dodgers.org_name,
  'First MLB appearance with the Dodgers franchise' ||
    case when dodgers.first_date is distinct from mlb.milestone_date then ' (different from the recorded MLB debut date)' else '' end,
  'HIGH'::public.confidence_level,
  'FIRST_DODGERS_MLB_APPEARANCE',
  'DAY'::public.date_precision,
  extract(year from dodgers.first_date)::int,
  'GAME_LOG',
  greatest(mlb.as_of_date, coalesce(dodgers.as_of, mlb.as_of_date))
from (
  select s.player_id, min(s.first_game_date) as first_date, min(s.as_of_date) as as_of,
         (array_agg(s.organization_id order by s.first_game_date))[1] as org_id,
         (array_agg(s.affiliate_team order by s.first_game_date))[1] as org_name
  from public.player_season_stints s
  join public.organizations o on o.id = s.organization_id
  where s.level = 'MLB' and s.affiliated and s.first_game_date is not null
    and o.franchise_key = 'DODGERS'
  group by s.player_id
) dodgers
join public.development_milestones mlb
  on mlb.player_id = dodgers.player_id and mlb.event_code = 'MLB_DEBUT'
join public.players pl on pl.id = dodgers.player_id
where dodgers.first_date is distinct from mlb.milestone_date
on conflict do nothing;

-- ===========================================================================
-- 9. VIEWS (extended, not duplicated)
-- ===========================================================================

-- 9a. Player development summary: the 021 view with the exact-date metrics
-- added. Existing columns keep their names and order; the new elapsed columns
-- are exact-date only (both endpoints DAY precision), exactly like their
-- existing siblings. Season-based approximations stay separate.
create or replace view public.v_dodgers_player_development_summary
with (security_invoker = true)
as
select
  p.id as player_id,
  p.slug as player_slug,
  p.full_name,
  p.birth_date,
  p.mlb_id,
  sg.signing_year,
  sg.signing_date,
  public.disi_age_years(p.birth_date, sg.signing_date) as age_at_signing,
  signing_m.milestone_date as professional_signing_date,
  pro_deb.milestone_date as professional_debut_date_exact,
  pro_deb.season_year as professional_debut_season,
  dsl.milestone_date as first_dsl_date,
  dsl.season_year as first_dsl_season,
  complex_m.milestone_date as first_complex_date,
  complex_m.season_year as first_complex_season,
  a_m.milestone_date as first_a_date,
  a_m.season_year as first_a_season,
  high_a.milestone_date as first_high_a_date,
  high_a.season_year as first_high_a_season,
  aa.milestone_date as first_aa_date,
  aa.season_year as first_aa_season,
  aaa.milestone_date as first_aaa_date,
  aaa.season_year as first_aaa_season,
  mlb.milestone_date as mlb_debut_date,
  mlb.season_year as mlb_debut_season,
  public.disi_age_years(p.birth_date, a_m.milestone_date) as age_at_first_a_exact,
  public.disi_age_years(p.birth_date, high_a.milestone_date) as age_at_first_high_a_exact,
  public.disi_age_years(p.birth_date, aa.milestone_date) as age_at_first_aa_exact,
  public.disi_age_years(p.birth_date, aaa.milestone_date) as age_at_first_aaa_exact,
  public.disi_age_years(p.birth_date, mlb.milestone_date) as age_at_mlb_debut_exact,
  -- Season-based approximations, clearly labelled. From first stints at the
  -- level (mid-year convention: age as of the season after the first stint).
  case when a_m.season_year is not null and p.birth_date is not null
       then a_m.season_year - extract(year from p.birth_date)::int end as approx_age_at_first_a,
  case when aa.season_year is not null and p.birth_date is not null
       then aa.season_year - extract(year from p.birth_date)::int end as approx_age_at_first_aa,
  case when mlb.season_year is not null and p.birth_date is not null
       then mlb.season_year - extract(year from p.birth_date)::int end as approx_age_at_mlb_debut,
  -- Elapsed times, exact only where both endpoint dates exist.
  public.disi_development_days(sg.signing_date, pro_deb.milestone_date) as days_signing_to_pro_debut_exact,
  public.disi_development_days(sg.signing_date, a_m.milestone_date) as days_signing_to_a_exact,
  public.disi_development_days(sg.signing_date, aa.milestone_date) as days_signing_to_aa_exact,
  public.disi_development_days(sg.signing_date, aaa.milestone_date) as days_signing_to_aaa_exact,
  public.disi_development_days(sg.signing_date, mlb.milestone_date) as days_signing_to_mlb_exact,
  public.disi_development_years(sg.signing_date, aa.milestone_date) as years_signing_to_aa_exact,
  public.disi_development_years(sg.signing_date, mlb.milestone_date) as years_signing_to_mlb_exact,
  public.disi_development_days(a_m.milestone_date, aa.milestone_date) as days_a_to_aa_exact,
  public.disi_development_days(aa.milestone_date, aaa.milestone_date) as days_aa_to_aaa_exact,
  public.disi_development_days(aaa.milestone_date, mlb.milestone_date) as days_aaa_to_mlb_exact,
  -- Season-based approximations (labelled; NOT exact elapsed time).
  case when sg.signing_date is not null and a_m.season_year is not null
       then a_m.season_year - extract(year from sg.signing_date)::int end as approx_years_signing_to_a,
  case when sg.signing_date is not null and aa.season_year is not null
       then aa.season_year - extract(year from sg.signing_date)::int end as approx_years_signing_to_aa,
  case when sg.signing_date is not null and mlb.season_year is not null
       then mlb.season_year - extract(year from sg.signing_date)::int end as approx_years_signing_to_mlb,
  ds.status as current_development_status,
  ds.status_season as current_development_season,
  ds.note as development_status_note,
  highest.level as highest_affiliated_level,
  highest.highest_season as highest_affiliated_season,
  org_changes.organization_count,
  oa.reached_mlb_verified,
  -- 022 additions. Appended at the end: create or replace view may extend a
  -- view with new columns but may not insert or reorder existing ones.
  public.disi_development_days(sg.signing_date, high_a.milestone_date) as days_signing_to_high_a_exact,
  public.disi_development_years(sg.signing_date, high_a.milestone_date) as years_signing_to_high_a_exact,
  public.disi_development_days(a_m.milestone_date, high_a.milestone_date) as days_a_to_high_a_exact,
  public.disi_development_days(high_a.milestone_date, aa.milestone_date) as days_high_a_to_aa_exact
from public.players p
left join public.signings sg on sg.player_id = p.id
left join lateral (
  select d.milestone_date from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'PROFESSIONAL_SIGNING' and d.milestone_date is not null
  order by d.milestone_date limit 1
) signing_m on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'PROFESSIONAL_DEBUT'
) pro_deb on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'DSL_DEBUT'
) dsl on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'COMPLEX_DEBUT'
) complex_m on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'A_DEBUT'
) a_m on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'HIGH_A_DEBUT'
) high_a on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'AA_DEBUT'
) aa on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'AAA_DEBUT'
) aaa on true
left join lateral (
  select min(d.milestone_date) as milestone_date, min(d.season_year) as season_year
  from public.development_milestones d
  where d.player_id = p.id and d.event_code = 'MLB_DEBUT'
) mlb on true
left join public.player_development_status ds on ds.player_id = p.id
left join lateral (
  select dls.level, max(dls.season) as highest_season
  from public.player_season_stints dls
  where dls.player_id = p.id and dls.affiliated
  group by dls.level, dls.level_rank
  order by coalesce(dls.level_rank, 0) desc
  limit 1
) highest on true
left join lateral (
  select count(distinct s.organization_id)::int as organization_count
  from public.player_season_stints s
  where s.player_id = p.id and s.organization_id is not null
) org_changes on true
left join public.outcome_audits oa on oa.player_id = p.id;

-- 9b. Development date coverage: how much of the progression is exact versus
-- season-only, and where conflicts remain. Informational; missing exact dates
-- are coverage gaps, never failures.
create or replace view public.v_dodgers_development_date_coverage
with (security_invoker = true)
as
select
  count(*)::int as tracked_players,
  count(*) filter (where d.professional_debut_date_exact is not null)::int as exact_pro_debut,
  count(*) filter (where d.first_dsl_date is not null)::int as exact_dsl_debut,
  count(*) filter (where d.first_complex_date is not null)::int as exact_complex_debut,
  count(*) filter (where d.first_a_date is not null)::int as exact_first_a,
  count(*) filter (where d.first_high_a_date is not null)::int as exact_first_high_a,
  count(*) filter (where d.first_aa_date is not null)::int as exact_first_aa,
  count(*) filter (where d.first_aaa_date is not null)::int as exact_first_aaa,
  count(*) filter (where d.mlb_debut_date is not null)::int as exact_mlb_debut,
  count(*) filter (where d.days_signing_to_pro_debut_exact is not null)::int as exact_signing_to_pro_debut,
  count(*) filter (where d.days_signing_to_a_exact is not null)::int as exact_signing_to_a,
  count(*) filter (where d.days_signing_to_high_a_exact is not null)::int as exact_signing_to_high_a,
  count(*) filter (where d.days_signing_to_aa_exact is not null)::int as exact_signing_to_aa,
  count(*) filter (where d.days_signing_to_aaa_exact is not null)::int as exact_signing_to_aaa,
  count(*) filter (where d.days_signing_to_mlb_exact is not null)::int as exact_signing_to_mlb,
  count(*) filter (where d.first_dsl_season is not null and d.first_dsl_date is null)::int as season_only_dsl_debut,
  count(*) filter (where d.first_complex_season is not null and d.first_complex_date is null)::int as season_only_complex_debut,
  count(*) filter (where d.first_a_season is not null and d.first_a_date is null)::int as season_only_first_a,
  count(*) filter (where d.first_high_a_season is not null and d.first_high_a_date is null)::int as season_only_first_high_a,
  count(*) filter (where d.first_aa_season is not null and d.first_aa_date is null)::int as season_only_first_aa,
  count(*) filter (where d.first_aaa_season is not null and d.first_aaa_date is null)::int as season_only_first_aaa,
  count(*) filter (where conf.unresolved_date_conflicts > 0)::int as players_with_unresolved_date_conflicts
from public.v_dodgers_player_development_summary d
left join lateral (
  select count(*)::int as unresolved_date_conflicts
  from public.research_source_conflicts c
  where c.player_id = d.player_id and c.conflict_type = 'EXACT_DATE_CONFLICT' and c.status = 'UNRESOLVED'
) conf on true;

-- 9c. Research queue: 021 issues plus the date-coverage issues. Missing exact
-- dates are coverage gaps to review, never failures and never negative
-- outcomes; the detail text says so.
create or replace view public.v_dodgers_development_research_queue
with (security_invoker = true)
as
with base as (
  select
    p.id as player_id,
    p.slug as player_slug,
    p.full_name,
    p.mlb_id,
    sg.signing_year,
    (select max(s.as_of_date) from public.player_season_stints s where s.player_id = p.id) as last_research_date,
    (select count(*)::int from public.player_season_stints s where s.player_id = p.id) as stint_count,
    exists (select 1 from public.player_season_stints s where s.player_id = p.id) as has_stints,
    exists (
      select 1 from public.player_season_stints s
      where s.player_id = p.id and s.level_classification in ('UNRECOGNIZED_SPORT','UNKNOWN_ROOKIE_LEAGUE')
    ) as has_unknown_level,
    exists (
      select 1 from public.player_season_stints s
      where s.player_id = p.id and s.organization_id is null
    ) as has_unresolved_organization,
    exists (
      select 1 from public.player_season_stints s1
      join public.player_season_stints s2
        on s2.player_id = s1.player_id and s2.season = s1.season
       and s2.id > s1.id
      where s1.player_id = p.id
        and s1.organization_id is not null and s2.organization_id is not null
        and s1.organization_id <> s2.organization_id
    ) as has_multi_org_season,
    exists (
      select 1 from public.development_milestones m
      where m.player_id = p.id and m.event_code = 'MLB_DEBUT'
    ) as has_mlb_milestone,
    not exists (
      select 1 from public.player_season_stints s
      where s.player_id = p.id and s.level <> 'MLB'
    ) as no_pre_mlb_history,
    -- 022 date-coverage facts
    exists (
      select 1 from public.player_season_stints s
      where s.player_id = p.id and s.season >= 2006 and s.first_game_date is null
    ) as has_undated_log_era_stint,
    exists (
      select 1 from public.player_season_stints s
      where s.player_id = p.id and s.season >= 2006 and s.last_game_date is null
    ) as has_stint_missing_last_date,
    exists (
      select 1 from public.player_season_stints s
      where s.player_id = p.id and s.season >= 2006 and s.first_game_date is not null
    ) as has_any_dated_stint,
    exists (
      select 1 from public.player_season_stints s
      where s.player_id = p.id and s.level_classification in ('UNKNOWN_ROOKIE_LEAGUE','UNRECOGNIZED_SPORT')
        and s.season >= 2006 and s.first_game_date is null
    ) as has_unknown_level_undated,
    exists (
      select 1 from public.development_milestones m
      where m.player_id = p.id and m.date_precision = 'SEASON'
        and m.event_code in ('DSL_DEBUT','COMPLEX_DEBUT','A_DEBUT','HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT')
    ) as has_season_only_debut_milestone,
    exists (
      select 1 from public.development_milestones m
      where m.player_id = p.id and m.date_precision = 'DAY'
        and m.event_code in ('A_DEBUT','HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT')
    ) as has_exact_level_debut_milestone,
    exists (
      select 1 from public.research_source_conflicts c
      where c.player_id = p.id and c.conflict_type = 'EXACT_DATE_CONFLICT' and c.status = 'UNRESOLVED'
    ) as has_exact_date_conflict,
    exists (
      select 1 from public.player_season_stints s
      where s.player_id = p.id and s.level <> 'MLB' and s.affiliated
    ) as has_pre_mlb_history
  from public.players p
  left join public.signings sg on sg.player_id = p.id
  join public.organizations o on o.id = sg.organization_id
  where o.franchise_key = 'DODGERS'
)
select
  player_id, player_slug, full_name, mlb_id, signing_year,
  issue, priority, detail
from base,
lateral (
  select * from (values
    ('IDENTITY_BUT_NO_PROFESSIONAL_SEASONS', 3,
      'Resolved identity (MLB id); the season-splits query ran and returned no structured season rows'),
    ('SEASON_GAP', 2,
      'Stints have a gap of at least two seasons between first and last'),
    ('UNKNOWN_LEVEL_CLASSIFICATION', 2,
      'A stint could not be classified into the canonical level taxonomy'),
    ('UNRESOLVED_ORGANIZATION', 2,
      'A stint has no organization resolved from its team/league/season'),
    ('MULTI_ORG_SEASON_UNVERIFIED', 1,
      'Two organizations appear in the same season; verify the trade date'),
    ('MLB_PLAYER_MISSING_PRE_MLB_HISTORY', 1,
      'Reached MLB but no pre-MLB development record was found'),
    ('LEVEL_CONFLICT', 1,
      'Source-level label and canonical classification disagree; review the stint'),
    ('MISSING_FIRST_GAME_DATE', 3,
      'A log-era stint (2006+) has no verified first appearance date yet; a coverage gap, not a failure'),
    ('MISSING_LAST_GAME_DATE', 3,
      'A log-era stint (2006+) has no verified last appearance date yet; a coverage gap, not a failure'),
    ('SEASON_ONLY_MILESTONE', 2,
      'A level debut stays season-precision; game-log evidence did not cover its first season'),
    ('GAME_LOG_UNAVAILABLE', 3,
      'Log-era stints exist but none carry game-verified dates; the gameLog queries returned nothing for this player'),
    ('EXACT_DATE_CONFLICT', 1,
      'Game-log evidence disagrees with an existing exact date; the stored value was kept and the conflict recorded'),
    ('MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES', 2,
      'Reached MLB with pre-MLB stints, but no level-debut milestone carries an exact date yet'),
    ('UNKNOWN_LEVEL_GAME_LOG', 2,
      'A stint with an unclassified level has no dated appearances; game dates cannot be attributed to it')
  ) as v(issue, priority, detail)
) issues
where (issue = 'IDENTITY_BUT_NO_PROFESSIONAL_SEASONS' and mlb_id is not null and not has_stints)
   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2
       and (select max(s.season) - min(s.season) from public.player_season_stints s where s.player_id = player_id) + 1 > stint_count)
   or (issue = 'UNKNOWN_LEVEL_CLASSIFICATION' and has_unknown_level)
   or (issue = 'UNRESOLVED_ORGANIZATION' and has_unresolved_organization)
   or (issue = 'MULTI_ORG_SEASON_UNVERIFIED' and has_multi_org_season)
   or (issue = 'MLB_PLAYER_MISSING_PRE_MLB_HISTORY' and has_mlb_milestone and no_pre_mlb_history)
   or (issue = 'MISSING_FIRST_GAME_DATE' and has_undated_log_era_stint)
   or (issue = 'MISSING_LAST_GAME_DATE' and has_stint_missing_last_date)
   or (issue = 'SEASON_ONLY_MILESTONE' and has_season_only_debut_milestone)
   or (issue = 'GAME_LOG_UNAVAILABLE' and has_stints and has_undated_log_era_stint and not has_any_dated_stint)
   or (issue = 'EXACT_DATE_CONFLICT' and has_exact_date_conflict)
   or (issue = 'MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES' and has_mlb_milestone and has_pre_mlb_history
       and not has_exact_level_debut_milestone)
   or (issue = 'UNKNOWN_LEVEL_GAME_LOG' and has_unknown_level_undated);

-- ===========================================================================
-- 10. GRANTS
-- ===========================================================================

grant select on public.v_dodgers_player_development_summary to anon, authenticated;
grant select on public.v_player_development_stints to anon, authenticated;
grant select on public.v_player_development_milestones to anon, authenticated;
grant select on public.v_dodgers_development_by_signing_class to anon, authenticated;
grant select on public.v_dodgers_development_by_market to anon, authenticated;
grant select on public.v_dodgers_development_by_bonus_band to anon, authenticated;
grant select on public.v_dodgers_development_research_queue to anon, authenticated;
grant select on public.v_dodgers_development_coverage to anon, authenticated;
grant select on public.v_dodgers_development_date_coverage to anon, authenticated;

commit;
