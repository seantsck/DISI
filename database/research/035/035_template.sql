-- DISI v0.26
-- 035_international_benchmark_outcomes.sql
-- League-wide international benchmarking, first bounded step: the MLB outcome audit of the 48 non-Dodgers players of the MLB
-- Pipeline 2013 / 2014 Top-30 international signing trackers, their Baseball-Reference team-season bWAR, and a coverage model that
-- states exactly what each tracked population is (a Top-prospect sample, a verified set, a full signing period) and whether it can
-- support an organizational rate. Run after 034.
--
-- Built from database/research/035/ (benchmark-outcomes.json, war-seed.json, scope-config.json, audit.mjs, build.mjs).
--
-- What this is. Source-backed outcome facts for an existing benchmark sample, plus derived views. It is NOT a league census: no
-- organization is ranked, no organizational hit rate is computed, and no class is declared rate-eligible by this migration (the
-- derived eligibility test is strict and, on today's data, true for no class). No new table is needed: outcomes, audits and evidence
-- reuse the Dodgers outcome-audit stores and populations reuse signing_populations.
--
-- What it does:
--   * Audits the MLB outcome of 43 identity-resolved benchmark players from the official MLB Stats API person record (same
--     conventions as the Dodgers audits, same 2026-10-05 boundary so the analytics as-of date does not move); 11 reached MLB.
--     Five players remain identity-unresolved and are queued, never inferred.
--   * Records outcomes rows (debut, games, plate appearances, innings, career bWAR from team-season facts) for the 11 reachers.
--   * Loads Baseball-Reference team-season bWAR for those 11 (same two data files and checksums as 032 / 033 / 034).
--   * Adds v_international_benchmark_player_outcomes, v_international_benchmark_class_coverage and
--     v_international_benchmark_research_queue.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/035/)
-- ===========================================================================

create temporary table _m035 on commit drop as
select $m035${{payload_json}}$m035$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
begin
  if to_regclass('public.transaction_asset_timing_observations') is null or to_regclass('public.v_downstream_organizational_realization') is null then
    raise exception '035: Migration 034 has not been applied';
  end if;
  for p in select x from _m035, jsonb_array_elements(j -> 'war' -> 'source_urls') x loop
    if not exists (select 1 from public.sources where url = p #>> '{}') then
      raise exception '035: the Baseball-Reference data file source % is not registered', p #>> '{}';
    end if;
  end loop;
  -- every benchmark player exists as a non-Dodgers Top-prospect signing of the recorded class, with the identity the research used
  for p in select x from _m035, jsonb_array_elements(j -> 'players') x loop
    select count(*) into n
    from public.players pl join public.signings s on s.player_id = pl.id join public.organizations o on o.id = s.organization_id
    where pl.slug = p ->> 'slug' and o.abbreviation = p ->> 'org' and s.signing_year = (p ->> 'signing_year')::int
      and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
      and (p ->> 'mlb_id' is null or pl.mlb_id is null or pl.mlb_id = (p ->> 'mlb_id')::bigint)
      and (p ->> 'bref_id' is null or pl.bref_id is null or pl.bref_id = p ->> 'bref_id');
    if n <> 1 then
      raise exception '035: benchmark player % (%, %) was not found exactly once with the researched identity', p ->> 'slug', p ->> 'org', p ->> 'signing_year';
    end if;
  end loop;
  -- nothing the data would add exists with different content
  select count(*) into n from _m035, jsonb_array_elements(j -> 'players') x
  join public.players pl on pl.slug = x ->> 'slug'
  join public.outcome_audits a on a.player_id = pl.id
  where a.reached_mlb_verified is distinct from (x ->> 'reached')::boolean;
  if n <> 0 then
    raise exception '035: % benchmark outcome audit(s) already exist with a different result', n;
  end if;
end $$;

-- ===========================================================================
-- 2. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (j ->> 'retrieved_at')::timestamptz
from _m035, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 3. OUTCOME EVIDENCE, AUDITS AND OUTCOMES (the Dodgers outcome-audit stores, same conventions)
-- ===========================================================================

insert into public.outcome_evidence (player_id, source_id, supports_fields, confidence, note)
select pl.id, so.id, array(select jsonb_array_elements_text(x -> 'supports')), (x ->> 'confidence')::public.confidence_level, x ->> 'evidence_note'
from _m035, jsonb_array_elements(j -> 'players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = x ->> 'person_url'
where x ->> 'mlb_id' is not null
on conflict (player_id, source_id) do nothing;

insert into public.outcome_audits (player_id, audited_through_date, reached_mlb_verified, source_id, confidence, audit_note, outcome_state)
select pl.id, (j ->> 'audit_through_date')::date, (x ->> 'reached')::boolean, so.id, (x ->> 'confidence')::public.confidence_level, x ->> 'audit_note', x ->> 'outcome_state'
from _m035, jsonb_array_elements(j -> 'players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = x ->> 'person_url'
where x ->> 'mlb_id' is not null
on conflict (player_id) do nothing;

insert into public.outcomes (player_id, reached_mlb, mlb_debut_date, mlb_games, mlb_pa, mlb_ip, career_war, current_status, outcome_through_season, source_id, confidence)
select pl.id, true, (x ->> 'debut')::date, nullif(x ->> 'games', '')::int, nullif(x ->> 'pa', '')::int, nullif(x ->> 'ip', '')::numeric, (x ->> 'career_bwar')::numeric,
       x ->> 'current_status', (j ->> 'outcome_through_season')::int, so.id, 'VERIFIED'
from _m035, jsonb_array_elements(j -> 'players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = x ->> 'person_url'
where (x ->> 'reached')::boolean
on conflict (player_id) do nothing;

-- ===========================================================================
-- 4. TEAM-SEASON FACTS OF THE BENCHMARK PLAYERS WHO REACHED MLB (same Baseball-Reference files and method as 032 - 034)
-- ===========================================================================

insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
  plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
select r ->> 0, r ->> 1, pl.id, (r ->> 2)::int, r ->> 3, m.organization_id, (r ->> 4)::int, r ->> 5, nullif(r ->> 7, '')::numeric, nullif(r ->> 8, '')::int,
       nullif(r ->> 9, '')::int, nullif(r ->> 10, '')::int, nullif(r ->> 6, ''), so.id,
       (j -> 'war' ->> 'observed_through_date')::date, (j -> 'war' ->> 'observed_through_season')::int, (j -> 'war' ->> 'retrieved_at')::timestamptz, 'VERIFIED',
       case when r ->> 7 is null then 'The data file has no WAR for this zero-plate-appearance row; stored as NULL, not zero.' end
from _m035 cross join lateral jsonb_array_elements(j -> 'war' -> 'rows') r
join public.sources so on so.url = case when r ->> 5 = 'BAT' then j -> 'war' ->> 'bat_url' else j -> 'war' ->> 'pitch_url' end
left join public.players pl on pl.bref_id = r ->> 0
left join lateral (
  select m2.organization_id from public.bref_team_code_map m2
  where m2.bref_team_code = r ->> 3 and (r ->> 2)::int >= m2.from_season and (r ->> 2)::int <= coalesce(m2.to_season, 9999)
  order by m2.from_season desc limit 1
) m on true
on conflict (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE' do nothing;

-- ===========================================================================
-- 5. VIEWS
-- ===========================================================================

{{views}}

-- ===========================================================================
-- 6. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['v_international_benchmark_player_outcomes', 'v_international_benchmark_class_coverage', 'v_international_benchmark_research_queue'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  n int;
  expected int;
begin
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '035: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- every identity-resolved benchmark player has an audit and, when reached, an outcome row
  select count(*) into expected from _m035, jsonb_array_elements(j -> 'players') x where x ->> 'mlb_id' is not null;
  select count(*) into n from public.outcome_audits a join public.players pl on pl.id = a.player_id
  where pl.slug in (select x ->> 'slug' from _m035, jsonb_array_elements(j -> 'players') x where x ->> 'mlb_id' is not null);
  if n <> expected then
    raise exception '035 postcondition: % of % benchmark outcome audits are present', n, expected;
  end if;
  select count(*) into expected from _m035, jsonb_array_elements(j -> 'players') x where (x ->> 'reached')::boolean;
  select count(*) into n from public.outcomes oc join public.players pl on pl.id = oc.player_id
  where pl.slug in (select x ->> 'slug' from _m035, jsonb_array_elements(j -> 'players') x where (x ->> 'reached')::boolean);
  if n <> expected then
    raise exception '035 postcondition: % of % benchmark outcomes are present', n, expected;
  end if;
  select jsonb_array_length(j -> 'war' -> 'rows') into expected from _m035;
  select count(*) into n from public.player_mlb_team_season_war w
  where w.record_status = 'ACTIVE' and exists (select 1 from _m035, jsonb_array_elements(j -> 'war' -> 'rows') r
    where r ->> 0 = w.bref_id and (r ->> 2)::int = w.season and r ->> 3 = w.bref_team_code and (r ->> 4)::int = w.stint_ordinal and r ->> 5 = w.component);
  if n <> expected then
    raise exception '035 postcondition: % of % benchmark team-season rows are present', n, expected;
  end if;
  select count(*) into n from public.player_mlb_team_season_war where organization_id is null and record_status = 'ACTIVE';
  if n <> 0 then
    raise exception '035 postcondition: % loaded team-season row(s) have no organization', n;
  end if;
end $$;

commit;
