-- DISI v0.43
-- 058_transaction_return_bwar_evidence.sql
-- Baseball-Reference team-season bWAR for four returned players of existing Dodgers trades, read from the archived captures 057 registered. Run after 057.
--
-- Built from database/research/058/ (scope.json, war-evidence.json, baseline.json, build.mjs; the sources are 057's source-capture.json).
-- Do not edit by hand: change the research and rebuild.
--
-- What this is. Evidence recovery, data only. It adds no table, view, function, grant, policy, source, player or team-code mapping, changes no
-- definition and moves no attribution rule.
--   * 91 team-season rows (the 032 / 035 / 057 shape: one row per player, season, team stint and component; no TOT row) for Jon Garland (28),
--     Jim Leyritz (15), Mudcat Grant (36) and Zoilo Versalles (12): returned players of existing Dodgers trades whose value was unknown only because
--     their WAR was not loaded. They are transaction-return assets, not DISI signing players: no players row is created; the rows carry player_id
--     NULL and join the value views by the asset's bref_id, as 032-035 do. Each complete mapped career row set is loaded: the partner team's
--     acquisition-season stint is what places a Dodgers stint after the trade (the counterparty-stint rule, unchanged). The one row not loaded is
--     Versalles's 1969 WSA stint: an unmapped team code (no mapping is added) and a non-Dodgers season after his exit, outside his value window.
--   * The rows cite the two archived Baseball-Reference sources 057 registered (decoded SHA-256 ec088b3a... / 3d80dcd5...); no source row is added.
--   * The existing interval-bounded value rules decide every value: Garland +0.17 is Tony Abreu's single attributable return (Abreu becomes
--     realized, 1.23 + 0.17 = 1.40); Leyritz -0.61 is shared-package value of the Vizcaino-and-cash trade (never Vizcaino's own); Grant +1.39 and
--     Versalles -1.12 are observable, not attributable, value of the Chico Fernandez chain. KNOWN RETURN WAR != ATTRIBUTABLE SIGNING VALUE.
--     Garland's 2011 Dodgers stint is after his recorded exit and is credited to no trade (DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION).
--   * Nothing in the prediction layer reads these rows: outcomes, labels, support, evaluations and every output stay byte-identical.
-- It then runs the explicit snapshot refresh once, only when this run changed a row.
--
-- Source sharing. The rows cite the 057 sources, so after 058 has been applied once the frozen 057 is no longer independently rerunnable (its
-- postconditions count every row on those sources) and rollback-057 refuses (it treats rows of other players on its sources as later research).
-- Migration order is authoritative: 057 is idempotent at its own release boundary; 058 depends on it.
--
-- Rerunnable: every statement is idempotent; the refresh runs only when a row was added.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA
-- ===========================================================================

create temporary table _m058 on commit drop as
select $m058${"baseline":{"bwar_missing":50,"counts":{"benchmark_signings":178,"dodgers_signings":220,"players":398,"sources":3384,"tables":79,"views":156},"evaluation_fingerprints":"102c01a35d380d36493465cef1070c07,1aa73185a9dab3071d4530ee670dd088,86b58f473301e2425751d853abd88e94","executive":{"direct":"282.77","realized":"297.60","signings_with_resolved_value":87,"trade":"14.83"},"signings":[{"chain_status":"INCOMPLETE_WAR_NOT_LOADED","direct":"0.00","observable":"4.90","pkg_down":null,"pkg_first":"0.62","player_slug":"chico-fernandez","realized":"0.62","realized_value_state":"TO_DATE_CHAIN_INCOMPLETE","trade":"0.62"},{"chain_status":"INCOMPLETE_WAR_NOT_LOADED","direct":"0.19","observable":null,"pkg_down":null,"pkg_first":null,"player_slug":"jose-vizcaino","realized":"0.09","realized_value_state":"TO_DATE_CHAIN_INCOMPLETE","trade":"-0.10"},{"chain_status":"INCOMPLETE_WAR_NOT_LOADED","direct":"1.23","observable":null,"pkg_down":null,"pkg_first":null,"player_slug":"tony-abreu","realized":null,"realized_value_state":"VALUE_UNRESOLVED","trade":null}],"transaction_queue":[{"issue":"CASH_AMOUNT_UNKNOWN","items":17},{"issue":"DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION","items":5},{"issue":"DOWNSTREAM_WAR_NOT_LOADED","items":6},{"issue":"EXIT_NOT_RESEARCHED_DOWNSTREAM","items":5},{"issue":"EXIT_STATUS_UNVERIFIED","items":16},{"issue":"EXIT_TRANSACTION_MISSING","items":2},{"issue":"FUTURE_CONSIDERATIONS_UNRESOLVED","items":3},{"issue":"POOL_SPACE_AMOUNT_UNKNOWN","items":1},{"issue":"PTBNL_UNRESOLVED","items":2},{"issue":"RETURN_ASSET_EXIT_MISSING","items":1}],"value_queue":[{"issue":"ACQUISITION_COST_INCOMPLETE","items":28},{"issue":"DOWNSTREAM_ASSET_CHAIN_INCOMPLETE","items":8},{"issue":"LINEAGE_BOUNDARY_NOTED","items":22},{"issue":"OUTCOME_INCOMPLETE","items":8},{"issue":"TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED","items":27}],"value_totals":{"chain_incomplete":7,"observable":"141.44","pkg_down":"2.99","pkg_first":"96.39","realized":"297.60","realized_to_date":80,"resolved":87,"unresolved":1},"war_active":1934,"war_active_057":54},"excluded_rows":[{"bref_id":"versazo01","component":"BAT","reason":"OUTSIDE_DODGERS_VALUE_WINDOW_AND_UNMAPPED_TEAM","season":1969,"stint":2,"team":"WSA","war":"0.36"}],"expected":{"executive":{"direct":"284.00","realized":"299.00","signings_with_resolved_value":88,"trade":"15.00"},"signings":[{"chain_status":"COMPLETE_TERMINAL","direct":"0.00","observable":"5.17","pkg_down":null,"pkg_first":"0.62","player_slug":"chico-fernandez","realized":"0.62","realized_value_state":"REALIZED_TO_DATE","trade":"0.62"},{"chain_status":"COMPLETE_TERMINAL","direct":"0.19","observable":null,"pkg_down":null,"pkg_first":"-0.71","player_slug":"jose-vizcaino","realized":"0.09","realized_value_state":"REALIZED_TO_DATE","trade":"-0.10"},{"chain_status":"COMPLETE_TERMINAL","direct":"1.23","observable":null,"pkg_down":null,"pkg_first":"0.17","player_slug":"tony-abreu","realized":"1.40","realized_value_state":"REALIZED_TO_DATE","trade":"0.17"}],"transaction_queue":[{"issue":"CASH_AMOUNT_UNKNOWN","items":17},{"issue":"DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION","items":6},{"issue":"DOWNSTREAM_WAR_NOT_LOADED","items":4},{"issue":"EXIT_NOT_RESEARCHED_DOWNSTREAM","items":5},{"issue":"EXIT_STATUS_UNVERIFIED","items":16},{"issue":"EXIT_TRANSACTION_MISSING","items":2},{"issue":"FUTURE_CONSIDERATIONS_UNRESOLVED","items":3},{"issue":"POOL_SPACE_AMOUNT_UNKNOWN","items":1},{"issue":"PTBNL_UNRESOLVED","items":2},{"issue":"RETURN_ASSET_EXIT_MISSING","items":1}],"value_queue":[{"issue":"ACQUISITION_COST_INCOMPLETE","items":28},{"issue":"DOWNSTREAM_ASSET_CHAIN_INCOMPLETE","items":5},{"issue":"LINEAGE_BOUNDARY_NOTED","items":22},{"issue":"OUTCOME_INCOMPLETE","items":8},{"issue":"TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED","items":27}],"value_totals":{"chain_incomplete":5,"observable":"141.71","pkg_down":"2.99","pkg_first":"95.85","realized":"299.00","realized_to_date":83,"resolved":88,"unresolved":0}},"observed_through_season":2025,"players":[{"acquisition_event_key":"LAD_ARI_2009_TONY_ABREU","attribution_level":"PLAYER_ATTRIBUTABLE","bat_rows":14,"bref_id":"garlajo01","credited_bwar":"0.17","exit_event_key":"LAD_FREE_AGENCY_2009_JON_GARLAND","mlb_id":"279782","name":"Jon Garland","originating_signing_slug":"tony-abreu","pitch_rows":14,"rows":28},{"acquisition_event_key":"LAD_NYY_2000_JOSE_VIZCAINO","attribution_level":"PACKAGE_ATTRIBUTABLE","bat_rows":15,"bref_id":"leyriji01","credited_bwar":"-0.61","exit_event_key":"LAD_FREE_AGENCY_2000_JIM_LEYRITZ","mlb_id":"117747","name":"Jim Leyritz","originating_signing_slug":"jose-vizcaino","pitch_rows":0,"rows":15},{"acquisition_event_key":"LAD_MIN_1967_BOB_MILLER","attribution_level":"CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE","bat_rows":18,"bref_id":"grantmu01","credited_bwar":"1.39","exit_event_key":"LAD_MON_1968_GRANT_EXPANSION","mlb_id":"115046","name":"Mudcat Grant","originating_signing_slug":"chico-fernandez","pitch_rows":18,"rows":36},{"acquisition_event_key":"LAD_MIN_1967_BOB_MILLER","attribution_level":"CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE","bat_rows":12,"bref_id":"versazo01","credited_bwar":"-1.12","exit_event_key":"LAD_SD_1968_VERSALLES_EXPANSION","mlb_id":"123713","name":"Zoilo Versalles","originating_signing_slug":"chico-fernandez","pitch_rows":0,"rows":12}],"sources":[{"cdx_digest":"CEBQTPXSHPR6RO2WZMQ7FK2LRRV575GV","component":"BAT","decoded_sha256":"ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023","observed_through_date":"2026-09-11","retrieved_at":"2026-10-28T03:21:59Z","url":"https://web.archive.org/web/20260911214553id_/https://www.baseball-reference.com/data/war_daily_bat.txt"},{"cdx_digest":"HW43HICGDZB6V2QAOFETX36ZQOQBY6UW","component":"PITCH","decoded_sha256":"3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825","observed_through_date":"2025-11-04","retrieved_at":"2026-10-28T03:22:08Z","url":"https://web.archive.org/web/20260210222101id_/https://www.baseball-reference.com/data/war_daily_pitch.txt"}],"war":{"row_format":["bref_id","mlb_id","season","team","stint","component","league","war","games","pa","ip_outs"],"rows":[["garlajo01","279782",2000,"CHW",1,"BAT","AL","0.00",1,0,null],["garlajo01","279782",2000,"CHW",1,"PITCH","AL","-0.45",15,null,209],["garlajo01","279782",2001,"CHW",1,"BAT","AL","-0.03",4,2,null],["garlajo01","279782",2001,"CHW",1,"PITCH","AL","1.62",35,null,351],["garlajo01","279782",2002,"CHW",1,"BAT","AL","-0.05",2,3,null],["garlajo01","279782",2002,"CHW",1,"PITCH","AL","1.41",33,null,578],["garlajo01","279782",2003,"CHW",1,"BAT","AL","0.02",2,4,null],["garlajo01","279782",2003,"CHW",1,"PITCH","AL","1.98",32,null,575],["garlajo01","279782",2004,"CHW",1,"BAT","AL","0.01",2,5,null],["garlajo01","279782",2004,"CHW",1,"PITCH","AL","1.64",34,null,651],["garlajo01","279782",2005,"CHW",1,"BAT","AL","0.05",1,2,null],["garlajo01","279782",2005,"CHW",1,"PITCH","AL","4.62",32,null,663],["garlajo01","279782",2006,"CHW",1,"BAT","AL","0.12",2,7,null],["garlajo01","279782",2006,"CHW",1,"PITCH","AL","3.66",33,null,634],["garlajo01","279782",2007,"CHW",1,"BAT","AL","0.03",1,2,null],["garlajo01","279782",2007,"CHW",1,"PITCH","AL","3.93",32,null,625],["garlajo01","279782",2008,"LAA",1,"BAT","AL","0.01",1,3,null],["garlajo01","279782",2008,"LAA",1,"PITCH","AL","0.78",32,null,590],["garlajo01","279782",2009,"ARI",1,"BAT","NL","-0.42",26,62,null],["garlajo01","279782",2009,"ARI",1,"PITCH","NL","1.31",27,null,503],["garlajo01","279782",2009,"LAD",2,"BAT","NL","-0.12",6,13,null],["garlajo01","279782",2009,"LAD",2,"PITCH","NL","0.29",6,null,109],["garlajo01","279782",2010,"SDP",1,"BAT","NL","0.55",34,69,null],["garlajo01","279782",2010,"SDP",1,"PITCH","NL","1.33",33,null,600],["garlajo01","279782",2011,"LAD",1,"BAT","NL","-0.11",8,16,null],["garlajo01","279782",2011,"LAD",1,"PITCH","NL","0.25",9,null,162],["garlajo01","279782",2013,"COL",1,"BAT","NL","0.02",12,21,null],["garlajo01","279782",2013,"COL",1,"PITCH","NL","0.06",12,null,204],["grantmu01","115046",1958,"CLE",1,"BAT","AL","-0.62",54,72,null],["grantmu01","115046",1958,"CLE",1,"PITCH","AL","1.61",44,null,612],["grantmu01","115046",1959,"CLE",1,"BAT","AL","0.23",42,58,null],["grantmu01","115046",1959,"CLE",1,"PITCH","AL","0.29",38,null,496],["grantmu01","115046",1960,"CLE",1,"BAT","AL","0.31",47,61,null],["grantmu01","115046",1960,"CLE",1,"PITCH","AL","-0.27",33,null,479],["grantmu01","115046",1961,"CLE",1,"BAT","AL","0.05",48,98,null],["grantmu01","115046",1961,"CLE",1,"PITCH","AL","2.35",35,null,734],["grantmu01","115046",1962,"CLE",1,"BAT","AL","0.07",30,56,null],["grantmu01","115046",1962,"CLE",1,"PITCH","AL","0.90",26,null,449],["grantmu01","115046",1963,"CLE",1,"BAT","AL","0.32",53,81,null],["grantmu01","115046",1963,"CLE",1,"PITCH","AL","2.28",38,null,688],["grantmu01","115046",1964,"CLE",1,"BAT","AL","0.40",20,26,null],["grantmu01","115046",1964,"CLE",1,"PITCH","AL","-0.49",13,null,186],["grantmu01","115046",1964,"MIN",2,"BAT","AL","-0.24",39,65,null],["grantmu01","115046",1964,"MIN",2,"PITCH","AL","1.47",26,null,498],["grantmu01","115046",1965,"MIN",1,"BAT","AL","0.09",50,109,null],["grantmu01","115046",1965,"MIN",1,"PITCH","AL","2.54",41,null,811],["grantmu01","115046",1966,"MIN",1,"BAT","AL","0.36",35,92,null],["grantmu01","115046",1966,"MIN",1,"PITCH","AL","2.29",35,null,747],["grantmu01","115046",1967,"MIN",1,"BAT","AL","0.21",27,32,null],["grantmu01","115046",1967,"MIN",1,"PITCH","AL","-0.38",27,null,286],["grantmu01","115046",1968,"LAD",1,"BAT","NL","0.03",43,31,null],["grantmu01","115046",1968,"LAD",1,"PITCH","NL","1.36",37,null,285],["grantmu01","115046",1969,"MON",1,"BAT","NL","-0.09",11,16,null],["grantmu01","115046",1969,"MON",1,"PITCH","NL","-0.17",11,null,152],["grantmu01","115046",1969,"STL",2,"BAT","NL","0.25",31,21,null],["grantmu01","115046",1969,"STL",2,"PITCH","NL","0.14",30,null,190],["grantmu01","115046",1970,"OAK",1,"BAT","AL","0.29",72,19,null],["grantmu01","115046",1970,"OAK",1,"PITCH","AL","4.49",72,null,371],["grantmu01","115046",1970,"PIT",2,"BAT","NL","-0.06",8,2,null],["grantmu01","115046",1970,"PIT",2,"PITCH","NL","0.35",8,null,36],["grantmu01","115046",1971,"PIT",1,"BAT","NL","0.10",42,9,null],["grantmu01","115046",1971,"PIT",1,"PITCH","NL","0.22",42,null,225],["grantmu01","115046",1971,"OAK",2,"BAT","AL","0.05",15,5,null],["grantmu01","115046",1971,"OAK",2,"PITCH","AL","0.35",15,null,82],["leyriji01","117747",1990,"NYY",1,"BAT","AL","-0.72",92,339,null],["leyriji01","117747",1991,"NYY",1,"BAT","AL","-0.54",32,91,null],["leyriji01","117747",1992,"NYY",1,"BAT","AL","0.57",63,167,null],["leyriji01","117747",1993,"NYY",1,"BAT","AL","3.23",95,305,null],["leyriji01","117747",1994,"NYY",1,"BAT","AL","1.85",75,293,null],["leyriji01","117747",1995,"NYY",1,"BAT","AL","0.42",77,310,null],["leyriji01","117747",1996,"NYY",1,"BAT","AL","0.49",88,309,null],["leyriji01","117747",1997,"ANA",1,"BAT","AL","2.00",84,342,null],["leyriji01","117747",1997,"TEX",2,"BAT","AL","0.66",37,114,null],["leyriji01","117747",1998,"BOS",1,"BAT","AL","0.74",52,156,null],["leyriji01","117747",1998,"SDP",2,"BAT","NL","0.42",62,172,null],["leyriji01","117747",1999,"SDP",1,"BAT","NL","-0.23",50,154,null],["leyriji01","117747",1999,"NYY",2,"BAT","AL","-0.11",31,79,null],["leyriji01","117747",2000,"NYY",1,"BAT","AL","-0.23",24,63,null],["leyriji01","117747",2000,"LAD",2,"BAT","NL","-0.61",41,68,null],["versazo01","123713",1959,"WSH",1,"BAT","AL","-0.48",29,64,null],["versazo01","123713",1960,"WSH",1,"BAT","AL","-0.11",15,47,null],["versazo01","123713",1961,"MIN",1,"BAT","AL","1.30",129,542,null],["versazo01","123713",1962,"MIN",1,"BAT","AL","2.00",160,624,null],["versazo01","123713",1963,"MIN",1,"BAT","AL","2.57",159,667,null],["versazo01","123713",1964,"MIN",1,"BAT","AL","2.53",160,717,null],["versazo01","123713",1965,"MIN",1,"BAT","AL","7.16",160,728,null],["versazo01","123713",1966,"MIN",1,"BAT","AL","1.34",137,596,null],["versazo01","123713",1967,"MIN",1,"BAT","AL","-1.61",160,626,null],["versazo01","123713",1968,"LAD",1,"BAT","NL","-1.12",122,436,null],["versazo01","123713",1969,"CLE",1,"BAT","AL","0.30",72,242,null],["versazo01","123713",1971,"ATL",1,"BAT","NL","-1.66",66,210,null]]}}$m058$::jsonb as j;

create temporary table _m058_players on commit drop as
select x ->> 'bref_id' as bref_id, x ->> 'mlb_id' as mlb_id, x ->> 'name' as name, (x ->> 'rows')::int as rows, (x ->> 'bat_rows')::int as bat_rows,
  (x ->> 'pitch_rows')::int as pitch_rows, x ->> 'acquisition_event_key' as acquisition_event_key, x ->> 'exit_event_key' as exit_event_key,
  x ->> 'originating_signing_slug' as signing_slug, x ->> 'attribution_level' as attribution_level, (x ->> 'credited_bwar')::numeric as credited_bwar
from _m058, jsonb_array_elements(j -> 'players') x;

create temporary table _m058_rows on commit drop as
select r ->> 0 as bref_id, r ->> 1 as mlb_id, (r ->> 2)::int as season, r ->> 3 as team, (r ->> 4)::int as stint, r ->> 5 as component, nullif(r ->> 6, '') as league,
  (r ->> 7)::numeric as war, (r ->> 8)::int as games, (r ->> 9)::int as pa, (r ->> 10)::int as ip_outs
from _m058, jsonb_array_elements(j #> '{war,rows}') r;

create temporary table _m058_excluded on commit drop as
select x ->> 'bref_id' as bref_id, (x ->> 'season')::int as season, x ->> 'team' as team, (x ->> 'stint')::int as stint, x ->> 'component' as component
from _m058, jsonb_array_elements(j -> 'excluded_rows') x;

create temporary table _m058_urls on commit drop as
select x ->> 'url' as url, x ->> 'component' as component, x ->> 'decoded_sha256' as decoded_sha256, x ->> 'cdx_digest' as cdx_digest,
  (x ->> 'observed_through_date')::date as observed_through_date, (x ->> 'retrieved_at')::timestamptz as retrieved_at
from _m058, jsonb_array_elements(j -> 'sources') x;

-- expected grouped queues and signing states, compared row by row (never through a collation-dependent hash)
create temporary table _m058_queue on commit drop as
select k as kind, x ->> 'issue' as issue, (x ->> 'items')::int as items
from _m058, lateral (values ('TX_BEFORE', j #> '{baseline,transaction_queue}'), ('TX_AFTER', j #> '{expected,transaction_queue}'),
  ('VALUE_BEFORE', j #> '{baseline,value_queue}'), ('VALUE_AFTER', j #> '{expected,value_queue}')) v(k, a), jsonb_array_elements(v.a) x;

create temporary table _m058_signings on commit drop as
select k as kind, x ->> 'player_slug' as player_slug, x ->> 'realized_value_state' as realized_value_state, x ->> 'chain_status' as chain_status,
  (x ->> 'direct')::numeric as direct, (x ->> 'trade')::numeric as trade, (x ->> 'realized')::numeric as realized, (x ->> 'pkg_first')::numeric as pkg_first,
  (x ->> 'pkg_down')::numeric as pkg_down, (x ->> 'observable')::numeric as observable
from _m058, lateral (values ('BEFORE', j #> '{baseline,signings}'), ('AFTER', j #> '{expected,signings}')) v(k, a), jsonb_array_elements(v.a) x;

-- every public base table except the team-season facts and the product snapshots, hashed row by row before anything is written
create temporary table _m058_tables (relname text primary key, h text) on commit drop;
do $$
declare tn text; hv text;
begin
  for tn in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
             and c.relname <> 'player_mlb_team_season_war' and c.relname not like 'product\_%' order by 1 loop
    execute format('select md5(coalesce(string_agg(md5((to_jsonb(t) - ''updated_at'')::text), '''' order by md5((to_jsonb(t) - ''updated_at'')::text)), '''')) from public.%I t', tn) into hv;
    insert into _m058_tables values (tn, hv);
  end loop;
end $$;

-- the prediction layer, as views, hashed the same way (they read outcomes, audits, signings and evaluations, never team-season WAR)
create temporary view _m058_prediction as
select (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(s)::text) as h from public.v_outcome_target_support s) z) as support,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(t)::text) as h from public.v_outcome_training_population t) z) as training_population,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(f)::text) as h from public.v_outcome_feature_matrix f) z) as feature_matrix,
  (select md5(coalesce(string_agg(h, '' order by h), '')) from (select md5(to_jsonb(e)::text) as h from public.v_outcome_model_evaluation e) z) as evaluation_view,
  (select count(*) from public.v_research_tasks where task_type = 'BWAR_MISSING') as bwar_missing;

-- the WAR rows 058 does not own: everything except the four players' rows on the two 057 sources
create temporary view _m058_other_war as
select w.* from public.player_mlb_team_season_war w
where not (w.bref_id in (select bref_id from _m058_players) and w.source_id in (select so.id from public.sources so join _m058_urls u on u.url = so.url));

create temporary table _m058_before on commit drop as
select (select md5(string_agg(t, '|' order by t)) from (select w::text as t from _m058_other_war w) x) as other_war_hash,
  (select max(generation_id) from public.product_executive_snapshot) as generation,
  (select md5(string_agg(t, '|' order by t)) from (select w::text as t from public.player_mlb_team_season_war w) x) as war_hash,
  p.* from _m058_prediction p;

-- ===========================================================================
-- 1. PRECONDITIONS: the canonical state 058 was written for
-- ===========================================================================

do $$
declare
  pp record;
  n int;
  rerun boolean;
begin
  -- 057 is applied: its two sources are the approved archived captures, and its 54 rows for its eleven players are ACTIVE on them
  if (select count(*) from _m058_urls u
      where (u.component = 'BAT' and u.decoded_sha256 = 'ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023'
               and u.url = 'https://web.archive.org/web/20260911214553id_/https://www.baseball-reference.com/data/war_daily_bat.txt')
         or (u.component = 'PITCH' and u.decoded_sha256 = '3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825'
               and u.url = 'https://web.archive.org/web/20260210222101id_/https://www.baseball-reference.com/data/war_daily_pitch.txt')) <> 2
     or (select count(*) from _m058_urls) <> 2 then
    raise exception '058: the sources are not the two approved archived Baseball-Reference captures';
  end if;
  if (select count(*) from public.sources so join _m058_urls u on u.url = so.url
      where position(u.decoded_sha256 in coalesce(so.notes, '')) > 0 and position(u.cdx_digest in coalesce(so.notes, '')) > 0
        and so.source_type = 'WAR_DATA_FILE' and so.source_tier = 'BASEBALL_REFERENCE' and so.source_name = 'Baseball-Reference') <> 2 then
    raise exception '058: Migration 057 has not been applied (its two archived Baseball-Reference sources are not recorded as reviewed)';
  end if;
  if (select count(*) from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m058_urls u on u.url = so.url
      where w.record_status = 'ACTIVE' and w.bref_id not in (select bref_id from _m058_players)) <> (select (j #>> '{baseline,war_active_057}')::int from _m058)
     or (select count(distinct w.bref_id) from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m058_urls u on u.url = so.url
         where w.record_status = 'ACTIVE' and w.bref_id not in (select bref_id from _m058_players)) <> 11 then
    raise exception '058: the 057 team-season rows are not the 54 ACTIVE rows of its eleven players';
  end if;
  -- every row is a complete 2025-or-earlier team stint of one of the four, BAT or PITCH, whose team the map resolves; never the excluded WSA row
  if exists (select 1 from _m058_rows r where r.season > 2025 or r.component not in ('BAT', 'PITCH') or r.team in ('TOT', 'WSA'))
     or (select (j ->> 'observed_through_season')::int from _m058) <> 2025 then
    raise exception '058: a row is not a complete 2025-or-earlier team-season stint of a mapped team';
  end if;
  if exists (select 1 from _m058_rows r where not exists (select 1 from public.bref_team_code_map m
             where m.bref_team_code = r.team and r.season >= m.from_season and r.season <= coalesce(m.to_season, 9999)))
     or exists (select 1 from _m058_rows r join _m058_excluded x using (bref_id, season, team, stint, component))
     or exists (select 1 from public.bref_team_code_map where bref_team_code = 'WSA') then
    raise exception '058: a team code has no team-code mapping for its season, or a reviewed exclusion is loaded';
  end if;
  if exists (select 1 from _m058_rows r where r.bref_id not in (select bref_id from _m058_players))
     or exists (select 1 from _m058_rows r join _m058_players p using (bref_id) where r.mlb_id <> p.mlb_id)
     or (select count(*) from _m058_players) <> 4 or (select count(*) from _m058_rows) <> 91
     or exists (select 1 from _m058_players p where p.rows <> (select count(*) from _m058_rows r where r.bref_id = p.bref_id)
                or p.bat_rows <> (select count(*) from _m058_rows r where r.bref_id = p.bref_id and r.component = 'BAT')
                or p.pitch_rows <> (select count(*) from _m058_rows r where r.bref_id = p.bref_id and r.component = 'PITCH')) then
    raise exception '058: the rows are not exactly the 91 reviewed rows of the four returned players';
  end if;
  -- each player is the existing transaction asset: one INCOMING player of the reviewed trade and one OUTGOING player of the reviewed exit,
  -- identified by MLB and Baseball-Reference id, with no DISI players row (a returned player is never made a signing player)
  for pp in select * from _m058_players loop
    if (select count(*) from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
        where e.event_key = pp.acquisition_event_key and e.transaction_type = 'TRADE' and a.asset_side = 'INCOMING' and a.asset_type = 'PLAYER'
          and a.mlb_id = pp.mlb_id and a.bref_id = pp.bref_id and a.player_id is null) <> 1
       or (select count(*) from public.transaction_event_assets a join public.transaction_events e on e.id = a.event_id
           where e.event_key = pp.exit_event_key and a.asset_side = 'OUTGOING' and a.mlb_id = pp.mlb_id and a.bref_id = pp.bref_id and a.player_id is null) <> 1
       or (select count(*) from public.transaction_event_assets a where a.bref_id = pp.bref_id or a.mlb_id = pp.mlb_id) <> 2 then
      raise exception '058: % is not the reviewed returned asset of % (exit %)', pp.name, pp.acquisition_event_key, pp.exit_event_key;
    end if;
    if exists (select 1 from public.players pl where pl.bref_id = pp.bref_id or pl.mlb_id::text = pp.mlb_id) then
      raise exception '058: % has a DISI players row; a returned player is not a signing player and the reviewed join is by bref_id', pp.name;
    end if;
    -- no active team-season evidence for the player from any other source (the research would no longer apply)
    if exists (select 1 from public.player_mlb_team_season_war w where w.bref_id = pp.bref_id and w.record_status = 'ACTIVE'
               and w.source_id not in (select so.id from public.sources so join _m058_urls u on u.url = so.url)) then
      raise exception '058: % already has active team-season bWAR from another source; the research no longer applies', pp.name;
    end if;
  end loop;
  rerun := exists (select 1 from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m058_urls u on u.url = so.url
                   where w.record_status = 'ACTIVE' and w.bref_id in (select bref_id from _m058_players));
  -- the prediction layer and every output are as the research measured them: no supported model, probability, expected value or recommendation
  if exists (select 1 from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED')
     or (select count(*) from public.v_player_outcome_probability where probability is not null or prediction_eligible) <> 0
     or (select count(*) from public.v_expected_value_support where probability_supported or expected_value_supported) <> 0
     or (select supported_probability_targets from public.v_executive_overview) <> 0
     or (select predictive_portfolio_recommendations from public.v_executive_overview) <> 0
     or (select supported_fitted_models from public.v_executive_overview) <> 0
     or (select string_agg(distinct training_fingerprint, ',' order by training_fingerprint) from public.outcome_model_evaluations)
        <> (select j #>> '{baseline,evaluation_fingerprints}' from _m058) then
    raise exception '058: the prediction layer is not in the state the research was written for';
  end if;
  if (select count(*) from public.players p
      where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
        and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')) <> 0 then
    raise exception '058: a player holds both a Dodgers signing and a benchmark signing';
  end if;
  if exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
    raise exception '058: the product snapshots are not current (drift before 058)';
  end if;
  if not rerun then
    if (select count(*) from public.players) <> (select (j #>> '{baseline,counts,players}')::int from _m058)
       or (select count(*) from public.sources) <> (select (j #>> '{baseline,counts,sources}')::int from _m058)
       or (select count(*) from public.signings where record_scope = 'MLB_PIPELINE_TOP_PROSPECT') <> (select (j #>> '{baseline,counts,benchmark_signings}')::int from _m058)
       or (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id where o.franchise_key = 'DODGERS') <> (select (j #>> '{baseline,counts,dodgers_signings}')::int from _m058)
       or (select count(*) from public.player_mlb_team_season_war where record_status = 'ACTIVE') <> (select (j #>> '{baseline,war_active}')::int from _m058) then
      raise exception '058: players, sources, signings or active team-season rows are not in the state the research was written for';
    end if;
    -- the four have no active WAR and are the reviewed blockers: Garland and Leyritz RETURN_WAR_UNKNOWN with a NULL value (the two pinned ids),
    -- Grant and Versalles WAR_NOT_LOADED downstream
    if exists (select 1 from public.player_mlb_team_season_war w where w.record_status = 'ACTIVE' and w.bref_id in (select bref_id from _m058_players))
       or (select count(*) from public.v_trade_realization_edges x where x.incoming_bref_id in ('garlajo01', 'leyriji01')
           and x.return_state = 'RETURN_WAR_UNKNOWN' and x.incoming_dodgers_bwar is null) <> 2
       or (select count(*) from public.v_transaction_asset_lineage l join _m058_players p using (bref_id)
           where l.war_state = 'WAR_NOT_LOADED' and l.value_resolution = 'VALUE_NOT_LOADED' and l.attribution_level = p.attribution_level) <> 4 then
      raise exception '058: the four returned players are not the reviewed WAR-not-loaded blockers';
    end if;
    if exists (select s.player_slug, s.realized_value_state, s.chain_status, s.direct_dodgers_bwar, s.individually_attributable_trade_bwar, s.realized_org_value_bwar,
                 s.package_first_hop_participation_bwar, s.package_downstream_participation_bwar, s.observable_not_attributable_bwar
               from public.v_player_realized_organizational_value s where s.player_slug in (select signing_slug from _m058_players)
               except select player_slug, realized_value_state, chain_status, direct, trade, realized, pkg_first, pkg_down, observable from _m058_signings where kind = 'BEFORE')
       or (select count(*) from _m058_signings where kind = 'BEFORE') <> 3 then
      raise exception '058: the three originating signings are not in the value state the research was written for';
    end if;
    if (select row(count(*) filter (where realized_org_value_bwar is not null), sum(realized_org_value_bwar)::numeric,
               count(*) filter (where realized_value_state = 'REALIZED_TO_DATE'), count(*) filter (where realized_value_state = 'TO_DATE_CHAIN_INCOMPLETE'),
               count(*) filter (where realized_value_state = 'VALUE_UNRESOLVED'), sum(package_first_hop_participation_bwar)::numeric, sum(package_downstream_participation_bwar)::numeric,
               sum(observable_not_attributable_bwar)::numeric) from public.v_player_realized_organizational_value)
       is distinct from (select row((j #>> '{baseline,value_totals,resolved}')::bigint, (j #>> '{baseline,value_totals,realized}')::numeric, (j #>> '{baseline,value_totals,realized_to_date}')::bigint,
               (j #>> '{baseline,value_totals,chain_incomplete}')::bigint, (j #>> '{baseline,value_totals,unresolved}')::bigint, (j #>> '{baseline,value_totals,pkg_first}')::numeric,
               (j #>> '{baseline,value_totals,pkg_down}')::numeric, (j #>> '{baseline,value_totals,observable}')::numeric) from _m058)
       or (select row(signings_with_resolved_value::bigint, realized_direct_dodgers_bwar::numeric, realized_individually_attributable_trade_bwar::numeric, realized_org_value_bwar::numeric) from public.v_executive_overview)
          is distinct from (select row((j #>> '{baseline,executive,signings_with_resolved_value}')::bigint, (j #>> '{baseline,executive,direct}')::numeric,
               (j #>> '{baseline,executive,trade}')::numeric, (j #>> '{baseline,executive,realized}')::numeric) from _m058) then
      raise exception '058: the realized-value and executive totals are not the 297.60 / 87 state the research was written for';
    end if;
    if exists ((select issue, count(*)::int from public.v_transaction_research_queue group by 1) except select issue, items from _m058_queue where kind = 'TX_BEFORE')
       or exists (select issue, items from _m058_queue where kind = 'TX_BEFORE' except (select issue, count(*)::int from public.v_transaction_research_queue group by 1))
       or exists ((select issue, count(*)::int from public.v_value_research_queue group by 1) except select issue, items from _m058_queue where kind = 'VALUE_BEFORE')
       or exists (select issue, items from _m058_queue where kind = 'VALUE_BEFORE' except (select issue, count(*)::int from public.v_value_research_queue group by 1)) then
      raise exception '058: the transaction or value research queue is not in the state the research was written for';
    end if;
    if (select bwar_missing from _m058_before) <> (select (j #>> '{baseline,bwar_missing}')::int from _m058) then
      raise exception '058: BWAR_MISSING is not in the state the research was written for';
    end if;
  end if;
end $$;

-- ===========================================================================
-- 2. TEAM-SEASON bWAR (the 032 / 035 / 057 row; returned players: player_id NULL, joined by bref_id; NULL WAR would stay NULL)
-- ===========================================================================

insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
  plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
select r.bref_id, r.mlb_id, null, r.season, r.team, m.organization_id, r.stint, r.component, r.war, r.games, r.pa, r.ip_outs, r.league, so.id,
       u.observed_through_date, (select (j ->> 'observed_through_season')::int from _m058), u.retrieved_at, 'VERIFIED',
       case when r.war is null then 'The data file has no WAR for this zero-plate-appearance row; stored as NULL, not zero.' end
from _m058_rows r
join _m058_urls u on u.component = r.component
join public.sources so on so.url = u.url
left join lateral (
  select m2.organization_id from public.bref_team_code_map m2
  where m2.bref_team_code = r.team and r.season >= m2.from_season and r.season <= coalesce(m2.to_season, 9999)
  order by m2.from_season desc limit 1
) m on true
on conflict (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE' do nothing;

-- ===========================================================================
-- 3. POSTCONDITIONS: what was added is exactly what was reviewed, the existing rules value it, and nothing else moved
-- ===========================================================================

do $$
declare
  b record;
  tb record;
  hv text;
  n int;
begin
  select * into b from _m058_before;
  -- every reviewed row is present once, active, exactly as read, with the mapped organization, the capture's provenance and no players row
  select count(*) into n from _m058_rows r
    where (select count(*) from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m058_urls u on u.url = so.url and u.component = r.component
           where w.bref_id = r.bref_id and w.mlb_id = r.mlb_id and w.season = r.season and w.bref_team_code = r.team and w.stint_ordinal = r.stint and w.component = r.component
             and w.war is not distinct from r.war and w.games is not distinct from r.games and w.plate_appearances is not distinct from r.pa
             and w.ip_outs is not distinct from r.ip_outs and w.league is not distinct from r.league and w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
             and w.player_id is null and w.organization_id is not distinct from (select m2.organization_id from public.bref_team_code_map m2
               where m2.bref_team_code = r.team and r.season >= m2.from_season and r.season <= coalesce(m2.to_season, 9999) order by m2.from_season desc limit 1)
             and w.organization_id is not null and w.observed_through_season = 2025 and w.confidence = 'VERIFIED') <> 1;
  if n > 0 then
    raise exception '058 postcondition: % team-season rows are not recorded exactly as read', n;
  end if;
  if (select count(*) from public.player_mlb_team_season_war w where w.record_status = 'ACTIVE' and w.bref_id in (select bref_id from _m058_players)) <> 91
     or exists (select 1 from _m058_players p where p.rows <> (select count(*) from public.player_mlb_team_season_war w where w.record_status = 'ACTIVE' and w.bref_id = p.bref_id))
     or exists (select 1 from public.player_mlb_team_season_war w where w.bref_team_code = 'WSA')
     or (select count(*) from public.player_mlb_team_season_war w join public.sources so on so.id = w.source_id join _m058_urls u on u.url = so.url
         where w.record_status = 'ACTIVE') <> 91 + (select (j #>> '{baseline,war_active_057}')::int from _m058) then
    raise exception '058 postcondition: the active rows are not exactly 91 for the four (28 / 15 / 36 / 12), no WSA row, beside the 54 057 rows';
  end if;
  if exists (select 1 from public.player_mlb_team_season_war w where w.record_status = 'ACTIVE' and (w.bref_team_code = 'TOT'
             or w.bref_id in (select bref_id from _m058_players)) group by w.bref_id, w.season, w.bref_team_code, w.stint_ordinal, w.component having count(*) > 1)
     or exists (select 1 from public.player_mlb_team_season_war where organization_id is null and record_status = 'ACTIVE') then
    raise exception '058 postcondition: a team-season fact is counted twice, or an active row has no organization';
  end if;
  if b.other_war_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select w::text as t from _m058_other_war w) x) then
    raise exception '058 postcondition: a team-season row 058 does not own changed (the 057 rows and every earlier row are untouched)';
  end if;
  -- nothing outside the team-season facts moved: every other base table (sources, players, transactions, assets, team-code map, outcomes,
  -- audits, evaluations, metrics ...) is row-for-row identical
  n := 0;
  for tb in select relname, h from _m058_tables loop
    execute format('select md5(coalesce(string_agg(md5((to_jsonb(t) - ''updated_at'')::text), '''' order by md5((to_jsonb(t) - ''updated_at'')::text)), '''')) from public.%I t', tb.relname) into hv;
    if hv is distinct from tb.h then n := n + 1; end if;
  end loop;
  if n > 0 then
    raise exception '058 postcondition: % base tables outside the team-season facts changed', n;
  end if;
  -- the existing rules value the rows: each returned player's interval-bounded value is exactly the reviewed credited rows, at the reviewed level
  if (select count(*) from public.v_transaction_asset_lineage l join _m058_players p using (bref_id)
      where l.war_state = 'LOADED' and l.value_resolution = 'VALUE_RESOLVED' and l.attribution_level = p.attribution_level
        and l.interval_bounded_dodgers_bwar = p.credited_bwar) <> 4
     or exists (select 1 from public.v_transaction_asset_lineage l where l.war_state = 'WAR_NOT_LOADED' and l.bref_id in (select bref_id from _m058_players)) then
    raise exception '058 postcondition: a returned player is not valued by its reviewed credited rows at its reviewed attribution level';
  end if;
  -- KNOWN RETURN WAR != ATTRIBUTABLE SIGNING VALUE: Garland is Abreu's sole return; Leyritz stays a shared package; Grant and Versalles stay chain-observable
  if (select count(*) from public.v_trade_realization_edges x where x.incoming_bref_id = 'garlajo01' and x.return_state = 'LOADED' and x.attribution_status = 'SOLE_OUTGOING_ASSET') <> 1
     or (select count(*) from public.v_trade_realization_edges x where x.incoming_bref_id = 'leyriji01' and x.return_state = 'LOADED' and x.attribution_status = 'SHARED_PACKAGE_RETURN'
         and not x.individual_attribution_permitted) <> 1
     or exists (select 1 from public.v_trade_realization_edges x where x.incoming_bref_id in ('grantmu01', 'versazo01')) then
    raise exception '058 postcondition: an attribution moved (Garland sole return, Leyritz shared package, Grant and Versalles outside any tracked-signing edge)';
  end if;
  if exists (select s.player_slug, s.realized_value_state, s.chain_status, s.direct_dodgers_bwar, s.individually_attributable_trade_bwar, s.realized_org_value_bwar,
               s.package_first_hop_participation_bwar, s.package_downstream_participation_bwar, s.observable_not_attributable_bwar
             from public.v_player_realized_organizational_value s where s.player_slug in (select signing_slug from _m058_players)
             except select player_slug, realized_value_state, chain_status, direct, trade, realized, pkg_first, pkg_down, observable from _m058_signings where kind = 'AFTER')
     or (select count(*) from _m058_signings where kind = 'AFTER') <> 3 then
    raise exception '058 postcondition: the three originating signings are not in the reviewed value state (Abreu 1.40 realized, Vizcaino 0.09, Fernandez 0.62)';
  end if;
  if (select row(count(*) filter (where realized_org_value_bwar is not null), sum(realized_org_value_bwar)::numeric,
             count(*) filter (where realized_value_state = 'REALIZED_TO_DATE'), count(*) filter (where realized_value_state = 'TO_DATE_CHAIN_INCOMPLETE'),
             count(*) filter (where realized_value_state = 'VALUE_UNRESOLVED'), sum(package_first_hop_participation_bwar)::numeric, sum(package_downstream_participation_bwar)::numeric,
             sum(observable_not_attributable_bwar)::numeric) from public.v_player_realized_organizational_value)
     is distinct from (select row((j #>> '{expected,value_totals,resolved}')::bigint, (j #>> '{expected,value_totals,realized}')::numeric, (j #>> '{expected,value_totals,realized_to_date}')::bigint,
             (j #>> '{expected,value_totals,chain_incomplete}')::bigint, (j #>> '{expected,value_totals,unresolved}')::bigint, (j #>> '{expected,value_totals,pkg_first}')::numeric,
             (j #>> '{expected,value_totals,pkg_down}')::numeric, (j #>> '{expected,value_totals,observable}')::numeric) from _m058)
     or (select row(signings_with_resolved_value::bigint, realized_direct_dodgers_bwar::numeric, realized_individually_attributable_trade_bwar::numeric, realized_org_value_bwar::numeric) from public.v_executive_overview)
        is distinct from (select row((j #>> '{expected,executive,signings_with_resolved_value}')::bigint, (j #>> '{expected,executive,direct}')::numeric,
             (j #>> '{expected,executive,trade}')::numeric, (j #>> '{expected,executive,realized}')::numeric) from _m058) then
    raise exception '058 postcondition: the realized-value and executive totals are not the reviewed 299.00 / 88 state';
  end if;
  if exists ((select issue, count(*)::int from public.v_transaction_research_queue group by 1) except select issue, items from _m058_queue where kind = 'TX_AFTER')
     or exists (select issue, items from _m058_queue where kind = 'TX_AFTER' except (select issue, count(*)::int from public.v_transaction_research_queue group by 1))
     or exists ((select issue, count(*)::int from public.v_value_research_queue group by 1) except select issue, items from _m058_queue where kind = 'VALUE_AFTER')
     or exists (select issue, items from _m058_queue where kind = 'VALUE_AFTER' except (select issue, count(*)::int from public.v_value_research_queue group by 1)) then
    raise exception '058 postcondition: the transaction or value research queue is not in the reviewed state';
  end if;
  if (select count(*) from public.v_transaction_research_queue where issue = 'DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION' and asset_name = 'Jon Garland'
      and event_key = 'LAD_FREE_AGENCY_2009_JON_GARLAND') <> 1
     or (select count(*) from public.v_transaction_research_queue where issue = 'CASH_AMOUNT_UNKNOWN' and event_key = 'LAD_NYY_2000_JOSE_VIZCAINO') <> 1
     or (select count(*) from public.v_value_research_queue where issue = 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED' and player_slug = 'jose-vizcaino') <> 1 then
    raise exception '058 postcondition: the Garland later-stint item, or Vizcaino''s cash and package-attribution items, are not as reviewed';
  end if;
  -- the prediction layer is byte-identical; no supported model, probability, expected value or recommendation; BWAR_MISSING unchanged
  if (select row(support, training_population, feature_matrix, evaluation_view, bwar_missing)::text from _m058_prediction)
     is distinct from row(b.support, b.training_population, b.feature_matrix, b.evaluation_view, b.bwar_missing)::text then
    raise exception '058 postcondition: the prediction layer moved (support, labels, features, evaluations or BWAR_MISSING)';
  end if;
  if exists (select 1 from public.outcome_model_evaluations where decision = 'MODEL_SUPPORTED')
     or (select count(*) from public.v_player_outcome_probability where probability is not null or prediction_eligible) <> 0
     or (select count(*) from public.v_expected_value_support where probability_supported or expected_value_supported) <> 0
     or (select supported_probability_targets from public.v_executive_overview) <> 0
     or (select predictive_portfolio_recommendations from public.v_executive_overview) <> 0
     or (select supported_fitted_models from public.v_executive_overview) <> 0 then
    raise exception '058 postcondition: a probability, expected value, recommendation or supported model appeared';
  end if;
  if (select count(*) from public.players p
      where exists (select 1 from public.signings s join public.organizations o on o.id = s.organization_id where s.player_id = p.id and o.franchise_key = 'DODGERS')
        and exists (select 1 from public.signings s where s.player_id = p.id and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT')) <> 0 then
    raise exception '058 postcondition: a player holds both a Dodgers signing and a benchmark signing';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' having count(*) <> (select (j #>> '{baseline,counts,tables}')::int from _m058))
     or exists (select 1 from information_schema.views where table_schema = 'public' having count(*) <> (select (j #>> '{baseline,counts,views}')::int from _m058)) then
    raise exception '058 postcondition: the catalog moved; 058 adds no table or view';
  end if;
end $$;

-- ===========================================================================
-- 4. GENERATION: one coherent refresh, only when this run changed a row
-- ===========================================================================

do $$
declare
  b record;
begin
  select * into b from _m058_before;
  if b.war_hash is distinct from (select md5(string_agg(t, '|' order by t)) from (select w::text as t from public.player_mlb_team_season_war w) x) then
    perform * from public.disi_refresh_product_snapshots();
    if (select max(generation_id) from public.product_executive_snapshot) <> b.generation + 1
       or exists (select 1 from public.disi_product_snapshot_drift() where missing_rows + extra_rows <> 0) then
      raise exception '058 postcondition: the refresh did not produce exactly one new drift-free generation';
    end if;
  end if;
end $$;

drop view _m058_other_war;
drop view _m058_prediction;

commit;
