// Migration 057 research artifacts, without a database: the two approved archived Baseball-Reference captures pinned three ways, the reviewed
// scope (eleven complete-window reachers; four deferred 2016-class reachers; three unresolved identities; the transaction-value follow-up), the
// derived team-season rows (no partial 2026 season, no TOT row, one row per team stint), the labels and the support transition the rows give
// under the unchanged 041 rule, and the stored evaluation (no supported model).
//   BWAR != FWAR   PARTIAL SEASON != COMPLETE TEAM-SEASON EVIDENCE   BASELINE SUPPORTED != MODEL SUPPORTED

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { research, assemble } from '../../database/research/057/build.mjs'
import { base32, readCapture } from '../../database/research/057/fetch-sources.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/057', f), 'utf8'))
const capture = read('source-capture.json')
const scope = read('scope.json')
const evidence = read('war-evidence.json')
const evaluation = read('evaluation.json')
const RAW = path.join(root, 'research-output/057-work/raw')
const H = (w) => (w === null ? 0 : Math.round(Number(w) * 100))

test('sources: the two approved captures of the accepted Baseball-Reference files, pinned by archive digest, payload SHA-256 and decoded SHA-256', () => {
  const [bat, pitch] = ['BAT', 'PITCH'].map((c) => capture.files.find((f) => f.component === c))
  assert.deepEqual([bat.original_url, bat.wayback_timestamp, bat.url, bat.captured_at, bat.original_last_modified, bat.cdx_digest, bat.decoded_sha256, bat.data_rows, bat.max_season, bat.rows_in_max_season],
    ['https://www.baseball-reference.com/data/war_daily_bat.txt', '20260911214553', 'https://web.archive.org/web/20260911214553id_/https://www.baseball-reference.com/data/war_daily_bat.txt',
      '2026-09-11T21:45:53Z', '2026-09-11T04:57:41Z', 'CEBQTPXSHPR6RO2WZMQ7FK2LRRV575GV', 'ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023', 126529, 2026, 812])
  assert.deepEqual([pitch.original_url, pitch.wayback_timestamp, pitch.url, pitch.captured_at, pitch.original_last_modified, pitch.cdx_digest, pitch.decoded_sha256, pitch.data_rows, pitch.max_season],
    ['https://www.baseball-reference.com/data/war_daily_pitch.txt', '20260210222101', 'https://web.archive.org/web/20260210222101id_/https://www.baseball-reference.com/data/war_daily_pitch.txt',
      '2026-02-10T22:21:01Z', '2025-11-04T14:33:16Z', 'HW43HICGDZB6V2QAOFETX36ZQOQBY6UW', '3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825', 56860, 2025])
  assert.equal(capture.observed_through_season, 2025, 'the last season complete in both captures')
  assert.match(bat.max_season_state, /^MID_SEASON/)
  assert.match(capture.live_access.result, /HTTP 403/)
  for (const s of research.sources) {
    assert.deepEqual([s.source_name, s.source_type, s.source_tier], ['Baseball-Reference', 'WAR_DATA_FILE', 'BASEBALL_REFERENCE'], 'the existing source kind, never a secondary WAR table')
    assert.doesNotMatch(`${s.title} ${s.notes}`, /fangraphs|fWAR|WARP/i)
  }
  assert.equal(base32(Buffer.from('foobar')), 'MZXW6YTBOI', 'RFC 4648 base32, as the Internet Archive digest uses')
})

test('raw captures (when present locally): the archived payloads still match every recorded hash', { skip: !capture.files.every((f) => fs.existsSync(path.join(RAW, f.raw_file))) }, () => {
  for (const f of capture.files) assert.ok(readCapture(f, RAW).startsWith('name_common,age,mlb_ID,player_ID,year_ID,team_ID,stint_ID,lg_ID,'))
})

test('scope: eleven complete-window reachers; four 2016-class reachers deferred; three identities unresolved (Amundaray kept unresolved); transaction WAR out of scope', () => {
  assert.equal(scope.approved.length, 11)
  assert.ok(scope.approved.every((p) => p.horizon_end_season === p.signing_year + 10 && p.horizon_end_season <= 2025))
  assert.deepEqual(scope.deferred_incomplete_window.map((p) => [p.slug, p.horizon_end_season]),
    [['gabriel-arias', 2026], ['jorge-ona', 2026], ['luis-garcia-jr', 2026], ['francisco-morales', 2026]])
  assert.match(scope.deferred_reason, /PARTIAL SEASON != COMPLETE TEAM-SEASON EVIDENCE/)
  assert.deepEqual(scope.identity_unresolved.map((p) => [p.slug, p.state]), [['yeyson-yrizarry', 'CONFLICT'], ['yeremy-rosario', 'INSUFFICIENT_EVIDENCE'], ['jonathan-amundaray', 'INSUFFICIENT_EVIDENCE']])
  assert.match(scope.identity_unresolved[2].note, /KEEP UNRESOLVED.*660657.*no signing \(SFA\) transaction/)
  assert.equal(scope.transaction_value_follow_up.players.length, 4)
})

test('rows: 54 team-season rows for the eleven; every season complete (<= 2025); the eight 2026 rows excluded; one row per team stint; no TOT', () => {
  const rows = evidence.rows
  assert.equal(rows.length, 54)
  assert.deepEqual(evidence.row_format, ['bref_id', 'mlb_id', 'season', 'team', 'stint', 'component', 'league', 'war', 'games', 'pa', 'ip_outs'])
  assert.ok(rows.every((r) => r[2] <= 2025 && r[3] !== 'TOT' && ['BAT', 'PITCH'].includes(r[5])))
  assert.equal(new Set(rows.map((r) => [r[0], r[2], r[3], r[4], r[5]].join('|'))).size, 54)
  const brefs = new Set(scope.approved.map((p) => p.bref_id))
  assert.ok(rows.every((r) => brefs.has(r[0])))
  for (const b of ['ariasga01', 'onajo01', 'garcilu04', 'moralfr02', 'garlajo01', 'grantmu01', 'versazo01', 'leyriji01']) assert.ok(!rows.some((r) => r[0] === b), `${b} is not loaded`)
  assert.equal(evidence.excluded_rows.length, 8)
  assert.ok(evidence.excluded_rows.every((r) => r.season === 2026), 'only the mid-season 2026 rows are excluded')
  // a traded player's season is its stints, each once
  const stints = (b, y) => rows.filter((r) => r[0] === b && r[2] === y && r[5] === 'BAT').map((r) => `${r[4]}:${r[3]}:${r[7]}`)
  assert.deepEqual(stints('sotoju01', 2022), ['1:WSN:3.73', '2:SDP:1.74'])
  assert.deepEqual(stints('taverle01', 2025), ['1:TEX:0.05', '2:SEA:-0.63'])
  assert.deepEqual(stints('pachecr01', 2024), ['1:PHI:0.06', '2:BAL:0.05', '3:MIA:-0.32'])
  // NULL WAR stays NULL (DeJesus's zero-plate-appearance batting row); pitching WAR from the pitching file
  assert.deepEqual(rows.filter((r) => r[0] === 'dejesen01').map((r) => [r[5], r[7]]), [['BAT', null], ['PITCH', '-0.18']])
})

test('labels and support: the unchanged 041 rule on the rows gives 8 / 3 and 6 / 5; 86 / 15 / 71 supported, 86 / 9 / 77 one positive short', () => {
  for (const p of research.players) {
    const mine = evidence.rows.filter((r) => r[0] === p.bref_id && r[2] <= p.horizon_end_season)
    const sum = mine.reduce((s, r) => s + H(r[7]), 0)
    assert.equal(p.positive_bwar_label, sum > 0, `${p.slug}: positive bWAR is a sum above 0`)
    assert.equal(p.bwar_2_label, sum >= 200, `${p.slug}: 2+ bWAR is a sum of at least 2`)
    assert.equal(Math.round(Number(p.window_bwar) * 100), sum)
  }
  assert.deepEqual(Object.fromEntries(research.players.map((p) => [p.slug, p.window_bwar])), {
    'emmanuel-dejesus': '-0.18', 'vladimir-guerrero-jr': '25.73', 'gilberto-celestino': '0.24', 'cristian-pache': '-1.30', 'andres-gimenez': '19.37', 'leody-taveras': '4.70',
    'juan-soto': '42.57', 'miguel-amaya': '3.35', 'simon-muzziotti': '-0.05', 'fernando-tatis-jr': '27.34', 'rafael-marchan': '1.41' })
  assert.deepEqual([research.players.filter((p) => p.positive_bwar_label).length, research.players.filter((p) => p.bwar_2_label).length], [8, 6])
  assert.deepEqual(research.before.map((s) => [s.target_key, s.labelled_n, s.positive_n, s.negative_n, s.support_state]),
    [['POSITIVE_BWAR_WITHIN_10_SEASONS', 75, 7, 68, 'BASELINE_NOT_SUPPORTED'], ['BWAR_2_WITHIN_10_SEASONS', 75, 3, 72, 'BASELINE_NOT_SUPPORTED']])
  assert.deepEqual(research.after.map((s) => [s.target_key, s.labelled_n, s.positive_n, s.negative_n, s.support_state]),
    [['POSITIVE_BWAR_WITHIN_10_SEASONS', 86, 15, 71, 'BASELINE_SUPPORTED'], ['BWAR_2_WITHIN_10_SEASONS', 86, 9, 77, 'BASELINE_NOT_SUPPORTED']])
  assert.equal(research.unmoved.length, 5, 'four Dodgers rows and the benchmark reach row are proved unmoved')
})

test('evaluation: the unchanged 041 method on the 057 data; 88 rows, 4 folds, 14 / 9 positives; no fitted model supported; the reach evaluation reproduced exactly', () => {
  assert.deepEqual(evaluation.failures, [])
  assert.deepEqual(evaluation.targets.map((t) => [t.target, t.evaluated_rows, t.positives, t.negatives, t.folds, t.base_rate, t.fingerprint]), [
    ['POSITIVE_BWAR_WITHIN_10_SEASONS', 88, 14, 74, [2013, 2014, 2015, 2016], 0.159091, '102c01a35d380d36493465cef1070c07'],
    ['BWAR_2_WITHIN_10_SEASONS', 88, 9, 79, [2013, 2014, 2015, 2016], 0.102273, '1aa73185a9dab3071d4530ee670dd088']])
  assert.equal(evaluation.evaluations.length, 6)
  assert.ok(evaluation.evaluations.every((e) => e.decision !== 'MODEL_SUPPORTED' && e.validation_method === 'LEAVE_ONE_SIGNING_YEAR_OUT' && e.model_version === 'outcome-probability-v1'))
  const e = (t, m) => evaluation.evaluations.find((x) => x.target_key === t && x.model_key === m)
  assert.match(e('POSITIVE_BWAR_WITHIN_10_SEASONS', 'POPULATION_STRATIFIED_RATE').decision_reason, /^NO_SKILL_OVER_BASELINE: out-of-time Brier skill -0\.013963/)
  assert.match(e('POSITIVE_BWAR_WITHIN_10_SEASONS', 'LOGISTIC_L2').decision_reason, /^INSUFFICIENT_EVENTS: 14 positives for 6 feature\(s\); at least 60 are required/)
  assert.match(e('BWAR_2_WITHIN_10_SEASONS', 'POPULATION_STRATIFIED_RATE').decision_reason, /^INSUFFICIENT_EVENTS: 9 positives for 1 feature\(s\)/)
  assert.deepEqual(evaluation.reach_check, { fingerprint: '86b58f473301e2425751d853abd88e94', evaluated_rows: 173, positives: 34, folds: 7, equals_stored_056_rows: true })
})

test('build: the migration without its evaluation stores none; the SQL loads nothing outside the scope and changes no definition or threshold', () => {
  const noEval = assemble(null)
  const payload = JSON.parse(noEval.match(/\$m057\$([\s\S]*?)\$m057\$/)[1])
  assert.equal(payload.evaluation, null)
  assert.equal(payload.players.length, 11)
  assert.equal(payload.war.rows.length, 54)
  const body = noEval.replace(/\$m057\$[\s\S]*?\$m057\$/g, '')
  assert.doesNotMatch(body, /(insert into|update|delete from) public\.(outcome_targets|players|signings|outcome_audits|bref_team_code_map|player_metric_observations)\b/)
  assert.doesNotMatch(body.replace(/create temporary table _m057\w*/g, ''), /\b(create|alter|drop)\s+(table|view|function|trigger|policy|index)\b/i)
})
