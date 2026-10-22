#!/usr/bin/env node
// Derives the 051 research artifacts for the audited no-MLB cohort from two read-only inputs:
//   <pipeline-dir>  the official MLB Stats API pipeline output for the cohort (scripts/mlb/player-seasons.mjs, development-milestones.mjs,
//                   player-game-logs.mjs, development-exact-dates.mjs; cached, one request every 750 ms)
//   <dataset.json>  the canonical state, saved read-only as the public anon role:
//                   npm run research:development -- --no-mlb-coverage --save <dataset.json>
//
//   node database/research/051/derive.mjs <pipeline-dir> <dataset.json>
//
// Writes cohort.json, development-records.json, coverage-before-after.json, needs-before-after.json, progression-review.json,
// source-manifest.json and baseline.json next to this file. Deterministic: the same inputs always produce the same bytes (no clock is read).
//
// The cohort is DERIVED: every Dodgers tracked signing whose canonical outcome audit is VERIFIED_NO_MLB. The comparison is a fact-for-fact
// match of what the official source carries against what DISI holds; nothing is inferred for a season, level, organization or date the source
// does not carry. 051 writes a canonical row only where this comparison finds a reviewed fact DISI lacks (it found none; see README.md).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleDataset } from '../../../lib/research/dataset.js'
import { developmentRecords, developmentCoverage } from '../../../lib/research/development-research.js'
import { developmentNeeds, developmentNeedSummary, NEED_GROUPS } from '../../../lib/research/development-needs.js'
import { auditedNoMlbCohort, auditedNoMlbCoverage, LEAGUE_SEASON_NOT_PLAYED } from '../../../lib/research/history-coverage.js'
import { stableJson } from '../../../lib/research/format.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const [dirArg, datasetArg] = process.argv.slice(2)
if (!dirArg || !datasetArg) throw new Error('usage: node database/research/051/derive.mjs <pipeline-dir> <dataset.json>')
const dir = path.resolve(dirArg)
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const raw = load(path.resolve(datasetArg))
const data = assembleDataset(raw)
if (!(data.stints ?? []).length) throw new Error('the dataset has no stint history; save it with --no-mlb-coverage --save')
const seasons = load(path.join(dir, 'player-seasons.json'))
const milestones = load(path.join(dir, 'development-milestones.json'))
const gameLogs = load(path.join(dir, 'player-game-logs.json'))
const exact = load(path.join(dir, 'development-exact-dates.json'))

const write = (name, value) => fs.writeFileSync(path.join(here, name), stableJson(value) + '\n')
const day = (v) => (v ? String(v).slice(0, 10) : null)
const bySlug = (rows) => new Map(rows.map((r) => [r.slug, r]))
const group = (rows, key) => {
  const m = new Map()
  for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return m
}

// ---- cohort ------------------------------------------------------------------------------------------------------------------------------
const cohort = auditedNoMlbCohort(data.signings).slice().sort((a, b) => a.signing_year - b.signing_year || (a.player_slug < b.player_slug ? -1 : 1))
const directory = new Map((data.directory ?? []).map((d) => [d.player_id, d]))
const slugs = cohort.map((s) => s.player_slug)
for (const r of seasons.records) if (!slugs.includes(r.slug)) throw new Error(`pipeline player ${r.slug} is not in the derived cohort`)
for (const s of slugs) if (!seasons.records.some((r) => r.slug === s)) throw new Error(`cohort player ${s} has no pipeline record`)
const excluded = {
  verified_mlb: data.signings.filter((s) => s.outcome_audit_status === 'VERIFIED_MLB').length,
  not_audited: data.signings.filter((s) => s.outcome_audit_status === 'NOT_AUDITED').length,
  // benchmark players are not Dodgers tracked signings: the dataset's signings are the Dodgers population only
  benchmark_players_in_cohort: cohort.filter((s) => s.population_class && s.population_class !== 'TRACKED_SAMPLE' && s.population_class !== 'OPENING_CLASS_CENSUS').length,
}

// ---- fact-for-fact comparison: official source vs the canonical record ---------------------------------------------------------------------
const stored = group(data.stints, (s) => s.player_slug)
const storedMilestones = group(data.milestones ?? [], (m) => m.player_slug)
const exactBySlug = bySlug(exact.records)
const logsBySlug = bySlug(gameLogs.records)
const milestoneBySlug = bySlug(milestones.records)
const key = (season, team, league, level) => [season, team ?? '', league ?? '', level].join('|')
const games = (s) => s.batting?.games ?? s.pitching?.games ?? s.pitchingLine?.games ?? null
const records = []
for (const s of cohort) {
  const api = seasons.records.find((r) => r.slug === s.player_slug)
  const have = stored.get(s.player_slug) ?? []
  const haveByKey = new Map(have.map((t) => [key(t.season, t.affiliate_team, t.league_name, t.level), t]))
  const apiByKey = new Map(api.stints.map((t) => [key(t.season, t.teamName, t.league, t.level), t]))
  const apiOnly = [...apiByKey.keys()].filter((k) => !haveByKey.has(k)).sort()
  const storedOnly = [...haveByKey.keys()].filter((k) => !apiByKey.has(k)).sort()
  const statDiffs = []
  const kindDiffs = []
  for (const [k, t] of apiByKey) {
    const h = haveByKey.get(k)
    if (!h) continue
    const hg = h.g ?? h.pg
    const ag = games(t)
    if (hg != null && ag != null && Number(hg) !== Number(ag)) statDiffs.push(`${k}: games ${hg} on record, ${ag} in the source`)
    if ((h.stint_kind ?? 'TEAM_STINT') !== t.stintKind && !(h.stint_kind === 'SEASON_TOTAL' && t.stintKind === 'TEAM_STINT')) kindDiffs.push(`${k}: ${h.stint_kind} on record, ${t.stintKind} in the source`)
  }
  // game-log dates: each dated stint and each dated first appearance the official game log supports, matched to what is on record
  const ex = exactBySlug.get(s.player_slug)
  let datesMatched = 0
  const dateFills = []
  const dateDiffs = []
  const undated = []
  for (const d of ex?.stintDates ?? []) {
    const h = haveByKey.get(key(d.season, d.teamName, d.league, d.level))
    if (!h) continue
    if (!d.first || !d.last) {
      if (!(h.first_game_date && h.last_game_date) && (h.stint_kind ?? 'TEAM_STINT') === 'TEAM_STINT' && d.season >= 2006) {
        undated.push({ stint: key(d.season, d.teamName, d.league, d.level), reason: d.level === 'FOREIGN_PRO'
          ? 'The official minor-league game log returns no games for this foreign professional league season; the dates stay unknown.'
          : 'The official game log returns no games for this stint; the dates stay unknown.' })
      }
      continue
    }
    if (day(h.first_game_date) === d.first && day(h.last_game_date) === d.last) datesMatched += 1
    else if (!h.first_game_date || !h.last_game_date) dateFills.push(`${key(d.season, d.teamName, d.league, d.level)}: ${d.first}..${d.last}`)
    else dateDiffs.push(`${key(d.season, d.teamName, d.league, d.level)}: ${day(h.first_game_date)}..${day(h.last_game_date)} on record, ${d.first}..${d.last} in the game log`)
  }
  const haveMs = new Map((storedMilestones.get(s.player_slug) ?? []).map((m) => [m.event_code, m]))
  let msMatched = 0
  const msNew = []
  const msUpgrades = []
  const msDiffs = []
  for (const u of [...(ex?.upgrades ?? []), ...(ex?.newMilestones ?? [])]) {
    const date = u.milestoneDate ?? u.eventDate
    const h = haveMs.get(u.eventCode)
    if (!h) msNew.push(`${u.eventCode} ${date}`)
    else if (h.date_precision === 'DAY' && day(h.milestone_date) === date) msMatched += 1
    else if (h.date_precision !== 'DAY') msUpgrades.push(`${u.eventCode}: season ${h.season_year} on record, ${date} in the game log`)
    else msDiffs.push(`${u.eventCode}: ${day(h.milestone_date)} on record, ${date} in the game log`)
  }
  const apiCandidates = milestoneBySlug.get(s.player_slug)?.milestones ?? []
  const missingCandidates = apiCandidates.filter((m) => !haveMs.has(m.milestone)).map((m) => `${m.milestone} ${m.eventDate ?? m.season}`)
  const logs = logsBySlug.get(s.player_slug)
  records.push({
    player_slug: s.player_slug,
    mlb_id: directory.get(s.player_id)?.mlb_id ?? null,
    signing_year: s.signing_year,
    source: { stints: api.stints.length, milestone_candidates: apiCandidates.length, game_log_fetches: logs?.fetches?.length ?? logs?.targets?.length ?? null,
      dated_appearances: ex?.coverage?.appearanceCount ?? 0, game_log_errors: ex?.coverage?.gameLogErrors?.length ?? 0 },
    on_record: { stints: have.length, milestones: haveMs.size },
    stints: { matched: api.stints.length - apiOnly.length, in_source_not_on_record: apiOnly, on_record_not_in_source: storedOnly, stat_differences: statDiffs, kind_differences: kindDiffs },
    game_dates: { stints_matched: datesMatched, stints_fillable: dateFills, stints_conflicting: dateDiffs, undated },
    milestones: { game_log_dated_matched: msMatched, new_from_game_log: msNew, season_to_day_upgrades: msUpgrades, conflicting: msDiffs, source_candidates_not_on_record: missingCandidates },
    date_conflicts_reported_by_pipeline: (ex?.conflicts ?? []).length,
    reviewed_facts_disi_lacks: apiOnly.length + dateFills.length + msNew.length + msUpgrades.length + missingCandidates.length,
    disagreements: storedOnly.length + statDiffs.length + kindDiffs.length + dateDiffs.length + msDiffs.length + (ex?.conflicts ?? []).length,
  })
}

// ---- coverage, needs, progression --------------------------------------------------------------------------------------------------------
const stintsByPlayer = group(data.stints, (s) => s.player_id)
const coverage = auditedNoMlbCoverage(data, stintsByPlayer, developmentRecords, developmentNeeds)
const { rows: coverageRows, ...coverageSummary } = coverage
const cohortIds = new Set(cohort.map((s) => s.player_id))
const cohortQueue = (data.developmentQueue ?? []).filter((q) => cohortIds.has(q.player_id))
const cohortNeeds = developmentNeeds(data).filter((n) => cohortIds.has(n.player_id))
const byNeed = Object.fromEntries(NEED_GROUPS.map((g) => [g.key, cohortNeeds.filter((n) => n.need === g.key).length]))
const detectorRows = {}
for (const q of cohortQueue) detectorRows[q.issue] = (detectorRows[q.issue] ?? 0) + 1
const needsState = {
  whole_database: developmentNeedSummary(data),
  audited_no_mlb_cohort: {
    detector_rows: cohortQueue.length,
    detector_rows_by_issue: Object.fromEntries(Object.entries(detectorRows).sort(([a], [b]) => (a < b ? -1 : 1))),
    distinct_needs: cohortNeeds.length,
    players_with_needs: new Set(cohortNeeds.map((n) => n.player_id)).size,
    by_need: byNeed,
  },
}
const decisions = (data.progressionDecisions ?? []).filter((d) => cohortIds.has(d.player_id))
const slugOf = new Map(cohort.map((s) => [s.player_id, s.player_slug]))
// the 048 inversion rule over first appearances: a lower ladder level first recorded after a higher one (rookie levels share a tier)
const TIER = { DSL_DEBUT: 1, COMPLEX_DEBUT: 1, A_DEBUT: 3, HIGH_A_DEBUT: 4, AA_DEBUT: 5, AAA_DEBUT: 6 }
const inversions = []
for (const s of cohort) {
  const first = {}
  for (const m of storedMilestones.get(s.player_slug) ?? []) if (TIER[m.event_code]) first[m.event_code] = day(m.milestone_date) ?? String(m.season_year)
  const flagged = new Set()
  for (const lo of Object.keys(first)) for (const hi of Object.keys(first)) if (TIER[hi] > TIER[lo] && first[lo] > first[hi]) { flagged.add(lo); flagged.add(hi) }
  if (!flagged.size) continue
  const covering = decisions.filter((d) => d.player_id === s.player_id)
  inversions.push({
    player_slug: s.player_slug,
    first_appearances: Object.fromEntries(Object.entries(first).sort(([a], [b]) => TIER[a] - TIER[b] || (a < b ? -1 : 1))),
    inverted_events: [...flagged].sort(),
    decisions: covering.map((d) => ({ event_code: d.event_code, progression_role: d.progression_role, review_status: d.review_status, confidence: d.confidence })).sort((a, b) => (a.event_code < b.event_code ? -1 : 1)),
    // the queue's own test (v_dodgers_development_research_queue): an inversion is open only while REACHED arrivals still run backward
    open_in_queue: cohortQueue.some((q) => q.player_id === s.player_id && q.issue === 'NON_MONOTONIC_PROGRESSION'),
  })
}

// ---- organization review: every season with two organizations (MULTI_ORG_SEASON_UNVERIFIED), against the recorded exit transaction -----------
// Evidence only. The detector asks for the trade date to be verified; the transaction model is the only source for an exit, so this reports
// whether the dated game-log appearances bracket the recorded exit date. It never creates, moves or infers a transaction.
const exitsById = new Map((data.exitSummary ?? []).map((e) => [e.player_id, e]))
const organizationSeasons = []
for (const s of cohort) {
  const team = (stored.get(s.player_slug) ?? []).filter((t) => (t.stint_kind ?? 'TEAM_STINT') === 'TEAM_STINT' && t.organization_name && t.level !== 'FOREIGN_PRO')
  for (const [season, rows] of group(team, (t) => t.season)) {
    const orgs = [...new Set(rows.map((t) => t.organization_name))].sort()
    if (orgs.length < 2) continue
    const span = (org) => {
      const r = rows.filter((t) => t.organization_name === org)
      const first = r.map((t) => day(t.first_game_date)).filter(Boolean).sort()[0] ?? null
      const last = r.map((t) => day(t.last_game_date)).filter(Boolean).sort().at(-1) ?? null
      return { organization: org, first_game_date: first, last_game_date: last, teams: [...new Set(r.map((t) => t.affiliate_team))].sort() }
    }
    const spans = orgs.map(span).sort((a, b) => String(a.first_game_date).localeCompare(String(b.first_game_date)))
    const exit = exitsById.get(s.player_id)
    const exitDate = day(exit?.first_exit_date)
    const dodgers = spans.find((x) => x.organization === 'Los Angeles Dodgers')
    const after = spans.filter((x) => x.organization !== 'Los Angeles Dodgers')
    let state
    if (!dodgers) state = 'NOT_A_DODGERS_EXIT_SEASON'
    else if (!exitDate) state = 'EXIT_TRANSACTION_NOT_ESTABLISHED'
    else if (!dodgers.last_game_date || after.some((x) => !x.first_game_date)) state = 'DATES_NOT_AVAILABLE'
    else if (dodgers.last_game_date <= exitDate && after.every((x) => x.first_game_date >= exitDate)) state = 'CONSISTENT_WITH_RECORDED_EXIT'
    else state = 'INCONSISTENT_WITH_RECORDED_EXIT'
    organizationSeasons.push({ player_slug: s.player_slug, season, organizations: spans,
      recorded_exit: exit ? { control_state: exit.control_state, first_exit_date: exitDate, mechanism: exit.first_exit_mechanism ?? null } : null, state })
  }
}

const sum = (f) => records.reduce((a, r) => a + f(r), 0)
const totals = {
  cohort_players: cohort.length,
  source_stints: sum((r) => r.source.stints),
  on_record_stints: sum((r) => r.on_record.stints),
  stints_in_source_not_on_record: sum((r) => r.stints.in_source_not_on_record.length),
  stints_on_record_not_in_source: sum((r) => r.stints.on_record_not_in_source.length),
  stat_differences: sum((r) => r.stints.stat_differences.length),
  stint_dates_matched: sum((r) => r.game_dates.stints_matched),
  stint_dates_fillable: sum((r) => r.game_dates.stints_fillable.length),
  stint_date_conflicts: sum((r) => r.game_dates.stints_conflicting.length),
  undated_log_era_team_stints: sum((r) => r.game_dates.undated.length),
  game_log_dated_milestones_matched: sum((r) => r.milestones.game_log_dated_matched),
  milestones_new_from_game_log: sum((r) => r.milestones.new_from_game_log.length),
  milestone_season_to_day_upgrades: sum((r) => r.milestones.season_to_day_upgrades.length),
  milestone_conflicts: sum((r) => r.milestones.conflicting.length),
  source_milestone_candidates_not_on_record: sum((r) => r.milestones.source_candidates_not_on_record.length),
  pipeline_date_conflicts: sum((r) => r.date_conflicts_reported_by_pipeline),
  game_log_errors: sum((r) => r.source.game_log_errors),
  dated_appearances: sum((r) => r.source.dated_appearances),
  reviewed_facts_disi_lacks: sum((r) => r.reviewed_facts_disi_lacks),
  disagreements: sum((r) => r.disagreements),
}

// ---- outputs -----------------------------------------------------------------------------------------------------------------------------
const asOf = data.asOf
write('baseline.json', {
  description: 'The canonical pre-051 state of the audited no-MLB cohort, read from production as the public anon role in a read-only session.',
  read_from: 'production (generation ' + (data.executive?.generation_id ?? 'unknown') + ')',
  as_of: asOf,
  tracked_signings: data.signings.length,
  outcome_audit_status: Object.fromEntries(['VERIFIED_MLB', 'VERIFIED_NO_MLB', 'NOT_AUDITED'].map((k) => [k, data.signings.filter((s) => s.outcome_audit_status === k).length])),
  cohort_players: cohort.length,
  excluded,
  database: { stints: data.stints.length, milestones: (data.milestones ?? []).length, progression_decisions: (data.progressionDecisions ?? []).length,
    progression_decisions_pending: (data.progressionDecisions ?? []).filter((d) => d.review_status === 'PENDING_REVIEW').length },
  cohort_rows: { stints: sum((r) => r.on_record.stints), milestones: sum((r) => r.on_record.milestones), progression_decisions: decisions.length,
    sources_per_player: Object.fromEntries(cohort.map((s) => [s.player_slug, (data.sourceCounts ?? {})[s.player_id] ?? 0]).sort(([a], [b]) => (a < b ? -1 : 1))) },
  development_coverage_all_signings: developmentCoverage(data),
  audited_no_mlb_coverage: coverageSummary,
  development_needs: needsState,
})
write('cohort.json', {
  rule: 'Every Dodgers tracked signing whose canonical outcome audit is VERIFIED_NO_MLB at the existing analysis boundary (derived, never listed by hand).',
  as_of: asOf,
  players: coverageRows.map((r) => ({
    player_slug: r.player_slug,
    full_name: r.full_name,
    mlb_id: directory.get(r.player_id)?.mlb_id ?? null,
    signing_year: r.signing_year,
    signing_route: r.pathway,
    history_state: r.history.state,
    history_start: r.history.history_start,
    first_observed_season: r.history.first_observed_season,
    first_professional_season: r.first_pro_status,
    highest_level_recorded: r.highest_level_recorded ?? 'UNKNOWN',
    highest_level_at_dodgers_affiliate: r.segments.highest_level_at_dodgers_affiliate,
    highest_level_reached_elsewhere: r.segments.highest_level_reached_elsewhere,
    dodgers_affiliate_seasons: r.segments.dodgers_affiliate_seasons,
    other_organization_seasons: r.segments.other_organization_seasons,
    other_organizations: r.segments.other_organizations,
    foreign_pro_seasons: r.segments.foreign_pro_seasons,
    unplaceable_level_seasons: r.segments.unplaceable_level_seasons,
    last_observed_affiliated: r.segments.last_observed_affiliated,
    exit_control_state: r.exit_control_state,
    chronology: r.dims.CHRONOLOGY,
    exact_dates: r.exact_dates,
    gaps: r.history.gaps.map((g) => ({ code: g.code, seasons: g.seasons ?? [] })),
    notes: r.history.notes.map((g) => ({ code: g.code, seasons: g.seasons ?? [] })),
    open_detectors: r.issues,
    open_needs: r.needs,
    season_gap_explained_by_league: r.season_gap_explained_by_league,
    progression_review_pending: r.progression_review_pending,
    contradiction: r.contradiction,
    research_result: records.find((x) => x.player_slug === r.player_slug).reviewed_facts_disi_lacks > 0 ? 'NEW_EVIDENCE' : 'NO_NEW_RELIABLE_EVIDENCE',
  })),
})
write('development-records.json', { as_of: asOf, totals, organization_seasons: organizationSeasons, players: records })
write('coverage-before-after.json', {
  note: '051 wrote no canonical development row (no reviewed fact was found that DISI lacks), so the after state is the before state. Every figure has its denominator.',
  canonical_rows_written: 0,
  before: coverageSummary,
  after: coverageSummary,
})
write('needs-before-after.json', {
  note: 'Raw detector rows and the de-duplicated evidence gaps (048). One researched fact can close several detectors; a detector row is never counted as independent research. 051 wrote no row, so nothing closed.',
  before: needsState,
  after: needsState,
  league_not_played: LEAGUE_SEASON_NOT_PLAYED,
})
write('progression-review.json', {
  rule: 'The 048 rule: a lower ladder level first recorded after a higher one (rookie levels share a tier). A model may find the ambiguity; a person decides it.',
  inversions,
  pending_decisions: decisions.filter((d) => d.review_status === 'PENDING_REVIEW').map((d) => ({ player_slug: slugOf.get(d.player_id), event_code: d.event_code, confidence: d.confidence })).sort((a, b) => (a.player_slug + a.event_code < b.player_slug + b.event_code ? -1 : 1)),
  new_reviews_created: 0,
  reason: 'Every inversion in the cohort is already covered by a 024 decision (reviewed, or pending for a person); the development queue reports no open NON_MONOTONIC_PROGRESSION for any cohort player.',
})
const urls = new Set()
for (const r of seasons.records) for (const t of r.stints) for (const u of t.sources ?? []) urls.add(typeof u === 'string' ? u : u.url)
for (const r of exact.records) for (const d of r.stintDates ?? []) if (d.sourceUrl) urls.add(d.sourceUrl)
const kinds = {}
for (const u of urls) {
  const k = /stats=gameLog/.test(u) ? 'gameLog' : /stats=yearByYear/.test(u) ? 'yearByYear season splits' : /\/people\/\d+$/.test(u) ? 'person record' : 'other'
  kinds[k] = (kinds[k] ?? 0) + 1
}
write('source-manifest.json', {
  policy: 'Official MLB Stats API only (public, read-only, cached, one request every 750 ms). No source answering 403, requiring authentication or applying an anti-bot control was read or worked around. Search results are discovery only. No article is stored.',
  endpoints: {
    person: 'https://statsapi.mlb.com/api/v1/people/{id}',
    season_splits_mlb: 'https://statsapi.mlb.com/api/v1/people/{id}/stats?stats=yearByYear&group={hitting|pitching}&sportId=1',
    season_splits_milb: 'https://statsapi.mlb.com/api/v1/people/{id}/stats?stats=yearByYear&group={hitting|pitching}&leagueListId=milb_all',
    game_log_milb: 'https://statsapi.mlb.com/api/v1/people/{id}/stats?stats=gameLog&group={hitting|pitching}&season={yyyy}&leagueListId=milb_all',
  },
  generated: { seasons: seasons.meta?.generatedAt ?? null, game_logs: gameLogs.meta?.generatedAt ?? null },
  distinct_urls_cited_by_rows: urls.size,
  by_kind: Object.fromEntries(Object.entries(kinds).sort(([a], [b]) => (a < b ? -1 : 1))),
  not_used: ['Baseball-Reference (answers 403 to direct reads)', 'MLB.com and MiLB.com pages (403)', 'any search-result snippet'],
})
process.stderr.write(`051: ${cohort.length} players; source stints ${totals.source_stints}, on record ${totals.on_record_stints}; reviewed facts DISI lacks ${totals.reviewed_facts_disi_lacks}; disagreements ${totals.disagreements}\n`)
