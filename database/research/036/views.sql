-- ===========================================================================
-- Migration 036 views: realized-outcome spine, expectation observations, expectation vs outcome, calibration, research queue
-- ===========================================================================

-- One row per tracked signing: the realized-outcome spine shared by Migrations 036-038. Every value is passed through from the
-- 032-034 Dodgers realization layer or the 035 benchmark layer; nothing is recomputed. MLB value columns describe an MLB career and
-- are NULL unless reached_mlb_verified is true (no MLB career is stated by reached_mlb_verified = false, never by a zero).
create or replace view public.v_player_realized_outcome
with (security_invoker = true)
as
with m as materialized (
  with war as (
    select w.bref_id, max(w.season) as bwar_last_season
    from public.player_mlb_team_season_war w
    where w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
    group by w.bref_id
  )
  select
    s.id as signing_id, pl.id as player_id, pl.slug as player_slug, pl.full_name,
    o.abbreviation as organization, o.franchise_key, (o.franchise_key = 'DODGERS') as is_dodgers,
    case when o.franchise_key = 'DODGERS' then 'DODGERS_TRACKED' else 'TOP_PROSPECT_BENCHMARK' end as outcome_scope,
    s.record_scope, s.signing_year, s.signing_date, s.pathway::text as pathway, s.country_market,
    coalesce(pl.primary_position, s.position_at_signing) as primary_position,
    case
      when coalesce(pl.primary_position, s.position_at_signing) is null then 'UNKNOWN'
      when coalesce(pl.primary_position, s.position_at_signing) in ('RHP', 'LHP', 'P') then 'PITCHER'
      else 'POSITION_PLAYER'
    end as position_group,
    (pl.mlb_id is not null) as identity_resolved,
    coalesce(case when o.franchise_key = 'DODGERS' then d.outcome_state else b.outcome_state end, 'UNAUDITED') as outcome_state,
    a.reached_mlb_verified,
    a.audited_through_date,
    case
      when o.franchise_key = 'DODGERS' then case d.maturity_status when 'MATURE' then 'MATURE' else 'NOT_MATURE' end
      else case when b.is_mature then 'MATURE' else 'NOT_MATURE' end
    end as outcome_maturity,
    case when o.franchise_key = 'DODGERS' then d.maturity_basis else 'SIGNING_YEAR_PLUS_5_YEARS' end as maturity_basis,
    least(pl.mlb_debut_date, oc.mlb_debut_date) as mlb_debut_date,
    case when a.reached_mlb_verified is true and least(pl.mlb_debut_date, oc.mlb_debut_date) is not null
      then extract(year from least(pl.mlb_debut_date, oc.mlb_debut_date))::int - s.signing_year end as years_signing_to_debut_season,
    case when a.reached_mlb_verified is true then case when o.franchise_key = 'DODGERS' then d.team_season_career_bwar else b.career_bwar end end as career_bwar,
    case when a.reached_mlb_verified is true then case when o.franchise_key = 'DODGERS' then d.direct_dodgers_mlb_bwar else b.original_org_bwar end end as signing_org_bwar,
    case when a.reached_mlb_verified is true then case when o.franchise_key = 'DODGERS' then d.non_dodgers_mlb_bwar else b.elsewhere_bwar end end as elsewhere_bwar,
    case when a.reached_mlb_verified is true then war.bwar_last_season end as bwar_last_season,
    (a.reached_mlb_verified is true and war.bwar_last_season >= extract(year from coalesce(d.analysis_as_of_date, b.analysis_as_of_date))::int - 1) as career_still_accruing,
    d.attributable_organizational_bwar as dodgers_attributable_organizational_bwar,
    d.attributable_value_basis as dodgers_attributable_value_basis,
    d.organizational_realization_status as dodgers_realization_status,
    coalesce(d.known_acquisition_cost_usd, b.known_acquisition_cost_usd) as known_acquisition_cost_usd,
    coalesce(d.acquisition_cost_completeness, b.acquisition_cost_completeness) as acquisition_cost_completeness,
    coalesce(d.analysis_as_of_date, b.analysis_as_of_date) as analysis_as_of_date
  from public.signings s
  join public.players pl on pl.id = s.player_id
  join public.organizations o on o.id = s.organization_id
  left join public.v_player_organizational_realization d on d.signing_id = s.id and o.franchise_key = 'DODGERS'
  left join public.v_international_benchmark_player_outcomes b on b.signing_id = s.id and o.franchise_key <> 'DODGERS'
  left join public.outcome_audits a on a.player_id = pl.id
  left join public.outcomes oc on oc.player_id = pl.id
  left join war on war.bref_id = pl.bref_id
  where d.signing_id is not null or b.signing_id is not null
)
select * from m;

comment on view public.v_player_realized_outcome is
  'Realized-outcome spine (Migration 036), one row per tracked signing: DODGERS_TRACKED rows come from v_player_organizational_realization (032-034), TOP_PROSPECT_BENCHMARK rows from v_international_benchmark_player_outcomes (035). outcome_state UNAUDITED keeps a NULL reach flag (never "no MLB"). career_bwar, signing_org_bwar and elsewhere_bwar are Baseball-Reference team-season sums and are NULL unless the player reached MLB; a side with no loaded season is NULL, not zero. dodgers_attributable_organizational_bwar is Dodgers organizational value (direct plus attributable trade return, 034) and is NULL for benchmark rows: career outcome is not organizational value. career_still_accruing marks a loaded MLB season in the as-of year or the one before. Nothing here is recomputed; read the source layers for the derivations.';

-- One row per ACTIVE external expectation observation: each ranking, and each OVERALL / FUTURE (FV) grade with a numeric base, of
-- an EXTERNAL or TEAM_PUBLIC publication (DISI_RESEARCH, DRAFT and SUPERSEDED evaluations are excluded, as in every 026 view).
-- The band is the publication's own measure; debut_order says whether the observation preceded the MLB debut.
create or replace view public.v_scouting_expectation_observations
with (security_invoker = true)
as
with m as materialized (
  with obs as (
    select e.id as evaluation_id, e.player_id, e.publication_id, e.evaluation_context, e.date_precision, e.evaluation_date,
      e.evaluation_year, e.evaluation_month, e.organization_id as evaluation_organization_id, e.eta_season, e.evidence_basis,
      e.confidence::text as evaluation_confidence,
      'RANK'::text as measure, r.ranking_scope, r.scope_label, r.list_size, r.rank::numeric as measure_value, r.rank::text as measure_label,
      null::text as grade_qualifier, null::text as scale_code, null::text as dimension_code, null::text as temporal_basis
    from public.player_evaluations e
    join public.scouting_publications sp on sp.id = e.publication_id
    join public.player_evaluation_rankings r on r.evaluation_id = e.id
    where e.record_status = 'ACTIVE' and sp.origin in ('EXTERNAL', 'TEAM_PUBLIC')
    union all
    select e.id, e.player_id, e.publication_id, e.evaluation_context, e.date_precision, e.evaluation_date,
      e.evaluation_year, e.evaluation_month, e.organization_id, e.eta_season, e.evidence_basis,
      e.confidence::text,
      'GRADE', null, null, null, g.raw_value, coalesce(g.raw_label, g.raw_value::text),
      g.qualifier, g.scale_code, g.dimension_code, g.temporal_basis
    from public.player_evaluations e
    join public.scouting_publications sp on sp.id = e.publication_id
    join public.player_evaluation_grades g on g.evaluation_id = e.id
    where e.record_status = 'ACTIVE' and sp.origin in ('EXTERNAL', 'TEAM_PUBLIC')
      and g.dimension_code = 'OVERALL' and g.temporal_basis = 'FUTURE' and g.raw_value is not null
  ),
  debut as (
    select pl.id as player_id, least(pl.mlb_debut_date, oc.mlb_debut_date) as mlb_debut_date
    from public.players pl left join public.outcomes oc on oc.player_id = pl.id
  )
  select
    o.evaluation_id, o.player_id, pl.slug as player_slug, pl.full_name,
    s.id as signing_id, so.abbreviation as signing_organization, (so.franchise_key = 'DODGERS') as is_dodgers, s.signing_year,
    sp.publication_slug, sp.publication_name, sp.publication_kind, sp.origin as publication_origin,
    o.evaluation_context, o.evidence_basis, o.evaluation_confidence,
    o.date_precision, o.evaluation_date, o.evaluation_year, o.evaluation_month,
    eo.abbreviation as evaluation_organization, o.eta_season,
    o.measure, o.ranking_scope, o.scope_label, o.list_size, o.measure_value, o.measure_label, o.grade_qualifier,
    o.scale_code, o.dimension_code, o.temporal_basis,
    b.band_family, b.band_code, b.band_order, b.band_label,
    case when b.band_code is null then 'NO_BAND_DEFINED' else 'BANDED' end as banding_state,
    case when o.date_precision = 'DAY' and pl.birth_date is not null then extract(year from age(o.evaluation_date, pl.birth_date))::int end as age_at_evaluation_exact,
    case when o.evaluation_year is not null and pl.birth_date is not null then o.evaluation_year - extract(year from pl.birth_date)::int end as age_in_evaluation_year,
    d.mlb_debut_date,
    case
      when d.mlb_debut_date is null then 'NO_DEBUT'
      when o.date_precision = 'DAY' then case when o.evaluation_date < d.mlb_debut_date then 'PRE_DEBUT' else 'POST_DEBUT' end
      when o.date_precision = 'MONTH' then case
        when (make_date(o.evaluation_year, o.evaluation_month, 1) + interval '1 month')::date <= d.mlb_debut_date then 'PRE_DEBUT'
        when make_date(o.evaluation_year, o.evaluation_month, 1) > d.mlb_debut_date then 'POST_DEBUT'
        else 'ORDER_AMBIGUOUS' end
      when o.evaluation_year is not null then case
        when o.evaluation_year < extract(year from d.mlb_debut_date)::int then 'PRE_DEBUT'
        when o.evaluation_year > extract(year from d.mlb_debut_date)::int then 'POST_DEBUT'
        else 'ORDER_AMBIGUOUS' end
      else 'ORDER_AMBIGUOUS'
    end as debut_order
  from obs o
  join public.players pl on pl.id = o.player_id
  join public.scouting_publications sp on sp.id = o.publication_id
  left join public.signings s on s.player_id = o.player_id
  left join public.organizations so on so.id = s.organization_id
  left join public.organizations eo on eo.id = o.evaluation_organization_id
  left join debut d on d.player_id = o.player_id
  left join lateral (
    select sb.band_family, sb.band_code, sb.band_order, sb.band_label
    from public.scouting_expectation_bands sb
    where sb.publication_id = o.publication_id and sb.measure = o.measure
      and (o.measure <> 'RANK' or (sb.ranking_scope = o.ranking_scope and (sb.required_list_size is null or sb.required_list_size = o.list_size)))
      and (o.measure <> 'GRADE' or (sb.scale_code = o.scale_code and sb.dimension_code = o.dimension_code and sb.temporal_basis = o.temporal_basis))
      and o.measure_value >= sb.lower_value and (sb.upper_value is null or o.measure_value <= sb.upper_value)
    order by sb.band_order
    limit 1
  ) b on true
)
select * from m;

comment on view public.v_scouting_expectation_observations is
  'Every ACTIVE external expectation observation (Migration 036): each ranking and each OVERALL / FUTURE (FV) grade of an EXTERNAL or TEAM_PUBLIC publication, exactly as recorded by 026 (sealed point-in-time snapshots; nothing is rescaled or revised with hindsight). band_code is the publication''s own band (NULL with banding_state NO_BAND_DEFINED when no reviewed band covers the measure); a grade bands on its numeric base and keeps its +/- qualifier here. debut_order compares the evaluation date with the MLB debut at the evaluation''s own date precision: PRE_DEBUT, POST_DEBUT, ORDER_AMBIGUOUS (same year or month) or NO_DEBUT.';

-- One row per player and band family, anchored on the earliest pre-debut (or no-debut) banded observation of that family, plus one
-- row per tracked signing without any banded pre-debut observation. The anchor is a frozen historical expectation: later
-- evaluations and outcome fields never move it.
create or replace view public.v_player_expectation_vs_outcome
with (security_invoker = true)
as
with m as materialized (
  with obs as (select * from public.v_scouting_expectation_observations),
  anchors as (
    select distinct on (o.player_id, o.band_family) o.*
    from obs o
    where o.banding_state = 'BANDED' and o.debut_order in ('PRE_DEBUT', 'NO_DEBUT')
    order by o.player_id, o.band_family, o.evaluation_year nulls last, coalesce(o.evaluation_month, 0), o.evaluation_date nulls first, o.band_order, o.evaluation_id
  ),
  fam as (
    select o.player_id, o.band_family, count(*)::int as family_observations,
      count(*) filter (where o.debut_order in ('POST_DEBUT', 'ORDER_AMBIGUOUS'))::int as excluded_post_debut_observations
    from obs o where o.banding_state = 'BANDED'
    group by o.player_id, o.band_family
  ),
  r as (select * from public.v_player_realized_outcome),
  rows_ as (
    select a.player_id, a.band_family, a.band_code, a.band_order, a.band_label, a.evaluation_id, a.publication_slug, a.measure,
      a.measure_value, a.measure_label, a.grade_qualifier, a.list_size, a.date_precision, a.evaluation_date, a.evaluation_year,
      a.age_at_evaluation_exact, a.age_in_evaluation_year, a.debut_order as anchor_debut_order,
      f.family_observations, f.excluded_post_debut_observations
    from anchors a join fam f on f.player_id = a.player_id and f.band_family = a.band_family
    union all
    select r.player_id, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 0, 0
    from r where not exists (select 1 from anchors a where a.player_id = r.player_id)
  ),
  j as (
    select x.*, sb.family_label, sb.expectation_statement, sb.population_label, sb.met_career_bwar_floor, sb.exceeded_career_bwar_floor,
      r.signing_id, r.player_slug, r.full_name, r.organization, r.is_dodgers, r.outcome_scope, r.signing_year, r.pathway,
      r.position_group, r.identity_resolved, r.outcome_state, r.reached_mlb_verified, r.outcome_maturity, r.mlb_debut_date,
      r.years_signing_to_debut_season, r.career_bwar, r.signing_org_bwar, r.elsewhere_bwar, r.career_still_accruing,
      r.dodgers_attributable_organizational_bwar, r.known_acquisition_cost_usd, r.acquisition_cost_completeness, r.analysis_as_of_date
    from rows_ x
    left join public.scouting_expectation_bands sb on sb.band_code = x.band_code
    left join r on r.player_id = x.player_id
  ),
  st as (
    select j.*,
      case
        when j.band_code is null then 'INSUFFICIENT_EXPECTATION_DATA'
        when j.signing_id is null then 'OUTCOME_INCOMPLETE'
        when j.reached_mlb_verified is null then case when j.outcome_maturity = 'MATURE' then 'OUTCOME_INCOMPLETE' else 'TOO_EARLY' end
        when j.reached_mlb_verified then case
          when j.exceeded_career_bwar_floor is not null and j.career_bwar >= j.exceeded_career_bwar_floor then 'EXPECTATION_EXCEEDED'
          when j.met_career_bwar_floor is null then 'EXPECTATION_MET'
          when j.career_bwar is null then 'OUTCOME_INCOMPLETE'
          when j.career_bwar >= j.met_career_bwar_floor then 'EXPECTATION_MET'
          when j.career_still_accruing or j.outcome_maturity <> 'MATURE' then 'TOO_EARLY'
          else 'EXPECTATION_UNDERPERFORMED' end
        when j.outcome_maturity <> 'MATURE' then 'TOO_EARLY'
        when j.outcome_state = 'NO_MLB_ACTIVE_IN_MINORS' then 'TOO_EARLY'
        else 'EXPECTATION_UNDERPERFORMED'
      end as comparison_state,
      case
        when j.band_code is null then 'NO_BANDED_PRE_DEBUT_EXPECTATION'
        when j.signing_id is null then 'NO_TRACKED_SIGNING'
        when j.reached_mlb_verified is null then case when j.outcome_maturity = 'MATURE' then 'OUTCOME_UNAUDITED' else 'NOT_MATURE' end
        when j.reached_mlb_verified then case
          when j.exceeded_career_bwar_floor is not null and j.career_bwar >= j.exceeded_career_bwar_floor then 'CAREER_BWAR_AT_OR_ABOVE_EXCEEDED_FLOOR'
          when j.met_career_bwar_floor is null then 'REACHED_MLB'
          when j.career_bwar is null then 'REACHED_WITHOUT_BWAR_FACTS'
          when j.career_bwar >= j.met_career_bwar_floor then 'CAREER_BWAR_AT_OR_ABOVE_MET_FLOOR'
          when j.career_still_accruing then 'MLB_CAREER_ACCRUING'
          when j.outcome_maturity <> 'MATURE' then 'NOT_MATURE'
          else 'CAREER_BWAR_BELOW_MET_FLOOR' end
        when j.outcome_maturity <> 'MATURE' then 'NOT_MATURE'
        when j.outcome_state = 'NO_MLB_ACTIVE_IN_MINORS' then 'ACTIVE_WITHOUT_DEBUT'
        else 'NO_MLB_THROUGH_AS_OF_DATE'
      end as state_reason
    from j
  )
  select
    st.player_id, st.player_slug, st.full_name, st.signing_id, st.organization, st.is_dodgers, st.outcome_scope, st.signing_year, st.pathway,
    st.position_group,
    st.band_family, st.family_label, st.band_code, st.band_order, st.band_label, st.population_label, st.expectation_statement,
    st.evaluation_id as anchor_evaluation_id, st.publication_slug, st.measure, st.measure_value, st.measure_label, st.grade_qualifier, st.list_size,
    st.date_precision as anchor_date_precision, st.evaluation_date as anchor_evaluation_date, st.evaluation_year as anchor_evaluation_year,
    st.age_at_evaluation_exact, st.age_in_evaluation_year, st.anchor_debut_order,
    st.family_observations, st.excluded_post_debut_observations,
    st.met_career_bwar_floor, st.exceeded_career_bwar_floor,
    st.identity_resolved, st.outcome_state, st.reached_mlb_verified, st.outcome_maturity, st.mlb_debut_date, st.years_signing_to_debut_season,
    st.career_bwar, st.signing_org_bwar, st.elsewhere_bwar, st.career_still_accruing,
    st.dodgers_attributable_organizational_bwar, st.known_acquisition_cost_usd, st.acquisition_cost_completeness,
    st.comparison_state, st.state_reason,
    (st.comparison_state in ('EXPECTATION_EXCEEDED', 'EXPECTATION_MET', 'EXPECTATION_UNDERPERFORMED')
      and st.outcome_maturity = 'MATURE' and not st.career_still_accruing
      and st.outcome_state not in ('NO_MLB_ACTIVE_IN_MINORS', 'NO_MLB_STATUS_UNKNOWN')) as outcome_settled,
    st.analysis_as_of_date
  from st
)
select * from m;

comment on view public.v_player_expectation_vs_outcome is
  'Expectation vs realized outcome (Migration 036): one row per player and band family, anchored on the earliest banded observation dated before the MLB debut (or with no debut), plus one INSUFFICIENT_EXPECTATION_DATA row per tracked signing with no such observation. The anchor is frozen: post-debut and order-ambiguous evaluations are counted in excluded_post_debut_observations and never anchor, and no outcome field moves it. comparison_state applies the band''s stated DISI-convention rule: EXPECTATION_EXCEEDED / EXPECTATION_MET / EXPECTATION_UNDERPERFORMED, TOO_EARLY (not mature, still active without a debut, or an accruing MLB career below the floor), OUTCOME_INCOMPLETE (unaudited when mature, or reached without loaded bWAR) and INSUFFICIENT_EXPECTATION_DATA. An unaudited or immature outcome is never a miss. outcome_settled is false while anything could still change (immature, accruing, active in the minors, or status unknown). States describe one public evaluation against one outcome; they are not a probability, an accuracy measure or a judgement of the evaluator.';

-- One row per band (every reviewed band, including bands with no anchored player): descriptive outcomes of the anchored players.
-- Counts use mature outcomes only; shares and the median appear only when at least 10 comparable outcomes exist.
create or replace view public.v_scouting_calibration_summary
with (security_invoker = true)
as
with m as materialized (
  with x as (select * from public.v_player_expectation_vs_outcome where band_code is not null),
  agg as (
    select x.band_code,
      count(*)::int as anchored_players,
      count(*) filter (where x.outcome_maturity = 'MATURE')::int as mature_players,
      count(*) filter (where x.outcome_maturity = 'MATURE' and x.comparison_state in ('EXPECTATION_EXCEEDED', 'EXPECTATION_MET', 'EXPECTATION_UNDERPERFORMED'))::int as comparable_outcomes,
      count(*) filter (where x.outcome_maturity = 'MATURE' and x.comparison_state in ('EXPECTATION_EXCEEDED', 'EXPECTATION_MET', 'EXPECTATION_UNDERPERFORMED') and x.reached_mlb_verified)::int as comparable_reached_mlb,
      count(*) filter (where x.outcome_maturity = 'MATURE' and x.comparison_state in ('EXPECTATION_EXCEEDED', 'EXPECTATION_MET'))::int as comparable_met_or_exceeded,
      count(*) filter (where x.outcome_maturity = 'MATURE' and x.comparison_state = 'EXPECTATION_EXCEEDED')::int as comparable_exceeded,
      count(*) filter (where x.outcome_maturity = 'MATURE' and x.comparison_state = 'EXPECTATION_UNDERPERFORMED')::int as comparable_underperformed,
      count(*) filter (where x.comparison_state = 'TOO_EARLY')::int as too_early,
      count(*) filter (where x.comparison_state = 'OUTCOME_INCOMPLETE')::int as outcome_incomplete,
      sum(x.career_bwar) filter (where x.outcome_maturity = 'MATURE' and x.reached_mlb_verified) as comparable_career_bwar_total,
      sum(x.signing_org_bwar) filter (where x.outcome_maturity = 'MATURE' and x.reached_mlb_verified) as comparable_signing_org_bwar_total,
      percentile_cont(0.5) within group (order by x.career_bwar) filter (where x.outcome_maturity = 'MATURE' and x.reached_mlb_verified) as median_career_bwar_of_reached,
      array_agg(distinct x.anchor_evaluation_year order by x.anchor_evaluation_year) as evaluation_years,
      count(distinct x.organization)::int as signing_organizations
    from x group by x.band_code
  )
  select
    sb.band_family, sb.family_label, sp.publication_slug, sb.measure, sb.band_order, sb.band_code, sb.band_label, sb.population_label,
    sb.met_career_bwar_floor, sb.exceeded_career_bwar_floor,
    coalesce(a.anchored_players, 0) as anchored_players,
    coalesce(a.mature_players, 0) as mature_players,
    coalesce(a.comparable_outcomes, 0) as comparable_outcomes,
    coalesce(a.comparable_reached_mlb, 0) as comparable_reached_mlb,
    coalesce(a.comparable_met_or_exceeded, 0) as comparable_met_or_exceeded,
    coalesce(a.comparable_exceeded, 0) as comparable_exceeded,
    coalesce(a.comparable_underperformed, 0) as comparable_underperformed,
    coalesce(a.too_early, 0) as too_early,
    coalesce(a.outcome_incomplete, 0) as outcome_incomplete,
    case when a.comparable_outcomes >= 10 then round(a.comparable_reached_mlb::numeric / a.comparable_outcomes, 3) end as reached_mlb_share,
    case when a.comparable_outcomes >= 10 then round(a.comparable_met_or_exceeded::numeric / a.comparable_outcomes, 3) end as met_or_exceeded_share,
    round(a.comparable_career_bwar_total, 1) as comparable_career_bwar_total,
    round(a.comparable_signing_org_bwar_total, 1) as comparable_signing_org_bwar_total,
    case when a.comparable_outcomes >= 10 and a.comparable_reached_mlb > 0 then round(a.median_career_bwar_of_reached::numeric, 1) end as median_career_bwar_of_reached,
    a.evaluation_years,
    coalesce(a.signing_organizations, 0) as signing_organizations,
    10 as minimum_comparable_sample,
    case when coalesce(a.comparable_outcomes, 0) >= 10 then 'DESCRIPTIVE_SAMPLE' else 'INSUFFICIENT_SAMPLE' end as sample_state,
    'Descriptive outcomes of the players this band anchored, within one publication''s own measure; a sample, not a census. Not a probability, a hit rate or an accuracy measure, and never comparable across band families.'::text as interpretation
  from public.scouting_expectation_bands sb
  join public.scouting_publications sp on sp.id = sb.publication_id
  left join agg a on a.band_code = sb.band_code
)
select * from m;

comment on view public.v_scouting_calibration_summary is
  'Descriptive band outcomes (Migration 036): one row per reviewed expectation band, with the anchored players of v_player_expectation_vs_outcome. Comparable outcomes are mature and settled into MET / EXCEEDED / UNDERPERFORMED; TOO_EARLY and OUTCOME_INCOMPLETE are counted separately and never as misses. reached_mlb_share, met_or_exceeded_share and the median career bWAR of the reached players appear only when the band has at least 10 comparable outcomes (sample_state DESCRIPTIVE_SAMPLE); otherwise INSUFFICIENT_SAMPLE. population_label states what kind of sample the band reads (a Top-prospect tracker is rank-selected). Never a probability, hit rate or accuracy, and never compared across band families.';

-- Research queue: comparisons worth a human look, and gaps that block a comparison. Issues are new to 036; the 026 scouting queue
-- keeps PLAYER_WITHOUT_SCOUTING_HISTORY, SIGNING_WITHOUT_SIGNING_EVALUATION and LEGACY_RANK_WITHOUT_EVALUATION.
create or replace view public.v_scouting_expectation_research_queue
with (security_invoker = true)
as
with m as materialized (
  with x as (select * from public.v_player_expectation_vs_outcome),
  lowest as (select band_family, max(band_order) as lowest_order from public.scouting_expectation_bands group by band_family)
  select 'TOP_BAND_EXPECTATION_UNDERPERFORMED'::text as issue, 2 as priority, x.player_id, x.player_slug, x.full_name, x.band_family, x.band_code,
    x.anchor_evaluation_id as evaluation_id,
    format('Top band (%s) of %s; outcome %s (%s) as of %s. Review the evaluation context; this is not a verdict on the evaluator.', x.band_label, x.family_label,
      x.outcome_state, x.state_reason, x.analysis_as_of_date) as detail
  from x where x.band_order = 1 and x.comparison_state = 'EXPECTATION_UNDERPERFORMED'
  union all
  select 'LOWER_BAND_EXPECTATION_EXCEEDED', 2, x.player_id, x.player_slug, x.full_name, x.band_family, x.band_code, x.anchor_evaluation_id,
    format('%s of %s; %s career bWAR exceeds the band''s %s floor.', x.band_label, x.family_label, x.career_bwar, x.exceeded_career_bwar_floor)
  from x where x.band_order > 1 and x.comparison_state = 'EXPECTATION_EXCEEDED'
  union all
  select 'LOWEST_BAND_REACHED_MLB', 3, x.player_id, x.player_slug, x.full_name, x.band_family, x.band_code, x.anchor_evaluation_id,
    format('%s (the lowest band of %s) and reached MLB.', x.band_label, x.family_label)
  from x join lowest l on l.band_family = x.band_family
  where x.band_order = l.lowest_order and x.band_order > 1 and x.reached_mlb_verified is true and x.comparison_state <> 'EXPECTATION_EXCEEDED'
  union all
  select 'EXPECTATION_COMPARISON_OUTCOME_INCOMPLETE', 2, x.player_id, x.player_slug, x.full_name, x.band_family, x.band_code, x.anchor_evaluation_id,
    format('Expectation anchored (%s) but the outcome is incomplete (%s).', x.band_label, x.state_reason)
  from x where x.band_code is not null and x.comparison_state = 'OUTCOME_INCOMPLETE'
  union all
  select 'MLB_REACHER_WITHOUT_PRE_DEBUT_EXPECTATION', case when x.career_bwar >= 10 then 2 else 3 end, x.player_id, x.player_slug, x.full_name,
    null, null, null,
    format('Reached MLB (%s career bWAR) with no banded public expectation dated before the debut; a pre-debut rank or FV would extend the expectation sample.',
      coalesce(x.career_bwar::text, 'no loaded'))
  from x where x.band_code is null and x.reached_mlb_verified is true
  union all
  select 'EXPECTATION_MEASURE_NOT_BANDED', 3, o.player_id, o.player_slug, o.full_name, null, null, o.evaluation_id,
    format('%s %s %s (%s) has no reviewed expectation band; add a band for this publication and measure before comparing it.',
      o.publication_slug, lower(o.measure), o.measure_label, coalesce(o.ranking_scope, o.scale_code))
  from public.v_scouting_expectation_observations o where o.banding_state = 'NO_BAND_DEFINED'
  union all
  select 'POST_DEBUT_EVALUATION_EXCLUDED', 3, o.player_id, o.player_slug, o.full_name, o.band_family, o.band_code, o.evaluation_id,
    format('%s evaluation (%s) is %s relative to the MLB debut %s; it is kept as history but never anchors an expectation.',
      o.publication_slug, coalesce(o.evaluation_date::text, o.evaluation_year::text, 'undated'), o.debut_order, o.mlb_debut_date)
  from public.v_scouting_expectation_observations o where o.debut_order in ('POST_DEBUT', 'ORDER_AMBIGUOUS')
)
select * from m;

comment on view public.v_scouting_expectation_research_queue is
  'Expectation research queue (Migration 036). Review items (TOP_BAND_EXPECTATION_UNDERPERFORMED, LOWER_BAND_EXPECTATION_EXCEEDED, LOWEST_BAND_REACHED_MLB) are prompts to examine an evaluation in context, not judgements; coverage items (EXPECTATION_COMPARISON_OUTCOME_INCOMPLETE, MLB_REACHER_WITHOUT_PRE_DEBUT_EXPECTATION, EXPECTATION_MEASURE_NOT_BANDED, POST_DEBUT_EVALUATION_EXCLUDED) say what would extend or unblock the comparison. Missing scouting history in general stays in v_scouting_research_queue.';
