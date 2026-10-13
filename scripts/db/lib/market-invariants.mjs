// Read-only structural and semantic checks for the market / pathway layer and the signing-time feature record (Migration 039).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins coverage. `loaded` says whether the 039 objects exist.

export const MARKET_CHECK_NAMES = [
  'market_feature_row_violations', 'market_feature_leakage_violations', 'market_era_violations',
  'market_context_passthrough_violations', 'market_summary_sample_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const marketQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(MARKET_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // one feature row per signing; every recorded market mapped; the population class follows the record scope
    market_feature_row_violations: `select (
        abs((select count(*) from public.v_signing_time_features) - (select count(*) from public.signings))
      + (select count(*) from (select signing_id from public.v_signing_time_features group by 1 having count(*) > 1) d)
      + (select count(*) from public.v_signing_time_features f
          where f.market_group = 'UNMAPPED' or (f.country_market is null) <> (f.market_group = 'UNKNOWN')
             or f.population_class is distinct from case f.record_scope when 'HISTORICAL_VERIFIED' then 'OUTCOME_SELECTED_SAMPLE'
               when 'MLB_PIPELINE_TOP_PROSPECT' then 'TOP_PROSPECT_SAMPLE' when 'TRACKED_DODGERS' then 'TRACKED_SAMPLE'
               when 'COMPLETE_CENSUS' then 'OPENING_CLASS_CENSUS' else 'UNCLASSIFIED_POPULATION' end)
      )::int as n`,

    // signing-time only: the expectation observation is dated on or before the cutoff, the position family comes from the position
    // at signing alone, the feature date is the cutoff
    market_feature_leakage_violations: `select (
        (select count(*) from public.v_signing_time_features f
          join public.v_scouting_expectation_observations o on o.evaluation_id = f.expectation_evaluation_id and o.band_code = f.expectation_band_code
          where case o.date_precision when 'DAY' then o.evaluation_date
              when 'MONTH' then (make_date(o.evaluation_year, o.evaluation_month, 1) + interval '1 month' - interval '1 day')::date
              else make_date(o.evaluation_year, 12, 31) end > f.signing_cutoff_date)
      + (select count(*) from public.v_signing_time_features f
          where (f.position_at_signing is null) <> (f.position_family = 'POSITION_UNKNOWN')
             or f.feature_as_of_date is distinct from f.signing_cutoff_date
             or (f.expectation_band_code is null) <> (f.expectation_tier = 'NO_AT_SIGNING_EXPECTATION'))
      )::int as n`,

    // eras never overlap; every amateur signing with a usable date sits in the era containing it; professional routes stay off the scale
    market_era_violations: `select (
        (select count(*) from public.international_signing_eras a join public.international_signing_eras b on a.era_key < b.era_key
          and coalesce(a.starts_on, '-infinity'::date) <= coalesce(b.ends_on, 'infinity'::date) and coalesce(b.starts_on, '-infinity'::date) <= coalesce(a.ends_on, 'infinity'::date))
      + (select count(*) from public.v_signing_time_features f
          where (f.signing_route = 'PROFESSIONAL_SIGNING') <> (f.era_key = 'PROFESSIONAL_ROUTE')
             or (f.era_key not in ('PROFESSIONAL_ROUTE', 'ERA_BOUNDARY_AMBIGUOUS') and not exists (select 1 from public.international_signing_eras e
                  where e.era_key = f.era_key and coalesce((select s.signing_date from public.signings s where s.id = f.signing_id), make_date(f.signing_year, 12, 31))
                    between coalesce(e.starts_on, '-infinity'::date) and coalesce(e.ends_on, 'infinity'::date))))
      )::int as n`,

    // outcome columns are the spine's, unchanged
    market_context_passthrough_violations: `select (
        abs((select count(*) from public.v_market_pathway_player_context) - (select count(*) from public.signings))
      + (select count(*) from public.v_market_pathway_player_context c join public.v_player_realized_outcome r on r.signing_id = c.signing_id
          where c.reached_mlb_verified is distinct from r.reached_mlb_verified or c.outcome_maturity is distinct from r.outcome_maturity
             or c.career_bwar is distinct from r.career_bwar or c.signing_org_bwar is distinct from r.signing_org_bwar)
      )::int as n`,

    // shares only for eligible, large-enough, non-outcome-selected classes; a census rate only for a complete audited census
    market_summary_sample_violations: `select count(*)::int as n from public.v_market_pathway_summary s
      where (s.sample_reach_share is not null and (s.population_scope = 'OUTCOME_SELECTED_SAMPLE' or s.audited_count < 10))
         or (s.census_reach_rate is not null) <> s.rate_eligible
         or (s.rate_eligible and (s.population_scope <> 'OPENING_CLASS_CENSUS' or s.mature_count <> s.tracked_count or s.audited_count <> s.mature_count or s.audited_count < 10))
         or (s.population_scope = 'OUTCOME_SELECTED_SAMPLE') <> (s.sample_state = 'OUTCOME_SELECTED_NOT_COMPARABLE')
         or (s.complete_cost_total_usd is not null and s.cost_complete_count <> s.tracked_count)
         or s.audited_count > s.mature_count or s.mature_count > s.tracked_count or s.reached_mlb_count > s.audited_count`,
  }
}

export const MARKET_QUERIES = marketQueries(true)
