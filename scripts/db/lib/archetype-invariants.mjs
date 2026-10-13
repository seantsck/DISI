// Read-only structural and semantic checks for historical archetypes and comparables (Migration 040).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). `loaded` says whether the 040 views exist.

export const ARCHETYPE_CHECK_NAMES = [
  'archetype_row_violations', 'comparable_selection_violations', 'comparable_ordering_violations',
  'comparable_summary_sample_violations', 'archetype_summary_sample_violations',
]

const SCORE = `(case when 'AGE_BAND' = any(c.matched_dimensions) then 16 else 0 end + case when 'EXPECTATION_TIER' = any(c.matched_dimensions) then 8 else 0 end
  + case when 'COST_BAND' = any(c.matched_dimensions) then 4 else 0 end + case when 'MARKET_GROUP' = any(c.matched_dimensions) then 2 else 0 end
  + case when 'ERA' = any(c.matched_dimensions) then 1 else 0 end)`

/** name -> SQL returning one row { n } = number of violations. */
export const archetypeQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(ARCHETYPE_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // one archetype per signing, its key built from the signing-time features
    archetype_row_violations: `select (
        abs((select count(*) from public.v_player_historical_archetype) - (select count(*) from public.signings))
      + (select count(*) from public.v_player_historical_archetype a join public.v_signing_time_features f on f.signing_id = a.signing_id
          where a.coarse_archetype_key is distinct from concat_ws('|', f.signing_route, f.position_family, f.age_band)
             or a.archetype_defined is distinct from (f.has_age and f.has_position))
      )::int as n`,

    // comparables are earlier-signed, same route and position family, never outcome-selected, never the target, never an unknown position
    comparable_selection_violations: `select (
        (select count(*) from public.v_player_comparables c
          join public.v_signing_time_features t on t.signing_id = c.target_signing_id
          join public.v_signing_time_features k on k.signing_id = c.comparable_signing_id
          where k.signing_year >= t.signing_year or k.signing_route <> t.signing_route or k.position_family <> t.position_family
             or t.position_family = 'POSITION_UNKNOWN' or k.population_class = 'OUTCOME_SELECTED_SAMPLE' or k.signing_id = t.signing_id
             or c.comparable_rank > 20)
      + (select count(*) from (select target_signing_id, comparable_signing_id from public.v_player_comparables group by 1, 2 having count(*) > 1) d)
      )::int as n`,

    // ranks are 1..n per target, the score is the documented sum of matched dimensions and never increases with rank;
    // an unknown value never counts as a match
    comparable_ordering_violations: `select (
        (select count(*) from (select target_signing_id, max(comparable_rank) as mx, count(*) as n from public.v_player_comparables group by 1) d where d.mx <> d.n)
      + (select count(*) from public.v_player_comparables c where c.match_score <> ${SCORE}
          or ('EXPECTATION_TIER' = any(c.matched_dimensions) and c.comparable_expectation_tier = 'NO_AT_SIGNING_EXPECTATION')
          or ('COST_BAND' = any(c.matched_dimensions) and c.comparable_cost_band = 'BONUS_UNKNOWN')
          or ('MARKET_GROUP' = any(c.matched_dimensions) and c.comparable_market_group = 'UNKNOWN'))
      + (select count(*) from public.v_player_comparables a join public.v_player_comparables b
          on a.target_signing_id = b.target_signing_id and b.comparable_rank = a.comparable_rank + 1 where b.match_score > a.match_score)
      )::int as n`,

    // a comparable share only for 10+ mature audited comparables of one class
    comparable_summary_sample_violations: `select count(*)::int as n from public.v_player_comparable_summary s
      where (s.comparable_reach_share is not null and s.mature_audited_comparables < 10)
         or (s.comparable_state = 'DESCRIPTIVE_COMPARABLE_SAMPLE') <> (s.comparable_reach_share is not null)
         or s.mature_audited_comparables > s.mature_comparables or s.mature_comparables > s.comparables or s.mature_reached_mlb > s.mature_audited_comparables`,

    // archetype shares never for the outcome-selected set, only for 10+ mature audited members
    archetype_summary_sample_violations: `select count(*)::int as n from public.v_archetype_outcome_summary s
      where (s.sample_reach_share is not null and (s.population_class = 'OUTCOME_SELECTED_SAMPLE' or s.mature_audited_members < 10))
         or (s.population_class = 'OUTCOME_SELECTED_SAMPLE') <> (s.sample_state = 'OUTCOME_SELECTED_NOT_COMPARABLE')
         or s.mature_audited_members > s.mature_members or s.mature_members > s.members`,
  }
}

export const ARCHETYPE_QUERIES = archetypeQueries(true)
