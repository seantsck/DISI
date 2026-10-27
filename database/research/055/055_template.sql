-- DISI v0.40
-- 055_international_benchmark_2017_2018.sql
-- The international benchmark deepened with the mature 2017 and 2018 classes. Run after 054a.
--
-- Built from database/research/055/ (source-cohorts.json, identity-research.json, outcome-research.json, evaluation.json, build.mjs).
-- Do not edit by hand: change the research and rebuild.
--
-- What this is. A reviewed research batch, the 050 method unchanged. It adds no table, view, function, grant or policy and changes no definition.
--   * The MLB Pipeline international Top 30 lists of the 2017 and 2018 classes, read from the archived official data feed as published before
--     each signing period opened, as two new TOP_PROSPECT_SAMPLE populations. A listed player becomes a benchmark signing only when the official
--     MLB transaction log shows his signing and his identity is resolved by more than his name (the 050 rule: the club the final list revision
--     names, the signing date inside the class window, the person record's birth date, the register's birth date, the position family).
--     RANKING APPEARANCE != NEW SIGNING; RANKING CLASS YEAR != SIGNING YEAR; SOURCE LIST MEMBERSHIP != VERIFIED SIGNING.
--   * The two listed players the Dodgers signed (Diego Cartaya, 2018 #1; Jerming Rosario, 2018 #30) keep their one Dodgers signing, byte for byte:
--     Cartaya's stored MLB Pipeline rank stays 1 and Rosario's stays NULL. No benchmark copy, player or evaluation is created for either.
--     BENCHMARK SUPPORT != DODGERS SUPPORT.
--   * Members that are not added are recorded in each population's stated composition and queued: unresolved identities (for a person to
--     review), Cuban signees whose route no readable source states, and Daniel Flores (2017 #2), who died in 2017 before his outcome window
--     could run. NO MLB DEBUT != NEGATIVE OUTCOME: his missing debut is never a FALSE label.
--   * MLB outcome audits at the unchanged 2026-10-05 boundary. MISSING BWAR != ZERO BWAR: no team-season bWAR is loaded, so a reacher's bWAR
--     labels stay NULL (041 decides every label; nothing here writes one). A 2017 or 2018 signing's 10-season horizon is still open.
--   * The stored 041 model evaluation, re-run on the 055 data with the same targets, features, models and out-of-time validation, so it is
--     current again (the previous rows are proven to be the 050 ones before they are replaced). No threshold moves.
-- It then runs the explicit snapshot refresh once, only when this run changed a row.
--
-- Rerunnable: every statement is idempotent; the refresh runs only when a row was added or changed.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m055 on commit drop as
select $m055${{payload_json}}$m055$::jsonb as j;

create temporary table _m055_new on commit drop as
select x ->> 'slug' as slug, (x ->> 'mlb_id')::bigint as mlb_id from _m055, jsonb_array_elements(j -> 'new_players') x;

create temporary table _m055_before on commit drop as
select
  (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) as dodgers_signings_hash,
  (select md5(string_agg(t, '|' order by t)) from (select a::text as t from public.outcome_audits a join public.signings s on s.player_id = a.player_id
     join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) as dodgers_audits_hash,
  (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) as war_hash,
  (select md5(string_agg(t, '|' order by t)) from (select r::text as t from public.signing_financial_reports r union all select r::text from public.signing_financial_resolutions r) x) as financial_hash,
  (select md5(string_agg(t, '|' order by t)) from (select e::text as t from public.transaction_events e union all select a::text from public.transaction_event_assets a
     union all select r::text from public.transaction_asset_resolutions r union all select c::text from public.player_career_transactions c) x) as transactions_hash,
  (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.player_season_stints s union all select m::text from public.development_milestones m
     union all select d::text from public.development_progression_decisions d) x) as development_hash,
  -- every row that exists before 055 (the 2013-2016 benchmark included) is byte-identical after it
  (select md5(string_agg(t, '|' order by t)) from (
     select p::text as t from public.players p where p.slug not in (select slug from _m055_new)
     union all select s::text from public.signings s where s.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
     union all select a::text from public.outcome_audits a where a.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
     union all select o::text from public.outcomes o where o.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
     union all select e::text from public.player_evaluations e where e.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
     union all select r::text from public.player_evaluation_rankings r join public.player_evaluations e on e.id = r.evaluation_id
       where e.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
     union all select sp::text from public.signing_populations sp where sp.population_key not in (select x ->> 'population_key' from _m055, jsonb_array_elements(j -> 'populations') x)
     union all select pm::text from public.signing_population_members pm join public.signing_populations sp on sp.id = pm.population_id
       where sp.population_key not in (select x ->> 'population_key' from _m055, jsonb_array_elements(j -> 'populations') x)
     union all select c::text from public.signing_census_coverage c where not (c.organization_id is null and c.coverage_type = 'TOP_PROSPECT_SAMPLE' and c.period_start_year in (2017, 2018))) z) as existing_rows_hash,
  (select md5(string_agg(t, '|' order by t)) from (
     select p::text as t from public.players p union all select s::text from public.signings s union all select a::text from public.outcome_audits a
     union all select o::text from public.outcomes o union all select e::text from public.player_evaluations e union all select m::text from public.outcome_model_evaluations m
     union all select sp::text from public.signing_populations sp union all select pm::text from public.signing_population_members pm) z) as content_hash
from _m055;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 055 was written for
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
  rerun boolean;
begin
  if to_regclass('public.player_career_transactions') is null
     or position('NOT MATERIALIZED' in pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) = 0 then
    raise exception '055: Migrations 054 and 054a have not been applied';
  end if;
  if (select count(*) from public.signing_populations where population_key in ('MLB-2015-PIPELINE-TOP30', 'MLB-2016-PIPELINE-TOP30')) <> 2 then
    raise exception '055: the 050 benchmark populations are missing';
  end if;
  if not exists (select 1 from public.scouting_publications where publication_slug = (select j ->> 'publication_slug' from _m055)) then
    raise exception '055: the MLB Pipeline international publication is missing';
  end if;
  rerun := exists (select 1 from public.signing_populations where population_key in (select x ->> 'population_key' from _m055, jsonb_array_elements(j -> 'populations') x));
  -- the Dodgers-facing state 055 must not move (re-proved, unchanged, after the writes)
  if (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') <> (select (j #>> '{baseline,counts,dodgers_signings}')::int from _m055)
     or (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id join public.outcome_audits a on a.player_id = s.player_id where o.franchise_key = 'DODGERS')
        <> (select (j #>> '{baseline,counts,dodgers_audits}')::int from _m055) then
    raise exception '055: the Dodgers signings or audits are not in the state the research was written for';
  end if;
  if not rerun then
    if (select count(*) from public.players) <> (select (j #>> '{baseline,counts,players}')::int from _m055)
       or (select count(*) from public.signings where record_scope = 'MLB_PIPELINE_TOP_PROSPECT') <> (select (j #>> '{baseline,counts,benchmark_signings}')::int from _m055)
       or (select count(*) from public.outcome_audits) <> (select (j #>> '{baseline,counts,outcome_audits}')::int from _m055)
       or (select count(*) from public.player_evaluations) <> (select (j #>> '{baseline,counts,player_evaluations}')::int from _m055)
       or (select count(*) from public.signing_populations) <> (select (j #>> '{baseline,counts,signing_populations}')::int from _m055) then
      raise exception '055: players, benchmark signings, audits, evaluations or populations are not in the state the research was written for';
    end if;
  end if;
  -- no new benchmark player exists under another identity; a rerun finds exactly the researched rows
  for p in select x from _m055, jsonb_array_elements(j -> 'new_players') x loop
    select count(*) into n from public.players pl where pl.mlb_id = (p ->> 'mlb_id')::bigint and pl.slug <> p ->> 'slug';
    if n > 0 then
      raise exception '055: MLB id % already belongs to another player; the research no longer applies', p ->> 'mlb_id';
    end if;
    select count(*) into n from public.players pl where pl.slug = p ->> 'slug' and pl.mlb_id is distinct from (p ->> 'mlb_id')::bigint;
    if n > 0 then
      raise exception '055: the slug % already belongs to a different player', p ->> 'slug';
    end if;
    if p ->> 'bref_id' is not null and exists (select 1 from public.players pl where pl.bref_id = p ->> 'bref_id' and pl.slug <> p ->> 'slug') then
      raise exception '055: Baseball-Reference id % already belongs to another player', p ->> 'bref_id';
    end if;
    if not exists (select 1 from public.organizations where abbreviation = p #>> '{signing,org}' and organization_type = 'MLB_CLUB') then
      raise exception '055: the club % is not a recorded MLB organization', p #>> '{signing,org}';
    end if;
  end loop;
  -- the listed Dodgers signings: one tracked Dodgers signing each, with the rank it already stores, and no benchmark copy
  for p in select x from _m055, jsonb_array_elements(j -> 'dodgers_mapped') x loop
    select count(*) into n from public.players pl join public.signings s on s.player_id = pl.id join public.organizations o on o.id = s.organization_id
      where pl.slug = p ->> 'slug' and pl.mlb_id = (p ->> 'mlb_id')::bigint and o.franchise_key = 'DODGERS' and s.record_scope = 'TRACKED_DODGERS'
        and s.international_rank is not distinct from (p ->> 'stored_international_rank')::numeric;
    if n <> 1 then
      raise exception '055: the listed Dodgers signing % is not one tracked Dodgers signing with this identity and its stored rank', p ->> 'slug';
    end if;
    if (select count(*) from public.signings s join public.players pl on pl.id = s.player_id where pl.slug = p ->> 'slug') <> 1 then
      raise exception '055: % has more than one signing; a ranked Dodgers signing is never duplicated', p ->> 'slug';
    end if;
  end loop;
  -- the stored evaluation is the 050 one (or, on a rerun, the 055 one)
  if jsonb_typeof((select j -> 'evaluation' from _m055)) = 'array' then
    select count(*) into n from public.outcome_model_evaluations m
      where m.training_fingerprint in ((select j #>> '{baseline,evaluation,0,training_fingerprint}' from _m055),
                                       (select x ->> 'training_fingerprint' from _m055, jsonb_array_elements(j -> 'evaluation') x limit 1));
    if n <> (select count(*) from public.outcome_model_evaluations) or n <> 3 then
      raise exception '055: the stored model evaluation is neither the 050 one nor the 055 one; it will not be replaced';
    end if;
  end if;
end $$;

-- ===========================================================================
-- 2. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, publication_date, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (x ->> 'publication_date')::date, (j ->> 'retrieved_at')::timestamptz
from _m055, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 3. POPULATIONS: two Top-prospect samples, never censuses
-- ===========================================================================

insert into public.signing_populations (population_key, franchise_key, population_scope, class_year_start, class_year_end, period_label, expected_size,
  expected_size_source_id, stated_composition, rate_analysis_suitable, notes)
select x ->> 'population_key', null, 'TOP_PROSPECT_SAMPLE', (x ->> 'class_year')::int, (x ->> 'class_year')::int, x ->> 'period_label', (x ->> 'expected_size')::int,
  so.id, x -> 'stated_composition', false, x ->> 'notes'
from _m055, jsonb_array_elements(j -> 'populations') x
join public.sources so on so.url = x ->> 'source_url'
on conflict (population_key) do nothing;

-- the league coverage ledger (013) gets the same sample rows the 2013-2016 lists have, so the League Benchmark page lists them
insert into public.signing_census_coverage (organization_id, period_start_year, period_end_year, coverage_type, expected_signings, tracked_signings, source_id, notes,
  population_scope, population_note)
select null, (x ->> 'class_year')::int, (x ->> 'class_year')::int, 'TOP_PROSPECT_SAMPLE', (x ->> 'expected_size')::int, (x #>> '{stated_composition,benchmark_signings}')::int, so.id,
  'League-wide MLB Pipeline Top 30 benchmark (Migration 055). Only listed players with a verified non-Dodgers signing are benchmark rows; this is not a census of all international signings.',
  'TOP_PROSPECT_SAMPLE', 'MLB Pipeline Top 30 international list: a rank-selected prospect sample, never a league signing census.'
from _m055, jsonb_array_elements(j -> 'populations') x
join public.sources so on so.url = x ->> 'source_url'
where not exists (select 1 from public.signing_census_coverage c where c.organization_id is null and c.coverage_type = 'TOP_PROSPECT_SAMPLE'
                  and c.period_start_year = (x ->> 'class_year')::int and c.period_end_year = (x ->> 'class_year')::int);

update public.signing_populations sp set legacy_coverage_id = c.id
from _m055, jsonb_array_elements(j -> 'populations') x, public.signing_census_coverage c
where sp.population_key = x ->> 'population_key' and sp.legacy_coverage_id is null
  and c.organization_id is null and c.coverage_type = 'TOP_PROSPECT_SAMPLE' and c.period_start_year = (x ->> 'class_year')::int and c.period_end_year = (x ->> 'class_year')::int;

-- ===========================================================================
-- 4. BENCHMARK PLAYERS AND SIGNINGS (non-Dodgers, identity resolved)
-- ===========================================================================

insert into public.players (full_name, canonical_name, birth_date, birth_country, primary_position, mlb_id, bref_id, mlb_debut_date, slug)
select x ->> 'full_name', x ->> 'canonical_name', (x ->> 'birth_date')::date, x ->> 'birth_country', x ->> 'primary_position', (x ->> 'mlb_id')::bigint,
  x ->> 'bref_id', (x ->> 'mlb_debut_date')::date, x ->> 'slug'
from _m055, jsonb_array_elements(j -> 'new_players') x
where not exists (select 1 from public.players pl where pl.mlb_id = (x ->> 'mlb_id')::bigint);

-- the published spelling is kept as an alias; the source name is never rewritten
insert into public.player_aliases (player_id, alias, alias_type, source_id)
select pl.id, x ->> 'alias', 'PUBLISHED_SPELLING', so.id
from _m055, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = x ->> 'list_url'
where x ->> 'alias' is not null
on conflict (player_id, alias) do nothing;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', pl.id, f.field, so.id, 'VERIFIED', f.note
from _m055, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
cross join lateral (values
  ('mlb_id', x ->> 'transactions_url', 'The official signing transaction and the person record name this MLB id (Migration 055 identity research).'),
  ('birth_date', x ->> 'person_url', 'MLB person record; equal to the Chadwick register birth date where the register holds the person.'),
  ('birth_country', x ->> 'person_url', 'MLB person record.')
) f(field, url, note)
join public.sources so on so.url = f.url
where not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = pl.id and e.field_name = f.field and e.source_id = so.id);

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'player', pl.id, 'bref_id', so.id, 'HIGH', 'Chadwick register crosswalk of the MLB id (identity only).'
from _m055, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = (select j ->> 'register_url' from _m055)
where x ->> 'bref_id' is not null
  and not exists (select 1 from public.evidence e where e.entity_type = 'player' and e.entity_id = pl.id and e.field_name = 'bref_id' and e.source_id = so.id);

insert into public.signings (player_id, organization_id, signing_year, signing_date, formal_transaction_date, transaction_source_id, country_market, pathway,
  signing_bonus_usd, bonus_publicly_reported, international_rank, rank_source, record_scope, notes, position_at_signing, position_at_signing_source_id)
select pl.id, o.id, (x #>> '{signing,year}')::int, (x #>> '{signing,date}')::date, (x #>> '{signing,date}')::date, tx.id, x #>> '{signing,country_market}',
  (x #>> '{signing,pathway}')::public.acquisition_pathway, null, false, (x #>> '{signing,rank}')::numeric, 'MLB Pipeline', 'MLB_PIPELINE_TOP_PROSPECT',
  x #>> '{signing,notes}', x #>> '{signing,position_at_signing}', li.id
from _m055, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.organizations o on o.abbreviation = x #>> '{signing,org}' and o.organization_type = 'MLB_CLUB'
join public.sources tx on tx.url = x ->> 'transactions_url'
join public.sources li on li.url = x ->> 'list_url'
on conflict (player_id, organization_id, signing_year) do nothing;

insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
select 'signing', s.id, f.field, so.id, f.confidence::public.confidence_level, f.note
from _m055, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.signings s on s.player_id = pl.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
cross join lateral (values
  (null::text, x ->> 'transactions_url', 'VERIFIED', format('Official MLB transaction: %s, "%s".', x #>> '{signing,date}', x #>> '{signing,description}')),
  ('position_at_signing', x ->> 'list_url', 'VERIFIED', 'Position as published in the MLB Pipeline international list.')
) f(field, url, confidence, note)
join public.sources so on so.url = f.url
where f.url is not null
  and not exists (select 1 from public.evidence e where e.entity_type = 'signing' and e.entity_id = s.id and e.field_name is not distinct from f.field and e.source_id = so.id);

insert into public.signing_population_members (population_id, signing_id, membership_status, note)
select sp.id, s.id, 'MEMBER', format('MLB Pipeline international Top 30, rank %s.', x #>> '{signing,rank}')
from _m055, jsonb_array_elements(j -> 'new_players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.signings s on s.player_id = pl.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
join public.signing_populations sp on sp.population_key = x ->> 'population_key'
on conflict (population_id, signing_id) do nothing;

insert into public.signing_population_member_sources (member_id, source_id, membership_basis, supports_fields, confidence, note)
select m.id, so.id, f.basis, f.fields, 'VERIFIED', f.note
from _m055, jsonb_array_elements(j -> 'new_players') x
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
-- 5. POINT-IN-TIME RANKINGS (026 evaluations: DRAFT, ranking, then ACTIVE; nothing earlier is touched, no Dodgers player is ranked here)
-- ===========================================================================

create temporary table _m055_eval on commit drop as
select pl.id as player_id, x -> 'evaluation' as ev
from _m055, jsonb_array_elements(j -> 'new_players') x join public.players pl on pl.slug = x ->> 'slug';

insert into public.player_evaluations (player_id, publication_id, evaluation_context, date_precision, evaluation_date, evaluation_year, evaluation_month,
  evidence_basis, confidence, source_id, archive_url, retrieved_at, summary_note, record_status)
select e.player_id, pub.id, 'INTERNATIONAL_CLASS_LIST', 'DAY', (e.ev ->> 'evaluation_date')::date, extract(year from (e.ev ->> 'evaluation_date')::date)::int,
  extract(month from (e.ev ->> 'evaluation_date')::date)::int, 'PUBLISHED_LIST', 'VERIFIED', so.id, e.ev ->> 'list_url', (select (j ->> 'retrieved_at')::timestamptz from _m055),
  e.ev ->> 'note', 'DRAFT'
from _m055_eval e
join public.scouting_publications pub on pub.publication_slug = (select j ->> 'publication_slug' from _m055)
join public.sources so on so.url = e.ev ->> 'list_url'
where not exists (select 1 from public.player_evaluations x join public.player_evaluation_rankings r on r.evaluation_id = x.id
                  where x.player_id = e.player_id and x.publication_id = pub.id and r.scope_label = e.ev ->> 'scope_label');

insert into public.player_evaluation_rankings (evaluation_id, rank, ranking_scope, scope_label, list_size, eligibility_definition)
select x.id, (e.ev ->> 'rank')::int, 'INTERNATIONAL_CLASS', e.ev ->> 'scope_label', (e.ev ->> 'list_size')::int,
  'International amateur and professional free agents eligible to sign in the class signing period, as ranked by MLB Pipeline'
from _m055_eval e
join public.scouting_publications pub on pub.publication_slug = (select j ->> 'publication_slug' from _m055)
join public.player_evaluations x on x.player_id = e.player_id and x.publication_id = pub.id and x.record_status = 'DRAFT'
  and x.evaluation_date = (e.ev ->> 'evaluation_date')::date and x.archive_url = e.ev ->> 'list_url'
where not exists (select 1 from public.player_evaluation_rankings r where r.evaluation_id = x.id);

update public.player_evaluations x set record_status = 'ACTIVE'
from _m055_eval e, public.scouting_publications pub
where pub.publication_slug = (select j ->> 'publication_slug' from _m055) and x.player_id = e.player_id and x.publication_id = pub.id
  and x.record_status = 'DRAFT' and x.evaluation_date = (e.ev ->> 'evaluation_date')::date and x.archive_url = e.ev ->> 'list_url';

-- ===========================================================================
-- 6. OUTCOME EVIDENCE, AUDITS AND OUTCOMES (the 035 / 050 conventions, the unchanged 2026-10-05 boundary)
-- ===========================================================================

create temporary table _m055_aud on commit drop as
select x ->> 'slug' as slug, x ->> 'person_url' as person_url, x -> 'audit' as audit, x -> 'outcome' as outcome
from _m055, jsonb_array_elements(j -> 'new_players') x;

insert into public.outcome_evidence (player_id, source_id, supports_fields, confidence, note)
select pl.id, so.id, array(select jsonb_array_elements_text(a.audit -> 'supports')), (a.audit ->> 'confidence')::public.confidence_level, a.audit ->> 'evidence_note'
from _m055_aud a join public.players pl on pl.slug = a.slug join public.sources so on so.url = a.person_url
on conflict (player_id, source_id) do nothing;

insert into public.outcome_audits (player_id, audited_through_date, reached_mlb_verified, source_id, confidence, audit_note, outcome_state)
select pl.id, (select (j ->> 'audit_through_date')::date from _m055), (a.audit ->> 'reached')::boolean, so.id, (a.audit ->> 'confidence')::public.confidence_level,
  a.audit ->> 'audit_note', a.audit ->> 'outcome_state'
from _m055_aud a join public.players pl on pl.slug = a.slug join public.sources so on so.url = a.person_url
on conflict (player_id) do nothing;

-- MISSING BWAR != ZERO BWAR: career_war stays NULL (no Baseball-Reference team-season row is loaded)
insert into public.outcomes (player_id, reached_mlb, mlb_debut_date, mlb_games, mlb_pa, mlb_ip, career_war, current_status, outcome_through_season, source_id, confidence)
select pl.id, true, (a.outcome ->> 'debut')::date, nullif(a.outcome ->> 'games', '')::int, nullif(a.outcome ->> 'pa', '')::int, nullif(a.outcome ->> 'ip', '')::numeric, null,
  a.outcome ->> 'current_status', (select (j ->> 'outcome_through_season')::int from _m055), so.id, 'VERIFIED'
from _m055_aud a join public.players pl on pl.slug = a.slug join public.sources so on so.url = a.person_url
where jsonb_typeof(a.outcome) = 'object'
on conflict (player_id) do nothing;

-- ===========================================================================
-- 7. THE STORED 041 EVALUATION, RE-RUN ON THE 055 DATA (same targets, features, models, validation)
-- ===========================================================================

update public.outcome_model_evaluations m set
  model_version = x ->> 'model_version', validation_method = x ->> 'validation_method',
  feature_list = array(select jsonb_array_elements_text(x -> 'feature_list')), training_populations = array(select jsonb_array_elements_text(x -> 'training_populations')),
  evaluated_rows = (x ->> 'evaluated_rows')::int, positive_n = (x ->> 'positive_n')::int, folds = (x ->> 'folds')::int,
  brier_score = (x ->> 'brier_score')::numeric, log_loss = (x ->> 'log_loss')::numeric, auc = (x ->> 'auc')::numeric,
  brier_skill_vs_base_rate = (x ->> 'brier_skill_vs_base_rate')::numeric, calibration_bins = x -> 'calibration_bins', decision = x ->> 'decision',
  decision_reason = x ->> 'decision_reason', training_fingerprint = x ->> 'training_fingerprint', data_as_of_date = (x ->> 'data_as_of_date')::date
from _m055, jsonb_array_elements(case when jsonb_typeof(j -> 'evaluation') = 'array' then j -> 'evaluation' else '[]'::jsonb end) x
where m.target_key = x ->> 'target_key' and m.model_key = x ->> 'model_key'
  and m.training_fingerprint is distinct from x ->> 'training_fingerprint';

-- ===========================================================================
-- 8. POSTCONDITIONS: what was added is exactly what was reviewed, and nothing else moved
-- ===========================================================================

do $$
declare
  b record;
  n int;
begin
  select * into b from _m055_before;
  -- every reviewed benchmark signing is present once, a member of its population, with its ranking, its audit and (if reached) its outcome
  select count(*) into n from _m055, jsonb_array_elements(j -> 'new_players') x
    where (select count(*) from public.players pl join public.signings s on s.player_id = pl.id
           join public.signing_population_members m on m.signing_id = s.id join public.signing_populations sp on sp.id = m.population_id and sp.population_key = x ->> 'population_key'
           join public.organizations o on o.id = s.organization_id and o.abbreviation = x #>> '{signing,org}'
           join public.outcome_audits a on a.player_id = pl.id and a.reached_mlb_verified = (x #>> '{audit,reached}')::boolean
           where pl.slug = x ->> 'slug' and pl.mlb_id = (x ->> 'mlb_id')::bigint and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
             and s.signing_year = (x #>> '{signing,year}')::int and s.signing_date = (x #>> '{signing,date}')::date
             and s.international_rank = (x #>> '{signing,rank}')::numeric) <> 1;
  if n > 0 then
    raise exception '055 postcondition: % benchmark signings are not recorded exactly as reviewed', n;
  end if;
  -- each new population holds exactly its added members, and the reviewed composition
  select count(*) into n from _m055, jsonb_array_elements(j -> 'populations') x
    where (select count(*) from public.signing_population_members m join public.signing_populations sp on sp.id = m.population_id where sp.population_key = x ->> 'population_key')
          <> (x #>> '{stated_composition,benchmark_signings}')::int
       or (select sp.stated_composition from public.signing_populations sp where sp.population_key = x ->> 'population_key') is distinct from x -> 'stated_composition';
  if n > 0 then
    raise exception '055 postcondition: % populations do not hold exactly their reviewed members', n;
  end if;
  -- no player has both a Dodgers signing and a benchmark signing (RANKING APPEARANCE != NEW SIGNING)
  select count(*) into n from public.players pl
    where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = pl.id and o.franchise_key = 'DODGERS')
      and exists (select 1 from public.signings s where s.player_id = pl.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT');
  if n > 0 then
    raise exception '055 postcondition: % players are both a Dodgers signing and a benchmark signing', n;
  end if;
  -- the listed Dodgers signings still carry exactly the rank they stored (Cartaya 1, Rosario NULL), and no 055 evaluation names them
  select count(*) into n from _m055, jsonb_array_elements(j -> 'dodgers_mapped') x
    where (select count(*) from public.signings s join public.players pl on pl.id = s.player_id
           where pl.slug = x ->> 'slug' and s.international_rank is not distinct from (x ->> 'stored_international_rank')::numeric) <> 1
       or exists (select 1 from public.player_evaluations e join public.players pl on pl.id = e.player_id join public.player_evaluation_rankings r on r.evaluation_id = e.id
                  where pl.slug = x ->> 'slug' and r.scope_label in ('2017 MLB Pipeline Top 30 international prospects', '2018 MLB Pipeline Top 30 international prospects'));
  if n > 0 then
    raise exception '055 postcondition: a listed Dodgers signing changed or gained a 055 ranking';
  end if;
  -- every reviewed ranking is ACTIVE, once
  select count(*) into n from _m055_eval e
    where (select count(*) from public.player_evaluations x join public.player_evaluation_rankings r on r.evaluation_id = x.id
           where x.player_id = e.player_id and x.record_status = 'ACTIVE' and r.scope_label = e.ev ->> 'scope_label' and r.rank = (e.ev ->> 'rank')::int) <> 1;
  if n > 0 then
    raise exception '055 postcondition: % rankings are not recorded exactly once', n;
  end if;
  -- nothing that existed before moved: the 2013-2016 benchmark, the Dodgers, costs, transactions, career history, development, WAR
  if b.existing_rows_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (
       select p::text as t from public.players p where p.slug not in (select slug from _m055_new)
       union all select s::text from public.signings s where s.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
       union all select a::text from public.outcome_audits a where a.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
       union all select o::text from public.outcomes o where o.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
       union all select e::text from public.player_evaluations e where e.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
       union all select r::text from public.player_evaluation_rankings r join public.player_evaluations e on e.id = r.evaluation_id
         where e.player_id not in (select pl.id from public.players pl join _m055_new n on n.slug = pl.slug)
       union all select sp::text from public.signing_populations sp where sp.population_key not in (select x ->> 'population_key' from _m055, jsonb_array_elements(j -> 'populations') x)
       union all select pm::text from public.signing_population_members pm join public.signing_populations sp on sp.id = pm.population_id
         where sp.population_key not in (select x ->> 'population_key' from _m055, jsonb_array_elements(j -> 'populations') x)
       union all select c::text from public.signing_census_coverage c where not (c.organization_id is null and c.coverage_type = 'TOP_PROSPECT_SAMPLE' and c.period_start_year in (2017, 2018))) z) then
    raise exception '055 postcondition: a row that existed before 055 changed';
  end if;
  if b.dodgers_signings_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x)
     or b.dodgers_audits_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select a::text as t from public.outcome_audits a join public.signings s on s.player_id = a.player_id
          join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') x) then
    raise exception '055 postcondition: a Dodgers signing or outcome audit changed';
  end if;
  if b.financial_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select r::text as t from public.signing_financial_reports r union all select r::text from public.signing_financial_resolutions r) x) then
    raise exception '055 postcondition: an acquisition-cost row changed';
  end if;
  if b.transactions_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select e::text as t from public.transaction_events e union all select a::text from public.transaction_event_assets a
       union all select r::text from public.transaction_asset_resolutions r union all select c::text from public.player_career_transactions c) x) then
    raise exception '055 postcondition: a transaction or career-history row changed';
  end if;
  if b.development_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select s::text as t from public.player_season_stints s union all select m::text from public.development_milestones m
       union all select d::text from public.development_progression_decisions d) x) then
    raise exception '055 postcondition: a development row changed';
  end if;
  if b.war_hash is distinct from (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) then
    raise exception '055 postcondition: a WAR row was added, removed or changed; 055 loads no Baseball-Reference WAR';
  end if;
  -- no label was written by hand, no WAR is invented: every new reacher has NULL career bWAR
  select count(*) into n from public.outcomes oc join public.players pl on pl.id = oc.player_id
    where pl.slug in (select a.slug from _m055_aud a) and oc.career_war is not null;
  if n > 0 then
    raise exception '055 postcondition: % new outcomes carry a career bWAR; 055 loads none', n;
  end if;
  -- BENCHMARK SUPPORT != DODGERS SUPPORT: no probability for a non-Dodgers population; the executive count is the Dodgers population's
  select count(*) into n from public.v_player_outcome_probability where probability is not null and training_population is distinct from 'DODGERS_TRACKED_AND_OPENING_CLASS';
  if n > 0 then
    raise exception '055 postcondition: % probabilities exist for a population predictions are not made for', n;
  end if;
  if (select supported_probability_targets from public.v_executive_overview) <> (select count(distinct target_key) from public.v_outcome_target_support
       where baseline_supported and reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS') then
    raise exception '055 postcondition: the executive overview does not count the Dodgers population''s support';
  end if;
  -- the stored evaluation describes the live training set and supports no model (when the evaluation was supplied)
  if jsonb_typeof((select j -> 'evaluation' from _m055)) = 'array' then
    if exists (select 1 from public.v_outcome_model_evaluation where not evaluation_current) then
      raise exception '055 postcondition: the stored model evaluation is not current after the 055 data';
    end if;
    if exists (select 1 from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED') then
      raise exception '055 postcondition: a model is supported; its coefficients must be stored and reviewed before anything is built on it';
    end if;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' having count(*) <> (select (j #>> '{baseline,catalog,tables}')::int from _m055))
     or exists (select 1 from information_schema.views where table_schema = 'public' having count(*) <> (select (j #>> '{baseline,catalog,views}')::int from _m055)) then
    raise exception '055 postcondition: the catalog moved; 055 adds no table or view';
  end if;
end $$;

-- ===========================================================================
-- 9. GENERATION: one coherent refresh, only when this run changed a row
-- ===========================================================================

do $$
declare
  b record;
begin
  select * into b from _m055_before;
  if b.content_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (
       select p::text as t from public.players p union all select s::text from public.signings s union all select a::text from public.outcome_audits a
       union all select o::text from public.outcomes o union all select e::text from public.player_evaluations e union all select m::text from public.outcome_model_evaluations m
       union all select sp::text from public.signing_populations sp union all select pm::text from public.signing_population_members pm) z) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

commit;
