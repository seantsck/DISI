-- DISI v0.42
-- 057_benchmark_bwar_evidence.sql
-- Baseball-Reference team-season bWAR for eleven mature benchmark MLB reachers, read from archived copies of the accepted data files. Run after 056.
--
-- Built from database/research/057/ (source-capture.json, scope.json, war-evidence.json, evaluation.json, baseline.json, build.mjs).
-- Do not edit by hand: change the research and rebuild.
--
-- What this is. Evidence recovery, data and provenance only. It adds no table, view, function, grant or policy, changes no definition and moves
-- no threshold.
--   * The two Baseball-Reference bulk WAR data files DISI already cites (war_daily_bat.txt, war_daily_pitch.txt) answer HTTP 403 today, so they
--     are read as archived Internet Archive captures of the exact original URLs (batting 2026-09-11, pitching 2026-02-10), each pinned by the
--     archive digest and the SHA-256 of the decoded file. Two source rows, WAR_DATA_FILE / BASEBALL_REFERENCE: archived original-source material,
--     never a secondary WAR table. BWAR != FWAR.
--   * 54 team-season rows (the 032 / 035 shape: one row per player, season, team stint and component; no TOT row, so a traded player's season is
--     its stints, each once) for the eleven benchmark reachers whose 10-season horizon ends by 2025, the last season complete in both captures.
--     The four 2016-class reachers (horizon 2026) are not loaded: PARTIAL SEASON != COMPLETE TEAM-SEASON EVIDENCE. No identity is resolved; no
--     transaction-value player is loaded.
--   * outcomes.career_war for the eleven = the sum of their loaded rows (the 035 rule), set only where it is NULL.
--   * The 041 labels follow from the rows, unchanged: POSITIVE_BWAR_WITHIN_10_SEASONS 8 TRUE / 3 FALSE, BWAR_2_WITHIN_10_SEASONS 6 TRUE / 5 FALSE.
--     The benchmark positive-bWAR reference baseline becomes supported (75 / 7 / 68 -> 86 / 15 / 71). That is evidence meeting the unchanged
--     50 / 10 / 10 minimum; BASELINE SUPPORTED != MODEL SUPPORTED and BENCHMARK SUPPORT != DODGERS SUPPORT. No Dodgers row moves.
--   * The unchanged 041 out-of-time evaluation is stored for the two bWAR targets (no fitted model is supported); the reach evaluation is untouched.
-- It then runs the explicit snapshot refresh once, only when this run changed a row.
--
-- Rerunnable: every statement is idempotent; the refresh runs only when a row was added or changed.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m057 on commit drop as
select $m057${"baseline":{"benchmark_bwar_support":[{"labelled_n":75,"negative_n":68,"positive_n":7,"reference_population":"TOP_PROSPECT_SAMPLE","support_state":"BASELINE_NOT_SUPPORTED","target_key":"POSITIVE_BWAR_WITHIN_10_SEASONS"},{"labelled_n":75,"negative_n":72,"positive_n":3,"reference_population":"TOP_PROSPECT_SAMPLE","support_state":"BASELINE_NOT_SUPPORTED","target_key":"BWAR_2_WITHIN_10_SEASONS"}],"counts":{"benchmark_signings":178,"dodgers_signings":220,"players":398,"tables":79,"views":156},"reach_fingerprint":"86b58f473301e2425751d853abd88e94","unmoved_support":[{"labelled_n":11,"negative_n":10,"positive_n":1,"reference_population":"DODGERS_TRACKED_AND_OPENING_CLASS","support_state":"BASELINE_NOT_SUPPORTED","target_key":"BWAR_2_WITHIN_10_SEASONS"},{"labelled_n":11,"negative_n":11,"positive_n":0,"reference_population":"DODGERS_TRACKED_AND_OPENING_CLASS","support_state":"BASELINE_NOT_SUPPORTED","target_key":"DODGERS_MLB_VALUE_WITHIN_10_SEASONS"},{"labelled_n":11,"negative_n":10,"positive_n":1,"reference_population":"DODGERS_TRACKED_AND_OPENING_CLASS","support_state":"BASELINE_NOT_SUPPORTED","target_key":"POSITIVE_BWAR_WITHIN_10_SEASONS"},{"labelled_n":25,"negative_n":23,"positive_n":2,"reference_population":"DODGERS_TRACKED_AND_OPENING_CLASS","support_state":"BASELINE_NOT_SUPPORTED","target_key":"REACH_MLB_WITHIN_7_SEASONS"},{"labelled_n":166,"negative_n":132,"positive_n":34,"reference_population":"TOP_PROSPECT_SAMPLE","support_state":"BASELINE_SUPPORTED","target_key":"REACH_MLB_WITHIN_7_SEASONS"}],"war_active":1880},"deferred_bref_ids":["ariasga01","onajo01","garcilu04","moralfr02"],"deferred_slugs":["gabriel-arias","jorge-ona","luis-garcia-jr","francisco-morales"],"evaluation":[{"auc":null,"brier_score":0.140938,"brier_skill_vs_base_rate":0,"calibration_bins":[{"bin":"0-0.1","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.1-0.2","mean_predicted":0.149936,"n":88,"observed_rate":0.159091},{"bin":"0.2-0.3","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.3-0.5","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.5-1","mean_predicted":null,"n":0,"observed_rate":null}],"data_as_of_date":"2026-10-05","decision":"BASELINE_REFERENCE","decision_reason":"Naive reference: the training-fold positive rate. 14 positives in 88 labelled rows of two reference populations, pooled for this out-of-time comparison only. A population's own reference baseline is shown for a player only when that population's support minimums are met, and only for the Dodgers population.","evaluated_rows":88,"feature_list":[],"folds":4,"log_loss":0.46612,"model_key":"BASE_RATE","model_version":"outcome-probability-v1","positive_n":14,"target_key":"POSITIVE_BWAR_WITHIN_10_SEASONS","training_fingerprint":"102c01a35d380d36493465cef1070c07","training_populations":["DODGERS_TRACKED_AND_OPENING_CLASS","TOP_PROSPECT_SAMPLE"],"validation_method":"LEAVE_ONE_SIGNING_YEAR_OUT"},{"auc":0.357143,"brier_score":0.142906,"brier_skill_vs_base_rate":-0.013963,"calibration_bins":[{"bin":"0-0.1","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.1-0.2","mean_predicted":0.123077,"n":50,"observed_rate":0.24},{"bin":"0.2-0.3","mean_predicted":0.207106,"n":38,"observed_rate":0.052632},{"bin":"0.3-0.5","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.5-1","mean_predicted":null,"n":0,"observed_rate":null}],"data_as_of_date":"2026-10-05","decision":"MODEL_NOT_SUPPORTED","decision_reason":"NO_SKILL_OVER_BASELINE: out-of-time Brier skill -0.013963 is not above 0.","evaluated_rows":88,"feature_list":["population_class"],"folds":4,"log_loss":0.471954,"model_key":"POPULATION_STRATIFIED_RATE","model_version":"outcome-probability-v1","positive_n":14,"target_key":"POSITIVE_BWAR_WITHIN_10_SEASONS","training_fingerprint":"102c01a35d380d36493465cef1070c07","training_populations":["DODGERS_TRACKED_AND_OPENING_CLASS","TOP_PROSPECT_SAMPLE"],"validation_method":"LEAVE_ONE_SIGNING_YEAR_OUT"},{"auc":0.319981,"brier_score":0.153014,"brier_skill_vs_base_rate":-0.085678,"calibration_bins":[{"bin":"0-0.1","mean_predicted":0.072913,"n":33,"observed_rate":0.242424},{"bin":"0.1-0.2","mean_predicted":0.15456,"n":35,"observed_rate":0.114286},{"bin":"0.2-0.3","mean_predicted":0.263334,"n":11,"observed_rate":0},{"bin":"0.3-0.5","mean_predicted":0.340927,"n":9,"observed_rate":0.222222},{"bin":"0.5-1","mean_predicted":null,"n":0,"observed_rate":null}],"data_as_of_date":"2026-10-05","decision":"MODEL_NOT_SUPPORTED","decision_reason":"INSUFFICIENT_EVENTS: 14 positives for 6 feature(s); at least 60 are required (10 per feature). Out-of-time Brier skill against the base rate -0.085678.","evaluated_rows":88,"feature_list":["is_top_prospect_sample","is_top_expectation_band","age_in_signing_year_minus_17","is_pitcher","is_dominican_republic","is_venezuela"],"folds":4,"log_loss":0.525536,"model_key":"LOGISTIC_L2","model_version":"outcome-probability-v1","positive_n":14,"target_key":"POSITIVE_BWAR_WITHIN_10_SEASONS","training_fingerprint":"102c01a35d380d36493465cef1070c07","training_populations":["DODGERS_TRACKED_AND_OPENING_CLASS","TOP_PROSPECT_SAMPLE"],"validation_method":"LEAVE_ONE_SIGNING_YEAR_OUT"},{"auc":null,"brier_score":0.099031,"brier_skill_vs_base_rate":0,"calibration_bins":[{"bin":"0-0.1","mean_predicted":0.064241,"n":50,"observed_rate":0.18},{"bin":"0.1-0.2","mean_predicted":0.133624,"n":38,"observed_rate":0},{"bin":"0.2-0.3","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.3-0.5","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.5-1","mean_predicted":null,"n":0,"observed_rate":null}],"data_as_of_date":"2026-10-05","decision":"BASELINE_REFERENCE","decision_reason":"Naive reference: the training-fold positive rate. 9 positives in 88 labelled rows of two reference populations, pooled for this out-of-time comparison only. A population's own reference baseline is shown for a player only when that population's support minimums are met, and only for the Dodgers population.","evaluated_rows":88,"feature_list":[],"folds":4,"log_loss":0.372934,"model_key":"BASE_RATE","model_version":"outcome-probability-v1","positive_n":9,"target_key":"BWAR_2_WITHIN_10_SEASONS","training_fingerprint":"1aa73185a9dab3071d4530ee670dd088","training_populations":["DODGERS_TRACKED_AND_OPENING_CLASS","TOP_PROSPECT_SAMPLE"],"validation_method":"LEAVE_ONE_SIGNING_YEAR_OUT"},{"auc":0.276371,"brier_score":0.100137,"brier_skill_vs_base_rate":-0.011166,"calibration_bins":[{"bin":"0-0.1","mean_predicted":0.063761,"n":50,"observed_rate":0.18},{"bin":"0.1-0.2","mean_predicted":0.142116,"n":38,"observed_rate":0},{"bin":"0.2-0.3","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.3-0.5","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.5-1","mean_predicted":null,"n":0,"observed_rate":null}],"data_as_of_date":"2026-10-05","decision":"MODEL_NOT_SUPPORTED","decision_reason":"INSUFFICIENT_EVENTS: 9 positives for 1 feature(s); at least 10 are required (10 per feature). Out-of-time Brier skill against the base rate -0.011166.","evaluated_rows":88,"feature_list":["population_class"],"folds":4,"log_loss":0.377699,"model_key":"POPULATION_STRATIFIED_RATE","model_version":"outcome-probability-v1","positive_n":9,"target_key":"BWAR_2_WITHIN_10_SEASONS","training_fingerprint":"1aa73185a9dab3071d4530ee670dd088","training_populations":["DODGERS_TRACKED_AND_OPENING_CLASS","TOP_PROSPECT_SAMPLE"],"validation_method":"LEAVE_ONE_SIGNING_YEAR_OUT"},{"auc":0.170183,"brier_score":0.106562,"brier_skill_vs_base_rate":-0.076047,"calibration_bins":[{"bin":"0-0.1","mean_predicted":0.053316,"n":48,"observed_rate":0.1875},{"bin":"0.1-0.2","mean_predicted":0.141688,"n":36,"observed_rate":0},{"bin":"0.2-0.3","mean_predicted":0.224303,"n":4,"observed_rate":0},{"bin":"0.3-0.5","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.5-1","mean_predicted":null,"n":0,"observed_rate":null}],"data_as_of_date":"2026-10-05","decision":"MODEL_NOT_SUPPORTED","decision_reason":"INSUFFICIENT_EVENTS: 9 positives for 6 feature(s); at least 60 are required (10 per feature). Out-of-time Brier skill against the base rate -0.076047.","evaluated_rows":88,"feature_list":["is_top_prospect_sample","is_top_expectation_band","age_in_signing_year_minus_17","is_pitcher","is_dominican_republic","is_venezuela"],"folds":4,"log_loss":0.43262,"model_key":"LOGISTIC_L2","model_version":"outcome-probability-v1","positive_n":9,"target_key":"BWAR_2_WITHIN_10_SEASONS","training_fingerprint":"1aa73185a9dab3071d4530ee670dd088","training_populations":["DODGERS_TRACKED_AND_OPENING_CLASS","TOP_PROSPECT_SAMPLE"],"validation_method":"LEAVE_ONE_SIGNING_YEAR_OUT"}],"expected_benchmark_bwar_support":[{"labelled_n":86,"negative_n":71,"positive_n":15,"reference_population":"TOP_PROSPECT_SAMPLE","support_state":"BASELINE_SUPPORTED","target_key":"POSITIVE_BWAR_WITHIN_10_SEASONS"},{"labelled_n":86,"negative_n":77,"positive_n":9,"reference_population":"TOP_PROSPECT_SAMPLE","support_state":"BASELINE_NOT_SUPPORTED","target_key":"BWAR_2_WITHIN_10_SEASONS"}],"identity_slugs":["yeyson-yrizarry","yeremy-rosario","jonathan-amundaray"],"observed_through_season":2025,"players":[{"bref_id":"dejesen01","bwar_2_label":false,"career_bwar":"-0.18","horizon_end_season":2023,"mlb_id":"646241","population_key":"MLB-2013-PIPELINE-TOP30","positive_bwar_label":false,"rank":24,"rows":2,"signing_year":2013,"slug":"emmanuel-dejesus","window_bwar":"-0.18"},{"bref_id":"guerrvl02","bwar_2_label":true,"career_bwar":"25.73","horizon_end_season":2025,"mlb_id":"665489","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":true,"rank":2,"rows":7,"signing_year":2015,"slug":"vladimir-guerrero-jr","window_bwar":"25.73"},{"bref_id":"celesgi01","bwar_2_label":false,"career_bwar":"0.24","horizon_end_season":2025,"mlb_id":"665482","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":true,"rank":8,"rows":2,"signing_year":2015,"slug":"gilberto-celestino","window_bwar":"0.24"},{"bref_id":"pachecr01","bwar_2_label":false,"career_bwar":"-1.30","horizon_end_season":2025,"mlb_id":"665506","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":false,"rank":10,"rows":7,"signing_year":2015,"slug":"cristian-pache","window_bwar":"-1.30"},{"bref_id":"gimenan01","bwar_2_label":true,"career_bwar":"19.37","horizon_end_season":2025,"mlb_id":"665926","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":true,"rank":12,"rows":6,"signing_year":2015,"slug":"andres-gimenez","window_bwar":"19.37"},{"bref_id":"taverle01","bwar_2_label":true,"career_bwar":"4.70","horizon_end_season":2025,"mlb_id":"665750","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":true,"rank":15,"rows":7,"signing_year":2015,"slug":"leody-taveras","window_bwar":"4.70"},{"bref_id":"sotoju01","bwar_2_label":true,"career_bwar":"42.57","horizon_end_season":2025,"mlb_id":"665742","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":true,"rank":19,"rows":9,"signing_year":2015,"slug":"juan-soto","window_bwar":"42.57"},{"bref_id":"amayami01","bwar_2_label":true,"career_bwar":"3.35","horizon_end_season":2025,"mlb_id":"665804","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":true,"rank":23,"rows":3,"signing_year":2015,"slug":"miguel-amaya","window_bwar":"3.35"},{"bref_id":"muzzisi01","bwar_2_label":false,"career_bwar":"-0.05","horizon_end_season":2025,"mlb_id":"665922","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":false,"rank":24,"rows":1,"signing_year":2015,"slug":"simon-muzziotti","window_bwar":"-0.05"},{"bref_id":"tatisfe02","bwar_2_label":true,"career_bwar":"27.34","horizon_end_season":2025,"mlb_id":"665487","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":true,"rank":25,"rows":6,"signing_year":2015,"slug":"fernando-tatis-jr","window_bwar":"27.34"},{"bref_id":"marchra01","bwar_2_label":false,"career_bwar":"1.41","horizon_end_season":2025,"mlb_id":"665561","population_key":"MLB-2015-PIPELINE-TOP30","positive_bwar_label":true,"rank":28,"rows":4,"signing_year":2015,"slug":"rafael-marchan","window_bwar":"1.41"}],"sources":[{"component":"BAT","decoded_sha256":"ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023","notes":"Baseball-Reference WAR data file (batting), https://www.baseball-reference.com/data/war_daily_bat.txt, read directly from an archived Internet Archive capture of that URL (captured 2026-09-11T21:45:53Z; original Last-Modified 2026-09-11T04:57:41Z; Internet Archive digest CEBQTPXSHPR6RO2WZMQ7FK2LRRV575GV; archived payload SHA-256 c0deabc49c28370e3b26a4a3339eb8333436ee0d65f952372208cc165c2f3df8; decoded file SHA-256 ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023, 126529 rows). The live file answers HTTP 403. Archived original-source material, not a secondary WAR table. Team-season rows are read through the 2025 season only; the capture's 2026 rows are mid-season and are not loaded. Career bWAR = sum of batting and pitching WAR rows for the player's mlb_ID.","observed_through_date":"2026-09-11","publication_date":"2026-09-11","retrieved_at":"2026-10-28T03:21:59Z","source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"WAR_DATA_FILE","title":"Baseball-Reference WAR data: batting (war_daily_bat.txt), archived capture 2026-09-11","url":"https://web.archive.org/web/20260911214553id_/https://www.baseball-reference.com/data/war_daily_bat.txt"},{"component":"PITCH","decoded_sha256":"3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825","notes":"Baseball-Reference WAR data file (pitching), https://www.baseball-reference.com/data/war_daily_pitch.txt, read directly from an archived Internet Archive capture of that URL (captured 2026-02-10T22:21:01Z; original Last-Modified 2025-11-04T14:33:16Z; Internet Archive digest HW43HICGDZB6V2QAOFETX36ZQOQBY6UW; archived payload SHA-256 f70322277fe7e007b8fa70854cb8426536a3f4457893ea4b1ac35a3746e16b05; decoded file SHA-256 3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825, 56860 rows). The live file answers HTTP 403. Archived original-source material, not a secondary WAR table. Team-season rows are read through the 2025 season only. Career bWAR = sum of batting and pitching WAR rows for the player's mlb_ID.","observed_through_date":"2025-11-04","publication_date":"2025-11-04","retrieved_at":"2026-10-28T03:22:08Z","source_name":"Baseball-Reference","source_tier":"BASEBALL_REFERENCE","source_type":"WAR_DATA_FILE","title":"Baseball-Reference WAR data: pitching (war_daily_pitch.txt), archived capture 2026-02-10","url":"https://web.archive.org/web/20260210222101id_/https://www.baseball-reference.com/data/war_daily_pitch.txt"}],"war":{"row_format":["bref_id","mlb_id","season","team","stint","component","league","war","games","pa","ip_outs"],"rows":[["amayami01","665804",2023,"CHC",1,"BAT","NL","0.33",53,156,null],["amayami01","665804",2024,"CHC",1,"BAT","NL","1.95",117,363,null],["amayami01","665804",2025,"CHC",1,"BAT","NL","1.07",28,103,null],["celesgi01","665482",2021,"MIN",1,"BAT","AL","-0.29",23,62,null],["celesgi01","665482",2022,"MIN",1,"BAT","AL","0.53",122,347,null],["dejesen01","646241",2023,"MIA",1,"BAT","NL",null,0,0,null],["dejesen01","646241",2023,"MIA",1,"PITCH","NL","-0.18",2,null,19],["gimenan01","665926",2020,"NYM",1,"BAT","NL","1.01",49,132,null],["gimenan01","665926",2021,"CLE",1,"BAT","AL","0.88",68,210,null],["gimenan01","665926",2022,"CLE",1,"BAT","AL","7.40",146,557,null],["gimenan01","665926",2023,"CLE",1,"BAT","AL","5.02",153,616,null],["gimenan01","665926",2024,"CLE",1,"BAT","AL","3.99",152,633,null],["gimenan01","665926",2025,"TOR",1,"BAT","AL","1.07",101,369,null],["guerrvl02","665489",2019,"TOR",1,"BAT","AL","2.15",123,514,null],["guerrvl02","665489",2020,"TOR",1,"BAT","AL","0.67",60,243,null],["guerrvl02","665489",2021,"TOR",1,"BAT","AL","6.51",161,698,null],["guerrvl02","665489",2022,"TOR",1,"BAT","AL","4.02",160,706,null],["guerrvl02","665489",2023,"TOR",1,"BAT","AL","1.79",156,682,null],["guerrvl02","665489",2024,"TOR",1,"BAT","AL","6.02",159,697,null],["guerrvl02","665489",2025,"TOR",1,"BAT","AL","4.57",156,680,null],["marchra01","665561",2020,"PHI",1,"BAT","NL","0.24",3,9,null],["marchra01","665561",2021,"PHI",1,"BAT","NL","0.24",20,56,null],["marchra01","665561",2024,"PHI",1,"BAT","NL","0.73",17,56,null],["marchra01","665561",2025,"PHI",1,"BAT","NL","0.20",42,118,null],["muzzisi01","665922",2022,"PHI",1,"BAT","NL","-0.05",9,9,null],["pachecr01","665506",2020,"ATL",1,"BAT","NL","-0.13",2,4,null],["pachecr01","665506",2021,"ATL",1,"BAT","NL","-0.67",22,68,null],["pachecr01","665506",2022,"OAK",1,"BAT","AL","-0.96",91,260,null],["pachecr01","665506",2023,"PHI",1,"BAT","NL","0.67",48,95,null],["pachecr01","665506",2024,"PHI",1,"BAT","NL","0.06",50,118,null],["pachecr01","665506",2024,"BAL",2,"BAT","AL","0.05",3,1,null],["pachecr01","665506",2024,"MIA",3,"BAT","NL","-0.32",35,64,null],["sotoju01","665742",2018,"WSN",1,"BAT","NL","3.00",116,494,null],["sotoju01","665742",2019,"WSN",1,"BAT","NL","5.10",150,659,null],["sotoju01","665742",2020,"WSN",1,"BAT","NL","2.25",47,196,null],["sotoju01","665742",2021,"WSN",1,"BAT","NL","7.33",151,654,null],["sotoju01","665742",2022,"WSN",1,"BAT","NL","3.73",101,436,null],["sotoju01","665742",2022,"SDP",2,"BAT","NL","1.74",52,228,null],["sotoju01","665742",2023,"SDP",1,"BAT","NL","5.29",162,708,null],["sotoju01","665742",2024,"NYY",1,"BAT","AL","8.00",157,713,null],["sotoju01","665742",2025,"NYM",1,"BAT","NL","6.13",160,715,null],["tatisfe02","665487",2019,"SDP",1,"BAT","NL","3.95",84,372,null],["tatisfe02","665487",2020,"SDP",1,"BAT","NL","2.84",59,257,null],["tatisfe02","665487",2021,"SDP",1,"BAT","NL","6.61",130,546,null],["tatisfe02","665487",2023,"SDP",1,"BAT","NL","5.23",141,635,null],["tatisfe02","665487",2024,"SDP",1,"BAT","NL","2.65",102,438,null],["tatisfe02","665487",2025,"SDP",1,"BAT","NL","6.06",155,691,null],["taverle01","665750",2020,"TEX",1,"BAT","AL","1.31",33,134,null],["taverle01","665750",2021,"TEX",1,"BAT","AL","-0.19",49,185,null],["taverle01","665750",2022,"TEX",1,"BAT","AL","0.49",99,341,null],["taverle01","665750",2023,"TEX",1,"BAT","AL","2.94",143,554,null],["taverle01","665750",2024,"TEX",1,"BAT","AL","0.73",151,529,null],["taverle01","665750",2025,"TEX",1,"BAT","AL","0.05",30,82,null],["taverle01","665750",2025,"SEA",2,"BAT","AL","-0.63",28,98,null]]}}$m057$::jsonb as j;

create temporary table _m057_players on commit drop as
select x ->> 'slug' as slug, (x ->> 'mlb_id')::bigint as mlb_id, x ->> 'bref_id' as bref_id, x from _m057, jsonb_array_elements(j -> 'players') x;

create temporary table _m057_rows on commit drop as
select r ->> 0 as bref_id, r ->> 1 as mlb_id, (r ->> 2)::int as season, r ->> 3 as team, (r ->> 4)::int as stint, r ->> 5 as component, nullif(r ->> 6, '') as league,
  (r ->> 7)::numeric as war, (r ->> 8)::int as games, (r ->> 9)::int as pa, (r ->> 10)::int as ip_outs
from _m057, jsonb_array_elements(j #> '{war,rows}') r;

create temporary table _m057_urls on commit drop as
select x ->> 'url' as url, x ->> 'component' as component, x ->> 'decoded_sha256' as decoded_sha256, (x ->> 'observed_through_date')::date as observed_through_date,
  (x ->> 'retrieved_at')::timestamptz as retrieved_at
from _m057, jsonb_array_elements(j -> 'sources') x;

-- support rows as (target, population, labelled, positive, negative, state), compared row by row (never through a collation-dependent hash)
create temporary table _m057_support on commit drop as
select k as kind, x ->> 'target_key' as target_key, x ->> 'reference_population' as reference_population, (x ->> 'labelled_n')::int as labelled_n,
  (x ->> 'positive_n')::int as positive_n, (x ->> 'negative_n')::int as negative_n, x ->> 'support_state' as support_state
from _m057, lateral (values ('UNMOVED', j #> '{baseline,unmoved_support}'), ('BENCHMARK_BWAR_BEFORE', j #> '{baseline,benchmark_bwar_support}'),
  ('BENCHMARK_BWAR_AFTER', j -> 'expected_benchmark_bwar_support')) v(k, a), jsonb_array_elements(v.a) x;

create temporary table _m057_before on commit drop as
select
  (select md5(string_agg(t, '|' order by t)) from (select w::text as t from public.player_mlb_team_season_war w
     where w.source_id not in (select so.id from public.sources so join _m057_urls u on u.url = so.url)) x) as existing_war_hash,
  (select md5(string_agg(t, '|' order by t)) from (select o::text as t from public.outcomes o
     where o.player_id not in (select pl.id from public.players pl join _m057_players p on p.slug = pl.slug)) x) as other_outcomes_hash,
  (select md5(string_agg(t, '|' order by t)) from (select m::text as t from public.outcome_model_evaluations m where m.target_key = 'REACH_MLB_WITHIN_7_SEASONS') x) as reach_evaluation_hash,
  (select md5(string_agg(t, '|' order by t)) from (select t::text as t from public.outcome_targets t) x) as targets_hash,
  (select md5(string_agg(t, '|' order by t)) from (
     select p::text as t from public.players p union all select s::text from public.signings s union all select a::text from public.outcome_audits a
     union all select e::text from public.outcome_evidence e union all select e::text from public.player_evaluations e union all select r::text from public.player_evaluation_rankings r
     union all select sp::text from public.signing_populations sp union all select pm::text from public.signing_population_members pm
     union all select c::text from public.signing_census_coverage c union all select m::text from public.bref_team_code_map m
     union all select r::text from public.signing_financial_reports r union all select r::text from public.signing_financial_resolutions r
     union all select e::text from public.transaction_events e union all select a::text from public.transaction_event_assets a
     union all select r::text from public.transaction_asset_resolutions r union all select c::text from public.player_career_transactions c
     union all select s::text from public.player_season_stints s union all select m::text from public.development_milestones m
     union all select d::text from public.development_progression_decisions d union all select m::text from public.player_metric_observations m) z) as untouched_hash,
  (select md5(string_agg(t, '|' order by t)) from (select concat_ws('|', target_key, reference_population, labelled_n, positive_n, negative_n, support_state) as t
     from public.v_outcome_target_support where reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS' or target_key = 'REACH_MLB_WITHIN_7_SEASONS') x) as unmoved_support_hash,
  (select max(generation_id) from public.product_executive_snapshot) as generation,
  (select md5(string_agg(t, '|' order by t)) from (
     select w::text as t from public.player_mlb_team_season_war w union all select o::text from public.outcomes o
     union all select m::text from public.outcome_model_evaluations m union all select s::text from public.sources s) z) as content_hash
from _m057;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 057 was written for
-- ===========================================================================

do $$
declare
  pp record;
  n int;
  rerun boolean;
begin
  if (select count(*) from public.signing_populations where population_key in ('MLB-2013-PIPELINE-TOP30', 'MLB-2014-PIPELINE-TOP30', 'MLB-2015-PIPELINE-TOP30',
        'MLB-2016-PIPELINE-TOP30', 'MLB-2017-PIPELINE-TOP30', 'MLB-2018-PIPELINE-TOP30', 'MLB-2019-PIPELINE-TOP30')) <> 7
     or to_regclass('public.player_mlb_team_season_war') is null or to_regclass('public.v_outcome_target_support') is null then
    raise exception '057: Migrations through 056 have not been applied';
  end if;
  -- the two sources are the approved archived captures: the decoded files these rows were read from, by SHA-256
  if (select count(*) from _m057, jsonb_array_elements(j -> 'sources') x
      where (x ->> 'component' = 'BAT' and x ->> 'decoded_sha256' = 'ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023'
               and x ->> 'url' = 'https://web.archive.org/web/20260911214553id_/https://www.baseball-reference.com/data/war_daily_bat.txt')
         or (x ->> 'component' = 'PITCH' and x ->> 'decoded_sha256' = '3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825'
               and x ->> 'url' = 'https://web.archive.org/web/20260210222101id_/https://www.baseball-reference.com/data/war_daily_pitch.txt')) <> 2
     or (select count(*) from _m057, jsonb_array_elements(j -> 'sources') x) <> 2 then
    raise exception '057: the sources are not the two approved archived Baseball-Reference captures';
  end if;
  if exists (select 1 from public.sources so join _m057_urls u on u.url = so.url
             where position(u.decoded_sha256 in coalesce(so.notes, '')) = 0 or so.source_type <> 'WAR_DATA_FILE' or so.source_tier <> 'BASEBALL_REFERENCE') then
    raise exception '057: a recorded source row names a different file than the approved capture';
  end if;
  -- every row is a complete season (never after the observed-through season), BAT or PITCH, a team stint that the team-code map resolves
  if exists (select 1 from _m057_rows r where r.season > (select (j ->> 'observed_through_season')::int from _m057) or r.component not in ('BAT', 'PITCH') or r.team = 'TOT')
     or (select (j ->> 'observed_through_season')::int from _m057) <> 2025 then
    raise exception '057: a row is not a complete 2025-or-earlier team-season stint';
  end if;
  if exists (select 1 from _m057_rows r where not exists (select 1 from public.bref_team_code_map m
             where m.bref_team_code = r.team and r.season >= m.from_season and r.season <= coalesce(m.to_season, 9999))) then
    raise exception '057: a team code has no team-code mapping for its season';
  end if;
  if exists (select 1 from _m057_rows r where r.bref_id not in (select bref_id from _m057_players))
     or exists (select 1 from _m057_rows r join _m057_players p on p.bref_id = r.bref_id where r.mlb_id::bigint <> p.mlb_id) then
    raise exception '057: a row belongs to a player outside the approved scope or carries another MLB id';
  end if;
  -- never a deferred incomplete-window reacher, an unresolved identity or a transaction-value player
  if exists (select 1 from _m057_players p where p.slug in (select jsonb_array_elements_text(j -> 'deferred_slugs') from _m057)
                                               or p.slug in (select jsonb_array_elements_text(j -> 'identity_slugs') from _m057))
     or exists (select 1 from _m057_rows r where r.bref_id in (select jsonb_array_elements_text(j -> 'deferred_bref_ids') from _m057)
                                             or r.bref_id in ('garlajo01', 'grantmu01', 'versazo01', 'leyriji01'))
     or (select count(*) from _m057_players) <> 11 then
    raise exception '057: the scope is not exactly the eleven approved complete-window players';
  end if;
  rerun := exists (select 1 from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m057_urls u on u.url = so.url
                   where w.record_status = 'ACTIVE');
  -- each approved player is the existing DISI record: one benchmark signing, the list rank, a verified MLB reach, an outcomes row
  for pp in select * from _m057_players loop
    select count(*) into n from public.players pl join public.signings s on s.player_id = pl.id
      join public.signing_population_members m on m.signing_id = s.id join public.signing_populations sp on sp.id = m.population_id
      join public.outcome_audits a on a.player_id = pl.id and a.reached_mlb_verified and a.outcome_state = 'REACHED_MLB'
      join public.outcomes oc on oc.player_id = pl.id
      where pl.slug = pp.slug and pl.mlb_id = pp.mlb_id and pl.bref_id = pp.bref_id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
        and s.signing_year = (pp.x ->> 'signing_year')::int and s.international_rank = (pp.x ->> 'rank')::numeric and sp.population_key = pp.x ->> 'population_key';
    if n <> 1 then
      raise exception '057: % is not one benchmark signing with this identity, list rank and verified MLB reach', pp.slug;
    end if;
    if (select count(*) from public.signings s join public.players pl on pl.id = s.player_id where pl.slug = pp.slug) <> 1
       or exists (select 1 from public.players pl where pl.slug <> pp.slug and (pl.mlb_id = pp.mlb_id or pl.bref_id = pp.bref_id)) then
      raise exception '057: % does not have exactly one signing and one identity', pp.slug;
    end if;
    -- an existing career bWAR is never silently overwritten
    if exists (select 1 from public.outcomes oc join public.players pl on pl.id = oc.player_id where pl.slug = pp.slug
               and oc.career_war is not null and oc.career_war <> (pp.x ->> 'career_bwar')::numeric) then
      raise exception '057: % already carries a different career bWAR; it is not overwritten', pp.slug;
    end if;
    -- no other active team-season evidence for the player (a rerun finds exactly the 057 rows)
    if exists (select 1 from public.player_mlb_team_season_war w join public.players pl on pl.slug = pp.slug
               where (w.player_id = pl.id or w.bref_id = pp.bref_id) and w.record_status = 'ACTIVE'
                 and w.source_id not in (select so.id from public.sources so join _m057_urls u on u.url = so.url)) then
      raise exception '057: % already has active team-season bWAR from another source; the research no longer applies', pp.slug;
    end if;
  end loop;
  -- the deferred reachers and the unresolved identities are as reviewed, with no active team-season evidence
  if (select count(*) from public.players pl join public.outcome_audits a on a.player_id = pl.id and a.reached_mlb_verified
      where pl.slug in (select jsonb_array_elements_text(j -> 'deferred_slugs') from _m057)
        and not exists (select 1 from public.player_mlb_team_season_war w where (w.player_id = pl.id or w.bref_id = pl.bref_id) and w.record_status = 'ACTIVE')) <> 4
     or (select count(*) from public.players pl where pl.slug in (select jsonb_array_elements_text(j -> 'identity_slugs') from _m057)
         and pl.mlb_id is null and pl.bref_id is null and not exists (select 1 from public.outcome_audits a where a.player_id = pl.id)) <> 3 then
    raise exception '057: the deferred reachers or the unresolved identities are not in the reviewed state';
  end if;
  -- thresholds, the Dodgers population and the reach target are as the research measured them
  if exists (select 1 from public.outcome_targets where min_reference_n <> 50 or min_positives <> 10 or min_negatives <> 10 or events_per_feature <> 10)
     or (select count(*) from public.outcome_targets) <> 4 then
    raise exception '057: the outcome-target thresholds are not the 041 ones';
  end if;
  if exists (select target_key, reference_population, labelled_n, positive_n, negative_n, support_state from public.v_outcome_target_support
        where reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS' or target_key = 'REACH_MLB_WITHIN_7_SEASONS' except select target_key, reference_population, labelled_n, positive_n, negative_n, support_state from _m057_support where kind = 'UNMOVED')
     or (select count(*) from _m057_support where kind = 'UNMOVED') <> 5
     or (select count(*) from public.v_outcome_target_support where reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS' or target_key = 'REACH_MLB_WITHIN_7_SEASONS') <> 5 then
    raise exception '057: the Dodgers or reach-target support is not in the state the research was written for';
  end if;
  if (select count(*) from public.outcome_model_evaluations where target_key = 'REACH_MLB_WITHIN_7_SEASONS'
      and training_fingerprint = (select j #>> '{baseline,reach_fingerprint}' from _m057)) <> 3
     or exists (select 1 from public.v_outcome_model_evaluation where target_key = 'REACH_MLB_WITHIN_7_SEASONS' and not evaluation_current) then
    raise exception '057: the stored reach evaluation is not the current 056 one';
  end if;
  if exists (select 1 from public.outcome_model_evaluations where target_key not in ('REACH_MLB_WITHIN_7_SEASONS', 'POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS'))
     or exists (select 1 from public.outcome_model_evaluations m where m.target_key in ('POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS')
                and (not rerun or jsonb_typeof((select j -> 'evaluation' from _m057)) <> 'array'
                     or m.training_fingerprint not in (select x ->> 'training_fingerprint' from _m057, jsonb_array_elements(j -> 'evaluation') x where x ->> 'target_key' = m.target_key))) then
    raise exception '057: a bWAR model evaluation already exists that 057 did not write';
  end if;
  if (select count(*) from public.players p
      where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
        and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')) <> 0 then
    raise exception '057: a player holds both a Dodgers signing and a benchmark signing';
  end if;
  if not rerun then
    if (select count(*) from public.players) <> (select (j #>> '{baseline,counts,players}')::int from _m057)
       or (select count(*) from public.signings where record_scope = 'MLB_PIPELINE_TOP_PROSPECT') <> (select (j #>> '{baseline,counts,benchmark_signings}')::int from _m057)
       or (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') <> (select (j #>> '{baseline,counts,dodgers_signings}')::int from _m057)
       or (select count(*) from public.player_mlb_team_season_war where record_status = 'ACTIVE') <> (select (j #>> '{baseline,war_active}')::int from _m057) then
      raise exception '057: players, benchmark signings, Dodgers signings or active team-season rows are not in the state the research was written for';
    end if;
    if exists ((select target_key, reference_population, labelled_n, positive_n, negative_n, support_state from public.v_outcome_target_support
        where reference_population = 'TOP_PROSPECT_SAMPLE' and target_key in ('POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS')) except select target_key, reference_population, labelled_n, positive_n, negative_n, support_state from _m057_support where kind = 'BENCHMARK_BWAR_BEFORE')
       or (select count(*) from _m057_support where kind = 'BENCHMARK_BWAR_BEFORE') <> 2 then
      raise exception '057: the benchmark bWAR support is not in the state the research was written for';
    end if;
  end if;
end $$;

-- ===========================================================================
-- 2. SOURCES: the two archived captures of the accepted Baseball-Reference files
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, publication_date, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (x ->> 'publication_date')::date, (x ->> 'retrieved_at')::timestamptz
from _m057, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 3. TEAM-SEASON bWAR (the 032 / 035 row: player, season, team stint, component; NULL WAR stays NULL)
-- ===========================================================================

insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
  plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
select r.bref_id, r.mlb_id, pl.id, r.season, r.team, m.organization_id, r.stint, r.component, r.war, r.games, r.pa, r.ip_outs, r.league, so.id,
       u.observed_through_date, (select (j ->> 'observed_through_season')::int from _m057), u.retrieved_at, 'VERIFIED',
       case when r.war is null then 'The data file has no WAR for this zero-plate-appearance row; stored as NULL, not zero.' end
from _m057_rows r
join _m057_urls u on u.component = r.component
join public.sources so on so.url = u.url
join public.players pl on pl.bref_id = r.bref_id
left join lateral (
  select m2.organization_id from public.bref_team_code_map m2
  where m2.bref_team_code = r.team and r.season >= m2.from_season and r.season <= coalesce(m2.to_season, 9999)
  order by m2.from_season desc limit 1
) m on true
on conflict (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE' do nothing;

-- ===========================================================================
-- 4. CAREER bWAR (the 035 rule: the sum of the loaded rows, to the hundredth; set only where it is NULL)
-- ===========================================================================

update public.outcomes oc set career_war = (p.x ->> 'career_bwar')::numeric
from _m057_players p join public.players pl on pl.slug = p.slug
where oc.player_id = pl.id and oc.career_war is null;

-- ===========================================================================
-- 5. THE 041 EVALUATION FOR THE TWO bWAR TARGETS (unchanged method; BASELINE SUPPORTED != MODEL SUPPORTED)
-- ===========================================================================

insert into public.outcome_model_evaluations (target_key, model_key, model_version, validation_method, feature_list, training_populations, evaluated_rows,
  positive_n, folds, brier_score, log_loss, auc, brier_skill_vs_base_rate, calibration_bins, decision, decision_reason, training_fingerprint, data_as_of_date)
select x ->> 'target_key', x ->> 'model_key', x ->> 'model_version', x ->> 'validation_method', array(select jsonb_array_elements_text(x -> 'feature_list')),
  array(select jsonb_array_elements_text(x -> 'training_populations')), (x ->> 'evaluated_rows')::int, (x ->> 'positive_n')::int, (x ->> 'folds')::int,
  (x ->> 'brier_score')::numeric, (x ->> 'log_loss')::numeric, (x ->> 'auc')::numeric, (x ->> 'brier_skill_vs_base_rate')::numeric, x -> 'calibration_bins',
  x ->> 'decision', x ->> 'decision_reason', x ->> 'training_fingerprint', (x ->> 'data_as_of_date')::date
from _m057, jsonb_array_elements(case when jsonb_typeof(j -> 'evaluation') = 'array' then j -> 'evaluation' else '[]'::jsonb end) x
where x ->> 'target_key' in ('POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS')
on conflict (target_key, model_key) do nothing;

-- ===========================================================================
-- 6. POSTCONDITIONS: what was added is exactly what was reviewed, and nothing else moved
-- ===========================================================================

do $$
declare
  b record;
  n int;
begin
  select * into b from _m057_before;
  -- every reviewed row is present once, active, exactly as read, with the mapped organization and the capture's provenance
  select count(*) into n from _m057_rows r
    where (select count(*) from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m057_urls u on u.url = so.url and u.component = r.component
           join public.players pl on pl.id = w.player_id and pl.bref_id = r.bref_id
           where w.bref_id = r.bref_id and w.mlb_id = r.mlb_id and w.season = r.season and w.bref_team_code = r.team and w.stint_ordinal = r.stint and w.component = r.component
             and w.war is not distinct from r.war and w.games is not distinct from r.games and w.plate_appearances is not distinct from r.pa
             and w.ip_outs is not distinct from r.ip_outs and w.league is not distinct from r.league and w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
             and w.organization_id is not null and w.observed_through_season = 2025 and w.confidence = 'VERIFIED') <> 1;
  if n > 0 then
    raise exception '057 postcondition: % team-season rows are not recorded exactly as read', n;
  end if;
  select count(*) into n from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m057_urls u on u.url = so.url where w.record_status = 'ACTIVE';
  if n <> (select count(*) from _m057_rows) or n <> 54 then
    raise exception '057 postcondition: % active rows cite the 057 sources; 54 were reviewed', n;
  end if;
  if exists (select 1 from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m057_urls u on u.url = so.url
             where w.season > 2025 or w.bref_id not in (select bref_id from _m057_players))
     or (select count(distinct w.bref_id) from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m057_urls u on u.url = so.url
         where w.record_status = 'ACTIVE') <> 11 then
    raise exception '057 postcondition: a 057 row is a partial season or belongs to a player outside the eleven';
  end if;
  -- one active row per player, season, team, stint and component: no double counting (the files carry no TOT row)
  if exists (select 1 from public.player_mlb_team_season_war w where w.record_status = 'ACTIVE' and (w.bref_team_code = 'TOT'
             or w.bref_id in (select bref_id from _m057_players)) group by w.bref_id, w.season, w.bref_team_code, w.stint_ordinal, w.component having count(*) > 1)
     or exists (select 1 from public.player_mlb_team_season_war where bref_team_code = 'TOT') then
    raise exception '057 postcondition: a team-season fact is counted twice';
  end if;
  if b.existing_war_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select w::text as t from public.player_mlb_team_season_war w
       where w.source_id not in (select so.id from public.sources so join _m057_urls u on u.url = so.url)) x) then
    raise exception '057 postcondition: a team-season row that existed before 057 changed';
  end if;
  -- career bWAR = the sum of the loaded rows (the 035 rule) for exactly the eleven; no other outcome moved
  select count(*) into n from _m057_players p join public.players pl on pl.slug = p.slug join public.outcomes oc on oc.player_id = pl.id
    where oc.career_war is distinct from (p.x ->> 'career_bwar')::numeric
       or oc.career_war is distinct from (select round(sum(w.war), 2) from public.player_mlb_team_season_war w where w.player_id = pl.id and w.record_status = 'ACTIVE');
  if n > 0 then
    raise exception '057 postcondition: % career bWAR values do not equal the sum of the loaded rows', n;
  end if;
  if b.other_outcomes_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select o::text as t from public.outcomes o
       where o.player_id not in (select pl.id from public.players pl join _m057_players p on p.slug = pl.slug)) x) then
    raise exception '057 postcondition: an outcome outside the eleven changed';
  end if;
  -- the 041 labels follow from the rows: each of the eleven exactly as derived; the four deferred reachers and the three identities stay NULL
  select count(*) into n from _m057_players p join public.v_outcome_training_population t on t.player_slug = p.slug
    where (t.target_key = 'POSITIVE_BWAR_WITHIN_10_SEASONS' and (t.label is distinct from (p.x ->> 'positive_bwar_label')::boolean or t.window_bwar is distinct from (p.x ->> 'window_bwar')::numeric))
       or (t.target_key = 'BWAR_2_WITHIN_10_SEASONS' and t.label is distinct from (p.x ->> 'bwar_2_label')::boolean)
       or (t.target_key in ('POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS') and t.training_state <> 'BENCHMARK_SAMPLE_ONLY');
  if n > 0 then
    raise exception '057 postcondition: % bWAR labels of the eleven are not the ones the rows give', n;
  end if;
  if (select count(*) from public.v_outcome_training_population t where t.target_key in ('POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS')
      and t.player_slug in (select jsonb_array_elements_text(j -> 'deferred_slugs') from _m057 union all select jsonb_array_elements_text(j -> 'identity_slugs') from _m057)
      and t.label is null and t.training_state = 'OUTCOME_UNAUDITED') <> 14 then
    raise exception '057 postcondition: a deferred reacher or an unresolved identity gained a bWAR label';
  end if;
  if (select count(*) from _m057_players p join public.v_outcome_training_population t on t.player_slug = p.slug
      where t.target_key = 'POSITIVE_BWAR_WITHIN_10_SEASONS' and t.label) <> 8
     or (select count(*) from _m057_players p join public.v_outcome_training_population t on t.player_slug = p.slug
         where t.target_key = 'BWAR_2_WITHIN_10_SEASONS' and t.label) <> 6 then
    raise exception '057 postcondition: the label split is not 8 / 3 (positive bWAR) and 6 / 5 (2+ bWAR)';
  end if;
  -- support: the benchmark bWAR rows move exactly as reviewed; every Dodgers row and the reach target do not move; thresholds do not move
  if exists ((select target_key, reference_population, labelled_n, positive_n, negative_n, support_state from public.v_outcome_target_support
        where reference_population = 'TOP_PROSPECT_SAMPLE' and target_key in ('POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS')) except select target_key, reference_population, labelled_n, positive_n, negative_n, support_state from _m057_support where kind = 'BENCHMARK_BWAR_AFTER')
     or (select count(*) from _m057_support where kind = 'BENCHMARK_BWAR_AFTER') <> 2 then
    raise exception '057 postcondition: the benchmark bWAR support is not 86 / 15 / 71 supported and 86 / 9 / 77 not supported';
  end if;
  if (select support_state from public.v_outcome_target_support where target_key = 'BWAR_2_WITHIN_10_SEASONS' and reference_population = 'TOP_PROSPECT_SAMPLE') <> 'BASELINE_NOT_SUPPORTED' then
    raise exception '057 postcondition: 2+ bWAR became supported';
  end if;
  if b.unmoved_support_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select concat_ws('|', target_key, reference_population, labelled_n, positive_n, negative_n, support_state) as t
       from public.v_outcome_target_support where reference_population = 'DODGERS_TRACKED_AND_OPENING_CLASS' or target_key = 'REACH_MLB_WITHIN_7_SEASONS') x)
     or b.targets_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select t::text as t from public.outcome_targets t) x) then
    raise exception '057 postcondition: Dodgers support, the reach target or a threshold moved';
  end if;
  -- the reach evaluation is byte-identical; every stored evaluation is current; no fitted model is supported
  if b.reach_evaluation_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select m::text as t from public.outcome_model_evaluations m where m.target_key = 'REACH_MLB_WITHIN_7_SEASONS') x) then
    raise exception '057 postcondition: the reach evaluation changed';
  end if;
  if jsonb_typeof((select j -> 'evaluation' from _m057)) = 'array' then
    if (select count(*) from public.outcome_model_evaluations) <> 9
       or exists (select 1 from public.v_outcome_model_evaluation where not evaluation_current) then
      raise exception '057 postcondition: the stored evaluations are not the nine current rows (reach, positive bWAR, 2+ bWAR)';
    end if;
  end if;
  if exists (select 1 from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED') then
    raise exception '057 postcondition: a model is supported; its coefficients must be stored and reviewed before anything is built on it';
  end if;
  -- BENCHMARK SUPPORT != DODGERS SUPPORT: no probability, expected value or recommendation
  if (select count(*) from public.v_player_outcome_probability where probability is not null or prediction_eligible) <> 0
     or (select count(*) from public.v_expected_value_support where probability_supported or expected_value_supported) <> 0
     or (select supported_probability_targets from public.v_executive_overview) <> 0
     or (select predictive_portfolio_recommendations from public.v_executive_overview) <> 0
     or (select supported_fitted_models from public.v_executive_overview) <> 0 then
    raise exception '057 postcondition: a probability, expected value, recommendation or supported model appeared';
  end if;
  if (select count(*) from public.players p
      where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
        and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')) <> 0 then
    raise exception '057 postcondition: a player holds both a Dodgers signing and a benchmark signing';
  end if;
  -- nothing else moved: players, signings, audits, evidence, rankings, populations, coverage, team-code map, costs, transactions, development, metrics
  if b.untouched_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (
       select p::text as t from public.players p union all select s::text from public.signings s union all select a::text from public.outcome_audits a
       union all select e::text from public.outcome_evidence e union all select e::text from public.player_evaluations e union all select r::text from public.player_evaluation_rankings r
       union all select sp::text from public.signing_populations sp union all select pm::text from public.signing_population_members pm
       union all select c::text from public.signing_census_coverage c union all select m::text from public.bref_team_code_map m
       union all select r::text from public.signing_financial_reports r union all select r::text from public.signing_financial_resolutions r
       union all select e::text from public.transaction_events e union all select a::text from public.transaction_event_assets a
       union all select r::text from public.transaction_asset_resolutions r union all select c::text from public.player_career_transactions c
       union all select s::text from public.player_season_stints s union all select m::text from public.development_milestones m
       union all select d::text from public.development_progression_decisions d union all select m::text from public.player_metric_observations m) z) then
    raise exception '057 postcondition: a row outside the bWAR evidence changed';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' having count(*) <> (select (j #>> '{baseline,counts,tables}')::int from _m057))
     or exists (select 1 from information_schema.views where table_schema = 'public' having count(*) <> (select (j #>> '{baseline,counts,views}')::int from _m057)) then
    raise exception '057 postcondition: the catalog moved; 057 adds no table or view';
  end if;
end $$;

-- ===========================================================================
-- 7. GENERATION: one coherent refresh, only when this run changed a row
-- ===========================================================================

do $$
declare
  b record;
begin
  select * into b from _m057_before;
  if b.content_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (
       select w::text as t from public.player_mlb_team_season_war w union all select o::text from public.outcomes o
       union all select m::text from public.outcome_model_evaluations m union all select s::text from public.sources s) z) then
    perform * from public.disi_refresh_product_snapshots();
    if (select max(generation_id) from public.product_executive_snapshot) <> b.generation + 1
       or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
      raise exception '057 postcondition: the refresh did not produce exactly one new drift-free generation';
    end if;
  end if;
end $$;

commit;
