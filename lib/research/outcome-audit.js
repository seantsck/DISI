// What one outcome-audit research task may conclude, and what a completed audit must capture.
// NOT_AUDITED is not AUDITED_NO_MLB: only VERIFIED_NO_MLB (an audit row with reached_mlb_verified = false) is a no-MLB result.

import { AUDIT_POLICY, AUDIT_CONCLUSIONS, OUTCOME_STATES } from './policy.js'

/**
 * Maps a scripts/mlb classify.mjs summary to an explicit conclusion.
 * @param {{ recommendation?: string, reason?: string }} summary
 * @param {number} signingYear
 * @param {{ negativeThroughYear: number, activeNegativeThroughYear: number }} [policy]
 * @returns {{ conclusion: string, writeAudit: boolean, reachedMlb: boolean | null, outcomeState: string | null, reason: string }}
 */
export function auditConclusion(summary, signingYear, policy = AUDIT_POLICY) {
  const none = (conclusion, reason) => ({ conclusion, writeAudit: false, reachedMlb: null, outcomeState: null, reason })
  switch (summary?.recommendation) {
    case 'VERIFIED_MLB':
      return { conclusion: 'VERIFIED_MLB', writeAudit: true, reachedMlb: true, outcomeState: 'REACHED_MLB', reason: 'Verified MLB debut.' }
    case 'NO_MLB_CAREER_ENDED':
      return signingYear <= policy.negativeThroughYear
        ? { conclusion: 'VERIFIED_NO_MLB', writeAudit: true, reachedMlb: false, outcomeState: 'NO_MLB_CAREER_ENDED', reason: summary.reason ?? '' }
        : none('NOT_AUDITED', `Class ${signingYear} is newer than ${policy.negativeThroughYear}; recorded as progress only.`)
    case 'NO_MLB_ACTIVE_IN_MINORS':
      return signingYear <= policy.activeNegativeThroughYear
        ? { conclusion: 'VERIFIED_NO_MLB', writeAudit: true, reachedMlb: false, outcomeState: 'NO_MLB_ACTIVE_IN_MINORS', reason: summary.reason ?? '' }
        : none('NOT_AUDITED', 'Still developing in affiliated ball; not an outcome yet.')
    default:
      return none('INSUFFICIENT_EVIDENCE', 'Insufficient evidence; left unaudited.')
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/**
 * Completeness check for an audit about to be written. Returns the list of missing items; an empty list means the capture is complete.
 * An LLM assertion is never evidence: every audit needs retrievable sources.
 * @param {any} audit
 * @returns {string[]}
 */
export function auditCaptureGaps(audit) {
  const gaps = []
  if (!AUDIT_CONCLUSIONS.includes(audit?.conclusion)) gaps.push('conclusion')
  if (audit?.conclusion !== 'VERIFIED_MLB' && audit?.conclusion !== 'VERIFIED_NO_MLB') return gaps.concat('conclusion_is_not_writable')
  if (!ISO.test(String(audit.asOfDate ?? ''))) gaps.push('as_of_date')
  if (!audit.mlbId) gaps.push('mlb_identity')
  if (!audit.rationale || !String(audit.rationale).trim()) gaps.push('rationale')
  const sources = Array.isArray(audit.sources) ? audit.sources : []
  if (!sources.length || sources.some((s) => !s?.url || !s?.retrievedAt)) gaps.push('provenance_sources_with_url_and_retrieval_time')
  if (!OUTCOME_STATES.includes(audit.outcomeState)) gaps.push('outcome_state')
  if (audit.conclusion === 'VERIFIED_MLB') {
    if (audit.outcomeState !== 'REACHED_MLB') gaps.push('outcome_state_matches_conclusion')
    if (!ISO.test(String(audit.mlbDebutDate ?? ''))) gaps.push('mlb_debut_date')
    if (!audit.mlbDebutTeam) gaps.push('mlb_debut_organization')
  } else {
    if (audit.outcomeState === 'REACHED_MLB') gaps.push('outcome_state_matches_conclusion')
    if (audit.mlbDebutDate) gaps.push('no_mlb_result_must_not_carry_a_debut_date')
    // evidence that no MLB appearance exists: an affiliated-career summary or a final transaction through the as-of date
    if (!audit.lastAffiliatedSeason && !audit.finalTransaction) gaps.push('no_mlb_evidence_last_affiliated_season_or_final_transaction')
  }
  return gaps
}
