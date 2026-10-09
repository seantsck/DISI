-- DISI v0.12
-- 021_player_development_history.sql
-- Reproducible development-history dataset for the tracked DISI player
-- population, beginning with Dodgers international signings. Run after 020.
--
-- Built from reviewed research artifacts (database/research/021/), produced by
-- scripts/mlb/player-seasons.mjs, player-game-levels.mjs,
-- development-milestones.mjs and development-sql-values.mjs against the MLB
-- Stats API season/transaction records. Retrieved 2026-10-05 / 2026-10-06.
--
-- What this adds:
--   * canonical level taxonomy (development_levels) with era mapping
--     (development_level_era_map); original source labels are preserved beside
--     the canonical classification, never replaced by it.
--   * player_season_stints: one row per player/team/league/level/season. A
--     season with several affiliates, levels or organizations is several rows;
--     it is never collapsed into one.
--   * extended development_milestones (new event types, date precision,
--     evidence). One milestone per player/event/date. Dates exist only where a
--     dated record supports them; SEASON-precision events carry the season and
--     never a fabricated day. Unknown is not "not reached".
--   * derived development metrics (milestone ages, elapsed days/years) that
--     require both endpoint dates, exposed separately from season-based
--     approximations.
--   * canonical current development status (development_status) as a research
--     classification, never a prospect grade and never an outcome.
--   * security-invoker views for the dossier, /development and analytics.
--
-- Rules:
--   * The Mexican League is outside affiliated minor-league progression for
--     DISI development analysis (correction introduced in 019, kept here): it
--     is FOREIGN_PRO at every point in history, even though the MLB Stats API
--     filed it under the Triple-A sport id before 2021. NPB, KBO, Cuban
--     professional and other established foreign leagues are likewise never
--     forced into MLB minor-league levels.
--   * Stint organization ownership is per stint, so development survives
--     trades: Dodgers identification, Dodgers development and development
--     after leaving the Dodgers stay distinguishable.
--   * Provenance is per row: source endpoint(s), retrieval timestamp, as-of
--     date. Primary-source records are never overwritten by secondary sources;
--     disagreements become research_source_conflicts rows.
--   * Every statement is idempotent: rerunning changes nothing.
--
-- Rerunnable.

begin;

-- ===========================================================================
-- 1. CANONICAL LEVEL TAXONOMY
-- ===========================================================================

do $$ begin
  create type public.development_level as enum (
    'INTERNATIONAL_ROOKIE',
    'COMPLEX_ROOKIE',
    'LOW_A',
    'A',
    'HIGH_A',
    'AA',
    'AAA',
    'MLB',
    'INDEPENDENT',
    'FOREIGN_PRO',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.development_era as enum (
    'PRE_1960',
    'PRE_ACADEMY_1960_1988',
    'CLASSIC_AFFILIATED_1989_2016',
    'DSL_AZL_2017_2020',
    'MODERN_FOUR_LEVEL_2021_PLUS'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.date_precision as enum ('DAY', 'SEASON');
exception when duplicate_object then null;
end $$;

-- Canonical levels with their progression rank. Affiliated levels have a rank;
-- everything outside affiliated progression does not, so no ordering is
-- implied between, say, NPB and Triple-A. A is kept as a legacy alias of
-- LOW_A so older source labels never need rewriting.
create table if not exists public.development_levels (
  level public.development_level primary key,
  label text not null,
  progression_rank int,
  affiliated boolean not null,
  notes text
);
insert into public.development_levels (level, label, progression_rank, affiliated, notes) values
  ('INTERNATIONAL_ROOKIE', 'International rookie (DSL-type)', 1, true, null),
  ('COMPLEX_ROOKIE', 'Complex rookie (ACL/FCL-type)', 2, true, null),
  ('LOW_A', 'Low-A / Single-A', 3, true, 'Single-A; "A" is kept as a legacy alias'),
  ('A', 'Low-A / Single-A (legacy label)', 3, true, 'Legacy alias of LOW_A'),
  ('HIGH_A', 'High-A', 4, true, null),
  ('AA', 'Double-A', 5, true, null),
  ('AAA', 'Triple-A', 6, true, null),
  ('MLB', 'Major League Baseball', 7, true, null),
  ('INDEPENDENT', 'Independent professional', null, false, null),
  ('FOREIGN_PRO', 'Established foreign professional league', null, false,
    'Mexican League, NPB, KBO, Cuban professional and similar. Never an affiliated minor-league level, whatever the source label says.'),
  ('OTHER', 'Other / unclassified professional', null, false, null)
on conflict (level) do update
set label = excluded.label,
    progression_rank = excluded.progression_rank,
    affiliated = excluded.affiliated,
    notes = excluded.notes;

-- Historical-era handling: an explicit mapping table, not an assumption that
-- eras are identical. Each row says which source-era labels classify as which
-- canonical level, and the era the mapping applies to.
create table if not exists public.development_level_era_map (
  id uuid primary key default gen_random_uuid(),
  era public.development_era not null,
  source_label text not null,
  maps_to public.development_level not null,
  note text,
  unique (era, source_label, maps_to)
);
insert into public.development_level_era_map (era, source_label, maps_to, note) values
  ('MODERN_FOUR_LEVEL_2021_PLUS', 'Dominican Summer League', 'INTERNATIONAL_ROOKIE', null),
  ('MODERN_FOUR_LEVEL_2021_PLUS', 'Arizona Complex League', 'COMPLEX_ROOKIE', null),
  ('MODERN_FOUR_LEVEL_2021_PLUS', 'Florida Complex League', 'COMPLEX_ROOKIE', null),
  ('DSL_AZL_2017_2020', 'Dominican Summer League', 'INTERNATIONAL_ROOKIE', null),
  ('DSL_AZL_2017_2020', 'Arizona League', 'COMPLEX_ROOKIE', 'the AZL became the ACL in 2021'),
  ('DSL_AZL_2017_2020', 'Arizona Complex League', 'COMPLEX_ROOKIE', null),
  ('DSL_AZL_2017_2020', 'Gulf Coast League', 'COMPLEX_ROOKIE', null),
  ('DSL_AZL_2017_2020', 'Florida Complex League', 'COMPLEX_ROOKIE', null),
  ('CLASSIC_AFFILIATED_1989_2016', 'Dominican Summer League', 'INTERNATIONAL_ROOKIE', null),
  ('CLASSIC_AFFILIATED_1989_2016', 'Arizona League', 'COMPLEX_ROOKIE', null),
  ('CLASSIC_AFFILIATED_1989_2016', 'Gulf Coast League', 'COMPLEX_ROOKIE', null),
  ('CLASSIC_AFFILIATED_1989_2016', 'Pioneer League', 'OTHER', 'rookie-advanced; complex-league equivalent only after reclassification'),
  ('CLASSIC_AFFILIATED_1989_2016', 'Mexican League', 'FOREIGN_PRO',
    'A member league of Triple-A in structure, never part of MLB affiliated development. This row keeps the 019 correction explicit for the era in which the MLB Stats API labelled it Triple-A.'),
  ('PRE_ACADEMY_1960_1988', 'Mexican League', 'FOREIGN_PRO', null),
  ('PRE_1960', 'Mexican League', 'FOREIGN_PRO', null)
on conflict (era, source_label, maps_to) do update
set note = excluded.note;

comment on table public.development_levels is
  'Canonical development levels. Source-level labels are preserved beside the canonical classification on every stint; this table only defines the vocabulary.';
comment on table public.development_level_era_map is
  'Era-aware mapping from original source labels to canonical levels. Eras are NOT assumed identical: 1950s minors, 1980s academies, DSL/ACL and the four-level system each map separately.';

-- ===========================================================================
-- 2. PLAYER / TEAM / LEVEL / SEASON STINTS
-- ===========================================================================

-- One row per player/organization/team/league/level/season. A player who plays
-- for multiple affiliates, levels or organizations in one season gets one row
-- per stint; a player-season is never one row when the underlying record is
-- not. The legacy performance_seasons table keeps its shape (migrations 001-020
-- are immutable); development research reads this table.
create table if not exists public.player_season_stints (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  season int not null check (season between 1900 and 2100),
  organization_id uuid references public.organizations(id) on delete set null,
  organization_name text,
  affiliate_team text,
  team_id bigint,
  league_name text,
  source_level text not null,
  level public.development_level not null,
  level_classification text not null,
  era public.development_era not null,
  first_game_date date,
  last_game_date date,
  game_date_basis text check (game_date_basis in ('GAME_LOG','GAME_LOG_CONFLICT')),
  age_during_season int check (age_during_season between 15 and 50),
  level_rank int,
  affiliated boolean not null,

  -- batting (never filled from pitching data)
  g int, pa int, ab int, h int, b2 int, b3 int, hr int,
  bb int, so int, sb int, cs int,
  avg numeric(7,4), obp numeric(7,4), slg numeric(7,4), ops numeric(7,4),

  -- pitching (never filled from batting data)
  pg int, gs int,
  ip numeric(8,4), bf int,
  h_allowed int, r int, er int, hr_allowed int,
  pbb int, pso int,
  era_ numeric(8,3), whip numeric(8,3),

  -- derived rates, only where the denominator exists (NULL otherwise)
  batter_k_pct numeric(7,4), batter_bb_pct numeric(7,4),
  pitcher_k_pct numeric(7,4), pitcher_bb_pct numeric(7,4),
  pitcher_k_minus_bb_pct numeric(7,4),

  -- provenance
  detail jsonb,
  source_urls jsonb,
  source_id uuid references public.sources(id) on delete set null,
  as_of_date date not null,
  retrieved_at timestamptz,
  created_at timestamptz not null default now()
);

-- No duplicate player/team/league/level/season stints. coalesce() makes the
-- rare rows whose source records no team/league name (NULL) collidable, so a
-- rerun updates in place instead of inserting duplicates.
create unique index if not exists player_season_stints_stint_key
  on public.player_season_stints
  (player_id, season, coalesce(affiliate_team, ''), coalesce(league_name, ''), level);

create index if not exists player_season_stints_player_idx on public.player_season_stints(player_id, season);
create index if not exists player_season_stints_level_idx on public.player_season_stints(level, season);
create index if not exists player_season_stints_org_idx on public.player_season_stints(organization_id);

comment on table public.player_season_stints is
  'Development history as stints: one row per player/team/league/level/season. Multiple affiliates, levels or organizations within a season are multiple rows. Hitter fields are never filled for pitcher stints or vice versa. Unknown is NULL.';
comment on column public.player_season_stints.source_level is
  'The level label exactly as the source recorded it (ROK, A(Adv), AAA, ...), preserved even when the canonical level differs.';
comment on column public.player_season_stints.affiliate_team is
  'Team name exactly as the source recorded it; NULL where the source records no team. organization_id / organization_name carry the parent club, resolved per season so post-trade stints stay attributed correctly.';
comment on column public.player_season_stints.first_game_date is
  'First game at this level, only where a dated game-level record supports it. A season split alone is NOT a date.';
comment on column public.player_season_stints.ip is
  'Innings pitched in decimal thirds (37.2 = 37 2/3 = 37.6667).';

-- ===========================================================================
-- 3. DEVELOPMENT MILESTONES (extends the 001 table in place)
-- ===========================================================================

alter table public.development_milestones add column if not exists event_code text;
alter table public.development_milestones add column if not exists date_precision public.date_precision;
alter table public.development_milestones add column if not exists season_year int;
alter table public.development_milestones add column if not exists evidence_basis text;
alter table public.development_milestones add column if not exists as_of_date date;
alter table public.development_milestones add column if not exists created_at timestamptz not null default now();

-- New event types beyond the 001 enum (which migrations 001-020 may not touch):
-- PROFESSIONAL_SIGNING and ORGANIZATION_CHANGE. DEBUT events use the existing
-- milestone enum values with event_code mirroring them.
create table if not exists public.development_event_codes (
  event_code text primary key,
  description text not null,
  uses_milestone_type public.milestone_type
);
insert into public.development_event_codes (event_code, description, uses_milestone_type) values
  ('PROFESSIONAL_SIGNING', 'First professional contract with any club (dated signing record).', null),
  ('PROFESSIONAL_DEBUT', 'First professional game; dated only where a record carries the date.', 'OTHER'),
  ('DSL_DEBUT', 'First DSL / international rookie league appearance.', 'DSL_DEBUT'),
  ('COMPLEX_DEBUT', 'First Arizona / Florida complex-league appearance.', 'COMPLEX_DEBUT'),
  ('A_DEBUT', 'First Low-A / Single-A appearance.', 'A_DEBUT'),
  ('HIGH_A_DEBUT', 'First High-A appearance.', 'HIGH_A_DEBUT'),
  ('AA_DEBUT', 'First Double-A appearance.', 'AA_DEBUT'),
  ('AAA_DEBUT', 'First Triple-A appearance.', 'AAA_DEBUT'),
  ('MLB_DEBUT', 'First MLB appearance.', 'MLB_DEBUT'),
  ('FIRST_DODGERS_MLB_APPEARANCE', 'First MLB appearance for the Dodgers franchise, when different from the MLB debut.', 'MLB_DEBUT'),
  ('ORGANIZATION_CHANGE', 'Development continued under a different organization.', 'TRADED'),
  ('RELEASED', 'Released by the organization (dated transaction).', 'RELEASED'),
  ('RETIRED', 'Retirement (dated transaction only).', 'RETIRED'),
  ('FINAL_AFFILIATED_APPEARANCE', 'Final verified affiliated appearance where play has verifiably ended.', 'OTHER')
on conflict (event_code) do update
set description = excluded.description,
    uses_milestone_type = excluded.uses_milestone_type;

comment on column public.development_milestones.event_code is
  'Canonical event vocabulary for 021 milestones (see development_event_codes). The legacy milestone enum is untouched; both are populated so 001-020 views keep working.';
comment on column public.development_milestones.date_precision is
  'DAY: an exact dated record exists. SEASON: only the season is evidenced; milestone_date stays NULL (no fabricated January 1).';
comment on column public.development_milestones.evidence_basis is
  'Which kind of record produced this milestone (SIGNING_RECORD, SEASON_SPLITS, MLB_PERSON_RECORD, MLB_TRANSACTION_LOG).';

-- One milestone per player/event/date (source): the 001 unique constraint is
-- (player_id, milestone, milestone_date). Event-code rows keep the same rule
-- through this index, treating a NULL date as its own distinct precision.
create unique index if not exists development_milestones_player_event_date_idx
  on public.development_milestones (player_id, event_code, coalesce(milestone_date, '9999-12-31'::date), coalesce(season_year, 0));

create index if not exists development_milestones_event_idx
  on public.development_milestones(event_code);

-- ===========================================================================
-- 4. CURRENT DEVELOPMENT STATUS (research classification, not a grade)
-- ===========================================================================

do $$ begin
  create type public.development_status as enum (
    'NOT_YET_DEBUTED',
    'ROOKIE_LEVEL',
    'A_BALL',
    'HIGH_A',
    'AA',
    'AAA',
    'MLB',
    'FOREIGN_PRO',
    'OUT_OF_AFFILIATED_BASEBALL',
    'UNKNOWN'
  );
exception when duplicate_object then null;
end $$;

-- Current development state per player, derived from stints (never a prospect
-- grade, never an outcome). OUT_OF_AFFILIATED_BASEBALL does not mean failure
-- and ROOKIE_LEVEL does not mean lesser: lower-level status is information,
-- not judgement.
create table if not exists public.player_development_status (
  player_id uuid primary key references public.players(id) on delete cascade,
  status public.development_status not null,
  basis text not null check (basis in ('STINTS','AUDITED_OUTCOME','NO_RECORDS')),
  status_season int,
  as_of_date date not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists player_development_status_status_idx on public.player_development_status(status);

comment on table public.player_development_status is
  'Current development state as a research classification. Not a prospect grade, not a career outcome; a lower level is not a failure verdict.';

-- ===========================================================================
-- 5. REVIEWED RESEARCH DATA (scripts/mlb/development-sql-values.mjs output)
-- ===========================================================================

-- Player slug -> id (the research artifacts key on slugs).
create temporary table _m021_players (id uuid, slug text, mlb_id bigint, birth_date date, has_mlb_id boolean) on commit drop;
insert into _m021_players
select p.id, p.slug, p.mlb_id, p.birth_date, p.mlb_id is not null
from public.players p;

create temporary table _m021_orgs (id uuid, name text) on commit drop;
insert into _m021_orgs select o.id, o.name from public.organizations o;

-- ---- stints -------------------------------------------------------------
create temporary table _m021_stints (
  slug text, mlb_id bigint, season int, organization_name text, affiliate_team text,
  team_id bigint, league_name text, source_level text, level text,
  level_classification text, era text, first_game_date date, last_game_date date,
  game_date_basis text, age_during_season int, level_rank int, affiliated boolean,
  g int, pa int, ab int, h int, b2 int, b3 int, hr int, bb int, so int, sb int, cs int,
  avg numeric, obp numeric, slg numeric, ops numeric,
  pg int, gs int, ip numeric, bf int, h_allowed int, r int, er int, hr_allowed int,
  pbb int, pso int, era_ numeric, whip numeric,
  batter_k_pct numeric, batter_bb_pct numeric,
  pitcher_k_pct numeric, pitcher_bb_pct numeric, pitcher_k_minus_bb_pct numeric,
  detail jsonb, as_of_date date, retrieved_at timestamptz, source_urls jsonb
) on commit drop;

-- values inserted here by the 021 research pipeline (an empty block arrives
-- as a single NULL sentinel row; the joins and where clauses below drop it)
insert into _m021_stints
values
{{stints}};

-- ---- milestones ---------------------------------------------------------
create temporary table _m021_milestones (
  slug text, mlb_id bigint, event_code text, event_date date, date_precision text,
  season_year int, organization_name text, level text, evidence_basis text,
  note text, as_of_date date
) on commit drop;

insert into _m021_milestones
values
{{milestones}};

-- ---- conflicts ----------------------------------------------------------
create temporary table _m021_conflicts (
  slug text, conflict_type text, description text, as_of_date date, note text
) on commit drop;

insert into _m021_conflicts
values
{{conflicts}};

-- ---- sources ------------------------------------------------------------
create temporary table _m021_sources (url text, retrieved_at timestamptz) on commit drop;

insert into _m021_sources
values
{{sources}};

-- Source rows referenced by the stint and milestone rows below (deduped by
-- url; a source already registered by 019/020 keeps its existing metadata).
-- Must run before the stint apply so source_id resolves.
insert into public.sources (source_name, source_type, title, url, accessed_at, notes, source_tier)
select
  case when v.url like 'disi:%' then 'DISI research records' else 'MLB Stats API' end,
  case
    when v.url like '%stats?stats=yearByYear%' then 'MLB_SEASON_SPLITS'
    when v.url like 'https://statsapi.mlb.com/api/v1/stat-types/yearByYear%' then 'MLB_SEASON_SPLITS'
    when v.url like 'https://statsapi.mlb.com/api/v1/people%' then 'MLB_PERSON_RECORD'
    when v.url like 'https://statsapi.mlb.com/api/v1/transactions%' then 'MLB_TRANSACTION_LOG'
    when v.url = 'disi:signings.signing_date' then 'SIGNING_RECORD'
    else 'MLB_STATS_API'
  end,
  case
    when v.url like '%stats?stats=yearByYear%' then 'MLB Stats API: yearByYear season splits'
    when v.url like 'https://statsapi.mlb.com/api/v1/stat-types/yearByYear%' then 'MLB Stats API: yearByYear season splits'
    when v.url ~ '^https://statsapi\.mlb\.com/api/v1/people/[0-9]+$' then 'MLB Stats API: player record'
    when v.url = 'https://statsapi.mlb.com/api/v1/people' then 'MLB Stats API: people endpoint'
    when v.url like 'https://statsapi.mlb.com/api/v1/transactions%' then 'MLB Stats API: transaction log'
    when v.url = 'disi:signings.signing_date' then 'DISI signings table (recorded signing date)'
    else v.url
  end,
  v.url,
  coalesce(v.retrieved_at, now()),
  'Referenced by migration 021 (player development history).',
  public.disi_infer_source_tier(v.url, null)
from _m021_sources v
where v.url is not null
on conflict (url) do nothing;

-- ===========================================================================
-- 6. APPLY STINTS
-- ===========================================================================

insert into public.player_season_stints (
  player_id, season, organization_id, organization_name, affiliate_team, team_id,
  league_name, source_level, level, level_classification, era,
  first_game_date, last_game_date, game_date_basis, age_during_season, level_rank, affiliated,
  g, pa, ab, h, b2, b3, hr, bb, so, sb, cs, avg, obp, slg, ops,
  pg, gs, ip, bf, h_allowed, r, er, hr_allowed, pbb, pso, era_, whip,
  batter_k_pct, batter_bb_pct, pitcher_k_pct, pitcher_bb_pct, pitcher_k_minus_bb_pct,
  detail, source_urls, source_id, as_of_date, retrieved_at
)
select
  pl.id, s.season, org.id, s.organization_name, s.affiliate_team, s.team_id,
  s.league_name, s.source_level, s.level::public.development_level,
  s.level_classification, s.era::public.development_era,
  s.first_game_date, s.last_game_date, s.game_date_basis, s.age_during_season,
  s.level_rank, s.affiliated,
  s.g, s.pa, s.ab, s.h, s.b2, s.b3, s.hr, s.bb, s.so, s.sb, s.cs, s.avg, s.obp, s.slg, s.ops,
  s.pg, s.gs, s.ip, s.bf, s.h_allowed, s.r, s.er, s.hr_allowed, s.pbb, s.pso, s.era_, s.whip,
  s.batter_k_pct, s.batter_bb_pct, s.pitcher_k_pct, s.pitcher_bb_pct, s.pitcher_k_minus_bb_pct,
  s.detail, s.source_urls,
  src.id, s.as_of_date, s.retrieved_at
from _m021_stints s
join _m021_players pl on pl.slug = s.slug
left join _m021_orgs org on org.name = s.organization_name
left join public.sources src on src.url = (s.source_urls ->> 0)
on conflict (player_id, season, (coalesce(affiliate_team, '')), (coalesce(league_name, '')), level) do update
set organization_id = excluded.organization_id,
    organization_name = excluded.organization_name,
    team_id = excluded.team_id,
    source_level = excluded.source_level,
    level_classification = excluded.level_classification,
    era = excluded.era,
    first_game_date = excluded.first_game_date,
    last_game_date = excluded.last_game_date,
    game_date_basis = excluded.game_date_basis,
    age_during_season = excluded.age_during_season,
    level_rank = excluded.level_rank,
    affiliated = excluded.affiliated,
    g = excluded.g, pa = excluded.pa, ab = excluded.ab, h = excluded.h,
    b2 = excluded.b2, b3 = excluded.b3, hr = excluded.hr, bb = excluded.bb,
    so = excluded.so, sb = excluded.sb, cs = excluded.cs,
    avg = excluded.avg, obp = excluded.obp, slg = excluded.slg, ops = excluded.ops,
    pg = excluded.pg, gs = excluded.gs, ip = excluded.ip, bf = excluded.bf,
    h_allowed = excluded.h_allowed, r = excluded.r, er = excluded.er,
    hr_allowed = excluded.hr_allowed, pbb = excluded.pbb, pso = excluded.pso,
    era_ = excluded.era_, whip = excluded.whip,
    batter_k_pct = excluded.batter_k_pct, batter_bb_pct = excluded.batter_bb_pct,
    pitcher_k_pct = excluded.pitcher_k_pct, pitcher_bb_pct = excluded.pitcher_bb_pct,
    pitcher_k_minus_bb_pct = excluded.pitcher_k_minus_bb_pct,
    detail = excluded.detail, source_urls = excluded.source_urls,
    source_id = excluded.source_id, as_of_date = excluded.as_of_date,
    retrieved_at = excluded.retrieved_at;

-- ===========================================================================
-- 7. APPLY MILESTONES
-- ===========================================================================

-- Legacy 003 MLB debut rows predate the event_code vocabulary. Tag them so the
-- event_code-keyed summary views see them; a pipeline row for the same
-- player/date then conflicts cleanly on the 001 unique key.
update public.development_milestones
set event_code = 'MLB_DEBUT',
    date_precision = 'DAY',
    season_year = extract(year from milestone_date)::int,
    evidence_basis = 'LEGACY_OUTCOME_AUDIT'
where event_code is null
  and milestone = 'MLB_DEBUT'
  and milestone_date is not null;

-- MLB_DEBUT first-Dodgers-variant is derived after the base rows land.
insert into public.development_milestones (
  player_id, milestone, milestone_date, age_at_milestone,
  organization_id, affiliate, notes, source_id, confidence,
  event_code, date_precision, season_year, evidence_basis, as_of_date
)
select
  pl.id,
  coalesce(ec.uses_milestone_type, 'OTHER'::public.milestone_type),
  m.event_date,
  public.disi_age_decimal(pl.birth_date, m.event_date),
  org.id,
  m.organization_name,
  m.note,
  null::uuid,
  case when m.evidence_basis in ('SIGNING_RECORD','MLB_PERSON_RECORD','MLB_TRANSACTION_LOG') then 'VERIFIED'::public.confidence_level else 'HIGH' end,
  m.event_code,
  m.date_precision::public.date_precision,
  m.season_year,
  m.evidence_basis,
  m.as_of_date
from _m021_milestones m
join _m021_players pl on pl.slug = m.slug
left join public.development_event_codes ec on ec.event_code = m.event_code
left join _m021_orgs org on org.name = m.organization_name
where m.event_date is not null or m.date_precision = 'SEASON'
on conflict do nothing;

-- One milestone per player/event/date/source: two reviewed rows for the same
-- player/event/date collapse on the expression unique index, and the
-- disagreement is recorded here for review. Detection is purely within the
-- reviewed artifact, so a rerun can never manufacture conflicts out of rows
-- the previous run already applied.
insert into public.research_source_conflicts (conflict_key, player_id, field_name, conflict_type, value_a, value_b, resolution)
select
  'DEV-MILESTONE-' || pl.slug || '-' || m.event_code || '-' || coalesce(m.event_date::text, m.season_year::text),
  pl.id, 'development_milestone.' || m.event_code, 'PERIOD_ASSIGNMENT',
  min(m.note), 'duplicate milestone candidate for the same event/date', null
from _m021_milestones m
join _m021_players pl on pl.slug = m.slug
group by pl.id, pl.slug, m.event_code, coalesce(m.event_date::text, m.season_year::text)
having count(*) > 1
on conflict (conflict_key) do nothing;

-- Reviewed research conflicts (a person-excluded stint, disagreeing game
-- dates). The conflict_type whitelist is extended, matching the 019 pattern,
-- rather than the reviewed values being mangled into unrelated types.
alter table public.research_source_conflicts drop constraint if exists research_source_conflicts_conflict_type_check;
alter table public.research_source_conflicts add constraint research_source_conflicts_conflict_type_check
  check (conflict_type in ('NAME_SPELLING','POSITION','BIRTH_COUNTRY','COUNTRY_MARKET','CLASS_MEMBERSHIP',
    'POPULATION_COUNT','PERIOD_ASSIGNMENT','POPULATION_DEFINITION','OUTCOME','IDENTITY',
    'STINT_EXCLUDED_BY_REVIEW','GAME_DATES_CONFLICT'));

insert into public.research_source_conflicts (conflict_key, conflict_type, player_id, field_name, value_a, status, note)
select
  'DEV021:' || c.conflict_type || ':' || c.slug || ':' || c.description,
  c.conflict_type, pl.id, 'player_season_stints', c.description, 'UNRESOLVED', c.note
from _m021_conflicts c
join _m021_players pl on pl.slug = c.slug
where c.slug is not null
on conflict (conflict_key) do nothing;

-- ===========================================================================
-- 8. DERIVED MILESTONE EDGES (first Dodgers MLB appearance when different)
-- ===========================================================================

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
  'SEASON_SPLITS',
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
-- 9. CURRENT DEVELOPMENT STATUS
-- ===========================================================================

-- Highest affiliated level reached, and where development currently stands.
-- A player with stints but no MLB has NOT failed; a player with no stints is
-- unknown unless audited otherwise; absence of data is never "not reached".
insert into public.player_development_status (player_id, status, basis, status_season, as_of_date, note)
select
  pl.id,
  case
    when audited.reached_mlb_verified is true then 'MLB'::public.development_status
    when foreign_after.last_season is not null
      and (highest.affiliated_rank is null or foreign_after.last_season > highest.last_season)
      then 'OUT_OF_AFFILIATED_BASEBALL'::public.development_status
    when highest.level is not null then
      case highest.level
        when 'AAA' then 'AAA'::public.development_status
        when 'AA' then 'AA'::public.development_status
        when 'HIGH_A' then 'HIGH_A'::public.development_status
        when 'LOW_A' then 'A_BALL'::public.development_status
        when 'A' then 'A_BALL'::public.development_status
        else 'ROOKIE_LEVEL'::public.development_status
      end
    when pl.mlb_id is null then 'UNKNOWN'::public.development_status
    else 'NOT_YET_DEBUTED'::public.development_status
  end,
  case when audited.reached_mlb_verified is true then 'AUDITED_OUTCOME' else 'STINTS' end,
  coalesce(highest.last_season, foreign_after.last_season),
  coalesce((select max(s.as_of_date) from public.player_season_stints s where s.player_id = pl.id), current_date),
  case
    when audited.reached_mlb_verified is true then null
    when highest.level is not null then 'Highest affiliated level reached: ' || highest.level
    when foreign_after.last_season is not null then 'Professional play recorded outside affiliated baseball'
    else 'No professional seasons recorded in the sources reviewed'
  end
from _m021_players pl
left join lateral (
  select dls.level, dls.level_rank as affiliated_rank, max(dls.season) as last_season
  from public.player_season_stints dls
  where dls.player_id = pl.id and dls.affiliated and dls.level <> 'MLB'
  group by dls.level, dls.level_rank
  order by dls.level_rank desc, last_season desc
  limit 1
) highest on true
left join lateral (
  select max(dls.season) as last_season
  from public.player_season_stints dls
  where dls.player_id = pl.id and not dls.affiliated
) foreign_after on true
left join lateral (
  select oa.reached_mlb_verified
  from public.outcome_audits oa
  where oa.player_id = pl.id
  order by oa.audited_through_date desc
  limit 1
) audited on true
where pl.id in (select player_id from public.player_season_stints)
   or audited.reached_mlb_verified is true
on conflict (player_id) do update
set status = excluded.status,
    basis = excluded.basis,
    status_season = excluded.status_season,
    as_of_date = excluded.as_of_date,
    note = excluded.note;

-- ===========================================================================
-- 10. SECURITY
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['player_season_stints', 'player_development_status',
                           'development_levels', 'development_level_era_map',
                           'development_event_codes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

grant select on public.player_season_stints to anon, authenticated;

-- ===========================================================================
-- 11. DERIVED DEVELOPMENT METRICS (exact-date functions)
-- ===========================================================================

-- Exact-day elapsed measures. NULL in / NULL out; both dates must exist.
create or replace function public.disi_development_days(p_from date, p_to date)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_from is null or p_to is null or p_to < p_from then null
              else (p_to - p_from)::int end
$$;

create or replace function public.disi_development_years(p_from date, p_to date)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_from is null or p_to is null or p_to < p_from then null
              else trunc(((p_to - p_from) / 365.2425)::numeric, 2) end
$$;

-- ===========================================================================
-- 12. RESEARCH VIEWS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 12a. Per-player development summary: milestone dates, ages, elapsed times.
-- Exact dates appear only where a dated record supports them; season-based
-- approximations are separate, clearly labelled columns.
-- ---------------------------------------------------------------------------
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
  oa.reached_mlb_verified
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

-- ---------------------------------------------------------------------------
-- 12b. Stint timeline for the player dossier: Year | Age | Org | Affiliate |
-- Level | G/PA or IP | key stats. Every row is one stint.
-- ---------------------------------------------------------------------------
create or replace view public.v_player_development_stints
with (security_invoker = true)
as
select
  s.id as stint_id,
  s.player_id,
  p.slug as player_slug,
  s.season,
  s.age_during_season,
  s.level_rank,
  s.organization_name,
  o.abbreviation as organization_abbreviation,
  s.affiliate_team,
  s.league_name,
  s.level::text as level,
  dl.label as level_label,
  s.source_level,
  s.level_classification,
  s.era::text as era,
  s.first_game_date,
  s.last_game_date,
  case
    when s.pg is not null and s.g is not null then concat_ws(' / ', s.g::text, s.pa::text || ' PA', round(s.ip, 1)::text || ' IP')
    when s.pg is not null then concat_ws(' / ', s.pg::text, round(s.ip, 1)::text || ' IP')
    else concat_ws(' / ', s.g::text, s.pa::text || ' PA')
  end as line_summary,
  s.g, s.pa, s.ab, s.h, s.b2, s.b3, s.hr, s.bb, s.so, s.sb, s.cs,
  s.avg, s.obp, s.slg, s.ops,
  s.pg, s.gs, s.ip, s.bf, s.h_allowed, s.r, s.er, s.hr_allowed, s.pbb, s.pso,
  s.era_, s.whip,
  s.batter_k_pct, s.batter_bb_pct, s.pitcher_k_pct, s.pitcher_bb_pct, s.pitcher_k_minus_bb_pct,
  s.affiliated,
  s.detail,
  s.source_urls,
  s.as_of_date
from public.player_season_stints s
join public.players p on p.id = s.player_id
left join public.organizations o on o.id = s.organization_id
left join public.development_levels dl on dl.level = s.level;

-- ---------------------------------------------------------------------------
-- 12c. Milestone timing for the dossier (only evidenced values).
-- ---------------------------------------------------------------------------
create or replace view public.v_player_development_milestones
with (security_invoker = true)
as
select
  m.player_id,
  p.slug as player_slug,
  m.event_code,
  ec.description as event_description,
  m.milestone_date,
  m.date_precision::text as date_precision,
  m.season_year,
  m.age_at_milestone,
  m.affiliate,
  m.evidence_basis,
  m.notes
from public.development_milestones m
join public.players p on p.id = m.player_id
join public.development_event_codes ec on ec.event_code = m.event_code
where m.event_code is not null;

-- ---------------------------------------------------------------------------
-- 12d. Development by signing class (tracked-cohort measures).
-- These are TRACKED-COHORT counts: the denominator is the tracked players in
-- the class, never the full signing period, so nothing here is a rate.
-- ---------------------------------------------------------------------------
create or replace view public.v_dodgers_development_by_signing_class
with (security_invoker = true)
as
select
  sg.signing_year,
  count(distinct sg.player_id)::int as tracked_players,
  -- Reached-level counts accept any evidence: an exact dated milestone or a
  -- labelled first season. The median columns below stay exact-date only.
  count(distinct sg.player_id) filter (where dsum.first_a_date is not null or dsum.first_a_season is not null)::int as reached_a,
  count(distinct sg.player_id) filter (where dsum.first_high_a_date is not null or dsum.first_high_a_season is not null)::int as reached_high_a,
  count(distinct sg.player_id) filter (where dsum.first_aa_date is not null or dsum.first_aa_season is not null)::int as reached_aa,
  count(distinct sg.player_id) filter (where dsum.first_aaa_date is not null or dsum.first_aaa_season is not null)::int as reached_aaa,
  count(distinct sg.player_id) filter (where dsum.mlb_debut_date is not null or dsum.mlb_debut_season is not null)::int as reached_mlb,
  -- Median time to AA / MLB among players where BOTH endpoint dates exist.
  percentile_cont(0.5) within group (order by dsum.years_signing_to_aa_exact) filter (where dsum.years_signing_to_aa_exact is not null) as median_years_signing_to_aa_exact,
  percentile_cont(0.5) within group (order by dsum.years_signing_to_mlb_exact) filter (where dsum.years_signing_to_mlb_exact is not null) as median_years_signing_to_mlb_exact,
  count(*) filter (where dsum.years_signing_to_aa_exact is not null)::int as years_signing_to_aa_n,
  count(*) filter (where dsum.years_signing_to_mlb_exact is not null)::int as years_signing_to_mlb_n,
  'TRACKED_COHORT' as cohort_scope,
  'Counts describe the tracked players in this signing class, not the full signing period. Median times are exact-date measures over the subset with both dates; the n columns say how many.' as cohort_note
from public.signings sg
join public.organizations o on o.id = sg.organization_id
left join public.v_dodgers_player_development_summary dsum on dsum.player_id = sg.player_id
where o.franchise_key = 'DODGERS'
group by sg.signing_year;

-- ---------------------------------------------------------------------------
-- 12e. Development by market: descriptive only, tracked players.
-- ---------------------------------------------------------------------------
create or replace view public.v_dodgers_development_by_market
with (security_invoker = true)
as
select
  sg.country_market,
  count(distinct sg.player_id)::int as tracked_players,
  percentile_cont(0.5) within group (order by public.disi_age_years(p.birth_date, sg.signing_date)) filter (where p.birth_date is not null and sg.signing_date is not null) as median_signing_age,
  count(distinct dsum.player_id) filter (where dsum.first_aa_date is not null or dsum.first_aa_season is not null)::int as aa_reach_count,
  count(distinct dsum.player_id) filter (where dsum.first_aaa_date is not null or dsum.first_aaa_season is not null)::int as aaa_reach_count,
  count(distinct dsum.player_id) filter (where dsum.mlb_debut_date is not null or dsum.mlb_debut_season is not null)::int as mlb_reach_count,
  percentile_cont(0.5) within group (order by dsum.years_signing_to_aa_exact) filter (where dsum.years_signing_to_aa_exact is not null) as median_years_signing_to_aa,
  percentile_cont(0.5) within group (order by dsum.years_signing_to_mlb_exact) filter (where dsum.years_signing_to_mlb_exact is not null) as median_years_signing_to_mlb,
  'DESCRIPTIVE_ONLY' as analysis_scope,
  'Tracked players only. Descriptive comparison of where players were signed; no causal interpretation is implied.' as analysis_note
from public.signings sg
join public.players p on p.id = sg.player_id
join public.organizations o on o.id = sg.organization_id
left join public.v_dodgers_player_development_summary dsum on dsum.player_id = sg.player_id
where o.franchise_key = 'DODGERS'
group by sg.country_market;

-- ---------------------------------------------------------------------------
-- 12f. Development by bonus band (existing acquisition-cost framework).
-- Unknown bonus is preserved as its own band, never folded into a number.
-- ---------------------------------------------------------------------------
create or replace view public.v_dodgers_development_by_bonus_band
with (security_invoker = true)
as
select
  case
    when sg.total_known_acquisition_cost_usd < 250000 then '<$250K'
    when sg.total_known_acquisition_cost_usd < 1000000 then '$250K-$999K'
    when sg.total_known_acquisition_cost_usd < 5000000 then '$1M-$4.999M'
    when sg.total_known_acquisition_cost_usd >= 5000000 then '$5M+'
    else 'UNKNOWN'
  end as bonus_band,
  count(distinct sg.player_id)::int as tracked_players,
  count(distinct dsum.player_id) filter (where dsum.first_aa_date is not null or dsum.first_aa_season is not null)::int as reached_aa,
  count(distinct dsum.player_id) filter (where dsum.first_aaa_date is not null or dsum.first_aaa_season is not null)::int as reached_aaa,
  count(distinct dsum.player_id) filter (where dsum.mlb_debut_date is not null or dsum.mlb_debut_season is not null)::int as reached_mlb,
  percentile_cont(0.5) within group (order by dsum.years_signing_to_mlb_exact) filter (where dsum.years_signing_to_mlb_exact is not null) as median_years_signing_to_mlb,
  'UNKNOWN_COST_IS_UNKNOWN' as bonus_note,
  'Tracked-cohort measures. Unknown acquisition cost stays its own band; it is not $0 and not imputed.' as scope_note
from public.signings sg
join public.organizations o on o.id = sg.organization_id
left join public.v_dodgers_player_development_summary dsum on dsum.player_id = sg.player_id
where o.franchise_key = 'DODGERS'
group by 1;

-- ---------------------------------------------------------------------------
-- 12g. Development research queue: what is missing, unknown or conflicting.
-- ---------------------------------------------------------------------------
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
    ) as no_pre_mlb_history
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
      'Source-level label and canonical classification disagree; review the stint')
  ) as v(issue, priority, detail)
) issues
where (issue = 'IDENTITY_BUT_NO_PROFESSIONAL_SEASONS' and mlb_id is not null and not has_stints)
   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2
       and (select max(s.season) - min(s.season) from public.player_season_stints s where s.player_id = player_id) + 1 > stint_count)
   or (issue = 'UNKNOWN_LEVEL_CLASSIFICATION' and has_unknown_level)
   or (issue = 'UNRESOLVED_ORGANIZATION' and has_unresolved_organization)
   or (issue = 'MULTI_ORG_SEASON_UNVERIFIED' and has_multi_org_season)
   or (issue = 'MLB_PLAYER_MISSING_PRE_MLB_HISTORY' and has_mlb_milestone and no_pre_mlb_history);

-- ---------------------------------------------------------------------------
-- 12h. Development data coverage (for the coverage report and /research).
-- ---------------------------------------------------------------------------
create or replace view public.v_dodgers_development_coverage
with (security_invoker = true)
as
select
  count(*)::int as tracked_players,
  count(*) filter (where pre.has_stints)::int as players_with_stints,
  count(*) filter (where not pre.has_stints)::int as players_without_stints,
  count(*) filter (where not pre.has_stints and d.mlb_id is not null)::int as resolved_players_without_stints,
  count(*) filter (where pre.has_mlb)::int as players_with_mlb_history,
  count(*) filter (where pre.has_mlb and pre.has_pre_mlb)::int as mlb_players_with_pre_mlb_history,
  count(*) filter (where pre.has_mlb and pre.has_pre_mlb_partial)::int as mlb_players_with_partial_pre_mlb_history,
  count(*) filter (where pre.has_mlb and not pre.has_pre_mlb)::int as mlb_players_missing_pre_mlb_history,
  count(*) filter (where not pre.has_mlb and pre.has_stints)::int as non_mlb_players_with_history,
  count(*) filter (where first_aa_date is not null)::int as players_with_exact_first_aa_date,
  count(*) filter (where first_aa_season is not null)::int as players_with_first_aa_season,
  count(*) filter (where first_aaa_date is not null)::int as players_with_exact_first_aaa_date,
  count(*) filter (where first_aaa_season is not null)::int as players_with_first_aaa_season,
  count(*) filter (where years_signing_to_mlb_exact is not null)::int as players_with_signing_to_mlb_time
from public.v_dodgers_player_development_summary d
left join lateral (
  select
    exists (select 1 from public.player_season_stints s where s.player_id = d.player_id) as has_stints,
    exists (select 1 from public.player_season_stints s where s.player_id = d.player_id and s.affiliated and s.level <> 'MLB') as has_pre_mlb,
    exists (select 1 from public.player_season_stints s where s.player_id = d.player_id and s.affiliated and s.level <> 'MLB'
            and (s.g > 0 or s.pa > 0 or s.pg > 0)) as has_pre_mlb_partial,
    exists (select 1 from public.player_season_stints s where s.player_id = d.player_id and s.level = 'MLB') as has_mlb
) pre on true;

-- ===========================================================================
-- 13. GRANTS
-- ===========================================================================

grant select on public.v_dodgers_player_development_summary to anon, authenticated;
grant select on public.v_player_development_stints to anon, authenticated;
grant select on public.v_player_development_milestones to anon, authenticated;
grant select on public.v_dodgers_development_by_signing_class to anon, authenticated;
grant select on public.v_dodgers_development_by_market to anon, authenticated;
grant select on public.v_dodgers_development_by_bonus_band to anon, authenticated;
grant select on public.v_dodgers_development_research_queue to anon, authenticated;
grant select on public.v_dodgers_development_coverage to anon, authenticated;

commit;
