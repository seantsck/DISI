#!/usr/bin/env node
// Builds database/research/048/development-values.sql: the reviewed development histories of the 048 cohort, from the official MLB Stats API
// pipeline (scripts/mlb/player-seasons.mjs and development-milestones.mjs), through the same VALUES generator Migration 021 used.
//
//   node database/research/048/derive-development.mjs <pipeline-output-dir> [--as-of 2026-10-20]
//
// The cohort is every verified MLB player outside the 047 controlled cohort, in deterministic development-queue order: verified MLB players
// whose full documented career is not yet on record. Rules applied here, in the open:
//   * stints are the player's whole recorded career, as 021 stored them (a stint is a fact; none is dropped or invented);
//   * a level-DEBUT milestone dated after the MLB debut season is a rehab or demotion appearance, not a development milestone, so it is
//     not recorded as one (its stint stays on record); MLB_DEBUT and ORGANIZATION_CHANGE are kept;
//   * nothing is filled in for seasons the API does not return: an earlier, unrecorded minor-league season stays unknown.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const dir = path.resolve(process.argv[2])
const asOf = process.argv.includes('--as-of') ? process.argv[process.argv.indexOf('--as-of') + 1] : '2026-10-20'
const COHORT = JSON.parse(fs.readFileSync(path.join(here, 'development-cohort.json'), 'utf8')).players.map((p) => p.slug)

const LEVEL_DEBUTS = new Set(['DSL_DEBUT', 'COMPLEX_DEBUT', 'A_DEBUT', 'HIGH_A_DEBUT', 'AA_DEBUT', 'AAA_DEBUT'])
const seasons = JSON.parse(fs.readFileSync(path.join(dir, 'player-seasons.json'), 'utf8'))
const milestones = JSON.parse(fs.readFileSync(path.join(dir, 'development-milestones.json'), 'utf8'))
seasons.records = seasons.records.filter((r) => COHORT.includes(r.slug))
milestones.records = milestones.records.filter((r) => COHORT.includes(r.slug))
if (seasons.records.length !== COHORT.length || milestones.records.length !== COHORT.length) throw new Error('the pipeline output does not cover the cohort')
let dropped = 0
for (const r of milestones.records) {
  const debut = r.milestones.find((m) => m.milestone === 'MLB_DEBUT')
  if (!debut) throw new Error(`${r.slug}: no MLB debut milestone`)
  const before = r.milestones.length
  r.milestones = r.milestones.filter((m) => !(LEVEL_DEBUTS.has(m.milestone) && m.season > debut.season))
  dropped += before - r.milestones.length
}
// Rows already on record (Migration 021 stored two of these players): never overwritten, never duplicated. A stint is the same row when its
// season, affiliate, league and level match; a milestone is already on record when the player has that event code at any precision.
const EXISTING = JSON.parse(fs.readFileSync(path.join(here, 'existing-development.json'), 'utf8')).players
let alreadyStints = 0
let alreadyMilestones = 0
for (const r of seasons.records) {
  const ex = EXISTING[r.slug]
  if (!ex) continue
  const keys = new Set(ex.stints.map((s) => s.join('|')))
  const before = r.stints.length
  r.stints = r.stints.filter((s) => !keys.has([s.season, s.teamName ?? '', s.league ?? '', s.level].join('|')))
  alreadyStints += before - r.stints.length
}
for (const r of milestones.records) {
  const ex = EXISTING[r.slug]
  if (!ex) continue
  const events = new Set(ex.milestones.map((m) => m[0]))
  const before = r.milestones.length
  r.milestones = r.milestones.filter((m) => !events.has(m.milestone))
  alreadyMilestones += before - r.milestones.length
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disi048-'))
fs.writeFileSync(path.join(tmp, 'player-seasons.json'), JSON.stringify(seasons))
fs.writeFileSync(path.join(tmp, 'development-milestones.json'), JSON.stringify(milestones))
const out = path.join(here, 'development-values.sql')
const r = spawnSync(process.execPath, [path.join(root, 'scripts/mlb/development-sql-values.mjs'), '--seasons', path.join(tmp, 'player-seasons.json'), '--milestones', path.join(tmp, 'development-milestones.json'), '--as-of', asOf, '--out', out], { encoding: 'utf8' })
if (r.status !== 0) throw new Error(r.stderr || 'generator failed')
console.log(r.stdout.trim(), `| post-debut level-debut milestones not recorded: ${dropped} | already on record (stints/milestones): ${alreadyStints}/${alreadyMilestones}`)
