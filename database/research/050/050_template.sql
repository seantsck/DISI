-- DISI v0.36.6
-- 050_international_benchmark_support_expansion.sql
-- The mature international benchmark expansion and the probability-support audit. Run after 049.
--
-- Built from database/research/050/ (source-cohorts.json, identity-research.json, outcome-research.json, evaluation.json, build.mjs).
--
-- What this is. A reviewed research batch plus one definition fix. It adds no table, view, function, grant or policy.
--   * The MLB Pipeline international Top 30 lists of the 2015 and 2016 classes, read from the archived official data feed, as two new
--     TOP_PROSPECT_SAMPLE populations. A listed player becomes a benchmark signing only when the official MLB transaction log shows his
--     signing and his identity is resolved by more than his name (the club the list names, the signing date inside the class window, the
--     person record's birth date, the register's birth date, the position). RANKING APPEARANCE != NEW SIGNING; RANKING CLASS YEAR != SIGNING
--     YEAR (the signing year is the year of the official signing, so a 2016-list player signed in 2017 has signing_year 2017); SOURCE LIST
--     MEMBERSHIP != VERIFIED SIGNING (unresolved members are queued, not added).
--   * The two listed players the Dodgers signed (Starling Heredia, Ronny Brito) keep their one Dodgers signing, untouched: it already carries an
--     MLB Pipeline international rank (another edition of the list), so the rank is represented and no Dodgers row changes. A ranked prospect
--     never becomes a second, benchmark copy of a Dodgers signing.
--   * Two of the five benchmark identities 035 left unresolved (Emmanuel DeJesus, Micker Zapata), resolved from the official signing
--     transaction of the tracker's own club; one is an open disagreement (Yeyson Yrizarry) and two have no official record (Yeremy Rosario,
--     Jonathan Amundaray). They stay unresolved.
--   * MLB outcome audits at the unchanged 2026-10-05 boundary. MISSING BWAR != ZERO BWAR: the Baseball-Reference data files answer 403, so no
--     team-season row is loaded and a reacher's bWAR-target label stays NULL (041 decides every label; nothing here writes one).
--   * The stored 041 model evaluation, re-run on the 050 data with the same targets, features, models and out-of-time validation, so it is
--     current again (the previous rows are proven before they are replaced).
--   * BENCHMARK SUPPORT != DODGERS SUPPORT. The executive overview counted a target as a supported probability target when ANY reference
--     population supported it, while probabilities are shown only for the Dodgers population. With a benchmark-only baseline the overview
--     would have said probabilities are published when none are. One statement of disi_executive_overview() now counts only the population
--     predictions are made for. The function's signature, grants and every other statement are unchanged.
-- It then runs the explicit snapshot refresh once, only when this run changed a row.
--
-- Rerunnable: every statement is idempotent; the refresh runs only when a row was added or changed.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m050 on commit drop as
select $m050${{payload_json}}$m050$::jsonb as j;

create temporary table _m050_before on commit drop as
select
  (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) as dodgers_signings_hash,
  (select md5(string_agg(t, '|' order by t)) from (select a::text as t from public.outcome_audits a join public.signings s on s.player_id = a.player_id
     join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) as dodgers_audits_hash,
  (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) as war_hash,
  (select md5(string_agg(t, '|' order by t)) from (select r::text as t from public.signing_financial_reports r) x) as financial_hash,
  (select md5(string_agg(t, '|' order by t)) from (select e::text as t from public.transaction_events e union all select a::text from public.transaction_event_assets a) x) as transactions_hash,
  (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.player_season_stints s union all select m::text from public.development_milestones m) x) as development_hash,
  (select md5(string_agg(t, '|' order by t)) from (select x::text as t from public.signings x where x.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
     and x.player_id not in (select pl.id from public.players pl, _m050, jsonb_array_elements(j -> 'new_players') p where pl.slug = p ->> 'slug')) y) as old_benchmark_signings_hash,
  (select md5(string_agg(t, '|' order by t)) from (
     select p::text as t from public.players p union all select s::text from public.signings s union all select a::text from public.outcome_audits a
     union all select o::text from public.outcomes o union all select e::text from public.player_evaluations e union all select m::text from public.outcome_model_evaluations m
     union all select sp::text from public.signing_populations sp union all select pm::text from public.signing_population_members pm
     union all select pg_get_functiondef('public.disi_executive_overview()'::regprocedure)) z) as content_hash
from _m050;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 050 was written for
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
  k text;
  rerun boolean;
begin
  if (select count(*) from public.transaction_events where event_key in ('LAD_MIN_1967_BOB_MILLER', 'LAD_FREE_AGENCY_2009_JON_GARLAND')) <> 2 then
    raise exception '050: Migration 049 has not been applied';
  end if;
  if to_regprocedure('public.disi_refresh_product_snapshots()') is null or to_regclass('public.v_outcome_model_evaluation') is null then
    raise exception '050: the 041 / 045a objects are missing';
  end if;
  if not exists (select 1 from public.scouting_publications where publication_slug = (select j ->> 'publication_slug' from _m050)) then
    raise exception '050: the MLB Pipeline international publication is missing';
  end if;
  rerun := exists (select 1 from public.signing_populations where population_key in (select x ->> 'population_key' from _m050, jsonb_array_elements(j -> 'populations') x));
  -- the Dodgers-facing state 050 must not move (re-proved, unchanged, after the writes)
  if (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') <> (select (j #>> '{baseline,counts,dodgers_signings}')::int from _m050)
     or (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id join public.outcome_audits a on a.player_id = s.player_id where o.franchise_key = 'DODGERS')
        <> (select (j #>> '{baseline,counts,dodgers_audits}')::int from _m050) then
    raise exception '050: the Dodgers signings or audits are not in the state the research was written for';
  end if;
  if not rerun then
    if (select count(*) from public.players) <> (select (j #>> '{baseline,counts,players}')::int from _m050)
       or (select count(*) from public.signings where record_scope = 'MLB_PIPELINE_TOP_PROSPECT') <> (select (j #>> '{baseline,counts,benchmark_signings}')::int from _m050)
       or (select count(*) from public.outcome_audits) <> (select (j #>> '{baseline,counts,outcome_audits}')::int from _m050)
       or (select count(*) from public.player_evaluations) <> (select (j #>> '{baseline,counts,player_evaluations}')::int from _m050) then
      raise exception '050: players, benchmark signings, audits or evaluations are not in the state the research was written for';
    end if;
  end if;
  -- no new benchmark player exists under another identity; a rerun finds exactly the researched rows
  for p in select x from _m050, jsonb_array_elements(j -> 'new_players') x loop
    select count(*) into n from public.players pl where pl.mlb_id = (p ->> 'mlb_id')::bigint and pl.slug <> p ->> 'slug';
    if n > 0 then
      raise exception '050: MLB id % already belongs to another player; the research no longer applies', p ->> 'mlb_id';
    end if;
    select count(*) into n from public.players pl where pl.slug = p ->> 'slug' and pl.mlb_id is distinct from (p ->> 'mlb_id')::bigint;
    if n > 0 then
      raise exception '050: the slug % already belongs to a different player', p ->> 'slug';
    end if;
    if p ->> 'bref_id' is not null and exists (select 1 from public.players pl where pl.bref_id = p ->> 'bref_id' and pl.slug <> p ->> 'slug') then
      raise exception '050: Baseball-Reference id % already belongs to another player', p ->> 'bref_id';
    end if;
    if not exists (select 1 from public.organizations where abbreviation = p #>> '{signing,org}' and organization_type = 'MLB_CLUB') then
      raise exception '050: the club % is not a recorded MLB organization', p #>> '{signing,org}';
    end if;
  end loop;
  -- the legacy identities: still unresolved, still the tracker's row (or exactly as 050 writes them)
  for p in select x from _m050, jsonb_array_elements(j -> 'legacy') x loop
    select count(*) into n from public.players pl join public.signings s on s.player_id = pl.id
      where pl.slug = p ->> 'slug' and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT' and (pl.mlb_id is null or pl.mlb_id = (p ->> 'mlb_id')::bigint);
    if n <> 1 then
      raise exception '050: the legacy benchmark row % is not in the state the identity research was written for', p ->> 'slug';
    end if;
    if exists (select 1 from public.players where mlb_id = (p ->> 'mlb_id')::bigint and slug <> p ->> 'slug') then
      raise exception '050: MLB id % already belongs to another player', p ->> 'mlb_id';
    end if;
    if exists (select 1 from public.outcome_audits a join public.players pl on pl.id = a.player_id where pl.slug = p ->> 'slug'
               and a.reached_mlb_verified is distinct from (p #>> '{audit,reached}')::boolean) then
      raise exception '050: the legacy row % already has a different outcome audit', p ->> 'slug';
    end if;
  end loop;
  -- the Dodgers signings a ranked prospect maps to
  for p in select x from _m050, jsonb_array_elements(j -> 'dodgers_evaluations') x loop
    select count(*) into n from public.players pl join public.signings s on s.player_id = pl.id join public.organizations o on o.id = s.organization_id
      where pl.slug = p ->> 'slug' and pl.mlb_id = (p ->> 'mlb_id')::bigint and o.franchise_key = 'DODGERS' and s.record_scope = 'TRACKED_DODGERS';
    if n <> 1 then
      raise exception '050: the ranked Dodgers signing % is not one tracked Dodgers signing with this identity', p ->> 'slug';
    end if;
    if exists (select 1 from public.signings s join public.players pl on pl.id = s.player_id where pl.slug = p ->> 'slug' and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT') then
      raise exception '050: % already has a benchmark copy of a Dodgers signing', p ->> 'slug';
    end if;
  end loop;
  -- the stored evaluation is the 041 one (or, on a rerun, the 050 one)
  if (select j -> 'evaluation' from _m050) is not null and jsonb_typeof((select j -> 'evaluation' from _m050)) = 'array' then
    select count(*) into n from public.outcome_model_evaluations m
      where m.training_fingerprint in ((select j #>> '{baseline,evaluation,0,training_fingerprint}' from _m050),
                                       (select x ->> 'training_fingerprint' from _m050, jsonb_array_elements(j -> 'evaluation') x limit 1));
    if n <> (select count(*) from public.outcome_model_evaluations) or n <> 3 then
      raise exception '050: the stored model evaluation is neither the 041 one nor the 050 one; it will not be replaced';
    end if;
  end if;
  -- the executive function is the 044 one (or, on a rerun, the 050 one)
  select md5(prosrc) into k from pg_proc where proname = 'disi_executive_overview' and pronamespace = 'public'::regnamespace;
  if k is distinct from (select j #>> '{executive,old_md5}' from _m050) and k is distinct from (select j #>> '{executive,new_md5}' from _m050) then
    raise exception '050: disi_executive_overview() is not the 044 definition 050 was written against (%)', k;
  end if;
  select md5(prosrc) into k from pg_proc where proname = 'disi_refresh_product_snapshots' and pronamespace = 'public'::regnamespace;
  if k is distinct from (select j #>> '{refresh,old_md5}' from _m050) and k is distinct from (select j #>> '{refresh,new_md5}' from _m050) then
    raise exception '050: disi_refresh_product_snapshots() is not the 045b definition 050 was written against (%)', k;
  end if;
end $$;

-- ===========================================================================
-- 2. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, publication_date, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (x ->> 'publication_date')::date, (j ->> 'retrieved_at')::timestamptz
from _m050, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 3. POPULATIONS: two Top-prospect samples, never censuses
-- ===========================================================================

insert into public.signing_populations (population_key, franchise_key, population_scope, class_year_start, class_year_end, period_label, expected_size,
  expected_size_source_id, stated_composition, rate_analysis_suitable, notes)
select x ->> 'population_key', null, 'TOP_PROSPECT_SAMPLE', (x ->> 'class_year')::int, (x ->> 'class_year')::int, x ->> 'period_label', (x ->> 'expected_size')::int,
  so.id, x -> 'stated_composition', false, x ->> 'notes'
from _m050, jsonb_array_elements(j -> 'populations') x
join public.sources so on so.url = x ->> 'source_url'
on conflict (population_key) do nothing;

-- the league coverage ledger (013) gets the same two sample rows the 2013 / 2014 trackers have, so the League Benchmark page lists them
insert into public.signing_census_coverage (organization_id, period_start_year, period_end_year, coverage_type, expected_signings, tracked_signings, source_id, notes,
  population_scope, population_note)
select null, (x ->> 'class_year')::int, (x ->> 'class_year')::int, 'TOP_PROSPECT_SAMPLE', (x ->> 'expected_size')::int, (x #>> '{stated_composition,benchmark_signings}')::int, so.id,
  'League-wide MLB Pipeline Top 30 benchmark (Migration 050). Only listed players with a verified non-Dodgers signing are benchmark rows; this is not a census of all international signings.',
  'TOP_PROSPECT_SAMPLE', 'MLB Pipeline Top 30 international list: a rank-selected prospect sample, never a league signing census.'
from _m050, jsonb_array_elements(j -> 'populations') x
join public.sources so on so.url = x ->> 'source_url'
where not exists (select 1 from public.signing_census_coverage c where c.organization_id is null and c.coverage_type = 'TOP_PROSPECT_SAMPLE'
                  and c.period_start_year = (x ->> 'class_year')::int and c.period_end_year = (x ->> 'class_year')::int);

update public.signing_populations sp set legacy_coverage_id = c.id
from _m050, jsonb_array_elements(j -> 'populations') x, public.signing_census_coverage c
where sp.population_key = x ->> 'population_key' and sp.legacy_coverage_id is null
  and c.organization_id is null and c.coverage_type = 'TOP_PROSPECT_SAMPLE' and c.period_start_year = (x ->> 'class_year')::int and c.period_end_year = (x ->> 'class_year')::int;

-- ===========================================================================
-- 4. BENCHMARK PLAYERS AND SIGNINGS (non-Dodgers, identity resolved)
-- ===========================================================================

insert into public.players (full_name, canonical_name, birth_date, birth_country, primary_position, mlb_id, bref_id, mlb_debut_date, slug)
select x ->> 'full_name', x ->> 'canonical_name', (x ->> 'birth_date')::date, x ->> 'birth_country', x ->> 'primary_position', (x ->> 'mlb_id')::bigint,
  x ->> 'bref_id', (x ->> 'mlb_debut_date')::date, x ->> 'slug'
from _m050, jsonb_array_elements(j -> 'new_players') x
where not exists (select 1 from public.players pl where pl.mlb_id = (x ->> 'mlb_id')::bigint);

-- the published spelling is kept as an alias; the source name is never rewritten
insert into public.player_aliases (player_id, alias, alias_type, source_id)
select pl.id, x ->> 'alias', 'PUBLISHED_SPELLING', so.id
from _m050, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = x ->> 'list_url'
where x ->> 'alias' is not null
on conflict (player_id, alias) do nothing;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', pl.id, f.field, so.id, 'VERIFIED', f.note
from _m050, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
cross join lateral (values
  ('mlb_id', x ->> 'transactions_url', 'The official signing transaction and the person record name this MLB id (Migration 050 identity research).'),
  ('birth_date', x ->> 'person_url', 'MLB person record; equal to the Chadwick register birth date where the register holds the person.'),
  ('birth_country', x ->> 'person_url', 'MLB person record.')
) f(field, url, note)
join public.sources so on so.url = f.url
where not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = pl.id and e.field_name = f.field and e.source_id = so.id);

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', pl.id, 'bref_id', so.id, 'HIGH', 'Chadwick register crosswalk of the MLB id (identity only).'
from _m050, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = (select j ->> 'register_url' from _m050)
where x ->> 'bref_id' is not null
  and not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = pl.id and e.field_name = 'bref_id' and e.source_id = so.id);

insert into public.signings (player_id, organization_id, signing_year, signing_date, formal_transaction_date, transaction_source_id, country_market, pathway,
  signing_bonus_usd, bonus_publicly_reported, international_rank, rank_source, record_scope, notes, position_at_signing, position_at_signing_source_id)
select pl.id, o.id, (x #>> '{signing,year}')::int, (x #>> '{signing,date}')::date, (x #>> '{signing,date}')::date, tx.id, x #>> '{signing,country_market}',
  (x #>> '{signing,pathway}')::public.acquisition_pathway, null, false, (x #>> '{signing,rank}')::numeric, 'MLB Pipeline', 'MLB_PIPELINE_TOP_PROSPECT',
  x #>> '{signing,notes}', x #>> '{signing,position_at_signing}', li.id
from _m050, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.organizations o on o.abbreviation = x #>> '{signing,org}' and o.organization_type = 'MLB_CLUB'
join public.sources tx on tx.url = x ->> 'transactions_url'
join public.sources li on li.url = x ->> 'list_url'
on conflict (player_id, organization_id, signing_year) do nothing;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, f.field, so.id, f.confidence::public.confidence_level, f.note
from _m050, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.signings s on s.player_id = pl.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
cross join lateral (values
  (null::text, x ->> 'transactions_url', 'VERIFIED', format('Official MLB transaction: %s, "%s".', x #>> '{signing,date}', x #>> '{signing,description}')),
  ('position_at_signing', x ->> 'list_url', 'VERIFIED', 'Position as published in the MLB Pipeline international list.'),
  ('pathway', x #>> '{signing,route,source_url}', 'MEDIUM', x #>> '{signing,route,note}')
) f(field, url, confidence, note)
join public.sources so on so.url = f.url
where f.url is not null
  and not exists (select 1 from public.evidence e where e.entity_type = 'signing' and e.entity_id = s.id and e.field_name is not distinct from f.field and e.source_id = so.id);

insert into public.signing_population_members (population_id, signing_id, membership_status, note)
select sp.id, s.id, 'MEMBER', format('MLB Pipeline international Top 30, rank %s.', x #>> '{signing,rank}')
from _m050, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.signings s on s.player_id = pl.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
join public.signing_populations sp on sp.population_key = x ->> 'population_key'
on conflict (population_id, signing_id) do nothing;

insert into public.signing_population_member_sources (member_id, source_id, membership_basis, supports_fields, confidence, note)
select m.id, so.id, f.basis, f.fields, 'VERIFIED', f.note
from _m050, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.signings s on s.player_id = pl.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
join public.signing_populations sp on sp.population_key = x ->> 'population_key'
join public.signing_population_members m on m.population_id = sp.id and m.signing_id = s.id
cross join lateral (values
  (x ->> 'list_url', 'PROSPECT_TRACKER', array['CLASS_MEMBERSHIP', 'PUBLISHED_POSITION'], 'Listed in the MLB Pipeline international Top 30.'),
  (x ->> 'transactions_url', 'MLB_PLAYER_TRANSACTION_HISTORY', array['FORMAL_TRANSACTION_DATE'], 'The official signing transaction.')
) f(url, basis, fields, note)
join public.sources so on so.url = f.url
on conflict (member_id, source_id) do nothing;

-- ===========================================================================
-- 5. LEGACY 035 IDENTITIES: set only where unset; the tracker's name and row are not rewritten
-- ===========================================================================

update public.players pl set mlb_id = (x ->> 'mlb_id')::bigint
from _m050, jsonb_array_elements(j -> 'legacy') x
where pl.slug = x ->> 'slug' and pl.mlb_id is null;

update public.players pl set birth_date = (x ->> 'birth_date')::date
from _m050, jsonb_array_elements(j -> 'legacy') x
where pl.slug = x ->> 'slug' and pl.birth_date is null and x ->> 'birth_date' is not null;

update public.players pl set bref_id = x ->> 'bref_id'
from _m050, jsonb_array_elements(j -> 'legacy') x
where pl.slug = x ->> 'slug' and pl.bref_id is null and x ->> 'bref_id' is not null;

update public.players pl set mlb_debut_date = (x ->> 'mlb_debut_date')::date
from _m050, jsonb_array_elements(j -> 'legacy') x
where pl.slug = x ->> 'slug' and pl.mlb_debut_date is null and x ->> 'mlb_debut_date' is not null;

insert into public.player_aliases (player_id, alias, alias_type, source_id)
select pl.id, x ->> 'alias', 'MLB_RECORD_NAME', so.id
from _m050, jsonb_array_elements(j -> 'legacy') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = x ->> 'person_url'
where x ->> 'alias' is distinct from pl.full_name
on conflict (player_id, alias) do nothing;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', pl.id, f.field, so.id, 'VERIFIED', f.note
from _m050, jsonb_array_elements(j -> 'legacy') x
join public.players pl on pl.slug = x ->> 'slug'
cross join lateral (values
  ('mlb_id', x ->> 'transactions_url', x ->> 'identity_note'),
  ('birth_date', x ->> 'person_url', 'MLB person record; equal to the Chadwick register birth date where the register holds the person.')
) f(field, url, note)
join public.sources so on so.url = f.url
where not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = pl.id and e.field_name = f.field and e.source_id = so.id);

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', pl.id, 'bref_id', so.id, 'HIGH', 'Chadwick register crosswalk of the MLB id (identity only).'
from _m050, jsonb_array_elements(j -> 'legacy') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = (select j ->> 'register_url' from _m050)
where x ->> 'bref_id' is not null
  and not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = pl.id and e.field_name = 'bref_id' and e.source_id = so.id);

-- ===========================================================================
-- 6. POINT-IN-TIME RANKINGS (026 evaluations: DRAFT, ranking, then ACTIVE; nothing earlier is touched)
-- ===========================================================================

create temporary table _m050_eval on commit drop as
select pl.id as player_id, x -> 'evaluation' as ev
from _m050, jsonb_array_elements(j -> 'new_players') x join public.players pl on pl.slug = x ->> 'slug'
union all
select pl.id, x -> 'evaluation'
from _m050, jsonb_array_elements(j -> 'dodgers_evaluations') x join public.players pl on pl.slug = x ->> 'slug';

insert into public.player_evaluations (player_id, publication_id, evaluation_context, date_precision, evaluation_date, evaluation_year, evaluation_month,
  evidence_basis, confidence, source_id, archive_url, retrieved_at, summary_note, record_status)
select e.player_id, pub.id, 'INTERNATIONAL_CLASS_LIST', 'DAY', (e.ev ->> 'evaluation_date')::date, extract(year from (e.ev ->> 'evaluation_date')::date)::int,
  extract(month from (e.ev ->> 'evaluation_date')::date)::int, 'PUBLISHED_LIST', 'VERIFIED', so.id, e.ev ->> 'list_url', (select (j ->> 'retrieved_at')::timestamptz from _m050),
  e.ev ->> 'note', 'DRAFT'
from _m050_eval e
join public.scouting_publications pub on pub.publication_slug = (select j ->> 'publication_slug' from _m050)
join public.sources so on so.url = e.ev ->> 'list_url'
where not exists (select 1 from public.player_evaluations x join public.player_evaluation_rankings r on r.evaluation_id = x.id
                  where x.player_id = e.player_id and x.publication_id = pub.id and r.scope_label = e.ev ->> 'scope_label');

insert into public.player_evaluation_rankings (evaluation_id, rank, ranking_scope, scope_label, list_size, eligibility_definition)
select x.id, (e.ev ->> 'rank')::int, 'INTERNATIONAL_CLASS', e.ev ->> 'scope_label', (e.ev ->> 'list_size')::int,
  'International amateur and professional free agents eligible to sign in the class signing period, as ranked by MLB Pipeline'
from _m050_eval e
join public.scouting_publications pub on pub.publication_slug = (select j ->> 'publication_slug' from _m050)
join public.player_evaluations x on x.player_id = e.player_id and x.publication_id = pub.id and x.record_status = 'DRAFT'
  and x.evaluation_date = (e.ev ->> 'evaluation_date')::date and x.archive_url = e.ev ->> 'list_url'
where not exists (select 1 from public.player_evaluation_rankings r where r.evaluation_id = x.id);

update public.player_evaluations x set record_status = 'ACTIVE'
from _m050_eval e, public.scouting_publications pub
where pub.publication_slug = (select j ->> 'publication_slug' from _m050) and x.player_id = e.player_id and x.publication_id = pub.id
  and x.record_status = 'DRAFT' and x.evaluation_date = (e.ev ->> 'evaluation_date')::date and x.archive_url = e.ev ->> 'list_url';

-- ===========================================================================
-- 7. OUTCOME EVIDENCE, AUDITS AND OUTCOMES (the 035 conventions, the unchanged 2026-10-05 boundary)
-- ===========================================================================

create temporary table _m050_aud on commit drop as
select x ->> 'slug' as slug, x ->> 'person_url' as person_url, x -> 'audit' as audit, x -> 'outcome' as outcome
from _m050, jsonb_array_elements(j -> 'new_players') x
union all
select x ->> 'slug', x ->> 'person_url', x -> 'audit', x -> 'outcome'
from _m050, jsonb_array_elements(j -> 'legacy') x;

insert into public.outcome_evidence (player_id, source_id, supports_fields, confidence, note)
select pl.id, so.id, array(select jsonb_array_elements_text(a.audit -> 'supports')), (a.audit ->> 'confidence')::public.confidence_level, a.audit ->> 'evidence_note'
from _m050_aud a join public.players pl on pl.slug = a.slug join public.sources so on so.url = a.person_url
on conflict (player_id, source_id) do nothing;

insert into public.outcome_audits (player_id, audited_through_date, reached_mlb_verified, source_id, confidence, audit_note, outcome_state)
select pl.id, (select (j ->> 'audit_through_date')::date from _m050), (a.audit ->> 'reached')::boolean, so.id, (a.audit ->> 'confidence')::public.confidence_level,
  a.audit ->> 'audit_note', a.audit ->> 'outcome_state'
from _m050_aud a join public.players pl on pl.slug = a.slug join public.sources so on so.url = a.person_url
on conflict (player_id) do nothing;

-- MISSING BWAR != ZERO BWAR: career_war stays NULL (no Baseball-Reference team-season row is loaded)
insert into public.outcomes (player_id, reached_mlb, mlb_debut_date, mlb_games, mlb_pa, mlb_ip, career_war, current_status, outcome_through_season, source_id, confidence)
select pl.id, true, (a.outcome ->> 'debut')::date, nullif(a.outcome ->> 'games', '')::int, nullif(a.outcome ->> 'pa', '')::int, nullif(a.outcome ->> 'ip', '')::numeric, null,
  a.outcome ->> 'current_status', (select (j ->> 'outcome_through_season')::int from _m050), so.id, 'VERIFIED'
from _m050_aud a join public.players pl on pl.slug = a.slug join public.sources so on so.url = a.person_url
where jsonb_typeof(a.outcome) = 'object'
on conflict (player_id) do nothing;

-- ===========================================================================
-- 8. THE EXECUTIVE OVERVIEW: supported probability targets are those of the population predictions are made for
-- ===========================================================================

{{executive_function}}

-- The snapshot refresh (045b) validates each new generation against the same pooled count; one rule now uses the Dodgers population's
-- count, like the overview it checks. Every other statement of the function is the 045b text.
{{refresh_function}}

-- ===========================================================================
-- 9. THE STORED 041 EVALUATION, RE-RUN ON THE 050 DATA (same targets, features, models, validation)
-- ===========================================================================

update public.outcome_model_evaluations m set
  model_version = x ->> 'model_version', validation_method = x ->> 'validation_method',
  feature_list = array(select jsonb_array_elements_text(x -> 'feature_list')), training_populations = array(select jsonb_array_elements_text(x -> 'training_populations')),
  evaluated_rows = (x ->> 'evaluated_rows')::int, positive_n = (x ->> 'positive_n')::int, folds = (x ->> 'folds')::int,
  brier_score = (x ->> 'brier_score')::numeric, log_loss = (x ->> 'log_loss')::numeric, auc = (x ->> 'auc')::numeric,
  brier_skill_vs_base_rate = (x ->> 'brier_skill_vs_base_rate')::numeric, calibration_bins = x -> 'calibration_bins', decision = x ->> 'decision',
  decision_reason = x ->> 'decision_reason', training_fingerprint = x ->> 'training_fingerprint', data_as_of_date = (x ->> 'data_as_of_date')::date
from _m050, jsonb_array_elements(case when jsonb_typeof(j -> 'evaluation') = 'array' then j -> 'evaluation' else '[]'::jsonb end) x
where m.target_key = x ->> 'target_key' and m.model_key = x ->> 'model_key'
  and m.training_fingerprint is distinct from x ->> 'training_fingerprint';

-- ===========================================================================
-- 10. POSTCONDITIONS: what was added is exactly what was reviewed, and nothing else moved
-- ===========================================================================

do $$
declare
  b record;
  n int;
  k text;
begin
  select * into b from _m050_before;
  -- every reviewed benchmark signing is present once, a member of its population, with its ranking, its audit and (if reached) its outcome
  select count(*) into n from _m050, jsonb_array_elements(j -> 'new_players') x
    where (select count(*) from public.players pl join public.signings s on s.player_id = pl.id
           join public.signing_population_members m on m.signing_id = s.id join public.signing_populations sp on sp.id = m.population_id and sp.population_key = x ->> 'population_key'
           join public.organizations o on o.id = s.organization_id and o.abbreviation = x #>> '{signing,org}'
           join public.outcome_audits a on a.player_id = pl.id and a.reached_mlb_verified = (x #>> '{audit,reached}')::boolean
           where pl.slug = x ->> 'slug' and pl.mlb_id = (x ->> 'mlb_id')::bigint and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
             and s.signing_year = (x #>> '{signing,year}')::int and s.signing_date = (x #>> '{signing,date}')::date) <> 1;
  if n > 0 then
    raise exception '050 postcondition: % benchmark signings are not recorded exactly as reviewed', n;
  end if;
  -- no player has both a Dodgers signing and a benchmark signing (RANKING APPEARANCE != NEW SIGNING)
  select count(*) into n from public.players pl
    where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = pl.id and o.franchise_key = 'DODGERS')
      and exists (select 1 from public.signings s where s.player_id = pl.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT');
  if n > 0 then
    raise exception '050 postcondition: % players are both a Dodgers signing and a benchmark signing', n;
  end if;
  -- every reviewed ranking is ACTIVE, once
  select count(*) into n from _m050_eval e
    where (select count(*) from public.player_evaluations x join public.player_evaluation_rankings r on r.evaluation_id = x.id
           where x.player_id = e.player_id and x.record_status = 'ACTIVE' and r.scope_label = e.ev ->> 'scope_label' and r.rank = (e.ev ->> 'rank')::int) <> 1;
  if n > 0 then
    raise exception '050 postcondition: % rankings are not recorded exactly once', n;
  end if;
  -- the Dodgers-facing state did not move: signings, audits, costs, transactions, development, WAR
  if b.dodgers_signings_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x)
     or b.dodgers_audits_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select a::text as t from public.outcome_audits a join public.signings s on s.player_id = a.player_id
          join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) then
    raise exception '050 postcondition: a Dodgers signing or outcome audit changed';
  end if;
  if b.financial_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select r::text as t from public.signing_financial_reports r) x) then
    raise exception '050 postcondition: an acquisition-cost row changed';
  end if;
  if b.transactions_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select e::text as t from public.transaction_events e union all select a::text from public.transaction_event_assets a) x) then
    raise exception '050 postcondition: a transaction row changed';
  end if;
  if b.development_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.player_season_stints s union all select m::text from public.development_milestones m) x) then
    raise exception '050 postcondition: a development row changed';
  end if;
  if b.war_hash is distinct from (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) then
    raise exception '050 postcondition: a WAR row was added, removed or changed; 050 loads no Baseball-Reference WAR';
  end if;
  if b.old_benchmark_signings_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select x::text as t from public.signings x where x.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
       and x.player_id not in (select pl.id from public.players pl, _m050, jsonb_array_elements(j -> 'new_players') p where pl.slug = p ->> 'slug')) y) then
    raise exception '050 postcondition: a 013 benchmark signing row changed';
  end if;
  -- no label was written by hand, no WAR is invented: every reacher without team-season rows has NULL career bWAR
  select count(*) into n from public.outcomes oc join public.players pl on pl.id = oc.player_id
    where pl.slug in (select a.slug from _m050_aud a) and oc.career_war is not null;
  if n > 0 then
    raise exception '050 postcondition: % new outcomes carry a career bWAR; 050 loads none', n;
  end if;
  -- BENCHMARK SUPPORT != DODGERS SUPPORT: no probability for a non-Dodgers population; the executive count is the Dodgers population's
  select count(*) into n from public.v_player_outcome_probability where probability is not null and training_population is distinct from 'DODGERS_TRACKED_AND_OPENING_CLASS';
  if n > 0 then
    raise exception '050 postcondition: % probabilities exist for a population predictions are not made for', n;
  end if;
  if (select supported_probability_targets from public.v_executive_overview) <> (select count(distinct target_key) from public.v_outcome_target_support
       where baseline_supported and reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS') then
    raise exception '050 postcondition: the executive overview does not count the Dodgers population''s support';
  end if;
  select md5(prosrc) into k from pg_proc where proname = 'disi_executive_overview' and pronamespace = 'public'::regnamespace;
  if k is distinct from (select j #>> '{executive,new_md5}' from _m050) then
    raise exception '050 postcondition: disi_executive_overview() is not the reviewed 050 definition';
  end if;
  select md5(prosrc) into k from pg_proc where proname = 'disi_refresh_product_snapshots' and pronamespace = 'public'::regnamespace;
  if k is distinct from (select j #>> '{refresh,new_md5}' from _m050) then
    raise exception '050 postcondition: disi_refresh_product_snapshots() is not the reviewed 050 definition';
  end if;
  -- the stored evaluation describes the live training set (when the evaluation was supplied)
  if jsonb_typeof((select j -> 'evaluation' from _m050)) = 'array' then
    if exists (select 1 from public.v_outcome_model_evaluation where not evaluation_current) then
      raise exception '050 postcondition: the stored model evaluation is not current after the 050 data';
    end if;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' having count(*) <> 78)
     or exists (select 1 from information_schema.views where table_schema = 'public' having count(*) <> 155) then
    raise exception '050 postcondition: the catalog moved; 050 adds no table or view';
  end if;
end $$;

-- ===========================================================================
-- 11. GENERATION: one coherent refresh, only when this run changed a row
-- ===========================================================================

do $$
declare
  b record;
begin
  select * into b from _m050_before;
  if b.content_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (
       select p::text as t from public.players p union all select s::text from public.signings s union all select a::text from public.outcome_audits a
       union all select o::text from public.outcomes o union all select e::text from public.player_evaluations e union all select m::text from public.outcome_model_evaluations m
       union all select sp::text from public.signing_populations sp union all select pm::text from public.signing_population_members pm
       union all select pg_get_functiondef('public.disi_executive_overview()'::regprocedure)) z) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

commit;
