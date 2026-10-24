-- DISI v0.39
-- 054_full_career_transaction_history.sql
-- Full-career transaction history: a player's moves between clubs other than the Dodgers. Run after 053.
--
-- Built from database/research/054/ (migration-values.json, build.mjs). Do not edit by hand: change the research and rebuild.
--
-- DODGERS ASSET LEDGER != FULL CAREER HISTORY. The canonical transaction ledger (transaction_events, transaction_event_assets) records Dodgers
-- transactions only, from the Dodgers' side, and every asset, package, control-interval and value view reads it as such. A move between two other
-- clubs written there would read as a Dodgers exit. 054 gives those moves their own home:
--   * player_career_transactions: one sourced movement fact about one player, in the player's direction (a trade from one club to another, a
--     release from a club, a free-agent signing by a club, a waiver claim, a purchase). Neither end is ever a Dodgers organization. No package, no
--     return, no value, no attribution. 46 reviewed rows for the 33 open transitions of the 16 transaction-blocked development needs, each stated by
--     the official MLB transaction log or the Retrosheet transaction database with an exact date.
--   * v_player_career_transactions: the player's transaction stream, both layers in his direction, each row labelled DODGERS_LEDGER or
--     CAREER_HISTORY. Read by the dossier and /development for chronology only.
--   * The development research queue reads career history for a move between two other clubs: a direct move, or a release and a later signing
--     (two facts, never one synthetic transaction), between his last game for the first club and his first for the second.
--   CAREER TRANSACTION != DODGERS ASSET TRANSACTION   CAREER MOVE != ASSET PACKAGE   CAREER MOVE != DODGERS CONTROL CHANGE
--   THIRD-PARTY TRADE != DODGERS TRADE   CAREER TRANSACTION != RETURN VALUE   CAREER TRANSACTION != PREDICTION FEATURE
--   ONE KNOWN MOVE != COMPLETE CAREER
-- It adds one table, one view and one product-contract row (the application reads the view), so the executive snapshot's contract count moves:
-- the explicit snapshot refresh runs once, only when a snapshot drifts.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m054 on commit drop as
select $m054${"events":[{"date":"2022-06-27","description":"Carlos Santana: traded, Kansas City Royals to Seattle Mariners. Seattle Mariners traded RHP Wyatt Mills and RHP William Fleming to Kansas City Royals for 1B Carlos Santana and cash. (MLB transaction log, 2022-06-27).","from":"KC","historical_label":"Traded","key":"CAREER_20220627_TRADE_KC_SEA_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 633466","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"SEA","type":"TRADE"},{"date":"2023-07-27","description":"Carlos Santana: traded, Pittsburgh Pirates to Milwaukee Brewers. Pittsburgh Pirates traded 1B Carlos Santana to Milwaukee Brewers for SS Jhonny Severino. (MLB transaction log, 2023-07-27).","from":"PIT","historical_label":"Traded","key":"CAREER_20230727_TRADE_PIT_MIL_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 715038","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"MIL","type":"TRADE"},{"date":"2025-08-28","description":"Carlos Santana released by the Cleveland Guardians. Cleveland Guardians released 1B Carlos Santana. (MLB transaction log, 2025-08-28). Who signed him next is a separate transaction.","from":"CLE","historical_label":"Released","key":"CAREER_20250828_RELEASE_CLE_NONE_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 866773","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"","type":"RELEASE"},{"date":"2025-09-01","description":"Carlos Santana signed by the Chicago Cubs as a free agent. Chicago Cubs signed free agent 1B Carlos Santana. (MLB transaction log, 2025-09-01). How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20250901_FREE_AGENT_SIGNING_NONE_CHC_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 867250","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"CHC","type":"FREE_AGENT_SIGNING"},{"date":"2026-06-26","description":"Carlos Santana released by the Arizona Diamondbacks. Arizona Diamondbacks released 1B Carlos Santana. (MLB transaction log, 2026-06-26). Who signed him next is a separate transaction.","from":"ARI","historical_label":"Released","key":"CAREER_20260626_RELEASE_ARI_NONE_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 922945","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"","type":"RELEASE"},{"date":"2026-06-28","description":"Carlos Santana signed by the Atlanta Braves as a free agent. Atlanta Braves signed free agent 1B Carlos Santana to a minor league contract. (MLB transaction log, 2026-06-28). How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20260628_FREE_AGENT_SIGNING_NONE_ATL_CARLOS_SANTANA","player_slug":"carlos-santana","source_reference":"MLB transaction 924086","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793","to":"ATL","type":"FREE_AGENT_SIGNING"},{"date":"2005-07-30","description":"Chan Ho Park: traded, Texas Rangers to San Diego Padres. Retrosheet transaction 63729, 2005-07-30.","from":"TEX","historical_label":"Traded","key":"CAREER_20050730_TRADE_TEX_SD_CHAN_HO_PARK","player_slug":"chan-ho-park","source_reference":"Retrosheet transaction 63729","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SD","type":"TRADE"},{"date":"2007-06-03","description":"Chan Ho Park released by the New York Mets. Retrosheet transaction 39970, 2007-06-03. Who signed him next is a separate transaction.","from":"NYM","historical_label":"Released","key":"CAREER_20070603_RELEASE_NYM_NONE_CHAN_HO_PARK","player_slug":"chan-ho-park","source_reference":"Retrosheet transaction 39970","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2007-06-12","description":"Chan Ho Park signed by the Houston Astros as a free agent. Retrosheet transaction 39971, 2007-06-12. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20070612_FREE_AGENT_SIGNING_NONE_HOU_CHAN_HO_PARK","player_slug":"chan-ho-park","source_reference":"Retrosheet transaction 39971","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"HOU","type":"FREE_AGENT_SIGNING"},{"date":"2010-08-04","description":"Chan Ho Park: claimed off waivers, New York Yankees to Pittsburgh Pirates. Pittsburgh Pirates claimed RHP Chan Ho Park off waivers from New York Yankees. (MLB transaction log, 2010-08-04).","from":"NYY","historical_label":"Claimed off waivers","key":"CAREER_20100804_WAIVER_CLAIM_NYY_PIT_CHAN_HO_PARK","player_slug":"chan-ho-park","source_reference":"MLB transaction 65586","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=120221","to":"PIT","type":"WAIVER_CLAIM"},{"date":"1963-05-08","description":"Chico Fernández: traded, Atlanta Braves to New York Mets. Retrosheet transaction 60349, 1963-05-08.","from":"ATL","historical_label":"Traded","key":"CAREER_19630508_TRADE_ATL_NYM_CHICO_FERNANDEZ","player_slug":"chico-fernandez","source_reference":"Retrosheet transaction 60349","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"NYM","type":"TRADE"},{"date":"1963-05-08","description":"Chico Fernández: traded, Detroit Tigers to Atlanta Braves. Retrosheet transaction 60348, 1963-05-08.","from":"DET","historical_label":"Traded","key":"CAREER_19630508_TRADE_DET_ATL_CHICO_FERNANDEZ","player_slug":"chico-fernandez","source_reference":"Retrosheet transaction 60348","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"ATL","type":"TRADE"},{"date":"2025-07-23","description":"Diego Cartaya released by the Minnesota Twins. St. Paul Saints released C Diego Cartaya. (MLB transaction log, 2025-07-23). Who signed him next is a separate transaction.","from":"MIN","historical_label":"Released","key":"CAREER_20250723_RELEASE_MIN_NONE_DIEGO_CARTAYA","player_slug":"diego-cartaya","source_reference":"MLB transaction 857600","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=682616","to":"","type":"RELEASE"},{"date":"2025-07-29","description":"Diego Cartaya signed by the San Francisco Giants as a free agent. San Francisco Giants signed free agent C Diego Cartaya. (MLB transaction log, 2025-07-29). How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20250729_FREE_AGENT_SIGNING_NONE_SFG_DIEGO_CARTAYA","player_slug":"diego-cartaya","source_reference":"MLB transaction 859876","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=682616","to":"SFG","type":"FREE_AGENT_SIGNING"},{"date":"2026-07-16","description":"Eddys Leonard released by the Milwaukee Brewers. Nashville Sounds released SS Eddys Leonard. (MLB transaction log, 2026-07-16). Who signed him next is a separate transaction.","from":"MIL","historical_label":"Released","key":"CAREER_20260716_RELEASE_MIL_NONE_EDDYS_LEONARD","player_slug":"eddys-leonard","source_reference":"MLB transaction 928037","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=678760","to":"","type":"RELEASE"},{"date":"2026-07-24","description":"Eddys Leonard signed by the San Francisco Giants as a free agent. San Francisco Giants signed free agent SS Eddys Leonard to a minor league contract. (MLB transaction log, 2026-07-24). How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20260724_FREE_AGENT_SIGNING_NONE_SFG_EDDYS_LEONARD","player_slug":"eddys-leonard","source_reference":"MLB transaction 931087","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=678760","to":"SFG","type":"FREE_AGENT_SIGNING"},{"date":"1997-06-13","description":"Fernando Valenzuela: traded, San Diego Padres to St. Louis Cardinals. Retrosheet transaction 62878, 1997-06-13.","from":"SD","historical_label":"Traded","key":"CAREER_19970613_TRADE_SD_STL_FERNANDO_VALENZUELA","player_slug":"fernando-valenzuela","source_reference":"Retrosheet transaction 62878","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"STL","type":"TRADE"},{"date":"2002-08-19","description":"Ismael Valdez: traded, Texas Rangers to Seattle Mariners. Retrosheet transaction 63457, 2002-08-19.","from":"TEX","historical_label":"Traded","key":"CAREER_20020819_TRADE_TEX_SEA_ISMAEL_VALDEZ","player_slug":"ismael-valdez","source_reference":"Retrosheet transaction 63457","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SEA","type":"TRADE"},{"date":"2004-07-31","description":"Ismael Valdez: traded, San Diego Padres to Miami Marlins. Retrosheet transaction 63647, 2004-07-31.","from":"SD","historical_label":"Traded","key":"CAREER_20040731_TRADE_SD_MIA_ISMAEL_VALDEZ","player_slug":"ismael-valdez","source_reference":"Retrosheet transaction 63647","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"MIA","type":"TRADE"},{"date":"2002-08-08","description":"José Offerman: conditional deal, Boston Red Sox to Seattle Mariners. Retrosheet transaction 38673, 2002-08-08.","from":"BOS","historical_label":"Conditional deal","key":"CAREER_20020808_TRADE_BOS_SEA_JOSE_OFFERMAN","player_slug":"jose-offerman","source_reference":"Retrosheet transaction 38673","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SEA","type":"TRADE"},{"date":"2005-05-20","description":"José Offerman released by the Philadelphia Phillies. Retrosheet transaction 38680, 2005-05-20. Who signed him next is a separate transaction.","from":"PHI","historical_label":"Released","key":"CAREER_20050520_RELEASE_PHI_NONE_JOSE_OFFERMAN","player_slug":"jose-offerman","source_reference":"Retrosheet transaction 38680","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2005-06-08","description":"José Offerman signed by the New York Mets as a free agent. Retrosheet transaction 38681, 2005-06-08. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20050608_FREE_AGENT_SIGNING_NONE_NYM_JOSE_OFFERMAN","player_slug":"jose-offerman","source_reference":"Retrosheet transaction 38681","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"NYM","type":"FREE_AGENT_SIGNING"},{"date":"1996-07-29","description":"José Vizcaíno: traded, New York Mets to Cleveland Guardians. Retrosheet transaction 62798, 1996-07-29.","from":"NYM","historical_label":"Traded","key":"CAREER_19960729_TRADE_NYM_CLE_JOSE_VIZCAINO","player_slug":"jose-vizcaino","source_reference":"Retrosheet transaction 62798","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"CLE","type":"TRADE"},{"date":"2006-08-18","description":"José Vizcaíno released by the San Francisco Giants. Retrosheet transaction 54695, 2006-08-18. Who signed him next is a separate transaction.","from":"SFG","historical_label":"Released","key":"CAREER_20060818_RELEASE_SFG_NONE_JOSE_VIZCAINO","player_slug":"jose-vizcaino","source_reference":"Retrosheet transaction 54695","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2006-08-23","description":"José Vizcaíno signed by the St. Louis Cardinals as a free agent. Retrosheet transaction 54696, 2006-08-23. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20060823_FREE_AGENT_SIGNING_NONE_STL_JOSE_VIZCAINO","player_slug":"jose-vizcaino","source_reference":"Retrosheet transaction 54696","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"STL","type":"FREE_AGENT_SIGNING"},{"date":"2006-06-15","description":"Juan Castro: traded, Minnesota Twins to Cincinnati Reds. Retrosheet transaction 63818, 2006-06-15.","from":"MIN","historical_label":"Traded","key":"CAREER_20060615_TRADE_MIN_CIN_JUAN_CASTRO","player_slug":"juan-castro","source_reference":"Retrosheet transaction 63818","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"CIN","type":"TRADE"},{"date":"2008-05-02","description":"Juan Castro released by the Cincinnati Reds. Retrosheet transaction 8701, 2008-05-02. Who signed him next is a separate transaction.","from":"CIN","historical_label":"Released","key":"CAREER_20080502_RELEASE_CIN_NONE_JUAN_CASTRO","player_slug":"juan-castro","source_reference":"Retrosheet transaction 8701","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2008-05-04","description":"Juan Castro signed by the Colorado Rockies as a free agent. Retrosheet transaction 8702, 2008-05-04. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20080504_FREE_AGENT_SIGNING_NONE_COL_JUAN_CASTRO","player_slug":"juan-castro","source_reference":"Retrosheet transaction 8702","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"COL","type":"FREE_AGENT_SIGNING"},{"date":"2008-07-19","description":"Juan Castro: traded, Colorado Rockies to Baltimore Orioles. Retrosheet transaction 64012, 2008-07-19.","from":"COL","historical_label":"Traded","key":"CAREER_20080719_TRADE_COL_BAL_JUAN_CASTRO","player_slug":"juan-castro","source_reference":"Retrosheet transaction 64012","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"BAL","type":"TRADE"},{"date":"1998-07-31","description":"Juan Guzmán: traded, Toronto Blue Jays to Baltimore Orioles. Retrosheet transaction 63020, 1998-07-31.","from":"TOR","historical_label":"Traded","key":"CAREER_19980731_TRADE_TOR_BAL_JUAN_GUZMAN","player_slug":"juan-guzman","source_reference":"Retrosheet transaction 63020","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"BAL","type":"TRADE"},{"date":"1999-07-31","description":"Juan Guzmán: traded, Baltimore Orioles to Cincinnati Reds. Retrosheet transaction 63120, 1999-07-31.","from":"BAL","historical_label":"Traded","key":"CAREER_19990731_TRADE_BAL_CIN_JUAN_GUZMAN","player_slug":"juan-guzman","source_reference":"Retrosheet transaction 63120","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"CIN","type":"TRADE"},{"date":"2000-06-12","description":"Karim García: conditional deal, Detroit Tigers to Baltimore Orioles. Retrosheet transaction 18076, 2000-06-12.","from":"DET","historical_label":"Conditional deal","key":"CAREER_20000612_TRADE_DET_BAL_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 18076","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"BAL","type":"TRADE"},{"date":"2002-07-02","description":"Karim García released by the New York Yankees. Retrosheet transaction 18081, 2002-07-02. Who signed him next is a separate transaction.","from":"NYY","historical_label":"Released","key":"CAREER_20020702_RELEASE_NYY_NONE_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 18081","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2002-07-12","description":"Karim García signed by the Cleveland Guardians as a free agent. Retrosheet transaction 18082, 2002-07-12. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20020712_FREE_AGENT_SIGNING_NONE_CLE_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 18082","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"CLE","type":"FREE_AGENT_SIGNING"},{"date":"2003-06-25","description":"Karim García: purchased, Cleveland Guardians to New York Yankees. Retrosheet transaction 18083, 2003-06-25.","from":"CLE","historical_label":"Purchased","key":"CAREER_20030625_PURCHASE_CLE_NYY_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 18083","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"NYY","type":"PURCHASE"},{"date":"2004-07-19","description":"Karim García: traded, New York Mets to Baltimore Orioles. Retrosheet transaction 63633, 2004-07-19.","from":"NYM","historical_label":"Traded","key":"CAREER_20040719_TRADE_NYM_BAL_KARIM_GARCIA","player_slug":"karim-garcia","source_reference":"Retrosheet transaction 63633","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"BAL","type":"TRADE"},{"date":"1997-07-25","description":"Omar Daal: claimed off waivers, Washington Nationals to Toronto Blue Jays. Retrosheet transaction 11937, 1997-07-25.","from":"WSH","historical_label":"Claimed off waivers","key":"CAREER_19970725_WAIVER_CLAIM_WSH_TOR_OMAR_DAAL","player_slug":"omar-daal","source_reference":"Retrosheet transaction 11937","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"TOR","type":"WAIVER_CLAIM"},{"date":"2000-07-26","description":"Omar Daal: traded, Arizona Diamondbacks to Philadelphia Phillies. Retrosheet transaction 63220, 2000-07-26.","from":"ARI","historical_label":"Traded","key":"CAREER_20000726_TRADE_ARI_PHI_OMAR_DAAL","player_slug":"omar-daal","source_reference":"Retrosheet transaction 63220","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"PHI","type":"TRADE"},{"date":"2001-07-31","description":"Pedro Astacio: traded, Colorado Rockies to Houston Astros. Retrosheet transaction 63347, 2001-07-31.","from":"COL","historical_label":"Traded","key":"CAREER_20010731_TRADE_COL_HOU_PEDRO_ASTACIO","player_slug":"pedro-astacio","source_reference":"Retrosheet transaction 63347","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"HOU","type":"TRADE"},{"date":"2005-06-17","description":"Pedro Astacio released by the Texas Rangers. Retrosheet transaction 1645, 2005-06-17. Who signed him next is a separate transaction.","from":"TEX","historical_label":"Released","key":"CAREER_20050617_RELEASE_TEX_NONE_PEDRO_ASTACIO","player_slug":"pedro-astacio","source_reference":"Retrosheet transaction 1645","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2005-06-30","description":"Pedro Astacio signed by the San Diego Padres as a free agent. Retrosheet transaction 1646, 2005-06-30. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20050630_FREE_AGENT_SIGNING_NONE_SD_PEDRO_ASTACIO","player_slug":"pedro-astacio","source_reference":"Retrosheet transaction 1646","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"SD","type":"FREE_AGENT_SIGNING"},{"date":"2002-07-01","description":"Raúl Mondesí: traded, Toronto Blue Jays to New York Yankees. Retrosheet transaction 63429, 2002-07-01.","from":"TOR","historical_label":"Traded","key":"CAREER_20020701_TRADE_TOR_NYY_RAUL_MONDESI","player_slug":"raul-mondesi","source_reference":"Retrosheet transaction 63429","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"NYY","type":"TRADE"},{"date":"2003-07-29","description":"Raúl Mondesí: traded, New York Yankees to Arizona Diamondbacks. Retrosheet transaction 63535, 2003-07-29.","from":"NYY","historical_label":"Traded","key":"CAREER_20030729_TRADE_NYY_ARI_RAUL_MONDESI","player_slug":"raul-mondesi","source_reference":"Retrosheet transaction 63535","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"ARI","type":"TRADE"},{"date":"2004-05-21","description":"Raúl Mondesí released by the Pittsburgh Pirates. Retrosheet transaction 35993, 2004-05-21. Who signed him next is a separate transaction.","from":"PIT","historical_label":"Released","key":"CAREER_20040521_RELEASE_PIT_NONE_RAUL_MONDESI","player_slug":"raul-mondesi","source_reference":"Retrosheet transaction 35993","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"","type":"RELEASE"},{"date":"2004-05-30","description":"Raúl Mondesí signed by the Los Angeles Angels as a free agent. Retrosheet transaction 35994, 2004-05-30. How he left his previous club is a separate transaction.","from":"","historical_label":"Signed as a free agent","key":"CAREER_20040530_FREE_AGENT_SIGNING_NONE_LAA_RAUL_MONDESI","player_slug":"raul-mondesi","source_reference":"Retrosheet transaction 35994","source_url":"https://www.retrosheet.org/transactions/tranDB.zip","to":"LAA","type":"FREE_AGENT_SIGNING"},{"date":"2019-07-31","description":"Yasiel Puig: traded, Cincinnati Reds to Cleveland Guardians. Cincinnati Reds Traded CF Taylor Trammell to San Diego Padres; San Diego Padres Traded RF Franmil Reyes, LHP Logan Allen and 3B Victor Nova to Cleveland Indians; Cincinnati Reds Traded LHP Scott Moss and RF Yasiel Puig to Cleveland Indians and Cleveland Indians Traded RHP Trevor Bauer to Cincinnati Reds. (MLB transaction log, 2019-07-31).","from":"CIN","historical_label":"Traded","key":"CAREER_20190731_TRADE_CIN_CLE_YASIEL_PUIG","player_slug":"yasiel-puig","source_reference":"MLB transaction 420891","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=624577","to":"CLE","type":"TRADE"}],"existing_source_urls":["https://statsapi.mlb.com/api/v1/transactions?playerId=624577","https://statsapi.mlb.com/api/v1/transactions?playerId=678760","https://statsapi.mlb.com/api/v1/transactions?playerId=682616","https://www.retrosheet.org/transactions/tranDB.zip"],"retrieved_at":"2026-10-24T00:00:00Z","sources":[{"notes":"Official transaction log of the player, read for his career moves between clubs other than the Dodgers (054).","source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: Chan Ho Park (120221)","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=120221"},{"notes":"Official transaction log of the player, read for his career moves between clubs other than the Dodgers (054).","source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: Carlos Santana (467793)","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=467793"}]}$m054$::jsonb as j;

create temporary table _m054_before on commit drop as
select
  (select md5(string_agg(t::text, '|' order by t::text)) from (select e::text from public.transaction_events e union all select a::text from public.transaction_event_assets a
     union all select r::text from public.transaction_asset_resolutions r union all select o::text from public.dodgers_control_observations o
     union all select x::text from public.transactions x) t(t)) as ledger_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t) as stints_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t) as milestones_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t) as decisions_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t) as audits_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from public.player_mlb_team_season_war t) as war_hash,
  (select md5(string_agg(t::text, '|' order by t::text)) from (select r::text from public.signing_financial_reports r union all select s::text from public.signing_financial_resolutions s) t(t)) as costs_hash
from _m054;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 054 was written for
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
  k text;
begin
  if to_regclass('public.product_database_status') is null or to_regprocedure('public.disi_refresh_product_snapshots()') is null then
    raise exception '054: Migration 045b has not been applied';
  end if;
  -- the 053 view reads the player's asset side (pg_get_viewdef drops comments)
  if position('asset_side' in pg_get_viewdef('public.v_dodgers_development_research_queue'::regclass)) = 0 then
    raise exception '054: Migration 053 has not been applied';
  end if;
  for k in select jsonb_array_elements_text(j -> 'existing_source_urls') from _m054 loop
    if not exists (select 1 from public.sources where url = k) then
      raise exception '054: the source % is missing', k;
    end if;
  end loop;
  select count(*) into n from public.sources s, _m054, jsonb_array_elements(j -> 'sources') x
    where s.url = x ->> 'url' and (s.title is distinct from x ->> 'title' or s.notes is distinct from x ->> 'notes' or s.source_type <> x ->> 'source_type');
  if n > 0 then
    raise exception '054: a source 054 adds already exists with other content';
  end if;
  for p in select y from _m054, jsonb_array_elements(j -> 'events') y loop
    if not exists (select 1 from public.players pl where pl.slug = p ->> 'player_slug') then
      raise exception '054: the player % is missing', p ->> 'player_slug';
    end if;
    for k in select unnest(array[nullif(p ->> 'from', ''), nullif(p ->> 'to', '')]) loop
      if k is not null and not exists (select 1 from public.organizations o where o.abbreviation = k and o.franchise_key is distinct from 'DODGERS') then
        raise exception '054: % is not a non-Dodgers organization (a Dodgers transaction belongs in the Dodgers ledger)', k;
      end if;
    end loop;
  end loop;
  -- a rerun finds exactly the reviewed rows; a first run finds no table
  if to_regclass('public.player_career_transactions') is not null then
    select count(*) into n from public.player_career_transactions c
      where c.event_key not in (select y ->> 'key' from _m054, jsonb_array_elements(j -> 'events') y);
    if n > 0 then
      raise exception '054: player_career_transactions holds % rows outside the reviewed set', n;
    end if;
  end if;
end $$;

-- ===========================================================================
-- 2. THE CAREER-HISTORY TABLE (one sourced movement fact about one player, in his direction)
-- ===========================================================================

create table if not exists public.player_career_transactions (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (event_key ~ '^CAREER_[0-9]{8}_[A-Z_]+_[A-Z]{2,4}_[A-Z]{2,4}_[A-Z0-9_]+$'),
  player_id uuid not null references public.players(id) on delete restrict,
  transaction_date date not null,
  transaction_type text not null check (transaction_type in ('TRADE', 'WAIVER_CLAIM', 'PURCHASE', 'RELEASE', 'FREE_AGENT_SIGNING')),
  from_organization_id uuid references public.organizations(id) on delete restrict,
  to_organization_id uuid references public.organizations(id) on delete restrict,
  historical_label text check (historical_label is null or char_length(btrim(historical_label)) between 1 and 200),
  description text not null check (char_length(btrim(description)) between 1 and 600),
  source_id uuid not null references public.sources(id) on delete restrict,
  source_reference text not null check (source_reference ~ '^(MLB transaction|Retrosheet transaction) [0-9]+$'),
  created_at timestamptz not null default now(),
  -- the mechanism fixes the shape: a move names both clubs; a release has no destination; a signing has no origin
  constraint player_career_transactions_shape_check check (
    (transaction_type in ('TRADE', 'WAIVER_CLAIM', 'PURCHASE') and from_organization_id is not null and to_organization_id is not null and from_organization_id <> to_organization_id)
    or (transaction_type = 'RELEASE' and from_organization_id is not null and to_organization_id is null)
    or (transaction_type = 'FREE_AGENT_SIGNING' and from_organization_id is null and to_organization_id is not null))
);
create unique index if not exists player_career_transactions_fact_key on public.player_career_transactions
  (player_id, transaction_date, transaction_type, coalesce(from_organization_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(to_organization_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists player_career_transactions_player_id_idx on public.player_career_transactions (player_id, transaction_date);
alter table public.player_career_transactions enable row level security;
comment on table public.player_career_transactions is
  'DISI career history (Migration 054): one sourced movement fact about one player between clubs other than the Dodgers, in the player''s direction. Never a Dodgers transaction (those are the Dodgers asset ledger, transaction_events), never a package, a return, a value or an attribution. Chronology evidence only.';
revoke all on table public.player_career_transactions from anon, authenticated;
grant select on table public.player_career_transactions to anon, authenticated;
drop policy if exists public_read_player_career_transactions on public.player_career_transactions;
create policy public_read_player_career_transactions on public.player_career_transactions for select to anon, authenticated using (true);

-- ===========================================================================
-- 3. SOURCES AND THE REVIEWED ROWS
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (j ->> 'retrieved_at')::timestamptz
from _m054, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

insert into public.player_career_transactions (event_key, player_id, transaction_date, transaction_type, from_organization_id, to_organization_id, historical_label,
  description, source_id, source_reference)
select x ->> 'key', pl.id, (x ->> 'date')::date, x ->> 'type', fo.id, too.id, nullif(x ->> 'historical_label', ''), x ->> 'description', so.id, x ->> 'source_reference'
from _m054 cross join jsonb_array_elements(j -> 'events') x
join public.players pl on pl.slug = x ->> 'player_slug'
left join public.organizations fo on fo.abbreviation = nullif(x ->> 'from', '')
left join public.organizations too on too.abbreviation = nullif(x ->> 'to', '')
join public.sources so on so.url = x ->> 'source_url'
on conflict (event_key) do nothing;

-- ===========================================================================
-- 4. THE PLAYER'S TRANSACTION STREAM (both layers, in his direction, each labelled)
-- ===========================================================================

create or replace view public.v_player_career_transactions
with (security_invoker = true)
as
select a.player_id, p.slug as player_slug, e.event_key, e.transaction_date, e.transaction_type,
  case when a.asset_side = 'INCOMING' then tor.abbreviation else fo.abbreviation end as from_organization,
  case when a.asset_side = 'INCOMING' then fo.abbreviation else tor.abbreviation end as to_organization,
  'DODGERS_LEDGER'::text as layer, e.historical_label, e.description, src.url as source_url
from public.transaction_event_assets a
join public.transaction_events e on e.id = a.event_id
join public.players p on p.id = a.player_id
left join public.organizations fo on fo.id = e.from_organization_id
left join public.organizations tor on tor.id = e.to_organization_id
left join public.sources src on src.id = coalesce(a.source_id, e.source_id)
where a.player_id is not null and a.asset_type = 'PLAYER'
union all
select c.player_id, p.slug, c.event_key, c.transaction_date, c.transaction_type, fo.abbreviation, tor.abbreviation,
  'CAREER_HISTORY'::text, c.historical_label, c.description, src.url
from public.player_career_transactions c
join public.players p on p.id = c.player_id
left join public.organizations fo on fo.id = c.from_organization_id
left join public.organizations tor on tor.id = c.to_organization_id
left join public.sources src on src.id = c.source_id;
comment on view public.v_player_career_transactions is
  'DISI (Migration 054): a player''s transactions in his own direction. DODGERS_LEDGER rows are the Dodgers asset ledger (packages, returns and value live there); CAREER_HISTORY rows are his moves between other clubs (chronology only). A consumer must never read a CAREER_HISTORY row as a Dodgers exit, acquisition, package or return.';
revoke all on table public.v_player_career_transactions from anon, authenticated;
grant select on table public.v_player_career_transactions to anon, authenticated;

insert into public.disi_product_contract (relation_name, relation_kind, product_area, contract_tier, app_routes, purpose, introduced_in)
values ('v_player_career_transactions', 'VIEW', 'DEVELOPMENT', 'DOSSIER', array['/players/[slug]', '/development'],
  'A player''s transaction stream in his direction (Dodgers ledger and career history, labelled) for development chronology', '054')
on conflict (relation_name) do nothing;

-- ===========================================================================
-- 5. RESEARCH QUEUE: the 053 view with the MULTI_ORG_SEASON_UNVERIFIED condition reading career history
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
    -- 054: a move between two clubs other than the Dodgers is explained by career history (player_career_transactions), never by the Dodgers
    -- ledger: a direct move from the first club to the second (a trade, a waiver claim, a purchase), or the player leaving the first club and later
    -- joining the second (two facts: a release or a move to a third club, then a signing or a move from a third club), each between his last game
    -- for the first and his first for the second. The clubs are ordered by first appearance. Career history explains development chronology only:
    -- no asset, package, control-interval or value view reads it.
    exists (
      select 1
      from (
        select s.season from team_stints s
        where s.player_id = p.id and s.organization_id is not null
        group by s.season
        having count(distinct s.organization_id) >= 2
      ) ms
      cross join lateral (
        select
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name limit 1) as org_a,
          (select s.organization_id from team_stints s join public.organizations o on o.id = s.organization_id
            where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            group by s.organization_id, o.name order by min(s.first_game_date), o.name offset 1 limit 1) as org_b
      ) ord0
      cross join lateral (
        select ord0.org_a, ord0.org_b,
          (select max(s.last_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_a) as last_a,
          (select min(s.first_game_date) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id = ord0.org_b) as first_b
      ) ord
      where not (
        (select count(distinct s.organization_id) from team_stints s where s.player_id = p.id and s.season = ms.season and s.organization_id is not null) = 2
        and not exists (
          select 1 from team_stints s
          where s.player_id = p.id and s.season = ms.season and s.organization_id is not null
            and (s.first_game_date is null or s.last_game_date is null))
        and ((
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
                 where s.player_id = p.id and s.season = ms.season and s.organization_id = mv.to_org) >= e.transaction_date)
          + (select count(*) from public.player_career_transactions c
              where c.player_id = p.id and extract(year from c.transaction_date)::int = ms.season
                and c.from_organization_id = ord.org_a and c.to_organization_id = ord.org_b
                and c.transaction_date >= ord.last_a and c.transaction_date <= ord.first_b)
          + (select count(*) from public.player_career_transactions x
              join public.player_career_transactions y on y.player_id = x.player_id and y.id <> x.id
              where x.player_id = p.id and extract(year from x.transaction_date)::int = ms.season and extract(year from y.transaction_date)::int = ms.season
                and x.from_organization_id = ord.org_a and x.to_organization_id is distinct from ord.org_b
                and y.to_organization_id = ord.org_b and y.from_organization_id is distinct from ord.org_a
                and x.transaction_date >= ord.last_a and x.transaction_date <= ord.first_b
                and y.transaction_date >= ord.last_a and y.transaction_date <= ord.first_b
                and x.transaction_date <= y.transaction_date)
          ) = 1)
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
-- 6. POSTCONDITIONS
-- ===========================================================================

do $$
declare
  rec jsonb;
  n int;
  b record;
begin
  select * into b from _m054_before;
  for rec in select y from _m054, jsonb_array_elements(j -> 'events') y loop
    select count(*) into n from public.player_career_transactions c
      join public.players pl on pl.id = c.player_id
      left join public.organizations fo on fo.id = c.from_organization_id
      left join public.organizations too on too.id = c.to_organization_id
      where c.event_key = rec ->> 'key' and pl.slug = rec ->> 'player_slug' and c.transaction_date = (rec ->> 'date')::date and c.transaction_type = rec ->> 'type'
        and coalesce(fo.abbreviation, '') = rec ->> 'from' and coalesce(too.abbreviation, '') = rec ->> 'to' and c.source_reference = rec ->> 'source_reference';
    if n <> 1 then
      raise exception '054 postcondition: the career move % is not recorded exactly as reviewed', rec ->> 'key';
    end if;
  end loop;
  if (select count(*) from public.player_career_transactions) <> (select jsonb_array_length(j -> 'events') from _m054) then
    raise exception '054 postcondition: player_career_transactions holds rows outside the reviewed set';
  end if;
  select count(*) into n from public.player_career_transactions c
    left join public.organizations fo on fo.id = c.from_organization_id left join public.organizations too on too.id = c.to_organization_id
    where fo.franchise_key = 'DODGERS' or too.franchise_key = 'DODGERS';
  if n > 0 then
    raise exception '054 postcondition: % career rows touch a Dodgers organization', n;
  end if;
  -- nothing else changed: the Dodgers ledger, development, outcome, WAR and cost rows are byte-identical
  if b.ledger_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from (select e::text from public.transaction_events e union all select a::text from public.transaction_event_assets a
       union all select r::text from public.transaction_asset_resolutions r union all select o::text from public.dodgers_control_observations o
       union all select x::text from public.transactions x) t(t)) then
    raise exception '054 postcondition: the Dodgers asset ledger changed; career history never writes it';
  end if;
  if b.stints_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.player_season_stints t)
     or b.milestones_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.development_milestones t)
     or b.decisions_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.development_progression_decisions t) then
    raise exception '054 postcondition: a development row changed';
  end if;
  if b.audits_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.outcome_audits t)
     or b.war_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from public.player_mlb_team_season_war t)
     or b.costs_hash is distinct from (select md5(string_agg(t::text, '|' order by t::text)) from (select r::text from public.signing_financial_reports r union all select s::text from public.signing_financial_resolutions s) t(t)) then
    raise exception '054 postcondition: an outcome audit, a WAR row or an acquisition cost changed';
  end if;
  -- career history reaches no asset, package, control or value view: only the stream and the research queue read it
  select count(*) into n from (
    select distinct v.relname from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
    where d.refobjid = 'public.player_career_transactions'::regclass and v.relname <> 'player_career_transactions') x
    where x.relname not in ('v_player_career_transactions', 'v_dodgers_development_research_queue');
  if n > 0 then
    raise exception '054 postcondition: % views outside the chronology read career history', n;
  end if;
end $$;

-- ===========================================================================
-- 7. GENERATION: one coherent refresh, only when a snapshot drifts (the executive snapshot counts the product contract)
-- ===========================================================================

do $$
begin
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    perform * from public.disi_refresh_product_snapshots();
  end if;
end $$;

commit;
