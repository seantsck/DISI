// Server-side data access. Every function returns { live, error, ... } and
// never substitutes hard-coded baseball data: if Supabase is unconfigured or a
// query fails, callers render an explicit unavailable state.

import { getSupabase } from './supabase.js'
import { applyTableQuery } from './table-state.js'
import { SIGNINGS_SPEC, PLAYERS_SPEC } from './specs.js'
import { searchTokens } from './text.js'

const NOT_CONFIGURED = 'Supabase environment variables are missing.'
const MIGRATION_HINT = 'The research views from database/sql/017_research_database_layer.sql are not present in this Supabase project. Run migration 017 in the Supabase SQL Editor.'

/** @param {any} error */
export function describeError(error) {
  if (!error) return 'Unknown error.'
  const message = error.message || String(error)
  const missingRelation = error.code === 'PGRST205' || error.code === '42P01'
    || /could not find the table|does not exist/i.test(message)
  return missingRelation ? `${MIGRATION_HINT} (${message})` : message
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
 * @returns {Promise<T & { live: boolean, error: string | null } | (Record<string, any> & { live: false, error: string })>}
 */
async function withSupabase(label, empty, run) {
  const supabase = getSupabase()
  if (!supabase) return failure(NOT_CONFIGURED, empty)
  try {
    const result = await run(supabase)
    return { live: true, error: null, ...result }
  } catch (error) {
    console.error(`DISI ${label} fetch failed.`, error)
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
  return withSupabase('overview', { status: null, snapshot: [], knownMlb: [], rateSummary: null }, async (supabase) => {
    const [status, snapshot, knownMlb, rateSummary] = await Promise.all([
      supabase.from('v_database_status').select('*').maybeSingle().then(unwrap),
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
    return { status, snapshot, knownMlb, rateSummary }
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

/** @param {string} slug */
export async function getPlayerDossier(slug) {
  const empty = { player: null, signings: [], timeline: [], transactions: [], sources: [], trainers: [], metrics: [], memberships: [], devStints: [], devMilestones: [], devSummary: null }
  return withSupabase('player dossier', empty, async (supabase) => {
    const player = await supabase.from('v_player_dossier').select('*').eq('player_slug', slug).maybeSingle().then(unwrap)
    if (!player) return { ...empty }
    const id = player.player_id
    const [signingRows, ages, timeline, transactions, sources, trainers, metrics, memberships, devStints, devMilestones, devSummary] = await Promise.all([
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
      supabase.from('v_player_trainers').select('*').eq('player_id', id).then(unwrap),
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
    ])
    // Derived ages (v_signing_ages) travel with each signing; each names the date it uses.
    const agesById = new Map(ages.map((a) => [a.signing_id, a]))
    const signings = signingRows.map((s) => ({ ...s, ages: agesById.get(s.signing_id) ?? null }))
    return { player, signings, timeline, transactions, sources, trainers, metrics, memberships, devStints, devMilestones, devSummary }
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

export async function getDevelopmentData() {
  const empty = { coverage: null, byClass: [], byMarket: [], byBonus: [], queue: [], debuts: [] }
  return withSupabase('development', empty, async (supabase) => {
    const [coverage, byClass, byMarket, byBonus, queue, debuts] = await Promise.all([
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
    ])
    return { coverage, byClass, byMarket, byBonus, queue, debuts }
  })
}

export async function getAssetConversionData() {
  return withSupabase('asset conversion', { packages: [], dispositions: [], bwarBySlug: {} }, async (supabase) => {
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
    }
  })
}

export async function getLeagueData() {
  return withSupabase('league benchmark', { rows: [], orgs: [], coverage: [], periodOrgs: [] }, async (supabase) => {
    const [rows, orgs, coverage, periodOrgs] = await Promise.all([
      supabase.from('v_signing_records')
        .select('signing_id,player_slug,full_name,signing_year,organization,country_market,primary_position,signing_bonus_usd,international_rank')
        .eq('record_scope', 'MLB_PIPELINE_TOP_PROSPECT')
        .order('signing_year', { ascending: true })
        .order('international_rank', { ascending: true, nullsFirst: false })
        .order('player_sort_name', { ascending: true })
        .then(unwrap),
      supabase.from('v_league_org_benchmark').select('*').order('signing_year').then(unwrap),
      supabase.from('v_signing_data_coverage').select('*').order('period_start_year').then(unwrap),
      supabase.from('v_league_period_org_summary').select('*').order('signed_count', { ascending: false }).then(unwrap),
    ])
    return { rows, orgs, coverage, periodOrgs }
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

/** @param {string | undefined} taskType */
export async function getResearchData(taskType) {
  const empty = { classes: [], tasks: [], taskCounts: {}, tiers: [], populations: [], reconciliation: [], periodQueue: [], outcomeProgress: null, outcomeClasses: [] }
  return withSupabase('research coverage', empty, async (supabase) => {
    let taskQuery = supabase.from('v_research_tasks').select('*').eq('franchise_key', 'DODGERS')
    if (taskType) taskQuery = taskQuery.eq('task_type', taskType)
    const [classes, tasks, tiers, populations, reconciliation, periodQueue, outcomeProgress, outcomeClasses, ...counts] = await Promise.all([
      supabase.from('v_class_research_coverage').select('*').eq('franchise_key', 'DODGERS')
        .order('signing_year', { ascending: false }).then(unwrap),
      taskQuery
        .order('priority', { ascending: false })
        .order('signing_year', { ascending: true })
        .order('full_name', { ascending: true, nullsFirst: true })
        .limit(200)
        .then(unwrap),
      supabase.from('source_tiers').select('*').order('priority').then(unwrap),
      supabase.from('v_dodgers_signing_population_coverage').select('*')
        .order('signing_year', { ascending: false }).order('population_scope', { ascending: true }).then(unwrap),
      supabase.from('v_dodgers_class_source_reconciliation')
        .select('signing_year,player_slug,full_name,classification,announced_date,formal_transaction_date,source_count,unresolved_flag,conflict_types')
        .eq('unresolved_flag', true)
        .order('signing_year', { ascending: false }).order('full_name', { ascending: true }).limit(200).then(unwrap),
      supabase.from('v_dodgers_signing_period_research_queue').select('*')
        .order('priority', { ascending: false }).order('signing_year', { ascending: false, nullsFirst: false })
        .order('full_name', { ascending: true, nullsFirst: true }).limit(200).then(unwrap),
      supabase.from('v_dodgers_outcome_audit_progress').select('*').maybeSingle().then(unwrap),
      supabase.from('v_dodgers_outcome_by_signing_class').select('*').order('signing_year', { ascending: false }).then(unwrap),
      ...RESEARCH_TASK_TYPES.map((type) =>
        supabase.from('v_research_tasks').select('task_type', { count: 'exact', head: true })
          .eq('franchise_key', 'DODGERS').eq('task_type', type)
          .then((r) => { if (r.error) throw r.error; return /** @type {const} */ ([type, r.count ?? 0]) })),
    ])
    return { classes, tasks, tiers, populations, reconciliation, periodQueue, outcomeProgress, outcomeClasses, taskCounts: Object.fromEntries(counts) }
  })
}
