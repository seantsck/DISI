// Read-only structural and semantic checks for the development pathway layer (Migration 037).
//
// Each query returns the NUMBER OF VIOLATIONS (expected 0). None pins how many players are in a class: classes move as seasons
// are added. `loaded` says whether the 037 views exist (the same checks then trivially pass on a canonical 036 database).

export const PATHWAY_CHECK_NAMES = [
  'pathway_season_path_violations', 'pathway_row_violations', 'pathway_class_rule_violations', 'pathway_status_violations',
  'pathway_arrival_order_violations', 'pathway_outcome_passthrough_violations', 'pathway_summary_sample_violations',
]

/** name -> SQL returning one row { n } = number of violations. */
export const pathwayQueries = (loaded) => {
  if (!loaded) return Object.fromEntries(PATHWAY_CHECK_NAMES.map((name) => [name, 'select 0::int as n']))
  return {
    // one row per player-season of affiliated developmental team play; the transition follows the ranks and the absence count;
    // 2020 (no minor-league season) is never an absence
    pathway_season_path_violations: `select (
        abs((select count(*) from public.v_player_development_season_path)
          - (select count(*) from (select distinct s.player_id, s.season from public.player_season_stints s join public.development_levels dl on dl.level = s.level
              where s.stint_kind = 'TEAM_STINT' and dl.affiliated and dl.progression_rank is not null) d))
      + (select count(*) from public.v_player_development_season_path sp
          where sp.primary_level_rank > sp.highest_level_rank
             or (sp.previous_season is null) <> (sp.transition = 'FIRST_SEASON')
             or (sp.absent_seasons_before > 0) <> (sp.transition = 'RETURNED_AFTER_ABSENCE')
             or (sp.transition = 'PROMOTED' and sp.primary_levels_gained <= 0)
             or (sp.transition = 'REPEATED' and sp.primary_levels_gained <> 0)
             or (sp.transition = 'REGRESSED' and sp.primary_levels_gained >= 0)
             or (sp.previous_season is not null and sp.absent_seasons_before
                 <> sp.season - sp.previous_season - 1 - case when sp.previous_season < 2020 and sp.season > 2020 then 1 else 0 end))
      )::int as n`,

    // one pathway row per Dodgers signing and none for another organization
    pathway_row_violations: `select (
        (select count(*) from public.signings s join public.organizations o on o.id = s.organization_id
          where o.franchise_key = 'DODGERS' and not exists (select 1 from public.v_player_development_pathway p where p.signing_id = s.id))
      + (select count(*) from public.v_player_development_pathway p join public.signings s on s.id = p.signing_id
          join public.organizations o on o.id = s.organization_id where o.franchise_key <> 'DODGERS')
      + (select count(*) from (select signing_id from public.v_player_development_pathway group by 1 having count(*) > 1) d)
      )::int as n`,

    // the class follows its stated precedence; a professional signing is never on the amateur ladder; a young active player is never
    // an exit, a stall or a slow progression
    pathway_class_rule_violations: `select count(*)::int as n from public.v_player_development_pathway p
      where p.pathway_class is distinct from case
        when p.signing_route = 'PROFESSIONAL_SIGNING' then 'NOT_CLASSIFIED_PROFESSIONAL_SIGNING'
        when p.observed_seasons = 0 or p.professional_debut_season is null or p.levels_unresolved > 0 then 'INSUFFICIENT_HISTORY'
        when p.seasons_below_prior_level > 0 then 'NONLINEAR'
        when p.seasons_to_aa <= 3 then 'FAST_TRACK'
        when p.seasons_to_aa <= 5 then 'STANDARD_PROGRESSION'
        when p.seasons_to_aa is not null then 'SLOW_PROGRESSION'
        when not p.active_affiliated then 'EARLY_EXIT'
        when p.current_same_level_run >= 3 then 'STALLED'
        when p.seasons_since_debut >= 6 then 'SLOW_PROGRESSION'
        else 'STILL_DEVELOPING' end
        or (p.pathway_class in ('EARLY_EXIT', 'STALLED', 'SLOW_PROGRESSION') and p.active_affiliated and p.seasons_since_debut < 6 and p.aa_or_higher_arrival_season is null and p.current_same_level_run < 3)`,

    // the status agrees with the audited reach and the observed activity
    pathway_status_violations: `select count(*)::int as n from public.v_player_development_pathway p
      where (p.pathway_status = 'REACHED_MLB') <> (p.reached_mlb_verified is true)
         or (p.pathway_status = 'NO_HISTORY' and p.observed_seasons <> 0)
         or (p.pathway_status = 'ACTIVE_AFFILIATED' and not p.active_affiliated)
         or (p.pathway_status = 'NO_RECENT_AFFILIATED_RECORD' and p.active_affiliated)`,

    // developmental arrivals never run backwards and never precede the professional debut
    pathway_arrival_order_violations: `select count(*)::int as n from public.v_player_development_pathway p
      where p.full_season_arrival_season > p.high_a_or_higher_arrival_season or p.high_a_or_higher_arrival_season > p.aa_or_higher_arrival_season
         or p.aa_or_higher_arrival_season > p.aaa_or_higher_arrival_season or p.aaa_or_higher_arrival_season > p.mlb_arrival_season
         or p.seasons_to_full_season < 0 or p.seasons_to_aa < 0 or p.seasons_to_aaa < 0 or p.seasons_to_mlb < 0
         or (p.aa_or_higher_arrival_season is not null and p.professional_debut_season is not null and p.seasons_to_aa is null)`,

    // outcome columns are the spine's, unchanged
    pathway_outcome_passthrough_violations: `select count(*)::int as n from public.v_player_development_pathway p
      join public.v_player_realized_outcome r on r.signing_id = p.signing_id
      where p.reached_mlb_verified is distinct from r.reached_mlb_verified or p.outcome_maturity is distinct from r.outcome_maturity
         or p.career_bwar is distinct from r.career_bwar or p.signing_org_bwar is distinct from r.signing_org_bwar
         or p.dodgers_attributable_organizational_bwar is distinct from r.dodgers_attributable_organizational_bwar`,

    // shares only for large-enough samples, never for coverage-artefact rows, and the Double-A share only for early velocity
    pathway_summary_sample_violations: `select count(*)::int as n from public.v_development_pathway_summary s
      where (s.mature_reached_mlb_share is not null and (s.mature_audited < s.minimum_sample or s.sample_state = 'COVERAGE_ARTEFACT_NOT_COMPARABLE'))
         or (s.mature_reached_aa_share is not null and (s.mature_players < s.minimum_sample or s.dimension <> 'EARLY_VELOCITY'))
         or ((s.sample_state = 'COVERAGE_ARTEFACT_NOT_COMPARABLE') <> (s.dimension = 'PATHWAY_CLASS' and s.dimension_value in ('INSUFFICIENT_HISTORY', 'NOT_CLASSIFIED_PROFESSIONAL_SIGNING')))
         or (s.sample_state = 'DESCRIPTIVE_SAMPLE' and s.mature_players < s.minimum_sample)
         or s.minimum_sample < 10 or s.mature_players > s.players or s.mature_reached_mlb > s.mature_audited`,
  }
}

export const PATHWAY_QUERIES = pathwayQueries(true)
