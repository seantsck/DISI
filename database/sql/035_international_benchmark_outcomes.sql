-- DISI v0.26
-- 035_international_benchmark_outcomes.sql
-- League-wide international benchmarking, first bounded step: the MLB outcome audit of the 48 non-Dodgers players of the MLB
-- Pipeline 2013 / 2014 Top-30 international signing trackers, their Baseball-Reference team-season bWAR, and a coverage model that
-- states exactly what each tracked population is (a Top-prospect sample, a verified set, a full signing period) and whether it can
-- support an organizational rate. Run after 034.
--
-- Built from database/research/035/ (benchmark-outcomes.json, war-seed.json, scope-config.json, audit.mjs, build.mjs).
--
-- What this is. Source-backed outcome facts for an existing benchmark sample, plus derived views. It is NOT a league census: no
-- organization is ranked, no organizational hit rate is computed, and no class is declared rate-eligible by this migration (the
-- derived eligibility test is strict and, on today's data, true for no class). No new table is needed: outcomes, audits and evidence
-- reuse the Dodgers outcome-audit stores and populations reuse signing_populations.
--
-- What it does:
--   * Audits the MLB outcome of 43 identity-resolved benchmark players from the official MLB Stats API person record (same
--     conventions as the Dodgers audits, same 2026-10-05 boundary so the analytics as-of date does not move); 11 reached MLB.
--     Five players remain identity-unresolved and are queued, never inferred.
--   * Records outcomes rows (debut, games, plate appearances, innings, career bWAR from team-season facts) for the 11 reachers.
--   * Loads Baseball-Reference team-season bWAR for those 11 (same two data files and checksums as 032 / 033 / 034).
--   * Adds v_international_benchmark_player_outcomes, v_international_benchmark_class_coverage and
--     v_international_benchmark_research_queue.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/035/)
-- ===========================================================================

create temporary table _m035 on commit drop as
select $m035${"audit_through_date":"2026-10-05","outcome_through_season":2026,"players":[{"audit_note":"Reached MLB: MLB debut 2022-04-09 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"herrejo04","career_bwar":-0.65,"confidence":"VERIFIED","current_status":"Active per the MLB person record through 2026-10-05","debut":"2022-04-09","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":194,"ip":"4.0","mlb_id":"645444","org":"ARI","outcome_state":"REACHED_MLB","pa":562,"person_url":"https://statsapi.mlb.com/api/v1/people/645444","reached":true,"signing_year":2013,"slug":"jose-herrera","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"Reached MLB: MLB debut 2022-05-30 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"espinan01","career_bwar":-0.02,"confidence":"VERIFIED","current_status":"Active per the MLB person record through 2026-10-05","debut":"2022-05-30","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":7,"ip":"18.1","mlb_id":"659262","org":"BOS","outcome_state":"REACHED_MLB","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/659262","reached":true,"signing_year":2014,"slug":"anderson-espinoza","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"659261","org":"BOS","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/659261","reached":false,"signing_year":2014,"slug":"christopher-acosta","supports":["MLB_REACH","ACTIVE_STATUS"]},{"bref_id":null,"mlb_id":null,"org":"BOS","reached":null,"signing_year":2013,"slug":"emmanuel-dejesus"},{"audit_note":"Reached MLB: MLB debut 2017-07-25 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"deverra01","career_bwar":30.62,"confidence":"VERIFIED","current_status":"Active per the MLB person record through 2026-10-05","debut":"2017-07-25","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":1291,"ip":null,"mlb_id":"646240","org":"BOS","outcome_state":"REACHED_MLB","pa":5577,"person_url":"https://statsapi.mlb.com/api/v1/people/646240","reached":true,"signing_year":2013,"slug":"rafael-devers","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"Reached MLB: MLB debut 2019-03-28 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"jimenel02","career_bwar":5.17,"confidence":"VERIFIED","current_status":"Active per the MLB person record through 2026-10-05","debut":"2019-03-28","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":546,"ip":null,"mlb_id":"650391","org":"CHC","outcome_state":"REACHED_MLB","pa":2161,"person_url":"https://statsapi.mlb.com/api/v1/people/650391","reached":true,"signing_year":2013,"slug":"eloy-jimenez","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"650400","org":"CHC","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/650400","reached":false,"signing_year":2013,"slug":"erling-moreno","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"Reached MLB: MLB debut 2018-04-22 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"torregl01","career_bwar":20.91,"confidence":"VERIFIED","current_status":"Active per the MLB person record through 2026-10-05","debut":"2018-04-22","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":1129,"ip":null,"mlb_id":"650402","org":"CHC","outcome_state":"REACHED_MLB","pa":4721,"person_url":"https://statsapi.mlb.com/api/v1/people/650402","reached":true,"signing_year":2013,"slug":"gleyber-torres","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"650508","org":"COL","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/650508","reached":false,"signing_year":2013,"slug":"carlos-herrera","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"650510","org":"COL","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/650510","reached":false,"signing_year":2013,"slug":"erick-julio","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660639","org":"COL","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660639","reached":false,"signing_year":2014,"slug":"pedro-gonzalez","supports":["MLB_REACH","ACTIVE_STATUS"]},{"bref_id":null,"mlb_id":null,"org":"COL","reached":null,"signing_year":2014,"slug":"yeremy-rosario"},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"658535","org":"CWS","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/658535","reached":false,"signing_year":2014,"slug":"amado-nunez","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"658532","org":"CWS","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/658532","reached":false,"signing_year":2014,"slug":"jhoandro-alfaro","supports":["MLB_REACH","ACTIVE_STATUS"]},{"bref_id":null,"mlb_id":null,"org":"CWS","reached":null,"signing_year":2013,"slug":"micker-zapata"},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660699","org":"DET","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660699","reached":false,"signing_year":2014,"slug":"julio-martinez","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"658530","org":"HOU","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/658530","reached":false,"signing_year":2014,"slug":"franklin-perez","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"658531","org":"HOU","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/658531","reached":false,"signing_year":2014,"slug":"miguel-angel-sierra","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"658665","org":"HOU","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/658665","reached":false,"signing_year":2014,"slug":"ronny-rafael","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"645282","org":"KC","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/645282","reached":false,"signing_year":2013,"slug":"marten-gasparini","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660615","org":"KC","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660615","reached":false,"signing_year":2014,"slug":"ricky-aracena","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"650691","org":"MIL","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/650691","reached":false,"signing_year":2013,"slug":"franly-mallen","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"658677","org":"MIL","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/658677","reached":false,"signing_year":2014,"slug":"gilbert-lara","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"650693","org":"MIL","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/650693","reached":false,"signing_year":2013,"slug":"nicolas-pierre","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"Reached MLB: MLB debut 2019-06-16 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"ynoahu01","career_bwar":1.06,"confidence":"VERIFIED","current_status":"Active per the MLB person record through 2026-10-05","debut":"2019-06-16","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":62,"ip":"122.1","mlb_id":"660623","org":"MIN","outcome_state":"REACHED_MLB","pa":32,"person_url":"https://statsapi.mlb.com/api/v1/people/660623","reached":true,"signing_year":2014,"slug":"huascar-ynoa","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"Reached MLB: MLB debut 2020-08-15 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"diazle01","career_bwar":0.13,"confidence":"VERIFIED","current_status":"Not active per the MLB person record through 2026-10-05","debut":"2020-08-15","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":112,"ip":null,"mlb_id":"650331","org":"MIN","outcome_state":"REACHED_MLB","pa":343,"person_url":"https://statsapi.mlb.com/api/v1/people/650331","reached":true,"signing_year":2013,"slug":"lewin-diaz","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660660","org":"NYM","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660660","reached":false,"signing_year":2014,"slug":"kenny-hernandez","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660626","org":"NYY","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660626","reached":false,"signing_year":2014,"slug":"antonio-arias","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"Reached MLB: MLB debut 2022-07-12 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"garcide02","career_bwar":0.5,"confidence":"VERIFIED","current_status":"Not active per the MLB person record through 2026-10-05","debut":"2022-07-12","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":39,"ip":null,"mlb_id":"660650","org":"NYY","outcome_state":"REACHED_MLB","pa":125,"person_url":"https://statsapi.mlb.com/api/v1/people/660650","reached":true,"signing_year":2014,"slug":"dermis-garcia","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"Reached MLB: MLB debut 2022-04-07 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"castidi02","career_bwar":-0.77,"confidence":"VERIFIED","current_status":"Active per the MLB person record through 2026-10-05","debut":"2022-04-07","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":103,"ip":"2.0","mlb_id":"660636","org":"NYY","outcome_state":"REACHED_MLB","pa":292,"person_url":"https://statsapi.mlb.com/api/v1/people/660636","reached":true,"signing_year":2014,"slug":"diego-castillo","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"Reached MLB: MLB debut 2021-07-16 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"parkho01","career_bwar":-0.63,"confidence":"VERIFIED","current_status":"Not active per the MLB person record through 2026-10-05","debut":"2021-07-16","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":68,"ip":null,"mlb_id":"660829","org":"NYY","outcome_state":"REACHED_MLB","pa":210,"person_url":"https://statsapi.mlb.com/api/v1/people/660829","reached":true,"signing_year":2014,"slug":"hyo-jun-park","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"bref_id":null,"mlb_id":null,"org":"NYY","reached":null,"signing_year":2014,"slug":"jonathan-amundaray"},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660665","org":"NYY","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660665","reached":false,"signing_year":2014,"slug":"juan-deleon","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660560","org":"NYY","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660560","reached":false,"signing_year":2014,"slug":"miguel-flames","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660617","org":"NYY","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660617","reached":false,"signing_year":2014,"slug":"nelson-gomez","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660564","org":"NYY","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660564","reached":false,"signing_year":2014,"slug":"wilkerman-garcia","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"645289","org":"OAK","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/645289","reached":false,"signing_year":2013,"slug":"carlos-hiciano","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660614","org":"PHI","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660614","reached":false,"signing_year":2014,"slug":"arquimedes-gamboa","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660616","org":"SD","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660616","reached":false,"signing_year":2014,"slug":"ricardo-rodriguez","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"659910","org":"SEA","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/659910","reached":false,"signing_year":2014,"slug":"brayan-hernandez","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"650849","org":"SEA","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/650849","reached":false,"signing_year":2013,"slug":"greifer-andrade","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660632","org":"TB","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660632","reached":false,"signing_year":2014,"slug":"adrian-rondon","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"650954","org":"TEX","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/650954","reached":false,"signing_year":2013,"slug":"jose-almonte","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"Reached MLB: MLB debut 2021-08-06 in the official MLB Stats API person record (retrieved 2026-10-12); identity from the existing DISI MLB id.","bref_id":"diplama01","career_bwar":0.38,"confidence":"VERIFIED","current_status":"Active per the MLB person record through 2026-10-05","debut":"2021-08-06","evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":56,"ip":"35.2","mlb_id":"650959","org":"TEX","outcome_state":"REACHED_MLB","pa":0,"person_url":"https://statsapi.mlb.com/api/v1/people/650959","reached":true,"signing_year":2013,"slug":"marcos-diplan","supports":["MLB_REACH","MLB_DEBUT_DATE","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Active in affiliated baseball with no MLB debut in the MLB person record","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"650958","org":"TEX","outcome_state":"NO_MLB_ACTIVE_IN_MINORS","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/650958","reached":false,"signing_year":2013,"slug":"michael-deleon","supports":["MLB_REACH","ACTIVE_STATUS"]},{"bref_id":null,"mlb_id":null,"org":"TEX","reached":null,"signing_year":2013,"slug":"yeyson-yrizarry"},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"660565","org":"TOR","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/660565","reached":false,"signing_year":2014,"slug":"juan-meza","supports":["MLB_REACH","ACTIVE_STATUS"]},{"audit_note":"No MLB debut in the official MLB Stats API person record through 2026-10-05 (retrieved 2026-10-12); this is the absence of a recorded debut, not proof of a career end.","bref_id":null,"career_bwar":null,"confidence":"MEDIUM","current_status":"Not flagged active in the MLB person record; no MLB debut recorded; affiliated status not otherwise established","debut":null,"evidence_note":"MLB Stats API person record and regular-season career statistics, retrieved 2026-10-12.","games":null,"ip":null,"mlb_id":"650988","org":"TOR","outcome_state":"NO_MLB_STATUS_UNKNOWN","pa":null,"person_url":"https://statsapi.mlb.com/api/v1/people/650988","reached":false,"signing_year":2013,"slug":"yeltsin-gudino","supports":["MLB_REACH","ACTIVE_STATUS"]}],"retrieved_at":"2026-10-12T00:00:00Z","sources":[{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 645282","url":"https://statsapi.mlb.com/api/v1/people/645282"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 645289","url":"https://statsapi.mlb.com/api/v1/people/645289"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 645444","url":"https://statsapi.mlb.com/api/v1/people/645444"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 646240","url":"https://statsapi.mlb.com/api/v1/people/646240"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650331","url":"https://statsapi.mlb.com/api/v1/people/650331"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650391","url":"https://statsapi.mlb.com/api/v1/people/650391"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650400","url":"https://statsapi.mlb.com/api/v1/people/650400"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650402","url":"https://statsapi.mlb.com/api/v1/people/650402"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650508","url":"https://statsapi.mlb.com/api/v1/people/650508"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650510","url":"https://statsapi.mlb.com/api/v1/people/650510"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650691","url":"https://statsapi.mlb.com/api/v1/people/650691"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650693","url":"https://statsapi.mlb.com/api/v1/people/650693"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650849","url":"https://statsapi.mlb.com/api/v1/people/650849"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650954","url":"https://statsapi.mlb.com/api/v1/people/650954"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650958","url":"https://statsapi.mlb.com/api/v1/people/650958"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650959","url":"https://statsapi.mlb.com/api/v1/people/650959"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 650988","url":"https://statsapi.mlb.com/api/v1/people/650988"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 658530","url":"https://statsapi.mlb.com/api/v1/people/658530"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 658531","url":"https://statsapi.mlb.com/api/v1/people/658531"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 658532","url":"https://statsapi.mlb.com/api/v1/people/658532"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 658535","url":"https://statsapi.mlb.com/api/v1/people/658535"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 658665","url":"https://statsapi.mlb.com/api/v1/people/658665"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 658677","url":"https://statsapi.mlb.com/api/v1/people/658677"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 659261","url":"https://statsapi.mlb.com/api/v1/people/659261"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 659262","url":"https://statsapi.mlb.com/api/v1/people/659262"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 659910","url":"https://statsapi.mlb.com/api/v1/people/659910"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660560","url":"https://statsapi.mlb.com/api/v1/people/660560"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660564","url":"https://statsapi.mlb.com/api/v1/people/660564"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660565","url":"https://statsapi.mlb.com/api/v1/people/660565"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660614","url":"https://statsapi.mlb.com/api/v1/people/660614"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660615","url":"https://statsapi.mlb.com/api/v1/people/660615"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660616","url":"https://statsapi.mlb.com/api/v1/people/660616"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660617","url":"https://statsapi.mlb.com/api/v1/people/660617"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660623","url":"https://statsapi.mlb.com/api/v1/people/660623"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660626","url":"https://statsapi.mlb.com/api/v1/people/660626"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660632","url":"https://statsapi.mlb.com/api/v1/people/660632"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660636","url":"https://statsapi.mlb.com/api/v1/people/660636"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660639","url":"https://statsapi.mlb.com/api/v1/people/660639"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660650","url":"https://statsapi.mlb.com/api/v1/people/660650"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660660","url":"https://statsapi.mlb.com/api/v1/people/660660"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660665","url":"https://statsapi.mlb.com/api/v1/people/660665"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660699","url":"https://statsapi.mlb.com/api/v1/people/660699"},{"notes":"Official MLB person record and regular-season career statistics.","source_name":"MLB Stats API","source_tier":"MILB_MLB_PLAYER_RECORD","source_type":"MLB_PLAYER_RECORD","title":"MLB person record: player 660829","url":"https://statsapi.mlb.com/api/v1/people/660829"}],"war":{"bat_url":"https://www.baseball-reference.com/data/war_daily_bat.txt","observed_through_date":"2026-09-28","observed_through_season":2026,"pitch_url":"https://www.baseball-reference.com/data/war_daily_pitch.txt","retrieved_at":"2026-10-10T07:36:40Z","rows":[["castidi02","660636",2022,"PIT",1,"BAT","NL","-0.68",96,283,null],["castidi02","660636",2022,"PIT",1,"PITCH","NL","-0.26",2,null,6],["castidi02","660636",2023,"ARI",1,"BAT","NL","-0.03",1,1,null],["castidi02","660636",2024,"MIN",1,"BAT","AL","0.20",4,8,null],["deverra01","646240",2017,"BOS",1,"BAT","AL","0.70",58,240,null],["deverra01","646240",2018,"BOS",1,"BAT","AL","0.41",121,490,null],["deverra01","646240",2019,"BOS",1,"BAT","AL","5.42",156,702,null],["deverra01","646240",2020,"BOS",1,"BAT","AL","0.78",57,248,null],["deverra01","646240",2021,"BOS",1,"BAT","AL","3.59",156,664,null],["deverra01","646240",2022,"BOS",1,"BAT","AL","4.47",141,614,null],["deverra01","646240",2023,"BOS",1,"BAT","AL","3.50",153,656,null],["deverra01","646240",2024,"BOS",1,"BAT","AL","3.92",138,601,null],["deverra01","646240",2025,"BOS",1,"BAT","AL","2.41",73,334,null],["deverra01","646240",2025,"SFG",2,"BAT","NL","1.85",90,395,null],["deverra01","646240",2026,"SFG",1,"BAT","NL","3.57",148,633,null],["diazle01","650331",2020,"MIA",1,"BAT","NL","-0.31",14,41,null],["diazle01","650331",2021,"MIA",1,"BAT","NL","0.92",40,128,null],["diazle01","650331",2022,"MIA",1,"BAT","NL","-0.48",58,174,null],["diplama01","650959",2021,"BAL",1,"BAT","AL","0.00",1,0,null],["diplama01","650959",2021,"BAL",1,"PITCH","AL","0.28",23,null,90],["diplama01","650959",2022,"BAL",1,"BAT","AL",null,0,0,null],["diplama01","650959",2022,"BAL",1,"PITCH","AL","0.10",5,null,17],["espinan01","659262",2022,"CHC",1,"BAT","NL",null,0,0,null],["espinan01","659262",2022,"CHC",1,"PITCH","NL","-0.02",7,null,55],["garcide02","660650",2022,"OAK",1,"BAT","AL","0.50",39,125,null],["herrejo04","645444",2022,"ARI",1,"BAT","NL","-0.26",47,124,null],["herrejo04","645444",2023,"ARI",1,"BAT","NL","-0.16",41,120,null],["herrejo04","645444",2023,"ARI",1,"PITCH","NL","-0.04",2,null,6],["herrejo04","645444",2024,"ARI",1,"BAT","NL","-0.24",42,114,null],["herrejo04","645444",2025,"ARI",1,"BAT","NL","0.04",57,204,null],["herrejo04","645444",2025,"ARI",1,"PITCH","NL","0.01",2,null,6],["jimenel02","650391",2019,"CHW",1,"BAT","AL","1.56",122,504,null],["jimenel02","650391",2020,"CHW",1,"BAT","AL","1.43",55,226,null],["jimenel02","650391",2021,"CHW",1,"BAT","AL","0.65",55,231,null],["jimenel02","650391",2022,"CHW",1,"BAT","AL","1.90",84,327,null],["jimenel02","650391",2023,"CHW",1,"BAT","AL","0.53",120,489,null],["jimenel02","650391",2024,"CHW",1,"BAT","AL","-0.55",65,249,null],["jimenel02","650391",2024,"BAL",2,"BAT","AL","-0.25",33,100,null],["jimenel02","650391",2026,"TOR",1,"BAT","AL","-0.10",12,35,null],["parkho01","660829",2021,"NYY",1,"BAT","AL","-0.03",1,1,null],["parkho01","660829",2021,"PIT",2,"BAT","NL","-0.34",44,149,null],["parkho01","660829",2022,"PIT",1,"BAT","NL","-0.26",23,60,null],["torregl01","650402",2018,"NYY",1,"BAT","AL","3.44",123,484,null],["torregl01","650402",2019,"NYY",1,"BAT","AL","2.91",144,604,null],["torregl01","650402",2020,"NYY",1,"BAT","AL","-0.03",42,160,null],["torregl01","650402",2021,"NYY",1,"BAT","AL","0.70",127,516,null],["torregl01","650402",2022,"NYY",1,"BAT","AL","4.05",140,572,null],["torregl01","650402",2023,"NYY",1,"BAT","AL","2.92",158,672,null],["torregl01","650402",2024,"NYY",1,"BAT","AL","1.88",154,665,null],["torregl01","650402",2025,"DET",1,"BAT","AL","3.02",145,628,null],["torregl01","650402",2026,"DET",1,"BAT","AL","2.02",96,420,null],["ynoahu01","660623",2019,"ATL",1,"BAT","NL","0.00",2,0,null],["ynoahu01","660623",2019,"ATL",1,"PITCH","NL","-0.17",2,null,9],["ynoahu01","660623",2020,"ATL",1,"BAT","NL",null,0,0,null],["ynoahu01","660623",2020,"ATL",1,"PITCH","NL","0.05",9,null,65],["ynoahu01","660623",2021,"ATL",1,"BAT","NL","0.33",18,32,null],["ynoahu01","660623",2021,"ATL",1,"PITCH","NL","1.30",18,null,273],["ynoahu01","660623",2022,"ATL",1,"BAT","NL",null,0,0,null],["ynoahu01","660623",2022,"ATL",1,"PITCH","NL","-0.45",2,null,20]],"source_urls":["https://www.baseball-reference.com/data/war_daily_bat.txt","https://www.baseball-reference.com/data/war_daily_pitch.txt"]}}$m035$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
declare
  p jsonb;
  n int;
begin
  if to_regclass('public.transaction_asset_timing_observations') is null or to_regclass('public.v_downstream_organizational_realization') is null then
    raise exception '035: Migration 034 has not been applied';
  end if;
  for p in select x from _m035, jsonb_array_elements(j -> 'war' -> 'source_urls') x loop
    if not exists (select 1 from public.sources where url = p #>> '{}') then
      raise exception '035: the Baseball-Reference data file source % is not registered', p #>> '{}';
    end if;
  end loop;
  -- every benchmark player exists as a non-Dodgers Top-prospect signing of the recorded class, with the identity the research used
  for p in select x from _m035, jsonb_array_elements(j -> 'players') x loop
    select count(*) into n
    from public.players pl join public.signings s on s.player_id = pl.id join public.organizations o on o.id = s.organization_id
    where pl.slug = p ->> 'slug' and o.abbreviation = p ->> 'org' and s.signing_year = (p ->> 'signing_year')::int
      and s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
      and (p ->> 'mlb_id' is null or pl.mlb_id is null or pl.mlb_id = (p ->> 'mlb_id')::bigint)
      and (p ->> 'bref_id' is null or pl.bref_id is null or pl.bref_id = p ->> 'bref_id');
    if n <> 1 then
      raise exception '035: benchmark player % (%, %) was not found exactly once with the researched identity', p ->> 'slug', p ->> 'org', p ->> 'signing_year';
    end if;
  end loop;
  -- nothing the data would add exists with different content
  select count(*) into n from _m035, jsonb_array_elements(j -> 'players') x
  join public.players pl on pl.slug = x ->> 'slug'
  join public.outcome_audits a on a.player_id = pl.id
  where a.reached_mlb_verified is distinct from (x ->> 'reached')::boolean;
  if n <> 0 then
    raise exception '035: % benchmark outcome audit(s) already exist with a different result', n;
  end if;
end $$;

-- ===========================================================================
-- 2. SOURCES
-- ===========================================================================

insert into public.sources (source_name, source_type, title, url, notes, source_tier, accessed_at)
select x ->> 'source_name', x ->> 'source_type', x ->> 'title', x ->> 'url', x ->> 'notes', x ->> 'source_tier', (j ->> 'retrieved_at')::timestamptz
from _m035, jsonb_array_elements(j -> 'sources') x
on conflict (url) do nothing;

-- ===========================================================================
-- 3. OUTCOME EVIDENCE, AUDITS AND OUTCOMES (the Dodgers outcome-audit stores, same conventions)
-- ===========================================================================

insert into public.outcome_evidence (player_id, source_id, supports_fields, confidence, note)
select pl.id, so.id, array(select jsonb_array_elements_text(x -> 'supports')), (x ->> 'confidence')::public.confidence_level, x ->> 'evidence_note'
from _m035, jsonb_array_elements(j -> 'players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = x ->> 'person_url'
where x ->> 'mlb_id' is not null
on conflict (player_id, source_id) do nothing;

insert into public.outcome_audits (player_id, audited_through_date, reached_mlb_verified, source_id, confidence, audit_note, outcome_state)
select pl.id, (j ->> 'audit_through_date')::date, (x ->> 'reached')::boolean, so.id, (x ->> 'confidence')::public.confidence_level, x ->> 'audit_note', x ->> 'outcome_state'
from _m035, jsonb_array_elements(j -> 'players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = x ->> 'person_url'
where x ->> 'mlb_id' is not null
on conflict (player_id) do nothing;

insert into public.outcomes (player_id, reached_mlb, mlb_debut_date, mlb_games, mlb_pa, mlb_ip, career_war, current_status, outcome_through_season, source_id, confidence)
select pl.id, true, (x ->> 'debut')::date, nullif(x ->> 'games', '')::int, nullif(x ->> 'pa', '')::int, nullif(x ->> 'ip', '')::numeric, (x ->> 'career_bwar')::numeric,
       x ->> 'current_status', (j ->> 'outcome_through_season')::int, so.id, 'VERIFIED'
from _m035, jsonb_array_elements(j -> 'players') x
join public.players pl on pl.slug = x ->> 'slug'
join public.sources so on so.url = x ->> 'person_url'
where (x ->> 'reached')::boolean
on conflict (player_id) do nothing;

-- ===========================================================================
-- 4. TEAM-SEASON FACTS OF THE BENCHMARK PLAYERS WHO REACHED MLB (same Baseball-Reference files and method as 032 - 034)
-- ===========================================================================

insert into public.player_mlb_team_season_war (bref_id, mlb_id, player_id, season, bref_team_code, organization_id, stint_ordinal, component, war, games,
  plate_appearances, ip_outs, league, source_id, observed_through_date, observed_through_season, retrieved_at, confidence, note)
select r ->> 0, r ->> 1, pl.id, (r ->> 2)::int, r ->> 3, m.organization_id, (r ->> 4)::int, r ->> 5, nullif(r ->> 7, '')::numeric, nullif(r ->> 8, '')::int,
       nullif(r ->> 9, '')::int, nullif(r ->> 10, '')::int, nullif(r ->> 6, ''), so.id,
       (j -> 'war' ->> 'observed_through_date')::date, (j -> 'war' ->> 'observed_through_season')::int, (j -> 'war' ->> 'retrieved_at')::timestamptz, 'VERIFIED',
       case when r ->> 7 is null then 'The data file has no WAR for this zero-plate-appearance row; stored as NULL, not zero.' end
from _m035 cross join lateral jsonb_array_elements(j -> 'war' -> 'rows') r
join public.sources so on so.url = case when r ->> 5 = 'BAT' then j -> 'war' ->> 'bat_url' else j -> 'war' ->> 'pitch_url' end
left join public.players pl on pl.bref_id = r ->> 0
left join lateral (
  select m2.organization_id from public.bref_team_code_map m2
  where m2.bref_team_code = r ->> 3 and (r ->> 2)::int >= m2.from_season and (r ->> 2)::int <= coalesce(m2.to_season, 9999)
  order by m2.from_season desc limit 1
) m on true
on conflict (bref_id, season, bref_team_code, stint_ordinal, component) where record_status = 'ACTIVE' do nothing;

-- ===========================================================================
-- 5. VIEWS
-- ===========================================================================

-- ===========================================================================
-- Migration 035 views: benchmark outcomes, class coverage, research queue
-- ===========================================================================

-- One row per signing of the benchmark scope (MLB Pipeline Top-prospect signings, every organization including the Dodgers):
-- outcome state, debut, years to debut season, direct (original-organization) and elsewhere bWAR where team-season facts exist, and
-- which comparison tiers the row can support. An unaudited player is UNAUDITED with a NULL reach flag: missing is never "no MLB".
create or replace view public.v_international_benchmark_player_outcomes
with (security_invoker = true)
as
with m as materialized (
  with as_of as (select max(audited_through_date) as analysis_as_of_date from public.outcome_audits),
  mem as (
    select m.signing_id, array_agg(sp.population_key order by sp.population_key) as population_keys,
      (array_agg(sp.population_scope order by sp.population_key))[1] as population_scope
    from public.signing_population_members m join public.signing_populations sp on sp.id = m.population_id
    group by m.signing_id
  ),
  war as (
    select w.bref_id,
      count(*)::int as team_season_rows,
      count(*) filter (where w.organization_id is null)::int as unmapped_rows,
      sum(w.war) as career_bwar,
      sum(w.war) filter (where og.franchise_key = f.franchise_key) as original_org_bwar,
      sum(w.war) filter (where og.franchise_key is distinct from f.franchise_key and w.organization_id is not null) as elsewhere_bwar,
      max(w.season) as last_season
    from public.player_mlb_team_season_war w
    left join public.organizations og on og.id = w.organization_id
    join public.players pl on pl.bref_id = w.bref_id
    join public.signings s on s.player_id = pl.id
    join public.organizations f on f.id = s.organization_id
    where w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
    group by w.bref_id, f.franchise_key
  )
  select
    s.id as signing_id, pl.id as player_id, pl.slug as player_slug, pl.full_name,
    o.abbreviation as organization, o.franchise_key, (o.franchise_key = 'DODGERS') as is_dodgers,
    s.signing_year, s.country_market, s.pathway, s.record_scope,
    coalesce(pl.primary_position, s.position_at_signing) as primary_position,
    s.international_rank, s.rank_source,
    mem.population_keys, mem.population_scope,
    s.signing_bonus_usd, f.known_acquisition_cost_usd, f.acquisition_cost_completeness,
    pl.birth_date,
    case when pl.birth_date is not null then s.signing_year - extract(year from pl.birth_date)::int end as age_in_signing_year,
    (pl.mlb_id is not null) as identity_resolved,
    case when a.player_id is null then 'UNAUDITED' else a.outcome_state end as outcome_state,
    a.reached_mlb_verified,
    a.audited_through_date,
    a.confidence::text as audit_confidence,
    oc.mlb_debut_date,
    case when oc.mlb_debut_date is not null then extract(year from oc.mlb_debut_date)::int - s.signing_year end as years_signing_to_debut_season,
    w.team_season_rows, w.career_bwar, w.original_org_bwar, w.elsewhere_bwar,
    w.last_season as bwar_last_season,
    (s.signing_year <= extract(year from ao.analysis_as_of_date)::int - 5) as is_mature,
    ao.analysis_as_of_date,
    -- tier 1: reach / age / bonus / time to MLB are comparable across organizations once audited; tier 2 additionally needs loaded
    -- team-season facts; tier 3 (organizational realization with transaction lineage) exists for the Dodgers only
    (a.player_id is not null) as tier1_reach_comparable,
    (a.reached_mlb_verified is true and w.team_season_rows > 0 and w.unmapped_rows = 0) as tier2_original_org_bwar_comparable,
    false as tier3_organizational_realization_comparable
  from public.signings s
  join public.players pl on pl.id = s.player_id
  join public.organizations o on o.id = s.organization_id
  join public.v_signing_acquisition_financials f on f.signing_id = s.id
  left join mem on mem.signing_id = s.id
  left join public.outcome_audits a on a.player_id = pl.id
  left join public.outcomes oc on oc.player_id = pl.id
  left join war w on w.bref_id = pl.bref_id
  cross join as_of ao
  where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
)
select * from m;

comment on view public.v_international_benchmark_player_outcomes is
  'One row per Top-prospect-tracker signing (every organization). This is a prospect-rank-selected sample, not a census and not an organization population: a tracker row says the player was a ranked prospect, so reach and bWAR describe ranked prospects only. outcome_state is UNAUDITED (reached flag NULL, never false) until an outcome audit exists. original_org_bwar sums team-season bWAR with the signing organization''s franchise, elsewhere_bwar the rest; each is NULL when no loaded team-season row exists for that side (no season with the organization is not a zero-WAR season, and no loaded facts is not a zero). The three tier flags say which comparisons the row can support; organizational realization (tier 3) is Dodgers-only context and is not comparable. No rank, percentile or organization ordering is computed.';

-- One row per tracked signing population: what it is, how much of it DISI holds, how much is audited, and whether it can support an
-- organizational rate. rate_eligible_strict is derived and deliberately demanding; the legacy rate_analysis_suitable flag is shown
-- beside it, never trusted in its place.
create or replace view public.v_international_benchmark_class_coverage
with (security_invoker = true)
as
with m as materialized (
  with as_of as (select max(audited_through_date) as analysis_as_of_date from public.outcome_audits),
  mem as (
    select m.population_id, o.franchise_key,
      count(*)::int as members,
      count(*) filter (where p.mlb_id is not null)::int as members_identity_resolved,
      count(*) filter (where a.player_id is not null)::int as members_audited,
      count(*) filter (where a.reached_mlb_verified is true)::int as members_reached,
      count(*) filter (where s.signing_bonus_usd is not null)::int as members_bonus_known,
      count(*) filter (where f.acquisition_cost_completeness = 'COMPLETE')::int as members_cost_complete,
      count(*) filter (where o.franchise_key = 'DODGERS')::int as dodgers_members
    from public.signing_population_members m
    join public.signings s on s.id = m.signing_id
    join public.players p on p.id = s.player_id
    join public.organizations o on o.id = s.organization_id
    join public.v_signing_acquisition_financials f on f.signing_id = s.id
    left join public.outcome_audits a on a.player_id = p.id
    group by m.population_id, o.franchise_key
  ),
  agg as (
    select population_id, sum(members)::int as members, sum(members_identity_resolved)::int as members_identity_resolved,
      sum(members_audited)::int as members_audited, sum(members_reached)::int as members_reached, sum(members_bonus_known)::int as members_bonus_known,
      sum(members_cost_complete)::int as members_cost_complete, sum(dodgers_members)::int as dodgers_members,
      count(distinct franchise_key)::int as organizations
    from mem group by population_id
  )
  select
    sp.population_key, sp.franchise_key, sp.population_scope, sp.period_label, sp.class_year_start, sp.class_year_end,
    sp.expected_size, sp.rate_analysis_suitable as legacy_rate_analysis_suitable,
    coalesce(g.members, 0) as members, coalesce(g.members_identity_resolved, 0) as members_identity_resolved,
    coalesce(g.members_audited, 0) as members_audited, coalesce(g.members_reached, 0) as members_reached,
    coalesce(g.members_bonus_known, 0) as members_bonus_known, coalesce(g.members_cost_complete, 0) as members_cost_complete,
    coalesce(g.organizations, 0) as organizations, coalesce(g.dodgers_members, 0) as dodgers_members,
    (sp.class_year_end <= extract(year from ao.analysis_as_of_date)::int - 5) as is_mature,
    case
      when sp.population_scope = 'FULL_SIGNING_PERIOD' and sp.expected_size is not null and coalesce(g.members, 0) = sp.expected_size then 'CENSUS_COMPLETE'
      when sp.population_scope = 'FULL_SIGNING_PERIOD' and coalesce(g.members, 0) > 0 then 'CENSUS_PARTIAL'
      when sp.population_scope = 'FULL_SIGNING_PERIOD' then 'UNKNOWN_COVERAGE'
      when sp.population_scope = 'TOP_PROSPECT_SAMPLE' then 'TOP_PROSPECT_SAMPLE'
      when sp.population_scope = 'HISTORICAL_VERIFIED_SET' then 'VERIFIED_SAMPLE'
      when sp.population_scope = 'OPENING_CLASS' then 'OPENING_CLASS_PARTIAL'
      else 'CURATED_SAMPLE' end as census_state,
    ao.analysis_as_of_date
  from public.signing_populations sp
  left join agg g on g.population_id = sp.id
  cross join as_of ao
),
x as (
  select m.*,
    array_remove(array[
      case when population_scope <> 'FULL_SIGNING_PERIOD' then 'NOT_A_FULL_SIGNING_PERIOD' end,
      case when expected_size is null then 'DENOMINATOR_NOT_SOURCED' end,
      case when expected_size is not null and members <> expected_size then 'MEMBERS_DO_NOT_EQUAL_EXPECTED_SIZE' end,
      case when members_audited < members or members = 0 then 'OUTCOMES_NOT_FULLY_AUDITED' end,
      case when members_identity_resolved < members or members = 0 then 'IDENTITIES_NOT_FULLY_RESOLVED' end,
      case when not is_mature then 'COHORT_NOT_MATURE' end
    ], null) as rate_blockers
  from m
)
select
  population_key, franchise_key, population_scope, period_label, class_year_start, class_year_end,
  expected_size, members, members_identity_resolved, members_audited, members_reached, members_bonus_known, members_cost_complete,
  organizations, dodgers_members, is_mature, census_state,
  (cardinality(rate_blockers) = 0) as rate_eligible_strict,
  rate_blockers,
  legacy_rate_analysis_suitable,
  case when cardinality(rate_blockers) = 0 then 'CLASS_COMPLETE_COMPARISON' else 'SAMPLE_COMPARISON' end as comparison_label,
  (dodgers_members > 0) as has_dodgers_comparator,
  analysis_as_of_date
from x;

comment on view public.v_international_benchmark_class_coverage is
  'One row per signing population. census_state: CENSUS_COMPLETE only for a FULL_SIGNING_PERIOD whose sourced expected_size equals the members DISI holds; TOP_PROSPECT_SAMPLE, VERIFIED_SAMPLE, OPENING_CLASS_PARTIAL and CENSUS_PARTIAL are samples. rate_eligible_strict is true only for a full signing period with a sourced denominator, every member held, identified and outcome-audited, and a mature cohort; rate_blockers lists every unmet requirement. The legacy rate_analysis_suitable flag is shown beside it and is never used in its place. comparison_label is SAMPLE_COMPARISON unless the class is strictly eligible (CLASS_COMPLETE_COMPARISON); a league-rate comparison needs every organization''s class complete for one period and is not available for any period. No organization ranking is computed.';

-- Unresolved benchmark research, derived from the facts. Counts are never fixed.
create or replace view public.v_international_benchmark_research_queue
with (security_invoker = true)
as
with m as materialized (
  with issues as (
    select 'BENCHMARK_IDENTITY_UNRESOLVED'::text as issue, 1 as priority, o.player_slug, o.population_keys[1] as population_key, o.organization, o.signing_year,
      'The benchmark player has no MLB id: the outcome cannot be audited and no MLB reach is inferred'::text as detail
    from public.v_international_benchmark_player_outcomes o
    where o.is_dodgers is false and not o.identity_resolved
    union all
    select 'BENCHMARK_OUTCOME_UNAUDITED', 2, o.player_slug, o.population_keys[1], o.organization, o.signing_year,
      'An identity-resolved benchmark player has no MLB outcome audit; reach is unknown, not no'
    from public.v_international_benchmark_player_outcomes o
    where o.identity_resolved and o.outcome_state = 'UNAUDITED'
    union all
    select 'BENCHMARK_REACHED_WITHOUT_TEAM_SEASON_FACTS', 2, o.player_slug, o.population_keys[1], o.organization, o.signing_year,
      'A benchmark player who reached MLB has no loaded team-season bWAR facts; career and original-organization bWAR are unknown'
    from public.v_international_benchmark_player_outcomes o
    where o.reached_mlb_verified is true and coalesce(o.team_season_rows, 0) = 0
    union all
    select 'BENCHMARK_BONUS_UNKNOWN', 3, o.player_slug, o.population_keys[1], o.organization, o.signing_year,
      'The signing bonus is not sourced; bonus-based comparisons exclude this player'
    from public.v_international_benchmark_player_outcomes o
    where o.is_dodgers is false and o.signing_bonus_usd is null
    union all
    select 'POPULATION_MEMBERS_NOT_TRACKED', 2, null, c.population_key, null, c.class_year_start,
      format('The population names %s members; %s are tracked. Untracked members are unknown, not non-reachers', c.expected_size, c.members)
    from public.v_international_benchmark_class_coverage c
    where c.expected_size is not null and c.members < c.expected_size
    union all
    select 'POPULATION_DENOMINATOR_NOT_SOURCED', 3, null, c.population_key, null, c.class_year_start,
      'The population is flagged suitable for rate analysis in the legacy model but no sourced expected size exists; no rate is computed'
    from public.v_international_benchmark_class_coverage c
    where c.legacy_rate_analysis_suitable and c.expected_size is null
    union all
    select 'SAMPLE_HAS_NO_DODGERS_COMPARATOR', 4, null, c.population_key, null, c.class_year_start,
      'Informational: the sample has no Dodgers member, so no Dodgers-versus-sample comparison is possible within it'
    from public.v_international_benchmark_class_coverage c
    where c.census_state = 'TOP_PROSPECT_SAMPLE' and c.dodgers_members = 0
  )
  select i.issue, i.priority, i.player_slug, i.population_key, i.organization, i.signing_year, i.detail from issues i
)
select * from m;

comment on view public.v_international_benchmark_research_queue is
  'Unresolved international-benchmark research, derived from the facts: identity-unresolved or unaudited benchmark players, reachers without team-season facts, unknown bonuses, population members that are named but not tracked, rate-suitable populations with no sourced denominator, and (informationally) samples with no Dodgers comparator.';

-- ===========================================================================
-- 6. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['v_international_benchmark_player_outcomes', 'v_international_benchmark_class_coverage', 'v_international_benchmark_research_queue'] loop
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
    raise exception '035: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- every identity-resolved benchmark player has an audit and, when reached, an outcome row
  select count(*) into expected from _m035, jsonb_array_elements(j -> 'players') x where x ->> 'mlb_id' is not null;
  select count(*) into n from public.outcome_audits a join public.players pl on pl.id = a.player_id
  where pl.slug in (select x ->> 'slug' from _m035, jsonb_array_elements(j -> 'players') x where x ->> 'mlb_id' is not null);
  if n <> expected then
    raise exception '035 postcondition: % of % benchmark outcome audits are present', n, expected;
  end if;
  select count(*) into expected from _m035, jsonb_array_elements(j -> 'players') x where (x ->> 'reached')::boolean;
  select count(*) into n from public.outcomes oc join public.players pl on pl.id = oc.player_id
  where pl.slug in (select x ->> 'slug' from _m035, jsonb_array_elements(j -> 'players') x where (x ->> 'reached')::boolean);
  if n <> expected then
    raise exception '035 postcondition: % of % benchmark outcomes are present', n, expected;
  end if;
  select jsonb_array_length(j -> 'war' -> 'rows') into expected from _m035;
  select count(*) into n from public.player_mlb_team_season_war w
  where w.record_status = 'ACTIVE' and exists (select 1 from _m035, jsonb_array_elements(j -> 'war' -> 'rows') r
    where r ->> 0 = w.bref_id and (r ->> 2)::int = w.season and r ->> 3 = w.bref_team_code and (r ->> 4)::int = w.stint_ordinal and r ->> 5 = w.component);
  if n <> expected then
    raise exception '035 postcondition: % of % benchmark team-season rows are present', n, expected;
  end if;
  select count(*) into n from public.player_mlb_team_season_war where organization_id is null and record_status = 'ACTIVE';
  if n <> 0 then
    raise exception '035 postcondition: % loaded team-season row(s) have no organization', n;
  end if;
end $$;

commit;
