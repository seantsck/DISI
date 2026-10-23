// The read-only dataset the research commands operate on. Sources are public (anon-readable) views and persisted snapshots only.

/** Relations read, with the columns each command needs. Selected explicitly so the output is stable. */
export const DATASET_QUERIES = Object.freeze({
  status: 'select * from product_database_status',
  executive: 'select * from product_executive_snapshot',
  targets: 'select * from product_prediction_readiness order by target_key, reference_population',
  evSupport: 'select * from product_expected_value_support order by value_model_key',
  decisionSupport: 'select * from product_portfolio_decision_support order by state_order',
  decisions: 'select * from product_player_decision order by signing_id',
  signings: `select signing_id, player_id, player_slug, full_name, player_sort_name, signing_year, signing_date, country_market, pathway, age_at_signing,
      outcome_audit_status, reached_mlb_verified, audited_through_date, mlb_debut_date, total_known_acquisition_cost_usd, career_bwar, current_status
    from v_signing_records where is_dodgers_franchise order by signing_id`,
  directory: 'select player_id, mlb_id, bref_id, age_at_signing from v_player_directory where has_dodgers_signing order by player_id',
  sourceCounts: 'select player_id, count(*)::int as n from v_player_sources group by player_id order by player_id',
  tasks: "select task_type, priority, signing_year, player_id, player_slug, full_name from v_research_tasks where franchise_key = 'DODGERS' order by task_type, signing_year, player_slug",
  matureQueue: 'select * from v_dodgers_mature_outcome_queue order by player_id',
  populations: 'select * from v_dodgers_signing_population_coverage order by population_key',
  transactionQueue: 'select issue, priority, player_slug, event_key, asset_name, detail from v_transaction_research_queue order by issue, player_slug, event_key',
  valueQueue: 'select issue, priority, player_slug, event_key, detail from v_value_research_queue order by issue, player_slug, event_key',
  developmentQueue: 'select issue, priority, player_id, signing_year from v_dodgers_development_research_queue order by issue, player_id',
  developmentSummary: `select player_id, player_slug, signing_date, professional_debut_season, first_dsl_season, first_complex_season, first_a_season, highest_affiliated_level,
      highest_affiliated_season, mlb_debut_date, days_signing_to_pro_debut_exact, days_signing_to_mlb_exact, years_signing_to_mlb_exact, age_at_signing,
      age_at_mlb_debut_exact, current_development_status, progression_review_pending from v_dodgers_player_development_summary order by player_id`,
  exitSummary: 'select signing_id, player_id, player_slug, control_state, first_exit_date, first_exit_mechanism, unresolved_status from v_dodgers_international_exit_summary order by signing_id',
  periodQueue: 'select task_type, priority, signing_year, player_id from v_dodgers_signing_period_research_queue order by task_type, player_id',
})

/**
 * Per-stint and per-milestone history (048). Larger than the base dataset (about 2,000 stint rows), so a command asks for it explicitly
 * (--history, --review): the verified-MLB coverage table and the progression-review packet need the stints themselves.
 */
export const HISTORY_QUERIES = Object.freeze({
  stints: `select player_id, player_slug, season, level, level_rank, affiliate_team, league_name, organization_name, level_classification, stint_kind, affiliated, g, pg,
      first_game_date, last_game_date
    from v_player_development_stints order by player_slug, season, level_rank nulls last, affiliate_team nulls last, league_name nulls last, stint_id`,
  milestones: `select player_id, player_slug, event_code, milestone_date, date_precision, season_year, evidence_basis
    from v_player_development_milestones where event_code is not null order by player_slug, event_code, season_year nulls last, milestone_date nulls last`,
  progression: `select player_id, player_slug, event_code, level, progression_rank, progression_tier, first_appearance_date, first_appearance_season, first_appearance_precision,
      progression_role, review_status, development_state from v_player_development_progression order by player_slug, progression_rank`,
  progressionDecisions: `select player_id, event_code, progression_role, review_status, confidence, notes, as_of_date
    from development_progression_decisions order by player_id, event_code`,
})

/**
 * Raw query results -> the analysis dataset. outcome_state lives on the decision snapshot; it is attached to the signing record so
 * the cohort can tell NO_MLB_CAREER_ENDED from NO_MLB_ACTIVE_IN_MINORS without a second lookup.
 * @param {Record<string, any[]>} raw
 */
export function assembleDataset(raw) {
  const state = new Map((raw.decisions ?? []).map((d) => [d.signing_id, d.outcome_state ?? null]))
  const signings = (raw.signings ?? []).map((s) => ({ ...s, outcome_state: state.get(s.signing_id) ?? null }))
  const status = raw.status?.[0] ?? null
  const executive = raw.executive?.[0] ?? null
  return {
    status,
    executive,
    asOf: String(status?.source_data_as_of_date ?? executive?.source_data_as_of_date ?? '').slice(0, 10) || null,
    targets: raw.targets ?? [],
    evSupport: raw.evSupport ?? [],
    decisionSupport: raw.decisionSupport ?? [],
    decisions: raw.decisions ?? [],
    signings,
    directory: raw.directory ?? [],
    sourceCounts: Object.fromEntries((raw.sourceCounts ?? []).map((r) => [r.player_id, Number(r.n)])),
    tasks: raw.tasks ?? [],
    matureQueue: raw.matureQueue ?? [],
    populations: raw.populations ?? [],
    transactionQueue: raw.transactionQueue ?? [],
    valueQueue: raw.valueQueue ?? [],
    developmentQueue: raw.developmentQueue ?? [],
    developmentSummary: raw.developmentSummary ?? [],
    exitSummary: raw.exitSummary ?? [],
    periodQueue: raw.periodQueue ?? [],
    // 048 (only when a command loaded the history queries)
    stints: raw.stints ?? [],
    milestones: raw.milestones ?? [],
    progression: raw.progression ?? [],
    progressionDecisions: raw.progressionDecisions ?? [],
  }
}
