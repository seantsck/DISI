// Acquisition-cost research workflow. UNKNOWN is never $0: a missing amount stays NULL and is reported as unknown, and a zero is
// recognised only where the evidence-backed total is exactly zero.

import { orderBy } from './cmp.js'

/** Tier definitions (documented in database/research/046/README.md). Lower is researched first. */
export const COST_TIERS = Object.freeze({
  1: 'MATURE_AUDITED',
  2: 'VERIFIED_MLB',
  3: 'REPORTED_LARGE_CLASS',
  4: 'TRADE_VALUE_CONTRIBUTOR',
  5: 'REMAINING',
})

/** A class is "large/reported" when a source states a population of at least this many players for the year. */
export const LARGE_CLASS_MIN_EXPECTED = 20

const TRADE_CHAINS = new Set(['COMPLETE_TERMINAL', 'INCOMPLETE_EXIT_NOT_RESEARCHED', 'INCOMPLETE_EXIT_UNRECORDED', 'INCOMPLETE_PENDING_CONSIDERATION', 'INCOMPLETE_RETURN_UNRECORDED'])

/**
 * Cost state of one signing, from the persisted product_player_decision columns.
 *  KNOWN_COMPLETE  every required component has a known amount
 *  KNOWN_PARTIAL   some components known, some required ones missing (a lower bound)
 *  KNOWN_UNJUDGED  an amount is known but DISI defines no required component, so completeness is not judged
 *  KNOWN_ZERO      the evidence-backed total is exactly 0
 *  UNKNOWN         no amount is known (NEVER treated as 0)
 *  NO_COST_RULE    DISI defines no required component for this signing route, so completeness cannot be judged; amount unknown unless reported
 */
export function costState(d) {
  const known = d.known_acquisition_cost_usd
  if (known === null || known === undefined) return d.cost_coverage_state === 'NO_RULE' ? 'NO_COST_RULE' : 'UNKNOWN'
  if (Number(known) === 0) return 'KNOWN_ZERO'
  if (d.cost_coverage_state === 'PARTIAL') return 'KNOWN_PARTIAL'
  return d.cost_coverage_state === 'COMPLETE' ? 'KNOWN_COMPLETE' : 'KNOWN_UNJUDGED'
}

export const isCostKnown = (d) => ['KNOWN_COMPLETE', 'KNOWN_PARTIAL', 'KNOWN_UNJUDGED', 'KNOWN_ZERO'].includes(costState(d))

/** Years whose reported population is large. @param {any[]} populations v_dodgers_signing_population_coverage rows */
export function largeClassYears(populations) {
  const years = new Set()
  for (const p of populations) if (p.expected_population != null && Number(p.expected_population) >= LARGE_CLASS_MIN_EXPECTED) years.add(p.signing_year)
  return years
}

/** The most analytically useful tier a signing qualifies for. */
export function costTier(d, { largeYears = new Set() } = {}) {
  if (d.maturity_status === 'MATURE' && d.outcome_state) return 1
  if (d.reached_mlb_verified === true) return 2
  if (largeYears.has(d.signing_year)) return 3
  if (TRADE_CHAINS.has(d.chain_status) || d.value_left_organization_bwar != null || d.individually_attributable_trade_bwar != null) return 4
  return 5
}

/**
 * Deterministic cost-research queue. Order: tier, verified MLB first, higher observed bWAR first (NULL last), older class first,
 * sort name, signing id.
 * @param {any[]} decisions product_player_decision rows
 * @param {{ populations?: any[], missing?: boolean, mature?: boolean, mlb?: boolean, year?: number, market?: string, limit?: number }} [opts]
 */
export function costQueue(decisions, opts = {}) {
  const largeYears = largeClassYears(opts.populations ?? [])
  let rows = decisions.map((d) => ({
    signing_id: d.signing_id,
    player_id: d.player_id,
    player_slug: d.player_slug,
    full_name: d.full_name,
    signing_year: d.signing_year,
    country_market: d.country_market,
    maturity: d.maturity_status,
    outcome_state: d.outcome_state ?? null,
    reached_mlb_verified: d.reached_mlb_verified === true,
    realized_career_bwar: d.realized_career_bwar == null ? null : Number(d.realized_career_bwar),
    cost_state: costState(d),
    known_acquisition_cost_usd: d.known_acquisition_cost_usd == null ? null : Number(d.known_acquisition_cost_usd),
    components_known: d.cost_components_known ?? [],
    components_missing: d.cost_components_required_missing ?? [],
    tier: costTier(d, { largeYears }),
  }))
  if (opts.missing) rows = rows.filter((r) => r.cost_state === 'UNKNOWN' || r.cost_state === 'NO_COST_RULE' || r.cost_state === 'KNOWN_PARTIAL')
  if (opts.mature === true) rows = rows.filter((r) => r.maturity === 'MATURE')
  if (opts.mlb === true) rows = rows.filter((r) => r.reached_mlb_verified)
  if (opts.mlb === false) rows = rows.filter((r) => !r.reached_mlb_verified)
  if (opts.year != null) rows = rows.filter((r) => r.signing_year === opts.year)
  if (opts.market) rows = rows.filter((r) => (r.country_market ?? '').toLowerCase() === opts.market.toLowerCase())
  rows.sort(orderBy(
    [(r) => r.tier, 'asc'],
    [(r) => (r.reached_mlb_verified ? 0 : 1), 'asc'],
    [(r) => r.realized_career_bwar, 'desc'],
    [(r) => r.signing_year, 'asc'],
    [(r) => r.full_name, 'asc'],
    [(r) => r.signing_id, 'asc'],
  ))
  return opts.limit != null ? rows.slice(0, opts.limit) : rows
}

/** Coverage summary: counts of each state, known spend as a lower bound, never an estimate for the unknown. */
export function costSummary(decisions) {
  const states = {}
  let spend = 0
  for (const d of decisions) {
    const s = costState(d)
    states[s] = (states[s] ?? 0) + 1
    if (d.known_acquisition_cost_usd != null) spend += Number(d.known_acquisition_cost_usd)
  }
  const known = (states.KNOWN_COMPLETE ?? 0) + (states.KNOWN_PARTIAL ?? 0) + (states.KNOWN_UNJUDGED ?? 0) + (states.KNOWN_ZERO ?? 0)
  return {
    signings: decisions.length,
    known,
    unknown: decisions.length - known,
    states: Object.fromEntries(Object.entries(states).sort(([a], [b]) => (a < b ? -1 : 1))),
    known_spend_usd: Math.round(spend * 100) / 100,
    spend_is_lower_bound: decisions.length - known > 0,
  }
}

/** Completeness check for a researched cost before it is written. @returns {string[]} missing items */
export function costReportGaps(r) {
  const gaps = []
  if (!(typeof r?.amount === 'number' && Number.isFinite(r.amount) && r.amount >= 0)) gaps.push('amount')
  if (!/^[A-Z]{3}$/.test(String(r?.currency ?? ''))) gaps.push('currency')
  if (!['EXACT', 'ROUNDED', 'APPROXIMATE', 'RULE_DERIVED'].includes(r?.amountBasis)) gaps.push('amount_basis_exact_rounded_approximate')
  if (!r?.sourceUrl) gaps.push('source')
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(r?.retrievedAt ?? ''))) gaps.push('retrieved_date')
  if (!r?.evidenceBasis) gaps.push('evidence_basis')
  if (!r?.confidence) gaps.push('confidence')
  if (r?.amount === 0 && !r?.zeroEvidence) gaps.push('zero_requires_explicit_evidence')
  return gaps
}
