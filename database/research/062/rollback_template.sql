-- DISI rollback of Migration 062 (bWAR backlog closure). WRITE: run only with explicit owner approval.
--
-- Built from database/research/062/ (build.mjs). Do not edit by hand: regenerate with node database/research/062/build.mjs
--
-- 062 wrote one owner-observed CAREER_BWAR observation per written player and registered that player's Baseball-Reference page as a source. This
-- file, in one guarded transaction:
--   * DELETES exactly the 062 observations. Metric observations have no ACTIVE / RETRACTED lifecycle, so the reversal is a delete, and every row
--     must match the released player, value, date, season, source, confidence and notes;
--   * KEEPS the source rows as provenance (the 049 / 061 convention: what was observed stays on record); a reapply finds them and does not
--     duplicate them.
-- It refuses:
--   * when 062 is not applied;
--   * when any of the 39 players has a CAREER_BWAR observation that is not exactly a 062 one (a later observation, a changed 062 row, or one for a
--     held player): later research on these players depends on the 062 state;
--   * when the CAREER_BWAR count is not the released post-062 count.
-- No other source, evidence row, team-season row, outcome or observation is touched. The product snapshots are refreshed only if they drift.
-- Like 062: SET LOCAL statement_timeout 600s for this transaction only. Migration 062 can be reapplied after this rollback.

begin;
set local statement_timeout = '600s';

create temporary table _r062 on commit drop as
select $r062${{payload_json}}$r062$::jsonb as j;

create temporary table _r062_players on commit drop as
select x ->> 'slug' as slug, x ->> 'bref_id' as bref_id, x ->> 'mlb_id' as mlb_id, (x ->> 'career_bwar')::numeric as career_bwar, x ->> 'url' as url, x ->> 'notes' as notes
from _r062, jsonb_array_elements(j -> 'players') x;

create temporary table _r062_held on commit drop as
select x ->> 'slug' as slug from _r062, jsonb_array_elements(j -> 'rejected') x;

create temporary table _r062_missing on commit drop as
select x #>> '{}' as slug from _r062, jsonb_array_elements(j #> '{baseline,bwar_missing_before}') x;

create temporary table _r062_const on commit drop as
select (j #>> '{semantics,observed_through_date}')::date as through_date, (j #>> '{semantics,observed_through_season}')::int as through_season,
  (j #>> '{semantics,confidence}')::public.confidence_level as confidence,
  (j #>> '{baseline,career_bwar_observations}')::int as observations_before, (select count(*) from _r062_players) as n_players
from _r062;

create temporary view _r062_exact as
select m.* from public.player_metric_observations m
join public.players pl on pl.id = m.player_id join _r062_players p on p.slug = pl.slug and pl.bref_id = p.bref_id and pl.mlb_id::text = p.mlb_id
cross join _r062_const k
where m.metric_key = 'CAREER_BWAR' and m.value = p.career_bwar and m.observed_through_date = k.through_date and m.observed_through_season = k.through_season
  and m.source_id = (select so.id from public.sources so where so.url = p.url) and m.confidence = k.confidence and m.notes = p.notes;

create temporary view _r062_conflicts as
select m.* from public.player_metric_observations m
join public.players pl on pl.id = m.player_id
where m.metric_key = 'CAREER_BWAR' and pl.slug in (select slug from _r062_players union all select slug from _r062_held) and m.id not in (select e.id from _r062_exact e);

create temporary table _r062_before on commit drop as
select (select max(generation_id) from public.product_executive_snapshot) as generation,
  (select count(*) from public.player_metric_observations) as observations_all,
  (select count(*) from public.sources) as sources,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(s)::text) as h from public.sources s) z) as sources_md5,
  (select count(*) from public.evidence) as evidence,
  (select count(*) from public.player_mlb_team_season_war) as war_rows,
  (select count(*) from public.player_mlb_team_season_war where record_status = 'ACTIVE') as war_active,
  (select count(*) from public.outcomes) as outcomes,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(m)::text) as h from public.player_metric_observations m
     where m.player_id not in (select pl.id from public.players pl join _r062_players p on p.slug = pl.slug)) z) as other_metric_observations;

do $$
declare
  k record;
  n int;
begin
  select * into k from _r062_const;
  n := (select count(*) from _r062_exact);
  if n = 0 and not exists (select 1 from _r062_conflicts) then
    raise exception 'rollback-062: Migration 062 is not applied';
  end if;
  if exists (select 1 from _r062_conflicts) then
    raise exception 'rollback-062: a CAREER_BWAR observation of the 39 is not a released 062 observation (later research on these players, or a changed 062 row); rollback refused';
  end if;
  if n <> k.n_players or (select count(distinct player_id) from _r062_exact) <> k.n_players then
    raise exception 'rollback-062: % of the % 062 observations exist; rollback refused', n, k.n_players;
  end if;
  if (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR') <> k.observations_before + k.n_players then
    raise exception 'rollback-062: the CAREER_BWAR observation count is not the released post-062 count; rollback refused';
  end if;
  raise notice 'rollback-062 phase guards: done at +%', clock_timestamp() - now();
end $$;

delete from public.player_metric_observations m where m.id in (select e.id from _r062_exact e);

do $$
declare
  b record;
  k record;
  missing_now text[];
  tn text;
  g bigint[];
  want bigint;
  refreshed boolean := false;
begin
  select * into b from _r062_before;
  select * into k from _r062_const;
  raise notice 'rollback-062 phase delete: done at +%', clock_timestamp() - now();
  if exists (select 1 from public.player_metric_observations m join public.players pl on pl.id = m.player_id
             where m.metric_key = 'CAREER_BWAR' and pl.slug in (select slug from _r062_players union all select slug from _r062_held))
     or (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR') <> k.observations_before
     or (select count(*) from public.player_metric_observations) <> b.observations_all - k.n_players
     or (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(m)::text) as h from public.player_metric_observations m
           where m.player_id not in (select pl.id from public.players pl join _r062_players p on p.slug = pl.slug)) z) is distinct from b.other_metric_observations then
    raise exception 'rollback-062 postcondition: the CAREER_BWAR observations are not the pre-062 observations';
  end if;
  missing_now := (select coalesce(array_agg(t.player_slug order by t.player_slug), '{}') from public.v_research_tasks t where t.task_type = 'BWAR_MISSING');
  if missing_now is distinct from (select coalesce(array_agg(slug order by slug), '{}') from _r062_missing) then
    raise exception 'rollback-062 postcondition: the BWAR_MISSING queue is not the pre-062 queue';
  end if;
  if (select count(*) from public.sources) <> b.sources
     or (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(s)::text) as h from public.sources s) z) is distinct from b.sources_md5
     or (select count(*) from public.evidence) <> b.evidence or (select count(*) from public.player_mlb_team_season_war) <> b.war_rows
     or (select count(*) from public.player_mlb_team_season_war where record_status = 'ACTIVE') <> b.war_active or (select count(*) from public.outcomes) <> b.outcomes then
    raise exception 'rollback-062 postcondition: a source, evidence row, team-season row or outcome moved';
  end if;
  raise notice 'rollback-062 phase postconditions: done at +%', clock_timestamp() - now();
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    perform * from public.disi_refresh_product_snapshots();
    refreshed := true;
  end if;
  want := b.generation + refreshed::int;
  if (select max(generation_id) from public.product_executive_snapshot) <> want
     or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception 'rollback-062 postcondition: expected one drift-free generation % (a refresh only when the snapshots drift)', want;
  end if;
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'product\_%' order by 1 loop
    execute format('select array_agg(distinct generation_id) from public.%I', tn) into g;
    if g is distinct from array[want] then
      raise exception 'rollback-062 postcondition: snapshot % is not at the single generation %', tn, want;
    end if;
  end loop;
  raise notice 'rollback-062 phase snapshots: done at +% (generation %, refreshed %)', clock_timestamp() - now(), want, refreshed;
end $$;

commit;
