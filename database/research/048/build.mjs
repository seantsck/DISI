#!/usr/bin/env node
// Assembles database/sql/048_verified_mlb_development_coverage.sql and database/release/sql/rollback-048.sql from:
//   048_template.sql / rollback_template.sql   hand-written guards, steps and postconditions
//   development-values.sql + development-cohort.json   the pipeline VALUES for the cohort (derive-development.mjs)
//
//   node database/research/048/build.mjs
//
// Deterministic: the same inputs always produce the same files. The build refuses anything the research rules do not allow.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8').replace(/\r\n/g, '\n')
const cohort = JSON.parse(read('development-cohort.json'))
const values = read('development-values.sql')

// ---- development VALUES -----------------------------------------------------------------------------------------------------
const blocks = {}
for (const m of values.matchAll(/^-- (\w+)\(.*?\)\n([\s\S]*?)(?=\n\n-- \w+\(|\s*(?![\s\S]))/gm)) blocks[m[1]] = m[2].trim()
if (!blocks.stints?.startsWith('(')) throw new Error('development-values.sql stints block looks empty')
if (!blocks.milestones?.startsWith('(')) throw new Error('development-values.sql milestones block looks empty')
const slugs = cohort.players.map((p) => p.slug)
if (new Set(slugs).size !== slugs.length) throw new Error('duplicate cohort player')
for (const s of cohort.excluded_047_cohort) if (slugs.includes(s)) throw new Error(`${s} is in the 047 controlled cohort and cannot be in 048`)
const stintSlugs = new Set([...blocks.stints.matchAll(/^\('([a-z0-9-]+)',(\d+),/gm)].map((m) => m[1]))
// players Migration 021 already researched have no new rows: the API adds nothing the database does not hold (derive-development.mjs proves it)
const already = cohort.already_researched ?? []
for (const s of already) if (!slugs.includes(s)) throw new Error(`${s} is marked as already researched but is not in the cohort`)
const fresh = slugs.filter((s) => !already.includes(s))
for (const s of fresh) if (!stintSlugs.has(s)) throw new Error(`cohort player ${s} has no stints in the values`)
for (const s of stintSlugs) if (!fresh.includes(s)) throw new Error(`stints for ${s}, who has no new development rows`)
// no level-debut milestone after the MLB debut season (a rehab or demotion appearance is not a development milestone)
const LEVEL_DEBUTS = new Set(['DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT'])
const ms = [...blocks.milestones.matchAll(/^\('([a-z0-9-]+)',(\d+),'(\w+)',(null|'[^']*'),'(\w+)',(\d+),/gm)].map((m) => ({ slug: m[1], code: m[3], season: Number(m[6]) }))
for (const s of fresh) {
  const debut = ms.find((m) => m.slug === s && m.code === 'MLB_DEBUT')
  if (!debut) throw new Error(`${s}: no MLB debut milestone`)
  for (const m of ms.filter((x) => x.slug === s && LEVEL_DEBUTS.has(x.code) && x.season > debut.season)) throw new Error(`${s}: ${m.code} (${m.season}) is after the MLB debut season`)
}
// progression reviews: 048 records only PENDING reviews (a reviewed decision is a person's judgment and is never asserted by a build)
const PENDING_NOTE_MIN = 80
for (const r of cohort.progression_reviews ?? []) {
  if (!slugs.includes(r.slug)) throw new Error(`progression review for ${r.slug}, who is not in the cohort`)
  if (!LEVEL_DEBUTS.has(r.event_code)) throw new Error(`${r.slug}: bad progression event ${r.event_code}`)
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
  as_of_date: cohort.as_of_date,
  cohort: cohort.players.map((p) => ({ slug: p.slug, mlb_id: p.mlb_id, already_researched: already.includes(p.slug) })),
  progression_reviews: (cohort.progression_reviews ?? []).map((r) => ({ slug: r.slug, event_code: r.event_code, decision_basis: r.decision_basis, confidence: r.confidence, as_of_date: r.as_of_date, notes: r.notes })),
})
const json = JSON.stringify(payload)
for (const tag of ['$m048$', '$r048$']) if (json.includes(tag)) throw new Error(`payload contains the dollar-quote tag ${tag}`)

let sql = read('048_template.sql')
sql = sql.split('{{payload_json}}').join(json)
sql = sql.replace('{{stints}}', () => blocks.stints).replace('{{milestones}}', () => block('milestones')).replace('{{sources}}', () => block('sources'))
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')
const dest = path.join(here, '../../sql/048_verified_mlb_development_coverage.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines, ${slugs.length} cohort players, ${fresh.length} with new rows)\n`)

// ---- rollback: generated from the same evidence so the two can never disagree -----------------------------------------------------
if (fs.existsSync(path.join(here, 'rollback_template.sql'))) {
  let rollback = read('rollback_template.sql')
  rollback = rollback.split('{{payload_json}}').join(json)
  rollback = rollback.replace('{{stints}}', () => blocks.stints).replace('{{milestones}}', () => block('milestones'))
  if (/\{\{\w+\}\}/.test(rollback)) throw new Error('unreplaced rollback placeholder')
  const rdest = path.join(here, '../../release/sql/rollback-048.sql')
  fs.writeFileSync(rdest, rollback)
  process.stderr.write(`wrote ${path.relative(process.cwd(), rdest)}\n`)
}
