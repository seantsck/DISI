// Read-only structural and semantic checks for the international benchmark layer (Migration 035).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins research coverage or a mutable total: how many players are
// audited, or how many classes are tracked, may grow; an unaudited player is a research-queue item, not a verifier failure.
// `loaded` says whether the 035 views exist (the same checks then trivially pass on a canonical 034 database). Nothing here writes.

export const BENCHMARK_CHECK_NAMES = [
  'benchmark_scope_violations', 'benchmark_unaudited_not_false_violations', 'benchmark_outcome_state_violations',
  'benchmark_bwar_split_violations', 'benchmark_tier_violations', 'benchmark_rate_eligibility_violations',
  'benchmark_census_state_violations', 'benchmark_comparison_label_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const benchmarkQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(BENCHMARK_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // one row per Top-prospect signing; no other record scope; no duplicate signing
    benchmark_scope_violations: `select (
        (select count(*) from public.v_international_benchmark_player_outcomes where record_scope <> 'MLB_PIPELINE_TOP_PROSPECT')
      + (select count(*) from (select signing_id from public.v_international_benchmark_player_outcomes group by 1 having count(*) > 1) d)
      + (select count(*) from public.signings s where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
          and not exists (select 1 from public.v_international_benchmark_player_outcomes o where o.signing_id = s.id))
      )::int as n`,

    // missing is never "no MLB": an unaudited player has a NULL reach flag, and an audited one has the audited flag
    benchmark_unaudited_not_false_violations: `select count(*)::int as n from public.v_international_benchmark_player_outcomes o
      where (o.outcome_state = 'UNAUDITED') <> (o.reached_mlb_verified is null)
         or (o.outcome_state = 'UNAUDITED' and (o.audited_through_date is not null or o.tier1_reach_comparable))`,

    // the outcome state agrees with the reach flag
    benchmark_outcome_state_violations: `select count(*)::int as n from public.v_international_benchmark_player_outcomes o
      where (o.reached_mlb_verified is true and o.outcome_state <> 'REACHED_MLB')
         or (o.reached_mlb_verified is false and o.outcome_state = 'REACHED_MLB')
         or (o.reached_mlb_verified is not true and (o.career_bwar is not null and o.team_season_rows is null))`,

    // career bWAR is the sum of the original-organization and elsewhere parts whenever every loaded row is mapped
    benchmark_bwar_split_violations: `select count(*)::int as n from public.v_international_benchmark_player_outcomes o
      where o.team_season_rows > 0
        and abs(coalesce(o.career_bwar, 0) - (coalesce(o.original_org_bwar, 0) + coalesce(o.elsewhere_bwar, 0))) > 0.005`,

    // tier 3 (organizational realization) is never claimed for a benchmark row; tier 2 needs a verified reach and loaded facts
    benchmark_tier_violations: `select count(*)::int as n from public.v_international_benchmark_player_outcomes o
      where o.tier3_organizational_realization_comparable
         or (o.tier2_original_org_bwar_comparable and (o.reached_mlb_verified is not true or coalesce(o.team_season_rows, 0) = 0))`,

    // strict rate eligibility needs every requirement; a flagged-suitable legacy class is never eligible by that flag alone
    benchmark_rate_eligibility_violations: `select count(*)::int as n from public.v_international_benchmark_class_coverage c
      where c.rate_eligible_strict
        and (c.population_scope <> 'FULL_SIGNING_PERIOD' or c.expected_size is null or c.members <> c.expected_size
          or c.members_audited < c.members or c.members_identity_resolved < c.members or not c.is_mature
          or cardinality(c.rate_blockers) > 0)`,

    // CENSUS_COMPLETE only for a full signing period whose sourced size equals the held members
    benchmark_census_state_violations: `select count(*)::int as n from public.v_international_benchmark_class_coverage c
      where (c.census_state = 'CENSUS_COMPLETE' and (c.population_scope <> 'FULL_SIGNING_PERIOD' or c.expected_size is null or c.members <> c.expected_size))
         or (c.population_scope <> 'FULL_SIGNING_PERIOD' and c.census_state like 'CENSUS_%')`,

    // the comparison label is class-complete exactly when strictly eligible; nothing is labelled a league rate
    benchmark_comparison_label_violations: `select count(*)::int as n from public.v_international_benchmark_class_coverage c
      where c.comparison_label not in ('SAMPLE_COMPARISON', 'CLASS_COMPLETE_COMPARISON')
         or (c.comparison_label = 'CLASS_COMPLETE_COMPARISON') <> c.rate_eligible_strict`,
  }
}

export const BENCHMARK_QUERIES = benchmarkQueries(true)
