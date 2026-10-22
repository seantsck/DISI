// Transaction / value-attribution research workflow. Package value is never credited to one signing: a shared package stays at
// package level until DISI's attribution rules make a share individually attributable.

import { orderBy } from './cmp.js'

/** Exit dispositions (transaction_events.transaction_type) a player can leave the organization through. */
export const DISPOSITIONS = Object.freeze({
  RELEASE: 'RELEASED',
  TRADE: 'TRADED',
  SALE: 'SOLD_OR_ASSIGNED',
  WAIVER: 'SOLD_OR_ASSIGNED',
  RULE5_SELECTION: 'RULE_5_LOSS',
  EXPANSION_DRAFT: 'EXPANSION_DRAFT_LOSS',
  FREE_AGENCY: 'FREE_AGENCY',
  FREE_AGENT_SIGNING: 'FREE_AGENT_SIGNING',
})

export const dispositionOf = (transactionType) => DISPOSITIONS[transactionType] ?? 'UNKNOWN_DISPOSITION'

/** Why an incomplete chain is incomplete, in terms of the work still to do. */
export const CHAIN_WORK = Object.freeze({
  INCOMPLETE_IDENTITY: 'RESOLVE_ASSET_IDENTITY',
  INCOMPLETE_EXIT_NOT_RESEARCHED: 'RESEARCH_EXIT_TRANSACTION',
  INCOMPLETE_EXIT_UNRECORDED: 'RECORD_EXIT_TRANSACTION',
  INCOMPLETE_PENDING_CONSIDERATION: 'RESOLVE_PENDING_CONSIDERATION',
  INCOMPLETE_RETURN_UNRECORDED: 'RECORD_TRADE_RETURN',
  INCOMPLETE_WAR_NOT_LOADED: 'LOAD_BASEBALL_REFERENCE_WAR',
  INCOMPLETE_TIMING: 'RESOLVE_SAME_SEASON_TIMING',
})

// ---- 049: what is missing is not one thing -----------------------------------------------------------------------------------
// KNOWN TRANSACTION != KNOWN RETURN VALUE. The database names a chain INCOMPLETE_* for two different reasons: the transaction history is not known
// (an exit, a return, a player to be named, future considerations) or the history is known and the value of what came back is not (Baseball-Reference
// WAR not loaded, a same-season stint order that cannot be resolved). A blocker of the second kind never erases the transaction: it is classified
// here, deterministically, and stored nowhere.
//   CHAIN_OR_MEMBERSHIP   DISI does not know what happened to the asset or who was in the package
//   TERMS                 the players are known; a cash or pool-space amount is not
//   VALUE                 the transaction is known; the value of the return, or its attribution, is not
//   OTHER                 acquisition cost and documented boundaries (not transaction or value truth)
export const BLOCKER_BUCKETS = Object.freeze(['CHAIN_OR_MEMBERSHIP', 'TERMS', 'VALUE', 'OTHER'])

/** Chain statuses (v_downstream_organizational_realization.chain_status) that block the transaction history rather than its valuation. */
export const TRANSACTION_CHAIN_STATUSES = Object.freeze([
  'INCOMPLETE_IDENTITY', 'INCOMPLETE_PENDING_CONSIDERATION', 'INCOMPLETE_RETURN_UNRECORDED', 'INCOMPLETE_EXIT_NOT_RESEARCHED', 'INCOMPLETE_EXIT_UNRECORDED',
])
/** Chain statuses where the transaction chain is recorded to its end and only the value of a returned player is unavailable. */
export const VALUE_CHAIN_STATUSES = Object.freeze(['INCOMPLETE_WAR_NOT_LOADED', 'INCOMPLETE_TIMING'])

/** @param {string} chainStatus */
export function chainBlocker(chainStatus) {
  if (TRANSACTION_CHAIN_STATUSES.includes(chainStatus)) return 'CHAIN_OR_MEMBERSHIP'
  if (VALUE_CHAIN_STATUSES.includes(chainStatus)) return 'VALUE'
  return null
}

/** Rank of the research issues DISI already raises (v_transaction_research_queue / v_value_research_queue): lower = earlier. */
const ISSUE_RANK = Object.freeze({
  EXIT_TRANSACTION_MISSING: 1,
  TRADE_RETURN_UNRECORDED: 2,
  PTBNL_UNRESOLVED: 3,
  EXIT_STATUS_UNVERIFIED: 4,
  TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED: 5,
  EXIT_NOT_RESEARCHED_DOWNSTREAM: 6,
  RETURN_ASSET_EXIT_MISSING: 7,
  DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION: 8,
  FUTURE_CONSIDERATIONS_UNRESOLVED: 9,
  DOWNSTREAM_WAR_NOT_LOADED: 10,
  DOWNSTREAM_ASSET_CHAIN_INCOMPLETE: 11,
  OUTCOME_INCOMPLETE: 12,
  CASH_AMOUNT_UNKNOWN: 13,
  POOL_SPACE_AMOUNT_UNKNOWN: 14,
  ACQUISITION_COST_INCOMPLETE: 15,
  LINEAGE_BOUNDARY_NOTED: 16,
})

/** Which attribution concern an issue belongs to. */
export const ISSUE_CATEGORY = Object.freeze({
  EXIT_TRANSACTION_MISSING: 'MISSING_TRANSACTION_CHAIN',
  EXIT_NOT_RESEARCHED_DOWNSTREAM: 'MISSING_TRANSACTION_CHAIN',
  EXIT_STATUS_UNVERIFIED: 'MISSING_TRANSACTION_CHAIN',
  RETURN_ASSET_EXIT_MISSING: 'MISSING_TRANSACTION_CHAIN',
  DOWNSTREAM_ASSET_CHAIN_INCOMPLETE: 'MISSING_TRANSACTION_CHAIN',
  TRADE_RETURN_UNRECORDED: 'MISSING_TRADE_PACKAGE',
  PTBNL_UNRESOLVED: 'MISSING_TRADE_PACKAGE',
  FUTURE_CONSIDERATIONS_UNRESOLVED: 'MISSING_TRADE_PACKAGE',
  CASH_AMOUNT_UNKNOWN: 'MISSING_TRADE_PACKAGE',
  POOL_SPACE_AMOUNT_UNKNOWN: 'MISSING_TRADE_PACKAGE',
  DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION: 'MISSING_RETURN_ATTRIBUTION',
  TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED: 'UNRESOLVED_ATTRIBUTION',
  DOWNSTREAM_WAR_NOT_LOADED: 'MISSING_VALUE_AS_OF',
  OUTCOME_INCOMPLETE: 'MISSING_VALUE_AS_OF',
  ACQUISITION_COST_INCOMPLETE: 'ACQUISITION_COST',
  LINEAGE_BOUNDARY_NOTED: 'NOTED_BOUNDARY',
})

/** The blocker bucket of each research issue. An issue the registry does not know is reported as OTHER, never dropped. */
export const ISSUE_BUCKET = Object.freeze({
  EXIT_TRANSACTION_MISSING: 'CHAIN_OR_MEMBERSHIP',
  EXIT_NOT_RESEARCHED_DOWNSTREAM: 'CHAIN_OR_MEMBERSHIP',
  EXIT_STATUS_UNVERIFIED: 'CHAIN_OR_MEMBERSHIP',
  RETURN_ASSET_EXIT_MISSING: 'CHAIN_OR_MEMBERSHIP',
  DOWNSTREAM_ASSET_CHAIN_INCOMPLETE: 'CHAIN_OR_MEMBERSHIP',
  TRADE_RETURN_UNRECORDED: 'CHAIN_OR_MEMBERSHIP',
  PTBNL_UNRESOLVED: 'CHAIN_OR_MEMBERSHIP',
  FUTURE_CONSIDERATIONS_UNRESOLVED: 'CHAIN_OR_MEMBERSHIP',
  DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION: 'CHAIN_OR_MEMBERSHIP',
  CASH_AMOUNT_UNKNOWN: 'TERMS',
  POOL_SPACE_AMOUNT_UNKNOWN: 'TERMS',
  DOWNSTREAM_WAR_NOT_LOADED: 'VALUE',
  OUTCOME_INCOMPLETE: 'VALUE',
  TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED: 'VALUE',
  ACQUISITION_COST_INCOMPLETE: 'OTHER',
  LINEAGE_BOUNDARY_NOTED: 'OTHER',
})

/** What evidence would close each issue. A rule that forbids closing it says so instead (a shared package is never split). */
export const NEXT_EVIDENCE = Object.freeze({
  EXIT_TRANSACTION_MISSING: 'A structured or official record of the exit transaction.',
  EXIT_NOT_RESEARCHED_DOWNSTREAM: "A record of the returned player's later Dodgers exit transaction (disappearance is not a release).",
  EXIT_STATUS_UNVERIFIED: 'An exit transaction or a dated control observation.',
  RETURN_ASSET_EXIT_MISSING: "A record of the returned player's later Dodgers exit transaction (disappearance is not a release).",
  DOWNSTREAM_ASSET_CHAIN_INCOMPLETE: 'The later hops of the returned asset.',
  TRADE_RETURN_UNRECORDED: 'The consideration the Dodgers received.',
  PTBNL_UNRESOLVED: 'The player named (or the cash settled) to complete the trade.',
  FUTURE_CONSIDERATIONS_UNRESOLVED: 'What the future considerations became.',
  DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION: 'The transaction that brought the player to the Dodgers.',
  CASH_AMOUNT_UNKNOWN: 'A source that states the cash amount (an unstated payment is not $0).',
  POOL_SPACE_AMOUNT_UNKNOWN: 'A source that states the pool-space amount (never estimated).',
  DOWNSTREAM_WAR_NOT_LOADED: 'Baseball-Reference team-season WAR for the returned player (FanGraphs WAR cannot substitute; missing is not zero).',
  OUTCOME_INCOMPLETE: 'Reconciled MLB team-season history for the signing.',
  TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED: 'None: attribution is withheld by rule. A shared package is never split, weighted or credited to one player.',
  ACQUISITION_COST_INCOMPLETE: 'A sourced acquisition cost.',
  LINEAGE_BOUNDARY_NOTED: 'None: a documented boundary.',
})

/**
 * One merged, deterministically ordered list of transaction / value research items.
 * @param {{ transactionQueue: any[], valueQueue: any[] }} data
 * @param {{ missing?: boolean, unresolvedAttribution?: boolean, traded?: boolean, bucket?: string, issues?: string[], limit?: number }} [f]
 */
export function transactionResearchItems({ transactionQueue, valueQueue }, f = {}) {
  const items = [
    ...transactionQueue.map((r) => ({ queue: 'TRANSACTION', ...r })),
    ...valueQueue.map((r) => ({ queue: 'VALUE', ...r })),
  ].map((r) => ({
    queue: r.queue,
    issue: r.issue,
    category: ISSUE_CATEGORY[r.issue] ?? 'OTHER',
    bucket: ISSUE_BUCKET[r.issue] ?? 'OTHER',
    priority: Number(r.priority),
    rank: ISSUE_RANK[r.issue] ?? 99,
    player_slug: r.player_slug ?? null,
    event_key: r.event_key ?? null,
    asset_name: r.asset_name ?? null,
    detail: r.detail ?? null,
    next_evidence: NEXT_EVIDENCE[r.issue] ?? 'Review this issue.',
  }))
  let rows = items
  if (f.issues) rows = rows.filter((r) => f.issues.includes(r.issue))
  else if (f.bucket) rows = rows.filter((r) => r.bucket === f.bucket)
  else if (f.unresolvedAttribution) rows = rows.filter((r) => r.category === 'UNRESOLVED_ATTRIBUTION' || r.category === 'MISSING_RETURN_ATTRIBUTION')
  else if (f.traded) rows = rows.filter((r) => r.event_key !== null)
  else if (f.missing) rows = rows.filter((r) => r.category !== 'NOTED_BOUNDARY')
  rows.sort(orderBy(
    [(r) => r.priority, 'asc'], [(r) => r.rank, 'asc'], [(r) => r.player_slug, 'asc'], [(r) => r.event_key, 'asc'], [(r) => r.asset_name, 'asc'], [(r) => r.queue, 'asc'],
  ))
  return f.limit != null ? rows.slice(0, f.limit) : rows
}

/**
 * Value as it is attributed today, from product_player_decision. Counts are of signings with a NON-ZERO amount in each column:
 * a zero is a known "no value", NULL is "not determined", and package value never enters the individual column.
 */
export function attributionSummary(decisions) {
  const nonzero = (k) => decisions.filter((d) => d[k] != null && Number(d[k]) !== 0).length
  const chains = {}
  for (const d of decisions) chains[d.chain_status] = (chains[d.chain_status] ?? 0) + 1
  return {
    signings: decisions.length,
    chain_status: Object.fromEntries(Object.entries(chains).sort(([a], [b]) => (a < b ? -1 : 1))),
    // every INCOMPLETE_* chain, as the database names them (unchanged meaning) ...
    incomplete_chains: decisions.filter((d) => String(d.chain_status).startsWith('INCOMPLETE')).length,
    // ... split by what is missing (049): the transaction history, or only the value of a returned player
    transaction_chains_incomplete: decisions.filter((d) => chainBlocker(d.chain_status) === 'CHAIN_OR_MEMBERSHIP').length,
    value_blocked_chains: decisions.filter((d) => chainBlocker(d.chain_status) === 'VALUE').length,
    individually_attributable_trade_value: nonzero('individually_attributable_trade_bwar'),
    package_first_hop_value: nonzero('package_first_hop_participation_bwar'),
    package_downstream_value: nonzero('package_downstream_participation_bwar'),
    observable_not_attributable_value: nonzero('observable_not_attributable_bwar'),
    value_left_organization: nonzero('value_left_organization_bwar'),
  }
}

/**
 * Players whose chain is incomplete, with the work item that completes it and what kind of work it is. By default only chains whose TRANSACTION
 * history is open; { bucket: 'VALUE' } lists the chains whose history is recorded and whose returned players' value is unavailable.
 * @param {any[]} decisions product_player_decision rows
 * @param {{ bucket?: 'CHAIN_OR_MEMBERSHIP' | 'VALUE' | 'ALL' }} [f]
 */
export function incompleteChains(decisions, f = {}) {
  const want = f.bucket ?? 'CHAIN_OR_MEMBERSHIP'
  return decisions
    .filter((d) => CHAIN_WORK[d.chain_status] && (want === 'ALL' || chainBlocker(d.chain_status) === want))
    .map((d) => ({
      player_slug: d.player_slug, full_name: d.full_name, signing_year: d.signing_year, chain_status: d.chain_status, work: CHAIN_WORK[d.chain_status],
      bucket: chainBlocker(d.chain_status), attribution_state: attributionState(d),
    }))
    .sort(orderBy([(r) => r.chain_status, 'asc'], [(r) => r.signing_year, 'asc'], [(r) => r.player_slug, 'asc']))
}

// ---- 047: package-level truth before player-level attribution ---------------------------------------------------------------

/**
 * How the value of one signing's exit is attributed today. Package value is never credited to one player: only a sole-outgoing-asset
 * trade is INDIVIDUALLY_ATTRIBUTED. UNKNOWN TRADE RETURN != ZERO VALUE: a NULL amount is VALUE_NOT_DETERMINED, a zero is a recorded zero.
 *  NOT_A_TRADE_EXIT           the DISI chain has no trade return to attribute (a release, or no exit event)
 *  RETURN_STILL_ACCRUING      the signing was traded and an asset it returned is still under Dodgers control, so value is still accruing
 *  CHAIN_INCOMPLETE           the exit or its return is not yet recorded, so any value shown is to date and not final
 *  VALUE_NOT_DETERMINED       the return exists but the outcome is not observed, or the transaction chain is complete and a returned player's WAR is not
 *                             loaded (NULL, never 0)
 *  INDIVIDUALLY_ATTRIBUTED    the signing was the sole outgoing asset and the return is attributed to it
 *  PACKAGE_LEVEL_ONLY         the return is observable only at package level and is NOT credited to this player
 *  RECORDED_ZERO_RETURN       every recorded return amount is exactly zero
 * @param {any} d product_player_decision row
 */
export function attributionState(d) {
  const chain = d.chain_status
  if (chain === 'NO_TRADE_CHAIN') return 'NOT_A_TRADE_EXIT'
  if (chain === 'STILL_ACTIVE') return 'RETURN_STILL_ACCRUING'
  // 049: the transaction chain is recorded to its end and only a returned player's value is unavailable (WAR not loaded, same-season order unresolved)
  if (VALUE_CHAIN_STATUSES.includes(chain)) return 'VALUE_NOT_DETERMINED'
  if (String(chain).startsWith('INCOMPLETE')) return 'CHAIN_INCOMPLETE'
  if (d.realized_value_state === 'OUTCOME_NOT_OBSERVED') return 'VALUE_NOT_DETERMINED'
  const nz = (k) => d[k] != null && Number(d[k]) !== 0
  if (nz('individually_attributable_trade_bwar')) return 'INDIVIDUALLY_ATTRIBUTED'
  if (nz('package_first_hop_participation_bwar') || nz('package_downstream_participation_bwar') || nz('observable_not_attributable_bwar')) return 'PACKAGE_LEVEL_ONLY'
  return 'RECORDED_ZERO_RETURN'
}

const ATTRIBUTION_RANK = Object.freeze({ CHAIN_INCOMPLETE: 1, RETURN_STILL_ACCRUING: 2, VALUE_NOT_DETERMINED: 3, PACKAGE_LEVEL_ONLY: 4, INDIVIDUALLY_ATTRIBUTED: 5, RECORDED_ZERO_RETURN: 6 })

/**
 * The asset-path ledger: one row per signing that left by a trade chain, with the separate value concepts side by side
 * (never summed): value the player produced for the Dodgers, value produced for other organizations, the part of the return that is
 * individually attributable, and the package-level amounts. NULL stays NULL.
 */
export function attributionLedger(decisions) {
  const v = (x) => (x == null ? null : Number(x))
  return decisions
    .filter((d) => d.chain_status !== 'NO_TRADE_CHAIN')
    .map((d) => ({
      signing_id: d.signing_id,
      player_slug: d.player_slug,
      full_name: d.full_name,
      signing_year: d.signing_year,
      chain_status: d.chain_status,
      attribution_state: attributionState(d),
      direct_dodgers_bwar: v(d.direct_dodgers_bwar),
      value_left_organization_bwar: v(d.value_left_organization_bwar),
      individually_attributable_trade_bwar: v(d.individually_attributable_trade_bwar),
      package_first_hop_participation_bwar: v(d.package_first_hop_participation_bwar),
      package_downstream_participation_bwar: v(d.package_downstream_participation_bwar),
      observable_not_attributable_bwar: v(d.observable_not_attributable_bwar),
    }))
    .sort(orderBy([(r) => ATTRIBUTION_RANK[r.attribution_state] ?? 9, 'asc'], [(r) => r.signing_year, 'asc'], [(r) => r.player_slug, 'asc'], [(r) => r.signing_id, 'asc']))
}

/** Counts of every attribution state over all signings (the denominator is stated by the caller: every tracked signing). */
export function attributionStateCounts(decisions) {
  const counts = {}
  for (const d of decisions) { const s = attributionState(d); counts[s] = (counts[s] ?? 0) + 1 }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)))
}

const PACKAGE_INCOMPLETE_ISSUES = new Set(['TRADE_RETURN_UNRECORDED', 'PTBNL_UNRESOLVED', 'FUTURE_CONSIDERATIONS_UNRESOLVED', 'CASH_AMOUNT_UNKNOWN', 'POOL_SPACE_AMOUNT_UNKNOWN'])

/**
 * Trade-package completeness, counted per distinct trade (event_key), from the transaction and value queues.
 * A package is complete only when the queues raise none of its open issues; one that names a single side is incomplete.
 */
export function packageCompleteness({ transactionQueue = [], valueQueue = [] }) {
  const incomplete = new Map()
  for (const r of transactionQueue) {
    if (r.event_key && PACKAGE_INCOMPLETE_ISSUES.has(r.issue)) { if (!incomplete.has(r.event_key)) incomplete.set(r.event_key, new Set()); incomplete.get(r.event_key).add(r.issue) }
  }
  const byIssue = {}
  for (const issues of incomplete.values()) for (const i of issues) byIssue[i] = (byIssue[i] ?? 0) + 1
  return {
    packages_with_open_issues: incomplete.size,
    packages_with_open_issues_by_issue: Object.fromEntries(Object.entries(byIssue).sort(([a], [b]) => (a < b ? -1 : 1))),
    // the value queue names the signing, not the trade, so this is counted per signing
    unresolved_attribution_signings: new Set(valueQueue.filter((r) => r.issue === 'TRADE_PACKAGE_ATTRIBUTION_UNRESOLVED').map((r) => r.player_slug)).size,
  }
}

/**
 * 049: the split a package count hides. A package whose MEMBERSHIP is open (a return, a player to be named, future considerations) is a different problem
 * from one whose players are all known and only a TERMS amount (cash, pool space) is unknown. A package can be in both, so the counts are not added.
 * @param {{ transactionQueue?: any[] }} data
 */
export function packageBlockerSplit({ transactionQueue = [] }) {
  const packages = openPackages({ transactionQueue })
  const hasTerms = (p) => p.issues.split(' ').some((i) => ISSUE_BUCKET[i] === 'TERMS')
  return {
    packages_with_open_issues: packages.length,
    packages_with_open_membership: packages.filter((p) => p.package_state === 'MEMBERSHIP_OPEN').length,
    packages_with_open_terms: packages.filter(hasTerms).length,
    packages_with_only_open_terms: packages.filter((p) => p.package_state === 'TERMS_OPEN').length,
  }
}

/**
 * One row per trade package that has an open package issue, with what is open and what would close it. Deterministic.
 * @param {{ transactionQueue?: any[] }} data
 * @param {{ membership?: boolean, terms?: boolean, issue?: string[] }} [f]
 */
export function openPackages({ transactionQueue = [] }, f = {}) {
  const by = new Map()
  for (const r of transactionQueue) {
    if (!r.event_key || !PACKAGE_INCOMPLETE_ISSUES.has(r.issue)) continue
    const cur = by.get(r.event_key) ?? { event_key: r.event_key, issues: new Set(), assets: new Set(), priority: Number(r.priority) }
    cur.issues.add(r.issue)
    if (r.asset_name) cur.assets.add(r.asset_name)
    cur.priority = Math.min(cur.priority, Number(r.priority))
    by.set(r.event_key, cur)
  }
  let rows = [...by.values()].map((p) => {
    const issues = [...p.issues].sort((a, b) => ISSUE_RANK[a] - ISSUE_RANK[b])
    const membership = issues.some((i) => ISSUE_BUCKET[i] === 'CHAIN_OR_MEMBERSHIP')
    return {
      event_key: p.event_key, priority: p.priority, package_state: membership ? 'MEMBERSHIP_OPEN' : 'TERMS_OPEN',
      issues: issues.join(' '), open_assets: [...p.assets].sort().join('; '), next_evidence: issues.map((i) => NEXT_EVIDENCE[i]).join(' '),
    }
  })
  if (f.membership) rows = rows.filter((r) => r.package_state === 'MEMBERSHIP_OPEN')
  if (f.terms) rows = rows.filter((r) => r.issues.split(' ').some((i) => ISSUE_BUCKET[i] === 'TERMS'))
  if (f.issue) rows = rows.filter((r) => r.issues.split(' ').some((i) => f.issue.includes(i)))
  return rows.sort(orderBy([(r) => r.package_state === 'MEMBERSHIP_OPEN' ? 0 : 1, 'asc'], [(r) => r.priority, 'asc'], [(r) => r.event_key, 'asc']))
}
