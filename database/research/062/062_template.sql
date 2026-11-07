-- DISI v0.47
-- 062_bwar_backlog_closure.sql
-- bWAR backlog closure: owner-observed current career bWAR from the Baseball-Reference player pages for the BWAR_MISSING players. Run after 061.
--
-- Built from database/research/062/ (owner-input.json, audit.json, baseline-build.json, build.mjs). Do not edit by hand: change the input and rebuild.
--
-- What this is. A reviewed data batch: one sources row and one CAREER_BWAR observation per written player. It adds no table, column, view,
-- function, trigger, enum, grant or policy, and changes no definition: the 017 provider rule already accepts the canonical Baseball-Reference
-- player URL, so no provider or schema change is made.
--   * The input is OWNER-OBSERVED. The DISI owner read the current career WAR on each player's Baseball-Reference page
--     (https://www.baseball-reference.com/players/<l>/<bref_id>.shtml) and supplied the 39 values on 2026-11-06. DISI and no automated process
--     read those pages. Every source row and observation says so, and the confidence is UNVERIFIED, the 060 convention for owner input.
--   * Identity: every bref_id / mlb_id pair is the one the 062 audit verified (MLB Stats API person record; the Baseball-Reference WAR data files'
--     player_ID / mlb_ID pairing). No identity is written.
--   * Written: each value exactly as supplied (one decimal; negatives kept; 0.0 a known observed value, never NULL), observed through 2026-11-06 /
--     the 2026 season, citing that player's page.
--   * Held (NULL, keeping BWAR_MISSING): a player whose current career value would contradict the team-season ledger DISI already holds (057 rows
--     through 2025, and outcomes.career_war) by more than the verifier's 0.1 career reconciliation tolerance. The reason is in
--     career-bwar-evidence.json.
--   * Sources, team-season WAR, outcomes, signings, transactions, evidence and every prediction output are otherwise unchanged.
-- It then refreshes the product snapshots once, only if the snapshots drift.
--
-- Rerunnable: a rerun finds every source and observation present and changes nothing. rollback-062 deletes the observations and keeps the source
-- rows as provenance (the 049 / 061 convention); a reapply finds them and does not duplicate them.
--
-- Statement timeout: SET LOCAL 600s for this transaction only (hosted production defaults to 2min per statement). Verification: inexpensive direct
-- checks inside the transaction; the full isolation evidence is measured outside it (database/research/062/report.mjs).

begin;
set local statement_timeout = '600s';

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m062 on commit drop as
select $m062${{payload_json}}$m062$::jsonb as j;

create temporary table _m062_players on commit drop as
select x ->> 'slug' as slug, x ->> 'bref_id' as bref_id, x ->> 'mlb_id' as mlb_id, (x ->> 'career_bwar')::numeric as career_bwar, x ->> 'url' as url,
  x ->> 'title' as title, x ->> 'source_notes' as source_notes, x ->> 'notes' as notes
from _m062, jsonb_array_elements(j -> 'players') x;

create temporary table _m062_held on commit drop as
select x ->> 'slug' as slug, x ->> 'bref_id' as bref_id from _m062, jsonb_array_elements(j -> 'rejected') x;

create temporary table _m062_missing on commit drop as
select k as kind, x #>> '{}' as slug
from _m062, lateral (values ('BEFORE', j #> '{baseline,bwar_missing_before}'), ('AFTER', j #> '{baseline,bwar_missing_after}')) v(k, a), jsonb_array_elements(v.a) x;

create temporary table _m062_const on commit drop as
select (j #>> '{semantics,observed_through_date}')::date as through_date, (j #>> '{semantics,observed_through_season}')::int as through_season,
  (j #>> '{semantics,confidence}')::public.confidence_level as confidence, (j #>> '{semantics,accessed_at}')::timestamptz as accessed_at,
  (j #>> '{baseline,career_bwar_observations}')::int as observations_before, (j #>> '{baseline,sources}')::int as sources_before,
  (j #>> '{baseline,evidence}')::int as evidence_before,
  (select count(*) from _m062_players) as n_players, (select count(*) from _m062_held) as n_held
from _m062;

-- the source row 062 writes for each player, exactly
create temporary view _m062_source_exact as
select s.* from public.sources s join _m062_players p on p.url = s.url cross join _m062_const k
where s.source_name = 'Baseball-Reference' and s.source_type = 'PLAYER_PAGE' and s.source_tier = 'BASEBALL_REFERENCE' and s.title = p.title
  and s.author is null and s.publication_date is null and s.accessed_at = k.accessed_at and s.notes = p.source_notes;

-- the observation 062 writes, exactly: player, metric, value, date, season, source, confidence and notes
create temporary view _m062_exact as
select m.* from public.player_metric_observations m
join public.players pl on pl.id = m.player_id join _m062_players p on p.slug = pl.slug and pl.bref_id = p.bref_id and pl.mlb_id::text = p.mlb_id
cross join _m062_const k
where m.metric_key = 'CAREER_BWAR' and m.value = p.career_bwar and m.observed_through_date = k.through_date and m.observed_through_season = k.through_season
  and m.source_id = (select so.id from _m062_source_exact so where so.url = p.url) and m.confidence = k.confidence and m.notes = p.notes;

-- every CAREER_BWAR observation of the 39 that is not exactly a 062 observation (an earlier, later or changed one, or one for a held player)
create temporary view _m062_conflicts as
select m.* from public.player_metric_observations m
join public.players pl on pl.id = m.player_id
where m.metric_key = 'CAREER_BWAR' and pl.slug in (select slug from _m062_players union all select slug from _m062_held) and m.id not in (select e.id from _m062_exact e);

-- the inexpensive counters the postcondition compares
create temporary table _m062_before on commit drop as
select (select max(generation_id) from public.product_executive_snapshot) as generation,
  (select count(*) from _m062_exact) as exact_before,
  (select count(*) from _m062_source_exact) as sources_062_before,
  (select count(*) from public.player_metric_observations) as observations_all,
  (select count(*) from public.sources) as sources,
  (select count(*) from public.evidence) as evidence,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(s)::text) as h from public.sources s where s.url not in (select url from _m062_players)) z) as other_sources,
  (select count(*) from public.player_mlb_team_season_war) as war_rows,
  (select count(*) from public.player_mlb_team_season_war where record_status = 'ACTIVE') as war_active,
  (select count(*) from public.outcomes) as outcomes,
  (select count(*) from public.signings) as signings,
  (select count(*) from public.transaction_event_assets) as transaction_assets,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(oc)::text) as h from public.outcomes oc
     join public.players pl on pl.id = oc.player_id where pl.slug in (select slug from _m062_players union all select slug from _m062_held)) z) as scoped_outcomes,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(m)::text) as h from public.player_metric_observations m
     where m.player_id not in (select pl.id from public.players pl join _m062_players p on p.slug = pl.slug)) z) as other_metric_observations;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 062 was written for
-- ===========================================================================

do $$
declare
  pp record;
  k record;
  pid uuid;
  n int;
  s int;
  ledger numeric;
  outcome numeric;
  missing_now text[];
begin
  select * into k from _m062_const;
  -- the 017 rule (unchanged): a CAREER_BWAR row must cite a Baseball-Reference URL
  if to_regprocedure('public.player_metric_observations_check_provider()') is null
     or pg_get_functiondef('public.player_metric_observations_check_provider()'::regprocedure) !~ 'baseball-reference'
     or not exists (select 1 from pg_trigger t where t.tgrelid = 'public.player_metric_observations'::regclass and t.tgname = 'player_metric_observations_check_provider'
                    and t.tgfoid = 'public.player_metric_observations_check_provider()'::regprocedure and t.tgenabled = 'O' and not t.tgisinternal) then
    raise exception '062: the CAREER_BWAR provider rule is not the 017 Baseball-Reference rule';
  end if;
  if k.n_players + k.n_held <> 39 or (select count(distinct slug) from (select slug from _m062_players union all select slug from _m062_held) z) <> 39
     or exists (select 1 from _m062_players where url !~ '^https://www\.baseball-reference\.com/players/[a-z]/[a-z][a-z0-9]+\.shtml$'
                or url <> 'https://www.baseball-reference.com/players/' || left(bref_id, 1) || '/' || bref_id || '.shtml') then
    raise exception '062: the reviewed rows are not 39 distinct players, or a URL is not the canonical player page of its bref_id';
  end if;
  for pp in select slug, bref_id, career_bwar from _m062_players union all select slug, bref_id, null from _m062_held order by 1 loop
    select pl.id into pid from public.players pl where pl.slug = pp.slug and pl.bref_id = pp.bref_id;
    if pid is null then
      raise exception '062: % is not the reviewed identity (%)', pp.slug, pp.bref_id;
    end if;
    if not exists (select 1 from public.v_signing_records r where r.player_id = pid and r.reached_mlb_verified is true) then
      raise exception '062: % is not a verified MLB player', pp.slug;
    end if;
    -- a written value stays reconcilable with any team-season ledger and outcomes.career_war DISI holds (the verifier's 0.1)
    if pp.career_bwar is not null then
      select sum(w.war) into ledger from public.player_mlb_team_season_war w where w.player_id = pid and w.record_status = 'ACTIVE' and w.war_system = 'BWAR';
      select oc.career_war into outcome from public.outcomes oc where oc.player_id = pid;
      if (ledger is not null and abs(pp.career_bwar - ledger) > 0.1) or (outcome is not null and abs(pp.career_bwar - outcome) > 0.1) then
        raise exception '062: % % would contradict its team-season ledger % / outcomes %', pp.slug, pp.career_bwar, ledger, outcome;
      end if;
    end if;
  end loop;
  -- each source URL: absent, or exactly the reviewed 062 row (a rerun or a reapply after rollback); never another row with that URL
  s := (select count(*) from _m062_source_exact);
  if exists (select 1 from public.sources so join _m062_players p on p.url = so.url where so.id not in (select id from _m062_source_exact)) then
    raise exception '062: a source row with a 062 player URL exists that is not the reviewed row; refused';
  end if;
  if s not in (0, k.n_players) then
    raise exception '062: % of the % reviewed source rows exist; refused', s, k.n_players;
  end if;
  if (select count(*) from public.sources) <> k.sources_before + s or (select count(*) from public.evidence) <> k.evidence_before then
    raise exception '062: % sources and % evidence rows, % / % reviewed', (select count(*) from public.sources), (select count(*) from public.evidence), k.sources_before + s, k.evidence_before;
  end if;
  if exists (select 1 from _m062_conflicts) then
    raise exception '062: a CAREER_BWAR observation of the 39 exists that is not a 062 observation (an earlier, later or changed one, or one for a held player); refused';
  end if;
  n := (select count(*) from _m062_exact);
  if n = 0 then
    if (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR') <> k.observations_before then
      raise exception '062: % CAREER_BWAR observations, % reviewed', (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR'), k.observations_before;
    end if;
    missing_now := (select coalesce(array_agg(t.player_slug order by t.player_slug), '{}') from public.v_research_tasks t where t.task_type = 'BWAR_MISSING');
    if missing_now is distinct from (select coalesce(array_agg(slug order by slug), '{}') from _m062_missing where kind = 'BEFORE') then
      raise exception '062: the BWAR_MISSING queue is not the reviewed pre-062 queue';
    end if;
    if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
      raise exception '062: the product snapshots drift before 062';
    end if;
  elsif n <> k.n_players or s <> k.n_players then
    raise exception '062: % of the % 062 observations exist; refused', n, k.n_players;
  end if;
  raise notice '062 phase preconditions: done at +% (% already applied)', clock_timestamp() - now(), n;
end $$;

-- ===========================================================================
-- 2. THE SOURCES: the owner-observed player page of each written player (found, not duplicated, on a rerun or reapply)
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, author, publication_date, accessed_at, notes, source_tier)
select 'Baseball-Reference', 'PLAYER_PAGE', p.title, p.url, null, null, k.accessed_at, p.source_notes, 'BASEBALL_REFERENCE'
from _m062_players p cross join _m062_const k
where not exists (select 1 from public.sources so where so.url = p.url)
order by p.slug;

-- ===========================================================================
-- 3. THE OBSERVATIONS: the owner's values exactly, written only after every check above
-- ===========================================================================

insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence, notes)
select pl.id, 'CAREER_BWAR', p.career_bwar, k.through_date, k.through_season, so.id, k.confidence, p.notes
from _m062_players p
join public.players pl on pl.slug = p.slug and pl.bref_id = p.bref_id and pl.mlb_id::text = p.mlb_id
join public.sources so on so.url = p.url
cross join _m062_const k
where not exists (select 1 from public.player_metric_observations m where m.player_id = pl.id and m.metric_key = 'CAREER_BWAR')
order by p.slug;

-- ===========================================================================
-- 4. POSTCONDITIONS: the direct result of the write
-- ===========================================================================

do $$
declare
  b record;
  k record;
  missing_now text[];
begin
  select * into b from _m062_before;
  select * into k from _m062_const;
  raise notice '062 phase insert: done at +%', clock_timestamp() - now();
  if (select count(*) from _m062_source_exact) <> k.n_players or (select count(*) from _m062_exact) <> k.n_players or exists (select 1 from _m062_conflicts)
     or exists (select 1 from _m062_players p where (select count(*) from _m062_exact e join public.players pl on pl.id = e.player_id where pl.slug = p.slug) <> 1) then
    raise exception '062 postcondition: the source rows and observations are not exactly the reviewed ones';
  end if;
  if (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR') <> k.observations_before + k.n_players
     or (select count(*) from public.player_metric_observations) <> b.observations_all + (k.n_players - b.exact_before)
     or exists (select 1 from public.player_metric_observations m join public.players pl on pl.id = m.player_id join _m062_held h on h.slug = pl.slug) then
    raise exception '062 postcondition: % CAREER_BWAR observations, % reviewed (or a held player has one)',
      (select count(*) from public.player_metric_observations where metric_key = 'CAREER_BWAR'), k.observations_before + k.n_players;
  end if;
  if (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(m)::text) as h from public.player_metric_observations m
        where m.player_id not in (select pl.id from public.players pl join _m062_players p on p.slug = pl.slug)) z) is distinct from b.other_metric_observations then
    raise exception '062 postcondition: another player''s metric observation moved';
  end if;
  -- the consuming view reads each owner value exactly (0.0 is a value, negatives stay negative), citing that player's page
  if exists (select 1 from _m062_players p join public.players pl on pl.slug = p.slug left join public.v_player_war v on v.player_id = pl.id
             where v.career_bwar is null or v.career_bwar <> p.career_bwar or v.bwar_observed_through_season is distinct from k.through_season
                or v.bwar_observed_through_date is distinct from k.through_date or v.bwar_source_url is distinct from p.url) then
    raise exception '062 postcondition: v_player_war does not read the 062 observation for each written player';
  end if;
  missing_now := (select coalesce(array_agg(t.player_slug order by t.player_slug), '{}') from public.v_research_tasks t where t.task_type = 'BWAR_MISSING');
  if missing_now is distinct from (select coalesce(array_agg(slug order by slug), '{}') from _m062_missing where kind = 'AFTER') then
    raise exception '062 postcondition: the BWAR_MISSING queue is not the reviewed post-062 queue';
  end if;
  if (select count(*) from public.sources) <> b.sources + (k.n_players - b.sources_062_before) or (select count(*) from public.evidence) <> b.evidence
     or (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(s)::text) as h from public.sources s where s.url not in (select url from _m062_players)) z) is distinct from b.other_sources
     or (select count(*) from public.player_mlb_team_season_war) <> b.war_rows
     or (select count(*) from public.player_mlb_team_season_war where record_status = 'ACTIVE') <> b.war_active
     or (select count(*) from public.outcomes) <> b.outcomes or (select count(*) from public.signings) <> b.signings
     or (select count(*) from public.transaction_event_assets) <> b.transaction_assets
     or (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(oc)::text) as h from public.outcomes oc
           join public.players pl on pl.id = oc.player_id where pl.slug in (select slug from _m062_players union all select slug from _m062_held)) z) is distinct from b.scoped_outcomes then
    raise exception '062 postcondition: another source, an evidence row, a team-season row, an outcome, a signing or a transaction asset moved';
  end if;
  raise notice '062 phase postconditions: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 5. GENERATION: one coherent refresh, only if the snapshots drift
-- ===========================================================================

do $$
declare
  b record;
  tn text;
  g bigint[];
  want bigint;
  refreshed boolean := false;
begin
  select * into b from _m062_before;
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    perform * from public.disi_refresh_product_snapshots();
    refreshed := true;
  end if;
  want := b.generation + refreshed::int;
  if (select max(generation_id) from public.product_executive_snapshot) <> want
     or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception '062 postcondition: expected one drift-free generation % (a refresh only when the snapshots drift)', want;
  end if;
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'product\_%' order by 1 loop
    execute format('select array_agg(distinct generation_id) from public.%I', tn) into g;
    if g is distinct from array[want] then
      raise exception '062 postcondition: snapshot % is not at the single generation %', tn, want;
    end if;
  end loop;
  raise notice '062 phase snapshots: done at +% (generation %, refreshed %)', clock_timestamp() - now(), want, refreshed;
end $$;

commit;
