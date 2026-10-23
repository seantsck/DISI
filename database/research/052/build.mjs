#!/usr/bin/env node
// Builds database/sql/052_development_taxonomy_chronology_resolution.sql and database/release/sql/rollback-052.sql from the reviewed values in
// migration-values.json (written by derive.mjs). Deterministic: the same values give the same bytes.
//
//   node database/research/052/build.mjs
//
// The research-queue view is taken from the frozen Migration 024 file itself: 052 changes exactly two detector conditions (SEASON_GAP and
// MULTI_ORG_SEASON_UNVERIFIED), and the rollback restores the 024 text byte for byte.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stableJson } from '../../../lib/research/format.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const values = JSON.parse(fs.readFileSync(path.join(here, 'migration-values.json'), 'utf8'))

// ---- the 024 research-queue view ---------------------------------------------------------------------------------------------------------
const m024 = fs.readFileSync(path.join(root, 'database/sql/024_development_progression_decisions.sql'), 'utf8').replace(/\r\n/g, '\n')
const start = m024.indexOf('create or replace view public.v_dodgers_development_research_queue')
const end = m024.indexOf("or (issue = 'LEVEL_SKIP_CAMEO_CANDIDATE' and has_level_skip_cameo_candidate);", start)
if (start < 0 || end < 0) throw new Error('the 024 research-queue view was not found')
const view024 = m024.slice(start, end + "or (issue = 'LEVEL_SKIP_CAMEO_CANDIDATE' and has_level_skip_cameo_candidate);".length)

const replaceOnce = (text, from, to) => {
  const i = text.indexOf(from)
  if (i < 0 || text.indexOf(from, i + 1) >= 0) throw new Error(`expected exactly one occurrence of: ${from.slice(0, 80)}`)
  return text.slice(0, i) + to + text.slice(i + from.length)
}
let view052 = replaceOnce(view024, `    ) as has_level_skip_cameo_candidate
  from public.players p`, `    ) as has_level_skip_cameo_candidate,
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
    exists (
      select 1
      from (
        select s.season from team_stints s
        where s.player_id = p.id and s.organization_id is not null
        group by s.season
        having count(distinct s.organization_id) >= 2
      ) ms
      where not (
        (select count(distinct s.organization_id) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id is not null) = 2
        and not exists (
          select 1 from team_stints s
          where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            and (s.first_game_date is null or s.last_game_date is null))
        and exists (
          select 1
          from public.transaction_event_assets a
          join public.transaction_events e on e.id = a.event_id
          where a.player_id = p.id
            and extract(year from e.transaction_date)::int = ms.season
            and e.from_organization_id is not null and e.to_organization_id is not null
            and e.from_organization_id <> e.to_organization_id
            and (select max(s.last_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = e.from_organization_id) <= e.transaction_date
            and (select min(s.first_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = e.to_organization_id) >= e.transaction_date))
    ) as has_unverified_multi_org_season
  from public.players p`)
view052 = replaceOnce(view052, `   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2
       and (select max(s.season) - min(s.season) + 1 from team_stints s where s.player_id = base.player_id) > stint_count)`,
`   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2 and has_open_season_gap)`)
view052 = replaceOnce(view052, `   or (issue = 'MULTI_ORG_SEASON_UNVERIFIED' and has_multi_org_season)`,
`   or (issue = 'MULTI_ORG_SEASON_UNVERIFIED' and has_unverified_multi_org_season)`)
view052 = replaceOnce(view052, `    ('SEASON_GAP', 2,
      'Stints have a gap of at least two seasons between first and last'),`, `    ('SEASON_GAP', 2,
      'A season between the first and last recorded seasons has no record and is not a league season that was not played'),`)
view052 = replaceOnce(view052, `    ('MULTI_ORG_SEASON_UNVERIFIED', 1,
      'Two organizations appear in the same season; verify the trade date'),`, `    ('MULTI_ORG_SEASON_UNVERIFIED', 1,
      'Two or more organizations appear in one season and no canonical transaction bracketed by game dates explains the move'),`)

// ---- payload ---------------------------------------------------------------------------------------------------------------------------------
const payload = stableJson(values)
if (payload.includes('$m052$')) throw new Error('payload contains the dollar-quote tag')

const header = `-- DISI v0.37
-- 052_development_taxonomy_chronology_resolution.sql
-- Development taxonomy and chronology resolution. Run after 050 (051 added no migration).
--
-- Built from database/research/052/ (migration-values.json, derive.mjs, build.mjs) against the official MLB Stats API, read 2026-10-23.
--
-- What this is. A research-data migration with one detector correction. It adds no table, function, grant or policy, and it changes no outcome
-- audit, transaction, WAR row, cost, benchmark fact, threshold, signing-time feature or prediction.
-- HISTORICAL LEAGUE LABEL != MODERN LEVEL; AFFILIATE NAME != ORGANIZATION WITHOUT SEASON CONTEXT; LEAGUE SEASON NOT PLAYED != MISSING PLAYER
-- SEASON; TEAM CHANGE != CANONICAL TRANSACTION; SEASON PRECISION != DAY PRECISION; SOURCE-LIMITED != RESEARCH FAILURE.
--   * Organizations. ${values.organizations.length} team stints take the parent organization the official team-season record names for the
--     stint's own team id in its own season (a major-league club is its own organization); ${values.organizations.filter((o) => o.correction).length} of them correct an
--     affiliation rule that carried the New Orleans Zephyrs as Houston's beyond 2004. The evidence (team id, season, parent id and name, URL) is
--     kept on each stint; the previous value is kept in the evidence. One stint (a co-operative club with no MLB parent) stays unresolved.
--   * Exact dates. ${values.stint_dates.length} log-era team stints take their first and last appearance dates from the official gameLog; ${values.milestone_upgrades.length} level debuts move from
--     season to day precision inside their own season; ${values.professional_debuts.length} amateur signings get a dated PROFESSIONAL_DEBUT (no professional-pathway signing
--     and no late first record does). An existing date is never overwritten; a stint the log returns no games for keeps NULL dates.
--   * Sequences. ${values.progression_reviews.length} pending progression reviews (${[...new Set(values.progression_reviews.map((r) => r.slug))].length} players) for sequences the exact dates make visible inside one season; none is decided.
--   * Taxonomy. The Pioneer League is recorded per era in the level-era map (Rookie sport through 2020, Independent from 2021). Its stints stay
--     OTHER and unranked: no stint on record is in a Rookie Advanced season, and no existing level fits without an assumption.
--   * Detector. v_dodgers_development_research_queue: SEASON_GAP no longer fires for 2020 when the league did not play it, and
--     MULTI_ORG_SEASON_UNVERIFIED no longer fires for a season bracketed by a canonical transaction and game dates. Every other detector is the
--     024 text unchanged.
-- No persisted snapshot reads a changed row: the migration proves that every product snapshot still matches its source (drift 0), so the
-- snapshot generation does not move and no refresh is run.
--
-- Rerunnable: every row is checked to be in its pre-052 or its 052 state; only pre-052 rows change.
`

const pre = `
begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m052 on commit drop as
select $m052$${payload.trim()}$m052$::jsonb as j;

create temporary table _m052_org on commit drop as
select x ->> 'slug' as slug, (x ->> 'season')::int as season, x ->> 'affiliate_team' as affiliate_team, x ->> 'league_name' as league_name,
       x ->> 'level' as level, (x ->> 'team_id')::bigint as team_id, x ->> 'organization_name' as organization_name,
       x ->> 'previous_organization_name' as previous_organization_name, x ->> 'previous_basis' as previous_basis, (x ->> 'correction')::boolean as correction,
       x -> 'evidence' as evidence
from _m052, jsonb_array_elements(j -> 'organizations') x;

create temporary table _m052_dates on commit drop as
select x ->> 'slug' as slug, (x ->> 'season')::int as season, x ->> 'affiliate_team' as affiliate_team, x ->> 'league_name' as league_name,
       x ->> 'level' as level, (x ->> 'first_game_date')::date as first_game_date, (x ->> 'last_game_date')::date as last_game_date, x ->> 'source_url' as source_url
from _m052, jsonb_array_elements(j -> 'stint_dates') x;

create temporary table _m052_upgrades on commit drop as
select x ->> 'slug' as slug, x ->> 'event_code' as event_code, (x ->> 'season_year')::int as season_year, (x ->> 'milestone_date')::date as milestone_date,
       x ->> 'prior_evidence_basis' as prior_evidence_basis, x ->> 'note' as note
from _m052, jsonb_array_elements(j -> 'milestone_upgrades') x;

create temporary table _m052_debuts on commit drop as
select x ->> 'slug' as slug, (x ->> 'event_date')::date as event_date, (x ->> 'season_year')::int as season_year, x ->> 'organization_name' as organization_name,
       x ->> 'note' as note, x ->> 'source_url' as source_url
from _m052, jsonb_array_elements(j -> 'professional_debuts') x;

create temporary table _m052_reviews on commit drop as
select x ->> 'slug' as slug, x ->> 'event_code' as event_code, x ->> 'decision_basis' as decision_basis, x ->> 'confidence' as confidence,
       x ->> 'notes' as notes, (x ->> 'as_of_date')::date as as_of_date
from _m052, jsonb_array_elements(j -> 'progression_reviews') x;

-- the stints the reviewed values address, by their natural key (the 021 unique index)
create temporary table _m052_stints on commit drop as
select s.id, s.player_id, k.kind
from (
  select slug, season, affiliate_team, league_name, level, 'ORG' as kind from _m052_org
  union all
  select slug, season, affiliate_team, league_name, level, 'DATES' from _m052_dates
) k
join public.players p on p.slug = k.slug
join public.player_season_stints s
  on s.player_id = p.id and s.season = k.season and coalesce(s.affiliate_team, '') = coalesce(k.affiliate_team, '')
 and coalesce(s.league_name, '') = coalesce(k.league_name, '') and s.level::text = k.level and s.stint_kind = 'TEAM_STINT';

create temporary table _m052_before on commit drop as
select
  (select count(*) from public.player_season_stints) as stints,
  (select count(*) from public.development_milestones) as milestones,
  (select count(*) from public.development_progression_decisions) as decisions,
  (select count(*) from public.development_level_era_map) as era_rows,
  (select count(*) from public.sources) as sources,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t where t.id not in (select id from _m052_stints)) as other_stints,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t) as milestones_md5,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t
    where not exists (select 1 from _m052_reviews r join public.players p on p.slug = r.slug where p.id = t.player_id and r.event_code = t.event_code)) as decisions_md5,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t) as outcome_audits,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.transaction_events t) as transaction_events,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.transaction_event_assets t) as transaction_assets,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_metric_observations t) as metric_observations,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.signings t) as signings,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_evaluations t) as evaluations,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_development_status t) as development_status;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 052 was written for
-- ===========================================================================

do $$
declare
  n int;
  e jsonb := (select j -> 'expected_before' from _m052);
begin
  if to_regprocedure('public.disi_refresh_product_snapshots()') is null or to_regclass('public.development_progression_decisions') is null then
    raise exception '052: Migrations 024 and 045a have not been applied';
  end if;
  if not exists (select 1 from public.signings sg join public.players p on p.id = sg.player_id where p.slug = 'yasiel-puig')
     or (select count(*) from public.players) <> 322 then
    raise exception '052: Migration 050 has not been applied (322 players expected)';
  end if;
  -- every reviewed value addresses exactly one team stint
  if (select count(*) from _m052_stints where kind = 'ORG') <> (select count(*) from _m052_org) then
    raise exception '052: % organization values do not match exactly one team stint', abs((select count(*) from _m052_stints where kind = 'ORG') - (select count(*) from _m052_org));
  end if;
  if (select count(*) from _m052_stints where kind = 'DATES') <> (select count(*) from _m052_dates) then
    raise exception '052: % date values do not match exactly one team stint', abs((select count(*) from _m052_stints where kind = 'DATES') - (select count(*) from _m052_dates));
  end if;
  -- every named organization exists exactly once
  select count(*) into n from (select distinct organization_name from _m052_org union select distinct organization_name from _m052_debuts) x
  where x.organization_name is not null and (select count(*) from public.organizations o where o.name = x.organization_name) <> 1;
  if n > 0 then
    raise exception '052: % organization names are not exactly one organization', n;
  end if;
  -- each organization stint is in its pre-052 state or exactly its 052 state
  select count(*) into n
  from _m052_org v
  join public.players p on p.slug = v.slug
  join public.player_season_stints s on s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
   and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT'
  left join public.organizations prev on prev.name = v.previous_organization_name
  where s.team_id is distinct from v.team_id
     or not (
       -- pre-052: unresolved (no organization id), or the reviewed correction target
       (s.detail -> 'organizationEvidence' is null
        and s.organization_name is not distinct from v.previous_organization_name
        and s.detail ->> 'organizationBasis' is not distinct from v.previous_basis
        and ((v.correction and s.organization_id = prev.id) or (not v.correction and s.organization_id is null))
        and not coalesce(s.source_urls, '[]'::jsonb) @> to_jsonb(array[v.evidence ->> 'url']))
       -- 052 state
       or (s.detail -> 'organizationEvidence' = v.evidence and s.organization_name = v.organization_name
           and s.organization_id = (select o.id from public.organizations o where o.name = v.organization_name)));
  if n > 0 then
    raise exception '052: % organization stints are in neither their pre-052 nor their 052 state', n;
  end if;
  -- each date stint is undated (pre-052) or carries exactly the reviewed dates (052)
  select count(*) into n
  from _m052_dates v
  join public.players p on p.slug = v.slug
  join public.player_season_stints s on s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
   and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT'
  where not ((s.first_game_date is null and s.last_game_date is null and s.game_date_basis is null
              and not coalesce(s.source_urls, '[]'::jsonb) @> to_jsonb(array[v.source_url]))
          or (s.first_game_date = v.first_game_date and s.last_game_date = v.last_game_date and s.game_date_basis = 'GAME_LOG'));
  if n > 0 then
    raise exception '052: % date stints are in neither their pre-052 nor their 052 state', n;
  end if;
  -- each upgraded milestone is the one season-precision row of its event, untouched since it was written, or exactly its 052 state
  select count(*) into n
  from _m052_upgrades u
  where (select count(*) from public.development_milestones m join public.players p on p.id = m.player_id
         where p.slug = u.slug and m.event_code = u.event_code) <> 1
     or not exists (
       select 1 from public.development_milestones m join public.players p on p.id = m.player_id
       where p.slug = u.slug and m.event_code = u.event_code and m.season_year = u.season_year
         and ((m.date_precision = 'SEASON' and m.milestone_date is null and m.age_at_milestone is null and m.prior_evidence_basis is null
               and m.evidence_basis = u.prior_evidence_basis and m.notes = (select j ->> 'season_only_note' from _m052))
           or (m.date_precision = 'DAY' and m.milestone_date = u.milestone_date and m.evidence_basis = 'GAME_LOG'
               and m.prior_evidence_basis = u.prior_evidence_basis and m.notes = u.note)));
  if n > 0 then
    raise exception '052: % milestone upgrades are in neither their pre-052 nor their 052 state', n;
  end if;
  -- a professional debut is added only where none is recorded (or exactly the 052 row is)
  select count(*) into n
  from _m052_debuts d
  join public.players p on p.slug = d.slug
  where exists (select 1 from public.development_milestones m where m.player_id = p.id and m.event_code = 'PROFESSIONAL_DEBUT'
                and not (m.milestone_date = d.event_date and m.evidence_basis = 'GAME_LOG' and m.date_precision = 'DAY'));
  if n > 0 then
    raise exception '052: % players already hold a different PROFESSIONAL_DEBUT', n;
  end if;
  -- a sequence review is added only where no decision covers the event (or exactly the 052 pending review does)
  select count(*) into n
  from _m052_reviews r
  join public.players p on p.slug = r.slug
  where (select count(*) from public.development_milestones m where m.player_id = p.id and m.event_code = r.event_code) <> 1
     or exists (select 1 from public.development_progression_decisions d where d.player_id = p.id and d.event_code = r.event_code
                and not (d.progression_role = 'REVIEW_REQUIRED' and d.review_status = 'PENDING_REVIEW' and d.notes = r.notes));
  if n > 0 then
    raise exception '052: % sequence reviews address an event that is already decided or not recorded once', n;
  end if;
  -- no affiliated minor-league stint is recorded for a season the league did not play (the 2020 rule depends on it)
  select count(*) into n from public.player_season_stints
  where stint_kind = 'TEAM_STINT' and season = 2020 and affiliated and level <> 'MLB';
  if n > 0 then
    raise exception '052: % affiliated minor-league stints are recorded for 2020, which the league did not play', n;
  end if;
end $$;
`

const writes = `
-- ===========================================================================
-- 2. ORGANIZATIONS (the official team-season record, per stint team id and season)
-- ===========================================================================
-- A major-league club is its own organization; an affiliate's organization is the parent the record names for that team in that season.
-- organization_name stays the DISI organization's name (one franchise, historical names: the season's own parent name is in the evidence).

update public.player_season_stints s
set organization_id = o.id,
    organization_name = o.name,
    detail = coalesce(s.detail, '{}'::jsonb)
      || jsonb_build_object('organizationBasis', 'TEAM_SEASON_RECORD',
                            'organizationEvidence', v.evidence,
                            'organizationPrevious', jsonb_build_object('name', v.previous_organization_name, 'basis', v.previous_basis)),
    source_urls = coalesce(s.source_urls, '[]'::jsonb) || to_jsonb(array[v.evidence ->> 'url'])
from _m052_org v
join public.players p on p.slug = v.slug
join public.organizations o on o.name = v.organization_name
where s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
  and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT'
  and s.detail -> 'organizationEvidence' is null;

-- ===========================================================================
-- 3. SOURCES (the official records the rows below cite)
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, accessed_at, notes, source_tier)
select
  'MLB Stats API',
  case x ->> 'kind' when 'GAME_LOG' then 'MLB_GAME_LOG' else 'MLB_TEAM_SEASON_RECORD' end,
  case x ->> 'kind' when 'GAME_LOG' then 'MLB Stats API: gameLog appearance endpoint' else 'MLB Stats API: team record for one season (parent organization, sport, league)' end,
  x ->> 'url',
  (x ->> 'retrieved_at')::timestamptz,
  'Referenced by migration 052 (development taxonomy and chronology).',
  public.disi_infer_source_tier(x ->> 'url', null)
from _m052, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 4. STINT FIRST / LAST APPEARANCE DATES (official gameLog; NULL dates only)
-- ===========================================================================

update public.player_season_stints s
set first_game_date = v.first_game_date,
    last_game_date = v.last_game_date,
    game_date_basis = 'GAME_LOG',
    source_urls = case when v.source_url is null then s.source_urls else coalesce(s.source_urls, '[]'::jsonb) || to_jsonb(array[v.source_url]) end
from _m052_dates v
join public.players p on p.slug = v.slug
where s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
  and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT'
  and s.first_game_date is null and s.last_game_date is null and s.game_date_basis is null;

-- ===========================================================================
-- 5. MILESTONES: SEASON -> DAY inside the milestone's own season; dated first professional games
-- ===========================================================================

update public.development_milestones m
set milestone_date = u.milestone_date,
    date_precision = 'DAY'::public.date_precision,
    evidence_basis = 'GAME_LOG',
    prior_evidence_basis = m.evidence_basis,
    age_at_milestone = public.disi_age_decimal(p.birth_date, u.milestone_date),
    notes = u.note
from _m052_upgrades u
join public.players p on p.slug = u.slug
where m.player_id = p.id and m.event_code = u.event_code and m.season_year = u.season_year
  and m.date_precision = 'SEASON' and m.milestone_date is null;

insert into public.development_milestones (
  player_id, milestone, milestone_date, age_at_milestone, organization_id, affiliate, notes, source_id, confidence,
  event_code, date_precision, season_year, evidence_basis, as_of_date
)
select
  p.id,
  coalesce(ec.uses_milestone_type, 'OTHER'::public.milestone_type),
  d.event_date,
  public.disi_age_decimal(p.birth_date, d.event_date),
  o.id,
  d.organization_name,
  d.note,
  src.id,
  'HIGH'::public.confidence_level,
  'PROFESSIONAL_DEBUT',
  'DAY'::public.date_precision,
  d.season_year,
  'GAME_LOG',
  (select (j ->> 'as_of_date')::date from _m052)
from _m052_debuts d
join public.players p on p.slug = d.slug
left join public.development_event_codes ec on ec.event_code = 'PROFESSIONAL_DEBUT'
left join public.organizations o on o.name = d.organization_name
left join public.sources src on src.url = d.source_url
where not exists (select 1 from public.development_milestones m where m.player_id = p.id and m.event_code = 'PROFESSIONAL_DEBUT');

-- Sequences the exact dates make visible: inside one season a lower level's first appearance after a higher one's. Recorded as PENDING_REVIEW,
-- exactly as 048 recorded the season-precision ones; 052 decides none (PENDING REVIEW != NEGATIVE DEVELOPMENT EVENT).
insert into public.development_progression_decisions (player_id, event_code, milestone_id, progression_role, developmental_arrival_date, developmental_arrival_precision,
  developmental_arrival_season, decision_basis, review_status, confidence, notes, reviewed_at, as_of_date)
select p.id, r.event_code, m.id, 'REVIEW_REQUIRED', null, null, null, r.decision_basis, 'PENDING_REVIEW', r.confidence::public.confidence_level, r.notes, now(), r.as_of_date
from _m052_reviews r
join public.players p on p.slug = r.slug
join public.development_milestones m on m.player_id = p.id and m.event_code = r.event_code
on conflict (player_id, event_code) do nothing;

-- ===========================================================================
-- 6. LEVEL-ERA MAP: the Pioneer League per era (official sport by season)
-- ===========================================================================

insert into public.development_level_era_map (era, source_label, maps_to, note)
select (x ->> 'era')::public.development_era, x ->> 'source_label', (x ->> 'maps_to')::public.development_level, x ->> 'note'
from _m052, jsonb_array_elements(j -> 'era_map') x
on conflict (era, source_label, maps_to) do update set note = excluded.note;

-- ===========================================================================
-- 7. RESEARCH QUEUE: the 024 view with the SEASON_GAP and MULTI_ORG_SEASON_UNVERIFIED corrections
-- ===========================================================================

${view052}
`

const post = `
-- ===========================================================================
-- 8. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  b record;
  n int;
  e jsonb := (select j -> 'expected_before' from _m052);
begin
  select * into b from _m052_before;
  select count(*) into n from _m052_org v join public.players p on p.slug = v.slug
  join public.player_season_stints s on s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
   and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT'
  where s.organization_id is distinct from (select o.id from public.organizations o where o.name = v.organization_name)
     or s.detail ->> 'organizationBasis' <> 'TEAM_SEASON_RECORD'
     or (s.detail -> 'organizationEvidence' ->> 'season')::int <> s.season
     or (s.detail -> 'organizationEvidence' ->> 'teamId')::bigint <> s.team_id;
  if n > 0 then
    raise exception '052 postcondition: % organization stints do not carry their reviewed organization and season-bounded evidence', n;
  end if;
  select count(*) into n from public.player_season_stints
  where stint_kind = 'TEAM_STINT' and organization_id is null and level <> 'FOREIGN_PRO';
  if n <> (e ->> 'team_stints_without_organization')::int - (select count(*) from _m052_org where not correction) then
    raise exception '052 postcondition: % team stints remain without an organization', n;
  end if;
  select count(*) into n from _m052_dates v join public.players p on p.slug = v.slug
  join public.player_season_stints s on s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
   and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT'
  where s.first_game_date is distinct from v.first_game_date or s.last_game_date is distinct from v.last_game_date or s.game_date_basis is distinct from 'GAME_LOG';
  if n > 0 then
    raise exception '052 postcondition: % stints do not carry their reviewed game dates', n;
  end if;
  select count(*) into n from public.player_season_stints where first_game_date is not null and game_date_basis is null;
  if n > 0 then
    raise exception '052 postcondition: % stints carry a date without game-log evidence', n;
  end if;
  select count(*) into n from _m052_upgrades u join public.players p on p.slug = u.slug
  join public.development_milestones m on m.player_id = p.id and m.event_code = u.event_code
  where m.date_precision <> 'DAY' or m.milestone_date is distinct from u.milestone_date or extract(year from m.milestone_date)::int <> m.season_year;
  if n > 0 then
    raise exception '052 postcondition: % milestone upgrades are not exact inside their own season', n;
  end if;
  if (select count(*) from public.player_season_stints) <> b.stints then
    raise exception '052 postcondition: the stint count moved; 052 adds and removes no stint';
  end if;
  if (select count(*) from public.development_milestones) <> (e ->> 'milestones')::int + (select count(*) from _m052_debuts) then
    raise exception '052 postcondition: % milestones, expected %', (select count(*) from public.development_milestones), (e ->> 'milestones')::int + (select count(*) from _m052_debuts);
  end if;
  if (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t where t.id not in (select id from _m052_stints)) <> b.other_stints then
    raise exception '052 postcondition: a stint outside the reviewed values changed';
  end if;
  if (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t
      where not exists (select 1 from _m052_reviews r join public.players p on p.slug = r.slug where p.id = t.player_id and r.event_code = t.event_code)) <> b.decisions_md5 then
    raise exception '052 postcondition: an existing progression decision changed; 052 decides no sequence';
  end if;
  select count(*) into n from _m052_reviews r join public.players p on p.slug = r.slug
  where not exists (select 1 from public.development_progression_decisions d where d.player_id = p.id and d.event_code = r.event_code
                    and d.progression_role = 'REVIEW_REQUIRED' and d.review_status = 'PENDING_REVIEW' and d.developmental_arrival_season is null);
  if n > 0 then
    raise exception '052 postcondition: % sequence reviews are not pending', n;
  end if;
  if (select count(*) from public.development_progression_decisions) <> (e ->> 'progression_decisions')::int + (select count(*) from _m052_reviews) then
    raise exception '052 postcondition: % progression decisions, expected %', (select count(*) from public.development_progression_decisions), (e ->> 'progression_decisions')::int + (select count(*) from _m052_reviews);
  end if;
  -- 052 is development research only: no outcome, transaction, WAR, cost, evaluation or status row moved
  if (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t) <> b.outcome_audits
     or (select md5(string_agg(t::text, '|' order by t::text)) from public.transaction_events t) <> b.transaction_events
     or (select md5(string_agg(t::text, '|' order by t::text)) from public.transaction_event_assets t) <> b.transaction_assets
     or (select md5(string_agg(t::text, '|' order by t::text)) from public.player_metric_observations t) <> b.metric_observations
     or (select md5(string_agg(t::text, '|' order by t::text)) from public.signings t) <> b.signings
     or (select md5(string_agg(t::text, '|' order by t::text)) from public.player_evaluations t) <> b.evaluations
     or (select md5(string_agg(t::text, '|' order by t::text)) from public.player_development_status t) <> b.development_status then
    raise exception '052 postcondition: an outcome, transaction, WAR, cost, evaluation or development-status row changed';
  end if;
  -- a VERIFIED_NO_MLB signing still holds no MLB-level stint and no MLB_DEBUT (051)
  select count(distinct s.player_id) into n from public.v_signing_records s
  where s.outcome_audit_status = 'VERIFIED_NO_MLB'
    and (exists (select 1 from public.player_season_stints t where t.player_id = s.player_id and t.level = 'MLB')
      or exists (select 1 from public.development_milestones m where m.player_id = s.player_id and m.event_code = 'MLB_DEBUT'));
  if n > 0 then
    raise exception '052 postcondition: % audited no-MLB signings now hold an MLB development fact', n;
  end if;
end $$;
`
const refresh = `
-- ===========================================================================
-- 9. SNAPSHOTS: no persisted snapshot reads what 052 changes
-- ===========================================================================
-- Proven, not assumed: every product snapshot still equals a fresh evaluation of its analytical source. The snapshot generation does not
-- move, because no snapshot source changed.

do $$
declare
  n int;
begin
  select coalesce(sum(missing_rows + extra_rows), 0) into n from public.disi_product_snapshot_drift();
  if n > 0 then
    raise exception '052 postcondition: % product snapshot rows no longer match their source', n;
  end if;
end $$;

commit;
`
const preWithTouched = pre.replace(`  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t where t.id not in (select id from _m052_stints)) as other_stints,`,
  `  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t where t.id not in (select id from _m052_stints)) as other_stints,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t where t.id in (select id from _m052_stints)) as touched_md5,`)
const postFinal = post + refresh
const migration = header + preWithTouched + writes + postFinal
fs.writeFileSync(path.join(root, 'database/sql/052_development_taxonomy_chronology_resolution.sql'), migration)

// ---- rollback ------------------------------------------------------------------------------------------------------------------------------
const rollback = `-- DISI rollback-052.sql
-- Reverses Migration 052 exactly, and only from its applied state. Run inside the release plan's guarded procedure (database/release/052-release-plan.md).
--
-- Restores: the pre-052 organization, basis and citations of the ${values.organizations.length} organization stints; NULL dates on the ${values.stint_dates.length} dated stints; the
-- season precision of the ${values.milestone_upgrades.length} upgraded level debuts; removes the ${values.professional_debuts.length} dated PROFESSIONAL_DEBUT rows, the ${values.progression_reviews.length} pending sequence reviews, the three Pioneer League era-map rows
-- and the sources 052 added; and restores the Migration 024 research-queue view text byte for byte. No snapshot reads these rows (drift is\n-- asserted 0), so no refresh runs.
-- Re-applying 052 after this rollback reproduces the same state (the migration is deterministic).

begin;

create temporary table _r052 on commit drop as
select $m052$${payload.trim()}$m052$::jsonb as j;

create temporary table _r052_org on commit drop as
select x ->> 'slug' as slug, (x ->> 'season')::int as season, x ->> 'affiliate_team' as affiliate_team, x ->> 'league_name' as league_name,
       x ->> 'level' as level, x ->> 'organization_name' as organization_name, x ->> 'previous_organization_name' as previous_organization_name,
       x ->> 'previous_basis' as previous_basis, (x ->> 'correction')::boolean as correction, x -> 'evidence' as evidence
from _r052, jsonb_array_elements(j -> 'organizations') x;

create temporary table _r052_dates on commit drop as
select x ->> 'slug' as slug, (x ->> 'season')::int as season, x ->> 'affiliate_team' as affiliate_team, x ->> 'league_name' as league_name,
       x ->> 'level' as level, (x ->> 'first_game_date')::date as first_game_date, (x ->> 'last_game_date')::date as last_game_date, x ->> 'source_url' as source_url
from _r052, jsonb_array_elements(j -> 'stint_dates') x;

create temporary table _r052_upgrades on commit drop as
select x ->> 'slug' as slug, x ->> 'event_code' as event_code, (x ->> 'season_year')::int as season_year, (x ->> 'milestone_date')::date as milestone_date,
       x ->> 'prior_evidence_basis' as prior_evidence_basis, x ->> 'note' as note
from _r052, jsonb_array_elements(j -> 'milestone_upgrades') x;

create temporary table _r052_reviews on commit drop as
select x ->> 'slug' as slug, x ->> 'event_code' as event_code, x ->> 'notes' as notes
from _r052, jsonb_array_elements(j -> 'progression_reviews') x;

create temporary table _r052_debuts on commit drop as
select x ->> 'slug' as slug, (x ->> 'event_date')::date as event_date
from _r052, jsonb_array_elements(j -> 'professional_debuts') x;

-- guard: 052 is applied, exactly
do $$
declare
  n int;
begin
  select count(*) into n from _r052_org v join public.players p on p.slug = v.slug
  join public.player_season_stints s on s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
   and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT'
  where s.detail -> 'organizationEvidence' = v.evidence and s.organization_name = v.organization_name;
  if n <> (select count(*) from _r052_org) then
    raise exception 'rollback-052: % of % organization stints are not in their 052 state', n, (select count(*) from _r052_org);
  end if;
  select count(*) into n from _r052_dates v join public.players p on p.slug = v.slug
  join public.player_season_stints s on s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
   and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT'
  where s.first_game_date = v.first_game_date and s.last_game_date = v.last_game_date and s.game_date_basis = 'GAME_LOG';
  if n <> (select count(*) from _r052_dates) then
    raise exception 'rollback-052: % of % dated stints are not in their 052 state', n, (select count(*) from _r052_dates);
  end if;
  select count(*) into n from _r052_upgrades u join public.players p on p.slug = u.slug
  join public.development_milestones m on m.player_id = p.id and m.event_code = u.event_code
  where m.date_precision = 'DAY' and m.milestone_date = u.milestone_date and m.evidence_basis = 'GAME_LOG' and m.notes = u.note;
  if n <> (select count(*) from _r052_upgrades) then
    raise exception 'rollback-052: % of % upgraded milestones are not in their 052 state', n, (select count(*) from _r052_upgrades);
  end if;
  select count(*) into n from _r052_debuts d join public.players p on p.slug = d.slug
  join public.development_milestones m on m.player_id = p.id and m.event_code = 'PROFESSIONAL_DEBUT' and m.milestone_date = d.event_date and m.evidence_basis = 'GAME_LOG';
  if n <> (select count(*) from _r052_debuts) then
    raise exception 'rollback-052: % of % dated professional debuts are not in their 052 state', n, (select count(*) from _r052_debuts);
  end if;
  select count(*) into n from _r052_reviews r join public.players p on p.slug = r.slug
  join public.development_progression_decisions d on d.player_id = p.id and d.event_code = r.event_code
  where d.progression_role = 'REVIEW_REQUIRED' and d.review_status = 'PENDING_REVIEW' and d.notes = r.notes;
  if n <> (select count(*) from _r052_reviews) then
    raise exception 'rollback-052: % of % sequence reviews are not in their 052 state (one may have been decided since; decide again after the rollback)', n, (select count(*) from _r052_reviews);
  end if;
end $$;

-- organizations: the previous organization, name, basis and citations
update public.player_season_stints s
set organization_id = prev.id,
    organization_name = v.previous_organization_name,
    detail = case when v.previous_basis is null then (s.detail - 'organizationEvidence' - 'organizationPrevious') - 'organizationBasis'
                  else (s.detail - 'organizationEvidence' - 'organizationPrevious') || jsonb_build_object('organizationBasis', v.previous_basis) end,
    source_urls = (select case when count(*) = 0 then null else jsonb_agg(e.value order by e.ordinality) end
                   from jsonb_array_elements(s.source_urls) with ordinality e
                   where e.value <> to_jsonb(v.evidence ->> 'url'))
from _r052_org v
join public.players p on p.slug = v.slug
left join public.organizations prev on prev.name = v.previous_organization_name and v.correction
where s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
  and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT';

-- dates: NULL again, and the gameLog citation removed
update public.player_season_stints s
set first_game_date = null,
    last_game_date = null,
    game_date_basis = null,
    source_urls = (select case when count(*) = 0 then null else jsonb_agg(e.value order by e.ordinality) end
                   from jsonb_array_elements(s.source_urls) with ordinality e
                   where v.source_url is null or e.value <> to_jsonb(v.source_url))
from _r052_dates v
join public.players p on p.slug = v.slug
where s.player_id = p.id and s.season = v.season and coalesce(s.affiliate_team, '') = coalesce(v.affiliate_team, '')
  and coalesce(s.league_name, '') = coalesce(v.league_name, '') and s.level::text = v.level and s.stint_kind = 'TEAM_STINT';

-- milestones: season precision again; the dated professional debuts removed
update public.development_milestones m
set milestone_date = null,
    date_precision = 'SEASON'::public.date_precision,
    evidence_basis = u.prior_evidence_basis,
    prior_evidence_basis = null,
    age_at_milestone = null,
    notes = (select j ->> 'season_only_note' from _r052)
from _r052_upgrades u
join public.players p on p.slug = u.slug
where m.player_id = p.id and m.event_code = u.event_code and m.season_year = u.season_year;

delete from public.development_progression_decisions d
using _r052_reviews r, public.players p
where p.slug = r.slug and d.player_id = p.id and d.event_code = r.event_code and d.review_status = 'PENDING_REVIEW' and d.notes = r.notes;

delete from public.development_milestones m
using _r052_debuts d, public.players p
where p.slug = d.slug and m.player_id = p.id and m.event_code = 'PROFESSIONAL_DEBUT' and m.milestone_date = d.event_date and m.evidence_basis = 'GAME_LOG';

delete from public.development_level_era_map e
using _r052, jsonb_array_elements(_r052.j -> 'era_map') x
where e.era = (x ->> 'era')::public.development_era and e.source_label = x ->> 'source_label' and e.maps_to = (x ->> 'maps_to')::public.development_level;

delete from public.sources s
where s.notes = 'Referenced by migration 052 (development taxonomy and chronology).'
  and s.url in (select x ->> 'url' from _r052, jsonb_array_elements(j -> 'sources') x)
  and not exists (select 1 from public.development_milestones m where m.source_id = s.id)
  and not exists (select 1 from public.player_season_stints t where t.source_id = s.id);

-- the Migration 024 research-queue view, byte for byte
${view024}

do $$
begin
  if exists (select 1 from public.player_season_stints where detail ? 'organizationEvidence') then
    raise exception 'rollback-052: organization evidence remains';
  end if;
  if exists (select 1 from public.development_level_era_map where source_label = 'Pioneer League' and era <> 'CLASSIC_AFFILIATED_1989_2016') then
    raise exception 'rollback-052: Pioneer League era rows remain';
  end if;
end $$;

do $$
declare
  n int;
begin
  select coalesce(sum(missing_rows + extra_rows), 0) into n from public.disi_product_snapshot_drift();
  if n > 0 then
    raise exception 'rollback-052: % product snapshot rows no longer match their source', n;
  end if;
end $$;

commit;
`
fs.mkdirSync(path.join(root, 'database/release/sql'), { recursive: true })
fs.writeFileSync(path.join(root, 'database/release/sql/rollback-052.sql'), rollback)
console.log(`052: ${migration.length} bytes; rollback ${rollback.length} bytes`)
