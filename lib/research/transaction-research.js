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
  INCOMPLETE_EXIT_NOT_RESEARCHED: 'RESEARCH_EXIT_TRANSACTION',
  INCOMPLETE_EXIT_UNRECORDED: 'RECORD_EXIT_TRANSACTION',
  INCOMPLETE_PENDING_CONSIDERATION: 'RESOLVE_PENDING_CONSIDERATION',
  INCOMPLETE_RETURN_UNRECORDED: 'RECORD_TRADE_RETURN',
})

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

/**
 * One merged, deterministically ordered list of transaction / value research items.
 * @param {{ transactionQueue: any[], valueQueue: any[] }} data
 * @param {{ missing?: boolean, unresolvedAttribution?: boolean, traded?: boolean, limit?: number }} [f]
 */
export function transactionResearchItems({ transactionQueue, valueQueue }, f = {}) {
  const items = [
    ...transactionQueue.map((r) => ({ queue: 'TRANSACTION', ...r })),
    ...valueQueue.map((r) => ({ queue: 'VALUE', ...r })),
  ].map((r) => ({
    queue: r.queue,
    issue: r.issue,
    category: ISSUE_CATEGORY[r.issue] ?? 'OTHER',
    priority: Number(r.priority),
    rank: ISSUE_RANK[r.issue] ?? 99,
    player_slug: r.player_slug ?? null,
    event_key: r.event_key ?? null,
    asset_name: r.asset_name ?? null,
    detail: r.detail ?? null,
  }))
  let rows = items
  if (f.unresolvedAttribution) rows = rows.filter((r) => r.category === 'UNRESOLVED_ATTRIBUTION' || r.category === 'MISSING_RETURN_ATTRIBUTION')
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
    incomplete_chains: decisions.filter((d) => String(d.chain_status).startsWith('INCOMPLETE')).length,
    individually_attributable_trade_value: nonzero('individually_attributable_trade_bwar'),
    package_first_hop_value: nonzero('package_first_hop_participation_bwar'),
    package_downstream_value: nonzero('package_downstream_participation_bwar'),
    observable_not_attributable_value: nonzero('observable_not_attributable_bwar'),
    value_left_organization: nonzero('value_left_organization_bwar'),
  }
}

/** Players whose chain is incomplete, with the work item that completes it. */
export function incompleteChains(decisions) {
  return decisions
    .filter((d) => CHAIN_WORK[d.chain_status])
    .map((d) => ({ player_slug: d.player_slug, full_name: d.full_name, signing_year: d.signing_year, chain_status: d.chain_status, work: CHAIN_WORK[d.chain_status] }))
    .sort(orderBy([(r) => r.chain_status, 'asc'], [(r) => r.signing_year, 'asc'], [(r) => r.player_slug, 'asc']))
}
