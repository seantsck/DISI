-- DISI v0.38
-- 053_transaction_chronology_resolution.sql
-- A reviewed transaction and chronology research batch. Run after 052.
--
-- Built from database/research/053/ (migration-values.json, build.mjs). Do not edit by hand: change the research and rebuild.
--
-- What this is. A research-data migration with one detector correction. It adds no table, function, grant or policy, changes no outcome audit,
-- no acquisition cost, no WAR row and no development stint, milestone or progression decision, and values nothing.
--   TEAM CHANGE != CANONICAL TRANSACTION   ORGANIZATION CHANGE != TRANSACTION TYPE   KNOWN DESTINATION != KNOWN TRANSACTION MECHANISM
--   KNOWN EXIT DATE != KNOWN RETURN   WAIVER CLAIM != TRADE   FREE-AGENT SIGNING != TRADE RETURN   CONTRACT PURCHASE != TRADE WITHOUT EVIDENCE
--   SOURCE SILENCE != RELEASE   UNKNOWN AMOUNT != ZERO   MISSING BWAR != ZERO BWAR
--   * Ten Dodgers transactions the official MLB transaction log or the Retrosheet transaction database states and DISI lacked: the 2022
--     re-signing of Pedro Baez; Chan Ho Park's 2008 signing and free agency; Jose Vizcaino's 1997 re-signing and his 2000 trade to the Yankees for
--     Jim Leyritz (with cash of unstated amount), and Leyritz's free agency; Omar Daal's 2001 re-acquisition from the Phillies and his 2002 free
--     agency; Juan Castro's 2010 signing and free agency. Each identity is matched across the Chadwick Register, the official person record and
--     BIOFILE by an exact birth date. Where the two sources give different dates, the official log is used and the other date is kept in the
--     description. Every event cites a source DISI already holds; 053 adds no source.
--   * The development research queue reads a canonical transaction in the player's own direction and recognizes the Dodgers end of a move (a
--     release or free agency before the other club's first game, a free-agent signing after the other club's last game). A move between two
--     other clubs is not a Dodgers transaction and is never recorded here.
--   * Not recorded, on purpose: Juan Castro's 2000 trade to Cincinnati, 2009 and December 2010 signings and 2011 retirement (stated by the sources,
--     but recording the trade's return needs a sealed control observation, which no rollback can remove), every cash amount, and every move
--     between two other clubs.
-- Jim Leyritz's Dodgers bWAR is NOT loaded (the Baseball-Reference WAR files answer 403): his return stays RETURN_WAR_UNKNOWN.
-- It then runs the explicit snapshot refresh once, only when this run changed a transaction row.
--
-- Rerunnable: every statement is idempotent; the refresh runs only when a row was added.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m053 on commit drop as
select $m053${"events":[{"assets":[{"bref_id":"vizcajo01","bref_register_id":"","counterparty":"","mlb_id":"123743","name":"Jose Vizcaino","player_slug":"jose-vizcaino","role_note":"DISI tracked international signing. Re-signed by the Dodgers after his 1997 free agency from San Francisco.","side":"INCOMING","type":"PLAYER"}],"date":"1997-12-08","description":"Jose Vizcaino signed with the Dodgers as a free agent (Retrosheet transaction 54684, 1997-12-08).","from":"LAD","historical_label":"Signed as a free agent","key":"LAD_FREE_AGENT_SIGNING_1997_JOSE_VIZCAINO","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"FREE_AGENT_SIGNING"},{"assets":[{"bref_id":"vizcajo01","bref_register_id":"","counterparty":"NYY","mlb_id":"123743","name":"Jose Vizcaino","player_slug":"jose-vizcaino","role_note":"DISI tracked international signing.","side":"OUTGOING","type":"PLAYER"},{"bref_id":"","bref_register_id":"","counterparty":"NYY","mlb_id":"","name":"Cash","player_slug":"","role_note":"Cash sent with Vizcaino; the amount is not stated in Retrosheet (unknown, never zero).","side":"OUTGOING","type":"CASH"},{"bref_id":"leyriji01","bref_register_id":"","counterparty":"NYY","mlb_id":"117747","name":"Jim Leyritz","player_slug":"","role_note":"Acquired from the Yankees for Jose Vizcaino and cash.","side":"INCOMING","type":"PLAYER"}],"date":"2000-06-20","description":"Traded Jose Vizcaino and cash to the New York Yankees. Received Jim Leyritz. Retrosheet transaction 63209 (2000-06-20); the cash amount is not stated.","from":"LAD","historical_label":"","key":"LAD_NYY_2000_JOSE_VIZCAINO","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"NYY","type":"TRADE"},{"assets":[{"bref_id":"leyriji01","bref_register_id":"","counterparty":"","mlb_id":"117747","name":"Jim Leyritz","player_slug":"","role_note":"Acquired in the 2000 Jose Vizcaino trade.","side":"OUTGOING","type":"PLAYER"}],"date":"2000-11-01","description":"Jim Leyritz was granted free agency by the Dodgers (Retrosheet transaction 30076, 2000-11-01).","from":"LAD","historical_label":"Granted free agency","key":"LAD_FREE_AGENCY_2000_JIM_LEYRITZ","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"FREE_AGENCY"},{"assets":[{"bref_id":"daalom01","bref_register_id":"","counterparty":"PHI","mlb_id":"112984","name":"Omar Daal","player_slug":"omar-daal","role_note":"DISI tracked international signing. Re-acquired from the Phillies.","side":"INCOMING","type":"PLAYER"},{"bref_id":"jungeer01","bref_register_id":"","counterparty":"PHI","mlb_id":"407784","name":"Eric Junge","player_slug":"","role_note":"","side":"OUTGOING","type":"PLAYER"},{"bref_id":"","bref_register_id":"corder001jes","counterparty":"PHI","mlb_id":"407782","name":"Jesus Cordero","player_slug":"","role_note":"Never appeared in the major leagues (official person record: no debut).","side":"OUTGOING","type":"PLAYER"}],"date":"2001-11-09","description":"Traded Eric Junge and Jesus Cordero to the Philadelphia Phillies. Received Omar Daal. Retrosheet transaction 63360 (2001-11-09).","from":"LAD","historical_label":"","key":"PHI_LAD_2001_DAAL_REACQ","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"PHI","type":"TRADE"},{"assets":[{"bref_id":"daalom01","bref_register_id":"","counterparty":"","mlb_id":"112984","name":"Omar Daal","player_slug":"omar-daal","role_note":"DISI tracked international signing.","side":"OUTGOING","type":"PLAYER"}],"date":"2002-10-28","description":"Omar Daal was granted free agency by the Dodgers (Retrosheet transaction 11939, 2002-10-28).","from":"LAD","historical_label":"Granted free agency","key":"LAD_FREE_AGENCY_2002_OMAR_DAAL","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"FREE_AGENCY"},{"assets":[{"bref_id":"parkch01","bref_register_id":"","counterparty":"","mlb_id":"120221","name":"Chan Ho Park","player_slug":"chan-ho-park","role_note":"DISI tracked international signing. Re-signed by the Dodgers after his 2001 free agency.","side":"INCOMING","type":"PLAYER"}],"date":"2008-01-20","description":"Chan Ho Park signed with the Dodgers as a free agent (Retrosheet transaction 39973, 2008-01-20).","from":"LAD","historical_label":"Signed as a free agent","key":"LAD_FREE_AGENT_SIGNING_2008_CHAN_HO_PARK","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"FREE_AGENT_SIGNING"},{"assets":[{"bref_id":"parkch01","bref_register_id":"","counterparty":"","mlb_id":"120221","name":"Chan Ho Park","player_slug":"chan-ho-park","role_note":"DISI tracked international signing.","side":"OUTGOING","type":"PLAYER"}],"date":"2008-11-01","description":"Chan Ho Park was granted free agency by the Dodgers (Retrosheet transaction 39974, 2008-11-01).","from":"LAD","historical_label":"Granted free agency","key":"LAD_FREE_AGENCY_2008_CHAN_HO_PARK","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"FREE_AGENCY"},{"assets":[{"bref_id":"castrju01","bref_register_id":"","counterparty":"","mlb_id":"112128","name":"Juan Castro","player_slug":"juan-castro","role_note":"DISI tracked international signing. Re-signed by the Dodgers.","side":"INCOMING","type":"PLAYER"}],"date":"2010-08-03","description":"Los Angeles Dodgers signed free agent SS Juan Castro to a minor league contract. (MLB transaction log, 2010-08-03; Retrosheet transaction 8708 dates the signing 2010-07-27). The Philadelphia Phillies had released him on 2010-07-17; that release is Philadelphia's transaction and is not recorded here.","from":"LAD","historical_label":"Signed as a free agent (minor league contract)","key":"LAD_FREE_AGENT_SIGNING_2010_JUAN_CASTRO","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=112128","to":"","type":"FREE_AGENT_SIGNING"},{"assets":[{"bref_id":"castrju01","bref_register_id":"","counterparty":"","mlb_id":"112128","name":"Juan Castro","player_slug":"juan-castro","role_note":"DISI tracked international signing.","side":"OUTGOING","type":"PLAYER"}],"date":"2010-10-05","description":"SS Juan Castro elected free agency. (MLB transaction log, 2010-10-05; Retrosheet transaction 8709).","from":"LAD","historical_label":"Elected free agency","key":"LAD_FREE_AGENCY_2010_JUAN_CASTRO","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=112128","to":"","type":"FREE_AGENCY"},{"assets":[{"bref_id":"baezpe01","bref_register_id":"","counterparty":"","mlb_id":"520980","name":"Pedro Báez","player_slug":"pedro-baez","role_note":"DISI tracked international signing. Re-signed by the Dodgers after his 2020 free agency.","side":"INCOMING","type":"PLAYER"}],"date":"2022-05-19","description":"Los Angeles Dodgers signed free agent RHP Pedro Baez to a minor league contract. (MLB transaction log, 2022-05-19). The Houston Astros had released him on 2022-04-27; that release is Houston's transaction and is not recorded here.","from":"LAD","historical_label":"Signed as a free agent (minor league contract)","key":"LAD_FREE_AGENT_SIGNING_2022_PEDRO_BAEZ","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=520980","to":"","type":"FREE_AGENT_SIGNING"}],"existing_events":["LAD_CHC_1990_VIZCAINO","LAD_FA_2001_PARK","LAD_FREE_AGENCY_2009_JUAN_CASTRO","LAD_FREE_AGENCY_2020_PEDRO_BAEZ","LAD_MON_1995_DAAL","LAD_RELEASE_2022_PEDRO_BAEZ"],"existing_source_urls":["https://github.com/chadwickbureau/register","https://statsapi.mlb.com/api/v1/transactions?playerId=112128","https://statsapi.mlb.com/api/v1/transactions?playerId=520980","https://www.retrosheet.org/transactions/tranDB.zip"],"retrieved_at":"2026-10-24T00:00:00Z","war_unavailable_mlb_ids":["117747"]}$m053$::jsonb as j;

create temporary table _m053_before on commit drop as
select
  (select count(*) from public.transaction_events) as events,
  (select count(*) from public.transaction_event_assets) as assets,
  (select count(*) from public.transaction_asset_resolutions) as resolutions,
  (select count(*) from public.dodgers_control_observations) as observations,
  (select count(*) from public.sources) as sources,
  (select md5(string_agg(t::text, '|' order by t.id::text)) from (
     select e.id, e::text from public.transaction_events e union all select a.id, a::text from public.transaction_event_assets a
     union all select r.id, r::text from public.transaction_asset_resolutions r ) t(id, t)) as transactions_hash,
  (select md5(string_agg(e::text, '|' order by e.event_key)) from public.transaction_events e
    where e.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y)) as other_events_hash,
  (select md5(string_agg(a::text, '|' order by a.id::text)) from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
    where e.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y)) as other_assets_hash,
  (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) as war_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t) as stints_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t) as milestones_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t) as decisions_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t) as audits_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from (select r::text from public.signing_financial_reports r union all select s::text from public.signing_financial_resolutions s) t(t)) as costs_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.transactions t) as legacy_hash
from _m053;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 053 was written for
-- ===========================================================================

do $$
declare
  p jsonb;
  a jsonb;
  n int;
  k text;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception '053: Migration 045b has not been applied';
  end if;
  -- the 052 view is the first to read transaction_events (pg_get_viewdef drops comments); the 053 view also reads asset_side
  if position('transaction_events' in pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) = 0 then
    raise exception '053: Migration 052 has not been applied';
  end if;
  for k in select unnest(array['LAD', 'NYY', 'PHI', 'CIN']) loop
    if not exists (select 1 from public.organizations where abbreviation = k) then
      raise exception '053: the organization % is missing', k;
    end if;
  end loop;
  for k in select jsonb_array_elements_text(j -> 'existing_source_urls') from _m053 loop
    if not exists (select 1 from public.sources where url = k) then
      raise exception '053: the source % is missing', k;
    end if;
  end loop;
  -- the existing events the research reads are present (053 changes none of them)
  for k in select jsonb_array_elements_text(j -> 'existing_events') from _m053 loop
    if (select count(*) from public.transaction_events where event_key = k) <> 1 then
      raise exception '053: the event % is not in the state the research was written for', k;
    end if;
  end loop;
  -- every tracked player is the DISI player with the reviewed MLB id; no event key is taken by anything else
  for p in select y from _m053, jsonb_array_elements(j -> 'events') y loop
    for a in select x from jsonb_array_elements(p -> 'assets') x where x ->> 'player_slug' <> '' loop
      if (select count(*) from public.players pl where pl.slug = a ->> 'player_slug' and pl.mlb_id::text = a ->> 'mlb_id') <> 1 then
        raise exception '053: % is not the DISI player with MLB id %', a ->> 'player_slug', a ->> 'mlb_id';
      end if;
    end loop;
    select count(*) into n from public.transaction_events e
      where e.event_key = p ->> 'key' and (e.transaction_date <> (p ->> 'date')::date or e.transaction_type <> p ->> 'type');
    if n > 0 then
      raise exception '053: the event key % already holds a different transaction', p ->> 'key';
    end if;
    -- the transaction is not already recorded under another key (same player, date and type)
    select count(*) into n from public.transaction_events e join public.transaction_event_assets x on x.event_id = e.id
      where e.event_key <> p ->> 'key' and e.transaction_date = (p ->> 'date')::date and e.transaction_type = p ->> 'type'
        and x.mlb_id in (select y ->> 'mlb_id' from jsonb_array_elements(p -> 'assets') y where y ->> 'mlb_id' <> '');
    if n > 0 then
      raise exception '053: the transaction % is already recorded under another key', p ->> 'key';
    end if;
  end loop;
  -- the returned and outgoing non-DISI players are not recorded in any other transaction
  select count(*) into n from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id, _m053
    where x.player_id is null and x.mlb_id in (select y ->> 'mlb_id' from jsonb_array_elements(j -> 'events') v, jsonb_array_elements(v -> 'assets') y where y ->> 'player_slug' = '' and y ->> 'mlb_id' <> '')
      and e.event_key not in (select v ->> 'key' from jsonb_array_elements(j -> 'events') v);
  if n > 0 then
    raise exception '053: a reviewed non-DISI player is already recorded in another transaction';
  end if;
end $$;

-- ===========================================================================
-- 2. TRANSACTIONS (Dodgers transactions only; a recorded trade does not wait for its value)
-- ===========================================================================

insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description, source_id,
  is_multi_team, historical_label)
select x ->> 'key', (x ->> 'date')::date, x ->> 'type', fo.id, too.id, x ->> 'description', so.id, false, nullif(x ->> 'historical_label', '')
from _m053 cross join jsonb_array_elements(j -> 'events') x
join public.organizations fo on fo.abbreviation = x ->> 'from'
left join public.organizations too on too.abbreviation = nullif(x ->> 'to', '')
join public.sources so on so.url = x ->> 'source_url'
on conflict (event_key) do nothing;

insert into public.transaction_event_assets (event_id, asset_side, player_id, asset_name, asset_type, role_note, source_id, bref_id, mlb_id, bref_register_id,
  counterparty_organization_id, cash_amount_usd, pool_space_amount_usd)
select e.id, a ->> 'side', pl.id, a ->> 'name', a ->> 'type', nullif(a ->> 'role_note', ''), so.id, nullif(a ->> 'bref_id', ''), nullif(a ->> 'mlb_id', ''),
  nullif(a ->> 'bref_register_id', ''), (select o.id from public.organizations o where o.abbreviation = nullif(a ->> 'counterparty', '')), null, null
from _m053 cross join jsonb_array_elements(j -> 'events') x cross join jsonb_array_elements(x -> 'assets') a
join public.transaction_events e on e.event_key = x ->> 'key'
join public.sources so on so.url = x ->> 'source_url'
left join public.players pl on pl.slug = nullif(a ->> 'player_slug', '')
on conflict (event_id, asset_side, asset_name) do nothing;

-- ===========================================================================
-- 3. RESEARCH QUEUE: the 052 view with the MULTI_ORG_SEASON_UNVERIFIED condition read in the player's direction
-- ===========================================================================

create or replace view public.v_dodgers_development_research_queue
with (security_invoker = true)
as
with team_stints as (
  -- 023: a season-total row repeats its component team stints, so it never
  -- counts as development history, a missing date or an unresolved organization.
  select * from public.player_season_stints where stint_kind = 'TEAM_STINT'
),
-- 024: developmental inversions - two REACHED levels whose arrivals run backward
-- (rookie levels share one tier). Reviewed decisions change arrivals, so a
-- covered inversion no longer appears here.
progression as (
  select * from public.v_player_development_progression
),
inverted as (
  select distinct lo.player_id
  from progression lo
  join progression hi on hi.player_id = lo.player_id and hi.progression_tier > lo.progression_tier
  where lo.development_state = 'REACHED' and hi.development_state = 'REACHED'
    and case when lo.developmental_arrival_date is not null and hi.developmental_arrival_date is not null
             then lo.developmental_arrival_date > hi.developmental_arrival_date
             else lo.developmental_arrival_season > hi.developmental_arrival_season end
),
base as (
  select
    p.id as player_id,
    p.slug as player_slug,
    p.full_name,
    p.mlb_id,
    sg.signing_year,
    (select max(s.as_of_date) from team_stints s where s.player_id = p.id) as last_research_date,
    (select count(distinct s.season)::int from team_stints s where s.player_id = p.id) as stint_count,
    exists (select 1 from team_stints s where s.player_id = p.id) as has_stints,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.level_classification in ('UNRECOGNIZED_SPORT','UNKNOWN_ROOKIE_LEAGUE')
    ) as has_unknown_level,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.organization_id is null
        and s.level <> 'FOREIGN_PRO' -- foreign clubs are organization-unmapped by design
    ) as has_unresolved_organization,
    exists (
      select 1 from team_stints s1
      join team_stints s2
        on s2.player_id = s1.player_id and s2.season = s1.season
       and s2.id > s1.id
      where s1.player_id = p.id
        and s1.organization_id is not null and s2.organization_id is not null
        and s1.organization_id <> s2.organization_id
    ) as has_multi_org_season,
    exists (
      select 1 from public.development_milestones m
      where m.player_id = p.id and m.event_code = 'MLB_DEBUT'
    ) as has_mlb_milestone,
    not exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.level <> 'MLB'
    ) as no_pre_mlb_history,
    -- 022 date-coverage facts
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.season >= 2006 and s.first_game_date is null
    ) as has_undated_log_era_stint,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.season >= 2006 and s.last_game_date is null
    ) as has_stint_missing_last_date,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.season >= 2006 and s.first_game_date is not null
    ) as has_any_dated_stint,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.level_classification in ('UNKNOWN_ROOKIE_LEAGUE','UNRECOGNIZED_SPORT')
        and s.season >= 2006 and s.first_game_date is null
    ) as has_unknown_level_undated,
    exists (
      select 1 from public.development_milestones m
      where m.player_id = p.id and m.date_precision = 'SEASON'
        and m.event_code in ('DSL_DEBUT','COMPLEX_DEBUT','A_DEBUT','HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT')
    ) as has_season_only_debut_milestone,
    exists (
      select 1 from public.development_milestones m
      where m.player_id = p.id and m.date_precision = 'DAY'
        and m.event_code in ('A_DEBUT','HIGH_A_DEBUT','AA_DEBUT','AAA_DEBUT')
    ) as has_exact_level_debut_milestone,
    exists (
      select 1 from public.research_source_conflicts c
      where c.player_id = p.id and c.conflict_type = 'EXACT_DATE_CONFLICT' and c.status = 'UNRESOLVED'
    ) as has_exact_date_conflict,
    exists (
      select 1 from team_stints s
      where s.player_id = p.id and s.level <> 'MLB' and s.affiliated
    ) as has_pre_mlb_history,
    -- 024 progression facts
    p.id in (select player_id from inverted) as has_non_monotonic_progression,
    -- Heuristic candidate only (never changes analytics): an undecided High-A/AA/AAA
    -- first appearance with no first appearance at the level below on or before
    -- it, and at most 2 team-stint games at the level.
    exists (
      select 1 from public.development_milestones m
      join (values ('HIGH_A_DEBUT', 'A_DEBUT', 'HIGH_A'), ('AA_DEBUT', 'HIGH_A_DEBUT', 'AA'), ('AAA_DEBUT', 'AA_DEBUT', 'AAA'))
        as k(event_code, below_event, level) on k.event_code = m.event_code
      where m.player_id = p.id
        and not exists (select 1 from public.development_progression_decisions d
                        where d.player_id = m.player_id and d.event_code = m.event_code)
        and not exists (
          select 1 from public.development_milestones b
          where b.player_id = m.player_id and b.event_code = k.below_event
            and case when b.milestone_date is not null and m.milestone_date is not null
                     then b.milestone_date <= m.milestone_date
                     else coalesce(b.season_year, extract(year from b.milestone_date)::int)
                          <= coalesce(m.season_year, extract(year from m.milestone_date)::int) end)
        and (select coalesce(sum(coalesce(s.g, s.pg)), 0) from team_stints s
             where s.player_id = m.player_id and s.level::text = k.level) <= 2
    ) as has_level_skip_cameo_candidate,
    -- 052: a season with no record between the first and last recorded seasons, unless the league did not play it. The official schedule holds no
    -- 2020 regular-season game at any affiliated minor-league level, so 2020 is explained for an affiliated minor leaguer: his last recorded
    -- season before it is affiliated minor-league play only and he has no major-league stint by then (the 2020 major-league season was played).
    -- LEAGUE SEASON NOT PLAYED != MISSING PLAYER SEASON; every other missing season stays a research need (SEASON GAP != DID NOT PLAY).
    exists (
      select 1
      from generate_series((select min(s.season) from team_stints s where s.player_id = p.id) + 1,
                           (select max(s.season) from team_stints s where s.player_id = p.id) - 1) as y(season)
      where not exists (select 1 from team_stints s where s.player_id = p.id and s.season = y.season)
        and not (y.season = 2020
                 and not exists (select 1 from team_stints s where s.player_id = p.id and s.level = 'MLB' and s.season <= y.season)
                 and not exists (
                   select 1 from team_stints s
                   where s.player_id = p.id
                     and s.season = (select max(b.season) from team_stints b where b.player_id = p.id and b.season < y.season)
                     and not (s.affiliated and s.level <> 'MLB')))
    ) as has_open_season_gap,
    -- 052: a season with two or more organizations stays a research need unless exactly two organizations appear, every stint of the season is
    -- game-dated, and one canonical transaction of this player moves him from the first to the second inside that season with his last
    -- appearance for the first on or before the transaction date and his first for the second on or after it. A team change is never a
    -- transaction (TEAM CHANGE != CANONICAL TRANSACTION); the transaction date and the two appearance dates stay three facts.
    -- 053: the direction is the player's, read from his asset side (the ledger records every transaction from the Dodgers' side: an INCOMING
    -- player came from the counterparty to the Dodgers), and a transaction with one known end brackets the Dodgers boundary of the move: a
    -- Dodgers release, free agency or waiver without a counterparty after his last game for the Dodgers and before his first for the other club,
    -- or a Dodgers free-agent signing after his last game for the other club and before his first for the Dodgers. The other club's signing or
    -- release is not a Dodgers transaction and is never implied. Exactly one bracketing transaction closes the season; two or more stay open
    -- for a person to decide (lib/research/development-chronology.js mirrors this rule).
    exists (
      select 1
      from (
        select s.season from team_stints s
        where s.player_id = p.id and s.organization_id is not null
        group by s.season
        having count(distinct s.organization_id) >= 2
      ) ms
      where not (
        (select count(distinct s.organization_id) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id is not null) = 2
        and not exists (
          select 1 from team_stints s
          where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            and (s.first_game_date is null or s.last_game_date is null))
        and (
          select count(distinct e.id)
          from public.transaction_event_assets a
          join public.transaction_events e on e.id = a.event_id
          cross join lateral (
            select case when a.asset_side = 'INCOMING' then e.to_organization_id else e.from_organization_id end as from_known,
                   case when a.asset_side = 'INCOMING' then e.from_organization_id else e.to_organization_id end as to_known
          ) k
          cross join lateral (
            select coalesce(k.from_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                             and s.organization_id is not null and s.organization_id <> k.to_known limit 1)) as from_org,
                   coalesce(k.to_known, (select s.organization_id from team_stints s where s.player_id = p.id and s.season = ms.season
                                           and s.organization_id is not null and s.organization_id <> k.from_known limit 1)) as to_org,
                   (k.from_known is null or k.to_known is null) as boundary
          ) mv
          where a.player_id = p.id
            and extract(year from e.transaction_date)::int = ms.season
            and e.from_organization_id is not null
            and k.from_known is distinct from k.to_known
            and (k.from_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.from_known))
            and (k.to_known is null or exists (select 1 from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = k.to_known))
            and (not mv.boundary
                 or (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org)
                    <= (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org))
            and (select max(s.last_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.from_org) <= e.transaction_date
            and (select min(s.first_game_date) from team_stints s
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org) >= e.transaction_date) = 1)
    ) as has_unverified_multi_org_season
  from public.players p
  left join public.signings sg on sg.player_id = p.id
  join public.organizations o on o.id = sg.organization_id
  where o.franchise_key = 'DODGERS'
)
select
  player_id, player_slug, full_name, mlb_id, signing_year,
  issue, priority, detail
from base,
lateral (
  select * from (values
    ('IDENTITY_BUT_NO_PROFESSIONAL_SEASONS', 3,
      'Resolved identity (MLB id); the season-splits query ran and returned no structured season rows'),
    ('SEASON_GAP', 2,
      'A season between the first and last recorded seasons has no record and is not a league season that was not played'),
    ('UNKNOWN_LEVEL_CLASSIFICATION', 2,
      'A stint could not be classified into the canonical level taxonomy'),
    ('UNRESOLVED_ORGANIZATION', 2,
      'A stint has no organization resolved from its team/league/season'),
    ('MULTI_ORG_SEASON_UNVERIFIED', 1,
      'Two or more organizations appear in one season and no canonical transaction bracketed by game dates explains the move'),
    ('MLB_PLAYER_MISSING_PRE_MLB_HISTORY', 1,
      'Reached MLB but no pre-MLB development record was found'),
    ('LEVEL_CONFLICT', 1,
      'Source-level label and canonical classification disagree; review the stint'),
    ('MISSING_FIRST_GAME_DATE', 3,
      'A log-era stint (2006+) has no verified first appearance date yet; a coverage gap, not a failure'),
    ('MISSING_LAST_GAME_DATE', 3,
      'A log-era stint (2006+) has no verified last appearance date yet; a coverage gap, not a failure'),
    ('SEASON_ONLY_MILESTONE', 2,
      'A level debut stays season-precision; game-log evidence did not cover its first season'),
    ('GAME_LOG_UNAVAILABLE', 3,
      'Log-era stints exist but none carry game-verified dates; the gameLog queries returned nothing for this player'),
    ('EXACT_DATE_CONFLICT', 1,
      'Game-log evidence disagrees with an existing exact date; the stored value was kept and the conflict recorded'),
    ('MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES', 2,
      'Reached MLB with pre-MLB stints, but no level-debut milestone carries an exact date yet'),
    ('UNKNOWN_LEVEL_GAME_LOG', 2,
      'A stint with an unclassified level has no dated appearances; game dates cannot be attributed to it'),
    ('NON_MONOTONIC_PROGRESSION', 1,
      'Developmental arrivals run backward (a lower level after a higher one) and no reviewed progression decision covers it'),
    ('LEVEL_SKIP_CAMEO_CANDIDATE', 2,
      'Heuristic only: a 1-2 game High-A/AA/AAA first appearance skipping the level below, with no reviewed decision; analytics are unchanged until reviewed')
  ) as v(issue, priority, detail)
) issues
where (issue = 'IDENTITY_BUT_NO_PROFESSIONAL_SEASONS' and mlb_id is not null and not has_stints)
   or (issue = 'SEASON_GAP' and has_stints and stint_count >= 2 and has_open_season_gap)
   or (issue = 'UNKNOWN_LEVEL_CLASSIFICATION' and has_unknown_level)
   or (issue = 'UNRESOLVED_ORGANIZATION' and has_unresolved_organization)
   or (issue = 'MULTI_ORG_SEASON_UNVERIFIED' and has_unverified_multi_org_season)
   or (issue = 'MLB_PLAYER_MISSING_PRE_MLB_HISTORY' and has_mlb_milestone and no_pre_mlb_history)
   or (issue = 'MISSING_FIRST_GAME_DATE' and has_undated_log_era_stint)
   or (issue = 'MISSING_LAST_GAME_DATE' and has_stint_missing_last_date)
   or (issue = 'SEASON_ONLY_MILESTONE' and has_season_only_debut_milestone)
   or (issue = 'GAME_LOG_UNAVAILABLE' and has_stints and has_undated_log_era_stint and not has_any_dated_stint)
   or (issue = 'EXACT_DATE_CONFLICT' and has_exact_date_conflict)
   or (issue = 'MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES' and has_mlb_milestone and has_pre_mlb_history
       and not has_exact_level_debut_milestone)
   or (issue = 'UNKNOWN_LEVEL_GAME_LOG' and has_unknown_level_undated)
   or (issue = 'NON_MONOTONIC_PROGRESSION' and has_non_monotonic_progression)
   or (issue = 'LEVEL_SKIP_CAMEO_CANDIDATE' and has_level_skip_cameo_candidate);

-- ===========================================================================
-- 4. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  rec jsonb;
  n int;
  b record;
begin
  select * into b from _m053_before;
  -- every reviewed event exists once with the reviewed date, type, counterparty and assets
  for rec in select y from _m053, jsonb_array_elements(j -> 'events') y loop
    select count(*) into n from public.transaction_events e
      left join public.organizations too on too.id = e.to_organization_id
      where e.event_key = rec ->> 'key' and e.transaction_date = (rec ->> 'date')::date and e.transaction_type = rec ->> 'type'
        and coalesce(too.abbreviation, '') = rec ->> 'to'
        and (select count(*) from public.transaction_event_assets a where a.event_id = e.id) = jsonb_array_length(rec -> 'assets');
    if n <> 1 then
      raise exception '053 postcondition: the event % is not recorded exactly as reviewed', rec ->> 'key';
    end if;
  end loop;
  -- a tracked asset is linked to its DISI player; no amount was invented
  select count(*) into n from _m053, jsonb_array_elements(j -> 'events') v, jsonb_array_elements(v -> 'assets') y
    where y ->> 'player_slug' <> '' and not exists (select 1 from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id
      join public.players pl on pl.id = a.player_id where e.event_key = v ->> 'key' and pl.slug = y ->> 'player_slug' and a.asset_side = y ->> 'side');
  if n > 0 then
    raise exception '053 postcondition: % tracked assets are not linked to their player', n;
  end if;
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _m053
    where e.event_key in (select v ->> 'key' from jsonb_array_elements(j -> 'events') v) and (a.cash_amount_usd is not null or a.pool_space_amount_usd is not null);
  if n > 0 then
    raise exception '053 postcondition: an amount was recorded; 053 records none';
  end if;
  -- nothing else changed: no other event or asset, no control observation, resolution, source, WAR, development, outcome, cost or legacy row
  if b.other_events_hash is distinct from (select md5(string_agg(e::text, '|' order by e.event_key)) from public.transaction_events e
      where e.event_key not in (select y ->> 'key' from _m053, jsonb_array_elements(j -> 'events') y)) then
    raise exception '053 postcondition: an event outside the reviewed set changed';
  end if;
  if b.other_assets_hash is distinct from (select md5(string_agg(a::text, '|' order by a.id::text)) from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
      where e.event_key not in (select y ->> 'key' from _m053, jsonb_array_elements(j -> 'events') y)) then
    raise exception '053 postcondition: an asset outside the reviewed events changed';
  end if;
  if b.war_hash is distinct from (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) then
    raise exception '053 postcondition: a WAR row changed; 053 loads no Baseball-Reference WAR';
  end if;
  if b.stints_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t)
     or b.milestones_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t)
     or b.decisions_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t) then
    raise exception '053 postcondition: a development row changed; a transaction never creates a stint, a milestone or a decision';
  end if;
  if b.audits_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t)
     or b.costs_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from (select r::text from public.signing_financial_reports r union all select s::text from public.signing_financial_resolutions s) t(t))
     or b.legacy_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.transactions t) then
    raise exception '053 postcondition: an outcome audit, an acquisition cost or a legacy transaction changed';
  end if;
  select (select count(*) from public.transaction_events) - b.events into n;
  if n > (select jsonb_array_length(j -> 'events') from _m053) then
    raise exception '053 postcondition: % events were added, at most % were reviewed', n, (select jsonb_array_length(j -> 'events') from _m053);
  end if;
  select (select count(*) from public.transaction_event_assets) - b.assets into n;
  if n > (select sum(jsonb_array_length(y -> 'assets')) from _m053, jsonb_array_elements(j -> 'events') y) then
    raise exception '053 postcondition: % assets were added, more than were reviewed', n;
  end if;
  if (select count(*) from public.transaction_asset_resolutions) <> b.resolutions or (select count(*) from public.dodgers_control_observations) <> b.observations
     or (select count(*) from public.sources) <> b.sources then
    raise exception '053 postcondition: a resolution, a control observation or a source was added; 053 adds none';
  end if;
end $$;

-- ===========================================================================
-- 5. GENERATION: one coherent refresh, only when this run added a transaction row
-- ===========================================================================

do $$
declare
  b record;
begin
  select * into b from _m053_before;
  if b.transactions_hash is distinct from (select md5(string_agg(t::text, '|' order by t.id::text)) from (
       select e.id, e::text from public.transaction_events e union all select a.id, a::text from public.transaction_event_assets a
       union all select r.id, r::text from public.transaction_asset_resolutions r) t(id, t)) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

commit;
