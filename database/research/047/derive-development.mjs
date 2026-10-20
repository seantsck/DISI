#!/usr/bin/env node
// Builds database/research/047/development-values.sql: the reviewed development histories of the 047 cohort, from the official MLB Stats API
// pipeline (scripts/mlb/player-seasons.mjs and development-milestones.mjs), through the same VALUES generator Migration 021 used.
//
//   node database/research/047/derive-development.mjs <pipeline-output-dir> [--as-of 2026-10-06]
//
// The cohort is the first ten rows of the deterministic tier-1 development queue (research:development --missing): verified MLB players
// whose pre-MLB history is not on record. Rules applied here, in the open:
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
const asOf = process.argv.includes('--as-of') ? process.argv[process.argv.indexOf('--as-of') + 1] : '2026-10-06'
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disi047-'))
fs.writeFileSync(path.join(tmp, 'player-seasons.json'), JSON.stringify(seasons))
fs.writeFileSync(path.join(tmp, 'development-milestones.json'), JSON.stringify(milestones))
const out = path.join(here, 'development-values.sql')
const r = spawnSync(process.execPath, [path.join(root, 'scripts/mlb/development-sql-values.mjs'), '--seasons', path.join(tmp, 'player-seasons.json'), '--milestones', path.join(tmp, 'development-milestones.json'), '--as-of', asOf, '--out', out], { encoding: 'utf8' })
if (r.status !== 0) throw new Error(r.stderr || 'generator failed')
console.log(r.stdout.trim(), `| post-debut level-debut milestones not recorded: ${dropped}`)
