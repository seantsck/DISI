// Server-side data access. Every function returns { live, error, ... } and
// never substitutes hard-coded baseball data: if Supabase is unconfigured or a
// query fails, callers render an explicit unavailable state.

import { getSupabase } from './supabase.js'
import { applyTableQuery } from './table-state.js'
import { SIGNINGS_SPEC, PLAYERS_SPEC } from './specs.js'
import { searchTokens } from './text.js'
import { evidenceBlockers, matureNotAuditedFrom, readinessBlockers } from './research/readiness-blockers.js'

const NOT_CONFIGURED = 'Supabase environment variables are missing.'
const MIGRATION_HINT = 'The research views from database/sql/017_research_database_layer.sql are not present in this Supabase project. Run migration 017 in the Supabase SQL Editor.'

const TIMEOUT_MESSAGE = 'The database did not respond in time. Please try again shortly.'
const GENERIC_MESSAGE = 'Live data could not be loaded.'

/**
 * Public, safe description of a failure: never a raw database message and never "[object Object]".
 * Raw details belong in the server log (logDetail), not in the page.
 * @param {any} error
 * @returns {string}
 */
export function describeError(error) {
  if (!error) return 'Unknown error.'
  if (typeof error === 'string') return error
  const code = typeof error.code === 'string' ? error.code : ''
  const message = typeof error.message === 'string' ? error.message : ''
  const missingRelation = code === 'PGRST205' || code === '42P01'
    || /could not find the table|does not exist/i.test(message)
  if (missingRelation) return MIGRATION_HINT
  if (code === '57014' || /statement timeout/i.test(message)) return TIMEOUT_MESSAGE
  return /^[A-Z0-9]{5,8}$/.test(code) ? `${GENERIC_MESSAGE} (error ${code})` : GENERIC_MESSAGE
}

/**
 * Server-log detail of a failure: the PostgREST / Postgres fields as plain strings (no credentials are part of these).
 * @param {any} error
 */
export function logDetail(error) {
  if (!error || typeof error !== 'object') return { message: String(error) }
  /** @type {Record<string, string>} */
  const out = {}
  for (const k of ['code', 'message', 'details', 'hint', 'name']) if (typeof error[k] === 'string' && error[k]) out[k] = error[k]
  return Object.keys(out).length ? out : { message: 'error object without message' }
}

/** @param {any} error @param {Record<string, any>} empty */
function failure(error, empty) {
  return { live: false, error: describeError(error), ...empty }
}

/** @param {{ data: any, error: any, count?: number | null }} result */
function unwrap(result) {
  if (result.error) throw result.error
  return result.data
}

/**
 * @template T
 * @param {string} label
 * @param {Record<string, any>} empty
 * @param {(supabase: import('@supabase/supabase-js').SupabaseClient) => Promise<T>} run
 * @param {any} [supabase] client override (tests); defaults to the configured client
 * @returns {Promise<T & { live: boolean, error: string | null } | (Record<string, any> & { live: false, error: string })>}
 */
async function withSupabase(label, empty, run, supabase = getSupabase()) {
  if (!supabase) return failure(NOT_CONFIGURED, empty)
  try {
    const result = await run(supabase)
    return { live: true, error: null, ...result }
  } catch (error) {
    console.error(`DISI ${label} fetch failed.`, logDetail(error))
    return failure(error, empty)
  }
}

/**
 * Collapses facet rows into sorted { value, count } options.
 * @param {any[]} rows
 * @param {string} facet
 */
function facetOptions(rows, facet) {
  /** @type {Map<string | null, number>} */
  const counts = new Map()
  for (const r of rows) {
    if (r.facet !== facet) continue
    counts.set(r.value, (counts.get(r.value) || 0) + Number(r.row_count))
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      if (a.value == null) return 1
      if (b.value == null) return -1
      return a.value.localeCompare(b.value, 'en', { numeric: true })
    })
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function getHomeData() {
  return withSupabase('overview', { status: null, snapshot: [], knownMlb: [], rateSummary: null, executive: null }, async (supabase) => {
    const [status, snapshot, knownMlb, rateSummary] = await Promise.all([
      // persisted home-page status (045b): the legacy v_database_status is internal and never evaluated on a request
      supabase.from('product_database_status').select('*').maybeSingle().then(unwrap),
      supabase.from('v_signing_records')
        .select('signing_id,player_slug,full_name,signing_year,signing_date,country_market,primary_position,pathway,total_known_acquisition_cost_usd,outcome_audit_status,career_bwar')
        .eq('is_dodgers_franchise', true)
        .order('signing_year', { ascending: false })
        .order('player_sort_name', { ascending: true })
        .limit(12)
        .then(unwrap),
      supabase.from('v_dodgers_known_mlb_outcomes')
        .select('player_id,player_slug,full_name,signing_year,country_market,mlb_debut_org,direct_dodgers_franchise_debut,career_bwar,bwar_observed_through_season,current_status')
        .not('career_bwar', 'is', null)
        .order('career_bwar', { ascending: false })
        .limit(8)
        .then(unwrap),
      supabase.from('v_dodgers_rate_eligible_summary').select('*').maybeSingle().then(unwrap),
    ])
    // Executive snapshot (045a): one persisted row - the 044 executive overview, the 045 release status and the snapshot's freshness -
    // read after the batch. Tolerant on purpose: a database without the snapshot layer simply has no executive summary.
    const executive = await supabase.from('product_executive_snapshot').select('*').maybeSingle()
      .then((/** @type {any} */ result) => (result.error ? null : result.data))
    return { status, snapshot, knownMlb, rateSummary, executive }
  })
}

// ---------------------------------------------------------------------------
// Signings research table
// ---------------------------------------------------------------------------

/** @param {import('./table-state.js').TableState} state */
export async function getSigningsTable(state) {
  return withSupabase('signings', { rows: [], total: 0, outOfRange: false, facets: [] }, async (supabase) => {
    const dodgersOnly = state.filters.org_scope !== 'all'
    let facetQuery = supabase.from('v_signing_filter_options').select('facet,value,row_count,is_dodgers_franchise')
    if (dodgersOnly) facetQuery = facetQuery.eq('is_dodgers_franchise', true)

    const rowQuery = applyTableQuery(supabase.from('v_signing_records').select('*', { count: 'exact' }), SIGNINGS_SPEC, state)
    const [rowsResult, facetRows] = await Promise.all([rowQuery, facetQuery.then(unwrap)])
    // PGRST103: requested page is beyond the last row.
    if (rowsResult.error && rowsResult.error.code !== 'PGRST103') throw rowsResult.error
    return {
      rows: rowsResult.data || [],
      total: rowsResult.count ?? 0,
      outOfRange: rowsResult.error?.code === 'PGRST103',
      facets: {
        market: facetOptions(facetRows, 'country_market'),
        position: facetOptions(facetRows, 'primary_position'),
        pathway: facetOptions(facetRows, 'pathway'),
        record_scope: facetOptions(facetRows, 'record_scope'),
        coverage: facetOptions(facetRows, 'coverage_type'),
        org: facetOptions(facetRows, 'organization'),
        year: facetOptions(facetRows, 'signing_year'),
      },
    }
  })
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** @param {import('./table-state.js').TableState} state */
export async function getPlayerDirectory(state) {
  return withSupabase('player directory', { rows: [], total: 0, outOfRange: false, facets: {} }, async (supabase) => {
    // Facet counts follow the scope: Dodgers signees by default, everyone only on request.
    const dodgersOnly = state.filters.org_scope !== 'all'
    let facetQuery = supabase.from('v_player_filter_options').select('facet,value,row_count,has_dodgers_signing')
    if (dodgersOnly) facetQuery = facetQuery.eq('has_dodgers_signing', true)
    const rowQuery = applyTableQuery(supabase.from('v_player_directory').select('*', { count: 'exact' }), PLAYERS_SPEC, state)
    const [rowsResult, facetRows] = await Promise.all([rowQuery, facetQuery.then(unwrap)])
    if (rowsResult.error && rowsResult.error.code !== 'PGRST103') throw rowsResult.error
    return {
      rows: rowsResult.data || [],
      total: rowsResult.count ?? 0,
      outOfRange: rowsResult.error?.code === 'PGRST103',
      facets: {
        market: facetOptions(facetRows, 'signing_market'),
        birthCountry: facetOptions(facetRows, 'birth_country'),
        bats: facetOptions(facetRows, 'bats'),
        throws: facetOptions(facetRows, 'throws'),
        ageBand: facetOptions(facetRows, 'signing_age_band'),
        position: facetOptions(facetRows, 'primary_position'),
        decade: facetOptions(facetRows, 'first_signing_decade'),
        letter: facetOptions(facetRows, 'name_initial'),
      },
    }
  })
}

/**
 * Header search. Matches names and aliases (accent-insensitive).
 * @param {string} query
 */
export async function searchPlayers(query, limit = 8) {
  const tokens = searchTokens(query)
  if (!tokens.length) return { live: true, error: null, results: [] }
  return withSupabase('player search', { results: [] }, async (supabase) => {
    let q = supabase.from('v_player_directory')
      .select('player_slug,full_name,aliases,first_signing_year,primary_position,first_signing_market,organizations,has_dodgers_signing')
    for (const token of tokens) q = q.ilike('search_text', `%${token}%`)
    const results = await q
      .order('has_dodgers_signing', { ascending: false })
      .order('player_sort_name', { ascending: true })
      .limit(limit)
      .then(unwrap)
    return { results }
  })
}

const EMPTY_DECISION = { realizedValue: [], readiness: [], expectedValue: [], comparables: [], decisionAvailable: false, freshness: null }

/** The snapshot generation columns every product page shows (one bounded row). */
const FRESHNESS_COLUMNS = 'generation_id,generated_at,snapshot_as_of_date,source_data_as_of_date,product_version,schema_version,support_chain_state'

/**
 * The player-decision snapshot joins realized value (042) and decision support (043) per Dodgers signing; this splits a row back into the
 * readiness shape the dossier renders (the readiness cost columns carry a prefix in the snapshot because realized value has its own).
 * @param {any} row
 */
export function readinessFromPlayerDecision(row) {
  return {
    signing_id: row.signing_id, decision_as_of_date: row.decision_as_of_date, decision_support_state: row.decision_support_state,
    optimization_eligible: row.optimization_eligible, decision_blockers: row.decision_blockers, decision_statement: row.decision_statement,
    expected_value_model_supported: row.expected_value_model_supported, historical_comparables: row.historical_comparables,
    cost_complete: row.readiness_cost_complete, cost_coverage_state: row.readiness_cost_coverage_state, player_data_complete: row.player_data_complete,
  }
}

/**
 * A player's organizational value, decision-support state, expected-value state and comparable-history summary, one query at a time.
 * @param {any} supabase
 * @param {string} playerId
 */
export async function loadDossierDecision(supabase, playerId) {
  /** @param {any} result */
  const rowsOf = (result) => (result.error ? null : result.data ?? [])
  // persisted snapshots (045a): bounded per-player rows; the dossier never evaluates the 042 / 043 analytical layer
  const decisionRows = await supabase.from('product_player_decision').select('*').eq('player_id', playerId)
    .order('signing_year', { ascending: true }).then(rowsOf)
  if (decisionRows === null) return { ...EMPTY_DECISION }
  // only Dodgers signings carry organizational value and decision support
  if (decisionRows.length === 0) return { ...EMPTY_DECISION, decisionAvailable: true }
  const realizedValue = decisionRows
  const readiness = decisionRows.filter((/** @type {any} */ r) => r.decision_support_state != null).map(readinessFromPlayerDecision)
  const expectedValue = await supabase.from('product_player_expected_value')
    .select('signing_id,value_model_key,decision_as_of_date,expected_value_supported,expected_org_value_bwar,expected_value_state,expected_value_exclusion_reason,provenance')
    .eq('player_id', playerId).then(rowsOf)
  const comparables = await supabase.from('product_player_comparables').select('*').in('target_signing_id', decisionRows.map((/** @type {any} */ r) => r.signing_id))
    .order('comparable_population_class', { ascending: true }).then(rowsOf)
  const freshness = await supabase.from('product_executive_snapshot').select(FRESHNESS_COLUMNS).maybeSingle()
    .then((/** @type {any} */ result) => (result.error ? null : result.data))
  return { realizedValue, readiness, expectedValue: expectedValue ?? [], comparables: comparables ?? [], decisionAvailable: expectedValue !== null, freshness }
}

/** @param {string} slug */
export async function getPlayerDossier(slug) {
  const empty = { player: null, signings: [], timeline: [], transactions: [], sources: [], network: [], networkAvailable: false, metrics: [], memberships: [], devStints: [], devMilestones: [], devSummary: null, scouting: [], scoutingAvailable: false, ...EMPTY_DECISION }
  return withSupabase('player dossier', empty, async (supabase) => {
    const player = await supabase.from('v_player_dossier').select('*').eq('player_slug', slug).maybeSingle().then(unwrap)
    if (!player) return { ...empty }
    const id = player.player_id
    const [signingRows, ages, timeline, transactions, sources, networkResult, metrics, memberships, devStints, devMilestones, devSummary, scoutingResult] = await Promise.all([
      supabase.from('v_signing_records').select('*').eq('player_id', id)
        .order('signing_year', { ascending: true }).order('signing_date', { ascending: true, nullsFirst: false }).then(unwrap),
      supabase.from('v_signing_ages').select('*').eq('player_id', id).then(unwrap),
      supabase.from('v_player_timeline').select('*').eq('player_id', id)
        .order('event_year', { ascending: true, nullsFirst: false })
        .order('event_date', { ascending: true, nullsFirst: false })
        .order('event_order', { ascending: true }).then(unwrap),
      supabase.from('v_player_transactions').select('*').eq('player_id', id)
        .order('transaction_date', { ascending: true, nullsFirst: false }).then(unwrap),
      supabase.from('v_player_sources').select('*').eq('player_id', id)
        .order('tier_priority', { ascending: true, nullsFirst: false }).order('fact', { ascending: true }).then(unwrap),
      // Amateur development & signing network (029): source-stated associations only. Tolerant on purpose: a
      // database that has not applied 029 yet simply reports the network as unavailable.
      supabase.from('v_player_signing_network').select('*').eq('player_id', id)
        .order('relationship_type', { ascending: true }).order('entity_name', { ascending: true })
        .then((result) => ({ rows: result.error ? [] : result.data, available: !result.error })),
      supabase.from('player_metric_observations')
        .select('metric_key,value,observed_through_date,observed_through_season,confidence,sources(title,url)')
        .eq('player_id', id)
        .order('metric_key', { ascending: true })
        .order('observed_through_date', { ascending: false }).then(unwrap),
      supabase.from('v_signing_population_memberships').select('*').eq('player_id', id)
        .order('population_key', { ascending: true }).then(unwrap),
      // Development history (021): one row per player/team/league/level/season.
      supabase.from('v_player_development_stints').select('*').eq('player_id', id)
        .order('season', { ascending: true })
        .order('level_rank', { ascending: true, nullsFirst: false })
        .order('league_name', { ascending: true, nullsFirst: false }).then(unwrap),
      supabase.from('v_player_development_milestones').select('*').eq('player_id', id)
        .order('season_year', { ascending: true, nullsFirst: false })
        .order('milestone_date', { ascending: true, nullsFirst: false }).then(unwrap),
      supabase.from('v_dodgers_player_development_summary').select('*').eq('player_id', id).maybeSingle().then(unwrap),
      // External scouting evaluations (026): opinions at a point in time, never merged with development or outcomes.
      // Tolerant on purpose: a database that has not applied 026 yet simply reports the history as unavailable.
      supabase.from('v_player_scouting_timeline').select('*').eq('player_id', id)
        .order('sort_key', { ascending: true }).order('publication_name', { ascending: true })
        .then((result) => ({ rows: result.error ? [] : result.data, available: !result.error })),
    ])
    // Derived ages (v_signing_ages) travel with each signing; each names the date it uses.
    const agesById = new Map(ages.map((a) => [a.signing_id, a]))
    const signings = signingRows.map((s) => ({ ...s, ages: agesById.get(s.signing_id) ?? null }))
    // Organizational value (042), decision support (043) and comparable history (040): persisted product snapshots (045a), read one
    // at a time after the batch. Tolerant: an error reports the section unavailable.
    const decision = await loadDossierDecision(supabase, id)
    return {
      player, signings, timeline, transactions, sources, network: networkResult.rows, networkAvailable: networkResult.available, metrics, memberships, devStints, devMilestones, devSummary,
      scouting: scoutingResult.rows, scoutingAvailable: scoutingResult.available, ...decision,
    }
  })
}

// ---------------------------------------------------------------------------
// Analytical pages
// ---------------------------------------------------------------------------

export async function getMarketsData() {
  return withSupabase('markets', { markets: [], pathways: [] }, async (supabase) => {
    const [markets, pathways] = await Promise.all([
      supabase.from('v_market_research_summary').select('*').eq('franchise_key', 'DODGERS')
        .order('tracked_signings', { ascending: false }).order('country_market', { ascending: true, nullsFirst: false }).then(unwrap),
      supabase.from('v_pathway_research_summary').select('*').eq('franchise_key', 'DODGERS')
        .order('tracked_signings', { ascending: false }).order('pathway', { ascending: true }).then(unwrap),
    ])
    return { markets, pathways }
  })
}

/**
 * Reads every row of a bounded query in pages of 1,000 (the Data API's per-request cap). A failed page makes the whole read return [] (a
 * partial page set would look like a complete one), and the caller treats [] as "not available", never as "no rows".
 * @param {(from: number, to: number) => PromiseLike<any>} page
 */
async function readAllPages(page) {
  const out = []
  for (let from = 0; from < 20000; from += 1000) {
    const result = await page(from, from + 999)
    if (result.error) return []
    const rows = result.data ?? []
    out.push(...rows)
    if (rows.length < 1000) return out
  }
  return []
}

/** @param {any} [supabase] client override (tests) */
export async function getDevelopmentData(supabase) {
  const empty = { coverage: null, byClass: [], byMarket: [], byBonus: [], queue: [], debuts: [], devSignings: [], devSummary: [], mlbStints: [] }
  return withSupabase('development', empty, async (supabase) => {
    const [coverage, byClass, byMarket, byBonus, queue, debuts, devSignings, devSummary] = await Promise.all([
      supabase.from('v_dodgers_development_coverage').select('*').maybeSingle().then(unwrap),
      supabase.from('v_dodgers_development_by_signing_class').select('*')
        .order('signing_year', { ascending: false }).then(unwrap),
      supabase.from('v_dodgers_development_by_market').select('*')
        .order('tracked_players', { ascending: false }).then(unwrap),
      supabase.from('v_dodgers_development_by_bonus_band').select('*').then(unwrap),
      supabase.from('v_dodgers_development_research_queue').select('*')
        .order('priority', { ascending: false })
        .order('player_slug', { ascending: true }).then(unwrap),
      supabase.from('v_signing_records')
        .select('signing_id,player_slug,full_name,signing_year,signing_date,country_market,pathway,signing_bonus_usd,mlb_debut_date,mlb_debut_org,direct_dodgers_franchise_debut,years_signing_to_mlb,career_bwar,bwar_observed_through_season,current_status')
        .eq('is_dodgers_franchise', true)
        .eq('reached_mlb_verified', true)
        .order('years_signing_to_mlb', { ascending: true, nullsFirst: false })
        .order('player_sort_name', { ascending: true })
        .then(unwrap),
      // 047: per-dimension completeness and descriptive timing, from the same two public relations the dossier already reads
      supabase.from('v_signing_records')
        .select('signing_id,player_id,player_slug,full_name,player_sort_name,signing_year,signing_date,country_market,pathway,outcome_audit_status,reached_mlb_verified,mlb_debut_date')
        .eq('is_dodgers_franchise', true)
        .order('signing_id', { ascending: true })
        .then(unwrap),
      supabase.from('v_dodgers_player_development_summary')
        .select('player_id,player_slug,signing_date,professional_debut_season,first_dsl_season,first_complex_season,first_a_season,highest_affiliated_level,mlb_debut_date,days_signing_to_mlb_exact,years_signing_to_mlb_exact,progression_review_pending')
        .order('player_id', { ascending: true })
        .then(unwrap),
    ])
    // 048: the stints of the verified MLB players, to show how much of each path is documented. The same public relation the dossier reads,
    // bounded to the 47 players and read in pages (the API returns at most 1,000 rows per request). Tolerant: a failure leaves the table out.
    const mlbIds = devSignings.filter((/** @type {any} */ s) => s.reached_mlb_verified === true).map((/** @type {any} */ s) => s.player_id)
    const mlbStints = mlbIds.length ? await readAllPages((from, to) =>
      supabase.from('v_player_development_stints')
        .select('player_id,season,level,stint_kind,organization_name,level_classification,affiliated')
        .in('player_id', mlbIds)
        .order('player_id', { ascending: true }).order('stint_id', { ascending: true })
        .range(from, to)) : []
    return { coverage, byClass, byMarket, byBonus, queue, debuts, devSignings, devSummary, mlbStints }
   }, supabase ?? getSupabase())
}

/** @param {any} [supabase] client override (tests) */
export async function getAssetConversionData(supabase) {
  return withSupabase('asset conversion', { packages: [], dispositions: [], bwarBySlug: {}, pathDecisions: [] }, async (supabase) => {
    // 047: where every tracked signing's asset path stands (persisted product snapshot, bounded: one row per Dodgers signing)
    const pathDecisions = await supabase.from('product_player_decision')
      .select('signing_id,player_slug,full_name,signing_year,chain_status,realized_value_state,direct_dodgers_bwar,individually_attributable_trade_bwar,package_first_hop_participation_bwar,package_downstream_participation_bwar,observable_not_attributable_bwar,value_left_organization_bwar')
      .order('signing_id', { ascending: true }).then((/** @type {any} */ r) => (r.error ? [] : r.data ?? []))
    const rows = await supabase.from('v_player_transactions').select('*')
      .eq('from_franchise_key', 'DODGERS')
      .eq('player_side', 'OUTGOING')
      .order('transaction_date', { ascending: true, nullsFirst: false })
      .then(unwrap)
    const slugs = [...new Set(rows.map((/** @type {any} */ r) => r.player_slug))]
    const war = slugs.length
      ? await supabase.from('v_player_directory').select('player_slug,career_bwar,bwar_observed_through_season')
          .in('player_slug', slugs).then(unwrap)
      : []
    /** @type {Record<string, any>} */
    const bwarBySlug = Object.fromEntries(war.map((/** @type {any} */ w) => [w.player_slug, w]))
    return {
      packages: rows.filter((/** @type {any} */ r) => r.record_kind === 'PACKAGE_EVENT'),
      dispositions: rows.filter((/** @type {any} */ r) => r.record_kind === 'TRANSACTION'),
      bwarBySlug,
      pathDecisions,
    }
  }, supabase ?? getSupabase())
}

export async function getLeagueData() {
  return withSupabase('league benchmark', { rows: [], orgs: [], coverage: [], periodOrgs: [], benchmarkReadiness: [] }, async (supabase) => {
    const [rows, orgs, coverage, periodOrgs, benchmarkReadiness] = await Promise.all([
      supabase.from('v_signing_records')
        .select('signing_id,player_slug,full_name,signing_year,organization,country_market,primary_position,signing_bonus_usd,international_rank,pathway,outcome_audited,reached_mlb_verified,population_keys')
        .eq('record_scope', 'MLB_PIPELINE_TOP_PROSPECT')
        .order('signing_year', { ascending: true })
        .order('international_rank', { ascending: true, nullsFirst: false })
        .order('player_sort_name', { ascending: true })
        .then(unwrap),
      supabase.from('v_league_org_benchmark').select('*').order('signing_year').then(unwrap),
      supabase.from('v_signing_data_coverage').select('*').order('period_start_year').then(unwrap),
      supabase.from('v_league_period_org_summary').select('*').order('signed_count', { ascending: false }).then(unwrap),
      // the benchmark's own reference-population rows of the persisted readiness snapshot (fixed-horizon label coverage)
      supabase.from('product_prediction_readiness')
        .select('target_key,target_label,reference_population,labelled_n,positive_n,negative_n,censored_n,unaudited_n,baseline_supported')
        .eq('reference_population', 'TOP_PROSPECT_SAMPLE').order('target_key').then(unwrap),
    ])
    return { rows, orgs, coverage, periodOrgs, benchmarkReadiness }
  })
}

export const RESEARCH_TASK_TYPES = [
  'CLASS_MEMBERS_MISSING',
  'BWAR_MISSING',
  'OUTCOME_AUDIT',
  'CLASS_SIZE_SOURCE_NOT_OFFICIAL',
  'MARKET_MISSING',
  'SIGNING_DATE_MISSING',
  'ACQUISITION_COST_UNKNOWN',
]

export const RESEARCH_TASK_LIMIT = 200

/**
 * Counts and filters research tasks fetched once, in database order: the counts cover every listed task type, the filter keeps
 * the database order and the list is capped. Equivalent to one capped query per filter plus one exact count per type.
 * @param {any[]} rows
 * @param {string | undefined} taskType
 */
export function summarizeResearchTasks(rows, taskType, limit = RESEARCH_TASK_LIMIT) {
  /** @type {Record<string, number>} */
  const taskCounts = Object.fromEntries(RESEARCH_TASK_TYPES.map((type) => [type, 0]))
  for (const row of rows) if (Object.hasOwn(taskCounts, row.task_type)) taskCounts[row.task_type] += 1
  const tasks = (taskType ? rows.filter((row) => row.task_type === taskType) : rows).slice(0, limit)
  return { tasks, taskCounts }
}

/**
 * The research page's queries, run one at a time. Issued together (formerly 15 concurrent requests, seven of them exact counts
 * over v_research_tasks) they saturated the database and hit the 3 s anon statement timeout (57014); each alone takes well under
 * a second. v_research_tasks is evaluated once and counted / filtered in code.
 * @param {any} supabase
 * @param {string | undefined} taskType
 */
export async function loadResearchData(supabase, taskType) {
  const allTasks = await supabase.from('v_research_tasks').select('*').eq('franchise_key', 'DODGERS')
    .order('priority', { ascending: false })
    .order('signing_year', { ascending: true })
    .order('full_name', { ascending: true, nullsFirst: true })
    .then(unwrap)
  const classes = await supabase.from('v_class_research_coverage').select('*').eq('franchise_key', 'DODGERS')
    .order('signing_year', { ascending: false }).then(unwrap)
  const tiers = await supabase.from('source_tiers').select('*').order('priority').then(unwrap)
  const populations = await supabase.from('v_dodgers_signing_population_coverage').select('*')
    .order('signing_year', { ascending: false }).order('population_scope', { ascending: true }).then(unwrap)
  const reconciliation = await supabase.from('v_dodgers_class_source_reconciliation')
    .select('signing_year,player_slug,full_name,classification,announced_date,formal_transaction_date,source_count,unresolved_flag,conflict_types')
    .eq('unresolved_flag', true)
    .order('signing_year', { ascending: false }).order('full_name', { ascending: true }).limit(200).then(unwrap)
  const periodQueue = await supabase.from('v_dodgers_signing_period_research_queue').select('*')
    .order('priority', { ascending: false }).order('signing_year', { ascending: false, nullsFirst: false })
    .order('full_name', { ascending: true, nullsFirst: true }).limit(200).then(unwrap)
  const outcomeProgress = await supabase.from('v_dodgers_outcome_audit_progress').select('*').maybeSingle().then(unwrap)
  const outcomeClasses = await supabase.from('v_dodgers_outcome_by_signing_class').select('*').order('signing_year', { ascending: false }).then(unwrap)
  const { tasks, taskCounts } = summarizeResearchTasks(allTasks ?? [], taskType)
  return { classes, tasks, tiers, populations, reconciliation, periodQueue, outcomeProgress, outcomeClasses, taskCounts }
}

/** @param {string | undefined} taskType @param {any} [supabase] client override (tests) */
export async function getResearchData(taskType, supabase) {
  const empty = { classes: [], tasks: [], taskCounts: {}, tiers: [], populations: [], reconciliation: [], periodQueue: [], outcomeProgress: null, outcomeClasses: [] }
  return withSupabase('research coverage', empty, (client) => loadResearchData(client, taskType), supabase ?? getSupabase())
}

// ---------------------------------------------------------------------------
// Portfolio decision support (043) and prediction readiness (041-044)
// ---------------------------------------------------------------------------

/**
 * The portfolio page's queries: bounded reads of the persisted product snapshots (045a), never the 043 analytical views.
 * @param {any} supabase
 */
export async function loadPortfolioData(supabase) {
  const freshness = await supabase.from('product_executive_snapshot').select(FRESHNESS_COLUMNS).maybeSingle().then(unwrap)
  const decisionSupport = await supabase.from('product_portfolio_decision_support').select('*').order('state_order').then(unwrap)
  const history = await supabase.from('product_portfolio_history')
    .select('grain,grain_value,signings,known_cost_signings,complete_cost_signings,known_spend_usd,cost_coverage,share_of_known_spend,largest_signing_share_of_known_spend,known_spend_concentration_hhi,markets_represented,mature_signings,mature_value_resolved,mature_realized_org_bwar,mature_positive_value_signings,spend_state,outcome_selected_signings_excluded')
    .in('grain', ['ALL', 'SIGNING_YEAR', 'MARKET_GROUP', 'SIGNING_ERA'])
    .order('grain').order('grain_value').then(unwrap)
  const scenarios = await supabase.from('product_portfolio_scenarios')
    .select('scenario_key,scenario_label,signing_year,signing_regime,pool_basis,reported_pool_usd,scenario_budget_usd,candidates,complete_cost_candidates,incomplete_cost_candidates,known_cost_usd,budget_headroom_usd,budget_state,optimization_eligible_candidates,value_optimization_state,optimized_selection,optimized_expected_org_bwar')
    .order('signing_year', { ascending: false }).order('scenario_key').then(unwrap)
  const expectedValueSupport = await supabase.from('product_expected_value_support').select('*').then(unwrap)
  return { freshness, decisionSupport, history, scenarios, expectedValueSupport }
}

/** @param {any} [supabase] client override (tests) */
export async function getPortfolioData(supabase) {
  const empty = { freshness: null, decisionSupport: [], history: [], scenarios: [], expectedValueSupport: [] }
  return withSupabase('portfolio', empty, (client) => loadPortfolioData(client), supabase ?? getSupabase())
}

/**
 * The prediction-readiness page's queries: bounded reads of the persisted product snapshots (045a).
 * @param {any} supabase
 */
export async function loadReadinessData(supabase) {
  const overview = await supabase.from('product_executive_snapshot').select('*').maybeSingle().then(unwrap)
  const targets = await supabase.from('product_prediction_readiness').select('*').order('target_key').order('reference_population').then(unwrap)
  const evaluations = await supabase.from('product_model_evaluations')
    .select('target_key,model_key,model_version,validation_method,evaluated_rows,positive_n,folds,brier_score,log_loss,auc,brier_skill_vs_base_rate,decision,decision_reason,evaluation_current,data_as_of_date')
    .order('model_key').then(unwrap)
  const expectedValueSupport = await supabase.from('product_expected_value_support').select('*').then(unwrap)
  // the blockers are derived from persisted snapshot rows only (never a live analytical view)
  const status = await supabase.from('product_database_status').select('*').maybeSingle().then(unwrap)
  const decisionSupport = await supabase.from('product_portfolio_decision_support').select('decision_support_state,optimization_eligible_candidates').then(unwrap)
  const playerStates = await supabase.from('product_player_decision').select('maturity_status,outcome_state,chain_status').then(unwrap)
  const blockers = status && overview
    ? readinessBlockers({ status, executive: overview, targets, evSupport: expectedValueSupport, decisionSupport, matureNotAudited: matureNotAuditedFrom(playerStates) })
    : null
  // 047: transaction-chain evidence gaps from the same snapshot rows. Reported, never gates; development completeness is on /development.
  const evidence = evidenceBlockers({ decisions: playerStates })
  return { overview, targets, evaluations, expectedValueSupport, blockers, evidence }
}

/** @param {any} [supabase] client override (tests) */
export async function getReadinessData(supabase) {
  const empty = { overview: null, targets: [], evaluations: [], expectedValueSupport: [], blockers: null, evidence: [] }
  return withSupabase('prediction readiness', empty, (client) => loadReadinessData(client), supabase ?? getSupabase())
}
