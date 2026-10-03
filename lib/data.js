import { getSupabase } from './supabase'

const fallback = {
  live: false,
  signals: {
    mature_tracked_signings: 17,
    verified_mlb_players: 4,
    mature_tracked_mlb_reach_rate: 0.2353,
    mature_tracked_bonus_spend_usd: 52642000,
    premium_5m_plus_bonus_spend_usd: 37500000,
    premium_5m_plus_share_of_bonus_spend_pct: 71.2,
    observed_later_career_war: 39.0,
    premium_5m_plus_observed_career_war: 0.0,
    verified_mlb_players_debuting_elsewhere: 4,
    traded_before_mlb_debut: 3,
    released_before_mlb_debut: 1,
    tracked_trade_conversions: 3,
    sole_asset_trade_conversions: 1,
    shared_package_trade_conversions: 2,
    observed_dodgers_regular_season_war_from_tracked_trade_returns: 5.0
  },
  cases: [
    {
      player: 'Yordan Alvarez', signing_year: 2016, signing_bonus_usd: 2000000,
      later_career_war: 30.9, identification_war_per_million: 15.45,
      realization_channel: 'TRADED_BEFORE_MLB_DEBUT', return_asset: 'Josh Fields',
      return_lad_regular_season_war: 2.0, strategic_context_label: 'PLAYOFF_PUSH_DEPTH',
      need_urgency: 4, acquisition_horizon: 'MULTI_YEAR_CONTROL',
      acquisition_season_postseason_result: 'LOST_NLCS', attribution_status: 'SOLE_OUTGOING_ASSET',
      identification_signal: 'ELITE_IDENTIFICATION', conversion_signal: 'LARGE_EX_POST_VALUE_GAP',
      attribution_caution: 'The tracked international signing was the sole outgoing asset, so the observed return can be associated directly with this disposition, while still requiring context beyond WAR.'
    },
    {
      player: 'Oneil Cruz', signing_year: 2015, signing_bonus_usd: 950000,
      later_career_war: 8.2, identification_war_per_million: 8.632,
      realization_channel: 'TRADED_BEFORE_MLB_DEBUT', return_asset: 'Tony Watson',
      return_lad_regular_season_war: 0.4, strategic_context_label: 'OCTOBER_BULLPEN_OPTIMIZATION',
      need_urgency: 3, acquisition_horizon: 'SAME_SEASON_RENTAL',
      acquisition_season_postseason_result: 'LOST_WORLD_SERIES', attribution_status: 'SHARED_PACKAGE_RETURN',
      identification_signal: 'HIGH_VALUE_IDENTIFICATION', conversion_signal: 'POSTSEASON_OPTIMIZATION_CONVERSION',
      attribution_caution: 'The tracked international signing was one component of a multi-player package; the full incoming return must not be attributed to this player alone.'
    },
    {
      player: 'Yusniel Diaz', signing_year: 2015, signing_bonus_usd: 15500000,
      later_career_war: 0.0, identification_war_per_million: 0.0,
      realization_channel: 'TRADED_BEFORE_MLB_DEBUT', return_asset: 'Manny Machado',
      return_lad_regular_season_war: 2.6, strategic_context_label: 'DIVISION_RACE_STAR_REPLACEMENT',
      need_urgency: 5, acquisition_horizon: 'SAME_SEASON_RENTAL',
      acquisition_season_postseason_result: 'LOST_WORLD_SERIES', attribution_status: 'SHARED_PACKAGE_RETURN',
      identification_signal: 'MLB_REACH_IDENTIFICATION', conversion_signal: 'HIGH_LEVERAGE_PACKAGE_CONVERSION',
      attribution_caution: 'The tracked international signing was one component of a multi-player package; the full incoming return must not be attributed to this player alone.'
    },
    {
      player: 'Ramon Rosso', signing_year: 2015, signing_bonus_usd: 62000,
      later_career_war: -0.1, identification_war_per_million: -1.613,
      realization_channel: 'RELEASED_BEFORE_MLB_DEBUT', return_asset: null,
      return_lad_regular_season_war: null, strategic_context_label: null,
      need_urgency: null, acquisition_horizon: null,
      acquisition_season_postseason_result: null, attribution_status: null,
      identification_signal: 'MLB_REACH_IDENTIFICATION', conversion_signal: 'TALENT_IDENTIFIED_BUT_NO_DIRECT_RETURN',
      attribution_caution: 'No trade return was realized by Los Angeles; later MLB reach occurred after the player left the organization.'
    }
  ],
  findings: [
    {
      finding_order: 1,
      finding_category: 'CAPITAL ALLOCATION',
      finding: 'Premium bonus concentration did not translate into observed career WAR in the tracked mature sample.',
      evidence: '$37.5M of $52.642M (71.2%) went to $5M+ signings, which produced 0.0 observed career WAR.',
      analytical_caution: 'Small, selectively tracked sample; descriptive rather than causal.'
    },
    {
      finding_order: 2,
      finding_category: 'TALENT IDENTIFICATION',
      finding: 'The mature tracked sample contains MLB talent identified by Los Angeles that realized its MLB debut elsewhere.',
      evidence: '4 of 4 verified MLB players debuted for another organization.',
      analytical_caution: 'Debuting elsewhere does not mean the asset failed; trade return and competitive context must be evaluated separately.'
    },
    {
      finding_order: 3,
      finding_category: 'ASSET CONVERSION',
      finding: 'Most MLB-reaching assets in the mature tracked sample were converted through trades rather than lost outright.',
      evidence: '3 were traded before MLB debut; 1 was released before MLB debut.',
      analytical_caution: 'Shared-package returns cannot be assigned fully to one prospect.'
    },
    {
      finding_order: 4,
      finding_category: 'COMPETITIVE CONTEXT',
      finding: 'International prospect capital was deployed in materially different competitive situations.',
      evidence: 'Fields: playoff-push depth. Watson: October bullpen optimization. Machado: critical shortstop replacement in a tight division race.',
      analytical_caution: 'Competitive context explains why equal WAR does not imply equal organizational value.'
    }
  ]
}

async function fetchOne(supabase, view) {
  const { data, error } = await supabase.from(view).select('*').limit(1).maybeSingle()
  if (error) throw error
  return data
}

async function fetchMany(supabase, view, orderColumn) {
  let query = supabase.from(view).select('*')
  if (orderColumn) query = query.order(orderColumn)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function getDashboardData() {
  const supabase = getSupabase()
  if (!supabase) return fallback

  try {
    const [signals, cases, findings] = await Promise.all([
      fetchOne(supabase, 'v_dodgers_portfolio_signals'),
      fetchMany(supabase, 'v_dodgers_executive_dashboard_feed'),
      fetchMany(supabase, 'v_dodgers_executive_findings_v2', 'finding_order')
    ])

    return {
      live: true,
      signals: signals || fallback.signals,
      cases: cases.length ? cases : fallback.cases,
      findings: findings.length ? findings : fallback.findings
    }
  } catch (error) {
    console.error('DISI Supabase fetch failed; using verified fallback sample.', error)
    return fallback
  }
}
