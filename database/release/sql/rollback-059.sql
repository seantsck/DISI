-- DISI rollback of Migration 059 (career bWAR metric reconciliation)
-- Deletes exactly the eleven CAREER_BWAR observations 059 wrote and restores the pre-059 state. One guarded transaction.
--
-- Built from database/research/059/ (build.mjs). Do not edit by hand.
--
-- Metric observations have no ACTIVE / RETRACTED lifecycle, so the reversal is a delete of exactly the 059 rows: each one must match the released
-- player, value, observation date (2026-09-28), season (2026), source (the live batting data file), confidence and notes. It refuses when 059 is
-- not applied, when any of the eleven has a CAREER_BWAR observation that is not exactly the 059 one (a later observation, or a changed 059 row),
-- and when fewer than eleven 059 rows exist. No source, team-season row, outcome or other observation is touched; the refresh runs once.
-- Like 059, it raises its own statement timeout for this transaction only (SET LOCAL, 600 s): hosted production defaults to 2min per statement.
-- Like 059 (v3), it proves its direct result only: the refusal guards, the exact delete, the pre-059 observation count and queue, inexpensive
-- unchanged-input counters and one drift-free generation. The exhaustive isolation evidence (every base table, the view fingerprints, the snapshot
-- business content, the catalog, the verifier) is compared read-only outside the transaction (database/research/059/release-evidence.mjs).

begin;
set local statement_timeout = '600s';

create temporary table _r059 on commit drop as
select $r059${"semantics":{"metric_key":"CAREER_BWAR","meaning":"CAREER_TO_DATE_AS_OF","observed_through_date":"2026-09-28","observed_through_season":2026,"rounding":"round(sum(war), 1) (PostgreSQL numeric round, as 032)","confidence":"VERIFIED"},"sources":{"bat_url":"https://www.baseball-reference.com/data/war_daily_bat.txt","pitch_url":"https://www.baseball-reference.com/data/war_daily_pitch.txt","bat_sha256":"ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8","pitch_sha256":"061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5","file_last_modified":"2026-09-28"},"players":[{"slug":"rafael-devers","bref_id":"deverra01","mlb_id":"646240","rows":11,"bat_rows":11,"pitch_rows":0,"bat_bwar":"30.62","pitch_bwar":"0","raw_bwar":"30.62","career_bwar":"30.6","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 646240 (deverra01), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"gleyber-torres","bref_id":"torregl01","mlb_id":"650402","rows":9,"bat_rows":9,"pitch_rows":0,"bat_bwar":"20.91","pitch_bwar":"0","raw_bwar":"20.91","career_bwar":"20.9","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 650402 (torregl01), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"eloy-jimenez","bref_id":"jimenel02","mlb_id":"650391","rows":8,"bat_rows":8,"pitch_rows":0,"bat_bwar":"5.17","pitch_bwar":"0","raw_bwar":"5.17","career_bwar":"5.2","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 650391 (jimenel02), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"huascar-ynoa","bref_id":"ynoahu01","mlb_id":"660623","rows":8,"bat_rows":4,"pitch_rows":4,"bat_bwar":"0.33","pitch_bwar":"0.73","raw_bwar":"1.06","career_bwar":"1.1","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 660623 (ynoahu01), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"marcos-diplan","bref_id":"diplama01","mlb_id":"650959","rows":4,"bat_rows":2,"pitch_rows":2,"bat_bwar":"0.00","pitch_bwar":"0.38","raw_bwar":"0.38","career_bwar":"0.4","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 650959 (diplama01), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"dermis-garcia","bref_id":"garcide02","mlb_id":"660650","rows":1,"bat_rows":1,"pitch_rows":0,"bat_bwar":"0.50","pitch_bwar":"0","raw_bwar":"0.50","career_bwar":"0.5","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 660650 (garcide02), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"lewin-diaz","bref_id":"diazle01","mlb_id":"650331","rows":3,"bat_rows":3,"pitch_rows":0,"bat_bwar":"0.13","pitch_bwar":"0","raw_bwar":"0.13","career_bwar":"0.1","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 650331 (diazle01), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"anderson-espinoza","bref_id":"espinan01","mlb_id":"659262","rows":2,"bat_rows":1,"pitch_rows":1,"bat_bwar":"0","pitch_bwar":"-0.02","raw_bwar":"-0.02","career_bwar":"0.0","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 659262 (espinan01), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"hyo-jun-park","bref_id":"parkho01","mlb_id":"660829","rows":3,"bat_rows":3,"pitch_rows":0,"bat_bwar":"-0.63","pitch_bwar":"0","raw_bwar":"-0.63","career_bwar":"-0.6","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 660829 (parkho01), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"jose-herrera","bref_id":"herrejo04","mlb_id":"645444","rows":6,"bat_rows":4,"pitch_rows":2,"bat_bwar":"-0.62","pitch_bwar":"-0.03","raw_bwar":"-0.65","career_bwar":"-0.7","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 645444 (herrejo04), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."},{"slug":"diego-castillo","bref_id":"castidi02","mlb_id":"660636","rows":4,"bat_rows":3,"pitch_rows":1,"bat_bwar":"-0.51","pitch_bwar":"-0.26","raw_bwar":"-0.77","career_bwar":"-0.8","notes":"Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID 660636 (castidi02), rounded to one decimal; career-to-date through the 2026 season (data files of 2026-09-28). Batting file: https://www.baseball-reference.com/data/war_daily_bat.txt (sha256 ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8); pitching file: https://www.baseball-reference.com/data/war_daily_pitch.txt (sha256 061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5)."}],"excluded_057":["emmanuel-dejesus","vladimir-guerrero-jr","gilberto-celestino","cristian-pache","andres-gimenez","leody-taveras","juan-soto","miguel-amaya","simon-muzziotti","fernando-tatis-jr","rafael-marchan"],"baseline":{"career_bwar_observations":47,"sources":3384,"bwar_missing_before":["adael-amador","adrian-morejon","anderson-espinoza","andres-gimenez","andry-lara","cionel-perez","cristian-pache","dermis-garcia","diego-castillo","eloy-jimenez","emmanuel-dejesus","everson-pereira","fernando-tatis-jr","francisco-alvarez","francisco-morales","gabriel-arias","george-valera","gilberto-celestino","gleyber-torres","huascar-ynoa","hyo-jun-park","jasson-dominguez","jorge-ona","jose-herrera","juan-soto","julio-rodriguez","kevin-alcantara","leody-taveras","lewin-diaz","lourdes-gurriel-jr","luis-garcia-jr","luis-matos","luis-robert-jr","marco-luciano","marcos-diplan","maximo-acosta","miguel-amaya","noelvi-marte","norge-ruiz","orelvis-martinez","osleivis-basabe","rafael-devers","rafael-marchan","randy-arozarena","ronald-bolanos","ronny-mauricio","simon-muzziotti","vladimir-guerrero-jr","vladimir-gutierrez","wander-franco"],"bwar_missing_after":["adael-amador","adrian-morejon","andres-gimenez","andry-lara","cionel-perez","cristian-pache","emmanuel-dejesus","everson-pereira","fernando-tatis-jr","francisco-alvarez","francisco-morales","gabriel-arias","george-valera","gilberto-celestino","jasson-dominguez","jorge-ona","juan-soto","julio-rodriguez","kevin-alcantara","leody-taveras","lourdes-gurriel-jr","luis-garcia-jr","luis-matos","luis-robert-jr","marco-luciano","maximo-acosta","miguel-amaya","noelvi-marte","norge-ruiz","orelvis-martinez","osleivis-basabe","rafael-marchan","randy-arozarena","ronald-bolanos","ronny-mauricio","simon-muzziotti","vladimir-guerrero-jr","vladimir-gutierrez","wander-franco"]}}$r059$::jsonb as j;

create temporary table _r059_players on commit drop as
select x ->> 'slug' as slug, x ->> 'bref_id' as bref_id, x ->> 'mlb_id' as mlb_id, (x ->> 'career_bwar')::numeric as career_bwar, x ->> 'notes' as notes
from _r059, jsonb_array_elements(j -> 'players') x;

create temporary table _r059_missing on commit drop as
select x #>> '{}' as slug from _r059, jsonb_array_elements(j #> '{baseline,bwar_missing_before}') x;

create temporary table _r059_const on commit drop as
select (j #>> '{semantics,observed_through_date}')::date as through_date, (j #>> '{semantics,observed_through_season}')::int as through_season,
  j #>> '{sources,bat_url}' as bat_url, (j #>> '{baseline,career_bwar_observations}')::int as observations_before
from _r059;

create temporary view _r059_exact as
select m.* from public.player_metric_observations m
join public.players pl on pl.id = m.player_id join _r059_players p on p.slug = pl.slug and pl.bref_id = p.bref_id and pl.mlb_id::text = p.mlb_id
cross join _r059_const k
where m.metric_key = 'CAREER_BWAR' and m.value = p.career_bwar and m.observed_through_date = k.through_date and m.observed_through_season = k.through_season
  and m.source_id = (select so.id from public.sources so where so.url = k.bat_url) and m.confidence = 'VERIFIED' and m.notes = p.notes;

create temporary view _r059_conflicts as
select m.* from public.player_metric_observations m
join public.players pl on pl.id = m.player_id join _r059_players p on p.slug = pl.slug
where m.metric_key = 'CAREER_BWAR' and m.id not in (select e.id from _r059_exact e);

-- the inexpensive counters the postcondition compares (the exhaustive isolation evidence is compared outside this transaction)
create temporary table _r059_before on commit drop as
select (select max(generation_id) from public.product_executive_snapshot) as generation,
  (select count(*) from public.player_metric_observations) as observations_all,
  (select count(*) from public.sources) as sources,
  (select count(*) from public.player_mlb_team_season_war) as war_rows,
  (select count(*) from public.player_mlb_team_season_war where record_status = 'ACTIVE') as war_active,
  (select count(*) from public.outcomes) as outcomes,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(m)::text) as h from public.player_metric_observations m
     where m.player_id not in (select pl.id from public.players pl join _r059_players p on p.slug = pl.slug)) z) as other_metric_observations;

do $$
declare
  n int;
begin
  n := (select count(*) from _r059_exact);
  if n = 0 and not exists (select 1 from _r059_conflicts) then
    raise exception 'rollback-059: Migration 059 is not applied';
  end if;
  if exists (select 1 from _r059_conflicts) then
    raise exception 'rollback-059: a CAREER_BWAR observation of the eleven is not the released 059 observation (a later observation or a changed 059 row); rollback refused';
  end if;
  if n <> 11 or (select count(distinct player_id) from _r059_exact) <> 11 then
    raise exception 'rollback-059: % of the eleven 059 observations exist; rollback refused', n;
  end if;
  if (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR') <> (select observations_before + 11 from _r059_const) then
    raise exception 'rollback-059: the CAREER_BWAR observation count is not the released post-059 count; rollback refused';
  end if;
  raise notice 'rollback-059 phase guards: done at +%', clock_timestamp() - now();
end $$;

delete from public.player_metric_observations m where m.id in (select e.id from _r059_exact e);

do $$
declare
  b record;
  k record;
  tn text;
  g bigint[];
  missing_now text[];
begin
  select * into b from _r059_before;
  select * into k from _r059_const;
  raise notice 'rollback-059 phase delete: done at +%', clock_timestamp() - now();
  if exists (select 1 from public.player_metric_observations m join public.players pl on pl.id = m.player_id join _r059_players p on p.slug = pl.slug
             where m.metric_key = 'CAREER_BWAR')
     or (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR') <> k.observations_before
     or (select count(*) from public.player_metric_observations) <> b.observations_all - 11
     or (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(m)::text) as h from public.player_metric_observations m
           where m.player_id not in (select pl.id from public.players pl join _r059_players p on p.slug = pl.slug)) z) is distinct from b.other_metric_observations then
    raise exception 'rollback-059 postcondition: the CAREER_BWAR observations are not the pre-059 observations';
  end if;
  missing_now := (select coalesce(array_agg(t.player_slug order by t.player_slug), '{}') from public.v_research_tasks t where t.task_type = 'BWAR_MISSING');
  if missing_now is distinct from (select coalesce(array_agg(slug order by slug), '{}') from _r059_missing) then
    raise exception 'rollback-059 postcondition: the BWAR_MISSING queue is not the pre-059 queue';
  end if;
  if (select count(*) from public.sources) <> b.sources or (select count(*) from public.player_mlb_team_season_war) <> b.war_rows
     or (select count(*) from public.player_mlb_team_season_war where record_status = 'ACTIVE') <> b.war_active or (select count(*) from public.outcomes) <> b.outcomes then
    raise exception 'rollback-059 postcondition: a source, team-season row or outcome moved';
  end if;
  raise notice 'rollback-059 phase postconditions: done at +%', clock_timestamp() - now();
  perform * from public.disi_refresh_product_snapshots();
  if (select max(generation_id) from public.product_executive_snapshot) <> b.generation + 1
     or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception 'rollback-059 postcondition: the refresh did not produce exactly one new drift-free generation';
  end if;
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'product\_%' order by 1 loop
    execute format('select array_agg(distinct generation_id) from public.%I', tn) into g;
    if g is distinct from array[b.generation + 1] then
      raise exception 'rollback-059 postcondition: snapshot % is not at the single generation %', tn, b.generation + 1;
    end if;
  end loop;
  raise notice 'rollback-059 phase snapshots: done at +% (generation %)', clock_timestamp() - now(), b.generation + 1;
end $$;

commit;
