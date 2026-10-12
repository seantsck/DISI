-- DISI v0.25
-- 034_downstream_organizational_value_chains.sql
-- Downstream organizational value chains: how organizational value continues beyond the first trade hop, with strict
-- package attribution, bounded Dodgers control intervals and no double-counting. Run after 033.
--
-- Built from database/research/034/ (exit-seed.json, timing-seed.json, war-seed.json, scope-config.json, audit.mjs, build.mjs).
--
-- What this is. Source-backed facts (the later exits of first-hop return assets, chronology facts, return-asset
-- team-season bWAR) and derived views. The factual transaction graph is not stored twice: lineage is derived by a
-- cycle-safe recursive traversal of canonical transaction events and assets; there is no edge table.
--
-- What it does:
--   * Extends transaction_events.transaction_type with FREE_AGENT_SIGNING (a re-signing starts a new control interval).
--   * Adds transaction_asset_timing_observations (sealed, append-only chronology facts: first / last Dodgers appearance,
--     season start after acquisition, exit bounded before a date). Distinct from dodgers_control_observations, which
--     states a bounded state through a date.
--   * Backfills the researched exit events of first-hop return assets and the second-round exits visible on the same
--     sources, their assets and stable identities, three placeholder resolutions, asset observations and timing facts.
--   * Loads Baseball-Reference team-season bWAR (same two data files and checksums as 032 / 033) for the newly surfaced
--     downstream PLAYER assets.
--   * Adds v_player_control_intervals, v_transaction_asset_lineage, v_transaction_package_lineage and
--     v_downstream_organizational_realization, and amends v_dodgers_international_value_portfolio,
--     v_value_research_queue and v_transaction_research_queue additively. The 032 / 033 first-hop columns are preserved.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/034/)
-- ===========================================================================

create temporary table _m034 on commit drop as
select $m034${"asset_observations":[{"asset":{"event":"LAD_BOS_2020_JETER_DOWNS","name":"Mookie Betts","side":"INCOMING"},"confidence":"HIGH","note":"The official transaction log shows continued Dodgers activity and no exit through the date.","observed_through":"2026-10-11","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=605141","type":"DODGERS_CONTROL_OBSERVED"},{"asset":{"event":"LAD_COL_2026_NICK_FRASSO","name":"Seth Halvorsen","side":"INCOMING"},"confidence":"HIGH","note":"Optioned to Oklahoma City 2026-09-20; no exit through the date.","observed_through":"2026-10-11","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=678020","type":"DODGERS_CONTROL_OBSERVED"},{"asset":{"event":"LAD_NYM_2026_CHAYCE_MCDERMOTT","name":"Ben Rortvedt","side":"INCOMING"},"confidence":"HIGH","note":"Outrighted to Oklahoma City 2026-09-03; no exit through the date.","observed_through":"2026-10-11","source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=666163","type":"DODGERS_CONTROL_OBSERVED"},{"asset":{"event":"LAD_FREE_AGENT_SIGNING_2008_CASEY_BLAKE","name":"Casey Blake","side":"INCOMING"},"confidence":"HIGH","note":"The last MLB team-season in the Baseball-Reference files (2011) is with the Dodgers; no exit transaction is recorded.","observed_through":"2026-10-11","source_url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml","type":"CAREER_ENDED_WITH_DODGERS"}],"events":[{"assets":[{"bref_id":"flowebe01","cash":null,"cp":"NYY","mlb_id":"114256","name":"Ben Flowers","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"fridlji01","cash":null,"cp":"NYY","mlb_id":"114434","name":"Jim Fridley","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"1957-05-24","description":"Traded Ben Flowers to the New York Yankees. Received Jim Fridley.","from":"BRO","key":"BRO_NYY_1957_BEN_FLOWERS","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/BRO/1957-transactions.shtml","to":"NYY","type":"TRADE"},{"assets":[{"bref_id":"valoel01","cash":null,"cp":null,"mlb_id":"123623","name":"Elmer Valo","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"1958-12-31","description":"Released Elmer Valo.","from":"LAD","key":"LAD_RELEASE_1958_ELMER_VALO","label":"Released (Baseball-Reference: \"Before 1959 Season\"; exact date unknown, placed at the end of the 1958 season)","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1958-transactions.shtml","to":null,"type":"RELEASE"},{"assets":[{"bref_id":"fridlji01","cash":null,"cp":"DET","mlb_id":"114434","name":"Jim Fridley","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"1958-04-10","description":"Jim Fridley player rights sold to the Detroit Tigers. (Date given is approximate. Exact date is uncertain.)","from":"LAD","key":"LAD_DET_1958_JIM_FRIDLEY","label":"Player rights sold (Baseball-Reference: the date is approximate)","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1958-transactions.shtml","to":"DET","type":"SALE"},{"assets":[{"bref_id":"burrila01","cash":null,"cp":"NYM","mlb_id":"111768","name":"Larry Burright","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"harknti01","cash":null,"cp":"NYM","mlb_id":"115479","name":"Tim Harkness","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"millebo04","cash":null,"cp":"NYM","mlb_id":"119112","name":"Bob Miller","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"1962-11-30","description":"Traded Larry Burright and Tim Harkness to the New York Mets. Received Bob Miller.","from":"LAD","key":"LAD_NYM_1962_TIM_HARKNESS","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1962-transactions.shtml","to":"NYM","type":"TRADE"},{"assets":[{"bref_id":"sharpmi01","cash":null,"cp":null,"mlb_id":"122066","name":"Mike Sharperson","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"1993-10-08","description":"Mike Sharperson granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_1993_MIKE_SHARPERSON","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1993-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"sharpmi01","cash":null,"cp":null,"mlb_id":"122066","name":"Mike Sharperson","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"1994-02-23","description":"Signed Mike Sharperson as a free agent.","from":"LAD","key":"LAD_FREE_AGENT_SIGNING_1994_MIKE_SHARPERSON","label":"Signed as a free agent","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1994-transactions.shtml","to":null,"type":"FREE_AGENT_SIGNING"},{"assets":[{"bref_id":"sharpmi01","cash":null,"cp":null,"mlb_id":"122066","name":"Mike Sharperson","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"1994-04-02","description":"Released Mike Sharperson.","from":"LAD","key":"LAD_RELEASE_1994_MIKE_SHARPERSON","label":"Released","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1994-transactions.shtml","to":null,"type":"RELEASE"},{"assets":[{"bref_id":"brewebi01","cash":null,"cp":"NYY","mlb_id":"111447","name":"Billy Brewer","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"juddmi01","cash":null,"cp":"NYY","mlb_id":"116781","name":"Mike Judd","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"1996-06-22","description":"Traded Billy Brewer to the New York Yankees. Received Mike Judd.","from":"LAD","key":"LAD_NYY_1996_BILLY_BREWER","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1996-transactions.shtml","to":"NYY","type":"TRADE"},{"assets":[{"bref_id":"deshide01","cash":null,"cp":null,"mlb_id":"113291","name":"Delino DeShields","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"1996-10-29","description":"Delino DeShields granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_1996_DELINO_DESHIELDS","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1996-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"mcmicgr01","cash":null,"cp":"NYM","mlb_id":"118825","name":"Greg McMichael","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":null,"cash":null,"cp":"NYM","mlb_id":null,"name":"Cash","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"CASH"},{"bref_id":"bohanbr01","cash":null,"cp":"NYM","mlb_id":"111155","name":"Brian Bohanon","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"1998-07-10","description":"Traded Greg McMichael and cash to the New York Mets. Received Brian Bohanon.","from":"LAD","key":"LAD_NYM_1998_GREG_MCMICHAEL","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1998-transactions.shtml","to":"NYM","type":"TRADE"},{"assets":[{"bref_id":"bohanbr01","cash":null,"cp":null,"mlb_id":"111155","name":"Brian Bohanon","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"1998-10-27","description":"Brian Bohanon granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_1998_BRIAN_BOHANON","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1998-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"mlickda01","cash":null,"cp":"DET","mlb_id":"119211","name":"Dave Mlicki","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"rojasme01","cash":null,"cp":"DET","mlb_id":"121404","name":"Mel Rojas","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":null,"cash":null,"cp":"DET","mlb_id":null,"name":"Apostol Garcia","note":null,"pool":null,"register_id":"garcia002apo","side":"INCOMING","type":"PLAYER"},{"bref_id":null,"cash":null,"cp":"DET","mlb_id":null,"name":"Rick Roberts","note":null,"pool":null,"register_id":"robert001ric","side":"INCOMING","type":"PLAYER"},{"bref_id":"checoro01","cash":null,"cp":"DET","mlb_id":"112226","name":"Robinson Checo","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"1999-04-16","description":"Traded Dave Mlicki and Mel Rojas to the Detroit Tigers. Received Apostol Garcia (minors), Rick Roberts (minors) and Robinson Checo.","from":"LAD","key":"LAD_DET_1999_DAVE_MLICKI","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/1999-transactions.shtml","to":"DET","type":"TRADE"},{"assets":[{"bref_id":"hundlto01","cash":null,"cp":null,"mlb_id":"116316","name":"Todd Hundley","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2000-10-27","description":"Todd Hundley granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2000_TODD_HUNDLEY","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2000-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"juddmi01","cash":null,"cp":"TB","mlb_id":"116781","name":"Mike Judd","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2001-03-28","description":"Sent Mike Judd to the Tampa Bay Devil Rays as part of a conditional deal.","from":"LAD","key":"LAD_TB_2001_MIKE_JUDD","label":"Sent as part of a conditional deal (Baseball-Reference); no incoming consideration is recorded","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2000-transactions.shtml","to":"TB","type":"TRADE"},{"assets":[{"bref_id":"barryje01","cash":null,"cp":"CWS","mlb_id":"110633","name":"Jeff Barry","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"majewga01","cash":null,"cp":"CWS","mlb_id":"400008","name":"Gary Majewski","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"masaoon01","cash":null,"cp":"CWS","mlb_id":"150385","name":"Onan Masaoka","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"baldwja01","cash":null,"cp":"CWS","mlb_id":"110503","name":"James Baldwin","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":null,"cash":null,"cp":"CWS","mlb_id":null,"name":"Cash","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"CASH"}],"date":"2001-07-26","description":"Traded Jeff Barry, Gary Majewski and Onan Masaoka to the Chicago White Sox. Received James Baldwin and cash.","from":"LAD","key":"LAD_CWS_2001_GARY_MAJEWSKI","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2001-transactions.shtml","to":"CWS","type":"TRADE"},{"assets":[{"bref_id":"baldwja01","cash":null,"cp":null,"mlb_id":"110503","name":"James Baldwin","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2001-11-05","description":"James Baldwin granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2001_JAMES_BALDWIN","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2001-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"adamste01","cash":null,"cp":null,"mlb_id":"110067","name":"Terry Adams","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2001-11-05","description":"Terry Adams granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2001_TERRY_ADAMS","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2001-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":null,"cash":null,"cp":"TOR","mlb_id":null,"name":"Chad Ricketts","note":null,"pool":null,"register_id":"ricket001rob","side":"OUTGOING","type":"PLAYER"},{"bref_id":"prokolu01","cash":null,"cp":"TOR","mlb_id":"150389","name":"Luke Prokopec","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"izturce01","cash":null,"cp":"TOR","mlb_id":"285131","name":"C\u00e9sar Izturis","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":"quantpa01","cash":null,"cp":"TOR","mlb_id":"120824","name":"Paul Quantrill","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2001-12-13","description":"Traded Chad Ricketts (minors) and Luke Prokopec to the Toronto Blue Jays. Received C\u00e9sar Izturis and Paul Quantrill.","from":"LAD","key":"LAD_TOR_2001_CHAD_RICKETTS","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2001-transactions.shtml","to":"TOR","type":"TRADE"},{"assets":[{"bref_id":null,"cash":null,"cp":"WSH","mlb_id":null,"name":"Jorge N\u00fa\u00f1ez","note":null,"pool":null,"register_id":"nunez-001jor","side":"OUTGOING","type":"PLAYER"},{"bref_id":"hergema01","cash":null,"cp":"WSH","mlb_id":"150382","name":"Matt Herges","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"motagu01","cash":null,"cp":"WSH","mlb_id":"150407","name":"Guillermo Mota","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":"ruanwi01","cash":null,"cp":"WSH","mlb_id":"400118","name":"Wilkin Ruan","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2002-03-23","description":"Traded Jorge Nu\u00f1ez (minors) and Matt Herges to the Montreal Expos. Received Guillermo Mota and Wilkin Ruan.","from":"LAD","key":"LAD_WSH_2002_JORGE_NUNEZ","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2002-transactions.shtml","to":"WSH","type":"TRADE"},{"assets":[{"bref_id":"grudzma01","cash":null,"cp":"CHC","mlb_id":"115210","name":"Mark Grudzielanek","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"karroer01","cash":null,"cp":"CHC","mlb_id":"116852","name":"Eric Karros","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"hermach01","cash":null,"cp":"CHC","mlb_id":"150252","name":"Chad Hermansen","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":"hundlto01","cash":null,"cp":"CHC","mlb_id":"116316","name":"Todd Hundley","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2002-12-04","description":"Traded Mark Grudzielanek and Eric Karros to the Chicago Cubs. Received Chad Hermansen and Todd Hundley.","from":"LAD","key":"CHC_LAD_2002_TODD_HUNDLEY","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2002-transactions.shtml","to":"CHC","type":"TRADE"},{"assets":[{"bref_id":"quantpa01","cash":null,"cp":null,"mlb_id":"120824","name":"Paul Quantrill","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2003-10-30","description":"Paul Quantrill granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2003_PAUL_QUANTRILL","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2003-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"hermach01","cash":null,"cp":null,"mlb_id":"150252","name":"Chad Hermansen","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2003-11-20","description":"Released Chad Hermansen.","from":"LAD","key":"LAD_RELEASE_2003_CHAD_HERMANSEN","label":"Released","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2003-transactions.shtml","to":null,"type":"RELEASE"},{"assets":[{"bref_id":"ruanwi01","cash":null,"cp":null,"mlb_id":"400118","name":"Wilkin Ruan","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2004-06-19","description":"Released Wilkin Ruan.","from":"LAD","key":"LAD_RELEASE_2004_WILKIN_RUAN","label":"Released","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2004-transactions.shtml","to":null,"type":"RELEASE"},{"assets":[{"bref_id":"encarju01","cash":null,"cp":"MIA","mlb_id":"113845","name":"Juan Encarnaci\u00f3n","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"loducpa01","cash":null,"cp":"MIA","mlb_id":"134001","name":"Paul Lo Duca","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"motagu01","cash":null,"cp":"MIA","mlb_id":"150407","name":"Guillermo Mota","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"choihe01","cash":null,"cp":"MIA","mlb_id":"400292","name":"Hee-Seop Choi","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":"murphbi02","cash":null,"cp":"MIA","mlb_id":"430889","name":"Bill Murphy","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":"pennybr01","cash":null,"cp":"MIA","mlb_id":"207267","name":"Brad Penny","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2004-07-30","description":"Traded Juan Encarnaci\u00f3n, Paul Lo Duca and Guillermo Mota to the Florida Marlins. Received Hee-Seop Choi, Bill Murphy and Brad Penny.","from":"LAD","key":"LAD_MIA_2004_GUILLERMO_MOTA","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2004-transactions.shtml","to":"MIA","type":"TRADE"},{"assets":[{"bref_id":null,"cash":null,"cp":"ARI","mlb_id":null,"name":"Reggie Abercrombie","note":null,"pool":null,"register_id":"abercr001reg","side":"OUTGOING","type":"PLAYER"},{"bref_id":"hillko01","cash":null,"cp":"ARI","mlb_id":"425542","name":"Koyie Hill","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"murphbi02","cash":null,"cp":"ARI","mlb_id":"430889","name":"Bill Murphy","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"finlest01","cash":null,"cp":"ARI","mlb_id":"114135","name":"Steve Finley","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":"maynebr01","cash":null,"cp":"ARI","mlb_id":"118490","name":"Brent Mayne","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2004-07-31","description":"Traded Reggie Abercrombie (minors), Koyie Hill and Bill Murphy to the Arizona Diamondbacks. Received Steve Finley and Brent Mayne.","from":"LAD","key":"LAD_ARI_2004_BILL_MURPHY","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2004-transactions.shtml","to":"ARI","type":"TRADE"},{"assets":[{"bref_id":"hundlto01","cash":null,"cp":null,"mlb_id":"116316","name":"Todd Hundley","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2004-10-29","description":"Todd Hundley granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2004_TODD_HUNDLEY","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2004-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"greensh01","cash":null,"cp":"ARI","mlb_id":"115094","name":"Shawn Green","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":null,"cash":null,"cp":"ARI","mlb_id":null,"name":"William Ju\u00e1rez","note":null,"pool":null,"register_id":"juarez001wil","side":"INCOMING","type":"PLAYER"},{"bref_id":null,"cash":null,"cp":"ARI","mlb_id":null,"name":"Danny Muegge","note":null,"pool":null,"register_id":"muegge001dan","side":"INCOMING","type":"PLAYER"},{"bref_id":"navardi01","cash":null,"cp":"ARI","mlb_id":"425900","name":"Dioner Navarro","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":"perezbe01","cash":null,"cp":"ARI","mlb_id":"425558","name":"Beltr\u00e1n P\u00e9rez","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2005-01-11","description":"Traded Shawn Green to the Arizona Diamondbacks. Received William Juarez (minors), Danny Muegge (minors), Dioner Navarro and Beltr\u00e1n P\u00e9rez.","from":"LAD","key":"LAD_ARI_2005_SHAWN_GREEN","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2004-transactions.shtml","to":"ARI","type":"TRADE"},{"assets":[{"bref_id":"choihe01","cash":null,"cp":"BOS","mlb_id":"400292","name":"Hee-Seop Choi","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2006-03-24","description":"Hee-Seop Choi selected by the Boston Red Sox off waivers.","from":"LAD","key":"LAD_WAIVER_2006_HEE_SEOP_CHOI","label":"Selected off waivers by the Boston Red Sox","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2006-transactions.shtml","to":"BOS","type":"WAIVER"},{"assets":[{"bref_id":"navardi01","cash":null,"cp":"TB","mlb_id":"425900","name":"Dioner Navarro","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"seoja01","cash":null,"cp":"TB","mlb_id":"150242","name":"Jae Weong Seo","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":null,"cash":null,"cp":"TB","mlb_id":null,"name":"Player to be named later","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER_TO_BE_NAMED"},{"bref_id":"ruggiju01","cash":null,"cp":"TB","mlb_id":"448605","name":"Justin Ruggiano","note":"Completed the trade on 2006-07-19.","pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"hallto02","cash":null,"cp":"TB","mlb_id":"150134","name":"Toby Hall","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":"hendrma01","cash":null,"cp":"TB","mlb_id":"424805","name":"Mark Hendrickson","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"},{"bref_id":null,"cash":null,"cp":"TB","mlb_id":null,"name":"Cash","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"CASH"}],"date":"2006-06-27","description":"Traded a player to be named later, Dioner Navarro and Jae Weong Seo to the Tampa Bay Devil Rays. Received Toby Hall, Mark Hendrickson and cash. The Los Angeles Dodgers sent Justin Ruggiano (July 19, 2006) to the Tampa Bay Devil Rays to complete the trade.","from":"LAD","key":"LAD_TB_2006_DIONER_NAVARRO","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2006-transactions.shtml","to":"TB","type":"TRADE"},{"assets":[{"bref_id":"izturce01","cash":null,"cp":"CHC","mlb_id":"285131","name":"C\u00e9sar Izturis","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"maddugr01","cash":null,"cp":"CHC","mlb_id":"118120","name":"Greg Maddux","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2006-07-31","description":"Traded C\u00e9sar Izturis to the Chicago Cubs. Received Greg Maddux.","from":"LAD","key":"LAD_CHC_2006_CESAR_IZTURIS","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2006-transactions.shtml","to":"CHC","type":"TRADE"},{"assets":[{"bref_id":"maddugr01","cash":null,"cp":null,"mlb_id":"118120","name":"Greg Maddux","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2006-10-31","description":"Greg Maddux granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2006_GREG_MADDUX","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2006-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"hallto02","cash":null,"cp":null,"mlb_id":"150134","name":"Toby Hall","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2006-10-31","description":"Toby Hall granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2006_TOBY_HALL","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2006-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"betemwi01","cash":null,"cp":"NYY","mlb_id":"400140","name":"Wilson Betemit","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"},{"bref_id":"proctsc01","cash":null,"cp":"NYY","mlb_id":"429984","name":"Scott Proctor","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2007-07-31","description":"Traded Wilson Betemit to the New York Yankees. Received Scott Proctor.","from":"LAD","key":"LAD_NYY_2007_WILSON_BETEMIT","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2007-transactions.shtml","to":"NYY","type":"TRADE"},{"assets":[{"bref_id":"hendrma01","cash":null,"cp":null,"mlb_id":"424805","name":"Mark Hendrickson","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2007-12-12","description":"Mark Hendrickson granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2007_MARK_HENDRICKSON","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2007-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":null,"cash":null,"cp":"SD","mlb_id":null,"name":"Player to be named later #1","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER_TO_BE_NAMED"},{"bref_id":null,"cash":null,"cp":"SD","mlb_id":null,"name":"Player to be named later #2","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER_TO_BE_NAMED"},{"bref_id":null,"cash":null,"cp":"SD","mlb_id":null,"name":"Eduardo P\u00e9rez","note":"Completed the trade on 2008-09-30.","pool":null,"register_id":"perez-005edu","side":"OUTGOING","type":"PLAYER"},{"bref_id":null,"cash":null,"cp":"SD","mlb_id":null,"name":"Mike Watt","note":"Completed the trade on 2008-09-30.","pool":null,"register_id":"watt--001mic","side":"OUTGOING","type":"PLAYER"},{"bref_id":"maddugr01","cash":null,"cp":"SD","mlb_id":"118120","name":"Greg Maddux","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2008-08-19","description":"Traded players to be named later to the San Diego Padres. Received Greg Maddux. The Los Angeles Dodgers sent Eduardo Perez (minors) (September 30, 2008) and Mike Watt (minors) (September 30, 2008) to the San Diego Padres to complete the trade.","from":"LAD","key":"SD_LAD_2008_GREG_MADDUX","label":null,"multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml","to":"SD","type":"TRADE"},{"assets":[{"bref_id":"maddugr01","cash":null,"cp":null,"mlb_id":"118120","name":"Greg Maddux","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2008-10-30","description":"Greg Maddux granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2008_GREG_MADDUX","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"blakeca01","cash":null,"cp":null,"mlb_id":"232694","name":"Casey Blake","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2008-10-30","description":"Casey Blake granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2008_CASEY_BLAKE","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"blakeca01","cash":null,"cp":null,"mlb_id":"232694","name":"Casey Blake","note":null,"pool":null,"register_id":null,"side":"INCOMING","type":"PLAYER"}],"date":"2008-12-09","description":"Signed Casey Blake as a free agent.","from":"LAD","key":"LAD_FREE_AGENT_SIGNING_2008_CASEY_BLAKE","label":"Signed as a free agent","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml","to":null,"type":"FREE_AGENT_SIGNING"},{"assets":[{"bref_id":"pennybr01","cash":null,"cp":null,"mlb_id":"207267","name":"Brad Penny","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2008-11-05","description":"Brad Penny granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2008_BRAD_PENNY","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"proctsc01","cash":null,"cp":null,"mlb_id":"429984","name":"Scott Proctor","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2008-12-12","description":"Scott Proctor granted Free Agency.","from":"LAD","key":"LAD_FREE_AGENCY_2008_SCOTT_PROCTOR","label":"Granted free agency","multi":false,"source_url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":null,"cash":null,"cp":null,"mlb_id":"502103","name":"Mike Antonini","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2013-03-27","description":"Albuquerque Isotopes (Los Angeles Dodgers affiliate) released LHP Michael Antonini.","from":"LAD","key":"LAD_RELEASE_2013_MIKE_ANTONINI","label":"Released","multi":false,"source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=502103","to":null,"type":"RELEASE"},{"assets":[{"bref_id":"gyorkje01","cash":null,"cp":null,"mlb_id":"576397","name":"Jedd Gyorko","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2019-11-02","description":"3B Jedd Gyorko elected free agency.","from":"LAD","key":"LAD_FREE_AGENCY_2019_JEDD_GYORKO","label":"Elected free agency","multi":false,"source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=576397","to":null,"type":"FREE_AGENCY"},{"assets":[{"bref_id":"priceda01","cash":null,"cp":null,"mlb_id":"456034","name":"David Price","note":null,"pool":null,"register_id":null,"side":"OUTGOING","type":"PLAYER"}],"date":"2022-11-06","description":"LHP David Price elected free agency.","from":"LAD","key":"LAD_FREE_AGENCY_2022_DAVID_PRICE","label":"Elected free agency","multi":false,"source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=456034","to":null,"type":"FREE_AGENCY"}],"expected_prior_events":161,"expected_total_assets":382,"organizations":["ARI","BOS","BRO","CHC","CWS","DET","LAD","MIA","NYM","NYY","SD","TB","TOR","WSH"],"resolutions":[{"confidence":"VERIFIED","date":"2006-07-19","event":"LAD_TB_2006_DIONER_NAVARRO","note":"The Dodgers sent Justin Ruggiano on July 19, 2006 to complete the trade (Baseball-Reference 2006 Los Angeles Dodgers transactions).","placeholder":["OUTGOING","Player to be named later"],"resolved":["OUTGOING","Justin Ruggiano"],"source_url":"https://www.baseball-reference.com/teams/LAD/2006-transactions.shtml"},{"confidence":"VERIFIED","date":"2008-09-30","event":"SD_LAD_2008_GREG_MADDUX","note":"The Dodgers sent the player on September 30, 2008 to complete the trade (Baseball-Reference 2008 Los Angeles Dodgers transactions).","placeholder":["OUTGOING","Player to be named later #1"],"resolved":["OUTGOING","Eduardo P\u00e9rez"],"source_url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml"},{"confidence":"VERIFIED","date":"2008-09-30","event":"SD_LAD_2008_GREG_MADDUX","note":"The Dodgers sent the player on September 30, 2008 to complete the trade (Baseball-Reference 2008 Los Angeles Dodgers transactions).","placeholder":["OUTGOING","Player to be named later #2"],"resolved":["OUTGOING","Mike Watt"],"source_url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml"}],"retrieved_at":"2026-10-11T00:00:00Z","sources":[{"notes":null,"source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_GAME_LOG","title":"MLB 1999 game log (pitching): player 112226","url":"https://statsapi.mlb.com/api/v1/people/112226/stats?stats=gameLog&season=1999&group=pitching"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_GAME_LOG","title":"MLB 2002 game log (pitching): player 150407","url":"https://statsapi.mlb.com/api/v1/people/150407/stats?stats=gameLog&season=2002&group=pitching"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_GAME_LOG","title":"MLB 2002 game log (hitting): player 400118","url":"https://statsapi.mlb.com/api/v1/people/400118/stats?stats=gameLog&season=2002&group=hitting"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_GAME_LOG","title":"MLB 2026 game log (hitting): player 666163","url":"https://statsapi.mlb.com/api/v1/people/666163/stats?stats=gameLog&season=2026&group=hitting"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_GAME_LOG","title":"MLB 2024 game log (hitting): player 669242","url":"https://statsapi.mlb.com/api/v1/people/669242/stats?stats=gameLog&season=2024&group=hitting"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_GAME_LOG","title":"MLB 2026 game log (pitching): player 694646","url":"https://statsapi.mlb.com/api/v1/people/694646/stats?stats=gameLog&season=2026&group=pitching"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: player 346857","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=346857"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: player 456034","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=456034"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: player 456701","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=456701"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: player 502103","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=502103"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: player 576397","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=576397"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: player 605141","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=605141"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: player 666163","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=666163"},{"notes":null,"source_name":"MLB Stats API","source_tier":"MLB_TRANSACTION_LOG","source_type":"MLB_PLAYER_TRANSACTIONS","title":"MLB transaction log: player 678020","url":"https://statsapi.mlb.com/api/v1/transactions?playerId=678020"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TEAM_SCHEDULE","title":"1957 Brooklyn Dodgers schedule and results","url":"https://www.baseball-reference.com/teams/BRO/1957-schedule-scores.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"1957 Brooklyn Dodgers team transactions","url":"https://www.baseball-reference.com/teams/BRO/1957-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"1958 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/1958-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"1962 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/1962-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"1993 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/1993-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"1994 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/1994-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"1996 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/1996-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"1998 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/1998-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"1999 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/1999-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"2000 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/2000-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"2001 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/2001-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"2002 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/2002-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"2003 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/2003-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"2004 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/2004-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"2006 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/2006-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"2007 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/2007-transactions.shtml"},{"notes":null,"source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"TRANSACTIONS","title":"2008 Los Angeles Dodgers team transactions","url":"https://www.baseball-reference.com/teams/LAD/2008-transactions.shtml"}],"team_map":[],"timing":[{"asset":{"event":"BRO_PHI_1957_FERNANDEZ","name":"Elmer Valo","side":"INCOMING"},"confidence":"VERIFIED","fact_type":"SEASON_START_CONFIRMS_POST_ACQUISITION","note":"Brooklyn's first 1957 regular-season game was 1957-04-16; Valo was acquired 1957-04-05. His only 1957 team-season row is Brooklyn, so the whole season is post-acquisition.","observed_date":"1957-04-16","season":1957,"source_url":"https://www.baseball-reference.com/teams/BRO/1957-schedule-scores.shtml"},{"asset":{"event":"LAD_CWS_2024_JERAL_PEREZ","name":"Tommy Edman","side":"INCOMING"},"confidence":"VERIFIED","fact_type":"FIRST_DODGERS_APPEARANCE","note":"Official game log: 37 games in 2024, all with the Dodgers, the first on 2024-08-19 (acquired 2024-07-29). No 2024 St. Louis game.","observed_date":"2024-08-19","season":2024,"source_url":"https://statsapi.mlb.com/api/v1/people/669242/stats?stats=gameLog&season=2024&group=hitting"},{"asset":{"event":"LAD_BAL_2026_AXEL_PEREZ","name":"Chayce McDermott","side":"INCOMING"},"confidence":"VERIFIED","fact_type":"FIRST_DODGERS_APPEARANCE","note":"Official game log: 2 Dodgers games (2026-05-17 to 2026-06-21) and 3 Mets games from 2026-08-05; acquired 2026-04-16, exited 2026-08-03.","observed_date":"2026-05-17","season":2026,"source_url":"https://statsapi.mlb.com/api/v1/people/694646/stats?stats=gameLog&season=2026&group=pitching"},{"asset":{"event":"LAD_BAL_2026_AXEL_PEREZ","name":"Chayce McDermott","side":"INCOMING"},"confidence":"VERIFIED","fact_type":"LAST_DODGERS_APPEARANCE","note":"Last Dodgers appearance before the 2026-08-03 trade to the Mets.","observed_date":"2026-06-21","season":2026,"source_url":"https://statsapi.mlb.com/api/v1/people/694646/stats?stats=gameLog&season=2026&group=pitching"},{"asset":{"event":"BOS_LAD_2012_GONZALEZ_BECKETT_CRAWFORD","name":"Nick Punto","side":"INCOMING"},"confidence":"HIGH","fact_type":"EXIT_BOUNDED_BEFORE","note":"Oakland signed free agent Nick Punto on 2013-11-13, so Dodgers control had ended by then; the Dodgers exit transaction itself is not in the official log.","observed_date":"2013-11-13","season":null,"source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=346857"},{"asset":{"event":"LAD_CIN_2018_YASIEL_PUIG","name":"Homer Bailey","side":"INCOMING"},"confidence":"HIGH","fact_type":"EXIT_BOUNDED_BEFORE","note":"Kansas City signed free agent Homer Bailey on 2019-02-09, so Dodgers control had ended by then; the Dodgers exit transaction itself is not in the official log.","observed_date":"2019-02-09","season":null,"source_url":"https://statsapi.mlb.com/api/v1/transactions?playerId=456701"},{"asset":{"event":"LAD_NYM_2026_CHAYCE_MCDERMOTT","name":"Ben Rortvedt","side":"INCOMING"},"confidence":"VERIFIED","fact_type":"FIRST_DODGERS_APPEARANCE","note":"Official game log: 16 games in 2026, all with the Dodgers, the first on 2026-08-04 (acquired 2026-08-03). No 2026 Mets game.","observed_date":"2026-08-04","season":2026,"source_url":"https://statsapi.mlb.com/api/v1/people/666163/stats?stats=gameLog&season=2026&group=hitting"},{"asset":{"event":"LAD_WSH_2002_JORGE_NUNEZ","name":"Guillermo Mota","side":"INCOMING"},"confidence":"VERIFIED","fact_type":"FIRST_DODGERS_APPEARANCE","note":"Official game log: 43 games in 2002, all with the Dodgers, the first on 2002-04-21 (acquired 2002-03-23).","observed_date":"2002-04-21","season":2002,"source_url":"https://statsapi.mlb.com/api/v1/people/150407/stats?stats=gameLog&season=2002&group=pitching"},{"asset":{"event":"LAD_WSH_2002_JORGE_NUNEZ","name":"Wilkin Ruan","side":"INCOMING"},"confidence":"VERIFIED","fact_type":"FIRST_DODGERS_APPEARANCE","note":"Official game log: 12 games in 2002, all with the Dodgers, the first on 2002-09-01 (acquired 2002-03-23).","observed_date":"2002-09-01","season":2002,"source_url":"https://statsapi.mlb.com/api/v1/people/400118/stats?stats=gameLog&season=2002&group=hitting"},{"asset":{"event":"LAD_DET_1999_DAVE_MLICKI","name":"Robinson Checo","side":"INCOMING"},"confidence":"VERIFIED","fact_type":"FIRST_DODGERS_APPEARANCE","note":"Official game log: 9 games in 1999, all with the Dodgers, the first on 1999-04-19 (acquired 1999-04-16).","observed_date":"1999-04-19","season":1999,"source_url":"https://statsapi.mlb.com/api/v1/people/112226/stats?stats=gameLog&season=1999&group=pitching"}],"war":{"bat_url":"https://www.baseball-reference.com/data/war_daily_bat.txt","observed_through_date":"2026-09-28","observed_through_season":2026,"pitch_url":"https://www.baseball-reference.com/data/war_daily_pitch.txt","retrieved_at":"2026-10-10T07:36:40Z","rows":[["baldwja01","110503",1995,"CHW",1,"BAT","AL",null,0,0,null],["baldwja01","110503",1995,"CHW",1,"PITCH","AL","-0.79",6,null,44],["baldwja01","110503",1996,"CHW",1,"BAT","AL",null,0,0,null],["baldwja01","110503",1996,"CHW",1,"PITCH","AL","2.54",28,null,507],["baldwja01","110503",1997,"CHW",1,"BAT","AL","-0.06",2,4,null],["baldwja01","110503",1997,"CHW",1,"PITCH","AL","0.46",32,null,600],["baldwja01","110503",1998,"CHW",1,"BAT","AL","-0.03",3,2,null],["baldwja01","110503",1998,"CHW",1,"PITCH","AL","0.10",37,null,477],["baldwja01","110503",1999,"CHW",1,"BAT","AL","0.09",1,2,null],["baldwja01","110503",1999,"CHW",1,"PITCH","AL","2.43",35,null,598],["baldwja01","110503",2000,"CHW",1,"BAT","AL","-0.06",2,5,null],["baldwja01","110503",2000,"CHW",1,"PITCH","AL","2.77",29,null,534],["baldwja01","110503",2001,"CHW",1,"BAT","AL","-0.03",1,2,null],["baldwja01","110503",2001,"CHW",1,"PITCH","AL","0.65",17,null,287],["baldwja01","110503",2001,"LAD",2,"BAT","NL","-0.19",12,27,null],["baldwja01","110503",2001,"LAD",2,"PITCH","NL","1.15",12,null,238],["baldwja01","110503",2002,"SEA",1,"BAT","AL","0.11",1,2,null],["baldwja01","110503",2002,"SEA",1,"PITCH","AL","0.05",30,null,450],["baldwja01","110503",2003,"MIN",1,"BAT","AL",null,0,0,null],["baldwja01","110503",2003,"MIN",1,"PITCH","AL","-0.09",10,null,45],["baldwja01","110503",2004,"NYM",1,"BAT","NL","-0.01",2,2,null],["baldwja01","110503",2004,"NYM",1,"PITCH","NL","-0.45",2,null,18],["baldwja01","110503",2005,"BAL",1,"BAT","AL","-0.01",5,1,null],["baldwja01","110503",2005,"BAL",1,"PITCH","AL","0.53",20,null,118],["baldwja01","110503",2005,"TEX",2,"BAT","AL",null,0,0,null],["baldwja01","110503",2005,"TEX",2,"PITCH","AL","0.13",8,null,52],["bettsmo01","605141",2014,"BOS",1,"BAT","AL","2.28",52,213,null],["bettsmo01","605141",2015,"BOS",1,"BAT","AL","6.01",145,654,null],["bettsmo01","605141",2016,"BOS",1,"BAT","AL","9.79",158,730,null],["bettsmo01","605141",2017,"BOS",1,"BAT","AL","6.49",153,712,null],["bettsmo01","605141",2018,"BOS",1,"BAT","AL","10.74",136,614,null],["bettsmo01","605141",2019,"BOS",1,"BAT","AL","7.23",150,706,null],["bettsmo01","605141",2020,"LAD",1,"BAT","NL","3.67",55,246,null],["bettsmo01","605141",2021,"LAD",1,"BAT","NL","4.06",122,550,null],["bettsmo01","605141",2022,"LAD",1,"BAT","NL","6.71",142,639,null],["bettsmo01","605141",2023,"LAD",1,"BAT","NL","8.58",152,693,null],["bettsmo01","605141",2024,"LAD",1,"BAT","NL","4.64",116,516,null],["bettsmo01","605141",2025,"LAD",1,"BAT","NL","4.87",150,663,null],["bettsmo01","605141",2026,"LAD",1,"BAT","NL","3.94",123,528,null],["bohanbr01","111155",1990,"TEX",1,"BAT","AL",null,0,0,null],["bohanbr01","111155",1990,"TEX",1,"PITCH","AL","-0.88",11,null,102],["bohanbr01","111155",1991,"TEX",1,"BAT","AL","0.00",1,0,null],["bohanbr01","111155",1991,"TEX",1,"PITCH","AL","0.19",11,null,184],["bohanbr01","111155",1992,"TEX",1,"BAT","AL",null,0,0,null],["bohanbr01","111155",1992,"TEX",1,"PITCH","AL","-0.98",18,null,137],["bohanbr01","111155",1993,"TEX",1,"BAT","AL",null,0,0,null],["bohanbr01","111155",1993,"TEX",1,"PITCH","AL","0.11",36,null,278],["bohanbr01","111155",1994,"TEX",1,"BAT","AL",null,0,0,null],["bohanbr01","111155",1994,"TEX",1,"PITCH","AL","-0.21",11,null,112],["bohanbr01","111155",1995,"DET",1,"BAT","AL",null,0,0,null],["bohanbr01","111155",1995,"DET",1,"PITCH","AL","0.65",52,null,317],["bohanbr01","111155",1996,"TOR",1,"BAT","AL",null,0,0,null],["bohanbr01","111155",1996,"TOR",1,"PITCH","AL","-0.43",20,null,66],["bohanbr01","111155",1997,"NYM",1,"BAT","NL","-0.05",20,35,null],["bohanbr01","111155",1997,"NYM",1,"PITCH","NL","0.42",19,null,283],["bohanbr01","111155",1998,"NYM",1,"BAT","NL","0.25",23,14,null],["bohanbr01","111155",1998,"NYM",1,"PITCH","NL","0.83",25,null,163],["bohanbr01","111155",1998,"LAD",2,"BAT","NL","0.17",14,35,null],["bohanbr01","111155",1998,"LAD",2,"PITCH","NL","2.42",14,null,292],["bohanbr01","111155",1999,"COL",1,"BAT","NL","0.08",34,81,null],["bohanbr01","111155",1999,"COL",1,"PITCH","NL","3.10",33,null,592],["bohanbr01","111155",2000,"COL",1,"BAT","NL","0.23",33,67,null],["bohanbr01","111155",2000,"COL",1,"PITCH","NL","3.12",34,null,531],["bohanbr01","111155",2001,"COL",1,"BAT","NL","0.41",20,33,null],["bohanbr01","111155",2001,"COL",1,"PITCH","NL","-0.47",20,null,291],["checoro01","112226",1997,"BOS",1,"BAT","AL",null,0,0,null],["checoro01","112226",1997,"BOS",1,"PITCH","AL","0.31",5,null,40],["checoro01","112226",1998,"BOS",1,"BAT","AL",null,0,0,null],["checoro01","112226",1998,"BOS",1,"PITCH","AL","-0.26",2,null,23],["checoro01","112226",1999,"LAD",1,"BAT","NL","0.04",9,4,null],["checoro01","112226",1999,"LAD",1,"PITCH","NL","-0.75",9,null,47],["choihe01","400292",2002,"CHC",1,"BAT","NL","-0.47",24,57,null],["choihe01","400292",2003,"CHC",1,"BAT","NL","1.12",80,245,null],["choihe01","400292",2004,"FLA",1,"BAT","NL","1.45",95,340,null],["choihe01","400292",2004,"LAD",2,"BAT","NL","-0.31",31,76,null],["choihe01","400292",2005,"LAD",1,"BAT","NL","0.82",133,368,null],["finlest01","114135",1989,"BAL",1,"BAT","AL","0.38",81,241,null],["finlest01","114135",1990,"BAL",1,"BAT","AL","0.32",142,513,null],["finlest01","114135",1991,"HOU",1,"BAT","NL","5.15",159,656,null],["finlest01","114135",1992,"HOU",1,"BAT","NL","5.71",162,686,null],["finlest01","114135",1993,"HOU",1,"BAT","NL","2.69",142,585,null],["finlest01","114135",1994,"HOU",1,"BAT","NL","2.58",94,417,null],["finlest01","114135",1995,"SDP",1,"BAT","NL","1.49",139,630,null],["finlest01","114135",1996,"SDP",1,"BAT","NL","5.76",161,721,null],["finlest01","114135",1997,"SDP",1,"BAT","NL","1.51",143,615,null],["finlest01","114135",1998,"SDP",1,"BAT","NL","-0.04",159,674,null],["finlest01","114135",1999,"ARI",1,"BAT","NL","4.93",156,663,null],["finlest01","114135",2000,"ARI",1,"BAT","NL","3.44",152,623,null],["finlest01","114135",2001,"ARI",1,"BAT","NL","0.87",140,548,null],["finlest01","114135",2001,"ARI",1,"PITCH","NL","0.04",1,null,3],["finlest01","114135",2002,"ARI",1,"BAT","NL","3.85",150,577,null],["finlest01","114135",2003,"ARI",1,"BAT","NL","3.20",147,582,null],["finlest01","114135",2004,"ARI",1,"BAT","NL","1.72",104,456,null],["finlest01","114135",2004,"LAD",2,"BAT","NL","1.43",58,250,null],["finlest01","114135",2005,"LAA",1,"BAT","AL","-0.71",112,440,null],["finlest01","114135",2006,"SFG",1,"BAT","NL","1.13",139,481,null],["finlest01","114135",2007,"COL",1,"BAT","NL","-1.21",43,102,null],["fridlji01","114434",1952,"CLE",1,"BAT","AL","-0.23",62,193,null],["fridlji01","114434",1954,"BAL",1,"BAT","AL","-0.53",85,266,null],["fridlji01","114434",1958,"CIN",1,"BAT","NL","-0.05",5,9,null],["gyorkje01","576397",2013,"SDP",1,"BAT","NL","2.48",125,525,null],["gyorkje01","576397",2014,"SDP",1,"BAT","NL","-0.48",111,443,null],["gyorkje01","576397",2015,"SDP",1,"BAT","NL","0.62",128,458,null],["gyorkje01","576397",2016,"STL",1,"BAT","NL","2.67",128,438,null],["gyorkje01","576397",2017,"STL",1,"BAT","NL","2.99",125,481,null],["gyorkje01","576397",2018,"STL",1,"BAT","NL","0.79",125,402,null],["gyorkje01","576397",2018,"STL",1,"PITCH","NL","-0.03",1,null,3],["gyorkje01","576397",2019,"STL",1,"BAT","NL","-0.10",38,62,null],["gyorkje01","576397",2019,"STL",1,"PITCH","NL","0.01",1,null,1],["gyorkje01","576397",2019,"LAD",2,"BAT","NL","-0.40",24,39,null],["gyorkje01","576397",2019,"LAD",2,"PITCH","NL",null,0,null,0],["gyorkje01","576397",2020,"MIL",1,"BAT","NL","0.74",42,135,null],["gyorkje01","576397",2020,"MIL",1,"PITCH","NL","0.03",1,null,3],["hallto02","150134",2000,"TBD",1,"BAT","AL","0.00",4,13,null],["hallto02","150134",2001,"TBD",1,"BAT","AL","0.99",49,196,null],["hallto02","150134",2002,"TBD",1,"BAT","AL","0.59",85,353,null],["hallto02","150134",2003,"TBD",1,"BAT","AL","1.57",130,498,null],["hallto02","150134",2004,"TBD",1,"BAT","AL","0.35",119,441,null],["hallto02","150134",2005,"TBD",1,"BAT","AL","2.80",135,463,null],["hallto02","150134",2006,"TBD",1,"BAT","AL","-0.58",64,234,null],["hallto02","150134",2006,"LAD",2,"BAT","NL","-0.14",21,60,null],["hallto02","150134",2007,"CHW",1,"BAT","AL","-0.98",38,120,null],["hallto02","150134",2008,"CHW",1,"BAT","AL","0.12",41,136,null],["halvose01","678020",2024,"COL",1,"BAT","NL","0.00",1,0,null],["halvose01","678020",2024,"COL",1,"PITCH","NL","0.65",12,null,37],["halvose01","678020",2025,"COL",1,"BAT","NL","0.00",1,0,null],["halvose01","678020",2025,"COL",1,"PITCH","NL","0.18",42,null,119],["halvose01","678020",2026,"COL",1,"PITCH","NL","0.26",21,null,57],["halvose01","678020",2026,"LAD",2,"PITCH","NL","-0.28",11,null,30],["hendrma01","424805",2002,"TOR",1,"BAT","AL",null,0,0,null],["hendrma01","424805",2002,"TOR",1,"PITCH","AL","1.29",16,null,110],["hendrma01","424805",2003,"TOR",1,"BAT","AL","0.08",2,4,null],["hendrma01","424805",2003,"TOR",1,"PITCH","AL","0.14",30,null,475],["hendrma01","424805",2004,"TBD",1,"BAT","AL","0.04",2,6,null],["hendrma01","424805",2004,"TBD",1,"PITCH","AL","0.79",32,null,550],["hendrma01","424805",2005,"TBD",1,"BAT","AL","-0.01",3,7,null],["hendrma01","424805",2005,"TBD",1,"PITCH","AL","-0.66",31,null,535],["hendrma01","424805",2006,"TBD",1,"BAT","AL",null,0,0,null],["hendrma01","424805",2006,"TBD",1,"PITCH","AL","2.16",13,null,269],["hendrma01","424805",2006,"LAD",2,"BAT","NL","-0.19",17,23,null],["hendrma01","424805",2006,"LAD",2,"PITCH","NL","0.36",18,null,225],["hendrma01","424805",2007,"LAD",1,"BAT","NL","-0.17",35,30,null],["hendrma01","424805",2007,"LAD",1,"PITCH","NL","0.07",39,null,368],["hendrma01","424805",2008,"FLA",1,"BAT","NL","0.34",35,37,null],["hendrma01","424805",2008,"FLA",1,"PITCH","NL","-0.69",36,null,401],["hendrma01","424805",2009,"BAL",1,"BAT","AL","0.00",4,0,null],["hendrma01","424805",2009,"BAL",1,"PITCH","AL","0.93",53,null,315],["hendrma01","424805",2010,"BAL",1,"BAT","AL","0.00",3,0,null],["hendrma01","424805",2010,"BAL",1,"PITCH","AL","-0.28",52,null,226],["hendrma01","424805",2011,"BAL",1,"BAT","AL",null,0,0,null],["hendrma01","424805",2011,"BAL",1,"PITCH","AL","0.01",8,null,33],["hermach01","150252",1999,"PIT",1,"BAT","NL","-0.34",19,69,null],["hermach01","150252",2000,"PIT",1,"BAT","NL","-1.61",33,117,null],["hermach01","150252",2001,"PIT",1,"BAT","NL","-0.76",22,56,null],["hermach01","150252",2002,"PIT",1,"BAT","NL","-0.10",65,216,null],["hermach01","150252",2002,"CHC",2,"BAT","NL","-0.58",35,49,null],["hermach01","150252",2003,"LAD",1,"BAT","NL","-0.15",11,27,null],["hermach01","150252",2004,"TOR",1,"BAT","AL","-0.07",4,7,null],["izturce01","285131",2001,"TOR",1,"BAT","AL","0.35",46,140,null],["izturce01","285131",2002,"LAD",1,"BAT","NL","-0.96",135,468,null],["izturce01","285131",2003,"LAD",1,"BAT","NL","0.22",158,593,null],["izturce01","285131",2004,"LAD",1,"BAT","NL","3.82",159,728,null],["izturce01","285131",2005,"LAD",1,"BAT","NL","-0.19",106,478,null],["izturce01","285131",2006,"LAD",1,"BAT","NL","0.85",32,129,null],["izturce01","285131",2006,"CHC",2,"BAT","NL","-0.83",22,79,null],["izturce01","285131",2007,"CHC",1,"BAT","NL","0.03",65,207,null],["izturce01","285131",2007,"PIT",2,"BAT","NL","-0.16",45,130,null],["izturce01","285131",2008,"STL",1,"BAT","NL","1.68",135,454,null],["izturce01","285131",2009,"BAL",1,"BAT","AL","1.33",114,412,null],["izturce01","285131",2010,"BAL",1,"BAT","AL","0.29",150,513,null],["izturce01","285131",2011,"BAL",1,"BAT","AL","0.08",18,33,null],["izturce01","285131",2012,"MIL",1,"BAT","NL","-0.59",57,169,null],["izturce01","285131",2012,"WSN",2,"BAT","NL","0.02",5,4,null],["izturce01","285131",2013,"CIN",1,"BAT","NL","0.19",63,142,null],["juddmi01","116781",1997,"LAD",1,"BAT","NL","-0.01",1,1,null],["juddmi01","116781",1997,"LAD",1,"PITCH","NL","0.22",1,null,8],["juddmi01","116781",1998,"LAD",1,"BAT","NL","-0.01",7,1,null],["juddmi01","116781",1998,"LAD",1,"PITCH","NL","-0.79",7,null,34],["juddmi01","116781",1999,"LAD",1,"BAT","NL","-0.04",7,9,null],["juddmi01","116781",1999,"LAD",1,"PITCH","NL","-0.08",7,null,84],["juddmi01","116781",2000,"LAD",1,"BAT","NL","0.09",1,2,null],["juddmi01","116781",2000,"LAD",1,"PITCH","NL","-0.29",1,null,12],["juddmi01","116781",2001,"TBD",1,"BAT","AL",null,0,0,null],["juddmi01","116781",2001,"TBD",1,"PITCH","AL","-0.10",8,null,60],["juddmi01","116781",2001,"TEX",2,"BAT","AL","-0.02",1,1,null],["juddmi01","116781",2001,"TEX",2,"PITCH","AL","-0.28",4,null,27],["kempma01","461314",2006,"LAD",1,"BAT","NL","-0.15",52,166,null],["kempma01","461314",2007,"LAD",1,"BAT","NL","1.60",98,311,null],["kempma01","461314",2008,"LAD",1,"BAT","NL","3.90",155,657,null],["kempma01","461314",2009,"LAD",1,"BAT","NL","4.86",159,667,null],["kempma01","461314",2010,"LAD",1,"BAT","NL","-1.12",162,668,null],["kempma01","461314",2011,"LAD",1,"BAT","NL","7.99",161,689,null],["kempma01","461314",2012,"LAD",1,"BAT","NL","2.77",106,449,null],["kempma01","461314",2013,"LAD",1,"BAT","NL","0.72",73,290,null],["kempma01","461314",2014,"LAD",1,"BAT","NL","1.22",150,599,null],["kempma01","461314",2015,"SDP",1,"BAT","NL","0.56",154,648,null],["kempma01","461314",2016,"SDP",1,"BAT","NL","0.26",100,431,null],["kempma01","461314",2016,"ATL",2,"BAT","NL","0.08",56,241,null],["kempma01","461314",2017,"ATL",1,"BAT","NL","-1.33",115,467,null],["kempma01","461314",2018,"LAD",1,"BAT","NL","1.22",146,506,null],["kempma01","461314",2019,"CIN",1,"BAT","NL","-1.02",20,62,null],["kempma01","461314",2020,"COL",1,"BAT","NL","0.08",43,132,null],["maddugr01","118120",1986,"CHC",1,"BAT","NL","0.16",6,13,null],["maddugr01","118120",1986,"CHC",1,"PITCH","NL","0.04",6,null,93],["maddugr01","118120",1987,"CHC",1,"BAT","NL","-0.40",34,49,null],["maddugr01","118120",1987,"CHC",1,"PITCH","NL","-0.44",30,null,467],["maddugr01","118120",1988,"CHC",1,"BAT","NL","0.41",37,97,null],["maddugr01","118120",1988,"CHC",1,"PITCH","NL","5.17",34,null,747],["maddugr01","118120",1989,"CHC",1,"BAT","NL","0.28",35,91,null],["maddugr01","118120",1989,"CHC",1,"PITCH","NL","5.04",35,null,715],["maddugr01","118120",1990,"CHC",1,"BAT","NL","-0.27",35,89,null],["maddugr01","118120",1990,"CHC",1,"PITCH","NL","3.96",35,null,711],["maddugr01","118120",1991,"CHC",1,"BAT","NL","0.51",39,101,null],["maddugr01","118120",1991,"CHC",1,"PITCH","NL","3.49",37,null,789],["maddugr01","118120",1992,"CHC",1,"BAT","NL","0.25",35,102,null],["maddugr01","118120",1992,"CHC",1,"PITCH","NL","9.11",35,null,804],["maddugr01","118120",1993,"ATL",1,"BAT","NL","-0.08",36,102,null],["maddugr01","118120",1993,"ATL",1,"PITCH","NL","5.81",36,null,801],["maddugr01","118120",1994,"ATL",1,"BAT","NL","0.20",25,73,null],["maddugr01","118120",1994,"ATL",1,"PITCH","NL","8.50",25,null,606],["maddugr01","118120",1995,"ATL",1,"BAT","NL","-0.11",28,81,null],["maddugr01","118120",1995,"ATL",1,"PITCH","NL","9.72",28,null,629],["maddugr01","118120",1996,"ATL",1,"BAT","NL","0.00",35,82,null],["maddugr01","118120",1996,"ATL",1,"PITCH","NL","7.20",35,null,735],["maddugr01","118120",1997,"ATL",1,"BAT","NL","-0.11",31,78,null],["maddugr01","118120",1997,"ATL",1,"PITCH","NL","7.79",33,null,698],["maddugr01","118120",1998,"ATL",1,"BAT","NL","0.55",31,85,null],["maddugr01","118120",1998,"ATL",1,"PITCH","NL","6.55",34,null,753],["maddugr01","118120",1999,"ATL",1,"BAT","NL","0.46",31,79,null],["maddugr01","118120",1999,"ATL",1,"PITCH","NL","3.23",33,null,658],["maddugr01","118120",2000,"ATL",1,"BAT","NL","0.10",33,90,null],["maddugr01","118120",2000,"ATL",1,"PITCH","NL","6.53",35,null,748],["maddugr01","118120",2001,"ATL",1,"BAT","NL","0.06",34,81,null],["maddugr01","118120",2001,"ATL",1,"PITCH","NL","5.16",34,null,699],["maddugr01","118120",2002,"ATL",1,"BAT","NL","0.17",33,68,null],["maddugr01","118120",2002,"ATL",1,"PITCH","NL","4.38",34,null,598],["maddugr01","118120",2003,"ATL",1,"BAT","NL","-0.11",35,78,null],["maddugr01","118120",2003,"ATL",1,"PITCH","NL","1.33",36,null,655],["maddugr01","118120",2004,"CHC",1,"BAT","NL","-0.01",32,79,null],["maddugr01","118120",2004,"CHC",1,"PITCH","NL","3.18",33,null,638],["maddugr01","118120",2005,"CHC",1,"BAT","NL","0.15",34,83,null],["maddugr01","118120",2005,"CHC",1,"PITCH","NL","2.86",35,null,675],["maddugr01","118120",2006,"CHC",1,"BAT","NL","-0.13",20,48,null],["maddugr01","118120",2006,"CHC",1,"PITCH","NL","1.32",22,null,409],["maddugr01","118120",2006,"LAD",2,"BAT","NL","0.13",12,29,null],["maddugr01","118120",2006,"LAD",2,"PITCH","NL","1.80",12,null,221],["maddugr01","118120",2007,"SDP",1,"BAT","NL","-0.18",33,72,null],["maddugr01","118120",2007,"SDP",1,"PITCH","NL","2.56",34,null,594],["maddugr01","118120",2008,"SDP",1,"BAT","NL","-0.12",26,49,null],["maddugr01","118120",2008,"SDP",1,"PITCH","NL","0.62",26,null,460],["maddugr01","118120",2008,"LAD",2,"BAT","NL","-0.13",7,13,null],["maddugr01","118120",2008,"LAD",2,"PITCH","NL","-0.12",7,null,122],["maynebr01","118490",1990,"KCR",1,"BAT","AL","-0.22",5,16,null],["maynebr01","118490",1991,"KCR",1,"BAT","AL","0.54",85,259,null],["maynebr01","118490",1992,"KCR",1,"BAT","AL","-0.19",82,229,null],["maynebr01","118490",1993,"KCR",1,"BAT","AL","-0.56",71,227,null],["maynebr01","118490",1994,"KCR",1,"BAT","AL","-0.04",46,158,null],["maynebr01","118490",1995,"KCR",1,"BAT","AL","-0.30",110,347,null],["maynebr01","118490",1996,"NYM",1,"BAT","NL","-0.13",70,113,null],["maynebr01","118490",1997,"OAK",1,"BAT","AL","1.77",85,282,null],["maynebr01","118490",1998,"SFG",1,"BAT","NL","0.25",94,317,null],["maynebr01","118490",1999,"SFG",1,"BAT","NL","2.16",117,374,null],["maynebr01","118490",2000,"COL",1,"BAT","NL","0.13",117,395,null],["maynebr01","118490",2000,"COL",1,"PITCH","NL","0.13",1,null,3],["maynebr01","118490",2001,"COL",1,"BAT","NL","0.53",49,179,null],["maynebr01","118490",2001,"KCR",2,"BAT","AL","-0.82",51,180,null],["maynebr01","118490",2002,"KCR",1,"BAT","AL","-0.16",101,370,null],["maynebr01","118490",2003,"KCR",1,"BAT","AL","0.48",113,414,null],["maynebr01","118490",2004,"ARI",1,"BAT","NL","-0.28",36,111,null],["maynebr01","118490",2004,"LAD",2,"BAT","NL","-0.41",47,113,null],["millebo04","119112",1957,"STL",1,"BAT","NL","0.00",7,0,null],["millebo04","119112",1957,"STL",1,"PITCH","NL","-0.18",5,null,27],["millebo04","119112",1959,"STL",1,"BAT","NL","0.11",11,26,null],["millebo04","119112",1959,"STL",1,"PITCH","NL","1.56",11,null,212],["millebo04","119112",1960,"STL",1,"BAT","NL","-0.17",17,16,null],["millebo04","119112",1960,"STL",1,"PITCH","NL","1.13",15,null,158],["millebo04","119112",1961,"STL",1,"BAT","NL","0.29",35,18,null],["millebo04","119112",1961,"STL",1,"PITCH","NL","0.47",34,null,223],["millebo04","119112",1962,"NYM",1,"BAT","NL","-0.15",40,44,null],["millebo04","119112",1962,"NYM",1,"PITCH","NL","0.08",33,null,431],["millebo04","119112",1963,"LAD",1,"BAT","NL","-0.24",42,65,null],["millebo04","119112",1963,"LAD",1,"PITCH","NL","2.02",42,null,561],["millebo04","119112",1964,"LAD",1,"BAT","NL","0.04",74,23,null],["millebo04","119112",1964,"LAD",1,"PITCH","NL","1.70",74,null,413],["millebo04","119112",1965,"LAD",1,"BAT","NL","-0.19",61,18,null],["millebo04","119112",1965,"LAD",1,"PITCH","NL","1.19",61,null,309],["millebo04","119112",1966,"LAD",1,"BAT","NL","-0.17",46,15,null],["millebo04","119112",1966,"LAD",1,"PITCH","NL","1.17",46,null,253],["millebo04","119112",1967,"LAD",1,"BAT","NL","-0.07",52,9,null],["millebo04","119112",1967,"LAD",1,"PITCH","NL","-0.55",52,null,257],["millebo04","119112",1968,"MIN",1,"BAT","AL","-0.03",45,7,null],["millebo04","119112",1968,"MIN",1,"PITCH","AL","0.92",45,null,217],["millebo04","119112",1969,"MIN",1,"BAT","AL","-0.52",48,34,null],["millebo04","119112",1969,"MIN",1,"PITCH","AL","2.48",48,null,358],["millebo04","119112",1970,"CLE",1,"BAT","AL","0.06",15,6,null],["millebo04","119112",1970,"CLE",1,"PITCH","AL","0.21",15,null,84],["millebo04","119112",1970,"CHW",2,"BAT","AL","0.06",16,27,null],["millebo04","119112",1970,"CHW",2,"PITCH","AL","0.27",15,null,210],["millebo04","119112",1970,"CHC",3,"BAT","NL","0.00",7,0,null],["millebo04","119112",1970,"CHC",3,"PITCH","NL","0.03",7,null,27],["millebo04","119112",1971,"CHC",1,"BAT","NL","-0.02",2,1,null],["millebo04","119112",1971,"CHC",1,"PITCH","NL","0.03",2,null,21],["millebo04","119112",1971,"SDP",2,"BAT","NL","-0.15",38,12,null],["millebo04","119112",1971,"SDP",2,"PITCH","NL","3.16",38,null,191],["millebo04","119112",1971,"PIT",3,"BAT","NL","0.03",16,2,null],["millebo04","119112",1971,"PIT",3,"PITCH","NL","0.67",16,null,84],["millebo04","119112",1972,"PIT",1,"BAT","NL","-0.08",36,5,null],["millebo04","119112",1972,"PIT",1,"PITCH","NL","0.45",36,null,163],["millebo04","119112",1973,"SDP",1,"BAT","NL","-0.03",18,2,null],["millebo04","119112",1973,"SDP",1,"PITCH","NL","-0.08",18,null,92],["millebo04","119112",1973,"DET",2,"BAT","AL",null,0,0,null],["millebo04","119112",1973,"DET",2,"PITCH","AL","0.85",22,null,126],["millebo04","119112",1973,"NYM",3,"BAT","NL","0.00",1,0,null],["millebo04","119112",1973,"NYM",3,"PITCH","NL","0.04",1,null,3],["millebo04","119112",1974,"NYM",1,"BAT","NL","-0.04",58,9,null],["millebo04","119112",1974,"NYM",1,"PITCH","NL","0.32",58,null,234],["motagu01","150407",1999,"MON",1,"BAT","NL","0.15",47,1,null],["motagu01","150407",1999,"MON",1,"PITCH","NL","0.83",51,null,166],["motagu01","150407",2000,"MON",1,"BAT","NL","-0.01",28,1,null],["motagu01","150407",2000,"MON",1,"PITCH","NL","-0.15",29,null,90],["motagu01","150407",2001,"MON",1,"BAT","NL","0.03",49,3,null],["motagu01","150407",2001,"MON",1,"PITCH","NL","-0.05",53,null,149],["motagu01","150407",2002,"LAD",1,"BAT","NL","0.02",40,4,null],["motagu01","150407",2002,"LAD",1,"PITCH","NL","0.07",43,null,182],["motagu01","150407",2003,"LAD",1,"BAT","NL","0.12",72,9,null],["motagu01","150407",2003,"LAD",1,"PITCH","NL","3.01",76,null,315],["motagu01","150407",2004,"LAD",1,"BAT","NL","-0.08",49,6,null],["motagu01","150407",2004,"LAD",1,"PITCH","NL","1.97",52,null,189],["motagu01","150407",2004,"FLA",2,"BAT","NL","0.11",26,6,null],["motagu01","150407",2004,"FLA",2,"PITCH","NL","-0.21",26,null,101],["motagu01","150407",2005,"FLA",1,"BAT","NL","-0.04",53,3,null],["motagu01","150407",2005,"FLA",1,"PITCH","NL","-0.08",56,null,201],["motagu01","150407",2006,"CLE",1,"BAT","AL","0.00",2,0,null],["motagu01","150407",2006,"CLE",1,"PITCH","AL","-0.35",34,null,113],["motagu01","150407",2006,"NYM",2,"BAT","NL","0.00",18,0,null],["motagu01","150407",2006,"NYM",2,"PITCH","NL","0.72",18,null,54],["motagu01","150407",2007,"NYM",1,"BAT","NL","-0.02",50,1,null],["motagu01","150407",2007,"NYM",1,"PITCH","NL","-0.66",52,null,178],["motagu01","150407",2008,"MIL",1,"BAT","NL","0.00",57,0,null],["motagu01","150407",2008,"MIL",1,"PITCH","NL","0.21",58,null,171],["motagu01","150407",2009,"LAD",1,"BAT","NL","0.05",58,4,null],["motagu01","150407",2009,"LAD",1,"PITCH","NL","0.74",61,null,196],["motagu01","150407",2010,"SFG",1,"BAT","NL","-0.03",55,2,null],["motagu01","150407",2010,"SFG",1,"PITCH","NL","-0.27",56,null,162],["motagu01","150407",2011,"SFG",1,"BAT","NL","-0.05",50,10,null],["motagu01","150407",2011,"SFG",1,"PITCH","NL","0.16",52,null,241],["motagu01","150407",2012,"SFG",1,"BAT","NL","0.00",26,0,null],["motagu01","150407",2012,"SFG",1,"PITCH","NL","-0.32",26,null,62],["murphbi02","430889",2007,"ARI",1,"BAT","NL","0.00",10,0,null],["murphbi02","430889",2007,"ARI",1,"PITCH","NL","0.00",10,null,19],["murphbi02","430889",2009,"TOR",1,"BAT","AL",null,0,0,null],["murphbi02","430889",2009,"TOR",1,"PITCH","AL","0.20",8,null,34],["navardi01","425900",2004,"NYY",1,"BAT","AL","0.05",5,7,null],["navardi01","425900",2005,"LAD",1,"BAT","NL","0.73",50,199,null],["navardi01","425900",2006,"LAD",1,"BAT","NL","0.08",25,86,null],["navardi01","425900",2006,"TBD",2,"BAT","AL","-0.09",56,216,null],["navardi01","425900",2007,"TBD",1,"BAT","AL","0.33",119,434,null],["navardi01","425900",2008,"TBR",1,"BAT","AL","2.01",120,470,null],["navardi01","425900",2009,"TBR",1,"BAT","AL","-0.39",115,410,null],["navardi01","425900",2010,"TBR",1,"BAT","AL","0.04",48,142,null],["navardi01","425900",2011,"LAD",1,"BAT","NL","-0.08",64,202,null],["navardi01","425900",2012,"CIN",1,"BAT","NL","0.25",24,73,null],["navardi01","425900",2013,"CHC",1,"BAT","NL","1.88",89,266,null],["navardi01","425900",2014,"TOR",1,"BAT","AL","2.45",139,520,null],["navardi01","425900",2015,"TOR",1,"BAT","AL","0.73",54,192,null],["navardi01","425900",2016,"CHW",1,"BAT","AL","-0.82",85,298,null],["navardi01","425900",2016,"TOR",2,"BAT","AL","-0.18",16,36,null],["pennybr01","207267",2000,"FLA",1,"BAT","NL","-0.30",23,46,null],["pennybr01","207267",2000,"FLA",1,"PITCH","NL","0.48",23,null,359],["pennybr01","207267",2001,"FLA",1,"BAT","NL","0.01",29,66,null],["pennybr01","207267",2001,"FLA",1,"PITCH","NL","2.67",31,null,615],["pennybr01","207267",2002,"FLA",1,"BAT","NL","0.02",24,49,null],["pennybr01","207267",2002,"FLA",1,"PITCH","NL","0.01",24,null,388],["pennybr01","207267",2003,"FLA",1,"BAT","NL","-0.11",31,73,null],["pennybr01","207267",2003,"FLA",1,"PITCH","NL","2.85",32,null,589],["pennybr01","207267",2004,"FLA",1,"BAT","NL","-0.44",20,48,null],["pennybr01","207267",2004,"FLA",1,"PITCH","NL","2.67",21,null,394],["pennybr01","207267",2004,"LAD",2,"BAT","NL","-0.06",3,4,null],["pennybr01","207267",2004,"LAD",2,"PITCH","NL","0.08",3,null,35],["pennybr01","207267",2005,"LAD",1,"BAT","NL","0.08",27,61,null],["pennybr01","207267",2005,"LAD",1,"PITCH","NL","2.43",29,null,526],["pennybr01","207267",2006,"LAD",1,"BAT","NL","0.16",33,70,null],["pennybr01","207267",2006,"LAD",1,"PITCH","NL","2.95",34,null,567],["pennybr01","207267",2007,"LAD",1,"BAT","NL","0.62",31,75,null],["pennybr01","207267",2007,"LAD",1,"PITCH","NL","5.93",33,null,624],["pennybr01","207267",2008,"LAD",1,"BAT","NL","0.02",18,32,null],["pennybr01","207267",2008,"LAD",1,"PITCH","NL","-1.02",19,null,284],["pennybr01","207267",2009,"BOS",1,"BAT","AL","0.00",2,5,null],["pennybr01","207267",2009,"BOS",1,"PITCH","AL","0.26",24,null,395],["pennybr01","207267",2009,"SFG",2,"BAT","NL","-0.06",6,16,null],["pennybr01","207267",2009,"SFG",2,"PITCH","NL","1.34",6,null,125],["pennybr01","207267",2010,"STL",1,"BAT","NL","0.05",9,20,null],["pennybr01","207267",2010,"STL",1,"PITCH","NL","0.62",9,null,167],["pennybr01","207267",2011,"DET",1,"BAT","AL","-0.06",2,4,null],["pennybr01","207267",2011,"DET",1,"PITCH","AL","-1.13",31,null,545],["pennybr01","207267",2012,"SFG",1,"BAT","NL","-0.01",22,1,null],["pennybr01","207267",2012,"SFG",1,"PITCH","NL","-0.79",22,null,84],["pennybr01","207267",2014,"MIA",1,"BAT","NL","0.16",8,8,null],["pennybr01","207267",2014,"MIA",1,"PITCH","NL","-0.55",8,null,78],["perezbe01","425558",2006,"WSN",1,"BAT","NL","0.17",9,7,null],["perezbe01","425558",2006,"WSN",1,"PITCH","NL","0.47",8,null,63],["priceda01","456034",2008,"TBR",1,"BAT","AL",null,0,0,null],["priceda01","456034",2008,"TBR",1,"PITCH","AL","0.49",5,null,42],["priceda01","456034",2009,"TBR",1,"BAT","AL","0.02",1,3,null],["priceda01","456034",2009,"TBR",1,"PITCH","AL","0.91",23,null,385],["priceda01","456034",2010,"TBR",1,"BAT","AL","-0.02",4,7,null],["priceda01","456034",2010,"TBR",1,"PITCH","AL","4.67",32,null,626],["priceda01","456034",2011,"TBR",1,"BAT","AL","-0.01",2,5,null],["priceda01","456034",2011,"TBR",1,"PITCH","AL","3.31",34,null,673],["priceda01","456034",2012,"TBR",1,"BAT","AL","0.00",2,5,null],["priceda01","456034",2012,"TBR",1,"PITCH","AL","6.63",31,null,633],["priceda01","456034",2013,"TBR",1,"BAT","AL","-0.09",2,6,null],["priceda01","456034",2013,"TBR",1,"PITCH","AL","2.62",27,null,560],["priceda01","456034",2014,"TBR",1,"BAT","AL","-0.05",1,4,null],["priceda01","456034",2014,"TBR",1,"PITCH","AL","2.71",23,null,512],["priceda01","456034",2014,"DET",2,"BAT","AL",null,0,0,null],["priceda01","456034",2014,"DET",2,"PITCH","AL","1.67",11,null,233],["priceda01","456034",2015,"DET",1,"BAT","AL","-0.07",2,5,null],["priceda01","456034",2015,"DET",1,"PITCH","AL","3.75",21,null,438],["priceda01","456034",2015,"TOR",2,"BAT","AL","-0.08",1,4,null],["priceda01","456034",2015,"TOR",2,"PITCH","AL","2.58",11,null,223],["priceda01","456034",2016,"BOS",1,"BAT","AL","-0.10",4,11,null],["priceda01","456034",2016,"BOS",1,"PITCH","AL","2.88",35,null,690],["priceda01","456034",2017,"BOS",1,"BAT","AL","0.06",1,1,null],["priceda01","456034",2017,"BOS",1,"PITCH","AL","1.54",16,null,224],["priceda01","456034",2018,"BOS",1,"BAT","AL",null,0,0,null],["priceda01","456034",2018,"BOS",1,"PITCH","AL","3.69",30,null,528],["priceda01","456034",2019,"BOS",1,"BAT","AL","0.05",1,2,null],["priceda01","456034",2019,"BOS",1,"PITCH","AL","1.54",22,null,322],["priceda01","456034",2021,"LAD",1,"BAT","NL","0.16",37,18,null],["priceda01","456034",2021,"LAD",1,"PITCH","NL","0.67",39,null,221],["priceda01","456034",2022,"LAD",1,"BAT","NL","0.00",1,0,null],["priceda01","456034",2022,"LAD",1,"PITCH","NL","0.69",40,null,121],["proctsc01","429984",2004,"NYY",1,"BAT","AL",null,0,0,null],["proctsc01","429984",2004,"NYY",1,"PITCH","AL","-0.10",26,null,75],["proctsc01","429984",2005,"NYY",1,"BAT","AL",null,0,0,null],["proctsc01","429984",2005,"NYY",1,"PITCH","AL","-0.15",29,null,134],["proctsc01","429984",2006,"NYY",1,"BAT","AL","0.00",6,0,null],["proctsc01","429984",2006,"NYY",1,"PITCH","AL","2.57",83,null,307],["proctsc01","429984",2007,"NYY",1,"BAT","AL","-0.04",6,3,null],["proctsc01","429984",2007,"NYY",1,"PITCH","AL","0.51",52,null,163],["proctsc01","429984",2007,"LAD",2,"BAT","NL","0.00",31,0,null],["proctsc01","429984",2007,"LAD",2,"PITCH","NL","0.40",31,null,96],["proctsc01","429984",2008,"LAD",1,"BAT","NL","0.00",38,0,null],["proctsc01","429984",2008,"LAD",1,"PITCH","NL","-0.81",41,null,116],["proctsc01","429984",2010,"ATL",1,"BAT","NL","0.00",6,0,null],["proctsc01","429984",2010,"ATL",1,"PITCH","NL","-0.06",6,null,17],["proctsc01","429984",2011,"ATL",1,"BAT","NL","-0.03",28,2,null],["proctsc01","429984",2011,"ATL",1,"PITCH","NL","-0.84",31,null,88],["proctsc01","429984",2011,"NYY",2,"BAT","AL",null,0,0,null],["proctsc01","429984",2011,"NYY",2,"PITCH","AL","-0.66",8,null,33],["quantpa01","120824",1992,"BOS",1,"BAT","AL",null,0,0,null],["quantpa01","120824",1992,"BOS",1,"PITCH","AL","1.26",27,null,148],["quantpa01","120824",1993,"BOS",1,"BAT","AL",null,0,0,null],["quantpa01","120824",1993,"BOS",1,"PITCH","AL","1.00",49,null,414],["quantpa01","120824",1994,"BOS",1,"BAT","AL",null,0,0,null],["quantpa01","120824",1994,"BOS",1,"PITCH","AL","0.48",17,null,69],["quantpa01","120824",1994,"PHI",2,"BAT","NL","-0.05",18,3,null],["quantpa01","120824",1994,"PHI",2,"PITCH","NL","-0.30",18,null,90],["quantpa01","120824",1995,"PHI",1,"BAT","NL","-0.27",33,67,null],["quantpa01","120824",1995,"PHI",1,"PITCH","NL","0.59",33,null,538],["quantpa01","120824",1996,"TOR",1,"BAT","AL",null,0,0,null],["quantpa01","120824",1996,"TOR",1,"PITCH","AL","0.63",38,null,403],["quantpa01","120824",1997,"TOR",1,"BAT","AL","-0.01",4,1,null],["quantpa01","120824",1997,"TOR",1,"PITCH","AL","3.20",77,null,264],["quantpa01","120824",1998,"TOR",1,"BAT","AL","0.00",4,0,null],["quantpa01","120824",1998,"TOR",1,"PITCH","AL","2.79",82,null,240],["quantpa01","120824",1999,"TOR",1,"BAT","AL","0.00",1,0,null],["quantpa01","120824",1999,"TOR",1,"PITCH","AL","1.26",41,null,146],["quantpa01","120824",2000,"TOR",1,"BAT","AL","0.04",5,1,null],["quantpa01","120824",2000,"TOR",1,"PITCH","AL","0.93",68,null,251],["quantpa01","120824",2001,"TOR",1,"BAT","AL","0.00",4,0,null],["quantpa01","120824",2001,"TOR",1,"PITCH","AL","2.41",80,null,249],["quantpa01","120824",2002,"LAD",1,"BAT","NL","0.03",83,3,null],["quantpa01","120824",2002,"LAD",1,"PITCH","NL","1.06",86,null,230],["quantpa01","120824",2003,"LAD",1,"BAT","NL","-0.02",85,1,null],["quantpa01","120824",2003,"LAD",1,"PITCH","NL","2.25",89,null,232],["quantpa01","120824",2004,"NYY",1,"BAT","AL","-0.04",6,1,null],["quantpa01","120824",2004,"NYY",1,"PITCH","AL","0.78",86,null,286],["quantpa01","120824",2005,"NYY",1,"BAT","AL","0.00",3,0,null],["quantpa01","120824",2005,"NYY",1,"PITCH","AL","-0.17",22,null,96],["quantpa01","120824",2005,"SDP",2,"BAT","NL","-0.01",22,1,null],["quantpa01","120824",2005,"SDP",2,"PITCH","NL","0.31",22,null,95],["quantpa01","120824",2005,"FLA",3,"BAT","NL","0.00",6,0,null],["quantpa01","120824",2005,"FLA",3,"PITCH","NL","-0.35",6,null,16],["rortvbe01","666163",2021,"MIN",1,"BAT","AL","-0.05",39,98,null],["rortvbe01","666163",2023,"NYY",1,"BAT","AL","-0.20",32,79,null],["rortvbe01","666163",2024,"TBR",1,"BAT","AL","0.89",112,328,null],["rortvbe01","666163",2024,"TBR",1,"PITCH","AL","0.01",1,null,6],["rortvbe01","666163",2025,"TBR",1,"BAT","AL","-0.51",26,70,null],["rortvbe01","666163",2025,"LAD",2,"BAT","NL","0.05",18,58,null],["rortvbe01","666163",2026,"LAD",1,"BAT","NL","-0.12",16,28,null],["ruanwi01","400118",2002,"LAD",1,"BAT","NL","-0.06",12,11,null],["ruanwi01","400118",2003,"LAD",1,"BAT","NL","0.20",21,41,null]],"source_urls":["https://www.baseball-reference.com/data/war_daily_bat.txt","https://www.baseball-reference.com/data/war_daily_pitch.txt"]}}$m034$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
begin
  if to_regclass('public.dodgers_control_observations') is null or to_regclass('public.v_transaction_asset_chain_readiness') is null
     or to_regclass('public.v_transaction_research_queue') is null then
    raise exception '034: Migration 033 has not been applied';
  end if;
  for p in select distinct x from _m034, jsonb_array_elements(j -> 'organizations') x loop
    if not exists (select 1 from public.organizations where abbreviation = p #>> '{}') then
      raise exception '034: organization % does not exist', p #>> '{}';
    end if;
  end loop;
  for p in select x from _m034, jsonb_array_elements(j -> 'war' -> 'source_urls') x loop
    if not exists (select 1 from public.sources where url = p #>> '{}') then
      raise exception '034: the Baseball-Reference data file source % is not registered', p #>> '{}';
    end if;
  end loop;
  -- the transaction layer holds exactly the 161 events of Migration 033 plus, on a rerun, the reviewed events of this migration
  select count(*) into n from public.transaction_events e
  where not exists (select 1 from _m034, jsonb_array_elements(j -> 'events') x where x ->> 'key' = e.event_key);
  if n <> (select (j ->> 'expected_prior_events')::int from _m034) then
    raise exception '034: % pre-existing transaction events found, % expected from Migration 033', n, (select j ->> 'expected_prior_events' from _m034);
  end if;
  -- every pre-existing asset the reviewed data refers to exists
  for p in
    select x from (
      select o -> 'asset' as x from _m034, jsonb_array_elements(j -> 'asset_observations') o
      union all select t -> 'asset' from _m034, jsonb_array_elements(j -> 'timing') t
    ) q
    where not exists (select 1 from _m034, jsonb_array_elements(j -> 'events') e where e ->> 'key' = x ->> 'event')
  loop
    if not exists (select 1 from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
                   where e.event_key = p ->> 'event' and a.asset_side = p ->> 'side' and a.asset_name = p ->> 'name') then
      raise exception '034: expected existing asset % (%) was not found', p ->> 'name', p ->> 'event';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 2. SCHEMA
-- ===========================================================================

alter table public.transaction_events drop constraint if exists transaction_events_transaction_type_check;
alter table public.transaction_events add constraint transaction_events_transaction_type_check
  check (transaction_type in ('TRADE', 'RELEASE', 'WAIVER', 'SALE', 'OTHER', 'RULE5_SELECTION', 'FREE_AGENCY', 'EXPANSION_DRAFT', 'FREE_AGENT_SIGNING'));

comment on column public.transaction_events.transaction_type is
  'Normalized mechanism. TRADE, RELEASE, WAIVER, SALE, RULE5_SELECTION, FREE_AGENCY and EXPANSION_DRAFT can end Dodgers control; FREE_AGENT_SIGNING begins a new control interval (a re-signing after free agency is never the return of an earlier trade). OTHER is unused.';

-- ---------------------------------------------------------------------------
-- transaction_asset_timing_observations: sourced chronology facts about one acquired asset's control interval
-- ---------------------------------------------------------------------------

create table if not exists public.transaction_asset_timing_observations (
  id uuid primary key default gen_random_uuid(),
  subject_asset_id uuid not null references public.transaction_event_assets(id) on delete restrict,
  event_id uuid not null references public.transaction_events(id) on delete restrict,
  fact_type text not null check (fact_type in
    ('FIRST_DODGERS_APPEARANCE', 'LAST_DODGERS_APPEARANCE', 'SEASON_START_CONFIRMS_POST_ACQUISITION', 'EXIT_BOUNDED_BEFORE')),
  season int check (season is null or season between 1871 and 2100),
  observed_date date not null,
  source_id uuid not null references public.sources(id) on delete restrict,
  confidence public.confidence_level not null,
  note text check (note is null or char_length(note) <= 400),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  constraint transaction_asset_timing_observations_shape_check check (
    (fact_type = 'EXIT_BOUNDED_BEFORE' and season is null)
    or (fact_type <> 'EXIT_BOUNDED_BEFORE' and season is not null and extract(year from observed_date)::int = season)),
  constraint transaction_asset_timing_observations_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
create unique index if not exists transaction_asset_timing_observations_active_key
  on public.transaction_asset_timing_observations (subject_asset_id, fact_type, coalesce(season, 0)) where record_status = 'ACTIVE';
create index if not exists transaction_asset_timing_observations_event_idx on public.transaction_asset_timing_observations (event_id);

comment on table public.transaction_asset_timing_observations is
  'Sealed, append-only chronology facts attached to an incoming PLAYER asset (the start of a Dodgers control interval): FIRST_DODGERS_APPEARANCE and SEASON_START_CONFIRMS_POST_ACQUISITION place a same-season Dodgers stint after the acquisition, LAST_DODGERS_APPEARANCE places it before the exit, EXIT_BOUNDED_BEFORE says control had ended on or before a date when the exit transaction itself is not recorded. Each is a point-in-time fact with its source; it never states a bounded state (that is dodgers_control_observations). Only retraction of an ACTIVE row is allowed.';
comment on column public.transaction_asset_timing_observations.fact_type is
  'FIRST_DODGERS_APPEARANCE: first Dodgers game on or after the acquisition (season required). LAST_DODGERS_APPEARANCE: last Dodgers game of the interval. SEASON_START_CONFIRMS_POST_ACQUISITION: the team opened its season (observed_date) after the acquisition date, so every Dodgers game of that season is post-acquisition. EXIT_BOUNDED_BEFORE: Dodgers control ended on or before observed_date (no season).';

create or replace function public.disi_timing_observation_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.transaction_event_assets%rowtype;
  ev_date date;
begin
  if tg_op = 'DELETE' then
    raise exception 'transaction timing observations are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED transaction timing observation is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE transaction timing observation is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new transaction timing observation starts ACTIVE' using errcode = '55000';
  end if;
  select * into a from public.transaction_event_assets where id = new.subject_asset_id;
  if not found or a.asset_type <> 'PLAYER' or a.asset_side <> 'INCOMING' then
    raise exception 'a timing observation must concern an incoming PLAYER asset (%)', new.subject_asset_id using errcode = '55000';
  end if;
  if new.event_id <> a.event_id then
    raise exception 'the observation event must be the acquisition event of its asset (%)', new.subject_asset_id using errcode = '55000';
  end if;
  select e.transaction_date into ev_date from public.transaction_events e where e.id = a.event_id;
  if new.observed_date < ev_date then
    raise exception 'a timing observation cannot predate the acquisition it concerns (%)', new.subject_asset_id using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_timing_observation_guard() from public, anon, authenticated;

drop trigger if exists transaction_asset_timing_observations_guard on public.transaction_asset_timing_observations;
create trigger transaction_asset_timing_observations_guard
before insert or update or delete on public.transaction_asset_timing_observations
for each row execute function public.disi_timing_observation_guard();

do $$
declare t text := 'transaction_asset_timing_observations';
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on table public.%I from anon, authenticated', t);
  execute format('grant select on table public.%I to anon, authenticated', t);
  execute format('drop policy if exists public_read_%I on public.%I', t, t);
  execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
end $$;

-- ===========================================================================
-- 3. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (j ->> 'retrieved_at')::timestamptz
from _m034, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 4. TRANSACTION EVENTS AND ASSETS
-- ===========================================================================

insert into public.transaction_events (event_key, transaction_date, transaction_type, from_organization_id, to_organization_id, description, source_id,
  is_multi_team, historical_label)
select x ->> 'key', (x ->> 'date')::date, x ->> 'type', fo.id, tobj.id, x ->> 'description', so.id, (x ->> 'multi')::boolean, nullif(x ->> 'label', '')
from _m034, jsonb_array_elements(j -> 'events') x
left join public.organizations fo on fo.abbreviation = x ->> 'from'
left join public.organizations tobj on tobj.abbreviation = x ->> 'to'
left join public.sources so on so.url = x ->> 'source_url'
on conflict (event_key) do nothing;

insert into public.transaction_event_assets (event_id, asset_side, player_id, asset_name, asset_type, role_note, source_id, bref_id, mlb_id, bref_register_id,
  counterparty_organization_id, cash_amount_usd, pool_space_amount_usd)
select e.id, a ->> 'side', null, a ->> 'name', a ->> 'type', nullif(a ->> 'note', ''), e.source_id, nullif(a ->> 'bref_id', ''),
       nullif(a ->> 'mlb_id', ''), nullif(a ->> 'register_id', ''), co.id, (a ->> 'cash')::numeric, (a ->> 'pool')::numeric
from _m034 cross join jsonb_array_elements(j -> 'events') x cross join jsonb_array_elements(x -> 'assets') a
join public.transaction_events e on e.event_key = x ->> 'key'
left join public.organizations co on co.abbreviation = a ->> 'cp'
on conflict (event_id, asset_side, asset_name) do nothing;

-- ===========================================================================
-- 5. PLACEHOLDER RESOLUTIONS, CONTROL OBSERVATIONS AND TIMING FACTS
-- ===========================================================================

insert into public.transaction_asset_resolutions (placeholder_asset_id, resolved_asset_id, resolution_type, resolution_date, source_id, confidence, notes)
select ph.id, rs.id, 'NAMED_PLAYER', (r ->> 'date')::date, so.id, (r ->> 'confidence')::public.confidence_level, r ->> 'note'
from _m034 cross join jsonb_array_elements(j -> 'resolutions') r
join public.transaction_events e on e.event_key = r ->> 'event'
join public.transaction_event_assets ph on ph.event_id = e.id and ph.asset_side = r #>> '{placeholder,0}' and ph.asset_name = r #>> '{placeholder,1}'
join public.transaction_event_assets rs on rs.event_id = e.id and rs.asset_side = r #>> '{resolved,0}' and rs.asset_name = r #>> '{resolved,1}'
join public.sources so on so.url = r ->> 'source_url'
where not exists (select 1 from public.transaction_asset_resolutions x where x.placeholder_asset_id = ph.id and x.record_status = 'ACTIVE');

insert into public.dodgers_control_observations (subject_asset_id, observation_type, observed_through_date, source_id, confidence, note)
select a.id, o ->> 'type', (o ->> 'observed_through')::date, so.id, (o ->> 'confidence')::public.confidence_level, o ->> 'note'
from _m034 cross join jsonb_array_elements(j -> 'asset_observations') o
join public.transaction_events e on e.event_key = o #>> '{asset,event}'
join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = o #>> '{asset,side}' and a.asset_name = o #>> '{asset,name}'
join public.sources so on so.url = o ->> 'source_url'
where not exists (select 1 from public.dodgers_control_observations x where x.subject_asset_id = a.id and x.observation_type = o ->> 'type'
                  and x.observed_through_date = (o ->> 'observed_through')::date and x.record_status = 'ACTIVE');

insert into public.transaction_asset_timing_observations (subject_asset_id, event_id, fact_type, season, observed_date, source_id, confidence, note)
select a.id, e.id, t ->> 'fact_type', nullif(t ->> 'season', '')::int, (t ->> 'observed_date')::date, so.id, (t ->> 'confidence')::public.confidence_level, t ->> 'note'
from _m034 cross join jsonb_array_elements(j -> 'timing') t
join public.transaction_events e on e.event_key = t #>> '{asset,event}'
join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = t #>> '{asset,side}' and a.asset_name = t #>> '{asset,name}'
join public.sources so on so.url = t ->> 'source_url'
where not exists (select 1 from public.transaction_asset_timing_observations x where x.subject_asset_id = a.id and x.fact_type = t ->> 'fact_type'
                  and coalesce(x.season, 0) = coalesce(nullif(t ->> 'season', '')::int, 0) and x.record_status = 'ACTIVE');

-- ===========================================================================
-- 6. TEAM-SEASON FACTS OF THE NEWLY SURFACED DOWNSTREAM PLAYER ASSETS (same Baseball-Reference files and method as 032 / 033)
-- ===========================================================================

insert into public.bref_team_code_map (bref_team_code, organization_id, from_season, to_season, note)
select x ->> 'code', o.id, (x ->> 'from')::int, (x ->> 'to')::int, x ->> 'note'
from _m034, jsonb_array_elements(j -> 'team_map') x
join public.organizations o on o.abbreviation = x ->> 'organization'
on conflict (bref_team_code, from_season) do nothing;

insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
  plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
select r ->> 0, r ->> 1, pl.id, (r ->> 2)::int, r ->> 3, m.organization_id, (r ->> 4)::int, r ->> 5, nullif(r ->> 7, '')::numeric, nullif(r ->> 8, '')::int,
       nullif(r ->> 9, '')::int, nullif(r ->> 10, '')::int, nullif(r ->> 6, ''), so.id,
       (j -> 'war' ->> 'observed_through_date')::date, (j -> 'war' ->> 'observed_through_season')::int, (j -> 'war' ->> 'retrieved_at')::timestamptz, 'VERIFIED',
       case when r ->> 7 is null then 'The data file has no WAR for this zero-plate-appearance row; stored as NULL, not zero.' end
from _m034 cross join lateral jsonb_array_elements(j -> 'war' -> 'rows') r
join public.sources so on so.url = case when r ->> 5 = 'BAT' then j -> 'war' ->> 'bat_url' else j -> 'war' ->> 'pitch_url' end
left join public.players pl on pl.bref_id = r ->> 0
left join lateral (
  select m2.organization_id from public.bref_team_code_map m2
  where m2.bref_team_code = r ->> 3 and (r ->> 2)::int >= m2.from_season and (r ->> 2)::int <= coalesce(m2.to_season, 9999)
  order by m2.from_season desc limit 1
) m on true
on conflict (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE' do nothing;

-- ===========================================================================
-- 7. VIEWS
-- ===========================================================================

-- ===========================================================================
-- Migration 034 views: control intervals, transaction asset lineage, package lineage, downstream organizational realization
-- ===========================================================================

-- One row per continuous Dodgers organizational tenure of one player identity: the original tracked signing, or an incoming
-- PLAYER asset of any acquisition event (trade, free-agent signing). An interval ends at the first later canonical exit event
-- of the same identity; a later re-entry is a new interval and is never reconnected to an earlier one. Dodgers bWAR is bounded
-- to the interval (acquisition-relative as in 032; exit-relative here); nothing outside the interval is credited.
create or replace view public.v_player_control_intervals
with (security_invoker = true)
as
with recursive as_of as (
  select max(audited_through_date) as analysis_as_of_date from public.outcome_audits
),
pa as (
  select a.id as asset_id, a.event_id, a.asset_side, a.asset_name, a.player_id, a.mlb_id, a.bref_id, a.bref_register_id, a.counterparty_organization_id,
    e.event_key, e.transaction_date, e.transaction_type, e.historical_label as event_label
  from public.transaction_event_assets a
  join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'PLAYER'
),
sg as (
  select distinct on (f.player_id) f.player_id, p.slug as player_slug, p.full_name, p.mlb_id::text as mlb_id, p.bref_id,
    coalesce(f.signing_date, make_date(f.signing_year, 1, 1)) as start_date
  from public.v_signing_acquisition_financials f
  join public.players p on p.id = f.player_id
  where f.is_dodgers
  order by f.player_id, f.signing_date nulls last, f.signing_year
),
starts as (
  select 'SIGNING:' || s.player_slug as interval_key, 'TRACKED_SIGNING'::text as start_method, null::uuid as start_asset_id, null::uuid as start_event_id,
    null::text as start_event_key, s.start_date, s.player_id, s.player_slug, s.full_name as display_name, s.mlb_id, s.bref_id,
    null::text as bref_register_id, null::uuid as cp_org_id
  from sg s
  union all
  select pa.event_key || ':' || coalesce(ps.slug, pa.mlb_id, pa.bref_id, pa.bref_register_id, pa.asset_name),
    case when pa.transaction_type = 'TRADE' then 'TRADE_ACQUISITION' else pa.transaction_type end,
    pa.asset_id, pa.event_id, pa.event_key, pa.transaction_date, pa.player_id, ps.slug, pa.asset_name, pa.mlb_id, pa.bref_id, pa.bref_register_id,
    pa.counterparty_organization_id
  from pa
  left join public.players ps on ps.id = pa.player_id
  where pa.asset_side = 'INCOMING'
),
-- first later exit of the same identity (the control interval's end)
ex as (
  select * from (
    select s.interval_key, x.asset_id as exit_asset_id, x.event_id as exit_event_id, x.event_key as exit_event_key, x.transaction_date as exit_date,
      x.transaction_type as exit_type, x.event_label as exit_label,
      row_number() over (partition by s.interval_key order by x.transaction_date, x.event_key) as rn
    from starts s
    join pa x on x.asset_side = 'OUTGOING'
      and x.transaction_type in ('TRADE', 'RELEASE', 'WAIVER', 'FREE_AGENCY', 'RULE5_SELECTION', 'EXPANSION_DRAFT', 'SALE')
      and x.event_id is distinct from s.start_event_id
      and x.transaction_date >= s.start_date
      and ((s.player_id is not null and x.player_id = s.player_id) or (s.mlb_id is not null and x.mlb_id = s.mlb_id)
        or (s.bref_id is not null and x.bref_id = s.bref_id) or (s.bref_register_id is not null and x.bref_register_id = s.bref_register_id))
  ) q where q.rn = 1
),
-- a later interval of the same identity that starts inside the exit season makes the exit-season stint order ambiguous
reentry as (
  select x.interval_key,
    exists (
      select 1 from starts s2
      join starts s1 on s1.interval_key = x.interval_key
      where s2.interval_key <> s1.interval_key and s2.start_date > x.exit_date
        and extract(year from s2.start_date) = extract(year from x.exit_date)
        and extract(month from s2.start_date) between 3 and 10
        and ((s1.player_id is not null and s2.player_id = s1.player_id) or (s1.mlb_id is not null and s2.mlb_id = s1.mlb_id)
          or (s1.bref_id is not null and s2.bref_id = s1.bref_id) or (s1.bref_register_id is not null and s2.bref_register_id = s1.bref_register_id))
    ) as reentry_same_season
  from ex x
),
roots as (
  select e.id as event_id, e.event_key, e.event_key || '|' || string_agg(p.slug, ',' order by p.slug) as root_key
  from public.transaction_events e
  join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = 'OUTGOING' and a.player_id is not null
  join public.players p on p.id = a.player_id
  where e.transaction_type = 'TRADE'
  group by e.id, e.event_key
),
-- which root packages an interval descends from (reachability only; attribution levels are computed in the lineage view)
reach(root_key, interval_key) as (
  select r.root_key, s.interval_key
  from roots r
  join starts s on s.start_event_id = r.event_id and s.start_method <> 'TRACKED_SIGNING'
  union
  select re.root_key, c.interval_key
  from reach re
  join ex on ex.interval_key = re.interval_key and ex.exit_type = 'TRADE'
  join starts c on c.start_event_id = ex.exit_event_id and c.start_method <> 'TRACKED_SIGNING'
),
lr as (
  select interval_key, array_agg(distinct root_key order by root_key) as lineage_root_keys from reach group by interval_key
),
tfacts as (
  select t.subject_asset_id, t.fact_type, t.season, t.observed_date
  from public.transaction_asset_timing_observations t where t.record_status = 'ACTIVE'
)
select
  s.interval_key,
  s.player_id, s.player_slug, s.display_name, s.mlb_id, s.bref_id, s.bref_register_id,
  s.start_method, s.start_event_key, s.start_date as interval_start,
  x.exit_event_key, x.exit_type as exit_method, x.exit_date as interval_end,
  case
    when x.exit_event_id is not null then 'CLOSED_EXIT_RECORDED'
    when ob.observation_type = 'DODGERS_CONTROL_OBSERVED' then 'OPEN_CONTROL_OBSERVED'
    when ob.observation_type = 'CAREER_ENDED_WITH_DODGERS' then 'CLOSED_CAREER_ENDED'
    when ob.observation_type = 'EXIT_MECHANISM_UNRECORDED' or tb.bound_date is not null then 'EXIT_UNRECORDED_BOUNDED'
    when ob.observation_type = 'HISTORY_UNAVAILABLE' then 'HISTORY_UNAVAILABLE'
    else 'EXIT_NOT_RESEARCHED' end as interval_status,
  tb.bound_date as exit_bounded_before_date,
  ao.analysis_as_of_date,
  coalesce(lr.lineage_root_keys, array[]::text[]) as lineage_root_keys,
  (lr.interval_key is not null) as is_lineage_interval,
  case
    when s.player_id is null and s.mlb_id is null and s.bref_id is null and s.bref_register_id is null then 'IDENTITY_UNRESOLVED'
    when coalesce(w.team_rows, 0) > 0 then case when w.ambiguous_rows > 0 then 'TIMING_UNRESOLVED' else 'LOADED' end
    when nm.observed_through is not null then 'NO_MLB_APPEARANCE_OBSERVED'
    when s.start_method = 'TRACKED_SIGNING' then 'NO_TEAM_SEASON_FACTS'
    else 'WAR_NOT_LOADED' end as war_state,
  case
    when s.player_id is null and s.mlb_id is null and s.bref_id is null and s.bref_register_id is null then null
    when coalesce(w.team_rows, 0) > 0 then case when w.ambiguous_rows > 0 then null else coalesce(w.in_war, 0) end
    when nm.observed_through is not null then 0::numeric
    end as interval_bounded_dodgers_bwar,
  w.ambiguous_war as unresolved_dodgers_bwar,
  case when coalesce(w.team_rows, 0) > 0 then w.timing_basis end as timing_resolution_basis,
  case when coalesce(w.team_rows, 0) > 0 then w.exit_basis end as exit_resolution_basis,
  (x.exit_event_id is not null and coalesce(x.exit_label !~* '(approximate|exact date unknown)', true)) as exit_date_is_exact,
  coalesce(w.in_rows, 0) as dodgers_rows_in_interval,
  coalesce(w.out_rows, 0) as dodgers_rows_outside_interval,
  w.out_war as dodgers_bwar_outside_interval,
  nm.observed_through as no_mlb_appearance_observed_through,
  s.start_asset_id, s.start_event_id, x.exit_asset_id, x.exit_event_id
from starts s
cross join as_of ao
left join ex x on x.interval_key = s.interval_key
left join reentry re on re.interval_key = s.interval_key
left join lr on lr.interval_key = s.interval_key
left join lateral (
  select o.observation_type, o.observed_through_date from public.dodgers_control_observations o
  where o.record_status = 'ACTIVE' and o.observation_type <> 'NO_MLB_APPEARANCE_OBSERVED'
    and ((s.start_asset_id is not null and o.subject_asset_id = s.start_asset_id)
      or (s.start_asset_id is null and s.player_id is not null and o.subject_player_id = s.player_id))
  order by o.observed_through_date desc, o.observation_type limit 1
) ob on true
left join lateral (
  select o.observed_through_date as observed_through from public.dodgers_control_observations o
  where o.record_status = 'ACTIVE' and o.observation_type = 'NO_MLB_APPEARANCE_OBSERVED' and s.start_asset_id is not null and o.subject_asset_id = s.start_asset_id
  order by o.observed_through_date desc limit 1
) nm on true
left join lateral (
  select min(t.observed_date) as bound_date from tfacts t where t.fact_type = 'EXIT_BOUNDED_BEFORE' and s.start_asset_id is not null and t.subject_asset_id = s.start_asset_id
) tb on true
left join lateral (
  with t as (
    select wr.season, wr.stint_ordinal, wr.war, o.franchise_key
    from public.player_mlb_team_season_war wr
    left join public.organizations o on o.id = wr.organization_id
    where s.bref_id is not null and wr.bref_id = s.bref_id and wr.record_status = 'ACTIVE' and wr.war_system = 'BWAR'
  ),
  k as (
    select extract(year from s.start_date)::int as ys, extract(month from s.start_date)::int as ms,
      extract(year from x.exit_date)::int as ye, extract(month from x.exit_date)::int as me
  ),
  cpf as (
    select o2.franchise_key from public.organizations o2 where o2.id = s.cp_org_id
  ),
  dr as (
    select t.season, count(distinct t.stint_ordinal) filter (where t.franchise_key = 'DODGERS')::int as d_rows from t group by t.season
  ),
  -- B-Ref stint order is chronological within a season: a same-season Dodgers stint is placed against the acquisition through
  -- the counterparty's single stint (the 032 rule, asset-level counterparty)
  cp as (
    select count(distinct t.stint_ordinal)::int as cp_stints, max(t.stint_ordinal) as cp_ord
    from t cross join k cross join cpf
    where t.season = k.ys and cpf.franchise_key is not null and t.franchise_key = cpf.franchise_key
  ),
  an as (
    select coalesce(bool_or(t.franchise_key = 'DODGERS' and t.stint_ordinal = cp.cp_ord + 1), false) as anchored
    from t cross join k cross join cp where t.season = k.ys
  ),
  ff as (
    select
      coalesce(bool_or(f.fact_type = 'SEASON_START_CONFIRMS_POST_ACQUISITION' and f.season = k.ys), false) as season_start_ok,
      coalesce(bool_or(f.fact_type = 'FIRST_DODGERS_APPEARANCE' and f.season = k.ys and f.observed_date >= s.start_date), false) as first_app_ok
    from k left join tfacts f on s.start_asset_id is not null and f.subject_asset_id = s.start_asset_id
  ),
  cls as (
    select t.*,
      case when t.franchise_key is distinct from 'DODGERS' then null
           when s.start_method = 'TRACKED_SIGNING' then 'IN'
           when t.season < k.ys then 'PRE'
           when t.season > k.ys then 'IN'
           when k.ms >= 11 then 'PRE'
           when k.ms <= 2 then 'IN'
           when ff.season_start_ok then 'IN'
           when ff.first_app_ok and coalesce((select d.d_rows from dr d where d.season = t.season), 0) = 1 then 'IN'
           when an.anchored and cp.cp_stints = 1 and t.stint_ordinal > cp.cp_ord then 'IN'
           when an.anchored and cp.cp_stints = 1 and t.stint_ordinal < cp.cp_ord then 'PRE'
           else 'AMBIG' end as sp,
      case when t.franchise_key is distinct from 'DODGERS' then null
           when x.exit_date is null then 'IN'
           when t.season < k.ye then 'IN'
           when t.season > k.ye then 'OUT'
           when k.me >= 11 then 'IN'
           when k.me <= 2 then 'OUT'
           when x.exit_label ~* '(approximate|exact date unknown)' then 'AMBIG'
           when coalesce((select d.d_rows from dr d where d.season = t.season), 0) = 1 and not coalesce(re.reentry_same_season, false) then 'IN'
           else 'AMBIG' end as ep
    from t cross join k cross join ff cross join an cross join cp
  )
  select
    (select count(*) from t)::int as team_rows,
    case
      when x.exit_date is null then null
      when coalesce((select d.d_rows from dr d, k where d.season = k.ye), 0) = 0 then 'NO_EXIT_SEASON_DODGERS_STINT'
      when (select me from k) >= 11 then 'OFFSEASON_AFTER_SEASON'
      when (select me from k) <= 2 then 'OFFSEASON_BEFORE_SEASON'
      when x.exit_label ~* '(approximate|exact date unknown)' then 'UNRESOLVED'
      when coalesce((select d.d_rows from dr d, k where d.season = k.ye), 0) = 1 and not coalesce(re.reentry_same_season, false) then 'SINGLE_STINT_BEFORE_EXIT'
      else 'UNRESOLVED' end as exit_basis,
    case
      when s.start_method = 'TRACKED_SIGNING' then 'TRACKED_SIGNING'
      when coalesce((select d.d_rows from dr d, k where d.season = k.ys), 0) = 0 then 'NO_ACQUISITION_SEASON_DODGERS_STINT'
      when (select ms from k) >= 11 or (select ms from k) <= 2 then 'CALENDAR'
      when (select season_start_ok from ff) or ((select first_app_ok from ff) and coalesce((select d.d_rows from dr d, k where d.season = k.ys), 0) = 1) then 'TIMING_OBSERVATION'
      when (select anchored from an) and (select cp_stints from cp) = 1 then 'COUNTERPARTY_STINT_ORDER'
      else 'UNRESOLVED' end as timing_basis,
    (select count(*) from cls c where c.sp = 'IN' and c.ep = 'IN')::int as in_rows,
    (select sum(c.war) from cls c where c.sp = 'IN' and c.ep = 'IN') as in_war,
    (select count(*) from cls c where c.sp = 'PRE' or c.ep = 'OUT')::int as out_rows,
    (select sum(c.war) from cls c where c.sp = 'PRE' or c.ep = 'OUT') as out_war,
    (select count(*) from cls c where c.franchise_key = 'DODGERS' and c.sp <> 'PRE' and c.ep <> 'OUT' and (c.sp = 'AMBIG' or c.ep = 'AMBIG'))::int as ambiguous_rows,
    (select sum(c.war) from cls c where c.franchise_key = 'DODGERS' and c.sp <> 'PRE' and c.ep <> 'OUT' and (c.sp = 'AMBIG' or c.ep = 'AMBIG')) as ambiguous_war
) w on true;

comment on view public.v_player_control_intervals is
  'One row per continuous Dodgers organizational tenure of one player identity: the original tracked signing (TRACKED_SIGNING) or an incoming PLAYER asset of a canonical acquisition event (TRADE_ACQUISITION, FREE_AGENT_SIGNING). The interval ends at the first later exit event of the same identity (matched on player_id, mlb_id, bref_id or bref_register_id, never on names); a later re-entry is a new interval and is never reconnected to the earlier one. interval_bounded_dodgers_bwar sums Baseball-Reference bWAR of Dodgers stints inside the interval only: acquisition-relative with the 032 counterparty stint rule, the calendar, or a sourced chronology fact (transaction_asset_timing_observations) - timing_resolution_basis names which; the absence of an earlier modeled interval or a single team row is never accepted as chronology evidence - and exit-relative by an exact-dated exit (offseason, no Dodgers stint that season, or one contiguous Dodgers stint with no same-season re-entry; exit_resolution_basis names which; an approximate exit date never resolves a mid-season stint); a stint that cannot be placed leaves the value NULL (TIMING_UNRESOLVED), never zero. Open intervals report realized bWAR through analysis_as_of_date and may grow.';

-- One row per root package x path x hop: the factual lineage of every Dodgers control interval that descends from a trade of
-- tracked signings. Derived by a cycle-safe recursive traversal of canonical transaction events; no edge is stored.
create or replace view public.v_transaction_asset_lineage
with (security_invoker = true)
as
with recursive iv as (
  select * from public.v_player_control_intervals
),
roots as (
  select e.id as event_id, e.event_key, e.transaction_date,
    e.event_key || '|' || string_agg(p.slug, ',' order by p.slug) as root_key,
    array_agg(p.slug order by p.slug) as slugs,
    (select count(*) from public.transaction_event_assets x where x.event_id = e.id and x.asset_side = 'OUTGOING')::int as out_count
  from public.transaction_events e
  join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = 'OUTGOING' and a.player_id is not null
  join public.players p on p.id = a.player_id
  where e.transaction_type = 'TRADE'
  group by e.id, e.event_key, e.transaction_date
),
-- composition of an exit trade relative to a root: 0 the parent asset alone, 1 consideration or same-root co-members,
-- 2 another root's lineage, a lineage-less player or another tracked signing
parents as (
  select distinct r.root_key, i.exit_event_id
  from iv i cross join lateral unnest(i.lineage_root_keys) as r(root_key)
  where i.exit_method = 'TRADE'
),
outg as (
  select a.id as asset_id, a.event_id, a.asset_type, a.player_id, oi.lineage_root_keys as o_roots
  from public.transaction_event_assets a
  left join iv oi on oi.exit_asset_id = a.id
  where a.asset_side = 'OUTGOING'
),
comp as (
  select p.root_key, p.exit_event_id,
    case when count(*) = 1 then 0
         else greatest(1, max(case when o.asset_type <> 'PLAYER' then 0
                                   when o.player_id is not null then 2
                                   when o.o_roots = array[p.root_key] then 0
                                   else 2 end)) end as class_level
  from parents p
  join outg o on o.event_id = p.exit_event_id
  group by p.root_key, p.exit_event_id
),
lin(root_key, root_event_key, root_slugs, hop, interval_key, path_key, parent_path_key, path_intervals, path_events, lvl, prior_lvl) as (
  select r.root_key, r.event_key, r.slugs, 1, i.interval_key, r.root_key || ' > ' || i.interval_key, null::text,
    array[i.interval_key], array[r.event_key],
    greatest(case when r.out_count = 1 then 0 else 1 end,
             case when i.war_state in ('IDENTITY_UNRESOLVED', 'TIMING_UNRESOLVED') then 3 else 0 end),
    null::int
  from roots r
  join iv i on i.start_event_id = r.event_id and i.start_method <> 'TRACKED_SIGNING'
  union all
  select l.root_key, l.root_event_key, l.root_slugs, l.hop + 1, c.interval_key, l.path_key || ' > ' || c.interval_key, l.path_key,
    l.path_intervals || c.interval_key, l.path_events || p.exit_event_key,
    greatest(l.lvl, cm.class_level, case when c.war_state in ('IDENTITY_UNRESOLVED', 'TIMING_UNRESOLVED') then 3 else 0 end),
    l.lvl
  from lin l
  join iv p on p.interval_key = l.interval_key and p.exit_method = 'TRADE'
  join iv c on c.start_event_id = p.exit_event_id and c.start_method <> 'TRACKED_SIGNING'
  join comp cm on cm.root_key = l.root_key and cm.exit_event_id = p.exit_event_id
  where not (p.exit_event_key = any (l.path_events)) and not (c.interval_key = any (l.path_intervals))
),
lvl_name(n, name) as (
  values (0, 'PLAYER_ATTRIBUTABLE'), (1, 'PACKAGE_ATTRIBUTABLE'), (2, 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'), (3, 'UNRESOLVED')
)
select
  l.root_key as root_package_key, l.root_event_key, l.root_slugs as root_signing_slugs, cardinality(l.root_slugs) as root_signing_count,
  l.path_key, l.parent_path_key, l.hop as hop_number,
  i.interval_key, i.player_slug, i.display_name as asset_name, i.mlb_id, i.bref_id, i.bref_register_id,
  i.start_event_key as acquisition_event_key, i.interval_start as acquisition_date,
  i.exit_event_key, i.interval_end as exit_date, i.exit_method as exit_type,
  i.interval_status,
  ln.name as attribution_level,
  case when ln.name = 'UNRESOLVED' then 'UNRESOLVED' else 'RESOLVED' end as attribution_resolution,
  case i.war_state when 'LOADED' then 'VALUE_RESOLVED' when 'NO_MLB_APPEARANCE_OBSERVED' then 'ZERO_OBSERVED_THROUGH_DATE'
    when 'WAR_NOT_LOADED' then 'VALUE_NOT_LOADED' when 'TIMING_UNRESOLVED' then 'VALUE_TIMING_UNRESOLVED'
    else 'VALUE_IDENTITY_UNRESOLVED' end as value_resolution,
  i.timing_resolution_basis,
  pn.name as prior_attribution_level,
  case
    when i.war_state = 'IDENTITY_UNRESOLVED' then 'IDENTITY_UNRESOLVED'
    when exists (select 1 from lin c where c.parent_path_key = l.path_key) then 'CONTINUES'
    when i.war_state = 'TIMING_UNRESOLVED' then 'TIMING_UNRESOLVED'
    when i.exit_event_id is not null and i.exit_method = 'TRADE' then
      case when ec.unresolved_ptbnl > 0 then 'PENDING_CONSIDERATION'
           when ec.incoming_count = 0 then 'RETURN_UNRECORDED'
           else 'TERMINAL_NON_PLAYER_RETURN' end
    when i.exit_event_id is not null then 'TERMINAL_NO_RETURN'
    when i.interval_status = 'OPEN_CONTROL_OBSERVED' then 'STILL_ACTIVE'
    when i.interval_status = 'CLOSED_CAREER_ENDED' then 'COMPLETE_TERMINAL'
    when i.interval_status = 'EXIT_UNRECORDED_BOUNDED' then 'EXIT_UNRECORDED_BOUNDED'
    when i.interval_status = 'HISTORY_UNAVAILABLE' then 'HISTORY_INCOMPLETE'
    when i.war_state = 'NO_MLB_APPEARANCE_OBSERVED' then 'NO_MLB_APPEARANCE'
    else 'EXIT_NOT_RESEARCHED' end as branch_status,
  i.war_state,
  i.interval_bounded_dodgers_bwar,
  i.unresolved_dodgers_bwar,
  i.analysis_as_of_date,
  l.path_events as path_event_keys,
  i.start_asset_id, i.exit_event_id, i.start_event_id
from lin l
join iv i on i.interval_key = l.interval_key
join lvl_name ln on ln.n = l.lvl
left join lvl_name pn on pn.n = l.prior_lvl
left join lateral (
  select count(*) filter (where a.asset_side = 'INCOMING')::int as incoming_count,
    count(*) filter (where a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER_TO_BE_NAMED' and r.id is null)::int as unresolved_ptbnl
  from public.transaction_event_assets a
  left join public.transaction_asset_resolutions r on r.placeholder_asset_id = a.id and r.record_status = 'ACTIVE'
  where a.event_id = i.exit_event_id
) ec on i.exit_event_id is not null;

comment on view public.v_transaction_asset_lineage is
  'One row per root package x path x hop. A root package is a trade event with at least one tracked signing outgoing, keyed event_key | sorted tracked slugs. Hop 1 is an incoming PLAYER asset of that trade; hop N+1 is an incoming PLAYER asset of the trade in which the hop-N asset left Dodgers control (first exit of the same identity). attribution_level degrades and never improves: PLAYER_ATTRIBUTABLE (the root is the sole outgoing asset and every exit on the path sent the asset alone), PACKAGE_ATTRIBUTABLE (one root package, but a boundary carries other outgoing assets or consideration), CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE (another root lineage, another tracked signing or a lineage-less player participates; visible, never added to a root), UNRESOLVED (identity or timing unresolved). Two dimensions are explicit: attribution_resolution (is the attribution level determinable) and value_resolution (is the bWAR value determinable; VALUE_NOT_LOADED means the WAR source has no row for the player, which does not make the attribution unresolved and is never zero without a dated no-MLB-appearance observation). Outgoing cash, pool space and placeholders always degrade at least to PACKAGE_ATTRIBUTABLE. Events and intervals are visited once per path. interval_bounded_dodgers_bwar is NULL when unresolved, never zero.';

-- One row per root package x downstream control interval, deduplicated across tracked signings and across paths. This is the
-- canonical basis of package-level aggregates: every interval contributes its bWAR once.
create or replace view public.v_transaction_package_lineage
with (security_invoker = true)
as
with lvl_n(name, n) as (
  values ('PLAYER_ATTRIBUTABLE', 0), ('PACKAGE_ATTRIBUTABLE', 1), ('CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE', 2), ('UNRESOLVED', 3)
),
ranked as (
  select l.*, ln.n as lvl,
    row_number() over (partition by l.root_package_key, l.interval_key order by ln.n desc, l.hop_number, l.path_key) as rn,
    count(*) over (partition by l.root_package_key, l.interval_key)::int as path_count,
    min(l.hop_number) over (partition by l.root_package_key, l.interval_key) as min_hop,
    max(l.hop_number) over (partition by l.root_package_key, l.interval_key) as max_hop
  from public.v_transaction_asset_lineage l
  join lvl_n ln on ln.name = l.attribution_level
)
select
  r.root_package_key, r.root_event_key, r.root_signing_slugs, r.root_signing_count,
  r.interval_key, r.asset_name, r.player_slug, r.mlb_id, r.bref_id, r.bref_register_id,
  r.min_hop as hop_number, r.max_hop as max_hop_number, r.path_count,
  r.acquisition_event_key, r.acquisition_date, r.exit_event_key, r.exit_date, r.exit_type, r.interval_status,
  r.attribution_level, r.attribution_resolution, r.value_resolution, r.timing_resolution_basis, r.branch_status, r.war_state,
  r.interval_bounded_dodgers_bwar,
  (r.min_hop = 1) as is_first_hop,
  (r.attribution_level in ('PLAYER_ATTRIBUTABLE', 'PACKAGE_ATTRIBUTABLE') and r.interval_bounded_dodgers_bwar is not null) as is_additive_to_package_total,
  r.analysis_as_of_date
from ranked r
where r.rn = 1;

comment on view public.v_transaction_package_lineage is
  'One row per root package x downstream acquisition interval, deduplicated from per-signing membership and from alternative paths (the most degraded attribution level and the nearest hop are kept; path_count says how many paths reach it). is_additive_to_package_total is true only for PLAYER_ATTRIBUTABLE and PACKAGE_ATTRIBUTABLE intervals with a resolved value: those belong to exactly one root package, so a package total never counts an interval twice and never counts one for several packages. CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE intervals are visible under every root they descend from and additive to none.';

-- Signing-level and package-level downstream organizational realization side by side (row_grain). Signing rows carry only
-- value that is defensibly the signing's own; package rows carry package value once. The two are never merged.
create or replace view public.v_downstream_organizational_realization
with (security_invoker = true)
as
with pk0 as (
  select p.root_package_key,
    min(p.root_event_key) as root_event_key,
    count(*)::int as intervals,
    sum(p.interval_bounded_dodgers_bwar) filter (where p.is_first_hop) as first_hop_sum,
    count(*) filter (where p.is_first_hop and p.interval_bounded_dodgers_bwar is null) as first_hop_unresolved,
    sum(p.interval_bounded_dodgers_bwar) filter (where p.is_first_hop and p.attribution_level = 'PLAYER_ATTRIBUTABLE') as first_hop_player_sum,
    count(*) filter (where p.is_first_hop and p.attribution_level = 'PLAYER_ATTRIBUTABLE' and p.interval_bounded_dodgers_bwar is null) as first_hop_player_unresolved,
    sum(p.interval_bounded_dodgers_bwar) filter (where not p.is_first_hop and p.attribution_level = 'PLAYER_ATTRIBUTABLE') as down_player_sum,
    count(*) filter (where not p.is_first_hop and p.attribution_level = 'PLAYER_ATTRIBUTABLE' and p.interval_bounded_dodgers_bwar is null) as down_player_unresolved,
    sum(p.interval_bounded_dodgers_bwar) filter (where not p.is_first_hop and p.attribution_level = 'PACKAGE_ATTRIBUTABLE') as down_package_sum,
    sum(p.interval_bounded_dodgers_bwar) filter (where p.attribution_level = 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE') as observable_sum,
    max(p.max_hop_number) as max_hop,
    count(*) filter (where not p.is_first_hop)::int as downstream_intervals,
    case
      when bool_or(p.branch_status = 'IDENTITY_UNRESOLVED') then 'INCOMPLETE_IDENTITY'
      when bool_or(p.branch_status = 'TIMING_UNRESOLVED') then 'INCOMPLETE_TIMING'
      when bool_or(p.branch_status = 'PENDING_CONSIDERATION') then 'INCOMPLETE_PENDING_CONSIDERATION'
      when bool_or(p.branch_status = 'RETURN_UNRECORDED') then 'INCOMPLETE_RETURN_UNRECORDED'
      when bool_or(p.branch_status = 'EXIT_NOT_RESEARCHED') then 'INCOMPLETE_EXIT_NOT_RESEARCHED'
      when bool_or(p.branch_status in ('EXIT_UNRECORDED_BOUNDED', 'HISTORY_INCOMPLETE')) then 'INCOMPLETE_EXIT_UNRECORDED'
      when bool_or(p.war_state = 'WAR_NOT_LOADED') then 'INCOMPLETE_WAR_NOT_LOADED'
      when bool_or(p.branch_status = 'STILL_ACTIVE') then 'STILL_ACTIVE'
      else 'COMPLETE_TERMINAL' end as chain_status
  from public.v_transaction_package_lineage p
  group by p.root_package_key
),
rp as (
  select e.event_key, e.event_key || '|' || string_agg(pl.slug, ',' order by pl.slug) as root_package_key
  from public.transaction_events e
  join public.transaction_event_assets a on a.event_id = e.id and a.asset_side = 'OUTGOING' and a.player_id is not null
  join public.players pl on pl.id = a.player_id
  where e.transaction_type = 'TRADE'
  group by e.event_key
),
-- a trade with no incoming PLAYER asset has no lineage; its state is the first-hop return state
rs as (
  select distinct on (x.event_key) x.event_key, x.return_state
  from public.v_trade_realization_edges x where x.incoming_asset_id is null
  order by x.event_key
),
pk as (
  select r.root_package_key,
    r.event_key as root_event_key,
    string_to_array(split_part(r.root_package_key, '|', 2), ',') as root_signing_slugs,
    case when k.root_package_key is not null then k.first_hop_unresolved
         when rs.return_state = 'NO_PLAYER_RETURN' then 0 else 1 end as first_hop_unresolved,
    case when k.root_package_key is null and rs.return_state = 'NO_PLAYER_RETURN' then 0 else k.first_hop_sum end as first_hop_value,
    k.first_hop_player_sum, coalesce(k.first_hop_player_unresolved, 0) as first_hop_player_unresolved,
    k.down_player_sum, coalesce(k.down_player_unresolved, 0) as down_player_unresolved,
    k.down_package_sum, k.observable_sum,
    coalesce(k.max_hop, 0) as max_hop,
    coalesce(k.downstream_intervals, 0) as downstream_intervals,
    coalesce(k.chain_status,
      case rs.return_state when 'NO_PLAYER_RETURN' then 'COMPLETE_TERMINAL'
                           when 'PLAYER_RETURN_PENDING' then 'INCOMPLETE_PENDING_CONSIDERATION'
                           when 'RETURN_UNRECORDED' then 'INCOMPLETE_RETURN_UNRECORDED'
                           else 'INCOMPLETE_RETURN_UNRECORDED' end) as chain_status
  from rp r
  left join pk0 k on k.root_package_key = r.root_package_key
  left join rs on rs.event_key = r.event_key
),
sign as (
  select r.player_id, r.player_slug, r.full_name, r.signing_id, r.signing_year, r.pathway, r.country_market, r.known_acquisition_cost_usd,
    r.acquisition_cost_completeness, r.cost_metric_eligible, r.maturity_status, r.analysis_as_of_date,
    r.direct_dodgers_mlb_bwar, r.trade_package_return_dodgers_bwar as legacy_first_hop_return_bwar,
    r.individually_attributable_trade_return_bwar as legacy_individually_attributable_first_hop_bwar,
    r.attributable_organizational_bwar as legacy_attributable_organizational_bwar,
    r.package_attribution_state as legacy_package_attribution_state,
    r.downstream_asset_chain_incomplete as legacy_downstream_asset_chain_incomplete
  from public.v_player_organizational_realization r
),
mine as (
  select s.player_id, k.*
  from sign s
  join pk k on s.player_slug = any (k.root_signing_slugs)
),
agg as (
  select m.player_id,
    array_agg(m.root_package_key order by m.root_package_key) as root_package_keys,
    count(*)::int as root_package_count,
    sum(m.first_hop_value) as first_hop_sum, sum(m.first_hop_unresolved) as first_hop_unresolved,
    sum(m.first_hop_player_sum) as first_hop_player_sum, sum(m.first_hop_player_unresolved) as first_hop_player_unresolved,
    sum(m.down_player_sum) as down_player_sum, sum(m.down_player_unresolved) as down_player_unresolved,
    sum(m.down_package_sum) as down_package_sum,
    sum(m.observable_sum) as observable_sum,
    max(m.max_hop) as max_hop,
    sum(m.downstream_intervals)::int as downstream_intervals,
    (array_agg(m.chain_status order by case m.chain_status when 'INCOMPLETE_IDENTITY' then 1 when 'INCOMPLETE_TIMING' then 2
       when 'INCOMPLETE_PENDING_CONSIDERATION' then 3 when 'INCOMPLETE_RETURN_UNRECORDED' then 4 when 'INCOMPLETE_EXIT_NOT_RESEARCHED' then 5
       when 'INCOMPLETE_EXIT_UNRECORDED' then 6 when 'INCOMPLETE_WAR_NOT_LOADED' then 7 when 'STILL_ACTIVE' then 8 else 9 end))[1] as chain_status
  from mine m
  group by m.player_id
),
signing_rows as (
  select 'SIGNING'::text as row_grain,
    s.player_slug, s.full_name, s.player_id, s.signing_id, s.signing_year, s.pathway, s.country_market,
    s.known_acquisition_cost_usd, s.acquisition_cost_completeness, s.cost_metric_eligible, s.maturity_status,
    null::text as root_package_key, null::text as root_event_key, coalesce(a.root_package_keys, array[]::text[]) as root_package_keys,
    coalesce(a.root_package_count, 0) as root_package_count,
    s.direct_dodgers_mlb_bwar,
    s.legacy_first_hop_return_bwar, s.legacy_individually_attributable_first_hop_bwar, s.legacy_package_attribution_state, s.legacy_downstream_asset_chain_incomplete,
    case when a.player_id is not null and a.first_hop_unresolved = 0 then a.first_hop_sum end as interval_bounded_first_hop_package_bwar,
    case when a.player_id is not null and a.first_hop_player_unresolved = 0 then coalesce(a.first_hop_player_sum, 0) end as interval_bounded_individually_attributable_first_hop_bwar,
    case when a.player_id is not null and a.down_player_unresolved = 0 then coalesce(a.down_player_sum, 0) end as downstream_individually_attributable_bwar,
    a.down_package_sum as package_participation_downstream_bwar,
    a.observable_sum as observable_not_attributable_bwar,
    case when s.direct_dodgers_mlb_bwar is null then null
         when a.player_id is null then s.direct_dodgers_mlb_bwar
         when a.first_hop_player_unresolved > 0 or a.down_player_unresolved > 0 then null
         else s.direct_dodgers_mlb_bwar + coalesce(a.first_hop_player_sum, 0) + coalesce(a.down_player_sum, 0) end as total_individually_attributable_organizational_bwar,
    a.max_hop as max_observed_hop,
    case when a.player_id is null then 'NO_TRADE_CHAIN' else a.chain_status end as chain_status,
    s.analysis_as_of_date
  from sign s
  left join agg a on a.player_id = s.player_id
),
package_rows as (
  select 'PACKAGE'::text as row_grain,
    null::text, null::text, null::uuid, null::uuid, null::int, null::text, null::text,
    null::numeric, null::text, null::boolean, null::text,
    k.root_package_key, k.root_event_key, array[k.root_package_key], 1,
    null::numeric,
    null::numeric, null::numeric, null::text, null::boolean,
    case when k.first_hop_unresolved = 0 then k.first_hop_value end,
    case when k.first_hop_player_unresolved = 0 then coalesce(k.first_hop_player_sum, 0) end,
    case when k.down_player_unresolved = 0 then coalesce(k.down_player_sum, 0) end,
    k.down_package_sum,
    k.observable_sum,
    null::numeric,
    k.max_hop,
    k.chain_status,
    (select max(audited_through_date) from public.outcome_audits)
  from pk k
)
select * from signing_rows
union all
select * from package_rows;

comment on view public.v_downstream_organizational_realization is
  'Downstream organizational realization beside the 032/033 first-hop columns, which are preserved unchanged (legacy_*). row_grain SIGNING: one row per tracked signing; individually attributable value only (interval_bounded_individually_attributable_first_hop_bwar and downstream_individually_attributable_bwar), the package value the signing participated in (package_participation_downstream_bwar, non-additive across the package members) and observable_not_attributable_bwar (mixed lineage, visible only). total_individually_attributable_organizational_bwar = direct Dodgers bWAR + interval-bounded PLAYER_ATTRIBUTABLE first-hop return + downstream PLAYER_ATTRIBUTABLE bWAR; package-attributable, mixed-lineage and unresolved value are never added; it is NULL when any PLAYER_ATTRIBUTABLE interval is unresolved. row_grain PACKAGE: one row per root package, deduplicated, never merged into a signing total. chain_status: COMPLETE_TERMINAL, STILL_ACTIVE (open chains grow), or INCOMPLETE_* (a data deficiency); a known attribution boundary is not incompleteness. Realized value is through analysis_as_of_date.';

create or replace view public.v_dodgers_international_value_portfolio
with (security_invoker = true)
as
with base as (
  select r.*,
    r.cost_metric_eligible as direct_ratio_eligible,
    (r.cost_metric_eligible and r.attributable_organizational_bwar is not null) as attributable_ratio_eligible
  from public.v_player_organizational_realization r
),
grains as (
  select 'ALL'::text as grain, 'All tracked Dodgers signings'::text as grain_value, 0 as sort_key, b.* from base b
  union all select 'SIGNING_YEAR', b.signing_year::text, b.signing_year, b.* from base b
  union all select 'SIGNING_ERA', case when b.signing_year < 2000 then 'Before 2000' when b.signing_year < 2012 then '2000-2011'
      when b.signing_year < 2018 then '2012-2017' else '2018 and later' end,
      case when b.signing_year < 2000 then 1 when b.signing_year < 2012 then 2 when b.signing_year < 2018 then 3 else 4 end, b.* from base b
  union all select 'MARKET', coalesce(b.country_market, 'Unknown'), 0, b.* from base b
  union all select 'PATHWAY', b.pathway, 0, b.* from base b
),
core as (
select
  g.grain, g.grain_value,
  count(*)::int as tracked_signings,
  count(*) filter (where g.maturity_status = 'MATURE')::int as mature_signings,
  count(*) filter (where g.direct_dodgers_mlb_bwar is not null)::int as outcome_observed_signings,
  count(*) filter (where g.reached_mlb_verified is true)::int as verified_mlb_reached,
  count(*) filter (where g.acquisition_cost_completeness = 'COMPLETE')::int as complete_cost_signings,
  count(*) filter (where g.direct_ratio_eligible)::int as direct_ratio_eligible_signings,
  count(*) filter (where g.attributable_ratio_eligible)::int as attributable_ratio_eligible_signings,
  sum(g.known_acquisition_cost_usd) filter (where g.direct_ratio_eligible) as eligible_known_acquisition_cost_usd,
  sum(g.direct_dodgers_mlb_bwar) filter (where g.direct_ratio_eligible) as eligible_direct_dodgers_bwar,
  round(sum(g.direct_dodgers_mlb_bwar) filter (where g.direct_ratio_eligible)
        / nullif(sum(g.known_acquisition_cost_usd) filter (where g.direct_ratio_eligible) / 1000000.0, 0), 3) as aggregate_direct_dodgers_bwar_per_million,
  sum(g.known_acquisition_cost_usd) filter (where g.attributable_ratio_eligible) as attributable_eligible_known_acquisition_cost_usd,
  sum(g.attributable_organizational_bwar) filter (where g.attributable_ratio_eligible) as eligible_attributable_organizational_bwar,
  round(sum(g.attributable_organizational_bwar) filter (where g.attributable_ratio_eligible)
        / nullif(sum(g.known_acquisition_cost_usd) filter (where g.attributable_ratio_eligible) / 1000000.0, 0), 3) as aggregate_attributable_organizational_bwar_per_million,
  (count(*) filter (where g.direct_ratio_eligible) < 5) as direct_ratio_small_sample,
  sum(g.individually_attributable_trade_return_bwar) as attributable_trade_return_bwar,
  sum(g.trade_package_return_dodgers_bwar) as package_return_dodgers_bwar,
  sum(g.non_dodgers_mlb_bwar) as non_dodgers_mlb_bwar_observed,
  'Tracked / verified-set analytic over the eligible rows named above; not an organization-wide rate. Eligible rows: mature, COMPLETE acquisition cost greater than zero, direct Dodgers bWAR observed.'::text as population_label
from grains g
group by g.grain, g.grain_value, g.sort_key
),
dsr as (
  select * from public.v_downstream_organizational_realization where row_grain = 'SIGNING'
),
pkr as (
  select * from public.v_downstream_organizational_realization where row_grain = 'PACKAGE'
),
sg as (
  select g.grain, g.grain_value,
    sum(d.interval_bounded_individually_attributable_first_hop_bwar) as interval_bounded_individually_attributable_first_hop_bwar,
    sum(d.downstream_individually_attributable_bwar) as downstream_individually_attributable_bwar,
    (count(*) filter (where g.cost_metric_eligible and d.total_individually_attributable_organizational_bwar is not null))::int as total_attributable_ratio_eligible_signings,
    sum(g.known_acquisition_cost_usd) filter (where g.cost_metric_eligible and d.total_individually_attributable_organizational_bwar is not null) as total_attributable_eligible_known_acquisition_cost_usd,
    sum(d.total_individually_attributable_organizational_bwar) filter (where g.cost_metric_eligible and d.total_individually_attributable_organizational_bwar is not null) as eligible_total_individually_attributable_bwar
  from grains g
  join dsr d on d.player_id = g.player_id
  group by g.grain, g.grain_value
),
pk as (
  select distinct g.grain, g.grain_value, k.root_key
  from grains g
  join dsr d on d.player_id = g.player_id
  cross join lateral unnest(d.root_package_keys) as k(root_key)
),
pkv as (
  select pk.grain, pk.grain_value, p.*
  from pk join pkr p on p.root_package_key = pk.root_key
),
plx as (
  select pk.grain, pk.grain_value, l.*
  from pk join public.v_transaction_package_lineage l on l.root_package_key = pk.root_key
),
dd as (
  select distinct on (x.grain, x.grain_value, x.interval_key) x.grain, x.grain_value, x.interval_key, x.interval_bounded_dodgers_bwar, x.attribution_level
  from plx x
  order by x.grain, x.grain_value, x.interval_key, case when x.is_first_hop then 0 else 1 end
),
dds as (
  select d.grain, d.grain_value,
    sum(d.interval_bounded_dodgers_bwar) as package_deduplicated_total_bwar,
    sum(d.interval_bounded_dodgers_bwar) filter (where d.attribution_level = 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE') as observable_not_attributable_bwar
  from dd d group by d.grain, d.grain_value
),
pm as (
  select v.grain, v.grain_value,
    count(*)::int as root_packages,
    sum(v.interval_bounded_first_hop_package_bwar) as interval_bounded_first_hop_package_bwar,
    sum(v.package_participation_downstream_bwar) as downstream_package_attributable_bwar,
    (count(*) filter (where v.chain_status like 'INCOMPLETE%'))::int as packages_incomplete,
    (count(*) filter (where v.chain_status = 'STILL_ACTIVE'))::int as packages_open,
    max(v.max_observed_hop) as max_observed_depth
  from pkv v group by v.grain, v.grain_value
),
pq as (
  select x.grain, x.grain_value,
    (count(distinct x.root_package_key) filter (where not x.is_first_hop and x.interval_bounded_dodgers_bwar is not null))::int as packages_with_downstream_realization,
    (count(distinct x.root_package_key) filter (where x.attribution_level = 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'))::int as packages_blocked_by_mixed_lineage
  from plx x group by x.grain, x.grain_value
)
select core.*,
  sg.interval_bounded_individually_attributable_first_hop_bwar,
  sg.downstream_individually_attributable_bwar,
  sg.total_attributable_ratio_eligible_signings,
  sg.total_attributable_eligible_known_acquisition_cost_usd,
  sg.eligible_total_individually_attributable_bwar,
  round(sg.eligible_total_individually_attributable_bwar / nullif(sg.total_attributable_eligible_known_acquisition_cost_usd / 1000000.0, 0), 3) as aggregate_total_individually_attributable_bwar_per_million,
  pm.root_packages,
  pm.interval_bounded_first_hop_package_bwar,
  pm.downstream_package_attributable_bwar,
  dds.package_deduplicated_total_bwar,
  dds.observable_not_attributable_bwar,
  pq.packages_with_downstream_realization,
  pq.packages_blocked_by_mixed_lineage,
  pm.packages_incomplete,
  pm.packages_open,
  pm.max_observed_depth
from core
left join sg on sg.grain = core.grain and sg.grain_value = core.grain_value
left join pm on pm.grain = core.grain and pm.grain_value = core.grain_value
left join dds on dds.grain = core.grain and dds.grain_value = core.grain_value
left join pq on pq.grain = core.grain and pq.grain_value = core.grain_value;

comment on view public.v_dodgers_international_value_portfolio is
  'Migration 034 appends downstream columns and leaves every earlier column unchanged (package_return_dodgers_bwar still sums per signing, so a package with several tracked signings repeats; the package-deduplicated measures group by root_package_key first). package_deduplicated_total_bwar is an observed lineage total (first-hop package value + downstream PLAYER_ATTRIBUTABLE + downstream PACKAGE_ATTRIBUTABLE + CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE intervals, each interval once), not an individually attributable total; only the individually-attributable and total_individually_attributable columns are attributable to a signing. Aggregate value per $1M by grain (all, signing year, era, market, pathway) using SUM(value) / SUM(cost) over the same eligible rows: mature, COMPLETE acquisition cost, outcome observed. The eligible counts and cost are explicit. These are tracked / verified-set analytics, not organization-wide hit rates (no signing period is rate-eligible), and they differ from the legacy average-of-ratios KPI by design.';

create or replace view public.v_value_research_queue
with (security_invoker = true)
as
with r as (select * from public.v_player_organizational_realization),
issues as (
  select 'TEAM_WAR_MISSING'::text as issue, 1 as priority, r.player_slug, r.signing_id, null::text as event_key,
    format('Verified MLB-reached %s signing (%s) has no loaded team-season bWAR facts', r.signing_year, r.pathway) as detail
  from r where r.team_history_status = 'MISSING'
  union all
  select 'TEAM_HISTORY_UNRESOLVED', 1, p.slug, null, null,
    format('%s %s team code %s has no organization mapping', w.season, w.component, w.bref_team_code)
  from public.player_mlb_team_season_war w left join public.players p on p.id = w.player_id
  where w.record_status = 'ACTIVE' and w.organization_id is null
  union all
  select 'CAREER_WAR_RECONCILIATION_REQUIRED', 1, r.player_slug, r.signing_id, null,
    format('Team-season total %s versus career bWAR %s', r.team_season_career_bwar, r.career_bwar)
  from r where r.team_history_status = 'LOADED_NEEDS_REVIEW'
  union all
  select 'CAREER_WAR_RECONCILIATION_REQUIRED', 2, r.player_slug, r.signing_id, null,
    format('Legacy career-WAR stores disagree: outcomes %s versus metric %s', r.outcomes_career_bwar, r.metric_career_bwar)
  from (select r2.player_slug, r2.signing_id, oc.career_war as outcomes_career_bwar, wv.career_bwar as metric_career_bwar
        from public.v_player_organizational_realization r2
        join public.outcomes oc on oc.player_id = r2.player_id left join public.v_player_war wv on wv.player_id = r2.player_id
        where (oc.career_war is null) <> (wv.career_bwar is null) or abs(coalesce(oc.career_war, 0) - coalesce(wv.career_bwar, 0)) > 0.1) r
  union all
  select 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED', 2, r.player_slug, r.signing_id, null,
    format('Traded in a shared outgoing package; the package returned %s Dodgers bWAR and no individual share is assigned', r.trade_package_return_dodgers_bwar)
  from r where r.package_attribution_state = 'SHARED_PACKAGE_NOT_ATTRIBUTABLE'
  union all
  select 'TRADE_RETURN_TIMING_UNRESOLVED', 2, null::text, null::uuid, l.acquisition_event_key,
    format('Incoming %s has a Dodgers stint in the acquisition season that cannot be placed against the acquisition; no sourced chronology fact exists, so the return is not counted', l.asset_name)
  from public.v_transaction_asset_lineage l where l.hop_number = 1 and l.war_state = 'TIMING_UNRESOLVED'
  union all
  select 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE', 3, d.player_slug, d.signing_id, null,
    format('The downstream chain is %s: incomplete data, not a known attribution boundary', d.chain_status)
  from public.v_downstream_organizational_realization d where d.row_grain = 'SIGNING' and d.chain_status like 'INCOMPLETE%'
  union all
  select 'LINEAGE_BOUNDARY_NOTED', 4, null::text, null::uuid, b.acquisition_event_key,
    format('Informational: %s is %s (it was %s earlier on the path); the value is visible and not added to a single root', b.asset_name, b.attribution_level, b.prior_attribution_level)
  from (
    select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name, l.attribution_level, l.prior_attribution_level
    from public.v_transaction_asset_lineage l
    where l.prior_attribution_level is not null and l.attribution_level = 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE' and l.prior_attribution_level <> l.attribution_level
    order by l.interval_key
  ) b
  union all
  select 'ACQUISITION_COST_INCOMPLETE', 3, r.player_slug, r.signing_id, null,
    format('%s %s signing with a verified MLB outcome has %s acquisition cost; no cost-aware ratio is computed', r.signing_year, r.pathway, r.acquisition_cost_completeness)
  from r where r.reached_mlb_verified is true and r.acquisition_cost_completeness <> 'COMPLETE'
  union all
  select 'OUTCOME_INCOMPLETE', 2, r.player_slug, r.signing_id, null,
    format('%s signing: %s', r.signing_year, case when r.outcome_state is null then 'outcome never audited although the signing is mature'
                                                   when r.outcome_state = 'NO_MLB_STATUS_UNKNOWN' then 'outcome audited as status unknown' else r.organizational_realization_status end)
  from r where r.organizational_realization_status = 'OUTCOME_INCOMPLETE' and r.reached_mlb_verified is not true
  union all
  select 'TRADE_RECORD_MISSING', 3, r.player_slug, r.signing_id, null,
    format('First MLB season (%s) was with another organization and no exit transaction is recorded', r.first_mlb_season)
  from r
  where r.reached_mlb_verified is true and r.first_mlb_franchise is not null and r.first_mlb_franchise is distinct from 'DODGERS'
    and not exists (select 1 from public.transactions t where t.player_id = r.player_id)
    and not exists (select 1 from public.transaction_event_assets a where a.player_id = r.player_id)
)
select i.issue, i.priority, i.player_slug, i.signing_id, i.event_key, i.detail from issues i;

comment on view public.v_value_research_queue is
  'Unresolved value research, derived from the facts: missing team-season WAR, unmapped team codes, career-total reconciliation, shared-package attribution, downstream chains, incomplete acquisition cost for verified MLB outcomes, incomplete outcomes, and exits with no recorded transaction. Migration 034 recomputes the trade-return timing and downstream-chain issues from control intervals and lineage, and notes attribution boundaries informationally (LINEAGE_BOUNDARY_NOTED is not missing research). Nothing is queued from unverified snippets.';

create or replace view public.v_transaction_research_queue
with (security_invoker = true)
as
with issues as (
  select 'EXIT_TRANSACTION_MISSING'::text as issue, 1 as priority, s.player_slug, null::text as event_key, null::text as asset_name,
    'The transaction history is unavailable from the official log; no exit was inferred'::text as detail
  from public.v_dodgers_international_exit_summary s where s.control_state = 'HISTORY_UNAVAILABLE'
  union all
  select 'EXIT_STATUS_UNVERIFIED', 2, s.player_slug, null, null,
    'No sourced exit and no verification that Dodgers control continues; absence from recent seasons is not proof of an exit'
  from public.v_dodgers_international_exit_summary s where s.control_state = 'NO_EXIT_EVIDENCE'
  union all
  select 'PTBNL_UNRESOLVED', 2, null, e.event_key, a.asset_name,
    format('%s %s consideration is a player to be named later with no sourced resolution', a.asset_side, e.transaction_date)
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'PLAYER_TO_BE_NAMED'
    and not exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id and r.record_status = 'ACTIVE')
  union all
  select 'FUTURE_CONSIDERATIONS_UNRESOLVED', 3, null, e.event_key, a.asset_name,
    format('%s future considerations on %s are unspecified in the sources', a.asset_side, e.transaction_date)
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'FUTURE_CONSIDERATIONS'
    and not exists (select 1 from public.transaction_asset_resolutions r where r.placeholder_asset_id = a.id and r.record_status = 'ACTIVE')
  union all
  select 'POOL_SPACE_AMOUNT_UNKNOWN', 3, null, e.event_key, a.asset_name,
    format('International bonus-pool space moved on %s with no sourced amount', e.transaction_date)
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'INTERNATIONAL_BONUS_POOL_SPACE' and a.pool_space_amount_usd is null
  union all
  select 'CASH_AMOUNT_UNKNOWN', 3, null, e.event_key, a.asset_name,
    format('Cash moved on %s with no sourced amount', e.transaction_date)
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'CASH' and a.cash_amount_usd is null
  union all
  select 'EVENT_ASSET_IDENTITY_MISSING', 2, null, e.event_key, a.asset_name,
    'A PLAYER asset has no DISI player, MLB id, Baseball-Reference id or Register id'
  from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
  where a.asset_type = 'PLAYER' and a.player_id is null and a.mlb_id is null and a.bref_id is null and a.bref_register_id is null
  union all
  select 'RETURN_ASSET_EXIT_MISSING', 3, null, c.acquisition_event_key, c.asset_name,
    format('Return asset acquired %s has no recorded exit and no observation of continued control (%s)', c.acquisition_date, c.chain_readiness_status)
  from public.v_transaction_asset_chain_readiness c
  where c.chain_readiness_status in ('EXIT_NOT_RESEARCHED', 'HISTORY_INCOMPLETE') and not c.no_mlb_appearance_observed
  union all
  select 'TRADE_RETURN_TIMING_UNRESOLVED', 2, null::text, l.acquisition_event_key, l.asset_name,
    'The incoming player has a Dodgers stint in the acquisition season that cannot be placed against the acquisition; no sourced chronology fact exists, so the return is not counted'
  from public.v_transaction_asset_lineage l where l.hop_number = 1 and l.war_state = 'TIMING_UNRESOLVED'
  union all
  select 'TRADE_RETURN_UNRECORDED', 2, null, e.event_key, null,
    'No incoming consideration is recorded for this trade; the return is unknown, not zero'
  from public.v_trade_realization_edges e where e.return_state = 'RETURN_UNRECORDED'
  union all
  select 'TRANSACTION_DATE_CONFLICT', 1, p.slug, e.event_key, null,
    format('Legacy transaction dated %s but the canonical event is dated %s', t.transaction_date, e.transaction_date)
  from public.transactions t
  join public.players p on p.id = t.player_id
  join public.transaction_event_assets a on a.player_id = t.player_id and a.asset_side = 'OUTGOING'
  join public.transaction_events e on e.id = a.event_id and e.transaction_type = t.transaction_type
  where e.transaction_date <> t.transaction_date
    and not exists (select 1 from public.transaction_event_assets a2 join public.transaction_events e2 on e2.id = a2.event_id
      where a2.player_id = t.player_id and a2.asset_side = 'OUTGOING' and e2.transaction_type = t.transaction_type and e2.transaction_date = t.transaction_date)
  union all
  select 'LEGACY_TRANSACTION_WITHOUT_EVENT', 1, p.slug, null, null,
    format('Legacy %s transaction on %s has no canonical event', t.transaction_type, t.transaction_date)
  from public.transactions t join public.players p on p.id = t.player_id
  where not exists (select 1 from public.transaction_event_assets a2 join public.transaction_events e2 on e2.id = a2.event_id
      where a2.player_id = t.player_id and a2.asset_side = 'OUTGOING' and e2.transaction_type = t.transaction_type)
  union all
  select 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION', 3, null::text, d.exit_event_key, d.display_name,
    'The identity has Dodgers team-season rows after a recorded exit and no recorded acquisition event; the later stint is outside every interval and is not credited to any trade return'
  from (select distinct on (e.interval_key) e.interval_key, e.exit_event_key, e.display_name from public.v_player_control_intervals e
        where e.interval_end is not null and e.bref_id is not null and exists (
          select 1 from public.player_mlb_team_season_war w join public.organizations o on o.id = w.organization_id
          where w.bref_id = e.bref_id and w.record_status = 'ACTIVE' and w.war_system = 'BWAR' and o.franchise_key = 'DODGERS'
            and (w.season > extract(year from e.interval_end)::int
                 or (w.season = extract(year from e.interval_end)::int and extract(month from e.interval_end) <= 2))
            and not exists (select 1 from public.v_player_control_intervals j where j.bref_id = e.bref_id and j.interval_key <> e.interval_key
                  and j.interval_start > e.interval_end and extract(year from j.interval_start) <= w.season
                  and (j.interval_end is null or extract(year from j.interval_end) >= w.season)))
        order by e.interval_key) d
  union all
  select 'DOWNSTREAM_TIMING_UNRESOLVED', 2, null::text, d.acquisition_event_key, d.asset_name,
    'A downstream asset has a Dodgers stint that cannot be placed inside its control interval; its value is not counted'
  from (select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name from public.v_transaction_asset_lineage l
        where l.hop_number > 1 and l.war_state = 'TIMING_UNRESOLVED' order by l.interval_key) d
  union all
  select 'EXIT_NOT_RESEARCHED_DOWNSTREAM', 3, null::text, d.acquisition_event_key, d.asset_name,
    'A downstream asset acquired in a recorded trade has no recorded exit and no observation of continued control'
  from (select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name from public.v_transaction_asset_lineage l
        where l.hop_number > 1 and l.branch_status = 'EXIT_NOT_RESEARCHED' and l.war_state <> 'NO_MLB_APPEARANCE_OBSERVED' order by l.interval_key) d
  union all
  select 'DOWNSTREAM_WAR_NOT_LOADED', 3, null::text, d.acquisition_event_key, d.asset_name,
    'A downstream asset has no loaded team-season facts and no dated no-MLB-appearance observation; its value is unknown, not zero'
  from (select distinct on (l.interval_key) l.interval_key, l.acquisition_event_key, l.asset_name from public.v_transaction_asset_lineage l
        where l.hop_number > 1 and l.war_state = 'WAR_NOT_LOADED' order by l.interval_key) d
)
select i.issue, i.priority, i.player_slug, i.event_key, i.asset_name, i.detail from issues i;

comment on view public.v_transaction_research_queue is
  'Unresolved transaction research, derived from the facts (Migration 034 adds the downstream issues EXIT_NOT_RESEARCHED_DOWNSTREAM, DOWNSTREAM_WAR_NOT_LOADED, DOWNSTREAM_TIMING_UNRESOLVED and DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION and recomputes the first-hop timing issue from control intervals): players with no exit evidence or unavailable history, unresolved players to be named later and future considerations, unknown cash and pool-space amounts, assets with no stable identity, return assets with no recorded exit, unresolved trade-return timing, unrecorded returns, and legacy / canonical date conflicts. Nothing is queued from unverified snippets.';

-- ===========================================================================
-- 8. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['transaction_asset_timing_observations', 'v_player_control_intervals', 'v_transaction_asset_lineage', 'v_transaction_package_lineage',
    'v_downstream_organizational_realization', 'v_dodgers_international_value_portfolio', 'v_value_research_queue', 'v_transaction_research_queue'] loop
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
    raise exception '034: API roles hold privileges beyond SELECT: %', bad;
  end if;

  select jsonb_array_length(j -> 'events') into expected from _m034;
  select count(*) into n from public.transaction_events e where exists (select 1 from _m034, jsonb_array_elements(j -> 'events') x where x ->> 'key' = e.event_key);
  if n <> expected then
    raise exception '034 postcondition: % of % reviewed transaction events are present', n, expected;
  end if;
  select (j ->> 'expected_total_assets')::int into expected from _m034;
  select count(*) into n from public.transaction_event_assets;
  if n <> expected then
    raise exception '034 postcondition: % transaction event assets exist, % expected', n, expected;
  end if;
  select jsonb_array_length(j -> 'timing') into expected from _m034;
  select count(*) into n from public.transaction_asset_timing_observations where record_status = 'ACTIVE';
  if n <> expected then
    raise exception '034 postcondition: % of % reviewed timing observations are present', n, expected;
  end if;
  select jsonb_array_length(j -> 'war' -> 'rows') into expected from _m034;
  select count(*) into n from public.player_mlb_team_season_war w
  where w.record_status = 'ACTIVE' and exists (select 1 from _m034, jsonb_array_elements(j -> 'war' -> 'rows') r
    where r ->> 0 = w.bref_id and (r ->> 2)::int = w.season and r ->> 3 = w.bref_team_code and (r ->> 4)::int = w.stint_ordinal and r ->> 5 = w.component);
  if n <> expected then
    raise exception '034 postcondition: % of % reviewed team-season rows are present', n, expected;
  end if;
  select count(*) into n from public.player_mlb_team_season_war where organization_id is null and record_status = 'ACTIVE';
  if n <> 0 then
    raise exception '034 postcondition: % loaded team-season row(s) have no organization', n;
  end if;
  -- no control interval ends before it starts; no lineage row exits before it was acquired
  select count(*) into n from public.v_player_control_intervals where interval_end is not null and interval_end < interval_start;
  if n <> 0 then
    raise exception '034 postcondition: % control interval(s) end before they start', n;
  end if;
end $$;

commit;
