import { getSupabase } from './supabase'

async function fetchOne(supabase, view) {
  const { data, error } = await supabase.from(view).select('*').limit(1).maybeSingle()
  if (error) throw error
  return data
}

async function fetchMany(supabase, view, orderColumn, ascending = true) {
  let query = supabase.from(view).select('*')
  if (orderColumn) query = query.order(orderColumn, { ascending })
  const { data, error } = await query
  if (error) throw error
  return data || []
}

function unavailable(error) {
  return {
    live: false,
    error: error?.message || String(error || 'Supabase is not configured.'),
  }
}

export async function getDashboardData() {
  const supabase = getSupabase()
  if (!supabase) return { ...unavailable('Supabase environment variables are missing.'), universe:null, coverage:[], rateSummary:null, knownMlb:[], cases:[] }
  try {
    const [universe, coverage, rateSummary, knownMlb, cases] = await Promise.all([
      fetchOne(supabase, 'v_dodgers_universe_summary'),
      fetchMany(supabase, 'v_dodgers_class_coverage', 'signing_year'),
      fetchOne(supabase, 'v_dodgers_rate_eligible_summary'),
      fetchMany(supabase, 'v_dodgers_known_mlb_outcomes', 'career_war', false),
      fetchMany(supabase, 'v_dodgers_executive_dashboard_feed')
    ])
    return { live:true, error:null, universe, coverage, rateSummary, knownMlb, cases }
  } catch (error) {
    console.error('DISI Supabase overview fetch failed.', error)
    return { ...unavailable(error), universe:null, coverage:[], rateSummary:null, knownMlb:[], cases:[] }
  }
}

export async function getSigningsData() {
  const supabase = getSupabase()
  if (!supabase) return { ...unavailable('Supabase environment variables are missing.'), rows:[], scope:'No substitute data loaded' }
  try {
    const rows = await fetchMany(supabase, 'v_dodgers_portfolio_universe', 'signing_year')
    return { live:true, error:null, rows, scope:'All currently tracked Dodgers signing rows in Supabase' }
  } catch (error) {
    console.error('DISI Supabase signings fetch failed.', error)
    return { ...unavailable(error), rows:[], scope:'No substitute data loaded' }
  }
}

export async function getMarketsData() {
  const supabase = getSupabase()
  if (!supabase) return { ...unavailable('Supabase environment variables are missing.'), markets:[], pathways:[] }
  try {
    const [markets, pathways] = await Promise.all([
      fetchMany(supabase, 'v_dodgers_market_summary'),
      fetchMany(supabase, 'v_dodgers_pathway_summary')
    ])
    return { live:true, error:null, markets, pathways }
  } catch (error) {
    console.error('DISI Supabase markets fetch failed.', error)
    return { ...unavailable(error), markets:[], pathways:[] }
  }
}

export async function getDevelopmentData() {
  const signings = await getSigningsData()
  const debuts = signings.rows
    .filter((r) => r.reached_mlb && r.mlb_debut_org)
    .sort((a,b) => Number(a.years_signing_to_mlb ?? 999) - Number(b.years_signing_to_mlb ?? 999))
  return { ...signings, debuts }
}

export async function getAssetConversionData() {
  const supabase = getSupabase()
  if (!supabase) return { ...unavailable('Supabase environment variables are missing.'), trades:[], cases:[] }
  try {
    const [trades, overview] = await Promise.all([
      fetchMany(supabase, 'v_dodgers_competitive_asset_conversion', 'transaction_date'),
      getDashboardData()
    ])
    return { live:true, error:null, trades, cases:overview.cases }
  } catch (error) {
    console.error('DISI Supabase asset-conversion fetch failed.', error)
    return { ...unavailable(error), trades:[], cases:[] }
  }
}

export async function getLeagueData() {
  const supabase = getSupabase()
  if (!supabase) return { ...unavailable('Supabase environment variables are missing.'), rows:[], orgs:[], coverage:[], periodOrgs:[] }
  try {
    const [rows, orgs, coverage, periodOrgs] = await Promise.all([
      fetchMany(supabase, 'v_league_signing_benchmark', 'signing_year'),
      fetchMany(supabase, 'v_league_org_benchmark', 'signing_year'),
      fetchMany(supabase, 'v_signing_data_coverage', 'period_start_year'),
      fetchMany(supabase, 'v_league_period_org_summary', 'signed_count', false)
    ])
    return { live:true, error:null, rows, orgs, coverage, periodOrgs }
  } catch (error) {
    console.error('DISI league benchmark fetch failed.', error)
    return { ...unavailable(error), rows:[], orgs:[], coverage:[], periodOrgs:[] }
  }
}


export async function getAuditOperationsData() {
  const supabase = getSupabase()
  if (!supabase) return { ...unavailable('Supabase environment variables are missing.'), summary:null, queue:[], classes:[], markets:[] }
  try {
    const [summary, queue, classes, markets] = await Promise.all([
      fetchOne(supabase, 'v_dodgers_audit_pipeline_summary'),
      fetchMany(supabase, 'v_dodgers_next_outcome_audits', 'audit_priority_score', false),
      fetchMany(supabase, 'v_dodgers_class_research_progress', 'signing_year'),
      fetchMany(supabase, 'v_dodgers_market_research_progress', 'tracked_signings', false)
    ])
    return { live:true, error:null, summary, queue, classes, markets }
  } catch (error) {
    console.error('DISI audit-operations fetch failed.', error)
    return { ...unavailable(error), summary:null, queue:[], classes:[], markets:[] }
  }
}
