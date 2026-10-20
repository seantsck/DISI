// The development queue, de-duplicated by the evidence gap each item actually names (048). Pure functions over the read-only dataset.
//
// v_dodgers_development_research_queue raises one row per DETECTOR. Several detectors fire on the same missing evidence: a log-era stint with no
// game dates raises MISSING_FIRST_GAME_DATE, MISSING_LAST_GAME_DATE and GAME_LOG_UNAVAILABLE, and the same absence keeps every level debut at season
// precision (SEASON_ONLY_MILESTONE) and the MLB player without exact pre-MLB dates. Researching any one of them is the same work, and closing it closes
// all of them. A reviewer should see one need, not five. Nothing is deleted: the detector rows stay, each need lists the issues it merges, and a need
// is closed only when every issue it merges is closed. Same dataset => same order.

import { orderBy } from './cmp.js'

/** Evidence-gap groups, most urgent first. The group is the research action; `issues` are the detectors that name the same gap. */
export const NEED_GROUPS = Object.freeze([
  { key: 'SOURCE_CONFLICT', action: 'Resolve a disagreement between sources', issues: ['EXACT_DATE_CONFLICT'] },
  { key: 'SEQUENCE_REVIEW', action: 'Review an ambiguous level sequence (a person decides; DISI does not)', issues: ['NON_MONOTONIC_PROGRESSION', 'LEVEL_SKIP_CAMEO_CANDIDATE'] },
  { key: 'SEASON_COVERAGE', action: 'Find the missing seasons or the missing early career', issues: ['IDENTITY_BUT_NO_PROFESSIONAL_SEASONS', 'MLB_PLAYER_MISSING_PRE_MLB_HISTORY', 'SEASON_GAP'] },
  { key: 'LEVEL_CLASSIFICATION', action: 'Place an unclassified stint on the level ladder', issues: ['UNKNOWN_LEVEL_CLASSIFICATION', 'LEVEL_CONFLICT', 'UNKNOWN_LEVEL_GAME_LOG'] },
  { key: 'ORGANIZATION', action: 'Resolve which organization a stint belongs to', issues: ['UNRESOLVED_ORGANIZATION', 'MULTI_ORG_SEASON_UNVERIFIED'] },
  { key: 'GAME_DATES', action: 'Retrieve dated game logs (exact first and last appearances)', issues: ['MISSING_FIRST_GAME_DATE', 'MISSING_LAST_GAME_DATE', 'GAME_LOG_UNAVAILABLE', 'SEASON_ONLY_MILESTONE', 'MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES'] },
])

const GROUP_OF = new Map(NEED_GROUPS.flatMap((g, i) => g.issues.map((issue) => [issue, { key: g.key, rank: i }])))

/** The group an issue belongs to, or null for an issue the registry does not know (reported, never dropped). */
export function needGroup(issue) {
  return GROUP_OF.get(issue)?.key ?? null
}

/**
 * Deduplicated research needs: one per player and evidence gap.
 * @param {{ developmentQueue?: { player_id: string, issue: string, priority?: number }[], signings?: any[] }} data
 * @returns {{ player_id: string, player_slug: string|null, full_name: string|null, signing_year: number|null, need: string, action: string, issues: string[], priority: number|null }[]}
 */
export function developmentNeeds(data) {
  const people = new Map((data.signings ?? []).map((s) => [s.player_id, s]))
  /** @type {Map<string, any>} */
  const byKey = new Map()
  for (const q of data.developmentQueue ?? []) {
    const g = GROUP_OF.get(q.issue)
    const key = g ? g.key : `UNGROUPED:${q.issue}`
    const id = `${q.player_id}|${key}`
    const cur = byKey.get(id) ?? { player_id: q.player_id, key, rank: g ? g.rank : 99, issues: new Set(), priority: null }
    cur.issues.add(q.issue)
    if (q.priority != null) cur.priority = cur.priority === null ? Number(q.priority) : Math.min(cur.priority, Number(q.priority))
    byKey.set(id, cur)
  }
  const rows = [...byKey.values()].map((c) => {
    const s = people.get(c.player_id)
    const group = NEED_GROUPS.find((g) => g.key === c.key)
    return {
      player_id: c.player_id,
      player_slug: s?.player_slug ?? null,
      full_name: s?.full_name ?? null,
      signing_year: s?.signing_year ?? null,
      need: c.key,
      action: group ? group.action : `Review ${c.key.replace('UNGROUPED:', '')}`,
      issues: [...c.issues].sort(),
      priority: c.priority,
      rank: c.rank,
    }
  })
  rows.sort(orderBy([(r) => r.rank, 'asc'], [(r) => r.signing_year, 'asc'], [(r) => r.player_slug ?? '', 'asc'], [(r) => r.player_id, 'asc']))
  return rows.map(({ rank, ...r }) => r)
}

/** Counts per need and the detector rows they merge. The raw detector count is kept so nothing looks resolved by merging. */
export function developmentNeedSummary(data) {
  const needs = developmentNeeds(data)
  const detectorRows = (data.developmentQueue ?? []).length
  const byNeed = {}
  for (const n of needs) byNeed[n.need] = (byNeed[n.need] ?? 0) + 1
  return {
    detector_rows: detectorRows,
    needs: needs.length,
    players: new Set(needs.map((n) => n.player_id)).size,
    by_need: Object.fromEntries(NEED_GROUPS.filter((g) => byNeed[g.key]).map((g) => [g.key, byNeed[g.key]]).concat(Object.entries(byNeed).filter(([k]) => k.startsWith('UNGROUPED:')))),
  }
}
