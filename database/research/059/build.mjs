#!/usr/bin/env node
// Assembles Migration 059 and its rollback from the reviewed research (scope.json) and the pre-059 canonical replay (baseline.json), and writes
// career-bwar-evidence.json. Deterministic: the same inputs give byte-identical files. Refuses if the baseline does not reproduce the reviewed scope.
//   node database/research/059/build.mjs            write database/sql/059_..., database/release/sql/rollback-059.sql, career-bwar-evidence.json
//   node database/research/059/build.mjs --check    verify the committed files equal the build output

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'))
export const research = { scope: read('scope.json'), baseline: read('baseline.json') }
const { scope, baseline } = research
export const MIGRATION = path.join(root, 'database/sql/059_career_bwar_metric_reconciliation.sql')
export const ROLLBACK = path.join(root, 'database/release/sql/rollback-059.sql')
const EVIDENCE = path.join(here, 'career-bwar-evidence.json')

const need = (ok, msg) => { if (!ok) throw new Error(`059 build: ${msg}`) }
const num = (x) => Number(x)
const bat = scope.sources.files.find((f) => f.component === 'BAT'), pitch = scope.sources.files.find((f) => f.component === 'PITCH')

/** The notes of one 059 observation: the derivation, the as-of and both pinned data files. */
export const notesFor = (p) => `Migration 059: sum of the ACTIVE Baseball-Reference BWAR batting and pitching team-season WAR rows for mlb_ID ${p.mlb_id} (${p.bref_id}), `
  + `rounded to one decimal; career-to-date through the ${scope.semantics.observed_through_season} season (data files of ${scope.semantics.observed_through_date}). `
  + `Batting file: ${bat.url} (sha256 ${bat.sha256}); pitching file: ${pitch.url} (sha256 ${pitch.sha256}).`

// ---- the baseline must reproduce the reviewed scope, exactly
need(scope.players.length === 11 && new Set(scope.players.map((p) => p.slug)).size === 11, 'the scope is not eleven distinct players')
need(scope.excluded_057.length === 11 && !scope.players.some((p) => scope.excluded_057.some((x) => x.slug === p.slug)), 'a 057 player is in scope')
need(scope.sources.metric_source_url === bat.url, 'the metric source is not the batting data file')
for (const f of [bat, pitch]) need(baseline.war_sources.some((s) => s.url === f.url && s.source_type === 'WAR_DATA_FILE' && s.source_tier === 'BASEBALL_REFERENCE'), `${f.url} is not a registered source`)
const careerBefore = baseline.metric.find((m) => m.metric_key === 'CAREER_BWAR')
need(careerBefore && careerBefore.observations === scope.reviewed_effect.career_bwar_observations[0], 'the CAREER_BWAR observation count is not the reviewed one')
need(baseline.scoped_metric.length === 0, 'one of the eleven or the 057 eleven already has a CAREER_BWAR observation')
need(baseline.counts.sources === scope.reviewed_effect.sources[0], 'the source count is not the reviewed one')
need(baseline.war.active === scope.reviewed_effect.team_season_war_active[0], 'the active team-season WAR count is not the reviewed one')
const missingBefore = baseline.bwar_missing.map((x) => x.player_slug).sort()
need(missingBefore.length === scope.reviewed_effect.bwar_missing[0], 'the BWAR_MISSING count is not the reviewed one')
need(baseline.bwar_missing.every((x) => x.franchise_key !== 'DODGERS'), 'a Dodgers signing is in BWAR_MISSING')
for (const p of scope.players) {
  const l = baseline.ledger.find((x) => x.slug === p.slug), id = baseline.identity.find((x) => x.slug === p.slug)
  need(l && id, `${p.slug} has no ledger or identity`)
  need(id.bref_id === p.bref_id && id.mlb_id === p.mlb_id && id.signings === 1 && id.record_scope === 'MLB_PIPELINE_TOP_PROSPECT' && id.franchise !== 'DODGERS', `${p.slug}: identity`)
  need(l.rows === p.rows && l.bat_rows === p.bat_rows && l.pitch_rows === p.pitch_rows && l.unmapped === 0 && l.tot === 0, `${p.slug}: ledger shape`)
  need(num(l.bat) === num(p.bat_bwar) && num(l.pitch) === num(p.pitch_bwar) && num(l.total) === num(p.raw_bwar) && num(l.total_1dp) === num(p.career_bwar), `${p.slug}: ledger sums`)
  need(num(l.outcome_career_war) === num(p.raw_bwar), `${p.slug}: outcomes.career_war`)
  need(l.observed === `${scope.semantics.observed_through_date}/${scope.semantics.observed_through_season}`, `${p.slug}: ledger as-of`)
  need(l.sources.split(' ').every((u) => u === bat.url || u === pitch.url), `${p.slug}: a ledger row cites another source`)
  need(missingBefore.includes(p.slug), `${p.slug} is not in BWAR_MISSING`)
}
for (const x of scope.excluded_057) need(missingBefore.includes(x.slug), `${x.slug} (057) is not in BWAR_MISSING`)
const missingAfter = missingBefore.filter((s) => !scope.players.some((p) => p.slug === s))
need(missingAfter.length === scope.reviewed_effect.bwar_missing[1], 'the post-059 BWAR_MISSING count is not the reviewed one')

export const payload = {
  semantics: scope.semantics,
  sources: { bat_url: bat.url, pitch_url: pitch.url, bat_sha256: bat.sha256, pitch_sha256: pitch.sha256, file_last_modified: scope.sources.file_last_modified },
  players: scope.players.map((p) => ({ slug: p.slug, bref_id: p.bref_id, mlb_id: p.mlb_id, rows: p.rows, bat_rows: p.bat_rows, pitch_rows: p.pitch_rows,
    bat_bwar: p.bat_bwar, pitch_bwar: p.pitch_bwar, raw_bwar: p.raw_bwar, career_bwar: p.career_bwar, notes: notesFor(p) })),
  excluded_057: scope.excluded_057.map((x) => x.slug),
  baseline: { career_bwar_observations: careerBefore.observations, sources: baseline.counts.sources, bwar_missing_before: missingBefore, bwar_missing_after: missingAfter },
}

const fill = (template, tag) => {
  const json = JSON.stringify(payload)
  need(!json.includes(`$${tag}$`), 'the payload contains the dollar-quote tag')
  return fs.readFileSync(path.join(here, template), 'utf8').replace('{{payload_json}}', () => json)
}
export const assemble = () => fill('059_template.sql', 'm059')
export const assembleRollback = () => fill('rollback_template.sql', 'r059')
export const evidence = () => ({
  generated_by: 'database/research/059/build.mjs',
  note: 'The eleven reviewed players as the pre-059 canonical replay reads them (baseline.json): identity, complete team-season ledger, BAT / PITCH sums, the one-decimal value and the stored outcomes.career_war. Production reads the same (baseline-production.json).',
  semantics: scope.semantics,
  sources: payload.sources,
  players: scope.players.map((p) => {
    const l = baseline.ledger.find((x) => x.slug === p.slug)
    return { slug: p.slug, name: p.name, bref_id: p.bref_id, mlb_id: p.mlb_id, current_status: l.current_status, rows: l.rows, bat_rows: l.bat_rows, pitch_rows: l.pitch_rows,
      null_war_rows: l.null_war_rows, seasons: `${l.first_season}-${l.last_season}`, seasons_with_rows: l.seasons, teams: l.teams, bat_bwar: l.bat, pitch_bwar: l.pitch,
      raw_bwar: l.total, career_bwar: l.total_1dp, outcome_career_war: l.outcome_career_war, ledger_as_of: l.observed, notes: notesFor(p) }
  }),
  excluded_057: scope.excluded_057.map((x) => { const l = baseline.ledger.find((y) => y.slug === x.slug); return { slug: x.slug, last_season: l?.last_season ?? null, raw_bwar: l?.total ?? null, sources: l?.sources ?? null, reason: x.reason } }),
  bwar_missing: { before: missingBefore.length, after: missingAfter.length, removed: scope.players.map((p) => p.slug).sort(), remaining: missingAfter,
    remaining_with_team_season_war: missingAfter.filter((s) => baseline.ledger.some((l) => l.slug === s)).length, remaining_without_team_season_war: missingAfter.filter((s) => !baseline.ledger.some((l) => l.slug === s)).length },
})

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputs = [[MIGRATION, assemble()], [ROLLBACK, assembleRollback()], [EVIDENCE, JSON.stringify(evidence(), null, 1) + '\n']]
  if (process.argv.includes('--check')) {
    const stale = outputs.filter(([f, t]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== t).map(([f]) => path.relative(root, f))
    if (stale.length) { console.error(`stale: ${stale.join(', ')}`); process.exit(1) }
    console.log('059 build output is current')
  } else {
    for (const [f, t] of outputs) fs.writeFileSync(f, t)
    console.log(`wrote ${outputs.map(([f]) => path.relative(root, f)).join(', ')}`)
  }
}
