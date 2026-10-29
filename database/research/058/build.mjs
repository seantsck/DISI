#!/usr/bin/env node
// Assembles database/sql/058_transaction_return_bwar_evidence.sql and database/release/sql/rollback-058.sql from:
//   058_template.sql / rollback_template.sql   hand-written guards, steps, proofs and postconditions
//   ../057/source-capture.json                  the two archived Baseball-Reference captures 057 registered (reused; no source row is added)
//   scope.json                                  the four returned players, their trades, attribution levels, credited rows, the excluded row
//   war-evidence.json                           the team-season rows read from the captures (derive-war.mjs)
//   baseline.json                               the pre-058 state the migration proves before it writes (measure.mjs --baseline)
//
//   node database/research/058/derive-war.mjs && node database/research/058/build.mjs
//
// Deterministic: the same inputs always produce the same files. Every expected post-058 value is derived here from the measured baseline and the
// reviewed per-player credited rows under the existing attribution levels (a PLAYER_ATTRIBUTABLE return adds to its signing; a PACKAGE_ATTRIBUTABLE
// return adds to package participation only; a CHAIN_OBSERVABLE return adds to observable value only), and must equal the reviewed effect in
// scope.json. The build refuses anything the reviewed scope does not allow: another player, an unmapped or excluded row, a partial season, a source
// that is not the 057 capture, a value or queue movement other than the reviewed one.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8').replace(/\r\n/g, '\n')
const json = (f) => JSON.parse(read(f))
const need = (cond, msg) => { if (!cond) throw new Error(msg) }

const capture = json('../057/source-capture.json')
const scope = json('scope.json')
const evidence = json('war-evidence.json')
const baseline = json('baseline.json')
const R = scope.reviewed_effect
const APPROVED = {
  BAT: ['ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023', 'https://web.archive.org/web/20260911214553id_/https://www.baseball-reference.com/data/war_daily_bat.txt'],
  PITCH: ['3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825', 'https://web.archive.org/web/20260210222101id_/https://www.baseball-reference.com/data/war_daily_pitch.txt'],
}
const H = (w) => (w === null || w === undefined ? null : Math.round(Number(w) * 100))
const fmt = (h) => (h === null ? null : (h < 0 ? '-' : '') + `${Math.floor(Math.abs(h) / 100)}.${String(Math.abs(h) % 100).padStart(2, '0')}`)
const add = (a, b) => fmt((H(a) ?? 0) + (H(b) ?? 0))

// ---- sources: the two 057 captures, referenced (url, decoded SHA-256, archive digest); never inserted ---------------------------------------
need(capture.observed_through_season === 2025 && evidence.observed_through_season === 2025, 'the last complete season in both captures is 2025')
need(capture.files.length === 2 && capture.files.every((f) => APPROVED[f.component][0] === f.decoded_sha256 && APPROVED[f.component][1] === f.url), 'the captures are the two approved 057 files')
const sources = capture.files.map((f) => ({ component: f.component, url: f.url, decoded_sha256: f.decoded_sha256, cdx_digest: f.cdx_digest,
  observed_through_date: f.original_last_modified.slice(0, 10), retrieved_at: f.retrieved_at }))
need(JSON.stringify(evidence.sources) === JSON.stringify(capture.files.map((f) => ({ component: f.component, url: f.url, decoded_sha256: f.decoded_sha256 }))), 'war-evidence.json was read from these captures')

// ---- the four returned players and their rows --------------------------------------------------------------------------------------------
need(scope.players.length === 4, 'four returned players')
const rows = evidence.rows
const key = (r) => [r[0], r[2], r[3], r[4], r[5]].join('|')
need(rows.length === 91 && new Set(rows.map(key)).size === 91, '91 reviewed rows, one per player, season, team stint and component')
need(rows.every((r) => r[2] <= 2025 && !['TOT', 'WSA'].includes(r[3]) && ['BAT', 'PITCH'].includes(r[5])), 'no partial season, TOT or WSA row')
const excludedKeys = new Set(scope.excluded_rows.map((x) => [x.bref_id, x.season, x.team, x.stint, x.component].join('|')))
need(rows.every((r) => !excludedKeys.has(key(r))) && scope.excluded_rows.length === 1 && scope.excluded_rows[0].team === 'WSA'
  && scope.excluded_rows[0].reason === 'OUTSIDE_DODGERS_VALUE_WINDOW_AND_UNMAPPED_TEAM', 'the one reviewed exclusion (Versalles 1969 WSA) is not loaded')
const players = scope.players.map((p) => {
  const mine = rows.filter((r) => r[0] === p.bref_id)
  need(mine.length === p.rows && mine.every((r) => r[1] === p.mlb_id), `${p.name}: ${p.rows} rows carrying the asset's MLB id`)
  const credited = p.credited_rows.map((k) => mine.find((r) => key(r) === k.join('|')))
  need(credited.every(Boolean) && fmt(credited.reduce((s, r) => s + H(r[7]), 0)) === p.credited_bwar, `${p.name}: the credited rows sum to ${p.credited_bwar}`)
  need(credited.every((r) => r[3] === 'LAD'), `${p.name}: every credited row is a Dodgers stint`)
  return { name: p.name, bref_id: p.bref_id, mlb_id: p.mlb_id, rows: p.rows, bat_rows: p.bat_rows, pitch_rows: p.pitch_rows,
    acquisition_event_key: p.acquisition_event_key, exit_event_key: p.exit_event_key, originating_signing_slug: p.originating_signing_slug,
    attribution_level: p.attribution, credited_bwar: p.credited_bwar }
})
need(rows.every((r) => players.some((p) => p.bref_id === r[0])), 'every row belongs to one of the four')
need(JSON.stringify(players.map((p) => [p.bref_id, p.attribution_level])) === JSON.stringify([['garlajo01', 'PLAYER_ATTRIBUTABLE'], ['leyriji01', 'PACKAGE_ATTRIBUTABLE'],
  ['grantmu01', 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE'], ['versazo01', 'CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE']]), 'the reviewed attribution levels')

// ---- the measured baseline is the reviewed one ---------------------------------------------------------------------------------------------
const b = baseline
need(b.war.active === R.war_active[0] && b.counts.sources === R.sources[0], 'baseline: 1934 active rows, 3384 sources')
need(b.value_totals.realized === R.realized_org_value_bwar[0] && b.value_totals.resolved === R.signings_with_resolved_value[0]
  && b.value_totals.realized_to_date === R.realized_to_date[0] && b.value_totals.chain_incomplete === R.to_date_chain_incomplete[0] && b.value_totals.unresolved === R.value_unresolved[0]
  && b.value_totals.pkg_first === R.package_first_hop_participation_bwar[0] && b.value_totals.observable === R.observable_not_attributable_bwar[0], 'baseline: the reviewed value totals')
need(b.executive.direct === R.realized_direct_dodgers_bwar[0] && b.executive.trade === R.realized_individually_attributable_trade_bwar[0]
  && b.executive.realized === R.realized_org_value_bwar[0] && b.executive.signings_with_resolved_value === R.signings_with_resolved_value[0], 'baseline: the reviewed executive totals')
need(b.scoped_war.length === 0 && b.war_not_loaded.length === 8, 'baseline: no row for the four; eight WAR_NOT_LOADED assets')
need(b.prediction.supported_models === 0 && b.prediction.probabilities === 0 && b.prediction.expected_values === 0 && b.prediction.recommendations === 0
  && b.prediction.supported_targets === 0 && b.prediction.evaluation_fingerprints === '102c01a35d380d36493465cef1070c07,1aa73185a9dab3071d4530ee670dd088,86b58f473301e2425751d853abd88e94',
  'baseline: no supported model, probability, expected value or recommendation; the three evaluation fingerprints')
const bwarMissing = b.research_task_types.find((t) => t.task_type === 'BWAR_MISSING')?.items
need(bwarMissing === R.bwar_missing[0], 'baseline: BWAR_MISSING 50')
const sig = (slug) => b.signings.find((s) => s.player_slug === slug)
for (const [slug, e] of Object.entries(R.signings)) {
  const s = sig(slug)
  need(s && JSON.stringify([s.realized_value_state, s.chain_status, s.realized]) === JSON.stringify(e.before), `baseline: ${slug} is ${e.before.join(' / ')}`)
}

// ---- the expected post-058 state, derived from the baseline and the credited rows under the existing attribution levels ---------------------
const credit = Object.fromEntries(players.map((p) => [p.bref_id, p.credited_bwar]))
const abreu = sig('tony-abreu'), vizcaino = sig('jose-vizcaino'), fernandez = sig('chico-fernandez')
// Abreu: PLAYER_ATTRIBUTABLE first hop; his total becomes direct + Garland (it was NULL only because the hop value was unknown)
const abreuAfter = { ...abreu, realized_value_state: 'REALIZED_TO_DATE', chain_status: 'COMPLETE_TERMINAL', trade: credit.garlajo01,
  realized: add(abreu.direct, credit.garlajo01), pkg_first: credit.garlajo01 }
// Vizcaino: Leyritz is PACKAGE_ATTRIBUTABLE: first-hop package participation is the sum over his two trade packages (Greg Smith, already
// known and individually his own (his individual trade value), and Leyritz's); his individual trade value and realized total do not move
const vizcainoPackages = add(vizcaino.trade, credit.leyriji01)
const vizcainoAfter = { ...vizcaino, realized_value_state: 'REALIZED_TO_DATE', chain_status: 'COMPLETE_TERMINAL', pkg_first: vizcainoPackages }
// Fernandez: Grant and Versalles are CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE third hops: only observable value moves
const fernandezAfter = { ...fernandez, realized_value_state: 'REALIZED_TO_DATE', chain_status: 'COMPLETE_TERMINAL',
  observable: add(fernandez.observable, add(credit.grantmu01, credit.versazo01)) }
for (const [slug, s] of [['tony-abreu', abreuAfter], ['jose-vizcaino', vizcainoAfter], ['chico-fernandez', fernandezAfter]]) {
  need(JSON.stringify([s.realized_value_state, s.chain_status, s.realized]) === JSON.stringify(R.signings[slug].after), `${slug}: derived ${[s.realized_value_state, s.chain_status, s.realized]} = reviewed`)
}
const signingsAfter = [fernandezAfter, vizcainoAfter, abreuAfter]
const vt = b.value_totals
const valueAfter = {
  resolved: vt.resolved + 1, realized: add(vt.realized, abreuAfter.realized), realized_to_date: vt.realized_to_date + 3, chain_incomplete: vt.chain_incomplete - 2,
  unresolved: vt.unresolved - 1, pkg_first: add(add(vt.pkg_first, abreuAfter.pkg_first), vizcainoAfter.pkg_first), pkg_down: vt.pkg_down,
  observable: add(vt.observable, add(credit.grantmu01, credit.versazo01)),
}
need(valueAfter.realized === R.realized_org_value_bwar[1] && valueAfter.resolved === R.signings_with_resolved_value[1] && valueAfter.realized_to_date === R.realized_to_date[1]
  && valueAfter.chain_incomplete === R.to_date_chain_incomplete[1] && valueAfter.unresolved === R.value_unresolved[1]
  && valueAfter.pkg_first === R.package_first_hop_participation_bwar[1] && valueAfter.observable === R.observable_not_attributable_bwar[1],
`the derived value totals are the reviewed ones: ${JSON.stringify(valueAfter)}`)
const executiveAfter = { signings_with_resolved_value: b.executive.signings_with_resolved_value + 1, direct: add(b.executive.direct, abreu.direct),
  trade: add(b.executive.trade, credit.garlajo01), realized: add(b.executive.realized, abreuAfter.realized) }
need(executiveAfter.direct === R.realized_direct_dodgers_bwar[1] && executiveAfter.trade === R.realized_individually_attributable_trade_bwar[1]
  && executiveAfter.realized === add(executiveAfter.direct, executiveAfter.trade) && executiveAfter.realized === R.realized_org_value_bwar[1], 'the derived executive totals are the reviewed ones')
const move = (queue, moves) => queue.map((q) => (moves[q.issue] ? (need(q.items === moves[q.issue][0], `${q.issue}: baseline ${q.items}`), { issue: q.issue, items: moves[q.issue][1] }) : q))
const total = (q) => q.reduce((s, x) => s + x.items, 0)
need(total(b.transaction_queue) === R.transaction_queue_total[0] && total(b.value_queue) === R.value_queue_total[0], 'baseline queue totals 58 / 93')
const txAfter = move(b.transaction_queue, R.transaction_queue_moves)
const valueQueueAfter = move(b.value_queue, R.value_queue_moves)
need(total(txAfter) === R.transaction_queue_total[1] && total(valueQueueAfter) === R.value_queue_total[1], 'reviewed queue totals 57 / 90')

// ---- payload -----------------------------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const enc = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
const pickSigning = (s) => ({ player_slug: s.player_slug, realized_value_state: s.realized_value_state, chain_status: s.chain_status, direct: s.direct, trade: s.trade,
  realized: s.realized, pkg_first: s.pkg_first, pkg_down: s.pkg_down, observable: s.observable })
const baselinePayload = {
  counts: { players: b.counts.players, sources: b.counts.sources, benchmark_signings: b.counts.benchmark_signings, dodgers_signings: b.counts.dodgers_signings,
    tables: b.counts.tables, views: b.counts.views },
  war_active: b.war.active, war_active_057: 54, value_totals: { ...vt }, executive: { signings_with_resolved_value: b.executive.signings_with_resolved_value,
    direct: b.executive.direct, trade: b.executive.trade, realized: b.executive.realized },
  signings: b.signings.map(pickSigning), transaction_queue: b.transaction_queue, value_queue: b.value_queue, bwar_missing: bwarMissing,
  evaluation_fingerprints: b.prediction.evaluation_fingerprints,
}
const expected = { value_totals: valueAfter, executive: executiveAfter, signings: signingsAfter.map(pickSigning), transaction_queue: txAfter, value_queue: valueQueueAfter }

export function assemble() {
  const payload = sortKeys({
    sources, observed_through_season: 2025, players, war: { row_format: evidence.row_format, rows },
    excluded_rows: scope.excluded_rows.map((x) => ({ bref_id: x.bref_id, season: x.season, team: x.team, stint: x.stint, component: x.component, war: x.war, reason: x.reason })),
    baseline: baselinePayload, expected,
  })
  const text = enc(payload)
  for (const tag of ['$m058$', '$r058$']) need(!text.includes(tag), `payload contains the dollar-quote tag ${tag}`)
  const sql = read('058_template.sql').split('{{payload_json}}').join(text)
  need(!/\{\{\w+\}\}/.test(sql), 'unreplaced placeholder')
  return sql
}
export function assembleRollback() {
  const payload = sortKeys({
    bref_ids: players.map((p) => p.bref_id), source_urls: sources.map((s) => s.url), rows: rows.length,
    baseline: { war_active: b.war.active, war_active_057: 54, value_totals: { resolved: vt.resolved, realized: vt.realized }, signings: b.signings.map(pickSigning),
      transaction_queue: b.transaction_queue, value_queue: b.value_queue },
  })
  const text = enc(payload)
  const sql = read('rollback_template.sql').split('{{payload_json}}').join(text)
  need(!/\{\{\w+\}\}/.test(sql), 'unreplaced rollback placeholder')
  return sql
}
export const research = { players, rows, sources, baseline: baselinePayload, expected }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = path.join(root, 'database/sql/058_transaction_return_bwar_evidence.sql')
  fs.writeFileSync(dest, assemble())
  const rdest = path.join(root, 'database/release/sql/rollback-058.sql')
  fs.writeFileSync(rdest, assembleRollback())
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)}, ${path.relative(process.cwd(), rdest)}: ${rows.length} rows for ${players.length} players\n`)
}
