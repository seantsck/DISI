-- DISI v0.23
-- 032_player_value_organizational_realization.sql
-- Player value and organizational realization: team-season bWAR facts and the derived views that separate a
-- player's career outcome from the value realized by the Dodgers. Run after 031.
--
-- Built from database/research/032/ (war-seed.json, scope-config.json, audit.mjs, build.mjs).
--
-- What this is. A factual layer plus derived views. The facts are Baseball-Reference team-season bWAR rows
-- (one row per player, season, team, stint and BAT / PITCH component). Everything else is derived. No dollar
-- valuation, no speculative weights, no downstream chain beyond one transaction hop, and no value is attributed
-- to trainers, academies or programs.
--
-- What it does:
--   * Adds player_mlb_team_season_war (bWAR only; BAT and PITCH kept apart; ACTIVE / RETRACTED lifecycle with
--     supersession; a row whose team code cannot be mapped stays visible with organization_id NULL).
--   * Adds bref_team_code_map (Baseball-Reference franchise code -> DISI organization, with season ranges).
--   * Adds transaction_event_assets.bref_id (nullable) so an incoming trade-return player can join team-season
--     WAR without a DISI players row.
--   * Loads 754 team-season rows for the 47 verified MLB-reached Dodgers signings and the three modeled return
--     assets (Josh Fields, Tony Watson, Manny Machado) from the two Baseball-Reference WAR data files.
--   * Reconciles the legacy career-WAR stores against the loaded facts (Carlos Frias, Roger Cedeno: outcomes
--     career_war backfilled; Eddys Leonard: CAREER_BWAR observation added). Only values the new facts prove.
--   * Adds four views: v_trade_realization_edges, v_player_organizational_realization,
--     v_dodgers_international_value_portfolio and v_value_research_queue. All security_invoker, SELECT-only.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/032/war-seed.json)
-- ===========================================================================

create temporary table _m032 on commit drop as
select $m032${"backfills":[{"expected":"-0.3","slug":"carlos-frias","store":"OUTCOMES_CAREER_WAR"},{"expected":"-0.2","slug":"eddys-leonard","store":"METRIC_CAREER_BWAR"},{"expected":"1.7","slug":"roger-cedeno","store":"OUTCOMES_CAREER_WAR"}],"bat_url":"https://www.baseball-reference.com/data/war_daily_bat.txt","observed_through_date":"2026-09-28","observed_through_season":2026,"pitch_url":"https://www.baseball-reference.com/data/war_daily_pitch.txt","retrieved_at":"2026-10-10T07:36:40Z","return_assets":[{"asset_name":"Josh Fields","bref_id":"fieldjo03","event_key":"LAD_HOU_2016_ALVAREZ_FIELDS"},{"asset_name":"Tony Watson","bref_id":"watsoto01","event_key":"LAD_PIT_2017_CRUZ_WATSON"},{"asset_name":"Manny Machado","bref_id":"machama01","event_key":"LAD_BAL_2018_DIAZ_MACHADO"}],"source_urls":["https://www.baseball-reference.com/data/war_daily_bat.txt","https://www.baseball-reference.com/data/war_daily_pitch.txt"],"team_map":[{"code":"ANA","from":1997,"note":"Anaheim Angels","organization":"LAA","to":2004},{"code":"ARI","from":1998,"note":"Arizona Diamondbacks","organization":"ARI","to":null},{"code":"ATL","from":1966,"note":"Atlanta Braves","organization":"ATL","to":null},{"code":"BAL","from":1954,"note":"Baltimore Orioles","organization":"BAL","to":null},{"code":"BOS","from":1901,"note":"Boston Red Sox","organization":"BOS","to":null},{"code":"BRO","from":1884,"note":"Brooklyn Dodgers (Dodgers franchise)","organization":"BRO","to":1957},{"code":"CAL","from":1965,"note":"California Angels","organization":"LAA","to":1996},{"code":"CHC","from":1876,"note":"Chicago Cubs","organization":"CHC","to":null},{"code":"CHW","from":1901,"note":"Chicago White Sox (B-Ref code CHW)","organization":"CWS","to":null},{"code":"CIN","from":1890,"note":"Cincinnati Reds","organization":"CIN","to":null},{"code":"CLE","from":1901,"note":"Cleveland franchise","organization":"CLE","to":null},{"code":"COL","from":1993,"note":"Colorado Rockies","organization":"COL","to":null},{"code":"DET","from":1901,"note":"Detroit Tigers","organization":"DET","to":null},{"code":"FLA","from":1993,"note":"Florida Marlins (Miami franchise)","organization":"MIA","to":2011},{"code":"HOU","from":1962,"note":"Houston franchise","organization":"HOU","to":null},{"code":"KCR","from":1969,"note":"Kansas City Royals (B-Ref code KCR)","organization":"KC","to":null},{"code":"LAA","from":2005,"note":"Los Angeles Angels","organization":"LAA","to":null},{"code":"LAD","from":1958,"note":"Los Angeles Dodgers (Dodgers franchise)","organization":"LAD","to":null},{"code":"MIA","from":2012,"note":"Miami Marlins","organization":"MIA","to":null},{"code":"MIL","from":1970,"note":"Milwaukee Brewers","organization":"MIL","to":null},{"code":"MIN","from":1961,"note":"Minnesota Twins","organization":"MIN","to":null},{"code":"MON","from":1969,"note":"Montreal Expos (Washington franchise)","organization":"WSH","to":2004},{"code":"NYM","from":1962,"note":"New York Mets","organization":"NYM","to":null},{"code":"NYY","from":1903,"note":"New York Yankees","organization":"NYY","to":null},{"code":"OAK","from":1968,"note":"Oakland Athletics","organization":"OAK","to":null},{"code":"PHI","from":1883,"note":"Philadelphia Phillies","organization":"PHI","to":null},{"code":"PIT","from":1887,"note":"Pittsburgh Pirates","organization":"PIT","to":null},{"code":"SDP","from":1969,"note":"San Diego Padres (B-Ref code SDP)","organization":"SD","to":null},{"code":"SEA","from":1977,"note":"Seattle Mariners","organization":"SEA","to":null},{"code":"SFG","from":1958,"note":"San Francisco Giants","organization":"SFG","to":null},{"code":"STL","from":1892,"note":"St. Louis Cardinals","organization":"STL","to":null},{"code":"TBD","from":1998,"note":"Tampa Bay Devil Rays (Rays franchise)","organization":"TB","to":2007},{"code":"TBR","from":2008,"note":"Tampa Bay Rays","organization":"TB","to":null},{"code":"TEX","from":1972,"note":"Texas Rangers","organization":"TEX","to":null},{"code":"TOR","from":1977,"note":"Toronto Blue Jays","organization":"TOR","to":null},{"code":"WSN","from":2005,"note":"Washington Nationals (B-Ref code WSN)","organization":"WSH","to":null}],"rows":[["abreuto01","473234",2007,"LAD",1,"BAT","NL","1.00",59,178,null],["abreuto01","473234",2009,"LAD",1,"BAT","NL","0.23",6,11,null],["abreuto01","473234",2010,"ARI",1,"BAT","NL","-1.30",81,201,null],["abreuto01","473234",2012,"KCR",1,"BAT","AL","-0.19",22,74,null],["abreuto01","473234",2013,"SFG",1,"BAT","NL","-0.06",53,147,null],["abreuto01","473234",2014,"SFG",1,"BAT","NL","-0.12",3,4,null],["alvaryo01","670541",2019,"HOU",1,"BAT","AL","3.72",87,369,null],["alvaryo01","670541",2020,"HOU",1,"BAT","AL","0.05",2,9,null],["alvaryo01","670541",2021,"HOU",1,"BAT","AL","3.08",144,598,null],["alvaryo01","670541",2022,"HOU",1,"BAT","AL","6.84",135,561,null],["alvaryo01","670541",2023,"HOU",1,"BAT","AL","4.53",114,496,null],["alvaryo01","670541",2024,"HOU",1,"BAT","AL","5.21",147,635,null],["alvaryo01","670541",2025,"HOU",1,"BAT","AL","0.70",48,199,null],["alvaryo01","670541",2026,"HOU",1,"BAT","AL","6.77",158,692,null],["amorosa01","110222",1952,"BRO",1,"BAT","NL","0.17",20,50,null],["amorosa01","110222",1954,"BRO",1,"BAT","NL","2.05",79,298,null],["amorosa01","110222",1955,"BRO",1,"BAT","NL","2.05",119,455,null],["amorosa01","110222",1956,"BRO",1,"BAT","NL","1.74",114,362,null],["amorosa01","110222",1957,"BRO",1,"BAT","NL","1.87",106,293,null],["amorosa01","110222",1959,"LAD",1,"BAT","NL","-0.02",5,5,null],["amorosa01","110222",1960,"LAD",1,"BAT","NL","-0.13",9,17,null],["amorosa01","110222",1960,"DET",2,"BAT","AL","-0.38",65,81,null],["astacpe01","110359",1992,"LAD",1,"BAT","NL","-0.12",11,29,null],["astacpe01","110359",1992,"LAD",1,"PITCH","NL","3.08",11,null,246],["astacpe01","110359",1993,"LAD",1,"BAT","NL","-0.14",31,69,null],["astacpe01","110359",1993,"LAD",1,"PITCH","NL","3.71",31,null,559],["astacpe01","110359",1994,"LAD",1,"BAT","NL","-0.49",23,51,null],["astacpe01","110359",1994,"LAD",1,"PITCH","NL","2.22",23,null,447],["astacpe01","110359",1995,"LAD",1,"BAT","NL","-0.06",48,27,null],["astacpe01","110359",1995,"LAD",1,"PITCH","NL","0.24",48,null,312],["astacpe01","110359",1996,"LAD",1,"BAT","NL","-0.55",35,77,null],["astacpe01","110359",1996,"LAD",1,"PITCH","NL","4.59",35,null,635],["astacpe01","110359",1997,"LAD",1,"BAT","NL","0.00",25,51,null],["astacpe01","110359",1997,"LAD",1,"PITCH","NL","1.66",26,null,461],["astacpe01","110359",1997,"COL",2,"BAT","NL","-0.15",6,14,null],["astacpe01","110359",1997,"COL",2,"PITCH","NL","1.42",7,null,146],["astacpe01","110359",1998,"COL",1,"BAT","NL","-0.09",34,75,null],["astacpe01","110359",1998,"COL",1,"PITCH","NL","-0.71",35,null,628],["astacpe01","110359",1999,"COL",1,"BAT","NL","0.04",36,94,null],["astacpe01","110359",1999,"COL",1,"PITCH","NL","5.87",34,null,696],["astacpe01","110359",2000,"COL",1,"BAT","NL","-0.52",32,84,null],["astacpe01","110359",2000,"COL",1,"PITCH","NL","3.14",32,null,589],["astacpe01","110359",2001,"COL",1,"BAT","NL","-0.37",20,52,null],["astacpe01","110359",2001,"COL",1,"PITCH","NL","1.07",22,null,423],["astacpe01","110359",2001,"HOU",2,"BAT","NL","-0.10",4,12,null],["astacpe01","110359",2001,"HOU",2,"PITCH","NL","0.92",4,null,86],["astacpe01","110359",2002,"NYM",1,"BAT","NL","0.00",30,69,null],["astacpe01","110359",2002,"NYM",1,"PITCH","NL","0.80",31,null,575],["astacpe01","110359",2003,"NYM",1,"BAT","NL","-0.07",7,14,null],["astacpe01","110359",2003,"NYM",1,"PITCH","NL","-0.59",7,null,110],["astacpe01","110359",2004,"BOS",1,"BAT","AL",null,0,0,null],["astacpe01","110359",2004,"BOS",1,"PITCH","AL","-0.31",5,null,26],["astacpe01","110359",2005,"TEX",1,"BAT","AL","-0.02",1,1,null],["astacpe01","110359",2005,"TEX",1,"PITCH","AL","0.24",12,null,201],["astacpe01","110359",2005,"SDP",2,"BAT","NL","-0.17",12,22,null],["astacpe01","110359",2005,"SDP",2,"PITCH","NL","1.44",12,null,179],["astacpe01","110359",2006,"WSN",1,"BAT","NL","0.16",17,34,null],["astacpe01","110359",2006,"WSN",1,"PITCH","NL","-0.51",17,null,271],["aybarwi01","430632",2005,"LAD",1,"BAT","NL","0.96",26,105,null],["aybarwi01","430632",2006,"LAD",1,"BAT","NL","0.31",43,151,null],["aybarwi01","430632",2006,"ATL",2,"BAT","NL","0.22",36,127,null],["aybarwi01","430632",2008,"TBR",1,"BAT","AL","1.38",95,362,null],["aybarwi01","430632",2009,"TBR",1,"BAT","AL","-0.19",105,336,null],["aybarwi01","430632",2010,"TBR",1,"BAT","AL","0.06",100,309,null],["baezpe01","520980",2014,"LAD",1,"BAT","NL","0.00",18,0,null],["baezpe01","520980",2014,"LAD",1,"PITCH","NL","0.38",20,null,72],["baezpe01","520980",2015,"LAD",1,"BAT","NL","0.00",48,0,null],["baezpe01","520980",2015,"LAD",1,"PITCH","NL","0.17",52,null,153],["baezpe01","520980",2016,"LAD",1,"BAT","NL","-0.01",67,1,null],["baezpe01","520980",2016,"LAD",1,"PITCH","NL","1.17",73,null,222],["baezpe01","520980",2017,"LAD",1,"BAT","NL","0.03",61,2,null],["baezpe01","520980",2017,"LAD",1,"PITCH","NL","0.71",66,null,192],["baezpe01","520980",2018,"LAD",1,"BAT","NL","-0.05",53,4,null],["baezpe01","520980",2018,"LAD",1,"PITCH","NL","0.76",55,null,169],["baezpe01","520980",2019,"LAD",1,"BAT","NL","0.00",66,0,null],["baezpe01","520980",2019,"LAD",1,"PITCH","NL","0.45",71,null,209],["baezpe01","520980",2020,"LAD",1,"BAT","NL",null,0,0,null],["baezpe01","520980",2020,"LAD",1,"PITCH","NL","0.08",18,null,51],["baezpe01","520980",2021,"HOU",1,"BAT","AL",null,0,0,null],["baezpe01","520980",2021,"HOU",1,"PITCH","AL","0.08",4,null,13],["baezpe01","520980",2022,"HOU",1,"BAT","AL",null,0,0,null],["baezpe01","520980",2022,"HOU",1,"PITCH","AL","-0.23",3,null,7],["beltrad01","134181",1998,"LAD",1,"BAT","NL","0.16",77,214,null],["beltrad01","134181",1999,"LAD",1,"BAT","NL","3.89",152,614,null],["beltrad01","134181",2000,"LAD",1,"BAT","NL","3.37",138,575,null],["beltrad01","134181",2001,"LAD",1,"BAT","NL","0.83",126,515,null],["beltrad01","134181",2002,"LAD",1,"BAT","NL","2.01",159,635,null],["beltrad01","134181",2003,"LAD",1,"BAT","NL","3.58",158,608,null],["beltrad01","134181",2004,"LAD",1,"BAT","NL","9.55",156,657,null],["beltrad01","134181",2005,"SEA",1,"BAT","AL","3.20",156,650,null],["beltrad01","134181",2006,"SEA",1,"BAT","AL","5.42",156,681,null],["beltrad01","134181",2007,"SEA",1,"BAT","AL","3.75",149,639,null],["beltrad01","134181",2008,"SEA",1,"BAT","AL","5.57",143,612,null],["beltrad01","134181",2009,"SEA",1,"BAT","AL","3.29",111,477,null],["beltrad01","134181",2010,"BOS",1,"BAT","AL","7.79",154,641,null],["beltrad01","134181",2011,"TEX",1,"BAT","AL","5.64",124,525,null],["beltrad01","134181",2012,"TEX",1,"BAT","AL","7.24",156,654,null],["beltrad01","134181",2013,"TEX",1,"BAT","AL","5.65",161,690,null],["beltrad01","134181",2014,"TEX",1,"BAT","AL","6.16",148,614,null],["beltrad01","134181",2015,"TEX",1,"BAT","AL","4.62",143,619,null],["beltrad01","134181",2016,"TEX",1,"BAT","AL","6.87",153,640,null],["beltrad01","134181",2017,"TEX",1,"BAT","AL","3.64",94,389,null],["beltrad01","134181",2018,"TEX",1,"BAT","AL","1.49",119,481,null],["castrju01","112128",1995,"LAD",1,"BAT","NL","0.14",11,5,null],["castrju01","112128",1996,"LAD",1,"BAT","NL","-0.87",70,146,null],["castrju01","112128",1997,"LAD",1,"BAT","NL","0.04",40,84,null],["castrju01","112128",1998,"LAD",1,"BAT","NL","-0.90",89,246,null],["castrju01","112128",1999,"LAD",1,"BAT","NL","-0.01",2,1,null],["castrju01","112128",2000,"CIN",1,"BAT","NL","-0.39",82,244,null],["castrju01","112128",2001,"CIN",1,"BAT","NL","-1.95",96,261,null],["castrju01","112128",2002,"CIN",1,"BAT","NL","0.09",54,91,null],["castrju01","112128",2003,"CIN",1,"BAT","NL","1.70",113,348,null],["castrju01","112128",2004,"CIN",1,"BAT","NL","-0.29",111,316,null],["castrju01","112128",2005,"MIN",1,"BAT","AL","0.76",97,292,null],["castrju01","112128",2006,"MIN",1,"BAT","AL","-0.49",50,164,null],["castrju01","112128",2006,"CIN",2,"BAT","NL","0.94",54,100,null],["castrju01","112128",2007,"CIN",1,"BAT","NL","-1.03",54,98,null],["castrju01","112128",2008,"CIN",1,"BAT","NL","-0.09",7,11,null],["castrju01","112128",2008,"BAL",2,"BAT","AL","-1.17",54,166,null],["castrju01","112128",2009,"LAD",1,"BAT","NL","0.25",57,121,null],["castrju01","112128",2010,"PHI",1,"BAT","NL","-1.75",54,136,null],["castrju01","112128",2010,"LAD",2,"BAT","NL","-0.13",1,4,null],["castrju01","112128",2011,"LAD",1,"BAT","NL","-0.25",7,15,null],["cedenro01","112155",1995,"LAD",1,"BAT","NL","-0.60",40,46,null],["cedenro01","112155",1996,"LAD",1,"BAT","NL","0.43",86,238,null],["cedenro01","112155",1997,"LAD",1,"BAT","NL","1.07",80,227,null],["cedenro01","112155",1998,"LAD",1,"BAT","NL","-0.08",105,271,null],["cedenro01","112155",1999,"NYM",1,"BAT","NL","1.50",155,525,null],["cedenro01","112155",2000,"HOU",1,"BAT","NL","0.47",74,305,null],["cedenro01","112155",2001,"DET",1,"BAT","AL","0.76",131,572,null],["cedenro01","112155",2002,"NYM",1,"BAT","NL","0.22",149,562,null],["cedenro01","112155",2003,"NYM",1,"BAT","NL","-0.67",148,527,null],["cedenro01","112155",2004,"STL",1,"BAT","NL","-0.38",95,223,null],["cedenro01","112155",2005,"STL",1,"BAT","NL","-1.03",37,61,null],["clemero01","112391",1955,"PIT",1,"BAT","NL","-0.34",124,501,null],["clemero01","112391",1956,"PIT",1,"BAT","NL","2.36",147,572,null],["clemero01","112391",1957,"PIT",1,"BAT","NL","1.41",111,475,null],["clemero01","112391",1958,"PIT",1,"BAT","NL","4.44",140,556,null],["clemero01","112391",1959,"PIT",1,"BAT","NL","2.75",105,456,null],["clemero01","112391",1960,"PIT",1,"BAT","NL","3.97",144,620,null],["clemero01","112391",1961,"PIT",1,"BAT","NL","6.37",146,614,null],["clemero01","112391",1962,"PIT",1,"BAT","NL","3.96",144,581,null],["clemero01","112391",1963,"PIT",1,"BAT","NL","5.31",152,642,null],["clemero01","112391",1964,"PIT",1,"BAT","NL","7.22",155,683,null],["clemero01","112391",1965,"PIT",1,"BAT","NL","7.16",152,642,null],["clemero01","112391",1966,"PIT",1,"BAT","NL","8.24",154,690,null],["clemero01","112391",1967,"PIT",1,"BAT","NL","8.94",147,632,null],["clemero01","112391",1968,"PIT",1,"BAT","NL","8.15",132,557,null],["clemero01","112391",1969,"PIT",1,"BAT","NL","7.48",138,570,null],["clemero01","112391",1970,"PIT",1,"BAT","NL","5.47",108,455,null],["clemero01","112391",1971,"PIT",1,"BAT","NL","7.26",132,553,null],["clemero01","112391",1972,"PIT",1,"BAT","NL","4.81",102,413,null],["cruzon01","665833",2021,"PIT",1,"BAT","NL","0.11",2,9,null],["cruzon01","665833",2022,"PIT",1,"BAT","NL","2.32",87,361,null],["cruzon01","665833",2023,"PIT",1,"BAT","NL","0.14",9,40,null],["cruzon01","665833",2024,"PIT",1,"BAT","NL","2.56",146,599,null],["cruzon01","665833",2025,"PIT",1,"BAT","NL","0.20",135,544,null],["cruzon01","665833",2026,"PIT",1,"BAT","NL","2.84",97,419,null],["daalom01","112984",1993,"LAD",1,"BAT","NL","0.06",47,1,null],["daalom01","112984",1993,"LAD",1,"PITCH","NL","0.02",47,null,106],["daalom01","112984",1994,"LAD",1,"BAT","NL","0.00",24,0,null],["daalom01","112984",1994,"LAD",1,"PITCH","NL","0.34",24,null,41],["daalom01","112984",1995,"LAD",1,"BAT","NL","0.00",28,0,null],["daalom01","112984",1995,"LAD",1,"PITCH","NL","-0.73",28,null,60],["daalom01","112984",1996,"MON",1,"BAT","NL","-0.21",64,11,null],["daalom01","112984",1996,"MON",1,"PITCH","NL","1.20",64,null,262],["daalom01","112984",1997,"MON",1,"BAT","NL","0.01",32,5,null],["daalom01","112984",1997,"MON",1,"PITCH","NL","-2.33",33,null,91],["daalom01","112984",1997,"TOR",2,"BAT","AL",null,0,0,null],["daalom01","112984",1997,"TOR",2,"PITCH","AL","0.49",9,null,81],["daalom01","112984",1998,"ARI",1,"BAT","NL","-0.15",33,56,null],["daalom01","112984",1998,"ARI",1,"PITCH","NL","4.20",33,null,488],["daalom01","112984",1999,"ARI",1,"BAT","NL","0.50",30,77,null],["daalom01","112984",1999,"ARI",1,"PITCH","NL","4.60",32,null,644],["daalom01","112984",2000,"ARI",1,"BAT","NL","0.25",18,31,null],["daalom01","112984",2000,"ARI",1,"PITCH","NL","-2.01",20,null,288],["daalom01","112984",2000,"PHI",2,"BAT","NL","0.30",12,23,null],["daalom01","112984",2000,"PHI",2,"PITCH","NL","0.67",12,null,213],["daalom01","112984",2001,"PHI",1,"BAT","NL","0.26",30,63,null],["daalom01","112984",2001,"PHI",1,"PITCH","NL","0.35",32,null,557],["daalom01","112984",2002,"LAD",1,"BAT","NL","0.21",38,48,null],["daalom01","112984",2002,"LAD",1,"PITCH","NL","1.38",39,null,484],["daalom01","112984",2003,"BAL",1,"BAT","AL","0.00",1,0,null],["daalom01","112984",2003,"BAL",1,"PITCH","AL","-0.76",19,null,281],["delarru01","523989",2011,"LAD",1,"BAT","NL","0.08",12,16,null],["delarru01","523989",2011,"LAD",1,"PITCH","NL","0.62",13,null,182],["delarru01","523989",2012,"LAD",1,"BAT","NL","0.00",1,0,null],["delarru01","523989",2012,"LAD",1,"PITCH","NL","-0.08",1,null,2],["delarru01","523989",2013,"BOS",1,"BAT","AL","0.00",1,0,null],["delarru01","523989",2013,"BOS",1,"PITCH","AL","-0.10",11,null,34],["delarru01","523989",2014,"BOS",1,"BAT","AL","-0.03",1,2,null],["delarru01","523989",2014,"BOS",1,"PITCH","AL","0.43",19,null,305],["delarru01","523989",2015,"ARI",1,"BAT","NL","-0.40",31,68,null],["delarru01","523989",2015,"ARI",1,"PITCH","NL","-0.05",32,null,566],["delarru01","523989",2016,"ARI",1,"BAT","NL","-0.10",13,17,null],["delarru01","523989",2016,"ARI",1,"PITCH","NL","0.91",13,null,152],["delarru01","523989",2017,"ARI",1,"BAT","NL","0.00",9,0,null],["delarru01","523989",2017,"ARI",1,"PITCH","NL","0.04",9,null,23],["depaujo03","800543",2026,"LAD",1,"BAT","NL","0.46",11,42,null],["diazyu01","666783",2022,"BAL",1,"BAT","AL","-0.03",1,1,null],["dominjo01","523848",2013,"LAD",1,"BAT","NL","-0.01",8,1,null],["dominjo01","523848",2013,"LAD",1,"PITCH","NL","0.09",9,null,25],["dominjo01","523848",2014,"LAD",1,"BAT","NL","-0.01",5,1,null],["dominjo01","523848",2014,"LAD",1,"PITCH","NL","-0.28",5,null,19],["dominjo01","523848",2015,"TBR",1,"BAT","AL","0.00",1,0,null],["dominjo01","523848",2015,"TBR",1,"PITCH","AL","0.23",4,null,17],["dominjo01","523848",2016,"SDP",1,"BAT","NL","0.00",30,0,null],["dominjo01","523848",2016,"SDP",1,"PITCH","NL","-0.45",34,null,107],["fernach01","114077",1956,"BRO",1,"BAT","NL","0.00",34,73,null],["fernach01","114077",1957,"PHI",1,"BAT","NL","-0.02",149,543,null],["fernach01","114077",1958,"PHI",1,"BAT","NL","-0.99",148,578,null],["fernach01","114077",1959,"PHI",1,"BAT","NL","-0.81",45,138,null],["fernach01","114077",1960,"DET",1,"BAT","AL","0.04",133,497,null],["fernach01","114077",1961,"DET",1,"BAT","AL","0.17",133,476,null],["fernach01","114077",1962,"DET",1,"BAT","AL","1.07",141,560,null],["fernach01","114077",1963,"DET",1,"BAT","AL","-0.50",15,56,null],["fernach01","114077",1963,"NYM",2,"BAT","NL","-1.36",58,157,null],["fieldjo03","451661",2013,"HOU",1,"BAT","AL","0.00",3,0,null],["fieldjo03","451661",2013,"HOU",1,"PITCH","AL","-0.06",41,null,114],["fieldjo03","451661",2014,"HOU",1,"BAT","AL","0.00",3,0,null],["fieldjo03","451661",2014,"HOU",1,"PITCH","AL","-0.25",54,null,164],["fieldjo03","451661",2015,"HOU",1,"BAT","AL","0.00",4,0,null],["fieldjo03","451661",2015,"HOU",1,"PITCH","AL","0.52",54,null,152],["fieldjo03","451661",2016,"HOU",1,"BAT","AL","0.00",2,0,null],["fieldjo03","451661",2016,"HOU",1,"PITCH","AL","-0.38",15,null,47],["fieldjo03","451661",2016,"LAD",2,"BAT","NL","-0.01",21,1,null],["fieldjo03","451661",2016,"LAD",2,"PITCH","NL","0.17",22,null,58],["fieldjo03","451661",2017,"LAD",1,"BAT","NL","0.00",55,0,null],["fieldjo03","451661",2017,"LAD",1,"PITCH","NL","0.89",57,null,171],["fieldjo03","451661",2018,"LAD",1,"BAT","NL","0.00",45,0,null],["fieldjo03","451661",2018,"LAD",1,"PITCH","NL","0.89",45,null,123],["friasca01","516910",2014,"LAD",1,"BAT","NL","-0.07",15,7,null],["friasca01","516910",2014,"LAD",1,"PITCH","NL","-0.59",15,null,97],["friasca01","516910",2015,"LAD",1,"BAT","NL","-0.09",16,24,null],["friasca01","516910",2015,"LAD",1,"PITCH","NL","0.29",17,null,233],["friasca01","516910",2016,"LAD",1,"BAT","NL","-0.01",1,1,null],["friasca01","516910",2016,"LAD",1,"PITCH","NL","0.13",1,null,12],["garcika01","114588",1995,"LAD",1,"BAT","NL","-0.32",13,20,null],["garcika01","114588",1996,"LAD",1,"BAT","NL","-0.03",1,1,null],["garcika01","114588",1997,"LAD",1,"BAT","NL","-0.63",15,46,null],["garcika01","114588",1998,"ARI",1,"BAT","NL","-1.53",113,354,null],["garcika01","114588",1999,"DET",1,"BAT","AL","0.50",96,310,null],["garcika01","114588",2000,"DET",1,"BAT","AL","-0.38",8,17,null],["garcika01","114588",2000,"BAL",2,"BAT","AL","-0.40",8,16,null],["garcika01","114588",2001,"CLE",1,"BAT","AL","0.14",20,50,null],["garcika01","114588",2002,"NYY",1,"BAT","AL","-0.08",2,5,null],["garcika01","114588",2002,"CLE",2,"BAT","AL","1.24",51,205,null],["garcika01","114588",2003,"CLE",1,"BAT","AL","-0.59",24,101,null],["garcika01","114588",2003,"NYY",2,"BAT","AL","0.35",52,161,null],["garcika01","114588",2004,"NYM",1,"BAT","NL","-0.79",62,202,null],["garcika01","114588",2004,"BAL",2,"BAT","AL","-0.73",23,73,null],["gonzavi02","624647",2020,"LAD",1,"BAT","NL",null,0,0,null],["gonzavi02","624647",2020,"LAD",1,"PITCH","NL","0.65",15,null,61],["gonzavi02","624647",2021,"LAD",1,"BAT","NL","0.00",40,0,null],["gonzavi02","624647",2021,"LAD",1,"PITCH","NL","0.49",44,null,106],["gonzavi02","624647",2023,"LAD",1,"BAT","NL","0.00",2,0,null],["gonzavi02","624647",2023,"LAD",1,"PITCH","NL","0.23",34,null,101],["gonzavi02","624647",2024,"NYY",1,"BAT","AL",null,0,0,null],["gonzavi02","624647",2024,"NYY",1,"PITCH","AL","0.05",27,null,70],["guzmaju01","115267",1991,"TOR",1,"BAT","AL",null,0,0,null],["guzmaju01","115267",1991,"TOR",1,"PITCH","AL","3.20",23,null,416],["guzmaju01","115267",1992,"TOR",1,"BAT","AL",null,0,0,null],["guzmaju01","115267",1992,"TOR",1,"PITCH","AL","5.46",28,null,542],["guzmaju01","115267",1993,"TOR",1,"BAT","AL",null,0,0,null],["guzmaju01","115267",1993,"TOR",1,"PITCH","AL","3.39",33,null,663],["guzmaju01","115267",1994,"TOR",1,"BAT","AL",null,0,0,null],["guzmaju01","115267",1994,"TOR",1,"PITCH","AL","0.85",25,null,442],["guzmaju01","115267",1995,"TOR",1,"BAT","AL",null,0,0,null],["guzmaju01","115267",1995,"TOR",1,"PITCH","AL","0.09",24,null,406],["guzmaju01","115267",1996,"TOR",1,"BAT","AL",null,0,0,null],["guzmaju01","115267",1996,"TOR",1,"PITCH","AL","6.73",27,null,563],["guzmaju01","115267",1997,"TOR",1,"BAT","AL",null,0,0,null],["guzmaju01","115267",1997,"TOR",1,"PITCH","AL","-0.13",13,null,180],["guzmaju01","115267",1998,"TOR",1,"BAT","AL","-0.03",1,2,null],["guzmaju01","115267",1998,"TOR",1,"PITCH","AL","1.40",22,null,435],["guzmaju01","115267",1998,"BAL",2,"BAT","AL",null,0,0,null],["guzmaju01","115267",1998,"BAL",2,"PITCH","AL","0.94",11,null,198],["guzmaju01","115267",1999,"BAL",1,"BAT","AL","-0.01",2,6,null],["guzmaju01","115267",1999,"BAL",1,"PITCH","AL","1.87",21,null,368],["guzmaju01","115267",1999,"CIN",2,"BAT","NL","-0.17",12,30,null],["guzmaju01","115267",1999,"CIN",2,"PITCH","NL","1.05",12,null,232],["guzmaju01","115267",2000,"TBD",1,"BAT","AL",null,0,0,null],["guzmaju01","115267",2000,"TBD",1,"PITCH","AL","-0.36",1,null,5],["herreel01","467070",2012,"LAD",1,"BAT","NL","0.60",67,214,null],["herreel01","467070",2013,"LAD",1,"BAT","NL","-0.06",4,8,null],["herreel01","467070",2014,"MIL",1,"BAT","NL","-0.54",69,140,null],["herreel01","467070",2015,"MIL",1,"BAT","NL","0.65",83,277,null],["huch01","464341",2007,"LAD",1,"BAT","NL","0.19",12,31,null],["huch01","464341",2008,"LAD",1,"BAT","NL","-0.07",65,129,null],["huch01","464341",2009,"LAD",1,"BAT","NL","0.03",5,6,null],["huch01","464341",2010,"LAD",1,"BAT","NL","-0.06",14,25,null],["huch01","464341",2011,"NYM",1,"BAT","NL","-0.43",22,23,null],["janseke01","445276",2010,"LAD",1,"BAT","NL","0.11",26,2,null],["janseke01","445276",2010,"LAD",1,"PITCH","NL","1.44",25,null,81],["janseke01","445276",2011,"LAD",1,"BAT","NL","0.00",48,0,null],["janseke01","445276",2011,"LAD",1,"PITCH","NL","0.85",51,null,161],["janseke01","445276",2012,"LAD",1,"BAT","NL","0.00",64,0,null],["janseke01","445276",2012,"LAD",1,"PITCH","NL","1.94",65,null,195],["janseke01","445276",2013,"LAD",1,"BAT","NL","-0.01",70,1,null],["janseke01","445276",2013,"LAD",1,"PITCH","NL","2.64",75,null,230],["janseke01","445276",2014,"LAD",1,"BAT","NL","-0.01",64,1,null],["janseke01","445276",2014,"LAD",1,"PITCH","NL","1.20",68,null,196],["janseke01","445276",2015,"LAD",1,"BAT","NL","0.00",51,0,null],["janseke01","445276",2015,"LAD",1,"PITCH","NL","1.35",54,null,157],["janseke01","445276",2016,"LAD",1,"BAT","NL","0.00",68,0,null],["janseke01","445276",2016,"LAD",1,"PITCH","NL","2.77",71,null,206],["janseke01","445276",2017,"LAD",1,"BAT","NL","0.10",59,4,null],["janseke01","445276",2017,"LAD",1,"PITCH","NL","2.98",65,null,205],["janseke01","445276",2018,"LAD",1,"BAT","NL","0.00",65,0,null],["janseke01","445276",2018,"LAD",1,"PITCH","NL","0.61",69,null,215],["janseke01","445276",2019,"LAD",1,"BAT","NL","-0.01",59,1,null],["janseke01","445276",2019,"LAD",1,"PITCH","NL","0.13",62,null,189],["janseke01","445276",2020,"LAD",1,"BAT","NL",null,0,0,null],["janseke01","445276",2020,"LAD",1,"PITCH","NL","0.35",27,null,73],["janseke01","445276",2021,"LAD",1,"BAT","NL","-0.01",66,1,null],["janseke01","445276",2021,"LAD",1,"PITCH","NL","2.46",69,null,207],["janseke01","445276",2022,"ATL",1,"BAT","NL",null,0,0,null],["janseke01","445276",2022,"ATL",1,"PITCH","NL","0.96",65,null,192],["janseke01","445276",2023,"BOS",1,"BAT","AL","0.00",1,0,null],["janseke01","445276",2023,"BOS",1,"PITCH","AL","0.74",51,null,134],["janseke01","445276",2024,"BOS",1,"BAT","AL","0.00",1,0,null],["janseke01","445276",2024,"BOS",1,"PITCH","AL","1.22",54,null,164],["janseke01","445276",2025,"LAA",1,"BAT","AL","0.00",1,0,null],["janseke01","445276",2025,"LAA",1,"PITCH","AL","2.24",62,null,177],["janseke01","445276",2026,"DET",1,"BAT","AL","0.00",1,0,null],["janseke01","445276",2026,"DET",1,"PITCH","AL","0.82",50,null,135],["kuoho01","425539",2005,"LAD",1,"BAT","NL","0.00",9,0,null],["kuoho01","425539",2005,"LAD",1,"PITCH","NL","-0.10",9,null,16],["kuoho01","425539",2006,"LAD",1,"BAT","NL","-0.02",25,11,null],["kuoho01","425539",2006,"LAD",1,"PITCH","NL","0.63",28,null,179],["kuoho01","425539",2007,"LAD",1,"BAT","NL","0.13",5,8,null],["kuoho01","425539",2007,"LAD",1,"PITCH","NL","-0.59",8,null,91],["kuoho01","425539",2008,"LAD",1,"BAT","NL","0.18",41,14,null],["kuoho01","425539",2008,"LAD",1,"PITCH","NL","2.62",42,null,240],["kuoho01","425539",2009,"LAD",1,"BAT","NL","0.00",35,0,null],["kuoho01","425539",2009,"LAD",1,"PITCH","NL","0.60",35,null,90],["kuoho01","425539",2010,"LAD",1,"BAT","NL","0.05",54,3,null],["kuoho01","425539",2010,"LAD",1,"PITCH","NL","3.17",56,null,180],["kuoho01","425539",2011,"LAD",1,"BAT","NL","0.00",38,0,null],["kuoho01","425539",2011,"LAD",1,"PITCH","NL","-1.59",40,null,81],["leonaed01","678760",2026,"SFG",1,"BAT","NL","-0.21",3,8,null],["machama01","592518",2012,"BAL",1,"BAT","AL","1.60",51,202,null],["machama01","592518",2013,"BAL",1,"BAT","AL","5.86",156,710,null],["machama01","592518",2014,"BAL",1,"BAT","AL","2.19",82,354,null],["machama01","592518",2015,"BAL",1,"BAT","AL","7.26",162,713,null],["machama01","592518",2016,"BAL",1,"BAT","AL","7.40",157,696,null],["machama01","592518",2017,"BAL",1,"BAT","AL","4.07",156,690,null],["machama01","592518",2018,"BAL",1,"BAT","AL","3.61",96,413,null],["machama01","592518",2018,"LAD",2,"BAT","NL","2.58",66,296,null],["machama01","592518",2019,"SDP",1,"BAT","NL","2.51",156,661,null],["machama01","592518",2020,"SDP",1,"BAT","NL","3.03",60,254,null],["machama01","592518",2021,"SDP",1,"BAT","NL","5.03",153,640,null],["machama01","592518",2022,"SDP",1,"BAT","NL","6.78",150,644,null],["machama01","592518",2023,"SDP",1,"BAT","NL","2.66",138,601,null],["machama01","592518",2024,"SDP",1,"BAT","NL","3.09",152,643,null],["machama01","592518",2025,"SDP",1,"BAT","NL","4.20",159,678,null],["machama01","592518",2026,"SDP",1,"BAT","NL","1.47",158,677,null],["martipe02","118377",1992,"LAD",1,"BAT","NL","0.00",2,2,null],["martipe02","118377",1992,"LAD",1,"PITCH","NL","0.30",2,null,24],["martipe02","118377",1993,"LAD",1,"BAT","NL","-0.09",66,6,null],["martipe02","118377",1993,"LAD",1,"PITCH","NL","3.00",65,null,321],["martipe02","118377",1994,"MON",1,"BAT","NL","-0.23",24,53,null],["martipe02","118377",1994,"MON",1,"PITCH","NL","2.42",24,null,434],["martipe02","118377",1995,"MON",1,"BAT","NL","-0.51",30,72,null],["martipe02","118377",1995,"MON",1,"PITCH","NL","4.73",30,null,584],["martipe02","118377",1996,"MON",1,"BAT","NL","-0.23",33,85,null],["martipe02","118377",1996,"MON",1,"PITCH","NL","4.02",33,null,650],["martipe02","118377",1997,"MON",1,"BAT","NL","-0.23",29,81,null],["martipe02","118377",1997,"MON",1,"PITCH","NL","8.99",31,null,724],["martipe02","118377",1998,"BOS",1,"BAT","AL","-0.12",2,7,null],["martipe02","118377",1998,"BOS",1,"PITCH","AL","7.26",33,null,701],["martipe02","118377",1999,"BOS",1,"BAT","AL","-0.03",2,2,null],["martipe02","118377",1999,"BOS",1,"PITCH","AL","9.78",31,null,640],["martipe02","118377",2000,"BOS",1,"BAT","AL",null,0,0,null],["martipe02","118377",2000,"BOS",1,"PITCH","AL","11.71",29,null,651],["martipe02","118377",2001,"BOS",1,"BAT","AL",null,0,0,null],["martipe02","118377",2001,"BOS",1,"PITCH","AL","5.08",18,null,350],["martipe02","118377",2002,"BOS",1,"BAT","AL","-0.05",2,7,null],["martipe02","118377",2002,"BOS",1,"PITCH","AL","6.48",30,null,598],["martipe02","118377",2003,"BOS",1,"BAT","AL","-0.05",1,3,null],["martipe02","118377",2003,"BOS",1,"PITCH","AL","8.02",29,null,560],["martipe02","118377",2004,"BOS",1,"BAT","AL","-0.03",1,2,null],["martipe02","118377",2004,"BOS",1,"PITCH","AL","5.46",33,null,651],["martipe02","118377",2005,"NYM",1,"BAT","NL","-0.47",29,76,null],["martipe02","118377",2005,"NYM",1,"PITCH","NL","6.95",31,null,651],["martipe02","118377",2006,"NYM",1,"BAT","NL","-0.15",22,49,null],["martipe02","118377",2006,"NYM",1,"PITCH","NL","0.96",23,null,398],["martipe02","118377",2007,"NYM",1,"BAT","NL","0.08",5,11,null],["martipe02","118377",2007,"NYM",1,"PITCH","NL","0.58",5,null,84],["martipe02","118377",2008,"NYM",1,"BAT","NL","0.01",20,46,null],["martipe02","118377",2008,"NYM",1,"PITCH","NL","-0.39",20,null,327],["martipe02","118377",2009,"PHI",1,"BAT","NL","-0.08",9,16,null],["martipe02","118377",2009,"PHI",1,"PITCH","NL","0.73",9,null,134],["martira02","118378",1988,"LAD",1,"BAT","NL","-0.11",9,8,null],["martira02","118378",1988,"LAD",1,"PITCH","NL","0.08",9,null,107],["martira02","118378",1989,"LAD",1,"BAT","NL","0.06",16,40,null],["martira02","118378",1989,"LAD",1,"PITCH","NL","1.29",15,null,296],["martira02","118378",1990,"LAD",1,"BAT","NL","-0.23",33,92,null],["martira02","118378",1990,"LAD",1,"PITCH","NL","3.92",33,null,703],["martira02","118378",1991,"LAD",1,"BAT","NL","-0.14",33,86,null],["martira02","118378",1991,"LAD",1,"PITCH","NL","3.68",33,null,661],["martira02","118378",1992,"LAD",1,"BAT","NL","-0.16",26,55,null],["martira02","118378",1992,"LAD",1,"PITCH","NL","0.52",25,null,452],["martira02","118378",1993,"LAD",1,"BAT","NL","-0.34",32,78,null],["martira02","118378",1993,"LAD",1,"PITCH","NL","4.67",32,null,635],["martira02","118378",1994,"LAD",1,"BAT","NL","0.58",24,72,null],["martira02","118378",1994,"LAD",1,"PITCH","NL","2.92",24,null,510],["martira02","118378",1995,"LAD",1,"BAT","NL","0.27",30,78,null],["martira02","118378",1995,"LAD",1,"PITCH","NL","2.34",30,null,619],["martira02","118378",1996,"LAD",1,"BAT","NL","-0.22",30,69,null],["martira02","118378",1996,"LAD",1,"PITCH","NL","2.70",28,null,506],["martira02","118378",1997,"LAD",1,"BAT","NL","0.10",21,47,null],["martira02","118378",1997,"LAD",1,"PITCH","NL","1.62",22,null,401],["martira02","118378",1998,"LAD",1,"BAT","NL","0.18",15,39,null],["martira02","118378",1998,"LAD",1,"PITCH","NL","2.11",15,null,305],["martira02","118378",1999,"BOS",1,"BAT","AL",null,0,0,null],["martira02","118378",1999,"BOS",1,"PITCH","AL","0.72",4,null,62],["martira02","118378",2000,"BOS",1,"BAT","AL","0.01",2,5,null],["martira02","118378",2000,"BOS",1,"PITCH","AL","-0.29",27,null,383],["martira02","118378",2001,"PIT",1,"BAT","NL","0.00",4,5,null],["martira02","118378",2001,"PIT",1,"PITCH","NL","-0.42",4,null,47],["mondera01","119247",1993,"LAD",1,"BAT","NL","0.21",42,91,null],["mondera01","119247",1994,"LAD",1,"BAT","NL","1.83",112,454,null],["mondera01","119247",1995,"LAD",1,"BAT","NL","4.79",139,580,null],["mondera01","119247",1996,"LAD",1,"BAT","NL","4.65",157,673,null],["mondera01","119247",1997,"LAD",1,"BAT","NL","5.71",159,670,null],["mondera01","119247",1998,"LAD",1,"BAT","NL","2.45",148,617,null],["mondera01","119247",1999,"LAD",1,"BAT","NL","1.97",159,680,null],["mondera01","119247",2000,"TOR",1,"BAT","AL","2.90",96,426,null],["mondera01","119247",2001,"TOR",1,"BAT","AL","2.28",149,653,null],["mondera01","119247",2002,"TOR",1,"BAT","AL","0.76",75,335,null],["mondera01","119247",2002,"NYY",2,"BAT","AL","-0.22",71,302,null],["mondera01","119247",2003,"NYY",1,"BAT","AL","2.29",98,403,null],["mondera01","119247",2003,"ARI",2,"BAT","NL","0.48",45,183,null],["mondera01","119247",2004,"PIT",1,"BAT","NL","0.08",26,110,null],["mondera01","119247",2004,"ANA",2,"BAT","AL","-0.32",8,37,null],["mondera01","119247",2005,"ATL",1,"BAT","NL","-0.35",41,155,null],["nomohi01","119827",1995,"LAD",1,"BAT","NL","-0.56",28,72,null],["nomohi01","119827",1995,"LAD",1,"PITCH","NL","4.69",28,null,574],["nomohi01","119827",1996,"LAD",1,"BAT","NL","-0.09",33,87,null],["nomohi01","119827",1996,"LAD",1,"PITCH","NL","4.70",33,null,685],["nomohi01","119827",1997,"LAD",1,"BAT","NL","0.02",30,75,null],["nomohi01","119827",1997,"LAD",1,"PITCH","NL","1.83",33,null,622],["nomohi01","119827",1998,"LAD",1,"BAT","NL","-0.14",12,22,null],["nomohi01","119827",1998,"LAD",1,"PITCH","NL","0.19",12,null,203],["nomohi01","119827",1998,"NYM",2,"BAT","NL","0.19",16,33,null],["nomohi01","119827",1998,"NYM",2,"PITCH","NL","0.47",17,null,269],["nomohi01","119827",1999,"MIL",1,"BAT","NL","0.14",27,64,null],["nomohi01","119827",1999,"MIL",1,"PITCH","NL","2.29",28,null,529],["nomohi01","119827",2000,"DET",1,"BAT","AL","-0.09",3,6,null],["nomohi01","119827",2000,"DET",1,"PITCH","AL","2.60",32,null,570],["nomohi01","119827",2001,"BOS",1,"BAT","AL","0.00",2,5,null],["nomohi01","119827",2001,"BOS",1,"PITCH","AL","3.08",33,null,594],["nomohi01","119827",2002,"LAD",1,"BAT","NL","-0.27",33,74,null],["nomohi01","119827",2002,"LAD",1,"PITCH","NL","2.66",34,null,661],["nomohi01","119827",2003,"LAD",1,"BAT","NL","-0.02",31,74,null],["nomohi01","119827",2003,"LAD",1,"PITCH","NL","3.54",33,null,655],["nomohi01","119827",2004,"LAD",1,"BAT","NL","0.02",16,27,null],["nomohi01","119827",2004,"LAD",1,"PITCH","NL","-2.42",18,null,252],["nomohi01","119827",2005,"TBD",1,"BAT","AL","-0.06",2,4,null],["nomohi01","119827",2005,"TBD",1,"PITCH","AL","-1.39",19,null,302],["nomohi01","119827",2008,"KCR",1,"BAT","AL",null,0,0,null],["nomohi01","119827",2008,"KCR",1,"PITCH","AL","-0.45",3,null,13],["offerjo01","119948",1990,"LAD",1,"BAT","NL","-0.68",29,63,null],["offerjo01","119948",1991,"LAD",1,"BAT","NL","-0.37",52,140,null],["offerjo01","119948",1992,"LAD",1,"BAT","NL","-0.08",149,598,null],["offerjo01","119948",1993,"LAD",1,"BAT","NL","1.94",158,696,null],["offerjo01","119948",1994,"LAD",1,"BAT","NL","-1.36",72,289,null],["offerjo01","119948",1995,"LAD",1,"BAT","NL","2.61",119,511,null],["offerjo01","119948",1996,"KCR",1,"BAT","AL","2.51",151,645,null],["offerjo01","119948",1997,"KCR",1,"BAT","AL","1.87",106,471,null],["offerjo01","119948",1998,"KCR",1,"BAT","AL","5.31",158,709,null],["offerjo01","119948",1999,"BOS",1,"BAT","AL","2.82",149,693,null],["offerjo01","119948",2000,"BOS",1,"BAT","AL","0.78",116,527,null],["offerjo01","119948",2001,"BOS",1,"BAT","AL","1.48",128,594,null],["offerjo01","119948",2002,"BOS",1,"BAT","AL","0.24",72,275,null],["offerjo01","119948",2002,"SEA",2,"BAT","AL","0.18",29,51,null],["offerjo01","119948",2004,"MIN",1,"BAT","AL","0.22",77,202,null],["offerjo01","119948",2005,"PHI",1,"BAT","NL","-0.01",33,38,null],["offerjo01","119948",2005,"NYM",2,"BAT","NL","-0.34",53,80,null],["osunaan01","120107",1995,"LAD",1,"BAT","NL","-0.03",39,2,null],["osunaan01","120107",1995,"LAD",1,"PITCH","NL","0.07",39,null,134],["osunaan01","120107",1996,"LAD",1,"BAT","NL","0.01",73,3,null],["osunaan01","120107",1996,"LAD",1,"PITCH","NL","1.52",73,null,252],["osunaan01","120107",1997,"LAD",1,"BAT","NL","0.05",43,2,null],["osunaan01","120107",1997,"LAD",1,"PITCH","NL","1.88",48,null,185],["osunaan01","120107",1998,"LAD",1,"BAT","NL","-0.03",50,2,null],["osunaan01","120107",1998,"LAD",1,"PITCH","NL","1.07",54,null,194],["osunaan01","120107",1999,"LAD",1,"BAT","NL","0.00",5,0,null],["osunaan01","120107",1999,"LAD",1,"PITCH","NL","-0.37",5,null,14],["osunaan01","120107",2000,"LAD",1,"BAT","NL","-0.05",42,2,null],["osunaan01","120107",2000,"LAD",1,"PITCH","NL","0.77",46,null,202],["osunaan01","120107",2001,"CHW",1,"BAT","AL",null,0,0,null],["osunaan01","120107",2001,"CHW",1,"PITCH","AL","-0.51",4,null,13],["osunaan01","120107",2002,"CHW",1,"BAT","AL","0.00",3,0,null],["osunaan01","120107",2002,"CHW",1,"PITCH","AL","0.66",59,null,203],["osunaan01","120107",2003,"NYY",1,"BAT","AL","0.00",3,0,null],["osunaan01","120107",2003,"NYY",1,"PITCH","AL","0.84",48,null,152],["osunaan01","120107",2004,"SDP",1,"BAT","NL","0.00",29,0,null],["osunaan01","120107",2004,"SDP",1,"PITCH","NL","0.77",31,null,110],["osunaan01","120107",2005,"WSN",1,"BAT","NL","0.00",4,0,null],["osunaan01","120107",2005,"WSN",1,"PITCH","NL","-0.53",4,null,7],["pagesan01","681624",2024,"LAD",1,"BAT","NL","1.20",116,443,null],["pagesan01","681624",2025,"LAD",1,"BAT","NL","3.73",156,624,null],["pagesan01","681624",2026,"LAD",1,"BAT","NL","5.99",134,574,null],["parkch01","120221",1994,"LAD",1,"BAT","NL","0.00",2,0,null],["parkch01","120221",1994,"LAD",1,"PITCH","NL","-0.12",2,null,12],["parkch01","120221",1995,"LAD",1,"BAT","NL","-0.01",2,1,null],["parkch01","120221",1995,"LAD",1,"PITCH","NL","0.04",2,null,12],["parkch01","120221",1996,"LAD",1,"BAT","NL","-0.19",48,23,null],["parkch01","120221",1996,"LAD",1,"PITCH","NL","1.45",48,null,326],["parkch01","120221",1997,"LAD",1,"BAT","NL","0.51",31,66,null],["parkch01","120221",1997,"LAD",1,"PITCH","NL","3.49",32,null,576],["parkch01","120221",1998,"LAD",1,"BAT","NL","0.16",33,80,null],["parkch01","120221",1998,"LAD",1,"PITCH","NL","3.08",34,null,662],["parkch01","120221",1999,"LAD",1,"BAT","NL","0.15",32,69,null],["parkch01","120221",1999,"LAD",1,"PITCH","NL","0.16",33,null,583],["parkch01","120221",2000,"LAD",1,"BAT","NL","0.57",32,78,null],["parkch01","120221",2000,"LAD",1,"PITCH","NL","4.90",34,null,678],["parkch01","120221",2001,"LAD",1,"BAT","NL","0.18",34,81,null],["parkch01","120221",2001,"LAD",1,"PITCH","NL","4.15",36,null,702],["parkch01","120221",2002,"TEX",1,"BAT","AL","-0.09",2,4,null],["parkch01","120221",2002,"TEX",1,"PITCH","AL","0.38",25,null,437],["parkch01","120221",2003,"TEX",1,"BAT","AL","0.04",1,1,null],["parkch01","120221",2003,"TEX",1,"PITCH","AL","-0.39",7,null,89],["parkch01","120221",2004,"TEX",1,"BAT","AL",null,0,0,null],["parkch01","120221",2004,"TEX",1,"PITCH","AL","0.46",16,null,287],["parkch01","120221",2005,"TEX",1,"BAT","AL","0.07",2,5,null],["parkch01","120221",2005,"TEX",1,"PITCH","AL","0.73",20,null,329],["parkch01","120221",2005,"SDP",2,"BAT","NL","0.16",10,18,null],["parkch01","120221",2005,"SDP",2,"PITCH","NL","-0.74",10,null,137],["parkch01","120221",2006,"SDP",1,"BAT","NL","0.19",24,48,null],["parkch01","120221",2006,"SDP",1,"PITCH","NL","-0.39",24,null,410],["parkch01","120221",2007,"NYM",1,"BAT","NL","-0.01",1,1,null],["parkch01","120221",2007,"NYM",1,"PITCH","NL","-0.29",1,null,12],["parkch01","120221",2008,"LAD",1,"BAT","NL","-0.04",53,12,null],["parkch01","120221",2008,"LAD",1,"PITCH","NL","1.17",54,null,286],["parkch01","120221",2009,"PHI",1,"BAT","NL","0.19",42,18,null],["parkch01","120221",2009,"PHI",1,"PITCH","NL","0.28",45,null,250],["parkch01","120221",2010,"NYY",1,"BAT","AL","0.00",5,0,null],["parkch01","120221",2010,"NYY",1,"PITCH","AL","-0.47",27,null,106],["parkch01","120221",2010,"PIT",2,"BAT","NL","-0.02",26,1,null],["parkch01","120221",2010,"PIT",2,"PITCH","NL","0.18",26,null,85],["puigya01","624577",2013,"LAD",1,"BAT","NL","4.70",104,432,null],["puigya01","624577",2014,"LAD",1,"BAT","NL","4.90",148,640,null],["puigya01","624577",2015,"LAD",1,"BAT","NL","1.09",79,311,null],["puigya01","624577",2016,"LAD",1,"BAT","NL","1.25",104,368,null],["puigya01","624577",2017,"LAD",1,"BAT","NL","3.43",152,570,null],["puigya01","624577",2018,"LAD",1,"BAT","NL","2.43",125,444,null],["puigya01","624577",2019,"CIN",1,"BAT","NL","0.48",100,404,null],["puigya01","624577",2019,"CLE",2,"BAT","AL","0.49",49,207,null],["rossora01","665759",2020,"PHI",1,"BAT","NL",null,0,0,null],["rossora01","665759",2020,"PHI",1,"PITCH","NL","-0.03",7,null,29],["rossora01","665759",2021,"PHI",1,"BAT","NL","0.02",7,1,null],["rossora01","665759",2021,"PHI",1,"PITCH","NL","-0.06",7,null,24],["ruizke01","660688",2020,"LAD",1,"BAT","NL","0.06",2,8,null],["ruizke01","660688",2021,"LAD",1,"BAT","NL","0.00",6,7,null],["ruizke01","660688",2021,"WSN",2,"BAT","NL","0.53",23,89,null],["ruizke01","660688",2022,"WSN",1,"BAT","NL","1.49",112,433,null],["ruizke01","660688",2023,"WSN",1,"BAT","NL","1.39",136,562,null],["ruizke01","660688",2024,"WSN",1,"BAT","NL","0.55",127,485,null],["ruizke01","660688",2025,"WSN",1,"BAT","NL","0.77",68,267,null],["ruizke01","660688",2026,"WSN",1,"BAT","NL","2.15",105,354,null],["ryuhy01","547943",2013,"LAD",1,"BAT","NL","0.32",27,66,null],["ryuhy01","547943",2013,"LAD",1,"PITCH","NL","3.50",30,null,576],["ryuhy01","547943",2014,"LAD",1,"BAT","NL","0.14",24,56,null],["ryuhy01","547943",2014,"LAD",1,"PITCH","NL","1.93",26,null,456],["ryuhy01","547943",2016,"LAD",1,"BAT","NL","-0.01",1,1,null],["ryuhy01","547943",2016,"LAD",1,"PITCH","NL","-0.25",1,null,14],["ryuhy01","547943",2017,"LAD",1,"BAT","NL","0.23",23,38,null],["ryuhy01","547943",2017,"LAD",1,"PITCH","NL","1.37",25,null,380],["ryuhy01","547943",2018,"LAD",1,"BAT","NL","0.33",16,30,null],["ryuhy01","547943",2018,"LAD",1,"PITCH","NL","2.17",15,null,247],["ryuhy01","547943",2019,"LAD",1,"BAT","NL","0.26",28,67,null],["ryuhy01","547943",2019,"LAD",1,"PITCH","NL","5.14",29,null,548],["ryuhy01","547943",2020,"TOR",1,"BAT","AL",null,0,0,null],["ryuhy01","547943",2020,"TOR",1,"PITCH","AL","2.89",12,null,201],["ryuhy01","547943",2021,"TOR",1,"BAT","AL","-0.05",2,4,null],["ryuhy01","547943",2021,"TOR",1,"PITCH","AL","2.02",31,null,507],["ryuhy01","547943",2022,"TOR",1,"BAT","AL",null,0,0,null],["ryuhy01","547943",2022,"TOR",1,"PITCH","AL","-0.31",6,null,81],["ryuhy01","547943",2023,"TOR",1,"BAT","AL",null,0,0,null],["ryuhy01","547943",2023,"TOR",1,"PITCH","AL","0.51",11,null,156],["santaca01","467793",2010,"CLE",1,"BAT","AL","1.95",46,192,null],["santaca01","467793",2011,"CLE",1,"BAT","AL","4.14",155,658,null],["santaca01","467793",2012,"CLE",1,"BAT","AL","3.71",143,609,null],["santaca01","467793",2013,"CLE",1,"BAT","AL","4.36",154,642,null],["santaca01","467793",2014,"CLE",1,"BAT","AL","2.79",152,660,null],["santaca01","467793",2015,"CLE",1,"BAT","AL","0.52",154,666,null],["santaca01","467793",2016,"CLE",1,"BAT","AL","3.47",158,688,null],["santaca01","467793",2017,"CLE",1,"BAT","AL","3.25",154,667,null],["santaca01","467793",2018,"PHI",1,"BAT","NL","2.18",161,679,null],["santaca01","467793",2019,"CLE",1,"BAT","AL","4.69",158,686,null],["santaca01","467793",2020,"CLE",1,"BAT","AL","0.99",60,255,null],["santaca01","467793",2021,"KCR",1,"BAT","AL","-0.13",158,659,null],["santaca01","467793",2022,"KCR",1,"BAT","AL","0.63",52,212,null],["santaca01","467793",2022,"SEA",2,"BAT","AL","0.48",79,294,null],["santaca01","467793",2023,"PIT",1,"BAT","NL","1.51",94,393,null],["santaca01","467793",2023,"MIL",2,"BAT","NL","1.14",52,226,null],["santaca01","467793",2024,"MIN",1,"BAT","AL","2.49",150,594,null],["santaca01","467793",2025,"CLE",1,"BAT","AL","1.37",116,455,null],["santaca01","467793",2025,"CHC",2,"BAT","NL","-0.20",8,19,null],["santaca01","467793",2026,"ARI",1,"BAT","NL","-0.59",8,26,null],["sasakro01","808963",2025,"LAD",1,"BAT","NL",null,0,0,null],["sasakro01","808963",2025,"LAD",1,"PITCH","NL","0.22",10,null,109],["sasakro01","808963",2026,"LAD",1,"PITCH","NL","0.92",26,null,367],["troncra01","470462",2008,"LAD",1,"BAT","NL","0.00",32,0,null],["troncra01","470462",2008,"LAD",1,"PITCH","NL","0.20",32,null,114],["troncra01","470462",2009,"LAD",1,"BAT","NL","-0.08",68,6,null],["troncra01","470462",2009,"LAD",1,"PITCH","NL","1.32",73,null,248],["troncra01","470462",2010,"LAD",1,"BAT","NL","0.01",49,3,null],["troncra01","470462",2010,"LAD",1,"PITCH","NL","0.14",52,null,162],["troncra01","470462",2011,"LAD",1,"BAT","NL","-0.01",16,1,null],["troncra01","470462",2011,"LAD",1,"PITCH","NL","-0.37",18,null,68],["troncra01","470462",2013,"CHW",1,"BAT","AL","0.00",3,0,null],["troncra01","470462",2013,"CHW",1,"PITCH","AL","-0.45",29,null,90],["uriasju01","628711",2016,"LAD",1,"BAT","NL","-0.05",17,26,null],["uriasju01","628711",2016,"LAD",1,"PITCH","NL","1.11",18,null,231],["uriasju01","628711",2017,"LAD",1,"BAT","NL","-0.03",5,7,null],["uriasju01","628711",2017,"LAD",1,"PITCH","NL","-0.24",5,null,70],["uriasju01","628711",2018,"LAD",1,"BAT","NL","-0.01",3,1,null],["uriasju01","628711",2018,"LAD",1,"PITCH","NL","0.11",3,null,12],["uriasju01","628711",2019,"LAD",1,"BAT","NL","0.17",35,18,null],["uriasju01","628711",2019,"LAD",1,"PITCH","NL","1.36",37,null,239],["uriasju01","628711",2020,"LAD",1,"BAT","NL",null,0,0,null],["uriasju01","628711",2020,"LAD",1,"PITCH","NL","1.17",11,null,165],["uriasju01","628711",2021,"LAD",1,"BAT","NL","0.30",30,70,null],["uriasju01","628711",2021,"LAD",1,"PITCH","NL","4.76",32,null,557],["uriasju01","628711",2022,"LAD",1,"BAT","NL",null,0,0,null],["uriasju01","628711",2022,"LAD",1,"PITCH","NL","4.60",31,null,525],["uriasju01","628711",2023,"LAD",1,"BAT","NL",null,0,0,null],["uriasju01","628711",2023,"LAD",1,"PITCH","NL","0.55",21,null,352],["valdeis01","123595",1994,"LAD",1,"BAT","NL","-0.03",21,2,null],["valdeis01","123595",1994,"LAD",1,"PITCH","NL","0.74",21,null,85],["valdeis01","123595",1995,"LAD",1,"BAT","NL","-0.35",33,70,null],["valdeis01","123595",1995,"LAD",1,"PITCH","NL","3.74",33,null,593],["valdeis01","123595",1996,"LAD",1,"BAT","NL","-0.18",33,84,null],["valdeis01","123595",1996,"LAD",1,"PITCH","NL","4.66",33,null,675],["valdeis01","123595",1997,"LAD",1,"BAT","NL","-0.35",28,67,null],["valdeis01","123595",1997,"LAD",1,"PITCH","NL","5.30",30,null,590],["valdeis01","123595",1998,"LAD",1,"BAT","NL","0.44",25,59,null],["valdeis01","123595",1998,"LAD",1,"PITCH","NL","2.38",27,null,522],["valdeis01","123595",1999,"LAD",1,"BAT","NL","-0.46",30,69,null],["valdeis01","123595",1999,"LAD",1,"PITCH","NL","2.79",32,null,610],["valdeis01","123595",2000,"CHC",1,"BAT","NL","0.23",10,20,null],["valdeis01","123595",2000,"CHC",1,"PITCH","NL","0.45",12,null,201],["valdeis01","123595",2000,"LAD",2,"BAT","NL","0.00",9,13,null],["valdeis01","123595",2000,"LAD",2,"PITCH","NL","-0.49",9,null,120],["valdeis01","123595",2001,"ANA",1,"BAT","AL","0.02",2,5,null],["valdeis01","123595",2001,"ANA",1,"PITCH","AL","2.19",27,null,491],["valdeis01","123595",2002,"TEX",1,"BAT","AL","-0.06",2,4,null],["valdeis01","123595",2002,"TEX",1,"PITCH","AL","4.10",23,null,440],["valdeis01","123595",2002,"SEA",2,"BAT","AL",null,0,0,null],["valdeis01","123595",2002,"SEA",2,"PITCH","AL","0.16",8,null,148],["valdeis01","123595",2003,"TEX",1,"BAT","AL","-0.10",2,6,null],["valdeis01","123595",2003,"TEX",1,"PITCH","AL","-0.49",22,null,345],["valdeis01","123595",2004,"SDP",1,"BAT","NL","0.16",21,41,null],["valdeis01","123595",2004,"SDP",1,"PITCH","NL","-1.10",23,null,342],["valdeis01","123595",2004,"FLA",2,"BAT","NL","0.22",11,18,null],["valdeis01","123595",2004,"FLA",2,"PITCH","NL","0.06",11,null,168],["valdeis01","123595",2005,"FLA",1,"BAT","NL","0.05",14,16,null],["valdeis01","123595",2005,"FLA",1,"PITCH","NL","0.05",14,null,152],["valenfe01","123619",1980,"LAD",1,"BAT","NL","-0.02",10,1,null],["valenfe01","123619",1980,"LAD",1,"PITCH","NL","0.87",10,null,53],["valenfe01","123619",1981,"LAD",1,"BAT","NL","0.55",25,71,null],["valenfe01","123619",1981,"LAD",1,"PITCH","NL","4.76",25,null,577],["valenfe01","123619",1982,"LAD",1,"BAT","NL","0.37",38,110,null],["valenfe01","123619",1982,"LAD",1,"PITCH","NL","5.03",37,null,855],["valenfe01","123619",1983,"LAD",1,"BAT","NL","0.19",36,106,null],["valenfe01","123619",1983,"LAD",1,"PITCH","NL","2.67",35,null,771],["valenfe01","123619",1984,"LAD",1,"BAT","NL","0.47",35,89,null],["valenfe01","123619",1984,"LAD",1,"PITCH","NL","3.72",34,null,783],["valenfe01","123619",1985,"LAD",1,"BAT","NL","0.46",35,103,null],["valenfe01","123619",1985,"LAD",1,"PITCH","NL","5.45",35,null,817],["valenfe01","123619",1986,"LAD",1,"BAT","NL","0.64",39,116,null],["valenfe01","123619",1986,"LAD",1,"PITCH","NL","5.45",34,null,808],["valenfe01","123619",1987,"LAD",1,"BAT","NL","-0.31",38,100,null],["valenfe01","123619",1987,"LAD",1,"PITCH","NL","4.09",34,null,753],["valenfe01","123619",1988,"LAD",1,"BAT","NL","0.25",23,52,null],["valenfe01","123619",1988,"LAD",1,"PITCH","NL","-0.12",23,null,427],["valenfe01","123619",1989,"LAD",1,"BAT","NL","-0.01",34,73,null],["valenfe01","123619",1989,"LAD",1,"PITCH","NL","1.25",31,null,590],["valenfe01","123619",1990,"LAD",1,"BAT","NL","1.19",35,78,null],["valenfe01","123619",1990,"LAD",1,"PITCH","NL","-0.13",33,null,612],["valenfe01","123619",1991,"CAL",1,"BAT","AL",null,0,0,null],["valenfe01","123619",1991,"CAL",1,"PITCH","AL","-0.42",2,null,20],["valenfe01","123619",1993,"BAL",1,"BAT","AL",null,0,0,null],["valenfe01","123619",1993,"BAL",1,"PITCH","AL","0.45",32,null,536],["valenfe01","123619",1994,"PHI",1,"BAT","NL","0.09",8,16,null],["valenfe01","123619",1994,"PHI",1,"PITCH","NL","1.37",8,null,135],["valenfe01","123619",1995,"SDP",1,"BAT","NL","0.43",29,35,null],["valenfe01","123619",1995,"SDP",1,"PITCH","NL","0.55",29,null,271],["valenfe01","123619",1996,"SDP",1,"BAT","NL","-0.21",36,66,null],["valenfe01","123619",1996,"SDP",1,"PITCH","NL","2.84",33,null,515],["valenfe01","123619",1997,"SDP",1,"BAT","NL","-0.01",14,21,null],["valenfe01","123619",1997,"SDP",1,"PITCH","NL","0.14",13,null,199],["valenfe01","123619",1997,"STL",2,"BAT","NL","0.01",4,7,null],["valenfe01","123619",1997,"STL",2,"PITCH","NL","-0.61",5,null,68],["vargami01","678246",2022,"LAD",1,"BAT","NL","-0.36",18,50,null],["vargami01","678246",2023,"LAD",1,"BAT","NL","0.11",81,304,null],["vargami01","678246",2024,"LAD",1,"BAT","NL","0.24",30,80,null],["vargami01","678246",2024,"CHW",2,"BAT","AL","-1.04",42,157,null],["vargami01","678246",2025,"CHW",1,"BAT","AL","1.88",138,569,null],["vargami01","678246",2026,"CHW",1,"BAT","AL","5.35",159,704,null],["vivasjo01","678391",2025,"NYY",1,"BAT","AL","-0.30",29,66,null],["vivasjo01","678391",2026,"WSN",1,"BAT","NL","1.04",121,364,null],["vivasjo01","678391",2026,"WSN",1,"PITCH","NL","-0.23",4,null,12],["vizcajo01","123743",1989,"LAD",1,"BAT","NL","-0.12",7,11,null],["vizcajo01","123743",1990,"LAD",1,"BAT","NL","0.07",37,55,null],["vizcajo01","123743",1991,"CHC",1,"BAT","NL","0.10",93,154,null],["vizcajo01","123743",1992,"CHC",1,"BAT","NL","-0.57",86,305,null],["vizcajo01","123743",1993,"CHC",1,"BAT","NL","2.52",151,617,null],["vizcajo01","123743",1994,"NYM",1,"BAT","NL","-1.11",103,456,null],["vizcajo01","123743",1995,"NYM",1,"BAT","NL","1.42",135,561,null],["vizcajo01","123743",1996,"NYM",1,"BAT","NL","2.03",96,402,null],["vizcajo01","123743",1996,"CLE",2,"BAT","AL","0.25",48,191,null],["vizcajo01","123743",1997,"SFG",1,"BAT","NL","2.53",151,630,null],["vizcajo01","123743",1998,"LAD",1,"BAT","NL","0.35",67,267,null],["vizcajo01","123743",1999,"LAD",1,"BAT","NL","0.01",94,298,null],["vizcajo01","123743",2000,"LAD",1,"BAT","NL","-0.12",40,106,null],["vizcajo01","123743",2000,"NYY",2,"BAT","AL","0.24",73,191,null],["vizcajo01","123743",2001,"HOU",1,"BAT","NL","-0.08",107,282,null],["vizcajo01","123743",2002,"HOU",1,"BAT","NL","0.48",125,438,null],["vizcajo01","123743",2003,"HOU",1,"BAT","NL","-0.49",91,203,null],["vizcajo01","123743",2004,"HOU",1,"BAT","NL","0.35",138,385,null],["vizcajo01","123743",2005,"HOU",1,"BAT","NL","-0.07",98,205,null],["vizcajo01","123743",2006,"SFG",1,"BAT","NL","-1.05",64,136,null],["vizcajo01","123743",2006,"STL",2,"BAT","NL","0.27",16,25,null],["watsoto01","453265",2011,"PIT",1,"BAT","NL","-0.01",39,1,null],["watsoto01","453265",2011,"PIT",1,"PITCH","NL","0.35",43,null,123],["watsoto01","453265",2012,"PIT",1,"BAT","NL","-0.01",64,1,null],["watsoto01","453265",2012,"PIT",1,"PITCH","NL","0.64",68,null,160],["watsoto01","453265",2013,"PIT",1,"BAT","NL","-0.04",63,3,null],["watsoto01","453265",2013,"PIT",1,"PITCH","NL","1.51",67,null,215],["watsoto01","453265",2014,"PIT",1,"BAT","NL","0.05",75,3,null],["watsoto01","453265",2014,"PIT",1,"PITCH","NL","2.57",78,null,232],["watsoto01","453265",2015,"PIT",1,"BAT","NL","0.00",72,0,null],["watsoto01","453265",2015,"PIT",1,"PITCH","NL","2.45",77,null,226],["watsoto01","453265",2016,"PIT",1,"BAT","NL","0.01",65,1,null],["watsoto01","453265",2016,"PIT",1,"PITCH","NL","1.28",70,null,203],["watsoto01","453265",2017,"PIT",1,"BAT","NL","-0.01",44,1,null],["watsoto01","453265",2017,"PIT",1,"PITCH","NL","0.54",47,null,140],["watsoto01","453265",2017,"LAD",2,"BAT","NL","0.00",24,0,null],["watsoto01","453265",2017,"LAD",2,"PITCH","NL","0.40",24,null,60],["watsoto01","453265",2018,"SFG",1,"BAT","NL","0.00",67,0,null],["watsoto01","453265",2018,"SFG",1,"PITCH","NL","2.00",72,null,198],["watsoto01","453265",2019,"SFG",1,"BAT","NL","0.00",57,0,null],["watsoto01","453265",2019,"SFG",1,"PITCH","NL","0.37",60,null,162],["watsoto01","453265",2020,"SFG",1,"BAT","NL",null,0,0,null],["watsoto01","453265",2020,"SFG",1,"PITCH","NL","0.16",21,null,54],["watsoto01","453265",2021,"LAA",1,"BAT","AL","-0.01",9,1,null],["watsoto01","453265",2021,"LAA",1,"PITCH","AL","0.14",36,null,99],["watsoto01","453265",2021,"SFG",2,"BAT","NL","0.00",26,0,null],["watsoto01","453265",2021,"SFG",2,"PITCH","NL","0.67",26,null,73]]}$m032$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
begin
  if to_regclass('public.v_signing_acquisition_financials') is null or to_regclass('public.signing_financial_resolutions') is null then
    raise exception '032: Migration 031 has not been applied';
  end if;
  for p in select x from _m032, jsonb_array_elements(j -> 'source_urls') x loop
    if not exists (select 1 from public.sources where url = p #>> '{}') then
      raise exception '032: the Baseball-Reference data file source % is not registered', p #>> '{}';
    end if;
  end loop;
  -- every return asset exists once and is a PLAYER on the INCOMING side
  for p in select x from _m032, jsonb_array_elements(j -> 'return_assets') x loop
    select count(*) into n from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
    where e.event_key = p ->> 'event_key' and a.asset_name = p ->> 'asset_name' and a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER';
    if n <> 1 then
      raise exception '032: return asset % (%) was not found once', p ->> 'asset_name', p ->> 'event_key';
    end if;
  end loop;
  -- every organization the team-code map names exists
  for p in select x from _m032, jsonb_array_elements(j -> 'team_map') x loop
    if not exists (select 1 from public.organizations where abbreviation = p ->> 'organization') then
      raise exception '032: organization % of team code % does not exist', p ->> 'organization', p ->> 'code';
    end if;
  end loop;
  -- every scoped DISI player exists and carries the bref_id the rows will join on
  select count(*) into n from public.outcome_audits a join public.players pl on pl.id = a.player_id where a.reached_mlb_verified and pl.bref_id is null;
  if n <> 0 then
    raise exception '032: % verified MLB-reached player(s) lack a bref_id', n;
  end if;
end $$;

-- ===========================================================================
-- 2. SCHEMA
-- ===========================================================================

create table if not exists public.bref_team_code_map (
  id uuid primary key default gen_random_uuid(),
  bref_team_code text not null check (bref_team_code ~ '^[A-Z]{2,3}$'),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  from_season int not null check (from_season between 1871 and 2100),
  to_season int check (to_season is null or (to_season between 1871 and 2100 and to_season >= from_season)),
  note text,
  created_at timestamptz not null default now(),
  unique (bref_team_code, from_season)
);

create table if not exists public.player_mlb_team_season_war (
  id uuid primary key default gen_random_uuid(),
  bref_id text not null check (bref_id ~ '^[a-z0-9]+$'),
  mlb_id text check (mlb_id is null or mlb_id ~ '^[0-9]+$'),
  player_id uuid references public.players(id) on delete restrict,
  season int not null check (season between 1871 and 2100),
  bref_team_code text not null check (bref_team_code ~ '^[A-Z]{2,3}$'),
  organization_id uuid references public.organizations(id) on delete restrict,
  stint_ordinal int not null check (stint_ordinal >= 1),
  component text not null check (component in ('BAT', 'PITCH')),
  war numeric(7,2),
  games int check (games is null or games >= 0),
  plate_appearances int check (plate_appearances is null or plate_appearances >= 0),
  ip_outs int check (ip_outs is null or ip_outs >= 0),
  league text,
  war_system text not null default 'BWAR' check (war_system = 'BWAR'),
  source_id uuid not null references public.sources(id) on delete restrict,
  observed_through_date date not null,
  observed_through_season int not null check (observed_through_season between 1871 and 2100),
  retrieved_at timestamptz not null,
  confidence public.confidence_level not null,
  note text check (note is null or char_length(note) <= 300),
  record_status text not null default 'ACTIVE' check (record_status in ('ACTIVE', 'RETRACTED')),
  supersedes_record_id uuid references public.player_mlb_team_season_war(id) on delete restrict,
  retracted_at timestamptz,
  retraction_reason text,
  created_at timestamptz not null default now(),
  constraint player_mlb_team_season_war_season_observed_check check (season <= observed_through_season),
  constraint player_mlb_team_season_war_supersedes_check check (supersedes_record_id is null or supersedes_record_id <> id),
  constraint player_mlb_team_season_war_retraction_check check ((record_status = 'RETRACTED') = (retracted_at is not null)
    and (record_status = 'ACTIVE' or nullif(btrim(retraction_reason), '') is not null)
    and (record_status = 'RETRACTED' or retraction_reason is null))
);
-- deterministic uniqueness: one ACTIVE row per player identity, season, team, stint and component
create unique index if not exists player_mlb_team_season_war_active_key on public.player_mlb_team_season_war
  (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE';
create unique index if not exists player_mlb_team_season_war_supersedes_key on public.player_mlb_team_season_war (supersedes_record_id)
  where supersedes_record_id is not null;
create index if not exists player_mlb_team_season_war_bref_idx on public.player_mlb_team_season_war (bref_id);
create index if not exists player_mlb_team_season_war_player_idx on public.player_mlb_team_season_war (player_id) where player_id is not null;

alter table public.transaction_event_assets add column if not exists bref_id text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.transaction_event_assets'::regclass and conname = 'transaction_event_assets_bref_id_check') then
    alter table public.transaction_event_assets add constraint transaction_event_assets_bref_id_check
      check (bref_id is null or (bref_id ~ '^[a-z0-9]+$' and asset_type = 'PLAYER'));
  end if;
end $$;

comment on table public.bref_team_code_map is
  'Baseball-Reference franchise / team code -> DISI organization with the seasons the code is used. A code can name a different DISI organization row over time only where the franchise did (e.g. BRO and LAD both resolve to the Dodgers franchise). A loaded row whose code has no mapping keeps organization_id NULL and is queued as TEAM_HISTORY_UNRESOLVED.';
comment on table public.player_mlb_team_season_war is
  'Baseball-Reference bWAR by player, season, team and stint, BAT and PITCH components stored separately (a derived view sums them). bWAR only: fWAR and any other WAR system are never mixed in. war NULL means the file has no WAR for that row (a zero-PA batting row), never zero. Direct Dodgers value is the sum over rows whose organization is the Dodgers franchise; value for any other organization is never credited to Los Angeles. Facts are sealed ACTIVE rows with supersession; nothing is deleted.';
comment on column public.player_mlb_team_season_war.ip_outs is
  'Innings pitched as outs (IPouts in the source file), kept as an integer so no fractional-inning ambiguity is introduced.';
comment on column public.transaction_event_assets.bref_id is
  'Baseball-Reference id of an incoming PLAYER return asset whose identity was verified; lets the asset join team-season WAR without a DISI players row. NULL for cash, future considerations, non-player and unresolved assets.';

create or replace function public.disi_team_season_war_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pred public.player_mlb_team_season_war%rowtype;
  mapped uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'team-season WAR facts are never deleted; retract them instead' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' then
    if old.record_status = 'RETRACTED' then
      raise exception 'a RETRACTED team-season WAR fact is sealed (%)', old.id using errcode = '55000';
    end if;
    if new.record_status <> 'RETRACTED'
       or (to_jsonb(new) - 'record_status' - 'retracted_at' - 'retraction_reason') is distinct from (to_jsonb(old) - 'record_status' - 'retracted_at' - 'retraction_reason') then
      raise exception 'an ACTIVE team-season WAR fact is sealed; the only change allowed is retraction (%)', old.id using errcode = '55000';
    end if;
    return new;
  end if;
  if new.record_status <> 'ACTIVE' then
    raise exception 'a new team-season WAR fact starts ACTIVE' using errcode = '55000';
  end if;
  -- the organization must be exactly what the mapping says for that code and season; NULL only where no mapping exists
  select m.organization_id into mapped from public.bref_team_code_map m
  where m.bref_team_code = new.bref_team_code and new.season >= m.from_season and new.season <= coalesce(m.to_season, 9999)
  order by m.from_season desc limit 1;
  if new.organization_id is distinct from mapped then
    raise exception 'organization % does not match the team-code mapping for % in % (expected %)', new.organization_id, new.bref_team_code, new.season, mapped using errcode = '55000';
  end if;
  if new.supersedes_record_id is not null then
    select * into pred from public.player_mlb_team_season_war where id = new.supersedes_record_id;
    if not found or pred.id = new.id or pred.bref_id <> new.bref_id or pred.season <> new.season
       or pred.bref_team_code <> new.bref_team_code or pred.stint_ordinal <> new.stint_ordinal or pred.component <> new.component then
      raise exception 'a correction must supersede an existing fact of the same player, season, team, stint and component (%)', new.supersedes_record_id using errcode = '55000';
    end if;
    if pred.record_status = 'ACTIVE' then
      update public.player_mlb_team_season_war
        set record_status = 'RETRACTED', retracted_at = now(), retraction_reason = 'Superseded by a corrected fact.'
      where id = pred.id;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.disi_team_season_war_guard() from public, anon, authenticated;

drop trigger if exists player_mlb_team_season_war_guard on public.player_mlb_team_season_war;
create trigger player_mlb_team_season_war_guard
before insert or update or delete on public.player_mlb_team_season_war
for each row execute function public.disi_team_season_war_guard();

do $$
declare t text;
begin
  foreach t in array array['bref_team_code_map', 'player_mlb_team_season_war'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

-- ===========================================================================
-- 3. TEAM-CODE MAP, TEAM-SEASON FACTS, RETURN-ASSET IDENTITIES
-- ===========================================================================

insert into public.bref_team_code_map (bref_team_code, organization_id, from_season, to_season, note)
select x ->> 'code', o.id, (x ->> 'from')::int, (x ->> 'to')::int, x ->> 'note'
from _m032, jsonb_array_elements(j -> 'team_map') x
join public.organizations o on o.abbreviation = x ->> 'organization'
on conflict (bref_team_code, from_season) do nothing;

insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
  plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
select r ->> 0, r ->> 1, pl.id, (r ->> 2)::int, r ->> 3, m.organization_id, (r ->> 4)::int, r ->> 5, nullif(r ->> 7, '')::numeric, nullif(r ->> 8, '')::int,
       nullif(r ->> 9, '')::int, nullif(r ->> 10, '')::int, nullif(r ->> 6, ''), so.id,
       (j ->> 'observed_through_date')::date, (j ->> 'observed_through_season')::int, (j ->> 'retrieved_at')::timestamptz, 'VERIFIED',
       case when r ->> 7 is null then 'The data file has no WAR for this zero-plate-appearance row; stored as NULL, not zero.' end
from _m032 cross join lateral jsonb_array_elements(j -> 'rows') r
join public.sources so on so.url = case when r ->> 5 = 'BAT' then j ->> 'bat_url' else j ->> 'pitch_url' end
left join public.players pl on pl.bref_id = r ->> 0
left join lateral (
  select m2.organization_id from public.bref_team_code_map m2
  where m2.bref_team_code = r ->> 3 and (r ->> 2)::int >= m2.from_season and (r ->> 2)::int <= coalesce(m2.to_season, 9999)
  order by m2.from_season desc limit 1
) m on true
on conflict (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE' do nothing;

do $$
declare
  p jsonb;
begin
  for p in select x from _m032, jsonb_array_elements(j -> 'return_assets') x loop
    update public.transaction_event_assets a set bref_id = p ->> 'bref_id'
    from public.transaction_events e
    where a.event_id = e.id and e.event_key = p ->> 'event_key' and a.asset_name = p ->> 'asset_name' and a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER'
      and a.bref_id is null;
    if not exists (select 1 from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
                   where e.event_key = p ->> 'event_key' and a.asset_name = p ->> 'asset_name' and a.bref_id = p ->> 'bref_id') then
      raise exception '032: return asset % carries a different bref_id', p ->> 'asset_name';
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 4. LEGACY CAREER-WAR STORES: reconcile only what the loaded facts prove
-- ===========================================================================
-- Legacy stores keep one decimal (Baseball-Reference's displayed career total). A value is written only where
-- the store is empty and the loaded team-season rows round to exactly the reviewed value.

do $$
declare
  b jsonb;
  pid uuid;
  total numeric;
  src uuid;
  n int;
begin
  for b in select x from _m032, jsonb_array_elements(j -> 'backfills') x loop
    select id into pid from public.players where slug = b ->> 'slug';
    select round(sum(w.war), 1) into total from public.player_mlb_team_season_war w
    where w.player_id = pid and w.record_status = 'ACTIVE' and w.war_system = 'BWAR';
    if pid is null or total is distinct from (b ->> 'expected')::numeric then
      raise exception '032: the loaded rows for % total % but % was reviewed', b ->> 'slug', total, b ->> 'expected';
    end if;
    select id into src from public.sources where url = (select j ->> 'bat_url' from _m032);
    if b ->> 'store' = 'OUTCOMES_CAREER_WAR' then
      update public.outcomes set career_war = total where player_id = pid and career_war is null;
      get diagnostics n = row_count;
      if n = 1 or exists (select 1 from public.outcomes where player_id = pid and career_war = total) then
        insert into public.evidence (entity_type, entity_id, field_name, source_id, confidence, evidence_note)
        select 'player', pid, 'career_war', src, 'VERIFIED',
               'Career bWAR is the sum of the player''s Baseball-Reference batting and pitching team-season WAR rows in the data files, rounded to one decimal.'
        where not exists (select 1 from public.evidence where entity_type = 'player' and entity_id = pid and field_name = 'career_war' and source_id = src);
      else
        raise exception '032: outcomes.career_war for % holds a different value', b ->> 'slug';
      end if;
    elsif b ->> 'store' = 'METRIC_CAREER_BWAR' then
      insert into public.player_metric_observations (player_id, metric_key, value, observed_through_date, observed_through_season, source_id, confidence, notes)
      select pid, 'CAREER_BWAR', total, (j ->> 'observed_through_date')::date, (j ->> 'observed_through_season')::int, src, 'VERIFIED',
             'Sum of the Baseball-Reference batting and pitching team-season WAR rows, rounded to one decimal.'
      from _m032
      where not exists (select 1 from public.player_metric_observations where player_id = pid and metric_key = 'CAREER_BWAR');
    end if;
  end loop;
end $$;

-- ===========================================================================
-- 5. VIEWS
-- ===========================================================================

-- One-hop trade realization: trade event -> outgoing package -> incoming player asset -> its Dodgers bWAR.
-- Attribution to a DISI player is permitted only when that player is the sole outgoing asset of the event.
create or replace view public.v_trade_realization_edges
with (security_invoker = true)
as
with ev as (
  select e.id as event_id, e.event_key, e.transaction_date, e.description,
    (select o2.franchise_key from public.organizations o2
      where o2.id = case when fo.franchise_key = 'DODGERS' then e.to_organization_id else e.from_organization_id end) as counterparty_franchise_key,
    count(a.id) filter (where a.asset_side = 'OUTGOING')::int as outgoing_asset_count,
    count(a.id) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null)::int as tracked_outgoing_count,
    array_agg(p.slug order by p.slug) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null) as tracked_outgoing_slugs,
    array_agg(a.player_id) filter (where a.asset_side = 'OUTGOING' and a.player_id is not null) as tracked_outgoing_player_ids
  from public.transaction_events e
  left join public.organizations fo on fo.id = e.from_organization_id
  join public.transaction_event_assets a on a.event_id = e.id
  left join public.players p on p.id = a.player_id
  where e.transaction_type = 'TRADE'
  group by e.id, e.event_key, e.transaction_date, e.description, fo.franchise_key, e.to_organization_id, e.from_organization_id
)
select
  ev.event_key, ev.transaction_date, ev.description as event_description,
  ev.outgoing_asset_count, ev.tracked_outgoing_count, ev.tracked_outgoing_slugs, ev.tracked_outgoing_player_ids,
  (ev.outgoing_asset_count = 1 and ev.tracked_outgoing_count = 1) as individual_attribution_permitted,
  case when ev.outgoing_asset_count = 1 then 'SOLE_OUTGOING_ASSET' else 'SHARED_PACKAGE_RETURN' end as attribution_status,
  i.id as incoming_asset_id, i.asset_name as incoming_asset_name, i.bref_id as incoming_bref_id,
  case when i.bref_id is null then 'NO_BREF_IDENTITY' when coalesce(w.team_season_rows, 0) = 0 then 'NO_TEAM_SEASON_FACTS'
       when w.timing_resolved is not true then 'TIMING_UNRESOLVED' else 'LOADED' end as incoming_war_status,
  w.team_season_rows as incoming_team_season_rows,
  extract(year from ev.transaction_date)::int as acquisition_season,
  ev.counterparty_franchise_key,
  case when coalesce(w.team_season_rows, 0) > 0 then w.timing_status end as acquisition_timing_status,
  case when coalesce(w.team_season_rows, 0) > 0 then w.timing_resolved end as same_season_timing_resolved,
  case when coalesce(w.team_season_rows, 0) > 0 then w.pre_rows end as pre_acquisition_dodgers_stint_rows,
  case when coalesce(w.team_season_rows, 0) > 0 then coalesce(w.pre_war, 0) end as pre_acquisition_dodgers_bwar_excluded,
  case when coalesce(w.team_season_rows, 0) > 0 and w.timing_resolved then coalesce(w.post_war, 0) end as incoming_dodgers_bwar,
  case when coalesce(w.team_season_rows, 0) > 0 then coalesce(w.later_seasons_war, 0) end as dodgers_bwar_complete_seasons_after_acquisition,
  w.ambiguous_war as unresolved_same_season_dodgers_bwar,
  w.later_non_dodgers_rows as incoming_later_non_dodgers_team_seasons,
  exists (
    select 1 from public.transaction_event_assets x join public.transaction_events e2 on e2.id = x.event_id
    where x.asset_side = 'OUTGOING' and x.bref_id = i.bref_id and e2.transaction_date > ev.transaction_date
  ) as downstream_asset_chain_incomplete,
  m.dodgers_regular_season_war as legacy_return_dodgers_war,
  case when coalesce(w.team_season_rows, 0) > 0 and w.timing_resolved then round(coalesce(w.post_war, 0) - m.dodgers_regular_season_war, 2) end as derived_minus_legacy_war
from ev
join public.transaction_event_assets i on i.event_id = ev.event_id and i.asset_side = 'INCOMING' and i.asset_type = 'PLAYER'
left join lateral (
  with k as (
    select extract(year from ev.transaction_date)::int as y, extract(month from ev.transaction_date)::int as mo
  ),
  t as (
    select x.season, x.stint_ordinal, x.war, x.organization_id, o.franchise_key
    from public.player_mlb_team_season_war x
    left join public.organizations o on o.id = x.organization_id
    where x.bref_id = i.bref_id and x.record_status = 'ACTIVE' and x.war_system = 'BWAR'
  ),
  -- B-Ref stint order is chronological within a season. A same-season Dodgers stint is placed relative to the
  -- acquisition only through the counterparty's single stint that season: the trade is the move out of the counterparty,
  -- so the Dodgers stint that immediately follows it is the first post-acquisition stint. Otherwise the season is left
  -- unresolved, never counted whole and never zeroed.
  cp as (
    select count(distinct t.stint_ordinal)::int as cp_stints, max(t.stint_ordinal) as cp_ord
    from t cross join k where t.season = k.y and ev.counterparty_franchise_key is not null and t.franchise_key = ev.counterparty_franchise_key
  ),
  s as (
    select count(*) filter (where t.franchise_key = 'DODGERS')::int as d_rows,
      coalesce(bool_or(t.franchise_key = 'DODGERS' and t.stint_ordinal = cp.cp_ord + 1), false) as anchor
    from t cross join k cross join cp where t.season = k.y
  ),
  g as (
    select k.y, k.mo, coalesce(s.d_rows, 0) as d_rows, (coalesce(cp.cp_stints, 0) = 1 and coalesce(s.anchor, false)) as anchored, cp.cp_ord
    from k cross join cp left join s on true
  ),
  cls as (
    select t.*, g.mo,
      case when t.franchise_key is distinct from 'DODGERS' then null
           when t.season > g.y then 'POST'
           when t.season < g.y then 'PRE'
           when g.mo >= 11 then 'PRE'
           when g.mo <= 2 then 'POST'
           when g.anchored and t.stint_ordinal > g.cp_ord then 'POST'
           when g.anchored and t.stint_ordinal < g.cp_ord then 'PRE'
           else 'AMBIGUOUS' end as placement,
      (t.season > g.y) as later_season
    from t cross join g
  )
  select
    (select count(*) from t)::int as team_season_rows,
    case when g.mo >= 11 then 'OFFSEASON_AFTER_SEASON'
         when g.mo <= 2 then 'OFFSEASON_BEFORE_SEASON'
         when g.d_rows = 0 then 'NO_ACQUISITION_SEASON_DODGERS_STINT'
         when ev.counterparty_franchise_key is null then 'NO_COUNTERPARTY_ORGANIZATION'
         when g.anchored then 'RESOLVED_BY_COUNTERPARTY_STINT_ORDER'
         else 'UNRESOLVED_SAME_SEASON_STINT_ORDER' end as timing_status,
    (g.mo >= 11 or g.mo <= 2 or g.d_rows = 0 or g.anchored) as timing_resolved,
    (select sum(c.war) filter (where c.placement = 'POST') from cls c) as post_war,
    (select sum(c.war) filter (where c.later_season and c.franchise_key = 'DODGERS') from cls c) as later_seasons_war,
    (select count(*) filter (where c.placement = 'PRE') from cls c)::int as pre_rows,
    (select sum(c.war) filter (where c.placement = 'PRE') from cls c) as pre_war,
    (select sum(c.war) filter (where c.placement = 'AMBIGUOUS') from cls c) as ambiguous_war,
    (select count(*) filter (where c.franchise_key is distinct from 'DODGERS' and c.organization_id is not null and c.season >= g.y) from t c)::int as later_non_dodgers_rows
  from g
) w on true
left join public.transaction_return_metrics m on m.event_id = ev.event_id and m.incoming_asset_name = i.asset_name;

comment on view public.v_trade_realization_edges is
  'One hop only: a modeled trade, its outgoing package and each incoming player asset with the bWAR it produced for the Dodgers after that specific acquisition. Dodgers stints before the acquisition are never credited: earlier seasons, the same season after it ended, and same-season stints ordered before the counterparty stint (B-Ref stint order is chronological) are excluded. A same-season Dodgers stint that cannot be ordered against the counterparty stint leaves the return NULL with acquisition_timing_status UNRESOLVED_SAME_SEASON_STINT_ORDER, never zero and never the whole season. A DISI player is individually attributable only as the sole outgoing asset; a shared package is exposed at package level and never split. downstream_asset_chain_incomplete is true only where a recorded later transaction sends the incoming asset away; descendants are never attributed. legacy_return_dodgers_war is the hand-entered transaction_return_metrics figure kept for comparison.';

-- One row per Dodgers international signing: acquisition cost and its completeness, direct and non-Dodgers MLB value
-- from team-season facts, one-hop trade return with attribution state, maturity and a single organizational status.
create or replace view public.v_player_organizational_realization
with (security_invoker = true)
as
with as_of as (
  select max(audited_through_date) as analysis_as_of_date from public.outcome_audits
),
ts as (
  select w.bref_id,
    count(*)::int as team_season_rows,
    count(*) filter (where w.organization_id is null)::int as unresolved_rows,
    count(*) filter (where w.war is null)::int as null_war_rows,
    sum(w.war) as team_season_career_bwar,
    count(*) filter (where o.franchise_key = 'DODGERS')::int as dodgers_rows,
    sum(w.war) filter (where o.franchise_key = 'DODGERS') as dodgers_war,
    count(*) filter (where o.franchise_key is distinct from 'DODGERS' and w.organization_id is not null)::int as non_dodgers_rows,
    sum(w.war) filter (where o.franchise_key is distinct from 'DODGERS' and w.organization_id is not null) as non_dodgers_war,
    min(w.season) as first_mlb_season,
    (array_agg(o.franchise_key order by w.season, w.stint_ordinal))[1] as first_mlb_franchise
  from public.player_mlb_team_season_war w
  left join public.organizations o on o.id = w.organization_id
  where w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
  group by w.bref_id
),
pkg as (
  select u.player_id,
    count(distinct u.event_key)::int as trade_events,
    bool_and(u.individual_attribution_permitted) as individual_permitted,
    bool_and(u.incoming_war_status = 'LOADED') as return_complete,
    case when bool_and(u.incoming_war_status = 'LOADED') then sum(u.incoming_dodgers_bwar) end as package_return_bwar,
    bool_or(u.downstream_asset_chain_incomplete) as downstream_flag
  from (select unnest(e.tracked_outgoing_player_ids) as player_id, e.* from public.v_trade_realization_edges e) u
  group by u.player_id
),
base as (
  select f.signing_id, f.player_id, f.player_slug, f.full_name, f.signing_year, f.signing_date, f.pathway, f.country_market,
    f.known_acquisition_cost_usd, f.acquisition_cost_completeness,
    pl.bref_id,
    a.reached_mlb_verified, a.outcome_state, a.audited_through_date,
    coalesce(wv.career_bwar, oc.career_war) as legacy_career_bwar,
    wv.career_bwar as metric_career_bwar, oc.career_war as outcomes_career_war, oc.current_status,
    ts.team_season_rows, ts.unresolved_rows, ts.null_war_rows, ts.team_season_career_bwar, ts.dodgers_rows, ts.dodgers_war, ts.non_dodgers_rows, ts.non_dodgers_war,
    ts.first_mlb_season, ts.first_mlb_franchise,
    pkg.trade_events, pkg.individual_permitted, pkg.return_complete, pkg.package_return_bwar, pkg.downstream_flag,
    as_of.analysis_as_of_date,
    case when f.signing_date is not null then f.signing_date <= (as_of.analysis_as_of_date - interval '5 years')::date
         else f.signing_year <= extract(year from as_of.analysis_as_of_date)::int - 5 end as is_mature
  from public.v_signing_acquisition_financials f
  join public.players pl on pl.id = f.player_id
  cross join as_of
  left join public.outcome_audits a on a.player_id = f.player_id
  left join public.outcomes oc on oc.player_id = f.player_id
  left join public.v_player_war wv on wv.player_id = f.player_id
  left join ts on ts.bref_id = pl.bref_id
  left join pkg on pkg.player_id = f.player_id
  where f.is_dodgers
),
state as (
  select b.*,
    case
      when b.reached_mlb_verified is true and coalesce(b.team_season_rows, 0) > 0 and b.unresolved_rows = 0
           and b.legacy_career_bwar is not null and abs(b.team_season_career_bwar - b.legacy_career_bwar) <= 0.1 then 'LOADED_RECONCILED'
      when b.reached_mlb_verified is true and coalesce(b.team_season_rows, 0) > 0 then 'LOADED_NEEDS_REVIEW'
      when b.reached_mlb_verified is true then 'MISSING'
      when b.outcome_state = 'NO_MLB_CAREER_ENDED' then 'NOT_APPLICABLE_NO_MLB'
      else 'NOT_APPLICABLE_OUTCOME_OPEN'
    end as team_history_status
  from base b
),
vals as (
  select s.*,
    case when s.team_history_status = 'LOADED_RECONCILED' then coalesce(s.dodgers_war, 0)
         when s.team_history_status = 'NOT_APPLICABLE_NO_MLB' then 0 end as direct_dodgers_mlb_bwar,
    case when s.team_history_status = 'LOADED_RECONCILED' then coalesce(s.non_dodgers_war, 0)
         when s.team_history_status = 'NOT_APPLICABLE_NO_MLB' then 0 end as non_dodgers_mlb_bwar,
    case when s.trade_events is null then 'NO_MODELED_TRADE_EVENT'
         when not s.individual_permitted then 'SHARED_PACKAGE_NOT_ATTRIBUTABLE'
         when not s.return_complete then 'RETURN_WAR_UNKNOWN'
         else 'SOLE_OUTGOING_ATTRIBUTABLE' end as package_attribution_state
  from state s
),
calc as (
  select v.*,
    case when v.package_attribution_state = 'SOLE_OUTGOING_ATTRIBUTABLE' then v.package_return_bwar end as individually_attributable_trade_return_bwar
  from vals v
)
select
  c.signing_id, c.player_id, c.player_slug, c.full_name, c.bref_id,
  c.signing_year, c.signing_date, c.pathway, c.country_market,
  c.known_acquisition_cost_usd, c.acquisition_cost_completeness,
  c.analysis_as_of_date,
  case when c.is_mature then 'MATURE' else 'RECENT' end as maturity_status,
  case when c.signing_date is not null then 'SIGNING_DATE_PLUS_5_YEARS' else 'SIGNING_YEAR_PLUS_5_YEARS' end as maturity_basis,
  c.outcome_state, c.reached_mlb_verified, c.current_status, c.team_history_status,
  c.first_mlb_season, c.first_mlb_franchise,
  c.legacy_career_bwar as career_bwar,
  c.team_season_career_bwar,
  c.direct_dodgers_mlb_bwar,
  c.non_dodgers_mlb_bwar,
  c.dodgers_rows as dodgers_mlb_team_seasons,
  c.non_dodgers_rows as non_dodgers_mlb_team_seasons,
  c.package_return_bwar as trade_package_return_dodgers_bwar,
  c.individually_attributable_trade_return_bwar,
  c.package_attribution_state,
  coalesce(c.downstream_flag, false) as downstream_asset_chain_incomplete,
  case when c.direct_dodgers_mlb_bwar is null then null
       when c.package_attribution_state = 'RETURN_WAR_UNKNOWN' then null
       else c.direct_dodgers_mlb_bwar + coalesce(c.individually_attributable_trade_return_bwar, 0) end as attributable_organizational_bwar,
  case when c.direct_dodgers_mlb_bwar is null then 'OUTCOME_NOT_OBSERVED'
       when c.package_attribution_state = 'SHARED_PACKAGE_NOT_ATTRIBUTABLE' then 'DIRECT_ONLY_SHARED_PACKAGE_RETURN_EXCLUDED'
       when c.package_attribution_state = 'RETURN_WAR_UNKNOWN' then 'RETURN_WAR_UNKNOWN'
       when c.package_attribution_state = 'SOLE_OUTGOING_ATTRIBUTABLE' then 'DIRECT_PLUS_SOLE_OUTGOING_RETURN'
       else 'DIRECT_ONLY' end as attributable_value_basis,
  case
    when c.reached_mlb_verified is true and c.team_history_status <> 'LOADED_RECONCILED' then 'OUTCOME_INCOMPLETE'
    when c.reached_mlb_verified is true and c.dodgers_rows > 0 then 'DIRECT_DODGERS_MLB_VALUE'
    when c.reached_mlb_verified is true then 'MLB_ELSEWHERE_ONLY'
    when c.outcome_state = 'NO_MLB_ACTIVE_IN_MINORS' then 'STILL_DEVELOPING'
    when c.outcome_state = 'NO_MLB_CAREER_ENDED' and c.is_mature then 'NO_MLB_VALUE_OBSERVED'
    when not c.is_mature then 'TOO_RECENT_TO_EVALUATE'
    else 'OUTCOME_INCOMPLETE'
  end as organizational_realization_status,
  (c.package_attribution_state = 'SOLE_OUTGOING_ATTRIBUTABLE' and c.individually_attributable_trade_return_bwar is not null) as flag_trade_return_attributable,
  (c.package_attribution_state = 'SHARED_PACKAGE_NOT_ATTRIBUTABLE') as flag_trade_return_package_only,
  (coalesce(c.non_dodgers_rows, 0) > 0) as flag_has_non_dodgers_mlb_value,
  (c.acquisition_cost_completeness = 'COMPLETE' and c.known_acquisition_cost_usd > 0 and c.direct_dodgers_mlb_bwar is not null and c.is_mature) as cost_metric_eligible,
  case when c.acquisition_cost_completeness <> 'COMPLETE' or c.known_acquisition_cost_usd is null or c.known_acquisition_cost_usd <= 0 then 'ACQUISITION_COST_' || c.acquisition_cost_completeness
       when c.direct_dodgers_mlb_bwar is null then 'OUTCOME_NOT_OBSERVED'
       when not c.is_mature then 'RECENT_SIGNING'
       end as ratio_suppression_reason,
  case when c.acquisition_cost_completeness = 'COMPLETE' and c.known_acquisition_cost_usd > 0 and c.direct_dodgers_mlb_bwar is not null and c.is_mature
       then round(c.direct_dodgers_mlb_bwar / (c.known_acquisition_cost_usd / 1000000.0), 3) end as direct_dodgers_bwar_per_million,
  case when c.acquisition_cost_completeness = 'COMPLETE' and c.known_acquisition_cost_usd > 0 and c.direct_dodgers_mlb_bwar is not null and c.is_mature
        and c.package_attribution_state <> 'RETURN_WAR_UNKNOWN'
       then round((c.direct_dodgers_mlb_bwar + coalesce(c.individually_attributable_trade_return_bwar, 0)) / (c.known_acquisition_cost_usd / 1000000.0), 3) end as attributable_organizational_bwar_per_million
from calc c;

comment on view public.v_player_organizational_realization is
  'One row per Dodgers international signing. direct_dodgers_mlb_bwar sums bWAR over MLB team-seasons of the Dodgers franchise (never career WAR, never the debut organization); non_dodgers_mlb_bwar is value produced for other organizations and is never credited to Los Angeles. Zero is used only where MLB team history is loaded and reconciled or the outcome is audited as no MLB career; otherwise NULL. A trade return is individually attributable only when the player was the sole outgoing asset; a shared package is exposed at package level and its individual share is NULL. Cost-aware ratios exist only for COMPLETE acquisition cost. maturity uses the existing 5-year rule against analysis_as_of_date (the latest outcome-audit date), not CURRENT_DATE.';

-- Tracked / verified-set aggregates, SUM(value) / SUM(cost) over the same eligible rows. Never an organization-wide rate.
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
)
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
group by g.grain, g.grain_value, g.sort_key;

comment on view public.v_dodgers_international_value_portfolio is
  'Aggregate value per $1M by grain (all, signing year, era, market, pathway) using SUM(value) / SUM(cost) over the same eligible rows: mature, COMPLETE acquisition cost, outcome observed. The eligible counts and cost are explicit. These are tracked / verified-set analytics, not organization-wide hit rates (no signing period is rate-eligible), and they differ from the legacy average-of-ratios KPI by design.';

-- Unresolved value research. Counts are derived, never fixed.
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
  select 'TRADE_RETURN_TIMING_UNRESOLVED', 2, null::text, null::uuid, e.event_key,
    format('Incoming %s has a same-season Dodgers stint that cannot be ordered against the %s stint; the trade return is not counted until the acquisition boundary is sourced', e.incoming_asset_name, coalesce(e.counterparty_franchise_key, 'counterparty'))
  from public.v_trade_realization_edges e where e.incoming_war_status = 'TIMING_UNRESOLVED'
  union all
  select 'DOWNSTREAM_ASSET_CHAIN_INCOMPLETE', 3, r.player_slug, r.signing_id, null,
    'A return asset later left in a recorded transaction; descendants are not attributed'
  from r where r.downstream_asset_chain_incomplete
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
  'Unresolved value research, derived from the facts: missing team-season WAR, unmapped team codes, career-total reconciliation, shared-package attribution, downstream chains, incomplete acquisition cost for verified MLB outcomes, incomplete outcomes, and exits with no recorded transaction. Nothing is queued from unverified snippets.';

-- ===========================================================================
-- 6. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['bref_team_code_map', 'player_mlb_team_season_war', 'v_trade_realization_edges', 'v_player_organizational_realization',
    'v_dodgers_international_value_portfolio', 'v_value_research_queue'] loop
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
    raise exception '032: API roles hold privileges beyond SELECT: %', bad;
  end if;

  select jsonb_array_length(j -> 'rows') into expected from _m032;
  select count(*) into n from public.player_mlb_team_season_war w
  where w.record_status = 'ACTIVE' and exists (select 1 from _m032, jsonb_array_elements(j -> 'rows') r
    where r ->> 0 = w.bref_id and (r ->> 2)::int = w.season and r ->> 3 = w.bref_team_code and (r ->> 4)::int = w.stint_ordinal and r ->> 5 = w.component);
  if n <> expected then
    raise exception '032 postcondition: % of % reviewed team-season rows are present', n, expected;
  end if;
  -- every loaded row resolves to an organization (the seed was audited complete)
  select count(*) into n from public.player_mlb_team_season_war where organization_id is null and record_status = 'ACTIVE';
  if n <> 0 then
    raise exception '032 postcondition: % loaded row(s) have no organization', n;
  end if;
  -- the legacy stores now agree with the loaded facts for every loaded player (one-decimal tolerance)
  select count(*) into n from (
    select p.id, sum(w.war) as total, coalesce(m.value, oc.career_war) as legacy
    from public.players p join public.player_mlb_team_season_war w on w.player_id = p.id and w.record_status = 'ACTIVE'
    left join public.outcomes oc on oc.player_id = p.id
    left join lateral (select value from public.player_metric_observations x where x.player_id = p.id and x.metric_key = 'CAREER_BWAR'
                       order by observed_through_date desc limit 1) m on true
    group by p.id, m.value, oc.career_war) t
  where t.legacy is null or abs(t.total - t.legacy) > 0.1;
  if n <> 0 then
    raise exception '032 postcondition: % player(s) have a career total that does not reconcile', n;
  end if;
end $$;

commit;
