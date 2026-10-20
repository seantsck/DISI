-- DISI v0.36.4
-- 048_verified_mlb_development_coverage.sql
-- A reviewed development-history coverage batch for the remaining verified MLB players. Run after 047.
--
-- Built from database/research/048/ (development-values.sql, development-cohort.json, build.mjs).
--
-- What this is. A research-data migration. It adds no table, view, function, grant or policy, and it changes no outcome audit, acquisition
-- cost, transaction, threshold or prediction. UNKNOWN DEVELOPMENT HISTORY != NO DEVELOPMENT; MISSING SEASON != NO SEASON PLAYED;
-- FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON; PARTIAL HISTORY != NO HISTORY.
--   * The documented careers of the thirty-seven verified MLB players that were not in the 047 controlled cohort, from the official MLB
--     Stats API season splits through the same pipeline Migrations 021 and 047 used (stints = the whole recorded career; first-appearance
--     milestones at season precision where no dated record exists). Seasons the API does not return are NOT filled in. A level debut dated
--     after the MLB debut season is a rehab or demotion appearance and is not recorded as a development milestone. Established foreign
--     professional leagues stay FOREIGN_PRO and are never read as affiliated minor-league development.
--   * Ambiguous level sequences are recorded as PENDING_REVIEW progression decisions and are never decided by this migration.
-- Rows that already exist (Migration 021 stored two of these players) are never overwritten. It then runs the explicit snapshot refresh
-- once, only when this run changed a row.
--
-- Rerunnable: every statement is idempotent; the refresh runs only when a row was added.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m048 on commit drop as
select $m048${{payload_json}}$m048$::jsonb as j;

create temporary table _m048_before on commit drop as
select
  (select count(*) from public.player_season_stints) as stints,
  (select count(*) from public.development_milestones) as milestones,
  (select count(*) from public.development_progression_decisions) as decisions,
  (select count(*) from public.transaction_events) as events,
  (select count(*) from public.transaction_event_assets) as assets,
  (select count(*) from public.player_season_stints t join public.players p on p.id = t.player_id
    where p.slug not in (select y ->> 'slug' from jsonb_array_elements((select j -> 'cohort' from _m048)) y)) as other_stints,
  (select count(*) from public.development_milestones d join public.players p on p.id = d.player_id
    where p.slug not in (select y ->> 'slug' from jsonb_array_elements((select j -> 'cohort' from _m048)) y)) as other_milestones,
  (select count(*) from public.player_season_stints t join public.players p on p.id = t.player_id
    where p.slug in (select y ->> 'slug' from jsonb_array_elements((select j -> 'cohort' from _m048)) y where (y ->> 'already_researched')::boolean)) as researched_stints;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 048 was written for
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null
     or to_regclass('public.player_season_stints') is null or to_regclass('public.development_progression_decisions') is null then
    raise exception '048: Migration 045b has not been applied';
  end if;
  if not exists (select 1 from public.transaction_events where event_key = 'LAD_RELEASE_2018_HOMER_BAILEY') then
    raise exception '048: Migration 047 has not been applied';
  end if;
  -- each cohort player exists with the MLB id the research used, and is a verified MLB player
  for p in select x from _m048, jsonb_array_elements(j -> 'cohort') x loop
    select count(*) into n from public.players where slug = p ->> 'slug' and mlb_id = (p ->> 'mlb_id')::bigint;
    if n <> 1 then
      raise exception '048: cohort player % is missing or carries a different MLB id', p ->> 'slug';
    end if;
    select count(*) into n from public.v_signing_records s where s.player_slug = p ->> 'slug' and s.reached_mlb_verified;
    if n <> 1 then
      raise exception '048: cohort player % is not a verified MLB player', p ->> 'slug';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2. DEVELOPMENT HISTORIES (official MLB Stats API season splits, the Migration 021 pipeline)
-- ===========================================================================

create temporary table _m048d_players (id uuid, slug text, mlb_id bigint, birth_date date, has_mlb_id boolean) on commit drop;
insert into _m048d_players
select p.id, p.slug, p.mlb_id, p.birth_date, p.mlb_id is not null
from public.players p;

create temporary table _m048d_orgs (id uuid, name text) on commit drop;
insert into _m048d_orgs select o.id, o.name from public.organizations o;

create temporary table _m048d_stints (
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
insert into _m048d_stints
values
{{stints}};

create temporary table _m048d_milestones (
  slug text, mlb_id bigint, event_code text, event_date date, date_precision text,
  season_year int, organization_name text, level text, evidence_basis text,
  note text, as_of_date date
) on commit drop;
insert into _m048d_milestones
values
{{milestones}};

create temporary table _m048d_sources (url text, retrieved_at timestamptz) on commit drop;

insert into _m048d_sources
values
{{sources}};

-- The state this research was written for: every player with new rows holds none of them yet (or exactly the reviewed set, which is a rerun),
-- and the players Migration 021 already researched are not touched. A player with other development rows means later research exists.
do $$
declare
  c record;
  n int;
  expected int;
begin
  for c in select x ->> 'slug' as slug, (x ->> 'already_researched')::boolean as done from _m048, jsonb_array_elements(j -> 'cohort') x loop
    select count(*) into n from public.player_season_stints t join public.players p on p.id = t.player_id where p.slug = c.slug;
    select count(*) into expected from _m048d_stints s where s.slug = c.slug;
    if c.done then
      if expected > 0 or n = 0 then
        raise exception '048: % was marked as already researched but the state disagrees', c.slug;
      end if;
    elsif n <> 0 and n <> expected then
      raise exception '048: % holds % stints; the reviewed set is %, so later development research exists', c.slug, n, expected;
    end if;
  end loop;
end $$;

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
  'Referenced by migration 048 (development-history research batch).',
  public.disi_infer_source_tier(v.url, null)
from _m048d_sources v
where v.url is not null
on conflict (url) do nothing;

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
from _m048d_stints s
join _m048d_players pl on pl.slug = s.slug
left join _m048d_orgs org on org.name = s.organization_name
left join public.sources src on src.url = (s.source_urls ->> 0)
on conflict (player_id, season, (coalesce(affiliate_team, '')), (coalesce(league_name, '')), level) do nothing;

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
from _m048d_milestones m
join _m048d_players pl on pl.slug = m.slug
left join public.development_event_codes ec on ec.event_code = m.event_code
left join _m048d_orgs org on org.name = m.organization_name
where m.event_date is not null or m.date_precision = 'SEASON'
on conflict do nothing;

-- ---- team-less season rows: classified only when PROVEN (Migration 023's rule) -----------------------------------------------------------
-- A team-less row is a SEASON_TOTAL only if it equals the sum of at least two component team stints of the same player, season and source
-- level on every statistic it reports. Anything not proven would remain a TEAM_STINT without a team, which the integrity checks forbid, so the
-- migration refuses rather than guess.

create temporary table _m048d_totals on commit drop as
select t.id as stint_id, p.slug, t.season, t.level::text as level,
  case when comp.levels = 1 and comp.one_level = t.level::text then 'SAME_LEVEL' else 'CROSS_LEVEL' end as basis,
  (comp.n >= 2
   and (t.g is null or t.g = coalesce(comp.g, 0)) and (t.pa is null or t.pa = coalesce(comp.pa, 0)) and (t.ab is null or t.ab = coalesce(comp.ab, 0))
   and (t.h is null or t.h = coalesce(comp.h, 0)) and (t.b2 is null or t.b2 = coalesce(comp.b2, 0)) and (t.b3 is null or t.b3 = coalesce(comp.b3, 0))
   and (t.hr is null or t.hr = coalesce(comp.hr, 0)) and (t.bb is null or t.bb = coalesce(comp.bb, 0)) and (t.so is null or t.so = coalesce(comp.so, 0))
   and (t.sb is null or t.sb = coalesce(comp.sb, 0)) and (t.cs is null or t.cs = coalesce(comp.cs, 0)) and (t.pg is null or t.pg = coalesce(comp.pg, 0))
   and (t.gs is null or t.gs = coalesce(comp.gs, 0)) and (t.bf is null or t.bf = coalesce(comp.bf, 0)) and (t.h_allowed is null or t.h_allowed = coalesce(comp.h_allowed, 0))
   and (t.r is null or t.r = coalesce(comp.r, 0)) and (t.er is null or t.er = coalesce(comp.er, 0)) and (t.hr_allowed is null or t.hr_allowed = coalesce(comp.hr_allowed, 0))
   and (t.pbb is null or t.pbb = coalesce(comp.pbb, 0)) and (t.pso is null or t.pso = coalesce(comp.pso, 0))
   and (t.ip is null or round(t.ip * 3) = coalesce(comp.ip3, 0))) as proven
from public.player_season_stints t
join public.players p on p.id = t.player_id
left join lateral (
  select count(*) as n, count(distinct c2.level) as levels, min(c2.level::text) as one_level,
    sum(c2.g) as g, sum(c2.pa) as pa, sum(c2.ab) as ab, sum(c2.h) as h, sum(c2.b2) as b2, sum(c2.b3) as b3, sum(c2.hr) as hr, sum(c2.bb) as bb,
    sum(c2.so) as so, sum(c2.sb) as sb, sum(c2.cs) as cs, sum(c2.pg) as pg, sum(c2.gs) as gs, sum(c2.bf) as bf, sum(c2.h_allowed) as h_allowed,
    sum(c2.r) as r, sum(c2.er) as er, sum(c2.hr_allowed) as hr_allowed, sum(c2.pbb) as pbb, sum(c2.pso) as pso, sum(round(c2.ip * 3)) as ip3
  from public.player_season_stints c2
  where c2.player_id = t.player_id and c2.season = t.season and c2.source_level = t.source_level
    and c2.team_id is not null and c2.affiliate_team is not null and c2.stint_kind = 'TEAM_STINT'
) comp on true
where t.stint_kind = 'TEAM_STINT' and (t.affiliate_team is null or t.team_id is null)
  and p.slug in (select y ->> 'slug' from _m048, jsonb_array_elements(j -> 'cohort') y);

do $$
declare
  bad text;
begin
  select string_agg(format('%s %s %s', slug, season, level), '; ') into bad from _m048d_totals where not proven;
  if bad is not null then
    raise exception '048: team-less season rows are not proven to equal their component team stints: %', bad;
  end if;
end $$;

update public.player_season_stints s
set stint_kind = 'SEASON_TOTAL', season_total_basis = r.basis
from _m048d_totals r
where s.id = r.stint_id;


-- ---- progression decisions: an ambiguous level sequence is PENDING review, never silently accepted (Migration 024) ----------------------------

insert into public.development_progression_decisions (player_id, event_code, milestone_id, progression_role, developmental_arrival_date, developmental_arrival_precision,
  developmental_arrival_season, decision_basis, review_status, confidence, notes, reviewed_at, as_of_date)
select pl.id, r ->> 'event_code', m.id, 'REVIEW_REQUIRED', null, null, null, r ->> 'decision_basis', 'PENDING_REVIEW', (r ->> 'confidence')::public.confidence_level, r ->> 'notes',
       now(), (r ->> 'as_of_date')::date
from _m048, jsonb_array_elements(j -> 'progression_reviews') r
join public.players pl on pl.slug = r ->> 'slug'
join public.development_milestones m on m.player_id = pl.id and m.event_code = r ->> 'event_code'
on conflict (player_id, event_code) do nothing;

-- ===========================================================================
-- 3. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  n int;
  b record;
begin
  select * into b from _m048_before;
  -- every reviewed stint and milestone is present
  select count(*) into n from _m048d_stints s join _m048d_players pl on pl.slug = s.slug
  where not exists (select 1 from public.player_season_stints t where t.player_id = pl.id and t.season = s.season and coalesce(t.affiliate_team, '') = coalesce(s.affiliate_team, '')
                    and coalesce(t.league_name, '') = coalesce(s.league_name, '') and t.level::text = s.level);
  if n > 0 then
    raise exception '048 postcondition: % reviewed stints are missing', n;
  end if;
  select count(*) into n from _m048d_milestones m join _m048d_players pl on pl.slug = m.slug
  where m.event_code is not null and not exists (select 1 from public.development_milestones d where d.player_id = pl.id and d.event_code = m.event_code
        and coalesce(d.milestone_date::text, d.season_year::text) = coalesce(m.event_date::text, m.season_year::text));
  if n > 0 then
    raise exception '048 postcondition: % reviewed milestones are missing', n;
  end if;
  -- no team-less cohort row is left as a team stint
  select count(*) into n from public.player_season_stints t join public.players p on p.id = t.player_id
    where p.slug in (select y ->> 'slug' from _m048, jsonb_array_elements(j -> 'cohort') y) and t.stint_kind = 'TEAM_STINT' and (t.affiliate_team is null or t.team_id is null);
  if n > 0 then
    raise exception '048 postcondition: % team-less cohort rows are still classified as team stints', n;
  end if;
  -- every reviewed progression decision is present and still pending; no decision of any other kind was added
  select count(*) into n from _m048, jsonb_array_elements(j -> 'progression_reviews') r
    where not exists (select 1 from public.development_progression_decisions d join public.players p on p.id = d.player_id
                      where p.slug = r ->> 'slug' and d.event_code = r ->> 'event_code' and d.progression_role = 'REVIEW_REQUIRED' and d.review_status = 'PENDING_REVIEW');
  if n > 0 then
    raise exception '048 postcondition: % progression reviews are missing or no longer pending', n;
  end if;
  select (select count(*) from public.development_progression_decisions) - b.decisions into n;
  if n > (select jsonb_array_length(j -> 'progression_reviews') from _m048) then
    raise exception '048 postcondition: % progression decisions were added, at most % were reviewed', n, (select jsonb_array_length(j -> 'progression_reviews') from _m048);
  end if;
  -- the MLB debut the pipeline recorded is the debut the outcome audit verified (no player's debut date was changed or invented)
  select count(*) into n from public.development_milestones d
    join public.players p on p.id = d.player_id
    join public.v_signing_records s on s.player_id = p.id and s.is_dodgers_franchise
    where d.event_code = 'MLB_DEBUT' and d.evidence_basis = 'MLB_PERSON_RECORD' and d.as_of_date = (select (j ->> 'as_of_date')::date from _m048)
      and p.slug in (select y ->> 'slug' from _m048, jsonb_array_elements(j -> 'cohort') y)
      and (d.milestone_date is distinct from s.mlb_debut_date);
  if n > 0 then
    raise exception '048 postcondition: % MLB debut milestones disagree with the verified outcome audit', n;
  end if;
  -- a level debut dated after the MLB debut season is a rehab or demotion appearance and was not recorded as a development milestone
  select count(*) into n from public.development_milestones d
    join public.players p on p.id = d.player_id
    join public.development_milestones debut on debut.player_id = d.player_id and debut.event_code = 'MLB_DEBUT'
    where d.event_code in ('DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT')
      and d.as_of_date = (select (j ->> 'as_of_date')::date from _m048)
      and p.slug in (select y ->> 'slug' from _m048, jsonb_array_elements(j -> 'cohort') y)
      and coalesce(d.season_year, extract(year from d.milestone_date)::int) > coalesce(debut.season_year, extract(year from debut.milestone_date)::int);
  if n > 0 then
    raise exception '048 postcondition: % post-MLB level debuts were recorded as development milestones', n;
  end if;
  -- nothing was invented: every new stint has a source, and nothing outside the reviewed cohort changed
  select count(*) into n from public.player_season_stints t join _m048d_players pl on pl.id = t.player_id
    where pl.slug in (select y ->> 'slug' from _m048, jsonb_array_elements(j -> 'cohort') y) and t.source_id is null;
  if n > 0 then
    raise exception '048 postcondition: % cohort stints have no source', n;
  end if;
  select count(*) into n from public.player_season_stints t join public.players p on p.id = t.player_id
    where p.slug not in (select y ->> 'slug' from _m048, jsonb_array_elements(j -> 'cohort') y);
  if n <> b.other_stints then
    raise exception '048 postcondition: stints outside the cohort changed (% -> %)', b.other_stints, n;
  end if;
  select count(*) into n from public.development_milestones d join public.players p on p.id = d.player_id
    where p.slug not in (select y ->> 'slug' from _m048, jsonb_array_elements(j -> 'cohort') y);
  if n <> b.other_milestones then
    raise exception '048 postcondition: milestones outside the cohort changed (% -> %)', b.other_milestones, n;
  end if;
  select count(*) into n from public.player_season_stints t join public.players p on p.id = t.player_id
    where p.slug in (select y ->> 'slug' from _m048, jsonb_array_elements(j -> 'cohort') y where (y ->> 'already_researched')::boolean);
  if n <> b.researched_stints then
    raise exception '048 postcondition: the stints of the already-researched players changed (% -> %)', b.researched_stints, n;
  end if;
  -- 048 is development research only: no transaction, asset, outcome, cost or analytical row moved
  if (select count(*) from public.transaction_events) <> b.events or (select count(*) from public.transaction_event_assets) <> b.assets then
    raise exception '048 postcondition: transaction rows changed; 048 records none';
  end if;
end $$;

-- ===========================================================================
-- 4. GENERATION: one coherent refresh, only when this run added a row
-- ===========================================================================

do $$
declare
  b record;
begin
  select * into b from _m048_before;
  if (select count(*) from public.player_season_stints) <> b.stints
     or (select count(*) from public.development_milestones) <> b.milestones
     or (select count(*) from public.development_progression_decisions) <> b.decisions then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

commit;
