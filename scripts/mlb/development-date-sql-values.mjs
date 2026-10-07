#!/usr/bin/env node
// Converts the REVIEWED exact-dates artifact into deterministic SQL VALUES
// blocks for migration 022, plus a decisions/coverage report. Never connects
// to a database: a person reviews the output before it is built in.
//
//   node scripts/mlb/development-date-sql-values.mjs \
//     --exact-dates research-output/022/development-exact-dates.json \
//     --as-of 2026-10-06 --out database/research/022/values.sql

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseIsoDate } from './lib/normalize.mjs'
import { sqlRow } from './lib/development.mjs'
import { stableStringify } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const asOf = parseIsoDate(requireArg(args, 'as-of', 'YYYY-MM-DD'))
const art = JSON.parse(fs.readFileSync(requireArg(args, 'exact-dates'), 'utf8'))
const out = requireArg(args, 'out')

const records = art.records.filter((r) => r.slug && r.mlbId)
const seenUpgrade = new Set()
const seenStintDate = new Set()
const seenNewMilestone = new Set()
const seenConflict = new Set()
const includedSources = new Map()

const track = (src) => {
  if (src?.url) includedSources.set(src.url, src)
}

const upgradeRows = []
const stintDateRows = []
const newMilestoneRows = []
const conflictRows = []

for (const r of records) {
  for (const u of r.upgrades ?? []) {
    const key = [r.slug, u.eventCode, u.milestoneDate].join('|')
    if (seenUpgrade.has(key)) continue
    seenUpgrade.add(key)
    track({ url: u.sourceUrl, retrievedAt: u.retrievedAt })
    upgradeRows.push(sqlRow([
      r.slug, r.mlbId, u.eventCode, u.milestoneDate,
      u.priorEvidenceBasis ?? 'SEASON_SPLITS', u.priorDatePrecision ?? 'SEASON',
      u.seasonYear, u.note ?? null, u.sourceUrl ?? null, u.retrievedAt ?? null, asOf,
    ]))
  }
  for (const d of r.stintDates ?? []) {
    if (!d.first) continue // seasons without game-log coverage stay NULL
    const key = [r.slug, d.season, d.teamId].join('|')
    if (seenStintDate.has(key)) continue
    seenStintDate.add(key)
    track({ url: d.sourceUrl, retrievedAt: d.retrievedAt })
    stintDateRows.push(sqlRow([
      r.slug, r.mlbId, d.season, d.teamName, d.league, d.level,
      d.first, d.last, d.basis ?? 'GAME_LOG', d.sourceUrl ?? null, d.retrievedAt ?? null, asOf,
    ]))
  }
  for (const m of r.newMilestones ?? []) {
    const key = [r.slug, m.eventCode, m.eventDate].join('|')
    if (seenNewMilestone.has(key)) continue
    seenNewMilestone.add(key)
    track({ url: m.sourceUrl, retrievedAt: m.retrievedAt })
    newMilestoneRows.push(sqlRow([
      r.slug, r.mlbId, m.eventCode, m.eventDate, m.seasonYear,
      m.organization ?? null, m.level ?? null, 'GAME_LOG', m.note ?? null, asOf,
      m.sourceUrl ?? null, m.retrievedAt ?? null,
    ]))
  }
  for (const c of r.conflicts ?? []) {
    // Only genuine exact-date disagreements become database conflicts; the
    // other kinds (no coverage, logs starting later) are research notes kept
    // in the decisions report and surfaced by the queue view instead.
    if (c.kind !== 'EXACT_DATE_CONFLICT') continue
    const key = [r.slug, c.kind, c.eventCode, c.valueA ?? '', c.valueB ?? ''].join('|')
    if (seenConflict.has(key)) continue
    seenConflict.add(key)
    conflictRows.push(sqlRow([
      r.slug, c.kind, `development_milestone.${c.eventCode}`, c.valueA, c.valueB, c.note ?? null, asOf,
    ]))
  }
}

const header = (name, cols) => `-- ${name}(${cols})`
const sql = [
  header('upgrades', 'slug, mlb_id, event_code, milestone_date, prior_evidence_basis, prior_date_precision, season_year, note, source_url, retrieved_at, as_of_date'),
  upgradeRows.join(',\n') || '-- none',
  '',
  header('stint_dates', 'slug, mlb_id, season, affiliate_team, league_name, level, first_game_date, last_game_date, game_date_basis, source_url, retrieved_at, as_of_date'),
  stintDateRows.join(',\n') || '-- none',
  '',
  header('new_milestones', 'slug, mlb_id, event_code, event_date, season_year, organization_name, level, evidence_basis, note, as_of_date, source_url, retrieved_at'),
  newMilestoneRows.join(',\n') || '-- none',
  '',
  header('conflicts', 'slug, conflict_type, field_name, value_a, value_b, note, as_of_date'),
  conflictRows.join(',\n') || '-- none',
  '',
  header('sources', 'url, retrieved_at'),
  [...includedSources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => sqlRow([s.url, s.retrievedAt ?? null])).join(',\n') || '-- none',
].join('\n\n') + '\n'

fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, sql)

// Coverage / decisions report (migration 021 conventions).
const players = records.length
const withUsableLogs = records.filter((r) => r.coverage.appearanceCount > 0).length
const withoutStructuredLogs = players - withUsableLogs
const report = {
  meta: {
    asOf,
    source: 'scripts/mlb/development-date-sql-values.mjs',
    participationRule: art.meta.participationRule,
    rules: art.meta.rules,
  },
  coverage: {
    playersQueried: players,
    playersWithUsableGameLogs: withUsableLogs,
    playersWithNoStructuredGameLogData: withoutStructuredLogs,
    upgrades: upgradeRows.length,
    stintsDated: stintDateRows.length,
    newMilestones: newMilestoneRows.length,
    conflicts: conflictRows.length,
    researchNotes: records.reduce((n, r) => n + (r.conflicts?.filter((c) => c.kind !== 'EXACT_DATE_CONFLICT').length ?? 0), 0),
    gameLogErrors: records.reduce((n, r) => n + (r.coverage.gameLogErrors?.length ?? 0), 0),
  },
  records: records.map((r) => ({ slug: r.slug, coverage: r.coverage })),
}
fs.writeFileSync(out.replace(/\.sql$/, '-decisions.json'), stableStringify(report))
process.stderr.write(
  `upgrades ${upgradeRows.length}; stint dates ${stintDateRows.length}; new milestones ${newMilestoneRows.length}; ` +
  `conflicts ${conflictRows.length}; sources ${includedSources.size} → ${out}\n`
)
