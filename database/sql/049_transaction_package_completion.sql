-- DISI v0.36.5
-- 049_transaction_package_completion.sql
-- A reviewed transaction-package research batch. Run after 048.
--
-- Built from database/research/049/ (transaction-evidence.json, build.mjs).
--
-- What this is. A research-data migration. It adds no table, view, function, grant or policy, changes no outcome audit, no acquisition cost and
-- no WAR row, and values nothing. KNOWN TRANSACTION != KNOWN RETURN VALUE; KNOWN PACKAGE != INDIVIDUALLY ATTRIBUTABLE VALUE; MISSING BWAR != ZERO
-- BWAR; UNKNOWN TRANSACTION != RELEASED; UNKNOWN TRADE RETURN != ZERO VALUE.
--   * A forward-only correction of the 2009 Tony Abreu trade. DISI stored it as a bare "Abreu traded to Arizona" on 2009-10-09 with no return. The
--     official MLB transaction log and Retrosheet (transaction 64131) agree it was the completion of a deal begun on 2009-08-31, when Arizona sent
--     Jon Garland to the Dodgers for a player to be named later, and Abreu was the player named and delivered on 2009-10-09. The event is re-dated to
--     the agreement (the date Garland's Dodgers bWAR is measured from) and Garland is recorded as the return. The date DISI stored before is not
--     lost: it is the completion date, named in the event description and in Abreu's asset note. Abreu is the ONLY outgoing asset, so the trade stays a
--     sole-outgoing-asset trade; no separate "player to be named later" asset is added, because the model counts every outgoing asset (a resolved
--     placeholder and the player it resolved to would be counted as two) and the older package views would then call a one-player trade a shared
--     package. Garland's Dodgers bWAR is NOT loaded (the Baseball-Reference WAR files answer 403), so the return stays RETURN_WAR_UNKNOWN: the
--     transaction is known, its value is not.
--   * The 1967-11-28 trade that ended Bob Miller's Dodgers career (Retrosheet 60573; read independently in three SABR biographies): Miller,
--     Johnny Roseboro and Ron Perranoski to Minnesota for Mudcat Grant and Zoilo Versalles. 047 left it unrecorded because the returned players'
--     Baseball-Reference WAR could not be loaded; recording a trade does not depend on valuing it, so it is recorded now with the value unknown.
--   * The three Dodgers exits those two packages make reachable: Jon Garland's free agency (2009-11-05, official MLB log and Retrosheet), and the 1968
--     expansion-draft selections of Mudcat Grant (Montreal) and Zoilo Versalles (San Diego) (Retrosheet; SABR).
--   * Four MLB identities for assets earlier migrations recorded by name only (Apostol Garcia, Rick Roberts, Danny Muegge, William Juarez), each
--     reconciled by the official season-by-season affiliations bracketing the trade, never by name alone. No exit is recorded for any of them.
-- It then runs the explicit snapshot refresh once, only when this run changed a row.
--
-- Rerunnable: every statement is idempotent; the refresh runs only when a row was added or changed.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m049 on commit drop as
select $m049${"abreu":{"completed":"2009-10-09","description":"Arizona Diamondbacks sent RHP Jon Garland to the Los Angeles Dodgers on 2009-08-31 for a player to be named later. The Dodgers named 2B Tony Abreu and delivered him to Arizona on 2009-10-09 to complete the trade (MLB transaction log; Retrosheet transaction 64131). Before Migration 049 DISI recorded only the completion date, 2009-10-09, as \"Los Angeles Dodgers traded 2B Tony Abreu to Arizona Diamondbacks.\" with no return.","incoming":{"bref_id":"garlajo01","mlb_id":"279782","name":"Jon Garland"},"incoming_role_note":"Acquired 2009-08-31 for a player to be named later (Tony Abreu).","incoming_source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=279782","initiated":"2009-08-31","original_date":"2009-10-09","original_description":"Los Angeles Dodgers traded 2B Tony Abreu to Arizona Diamondbacks.","original_ptbnl_role_note":"DISI tracked international signing.","ptbnl":{"mlb_id":"473234","name":"Tony Abreu"},"ptbnl_role_note":"DISI tracked international signing. Named as the player to be named later and delivered 2009-10-09 to complete the trade."},"abreu_asset_count":1,"abreu_event":"LAD_ARI_2009_TONY_ABREU","events":[{"assets":[{"bref_id":"millebo04","counterparty":"MIN","mlb_id":"119112","name":"Bob Miller","role_note":"","side":"OUTGOING"},{"bref_id":"rosebjo01","counterparty":"MIN","mlb_id":"121456","name":"John Roseboro","role_note":"","side":"OUTGOING"},{"bref_id":"perraro01","counterparty":"MIN","mlb_id":"120430","name":"Ron Perranoski","role_note":"","side":"OUTGOING"},{"bref_id":"grantmu01","counterparty":"MIN","mlb_id":"115046","name":"Mudcat Grant","role_note":"","side":"INCOMING"},{"bref_id":"versazo01","counterparty":"MIN","mlb_id":"123713","name":"Zoilo Versalles","role_note":"","side":"INCOMING"}],"date":"1967-11-28","description":"Traded Bob Miller, John Roseboro and Ron Perranoski to the Minnesota Twins. Received Mudcat Grant and Zoilo Versalles. Retrosheet transaction 60573 (1967-11-28); the same package is described in the SABR biographies of Versalles, Grant and Perranoski (the Versalles biography dates it November 27, Retrosheet and the Perranoski biography November 28).","from":"LAD","historical_label":"","key":"LAD_MIN_1967_BOB_MILLER","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"MIN","type":"TRADE"},{"assets":[{"bref_id":"garlajo01","counterparty":"","mlb_id":"279782","name":"Jon Garland","role_note":"","side":"OUTGOING"}],"date":"2009-11-05","description":"Jon Garland elected free agency (MLB transaction log, 2009-11-05; Retrosheet transaction 18248).","from":"LAD","historical_label":"Granted free agency","key":"LAD_FREE_AGENCY_2009_JON_GARLAND","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=279782","to":"","type":"FREE_AGENCY"},{"assets":[{"bref_id":"grantmu01","counterparty":"WSH","mlb_id":"115046","name":"Mudcat Grant","role_note":"","side":"OUTGOING"}],"date":"1968-10-14","description":"Mudcat Grant was selected from the Dodgers by the Montreal Expos as pick 36 of the 1968 expansion draft. Retrosheet transaction 19808; the SABR biography of Mudcat Grant gives the same selection.","from":"LAD","historical_label":"1968 expansion draft (Montreal Expos), pick 36","key":"LAD_MON_1968_GRANT_EXPANSION","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"WSH","type":"EXPANSION_DRAFT"},{"assets":[{"bref_id":"versazo01","counterparty":"SD","mlb_id":"123713","name":"Zoilo Versalles","role_note":"","side":"OUTGOING"}],"date":"1968-10-14","description":"Zoilo Versalles was selected from the Dodgers by the San Diego Padres as pick 20 of the 1968 expansion draft. Retrosheet transaction 54511; the SABR biography of Zoilo Versalles gives the same selection.","from":"LAD","historical_label":"1968 expansion draft (San Diego Padres), pick 20","key":"LAD_SD_1968_VERSALLES_EXPANSION","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SD","type":"EXPANSION_DRAFT"}],"exits":[{"acquired_in_event":"LAD_NYM_1962_TIM_HARKNESS","exit_event_key":"LAD_MIN_1967_BOB_MILLER","mlb_id":"119112"},{"acquired_in_event":"LAD_ARI_2009_TONY_ABREU","exit_event_key":"LAD_FREE_AGENCY_2009_JON_GARLAND","mlb_id":"279782"},{"acquired_in_event":"LAD_MIN_1967_BOB_MILLER","exit_event_key":"LAD_MON_1968_GRANT_EXPANSION","mlb_id":"115046"},{"acquired_in_event":"LAD_MIN_1967_BOB_MILLER","exit_event_key":"LAD_SD_1968_VERSALLES_EXPANSION","mlb_id":"123713"}],"identities":[{"asset":"Apostol Garcia","event":"LAD_DET_1999_DAVE_MLICKI","mlb_id":"472796"},{"asset":"Rick Roberts","event":"LAD_DET_1999_DAVE_MLICKI","mlb_id":"425540"},{"asset":"Danny Muegge","event":"LAD_ARI_2005_SHAWN_GREEN","mlb_id":"458260"},{"asset":"William Juárez","event":"LAD_ARI_2005_SHAWN_GREEN","mlb_id":"452705"}],"retrieved_at":"2026-10-21T21:30:00Z","sources":[{"notes":"Official MLB transaction log for Jon Garland (MLBAM 279782): the 2009-08-31 trade from Arizona and the 2009-11-05 election of free agency.","source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_TRANSACTION_LOG","title":"MLB Stats API: transaction log (Jon Garland)","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=279782"},{"notes":"Open identifier crosswalk (Retrosheet, MLBAM, Baseball-Reference). Used for identity only, always together with an exact birth-date match against Retrosheet BIOFILE and the MLB person record; never as evidence of a transaction.","source_name":"Chadwick Bureau Register","source_tier":"OTHER","source_type":"IDENTITY_CROSSWALK","title":"Chadwick Bureau Register (people-*.csv)","url":"https://github.com/chadwickbureau/register"},{"notes":"Read as a second account of the 1967 Dodgers-Twins package and the 1968 expansion draft. Not a transaction record.","source_name":"SABR Baseball Biography Project","source_tier":"OTHER","source_type":"BIOGRAPHY","title":"SABR biography: zoilo-versalles","url":"https://sabr.org/bioproj/person/zoilo-versalles/"},{"notes":"Read as a second account of the 1967 Dodgers-Twins package and the 1968 expansion draft. Not a transaction record.","source_name":"SABR Baseball Biography Project","source_tier":"OTHER","source_type":"BIOGRAPHY","title":"SABR biography: mudcat-grant","url":"https://sabr.org/bioproj/person/mudcat-grant/"},{"notes":"Read as a second account of the 1967 Dodgers-Twins package and the 1968 expansion draft. Not a transaction record.","source_name":"SABR Baseball Biography Project","source_tier":"OTHER","source_type":"BIOGRAPHY","title":"SABR biography: ron-perranoski","url":"https://sabr.org/bioproj/person/ron-perranoski/"}],"sources_urls":{"retrosheet":"https://www.retrosheet.org/transactions/tranDB.zip"},"trade":{"acquired_in_event":"LAD_NYM_1962_TIM_HARKNESS","event_key":"LAD_MIN_1967_BOB_MILLER"}}$m049$::jsonb as j;

create temporary table _m049_before on commit drop as
select
  (select count(*) from public.transaction_events) as events,
  (select count(*) from public.transaction_event_assets) as assets,
  (select count(*) from public.transaction_asset_resolutions) as resolutions,
  (select count(*) from public.player_mlb_team_season_war) as war_rows,
  (select md5(string_agg(t::text, '|' order by t.id::text)) from (
     select e.id, e::text from public.transaction_events e union all select a.id, a::text from public.transaction_event_assets a
     union all select r.id, r::text from public.transaction_asset_resolutions r) t(id, t)) as transactions_hash,
  (select md5(string_agg(a::text, '|' order by a.id::text)) from public.transaction_event_assets a where a.asset_type in ('CASH', 'INTERNATIONAL_BONUS_POOL_SPACE', 'FUTURE_CONSIDERATIONS')) as consideration_hash,
  (select md5(string_agg(e::text, '|' order by e.event_key)) from public.transaction_events e
    where e.event_key <> j ->> 'abreu_event' and e.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y)) as other_events_hash,
  (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) as war_hash
from _m049;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 049 was written for
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
  k text;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null
     or to_regclass('public.v_transaction_package_lineage') is null or to_regclass('public.transaction_asset_resolutions') is null then
    raise exception '049: Migration 045b has not been applied';
  end if;
  if (select count(*) from public.development_milestones) < 1073 then
    raise exception '049: Migration 048 has not been applied';
  end if;
  for k in select unnest(array['LAD', 'MIN', 'ARI', 'WSH', 'SD']) loop
    if not exists (select 1 from public.organizations where abbreviation = k) then
      raise exception '049: the organization % is missing', k;
    end if;
  end loop;
  -- the Abreu event: either exactly as DISI stored it (a first run) or exactly as 049 writes it (a rerun)
  select count(*) into n from public.transaction_events e
    where e.event_key = (select j ->> 'abreu_event' from _m049) and e.transaction_type = 'TRADE'
      and e.transaction_date in ((select (j #>> '{abreu,original_date}')::date from _m049), (select (j #>> '{abreu,initiated}')::date from _m049));
  if n <> 1 then
    raise exception '049: the Abreu trade is not in the state the research was written for';
  end if;
  select count(*) into n from public.transaction_events e
    join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = 'OUTGOING' and a.asset_type = 'PLAYER' and a.mlb_id = (select j #>> '{abreu,ptbnl,mlb_id}' from _m049) and a.player_id is not null
    where e.event_key = (select j ->> 'abreu_event' from _m049);
  if n <> 1 then
    raise exception '049: the tracked Abreu asset is missing from his trade';
  end if;
  -- no return other than the reviewed one may already be recorded for the Abreu trade
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
    where e.event_key = (select j ->> 'abreu_event' from _m049) and a.asset_side = 'INCOMING' and a.mlb_id is distinct from (select j #>> '{abreu,incoming,mlb_id}' from _m049);
  if n > 0 then
    raise exception '049: the Abreu trade already records a different return; the research no longer applies';
  end if;
  -- Miller was acquired in the 1962 trade and no Dodgers exit is recorded for him other than the reviewed one
  select count(*) into n from public.transaction_events ev
    join public.transaction_event_assets a on a.event_id = ev.id and a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER'
    where ev.event_key = (select j #>> '{trade,acquired_in_event}' from _m049) and a.mlb_id = '119112' and a.bref_id = 'millebo04';
  if n <> 1 then
    raise exception '049: the acquisition of Bob Miller is not recorded with this identity';
  end if;
  select count(*) into n from public.transaction_events ev
    join public.transaction_event_assets a on a.event_id = ev.id and a.asset_side = 'OUTGOING' and a.mlb_id = '119112'
    where ev.event_key <> (select j #>> '{trade,event_key}' from _m049) and ev.transaction_date > '1962-11-30';
  if n > 0 then
    raise exception '049: a later Dodgers exit is already recorded for Bob Miller; the research no longer applies';
  end if;
  -- the four named-only assets exist, still unidentified (or already carrying exactly the reviewed id)
  for p in select x from _m049, jsonb_array_elements(j -> 'identities') x loop
    select count(*) into n from public.transaction_events ev
      join public.transaction_event_assets a on a.event_id = ev.id and a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER' and a.asset_name = p ->> 'asset'
      where ev.event_key = p ->> 'event' and (a.mlb_id is null or a.mlb_id = p ->> 'mlb_id');
    if n <> 1 then
      raise exception '049: the asset % in % is not in the state the identity research was written for', p ->> 'asset', p ->> 'event';
    end if;
  end loop;
  -- Garland, Grant and Versalles may not already be recorded elsewhere under different keys
  select count(*) into n from public.transaction_event_assets a join public.transaction_events ev on ev.id = a.event_id
    where a.mlb_id in ('279782', '115046', '123713') and ev.event_key not in (select x ->> 'key' from _m049, jsonb_array_elements(j -> 'events') x)
      and ev.event_key <> (select j ->> 'abreu_event' from _m049);
  if n > 0 then
    raise exception '049: Garland, Grant or Versalles is already recorded in another transaction';
  end if;
end $$;

-- ===========================================================================
-- 2. SOURCES (what was read; the evidence rows themselves are cited in each description)
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (j ->> 'retrieved_at')::timestamptz
from _m049, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 3. THE ABREU / GARLAND CORRECTION (forward-only; the old date is kept as the completion date)
-- ===========================================================================

update public.transaction_events e
set transaction_date = (j #>> '{abreu,initiated}')::date, description = j #>> '{abreu,description}'
from _m049
where e.event_key = j ->> 'abreu_event' and (e.transaction_date <> (j #>> '{abreu,initiated}')::date or e.description is distinct from j #>> '{abreu,description}');

update public.transaction_event_assets a
set role_note = j #>> '{abreu,ptbnl_role_note}'
from _m049, public.transaction_events e
where e.event_key = j ->> 'abreu_event' and a.event_id = e.id and a.asset_side = 'OUTGOING' and a.mlb_id = j #>> '{abreu,ptbnl,mlb_id}'
  and a.role_note is distinct from j #>> '{abreu,ptbnl_role_note}';

-- the return: Jon Garland, with the identity the Register crosswalk and an exact birth-date match established
insert into public.transaction_event_assets (event_id, asset_side, player_id, asset_name, asset_type, role_note, source_id, bref_id, mlb_id, bref_register_id,
  counterparty_organization_id, cash_amount_usd, pool_space_amount_usd)
select e.id, 'INCOMING', null, j #>> '{abreu,incoming,name}', 'PLAYER', j #>> '{abreu,incoming_role_note}', so.id, j #>> '{abreu,incoming,bref_id}', j #>> '{abreu,incoming,mlb_id}', null,
  (select o.id from public.organizations o where o.abbreviation = 'ARI'), null, null
from _m049
join public.transaction_events e on e.event_key = j ->> 'abreu_event'
join public.sources so on so.url = j #>> '{abreu,incoming_source_url}'
on conflict (event_id, asset_side, asset_name) do nothing;

-- ===========================================================================
-- 4. NEW TRANSACTIONS (a recorded trade does not wait for its value)
-- ===========================================================================

insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description, source_id,
  is_multi_team, historical_label)
select x ->> 'key', (x ->> 'date')::date, x ->> 'type', fo.id, too.id, x ->> 'description', so.id, false, nullif(x ->> 'historical_label', '')
from _m049 cross join jsonb_array_elements(j -> 'events') x
join public.organizations fo on fo.abbreviation = x ->> 'from'
left join public.organizations too on too.abbreviation = nullif(x ->> 'to', '')
join public.sources so on so.url = x ->> 'source_url'
on conflict (event_key) do nothing;

insert into public.transaction_event_assets (event_id, asset_side, player_id, asset_name, asset_type, role_note, source_id, bref_id, mlb_id, bref_register_id,
  counterparty_organization_id, cash_amount_usd, pool_space_amount_usd)
select e.id, a ->> 'side', null, a ->> 'name', 'PLAYER', nullif(a ->> 'role_note', ''), so.id, a ->> 'bref_id', a ->> 'mlb_id', null,
  (select o.id from public.organizations o where o.abbreviation = nullif(a ->> 'counterparty', '')), null, null
from _m049 cross join jsonb_array_elements(j -> 'events') x cross join jsonb_array_elements(x -> 'assets') a
join public.transaction_events e on e.event_key = x ->> 'key'
join public.sources so on so.url = x ->> 'source_url'
on conflict (event_id, asset_side, asset_name) do nothing;

-- ===========================================================================
-- 5. IDENTITIES for assets recorded by name only (an identifier, never a new fact about the trade)
-- ===========================================================================

update public.transaction_event_assets a
set mlb_id = x ->> 'mlb_id'
from _m049, jsonb_array_elements(j -> 'identities') x, public.transaction_events e
where e.event_key = x ->> 'event' and a.event_id = e.id and a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER' and a.asset_name = x ->> 'asset' and a.mlb_id is null;

-- A recorded exit supersedes a sealed "exit bounded before DATE" observation that stood in for it (034 chronology). The observation is RETRACTED with a
-- reason, never deleted. (None exists for these assets today; the statement keeps the rule if one is ever added before this runs.)
update public.transaction_asset_timing_observations o
set record_status = 'RETRACTED', retracted_at = now(),
    retraction_reason = 'Superseded by Migration 049: the exit is now recorded.'
from public.transaction_event_assets a
where o.record_status = 'ACTIVE' and o.fact_type = 'EXIT_BOUNDED_BEFORE' and a.id = o.subject_asset_id and a.asset_side = 'INCOMING'
  and a.mlb_id in ('119112', '279782', '115046', '123713');

-- ===========================================================================
-- 6. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  rec jsonb;
  n int;
  b record;
begin
  select * into b from _m049_before;
  -- the Abreu trade: initiated 2009-08-31, Garland incoming, Abreu the only outgoing asset (named and delivered 2009-10-09), nothing lost
  select count(*) into n from public.transaction_events e
    join public.transaction_event_assets g on g.event_id = e.id and g.asset_side = 'INCOMING' and g.asset_type = 'PLAYER' and g.mlb_id = (select j #>> '{abreu,incoming,mlb_id}' from _m049)
    join public.transaction_event_assets ab on ab.event_id = e.id and ab.asset_side = 'OUTGOING' and ab.asset_type = 'PLAYER' and ab.mlb_id = (select j #>> '{abreu,ptbnl,mlb_id}' from _m049)
      and ab.player_id is not null and ab.role_note = (select j #>> '{abreu,ptbnl_role_note}' from _m049)
    where e.event_key = (select j ->> 'abreu_event' from _m049) and e.transaction_date = (select (j #>> '{abreu,initiated}')::date from _m049)
      and e.description like '%' || (select j #>> '{abreu,completed}' from _m049) || '%'
      and (select count(*) from public.transaction_event_assets x where x.event_id = e.id and x.asset_side = 'OUTGOING') = 1;
  if n <> 1 then
    raise exception '049 postcondition: the Abreu trade is not recorded as Garland for Abreu, the only outgoing asset';
  end if;
  -- every new event exists once with the reviewed date and type; every exit closes the interval it concerns
  for rec in select y from _m049, jsonb_array_elements(j -> 'events') y loop
    select count(*) into n from public.transaction_events e
      where e.event_key = rec ->> 'key' and e.transaction_date = (rec ->> 'date')::date and e.transaction_type = rec ->> 'type'
        and (select count(*) from public.transaction_event_assets a where a.event_id = e.id) = jsonb_array_length(rec -> 'assets');
    if n <> 1 then
      raise exception '049 postcondition: the event % is not recorded exactly as reviewed', rec ->> 'key';
    end if;
  end loop;
  for rec in select y from _m049, jsonb_array_elements(j -> 'exits') y loop
    select count(*) into n from public.v_transaction_package_lineage l
      where l.mlb_id = rec ->> 'mlb_id' and l.acquisition_event_key = rec ->> 'acquired_in_event' and l.exit_event_key = rec ->> 'exit_event_key';
    if n < 1 then
      raise exception '049 postcondition: the exit % does not close the interval acquired in %', rec ->> 'exit_event_key', rec ->> 'acquired_in_event';
    end if;
  end loop;
  -- identities were added, never changed
  select count(*) into n from _m049, jsonb_array_elements(j -> 'identities') x
    where not exists (select 1 from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id
                      where e.event_key = x ->> 'event' and a.asset_name = x ->> 'asset' and a.asset_side = 'INCOMING' and a.mlb_id = x ->> 'mlb_id');
  if n > 0 then
    raise exception '049 postcondition: % identities are missing', n;
  end if;
  -- nothing was invented: no cash, pool-space or future-consideration row moved, no other event changed, no WAR row was added or changed,
  -- no value was loaded, and no more than the reviewed rows were added
  if b.consideration_hash is distinct from (select md5(string_agg(a::text, '|' order by a.id::text)) from public.transaction_event_assets a where a.asset_type in ('CASH', 'INTERNATIONAL_BONUS_POOL_SPACE', 'FUTURE_CONSIDERATIONS')) then
    raise exception '049 postcondition: a cash, pool-space or future-consideration row changed';
  end if;
  if b.other_events_hash is distinct from (select md5(string_agg(e::text, '|' order by e.event_key)) from public.transaction_events e
      where e.event_key <> (select j ->> 'abreu_event' from _m049) and e.event_key not in (select y ->> 'key' from _m049, jsonb_array_elements(j -> 'events') y)) then
    raise exception '049 postcondition: an event outside the reviewed set changed';
  end if;
  if b.war_hash is distinct from (select md5(string_agg(w::text, '|' order by w.id::text)) from public.player_mlb_team_season_war w) then
    raise exception '049 postcondition: a WAR row was added, removed or changed; 049 loads no Baseball-Reference WAR';
  end if;
  select (select count(*) from public.transaction_events) - b.events into n;
  if n > (select jsonb_array_length(j -> 'events') from _m049) then
    raise exception '049 postcondition: % events were added, at most % were reviewed', n, (select jsonb_array_length(j -> 'events') from _m049);
  end if;
  select (select count(*) from public.transaction_event_assets) - b.assets into n;
  if n > (select (j ->> 'abreu_asset_count')::int + (select coalesce(sum(jsonb_array_length(y -> 'assets')), 0) from jsonb_array_elements(j -> 'events') y) from _m049) then
    raise exception '049 postcondition: % assets were added, more than were reviewed', n;
  end if;
  select (select count(*) from public.transaction_asset_resolutions) - b.resolutions into n;
  if n <> 0 then
    raise exception '049 postcondition: % resolutions were added; 049 adds none', n;
  end if;
end $$;

-- ===========================================================================
-- 7. GENERATION: one coherent refresh, only when this run added or changed a transaction row
-- ===========================================================================

do $$
declare
  b record;
begin
  select * into b from _m049_before;
  if b.transactions_hash is distinct from (select md5(string_agg(t::text, '|' order by t.id::text)) from (
       select e.id, e::text from public.transaction_events e union all select a.id, a::text from public.transaction_event_assets a
       union all select r.id, r::text from public.transaction_asset_resolutions r) t(id, t)) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

commit;
