#!/usr/bin/env node
// Assembles database/sql/027_canonical_seed_drift_reconciliation.sql from:
//   027_template.sql               hand-written guarded reconciliation steps
//   reconciliation-manifest.json   exact drift manifest (stable natural selectors)
//   audit-report.json              written by audit.mjs; the build refuses to run if the audit failed
//
//   node database/research/027/audit.mjs && node database/research/027/build.mjs
//
// Deterministic: the same inputs always produce the same file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'reconciliation-manifest.json'), 'utf8'))
const audit = JSON.parse(fs.readFileSync(path.join(here, 'audit-report.json'), 'utf8'))
if (audit.failures.length) throw new Error(`audit has failures: ${audit.failures.join('; ')}`)

const cats = manifest.categories
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v)

// The migration needs only what it compares and writes: selectors, canonical values and the known live variants.
const slim = (name, withLive = false, withGuard = false, withRank = false, withLegacy = false) => cats[name].entries.map((e) => {
  const out = { selector: e.selector, canonical: e.canonical }
  if (withRank) out.rank = e.rank
  if (withLive) out.live = e.live
  if (withLegacy) out.legacy = e.replay_original
  if (withGuard) out.guard = e.guard
  return out
})
const payload = sortKeys({
  signing_environments: slim('signing_environments'),
  signing_environment_assignments: slim('signing_environment_assignments', false, true),
  transactions: slim('transactions'),
  player_aliases: slim('player_aliases'),
  sources_missing: slim('sources_missing'),
  source_metadata_variants: slim('source_metadata_variants', true),
  evidence: [...slim('evidence_missing', true, false, true), ...slim('evidence_variants', true, false, true), ...slim('evidence_note_neutralizations', true, false, true, true)],
  legacy_trainers: slim('legacy_trainers'),
  legacy_player_trainers: slim('legacy_player_trainers'),
})
const json = JSON.stringify(payload)
if (json.includes('$m027$')) throw new Error('payload contains the dollar-quote tag')

let sql = fs.readFileSync(path.join(here, '027_template.sql'), 'utf8').replace(/\r\n/g, '\n')
if (!sql.includes('{{payload_json}}')) throw new Error('template has no {{payload_json}}')
sql = sql.split('{{payload_json}}').join(json)
if (/\{\{\w+\}\}/.test(sql)) throw new Error('unreplaced placeholder')

const dest = path.join(here, '../../sql/027_canonical_seed_drift_reconciliation.sql')
fs.writeFileSync(dest, sql)
process.stderr.write(`wrote ${path.relative(process.cwd(), dest)} (${sql.split('\n').length - 1} lines)\n`)
