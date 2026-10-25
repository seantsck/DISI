-- DISI rollback-054.sql: logical rollback of the full-career transaction history (WRITE; run only with explicit owner approval, after a failed
-- post-release verification).
--
-- Built from database/research/054/ (migration-values.json); regenerate with: node database/research/054/build.mjs
--
-- 054 created player_career_transactions with 46 reviewed rows, the view v_player_career_transactions, one product-contract row and two sources,
-- and redefined the development research queue's MULTI_ORG_SEASON_UNVERIFIED condition. This file restores the 053 queue text byte for byte,
-- drops the view and the table, deletes the contract row and the two sources (only where nothing else cites them), and refreshes the snapshots once:
-- every canonical table returns to its exact pre-054 content and the catalog to its pre-054 shape.
--
-- It is guarded: it refuses unless the table holds exactly the reviewed rows, and unless no object other than the 054 view and the research queue
-- depends on the table or the view. One transaction. Migration 054 CAN be applied again after this rollback.

begin;

create temporary table _r054 on commit drop as
select $r054${"events":[{"date":"2022-06-27","description":"Carlos Santana: traded, Kansas City Royals to Seattle Mariners. Seattle Mariners traded RHP Wyatt Mills and RHP William Fleming to Kansas City Royals for 1B Carlos Santana and cash. (MLB transaction log, 2022-06-27).","from":"KC","historical_label":"Traded","key":"CAREER_20220627_TRADE_KC_SEA_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 633466","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"SEA","type":"TRADE"},{"date":"2023-07-27","description":"Carlos Santana: traded, Pittsburgh Pirates to Milwaukee Brewers. Pittsburgh Pirates traded 1B Carlos Santana to Milwaukee Brewers for SS Jhonny Severino. (MLB transaction log, 2023-07-27).","from":"PIT","historical_label":"Traded","key":"CAREER_20230727_TRADE_PIT_MIL_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 715038","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"MIL","type":"TRADE"},{"date":"2025-08-28","description":"Carlos Santana released by the Cleveland Guardians. Cleveland Guardians released 1B Carlos Santana. (MLB transaction log, 2025-08-28). Who signed him next is a separate transaction.","from":"CLE","historical_label":"Released","key":"CAREER_20250828_RELEASE_CLE_NONE_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 866773","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"","type":"RELEASE"},{"date":"2025-09-01","description":"Carlos Santana signed by the Chicago Cubs as a free agent. Chicago Cubs signed free agent 1B Carlos Santana. (MLB transaction log, 2025-09-01). How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20250901_FREE_AGENT_SIGNING_NONE_CHC_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 867250","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"CHC","type":"FREE_AGENT_SIGNING"},{"date":"2026-06-26","description":"Carlos Santana released by the Arizona Diamondbacks. Arizona Diamondbacks released 1B Carlos Santana. (MLB transaction log, 2026-06-26). Who signed him next is a separate transaction.","from":"ARI","historical_label":"Released","key":"CAREER_20260626_RELEASE_ARI_NONE_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 922945","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"","type":"RELEASE"},{"date":"2026-06-28","description":"Carlos Santana signed by the Atlanta Braves as a free agent. Atlanta Braves signed free agent 1B Carlos Santana to a minor league contract. (MLB transaction log, 2026-06-28). How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20260628_FREE_AGENT_SIGNING_NONE_ATL_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 924086","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"ATL","type":"FREE_AGENT_SIGNING"},{"date":"2005-07-30","description":"Chan Ho Park: traded, Texas Rangers to San Diego Padres. Retrosheet transaction 63729, 2005-07-30.","from":"TEX","historical_label":"Traded","key":"CAREER_20050730_TRADE_TEX_SD_CHAN_HO_PARK","player_slug":"chan-ho-park","source_reference":"Retrosheet transaction 63729","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SD","type":"TRADE"},{"date":"2007-06-03","description":"Chan Ho Park released by the New York Mets. Retrosheet transaction 39970, 2007-06-03. Who signed him next is a separate transaction.","from":"NYM","historical_label":"Released","key":"CAREER_20070603_RELEASE_NYM_NONE_CHAN_HO_PARK","player_slug":"chan-ho-park","source_reference":"Retrosheet transaction 39970","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2007-06-12","description":"Chan Ho Park signed by the Houston Astros as a free agent. Retrosheet transaction 39971, 2007-06-12. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20070612_FREE_AGENT_SIGNING_NONE_HOU_CHAN_HO_PARK","player_slug":"chan-ho-park","source_reference":"Retrosheet transaction 39971","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"HOU","type":"FREE_AGENT_SIGNING"},{"date":"2010-08-04","description":"Chan Ho Park: claimed off waivers, New York Yankees to Pittsburgh Pirates. Pittsburgh Pirates claimed RHP Chan Ho Park off waivers from New York Yankees. (MLB transaction log, 2010-08-04).","from":"NYY","historical_label":"Claimed off waivers","key":"CAREER_20100804_WAIVER_CLAIM_NYY_PIT_CHAN_HO_PARK","player_slug":"chan-ho-park","source_reference":"MLB transaction 65586","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=120221","to":"PIT","type":"WAIVER_CLAIM"},{"date":"1963-05-08","description":"Chico Fernández: traded, Atlanta Braves to New York Mets. Retrosheet transaction 60349, 1963-05-08.","from":"ATL","historical_label":"Traded","key":"CAREER_19630508_TRADE_ATL_NYM_CHICO_FERNANDEZ","player_slug":"chico-fernandez","source_reference":"Retrosheet transaction 60349","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"NYM","type":"TRADE"},{"date":"1963-05-08","description":"Chico Fernández: traded, Detroit Tigers to Atlanta Braves. Retrosheet transaction 60348, 1963-05-08.","from":"DET","historical_label":"Traded","key":"CAREER_19630508_TRADE_DET_ATL_CHICO_FERNANDEZ","player_slug":"chico-fernandez","source_reference":"Retrosheet transaction 60348","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"ATL","type":"TRADE"},{"date":"2025-07-23","description":"Diego Cartaya released by the Minnesota Twins. St. Paul Saints released C Diego Cartaya. (MLB transaction log, 2025-07-23). Who signed him next is a separate transaction.","from":"MIN","historical_label":"Released","key":"CAREER_20250723_RELEASE_MIN_NONE_DIEGO_CARTAYA","player_slug":"diego-cartaya","source_reference":"MLB transaction 857600","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=682616","to":"","type":"RELEASE"},{"date":"2025-07-29","description":"Diego Cartaya signed by the San Francisco Giants as a free agent. San Francisco Giants signed free agent C Diego Cartaya. (MLB transaction log, 2025-07-29). How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20250729_FREE_AGENT_SIGNING_NONE_SFG_DIEGO_CARTAYA","player_slug":"diego-cartaya","source_reference":"MLB transaction 859876","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=682616","to":"SFG","type":"FREE_AGENT_SIGNING"},{"date":"2026-07-16","description":"Eddys Leonard released by the Milwaukee Brewers. Nashville Sounds released SS Eddys Leonard. (MLB transaction log, 2026-07-16). Who signed him next is a separate transaction.","from":"MIL","historical_label":"Released","key":"CAREER_20260716_RELEASE_MIL_NONE_EDDYS_LEONARD","player_slug":"eddys-leonard","source_reference":"MLB transaction 928037","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=678760","to":"","type":"RELEASE"},{"date":"2026-07-24","description":"Eddys Leonard signed by the San Francisco Giants as a free agent. San Francisco Giants signed free agent SS Eddys Leonard to a minor league contract. (MLB transaction log, 2026-07-24). How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20260724_FREE_AGENT_SIGNING_NONE_SFG_EDDYS_LEONARD","player_slug":"eddys-leonard","source_reference":"MLB transaction 931087","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=678760","to":"SFG","type":"FREE_AGENT_SIGNING"},{"date":"1997-06-13","description":"Fernando Valenzuela: traded, San Diego Padres to St. Louis Cardinals. Retrosheet transaction 62878, 1997-06-13.","from":"SD","historical_label":"Traded","key":"CAREER_19970613_TRADE_SD_STL_FERNANDO_VALENZUELA","player_slug":"fernando-valenzuela","source_reference":"Retrosheet transaction 62878","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"STL","type":"TRADE"},{"date":"2002-08-19","description":"Ismael Valdez: traded, Texas Rangers to Seattle Mariners. Retrosheet transaction 63457, 2002-08-19.","from":"TEX","historical_label":"Traded","key":"CAREER_20020819_TRADE_TEX_SEA_ISMAEL_VALDEZ","player_slug":"ismael-valdez","source_reference":"Retrosheet transaction 63457","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SEA","type":"TRADE"},{"date":"2004-07-31","description":"Ismael Valdez: traded, San Diego Padres to Miami Marlins. Retrosheet transaction 63647, 2004-07-31.","from":"SD","historical_label":"Traded","key":"CAREER_20040731_TRADE_SD_MIA_ISMAEL_VALDEZ","player_slug":"ismael-valdez","source_reference":"Retrosheet transaction 63647","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"MIA","type":"TRADE"},{"date":"2002-08-08","description":"José Offerman: conditional deal, Boston Red Sox to Seattle Mariners. Retrosheet transaction 38673, 2002-08-08.","from":"BOS","historical_label":"Conditional deal","key":"CAREER_20020808_TRADE_BOS_SEA_JOSE_OFFERMAN","player_slug":"jose-offerman","source_reference":"Retrosheet transaction 38673","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SEA","type":"TRADE"},{"date":"2005-05-20","description":"José Offerman released by the Philadelphia Phillies. Retrosheet transaction 38680, 2005-05-20. Who signed him next is a separate transaction.","from":"PHI","historical_label":"Released","key":"CAREER_20050520_RELEASE_PHI_NONE_JOSE_OFFERMAN","player_slug":"jose-offerman","source_reference":"Retrosheet transaction 38680","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2005-06-08","description":"José Offerman signed by the New York Mets as a free agent. Retrosheet transaction 38681, 2005-06-08. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20050608_FREE_AGENT_SIGNING_NONE_NYM_JOSE_OFFERMAN","player_slug":"jose-offerman","source_reference":"Retrosheet transaction 38681","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"NYM","type":"FREE_AGENT_SIGNING"},{"date":"1996-07-29","description":"José Vizcaíno: traded, New York Mets to Cleveland Guardians. Retrosheet transaction 62798, 1996-07-29.","from":"NYM","historical_label":"Traded","key":"CAREER_19960729_TRADE_NYM_CLE_JOSE_VIZCAINO","player_slug":"jose-vizcaino","source_reference":"Retrosheet transaction 62798","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"CLE","type":"TRADE"},{"date":"2006-08-18","description":"José Vizcaíno released by the San Francisco Giants. Retrosheet transaction 54695, 2006-08-18. Who signed him next is a separate transaction.","from":"SFG","historical_label":"Released","key":"CAREER_20060818_RELEASE_SFG_NONE_JOSE_VIZCAINO","player_slug":"jose-vizcaino","source_reference":"Retrosheet transaction 54695","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2006-08-23","description":"José Vizcaíno signed by the St. Louis Cardinals as a free agent. Retrosheet transaction 54696, 2006-08-23. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20060823_FREE_AGENT_SIGNING_NONE_STL_JOSE_VIZCAINO","player_slug":"jose-vizcaino","source_reference":"Retrosheet transaction 54696","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"STL","type":"FREE_AGENT_SIGNING"},{"date":"2006-06-15","description":"Juan Castro: traded, Minnesota Twins to Cincinnati Reds. Retrosheet transaction 63818, 2006-06-15.","from":"MIN","historical_label":"Traded","key":"CAREER_20060615_TRADE_MIN_CIN_JUAN_CASTRO","player_slug":"juan-castro","source_reference":"Retrosheet transaction 63818","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"CIN","type":"TRADE"},{"date":"2008-05-02","description":"Juan Castro released by the Cincinnati Reds. Retrosheet transaction 8701, 2008-05-02. Who signed him next is a separate transaction.","from":"CIN","historical_label":"Released","key":"CAREER_20080502_RELEASE_CIN_NONE_JUAN_CASTRO","player_slug":"juan-castro","source_reference":"Retrosheet transaction 8701","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2008-05-04","description":"Juan Castro signed by the Colorado Rockies as a free agent. Retrosheet transaction 8702, 2008-05-04. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20080504_FREE_AGENT_SIGNING_NONE_COL_JUAN_CASTRO","player_slug":"juan-castro","source_reference":"Retrosheet transaction 8702","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"COL","type":"FREE_AGENT_SIGNING"},{"date":"2008-07-19","description":"Juan Castro: traded, Colorado Rockies to Baltimore Orioles. Retrosheet transaction 64012, 2008-07-19.","from":"COL","historical_label":"Traded","key":"CAREER_20080719_TRADE_COL_BAL_JUAN_CASTRO","player_slug":"juan-castro","source_reference":"Retrosheet transaction 64012","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"BAL","type":"TRADE"},{"date":"1998-07-31","description":"Juan Guzmán: traded, Toronto Blue Jays to Baltimore Orioles. Retrosheet transaction 63020, 1998-07-31.","from":"TOR","historical_label":"Traded","key":"CAREER_19980731_TRADE_TOR_BAL_JUAN_GUZMAN","player_slug":"juan-guzman","source_reference":"Retrosheet transaction 63020","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"BAL","type":"TRADE"},{"date":"1999-07-31","description":"Juan Guzmán: traded, Baltimore Orioles to Cincinnati Reds. Retrosheet transaction 63120, 1999-07-31.","from":"BAL","historical_label":"Traded","key":"CAREER_19990731_TRADE_BAL_CIN_JUAN_GUZMAN","player_slug":"juan-guzman","source_reference":"Retrosheet transaction 63120","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"CIN","type":"TRADE"},{"date":"2000-06-12","description":"Karim García: conditional deal, Detroit Tigers to Baltimore Orioles. Retrosheet transaction 18076, 2000-06-12.","from":"DET","historical_label":"Conditional deal","key":"CAREER_20000612_TRADE_DET_BAL_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 18076","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"BAL","type":"TRADE"},{"date":"2002-07-02","description":"Karim García released by the New York Yankees. Retrosheet transaction 18081, 2002-07-02. Who signed him next is a separate transaction.","from":"NYY","historical_label":"Released","key":"CAREER_20020702_RELEASE_NYY_NONE_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 18081","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2002-07-12","description":"Karim García signed by the Cleveland Guardians as a free agent. Retrosheet transaction 18082, 2002-07-12. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20020712_FREE_AGENT_SIGNING_NONE_CLE_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 18082","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"CLE","type":"FREE_AGENT_SIGNING"},{"date":"2003-06-25","description":"Karim García: purchased, Cleveland Guardians to New York Yankees. Retrosheet transaction 18083, 2003-06-25.","from":"CLE","historical_label":"Purchased","key":"CAREER_20030625_PURCHASE_CLE_NYY_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 18083","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"NYY","type":"PURCHASE"},{"date":"2004-07-19","description":"Karim García: traded, New York Mets to Baltimore Orioles. Retrosheet transaction 63633, 2004-07-19.","from":"NYM","historical_label":"Traded","key":"CAREER_20040719_TRADE_NYM_BAL_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 63633","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"BAL","type":"TRADE"},{"date":"1997-07-25","description":"Omar Daal: claimed off waivers, Washington Nationals to Toronto Blue Jays. Retrosheet transaction 11937, 1997-07-25.","from":"WSH","historical_label":"Claimed off waivers","key":"CAREER_19970725_WAIVER_CLAIM_WSH_TOR_OMAR_DAAL","player_slug":"omar-daal","source_reference":"Retrosheet transaction 11937","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"TOR","type":"WAIVER_CLAIM"},{"date":"2000-07-26","description":"Omar Daal: traded, Arizona Diamondbacks to Philadelphia Phillies. Retrosheet transaction 63220, 2000-07-26.","from":"ARI","historical_label":"Traded","key":"CAREER_20000726_TRADE_ARI_PHI_OMAR_DAAL","player_slug":"omar-daal","source_reference":"Retrosheet transaction 63220","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"PHI","type":"TRADE"},{"date":"2001-07-31","description":"Pedro Astacio: traded, Colorado Rockies to Houston Astros. Retrosheet transaction 63347, 2001-07-31.","from":"COL","historical_label":"Traded","key":"CAREER_20010731_TRADE_COL_HOU_PEDRO_ASTACIO","player_slug":"pedro-astacio","source_reference":"Retrosheet transaction 63347","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"HOU","type":"TRADE"},{"date":"2005-06-17","description":"Pedro Astacio released by the Texas Rangers. Retrosheet transaction 1645, 2005-06-17. Who signed him next is a separate transaction.","from":"TEX","historical_label":"Released","key":"CAREER_20050617_RELEASE_TEX_NONE_PEDRO_ASTACIO","player_slug":"pedro-astacio","source_reference":"Retrosheet transaction 1645","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2005-06-30","description":"Pedro Astacio signed by the San Diego Padres as a free agent. Retrosheet transaction 1646, 2005-06-30. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20050630_FREE_AGENT_SIGNING_NONE_SD_PEDRO_ASTACIO","player_slug":"pedro-astacio","source_reference":"Retrosheet transaction 1646","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SD","type":"FREE_AGENT_SIGNING"},{"date":"2002-07-01","description":"Raúl Mondesí: traded, Toronto Blue Jays to New York Yankees. Retrosheet transaction 63429, 2002-07-01.","from":"TOR","historical_label":"Traded","key":"CAREER_20020701_TRADE_TOR_NYY_RAUL_MONDESI","player_slug":"raul-mondesi","source_reference":"Retrosheet transaction 63429","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"NYY","type":"TRADE"},{"date":"2003-07-29","description":"Raúl Mondesí: traded, New York Yankees to Arizona Diamondbacks. Retrosheet transaction 63535, 2003-07-29.","from":"NYY","historical_label":"Traded","key":"CAREER_20030729_TRADE_NYY_ARI_RAUL_MONDESI","player_slug":"raul-mondesi","source_reference":"Retrosheet transaction 63535","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"ARI","type":"TRADE"},{"date":"2004-05-21","description":"Raúl Mondesí released by the Pittsburgh Pirates. Retrosheet transaction 35993, 2004-05-21. Who signed him next is a separate transaction.","from":"PIT","historical_label":"Released","key":"CAREER_20040521_RELEASE_PIT_NONE_RAUL_MONDESI","player_slug":"raul-mondesi","source_reference":"Retrosheet transaction 35993","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2004-05-30","description":"Raúl Mondesí signed by the Los Angeles Angels as a free agent. Retrosheet transaction 35994, 2004-05-30. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20040530_FREE_AGENT_SIGNING_NONE_LAA_RAUL_MONDESI","player_slug":"raul-mondesi","source_reference":"Retrosheet transaction 35994","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"LAA","type":"FREE_AGENT_SIGNING"},{"date":"2019-07-31","description":"Yasiel Puig: traded, Cincinnati Reds to Cleveland Guardians. Cincinnati Reds Traded CF Taylor Trammell to San Diego Padres; San Diego Padres Traded RF Franmil Reyes, LHP Logan Allen and 3B Victor Nova to Cleveland Indians; Cincinnati Reds Traded LHP Scott Moss and RF Yasiel Puig to Cleveland Indians and Cleveland Indians Traded RHP Trevor Bauer to Cincinnati Reds. (MLB transaction log, 2019-07-31).","from":"CIN","historical_label":"Traded","key":"CAREER_20190731_TRADE_CIN_CLE_YASIEL_PUIG","player_slug":"yasiel-puig","source_reference":"MLB transaction 420891","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=624577","to":"CLE","type":"TRADE"}],"existing_source_urls":["https://statsapi.mlb.com/api/v1/transactions?playerId=624577","https://statsapi.mlb.com/api/v1/transactions?playerId=678760","https://statsapi.mlb.com/api/v1/transactions?playerId=682616","https://www.retrosheet.org/transactions/tranDB.zip"],"retrieved_at":"2026-10-24T00:00:00Z","sources":[{"notes":"Official transaction log of the player, read for his career moves between clubs other than the Dodgers (054).","source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: Chan Ho Park (120221)","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=120221"},{"notes":"Official transaction log of the player, read for his career moves between clubs other than the Dodgers (054).","source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: Carlos Santana (467793)","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793"}]}$r054$::jsonb as j;

do $$
declare
  n int;
begin
  if to_regclass('public.player_career_transactions') is null or to_regclass('public.v_player_career_transactions') is null then
    raise exception 'rollback-054: the 054 table or view is missing; this database is not in the post-054 state';
  end if;
  select count(*) into n from public.player_career_transactions c, _r054
    where c.event_key not in (select y ->> 'key' from jsonb_array_elements(j -> 'events') y);
  if n > 0 then
    raise exception 'rollback-054: player_career_transactions holds % rows 054 did not write; later research depends on it', n;
  end if;
  if (select count(*) from public.player_career_transactions) <> (select jsonb_array_length(j -> 'events') from _r054) then
    raise exception 'rollback-054: player_career_transactions does not hold exactly the reviewed rows';
  end if;
  select count(*) into n from (
    select distinct v.oid from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
    where d.refobjid in ('public.player_career_transactions'::regclass, 'public.v_player_career_transactions'::regclass)
      and v.relname not in ('player_career_transactions', 'v_player_career_transactions', 'v_dodgers_development_research_queue')) x;
  if n > 0 then
    raise exception 'rollback-054: % other objects depend on the career-history table or view', n;
  end if;
  select count(*) into n from pg_constraint where confrelid = 'public.player_career_transactions'::regclass;
  if n > 0 then
    raise exception 'rollback-054: % foreign keys reference player_career_transactions', n;
  end if;
end $$;

-- 1. the 053 research queue, byte for byte (it no longer reads career history)
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

-- 2. the view, the contract row, the table, the sources 054 added
drop view public.v_player_career_transactions;
delete from public.disi_product_contract where relation_name = 'v_player_career_transactions' and introduced_in = '054';
drop table public.player_career_transactions;
delete from public.sources s using _r054, jsonb_array_elements(j -> 'sources') x
where s.url = x ->> 'url'
  and not exists (select 1 from public.transaction_events e where e.source_id = s.id)
  and not exists (select 1 from public.transaction_event_assets a where a.source_id = s.id)
  and not exists (select 1 from public.dodgers_control_observations o where o.source_id = s.id);

-- 3. postconditions
do $$
declare
  n int;
begin
  if to_regclass('public.player_career_transactions') is not null or to_regclass('public.v_player_career_transactions') is not null then
    raise exception 'rollback-054 postcondition: the 054 table or view remains';
  end if;
  if exists (select 1 from public.disi_product_contract where relation_name = 'v_player_career_transactions') then
    raise exception 'rollback-054 postcondition: the contract row remains';
  end if;
  select count(*) into n from public.sources s, _r054, jsonb_array_elements(j -> 'sources') x where s.url = x ->> 'url';
  if n <> 0 then
    raise exception 'rollback-054 postcondition: % 054 sources remain', n;
  end if;
  if position('player_career_transactions' in pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) > 0 then
    raise exception 'rollback-054 postcondition: the research queue still reads career history';
  end if;
end $$;

-- 4. one coherent generation without the career history
do $$
begin
  perform * from public.disi_refresh_product_snapshots();
end $$;

commit;
