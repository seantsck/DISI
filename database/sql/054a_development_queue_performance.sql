-- DISI v0.39.1
-- 054a_development_queue_performance.sql
-- Post-054 performance correction, applied after 054 and before any 055. Query shape only: v_dodgers_development_research_queue keeps its
-- columns, types, rows, labels, grants, comment and security_invoker behaviour; no table, fact, function, index, policy, grant, contract or
-- snapshot changes.
--
-- Why. The 054 definition names its team_stints CTE about forty times, so PostgreSQL materializes it once and every per-player subquery rescans
-- the whole materialized set (1739 team stints) without an index. On the hosted database (work_mem 2 MB) that set spills to disk: as anon the view
-- ran about 1.3 s with about 687,810 temp buffers read (about 5.4 GB) per read, and the first /development request after the 054 freeze deployment
-- exceeded the anon 3 s statement timeout (57014). Marking the CTE NOT MATERIALIZED lets the planner inline it into each subquery and use
-- player_season_stints_player_idx (player_id, season): about 55 ms with no temp I/O, planning about 18 MB, the same 128 rows.
--
-- The one change: `with team_stints as (` becomes `with team_stints as not materialized (`. Every other byte of the view is the 054 text.
-- Built from database/research/054a/ (054a_template.sql, build.mjs), which read the view from the frozen 054 file. Do not edit by hand.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. THE TWO DEFINITIONS, AS TEMPORARY VIEWS (deparsed by this server, so the comparison holds on any PostgreSQL version)
-- ===========================================================================

create temporary view _q054 as
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
    ) as has_level_skip_cameo_candidate,
    -- 052: a season with no record between the first and last recorded seasons, unless the league did not play it. The official schedule holds no
    -- 2020 regular-season game at any affiliated minor-league level, so 2020 is explained for an affiliated minor leaguer: his last recorded
    -- season before it is affiliated minor-league play only and he has no major-league stint by then (the 2020 major-league season was played).
    -- LEAGUE SEASON NOT PLAYED != MISSING PLAYER SEASON; every other missing season stays a research need (SEASON GAP != DID NOT PLAY).
    exists (
      select 1
      from generate_series((select min(s.season) from team_stints s where s.player_id = p.id) + 1,
                           (select max(s.season) from team_stints s where s.player_id = p.id) - 1) as y(season)
      where not exists (select 1 from team_stints s where s.player_id = p.id and s.season = y.season)
        and not (y.season = 2020
                 and not exists (select 1 from team_stints s where s.player_id = p.id and s.level = 'MLB' and s.season <= y.season)
                 and not exists (
                   select 1 from team_stints s
                   where s.player_id = p.id
                     and s.season = (select max(b.season) from team_stints b where b.player_id = p.id and b.season < y.season)
                     and not (s.affiliated and s.level <> 'MLB')))
    ) as has_open_season_gap,
    -- 052: a season with two or more organizations stays a research need unless exactly two organizations appear, every stint of the season is
    -- game-dated, and one canonical transaction of this player moves him from the first to the second inside that season with his last
    -- appearance for the first on or before the transaction date and his first for the second on or after it. A team change is never a
    -- transaction (TEAM CHANGE != CANONICAL TRANSACTION); the transaction date and the two appearance dates stay three facts.
    -- 053: the direction is the player's, read from his asset side (the ledger records every transaction from the Dodgers' side: an INCOMING
    -- player came from the counterparty to the Dodgers), and a transaction with one known end brackets the Dodgers boundary of the move: a
    -- Dodgers release, free agency or waiver without a counterparty after his last game for the Dodgers and before his first for the other club,
    -- or a Dodgers free-agent signing after his last game for the other club and before his first for the Dodgers. The other club's signing or
    -- release is not a Dodgers transaction and is never implied. Exactly one bracketing transaction closes the season; two or more stay open
    -- for a person to decide (lib/research/development-chronology.js mirrors this rule).
    -- 054: a move between two clubs other than the Dodgers is explained by career history (player_career_transactions), never by the Dodgers
    -- ledger: a direct move from the first club to the second (a trade, a waiver claim, a purchase), or the player leaving the first club and later
    -- joining the second (two facts: a release or a move to a third club, then a signing or a move from a third club), each between his last game
    -- for the first and his first for the second. The clubs are ordered by first appearance. Career history explains development chronology only:
    -- no asset, package, control-interval or value view reads it.
    exists (
      select 1
      from (
        select s.season from team_stints s
        where s.player_id = p.id and s.organization_id is not null
        group by s.season
        having count(distinct s.organization_id) >= 2
      ) ms
      cross join lateral (
        select
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name limit 1) as org_a,
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name offset 1 limit 1) as org_b
      ) ord0
      cross join lateral (
        select ord0.org_a, ord0.org_b,
          (select max(s.last_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_a) as last_a,
          (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_b) as first_b
      ) ord
      where not (
        (select count(distinct s.organization_id) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id is not null) = 2
        and not exists (
          select 1 from team_stints s
          where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            and (s.first_game_date is null or s.last_game_date is null))
        and ((
          select count(distinct e.id)
          from public.transaction_event_assets a
          join public.transaction_events e on e.id = a.event_id
          cross join lateral (
            select case when a.asset_side = 'INCOMING' then e.to_organization_id else e.from_organization_id end as from_known,
                   case when a.asset_side = 'INCOMING' then e.from_organization_id else e.to_organization_id end as to_known
          ) k
          cross join lateral (
            select coalesce(k.from_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                             and s.organization_id is not null and s.organization_id <> k.to_known limit 1)) as from_org,
                   coalesce(k.to_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                           and s.organization_id is not null and s.organization_id <> k.from_known limit 1)) as to_org,
                   (k.from_known is null or k.to_known is null) as boundary
          ) mv
          where a.player_id = p.id
            and extract(year from e.transaction_date)::int = ms.season
            and e.from_organization_id is not null
            and k.from_known is distinct from k.to_known
            and (k.from_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.from_known))
            and (k.to_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.to_known))
            and (not mv.boundary
                 or (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org)
                    <= (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org))
            and (select max(s.last_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org) <= e.transaction_date
            and (select min(s.first_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org) >= e.transaction_date)
          + (select count(*) from public.player_career_transactions c
              where c.player_id = p.id and extract(year from c.transaction_date)::int = ms.season
                and c.from_organization_id = ord.org_a and c.to_organization_id = ord.org_b
                and c.transaction_date >= ord.last_a and c.transaction_date <= ord.first_b)
          + (select count(*) from public.player_career_transactions x
              join public.player_career_transactions y on y.player_id = x.player_id and y.id <> x.id
              where x.player_id = p.id and extract(year from x.transaction_date)::int = ms.season and extract(year from y.transaction_date)::int = ms.season
                and x.from_organization_id = ord.org_a and x.to_organization_id is distinct from ord.org_b
                and y.to_organization_id = ord.org_b and y.from_organization_id is distinct from ord.org_a
                and x.transaction_date >= ord.last_a and x.transaction_date <= ord.first_b
                and y.transaction_date >= ord.last_a and y.transaction_date <= ord.first_b
                and x.transaction_date <= y.transaction_date)
          ) = 1)
    ) as has_unverified_multi_org_season
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
      'A season between the first and last recorded seasons has no record and is not a league season that was not played'),
    ('UNKNOWN_LEVEL_CLASSIFICATION', 2,
      'A stint could not be classified into the canonical level taxonomy'),
    ('UNRESOLVED_ORGANIZATION', 2,
      'A stint has no organization resolved from its team/league/season'),
    ('MULTI_ORG_SEASON_UNVERIFIED', 1,
      'Two or more organizations appear in one season and no canonical transaction bracketed by game dates explains the move'),
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
   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2 and has_open_season_gap)
   or (issue = 'UNKNOWN_LEVEL_CLASSIFICATION' and has_unknown_level)
   or (issue = 'UNRESOLVED_ORGANIZATION' and has_unresolved_organization)
   or (issue = 'MULTI_ORG_SEASON_UNVERIFIED' and has_unverified_multi_org_season)
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

create temporary view _q054a as
with team_stints as not materialized (
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
    ) as has_level_skip_cameo_candidate,
    -- 052: a season with no record between the first and last recorded seasons, unless the league did not play it. The official schedule holds no
    -- 2020 regular-season game at any affiliated minor-league level, so 2020 is explained for an affiliated minor leaguer: his last recorded
    -- season before it is affiliated minor-league play only and he has no major-league stint by then (the 2020 major-league season was played).
    -- LEAGUE SEASON NOT PLAYED != MISSING PLAYER SEASON; every other missing season stays a research need (SEASON GAP != DID NOT PLAY).
    exists (
      select 1
      from generate_series((select min(s.season) from team_stints s where s.player_id = p.id) + 1,
                           (select max(s.season) from team_stints s where s.player_id = p.id) - 1) as y(season)
      where not exists (select 1 from team_stints s where s.player_id = p.id and s.season = y.season)
        and not (y.season = 2020
                 and not exists (select 1 from team_stints s where s.player_id = p.id and s.level = 'MLB' and s.season <= y.season)
                 and not exists (
                   select 1 from team_stints s
                   where s.player_id = p.id
                     and s.season = (select max(b.season) from team_stints b where b.player_id = p.id and b.season < y.season)
                     and not (s.affiliated and s.level <> 'MLB')))
    ) as has_open_season_gap,
    -- 052: a season with two or more organizations stays a research need unless exactly two organizations appear, every stint of the season is
    -- game-dated, and one canonical transaction of this player moves him from the first to the second inside that season with his last
    -- appearance for the first on or before the transaction date and his first for the second on or after it. A team change is never a
    -- transaction (TEAM CHANGE != CANONICAL TRANSACTION); the transaction date and the two appearance dates stay three facts.
    -- 053: the direction is the player's, read from his asset side (the ledger records every transaction from the Dodgers' side: an INCOMING
    -- player came from the counterparty to the Dodgers), and a transaction with one known end brackets the Dodgers boundary of the move: a
    -- Dodgers release, free agency or waiver without a counterparty after his last game for the Dodgers and before his first for the other club,
    -- or a Dodgers free-agent signing after his last game for the other club and before his first for the Dodgers. The other club's signing or
    -- release is not a Dodgers transaction and is never implied. Exactly one bracketing transaction closes the season; two or more stay open
    -- for a person to decide (lib/research/development-chronology.js mirrors this rule).
    -- 054: a move between two clubs other than the Dodgers is explained by career history (player_career_transactions), never by the Dodgers
    -- ledger: a direct move from the first club to the second (a trade, a waiver claim, a purchase), or the player leaving the first club and later
    -- joining the second (two facts: a release or a move to a third club, then a signing or a move from a third club), each between his last game
    -- for the first and his first for the second. The clubs are ordered by first appearance. Career history explains development chronology only:
    -- no asset, package, control-interval or value view reads it.
    exists (
      select 1
      from (
        select s.season from team_stints s
        where s.player_id = p.id and s.organization_id is not null
        group by s.season
        having count(distinct s.organization_id) >= 2
      ) ms
      cross join lateral (
        select
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name limit 1) as org_a,
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name offset 1 limit 1) as org_b
      ) ord0
      cross join lateral (
        select ord0.org_a, ord0.org_b,
          (select max(s.last_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_a) as last_a,
          (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_b) as first_b
      ) ord
      where not (
        (select count(distinct s.organization_id) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id is not null) = 2
        and not exists (
          select 1 from team_stints s
          where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            and (s.first_game_date is null or s.last_game_date is null))
        and ((
          select count(distinct e.id)
          from public.transaction_event_assets a
          join public.transaction_events e on e.id = a.event_id
          cross join lateral (
            select case when a.asset_side = 'INCOMING' then e.to_organization_id else e.from_organization_id end as from_known,
                   case when a.asset_side = 'INCOMING' then e.from_organization_id else e.to_organization_id end as to_known
          ) k
          cross join lateral (
            select coalesce(k.from_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                             and s.organization_id is not null and s.organization_id <> k.to_known limit 1)) as from_org,
                   coalesce(k.to_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                           and s.organization_id is not null and s.organization_id <> k.from_known limit 1)) as to_org,
                   (k.from_known is null or k.to_known is null) as boundary
          ) mv
          where a.player_id = p.id
            and extract(year from e.transaction_date)::int = ms.season
            and e.from_organization_id is not null
            and k.from_known is distinct from k.to_known
            and (k.from_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.from_known))
            and (k.to_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.to_known))
            and (not mv.boundary
                 or (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org)
                    <= (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org))
            and (select max(s.last_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org) <= e.transaction_date
            and (select min(s.first_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org) >= e.transaction_date)
          + (select count(*) from public.player_career_transactions c
              where c.player_id = p.id and extract(year from c.transaction_date)::int = ms.season
                and c.from_organization_id = ord.org_a and c.to_organization_id = ord.org_b
                and c.transaction_date >= ord.last_a and c.transaction_date <= ord.first_b)
          + (select count(*) from public.player_career_transactions x
              join public.player_career_transactions y on y.player_id = x.player_id and y.id <> x.id
              where x.player_id = p.id and extract(year from x.transaction_date)::int = ms.season and extract(year from y.transaction_date)::int = ms.season
                and x.from_organization_id = ord.org_a and x.to_organization_id is distinct from ord.org_b
                and y.to_organization_id = ord.org_b and y.from_organization_id is distinct from ord.org_a
                and x.transaction_date >= ord.last_a and x.transaction_date <= ord.first_b
                and y.transaction_date >= ord.last_a and y.transaction_date <= ord.first_b
                and x.transaction_date <= y.transaction_date)
          ) = 1)
    ) as has_unverified_multi_org_season
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
      'A season between the first and last recorded seasons has no record and is not a league season that was not played'),
    ('UNKNOWN_LEVEL_CLASSIFICATION', 2,
      'A stint could not be classified into the canonical level taxonomy'),
    ('UNRESOLVED_ORGANIZATION', 2,
      'A stint has no organization resolved from its team/league/season'),
    ('MULTI_ORG_SEASON_UNVERIFIED', 1,
      'Two or more organizations appear in one season and no canonical transaction bracketed by game dates explains the move'),
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
   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2 and has_open_season_gap)
   or (issue = 'UNKNOWN_LEVEL_CLASSIFICATION' and has_unknown_level)
   or (issue = 'UNRESOLVED_ORGANIZATION' and has_unresolved_organization)
   or (issue = 'MULTI_ORG_SEASON_UNVERIFIED' and has_unverified_multi_org_season)
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

create temporary table _m054a_before on commit drop as
select coalesce(c.relacl::text, '') as acl, coalesce(array_to_string(c.reloptions, ','), '') as opts,
  obj_description(c.oid, 'pg_class') as note, c.relowner
from pg_class c where c.oid = 'public.v_dodgers_development_research_queue'::regclass;

-- ===========================================================================
-- 1. PRECONDITIONS: exactly the 054 view (or this one, on a rerun)
-- ===========================================================================

do $$
declare
  d text;
begin
  if to_regclass('public.player_career_transactions') is null or to_regclass('public.v_player_career_transactions') is null then
    raise exception '054a: Migration 054 has not been applied';
  end if;
  d := pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass);
  if d is distinct from pg_get_viewdef('pg_temp._q054'::regclass) and d is distinct from pg_get_viewdef('pg_temp._q054a'::regclass) then
    raise exception '054a: v_dodgers_development_research_queue is not the 054 definition';
  end if;
  if (select opts from _m054a_before) !~ 'security_invoker=(true|on)' then
    raise exception '054a: v_dodgers_development_research_queue is not security_invoker';
  end if;
end $$;

-- ===========================================================================
-- 2. THE RESEARCH QUEUE: the 054 view with team_stints NOT MATERIALIZED
-- ===========================================================================

create or replace view public.v_dodgers_development_research_queue
with (security_invoker = true)
as
with team_stints as not materialized (
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
    ) as has_level_skip_cameo_candidate,
    -- 052: a season with no record between the first and last recorded seasons, unless the league did not play it. The official schedule holds no
    -- 2020 regular-season game at any affiliated minor-league level, so 2020 is explained for an affiliated minor leaguer: his last recorded
    -- season before it is affiliated minor-league play only and he has no major-league stint by then (the 2020 major-league season was played).
    -- LEAGUE SEASON NOT PLAYED != MISSING PLAYER SEASON; every other missing season stays a research need (SEASON GAP != DID NOT PLAY).
    exists (
      select 1
      from generate_series((select min(s.season) from team_stints s where s.player_id = p.id) + 1,
                           (select max(s.season) from team_stints s where s.player_id = p.id) - 1) as y(season)
      where not exists (select 1 from team_stints s where s.player_id = p.id and s.season = y.season)
        and not (y.season = 2020
                 and not exists (select 1 from team_stints s where s.player_id = p.id and s.level = 'MLB' and s.season <= y.season)
                 and not exists (
                   select 1 from team_stints s
                   where s.player_id = p.id
                     and s.season = (select max(b.season) from team_stints b where b.player_id = p.id and b.season < y.season)
                     and not (s.affiliated and s.level <> 'MLB')))
    ) as has_open_season_gap,
    -- 052: a season with two or more organizations stays a research need unless exactly two organizations appear, every stint of the season is
    -- game-dated, and one canonical transaction of this player moves him from the first to the second inside that season with his last
    -- appearance for the first on or before the transaction date and his first for the second on or after it. A team change is never a
    -- transaction (TEAM CHANGE != CANONICAL TRANSACTION); the transaction date and the two appearance dates stay three facts.
    -- 053: the direction is the player's, read from his asset side (the ledger records every transaction from the Dodgers' side: an INCOMING
    -- player came from the counterparty to the Dodgers), and a transaction with one known end brackets the Dodgers boundary of the move: a
    -- Dodgers release, free agency or waiver without a counterparty after his last game for the Dodgers and before his first for the other club,
    -- or a Dodgers free-agent signing after his last game for the other club and before his first for the Dodgers. The other club's signing or
    -- release is not a Dodgers transaction and is never implied. Exactly one bracketing transaction closes the season; two or more stay open
    -- for a person to decide (lib/research/development-chronology.js mirrors this rule).
    -- 054: a move between two clubs other than the Dodgers is explained by career history (player_career_transactions), never by the Dodgers
    -- ledger: a direct move from the first club to the second (a trade, a waiver claim, a purchase), or the player leaving the first club and later
    -- joining the second (two facts: a release or a move to a third club, then a signing or a move from a third club), each between his last game
    -- for the first and his first for the second. The clubs are ordered by first appearance. Career history explains development chronology only:
    -- no asset, package, control-interval or value view reads it.
    exists (
      select 1
      from (
        select s.season from team_stints s
        where s.player_id = p.id and s.organization_id is not null
        group by s.season
        having count(distinct s.organization_id) >= 2
      ) ms
      cross join lateral (
        select
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name limit 1) as org_a,
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name offset 1 limit 1) as org_b
      ) ord0
      cross join lateral (
        select ord0.org_a, ord0.org_b,
          (select max(s.last_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_a) as last_a,
          (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_b) as first_b
      ) ord
      where not (
        (select count(distinct s.organization_id) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id is not null) = 2
        and not exists (
          select 1 from team_stints s
          where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            and (s.first_game_date is null or s.last_game_date is null))
        and ((
          select count(distinct e.id)
          from public.transaction_event_assets a
          join public.transaction_events e on e.id = a.event_id
          cross join lateral (
            select case when a.asset_side = 'INCOMING' then e.to_organization_id else e.from_organization_id end as from_known,
                   case when a.asset_side = 'INCOMING' then e.from_organization_id else e.to_organization_id end as to_known
          ) k
          cross join lateral (
            select coalesce(k.from_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                             and s.organization_id is not null and s.organization_id <> k.to_known limit 1)) as from_org,
                   coalesce(k.to_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                           and s.organization_id is not null and s.organization_id <> k.from_known limit 1)) as to_org,
                   (k.from_known is null or k.to_known is null) as boundary
          ) mv
          where a.player_id = p.id
            and extract(year from e.transaction_date)::int = ms.season
            and e.from_organization_id is not null
            and k.from_known is distinct from k.to_known
            and (k.from_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.from_known))
            and (k.to_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.to_known))
            and (not mv.boundary
                 or (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org)
                    <= (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org))
            and (select max(s.last_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org) <= e.transaction_date
            and (select min(s.first_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org) >= e.transaction_date)
          + (select count(*) from public.player_career_transactions c
              where c.player_id = p.id and extract(year from c.transaction_date)::int = ms.season
                and c.from_organization_id = ord.org_a and c.to_organization_id = ord.org_b
                and c.transaction_date >= ord.last_a and c.transaction_date <= ord.first_b)
          + (select count(*) from public.player_career_transactions x
              join public.player_career_transactions y on y.player_id = x.player_id and y.id <> x.id
              where x.player_id = p.id and extract(year from x.transaction_date)::int = ms.season and extract(year from y.transaction_date)::int = ms.season
                and x.from_organization_id = ord.org_a and x.to_organization_id is distinct from ord.org_b
                and y.to_organization_id = ord.org_b and y.from_organization_id is distinct from ord.org_a
                and x.transaction_date >= ord.last_a and x.transaction_date <= ord.first_b
                and y.transaction_date >= ord.last_a and y.transaction_date <= ord.first_b
                and x.transaction_date <= y.transaction_date)
          ) = 1)
    ) as has_unverified_multi_org_season
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
      'A season between the first and last recorded seasons has no record and is not a league season that was not played'),
    ('UNKNOWN_LEVEL_CLASSIFICATION', 2,
      'A stint could not be classified into the canonical level taxonomy'),
    ('UNRESOLVED_ORGANIZATION', 2,
      'A stint has no organization resolved from its team/league/season'),
    ('MULTI_ORG_SEASON_UNVERIFIED', 1,
      'Two or more organizations appear in one season and no canonical transaction bracketed by game dates explains the move'),
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
   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2 and has_open_season_gap)
   or (issue = 'UNKNOWN_LEVEL_CLASSIFICATION' and has_unknown_level)
   or (issue = 'UNRESOLVED_ORGANIZATION' and has_unresolved_organization)
   or (issue = 'MULTI_ORG_SEASON_UNVERIFIED' and has_unverified_multi_org_season)
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
-- 3. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  n bigint;
  b record;
begin
  select * into b from _m054a_before;
  if pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass) is distinct from pg_get_viewdef('pg_temp._q054a'::regclass) then
    raise exception '054a postcondition: the research queue is not the 054a definition';
  end if;
  -- the same rows as the 054 query on this database, as a multiset (every column, duplicates counted)
  select count(*) into n from (
    (select * from public.v_dodgers_development_research_queue except all select * from pg_temp._q054)
    union all
    (select * from pg_temp._q054 except all select * from public.v_dodgers_development_research_queue)) x;
  if n <> 0 then
    raise exception '054a postcondition: % rows differ from the 054 research queue', n;
  end if;
  if (select count(*) from public.v_dodgers_development_research_queue) <> (select count(*) from pg_temp._q054) then
    raise exception '054a postcondition: the row count differs from the 054 research queue';
  end if;
  -- grants, options, comment and owner are what they were
  if (select row(coalesce(c.relacl::text, ''), coalesce(array_to_string(c.reloptions, ','), ''), obj_description(c.oid, 'pg_class'), c.relowner)
        from pg_class c where c.oid = 'public.v_dodgers_development_research_queue'::regclass)
     is distinct from row(b.acl, b.opts, b.note, b.relowner) then
    raise exception '054a postcondition: a grant, option, comment or owner of the research queue changed';
  end if;
  -- no snapshot reads a different answer, so none is refreshed (the generation stays)
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception '054a postcondition: a product snapshot drifted';
  end if;
end $$;

drop view pg_temp._q054a;
drop view pg_temp._q054;

commit;
