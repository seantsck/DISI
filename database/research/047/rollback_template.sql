-- DISI 047: logical rollback of the research batch (WRITE; run only with explicit owner approval, after a failed post-release verification).
--
-- Built from database/research/047/ (transaction-evidence.json, development-values.sql); regenerate with: node database/research/047/build.mjs
--
-- 047 inserted five transaction exit events (with one OUTGOING asset each) and the development stints and first-appearance milestones of ten
-- players. None of those tables is sealed, so this file DELETES exactly those rows, then refreshes the product snapshots once. The source
-- rows (Retrosheet and the MLB Stats API requests) are provenance of what was read and stay.
--
-- It is guarded: it refuses to run unless all five exit events are present, unless nothing depends on their assets (no control observation,
-- placeholder resolution or timing observation), unless each cohort player holds exactly the reviewed stint set (no later development research),
-- and unless no later transaction was recorded for the five assets. One transaction. Unlike 046, nothing here is retracted instead of deleted, so
-- migration 047 CAN be re-applied after this rollback.

begin;

create temporary table _r047 on commit drop as
select $r047${{payload_json}}$r047$::jsonb as j;

create temporary table _r047d_stints (
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
insert into _r047d_stints
values
{{stints}};

create temporary table _r047d_milestones (
  slug text, mlb_id bigint, event_code text, event_date date, date_precision text,
  season_year int, organization_name text, level text, evidence_basis text,
  note text, as_of_date date
) on commit drop;
insert into _r047d_milestones
values
{{milestones}};

do $$
declare
  x jsonb;
  n int;
  pl record;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception 'rollback-047: this is not a 045b database';
  end if;
  for x in select y from _r047, jsonb_array_elements(j -> 'exits') y loop
    select count(*) into n from public.transaction_events e where e.event_key = x ->> 'key';
    if n <> 1 then
      raise exception 'rollback-047: the exit event % is not present; this database is not in the post-047 state', x ->> 'key';
    end if;
    -- nothing may depend on the assets being removed
    select count(*) into n from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id
      where e.event_key = x ->> 'key'
        and (exists (select 1 from public.dodgers_control_observations o where o.subject_asset_id = a.id)
          or exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id or r.resolved_asset_id = a.id)
          or exists (select 1 from public.transaction_asset_timing_observations t where t.subject_asset_id = a.id));
    if n > 0 then
      raise exception 'rollback-047: later research depends on the exit event %', x ->> 'key';
    end if;
  end loop;
  -- each progression review is still the pending row 047 wrote (a later review would be lost)
  for x in select y from _r047, jsonb_array_elements(j -> 'progression_reviews') y loop
    select count(*) into n from public.development_progression_decisions d join public.players p on p.id = d.player_id
      where p.slug = x ->> 'slug' and d.event_code = x ->> 'event_code' and d.progression_role = 'REVIEW_REQUIRED' and d.review_status = 'PENDING_REVIEW';
    if n <> 1 then
      raise exception 'rollback-047: the progression review for % % is not the pending row 047 wrote; a later review exists', x ->> 'slug', x ->> 'event_code';
    end if;
  end loop;
  -- each cohort player holds exactly the reviewed stint set
  for pl in select y ->> 'slug' as slug from _r047, jsonb_array_elements(j -> 'cohort') y loop
    select count(*) into n from public.player_season_stints t join public.players p on p.id = t.player_id where p.slug = pl.slug;
    if n <> (select count(*) from _r047d_stints s where s.slug = pl.slug) then
      raise exception 'rollback-047: % holds % stints but 047 wrote %; later development research exists', pl.slug, n, (select count(*) from _r047d_stints s where s.slug = pl.slug);
    end if;
  end loop;
end $$;

-- 0. the pending progression reviews (they restrict the deletion of their milestones)
delete from public.development_progression_decisions d using _r047, jsonb_array_elements(j -> 'progression_reviews') x, public.players p
where p.slug = x ->> 'slug' and d.player_id = p.id and d.event_code = x ->> 'event_code' and d.review_status = 'PENDING_REVIEW';

-- 1. the exit events (assets first). The exit-bound observations 047 retracted are sealed (never un-retracted), so the facts are restored as
--    NEW active observations with the same content.
insert into public.transaction_asset_timing_observations (subject_asset_id, event_id, fact_type, season, observed_date, source_id, confidence, note)
select o.subject_asset_id, o.event_id, o.fact_type, o.season, o.observed_date, o.source_id, o.confidence, o.note
from public.transaction_asset_timing_observations o
where o.record_status = 'RETRACTED' and o.retraction_reason like 'Superseded by Migration 047:%'
  and not exists (select 1 from public.transaction_asset_timing_observations a where a.subject_asset_id = o.subject_asset_id and a.fact_type = o.fact_type
                  and coalesce(a.season, 0) = coalesce(o.season, 0) and a.record_status = 'ACTIVE');

delete from public.transaction_event_assets a using public.transaction_events e, _r047, jsonb_array_elements(j -> 'exits') x
where a.event_id = e.id and e.event_key = x ->> 'key';
delete from public.transaction_events e using _r047, jsonb_array_elements(j -> 'exits') x where e.event_key = x ->> 'key';

-- 2. the first-appearance milestones 047 recorded (rows with the pipeline evidence bases; the legacy outcome-audit rows are untouched)
delete from public.development_milestones d using _r047d_milestones m, public.players p
where p.slug = m.slug and d.player_id = p.id and d.event_code = m.event_code
  and coalesce(d.milestone_date::text, d.season_year::text) = coalesce(m.event_date::text, m.season_year::text)
  and d.evidence_basis in ('SEASON_SPLITS', 'MLB_PERSON_RECORD', 'GAME_LOG') and d.as_of_date = m.as_of_date;

-- 3. the stints
delete from public.player_season_stints t using _r047d_stints s, public.players p
where p.slug = s.slug and t.player_id = p.id and t.season = s.season and coalesce(t.affiliate_team, '') = coalesce(s.affiliate_team, '')
  and coalesce(t.league_name, '') = coalesce(s.league_name, '') and t.level::text = s.level;

-- 4. postconditions
do $$
declare
  n int;
begin
  select count(*) into n from public.transaction_events e, _r047, jsonb_array_elements(j -> 'exits') x where e.event_key = x ->> 'key';
  if n <> 0 then
    raise exception 'rollback-047 postcondition: % exit events remain', n;
  end if;
  select count(*) into n from public.player_season_stints t join public.players p on p.id = t.player_id
    where p.slug in (select y ->> 'slug' from _r047, jsonb_array_elements(j -> 'cohort') y);
  if n <> 0 then
    raise exception 'rollback-047 postcondition: % cohort stints remain', n;
  end if;
  select count(*) into n from public.transaction_asset_timing_observations o join public.transaction_event_assets a on a.id = o.subject_asset_id,
    _r047, jsonb_array_elements(j -> 'exits') y
  where o.record_status = 'ACTIVE' and o.fact_type = 'EXIT_BOUNDED_BEFORE' and a.mlb_id = y #>> '{asset,mlb_id}' and a.asset_side = 'INCOMING';
  if n <> (select count(distinct o2.subject_asset_id) from public.transaction_asset_timing_observations o2 where o2.record_status = 'RETRACTED' and o2.retraction_reason like 'Superseded by Migration 047:%') then
    raise exception 'rollback-047 postcondition: the exit-bound observations were not restored';
  end if;
end $$;

-- 5. one coherent generation without the research
do $$
begin
  perform * from public.disi_refresh_product_snapshots();
end $$;

commit;
