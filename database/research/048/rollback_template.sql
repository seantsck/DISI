-- DISI 048: logical rollback of the verified-MLB development coverage batch (WRITE; run only with explicit owner approval, after a failed
-- post-release verification).
--
-- Built from database/research/048/ (development-values.sql, development-cohort.json); regenerate with: node database/research/048/build.mjs
--
-- 048 inserted the development stints and first-appearance milestones of thirty-five verified MLB players and fifteen pending progression
-- reviews. None of those tables is sealed, so this file DELETES exactly those rows, then refreshes the product snapshots once. The source
-- rows (the MLB Stats API requests) are provenance of what was read and stay. The two players Migration 021 had already researched were not
-- changed by 048 and are not changed here.
--
-- It is guarded: it refuses to run unless every pending review is still the row 048 wrote (a reviewer's later decision would be lost), unless
-- each player holds exactly the reviewed stint set (no later development research), and unless the already-researched players are untouched.
-- One transaction. Nothing here is retracted instead of deleted, so migration 048 CAN be re-applied after this rollback.

begin;

create temporary table _r048 on commit drop as
select $r048${{payload_json}}$r048$::jsonb as j;

create temporary table _r048d_stints (
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
insert into _r048d_stints
values
{{stints}};

create temporary table _r048d_milestones (
  slug text, mlb_id bigint, event_code text, event_date date, date_precision text,
  season_year int, organization_name text, level text, evidence_basis text,
  note text, as_of_date date
) on commit drop;
insert into _r048d_milestones
values
{{milestones}};

do $$
declare
  x jsonb;
  n int;
  pl record;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception 'rollback-048: this is not a 045b database';
  end if;
  -- each progression review is still the pending row 048 wrote (a later review would be lost)
  for x in select y from _r048, jsonb_array_elements(j -> 'progression_reviews') y loop
    select count(*) into n from public.development_progression_decisions d join public.players p on p.id = d.player_id
      where p.slug = x ->> 'slug' and d.event_code = x ->> 'event_code' and d.progression_role = 'REVIEW_REQUIRED' and d.review_status = 'PENDING_REVIEW';
    if n <> 1 then
      raise exception 'rollback-048: the progression review for % % is not the pending row 048 wrote; a later review exists', x ->> 'slug', x ->> 'event_code';
    end if;
  end loop;
  -- each player with new rows holds exactly the reviewed stint set
  for pl in select y ->> 'slug' as slug from _r048, jsonb_array_elements(j -> 'cohort') y where not (y ->> 'already_researched')::boolean loop
    select count(*) into n from public.player_season_stints t join public.players p on p.id = t.player_id where p.slug = pl.slug;
    if n <> (select count(*) from _r048d_stints s where s.slug = pl.slug) then
      raise exception 'rollback-048: % holds % stints but 048 wrote %; later development research exists', pl.slug, n, (select count(*) from _r048d_stints s where s.slug = pl.slug);
    end if;
  end loop;
  -- the players Migration 021 researched hold no stint 048 wrote
  select count(*) into n from public.player_season_stints t join public.players p on p.id = t.player_id
    where p.slug in (select y ->> 'slug' from _r048, jsonb_array_elements(j -> 'cohort') y where (y ->> 'already_researched')::boolean)
      and t.as_of_date = (select (j ->> 'as_of_date')::date from _r048);
  if n <> 0 then
    raise exception 'rollback-048: an already-researched player holds % stints from the 048 as-of date; this is not the post-048 state', n;
  end if;
end $$;

-- 0. the pending progression reviews (they restrict the deletion of their milestones)
delete from public.development_progression_decisions d using _r048, jsonb_array_elements(j -> 'progression_reviews') x, public.players p
where p.slug = x ->> 'slug' and d.player_id = p.id and d.event_code = x ->> 'event_code' and d.review_status = 'PENDING_REVIEW';

-- 1. the first-appearance milestones 048 recorded (rows with the pipeline evidence bases, including each player's final release or retirement transaction; the 021 rows are untouched)
delete from public.development_milestones d using _r048d_milestones m, public.players p
where p.slug = m.slug and d.player_id = p.id and d.event_code = m.event_code
  and coalesce(d.milestone_date::text, d.season_year::text) = coalesce(m.event_date::text, m.season_year::text)
  and d.evidence_basis in ('SEASON_SPLITS', 'MLB_PERSON_RECORD', 'MLB_TRANSACTION_LOG', 'GAME_LOG') and d.as_of_date = m.as_of_date;

-- 2. the stints
delete from public.player_season_stints t using _r048d_stints s, public.players p
where p.slug = s.slug and t.player_id = p.id and t.season = s.season and coalesce(t.affiliate_team, '') = coalesce(s.affiliate_team, '')
  and coalesce(t.league_name, '') = coalesce(s.league_name, '') and t.level::text = s.level;

-- 3. postconditions
do $$
declare
  n int;
begin
  select count(*) into n from public.player_season_stints t join public.players p on p.id = t.player_id
    where p.slug in (select y ->> 'slug' from _r048, jsonb_array_elements(j -> 'cohort') y where not (y ->> 'already_researched')::boolean);
  if n <> 0 then
    raise exception 'rollback-048 postcondition: % cohort stints remain', n;
  end if;
  select count(*) into n from public.development_milestones d join public.players p on p.id = d.player_id
    where d.as_of_date = (select (j ->> 'as_of_date')::date from _r048)
      and p.slug in (select y ->> 'slug' from _r048, jsonb_array_elements(j -> 'cohort') y where not (y ->> 'already_researched')::boolean)
      and d.evidence_basis in ('SEASON_SPLITS', 'MLB_PERSON_RECORD', 'MLB_TRANSACTION_LOG', 'GAME_LOG');
  if n <> 0 then
    raise exception 'rollback-048 postcondition: % cohort milestones remain', n;
  end if;
end $$;

-- 4. one coherent generation without the research
do $$
begin
  perform * from public.disi_refresh_product_snapshots();
end $$;

commit;
