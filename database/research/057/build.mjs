#!/usr/bin/env node
// Assembles database/sql/057_benchmark_bwar_evidence.sql and database/release/sql/rollback-057.sql from:
//   057_template.sql / rollback_template.sql   hand-written guards, steps, proofs and postconditions
//   source-capture.json                        the two archived Baseball-Reference captures (archive digest, payload and decoded SHA-256)
//   scope.json                                 the eleven approved complete-window reachers; the deferred, the unresolved, the out-of-scope
//   war-evidence.json                          the team-season rows read from the captures (derive-war.mjs)
//   evaluation.json                            the unchanged 041 out-of-time evaluation for the two bWAR targets on the 057 data (evaluate.mjs)
//   baseline.json                              the pre-057 state the migration proves before it writes (measure.mjs --baseline)
//
//   node database/research/057/derive-war.mjs && node database/research/057/evaluate.mjs && node database/research/057/build.mjs
//
// Deterministic: the same inputs always produce the same files. The build refuses anything the reviewed scope does not allow: a partial
// season, a player outside the eleven, a label the rows do not give, a support transition other than the reviewed one, a supported model.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8').replace(/\r\n/g, '\n')
const json = (f) => JSON.parse(read(f))
const need = (cond, msg) => { if (!cond) throw new Error(msg) }

const capture = json('source-capture.json')
const scope = json('scope.json')
const evidence = json('war-evidence.json')
const baseline = json('baseline.json')
const THROUGH = capture.observed_through_season
const BENCH = 'TOP_PROSPECT_SAMPLE'
const DODGERS = 'DODGERS_TRACKED_AND_OPENING_CLASS'
const BWAR_TARGETS = ['POSITIVE_BWAR_WITHIN_10_SEASONS', 'BWAR_2_WITHIN_10_SEASONS']
const APPROVED_SHA = { BAT: 'ec088b3ad7aa2f284f41d845f071c0644e43e753bae46ee45aab840b9cd51023', PITCH: '3d80dcd5ae2cb442db52146bf569dbb6ee5de37846355c18e6b7937653af3825' }

// ---- sources: the two approved captures, unchanged in kind (WAR_DATA_FILE, BASEBALL_REFERENCE) ------------------------------------------------
need(THROUGH === 2025, 'the last complete season in both captures is 2025')
need(capture.files.length === 2 && capture.files.every((f) => APPROVED_SHA[f.component] === f.decoded_sha256), 'the captures are the two approved files')
const kind = { BAT: 'batting', PITCH: 'pitching' }
const sources = capture.files.map((f) => ({
  component: f.component, url: f.url, source_name: 'Baseball-Reference', source_type: 'WAR_DATA_FILE', source_tier: 'BASEBALL_REFERENCE',
  title: `Baseball-Reference WAR data: ${kind[f.component]} (${f.original_url.split('/').pop()}), archived capture ${f.captured_at.slice(0, 10)}`,
  notes: `Baseball-Reference WAR data file (${kind[f.component]}), ${f.original_url}, read directly from an archived Internet Archive capture of that URL `
    + `(captured ${f.captured_at}; original Last-Modified ${f.original_last_modified}; Internet Archive digest ${f.cdx_digest}; archived payload SHA-256 ${f.archived_payload_sha256}; `
    + `decoded file SHA-256 ${f.decoded_sha256}, ${f.data_rows} rows). The live file answers HTTP 403. Archived original-source material, not a secondary WAR table. `
    + `Team-season rows are read through the ${THROUGH} season only${f.max_season > THROUGH ? `; the capture's ${f.max_season} rows are mid-season and are not loaded` : ''}. `
    + `Career bWAR = sum of batting and pitching WAR rows for the player's mlb_ID.`,
  publication_date: f.original_last_modified.slice(0, 10), observed_through_date: f.original_last_modified.slice(0, 10), retrieved_at: f.retrieved_at,
  decoded_sha256: f.decoded_sha256,
}))

// ---- the eleven: identity from the DISI record, rows from the captures, labels from the unchanged 041 rule ----------------------------------
need(scope.approved.length === 11, 'eleven approved players')
const fmt = (h) => (h < 0 ? '-' : '') + `${Math.floor(Math.abs(h) / 100)}.${String(Math.abs(h) % 100).padStart(2, '0')}`
const H = (w) => (w === null ? 0 : Math.round(Number(w) * 100))
const rows = evidence.rows
need(rows.every((r) => r[2] <= THROUGH), 'no row after the last complete season')
const players = scope.approved.map((p) => {
  const mine = rows.filter((r) => r[0] === p.bref_id)
  need(mine.length > 0 && mine.every((r) => r[1] === p.mlb_id), `${p.slug}: rows carry the DISI MLB id`)
  need(p.horizon_end_season === p.signing_year + 10 && p.horizon_end_season <= THROUGH, `${p.slug}: the window is complete in the captures`)
  const window = mine.filter((r) => r[2] <= p.horizon_end_season).reduce((s, r) => s + H(r[7]), 0)
  const loaded = mine.reduce((s, r) => s + H(r[7]), 0)
  const e = evidence.players.find((x) => x.slug === p.slug)
  need(e && e.window_bwar === fmt(window) && e.loaded_bwar === fmt(loaded) && e.rows === mine.length, `${p.slug}: war-evidence.json agrees with its rows`)
  return { slug: p.slug, mlb_id: p.mlb_id, bref_id: p.bref_id, population_key: p.population_key, rank: p.rank, signing_year: p.signing_year,
    horizon_end_season: p.horizon_end_season, rows: mine.length, window_bwar: fmt(window), career_bwar: fmt(loaded),
    positive_bwar_label: window > 0, bwar_2_label: window >= 200 }
})
const forbidden = new Set([...scope.deferred_incomplete_window.map((p) => p.bref_id), 'garlajo01', 'grantmu01', 'versazo01', 'leyriji01'])
need(rows.every((r) => !forbidden.has(r[0]) && players.some((p) => p.bref_id === r[0])), 'every row belongs to one of the eleven')
need(rows.length === 54, `54 reviewed team-season rows (${rows.length})`)
const keyOf = (r) => [r[0], r[2], r[3], r[4], r[5]].join('|')
need(new Set(rows.map(keyOf)).size === rows.length && rows.every((r) => r[3] !== 'TOT'), 'one row per player, season, team stint and component')
const expectTrue = (t) => players.filter((p) => p[t]).map((p) => p.slug).sort()
need(JSON.stringify(expectTrue('positive_bwar_label')) === JSON.stringify(['andres-gimenez', 'fernando-tatis-jr', 'gilberto-celestino', 'juan-soto', 'leody-taveras',
  'miguel-amaya', 'rafael-marchan', 'vladimir-guerrero-jr']), 'positive bWAR: the reviewed 8 TRUE / 3 FALSE')
need(JSON.stringify(expectTrue('bwar_2_label')) === JSON.stringify(['andres-gimenez', 'fernando-tatis-jr', 'juan-soto', 'leody-taveras', 'miguel-amaya',
  'vladimir-guerrero-jr']), '2+ bWAR: the reviewed 6 TRUE / 5 FALSE')

// ---- support: before (measured), after (before + the eleven labels) under the unchanged thresholds ------------------------------------------
const sup = (t, pop) => baseline.support.find((s) => s.target_key === t && s.reference_population === pop)
const pick = (s) => ({ target_key: s.target_key, reference_population: s.reference_population, labelled_n: s.labelled_n, positive_n: s.positive_n, negative_n: s.negative_n, support_state: s.support_state })
const unmoved = baseline.support.filter((s) => s.reference_population === DODGERS || s.target_key === 'REACH_MLB_WITHIN_7_SEASONS').map(pick)
need(unmoved.length === 5, 'five support rows 057 must not move')
const before = BWAR_TARGETS.map((t) => pick(sup(t, BENCH)))
need(JSON.stringify(before.map((s) => [s.labelled_n, s.positive_n, s.negative_n, s.support_state])) === JSON.stringify([[75, 7, 68, 'BASELINE_NOT_SUPPORTED'], [75, 3, 72, 'BASELINE_NOT_SUPPORTED']]),
  'the measured pre-057 benchmark bWAR support is the reviewed one')
const after = before.map((s) => {
  const key = s.target_key === 'POSITIVE_BWAR_WITHIN_10_SEASONS' ? 'positive_bwar_label' : 'bwar_2_label'
  const pos = s.positive_n + players.filter((p) => p[key]).length
  const neg = s.negative_n + players.filter((p) => !p[key]).length
  const t = sup(s.target_key, BENCH)
  const supported = pos + neg >= t.min_reference_n && pos >= t.min_positives && neg >= t.min_negatives
  return { ...s, labelled_n: pos + neg, positive_n: pos, negative_n: neg, support_state: supported ? 'BASELINE_SUPPORTED' : 'BASELINE_NOT_SUPPORTED' }
})
need(JSON.stringify(after.map((s) => [s.labelled_n, s.positive_n, s.negative_n, s.support_state])) === JSON.stringify([[86, 15, 71, 'BASELINE_SUPPORTED'], [86, 9, 77, 'BASELINE_NOT_SUPPORTED']]),
  'the support transition is exactly the reviewed one: positive bWAR 86 / 15 / 71 supported, 2+ bWAR 86 / 9 / 77 not supported')
const reach = baseline.evaluation.filter((e) => e.target_key === 'REACH_MLB_WITHIN_7_SEASONS')
need(reach.length === 3 && reach.every((e) => e.training_fingerprint === '86b58f473301e2425751d853abd88e94' && e.evaluation_current) && baseline.evaluation.length === 3,
  'the stored evaluation before 057 is the current 056 reach evaluation alone')

// ---- payload -----------------------------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const enc = (o) => JSON.stringify(o).replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'))
const baselinePayload = {
  counts: { players: baseline.counts.players, benchmark_signings: baseline.counts.benchmark_signings, dodgers_signings: baseline.counts.dodgers_signings,
    tables: baseline.counts.tables, views: baseline.counts.views },
  war_active: baseline.war.active, reach_fingerprint: reach[0].training_fingerprint, unmoved_support: unmoved, benchmark_bwar_support: before,
}

/** The migration SQL; `evaluation` null builds it without the evaluation rows (evaluate.mjs computes the evaluation on that data). */
export function assemble(evaluation) {
  if (evaluation) {
    need(!evaluation.failures?.length, `the evaluation has failures: ${evaluation.failures?.join('; ')}`)
    need(evaluation.evaluations.length === 6 && evaluation.evaluations.every((e) => BWAR_TARGETS.includes(e.target_key) && e.decision !== 'MODEL_SUPPORTED'),
      'six bWAR evaluation rows, none supported')
  }
  const payload = sortKeys({
    sources, observed_through_season: THROUGH, players, war: { row_format: evidence.row_format, rows },
    deferred_slugs: scope.deferred_incomplete_window.map((p) => p.slug), deferred_bref_ids: scope.deferred_incomplete_window.map((p) => p.bref_id),
    identity_slugs: scope.identity_unresolved.map((p) => p.slug),
    baseline: baselinePayload, expected_benchmark_bwar_support: after,
    evaluation: evaluation ? evaluation.evaluations : null,
  })
  const text = enc(payload)
  for (const tag of ['$m057$', '$r057$']) need(!text.includes(tag), `payload contains the dollar-quote tag ${tag}`)
  const sql = read('057_template.sql').split('{{payload_json}}').join(text)
  need(!/\{\{\w+\}\}/.test(sql), 'unreplaced placeholder')
  return sql
}
export function assembleRollback(evaluation) {
  const payload = sortKeys({
    players: players.map((p) => ({ slug: p.slug, bref_id: p.bref_id, career_bwar: p.career_bwar })), source_urls: sources.map((s) => s.url),
    evaluation_fingerprints: [...new Set(evaluation.evaluations.map((e) => e.training_fingerprint))].sort(),
    baseline: { war_active: baseline.war.active, support: baseline.support.map(pick) },
  })
  const text = enc(payload)
  const sql = read('rollback_template.sql').split('{{payload_json}}').join(text)
  need(!/\{\{\w+\}\}/.test(sql), 'unreplaced rollback placeholder')
  return sql
}
export const research = { players, rows, sources, before, after, unmoved }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const evaluation = json('evaluation.json')
  const dest = path.join(root, 'database/sql/057_benchmark_bwar_evidence.sql')
  fs.writeFileSync(dest, assemble(evaluation))
  const rdest = path.join(root, 'database/release/sql/rollback-057.sql')
  fs.writeFileSync(rdest, assembleRollback(evaluation))
  process.stderr.write(`wrote ${path.relative(process.cwd(), dest)}, ${path.relative(process.cwd(), rdest)}: ${rows.length} rows for ${players.length} players\n`)
}
