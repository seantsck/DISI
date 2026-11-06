-- DISI rollback of Migration 061 (transaction research closure). WRITE: run only with explicit owner approval.
--
-- Built from database/research/061/ (research-evidence.json, baseline-build.json); regenerate with: node database/research/061/build.mjs
--
-- 061 filled six existing CASH assets, added three assets beside what was recorded (two international bonus pool assets and Margot's second cash
-- component), added the two Garland events with their assets, registered twelve sources and recorded one evidence row per fact and source. None of
-- those tables is sealed and 061 wrote no transaction_asset_resolutions row (the Frias and Perez placeholders are untouched), so this file:
--   * returns the six CASH amounts to NULL (unknown), only where they are exactly the reviewed amounts;
--   * DELETES the three added assets, the two Garland events and their assets, and the 17 evidence rows 061 wrote;
--   * keeps the twelve source rows as provenance (what was read stays on record; a reapply finds them and does not duplicate them);
--   * leaves every other transaction row, source, evidence row, resolution, observation, signing, ledger row, outcome, metric and WAR row as it was.
-- It is guarded: it refuses unless all of 061 is present exactly as written, and unless nothing depends on what is removed (no control observation,
-- timing observation, resolution, return metric or competitive-context row on the added assets or events, and no later transaction recorded for
-- Garland). One transaction. Unlike 060, nothing is retracted, so Migration 061 CAN be reapplied after this rollback and reproduces the same state.
-- Consequence documented in the other direction: while 061 is applied, rollback-049 is unavailable (it refuses when a later transaction exists for
-- Jon Garland); rolling back 061 first restores it.

begin;
set local statement_timeout = '600s';

create temporary table _r061 on commit drop as
select $r061${"baseline":{"assets":410,"cash_unknown":17,"events":223,"evidence":4490,"future_considerations":3,"pool_unknown":1,"ptbn":9,"resolutions":7,"sources":3384},"delta":{"assets":5,"cash_assets":1,"cash_unknown":-6,"events":2,"evidence":17,"pool_assets":2,"pool_unknown":1,"sources":12},"events":[{"asset":{"asset_name":"Jon Garland","asset_type":"PLAYER","bref_id":"garlajo01","mlb_id":"279782","side":"INCOMING"},"description":"Los Angeles Dodgers signed free agent RHP Jon Garland (MLB.com transaction list, 2010-11-26).","event_key":"LAD_FREE_AGENT_SIGNING_2010_JON_GARLAND","historical_label":"Signed as a free agent","id":"garland_signing","source":"garland_mlb","transaction_date":"2010-11-26","transaction_type":"FREE_AGENT_SIGNING"},{"asset":{"asset_name":"Jon Garland","asset_type":"PLAYER","bref_id":"garlajo01","mlb_id":"279782","side":"OUTGOING"},"description":"Jon Garland elected free agency (MLB.com transaction list, 2011-10-30).","event_key":"LAD_FREE_AGENCY_2011_JON_GARLAND","historical_label":"Granted free agency","id":"garland_exit","source":"garland_mlb","transaction_date":"2011-10-30","transaction_type":"FREE_AGENCY"}],"evidence":[{"confidence":"MEDIUM","event_key":"LAD_STL_2019_TONY_CINGRANI","field_name":"cash_amount_usd","kind":"asset","note":"Payroll worksheet line: Cash from St. Louis (Gyorko) -$2,938,710. The Cardinals' club announcement names cash considerations without an amount.","ref":"cingrani_cash","source":"payroll_tbla"},{"confidence":"MEDIUM","event_key":"LAD_ATL_2017_ADRIAN_GONZALEZ","field_name":"cash_amount_usd","kind":"asset","note":"Reported to be $4.5 million per Jon Heyman (FanRag Sports); the article's luxury-tax arithmetic lists Cash to Braves ($4.5 million). A reported figure, not a club announcement.","ref":"braves_cash","source":"kemp_tbla"},{"confidence":"HIGH","event_key":"LAD_BOS_2020_JETER_DOWNS","field_name":"cash_amount_usd","kind":"asset","note":"MLB.com: the $48 million sent by the Red Sox to the Dodgers, prorated over the three years remaining on the deal. One consideration recorded as a single amount; the payment schedule is not modelled.","ref":"betts_cash","source":"betts_mlb"},{"confidence":"HIGH","event_key":"LAD_BOS_2020_JETER_DOWNS","field_name":"cash_amount_usd","kind":"asset","note":"Associated Press: Boston will send Los Angeles $48 million in 18 installments of $2,666,667 from April through September in 2020, 2021 and 2022.","ref":"betts_cash","source":"betts_boston"},{"confidence":"HIGH","event_key":"LAD_CIN_2018_YASIEL_PUIG","field_name":"cash_amount_usd","kind":"asset","note":"MLB.com: the Dodgers sent Kemp, Puig, Wood and Farmer plus $7 million to the Reds.","ref":"puig_cash","source":"puig_mlb"},{"confidence":"MEDIUM","event_key":"LAD_CIN_2018_YASIEL_PUIG","field_name":"cash_amount_usd","kind":"asset","note":"Payroll worksheet line: Cash to Reds (Kemp, etc) $7,000,000.","ref":"puig_cash","source":"payroll_tbla"},{"confidence":"HIGH","event_key":"LAD_MIN_2024_RAYNE_DONCON","field_name":"cash_amount_usd","kind":"asset","note":"Star Tribune: the Twins will receive $6 million to cover part of Margot's salary. This is the guaranteed component only; the option-dependent $2 million is a separate asset.","ref":"margot_cash_guaranteed","source":"margot_startribune"},{"confidence":"HIGH","event_key":"LAD_MIN_2024_RAYNE_DONCON","field_name":"cash_amount_usd","kind":"asset","note":"Associated Press: as part of the trade the Dodgers agreed to pay the Twins $6 million.","ref":"margot_cash_guaranteed","source":"margot_cbs"},{"confidence":"HIGH","event_key":"LAD_TOR_2019_RONNY_BRITO","field_name":"cash_amount_usd","kind":"asset","note":"MLB.com: Toronto agreed to pick up $16.4 million of Martin's $20 million salary to facilitate the deal. Recorded as the CASH consideration of the trade; it is not a Dodgers acquisition cost.","ref":"martin_cash","source":"martin_mlb"},{"confidence":"MEDIUM","event_key":"LAD_TOR_2019_RONNY_BRITO","field_name":"cash_amount_usd","kind":"asset","note":"Payroll worksheet line: Cash from Toronto (Martin) -$16,400,000.","ref":"martin_cash","source":"payroll_tbla"},{"confidence":"MEDIUM","event_key":"LAD_CIN_2025_ARNALDO_LANTIGUA","field_name":"pool_space_amount_usd","kind":"asset","note":"True Blue LA reports that MLB.com's Mark Sheldon reported the Dodgers received $1.5 million in international bonus pool space from Cincinnati.","ref":"lantigua_pool","source":"lantigua_tbla"},{"confidence":"VERIFIED","event_key":"LAD_STL_2019_TONY_CINGRANI","field_name":"pool_space_component","kind":"asset","note":"Club announcement: Jedd Gyorko, 2019/2020 International Cap Space and cash considerations for Tony Cingrani and Jeffry Abreu. The amount of international cap space is not stated.","ref":"cingrani_pool","source":"cardinals_release"},{"confidence":"HIGH","event_key":"LAD_MIN_2024_RAYNE_DONCON","field_name":"cash_amount_usd_additional_option_declined","kind":"asset","note":"Associated Press, 2024-11-01: because the option was declined, Los Angeles will pay Minnesota an additional $2 million on Dec. 1, 2026. Owed under the trade; the payment date is later than the 2026-11-05 capture.","ref":"margot_cash_triggered","source":"margot_cbs"},{"confidence":"VERIFIED","event_key":"LAD_FREE_AGENT_SIGNING_2010_JON_GARLAND","field_name":"transaction_date","kind":"event","note":"MLB.com transaction list: November 26, 2010 Los Angeles Dodgers signed free agent RHP Jon Garland. Contract terms are not recorded: a salary is not trade consideration.","ref":"garland_signing","source":"garland_mlb"},{"confidence":"MEDIUM","event_key":"LAD_FREE_AGENT_SIGNING_2010_JON_GARLAND","field_name":"transaction_date","kind":"event","note":"Baseball Almanac: 11-26-2010 Signed by Los Angeles Dodgers.","ref":"garland_signing","source":"garland_almanac"},{"confidence":"VERIFIED","event_key":"LAD_FREE_AGENCY_2011_JON_GARLAND","field_name":"transaction_date","kind":"event","note":"MLB.com transaction list: October 30, 2011 RHP Jon Garland elected free agency.","ref":"garland_exit","source":"garland_mlb"},{"confidence":"MEDIUM","event_key":"LAD_FREE_AGENCY_2011_JON_GARLAND","field_name":"transaction_date","kind":"event","note":"Baseball Almanac: 10-30-2011 Granted free agency.","ref":"garland_exit","source":"garland_almanac"}],"inserts":[{"amount":"1500000.00","asset_name":"International bonus pool space","asset_type":"INTERNATIONAL_BONUS_POOL_SPACE","counterparty":"Cincinnati Reds","event_key":"LAD_CIN_2025_ARNALDO_LANTIGUA","field_name":"pool_space_amount_usd","id":"lantigua_pool","keeps_asset":"Future considerations","role_note":"Reported $1.5 million of international bonus pool space received from Cincinnati. The event's Future Considerations placeholder is kept as the MLB transaction log recorded it.","side":"INCOMING","source":"lantigua_tbla"},{"amount":null,"asset_name":"International cap space (2019/2020)","asset_type":"INTERNATIONAL_BONUS_POOL_SPACE","counterparty":"St. Louis Cardinals","event_key":"LAD_STL_2019_TONY_CINGRANI","field_name":"pool_space_component","id":"cingrani_pool","keeps_asset":"Future considerations","role_note":"The Cardinals' announcement names 2019/2020 International Cap Space in the trade. It states no amount, so none is recorded: a known component with an unknown amount (unknown, never zero). The Future Considerations placeholder is kept.","side":"INCOMING","source":"cardinals_release"},{"amount":"2000000.00","asset_name":"Cash (additional, Margot 2025 option declined)","asset_type":"CASH","counterparty":"Minnesota Twins","event_key":"LAD_MIN_2024_RAYNE_DONCON","field_name":"cash_amount_usd_additional_option_declined","id":"margot_cash_triggered","keeps_asset":"Cash","role_note":"A second cash component of the trade, separate from the $6,000,000 guaranteed cash: an additional $2,000,000 the Dodgers owe Minnesota because the Twins declined Margot's 2025 option (declined 2024-11-01); the Associated Press reports it is payable 2026-12-01.","side":"OUTGOING","source":"margot_cbs"}],"organization_name":"Los Angeles Dodgers","sources":[{"accessed_at":"2026-11-05T23:10:11Z","key":"lantigua_tbla","notes":"Read directly. Reports that MLB.com's Mark Sheldon reported the Dodgers received $1.5 million in international bonus pool space from Cincinnati (secondary reporting of a reported figure).","publication_date":null,"source_name":"True Blue LA","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers trade outfielder Arnaldo Lantigua to Reds for international bonus pool space","url":"https://www.truebluela.com/2025/1/17/24346370/dodgers-reds-trade-arnaldo-lantigua-international-bonus-pool-roki-sasaki"},{"accessed_at":"2026-11-05T23:10:11Z","key":"kemp_tbla","notes":"Read directly. States the cash amount is unknown but reported to be $4.5 million per Jon Heyman of FanRag Sports, and lists Cash to Braves ($4.5 million) in its luxury-tax arithmetic (a reported figure, not a club announcement).","publication_date":"2017-12-16","source_name":"True Blue LA","source_tier":"OTHER","source_type":"ARTICLE","title":"Dodgers trade Adrian Gonzalez, Scott Kazmir, Brandon McCarthy & Charlie Culberson to Braves for Matt Kemp","url":"https://www.truebluela.com/2017/12/16/16785216/matt-kemp-trade-dodgers-braves-adrian-gonzalez-scott-kazmir-brandon-mccarthy-luxury-tax"},{"accessed_at":"2026-11-05T23:10:11Z","key":"payroll_tbla","notes":"Read directly. A payroll worksheet (the page shows Updated Sep 26, 2019) that lists Cash from Toronto (Martin) -$16,400,000, Cash from St. Louis (Gyorko) -$2,938,710 and Cash to Reds (Kemp, etc) $7,000,000. It is used as corroborating evidence replacing an inaccessible owner-supplied citation.","publication_date":"2019-09-26","source_name":"True Blue LA","source_tier":"OTHER","source_type":"ARTICLE","title":"Los Angeles Dodgers payroll worksheet","url":"https://www.truebluela.com/2017/8/5/16101678/dodgers-payroll-roster-service-time"},{"accessed_at":"2026-11-05T23:10:11Z","key":"betts_boston","notes":"Read directly. Associated Press report (Ronald Blum): Boston will send Los Angeles $2,666,667 on the 15th of each month from April through September in 2020, 2021 and 2022. Corroborating evidence replacing an inaccessible owner-supplied citation.","publication_date":"2020-02-12","source_name":"Boston.com (Associated Press)","source_tier":"OTHER","source_type":"ARTICLE","title":"Red Sox to send Dodgers $48 million in 18 installments over 3 years","url":"https://www.boston.com/sports/boston-red-sox/2020/02/12/red-sox-to-send-dodgers-48-million-in-18-installments-over-3-years/"},{"accessed_at":"2026-11-05T23:11:02Z","key":"betts_mlb","notes":"The live page answered HTTP 403 to a direct request at 2026-11-05T23:10:11Z, so it was read through the Internet Archive snapshot of 2026-10-04T05:25:55Z of this exact URL. States: The $48 million sent by the Red Sox to the Dodgers will count toward Boston's luxury tax payroll, prorated annually over the three years remaining on the deal.","publication_date":"2020-02-11","source_name":"MLB.com","source_tier":"MLB_COM_REPORTING","source_type":"ARTICLE","title":"Mookie Betts traded to Dodgers from Red Sox","url":"https://www.mlb.com/amp/news/mookie-betts-trade-dodgers-red-sox.html"},{"accessed_at":"2026-11-05T23:11:25Z","key":"puig_mlb","notes":"The live page answered HTTP 403 to a direct request at 2026-11-05T23:10:11Z, so it was read through the Internet Archive snapshot of 2025-10-08T15:33:13Z of this exact URL. States the Dodgers sent outfielders Matt Kemp and Yasiel Puig, pitcher Alex Wood, utility man James Farmer plus $7 million to the Reds.","publication_date":null,"source_name":"MLB.com","source_tier":"MLB_COM_REPORTING","source_type":"ARTICLE","title":"Dodgers trade Kemp, Puig, Wood in blockbuster","url":"https://www.mlb.com/news/dodgers-trade-kemp-puig-wood-in-blockbuster-c302142414"},{"accessed_at":"2026-11-05T23:11:18Z","key":"martin_mlb","notes":"The live page answered HTTP 403 to a direct request at 2026-11-05T23:10:11Z, so it was read through the Internet Archive snapshot of 2021-07-28T05:41:00Z of this exact URL. States Toronto agreed to pick up $16.4 million of Martin's $20 million salary to facilitate the deal; DISI records that coverage as the CASH consideration of the trade, not as a Dodgers acquisition cost.","publication_date":null,"source_name":"MLB.com","source_tier":"MLB_COM_REPORTING","source_type":"ARTICLE","title":"Blue Jays trade Russell Martin to Dodgers","url":"https://www.mlb.com/news/blue-jays-trade-russell-martin-to-dodgers-c302623680"},{"accessed_at":"2026-11-05T23:11:35Z","key":"margot_startribune","notes":"The live page answered HTTP 429 to a direct request at 2026-11-05T23:10:11Z, so it was read through the Internet Archive snapshot of 2025-07-23T16:12:32Z of this exact URL. States the Twins will receive $6 million to cover part of Margot's salary.","publication_date":"2024-02-27","source_name":"Star Tribune","source_tier":"OTHER","source_type":"ARTICLE","title":"Twins acquire outfielder Manuel Margot in trade with Dodgers","url":"https://www.startribune.com/twins-trade-for-manuel-margot-los-angeles-dodgers-byron-buxton/600346254"},{"accessed_at":"2026-11-05T23:11:31Z","key":"margot_cbs","notes":"The live page answered HTTP 406 to a direct request at 2026-11-05T23:10:11Z, so it was read through the Internet Archive snapshot of 2025-09-06T21:17:44Z of this exact URL. Associated Press report of 2024-11-01: as part of the trade the Dodgers agreed to pay the Twins $6 million; because the option was declined, Los Angeles will pay Minnesota an additional $2 million on Dec. 1, 2026.","publication_date":"2024-11-01","source_name":"CBS Minnesota (Associated Press)","source_tier":"OTHER","source_type":"ARTICLE","title":"Kyle Farmer and Manuel Margot become free agents after Twins decline options","url":"https://www.cbsnews.com/minnesota/news/kyle-farmer-manuel-margot-free-agents-twins/"},{"accessed_at":"2026-11-05T23:10:59Z","key":"cardinals_release","notes":"The live page answered HTTP 403 to a direct request at 2026-11-05T23:10:11Z, so it was read through the Internet Archive snapshot of 2025-04-30T13:46:26Z of this exact URL. The club announcement names Jedd Gyorko, 2019/2020 International Cap Space and cash considerations; it states no international cap space amount.","publication_date":"2019-07-31","source_name":"MLB.com (St. Louis Cardinals)","source_tier":"OFFICIAL_CLUB_RELEASE","source_type":"PRESS_RELEASE","title":"Cardinals announce trade with Dodgers","url":"https://www.mlb.com/press-release/cardinals-announce-trade-with-dodgers"},{"accessed_at":"2026-11-05T23:11:04Z","key":"garland_mlb","notes":"The live page answered HTTP 403 to a direct request at 2026-11-05T23:10:11Z, so it was read through the Internet Archive snapshot of 2026-06-07T13:45:53Z of this exact URL. Its transaction list reads: November 26, 2010 Los Angeles Dodgers signed free agent RHP Jon Garland; October 30, 2011 RHP Jon Garland elected free agency.","publication_date":null,"source_name":"MLB.com","source_tier":"MLB_TRANSACTION_LOG","source_type":"TRANSACTIONS","title":"Jon Garland Stats, Age, Position, Height, Weight, Fantasy & News","url":"https://www.mlb.com/player/jon-garland-279782"},{"accessed_at":"2026-11-05T23:10:11Z","key":"garland_almanac","notes":"Read directly; secondary corroboration of the MLB.com transaction list: 11-26-2010 Signed by Los Angeles Dodgers; 10-30-2011 Granted free agency. It states no contract terms.","publication_date":null,"source_name":"Baseball Almanac","source_tier":"OTHER","source_type":"TRANSACTIONS","title":"Jon Garland Trades and Transactions by Baseball Almanac","url":"https://www.baseball-almanac.com/players/trades.php?p=garlajo01"}],"updates":[{"amount":"2938710.00","asset_name":"Cash","counterparty":"St. Louis Cardinals","event_key":"LAD_STL_2019_TONY_CINGRANI","field_name":"cash_amount_usd","id":"cingrani_cash","side":"INCOMING"},{"amount":"4500000.00","asset_name":"Cash","counterparty":"Atlanta Braves","event_key":"LAD_ATL_2017_ADRIAN_GONZALEZ","field_name":"cash_amount_usd","id":"braves_cash","side":"OUTGOING"},{"amount":"48000000.00","asset_name":"Cash","counterparty":"Boston Red Sox","event_key":"LAD_BOS_2020_JETER_DOWNS","field_name":"cash_amount_usd","id":"betts_cash","side":"INCOMING"},{"amount":"7000000.00","asset_name":"Cash","counterparty":"Cincinnati Reds","event_key":"LAD_CIN_2018_YASIEL_PUIG","field_name":"cash_amount_usd","id":"puig_cash","side":"OUTGOING"},{"amount":"6000000.00","asset_name":"Cash","counterparty":"Minnesota Twins","event_key":"LAD_MIN_2024_RAYNE_DONCON","field_name":"cash_amount_usd","id":"margot_cash_guaranteed","side":"OUTGOING"},{"amount":"16400000.00","asset_name":"Cash","counterparty":"Toronto Blue Jays","event_key":"LAD_TOR_2019_RONNY_BRITO","field_name":"cash_amount_usd","id":"martin_cash","side":"INCOMING"}]}$r061$::jsonb as j;

create temporary table _r061_src on commit drop as
select x ->> 'key' as key, x ->> 'url' as url from _r061 m, jsonb_array_elements(m.j -> 'sources') x;

create temporary table _r061_upd on commit drop as
select x ->> 'id' as id, x ->> 'event_key' as event_key, x ->> 'side' as side, x ->> 'asset_name' as asset_name, x ->> 'counterparty' as counterparty,
       (x ->> 'amount')::numeric(14,2) as amount
from _r061 m, jsonb_array_elements(m.j -> 'updates') x;

create temporary table _r061_ins on commit drop as
select x ->> 'id' as id, x ->> 'event_key' as event_key, x ->> 'side' as side, x ->> 'asset_type' as asset_type, x ->> 'asset_name' as asset_name,
       x ->> 'counterparty' as counterparty, (x ->> 'amount')::numeric(14,2) as amount, x ->> 'source' as source, x ->> 'role_note' as role_note
from _r061 m, jsonb_array_elements(m.j -> 'inserts') x;

create temporary table _r061_ev on commit drop as
select x ->> 'id' as id, x ->> 'event_key' as event_key, (x ->> 'transaction_date')::date as transaction_date, x ->> 'transaction_type' as transaction_type,
       x #>> '{asset,side}' as a_side, x #>> '{asset,asset_name}' as a_name, x #>> '{asset,mlb_id}' as a_mlb
from _r061 m, jsonb_array_elements(m.j -> 'events') x;

create temporary table _r061_evd on commit drop as
select x ->> 'event_key' as event_key, x ->> 'field_name' as field_name, x ->> 'source' as source, x ->> 'confidence' as confidence, x ->> 'note' as note
from _r061 m, jsonb_array_elements(m.j -> 'evidence') x;

create temporary table _r061_keys on commit drop as
select (select array_agg(distinct k) from (select event_key k from _r061_upd union select event_key from _r061_ins) z) as target_keys,
       (select array_agg(event_key) from _r061_ev) as new_keys,
       (select array_agg(url) from _r061_src) as urls;

-- ===========================================================================
-- 1. GUARDS
-- ===========================================================================

do $$
declare
  m jsonb := (select j from _r061);
  r record;
  n int;
  applied int := 0;
begin
  if to_regprocedure('public.disi_refresh_product_snapshots()') is null or to_regprocedure('public.disi_product_snapshot_drift()') is null then
    raise exception 'rollback-061: this is not a post-060 database';
  end if;
  for r in select * from _r061_upd order by id loop
    select count(*) into n from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
      join public.organizations o on o.id = x.counterparty_organization_id
      where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = 'CASH' and x.asset_name = r.asset_name and o.name = r.counterparty and x.cash_amount_usd = r.amount;
    applied := applied + n;
  end loop;
  for r in select * from _r061_ins order by id loop
    select count(*) into n from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
      join public.sources so on so.id = x.source_id join _r061_src s on s.url = so.url and s.key = r.source
      where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = r.asset_type and x.asset_name = r.asset_name and x.role_note = r.role_note
        and x.cash_amount_usd is not distinct from (case when r.asset_type = 'CASH' then r.amount end)
        and x.pool_space_amount_usd is not distinct from (case when r.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' then r.amount end);
    applied := applied + n;
  end loop;
  for r in select * from _r061_ev order by transaction_date loop
    select count(*) into n from public.transaction_events e where e.event_key = r.event_key and e.transaction_date = r.transaction_date and e.transaction_type = r.transaction_type
      and (select count(*) from public.transaction_event_assets x where x.event_id = e.id) = 1;
    applied := applied + n;
  end loop;
  for r in select * from _r061_evd order by event_key, field_name, source loop
    select count(*) into n from public.evidence ev join public.transaction_events e on e.id = ev.entity_id join public.sources so on so.id = ev.source_id join _r061_src s on s.url = so.url
      where ev.entity_type = 'transaction_event' and e.event_key = r.event_key and ev.field_name is not distinct from r.field_name and s.key = r.source
        and ev.confidence::text = r.confidence and ev.evidence_note = r.note;
    applied := applied + n;
  end loop;
  if applied = 0 then
    raise exception 'rollback-061: Migration 061 is not applied';
  end if;
  if applied <> (select count(*) from _r061_upd) + (select count(*) from _r061_ins) + (select count(*) from _r061_ev) + (select count(*) from _r061_evd) then
    raise exception 'rollback-061: % of the % facts 061 wrote are present exactly as written; a partial state or a later change is refused',
      applied, (select count(*) from _r061_upd) + (select count(*) from _r061_ins) + (select count(*) from _r061_ev) + (select count(*) from _r061_evd);
  end if;
  -- nothing may depend on what is removed
  if exists (select 1 from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
             where (e.event_key = any ((select new_keys from _r061_keys)::text[]) or x.id in (select x2.id from public.transaction_event_assets x2 join public.transaction_events e2 on e2.id = x2.event_id
                      join _r061_ins i on i.event_key = e2.event_key and i.side = x2.asset_side and i.asset_name = x2.asset_name))
               and (exists (select 1 from public.dodgers_control_observations o where o.subject_asset_id = x.id)
                 or exists (select 1 from public.transaction_asset_resolutions rs where rs.placeholder_asset_id = x.id or rs.resolved_asset_id = x.id)
                 or exists (select 1 from public.transaction_asset_timing_observations t where t.subject_asset_id = x.id))) then
    raise exception 'rollback-061: later research depends on an asset 061 added; rollback refused';
  end if;
  if exists (select 1 from public.transaction_events e where e.event_key = any ((select new_keys from _r061_keys)::text[])
             and (exists (select 1 from public.transaction_asset_timing_observations t where t.event_id = e.id)
               or exists (select 1 from public.transaction_return_metrics t where t.event_id = e.id)
               or exists (select 1 from public.transaction_competitive_context t where t.event_id = e.id))) then
    raise exception 'rollback-061: later research depends on a Garland event 061 added; rollback refused';
  end if;
  -- no later transaction was recorded for Garland, and no evidence beyond the reviewed rows hangs on the removed events
  if exists (select 1 from public.transaction_events e join public.transaction_event_assets x on x.event_id = e.id
             where x.mlb_id = (select a_mlb from _r061_ev limit 1) and e.transaction_date > (select min(transaction_date) from _r061_ev) and e.event_key <> all ((select new_keys from _r061_keys)::text[])) then
    raise exception 'rollback-061: a later transaction was recorded for Jon Garland; rollback refused';
  end if;
  if (select count(*) from public.evidence ev where ev.entity_type = 'transaction_event'
        and ev.entity_id in (select id from public.transaction_events where event_key = any ((select new_keys from _r061_keys)::text[]))) <> (select count(*) from _r061_evd where event_key = any ((select new_keys from _r061_keys)::text[])) then
    raise exception 'rollback-061: evidence beyond the reviewed rows exists on a Garland event; rollback refused';
  end if;
  raise notice 'rollback-061 phase guards: done at +%', clock_timestamp() - now();
end $$;

create temporary table _r061_before on commit drop as
select
  (select max(generation_id) from public.product_executive_snapshot) as generation,
  (select count(*) from public.transaction_events) as events,
  (select count(*) from public.transaction_event_assets) as assets,
  (select count(*) from public.evidence) as evidence,
  (select count(*) from public.sources) as sources,
  (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null) as cash_unknown,
  (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null) as pool_unknown,
  (select md5(coalesce(string_agg(md5(to_jsonb(e)::text), '' order by e.id), '')) from public.transaction_events e where e.event_key <> all (k.new_keys)) as other_events,
  (select md5(coalesce(string_agg(md5(to_jsonb(a)::text), '' order by a.id), '')) from public.transaction_event_assets a
     where a.event_id not in (select id from public.transaction_events where event_key = any (k.target_keys || k.new_keys))) as other_assets,
  (select md5(coalesce(string_agg(md5(to_jsonb(a)::text), '' order by a.id), '')) from public.transaction_event_assets a
     where a.event_id in (select id from public.transaction_events where event_key = any (k.target_keys)) and a.asset_type in ('PLAYER', 'FUTURE_CONSIDERATIONS', 'PLAYER_TO_BE_NAMED')) as target_event_kept_assets,
  (select md5(coalesce(string_agg(md5(to_jsonb(r)::text), '' order by r.id), '')) from public.transaction_asset_resolutions r) as resolutions,
  (select md5(coalesce(string_agg(md5(to_jsonb(s)::text), '' order by s.id), '')) from public.sources s) as sources_all,
  (select md5(coalesce(string_agg(md5(to_jsonb(v)::text), '' order by v.id), '')) from public.evidence v
     where v.source_id not in (select id from public.sources where url = any (k.urls))) as other_evidence,
  (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
     from public.signings s) as signings,
  (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by md5(to_jsonb(o)::text)), '')) from public.outcomes o) as outcomes
from _r061_keys k;

-- ===========================================================================
-- 2. RESTORE AND REMOVE
-- ===========================================================================

-- the six amounts return to unknown (only where they are exactly the reviewed amounts)
update public.transaction_event_assets x set cash_amount_usd = null
from public.transaction_events e, _r061_upd u
where e.id = x.event_id and e.event_key = u.event_key and x.asset_side = u.side and x.asset_type = 'CASH' and x.asset_name = u.asset_name and x.cash_amount_usd = u.amount;

-- the evidence 061 wrote
delete from public.evidence ev
using _r061_evd d, public.transaction_events e, public.sources so, _r061_src s
where ev.entity_type = 'transaction_event' and e.id = ev.entity_id and e.event_key = d.event_key and so.id = ev.source_id and so.url = s.url and s.key = d.source
  and ev.field_name is not distinct from d.field_name and ev.confidence::text = d.confidence and ev.evidence_note = d.note;

-- the three added assets (the asset each sits beside is untouched)
delete from public.transaction_event_assets x
using public.transaction_events e, _r061_ins i
where e.id = x.event_id and e.event_key = i.event_key and x.asset_side = i.side and x.asset_name = i.asset_name and x.asset_type = i.asset_type and x.role_note = i.role_note;

-- the two Garland events and their assets
delete from public.transaction_event_assets x using public.transaction_events e, _r061_ev v where x.event_id = e.id and e.event_key = v.event_key;
delete from public.transaction_events e using _r061_ev v where e.event_key = v.event_key;

do $$
begin
  raise notice 'rollback-061 phase restore: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 3. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  m jsonb := (select j from _r061);
  bf record;
  r record;
begin
  select * into bf from _r061_before;
  for r in select * from _r061_upd order by id loop
    if (select count(*) from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id
        where e.event_key = r.event_key and x.asset_side = r.side and x.asset_type = 'CASH' and x.asset_name = r.asset_name and x.cash_amount_usd is null) <> 1 then
      raise exception 'rollback-061 postcondition: % is not unknown again', r.id;
    end if;
  end loop;
  if exists (select 1 from public.transaction_events where event_key = any ((select new_keys from _r061_keys)::text[]))
     or exists (select 1 from public.transaction_event_assets x join public.transaction_events e on e.id = x.event_id join _r061_ins i on i.event_key = e.event_key and i.side = x.asset_side and i.asset_name = x.asset_name) then
    raise exception 'rollback-061 postcondition: an added event or asset remains';
  end if;
  if (select count(*) from public.transaction_events) <> bf.events - (m #>> '{delta,events}')::int
     or (select count(*) from public.transaction_event_assets) <> bf.assets - (m #>> '{delta,assets}')::int
     or (select count(*) from public.evidence) <> bf.evidence - (m #>> '{delta,evidence}')::int
     or (select count(*) from public.sources) <> bf.sources
     or (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null) <> bf.cash_unknown - (m #>> '{delta,cash_unknown}')::int
     or (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null) <> bf.pool_unknown - (m #>> '{delta,pool_unknown}')::int
     or (select count(*) from public.transaction_event_assets where asset_type = 'CASH' and cash_amount_usd is null) <> (m #>> '{baseline,cash_unknown}')::int
     or (select count(*) from public.transaction_event_assets where asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and pool_space_amount_usd is null) <> (m #>> '{baseline,pool_unknown}')::int then
    raise exception 'rollback-061 postcondition: the transaction state is not the pre-061 baseline';
  end if;
  if (select md5(coalesce(string_agg(md5(to_jsonb(e)::text), '' order by e.id), '')) from public.transaction_events e where e.event_key <> all ((select new_keys from _r061_keys)::text[])) <> bf.other_events
     or (select md5(coalesce(string_agg(md5(to_jsonb(ax)::text), '' order by ax.id), '')) from public.transaction_event_assets ax
         where ax.event_id not in (select id from public.transaction_events where event_key = any ((select target_keys || new_keys from _r061_keys)::text[]))) <> bf.other_assets
     or (select md5(coalesce(string_agg(md5(to_jsonb(ax)::text), '' order by ax.id), '')) from public.transaction_event_assets ax
         where ax.event_id in (select id from public.transaction_events where event_key = any ((select target_keys from _r061_keys)::text[]))
           and ax.asset_type in ('PLAYER', 'FUTURE_CONSIDERATIONS', 'PLAYER_TO_BE_NAMED')) <> bf.target_event_kept_assets
     or (select md5(coalesce(string_agg(md5(to_jsonb(rs)::text), '' order by rs.id), '')) from public.transaction_asset_resolutions rs) <> bf.resolutions
     or (select md5(coalesce(string_agg(md5(to_jsonb(s)::text), '' order by s.id), '')) from public.sources s) <> bf.sources_all
     or (select md5(coalesce(string_agg(md5(to_jsonb(v)::text), '' order by v.id), '')) from public.evidence v
         where v.source_id not in (select id from public.sources where url = any ((select urls from _r061_keys)::text[]))) <> bf.other_evidence
     or (select md5(coalesce(string_agg(md5(concat_ws('|', s.id, s.signing_bonus_usd, s.posting_fee_usd, s.transfer_fee_usd, s.bonus_publicly_reported, s.international_pool_treatment)), '' order by s.id), ''))
         from public.signings s) <> bf.signings
     or (select md5(coalesce(string_agg(md5(to_jsonb(o)::text), '' order by md5(to_jsonb(o)::text)), '')) from public.outcomes o) <> bf.outcomes then
    raise exception 'rollback-061 postcondition: something outside the facts 061 wrote changed';
  end if;
  raise notice 'rollback-061 phase postconditions: done at +%', clock_timestamp() - now();
end $$;

-- ===========================================================================
-- 4. GENERATION: one coherent refresh, only if the snapshots drift
-- ===========================================================================

do $$
declare
  bf record;
  tn text;
  g bigint[];
  want bigint;
  refreshed boolean := false;
begin
  select * into bf from _r061_before;
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    perform * from public.disi_refresh_product_snapshots();
    refreshed := true;
  end if;
  want := bf.generation + refreshed::int;
  if (select max(generation_id) from public.product_executive_snapshot) <> want
     or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception 'rollback-061 postcondition: expected one drift-free generation % (a refresh only when the snapshots drift)', want;
  end if;
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'product\_%' order by 1 loop
    execute format('select array_agg(distinct generation_id) from public.%I', tn) into g;
    if g is distinct from array[want] then
      raise exception 'rollback-061 postcondition: snapshot % is not at the single generation %', tn, want;
    end if;
  end loop;
  raise notice 'rollback-061 phase snapshots: done at +% (generation %, refreshed %)', clock_timestamp() - now(), want, refreshed;
end $$;

commit;
