-- DISI v0.15
-- 024_development_progression_decisions.sql
-- Development progression decisions. Run after 023.
--
-- Built from reviewed research (database/research/024/): values-decisions.json
-- holds the reviewed decisions, audit.mjs checks each one against the canonical
-- 001->023 data, and build.mjs assembles this file.
--
-- A *_DEBUT milestone is the FIRST RECORDED APPEARANCE at a level. That fact
-- stays exactly as 022/023 left it. This migration adds a small reviewed layer
-- saying how a first appearance counts as DEVELOPMENTAL arrival, because a
-- one-game AAA cameo or a later lower-level appearance is not progression.
--
-- What this does:
--   * Adds development_progression_decisions: one reviewed row per player and
--     level event, tied to the existing milestone by a composite foreign key
--     (milestone, player, event). Roles:
--       (no row)                      first appearance = developmental arrival
--       DEVELOPMENTAL_ARRIVAL         reviewed confirmation of the above
--       EARLY_CAMEO                   real appearance, not arrival; arrival is a
--                                     reviewed later date, or NULL = not yet reached
--       POST_ESTABLISHMENT_APPEARANCE appeared only after establishing higher;
--                                     no arrival (skipped in progression)
--       REVIEW_REQUIRED               ambiguous; arrival unknown, never guessed
--   * Seeds 20 rows (11 reviewed decisions; 9 REVIEW_REQUIRED events covering
--     every unresolved level of four ambiguous sequences), resolved by player slug
--     and event code, behind evidence guards.
--   * Adds v_player_development_progression: per player and ladder level, the
--     first appearance, the decision, the developmental arrival and a state
--     (REACHED / SKIPPED / NOT_REACHED / UNRESOLVED). SKIPPED is derived: no
--     arrival at the level but an arrival at a higher level. FOREIGN_PRO is never
--     on the ladder.
--   * The development summary keeps every first_* / age_at_first_* column as a
--     literal first-appearance fact. Elapsed development metrics (signing to
--     A/High-A/AA/AAA, A to High-A/AA, High-A to AA, AA to AAA, AAA to MLB and
--     the season approximations to A/AA) now use developmental arrival.
--     dev_<level>_date/season/state/role columns are appended.
--   * player_development_status.status becomes the highest unambiguously
--     established developmental level. Pending milestones do not count as
--     reached and do not invalidate a separately verified higher level (e.g. a
--     verified MLB outcome). highest_affiliated_level stays the highest level
--     ever appeared at.
--   * The signing-class / market / bonus-band views keep their first-appearance
--     columns (documented as appearances) and append developmentally_reached_*
--     counts and the number of players with progression review pending.
--   * The research queue gains NON_MONOTONIC_PROGRESSION (a developmental
--     inversion with no covering decision) and LEVEL_SKIP_CAMEO_CANDIDATE (a
--     heuristic: a 1-2 game High-A/AA/AAA first appearance that skips the level
--     below, with no decision). Candidates never change analytics.
--   * Leaves all 828 stints, all 832 milestones and every 023 stint_kind untouched.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 1. SCHEMA: development_progression_decisions
-- ===========================================================================

-- A composite key on the existing milestone lets each decision prove it points at
-- the milestone of its own player and event (not just any milestone).
create unique index if not exists development_milestones_id_player_event_key
  on public.development_milestones (id, player_id, event_code);

create table if not exists public.development_progression_decisions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  event_code text not null references public.development_event_codes(event_code),
  milestone_id uuid not null,
  progression_role text not null,
  developmental_arrival_date date,
  developmental_arrival_precision public.date_precision,
  developmental_arrival_season int,
  decision_basis text not null,
  review_status text not null,
  confidence public.confidence_level not null,
  notes text not null,
  source_id uuid references public.sources(id) on delete set null,
  reviewed_at timestamptz not null,
  as_of_date date not null,
  created_at timestamptz not null default now(),
  constraint development_progression_decisions_player_event_key unique (player_id, event_code),
  constraint development_progression_decisions_milestone_fkey
    foreign key (milestone_id, player_id, event_code)
    references public.development_milestones (id, player_id, event_code) on delete restrict,
  constraint development_progression_decisions_event_check
    check (event_code in ('DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT', 'MLB_DEBUT')),
  constraint development_progression_decisions_role_check
    check (progression_role in ('DEVELOPMENTAL_ARRIVAL', 'EARLY_CAMEO', 'POST_ESTABLISHMENT_APPEARANCE', 'REVIEW_REQUIRED')),
  constraint development_progression_decisions_basis_check
    check (decision_basis in ('STINT_CHRONOLOGY_REVIEW', 'GAME_LOG_REVIEW', 'TRANSACTION_EVIDENCE')),
  -- REVIEW_REQUIRED is exactly the pending state; every other role is a reviewed decision.
  constraint development_progression_decisions_review_check
    check (case when progression_role = 'REVIEW_REQUIRED' then review_status = 'PENDING_REVIEW'
                else review_status = 'REVIEWED' end),
  -- Only an EARLY_CAMEO may carry a (later) arrival; it is either fully absent,
  -- an exact DAY (date and its season), or SEASON-only (season, no date).
  constraint development_progression_decisions_arrival_check
    check (case
      when progression_role <> 'EARLY_CAMEO' then
        developmental_arrival_date is null and developmental_arrival_precision is null and developmental_arrival_season is null
      when developmental_arrival_precision is null then
        developmental_arrival_date is null and developmental_arrival_season is null
      when developmental_arrival_precision = 'DAY' then
        coalesce(developmental_arrival_date is not null
                 and developmental_arrival_season = extract(year from developmental_arrival_date)::int, false)
      else developmental_arrival_date is null and developmental_arrival_season is not null
    end)
);

create index if not exists development_progression_decisions_milestone_idx
  on public.development_progression_decisions (milestone_id);

comment on table public.development_progression_decisions is
  'Reviewed interpretation of first-appearance milestones as developmental progression. One row per player and level event; no row means the first appearance is the developmental arrival. Raw stints and milestones are never changed by a decision.';
comment on column public.development_progression_decisions.progression_role is
  'DEVELOPMENTAL_ARRIVAL (first appearance confirmed as arrival), EARLY_CAMEO (real appearance, not arrival; arrival is the reviewed later date or NULL = not yet reached), POST_ESTABLISHMENT_APPEARANCE (first appeared only after establishing at a higher level; no arrival, skipped), REVIEW_REQUIRED (ambiguous; arrival unknown, never guessed).';
comment on column public.development_progression_decisions.developmental_arrival_date is
  'Reviewed developmental arrival for an EARLY_CAMEO with a later arrival (DAY precision). NULL otherwise.';

-- ===========================================================================
-- 2. REVIEWED RESEARCH DATA (database/research/024/values-decisions.json)
-- ===========================================================================

create temporary table _m024_decisions (
  slug text, event_code text, progression_role text,
  developmental_arrival_date date, developmental_arrival_precision text, developmental_arrival_season int,
  decision_basis text, review_status text, confidence text, notes text,
  reviewed_at timestamptz, as_of_date date
) on commit drop;

insert into _m024_decisions values
('roger-cedeno', 'HIGH_A_DEBUT', 'POST_ESTABLISHMENT_APPEARANCE', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'REVIEWED', 'HIGH', 'First High-A appearance (1998 Vero Beach, 6 G, season-only) came after AA and AAA in 1993 and the MLB debut on 1995-06-20. High-A is skipped in developmental progression; the 1998 stint and first-appearance fact stay. No AA-before-AAA order is inferred inside 1993.', timestamptz '2026-10-07', date '2026-10-07'),
('omar-estevez', 'COMPLEX_DEBUT', 'POST_ESTABLISHMENT_APPEARANCE', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'REVIEWED', 'HIGH', 'Complex-league appearance (AZL, 2019-06-24, 7 G) came after full Low-A (2016) and High-A (2017-2018) seasons and during his 2019 AA season. Context not evidenced; not labelled rehab.', timestamptz '2026-10-07', date '2026-10-07'),
('elio-campos', 'COMPLEX_DEBUT', 'POST_ESTABLISHMENT_APPEARANCE', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'REVIEWED', 'MEDIUM', 'Complex-league appearance (FCL Braves, 2025-06-10, 3 G) came after four DSL seasons and inside his 2025 Low-A season (from 2025-04-04). Rookie tier only; no elapsed metric depends on it.', timestamptz '2026-10-07', date '2026-10-07'),
('elio-campos', 'AAA_DEBUT', 'EARLY_CAMEO', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'REVIEWED', 'HIGH', 'One AAA game (Gwinnett, 2025-08-01) with no AA or High-A appearance at any point. AAA not yet developmentally reached.', timestamptz '2026-10-07', date '2026-10-07'),
('eduardo-guerrero', 'AAA_DEBUT', 'EARLY_CAMEO', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'REVIEWED', 'HIGH', 'One AAA game (Oklahoma City, 2024-08-03) before his Low-A arrival (2024-08-06) and later High-A and AA progression. AAA not yet developmentally reached; A, High-A and AA arrivals stand as first appearances.', timestamptz '2026-10-07', date '2026-10-07'),
('javier-herrera', 'AAA_DEBUT', 'EARLY_CAMEO', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'REVIEWED', 'HIGH', 'One AAA game (Oklahoma City, 2025-08-01) between complex-league seasons; he reached Low-A in 2026 (68 G). AAA not yet developmentally reached.', timestamptz '2026-10-07', date '2026-10-07'),
('eduardo-rojas', 'AAA_DEBUT', 'EARLY_CAMEO', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'REVIEWED', 'HIGH', 'One AAA game (Oklahoma City, 2026-07-05) during a complex-league season, before a one-game Low-A appearance. AAA not yet developmentally reached.', timestamptz '2026-10-07', date '2026-10-07'),
('sean-linan', 'AAA_DEBUT', 'EARLY_CAMEO', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'REVIEWED', 'HIGH', 'Two AAA games (Oklahoma City, 2025-05-17 to 2025-05-23) during his High-A season; AA arrival came later (2026-08-18). AAA not yet developmentally reached.', timestamptz '2026-10-07', date '2026-10-07'),
('mairoshendrick-martinus', 'HIGH_A_DEBUT', 'EARLY_CAMEO', date '2026-08-02', 'DAY', 2026, 'GAME_LOG_REVIEW', 'REVIEWED', 'HIGH', 'Seven High-A games (Great Lakes, 2025-04-20 to 2025-05-04), then 184 Low-A games (2025-2026) before High-A arrival on 2026-08-02 (Great Lakes, game-log first appearance).', timestamptz '2026-10-07', date '2026-10-07'),
('ronny-brito', 'HIGH_A_DEBUT', 'EARLY_CAMEO', date '2021-05-04', 'DAY', 2021, 'GAME_LOG_REVIEW', 'REVIEWED', 'MEDIUM', 'Four High-A games (Dunedin, 2019-05-30 to 2019-06-06), then a 56-game short-season A- season (Vancouver; classified LOW_A per 021) before High-A arrival on 2021-05-04 (Vancouver, game-log first appearance). Confidence medium-high.', timestamptz '2026-10-07', date '2026-10-07'),
('jeral-perez', 'A_DEBUT', 'EARLY_CAMEO', date '2024-04-05', 'DAY', 2024, 'GAME_LOG_REVIEW', 'REVIEWED', 'HIGH', 'Seven Low-A games (Rancho Cucamonga, 2023-04-20 to 2023-04-28), then a 53-game ACL season before Low-A arrival on 2024-04-05 (Rancho Cucamonga, game-log first appearance).', timestamptz '2026-10-07', date '2026-10-07'),
('carlos-frias', 'A_DEBUT', 'REVIEW_REQUIRED', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'Unresolved sequence: High-A in 2011 (12 G) and 2012 (3 G), then Ogden (rookie-advanced), then Low-A in 2013 (12 G) before High-A again and AA. Whether the 2011 High-A stint was an early cameo, the 2013 Low-A stint a reassignment, or the path simply unusual is not decided; neither A nor High-A is accepted as a developmental arrival.', timestamptz '2026-10-07', date '2026-10-07'),
('carlos-frias', 'HIGH_A_DEBUT', 'REVIEW_REQUIRED', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'Unresolved sequence: High-A in 2011 (12 G) and 2012 (3 G), then Ogden (rookie-advanced), then Low-A in 2013 (12 G) before High-A again and AA. Whether the 2011 High-A stint was an early cameo, the 2013 Low-A stint a reassignment, or the path simply unusual is not decided; neither A nor High-A is accepted as a developmental arrival.', timestamptz '2026-10-07', date '2026-10-07'),
('carlos-avila', 'A_DEBUT', 'REVIEW_REQUIRED', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'Unresolved sequence: AA (2024, 6 G; 2025, 1 G), Low-A (2025, 5 G) and AAA (2025, 3 G) are all brief fill-in appearances while he played mainly in the ACL. None of A, AA or AAA is accepted as a developmental arrival.', timestamptz '2026-10-07', date '2026-10-07'),
('carlos-avila', 'AA_DEBUT', 'REVIEW_REQUIRED', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'Unresolved sequence: AA (2024, 6 G; 2025, 1 G), Low-A (2025, 5 G) and AAA (2025, 3 G) are all brief fill-in appearances while he played mainly in the ACL. None of A, AA or AAA is accepted as a developmental arrival.', timestamptz '2026-10-07', date '2026-10-07'),
('carlos-avila', 'AAA_DEBUT', 'REVIEW_REQUIRED', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'Unresolved sequence: AA (2024, 6 G; 2025, 1 G), Low-A (2025, 5 G) and AAA (2025, 3 G) are all brief fill-in appearances while he played mainly in the ACL. None of A, AA or AAA is accepted as a developmental arrival.', timestamptz '2026-10-07', date '2026-10-07'),
('christian-romero', 'AA_DEBUT', 'REVIEW_REQUIRED', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'Unresolved sequence: AAA (2024-05-17) then AA five days later (2024-05-22), back to High-A in 2025, then AAA again from 2025-07-31. Which appearance represents advancement is not determined; neither AA nor AAA is accepted.', timestamptz '2026-10-07', date '2026-10-07'),
('christian-romero', 'AAA_DEBUT', 'REVIEW_REQUIRED', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'Unresolved sequence: AAA (2024-05-17) then AA five days later (2024-05-22), back to High-A in 2025, then AAA again from 2025-07-31. Which appearance represents advancement is not determined; neither AA nor AAA is accepted.', timestamptz '2026-10-07', date '2026-10-07'),
('nicolas-cruz', 'A_DEBUT', 'REVIEW_REQUIRED', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'Unresolved sequence: three High-A games in September 2024, then interleaved High-A (from 2025-04-20) and Low-A (from 2025-04-25) stints in 2025. Whether the early High-A stint was advancement or a cameo/reassignment pattern is not established; neither A nor High-A is accepted.', timestamptz '2026-10-07', date '2026-10-07'),
('nicolas-cruz', 'HIGH_A_DEBUT', 'REVIEW_REQUIRED', null, null, null, 'STINT_CHRONOLOGY_REVIEW', 'PENDING_REVIEW', 'LOW', 'Unresolved sequence: three High-A games in September 2024, then interleaved High-A (from 2025-04-20) and Low-A (from 2025-04-25) stints in 2025. Whether the early High-A stint was advancement or a cameo/reassignment pattern is not established; neither A nor High-A is accepted.', timestamptz '2026-10-07', date '2026-10-07');

create temporary table _m024_resolved on commit drop as
select d.*, p.id as player_id, m.id as milestone_id, m.milestone_date as first_date,
       coalesce(m.season_year, extract(year from m.milestone_date)::int) as first_season
from _m024_decisions d
join public.players p on p.slug = d.slug
join public.development_milestones m on m.player_id = p.id and m.event_code = d.event_code;

do $$
declare
  expected int;
  resolved int;
  bad text;
begin
  select count(*) into expected from _m024_decisions;
  select count(*) into resolved from _m024_resolved;
  if expected <> resolved
     or (select count(*) from (select distinct slug, event_code from _m024_resolved) x) <> expected then
    raise exception '024: % reviewed decisions but % resolved to exactly one first-appearance milestone', expected, resolved;
  end if;

  -- A reviewed later arrival must come after the first appearance and must be the
  -- game-log first appearance of a team stint at that level.
  select string_agg(format('%s %s', r.slug, r.event_code), '; ') into bad
  from _m024_resolved r
  where r.progression_role = 'EARLY_CAMEO' and r.developmental_arrival_date is not null
    and (r.developmental_arrival_date <= coalesce(r.first_date, make_date(r.first_season, 12, 31))
      or not exists (
        select 1 from public.player_season_stints s
        where s.player_id = r.player_id and s.stint_kind = 'TEAM_STINT'
          and s.first_game_date = r.developmental_arrival_date
          and s.level::text = any (case r.event_code
            when 'DSL_DEBUT' then array['INTERNATIONAL_ROOKIE'] when 'COMPLEX_DEBUT' then array['COMPLEX_ROOKIE']
            when 'A_DEBUT' then array['LOW_A', 'A'] when 'HIGH_A_DEBUT' then array['HIGH_A']
            when 'AA_DEBUT' then array['AA'] when 'AAA_DEBUT' then array['AAA'] else array['MLB'] end)));
  if bad is not null then
    raise exception '024: reviewed arrival is not a later game-log first appearance at the level: %', bad;
  end if;

  -- A post-establishment appearance must follow a first appearance at a higher level.
  select string_agg(format('%s %s', r.slug, r.event_code), '; ') into bad
  from _m024_resolved r
  where r.progression_role = 'POST_ESTABLISHMENT_APPEARANCE'
    and not exists (
      select 1 from public.development_milestones h
      join public.development_levels hl on hl.level::text = case h.event_code
        when 'A_DEBUT' then 'LOW_A' when 'HIGH_A_DEBUT' then 'HIGH_A' when 'AA_DEBUT' then 'AA'
        when 'AAA_DEBUT' then 'AAA' when 'MLB_DEBUT' then 'MLB' end
      where h.player_id = r.player_id
        and hl.progression_rank > 2
        and hl.progression_rank > (select l.progression_rank from public.development_levels l where l.level::text = case r.event_code
          when 'DSL_DEBUT' then 'INTERNATIONAL_ROOKIE' when 'COMPLEX_DEBUT' then 'COMPLEX_ROOKIE' when 'A_DEBUT' then 'LOW_A'
          when 'HIGH_A_DEBUT' then 'HIGH_A' when 'AA_DEBUT' then 'AA' when 'AAA_DEBUT' then 'AAA' end)
        and (case when h.milestone_date is not null and r.first_date is not null then h.milestone_date < r.first_date
                  else coalesce(h.season_year, extract(year from h.milestone_date)::int) < r.first_season end));
  if bad is not null then
    raise exception '024: post-establishment appearance without an earlier higher-level appearance: %', bad;
  end if;
end $$;

insert into public.development_progression_decisions (
  player_id, event_code, milestone_id, progression_role,
  developmental_arrival_date, developmental_arrival_precision, developmental_arrival_season,
  decision_basis, review_status, confidence, notes, reviewed_at, as_of_date)
select r.player_id, r.event_code, r.milestone_id, r.progression_role,
  r.developmental_arrival_date, r.developmental_arrival_precision::public.date_precision, r.developmental_arrival_season,
  r.decision_basis, r.review_status, r.confidence::public.confidence_level, r.notes, r.reviewed_at, r.as_of_date
from _m024_resolved r
on conflict (player_id, event_code) do update
set milestone_id = excluded.milestone_id,
    progression_role = excluded.progression_role,
    developmental_arrival_date = excluded.developmental_arrival_date,
    developmental_arrival_precision = excluded.developmental_arrival_precision,
    developmental_arrival_season = excluded.developmental_arrival_season,
    decision_basis = excluded.decision_basis,
    review_status = excluded.review_status,
    confidence = excluded.confidence,
    notes = excluded.notes,
    reviewed_at = excluded.reviewed_at,
    as_of_date = excluded.as_of_date
where (public.development_progression_decisions.milestone_id, public.development_progression_decisions.progression_role,
       public.development_progression_decisions.developmental_arrival_date, public.development_progression_decisions.developmental_arrival_precision,
       public.development_progression_decisions.developmental_arrival_season, public.development_progression_decisions.decision_basis,
       public.development_progression_decisions.review_status, public.development_progression_decisions.confidence,
       public.development_progression_decisions.notes, public.development_progression_decisions.reviewed_at,
       public.development_progression_decisions.as_of_date)
  is distinct from (excluded.milestone_id, excluded.progression_role, excluded.developmental_arrival_date,
       excluded.developmental_arrival_precision, excluded.developmental_arrival_season, excluded.decision_basis,
       excluded.review_status, excluded.confidence, excluded.notes, excluded.reviewed_at, excluded.as_of_date);

-- ===========================================================================
-- 3. SECURITY for the new table (the 021 convention: RLS, public read, no writes)
-- ===========================================================================

alter table public.development_progression_decisions enable row level security;
drop policy if exists public_read_development_progression_decisions on public.development_progression_decisions;
create policy public_read_development_progression_decisions on public.development_progression_decisions
  for select to anon, authenticated using (true);

-- ===========================================================================
-- 4. DEVELOPMENTAL ARRIVAL (one reusable derivation)
-- ===========================================================================
-- One row per player (with any ladder milestone) and ladder level. Arrival:
--   no decision / DEVELOPMENTAL_ARRIVAL   -> the first appearance
--   EARLY_CAMEO                           -> the reviewed arrival (NULL = not yet reached)
--   POST_ESTABLISHMENT_APPEARANCE         -> none
--   REVIEW_REQUIRED                       -> unknown (state UNRESOLVED)
-- State: UNRESOLVED (review pending) / REACHED (an arrival exists) / SKIPPED (no
-- arrival here but an arrival at a higher level) / NOT_REACHED. Rookie levels
-- share one tier for ordering. FOREIGN_PRO is never on the ladder.
create or replace view public.v_player_development_progression
with (security_invoker = true)
as
with ladder (event_code, level, progression_rank, progression_tier) as (
  values ('DSL_DEBUT', 'INTERNATIONAL_ROOKIE', 1, 1), ('COMPLEX_DEBUT', 'COMPLEX_ROOKIE', 2, 1),
         ('A_DEBUT', 'LOW_A', 3, 3), ('HIGH_A_DEBUT', 'HIGH_A', 4, 4), ('AA_DEBUT', 'AA', 5, 5),
         ('AAA_DEBUT', 'AAA', 6, 6), ('MLB_DEBUT', 'MLB', 7, 7)
),
ladder_players as (
  select distinct m.player_id from public.development_milestones m
  where m.event_code in (select event_code from ladder)
),
base as (
  select lp.player_id, l.event_code, l.level, l.progression_rank, l.progression_tier,
    fm.id as milestone_id, fm.milestone_date as first_appearance_date,
    fm.season_year as first_appearance_season, fm.date_precision::text as first_appearance_precision,
    d.progression_role, d.review_status,
    case
      when d.progression_role in ('REVIEW_REQUIRED', 'POST_ESTABLISHMENT_APPEARANCE') then null
      when d.progression_role = 'EARLY_CAMEO' then d.developmental_arrival_date
      else fm.milestone_date
    end as dev_date,
    case
      when d.progression_role in ('REVIEW_REQUIRED', 'POST_ESTABLISHMENT_APPEARANCE') then null
      when d.progression_role = 'EARLY_CAMEO' then d.developmental_arrival_season
      else fm.season_year
    end as dev_season,
    case
      when d.progression_role in ('REVIEW_REQUIRED', 'POST_ESTABLISHMENT_APPEARANCE') then null
      when d.progression_role = 'EARLY_CAMEO' then d.developmental_arrival_precision::text
      else fm.date_precision::text
    end as dev_precision
  from ladder_players lp
  cross join ladder l
  left join (
    select distinct on (m.player_id, m.event_code)
      m.player_id, m.event_code, m.id, m.milestone_date,
      coalesce(m.season_year, extract(year from m.milestone_date)::int) as season_year, m.date_precision
    from public.development_milestones m
    order by m.player_id, m.event_code, m.milestone_date nulls last, m.season_year
  ) fm on fm.player_id = lp.player_id and fm.event_code = l.event_code
  left join public.development_progression_decisions d on d.player_id = lp.player_id and d.event_code = l.event_code
)
select
  b.player_id, p.slug as player_slug, b.event_code, b.level, b.progression_rank, b.progression_tier,
  b.milestone_id, b.first_appearance_date, b.first_appearance_season, b.first_appearance_precision,
  b.progression_role, b.review_status,
  b.dev_date as developmental_arrival_date, b.dev_season as developmental_arrival_season,
  b.dev_precision as developmental_arrival_precision,
  case
    when b.progression_role = 'REVIEW_REQUIRED' then 'UNRESOLVED'
    when b.dev_season is not null then 'REACHED'
    when max(case when b.dev_season is not null then b.progression_rank end) over (partition by b.player_id) > b.progression_rank
      then 'SKIPPED'
    else 'NOT_REACHED'
  end as development_state
from base b
join public.players p on p.id = b.player_id;

-- ===========================================================================
-- 5. VIEWS (extended, not duplicated)
-- ===========================================================================

-- 5a. Player development summary: the 023 view. first_* and age_at_first_* stay
-- literal first appearances; the elapsed development metrics read developmental
-- arrival; dev_* columns are appended.
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
  public.disi_development_days(sg.signing_date, dev.a_date) as days_signing_to_a_exact,
  public.disi_development_days(sg.signing_date, dev.aa_date) as days_signing_to_aa_exact,
  public.disi_development_days(sg.signing_date, dev.aaa_date) as days_signing_to_aaa_exact,
  public.disi_development_days(sg.signing_date, mlb.milestone_date) as days_signing_to_mlb_exact,
  public.disi_development_years(sg.signing_date, dev.aa_date) as years_signing_to_aa_exact,
  public.disi_development_years(sg.signing_date, mlb.milestone_date) as years_signing_to_mlb_exact,
  public.disi_development_days(dev.a_date, dev.aa_date) as days_a_to_aa_exact,
  public.disi_development_days(dev.aa_date, dev.aaa_date) as days_aa_to_aaa_exact,
  public.disi_development_days(dev.aaa_date, mlb.milestone_date) as days_aaa_to_mlb_exact,
  -- Season-based approximations (labelled; NOT exact elapsed time).
  case when sg.signing_date is not null and dev.a_season is not null
       then dev.a_season - extract(year from sg.signing_date)::int end as approx_years_signing_to_a,
  case when sg.signing_date is not null and dev.aa_season is not null
       then dev.aa_season - extract(year from sg.signing_date)::int end as approx_years_signing_to_aa,
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
  public.disi_development_days(sg.signing_date, dev.high_a_date) as days_signing_to_high_a_exact,
  public.disi_development_years(sg.signing_date, dev.high_a_date) as years_signing_to_high_a_exact,
  public.disi_development_days(dev.a_date, dev.high_a_date) as days_a_to_high_a_exact,
  public.disi_development_days(dev.high_a_date, dev.aa_date) as days_high_a_to_aa_exact,
  -- 024 additions (appended). Developmental arrival per level after reviewed
  -- progression decisions; the first_* columns above stay first appearances.
  dev.a_date as dev_a_date, dev.a_season as dev_a_season, dev.a_state as dev_a_state, dev.a_role as dev_a_role,
  dev.high_a_date as dev_high_a_date, dev.high_a_season as dev_high_a_season, dev.high_a_state as dev_high_a_state, dev.high_a_role as dev_high_a_role,
  dev.aa_date as dev_aa_date, dev.aa_season as dev_aa_season, dev.aa_state as dev_aa_state, dev.aa_role as dev_aa_role,
  dev.aaa_date as dev_aaa_date, dev.aaa_season as dev_aaa_season, dev.aaa_state as dev_aaa_state, dev.aaa_role as dev_aaa_role,
  coalesce(dev.review_pending, false) as progression_review_pending
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
left join (
  select
    pr.player_id,
    max(pr.developmental_arrival_date) filter (where pr.event_code = 'A_DEBUT') as a_date,
    max(pr.developmental_arrival_season) filter (where pr.event_code = 'A_DEBUT') as a_season,
    max(pr.development_state) filter (where pr.event_code = 'A_DEBUT') as a_state,
    max(pr.progression_role) filter (where pr.event_code = 'A_DEBUT') as a_role,
    max(pr.developmental_arrival_date) filter (where pr.event_code = 'HIGH_A_DEBUT') as high_a_date,
    max(pr.developmental_arrival_season) filter (where pr.event_code = 'HIGH_A_DEBUT') as high_a_season,
    max(pr.development_state) filter (where pr.event_code = 'HIGH_A_DEBUT') as high_a_state,
    max(pr.progression_role) filter (where pr.event_code = 'HIGH_A_DEBUT') as high_a_role,
    max(pr.developmental_arrival_date) filter (where pr.event_code = 'AA_DEBUT') as aa_date,
    max(pr.developmental_arrival_season) filter (where pr.event_code = 'AA_DEBUT') as aa_season,
    max(pr.development_state) filter (where pr.event_code = 'AA_DEBUT') as aa_state,
    max(pr.progression_role) filter (where pr.event_code = 'AA_DEBUT') as aa_role,
    max(pr.developmental_arrival_date) filter (where pr.event_code = 'AAA_DEBUT') as aaa_date,
    max(pr.developmental_arrival_season) filter (where pr.event_code = 'AAA_DEBUT') as aaa_season,
    max(pr.development_state) filter (where pr.event_code = 'AAA_DEBUT') as aaa_state,
    max(pr.progression_role) filter (where pr.event_code = 'AAA_DEBUT') as aaa_role,
    bool_or(pr.progression_role = 'REVIEW_REQUIRED') as review_pending
  from public.v_player_development_progression pr
  group by pr.player_id
) dev on dev.player_id = p.id
left join public.player_development_status ds on ds.player_id = p.id
left join lateral (
  select dls.level, max(dls.season) as highest_season
  from public.player_season_stints dls
  where dls.player_id = p.id and dls.affiliated and dls.stint_kind = 'TEAM_STINT'
  group by dls.level, dls.level_rank
  order by coalesce(dls.level_rank, 0) desc
  limit 1
) highest on true
left join lateral (
  select count(distinct s.organization_id)::int as organization_count
  from public.player_season_stints s
  where s.player_id = p.id and s.organization_id is not null and s.stint_kind = 'TEAM_STINT'
) org_changes on true
left join public.outcome_audits oa on oa.player_id = p.id;

-- 5b. Development by signing class / market / bonus band: the 021 views with the
-- first-appearance columns kept for compatibility and developmental counts appended.
create or replace view public.v_dodgers_development_by_signing_class
with (security_invoker = true)
as
select
  sg.signing_year,
  count(distinct sg.player_id)::int as tracked_players,
  -- reached_* (021 names, kept for compatibility) count FIRST APPEARANCES with
  -- any evidence. Developmental counts are the appended developmentally_reached_*
  -- columns. The median columns below stay exact-date only.
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
  'Counts describe the tracked players in this signing class, not the full signing period. Median times are exact-date measures over the subset with both dates; the n columns say how many.' as cohort_note,
  -- 024 additions (appended): developmental arrival after reviewed progression
  -- decisions. A pending (REVIEW_REQUIRED) level is not counted as reached.
  count(distinct sg.player_id) filter (where dsum.dev_a_state = 'REACHED')::int as developmentally_reached_a,
  count(distinct sg.player_id) filter (where dsum.dev_high_a_state = 'REACHED')::int as developmentally_reached_high_a,
  count(distinct sg.player_id) filter (where dsum.dev_aa_state = 'REACHED')::int as developmentally_reached_aa,
  count(distinct sg.player_id) filter (where dsum.dev_aaa_state = 'REACHED')::int as developmentally_reached_aaa,
  count(distinct sg.player_id) filter (where dsum.progression_review_pending)::int as progression_review_pending_players
from public.signings sg
join public.organizations o on o.id = sg.organization_id
left join public.v_dodgers_player_development_summary dsum on dsum.player_id = sg.player_id
where o.franchise_key = 'DODGERS'
group by sg.signing_year;

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
  'Tracked players only. Descriptive comparison of where players were signed; no causal interpretation is implied.' as analysis_note,
  -- 024 additions (appended): developmental arrival; *_reach_count are first appearances.
  count(distinct dsum.player_id) filter (where dsum.dev_aa_state = 'REACHED')::int as developmentally_reached_aa,
  count(distinct dsum.player_id) filter (where dsum.dev_aaa_state = 'REACHED')::int as developmentally_reached_aaa,
  count(distinct dsum.player_id) filter (where dsum.progression_review_pending)::int as progression_review_pending_players
from public.signings sg
join public.players p on p.id = sg.player_id
join public.organizations o on o.id = sg.organization_id
left join public.v_dodgers_player_development_summary dsum on dsum.player_id = sg.player_id
where o.franchise_key = 'DODGERS'
group by sg.country_market;

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
  'Tracked-cohort measures. Unknown acquisition cost stays its own band; it is not $0 and not imputed.' as scope_note,
  -- 024 additions (appended): developmental arrival; reached_aa / reached_aaa are first appearances.
  count(distinct dsum.player_id) filter (where dsum.dev_aa_state = 'REACHED')::int as developmentally_reached_aa,
  count(distinct dsum.player_id) filter (where dsum.dev_aaa_state = 'REACHED')::int as developmentally_reached_aaa,
  count(distinct dsum.player_id) filter (where dsum.progression_review_pending)::int as progression_review_pending_players
from public.signings sg
join public.organizations o on o.id = sg.organization_id
left join public.v_dodgers_player_development_summary dsum on dsum.player_id = sg.player_id
where o.franchise_key = 'DODGERS'
group by 1;

-- The 021 column names say "reached"; after 024 that word means developmental
-- arrival. The columns keep their values for existing consumers and are labelled
-- here as first appearances.
comment on column public.v_dodgers_development_by_signing_class.reached_a is 'Players with a recorded FIRST APPEARANCE at A (any evidence). Not developmental arrival: see developmentally_reached_a.';
comment on column public.v_dodgers_development_by_signing_class.reached_high_a is 'Players with a recorded FIRST APPEARANCE at High-A (any evidence). Not developmental arrival: see developmentally_reached_high_a.';
comment on column public.v_dodgers_development_by_signing_class.reached_aa is 'Players with a recorded FIRST APPEARANCE at AA (any evidence). Not developmental arrival: see developmentally_reached_aa.';
comment on column public.v_dodgers_development_by_signing_class.reached_aaa is 'Players with a recorded FIRST APPEARANCE at AAA (any evidence). Not developmental arrival: see developmentally_reached_aaa.';
comment on column public.v_dodgers_development_by_market.aa_reach_count is 'Players with a recorded FIRST APPEARANCE at AA. Not developmental arrival: see developmentally_reached_aa.';
comment on column public.v_dodgers_development_by_market.aaa_reach_count is 'Players with a recorded FIRST APPEARANCE at AAA. Not developmental arrival: see developmentally_reached_aaa.';
comment on column public.v_dodgers_development_by_bonus_band.reached_aa is 'Players with a recorded FIRST APPEARANCE at AA. Not developmental arrival: see developmentally_reached_aa.';
comment on column public.v_dodgers_development_by_bonus_band.reached_aaa is 'Players with a recorded FIRST APPEARANCE at AAA. Not developmental arrival: see developmentally_reached_aaa.';
comment on column public.v_dodgers_development_by_signing_class.developmentally_reached_aa is 'Players whose AA developmental arrival is REACHED after reviewed progression decisions; a pending review is not counted.';
comment on column public.v_dodgers_development_by_signing_class.developmentally_reached_aaa is 'Players whose AAA developmental arrival is REACHED after reviewed progression decisions; a pending review is not counted.';

-- 5c. Research queue: the 023 queue plus NON_MONOTONIC_PROGRESSION and
-- LEVEL_SKIP_CAMEO_CANDIDATE.
create or replace view public.v_dodgers_development_research_queue
with (security_invoker = true)
as
with team_stints as (
  -- 023: a season-total row repeats its component team stints, so it never
  -- counts as development history, a missing date or an unresolved organization.
  select * from public.player_season_stints where stint_kind = 'TEAM_STINT'
),
-- 024: developmental inversions - two REACHED levels whose arrivals run backward
-- (rookie levels share one tier). Reviewed decisions change arrivals, so a
-- covered inversion no longer appears here.
progression as (
  select * from public.v_player_development_progression
),
inverted as (
  select distinct lo.player_id
  from progression lo
  join progression hi on hi.player_id = lo.player_id and hi.progression_tier > lo.progression_tier
  where lo.development_state = 'REACHED' and hi.development_state = 'REACHED'
    and case when lo.developmental_arrival_date is not null and hi.developmental_arrival_date is not null
             then lo.developmental_arrival_date > hi.developmental_arrival_date
             else lo.developmental_arrival_season > hi.developmental_arrival_season end
),
base as (
  select
    p.id as player_id,
    p.slug as player_slug,
    p.full_name,
    p.mlb_id,
    sg.signing_year,
    (select max(s.as_of_date) from team_stints s where s.player_id = p.id) as last_research_date,
    (select count(distinct s.season)::int from team_stints s where s.player_id = p.id) as stint_count,
    exists (select 1 from team_stints s where s.player_id = p.id) as has_stints,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.level_classification in ('UNRECOGNIZED_SPORT','UNKNOWN_ROOKIE_LEAGUE')
    ) as has_unknown_level,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.organization_id is null
        and s.level <> 'FOREIGN_PRO' -- foreign clubs are organization-unmapped by design
    ) as has_unresolved_organization,
    exists (
      select 1 from team_stints s1
      join team_stints s2
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
      select 1 from team_stints s
      where s.player_id = p.id and s.level <> 'MLB'
    ) as no_pre_mlb_history,
    -- 022 date-coverage facts
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.season >= 2006 and s.first_game_date is null
    ) as has_undated_log_era_stint,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.season >= 2006 and s.last_game_date is null
    ) as has_stint_missing_last_date,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.season >= 2006 and s.first_game_date is not null
    ) as has_any_dated_stint,
    exists (
      select 1 from team_stints s
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
      select 1 from team_stints s
      where s.player_id = p.id and s.level <> 'MLB' and s.affiliated
    ) as has_pre_mlb_history,
    -- 024 progression facts
    p.id in (select player_id from inverted) as has_non_monotonic_progression,
    -- Heuristic candidate only (never changes analytics): an undecided High-A/AA/AAA
    -- first appearance with no first appearance at the level below on or before
    -- it, and at most 2 team-stint games at the level.
    exists (
      select 1 from public.development_milestones m
      join (values ('HIGH_A_DEBUT', 'A_DEBUT', 'HIGH_A'), ('AA_DEBUT', 'HIGH_A_DEBUT', 'AA'), ('AAA_DEBUT', 'AA_DEBUT', 'AAA'))
        as k(event_code, below_event, level) on k.event_code = m.event_code
      where m.player_id = p.id
        and not exists (select 1 from public.development_progression_decisions d
                        where d.player_id = m.player_id and d.event_code = m.event_code)
        and not exists (
          select 1 from public.development_milestones b
          where b.player_id = m.player_id and b.event_code = k.below_event
            and case when b.milestone_date is not null and m.milestone_date is not null
                     then b.milestone_date <= m.milestone_date
                     else coalesce(b.season_year, extract(year from b.milestone_date)::int)
                          <= coalesce(m.season_year, extract(year from m.milestone_date)::int) end)
        and (select coalesce(sum(coalesce(s.g, s.pg)), 0) from team_stints s
             where s.player_id = m.player_id and s.level::text = k.level) <= 2
    ) as has_level_skip_cameo_candidate
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
      'A stint with an unclassified level has no dated appearances; game dates cannot be attributed to it'),
    ('NON_MONOTONIC_PROGRESSION', 1,
      'Developmental arrivals run backward (a lower level after a higher one) and no reviewed progression decision covers it'),
    ('LEVEL_SKIP_CAMEO_CANDIDATE', 2,
      'Heuristic only: a 1-2 game High-A/AA/AAA first appearance skipping the level below, with no reviewed decision; analytics are unchanged until reviewed')
  ) as v(issue, priority, detail)
) issues
where (issue = 'IDENTITY_BUT_NO_PROFESSIONAL_SEASONS' and mlb_id is not null and not has_stints)
   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2
       and (select max(s.season) - min(s.season) + 1 from team_stints s where s.player_id = base.player_id) > stint_count)
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
   or (issue = 'UNKNOWN_LEVEL_GAME_LOG' and has_unknown_level_undated)
   or (issue = 'NON_MONOTONIC_PROGRESSION' and has_non_monotonic_progression)
   or (issue = 'LEVEL_SKIP_CAMEO_CANDIDATE' and has_level_skip_cameo_candidate);

-- ===========================================================================
-- 6. CURRENT DEVELOPMENT STATUS (highest unambiguously established level)
-- ===========================================================================
-- Status = the highest unambiguously established developmental level. Pending
-- milestones do not count as reached and do not invalidate a separately
-- verified higher level. This is the 023 derivation (a verified MLB outcome
-- still yields MLB) with the stint-based level restricted to levels whose
-- arrival is established: a level whose first appearance is an EARLY_CAMEO with
-- no reviewed arrival, a POST_ESTABLISHMENT_APPEARANCE or a REVIEW_REQUIRED
-- event does not count. A pending level is unknown: it neither raises the status
-- nor is asserted as not reached, and the note names the levels pending review.
-- highest_affiliated_level in the summary stays appearance-based.

with team_stints as (
  select * from public.player_season_stints where stint_kind = 'TEAM_STINT'
)
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
  coalesce((select max(s.as_of_date) from team_stints s where s.player_id = pl.id), current_date),
  case
    when audited.reached_mlb_verified is true then null
    when highest.level is not null then 'Highest affiliated level reached: ' || highest.level
      || coalesce(' (unambiguous); progression pending review: ' || pending.events, '')
    when foreign_after.last_season is not null then 'Professional play recorded outside affiliated baseball'
    else 'No professional seasons recorded in the sources reviewed'
  end
from public.players pl
left join lateral (
  select dls.level, dls.level_rank as affiliated_rank, max(dls.season) as last_season
  from team_stints dls
  where dls.player_id = pl.id and dls.affiliated and dls.level <> 'MLB'
    -- 024: a level the player has not developmentally reached does not count
    and not exists (
      select 1 from public.development_progression_decisions d
      where d.player_id = pl.id
        and d.event_code = case dls.level::text
          when 'INTERNATIONAL_ROOKIE' then 'DSL_DEBUT' when 'COMPLEX_ROOKIE' then 'COMPLEX_DEBUT'
          when 'LOW_A' then 'A_DEBUT' when 'A' then 'A_DEBUT' when 'HIGH_A' then 'HIGH_A_DEBUT'
          when 'AA' then 'AA_DEBUT' when 'AAA' then 'AAA_DEBUT' end
        and (d.progression_role in ('POST_ESTABLISHMENT_APPEARANCE', 'REVIEW_REQUIRED')
          or (d.progression_role = 'EARLY_CAMEO' and d.developmental_arrival_season is null)))
  group by dls.level, dls.level_rank
  order by dls.level_rank desc, last_season desc
  limit 1
) highest on true
left join lateral (
  select max(dls.season) as last_season
  from team_stints dls
  where dls.player_id = pl.id and not dls.affiliated
) foreign_after on true
left join lateral (
  select oa.reached_mlb_verified
  from public.outcome_audits oa
  where oa.player_id = pl.id
  order by oa.audited_through_date desc
  limit 1
) audited on true
left join lateral (
  select string_agg(d.event_code, ', ' order by array_position(
    array['DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT', 'MLB_DEBUT'], d.event_code)) as events
  from public.development_progression_decisions d
  where d.player_id = pl.id and d.progression_role = 'REVIEW_REQUIRED'
) pending on true
where pl.id in (select player_id from team_stints)
   or audited.reached_mlb_verified is true
on conflict (player_id) do update
set status = excluded.status,
    basis = excluded.basis,
    status_season = excluded.status_season,
    as_of_date = excluded.as_of_date,
    note = excluded.note
where (public.player_development_status.status, public.player_development_status.basis,
       public.player_development_status.status_season, public.player_development_status.note)
  is distinct from (excluded.status, excluded.basis, excluded.status_season, excluded.note);

-- ===========================================================================
-- 7. GRANTS (explicit; never rely on Supabase default privileges)
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'player_season_stints', 'player_development_status', 'development_levels',
    'development_level_era_map', 'development_event_codes', 'development_progression_decisions',
    'v_dodgers_player_development_summary', 'v_player_development_stints', 'v_player_development_milestones',
    'v_dodgers_development_by_signing_class', 'v_dodgers_development_by_market', 'v_dodgers_development_by_bonus_band',
    'v_dodgers_development_research_queue', 'v_dodgers_development_coverage', 'v_dodgers_development_date_coverage',
    'v_player_development_progression'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

commit;
