-- DISI rollback of Migration 059 (career bWAR metric reconciliation)
-- Deletes exactly the eleven CAREER_BWAR observations 059 wrote and restores the pre-059 state. One guarded transaction.
--
-- Built from database/research/059/ (build.mjs). Do not edit by hand.
--
-- Metric observations have no ACTIVE / RETRACTED lifecycle, so the reversal is a delete of exactly the 059 rows: each one must match the released
-- player, value, observation date (2026-09-28), season (2026), source (the live batting data file), confidence and notes. It refuses when 059 is
-- not applied, when any of the eleven has a CAREER_BWAR observation that is not exactly the 059 one (a later observation, or a changed 059 row),
-- and when fewer than eleven 059 rows exist. No source, team-season row, outcome or other observation is touched; the refresh runs once.

begin;

create temporary table _r059 on commit drop as
select $r059${{payload_json}}$r059$::jsonb as j;

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

create temporary table _r059_tables (relname text primary key, h text) on commit drop;
do $$
declare tn text; hv text;
begin
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
             and c.relname <> 'player_metric_observations' and c.relname not like 'product\_%' order by 1 loop
    execute format('select md5(coalesce(string_agg(md5((to_jsonb(t) - ''updated_at'')::text), '''' order by md5((to_jsonb(t) - ''updated_at'')::text)), '''')) from public.%I t', tn) into hv;
    insert into _r059_tables values (tn, hv);
  end loop;
end $$;

create temporary view _r059_untouched as
select (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(s)::text) as h from public.v_outcome_target_support s) z) as support,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(t)::text) as h from public.v_outcome_training_population t) z) as training_population,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(f)::text) as h from public.v_outcome_feature_matrix f) z) as feature_matrix,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(e)::text) as h from public.v_outcome_model_evaluation e) z) as evaluation_view,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(r)::text) as h from public.v_player_realized_organizational_value r) z) as realized_value,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(x)::text) as h from public.v_transaction_research_queue x) z) as transaction_queue,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(x)::text) as h from public.v_value_research_queue x) z) as value_queue,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(t)::text) as h from public.v_research_tasks t
     where t.task_type <> 'BWAR_MISSING' or t.franchise_key = 'DODGERS') z) as other_research_tasks,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(m)::text) as h from public.player_metric_observations m
     where m.player_id not in (select pl.id from public.players pl join _r059_players p on p.slug = pl.slug)) z) as other_metric_observations;

create temporary table _r059_before on commit drop as
select (select max(generation_id) from public.product_executive_snapshot) as generation, u.* from _r059_untouched u;

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
end $$;

delete from public.player_metric_observations m where m.id in (select e.id from _r059_exact e);

do $$
declare
  b record;
  u record;
  t record;
  hv text;
begin
  select * into b from _r059_before;
  select * into u from _r059_untouched;
  if exists (select 1 from public.player_metric_observations m join public.players pl on pl.id = m.player_id join _r059_players p on p.slug = pl.slug
             where m.metric_key = 'CAREER_BWAR')
     or (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR') <> (select observations_before from _r059_const) then
    raise exception 'rollback-059 postcondition: the CAREER_BWAR observations are not the pre-059 observations';
  end if;
  if exists (select player_slug from public.v_research_tasks where task_type = 'BWAR_MISSING' except select slug from _r059_missing)
     or exists (select slug from _r059_missing except select player_slug from public.v_research_tasks where task_type = 'BWAR_MISSING')
     or (select count(*) from public.v_research_tasks where task_type = 'BWAR_MISSING') <> (select count(*) from _r059_missing) then
    raise exception 'rollback-059 postcondition: the BWAR_MISSING queue is not the pre-059 queue';
  end if;
  for t in select * from _r059_tables order by relname loop
    execute format('select md5(coalesce(string_agg(md5((to_jsonb(t) - ''updated_at'')::text), '''' order by md5((to_jsonb(t) - ''updated_at'')::text)), '''')) from public.%I t', t.relname) into hv;
    if hv is distinct from t.h then
      raise exception 'rollback-059 postcondition: table % changed', t.relname;
    end if;
  end loop;
  if (u.support, u.training_population, u.feature_matrix, u.evaluation_view, u.realized_value, u.transaction_queue, u.value_queue, u.other_research_tasks, u.other_metric_observations)
       is distinct from (b.support, b.training_population, b.feature_matrix, b.evaluation_view, b.realized_value, b.transaction_queue, b.value_queue, b.other_research_tasks, b.other_metric_observations) then
    raise exception 'rollback-059 postcondition: a layer other than the eleven observations moved';
  end if;
  perform * from public.disi_refresh_product_snapshots();
  if (select max(generation_id) from public.product_executive_snapshot) <> b.generation + 1
     or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception 'rollback-059 postcondition: the refresh did not produce exactly one new drift-free generation';
  end if;
end $$;

commit;
