// Read-only structural and semantic checks for the scouting expectation layer (Migration 036).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins research coverage: how many players carry an expectation or
// how many outcomes are settled may grow. `loaded` says whether the 036 objects exist (the same checks then trivially pass on a
// canonical 035 database). Nothing here writes.

export const EXPECTATION_CHECK_NAMES = [
  'expectation_band_shape_violations', 'expectation_spine_violations', 'expectation_spine_missing_not_zero_violations',
  'expectation_observation_scope_violations', 'expectation_anchor_violations', 'expectation_unknown_not_miss_violations',
  'expectation_state_rule_violations', 'expectation_calibration_sample_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const expectationQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(EXPECTATION_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // bands of one family share one publication and one measure definition, keep orders 1..n and never overlap
    expectation_band_shape_violations: `select (
        (select count(*) from (select band_family from public.scouting_expectation_bands group by 1
          having count(distinct (publication_id, measure, coalesce(ranking_scope, ''), coalesce(required_list_size, 0), coalesce(scale_code, ''),
            coalesce(dimension_code, ''), coalesce(temporal_basis, ''), population_label)) > 1
            or min(band_order) <> 1 or max(band_order) <> count(*)) f)
      + (select count(*) from public.scouting_expectation_bands a join public.scouting_expectation_bands b
          on a.band_family = b.band_family and a.band_code < b.band_code
         and a.lower_value <= coalesce(b.upper_value, 'infinity'::numeric) and b.lower_value <= coalesce(a.upper_value, 'infinity'::numeric))
      )::int as n`,

    // one spine row per signing; the scope agrees with the organization; Dodgers-only value never appears on a benchmark row
    expectation_spine_violations: `select (
        (select count(*) from public.signings s where not exists (select 1 from public.v_player_realized_outcome r where r.signing_id = s.id))
      + (select count(*) from (select signing_id from public.v_player_realized_outcome group by 1 having count(*) > 1) d)
      + (select count(*) from public.v_player_realized_outcome r
          where r.is_dodgers <> (r.outcome_scope = 'DODGERS_TRACKED')
             or (not r.is_dodgers and (r.dodgers_attributable_organizational_bwar is not null or r.dodgers_realization_status is not null))
             or r.outcome_maturity not in ('MATURE', 'NOT_MATURE'))
      )::int as n`,

    // MLB value columns describe an MLB career: NULL unless reach is verified; UNAUDITED keeps a NULL reach flag
    expectation_spine_missing_not_zero_violations: `select count(*)::int as n from public.v_player_realized_outcome r
      where (r.reached_mlb_verified is not true and (r.career_bwar is not null or r.signing_org_bwar is not null or r.elsewhere_bwar is not null or r.career_still_accruing))
         or ((r.outcome_state = 'UNAUDITED') <> (r.reached_mlb_verified is null))`,

    // exactly the ACTIVE ranks and FV grades of external / team-public publications are observations, each once
    expectation_observation_scope_violations: `select (
        (select count(*) from public.v_scouting_expectation_observations o
          join public.player_evaluations e on e.id = o.evaluation_id join public.scouting_publications sp on sp.id = e.publication_id
          where e.record_status <> 'ACTIVE' or sp.origin not in ('EXTERNAL', 'TEAM_PUBLIC'))
      + abs((select count(*) from public.v_scouting_expectation_observations where measure = 'RANK')
          - (select count(*) from public.player_evaluation_rankings r join public.player_evaluations e on e.id = r.evaluation_id
              join public.scouting_publications sp on sp.id = e.publication_id where e.record_status = 'ACTIVE' and sp.origin in ('EXTERNAL', 'TEAM_PUBLIC')))
      + abs((select count(*) from public.v_scouting_expectation_observations where measure = 'GRADE')
          - (select count(*) from public.player_evaluation_grades g join public.player_evaluations e on e.id = g.evaluation_id
              join public.scouting_publications sp on sp.id = e.publication_id where e.record_status = 'ACTIVE' and sp.origin in ('EXTERNAL', 'TEAM_PUBLIC')
                and g.dimension_code = 'OVERALL' and g.temporal_basis = 'FUTURE' and g.raw_value is not null))
      + (select count(*) from public.v_scouting_expectation_observations where (banding_state = 'BANDED') <> (band_code is not null))
      )::int as n`,

    // an anchor is banded, never post-debut or order-ambiguous, unique per player and family, and the earliest eligible observation
    expectation_anchor_violations: `select (
        (select count(*) from public.v_player_expectation_vs_outcome where band_code is not null and anchor_debut_order not in ('PRE_DEBUT', 'NO_DEBUT'))
      + (select count(*) from (select player_id, band_family from public.v_player_expectation_vs_outcome where band_family is not null group by 1, 2 having count(*) > 1) d)
      + (select count(*) from public.v_player_expectation_vs_outcome x
          where x.band_code is not null and exists (select 1 from public.v_scouting_expectation_observations o
            where o.player_id = x.player_id and o.band_family = x.band_family and o.debut_order in ('PRE_DEBUT', 'NO_DEBUT')
              and o.evaluation_year < x.anchor_evaluation_year))
      + (select count(*) from public.v_player_expectation_vs_outcome x
          where x.band_code is null and exists (select 1 from public.v_scouting_expectation_observations o
            where o.player_id = x.player_id and o.banding_state = 'BANDED' and o.debut_order in ('PRE_DEBUT', 'NO_DEBUT')))
      )::int as n`,

    // unknown or immature is never a miss; an unaudited outcome is never met, exceeded or underperformed
    expectation_unknown_not_miss_violations: `select count(*)::int as n from public.v_player_expectation_vs_outcome x
      where (x.reached_mlb_verified is null and x.comparison_state in ('EXPECTATION_EXCEEDED', 'EXPECTATION_MET', 'EXPECTATION_UNDERPERFORMED'))
         or (x.comparison_state = 'EXPECTATION_UNDERPERFORMED' and (x.outcome_maturity <> 'MATURE' or x.outcome_state = 'NO_MLB_ACTIVE_IN_MINORS'
             or (x.reached_mlb_verified and x.career_still_accruing)))
         or (x.outcome_settled and x.comparison_state not in ('EXPECTATION_EXCEEDED', 'EXPECTATION_MET', 'EXPECTATION_UNDERPERFORMED'))`,

    // the state follows the band's stated rule
    expectation_state_rule_violations: `select count(*)::int as n from public.v_player_expectation_vs_outcome x
      where (x.band_code is null) <> (x.comparison_state = 'INSUFFICIENT_EXPECTATION_DATA')
         or (x.comparison_state = 'EXPECTATION_EXCEEDED' and not (x.reached_mlb_verified and x.career_bwar >= x.exceeded_career_bwar_floor))
         or (x.comparison_state = 'EXPECTATION_MET' and not (x.reached_mlb_verified and (x.met_career_bwar_floor is null or x.career_bwar >= x.met_career_bwar_floor)))
         or (x.comparison_state = 'EXPECTATION_UNDERPERFORMED' and x.reached_mlb_verified and x.career_bwar >= coalesce(x.met_career_bwar_floor, 0) and x.met_career_bwar_floor is not null)
         or (x.comparison_state = 'EXPECTATION_UNDERPERFORMED' and x.reached_mlb_verified and x.met_career_bwar_floor is null)`,

    // shares and medians only for samples of at least the minimum; the counts partition the anchored players
    expectation_calibration_sample_violations: `select count(*)::int as n from public.v_scouting_calibration_summary c
      where ((c.reached_mlb_share is not null or c.met_or_exceeded_share is not null or c.median_career_bwar_of_reached is not null) and c.comparable_outcomes < c.minimum_comparable_sample)
         or (c.sample_state = 'DESCRIPTIVE_SAMPLE') <> (c.comparable_outcomes >= c.minimum_comparable_sample)
         or c.comparable_outcomes <> c.comparable_met_or_exceeded + c.comparable_underperformed
         or c.comparable_outcomes > c.mature_players or c.mature_players > c.anchored_players
         or c.minimum_comparable_sample < 10`,
  }
}

export const EXPECTATION_QUERIES = expectationQueries(true)
