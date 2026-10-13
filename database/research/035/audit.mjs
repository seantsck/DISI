#!/usr/bin/env node
// Audits the 035 research inputs against the canonical 001-034 replay (in memory, PGlite) and writes audit-report.json.
//
//   node database/research/035/audit.mjs
//
// Checks: the roster of non-Dodgers Top-prospect signings equals the researched player list (nothing missing, nothing extra);
// no benchmark outcome audit, outcome or team-season row exists yet; every resolved identity agrees with the stored one; the
// WAR seed covers every player who reached MLB; every team code in the seed maps to an organization.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildChainThrough } from '../../../tests/db/canonical-chain.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
const outcomes = read('benchmark-outcomes.json')
const war = read('war-seed.json')
const failures = []

const chain = await buildChainThrough('034_downstream_organizational_value_chains.sql')
const q = (s, p) => chain.query(s, p)
const baseline = {
  audits: (await q('select count(*)::int as n from outcome_audits'))[0].n,
  outcomes: (await q('select count(*)::int as n from outcomes'))[0].n,
  war_rows: (await q('select count(*)::int as n from player_mlb_team_season_war'))[0].n,
  analysis_as_of_date: (await q('select max(audited_through_date)::text as d from outcome_audits'))[0].d,
}
const roster = await q(`select p.slug, p.mlb_id::text as mlb_id, p.bref_id, o.abbreviation as org, s.signing_year
  from signings s join players p on p.id = s.player_id join organizations o on o.id = s.organization_id
  where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT' and o.franchise_key <> 'DODGERS'`)
const rosterBySlug = new Map(roster.map((r) => [r.slug, r]))
const researched = new Map(outcomes.players.map((p) => [p.slug, p]))
for (const r of roster) if (!researched.has(r.slug)) failures.push(`roster player ${r.slug} was not researched`)
for (const p of outcomes.players) {
  const r = rosterBySlug.get(p.slug)
  if (!r) { failures.push(`researched player ${p.slug} is not a non-Dodgers Top-prospect signing`); continue }
  if (r.org !== p.org || r.signing_year !== p.signing_year) failures.push(`${p.slug}: organization/year differs`)
  if (r.mlb_id && p.mlb_id && r.mlb_id !== p.mlb_id) failures.push(`${p.slug}: stored MLB id ${r.mlb_id} differs from researched ${p.mlb_id}`)
  if (p.mlb_debut_date && p.mlb_debut_date > outcomes.audit_through_date) failures.push(`${p.slug}: debut after the audit boundary`)
}
const existing = await q(`select count(*)::int as n from outcome_audits a join players p on p.id = a.player_id where p.slug = any($1)`, [outcomes.players.map((p) => p.slug)])
if (existing[0].n !== 0) failures.push(`${existing[0].n} benchmark audits already exist`)
const reached = outcomes.players.filter((p) => p.mlb_debut_date)
const warPersons = new Set(war.rows.map((r) => r.bref_id))
const brefByMlb = new Map(Object.values(war.scope.players).map((p) => [p.mlb_id, p.bref_id]))
for (const p of reached) if (!warPersons.has(brefByMlb.get(p.mlb_id))) failures.push(`${p.slug}: reached MLB but has no WAR rows`)
const maps = await q('select bref_team_code, from_season, to_season from bref_team_code_map')
for (const r of war.rows) {
  if (!maps.some((m) => m.bref_team_code === r.team && r.season >= m.from_season && r.season <= (m.to_season ?? 9999))) failures.push(`unmapped team code ${r.team} ${r.season}`)
}
if (baseline.analysis_as_of_date !== outcomes.audit_through_date) failures.push(`as-of date ${baseline.analysis_as_of_date} would move to ${outcomes.audit_through_date}`)

const report = {
  baseline,
  benchmark_roster: roster.length,
  researched: outcomes.players.length,
  identity_resolved: outcomes.players.filter((p) => p.mlb_id).length,
  reached: reached.length,
  war_rows: war.rows.length,
  failures,
}
fs.writeFileSync(path.join(here, 'audit-report.json'), JSON.stringify(report, null, 1) + '\n')
console.log(JSON.stringify(report))
if (failures.length) process.exitCode = 1
