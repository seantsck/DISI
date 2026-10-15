// The DISI v1 product snapshots (Migration 045a): the persisted read models the application reads instead of the 042-045 analytical
// views. One definition per snapshot table, shared by the migration build (table creation, refresh stages, drift check), the verifier
// and the tests, so the three can never disagree.
//
// Every snapshot is a column-exact projection of its analytical source plus `generation_id` (first column). `source` is the SELECT whose
// rows the table holds; `volatile` names generation-metadata columns excluded from the drift comparison (they record WHEN, not WHAT).

export const SNAPSHOTS = [
  {
    table: 'product_executive_snapshot',
    grain: 'one row: the executive overview (044), the release status (045) and the generation metadata',
    area: 'EXECUTIVE', tier: 'EXECUTIVE', routes: ['/', '/prediction-readiness'],
    purpose: 'Executive summary, product / schema version, support-chain state and snapshot freshness (persisted; refreshed explicitly)',
    source: `select current_timestamp as generated_at, (current_timestamp at time zone 'UTC')::date as snapshot_as_of_date,
    rs.analysis_as_of_date as source_data_as_of_date, rs.latest_development_data_date as source_development_data_as_of_date,
    rs.product_version, rs.schema_version, rs.support_chain_state, o.*,
    rs.canonical_through, rs.latest_outcome_audit_date, rs.model_evaluation_data_as_of, rs.probability_model_version, rs.value_model_version,
    rs.decision_engine_version, rs.product_contract_relations, rs.product_statement
  from public.v_executive_overview o cross join public.v_disi_release_status rs`,
    volatile: ['generated_at', 'snapshot_as_of_date'],
  },
  {
    table: 'product_prediction_readiness',
    grain: 'one row per outcome target and reference population',
    area: 'PREDICTION_READINESS', tier: 'PAGE', routes: ['/prediction-readiness'],
    purpose: 'Evidence, minimums and what is still needed per outcome target and reference population (persisted)',
    source: `select * from public.v_prediction_readiness`,
  },
  {
    table: 'product_model_evaluations',
    grain: 'one row per recorded model evaluation',
    area: 'PREDICTION_READINESS', tier: 'PAGE', routes: ['/prediction-readiness'],
    purpose: 'Recorded out-of-time model evaluation with currency check (persisted)',
    source: `select * from public.v_outcome_model_evaluation`,
  },
  {
    table: 'product_expected_value_support',
    grain: 'one row per reviewed value model',
    area: 'ORGANIZATIONAL_VALUE', tier: 'PAGE', routes: ['/portfolio', '/prediction-readiness'],
    purpose: 'Expected-value model support and blockers (persisted)',
    source: `select * from public.v_expected_value_support`,
  },
  {
    table: 'product_portfolio_decision_support',
    grain: 'one row per decision-support state',
    area: 'PORTFOLIO', tier: 'EXECUTIVE', routes: ['/portfolio'],
    purpose: 'Candidates per decision-support state with what DISI may and may not say (persisted)',
    source: `select * from public.v_portfolio_decision_support`,
  },
  {
    table: 'product_portfolio_history',
    grain: 'one row per grain and grain value',
    area: 'PORTFOLIO', tier: 'PAGE', routes: ['/portfolio'],
    purpose: 'Retrospective capital allocation, concentration and realized value (persisted)',
    source: `select * from public.v_historical_portfolio_summary`,
  },
  {
    table: 'product_portfolio_scenarios',
    grain: 'one row per scenario and Dodgers signing year',
    area: 'PORTFOLIO', tier: 'PAGE', routes: ['/portfolio'],
    purpose: 'Pool scenarios: budget feasibility and (when supported) value optimization (persisted)',
    source: `select * from public.v_portfolio_scenario_evaluation`,
  },
  {
    table: 'product_player_decision',
    grain: 'one row per Dodgers signing: realized organizational value (042) and decision support at the signing date (043)',
    area: 'ORGANIZATIONAL_VALUE', tier: 'DOSSIER', routes: ['/players/[slug]'],
    purpose: 'Realized organizational value (components separate) and decision-support state per Dodgers signing (persisted)',
    source: `select r.*, c.decision_as_of_date, c.decision_support_state, c.optimization_eligible, c.decision_blockers, c.decision_statement,
    c.expected_value_model_supported, c.historical_comparables, c.cost_complete as readiness_cost_complete,
    c.cost_coverage_state as readiness_cost_coverage_state, c.player_data_complete
  from public.v_player_realized_organizational_value r
  left join public.v_portfolio_candidate_readiness c on c.signing_id = r.signing_id`,
    index: ['player_id'],
  },
  {
    table: 'product_player_expected_value',
    grain: 'one row per Dodgers signing and value model',
    area: 'ORGANIZATIONAL_VALUE', tier: 'DOSSIER', routes: ['/players/[slug]'],
    purpose: 'Expected organizational value state per Dodgers signing - NULL with its reason unless supported (persisted)',
    source: `select * from public.v_player_expected_organizational_value`,
    index: ['player_id'],
  },
  {
    table: 'product_player_comparables',
    grain: 'one row per Dodgers target signing and comparable population class',
    area: 'COMPARABLES', tier: 'DOSSIER', routes: ['/players/[slug]'],
    purpose: 'Earlier comparable signings by population class for Dodgers signings (historical context; persisted)',
    source: `select s.* from public.v_player_comparable_summary s
  where s.target_signing_id in (select signing_id from public.v_player_realized_organizational_value)`,
    index: ['target_signing_id'],
  },
]

// The 042-045 analytical relations the application no longer reads. 045a removes them from the product contract and from the API.
export const INTERNAL_VIEWS = [
  'v_player_realized_organizational_value', 'v_historical_org_value_distribution', 'v_expected_value_support', 'v_player_expected_organizational_value',
  'v_expected_value_research_queue', 'v_portfolio_candidate_readiness', 'v_historical_portfolio_summary', 'v_portfolio_scenario_evaluation',
  'v_portfolio_decision_support', 'v_portfolio_research_queue', 'v_executive_overview', 'v_prediction_readiness', 'v_disi_release_status',
  'v_research_roadmap',
]
// earlier (040 / 041) views that only the 044 pages had added to the product contract; they stay public research views
export const CONTRACT_REMOVED_EARLIER = ['v_outcome_model_evaluation', 'v_player_comparable_summary']
export const STAGED_FUNCTIONS = [
  'disi_player_realized_organizational_value', 'disi_player_expected_organizational_value', 'disi_expected_value_research_queue',
  'disi_portfolio_candidate_readiness', 'disi_executive_overview', 'disi_research_roadmap',
]
export const SERVING_FUNCTIONS = ['disi_refresh_product_snapshots', 'disi_product_snapshot_drift']
export const SNAPSHOT_TABLES = SNAPSHOTS.map((s) => s.table)
