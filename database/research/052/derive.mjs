#!/usr/bin/env node
// Derives the 052 research artifacts and the reviewed migration values from read-only inputs:
//   <pipeline-dir>   the official MLB Stats API pipeline output (cached, one request every 750 ms):
//                      team-seasons.json     scripts/mlb/team-seasons.mjs    every (team id, season) a stint is recorded for
//                      league-seasons.json   scripts/mlb/league-seasons.mjs  2019-2021 regular-season schedules by level; the Pioneer League by season
//                      player-seasons.json, development-milestones.json, player-game-logs.json, development-exact-dates.json
//                                            scripts/mlb/player-seasons.mjs, development-milestones.mjs, player-game-logs.mjs, development-exact-dates.mjs
//                                            for the players with an undated log-era stint
//   <before.json>    the canonical state before 052, saved read-only as the public anon role:
//                      npm run research:development -- --needs --history --save <before.json>
//   [after.json]     the same read after Migration 052 (adds needs-before-after.json, highest-level-before-after.json and the after half of
//                    gap-classification.json and sequence-review.json)
//
//   node database/research/052/derive.mjs <pipeline-dir> <before.json> [after.json]
//
// Deterministic: the same inputs give the same bytes (no clock is read). Nothing here writes to a database. A value enters
// migration-values.json only where the official record supports it and the canonical row does not have it yet; an existing value is
// never overwritten, except the three organization assignments the official season record contradicts (corrected, with the previous value kept).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleDataset } from '../../../lib/research/dataset.js'
import { developmentNeeds, developmentNeedSummary, NEED_GROUPS } from '../../../lib/research/development-needs.js'
import { firstProSeasonStatus, isProfessionalPathway } from '../../../lib/research/development-research.js'
import { careerSegments, auditedNoMlbCohort } from '../../../lib/research/history-coverage.js'
import {
  GAP_CLASS, GAME_LOG_FIRST_SEASON, MINOR_LEAGUE_SEASONS_NOT_PLAYED, gapClassCounts, multiOrganizationSeasons, needCauses, seasonGaps, undatedStints,
} from '../../../lib/research/development-chronology.js'
import { stableJson } from '../../../lib/research/format.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const [dirArg, beforeArg, afterArg] = process.argv.slice(2)
if (!dirArg || !beforeArg) throw new Error('usage: node database/research/052/derive.mjs <pipeline-dir> <before.json> [after.json]')
const dir = path.resolve(dirArg)
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const write = (name, value) => fs.writeFileSync(path.join(here, name), stableJson(value) + '\n')
const day = (v) => (v ? String(v).slice(0, 10) : null)
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const countBy = (rows, key) => {
  const out = {}
  for (const r of rows) { const k = key(r); out[k] = (out[k] ?? 0) + 1 }
  return Object.fromEntries(Object.entries(out).sort((a, b) => cmp(a[0], b[0])))
}
const groupMap = (rows, key) => {
  const m = new Map()
  for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r) }
  return m
}

const AS_OF = '2026-10-23'
const SEASON_ONLY_NOTE = 'Season of first appearance is known; the exact date is not recorded here.'
const COMMISSIONER_ORG_ID = 11

/**
 * MLB Stats API club id -> the DISI organization (franchise) row. Reviewed: the id is the franchise across its names (Montreal Expos and
 * Washington Nationals are 120; Florida and Miami Marlins 146; California, Anaheim and Los Angeles Angels 108; Tampa Bay Devil Rays and Rays
 * 139; Cleveland Indians and Guardians 114). DISI keeps Brooklyn and Los Angeles as separate organizations of one franchise (id 119), so that
 * one is season-bounded. The season's own parent name is kept in the stint's organization evidence.
 */
const FRANCHISE_ORGANIZATION = Object.freeze({
  108: 'Los Angeles Angels', 109: 'Arizona Diamondbacks', 110: 'Baltimore Orioles', 111: 'Boston Red Sox', 112: 'Chicago Cubs', 113: 'Cincinnati Reds',
  114: 'Cleveland Guardians', 115: 'Colorado Rockies', 116: 'Detroit Tigers', 117: 'Houston Astros', 118: 'Kansas City Royals', 120: 'Washington Nationals',
  121: 'New York Mets', 133: 'Athletics', 134: 'Pittsburgh Pirates', 135: 'San Diego Padres', 136: 'Seattle Mariners', 137: 'San Francisco Giants',
  138: 'St. Louis Cardinals', 139: 'Tampa Bay Rays', 140: 'Texas Rangers', 141: 'Toronto Blue Jays', 142: 'Minnesota Twins', 143: 'Philadelphia Phillies',
  144: 'Atlanta Braves', 145: 'Chicago White Sox', 146: 'Miami Marlins', 147: 'New York Yankees', 158: 'Milwaukee Brewers',
})
const organizationFor = (parentOrgId, season) => {
  if (parentOrgId === 119) return season <= 1957 ? 'Brooklyn Dodgers' : 'Los Angeles Dodgers'
  return FRANCHISE_ORGANIZATION[parentOrgId] ?? null
}

// ---- inputs --------------------------------------------------------------------------------------------------------------------------------
const before = assembleDataset(load(path.resolve(beforeArg)))
const after = afterArg ? assembleDataset(load(path.resolve(afterArg))) : null
for (const d of [before, after].filter(Boolean)) {
  if (!d.stints.length || !d.stintKeys.length) throw new Error('the dataset has no stint history; save it with --needs --history --save')
}
const teamSeasons = load(path.join(dir, 'team-seasons.json'))
const leagueSeasons = load(path.join(dir, 'league-seasons.json'))
const seasons = load(path.join(dir, 'player-seasons.json'))
const milestoneCandidates = load(path.join(dir, 'development-milestones.json'))
const gameLogs = load(path.join(dir, 'player-game-logs.json'))
const exact = load(path.join(dir, 'development-exact-dates.json'))

const signingBySlug = new Map(before.signings.map((s) => [s.player_slug, s]))
// surrogate ids differ between databases (production and a replay): every per-dataset lookup uses that dataset's own ids
const slugMap = (data) => {
  const m = new Map(data.signings.map((s) => [s.player_id, s.player_slug]))
  for (const s of data.stints) if (!m.has(s.player_id)) m.set(s.player_id, s.player_slug)
  return m
}
const slugById = slugMap(before)
const dodgersIds = new Set(before.signings.map((s) => s.player_id))

/** stints joined to their keys (team id, organization basis) */
function joined(data) {
  const keys = new Map(data.stintKeys.map((k) => [k.stint_id, k]))
  return data.stints.map((s) => {
    const k = keys.get(s.stint_id) ?? {}
    return { ...s, team_id: k.team_id == null ? null : Number(k.team_id), organization_id: k.organization_id ?? null, organization_basis: k.organization_basis ?? null, game_date_basis: k.game_date_basis ?? null }
  })
}
// HISTORY_QUERIES.stints does not select stint_id; the view row order is (slug, season, rank, team, league, stint_id), so rows are matched by
// their natural key instead (unique by the 021 index: player / season / team / league / level).
function withKeys(data) {
  const natural = (s) => [s.player_id, s.season, s.affiliate_team ?? '', s.league_name ?? '', s.level].join('|')
  if (data.stints.some((s) => s.stint_id)) return joined(data)
  throw new Error(`stints carry no stint_id: ${natural(data.stints[0])}`)
}
const beforeStints = withKeys(before)
const T = new Map(teamSeasons.records.map((r) => [`${r.teamId}|${r.season}`, r]))
const L = new Map(leagueSeasons.records.map((r) => [r.key + '|' + r.kind, r]))
const stintKey = (s) => ({ slug: s.player_slug, season: s.season, affiliate_team: s.affiliate_team ?? null, league_name: s.league_name ?? null, level: s.level })
const keyText = (k) => `${k.slug}|${k.season}|${k.affiliate_team ?? ''}|${k.league_name ?? ''}|${k.level}`

// ---- baseline --------------------------------------------------------------------------------------------------------------------------------
function measures(data, stints) {
  const team = stints.filter((s) => s.stint_kind === 'TEAM_STINT')
  const needs = developmentNeeds(data)
  const summary = developmentNeedSummary(data)
  return {
    development: {
      stints: stints.length,
      team_stints: team.length,
      season_totals: stints.filter((s) => s.stint_kind === 'SEASON_TOTAL').length,
      milestones: data.milestones.length,
      milestones_by_precision: countBy(data.milestones, (m) => m.date_precision ?? 'NONE'),
      progression_decisions: data.progressionDecisions.length,
      progression_decisions_by_role: countBy(data.progressionDecisions, (d) => d.progression_role),
      dodgers_players_with_development_history: new Set(team.filter((s) => data.signings.some((x) => x.player_id === s.player_id)).map((s) => s.player_id)).size,
      dodgers_players_without_structured_history: data.signings.filter((s) => !team.some((t) => t.player_id === s.player_id)).length,
      log_era_team_stints: team.filter((s) => s.season >= GAME_LOG_FIRST_SEASON).length,
      log_era_team_stints_dated: team.filter((s) => s.season >= GAME_LOG_FIRST_SEASON && s.first_game_date && s.last_game_date).length,
      team_stints_without_organization: team.filter((s) => !s.organization_id && s.level !== 'FOREIGN_PRO').length,
      unclassified_level_team_stints: team.filter((s) => ['UNKNOWN_ROOKIE_LEAGUE', 'UNRECOGNIZED_SPORT'].includes(s.level_classification)).length,
    },
    needs: {
      detector_rows: summary.detector_rows,
      detector_rows_by_issue: countBy(data.developmentQueue, (q) => q.issue),
      distinct_needs: summary.needs,
      affected_players: summary.players,
      by_need: Object.fromEntries(NEED_GROUPS.map((g) => [g.key, needs.filter((n) => n.need === g.key).length])),
      players_by_need: Object.fromEntries(NEED_GROUPS.map((g) => [g.key, new Set(needs.filter((n) => n.need === g.key).map((n) => n.player_id)).size])),
    },
  }
}
const status = before.status ?? {}
const systemState = (data) => {
  const s = data.signings
  return {
    dodgers_signings: s.length,
    audited: s.filter((x) => x.outcome_audit_status !== 'NOT_AUDITED').length,
    verified_mlb: s.filter((x) => x.outcome_audit_status === 'VERIFIED_MLB').length,
    verified_no_mlb: s.filter((x) => x.outcome_audit_status === 'VERIFIED_NO_MLB').length,
    not_audited: s.filter((x) => x.outcome_audit_status === 'NOT_AUDITED').length,
    snapshot_generation: data.status?.generation_id == null ? null : Number(data.status.generation_id),
    transaction_queue: data.transactionQueue.length,
    value_queue: data.valueQueue.length,
    research_tasks: data.tasks.length,
  }
}
write('baseline.json', {
  as_of: AS_OF,
  canonical_main: '9bf42da0f3da29c7520a91d522b6aea9535a10eb',
  read: 'production, read only as the anon role, after 050 (snapshot generation 8); 051 wrote no row',
  system: systemState(before),
  ...measures(before, beforeStints),
  database_status_snapshot: Object.fromEntries(Object.entries(status).filter(([k]) => /players|signings|stints|milestones|sources|generation|audit|outcome/.test(k)).sort((a, b) => cmp(a[0], b[0]))),
})

// ---- 1. level taxonomy: every stint the ladder cannot place --------------------------------------------------------------------------------
const UNCLEAR = new Set(['UNKNOWN_ROOKIE_LEAGUE', 'UNRECOGNIZED_SPORT'])
const unclear = beforeStints.filter((s) => UNCLEAR.has(s.level_classification))
const leagueSport = (season) => L.get(`128|${season}|LEAGUE`)?.leagueSportId ?? null
const unclearRows = unclear.filter((s) => s.stint_kind === 'TEAM_STINT').map((s) => {
  const t = T.get(`${s.team_id}|${s.season}`)
  return {
    player_slug: s.player_slug, season: s.season, team: s.affiliate_team, league: s.league_name, source_level: s.source_level ?? null, level: s.level,
    level_classification: s.level_classification, era: s.era ?? null, organization: s.organization_name ?? null,
    official_team_season: t ? { sport_id: t.sportId, sport: t.sportName, league: t.leagueName, parent_organization: t.parentOrgName } : null,
    official_league_sport_id: leagueSport(s.season),
    research_issue: 'UNKNOWN_LEVEL_CLASSIFICATION',
  }
}).sort((a, b) => a.season - b.season || cmp(a.team, b.team) || cmp(a.player_slug, b.player_slug))
const eraOf = (y) => (y < 1960 ? 'PRE_1960' : y <= 1988 ? 'PRE_ACADEMY_1960_1988' : y <= 2016 ? 'CLASSIC_AFFILIATED_1989_2016' : y <= 2020 ? 'DSL_AZL_2017_2020' : 'MODERN_FOUR_LEVEL_2021_PLUS')
const pioneerSeasons = leagueSeasons.records.filter((r) => r.kind === 'LEAGUE' && r.leagueId === 128).map((r) => ({ season: r.season, sport_id: r.leagueSportId, source: r.source.url }))
write('unclassified-levels.json', {
  as_of: AS_OF,
  team_stints: unclearRows.length,
  season_total_rows: unclear.filter((s) => s.stint_kind === 'SEASON_TOTAL').length,
  players: new Set(unclearRows.map((r) => r.player_slug)).size,
  by_league: countBy(unclearRows, (r) => r.league ?? 'unknown'),
  by_era: countBy(unclearRows, (r) => r.era ?? eraOf(r.season)),
  by_team: countBy(unclearRows, (r) => r.team ?? 'unknown'),
  by_source_level: countBy(unclearRows, (r) => r.source_level ?? 'unknown'),
  by_official_sport: countBy(unclearRows, (r) => `${r.official_team_season?.sport_id}:${r.official_team_season?.sport}`),
  official_pioneer_league_sport_by_season: pioneerSeasons,
  official_sports: { 16: 'Rookie (ROK)', 5442: 'Rookie Advanced (ROA)', 23: 'Independent Leagues (IND)' },
  finding: 'Every stint the ladder cannot place is a Pioneer League season (1988-2018). The official record files every one of those seasons under the Rookie sport (16), the same sport as the Dominican Summer and complex leagues; it files the league under Rookie Advanced (5442) only in 2019 and 2020 and under the Independent sport (23) from 2021. No stint on record falls in a Rookie Advanced season, and the Pioneer League is neither an international nor a complex league, so no canonical level fits without an assumption.',
  decision: 'TAXONOMY_LIMITED: no level is created and no stint is reclassified. The era map gains the season-aware Pioneer League rows (Rookie sport through 2020, Independent from 2021) so the classification is recorded per era, and the stints stay OTHER, unranked and counted.',
  rows: unclearRows,
})

// ---- 2. organizations: every team stint against the official season record ----------------------------------------------------------------
const orgRows = []
for (const s of beforeStints.filter((x) => x.stint_kind === 'TEAM_STINT' && x.level !== 'FOREIGN_PRO')) {
  const t = s.team_id == null ? null : T.get(`${s.team_id}|${s.season}`)
  const official = t && t.parentOrgId && t.parentOrgId !== COMMISSIONER_ORG_ID ? organizationFor(t.parentOrgId, s.season) : null
  let state
  if (!t) state = 'NO_OFFICIAL_RECORD'
  else if (!official) state = t.parentOrgId === COMMISSIONER_ORG_ID ? 'NO_MLB_PARENT' : 'UNMAPPED_PARENT'
  else if (!s.organization_id) state = 'RESOLVED_BY_052'
  else if (s.organization_name === official) state = 'MATCHES_OFFICIAL_RECORD'
  else state = 'CORRECTED_BY_052'
  orgRows.push({ ...stintKey(s), team_id: s.team_id, state, recorded: s.organization_name ?? null, recorded_basis: s.organization_basis, official,
    official_parent: t ? { id: t.parentOrgId, name: t.parentOrgName, team: t.teamName, sport: t.sportName, league: t.leagueName } : null,
    source: t ? { url: t.source.url, retrieved_at: t.source.retrievedAt } : null })
}
orgRows.sort((a, b) => cmp(keyText(a), keyText(b)))
if (orgRows.some((r) => r.state === 'UNMAPPED_PARENT' || r.state === 'NO_OFFICIAL_RECORD')) throw new Error('a team stint has no mappable official record')
const resolvedRows = orgRows.filter((r) => r.state === 'RESOLVED_BY_052')
const correctedRows = orgRows.filter((r) => r.state === 'CORRECTED_BY_052')
write('affiliate-organization-research.json', {
  as_of: AS_OF,
  endpoint: teamSeasons.meta.endpoint,
  team_season_requests: teamSeasons.meta.requests,
  team_season_errors: teamSeasons.meta.errors,
  team_stints_checked: orgRows.length,
  by_state: countBy(orgRows, (r) => r.state),
  resolved_by_parent: countBy(resolvedRows, (r) => r.official),
  resolved_by_era: countBy(resolvedRows, (r) => (r.season < 1960 ? 'before 1960' : r.season < 1989 ? '1960-1988' : r.season < 2006 ? '1989-2005' : '2006+')),
  resolved_by_level: countBy(resolvedRows, (r) => r.level),
  rule: 'The organization of a stint is the parent organization the official record names for the stint\'s own team id in the stint\'s own season (a major-league club is its own organization). It is never taken from the affiliate name alone, the signing organization, an adjacent stint, the current affiliate or the modern franchise.',
  franchise_map: FRANCHISE_ORGANIZATION,
  corrections: correctedRows,
  no_mlb_parent: orgRows.filter((r) => r.state === 'NO_MLB_PARENT'),
  resolved: resolvedRows,
})

// ---- 3. game dates --------------------------------------------------------------------------------------------------------------------------
const beforeByKey = new Map(beforeStints.map((s) => [keyText(stintKey(s)), s]))
const dateRows = []
for (const r of exact.records) {
  for (const d of r.stintDates) {
    const k = { slug: r.slug, season: d.season, affiliate_team: d.teamName ?? null, league_name: d.league ?? null, level: d.level }
    const s = beforeByKey.get(keyText(k))
    if (!s) throw new Error(`pipeline stint ${keyText(k)} is not on record`)
    if (s.stint_kind !== 'TEAM_STINT' || d.season < GAME_LOG_FIRST_SEASON) continue
    const has = Boolean(s.first_game_date && s.last_game_date)
    let state
    if (d.first && d.last) state = has ? (day(s.first_game_date) === d.first && day(s.last_game_date) === d.last ? 'MATCHES' : 'CONFLICT') : 'FILLED_BY_052'
    else state = has ? 'ON_RECORD_NOT_IN_LOG' : (d.level === 'FOREIGN_PRO' ? 'FOREIGN_PROFESSIONAL_NO_LOG' : 'GAME_LOG_RETURNS_NO_GAMES')
    dateRows.push({ ...k, state, first_game_date: d.first ?? null, last_game_date: d.last ?? null, games: d.games ?? null, source_url: d.sourceUrl ?? null, retrieved_at: d.retrievedAt ?? null })
  }
}
dateRows.sort((a, b) => cmp(keyText(a), keyText(b)))
if (dateRows.some((r) => r.state === 'CONFLICT')) throw new Error('a game-log date disagrees with a recorded date')
const upgrades = []
const upgradeRejected = []
const msByKey = new Map(before.milestones.map((m) => [`${m.player_slug}|${m.event_code}`, m]))
for (const r of exact.records) {
  for (const u of r.upgrades) {
    const m = msByKey.get(`${r.slug}|${u.eventCode}`)
    // the pipeline dates every level's first log appearance; a level first recorded after the MLB debut season is not a development milestone (048)
    if (!m) { upgradeRejected.push({ slug: r.slug, event_code: u.eventCode, season_year: Number(u.seasonYear), reason: 'not a recorded milestone: a level first appearance after the MLB debut season (048 rule)' }); continue }
    if (m.date_precision !== 'SEASON' || m.milestone_date) { upgradeRejected.push({ slug: r.slug, event_code: u.eventCode, reason: 'already exact' }); continue }
    if (Number(m.season_year) !== Number(u.seasonYear) || !String(u.milestoneDate).startsWith(String(u.seasonYear))) throw new Error(`upgrade outside its own season: ${r.slug} ${u.eventCode}`)
    upgrades.push({ slug: r.slug, event_code: u.eventCode, season_year: Number(u.seasonYear), milestone_date: u.milestoneDate, prior_evidence_basis: m.evidence_basis, note: u.note,
      source_url: u.sourceUrl, retrieved_at: u.retrievedAt })
  }
}
upgrades.sort((a, b) => cmp(a.slug, b.slug) || cmp(a.event_code, b.event_code))
// A first professional game is dated only for an amateur signing whose first recorded season is its signing season or the one after (the 048
// rule, unchanged): for a professional signing the first affiliated game is not the first professional game, and a late first record is a
// first OBSERVED season.
const professionalDebuts = []
const professionalDebutsRejected = []
const professionalDebutsMatched = []
for (const r of exact.records) {
  for (const m of r.newMilestones) {
    if (m.eventCode !== 'PROFESSIONAL_DEBUT') throw new Error(`unexpected new milestone ${m.eventCode}`)
    const s = signingBySlug.get(r.slug)
    const team = beforeStints.filter((x) => x.player_slug === r.slug && x.stint_kind === 'TEAM_STINT')
    const firstSeason = Math.min(...team.map((x) => x.season))
    const firstStint = team.filter((x) => x.season === firstSeason)
    const status = firstProSeasonStatus(s, { professional_debut_season: firstSeason })
    let reason = null
    if (isProfessionalPathway(s.pathway)) reason = `PRIOR_PROFESSIONAL_CAREER (${s.pathway}): the first affiliated game is not the first professional game`
    else if (status !== 'KNOWN') reason = `FIRST_OBSERVED_ONLY: first record ${firstSeason}, signed ${s.signing_year}`
    else if (Number(m.seasonYear) !== firstSeason) reason = `dated game in ${m.seasonYear}, first recorded season ${firstSeason}`
    const row = { slug: r.slug, event_code: 'PROFESSIONAL_DEBUT', event_date: m.eventDate, season_year: Number(m.seasonYear), level: m.level, pathway: s.pathway, signing_year: s.signing_year,
      first_recorded_season: firstSeason, organization_name: firstStint.find((x) => x.level === m.level)?.organization_name ?? null, note: m.note, source_url: m.sourceUrl, retrieved_at: m.retrievedAt }
    const onRecord = msByKey.get(`${r.slug}|PROFESSIONAL_DEBUT`)
    if (onRecord) {
      if (day(onRecord.milestone_date) !== m.eventDate) throw new Error(`a recorded PROFESSIONAL_DEBUT disagrees with the game log: ${r.slug}`)
      professionalDebutsMatched.push(r.slug)
    } else if (reason) professionalDebutsRejected.push({ ...row, reason })
    else professionalDebuts.push(row)
  }
}
professionalDebuts.sort((a, b) => cmp(a.slug, b.slug))
professionalDebutsRejected.sort((a, b) => cmp(a.slug, b.slug))
// conflicts reported by the pipeline: an MLB debut earlier than the fetched window is NOT a disagreement (the log was read from 2006 only)
const pipelineConflicts = exact.records.flatMap((r) => (r.conflicts ?? []).map((c) => ({ slug: r.slug, ...c })))
const windowArtifacts = pipelineConflicts.filter((c) => c.kind === 'EXACT_DATE_CONFLICT')
for (const c of windowArtifacts) {
  if (!(c.eventCode === 'MLB_DEBUT' && Number(String(c.valueA).slice(0, 4)) < GAME_LOG_FIRST_SEASON + 1 && String(c.valueB) > String(c.valueA))) throw new Error(`real date conflict: ${c.slug} ${c.eventCode}`)
}
const fetches = gameLogs.records.reduce((n, r) => n + (r.gameLogs?.length ?? 0), 0)
const appearances = gameLogs.records.reduce((n, r) => n + (r.gameLogs ?? []).reduce((m, g) => m + (g.appearances?.length ?? 0), 0), 0)
const emptyFetches = gameLogs.records.reduce((n, r) => n + (r.gameLogs ?? []).filter((g) => !(g.appearances?.length)).length, 0)
const fetchErrors = gameLogs.records.reduce((n, r) => n + (r.errors?.length ?? 0) + (r.gameLogs ?? []).filter((g) => g.error).length, 0)
write('game-date-research.json', {
  as_of: AS_OF,
  players: exact.records.length,
  rule: 'Exact dates come only from dated appearances in the official gameLog endpoint (2006 onward). A stint the log returns no games for keeps NULL dates: never a season start, a schedule date, a transaction date, July 1 or January 1. SEASON PRECISION != DAY PRECISION.',
  requests: fetches,
  successful_responses: fetches - fetchErrors,
  empty_responses: emptyFetches,
  errors: fetchErrors,
  dated_appearances: appearances,
  log_era_stints_checked: dateRows.length,
  stints_by_state: countBy(dateRows, (r) => r.state),
  milestone_season_to_day_upgrades: upgrades.length,
  milestone_upgrades_by_event: countBy(upgrades, (u) => u.event_code),
  milestone_upgrades_not_applied: upgradeRejected,
  professional_debuts_dated: professionalDebuts.length,
  professional_debuts_already_on_record_and_matching: professionalDebutsMatched.sort(),
  professional_debuts_not_dated: professionalDebutsRejected,
  pipeline_notes: countBy(pipelineConflicts, (c) => c.kind),
  pipeline_window_artifacts: { count: windowArtifacts.length, explanation: 'The game log was read from 2006; for a player who debuted earlier the first appearance in that window is not the debut. The recorded MLB debut (person record) stands; these are not source conflicts and none is recorded as one.', items: windowArtifacts.map((c) => `${c.slug}: debut ${c.valueA}, first appearance in the 2006+ window ${c.valueB}`) },
  still_undated: dateRows.filter((r) => ['FOREIGN_PROFESSIONAL_NO_LOG', 'GAME_LOG_RETURNS_NO_GAMES'].includes(r.state)),
})

// ---- 4. multi-organization seasons ---------------------------------------------------------------------------------------------------------
const txOf = groupMap(before.transactions, (t) => t.player_id)
const resolvedOrgByKey = new Map(orgRows.filter((r) => r.official).map((r) => [keyText(r), r.official]))
const datesByKey = new Map(dateRows.filter((r) => r.state === 'FILLED_BY_052').map((r) => [keyText(r), r]))
// the organization abbreviation travels with the organization (the transaction view names organizations by abbreviation)
const abbreviationOf = new Map(before.organizations.map((o) => [o.name, o.abbreviation]))
for (const name of new Set(resolvedOrgByKey.values())) if (!abbreviationOf.has(name)) throw new Error(`no abbreviation on record for ${name}`)
const afterLike = beforeStints.map((s) => {
  const k = keyText(stintKey(s))
  const d = datesByKey.get(k)
  const resolved = s.stint_kind === 'TEAM_STINT' && s.level !== 'FOREIGN_PRO' ? resolvedOrgByKey.get(k) : undefined
  return { ...s, organization_name: resolved ?? s.organization_name, organization_abbreviation: resolved ? abbreviationOf.get(resolved) : s.organization_abbreviation,
    first_game_date: s.first_game_date ?? d?.first_game_date ?? null, last_game_date: s.last_game_date ?? d?.last_game_date ?? null }
})
const stintsBy = (rows) => groupMap(rows, (s) => s.player_id)
const multiFor = (rows) => {
  const out = []
  for (const [pid, st] of stintsBy(rows)) {
    if (!dodgersIds.has(pid)) continue
    for (const m of multiOrganizationSeasons(st, txOf.get(pid) ?? [])) out.push({ player_slug: slugById.get(pid), ...m })
  }
  return out.sort((a, b) => cmp(a.player_slug, b.player_slug) || a.season - b.season)
}
const multiBefore = multiFor(beforeStints)
const multiAfter = multiFor(afterLike)
write('multi-organization-seasons.json', {
  as_of: AS_OF,
  rule: 'A two-organization season is BRACKETED when one canonical transaction of this player moves him between the two organizations inside that season and his last game-dated appearance for the first is on or before the transaction date while his first for the second is on or after it. The transaction date, the last game before it and the first game after it are three facts and stay three. A team change never creates a transaction; a season with no canonical transaction stays open.',
  before: { seasons: multiBefore.length, players: new Set(multiBefore.map((m) => m.player_slug)).size, by_state: countBy(multiBefore, (m) => m.state) },
  after_052_values: { seasons: multiAfter.length, players: new Set(multiAfter.map((m) => m.player_slug)).size, by_state: countBy(multiAfter, (m) => m.state),
    players_all_seasons_bracketed: [...new Set(multiAfter.map((m) => m.player_slug))].filter((p) => multiAfter.filter((m) => m.player_slug === p).every((m) => m.state === 'BRACKETED')).sort() },
  seasons_before: multiBefore,
  seasons: multiAfter,
})

// ---- 5. 2020 and the season-gap detector ----------------------------------------------------------------------------------------------------
const schedules = leagueSeasons.records.filter((r) => r.kind === 'SCHEDULE').map((r) => ({ sport_id: r.sportId, season: r.season, regular_season_games: r.regularSeasonGames, source: r.source.url }))
const gapPlayers = new Set(before.developmentQueue.filter((q) => q.issue === 'SEASON_GAP').map((q) => q.player_id))
const gapRows = [...stintsBy(beforeStints)].filter(([pid]) => gapPlayers.has(pid)).map(([pid, st]) => {
  const g = seasonGaps(st)
  return { player_slug: slugById.get(pid), missing: g.missing, open_after_052: g.open, explained_by_league: g.explained, flagged_after_052: g.open.length > 0 }
}).sort((a, b) => cmp(a.player_slug, b.player_slug))
const involving2020 = gapRows.filter((r) => r.missing.some((m) => m.season === 2020))
const evidence2020 = schedules.filter((r) => r.season === 2020)
for (const r of evidence2020.filter((x) => [11, 12, 13, 14, 15, 16].includes(x.sport_id))) if (r.regular_season_games !== 0) throw new Error(`sport ${r.sport_id} has 2020 games`)
const notPlayedStints = beforeStints.filter((s) => s.stint_kind === 'TEAM_STINT' && MINOR_LEAGUE_SEASONS_NOT_PLAYED.includes(s.season) && s.affiliated && s.level !== 'MLB')
if (notPlayedStints.length) throw new Error('an affiliated minor-league stint is recorded for a season that was not played')

// ---- 6. sequence reviews ---------------------------------------------------------------------------------------------------------------------
const packet = (data, stints) => {
  const slugById = slugMap(data)
  const txOf = groupMap(data.transactions, (t) => t.player_id)
  const st = stintsBy(stints)
  const ms = groupMap(data.milestones, (m) => m.player_id)
  const pending = data.progressionDecisions.filter((d) => d.progression_role === 'REVIEW_REQUIRED')
  const cameo = new Set(data.developmentQueue.filter((q) => q.issue === 'LEVEL_SKIP_CAMEO_CANDIDATE').map((q) => q.player_id))
  const inverted = new Set(data.developmentQueue.filter((q) => q.issue === 'NON_MONOTONIC_PROGRESSION').map((q) => q.player_id))
  const ids = [...new Set([...pending.map((d) => d.player_id), ...cameo, ...inverted])]
  return ids.map((pid) => {
    const team = (st.get(pid) ?? []).filter((s) => s.stint_kind === 'TEAM_STINT').sort((a, b) => a.season - b.season || (a.level_rank ?? 99) - (b.level_rank ?? 99))
    const debut = (ms.get(pid) ?? []).find((m) => m.event_code === 'MLB_DEBUT')
    return {
      player_slug: slugById.get(pid),
      mlb_debut: day(debut?.milestone_date) ?? null,
      pending_events: pending.filter((d) => d.player_id === pid).map((d) => d.event_code).sort(),
      level_skip_cameo_candidate: cameo.has(pid),
      non_monotonic_without_decision: inverted.has(pid),
      stints: team.filter((s) => s.level !== 'FOREIGN_PRO').map((s) => ({ season: s.season, level: s.level, team: s.affiliate_team, organization: s.organization_name ?? null, games: s.g ?? s.pg ?? null,
        first: day(s.first_game_date), last: day(s.last_game_date) })),
      level_debuts: (ms.get(pid) ?? []).filter((m) => /_DEBUT$/.test(m.event_code) && m.event_code !== 'PROFESSIONAL_DEBUT').map((m) => ({ event: m.event_code, date: day(m.milestone_date), season: m.season_year, precision: m.date_precision }))
        .sort((a, b) => cmp(a.event, b.event)),
      transactions: (txOf.get(pid) ?? []).map((t) => `${day(t.transaction_date)} ${t.transaction_type} ${t.from_organization ?? ''} -> ${t.to_organization ?? ''}`),
      decision: 'A PERSON DECIDES. DISI records no interpretation: an early cameo, a post-establishment appearance and a regression are alternatives, never inferred.',
    }
  }).sort((a, b) => cmp(a.player_slug, b.player_slug))
}

// ---- 6b. sequences the exact dates expose (the 048 inversion rule over the upgraded dates) ---------------------------------------------------
// At season precision two first appearances in one season cannot run backward; a day-precision date can. Each newly visible inversion is
// recorded as a PENDING_REVIEW decision on the non-MLB levels involved, exactly as 048 recorded the season-precision ones. 052 decides none.
const upgradeBy = new Map(upgrades.map((u) => [`${u.slug}|${u.event_code}`, u]))
const decided = new Set(before.progressionDecisions.map((d) => `${d.player_id}|${d.event_code}`))
const LABEL = { DSL_DEBUT: 'DSL', COMPLEX_DEBUT: 'Complex', A_DEBUT: 'Low-A', HIGH_A_DEBUT: 'High-A', AA_DEBUT: 'Double-A', AAA_DEBUT: 'Triple-A', MLB_DEBUT: 'MLB' }
const progressionReviews = []
for (const [pid, rows] of groupMap(before.progression, (r) => r.player_id)) {
  const slug = slugById.get(pid)
  const reached = rows.filter((r) => r.development_state === 'REACHED' && !decided.has(`${pid}|${r.event_code}`)).map((r) => ({
    event: r.event_code, tier: Number(r.progression_tier), season: r.first_appearance_season == null ? null : Number(r.first_appearance_season),
    date: upgradeBy.get(`${slug}|${r.event_code}`)?.milestone_date ?? day(r.first_appearance_date) }))
  const pairs = []
  for (const lo of reached) for (const hi of reached) {
    if (!(hi.tier > lo.tier)) continue
    const backward = lo.date && hi.date ? lo.date > hi.date : (lo.season != null && hi.season != null && lo.season > hi.season)
    if (backward) pairs.push({ lo, hi })
  }
  if (!pairs.length) continue
  // only sequences the 052 dates made visible: at season precision none of these pairs ran backward
  if (pairs.some((x) => x.lo.season > x.hi.season)) throw new Error(`${slug}: a season-precision inversion has no decision`)
  const events = [...new Set(pairs.flatMap((x) => [x.lo.event, x.hi.event]))].filter((e) => e !== 'MLB_DEBUT').sort()
  const facts = pairs.map((x) => `first ${LABEL[x.hi.event]} appearance ${x.hi.date}, first ${LABEL[x.lo.event]} appearance ${x.lo.date}`).join('; ')
  const withMlb = pairs.some((x) => x.hi.event === 'MLB_DEBUT')
  const notes = `Unresolved sequence made visible by exact game-log dates (official gameLog, read 2026-10-23): ${facts}. Inside one season the lower level's first appearance comes after the higher one's. `
    + (withMlb
      ? 'Whether the later minor-league games were a rehabilitation assignment, an option or development is not decided; the level is not accepted as a developmental arrival until a reviewer decides.'
      : 'Whether the higher-level games were an early cameo or the lower-level games a reassignment is not decided; none of these levels is accepted as a developmental arrival until a reviewer decides.')
  for (const e of events) progressionReviews.push({ slug, event_code: e, decision_basis: 'GAME_LOG_REVIEW', confidence: 'LOW', notes, as_of_date: AS_OF })
}
progressionReviews.sort((a, b) => cmp(a.slug, b.slug) || cmp(a.event_code, b.event_code))

// ---- 7. migration values -----------------------------------------------------------------------------------------------------------------
const organizationValues = [...resolvedRows, ...correctedRows].map((r) => ({
  slug: r.slug, season: r.season, affiliate_team: r.affiliate_team, league_name: r.league_name, level: r.level, team_id: r.team_id,
  organization_name: r.official, previous_organization_name: r.recorded, previous_basis: r.recorded_basis, correction: r.state === 'CORRECTED_BY_052',
  evidence: { teamId: r.team_id, season: r.season, parentOrgId: r.official_parent.id, parentOrgName: r.official_parent.name, teamName: r.official_parent.team,
    sport: r.official_parent.sport, url: r.source.url, retrievedAt: r.source.retrieved_at },
})).sort((a, b) => cmp(keyText(a), keyText(b)))
const dateValues = dateRows.filter((r) => r.state === 'FILLED_BY_052').map((r) => ({ slug: r.slug, season: r.season, affiliate_team: r.affiliate_team, league_name: r.league_name, level: r.level,
  first_game_date: r.first_game_date, last_game_date: r.last_game_date, source_url: r.source_url, retrieved_at: r.retrieved_at }))
const eraMapValues = [
  { era: 'PRE_ACADEMY_1960_1988', source_label: 'Pioneer League', maps_to: 'OTHER',
    note: '052: the official record files the Pioneer League under the Rookie sport (16) in this era. Affiliated rookie-class play, neither an international nor a complex league; no ladder level until a reviewed taxonomy decision.' },
  { era: 'DSL_AZL_2017_2020', source_label: 'Pioneer League', maps_to: 'OTHER',
    note: '052: the official record files the Pioneer League under the Rookie sport (16) in 2017-2018 and under Rookie Advanced (5442) in 2019-2020 (no 2020 season was played). Affiliated rookie-class play; no ladder level until a reviewed taxonomy decision. ROOKIE-ADVANCED != COMPLEX ROOKIE BY ASSUMPTION.' },
  { era: 'MODERN_FOUR_LEVEL_2021_PLUS', source_label: 'Pioneer League', maps_to: 'INDEPENDENT',
    note: '052: from 2021 the official record files the Pioneer League under the Independent sport (23): an MLB Partner League without affiliations, never affiliated development.' },
]
const sources = new Map()
for (const r of organizationValues) sources.set(r.evidence.url, { url: r.evidence.url, retrieved_at: r.evidence.retrievedAt, kind: 'TEAM_SEASON' })
for (const r of dateValues) if (r.source_url) sources.set(r.source_url, { url: r.source_url, retrieved_at: r.retrieved_at, kind: 'GAME_LOG' })
for (const r of upgrades) if (r.source_url) sources.set(r.source_url, { url: r.source_url, retrieved_at: r.retrieved_at, kind: 'GAME_LOG' })
for (const r of professionalDebuts) if (r.source_url) sources.set(r.source_url, { url: r.source_url, retrieved_at: r.retrieved_at, kind: 'GAME_LOG' })
const values = {
  as_of_date: AS_OF,
  season_only_note: SEASON_ONLY_NOTE,
  expected_before: {
    stints: beforeStints.length, team_stints: beforeStints.filter((s) => s.stint_kind === 'TEAM_STINT').length, milestones: before.milestones.length,
    progression_decisions: before.progressionDecisions.length,
    progression_decisions_pending: before.progressionDecisions.filter((d) => d.progression_role === 'REVIEW_REQUIRED').length,
    team_stints_without_organization: beforeStints.filter((s) => s.stint_kind === 'TEAM_STINT' && !s.organization_id && s.level !== 'FOREIGN_PRO').length,
  },
  organizations: organizationValues,
  stint_dates: dateValues,
  milestone_upgrades: upgrades.map(({ retrieved_at, ...u }) => u),
  professional_debuts: professionalDebuts.map((p) => ({ slug: p.slug, event_date: p.event_date, season_year: p.season_year, organization_name: p.organization_name, note: p.note, source_url: p.source_url })),
  progression_reviews: progressionReviews,
  era_map: eraMapValues,
  sources: [...sources.values()].sort((a, b) => cmp(a.url, b.url)),
}
write('migration-values.json', values)

// ---- 8. gap classification -------------------------------------------------------------------------------------------------------------------
const filledKeys = new Set(dateValues.map((r) => keyText(r)))
const resolvedPlayers = new Set(organizationValues.map((r) => r.slug))
const upgradedPlayers = new Set(upgrades.map((u) => u.slug))
const multiAfterBySlug = groupMap(multiAfter, (m) => m.player_slug)
function classifyBefore(data, stints) {
  const needs = developmentNeeds(data)
  const st = stintsBy(stints)
  const ms = groupMap(data.milestones, (m) => m.player_id)
  const after = needCauses(needs, (pid) => st.get(pid) ?? [], (pid) => txOf.get(pid) ?? [], (pid) => ms.get(pid) ?? [])
  return after.map((n) => {
    const slug = n.player_slug
    const team = (st.get(n.player_id) ?? []).filter((s) => s.stint_kind === 'TEAM_STINT')
    let gapClass = n.gap_class
    let cause = n.cause
    if (n.need === 'ORGANIZATION' && n.issues.includes('UNRESOLVED_ORGANIZATION') && resolvedPlayers.has(slug)
      && !team.some((s) => !s.organization_name && s.level !== 'FOREIGN_PRO' && !organizationValues.some((v) => keyText(v) === keyText(stintKey(s))))) {
      gapClass = 'FACT_MISSING'; cause = 'The official team-season record names the parent organization of every unresolved stint.'
    } else if (n.need === 'ORGANIZATION' && !n.issues.includes('UNRESOLVED_ORGANIZATION')) {
      const ms2 = multiAfterBySlug.get(slug) ?? []
      if (ms2.length && ms2.every((m) => m.state === 'BRACKETED')) { gapClass = 'NOT_A_GAP'; cause = 'Every multi-organization season is bracketed by a canonical transaction and game dates.' }
    } else if (n.need === 'GAME_DATES') {
      const open = team.filter((s) => s.season >= GAME_LOG_FIRST_SEASON && (!s.first_game_date || !s.last_game_date))
      if (open.length && open.some((s) => filledKeys.has(keyText(stintKey(s)))) || upgradedPlayers.has(slug)) { gapClass = 'FACT_MISSING'; cause = 'The official game log dates stints or level debuts this player lacks.' }
    } else if (n.need === 'SEASON_COVERAGE' && n.issues.includes('SEASON_GAP') && !seasonGaps(team).open.length) {
      gapClass = 'NOT_A_GAP'
    }
    return { player_slug: slug, need: n.need, issues: n.issues, gap_class: gapClass, cause }
  }).sort((a, b) => cmp(a.player_slug ?? '', b.player_slug ?? '') || cmp(a.need, b.need))
}
const classBefore = classifyBefore(before, beforeStints)

// ---- 9. after (Migration 052 applied) ---------------------------------------------------------------------------------------------------------
let afterBlock = null
if (after) {
  const afterStints = withKeys(after)
  const needsAfter = developmentNeeds(after)
  const st = stintsBy(afterStints)
  const ms = groupMap(after.milestones, (m) => m.player_id)
  const txAfter = groupMap(after.transactions, (t) => t.player_id)
  const classAfter = needCauses(needsAfter, (pid) => st.get(pid) ?? [], (pid) => txAfter.get(pid) ?? [], (pid) => ms.get(pid) ?? [])
    .map((n) => ({ player_slug: n.player_slug, need: n.need, issues: n.issues, gap_class: n.gap_class, cause: n.cause, closes_with: n.closes_with }))
    .sort((a, b) => cmp(a.player_slug ?? '', b.player_slug ?? '') || cmp(a.need, b.need))
  const slugBefore = slugById
  const m0 = measures(before, beforeStints)
  const m1 = measures(after, afterStints)
  const beforeNeeds = developmentNeeds(before)
  const keyN = (n) => `${n.player_slug}|${n.need}`
  const afterKeys = new Set(needsAfter.map(keyN))
  const beforeKeys = new Set(beforeNeeds.map(keyN))
  const resolvedNeeds = beforeNeeds.filter((n) => !afterKeys.has(keyN(n))).map((n) => {
    const c = classBefore.find((x) => x.player_slug === n.player_slug && x.need === n.need)
    return { player_slug: n.player_slug, need: n.need, issues: n.issues, class_before: c?.gap_class ?? null, reason: c?.cause ?? null }
  })
  const newNeeds = needsAfter.filter((n) => !beforeKeys.has(keyN(n))).map((n) => ({ player_slug: n.player_slug, need: n.need, issues: n.issues,
    reason: classAfter.find((x) => x.player_slug === n.player_slug && x.need === n.need)?.cause ?? null }))
  const slugAfter = slugMap(after)
  const rowsBefore = new Set(before.developmentQueue.map((q) => `${slugBefore.get(q.player_id)}|${q.issue}`))
  const rowsAfter = new Set(after.developmentQueue.map((q) => `${slugAfter.get(q.player_id)}|${q.issue}`))
  const byCategory = Object.fromEntries(NEED_GROUPS.map((g) => [g.key, {
    before: m0.needs.by_need[g.key], after: m1.needs.by_need[g.key],
    resolved: resolvedNeeds.filter((n) => n.need === g.key).length, added: newNeeds.filter((n) => n.need === g.key).length,
    remaining_by_class: countBy(classAfter.filter((n) => n.need === g.key), (n) => n.gap_class),
  }]))
  write('needs-before-after.json', {
    as_of: AS_OF,
    before: m0.needs,
    after: m1.needs,
    by_category: byCategory,
    detector_rows_removed: [...rowsBefore].filter((k) => !rowsAfter.has(k)).sort(),
    detector_rows_added: [...rowsAfter].filter((k) => !rowsBefore.has(k)).sort(),
    resolved_needs: resolvedNeeds,
    new_needs: newNeeds,
    development_before: m0.development,
    development_after: m1.development,
  })
  // highest level, both questions, before and after
  const highest = (data, stints) => {
    const ids = new Set(data.signings.map((s) => s.player_id))
    const slugs = slugMap(data)
    const out = new Map()
    for (const [pid, rows] of stintsBy(stints)) {
      if (!ids.has(pid)) continue
      const seg = careerSegments(rows)
      out.set(slugs.get(pid), { whole_career: seg.highest_level_whole_career, at_dodgers_affiliate: seg.highest_level_at_dodgers_affiliate, elsewhere: seg.highest_level_reached_elsewhere,
        unknown_organization_seasons: seg.unknown_organization_seasons })
    }
    return out
  }
  const h0 = highest(before, beforeStints)
  const h1 = highest(after, afterStints)
  const lv = (v, key) => (v?.[key] ? `${v[key].level} (${v[key].season})` : null)
  const changes = [...h1.keys()].filter((k) => lv(h0.get(k), 'whole_career') !== lv(h1.get(k), 'whole_career') || lv(h0.get(k), 'at_dodgers_affiliate') !== lv(h1.get(k), 'at_dodgers_affiliate')
    || h0.get(k)?.elsewhere !== h1.get(k)?.elsewhere).sort().map((k) => ({ player_slug: k,
    whole_career: { before: lv(h0.get(k), 'whole_career'), after: lv(h1.get(k), 'whole_career') },
    at_dodgers_affiliate: { before: lv(h0.get(k), 'at_dodgers_affiliate'), after: lv(h1.get(k), 'at_dodgers_affiliate') },
    reached_elsewhere: { before: h0.get(k)?.elsewhere ?? null, after: h1.get(k)?.elsewhere ?? null },
    why: 'Organizations resolved from the official team-season record now place a stint of this player with (or away from) a Dodgers affiliate.' }))
  const orgOnly = [...h1.keys()].filter((k) => !changes.some((c) => c.player_slug === k) && JSON.stringify(h0.get(k)?.unknown_organization_seasons) !== JSON.stringify(h1.get(k)?.unknown_organization_seasons)).sort()
  const cohortIds = new Set(auditedNoMlbCohort(after.signings).map((s) => s.player_slug))
  /** @param {Map<string, any>} h @param {string} key @param {(k: string) => boolean} [filter] */
  const dist = (h, key, filter = (_k) => true) => countBy([...h].filter(([k]) => filter(k)), ([, v]) => v[key]?.level ?? 'UNKNOWN')
  write('highest-level-before-after.json', {
    as_of: AS_OF,
    rule: 'Highest level is two questions, both read from the same stints: the whole recorded career (any organization) and the part recorded at a Dodgers affiliate. Later play with another organization is career context, never Dodgers development. Organization resolution changes only the second.',
    all_dodgers_signings: {
      whole_career_before: dist(h0, 'whole_career'), whole_career_after: dist(h1, 'whole_career'),
      at_dodgers_affiliate_before: dist(h0, 'at_dodgers_affiliate'), at_dodgers_affiliate_after: dist(h1, 'at_dodgers_affiliate'),
    },
    audited_no_mlb_cohort: {
      whole_career_before: dist(h0, 'whole_career', (k) => cohortIds.has(k)), whole_career_after: dist(h1, 'whole_career', (k) => cohortIds.has(k)),
      at_dodgers_affiliate_before: dist(h0, 'at_dodgers_affiliate', (k) => cohortIds.has(k)), at_dodgers_affiliate_after: dist(h1, 'at_dodgers_affiliate', (k) => cohortIds.has(k)),
    },
    changed_players: changes,
    players_whose_only_change_is_resolved_organization_seasons: orgOnly.length,
    unknown_organization_team_stints_before: beforeStints.filter((s) => s.stint_kind === 'TEAM_STINT' && !s.organization_id && s.level !== 'FOREIGN_PRO').length,
    unknown_organization_team_stints_after: afterStints.filter((s) => s.stint_kind === 'TEAM_STINT' && !s.organization_id && s.level !== 'FOREIGN_PRO').length,
  })
  afterBlock = { classAfter, packetAfter: packet(after, afterStints) }
}

const finalClasses = afterBlock ? afterBlock.classAfter : null
write('gap-classification.json', {
  as_of: AS_OF,
  classes: GAP_CLASS,
  before: { counts: gapClassCounts(classBefore), by_need: Object.fromEntries(NEED_GROUPS.map((g) => [g.key, gapClassCounts(classBefore.filter((n) => n.need === g.key))])), needs: classBefore },
  after: finalClasses ? { counts: gapClassCounts(finalClasses), by_need: Object.fromEntries(NEED_GROUPS.map((g) => [g.key, gapClassCounts(finalClasses.filter((n) => n.need === g.key))])), needs: finalClasses } : null,
})
write('sequence-review.json', {
  as_of: AS_OF,
  rule: 'Every pending progression decision and every heuristic candidate, with the facts a reviewer needs. 052 decides none: PENDING REVIEW != NEGATIVE DEVELOPMENT EVENT; POST-ESTABLISHMENT LOWER-LEVEL APPEARANCE != DEVELOPMENTAL REGRESSION.',
  pending_decisions_before: before.progressionDecisions.filter((d) => d.progression_role === 'REVIEW_REQUIRED').length,
  new_pending_reviews_from_exact_dates: progressionReviews,
  resolved_by_objective_evidence: 0,
  automatic_interpretive_decisions: 0,
  players: afterBlock ? afterBlock.packetAfter : packet(before, beforeStints),
})
write('season-gaps-2020.json', {
  as_of: AS_OF,
  rule: 'A season with no record between a player\'s first and last recorded seasons is a research need unless the league did not play it: 2020 is explained for an affiliated minor leaguer whose last recorded season before it is affiliated minor-league play only and who has no major-league stint by then. Leagues that played in 2020 (the major leagues, NPB, KBO) are never suppressed.',
  official_schedules: schedules,
  affiliated_minor_league_stints_recorded_for_2020: notPlayedStints.length,
  season_gap_players_before: gapRows.length,
  involving_2020: involving2020.length,
  only_2020_and_explained: gapRows.filter((r) => !r.flagged_after_052).length,
  still_open: gapRows.filter((r) => r.flagged_after_052).length,
  rows: gapRows,
})
write('source-manifest.json', {
  as_of: AS_OF,
  official_endpoints: [
    { endpoint: teamSeasons.meta.endpoint, requests: teamSeasons.meta.requests, errors: teamSeasons.meta.errors, used_for: 'the parent organization, sport and league of every team stint, per season' },
    { endpoint: 'https://statsapi.mlb.com/api/v1/schedule?sportId={sport}&season={season}&gameType=R', requests: schedules.length, errors: leagueSeasons.records.filter((r) => r.kind === 'SCHEDULE' && r.error).length, used_for: 'whether a level played a regular season (2019-2021)' },
    { endpoint: 'https://statsapi.mlb.com/api/v1/league/128?season={season}', requests: pioneerSeasons.length, errors: leagueSeasons.records.filter((r) => r.kind === 'LEAGUE' && r.error).length, used_for: 'the Pioneer League sport per season' },
    { endpoint: 'https://statsapi.mlb.com/api/v1/people/{id}/stats?stats=yearByYear (season splits)', requests: seasons.records.length * 4, errors: 0, used_for: 'the fact-for-fact stint comparison (904 / 904 matched) for the players with undated stints' },
    { endpoint: 'https://statsapi.mlb.com/api/v1/people/{id}/stats?stats=gameLog', requests: fetches, errors: fetchErrors, used_for: 'exact first / last appearance dates and level debuts' },
  ],
  season_split_comparison: { players: seasons.records.length, source_stints: seasons.records.reduce((n, r) => n + r.stints.length, 0) },
  milestone_candidates_not_on_record: milestoneCandidates.records.flatMap((r) => r.milestones.filter((m) => !msByKey.has(`${r.slug}|${m.milestone}`)).map((m) => ({ slug: r.slug, event: m.milestone, season: m.season ?? null,
    reason: 'A level first appearance after the MLB debut season: a rehabilitation or reassignment appearance, never a development milestone (the 048 rule).' }))),
  not_used: [
    'MiLB.com and MLB.com league histories (403: not read, not worked around)',
    'Baseball-Reference (403)',
    'Search results and snippets (discovery only, never evidence)',
    'Wikipedia (read for discovery; the classification rests on the official sport per season)',
  ],
  cited_urls: values.sources.length,
})
console.log(stableJson({ reviews: progressionReviews.map((r) => `${r.slug}:${r.event_code}`), organizations: organizationValues.length, corrections: correctedRows.length, stint_dates: dateValues.length, upgrades: upgrades.length,
  professional_debuts: professionalDebuts.length, sources: values.sources.length, gap_before: gapClassCounts(classBefore), gap_after: finalClasses ? gapClassCounts(finalClasses) : null }))
