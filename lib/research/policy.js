// Constants shared by the 046 research tooling. They restate rules that already exist elsewhere in DISI; a test pins each
// of them to its origin so there is never a second, drifting definition.

/** Five-year maturity (v_dodgers_class_analysis_eligibility 018, v_dodgers_mature_outcome_queue 019, v_player_realized_organizational_value 032). */
export const MATURITY_YEARS = 5

/** scripts/mlb/lib/classify.mjs DEFAULT_AUDIT_POLICY: which research recommendations may become an outcome audit. */
export const AUDIT_POLICY = Object.freeze({ negativeThroughYear: 2021, activeNegativeThroughYear: 2020 })

/** The canonical audit states. NOT_AUDITED is the absence of an audit, never a failure. */
export const AUDIT_STATUS = Object.freeze({
  NOT_AUDITED: 'NOT_AUDITED',
  VERIFIED_MLB: 'VERIFIED_MLB',
  VERIFIED_NO_MLB: 'VERIFIED_NO_MLB',
})

/** Explicit conclusions of one outcome-audit research task. INSUFFICIENT_EVIDENCE leaves the player NOT_AUDITED. */
export const AUDIT_CONCLUSIONS = Object.freeze(['VERIFIED_MLB', 'VERIFIED_NO_MLB', 'NOT_AUDITED', 'INSUFFICIENT_EVIDENCE'])

/** outcome_audits.outcome_state values (019). */
export const OUTCOME_STATES = Object.freeze(['REACHED_MLB', 'NO_MLB_CAREER_ENDED', 'NO_MLB_ACTIVE_IN_MINORS', 'NO_MLB_STATUS_UNKNOWN'])

/** Audit priority by signing class (v_dodgers_mature_outcome_queue 019). */
export const AUDIT_TIERS = Object.freeze([
  { key: 'TIER_1_THROUGH_2014', throughYear: 2014, priority: 100 },
  { key: 'TIER_2_2015_2020', throughYear: 2020, priority: 80 },
  { key: 'TIER_3_RECENT_MATURE', throughYear: Infinity, priority: 60 },
])
export const NEVER_RESEARCHED_BONUS = 10
