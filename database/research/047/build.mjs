#!/usr/bin/env node
// Assembles database/sql/047_development_transaction_research_batch.sql and database/release/sql/rollback-047.sql from:
//   047_template.sql / rollback_template.sql   hand-written guards, steps and postconditions
//   transaction-evidence.json                  the exits read directly from Retrosheet (derive-transactions.mjs)
//   development-values.sql + development-cohort.json   the pipeline VALUES for the cohort (derive-development.mjs)
//
//   node database/research/047/build.mjs
//
// Deterministic: the same inputs always produce the same files. The build refuses anything the research rules do not allow.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8').replace(/\r\n/g, '\n')
const evidence = JSON.parse(read('transaction-evidence.json'))
const cohort = JSON.parse(read('development-cohort.json'))
const values = read('development-values.sql')

// ---- transaction exits ----------------------------------------------------------------------------------------------------
const TYPES = { FREE_AGENCY: 'Granted free agency', RELEASE: 'Released' }
const keys = new Set()
for (const e of evidence.exits) {
  if (keys.has(e.key)) throw new Error(`duplicate exit key ${e.key}`)
  keys.add(e.key)
  if (!(e.type in TYPES) || e.historical_label !== TYPES[e.type]) throw new Error(`${e.key}: only ${Object.keys(TYPES).join(' / ')} exits with their reviewed label are seeded`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date.endsWith('-00')) throw new Error(`${e.key}: an exact date is required`)
  if (!(e.asset?.mlb_id && e.asset?.bref_id && e.asset?.name)) throw new Error(`${e.key}: the asset needs a name, an MLB id and a Baseball-Reference id (identity is never guessed)`)
  if (!(e.retrosheet?.transaction_id && e.retrosheet?.row && e.retrosheet?.birth_date_matched)) throw new Error(`${e.key}: the exact source row and the birth-date match are required`)
  if (!e.description.includes(String(e.retrosheet.transaction_id))) throw new Error(`${e.key}: the description must cite the source transaction id`)
  if (!e.acquired_in_event) throw new Error(`${e.key}: the acquisition event is required`)
}
const src = evidence.source
if (!(src?.url?.startsWith('https://') && src.source_name && src.source_type && src.title && src.source_tier && src.notes)) throw new Error('the source needs full metadata')
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(evidence.retrieved_at)) throw new Error('retrieved_at must be a UTC timestamp')
// an unresolved asset is never also an exit
for (const u of evidence.unresolved) if (u.mlb_id && evidence.exits.some((e) => e.asset.mlb_id === u.mlb_id)) throw new Error(`${u.asset}: both recorded and unresolved`)
for (const p of evidence.package_verification) if (!(p.agrees.outgoing && p.agrees.incoming)) throw new Error(`${p.event}: the recorded package disagrees with the source; a disagreement is not silently seeded`)

// ---- development VALUES -----------------------------------------------------------------------------------------------------
const blocks = {}
for (const m of values.matchAll(/^-- (\w+)\(.*?\)\n([\s\S]*?)(?=\n\n-- \w+\(|\s*(?![\s\S]))/gm)) blocks[m[1]] = m[2].trim()
if (!blocks.stints?.startsWith('(')) throw new Error('development-values.sql stints block looks empty')
if (!blocks.milestones?.startsWith('(')) throw new Error('development-values.sql milestones block looks empty')
const slugs = cohort.players.map((p) => p.slug)
const stintSlugs = new Set([...blocks.stints.matchAll(/^\('([a-z0-9-]+)',(\d+),/gm)].map((m) => m[1]))
for (const s of slugs) if (!stintSlugs.has(s)) throw new Error(`cohort player ${s} has no stints in the values`)
for (const s of stintSlugs) if (!slugs.includes(s)) throw new Error(`stints for ${s}, who is not in the cohort`)
// no level-debut milestone after the MLB debut season (a rehab or demotion appearance is not a development milestone)
const LEVEL_DEBUTS = new Set(['DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT'])
const ms = [...blocks.milestones.matchAll(/^\('([a-z0-9-]+)',(\d+),'(\w+)',(null|'[^']*'),'(\w+)',(\d+),/gm)].map((m) => ({ slug: m[1], code: m[3], season: Number(m[6]) }))
for (const s of slugs) {
  const debut = ms.find((m) => m.slug === s && m.code === 'MLB_DEBUT')
  if (!debut) throw new Error(`${s}: no MLB debut milestone`)
  for (const m of ms.filter((x) => x.slug === s && LEVEL_DEBUTS.has(x.code) && x.season > debut.season)) throw new Error(`${s}: ${m.code} (${m.season}) is after the MLB debut season`)
}
// progression reviews: 047 records only PENDING reviews (a reviewed decision is a person's judgment and is never asserted by a build)
const PENDING_NOTE_MIN = 80
for (const r of cohort.progression_reviews ?? []) {
  if (!slugs.includes(r.slug)) throw new Error(`progression review for ${r.slug}, who is not in the cohort`)
  if (!['DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT'].includes(r.event_code)) throw new Error(`${r.slug}: bad progression event ${r.event_code}`)
  if (r.decision_basis !== 'STINT_CHRONOLOGY_REVIEW') throw new Error(`${r.slug}: only a stint-chronology review is seeded`)
  if (r.confidence !== 'LOW') throw new Error(`${r.slug}: a pending review carries LOW confidence`)
  if (!r.notes || r.notes.length < PENDING_NOTE_MIN) throw new Error(`${r.slug}: a progression review needs the evidence in its note`)
  if (!ms.some((m) => m.slug === r.slug && m.code === r.event_code)) throw new Error(`${r.slug}: no ${r.event_code} milestone to review`)
}
const noneRow = { milestones: '(null::text, null::bigint, null::text, null::date, null::text, null::int, null::text, null::text, null::text, null::text, null::date)', sources: '(null::text, null::timestamptz)' }
const block = (name) => (blocks[name] && blocks[name] !== '-- none' ? blocks[name] : noneRow[name])

// ---- payload -----------------------------------------------------------------------------------------------------------------
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)
const payload = sortKeys({
  organization_name: 'Los Angeles Dodgers',
  retrieved_at: evidence.retrieved_at,
  source: { url: src.url, source_name: src.source_name, source_type: src.source_type, title: src.title, notes: src.notes, source_tier: src.source_tier },
  exits: evidence.exits.map((e) => ({ key: e.key, date: e.date, type: e.type, historical_label: e.historical_label, description: e.description, acquired_in_event: e.acquired_in_event, asset: e.asset })),
  cohort: cohort.players.map((p) => ({ slug: p.slug, mlb_id: p.mlb_id })),
  progression_reviews: (cohort.progression_reviews ?? []).map((r) => ({ slug: r.slug, event_code: r.event_code, decision_basis: r.decision_basis, confidence: r.confidence, as_of_date: r.as_of_date, notes: r.notes })),
})
const json = JSON.stringify(payload)
for (const tag of ['$m047$', '$r047$']) if (json.includes(tag)) throw new Error(`payload contains the dollar-quote tag ${tag}`)

let sql = read('047_template.sql')
sql = sql.split('{{payload_json}}').join(json)
sql = sql.replace('{{stints}}', () => blocks.stints).replace('{{milestones}}', () => block('milestones')).replace('{{sources}}', () => block('sources'))
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')
const dest = path.join(here, '../../sql/047_development_transaction_research_batch.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines, ${evidence.exits.length} exits, ${slugs.length} players)\n`)

// ---- rollback: generated from the same evidence so the two can never disagree -----------------------------------------------------
let rollback = read('rollback_template.sql')
rollback = rollback.split('{{payload_json}}').join(json)
rollback = rollback.replace('{{stints}}', () => blocks.stints).replace('{{milestones}}', () => block('milestones'))
if (/\{\{\w+\}\}/.test(rollback)) throw new Error('unreplaced rollback placeholder')
const rdest = path.join(here, '../../release/sql/rollback-047.sql')
fs.writeFileSync(rdest, rollback)
process.stderr.write(`wrote ${path.relative(process.cwd(), rdest)}\n`)
