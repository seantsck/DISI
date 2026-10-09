#!/usr/bin/env node
// Converts REVIEWED development research artifacts into deterministic SQL
// VALUES blocks for migration 021, plus a decisions report. Never connects to
// a database: a person reviews the output and it is built into the migration.
//
//   node scripts/mlb/development-sql-values.mjs \
//     --seasons research-output/021/player-seasons.json \
//     --milestones research-output/021/development-milestones.json \
//     --game-levels research-output/021/player-game-levels.json \
//     --decisions database/research/021/development-decisions.json \
//     --as-of 2026-10-06 --out database/research/021/values.sql

import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, requireArg } from './lib/args.mjs'
import { parseIsoDate } from './lib/normalize.mjs'
import { sqlRow, Json } from './lib/development.mjs'
import { stableStringify, sortRecords } from './lib/output.mjs'

const args = parseArgs(process.argv.slice(2))
const asOf = parseIsoDate(requireArg(args, 'as-of', 'YYYY-MM-DD'))
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
const seasonArt = load(requireArg(args, 'seasons'))
const milestoneArt = args.milestones ? load(args.milestones) : { records: [] }
const gameLevelArt = args['game-levels'] ? load(args['game-levels']) : { records: [] }
const decisions = args.decisions ? load(args.decisions) : {}

const stints = sortRecords(seasonArt.records.filter((r) => r.slug && r.mlbId && r.stints?.length)
  .flatMap((r) => r.stints.map((s) => ({ ...s, slug: r.slug, mlbId: r.mlbId, playerMlbDebutDate: r.mlbDebutDate ?? null }))), ['slug', 'season', 'levelRank'])
const milestones = sortRecords(milestoneArt.records.filter((r) => r.slug && r.mlbId && r.milestones?.length)
  .flatMap((r) => r.milestones.map((m) => ({ ...m, slug: r.slug, mlbId: r.mlbId }))), ['slug', 'milestone', 'eventDate'])
const gameLevels = new Map(gameLevelArt.records.filter((r) => r.slug).map((r) => [r.slug, r]))

/** Dated first/last game dates for a slug+season+team, only when recorded. */
function gameDates(slug, season, teamName) {
  const rec = gameLevels.get(slug)
  if (!rec?.levels?.length) return { first: null, last: null, basis: null }
  const candidates = rec.levels.filter((l) => l.season === season && (!teamName || l.teamName === teamName))
  const dated = candidates.filter((l) => l.firstGameDate)
  if (!dated.length) return { first: null, last: null, basis: null }
  const firsts = [...new Set(dated.map((l) => l.firstGameDate))].sort()
  const lasts = [...new Set(dated.map((l) => l.lastGameDate))].sort()
  if (firsts.length > 1) return { first: null, last: null, basis: 'GAME_LOG_CONFLICT' }
  return { first: firsts[0] ?? null, last: lasts.length === 1 ? lasts[0] : null, basis: 'GAME_LOG' }
}

/** Development decision overrides reviewed by a person (per slug). */
function decisionFor(slug) {
  return decisions[slug] ?? {}
}

const stintRows = []
const milestoneRows = []
const conflicts = []
const includedSources = new Map()

for (const s of stints) {
  const dec = decisionFor(s.slug)
  // Reviewed exclusion: a stint a person rejected never enters the database.
  if (dec.excludeStints?.some((x) => x.season === s.season && x.level === s.level && x.teamName === s.teamName)) {
    conflicts.push(sqlRow([s.slug, 'STINT_EXCLUDED_BY_REVIEW', `review excluded ${s.season} ${s.level} ${s.teamName}`, asOf, null]))
    continue
  }
  const dates = gameDates(s.slug, s.season, s.teamName)
  if (dates.basis === 'GAME_LOG_CONFLICT') {
    conflicts.push(sqlRow([s.slug, 'GAME_DATES_CONFLICT', `${s.season} ${s.teamName}: game logs disagree on first appearance`, asOf, null]))
  }
  // Prefer the age the source recorded for the season, then a reviewed
  // decision override, then the computed June-30 season age.
  const age = s.age ?? dec.ageOverrides?.[String(s.season)] ?? s.ageSeasonStart
  const sourceUrls = (s.sources ?? []).map((x) => x.url)
  const retrieved = (s.sources ?? []).map((x) => x.retrievedAt).sort()[0] ?? null
  for (const src of s.sources ?? []) includedSources.set(src.url, src)
  stintRows.push(sqlRow([
    s.slug, s.mlbId, s.season, s.organization, s.teamName, s.teamId, s.league,
    s.sourceLevel, s.level, s.classification, s.era,
    dates.first, dates.last, dates.basis,
    age, s.levelRank, s.affiliated,
    s.batting ? s.batting.games : null,
    s.batting ? s.batting.plateAppearances : null,
    s.batting ? s.batting.atBats : null,
    s.batting ? s.batting.hits : null,
    s.batting ? s.batting.doubles : null,
    s.batting ? s.batting.triples : null,
    s.batting ? s.batting.homeRuns : null,
    s.batting ? s.batting.walks : null,
    s.batting ? s.batting.strikeouts : null,
    s.batting ? s.batting.stolenBases : null,
    s.batting ? s.batting.caughtStealing : null,
    s.batting ? s.batting.avg : null,
    s.batting ? s.batting.obp : null,
    s.batting ? s.batting.slg : null,
    s.batting ? s.batting.ops : null,
    s.pitchingLine ? s.pitchingLine.games : null,
    s.pitchingLine ? s.pitchingLine.gamesStarted : null,
    s.pitchingLine ? s.pitchingLine.inningsPitched : null,
    s.pitchingLine ? s.pitchingLine.battersFaced : null,
    s.pitchingLine ? s.pitchingLine.hitsAllowed : null,
    s.pitchingLine ? s.pitchingLine.runs : null,
    s.pitchingLine ? s.pitchingLine.earnedRuns : null,
    s.pitchingLine ? s.pitchingLine.homeRunsAllowed : null,
    s.pitchingLine ? s.pitchingLine.walks : null,
    s.pitchingLine ? s.pitchingLine.strikeouts : null,
    s.pitchingLine ? s.pitchingLine.era : null,
    s.pitchingLine ? s.pitchingLine.whip : null,
    s.batting ? s.batting.kPct : null,
    s.batting ? s.batting.bbPct : null,
    s.pitchingLine ? s.pitchingLine.kPct : null,
    s.pitchingLine ? s.pitchingLine.bbPct : null,
    s.pitchingLine ? s.pitchingLine.kMinusBbPct : null,
    new Json({ groups: s.groups, classificationRule: s.classificationRule, organizationBasis: s.organizationBasis, hitting: s.hitting?.stat ?? null, pitching: s.pitching?.stat ?? null }),
    asOf, retrieved, sourceUrls.length ? new Json(sourceUrls) : null,
  ]))
}

const MILESTONE_TO_CODE = {
  SIGNED: 'PROFESSIONAL_SIGNING',
  DSL_DEBUT: 'DSL_DEBUT',
  COMPLEX_DEBUT: 'COMPLEX_DEBUT',
  A_DEBUT: 'A_DEBUT',
  HIGH_A_DEBUT: 'HIGH_A_DEBUT',
  AA_DEBUT: 'AA_DEBUT',
  AAA_DEBUT: 'AAA_DEBUT',
  MLB_DEBUT: 'MLB_DEBUT',
  ORGANIZATION_CHANGE: 'ORGANIZATION_CHANGE',
  RELEASED: 'RELEASED',
  RETIRED: 'RETIRED',
  FINAL_AFFILIATED_APPEARANCE: 'FINAL_AFFILIATED_APPEARANCE',
}

const seenMilestones = new Set()
for (const m of milestones) {
  const code = MILESTONE_TO_CODE[m.milestone]
  if (!code) throw new Error(`Unhandled milestone type ${m.milestone}`)
  const key = [m.slug, code, m.eventDate ?? '', m.season ?? '', m.evidence].join('|')
  if (seenMilestones.has(key)) continue
  seenMilestones.add(key)
  const dec = decisionFor(m.slug)
  if (dec.excludeMilestones?.includes(code)) continue
  // "First Dodgers MLB appearance if different" is derived in the migration;
  // everything here is one event per player/event/date/source.
  for (const src of [{ url: milestoneSourceUrl(m) }]) {
    if (src.url) includedSources.set(src.url, { url: src.url, retrievedAt: m.retrievedAt ?? asOf })
  }
  milestoneRows.push(sqlRow([
    m.slug, m.mlbId, code,
    m.eventDate ?? null,
    m.datePrecision ?? null,
    m.season ?? null,
    m.organization ?? null,
    m.level ?? null,
    m.evidence ?? null,
    m.note ?? null,
    asOf,
  ]))
}

function milestoneSourceUrl(m) {
  switch (m.evidence) {
    case 'SIGNING_RECORD': return 'disi:signings.signing_date'
    case 'MLB_PERSON_RECORD': return 'https://statsapi.mlb.com/api/v1/people'
    case 'SEASON_SPLITS': return 'https://statsapi.mlb.com/api/v1/stat-types/yearByYear'
    case 'MLB_TRANSACTION_LOG': return 'https://statsapi.mlb.com/api/v1/transactions'
    default: return null
  }
}

const header = (name, cols) => `-- ${name}(${cols})`
const sql = [
  header('stints', `slug, mlb_id, season, organization_name, affiliate_team, team_id, league_name, source_level, level, level_classification, era, first_game_date, last_game_date, game_date_basis, age_during_season, level_rank, affiliated, g, pa, ab, h, b2, b3, hr, bb, so, sb, cs, avg, obp, slg, ops, pg, gs, ip, bf, h_allowed, r, er, hr_allowed, pbb, pso, era_, whip, batter_k_pct, batter_bb_pct, pitcher_k_pct, pitcher_bb_pct, pitcher_k_minus_bb_pct, detail, as_of_date, retrieved_at, source_urls`),
  stintRows.join(',\n'),
  '',
  header('milestones', 'slug, mlb_id, event_code, event_date, date_precision, season_year, organization_name, level, evidence_basis, note, as_of_date'),
  milestoneRows.join(',\n') || "-- none",
  '',
  header('conflicts', 'slug, conflict_type, description, as_of_date, note'),
  conflicts.join(',\n') || "-- none",
  '',
  header('sources', 'url, retrieved_at'),
  [...includedSources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, s]) => sqlRow([s.url, s.retrievedAt ?? null])).join(',\n') || "-- none",
]
  .filter((block) => block !== '')
  .map((block) => block.trimEnd())
  .join('\n\n') + '\n'

const out = requireArg(args, 'out')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, sql)
fs.writeFileSync(out.replace(/\.sql$/, '') + '-decisions.json', stableStringify({
  meta: { asOf, stints: stintRows.length, milestones: milestoneRows.length, conflicts: conflicts.length },
  records: [...new Set(stints.map((s) => s.slug))].map((slug) => ({ slug })),
}))
process.stderr.write(`stints ${stintRows.length}; milestones ${milestoneRows.length}; conflicts ${conflicts.length} → ${out}\n`)
