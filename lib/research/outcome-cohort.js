// The deterministic outcome-audit cohort: who is mature, who is still NOT_AUDITED, in what order they are researched and why
// each one is or is not resolvable today. NOT_AUDITED is an absent audit; it is never counted as, or converted to, NO_MLB.

import { AUDIT_POLICY, AUDIT_TIERS, NEVER_RESEARCHED_BONUS } from './policy.js'
import { isMatureSigning } from './maturity.js'
import { orderBy } from './cmp.js'

const tierFor = (year) => AUDIT_TIERS.find((t) => year <= t.throughYear) ?? AUDIT_TIERS.at(-1)

/** Canonical status from the signing record. */
export function auditStatusOf(signing) {
  if (signing.outcome_audit_status === 'VERIFIED_MLB' || signing.outcome_audit_status === 'VERIFIED_NO_MLB') return signing.outcome_audit_status
  return 'NOT_AUDITED'
}

/**
 * @param {{ signings: any[], directory?: any[], matureQueue?: any[], sourceCounts?: Record<string, number>, asOf: string, policy?: typeof AUDIT_POLICY }} data
 */
export function buildOutcomeCohort({ signings, directory = [], matureQueue = [], sourceCounts = {}, asOf, policy = AUDIT_POLICY }) {
  const dir = new Map(directory.map((d) => [d.player_id, d]))
  const prog = new Map(matureQueue.map((q) => [q.player_id, q]))
  return signings.map((s) => {
    const status = auditStatusOf(s)
    const mature = isMatureSigning(s, asOf)
    const d = dir.get(s.player_id)
    const q = prog.get(s.player_id)
    const mlbId = d?.mlb_id ?? q?.mlb_id ?? null
    const researched = Boolean(q && q.unaudited_reason !== 'NOT_YET_RESEARCHED')
    const blockers = []
    if (status === 'NOT_AUDITED') {
      if (mature === false) blockers.push('NOT_MATURE')
      if (mature === null) blockers.push('MATURITY_UNKNOWN')
      if (!mlbId) blockers.push('NO_MLB_ID')
      if (mature) {
        if (!q || q.unaudited_reason === 'NOT_YET_RESEARCHED') blockers.push('NOT_YET_RESEARCHED')
        if (q?.unaudited_reason === 'INSUFFICIENT_EVIDENCE') blockers.push('INSUFFICIENT_EVIDENCE')
        if (q?.unaudited_reason === 'STILL_DEVELOPING' && s.signing_year > policy.activeNegativeThroughYear) blockers.push('ACTIVE_IN_AFFILIATED_BALL_POLICY_HOLD')
        if (q?.unaudited_reason === 'AWAITING_REVIEW') blockers.push('RESEARCH_COMPLETE_AWAITING_AUDIT_REVIEW')
      }
    }
    const tier = tierFor(s.signing_year)
    return {
      player_id: s.player_id,
      player_slug: s.player_slug,
      full_name: s.full_name,
      player_sort_name: s.player_sort_name ?? s.full_name,
      signing_id: s.signing_id,
      signing_year: s.signing_year,
      signing_date: s.signing_date ?? null,
      age_at_signing: d?.age_at_signing ?? s.age_at_signing ?? null,
      country_market: s.country_market ?? null,
      maturity: mature === null ? 'UNKNOWN' : mature ? 'MATURE' : 'DEVELOPING',
      audit_status: status,
      outcome_state: s.outcome_state ?? null,
      mlb_id: mlbId,
      bref_id: d?.bref_id ?? null,
      source_count: sourceCounts[s.player_id] ?? 0,
      highest_level: q?.highest_level ?? null,
      last_affiliated_season: q?.last_affiliated_season ?? null,
      last_affiliated_team: q?.last_affiliated_team ?? null,
      disposition: q?.disposition ?? null,
      research_recommendation: q?.research_recommendation ?? null,
      audit_tier: mature ? tier.key : 'DEVELOPING',
      priority: mature && status === 'NOT_AUDITED' ? tier.priority + (researched ? 0 : NEVER_RESEARCHED_BONUS) : 0,
      blockers,
      actionable_now: status === 'NOT_AUDITED' && mature === true && blockers.every((b) => b === 'NOT_YET_RESEARCHED' || b === 'RESEARCH_COMPLETE_AWAITING_AUDIT_REVIEW'),
    }
  }).sort(orderBy(
    [(r) => r.priority, 'desc'],
    [(r) => r.signing_year, 'asc'],
    [(r) => r.signing_date, 'asc'],
    [(r) => r.player_sort_name, 'asc'],
    [(r) => r.player_id, 'asc'],
  ))
}

/** @param {any[]} cohort @param {{ mature?: boolean, status?: string, year?: number, market?: string, limit?: number }} [f] */
export function filterCohort(cohort, f = {}) {
  let rows = cohort
  if (f.mature === true) rows = rows.filter((r) => r.maturity === 'MATURE')
  if (f.mature === false) rows = rows.filter((r) => r.maturity !== 'MATURE')
  if (f.status && f.status !== 'all') rows = rows.filter((r) => r.audit_status === f.status.toUpperCase())
  if (f.year != null) rows = rows.filter((r) => r.signing_year === f.year)
  if (f.market) rows = rows.filter((r) => (r.country_market ?? '').toLowerCase() === f.market.toLowerCase())
  if (f.limit != null) rows = rows.slice(0, f.limit)
  return rows
}

/** Counts that keep the three audit states apart. */
export function cohortSummary(cohort) {
  const n = (fn) => cohort.filter(fn).length
  const mature = cohort.filter((r) => r.maturity === 'MATURE')
  const blockerCounts = {}
  for (const r of cohort) if (r.audit_status === 'NOT_AUDITED') for (const b of r.blockers) blockerCounts[b] = (blockerCounts[b] ?? 0) + 1
  return {
    tracked: cohort.length,
    mature: mature.length,
    verified_mlb: n((r) => r.audit_status === 'VERIFIED_MLB'),
    verified_no_mlb: n((r) => r.audit_status === 'VERIFIED_NO_MLB'),
    not_audited: n((r) => r.audit_status === 'NOT_AUDITED'),
    mature_audited: mature.filter((r) => r.audit_status !== 'NOT_AUDITED').length,
    mature_not_audited: mature.filter((r) => r.audit_status === 'NOT_AUDITED').length,
    developing_not_audited: n((r) => r.maturity !== 'MATURE' && r.audit_status === 'NOT_AUDITED'),
    mature_not_audited_actionable_now: n((r) => r.actionable_now),
    blocker_counts: Object.fromEntries(Object.entries(blockerCounts).sort(([a], [b]) => (a < b ? -1 : 1))),
  }
}
