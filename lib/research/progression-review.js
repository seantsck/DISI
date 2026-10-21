// The reviewer's packet for a pending progression decision (048). Pure functions over read-only rows.
//
// An ambiguous level sequence is recorded as a PENDING_REVIEW decision (Migration 024) and stays pending until a PERSON decides. This module does not
// decide. It lays out, for one player, the evidence a reviewer needs side by side: the pending decisions and their notes, the source stints in
// chronological order, the first appearance at each level, the exact pairs of levels that run backward, and the competing readings of each pair
// with what would settle it. It never ranks the readings and never writes a decision.
//
// POST-MLB MINOR-LEAGUE STINT != DEVELOPMENTAL ARRIVAL. AMBIGUOUS LEVEL SEQUENCE != CANONICAL LEVEL DEBUT.

import { orderBy } from './cmp.js'

/** The ladder of Migration 024 (rookie levels share a tier). */
export const LADDER = Object.freeze([
  { event: 'DSL_DEBUT', level: 'INTERNATIONAL_ROOKIE', label: 'DSL', tier: 1 },
  { event: 'COMPLEX_DEBUT', level: 'COMPLEX_ROOKIE', label: 'Complex', tier: 1 },
  { event: 'A_DEBUT', level: 'LOW_A', label: 'Low-A', tier: 3 },
  { event: 'HIGH_A_DEBUT', level: 'HIGH_A', label: 'High-A', tier: 4 },
  { event: 'AA_DEBUT', level: 'AA', label: 'Double-A', tier: 5 },
  { event: 'AAA_DEBUT', level: 'AAA', label: 'Triple-A', tier: 6 },
])
const BY_EVENT = new Map(LADDER.map((l) => [l.event, l]))
const BY_LEVEL = new Map(LADDER.map((l) => [l.level, l]))

/** What would settle a reading. These are the sources a reviewer can open; none is consulted or inferred here. */
export const EVIDENCE_NEEDED = Object.freeze([
  'Dated game logs for each season in question (exact first and last appearance at each level).',
  'The MLB Stats API transaction log for assignments, rehabilitation assignments and injured-list placements in those seasons.',
  'A team or beat-reporting source that states the reason for the appearance.',
])

const season = (m) => m.first_appearance_season ?? m.season_year ?? null

/**
 * @param {{ player_id: string, player_slug?: string, full_name?: string, signing_year?: number, mlb_debut_date?: string|null }} player
 * @param {{ event_code: string, progression_role: string, review_status: string, confidence?: string, notes?: string, as_of_date?: string }[]} decisions
 * @param {{ event_code: string, first_appearance_season: number|null, first_appearance_date?: string|null, first_appearance_precision?: string|null, development_state?: string }[]} progression
 * @param {{ season: number, level: string, level_rank?: number|null, affiliate_team?: string|null, league_name?: string|null, organization_name?: string|null, stint_kind?: string, g?: number|null, pg?: number|null, pa?: number|null, ip?: number|string|null, first_game_date?: string|null }[]} stints
 */
export function progressionReviewPacket(player, decisions, progression, stints) {
  const pending = decisions.filter((d) => d.review_status === 'PENDING_REVIEW')
  const prog = progression.filter((p) => BY_EVENT.has(p.event_code))
  const debutSeason = player.mlb_debut_date ? Number(String(player.mlb_debut_date).slice(0, 4)) : null
  const team = stints.filter((s) => (s.stint_kind ?? 'TEAM_STINT') === 'TEAM_STINT')

  // source stints in chronological order: season, then ladder order, then team
  const order = (level) => BY_LEVEL.get(level)?.tier ?? (level === 'MLB' ? 99 : 50)
  const path = team.slice().sort(orderBy([(s) => s.season, 'asc'], [(s) => order(s.level), 'asc'], [(s) => s.affiliate_team ?? '', 'asc'], [(s) => s.league_name ?? '', 'asc']))
    .map((s) => ({
      season: s.season,
      level: s.level,
      label: BY_LEVEL.get(s.level)?.label ?? s.level,
      team: s.affiliate_team ?? null,
      organization: s.organization_name ?? null,
      games: s.g ?? s.pg ?? null,
      before_mlb_debut: debutSeason === null ? null : s.season <= debutSeason && s.level !== 'MLB',
    }))

  // first appearance at each level, in ladder order, with the decision that covers it
  const firsts = LADDER.map((l) => {
    const p = prog.find((x) => x.event_code === l.event)
    if (!p || season(p) === null) return null
    const d = decisions.find((x) => x.event_code === l.event) ?? null
    const games = team.filter((s) => s.level === l.level && (debutSeason === null || s.season <= debutSeason)).reduce((n, s) => n + (s.g ?? s.pg ?? 0), 0)
    return {
      event_code: l.event, level: l.level, label: l.label, tier: l.tier,
      first_season: season(p), first_date: p.first_appearance_date ?? null, precision: p.first_appearance_precision ?? null,
      games_before_mlb_debut: games,
      decision: d ? { role: d.progression_role, status: d.review_status } : null,
      development_state: p.development_state ?? null,
    }
  }).filter(Boolean)

  // pairs that run backward (a lower tier first recorded in a LATER season than a higher tier)
  const inversions = []
  for (const lo of firsts) {
    for (const hi of firsts) {
      if (hi.tier > lo.tier && lo.first_season > hi.first_season) inversions.push({ lower: lo, higher: hi })
    }
  }
  inversions.sort(orderBy([(i) => i.higher.first_season, 'asc'], [(i) => i.lower.first_season, 'asc'], [(i) => i.lower.event_code, 'asc']))

  const readings = inversions.map((i) => ({
    between: [i.lower.event_code, i.higher.event_code],
    higher_first_season: i.higher.first_season,
    lower_first_season: i.lower.first_season,
    interpretations: [
      {
        id: 'EARLY_CAMEO_AT_HIGHER_LEVEL',
        reading: `${i.higher.label} (${i.higher.first_season}, ${i.higher.games_before_mlb_debut} G before the MLB debut) was an early cameo; the developmental arrival at ${i.higher.label} is later.`,
        decision_if_accepted: `${i.higher.event_code}: EARLY_CAMEO with a reviewed arrival date, or NULL if ${i.higher.label} was not yet reached`,
      },
      {
        id: 'LOWER_LEVEL_IS_REASSIGNMENT_OR_REHABILITATION',
        reading: `${i.lower.label} (${i.lower.first_season}, ${i.lower.games_before_mlb_debut} G before the MLB debut) came after ${i.higher.label} as a reassignment, demotion or rehabilitation assignment; it is not a developmental arrival.`,
        decision_if_accepted: `${i.lower.event_code}: POST_ESTABLISHMENT_APPEARANCE (no arrival at ${i.lower.label}; the level is skipped in progression)`,
      },
    ],
  }))

  return {
    player: { player_id: player.player_id, player_slug: player.player_slug ?? null, full_name: player.full_name ?? null, signing_year: player.signing_year ?? null, mlb_debut_date: player.mlb_debut_date ?? null },
    pending: pending.map((d) => ({ event_code: d.event_code, role: d.progression_role, status: d.review_status, confidence: d.confidence ?? null, as_of_date: d.as_of_date ?? null, notes: d.notes ?? null }))
      .sort(orderBy([(d) => BY_EVENT.get(d.event_code)?.tier ?? 0, 'asc'], [(d) => d.event_code, 'asc'])),
    path,
    first_appearances: firsts,
    inversions: inversions.map((i) => ({ lower: i.lower.event_code, higher: i.higher.event_code, lower_first_season: i.lower.first_season, higher_first_season: i.higher.first_season })),
    readings,
    evidence_needed: EVIDENCE_NEEDED,
    // the packet never decides: every pending row is reported exactly as stored
    decided: false,
  }
}

/** A reviewer's plain-text rendering of a packet (the research CLI prints it). */
export function renderReviewPacket(packet) {
  const out = []
  const p = packet.player
  out.push(`${p.full_name ?? p.player_slug}  (signed ${p.signing_year ?? 'unknown'}, MLB debut ${p.mlb_debut_date ?? 'not recorded'})`)
  out.push('Nothing below is a decision. Every pending row stays PENDING_REVIEW until a person decides it.')
  out.push('', `PENDING DECISIONS (${packet.pending.length})`)
  for (const d of packet.pending) out.push(`  ${d.event_code}  ${d.role} / ${d.status}  confidence ${d.confidence ?? 'n/a'}  as of ${d.as_of_date ?? 'n/a'}`, `    ${d.notes ?? '(no note)'}`)
  out.push('', 'SOURCE STINTS, CHRONOLOGICAL (* = in or before the MLB debut season; the order of stints WITHIN a season is not recorded)')
  let last = null
  for (const s of packet.path) {
    out.push(`  ${s.season === last ? '    ' : s.season}  ${s.before_mlb_debut ? '*' : ' '} ${s.label.padEnd(9)} ${String(s.games ?? '?').padStart(3)} G  ${s.team ?? '(no team)'}${s.organization ? ` [${s.organization}]` : ''}`)
    last = s.season
  }
  out.push('', 'FIRST APPEARANCE AT EACH LEVEL')
  for (const f of packet.first_appearances) out.push(`  ${f.label.padEnd(9)} ${f.first_date ?? f.first_season} (${f.precision ?? 'season'})  ${f.games_before_mlb_debut} G before the MLB debut  ${f.decision ? `decision ${f.decision.role}/${f.decision.status}` : 'no decision'}`)
  out.push('', `LEVELS THAT RUN BACKWARD (${packet.inversions.length})`)
  for (const i of packet.inversions) out.push(`  ${i.lower} first recorded ${i.lower_first_season}, after ${i.higher} first recorded ${i.higher_first_season}`)
  for (const r of packet.readings) {
    out.push('', `COMPETING READINGS: ${r.between.join(' vs ')}`)
    for (const i of r.interpretations) out.push(`  - ${i.reading}`, `      if accepted: ${i.decision_if_accepted}`)
  }
  out.push('', 'EVIDENCE THAT WOULD SETTLE IT')
  for (const e of packet.evidence_needed) out.push(`  - ${e}`)
  return out.join('\n')
}
