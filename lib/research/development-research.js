// Development-history research workflow (047). Pure functions over the read-only dataset.
//
// UNKNOWN DEVELOPMENT HISTORY != NO DEVELOPMENT. A missing season, level or date is reported as missing, never as "did not develop".
// Completeness is a set of INDEPENDENT dimensions (a player can have a complete outcome audit and an incomplete development
// history, or complete development timing and an incomplete transaction history); there is no single "complete" flag for every purpose.

import { orderBy } from './cmp.js'

/** The development dimensions, in the order they are reported. */
export const DIMENSIONS = Object.freeze(['SIGNING_DATE', 'FIRST_PRO_SEASON', 'HIGHEST_LEVEL', 'MLB_DEBUT', 'EXIT', 'CHRONOLOGY'])

/** Missing-field codes. Existing queue names are reused where DISI already raises the same concern. */
export const MISSING_CODE = Object.freeze({
  SIGNING_DATE: 'SIGNING_DATE_MISSING',
  FIRST_PRO_SEASON: 'FIRST_PRO_SEASON_UNKNOWN',
  HIGHEST_LEVEL: 'HIGHEST_LEVEL_UNKNOWN',
  MLB_DEBUT: 'MLB_DEBUT_UNKNOWN',
  EXIT: 'EXIT_TRANSACTION_MISSING',
  CHRONOLOGY: 'CHRONOLOGY_INCOMPLETE',
})

/** Tiers (lower is researched first). Documented in docs/RESEARCH-METHODOLOGY.md. */
export const DEVELOPMENT_TIERS = Object.freeze({
  1: 'VERIFIED_MLB_MISSING_TIMING',
  2: 'MATURE_AUDITED_MISSING_HIGHEST_LEVEL',
  3: 'DODGERS_WAR_INCOMPLETE_CHRONOLOGY',
  4: 'TRADED_INCOMPLETE_PRE_TRADE_HISTORY',
  5: 'AUDITED_NO_MLB_INCOMPLETE',
  6: 'NOT_AUDITED_INCOMPLETE',
  7: 'REMAINING',
})

/** development-queue issues (v_dodgers_development_research_queue) that mean the affiliate chronology cannot support timing analysis. */
export const CHRONOLOGY_ISSUES = Object.freeze(new Set([
  'IDENTITY_BUT_NO_PROFESSIONAL_SEASONS', 'SEASON_GAP', 'MULTI_ORG_SEASON_UNVERIFIED', 'UNKNOWN_LEVEL_CLASSIFICATION',
  'MISSING_FIRST_GAME_DATE', 'MISSING_LAST_GAME_DATE', 'MLB_PLAYER_MISSING_PRE_MLB_HISTORY', 'MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES',
  'UNRESOLVED_ORGANIZATION', 'SEASON_ONLY_MILESTONE', 'LEVEL_SKIP_CAMEO_CANDIDATE', 'NON_MONOTONIC_PROGRESSION', 'UNKNOWN_LEVEL_GAME_LOG',
]))

/**
 * The signing's OWN exit. The authoritative state is the exit summary's control_state (STILL_DODGERS_CONTROLLED: no exit to know;
 * LEFT_DODGERS_CONTROL: an exit event is recorded; NO_EXIT_EVIDENCE / HISTORY_UNAVAILABLE: the exit is not established). When it is not
 * supplied, the transaction queue's EXIT_TRANSACTION_MISSING / EXIT_STATUS_UNVERIFIED issues mark an open exit.
 * The INCOMPLETE_* chain statuses are deliberately not used: they describe the exits and returns of players the Dodgers RECEIVED in a
 * trade (downstream hops), and STILL_ACTIVE means a returned asset is still under Dodgers control, not that this player is.
 */
const EXIT_OPEN_ISSUES = new Set(['EXIT_TRANSACTION_MISSING', 'EXIT_STATUS_UNVERIFIED'])
const EXIT_STATE = Object.freeze({ STILL_DODGERS_CONTROLLED: 'NOT_APPLICABLE', LEFT_DODGERS_CONTROL: 'KNOWN', NO_EXIT_EVIDENCE: 'UNKNOWN', HISTORY_UNAVAILABLE: 'UNKNOWN' })

const has = (v) => v !== null && v !== undefined && v !== ''
const num = (v) => (has(v) ? Number(v) : null)

/** The earliest record may start later than the real first professional season (the API has no DSL/complex rows for many players). */
export const FIRST_RECORD_MAX_GAP_SEASONS = 1

/**
 * The first professional season is KNOWN only when the earliest recorded season is the signing season or the one after it. A record that
 * starts two or more seasons after signing is the first OBSERVED record, not evidence of the first professional season: the earlier
 * seasons are missing, and missing is never read as "did not play".
 */
export function firstProSeasonKnown(signing, summary) {
  const season = [summary?.professional_debut_season, summary?.first_dsl_season, summary?.first_complex_season, summary?.first_a_season].find((v) => has(v))
  if (!has(season)) return false
  const year = num(signing?.signing_year)
  return year === null || Number(season) - year <= FIRST_RECORD_MAX_GAP_SEASONS
}

/**
 * Per-dimension state: KNOWN, UNKNOWN, or NOT_APPLICABLE. Nothing is ever "NONE": absence of evidence is UNKNOWN.
 * @param {{ signing: any, summary?: any, decision?: any, issues?: string[], txIssues?: string[], exitRow?: any }} p
 */
export function developmentDimensions({ signing, summary = null, decision = null, issues = [], txIssues = [], exitRow = null }) {
  const s = summary ?? {}
  const signingDate = signing?.signing_date ?? s.signing_date
  const mlb = signing?.reached_mlb_verified === true
  const firstPro = firstProSeasonKnown(signing, s)
  const exitState = exitRow ? (EXIT_STATE[exitRow.control_state] ?? 'UNKNOWN') : txIssues.some((i) => EXIT_OPEN_ISSUES.has(i)) ? 'UNKNOWN' : 'KNOWN'
  return {
    SIGNING_DATE: has(signingDate) ? 'KNOWN' : 'UNKNOWN',
    FIRST_PRO_SEASON: firstPro ? 'KNOWN' : 'UNKNOWN',
    // a verified MLB debut is the highest level there is: derived from the audited outcome, not guessed from stints
    HIGHEST_LEVEL: mlb || has(s.highest_affiliated_level) ? 'KNOWN' : 'UNKNOWN',
    // only a verified MLB player has an MLB debut to know; for everyone else the dimension does not apply
    MLB_DEBUT: !mlb ? 'NOT_APPLICABLE' : has(signing?.mlb_debut_date ?? s.mlb_debut_date) ? 'KNOWN' : 'UNKNOWN',
    // a player still controlled by the organization has no exit to know
    EXIT: exitState,
    // affiliate chronology supports timing analysis only with stints on record and no open chronology issue
    CHRONOLOGY: summary === null || (!mlb && !has(s.highest_affiliated_level)) || issues.some((i) => CHRONOLOGY_ISSUES.has(i)) ? 'UNKNOWN' : 'KNOWN',
  }
}

/** Overall description of a dimension map. Never "no development": NONE_KNOWN means no applicable dimension is known. */
export function developmentState(dims) {
  const applicable = Object.values(dims).filter((v) => v !== 'NOT_APPLICABLE')
  const known = applicable.filter((v) => v === 'KNOWN').length
  if (applicable.length > 0 && known === applicable.length) return 'COMPLETE'
  return known === 0 ? 'NONE_KNOWN' : 'PARTIAL'
}

/** Which tier a player with at least one UNKNOWN dimension belongs to. */
export function developmentTier({ signing, decision, dims }) {
  const unknown = (k) => dims[k] === 'UNKNOWN'
  const outcome = signing?.outcome_audit_status ?? decision?.outcome_audit_status
  const audited = outcome === 'VERIFIED_MLB' || outcome === 'VERIFIED_NO_MLB'
  const mlb = signing?.reached_mlb_verified === true
  // any chain other than NO_TRADE_CHAIN means the signing left in a trade (STILL_ACTIVE: a returned asset is still held)
  const traded = Boolean(decision?.chain_status) && decision.chain_status !== 'NO_TRADE_CHAIN'
  const dodgersWar = num(decision?.direct_dodgers_bwar)
  const anyUnknown = Object.values(dims).includes('UNKNOWN')
  if (mlb && (unknown('SIGNING_DATE') || unknown('MLB_DEBUT') || unknown('FIRST_PRO_SEASON'))) return 1
  if (audited && decision?.maturity_status === 'MATURE' && unknown('HIGHEST_LEVEL')) return 2
  if (dodgersWar !== null && dodgersWar > 0 && anyUnknown) return 3
  if (traded && (unknown('FIRST_PRO_SEASON') || unknown('HIGHEST_LEVEL') || unknown('CHRONOLOGY') || unknown('SIGNING_DATE'))) return 4
  if (outcome === 'VERIFIED_NO_MLB' && anyUnknown) return 5
  if (!audited && anyUnknown) return 6
  return 7
}

/**
 * The deterministic development-research queue. Same dataset => same order. A player with no UNKNOWN dimension is not queued.
 * Order: tier, higher Dodgers bWAR first (NULL last), older class first, signing date, sort name, signing id.
 * @param {{ signings: any[], decisions?: any[], developmentSummary?: any[], developmentQueue?: any[], transactionQueue?: any[], sourceCounts?: Record<string, number>, directory?: any[] }} data
 * @param {{ missing?: boolean, mature?: boolean, mlb?: boolean, year?: number, market?: string, player?: string, limit?: number }} [opts]
 */
export function developmentQueue(data, opts = {}) {
  let rows = developmentRecords(data).filter((r) => r.missing.length > 0)
  if (opts.missing) rows = rows.filter((r) => r.missing.length > 0)
  if (opts.mature === true) rows = rows.filter((r) => r.maturity === 'MATURE')
  if (opts.mlb === true) rows = rows.filter((r) => r.reached_mlb_verified)
  if (opts.mlb === false) rows = rows.filter((r) => !r.reached_mlb_verified)
  if (opts.year != null) rows = rows.filter((r) => r.signing_year === opts.year)
  if (opts.market) rows = rows.filter((r) => (r.country_market ?? '').toLowerCase() === opts.market.toLowerCase())
  if (opts.player) rows = rows.filter((r) => r.player_slug === opts.player)
  rows.sort(orderBy(
    [(r) => r.tier, 'asc'], [(r) => r.dodgers_bwar, 'desc'], [(r) => r.signing_year, 'asc'], [(r) => r.signing_date, 'asc'], [(r) => r.sort_name, 'asc'], [(r) => r.signing_id, 'asc'],
  ))
  rows.forEach((r, i) => { r.rank = i + 1 })
  return opts.limit != null ? rows.slice(0, opts.limit) : rows
}

/** Every signing with its dimensions, tier and missing fields (complete players included, tier only meaningful when something is missing). */
export function developmentRecords(data) {
  const summaries = new Map((data.developmentSummary ?? []).map((r) => [r.player_id, r]))
  const decisions = new Map((data.decisions ?? []).map((d) => [d.signing_id, d]))
  const issues = new Map()
  for (const q of data.developmentQueue ?? []) { if (!issues.has(q.player_id)) issues.set(q.player_id, []); issues.get(q.player_id).push(q.issue) }
  const txIssues = new Map()
  for (const q of data.transactionQueue ?? []) { if (!txIssues.has(q.player_slug)) txIssues.set(q.player_slug, []); txIssues.get(q.player_slug).push(q.issue) }
  const exits = new Map((data.exitSummary ?? []).map((r) => [r.signing_id, r]))
  const sources = data.sourceCounts ?? {}
  return (data.signings ?? []).map((signing) => {
    const summary = summaries.get(signing.player_id) ?? null
    const decision = decisions.get(signing.signing_id) ?? null
    const dims = developmentDimensions({ signing, summary, decision, issues: issues.get(signing.player_id) ?? [], txIssues: txIssues.get(signing.player_slug) ?? [], exitRow: exits.get(signing.signing_id) ?? null })
    return {
      signing_id: signing.signing_id,
      player_id: signing.player_id,
      player_slug: signing.player_slug,
      full_name: signing.full_name,
      sort_name: signing.player_sort_name ?? signing.full_name,
      signing_year: signing.signing_year,
      signing_date: signing.signing_date ?? null,
      country_market: signing.country_market ?? null,
      maturity: decision?.maturity_status ?? null,
      outcome: signing.outcome_audit_status ?? null,
      reached_mlb_verified: signing.reached_mlb_verified === true,
      highest_level: summary?.highest_affiliated_level ?? (signing.reached_mlb_verified === true ? 'MLB' : null),
      mlb_debut_date: signing.mlb_debut_date ?? summary?.mlb_debut_date ?? null,
      exit: dims.EXIT,
      dodgers_bwar: num(decision?.direct_dodgers_bwar),
      development_state: developmentState(dims),
      dims,
      missing: DIMENSIONS.filter((k) => dims[k] === 'UNKNOWN').map((k) => MISSING_CODE[k]),
      source_count: sources[signing.player_id] ?? 0,
      tier: developmentTier({ signing, decision, dims }),
    }
  })
}

/**
 * Coverage per dimension with its denominator (applicable players only). `dimensions` restricts the report (the website cannot see the
 * transaction queue, so it does not report the EXIT dimension).
 */
export function developmentCoverage(data, { dimensions = DIMENSIONS } = {}) {
  const all = developmentRecords(data)
  /** @type {Record<string, { known: number, applicable: number }>} */
  const out = {}
  for (const k of dimensions) {
    const applicable = all.filter((r) => r.dims[k] !== 'NOT_APPLICABLE')
    out[k] = { known: applicable.filter((r) => r.dims[k] === 'KNOWN').length, applicable: applicable.length }
  }
  const states = {}
  for (const r of all) states[r.development_state] = (states[r.development_state] ?? 0) + 1
  return { signings: all.length, dimensions: out, states: Object.fromEntries(Object.entries(states).sort(([a], [b]) => (a < b ? -1 : 1))) }
}

const LEVEL_ORDER = ['INTERNATIONAL_ROOKIE', 'COMPLEX_ROOKIE', 'LOW_A', 'HIGH_A', 'AA', 'AAA', 'MLB']

/**
 * Descriptive facts only (no rates, no scores, no cross-cohort comparison). Every figure states its denominator.
 *  - signing-to-MLB: verified MLB players with exact signing and debut dates
 *  - highest level: AUDITED NO-MLB players only (a NOT_AUDITED player is never counted as a negative outcome)
 */
export function timingFacts(data) {
  const summaries = new Map((data.developmentSummary ?? []).map((r) => [r.player_id, r]))
  const mlb = (data.signings ?? []).filter((s) => s.reached_mlb_verified === true)
  const withInterval = mlb.map((s) => ({ s, sm: summaries.get(s.player_id) })).filter(({ sm }) => num(sm?.days_signing_to_mlb_exact) !== null)
  const years = withInterval.map(({ sm }) => Number(sm.years_signing_to_mlb_exact)).filter(Number.isFinite).sort((a, b) => a - b)
  const median = years.length === 0 ? null : years.length % 2 ? years[(years.length - 1) / 2] : (years[years.length / 2 - 1] + years[years.length / 2]) / 2
  const auditedNoMlb = (data.signings ?? []).filter((s) => s.outcome_audit_status === 'VERIFIED_NO_MLB')
  const levels = {}
  let known = 0
  for (const s of auditedNoMlb) {
    const lv = summaries.get(s.player_id)?.highest_affiliated_level
    if (has(lv)) { known += 1; levels[lv] = (levels[lv] ?? 0) + 1 }
  }
  return {
    verified_mlb_players: mlb.length,
    signing_to_mlb_exact: { n: years.length, of: mlb.length, min_years: years[0] ?? null, median_years: median, max_years: years.at(-1) ?? null },
    audited_no_mlb_players: auditedNoMlb.length,
    highest_level_known: { n: known, of: auditedNoMlb.length },
    highest_level_counts: Object.fromEntries(LEVEL_ORDER.filter((l) => levels[l]).map((l) => [l, levels[l]])),
    note: 'Descriptive facts with stated denominators. NOT_AUDITED players are not counted as negative outcomes, and nothing here is a rate, a score or a cross-cohort comparison.',
  }
}
