// Migration 058 research artifacts, without a database: the four returned players and their trades, the rows read from the two 057 captures (no
// source added), the one reviewed exclusion (Versalles 1969 WSA), the credited rows under the existing attribution levels, the expected post-058
// value and queue state derived from the measured baseline, and the verifier's pin transition (the 057 layer keeps the pins, the head has none).
//   KNOWN RETURN WAR != ATTRIBUTABLE SIGNING VALUE   PACKAGE VALUE != PLAYER ATTRIBUTION   OLDER VIEW != VALUE OF RECORD

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { research, assemble, assembleRollback } from '../../database/research/058/build.mjs'
import { CANONICAL_EXPECTATIONS, EXPECTATIONS_THROUGH_057, EXPECTATIONS_THROUGH_055, EXPECTATIONS_THROUGH_053, EXPECTATIONS_THROUGH_052,
  EXPECTATIONS_THROUGH_049, EXPECTATIONS_THROUGH_048 } from '../../scripts/db/lib/invariants.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(root, 'database/research/058', f), 'utf8'))
const scope = read('scope.json')
const evidence = read('war-evidence.json')
const teamMap = read('team-code-map.json').codes
const capture = JSON.parse(fs.readFileSync(path.join(root, 'database/research/057/source-capture.json'), 'utf8'))
const H = (w) => (w === null ? 0 : Math.round(Number(w) * 100))
const key = (r) => [r[0], r[2], r[3], r[4], r[5]].join('|')

test('scope: exactly the four returned players, their MLBAM and Baseball-Reference ids, trades, exits and attribution levels', () => {
  assert.deepEqual(scope.players.map((p) => [p.name, p.mlb_id, p.bref_id, p.acquisition_event_key, p.exit_event_key, p.originating_signing_slug, p.attribution]), [
    ['Jon Garland', '279782', 'garlajo01', 'LAD_ARI_2009_TONY_ABREU', 'LAD_FREE_AGENCY_2009_JON_GARLAND', 'tony-abreu', 'PLAYER_ATTRIBUTABLE'],
    ['Jim Leyritz', '117747', 'leyriji01', 'LAD_NYY_2000_JOSE_VIZCAINO', 'LAD_FREE_AGENCY_2000_JIM_LEYRITZ', 'jose-vizcaino', 'PACKAGE_ATTRIBUTABLE'],
    ['Mudcat Grant', '115046', 'grantmu01', 'LAD_MIN_1967_BOB_MILLER', 'LAD_MON_1968_GRANT_EXPANSION', 'chico-fernandez', 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'],
    ['Zoilo Versalles', '123713', 'versazo01', 'LAD_MIN_1967_BOB_MILLER', 'LAD_SD_1968_VERSALLES_EXPANSION', 'chico-fernandez', 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE']])
  assert.deepEqual(scope.not_in_scope.war_not_loaded_assets.map((p) => p.name), ['Rick Roberts', 'Apostol Garcia', 'Danny Muegge', 'William Juarez'])
  assert.match(scope.not_in_scope.note, /never zero, and no observation is created/)
})

test('sources: the rows come from the two 057 captures, referenced and never re-registered', () => {
  assert.equal(scope.sources_reused_from, 'database/research/057/source-capture.json')
  assert.deepEqual(evidence.sources.map((s) => [s.component, s.decoded_sha256]), [
    ['BAT', 'ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023'], ['PITCH', '3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825']])
  assert.deepEqual(research.sources.map((s) => s.url), capture.files.map((f) => f.url))
  assert.ok(research.sources.every((s) => /\/web\/(20260911214553|20260210222101)id_\//.test(s.url)))
  const body = assemble().replace(/\$m058\$[\s\S]*?\$m058\$/g, '').replace(/--.*$/gm, '')
  assert.doesNotMatch(body, /insert into public\.sources/i, '058 inserts no source row')
})

test('rows: 91 (Garland 28 = 14 + 14, Leyritz 15, Grant 36 = 18 + 18, Versalles 12); every team mapped for its season; no TOT, no WSA, no partial season', () => {
  const rows = evidence.rows
  assert.equal(rows.length, 91)
  assert.equal(new Set(rows.map(key)).size, 91)
  const count = (b, c) => rows.filter((r) => r[0] === b && (!c || r[5] === c)).length
  assert.deepEqual([count('garlajo01'), count('garlajo01', 'BAT'), count('garlajo01', 'PITCH'), count('leyriji01'), count('grantmu01'), count('grantmu01', 'PITCH'), count('versazo01')],
    [28, 14, 14, 15, 36, 18, 12])
  assert.ok(rows.every((r) => r[2] <= 2025 && !['TOT', 'WSA'].includes(r[3]) && ['BAT', 'PITCH'].includes(r[5])))
  assert.ok(rows.every((r) => teamMap.some((m) => m.code === r[3] && r[2] >= m.from && r[2] <= (m.to ?? 9999))), 'every row maps under the reviewed team-code map')
  assert.ok(!teamMap.some((m) => m.code === 'WSA'), 'no WSA mapping exists or is added')
  assert.equal(teamMap.length, 40)
})

test('exclusion: only Versalles 1969 WSA stint 2 (+0.36), an unmapped team outside his 1967-11-28 .. 1968-10-14 Dodgers window', () => {
  assert.deepEqual(evidence.excluded_rows.map((r) => [r.bref_id, r.season, r.team, r.stint, r.component, r.war, r.reason]),
    [['versazo01', 1969, 'WSA', 2, 'BAT', '0.36', 'OUTSIDE_DODGERS_VALUE_WINDOW_AND_UNMAPPED_TEAM']])
  const v = scope.players.find((p) => p.bref_id === 'versazo01')
  assert.ok(evidence.excluded_rows[0].season > Number(v.exit_date.slice(0, 4)), 'after his exit')
  // his Dodgers value is the 1968 LAD row alone, with or without the excluded row
  const lad = evidence.rows.filter((r) => r[0] === 'versazo01' && r[3] === 'LAD')
  assert.deepEqual(lad.map((r) => [r[2], r[7]]), [[1968, '-1.12']])
})

test('credited rows: Garland 2009 LAD stint 2 (BAT -0.12 + PITCH +0.29 = +0.17) after the ARI stint 1; Leyritz 2000 LAD stint 2 -0.61 after NYY stint 1; Grant 1968 +1.39; Versalles 1968 -1.12', () => {
  const r = (b, y, t, s, c) => evidence.rows.find((x) => key(x) === [b, y, t, s, c].join('|'))
  assert.deepEqual([r('garlajo01', 2009, 'ARI', 1, 'BAT')[7], r('garlajo01', 2009, 'LAD', 2, 'BAT')[7], r('garlajo01', 2009, 'LAD', 2, 'PITCH')[7]], ['-0.42', '-0.12', '0.29'])
  assert.deepEqual([r('leyriji01', 2000, 'NYY', 1, 'BAT')[7], r('leyriji01', 2000, 'LAD', 2, 'BAT')[7]], ['-0.23', '-0.61'])
  assert.deepEqual([r('grantmu01', 1968, 'LAD', 1, 'BAT')[7], r('grantmu01', 1968, 'LAD', 1, 'PITCH')[7]], ['0.03', '1.36'])
  for (const p of scope.players) {
    const sum = p.credited_rows.reduce((s, k) => s + H(r(...k)[7]), 0)
    assert.equal(sum, H(p.credited_bwar), p.name)
  }
  // Garland's later Dodgers stint is loaded (full career) but is not credited: it is after his recorded 2009 exit
  assert.deepEqual(evidence.rows.filter((x) => x[0] === 'garlajo01' && x[3] === 'LAD' && x[2] === 2011).map((x) => [x[5], x[7]]), [['BAT', '-0.11'], ['PITCH', '0.25']])
  assert.match(scope.players[0].not_credited, /DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION/)
  // negative WAR stays negative: no floor
  assert.ok(evidence.players.find((p) => p.bref_id === 'versazo01').credited_bwar.startsWith('-'))
})

test('expected effect: derived from the measured baseline under the existing attribution levels; only Garland adds to a signing', () => {
  const e = research.expected, b = research.baseline
  assert.deepEqual(b.value_totals, { resolved: 87, realized: '297.60', realized_to_date: 80, chain_incomplete: 7, unresolved: 1, pkg_first: '96.39', pkg_down: '2.99', observable: '141.44' })
  assert.deepEqual(e.value_totals, { resolved: 88, realized: '299.00', realized_to_date: 83, chain_incomplete: 5, unresolved: 0, pkg_first: '95.85', pkg_down: '2.99', observable: '141.71' })
  assert.deepEqual(e.executive, { signings_with_resolved_value: 88, direct: '284.00', trade: '15.00', realized: '299.00' })
  const s = Object.fromEntries(e.signings.map((x) => [x.player_slug, x]))
  assert.deepEqual([s['tony-abreu'].realized, s['tony-abreu'].trade], ['1.40', '0.17'])
  assert.deepEqual([s['jose-vizcaino'].realized, s['jose-vizcaino'].trade, s['jose-vizcaino'].pkg_first], ['0.09', '-0.10', '-0.71'], 'Leyritz is package value, never Vizcaino\'s own')
  assert.deepEqual([s['chico-fernandez'].realized, s['chico-fernandez'].observable], ['0.62', '5.17'], 'Grant and Versalles are observable, never Fernandez\'s own')
  const total = (q) => q.reduce((x, y) => x + y.items, 0)
  assert.deepEqual([total(b.transaction_queue), total(e.transaction_queue), total(b.value_queue), total(e.value_queue)], [58, 57, 93, 90])
  assert.equal(b.bwar_missing, 50)
  assert.match(scope.reviewed_effect.older_view_note, /OLDER VIEW != VALUE OF RECORD/)
})

test('verifier: the head pins no unavailable-WAR id; the 057 layer (and every earlier layer that had them) keeps them; history is not rewritten', () => {
  assert.deepEqual(CANONICAL_EXPECTATIONS.transaction_war_unavailable_mlb_ids, [])
  assert.deepEqual(EXPECTATIONS_THROUGH_057.transaction_war_unavailable_mlb_ids, ['279782', '117747'])
  assert.deepEqual(EXPECTATIONS_THROUGH_055.transaction_war_unavailable_mlb_ids, ['279782', '117747'])
  assert.deepEqual(EXPECTATIONS_THROUGH_053.transaction_war_unavailable_mlb_ids, ['279782', '117747'])
  assert.deepEqual(EXPECTATIONS_THROUGH_052.transaction_war_unavailable_mlb_ids, ['279782'])
  assert.deepEqual(EXPECTATIONS_THROUGH_049.transaction_war_unavailable_mlb_ids, ['279782'])
  assert.deepEqual(EXPECTATIONS_THROUGH_048.transaction_war_unavailable_mlb_ids, [])
  const { transaction_war_unavailable_mlb_ids: a, ...head } = CANONICAL_EXPECTATIONS
  const { transaction_war_unavailable_mlb_ids: c, ...l057 } = EXPECTATIONS_THROUGH_057
  assert.deepEqual(l057, head, 'the 057 layer differs from the head only in the pins')
  assert.ok(a && c)
})

test('build: the SQL changes no definition and writes no player, source, mapping, outcome, evaluation or metric; the rollback retracts and never deletes', () => {
  const body = assemble().replace(/\$m058\$[\s\S]*?\$m058\$/g, '').replace(/--.*$/gm, '')
  assert.doesNotMatch(body, /(insert into|update|delete from) public\.(players|sources|signings|bref_team_code_map|outcomes|outcome_audits|outcome_model_evaluations|player_metric_observations|transaction_events|transaction_event_assets|dodgers_control_observations)\b/i)
  assert.doesNotMatch(body.replace(/create temporary (table|view) _m058\w*/g, '').replace(/drop view _m058\w*/g, ''), /\b(create|alter|drop)\s+(table|view|function|trigger|policy|index)\b/i)
  assert.doesNotMatch(body.replace(/'(?:[^']|'')*'/g, "''"), /\b(grant|revoke)\b/i, 'no grant or revoke statement (string literals such as Mudcat Grant stripped)')
  const rb = assembleRollback().replace(/\$r058\$[\s\S]*?\$r058\$/g, '').replace(/--.*$/gm, '')
  assert.doesNotMatch(rb, /delete from/i)
  assert.match(rb, /set record_status = 'RETRACTED'/)
  assert.doesNotMatch(rb, /public\.(outcomes|sources|outcome_model_evaluations)\b.*(update|delete)/i)
})
