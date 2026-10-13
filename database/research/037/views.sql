-- ===========================================================================
-- Migration 037 views: season path, player pathway, pathway summary, pathway research queue
-- ===========================================================================

-- One row per Dodgers player and observed season of affiliated developmental play (TEAM_STINT rows of the 021-023 stint layer on
-- the levels with a progression rank). The primary level is the level with the most games that season (ties go to the higher level),
-- so a short cameo is never read as a promotion; the highest level is shown beside it. The transition compares the primary level with
-- the previous observed season. 2020 had no minor-league season and is never counted as an absence.
create or replace view public.v_player_development_season_path
with (security_invoker = true)
as
with m as materialized (
  with st as (
    select s.player_id, s.season, s.level::text as level, dl.progression_rank as level_rank,
      greatest(coalesce(s.g, 0), coalesce(s.pg, 0)) as games
    from public.player_season_stints s
    join public.development_levels dl on dl.level = s.level
    where s.stint_kind = 'TEAM_STINT' and dl.affiliated and dl.progression_rank is not null
  ),
  ps as (
    select st.player_id, st.season,
      (array_agg(st.level order by st.games desc, st.level_rank desc, st.level))[1] as primary_level,
      (array_agg(st.level_rank order by st.games desc, st.level_rank desc, st.level))[1] as primary_level_rank,
      (array_agg(st.level order by st.level_rank desc, st.level))[1] as highest_level,
      max(st.level_rank) as highest_level_rank,
      count(distinct st.level)::int as levels_played,
      sum(st.games)::int as games
    from st group by st.player_id, st.season
  ),
  w as (
    select ps.*,
      lag(ps.season) over (partition by ps.player_id order by ps.season) as previous_season,
      lag(ps.primary_level_rank) over (partition by ps.player_id order by ps.season) as previous_primary_level_rank,
      max(ps.primary_level_rank) over (partition by ps.player_id order by ps.season rows between unbounded preceding and 1 preceding) as best_prior_primary_level_rank,
      row_number() over (partition by ps.player_id order by ps.season)::int as observed_season_number
    from ps
  )
  select
    w.player_id, pl.slug as player_slug, pl.full_name, w.season, w.observed_season_number,
    w.primary_level, w.primary_level_rank, w.highest_level, w.highest_level_rank, w.levels_played, w.games,
    w.previous_season,
    case when w.previous_season is null then 0
      else w.season - w.previous_season - 1 - case when w.previous_season < 2020 and w.season > 2020 then 1 else 0 end end as absent_seasons_before,
    w.primary_level_rank - w.previous_primary_level_rank as primary_levels_gained,
    case
      when w.previous_season is null then 'FIRST_SEASON'
      when w.season - w.previous_season - 1 - case when w.previous_season < 2020 and w.season > 2020 then 1 else 0 end > 0 then 'RETURNED_AFTER_ABSENCE'
      when w.primary_level_rank > w.previous_primary_level_rank then 'PROMOTED'
      when w.primary_level_rank = w.previous_primary_level_rank then 'REPEATED'
      else 'REGRESSED'
    end as transition,
    coalesce(w.primary_level_rank < w.best_prior_primary_level_rank, false) as below_prior_primary_level
  from w
  join public.players pl on pl.id = w.player_id
)
select * from m;

comment on view public.v_player_development_season_path is
  'Observed development path (Migration 037): one row per Dodgers player and season with affiliated developmental play (021-023 TEAM_STINT rows; season totals and non-affiliated levels excluded). primary_level is the level with the most games (ties to the higher level), highest_level the highest level played. transition compares the primary level with the previous observed season: FIRST_SEASON, PROMOTED, REPEATED, REGRESSED, or RETURNED_AFTER_ABSENCE when at least one season without affiliated play lies between (2020, which had no minor-league season, never counts). Transitions are observations: no reason (injury, demotion, release, assignment choice) is inferred.';

-- One row per Dodgers signing: the observed pathway, its features and a DISI-convention pathway class, with the realized-outcome
-- spine beside it. Developmental arrival per level comes from 024 (reviewed early cameos are not arrivals); repeats, regressions,
-- absences and activity come from the season path. Seasons are counted from the professional-debut season, excluding 2020.
create or replace view public.v_player_development_pathway
with (security_invoker = true)
as
with m as materialized (
  with latest as (
    select max(s.season) as latest_observed_season from public.player_season_stints s where s.stint_kind = 'TEAM_STINT'
  ),
  path as (
    select sp.player_id,
      min(sp.season) as first_affiliated_season, max(sp.season) as last_affiliated_season,
      count(*)::int as observed_seasons,
      count(*) filter (where sp.transition = 'PROMOTED')::int as promotion_seasons,
      count(*) filter (where sp.transition = 'REPEATED')::int as repeated_seasons,
      count(*) filter (where sp.transition = 'REGRESSED')::int as regressed_seasons,
      count(*) filter (where sp.below_prior_primary_level)::int as seasons_below_prior_level,
      count(*) filter (where sp.transition = 'RETURNED_AFTER_ABSENCE')::int as returns_after_absence,
      coalesce(sum(sp.absent_seasons_before), 0)::int as absent_seasons,
      (array_agg(sp.primary_level order by sp.season desc))[1] as last_primary_level,
      (array_agg(sp.primary_level_rank order by sp.season desc))[1] as last_primary_level_rank
    from public.v_player_development_season_path sp
    group by sp.player_id
  ),
  -- runs of consecutive observed seasons (no absence between) at the same primary level
  runs as (
    select r.player_id, r.primary_level_rank, r.grp, count(*)::int as run_length, max(r.season) as run_end
    from (
      select sp.player_id, sp.season, sp.primary_level_rank,
        sp.observed_season_number - row_number() over (partition by sp.player_id, sp.primary_level_rank order by sp.season)
          + sum(case when sp.absent_seasons_before > 0 then 1000 else 0 end) over (partition by sp.player_id order by sp.season) as grp
      from public.v_player_development_season_path sp
    ) r
    group by r.player_id, r.primary_level_rank, r.grp
  ),
  run_stats as (
    select ru.player_id, max(ru.run_length)::int as longest_same_level_run,
      (array_agg(ru.run_length order by ru.run_end desc))[1] as current_same_level_run
    from runs ru group by ru.player_id
  ),
  arrivals as (
    select p.player_id,
      min(p.developmental_arrival_season) filter (where p.development_state = 'REACHED') as first_arrival_season,
      min(p.developmental_arrival_season) filter (where p.development_state = 'REACHED' and p.level in ('LOW_A', 'HIGH_A', 'AA', 'AAA', 'MLB')) as full_season_arrival_season,
      min(p.developmental_arrival_season) filter (where p.development_state = 'REACHED' and p.level in ('HIGH_A', 'AA', 'AAA', 'MLB')) as high_a_or_higher_arrival_season,
      min(p.developmental_arrival_season) filter (where p.development_state = 'REACHED' and p.level in ('AA', 'AAA', 'MLB')) as aa_or_higher_arrival_season,
      min(p.developmental_arrival_season) filter (where p.development_state = 'REACHED' and p.level in ('AAA', 'MLB')) as aaa_or_higher_arrival_season,
      min(p.developmental_arrival_season) filter (where p.development_state = 'REACHED' and p.level = 'MLB') as mlb_arrival_season,
      count(*) filter (where p.development_state = 'SKIPPED')::int as levels_skipped,
      count(*) filter (where p.development_state = 'UNRESOLVED')::int as levels_unresolved,
      max(p.progression_rank) filter (where p.development_state = 'REACHED') as terminal_level_rank
    from public.v_player_development_progression p
    group by p.player_id
  ),
  base as (
    select
      r.signing_id, r.player_id, r.player_slug, r.full_name, r.signing_year, r.pathway, r.country_market, r.position_group,
      sa.age_years_at_signing as signing_age,
      case when r.pathway in ('CUBAN_PRO', 'JAPAN_PRO', 'KOREA_PRO', 'POSTED_PLAYER', 'MEXICAN_LEAGUE_TRANSFER') then 'PROFESSIONAL_SIGNING' else 'AMATEUR_OR_UNCLASSIFIED_SIGNING' end as signing_route,
      coalesce(ds.professional_debut_season, pa.first_affiliated_season) as professional_debut_season,
      pa.first_affiliated_season, pa.last_affiliated_season, coalesce(pa.observed_seasons, 0) as observed_seasons,
      coalesce(pa.promotion_seasons, 0) as promotion_seasons, coalesce(pa.repeated_seasons, 0) as repeated_seasons,
      coalesce(pa.regressed_seasons, 0) as regressed_seasons, coalesce(pa.seasons_below_prior_level, 0) as seasons_below_prior_level,
      coalesce(pa.returns_after_absence, 0) as returns_after_absence, coalesce(pa.absent_seasons, 0) as absent_seasons,
      pa.last_primary_level, pa.last_primary_level_rank,
      rs.longest_same_level_run, rs.current_same_level_run,
      ar.full_season_arrival_season, ar.high_a_or_higher_arrival_season, ar.aa_or_higher_arrival_season, ar.aaa_or_higher_arrival_season,
      ar.mlb_arrival_season, coalesce(ar.levels_skipped, 0) as levels_skipped, coalesce(ar.levels_unresolved, 0) as levels_unresolved,
      (select dl.level::text from public.development_levels dl where dl.progression_rank = ar.terminal_level_rank and dl.level <> 'A' order by dl.level limit 1) as terminal_level,
      pl.birth_date,
      lt.latest_observed_season,
      r.outcome_state, r.reached_mlb_verified, r.outcome_maturity, r.career_bwar, r.signing_org_bwar, r.elsewhere_bwar,
      r.dodgers_attributable_organizational_bwar, r.analysis_as_of_date
    from public.v_player_realized_outcome r
    join public.players pl on pl.id = r.player_id
    left join public.v_signing_ages sa on sa.signing_id = r.signing_id
    left join public.v_dodgers_player_development_summary ds on ds.player_id = r.player_id
    left join path pa on pa.player_id = r.player_id
    left join run_stats rs on rs.player_id = r.player_id
    left join arrivals ar on ar.player_id = r.player_id
    cross join latest lt
    where r.is_dodgers
  ),
  feat as (
    select b.*,
      -- seasons from the professional-debut season, 2020 (no minor-league season) excluded
      case when b.full_season_arrival_season is not null then b.full_season_arrival_season - b.professional_debut_season
        - case when b.professional_debut_season < 2020 and b.full_season_arrival_season > 2020 then 1 else 0 end end as seasons_to_full_season,
      case when b.aa_or_higher_arrival_season is not null then b.aa_or_higher_arrival_season - b.professional_debut_season
        - case when b.professional_debut_season < 2020 and b.aa_or_higher_arrival_season > 2020 then 1 else 0 end end as seasons_to_aa,
      case when b.aaa_or_higher_arrival_season is not null then b.aaa_or_higher_arrival_season - b.professional_debut_season
        - case when b.professional_debut_season < 2020 and b.aaa_or_higher_arrival_season > 2020 then 1 else 0 end end as seasons_to_aaa,
      case when b.mlb_arrival_season is not null then b.mlb_arrival_season - b.professional_debut_season
        - case when b.professional_debut_season < 2020 and b.mlb_arrival_season > 2020 then 1 else 0 end end as seasons_to_mlb,
      case when b.last_affiliated_season is not null then b.latest_observed_season - b.professional_debut_season + 1
        - case when b.professional_debut_season < 2020 and b.latest_observed_season > 2020 then 1 else 0 end end as seasons_since_debut,
      case when b.aa_or_higher_arrival_season is not null and b.birth_date is not null then b.aa_or_higher_arrival_season - extract(year from b.birth_date)::int end as age_in_aa_arrival_season,
      case when b.full_season_arrival_season is not null and b.birth_date is not null then b.full_season_arrival_season - extract(year from b.birth_date)::int end as age_in_full_season_arrival_season,
      (b.last_affiliated_season >= b.latest_observed_season - 1) as active_affiliated
    from base b
  ),
  cls as (
    select f.*,
      case
        when f.signing_route = 'PROFESSIONAL_SIGNING' then 'NOT_CLASSIFIED_PROFESSIONAL_SIGNING'
        when f.observed_seasons = 0 or f.professional_debut_season is null or f.levels_unresolved > 0 then 'INSUFFICIENT_HISTORY'
        when f.seasons_below_prior_level > 0 then 'NONLINEAR'
        when f.seasons_to_aa is not null and f.seasons_to_aa <= 3 then 'FAST_TRACK'
        when f.seasons_to_aa is not null and f.seasons_to_aa <= 5 then 'STANDARD_PROGRESSION'
        when f.seasons_to_aa is not null then 'SLOW_PROGRESSION'
        when not f.active_affiliated then 'EARLY_EXIT'
        when f.current_same_level_run >= 3 then 'STALLED'
        when f.seasons_since_debut >= 6 then 'SLOW_PROGRESSION'
        else 'STILL_DEVELOPING'
      end as pathway_class,
      case
        when f.reached_mlb_verified is true then 'REACHED_MLB'
        when f.observed_seasons = 0 then 'NO_HISTORY'
        when f.active_affiliated then 'ACTIVE_AFFILIATED'
        else 'NO_RECENT_AFFILIATED_RECORD'
      end as pathway_status,
      case
        when f.seasons_to_full_season is null then 'FULL_SEASON_NOT_REACHED'
        when f.seasons_to_full_season <= 1 then 'FULL_SEASON_BY_SEASON_2'
        when f.seasons_to_full_season = 2 then 'FULL_SEASON_IN_SEASON_3'
        when f.seasons_to_full_season = 3 then 'FULL_SEASON_IN_SEASON_4'
        else 'FULL_SEASON_IN_SEASON_5_OR_LATER'
      end as early_velocity
    from feat f
  )
  select
    c.signing_id, c.player_id, c.player_slug, c.full_name, c.signing_year, c.pathway, c.signing_route, c.country_market, c.position_group, c.signing_age,
    c.professional_debut_season, c.first_affiliated_season, c.last_affiliated_season, c.latest_observed_season, c.observed_seasons, c.seasons_since_debut,
    c.full_season_arrival_season, c.high_a_or_higher_arrival_season, c.aa_or_higher_arrival_season, c.aaa_or_higher_arrival_season, c.mlb_arrival_season,
    c.seasons_to_full_season, c.seasons_to_aa, c.seasons_to_aaa, c.seasons_to_mlb,
    c.age_in_full_season_arrival_season, c.age_in_aa_arrival_season,
    c.levels_skipped, c.levels_unresolved, c.promotion_seasons, c.repeated_seasons, c.regressed_seasons, c.seasons_below_prior_level,
    c.returns_after_absence, c.absent_seasons, c.longest_same_level_run, c.current_same_level_run,
    c.last_primary_level, c.terminal_level, c.active_affiliated,
    c.pathway_class, c.pathway_status, c.early_velocity,
    c.outcome_state, c.reached_mlb_verified, c.outcome_maturity, c.career_bwar, c.signing_org_bwar, c.elsewhere_bwar,
    c.dodgers_attributable_organizational_bwar, c.analysis_as_of_date
  from cls c
)
select * from m;

comment on view public.v_player_development_pathway is
  'Development pathway (Migration 037): one row per Dodgers signing. Arrival seasons are 024 developmental arrivals (a reviewed early cameo is not an arrival); seasons_to_* count seasons from the professional-debut season, 2020 excluded; repeats, regressions, absences and same-level runs come from v_player_development_season_path. pathway_class is a DISI convention with this precedence: NOT_CLASSIFIED_PROFESSIONAL_SIGNING (a professional signing is never placed on the amateur ladder), INSUFFICIENT_HISTORY (no affiliated history, or an arrival the 024 review left unresolved), NONLINEAR (a season whose primary level is below an earlier one), FAST_TRACK / STANDARD_PROGRESSION / SLOW_PROGRESSION (Double-A or higher within 3 / 4-5 / 6+ seasons), EARLY_EXIT (no affiliated play in the two most recent observed seasons and Double-A never reached; reason not inferred), STALLED (active, Double-A not reached, the last 3+ consecutive seasons at one primary level), SLOW_PROGRESSION (active 6+ seasons without Double-A), STILL_DEVELOPING (active, fewer than 6 seasons; never a failure label). The outcome columns come from v_player_realized_outcome. A class describes an observed path; it is not a cause of, or a forecast for, an outcome.';

-- Pathway classes and early velocity against outcomes, per signing pathway (pathways are never blended). Outcome counts use mature
-- signings only; shares appear only for 10+ mature players.
create or replace view public.v_development_pathway_summary
with (security_invoker = true)
as
with m as materialized (
  with p as (select * from public.v_player_development_pathway),
  d as (
    select 'PATHWAY_CLASS'::text as dimension, p.pathway_class as dimension_value, p.* from p
    union all
    select 'EARLY_VELOCITY', p.early_velocity, p.* from p where p.pathway_class not in ('NOT_CLASSIFIED_PROFESSIONAL_SIGNING', 'INSUFFICIENT_HISTORY')
  ),
  agg as (
    select d.dimension, d.dimension_value, d.pathway,
      count(*)::int as players,
      count(*) filter (where d.active_affiliated)::int as active_players,
      count(*) filter (where d.aa_or_higher_arrival_season is not null)::int as reached_aa_or_higher,
      count(*) filter (where d.aaa_or_higher_arrival_season is not null)::int as reached_aaa_or_higher,
      count(*) filter (where d.reached_mlb_verified)::int as reached_mlb,
      count(*) filter (where d.outcome_maturity = 'MATURE')::int as mature_players,
      count(*) filter (where d.outcome_maturity = 'MATURE' and d.reached_mlb_verified is not null)::int as mature_audited,
      count(*) filter (where d.outcome_maturity = 'MATURE' and d.aa_or_higher_arrival_season is not null)::int as mature_reached_aa_or_higher,
      count(*) filter (where d.outcome_maturity = 'MATURE' and d.reached_mlb_verified)::int as mature_reached_mlb,
      sum(d.career_bwar) filter (where d.outcome_maturity = 'MATURE' and d.reached_mlb_verified) as mature_career_bwar_total,
      sum(d.signing_org_bwar) filter (where d.outcome_maturity = 'MATURE' and d.reached_mlb_verified) as mature_dodgers_bwar_total,
      percentile_cont(0.5) within group (order by d.seasons_to_aa) filter (where d.seasons_to_aa is not null) as median_seasons_to_aa,
      percentile_cont(0.5) within group (order by d.age_in_aa_arrival_season) filter (where d.age_in_aa_arrival_season is not null) as median_age_in_aa_arrival_season,
      percentile_cont(0.5) within group (order by d.signing_age) filter (where d.signing_age is not null) as median_signing_age,
      min(d.signing_year) as first_signing_year, max(d.signing_year) as last_signing_year,
      -- rows without a classified path (no history, unresolved arrivals, professional signings) are a coverage artefact: development
      -- history exists mostly for 2012+ signings, so their outcomes are selected by record-keeping, not by any pathway
      (d.dimension = 'EARLY_VELOCITY' or d.dimension_value not in ('INSUFFICIENT_HISTORY', 'NOT_CLASSIFIED_PROFESSIONAL_SIGNING')) as comparable
    from d group by d.dimension, d.dimension_value, d.pathway
  )
  select
    a.dimension, a.dimension_value, a.pathway, a.players, a.active_players,
    a.reached_aa_or_higher, a.reached_aaa_or_higher, a.reached_mlb,
    a.mature_players, a.mature_audited, a.mature_reached_aa_or_higher, a.mature_reached_mlb,
    -- the Double-A share is shown only for early velocity: a pathway class is itself defined by Double-A arrival, so its share would be true by definition
    case when a.comparable and a.dimension = 'EARLY_VELOCITY' and a.mature_players >= 10 then round(a.mature_reached_aa_or_higher::numeric / a.mature_players, 3) end as mature_reached_aa_share,
    case when a.comparable and a.mature_audited >= 10 then round(a.mature_reached_mlb::numeric / a.mature_audited, 3) end as mature_reached_mlb_share,
    round(a.mature_career_bwar_total, 1) as mature_career_bwar_total,
    round(a.mature_dodgers_bwar_total, 1) as mature_dodgers_bwar_total,
    round(a.median_seasons_to_aa::numeric, 1) as median_seasons_to_aa,
    round(a.median_age_in_aa_arrival_season::numeric, 1) as median_age_in_aa_arrival_season,
    round(a.median_signing_age::numeric, 1) as median_signing_age,
    a.first_signing_year, a.last_signing_year,
    10 as minimum_sample,
    case when not a.comparable then 'COVERAGE_ARTEFACT_NOT_COMPARABLE' when a.mature_players >= 10 then 'DESCRIPTIVE_SAMPLE' else 'INSUFFICIENT_SAMPLE' end as sample_state,
    format('Observed players on this pathway (%s, %s = %s): %s players, %s mature. Association only; a path does not cause an outcome.',
      a.pathway, lower(a.dimension), a.dimension_value, a.players, a.mature_players) as interpretation
  from agg a
)
select * from m;

comment on view public.v_development_pathway_summary is
  'Development pathway summary (Migration 037): pathway class (dimension PATHWAY_CLASS) and early velocity (dimension EARLY_VELOCITY, seasons from the professional debut to the first full-season level, for classified players only) against observed milestones and outcomes, one row per value and signing pathway; pathways are never blended. Outcome counts are for mature signings; mature_reached_mlb_share needs 10+ mature audited players and mature_reached_aa_share (early velocity only: a pathway class is itself defined by Double-A arrival) 10+ mature players, otherwise NULL (sample_state INSUFFICIENT_SAMPLE). INSUFFICIENT_HISTORY and NOT_CLASSIFIED_PROFESSIONAL_SIGNING rows are COVERAGE_ARTEFACT_NOT_COMPARABLE and carry no share: older histories were kept mainly for players who reached MLB, so their outcomes reflect record-keeping, not a path. Development history covers mostly 2012+ signings, so most mature MLB players are not in any classified row. Association only: "observed players on this pathway", never a cause or a forecast.';

-- Research queue: pathway facts whose reasons are not sourced and classifications blocked by unresolved arrivals. Issues are new to
-- 037; the development research queue keeps SEASON_GAP, IDENTITY_BUT_NO_PROFESSIONAL_SEASONS and the MLB history gaps.
create or replace view public.v_development_pathway_research_queue
with (security_invoker = true)
as
with m as materialized (
  with pw as materialized (select * from public.v_player_development_pathway),
  sp as materialized (select * from public.v_player_development_season_path where below_prior_primary_level)
  select 'PATHWAY_ARRIVAL_UNRESOLVED'::text as issue, 2 as priority, p.player_id, p.player_slug, p.full_name, p.signing_year, null::integer as season,
    format('%s developmental arrival(s) left unresolved by the 024 review; the pathway is not classified until they are decided.', p.levels_unresolved) as detail
  from pw p where p.levels_unresolved > 0
  union all
  select 'LEVEL_REGRESSION_REASON_UNSOURCED', 3, sp.player_id, sp.player_slug, sp.full_name, s.signing_year, sp.season,
    format('%s primary level %s is below an earlier season''s primary level; the reason (assignment, injury rehabilitation, demotion) is not sourced and is not inferred.',
      sp.season, sp.primary_level)
  from sp join public.signings s on s.player_id = sp.player_id
  union all
  select 'PROLONGED_SAME_LEVEL_UNSOURCED', 3, p.player_id, p.player_slug, p.full_name, p.signing_year, p.last_affiliated_season,
    format('%s consecutive seasons at %s without Double-A; the reason is not sourced and the class is an observation, not a judgement.',
      p.current_same_level_run, p.last_primary_level)
  from pw p where p.pathway_class = 'STALLED'
  union all
  select 'PROFESSIONAL_SIGNING_PATH_NOT_MODELLED', 3, p.player_id, p.player_slug, p.full_name, p.signing_year, null,
    format('%s signing: an established professional is never placed on the amateur development ladder; no professional-route pathway model exists yet.', p.pathway)
  from pw p where p.pathway_class = 'NOT_CLASSIFIED_PROFESSIONAL_SIGNING'
)
select * from m;

comment on view public.v_development_pathway_research_queue is
  'Pathway research queue (Migration 037): unresolved developmental arrivals that block a pathway class, primary-level regressions and prolonged same-level runs whose reasons are not sourced (DISI never infers injury, demotion or release), and professional signings outside the amateur pathway model. Missing seasons and missing histories stay in v_dodgers_development_research_queue.';
