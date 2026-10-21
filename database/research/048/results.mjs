#!/usr/bin/env node
// What the 048 research achieved, player by player, from two saved research datasets that include the stint history
// (npm run research:development -- --review --save file.json): the pre-048 state and the post-048 state.
//   node database/research/048/results.mjs <before.json> <after.json>
// Each cohort player is classified SUBSTANTIALLY_EXPANDED, PARTIALLY_EXPANDED, NO_NEW_RELIABLE_EVIDENCE or UNRESOLVED_OR_CONFLICTED
// (lib/research/history-coverage.js researchResult). Deterministic.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleDataset } from '../../../lib/research/dataset.js'
import { developmentRecords, timingFacts } from '../../../lib/research/development-research.js'
import { historyCoverage, researchResult, RESEARCH_RESULT } from '../../../lib/research/history-coverage.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const cohort = JSON.parse(fs.readFileSync(path.join(here, 'development-cohort.json'), 'utf8'))
const load = (f) => assembleDataset(JSON.parse(fs.readFileSync(f, 'utf8')))
const before = load(process.argv[2])
const after = load(process.argv[3])
if (!before.stints.length || !after.stints.length) throw new Error('Both datasets need the stint history (save them with --review or --mlb-coverage).')

// Datasets are compared by player slug: player ids are database-generated and differ between a production read and a replay.
const index = (d) => {
  const by = (rows) => { const m = new Map(); for (const r of rows) { if (!m.has(r.player_slug)) m.set(r.player_slug, []); m.get(r.player_slug).push(r) } return m }
  const slugOf = new Map(d.signings.map((s) => [s.player_id, s.player_slug]))
  return { stints: by(d.stints), milestones: by(d.milestones), records: new Map(developmentRecords(d).map((r) => [r.player_slug, r])), signings: new Map(d.signings.map((s) => [s.player_slug, s])),
    pending: new Set(d.progressionDecisions.filter((x) => x.review_status === 'PENDING_REVIEW').map((x) => slugOf.get(x.player_id))), summary: new Map(d.developmentSummary.map((s) => [s.player_slug, s])) }
}
const B = index(before)
const A = index(after)
const debutSeason = (s) => (s?.mlb_debut_date ? Number(String(s.mlb_debut_date).slice(0, 4)) : null)
const preMlb = (rows, season) => rows.filter((s) => (s.stint_kind ?? 'TEAM_STINT') === 'TEAM_STINT' && s.level !== 'MLB' && (season === null || s.season <= season))

const rows = cohort.players.map((p) => {
  const sg = A.signings.get(p.slug)
  const id = p.slug
  const season = debutSeason(sg)
  const stintsBefore = B.stints.get(id) ?? []
  const stintsAfter = A.stints.get(id) ?? []
  const addedPre = preMlb(stintsAfter, season).length - preMlb(stintsBefore, season).length
  const history = historyCoverage({ signing_year: sg.signing_year, mlb_debut_date: sg.mlb_debut_date, pathway: sg.pathway }, stintsAfter)
  const pendingCreated = A.pending.has(id) && !B.pending.has(id)
  const exactBefore = B.summary.get(id)?.days_signing_to_mlb_exact != null
  const exactAfter = A.summary.get(id)?.days_signing_to_mlb_exact != null
  return {
    slug: p.slug,
    result: researchResult({ added_pre_mlb_stints: addedPre, pending_review: A.pending.has(id), history }),
    stints_added: stintsAfter.length - stintsBefore.length,
    pre_mlb_stints_added: addedPre,
    milestones_added: (A.milestones.get(id) ?? []).length - (B.milestones.get(id) ?? []).length,
    first_observed_season: history.first_observed_season,
    first_pro_before: B.records.get(p.slug)?.dims.FIRST_PRO_SEASON ?? null,
    first_pro_after: A.records.get(p.slug)?.dims.FIRST_PRO_SEASON ?? null,
    first_pro_status_after: A.records.get(p.slug)?.first_pro_status ?? null,
    exact_timing_added: !exactBefore && exactAfter,
    ambiguous_sequence_created: pendingCreated,
    gaps: history.gaps.map((g) => g.code),
    notes: history.notes.map((n) => n.code),
  }
})
const count = (f) => rows.filter(f).length
const byResult = Object.fromEntries(RESEARCH_RESULT.map((r) => [r, rows.filter((x) => x.result === r).map((x) => x.slug)]))
const summary = {
  cohort_size: rows.length,
  players_with_new_rows: count((r) => r.stints_added > 0),
  stints_added: rows.reduce((n, r) => n + r.stints_added, 0),
  milestones_added: rows.reduce((n, r) => n + r.milestones_added, 0),
  first_professional_seasons_resolved: count((r) => r.first_pro_before !== 'KNOWN' && r.first_pro_after === 'KNOWN'),
  exact_signing_to_mlb_added: count((r) => r.exact_timing_added),
  ambiguous_sequences_created: count((r) => r.ambiguous_sequence_created),
  results: Object.fromEntries(Object.entries(byResult).map(([k, v]) => [k, v.length])),
  by_result: byResult,
  signing_to_mlb_before: timingFacts(before).signing_to_mlb_exact,
  signing_to_mlb_after: timingFacts(after).signing_to_mlb_exact,
}
console.log(JSON.stringify({ summary, players: rows }, null, 2))
