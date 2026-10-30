-- DISI v0.44
-- 059_career_bwar_metric_reconciliation.sql
-- CAREER_BWAR metric observations for eleven benchmark players, derived from their complete 2026 Baseball-Reference team-season ledger. Run after 058.
--
-- Built from database/research/059/ (scope.json, baseline.json, build.mjs). Do not edit by hand: change the research and rebuild.
--
-- What this is. Reconciliation of the existing metric layer with facts DISI already holds, data only. It adds no table, view, function, grant,
-- policy, trigger, source, player, team-season row or outcome, and changes no definition.
--   * CAREER_BWAR is what 017 defines: a dated career-to-date Baseball-Reference bWAR observation (one row per player and observation date, so an
--     active player's total keeps its history). It is not a final career value; an active player is not excluded.
--   * Eleven benchmark players whose complete mapped team-season ledger 035 loaded from the live Baseball-Reference data files of 2026-09-28
--     (batting sha256 ef920800..., pitching sha256 061df2f8..., the files 032-035 pinned) gain one observation each: round(sum of their ACTIVE
--     BWAR batting and pitching team-season rows, 1), observed through 2026-09-28 / the 2026 season, citing the batting-file source and naming the
--     pitching file in the notes. This is the 032 derived pattern. Each value equals the player's stored outcomes.career_war at one decimal.
--   * The 057 eleven are not touched: their rows stop at 2025 and cite archived captures the CAREER_BWAR provider rule does not accept.
--   * BWAR_MISSING 50 -> 39 (benchmark signings only). Outcomes, labels, features, support, evaluations, every prediction output, team-season WAR,
--     transaction and organizational value, and every other table stay byte-identical.
-- It then runs the explicit snapshot refresh once, only when this run added an observation.
--
-- Rerunnable: every statement is idempotent; the refresh runs only when an observation was added.
--
-- Statement timeout. Hosted production sets statement_timeout = 2min at the session / database level, and each DO block below is one statement
-- (the postcondition block re-derives every isolation fingerprint). The first production attempt of this migration (2026-10-29 20:49:37Z) was
-- cancelled by that limit inside its postcondition block and rolled back whole, before any commit. The transaction therefore raises its own limit
-- with SET LOCAL, the refresh-product-snapshots.sql convention: it applies to this transaction only and reverts at COMMIT or ROLLBACK.

begin;
set local statement_timeout = '600s';

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m059 on commit drop as
select $m059${{payload_json}}$m059$::jsonb as j;

create temporary table _m059_players on commit drop as
select x ->> 'slug' as slug, x ->> 'bref_id' as bref_id, x ->> 'mlb_id' as mlb_id, (x ->> 'rows')::int as nrows, (x ->> 'bat_rows')::int as bat_rows,
  (x ->> 'pitch_rows')::int as pitch_rows, (x ->> 'bat_bwar')::numeric as bat_bwar, (x ->> 'pitch_bwar')::numeric as pitch_bwar,
  (x ->> 'raw_bwar')::numeric as raw_bwar, (x ->> 'career_bwar')::numeric as career_bwar, x ->> 'notes' as notes
from _m059, jsonb_array_elements(j -> 'players') x;

create temporary table _m059_excluded on commit drop as
select x #>> '{}' as slug from _m059, jsonb_array_elements(j -> 'excluded_057') x;

create temporary table _m059_missing on commit drop as
select k as kind, x #>> '{}' as slug
from _m059, lateral (values ('BEFORE', j #> '{baseline,bwar_missing_before}'), ('AFTER', j #> '{baseline,bwar_missing_after}')) v(k, a), jsonb_array_elements(v.a) x;

create temporary table _m059_const on commit drop as
select (j #>> '{semantics,observed_through_date}')::date as through_date, (j #>> '{semantics,observed_through_season}')::int as through_season,
  j #>> '{sources,bat_url}' as bat_url, j #>> '{sources,pitch_url}' as pitch_url,
  (j #>> '{baseline,career_bwar_observations}')::int as observations_before, (j #>> '{baseline,sources}')::int as sources_before
from _m059;

-- the observation 059 writes, exactly: player, metric, value, date, season, source, confidence and notes
create temporary view _m059_exact as
select m.* from public.player_metric_observations m
join public.players pl on pl.id = m.player_id join _m059_players p on p.slug = pl.slug
cross join _m059_const k
where m.metric_key = 'CAREER_BWAR' and m.value = p.career_bwar and m.observed_through_date = k.through_date and m.observed_through_season = k.through_season
  and m.source_id = (select so.id from public.sources so where so.url = k.bat_url) and m.confidence = 'VERIFIED' and m.notes = p.notes;

-- every CAREER_BWAR observation of the eleven that is not exactly the 059 observation (an earlier, later or changed one)
create temporary view _m059_conflicts as
select m.* from public.player_metric_observations m
join public.players pl on pl.id = m.player_id join _m059_players p on p.slug = pl.slug
where m.metric_key = 'CAREER_BWAR' and m.id not in (select e.id from _m059_exact e);

-- every public base table except the metric observations and the product snapshots, hashed row by row before anything is written
create temporary table _m059_tables (relname text primary key, h text) on commit drop;
do $$
declare tn text; hv text;
begin
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
             and c.relname <> 'player_metric_observations' and c.relname not like 'product\_%' order by 1 loop
    execute format('select md5(coalesce(string_agg(md5((to_jsonb(t) - ''updated_at'')::text), '''' order by md5((to_jsonb(t) - ''updated_at'')::text)), '''')) from public.%I t', tn) into hv;
    insert into _m059_tables values (tn, hv);
  end loop;
end $$;

-- the layers 059 must not move, as views, hashed the same way: prediction, outcomes, organizational and transaction value, the other research tasks
create temporary view _m059_untouched as
select (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(s)::text) as h from public.v_outcome_target_support s) z) as support,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(t)::text) as h from public.v_outcome_training_population t) z) as training_population,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(f)::text) as h from public.v_outcome_feature_matrix f) z) as feature_matrix,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(e)::text) as h from public.v_outcome_model_evaluation e) z) as evaluation_view,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(p)::text) as h from public.v_player_outcome_probability p) z) as probabilities,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(e)::text) as h from public.v_expected_value_support e) z) as expected_values,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(r)::text) as h from public.v_player_realized_outcome r) z) as realized_outcome,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(r)::text) as h from public.v_player_realized_organizational_value r) z) as realized_value,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(l)::text) as h from public.v_transaction_asset_lineage l) z) as lineage,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(x)::text) as h from public.v_transaction_research_queue x) z) as transaction_queue,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(x)::text) as h from public.v_value_research_queue x) z) as value_queue,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(x)::text) as h from public.v_executive_overview x) z) as executive_overview,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(t)::text) as h from public.v_research_tasks t
     where t.task_type <> 'BWAR_MISSING' or t.franchise_key = 'DODGERS') z) as other_research_tasks,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(m)::text) as h from public.player_metric_observations m
     where m.player_id not in (select pl.id from public.players pl join _m059_players p on p.slug = pl.slug)) z) as other_metric_observations;

create temporary table _m059_before on commit drop as
select (select max(generation_id) from public.product_executive_snapshot) as generation,
  (select count(*) from _m059_exact) as exact_before, u.* from _m059_untouched u;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 059 was written for
-- ===========================================================================

do $$
declare
  pp record;
  k record;
  pid uuid;
  n int;
  bat_src uuid;
  pitch_src uuid;
begin
  select * into k from _m059_const;
  if (select count(*) from _m059_players) <> 11 or (select count(distinct slug) from _m059_players) <> 11
     or exists (select 1 from _m059_players p join _m059_excluded x using (slug)) or (select count(*) from _m059_excluded) <> 11 then
    raise exception '059: the reviewed scope is not the eleven players, or a 057 player is in it';
  end if;
  if (select count(*) from public.sources where url = k.bat_url and source_type = 'WAR_DATA_FILE' and source_tier = 'BASEBALL_REFERENCE') <> 1
     or (select count(*) from public.sources where url = k.pitch_url and source_type = 'WAR_DATA_FILE' and source_tier = 'BASEBALL_REFERENCE') <> 1 then
    raise exception '059: the live Baseball-Reference data-file sources are not the registered ones';
  end if;
  if (select count(*) from public.sources) <> k.sources_before then
    raise exception '059: % sources, % reviewed', (select count(*) from public.sources), k.sources_before;
  end if;
  select id into bat_src from public.sources where url = k.bat_url;
  select id into pitch_src from public.sources where url = k.pitch_url;

  for pp in select * from _m059_players order by slug loop
    select pl.id into pid from public.players pl where pl.slug = pp.slug and pl.bref_id = pp.bref_id and pl.mlb_id::text = pp.mlb_id;
    if pid is null then
      raise exception '059: % is not the reviewed identity (% / %)', pp.slug, pp.bref_id, pp.mlb_id;
    end if;
    if (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id
        where s.player_id = pid and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT' and o.franchise_key <> 'DODGERS') <> 1
       or (select count(*) from public.signings s where s.player_id = pid) <> 1
       or not exists (select 1 from public.outcome_audits a where a.player_id = pid and a.reached_mlb_verified) then
      raise exception '059: % is not a single verified-MLB benchmark signing', pp.slug;
    end if;
    -- the complete mapped ledger, exactly as reviewed: ACTIVE BWAR rows, every row on the matching live file, no TOT, no unmapped team, no duplicate
    if (select count(*) from public.player_mlb_team_season_war w where w.player_id = pid and w.record_status = 'ACTIVE' and w.war_system = 'BWAR') <> pp.nrows
       or (select count(*) from public.player_mlb_team_season_war w where w.player_id = pid and w.record_status = 'ACTIVE' and w.component = 'BAT') <> pp.bat_rows
       or (select count(*) from public.player_mlb_team_season_war w where w.player_id = pid and w.record_status = 'ACTIVE' and w.component = 'PITCH') <> pp.pitch_rows
       or exists (select 1 from public.player_mlb_team_season_war w where (w.player_id = pid or w.bref_id = pp.bref_id) and w.record_status = 'ACTIVE'
                  and (w.player_id is distinct from pid or w.bref_id <> pp.bref_id or w.war_system <> 'BWAR' or w.component not in ('BAT', 'PITCH')
                       or w.bref_team_code = 'TOT' or w.organization_id is null
                       or w.source_id <> case w.component when 'BAT' then bat_src when 'PITCH' then pitch_src end
                       or w.observed_through_date <> k.through_date or w.observed_through_season <> k.through_season))
       or exists (select 1 from public.player_mlb_team_season_war w where w.player_id = pid and w.record_status = 'ACTIVE'
                  group by w.season, w.bref_team_code, w.stint_ordinal, w.component having count(*) > 1) then
      raise exception '059: the team-season ledger of % is not the reviewed complete mapped ledger', pp.slug;
    end if;
    if (select coalesce(sum(w.war) filter (where w.component = 'BAT'), 0) from public.player_mlb_team_season_war w where w.player_id = pid and w.record_status = 'ACTIVE') <> pp.bat_bwar
       or (select coalesce(sum(w.war) filter (where w.component = 'PITCH'), 0) from public.player_mlb_team_season_war w where w.player_id = pid and w.record_status = 'ACTIVE') <> pp.pitch_bwar
       or (select sum(w.war) from public.player_mlb_team_season_war w where w.player_id = pid and w.record_status = 'ACTIVE') <> pp.raw_bwar
       or (select round(sum(w.war), 1) from public.player_mlb_team_season_war w where w.player_id = pid and w.record_status = 'ACTIVE') <> pp.career_bwar then
      raise exception '059: the team-season bWAR of % is not the reviewed % (rounded %)', pp.slug, pp.raw_bwar, pp.career_bwar;
    end if;
    if (select oc.career_war from public.outcomes oc where oc.player_id = pid) is distinct from pp.raw_bwar then
      raise exception '059: outcomes.career_war of % is not the reviewed %', pp.slug, pp.raw_bwar;
    end if;
  end loop;

  if exists (select 1 from _m059_conflicts) then
    raise exception '059: a CAREER_BWAR observation of the eleven exists that is not the 059 observation (an earlier, later or changed one); refused';
  end if;
  if exists (select 1 from public.player_metric_observations m join public.players pl on pl.id = m.player_id join _m059_excluded x on x.slug = pl.slug) then
    raise exception '059: a 057 player has a CAREER_BWAR observation';
  end if;

  n := (select count(*) from _m059_exact);
  if n = 0 then
    if (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR') <> k.observations_before then
      raise exception '059: % CAREER_BWAR observations, % reviewed', (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR'), k.observations_before;
    end if;
    if exists (select player_slug from public.v_research_tasks where task_type = 'BWAR_MISSING' except select slug from _m059_missing where kind = 'BEFORE')
       or exists (select slug from _m059_missing where kind = 'BEFORE' except select player_slug from public.v_research_tasks where task_type = 'BWAR_MISSING')
       or (select count(*) from public.v_research_tasks where task_type = 'BWAR_MISSING') <> (select count(*) from _m059_missing where kind = 'BEFORE') then
      raise exception '059: the BWAR_MISSING queue is not the reviewed pre-059 queue';
    end if;
    if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
      raise exception '059: the product snapshots are not current (drift before 059)';
    end if;
  elsif n <> 11 then
    raise exception '059: % of the eleven 059 observations exist; refused', n;
  end if;
end $$;

-- ===========================================================================
-- 2. THE OBSERVATIONS: derived from the ledger, written only after every check above
-- ===========================================================================

insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence, notes)
select pl.id, 'CAREER_BWAR', round(sum(w.war), 1), k.through_date, k.through_season, (select so.id from public.sources so where so.url = k.bat_url), 'VERIFIED', p.notes
from _m059_players p
join public.players pl on pl.slug = p.slug
join public.player_mlb_team_season_war w on w.player_id = pl.id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
cross join _m059_const k
where not exists (select 1 from public.player_metric_observations m where m.player_id = pl.id and m.metric_key = 'CAREER_BWAR')
group by pl.id, k.through_date, k.through_season, k.bat_url, p.notes;

-- ===========================================================================
-- 3. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  b record;
  k record;
  u record;
  t record;
  hv text;
begin
  select * into b from _m059_before;
  select * into k from _m059_const;
  select * into u from _m059_untouched;
  if (select count(*) from _m059_exact) <> 11 or exists (select 1 from _m059_conflicts)
     or exists (select 1 from _m059_players p where (select count(*) from _m059_exact e join public.players pl on pl.id = e.player_id where pl.slug = p.slug) <> 1) then
    raise exception '059 postcondition: the eleven observations are not exactly the reviewed ones';
  end if;
  if (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR') <> k.observations_before + 11
     or exists (select 1 from public.player_metric_observations m join public.players pl on pl.id = m.player_id join _m059_excluded x on x.slug = pl.slug) then
    raise exception '059 postcondition: % CAREER_BWAR observations, % reviewed (or a 057 player has one)',
      (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR'), k.observations_before + 11;
  end if;
  if exists (select 1 from _m059_players p join public.players pl on pl.slug = p.slug left join public.v_player_war v on v.player_id = pl.id
             where v.career_bwar is distinct from p.career_bwar or v.bwar_observed_through_season is distinct from k.through_season
                or v.bwar_observed_through_date is distinct from k.through_date or v.bwar_source_url is distinct from k.bat_url) then
    raise exception '059 postcondition: v_player_war does not read the 059 observation for each of the eleven';
  end if;
  if exists (select player_slug from public.v_research_tasks where task_type = 'BWAR_MISSING' except select slug from _m059_missing where kind = 'AFTER')
     or exists (select slug from _m059_missing where kind = 'AFTER' except select player_slug from public.v_research_tasks where task_type = 'BWAR_MISSING')
     or (select count(*) from public.v_research_tasks where task_type = 'BWAR_MISSING') <> (select count(*) from _m059_missing where kind = 'AFTER') then
    raise exception '059 postcondition: the BWAR_MISSING queue is not the reviewed post-059 queue';
  end if;
  for t in select * from _m059_tables order by relname loop
    execute format('select md5(coalesce(string_agg(md5((to_jsonb(t) - ''updated_at'')::text), '''' order by md5((to_jsonb(t) - ''updated_at'')::text)), '''')) from public.%I t', t.relname) into hv;
    if hv is distinct from t.h then
      raise exception '059 postcondition: table % changed', t.relname;
    end if;
  end loop;
  if (u.support, u.training_population, u.feature_matrix, u.evaluation_view, u.probabilities, u.expected_values, u.realized_outcome)
       is distinct from (b.support, b.training_population, b.feature_matrix, b.evaluation_view, b.probabilities, b.expected_values, b.realized_outcome) then
    raise exception '059 postcondition: the prediction or outcome layer moved';
  end if;
  if (u.realized_value, u.lineage, u.transaction_queue, u.value_queue, u.executive_overview)
       is distinct from (b.realized_value, b.lineage, b.transaction_queue, b.value_queue, b.executive_overview) then
    raise exception '059 postcondition: organizational or transaction value moved';
  end if;
  if (u.other_research_tasks, u.other_metric_observations) is distinct from (b.other_research_tasks, b.other_metric_observations) then
    raise exception '059 postcondition: another research task or another player''s metric observation moved';
  end if;
end $$;

-- ===========================================================================
-- 4. GENERATION: one coherent refresh, only when this run added an observation
-- ===========================================================================

do $$
declare
  b record;
begin
  select * into b from _m059_before;
  if b.exact_before = 0 then
    perform * from public.disi_refresh_product_snapshots();
    if (select max(generation_id) from public.product_executive_snapshot) <> b.generation + 1
       or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
      raise exception '059 postcondition: the refresh did not produce exactly one new drift-free generation';
    end if;
  elsif (select max(generation_id) from public.product_executive_snapshot) <> b.generation then
    raise exception '059 postcondition: a rerun changed the snapshot generation';
  end if;
end $$;

commit;
