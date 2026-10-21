-- DISI 049: logical rollback of the transaction-package batch (WRITE; run only with explicit owner approval, after a failed post-release verification).
--
-- Built from database/research/049/ (transaction-evidence.json); regenerate with: node database/research/049/build.mjs
--
-- 049 inserted four transaction events (the 1967 Dodgers-Twins trade, Jon Garland's free agency and the 1968 expansion-draft selections of
-- Mudcat Grant and Zoilo Versalles) with their assets, re-dated and re-described the 2009 Tony Abreu trade, added Jon Garland as its return, and added
-- four MLB identifiers. None of those tables is sealed and 049 added no resolution, so this file DELETES the events and assets, restores the Abreu event's
-- stored date, description and asset note, and clears the four identifiers: the three transaction tables return to their exact pre-049 content. The source
-- rows (what was read) stay as provenance.
--
-- It is guarded: it refuses to run unless the four events are present and the Abreu trade is in the state 049 wrote, unless nothing depends on the
-- assets being removed (no control observation, timing observation or resolution), and unless no later transaction was recorded for the players involved.
-- One transaction. Unlike 046, nothing is retracted instead of deleted, so Migration 049 CAN be re-applied after this rollback.

begin;

create temporary table _r049 on commit drop as
select $r049${"abreu":{"completed":"2009-10-09","description":"Arizona Diamondbacks sent RHP Jon Garland to the Los Angeles Dodgers on 2009-08-31 for a player to be named later. The Dodgers named 2B Tony Abreu and delivered him to Arizona on 2009-10-09 to complete the trade (MLB transaction log; Retrosheet transaction 64131). Before Migration 049 DISI recorded only the completion date, 2009-10-09, as \"Los Angeles Dodgers traded 2B Tony Abreu to Arizona Diamondbacks.\" with no return.","incoming":{"bref_id":"garlajo01","mlb_id":"279782","name":"Jon Garland"},"incoming_role_note":"Acquired 2009-08-31 for a player to be named later (Tony Abreu).","incoming_source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=279782","initiated":"2009-08-31","original_date":"2009-10-09","original_description":"Los Angeles Dodgers traded 2B Tony Abreu to Arizona Diamondbacks.","original_ptbnl_role_note":"DISI tracked international signing.","ptbnl":{"mlb_id":"473234","name":"Tony Abreu"},"ptbnl_role_note":"DISI tracked international signing. Named as the player to be named later and delivered 2009-10-09 to complete the trade."},"abreu_asset_count":1,"abreu_event":"LAD_ARI_2009_TONY_ABREU","events":[{"assets":[{"bref_id":"millebo04","counterparty":"MIN","mlb_id":"119112","name":"Bob Miller","role_note":"","side":"OUTGOING"},{"bref_id":"rosebjo01","counterparty":"MIN","mlb_id":"121456","name":"John Roseboro","role_note":"","side":"OUTGOING"},{"bref_id":"perraro01","counterparty":"MIN","mlb_id":"120430","name":"Ron Perranoski","role_note":"","side":"OUTGOING"},{"bref_id":"grantmu01","counterparty":"MIN","mlb_id":"115046","name":"Mudcat Grant","role_note":"","side":"INCOMING"},{"bref_id":"versazo01","counterparty":"MIN","mlb_id":"123713","name":"Zoilo Versalles","role_note":"","side":"INCOMING"}],"date":"1967-11-28","description":"Traded Bob Miller, John Roseboro and Ron Perranoski to the Minnesota Twins. Received Mudcat Grant and Zoilo Versalles. Retrosheet transaction 60573 (1967-11-28); the same package is described in the SABR biographies of Versalles, Grant and Perranoski (the Versalles biography dates it November 27, Retrosheet and the Perranoski biography November 28).","from":"LAD","historical_label":"","key":"LAD_MIN_1967_BOB_MILLER","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"MIN","type":"TRADE"},{"assets":[{"bref_id":"garlajo01","counterparty":"","mlb_id":"279782","name":"Jon Garland","role_note":"","side":"OUTGOING"}],"date":"2009-11-05","description":"Jon Garland elected free agency (MLB transaction log, 2009-11-05; Retrosheet transaction 18248).","from":"LAD","historical_label":"Granted free agency","key":"LAD_FREE_AGENCY_2009_JON_GARLAND","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=279782","to":"","type":"FREE_AGENCY"},{"assets":[{"bref_id":"grantmu01","counterparty":"WSH","mlb_id":"115046","name":"Mudcat Grant","role_note":"","side":"OUTGOING"}],"date":"1968-10-14","description":"Mudcat Grant was selected from the Dodgers by the Montreal Expos as pick 36 of the 1968 expansion draft. Retrosheet transaction 19808; the SABR biography of Mudcat Grant gives the same selection.","from":"LAD","historical_label":"1968 expansion draft (Montreal Expos), pick 36","key":"LAD_MON_1968_GRANT_EXPANSION","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"WSH","type":"EXPANSION_DRAFT"},{"assets":[{"bref_id":"versazo01","counterparty":"SD","mlb_id":"123713","name":"Zoilo Versalles","role_note":"","side":"OUTGOING"}],"date":"1968-10-14","description":"Zoilo Versalles was selected from the Dodgers by the San Diego Padres as pick 20 of the 1968 expansion draft. Retrosheet transaction 54511; the SABR biography of Zoilo Versalles gives the same selection.","from":"LAD","historical_label":"1968 expansion draft (San Diego Padres), pick 20","key":"LAD_SD_1968_VERSALLES_EXPANSION","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SD","type":"EXPANSION_DRAFT"}],"exits":[{"acquired_in_event":"LAD_NYM_1962_TIM_HARKNESS","exit_event_key":"LAD_MIN_1967_BOB_MILLER","mlb_id":"119112"},{"acquired_in_event":"LAD_ARI_2009_TONY_ABREU","exit_event_key":"LAD_FREE_AGENCY_2009_JON_GARLAND","mlb_id":"279782"},{"acquired_in_event":"LAD_MIN_1967_BOB_MILLER","exit_event_key":"LAD_MON_1968_GRANT_EXPANSION","mlb_id":"115046"},{"acquired_in_event":"LAD_MIN_1967_BOB_MILLER","exit_event_key":"LAD_SD_1968_VERSALLES_EXPANSION","mlb_id":"123713"}],"identities":[{"asset":"Apostol Garcia","event":"LAD_DET_1999_DAVE_MLICKI","mlb_id":"472796"},{"asset":"Rick Roberts","event":"LAD_DET_1999_DAVE_MLICKI","mlb_id":"425540"},{"asset":"Danny Muegge","event":"LAD_ARI_2005_SHAWN_GREEN","mlb_id":"458260"},{"asset":"William Juárez","event":"LAD_ARI_2005_SHAWN_GREEN","mlb_id":"452705"}],"retrieved_at":"2026-10-21T21:30:00Z","sources":[{"notes":"Official MLB transaction log for Jon Garland (MLBAM 279782): the 2009-08-31 trade from Arizona and the 2009-11-05 election of free agency.","source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_TRANSACTION_LOG","title":"MLB Stats API: transaction log (Jon Garland)","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=279782"},{"notes":"Open identifier crosswalk (Retrosheet, MLBAM, Baseball-Reference). Used for identity only, always together with an exact birth-date match against Retrosheet BIOFILE and the MLB person record; never as evidence of a transaction.","source_name":"Chadwick Bureau Register","source_tier":"OTHER","source_type":"IDENTITY_CROSSWALK","title":"Chadwick Bureau Register (people-*.csv)","url":"https://github.com/chadwickbureau/register"},{"notes":"Read as a second account of the 1967 Dodgers-Twins package and the 1968 expansion draft. Not a transaction record.","source_name":"SABR Baseball Biography Project","source_tier":"OTHER","source_type":"BIOGRAPHY","title":"SABR biography: zoilo-versalles","url":"https://sabr.org/bioproj/person/zoilo-versalles/"},{"notes":"Read as a second account of the 1967 Dodgers-Twins package and the 1968 expansion draft. Not a transaction record.","source_name":"SABR Baseball Biography Project","source_tier":"OTHER","source_type":"BIOGRAPHY","title":"SABR biography: mudcat-grant","url":"https://sabr.org/bioproj/person/mudcat-grant/"},{"notes":"Read as a second account of the 1967 Dodgers-Twins package and the 1968 expansion draft. Not a transaction record.","source_name":"SABR Baseball Biography Project","source_tier":"OTHER","source_type":"BIOGRAPHY","title":"SABR biography: ron-perranoski","url":"https://sabr.org/bioproj/person/ron-perranoski/"}],"sources_urls":{"retrosheet":"https://www.retrosheet.org/transactions/tranDB.zip"},"trade":{"acquired_in_event":"LAD_NYM_1962_TIM_HARKNESS","event_key":"LAD_MIN_1967_BOB_MILLER"}}$r049$::jsonb as j;

do $$
declare
  rec jsonb;
  n int;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception 'rollback-049: this is not a 045b database';
  end if;
  for rec in select y from _r049, jsonb_array_elements(j -> 'events') y loop
    select count(*) into n from public.transaction_events e where e.event_key = rec ->> 'key';
    if n <> 1 then
      raise exception 'rollback-049: the event % is not present; this database is not in the post-049 state', rec ->> 'key';
    end if;
    -- nothing may depend on the assets being removed
    select count(*) into n from public.transaction_events e join public.transaction_event_assets a on a.event_id = e.id
      where e.event_key = rec ->> 'key'
        and (exists (select 1 from public.dodgers_control_observations o where o.subject_asset_id = a.id)
          or exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id or r.resolved_asset_id = a.id)
          or exists (select 1 from public.transaction_asset_timing_observations t where t.subject_asset_id = a.id));
    if n > 0 then
      raise exception 'rollback-049: later research depends on the event %', rec ->> 'key';
    end if;
  end loop;
  -- the Abreu trade is in the state 049 wrote
  select count(*) into n from public.transaction_events e, _r049
    where e.event_key = j ->> 'abreu_event' and e.transaction_date = (j #>> '{abreu,initiated}')::date and e.description = j #>> '{abreu,description}';
  if n <> 1 then
    raise exception 'rollback-049: the Abreu trade is not in the post-049 state';
  end if;
  -- Garland (as the Abreu return) has no dependent observation
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _r049
    where e.event_key = j ->> 'abreu_event' and a.mlb_id = j #>> '{abreu,incoming,mlb_id}'
      and (exists (select 1 from public.dodgers_control_observations o where o.subject_asset_id = a.id)
        or exists (select 1 from public.transaction_asset_timing_observations t where t.subject_asset_id = a.id)
        or exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id or r.resolved_asset_id = a.id));
  if n > 0 then
    raise exception 'rollback-049: later research depends on the Garland asset';
  end if;
  -- no later transaction was recorded for the players involved
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _r049
    where a.mlb_id in ('279782', '115046', '123713') and e.event_key <> j ->> 'abreu_event'
      and e.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y);
  if n > 0 then
    raise exception 'rollback-049: a later transaction was recorded for Garland, Grant or Versalles';
  end if;
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _r049
    where a.mlb_id = '119112' and a.asset_side = 'OUTGOING' and e.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y);
  if n > 0 then
    raise exception 'rollback-049: a later transaction was recorded for Bob Miller';
  end if;
end $$;

-- 1. Garland leaves the Abreu trade, and the trade returns to the date, description and note DISI stored before 049
delete from public.transaction_event_assets a using _r049, public.transaction_events e
where e.event_key = j ->> 'abreu_event' and a.event_id = e.id and a.asset_side = 'INCOMING' and a.mlb_id = j #>> '{abreu,incoming,mlb_id}';

update public.transaction_events e
set transaction_date = (j #>> '{abreu,original_date}')::date, description = j #>> '{abreu,original_description}'
from _r049 where e.event_key = j ->> 'abreu_event';

update public.transaction_event_assets a
set role_note = j #>> '{abreu,original_ptbnl_role_note}'
from _r049, public.transaction_events e
where e.event_key = j ->> 'abreu_event' and a.event_id = e.id and a.asset_side = 'OUTGOING' and a.asset_type = 'PLAYER' and a.mlb_id = j #>> '{abreu,ptbnl,mlb_id}';

-- 2. the four events and their assets
delete from public.transaction_event_assets a using public.transaction_events e, _r049, jsonb_array_elements(j -> 'events') x
where a.event_id = e.id and e.event_key = x ->> 'key';
delete from public.transaction_events e using _r049, jsonb_array_elements(j -> 'events') x where e.event_key = x ->> 'key';

-- 3. the four identifiers (only where they are exactly the reviewed ones)
update public.transaction_event_assets a
set mlb_id = null
from _r049, jsonb_array_elements(j -> 'identities') x, public.transaction_events e
where e.event_key = x ->> 'event' and a.event_id = e.id and a.asset_side = 'INCOMING' and a.asset_name = x ->> 'asset' and a.mlb_id = x ->> 'mlb_id';

-- 4. postconditions
do $$
declare
  n int;
begin
  select count(*) into n from public.transaction_events e, _r049, jsonb_array_elements(j -> 'events') x where e.event_key = x ->> 'key';
  if n <> 0 then
    raise exception 'rollback-049 postcondition: % reviewed events remain', n;
  end if;
  select count(*) into n from public.transaction_events e, _r049
    where e.event_key = j ->> 'abreu_event' and e.transaction_date = (j #>> '{abreu,original_date}')::date and e.description = j #>> '{abreu,original_description}';
  if n <> 1 then
    raise exception 'rollback-049 postcondition: the Abreu trade is not back to its stored date and description';
  end if;
  select count(*) into n from public.transaction_event_assets a, _r049 where a.mlb_id in (j #>> '{abreu,incoming,mlb_id}', '115046', '123713');
  if n <> 0 then
    raise exception 'rollback-049 postcondition: % Garland, Grant or Versalles assets remain', n;
  end if;
  select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id, _r049, jsonb_array_elements(j -> 'identities') x
    where e.event_key = x ->> 'event' and a.asset_name = x ->> 'asset' and a.mlb_id = x ->> 'mlb_id';
  if n <> 0 then
    raise exception 'rollback-049 postcondition: % identifiers remain', n;
  end if;
end $$;

-- 5. one coherent generation without the research
do $$
begin
  perform * from public.disi_refresh_product_snapshots();
end $$;

commit;
