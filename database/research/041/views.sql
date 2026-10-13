-- ===========================================================================
-- Migration 041 views: training population, feature matrix, target support, model evaluation, outcome probability, research queue
-- ===========================================================================

-- One row per signing and target: the label on a fixed, fully elapsed horizon, and why the row may or may not train anything.
-- A row is never negative because it is unaudited, young, active or not yet past its horizon.
create or replace view public.v_outcome_training_population
with (security_invoker = true)
as
with m as materialized (
  with f as materialized (select * from public.v_signing_time_features),
  r as materialized (select * from public.v_player_realized_outcome),
  last_season as (
    select case when ao.d >= make_date(extract(year from ao.d)::int, 10, 1) then extract(year from ao.d)::int else extract(year from ao.d)::int - 1 end as last_complete_season,
      ao.d as analysis_as_of_date
    from (select max(audited_through_date) as d from public.outcome_audits) ao
  ),
  war as materialized (
    select pl.id as player_id, w.season, sum(w.war) as war, sum(w.war) filter (where og.franchise_key = 'DODGERS') as dodgers_war, count(*)::int as war_rows
    from public.player_mlb_team_season_war w
    join public.players pl on pl.bref_id = w.bref_id
    left join public.organizations og on og.id = w.organization_id
    where w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
    group by pl.id, w.season
  ),
  base0 as materialized (
    select f.signing_id, f.player_id, f.player_slug, f.is_dodgers, f.population_class, f.signing_route, f.signing_year, f.signing_cutoff_date,
      t.target_key, t.horizon_seasons, t.applies_to, t.threshold_bwar,
      f.signing_year + t.horizon_seasons as horizon_end_season,
      (f.signing_year + t.horizon_seasons <= ls.last_complete_season) as exposure_complete,
      r.reached_mlb_verified, r.years_signing_to_debut_season, r.audited_through_date, ls.last_complete_season, ls.analysis_as_of_date
    from f
    join r on r.signing_id = f.signing_id
    cross join public.outcome_targets t
    cross join last_season ls
  ),
  -- team-season bWAR inside each label window: one grouped join, not a subquery per row
  base as (
    select b.*, coalesce(sum(w.war_rows), 0)::int as window_war_rows, sum(w.war) as window_bwar, sum(w.dodgers_war) as window_dodgers_bwar
    from base0 b
    left join war w on w.player_id = b.player_id and w.season <= b.horizon_end_season
    group by b.signing_id, b.player_id, b.player_slug, b.is_dodgers, b.population_class, b.signing_route, b.signing_year, b.signing_cutoff_date,
      b.target_key, b.horizon_seasons, b.applies_to, b.threshold_bwar, b.horizon_end_season, b.exposure_complete, b.reached_mlb_verified,
      b.years_signing_to_debut_season, b.audited_through_date, b.last_complete_season, b.analysis_as_of_date
  ),
  lab as (
    select b.*,
      case
        when b.applies_to = 'DODGERS_ONLY' and not b.is_dodgers then null
        when b.reached_mlb_verified is null then null
        when b.target_key = 'REACH_MLB_WITHIN_7_SEASONS' then (b.reached_mlb_verified and b.years_signing_to_debut_season <= b.horizon_seasons)
        when not b.reached_mlb_verified then false
        when b.window_war_rows = 0 and b.years_signing_to_debut_season > b.horizon_seasons then false
        when b.window_war_rows = 0 then null
        when b.target_key = 'POSITIVE_BWAR_WITHIN_10_SEASONS' then b.window_bwar > 0
        when b.target_key = 'BWAR_2_WITHIN_10_SEASONS' then b.window_bwar >= b.threshold_bwar
        when b.target_key = 'DODGERS_MLB_VALUE_WITHIN_10_SEASONS' then coalesce(b.window_dodgers_bwar, 0) > 0
      end as label
    from base b
  )
  select l.signing_id, l.player_id, l.player_slug, l.is_dodgers, l.population_class, l.signing_route, l.signing_year, l.signing_cutoff_date,
    l.target_key, l.horizon_seasons, l.horizon_end_season, l.last_complete_season, l.exposure_complete,
    case when l.exposure_complete then l.label end as label,
    case
      when l.population_class = 'OUTCOME_SELECTED_SAMPLE' then 'OUT_OF_SCOPE'
      when l.signing_route = 'PROFESSIONAL_SIGNING' then 'OUT_OF_SCOPE'
      when l.applies_to = 'DODGERS_ONLY' and not l.is_dodgers then 'OUT_OF_SCOPE'
      when not l.exposure_complete then 'CENSORED'
      when l.label is null then 'OUTCOME_UNAUDITED'
      when l.population_class = 'TOP_PROSPECT_SAMPLE' then 'BENCHMARK_SAMPLE_ONLY'
      when l.population_class in ('TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS') then 'TRAINING_ELIGIBLE'
      else 'OUT_OF_SCOPE'
    end as training_state,
    case
      when l.population_class = 'OUTCOME_SELECTED_SAMPLE' then 'OUTCOME_SELECTED_POPULATION'
      when l.signing_route = 'PROFESSIONAL_SIGNING' then 'PROFESSIONAL_ROUTE'
      when l.applies_to = 'DODGERS_ONLY' and not l.is_dodgers then 'TARGET_NOT_APPLICABLE'
      when not l.exposure_complete then 'HORIZON_NOT_ELAPSED'
      when l.label is null then 'LABEL_NOT_ESTABLISHED'
    end as training_exclusion_reason,
    case
      when l.population_class in ('TRACKED_SAMPLE', 'OPENING_CLASS_CENSUS') then 'DODGERS_TRACKED_AND_OPENING_CLASS'
      when l.population_class = 'TOP_PROSPECT_SAMPLE' then 'TOP_PROSPECT_SAMPLE'
    end as reference_population,
    l.reached_mlb_verified, l.years_signing_to_debut_season, l.window_bwar, l.window_dodgers_bwar, l.analysis_as_of_date
  from lab l
)
select * from m;

comment on view public.v_outcome_training_population is
  'Outcome training population (Migration 041): one row per signing and target (outcome_targets). The label is defined on a fixed horizon (signing year + horizon_seasons) and only once that horizon has fully elapsed (horizon_end_season <= last complete MLB season); before that the row is CENSORED with a NULL label, never negative. An unaudited outcome or a reacher without loaded bWAR facts is OUTCOME_UNAUDITED. training_state: OUT_OF_SCOPE (outcome-selected historical set, professional route, Dodgers-only target for a non-Dodgers signing), CENSORED, OUTCOME_UNAUDITED, BENCHMARK_SAMPLE_ONLY (labelled rank-selected top-prospect rows: their own reference population, never pooled into Dodgers estimates), TRAINING_ELIGIBLE (labelled tracked / opening-class Dodgers rows). No state is ever coerced to a negative label.';

-- One row per signing: the signing-time features (039) a model may use, with their as-of date and completeness. No outcome, no
-- development, no later evaluation.
create or replace view public.v_outcome_feature_matrix
with (security_invoker = true)
as
with m as materialized (
  select f.signing_id, f.player_id, f.player_slug, f.population_class, f.signing_route, f.signing_year,
    f.feature_as_of_date, f.cutoff_precision,
    f.age_in_signing_year, f.age_band, f.position_family, (f.position_family = 'PITCHER') as is_pitcher,
    f.market_group, (f.market_group = 'DOMINICAN_REPUBLIC') as is_dominican_republic, (f.market_group = 'VENEZUELA') as is_venezuela,
    f.expectation_tier, (f.expectation_tier = 'TOP_BAND') as is_top_expectation_band, f.expectation_evaluation_id,
    f.cost_band, f.signing_bonus_usd, f.era_key,
    f.has_age, f.has_position, f.has_market, f.has_bonus, f.has_expectation,
    (f.has_age and f.has_position and f.has_market) as model_features_complete,
    case when not f.has_age then 'AGE_UNKNOWN' when not f.has_position then 'POSITION_AT_SIGNING_UNKNOWN' when not f.has_market then 'MARKET_UNKNOWN' end as feature_gap
  from public.v_signing_time_features f
)
select * from m;

comment on view public.v_outcome_feature_matrix is
  'Outcome feature matrix (Migration 041): the signing-time features of v_signing_time_features in model-ready form, each available at feature_as_of_date (the signing cutoff). Bonus is shown but is not a model feature: it is known for few Dodgers signings and the known ones are selection-biased. model_features_complete requires age, position at signing and market; a missing feature is never imputed.';

-- One row per target and reference population: labelled n, positives, negatives, censored and unaudited counts, and whether an
-- empirical reference baseline is supported (n >= target minimum, positives and negatives >= their minimums), with a 90% Wilson interval.
create or replace view public.v_outcome_target_support
with (security_invoker = true)
as
with m as materialized (
  with p as (select * from public.v_outcome_training_population where reference_population is not null and training_state <> 'OUT_OF_SCOPE'),
  agg as (
    select p.target_key, p.reference_population,
      count(*)::int as population_rows,
      count(*) filter (where p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY'))::int as labelled_n,
      count(*) filter (where p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY') and p.label)::int as positive_n,
      count(*) filter (where p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY') and p.label = false)::int as negative_n,
      count(*) filter (where p.training_state = 'CENSORED')::int as censored_n,
      count(*) filter (where p.training_state = 'OUTCOME_UNAUDITED')::int as unaudited_n
    from p group by p.target_key, p.reference_population
  )
  select t.target_key, t.label as target_label, t.horizon_seasons, a.reference_population,
    a.population_rows, a.labelled_n, a.positive_n, a.negative_n, a.censored_n, a.unaudited_n,
    t.min_reference_n, t.min_positives, t.min_negatives,
    (a.labelled_n >= t.min_reference_n and a.positive_n >= t.min_positives and a.negative_n >= t.min_negatives) as baseline_supported,
    case when a.labelled_n >= t.min_reference_n and a.positive_n >= t.min_positives and a.negative_n >= t.min_negatives
      then round(a.positive_n::numeric / a.labelled_n, 4) end as baseline_probability,
    case when a.labelled_n >= t.min_reference_n and a.positive_n >= t.min_positives and a.negative_n >= t.min_negatives then round((
      ((a.positive_n::numeric / a.labelled_n) + 1.6449^2 / (2 * a.labelled_n)
        - 1.6449 * sqrt((a.positive_n::numeric / a.labelled_n) * (1 - a.positive_n::numeric / a.labelled_n) / a.labelled_n + 1.6449^2 / (4 * a.labelled_n^2)))
      / (1 + 1.6449^2 / a.labelled_n))::numeric, 4) end as baseline_probability_low_90,
    case when a.labelled_n >= t.min_reference_n and a.positive_n >= t.min_positives and a.negative_n >= t.min_negatives then round((
      ((a.positive_n::numeric / a.labelled_n) + 1.6449^2 / (2 * a.labelled_n)
        + 1.6449 * sqrt((a.positive_n::numeric / a.labelled_n) * (1 - a.positive_n::numeric / a.labelled_n) / a.labelled_n + 1.6449^2 / (4 * a.labelled_n^2)))
      / (1 + 1.6449^2 / a.labelled_n))::numeric, 4) end as baseline_probability_high_90,
    case
      when a.labelled_n >= t.min_reference_n and a.positive_n >= t.min_positives and a.negative_n >= t.min_negatives then 'BASELINE_SUPPORTED'
      when a.labelled_n = 0 then 'NO_LABELLED_OUTCOMES'
      else 'BASELINE_NOT_SUPPORTED'
    end as support_state,
    greatest(t.min_positives - a.positive_n, 0) as additional_positives_needed,
    greatest(t.min_reference_n - a.labelled_n, 0) as additional_labels_needed
  from public.outcome_targets t
  join agg a on a.target_key = t.target_key
)
select * from m;

comment on view public.v_outcome_target_support is
  'Target support (Migration 041): one row per target and reference population (DODGERS_TRACKED_AND_OPENING_CLASS or TOP_PROSPECT_SAMPLE; populations are never pooled). An empirical reference baseline is supported only when the labelled rows, positives and negatives reach the target''s minimums (outcome_targets); the baseline then carries a 90% Wilson score interval. Otherwise the probability columns are NULL and additional_*_needed says how far the evidence is from support.';

-- The recorded, deterministic build-time model evaluation (outcome_model_evaluations), with whether the live training set still
-- matches the fingerprint it was computed on.
create or replace view public.v_outcome_model_evaluation
with (security_invoker = true)
as
with m as materialized (
  with live as (
    select p.target_key,
      md5(string_agg(concat_ws('|', p.player_slug, p.label::text, p.population_class, coalesce(x.age_in_signing_year::text, ''), x.position_family,
        x.market_group, x.expectation_tier), E'\n' order by concat_ws('|', p.player_slug, p.label::text, p.population_class,
        coalesce(x.age_in_signing_year::text, ''), x.position_family, x.market_group, x.expectation_tier) collate "C")) as live_fingerprint,
      count(*)::int as live_rows
    from public.v_outcome_training_population p
    join public.v_outcome_feature_matrix x on x.signing_id = p.signing_id
    where p.training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY') and x.model_features_complete
    group by p.target_key
  )
  select e.target_key, e.model_key, e.model_version, e.validation_method, e.feature_list, e.training_populations, e.evaluated_rows, e.positive_n,
    e.folds, e.brier_score, e.log_loss, e.auc, e.brier_skill_vs_base_rate, e.calibration_bins, e.decision, e.decision_reason,
    e.training_fingerprint, e.data_as_of_date,
    (l.live_fingerprint is not distinct from e.training_fingerprint) as evaluation_current,
    l.live_rows
  from public.outcome_model_evaluations e
  left join live l on l.target_key = e.target_key
)
select * from m;

comment on view public.v_outcome_model_evaluation is
  'Model evaluation (Migration 041): the deterministic build-time evaluation stored in outcome_model_evaluations - an unconditional base rate, a population-stratified rate and an L2-regularised logistic regression on signing-time features, each under leave-one-signing-year-out validation (out-of-time; never in-sample), with Brier score, log loss, AUC (secondary), Brier skill against the base rate, calibration bins and the support decision. evaluation_current is false when the live training set no longer matches the fingerprint the evaluation was computed on (the evaluation must then be rebuilt before it is cited). No accuracy figure is reported.';

-- One row per signing and target: the probability DISI can responsibly show, or NULL with the reason.
create or replace view public.v_player_outcome_probability
with (security_invoker = true)
as
with m as materialized (
  with p as materialized (select * from public.v_outcome_training_population),
  s as materialized (select * from public.v_outcome_target_support),
  x as materialized (select * from public.v_outcome_feature_matrix),
  ev as (select target_key, bool_or(decision = 'MODEL_SUPPORTED') as model_supported,
           string_agg(format('%s: Brier skill %s (%s rows, %s positives, %s)', model_key, coalesce(brier_skill_vs_base_rate::text, 'n/a'), evaluated_rows, positive_n, validation_method), '; ' order by model_key) as evidence
         from public.outcome_model_evaluations group by target_key)
  select
    p.signing_id, p.player_id, p.player_slug, p.target_key, p.signing_cutoff_date as prediction_as_of_date,
    p.reference_population as training_population,
    s.labelled_n as training_n, s.positive_n,
    s.baseline_probability, s.baseline_probability_low_90, s.baseline_probability_high_90,
    case when x.model_features_complete then 1.0 else round(((x.has_age)::int + (x.has_position)::int + (x.has_market)::int)::numeric / 3, 3) end as feature_completeness,
    s.support_state as sample_state,
    case when ev.model_supported then 'MODEL_SUPPORTED' else 'MODEL_NOT_SUPPORTED' end as model_support_state,
    coalesce(ev.evidence, 'No model evaluation recorded for this target') as calibration_evidence,
    case
      when p.population_class = 'OUTCOME_SELECTED_SAMPLE' then 'OUTCOME_SELECTED_POPULATION'
      when p.signing_route = 'PROFESSIONAL_SIGNING' then 'PROFESSIONAL_ROUTE_NOT_MODELLED'
      when p.training_exclusion_reason = 'TARGET_NOT_APPLICABLE' then 'TARGET_NOT_APPLICABLE'
      when p.exposure_complete and p.label is not null then 'OUTCOME_ALREADY_OBSERVED'
      when p.exposure_complete then 'OUTCOME_UNAUDITED_PAST_HORIZON'
      when p.reference_population is distinct from 'DODGERS_TRACKED_AND_OPENING_CLASS' then 'NO_REFERENCE_POPULATION_FOR_THIS_POPULATION'
      when s.baseline_supported is not true then 'REFERENCE_POPULATION_NOT_SUPPORTED'
    end as prediction_exclusion_reason
  from p
  left join s on s.target_key = p.target_key and s.reference_population = p.reference_population
  left join x on x.signing_id = p.signing_id
  left join ev on ev.target_key = p.target_key
),
final as (
  select m.*, (m.prediction_exclusion_reason is null) as prediction_eligible from m
)
select f.signing_id, f.player_id, f.player_slug, f.target_key, f.prediction_as_of_date,
  case when f.prediction_eligible then f.baseline_probability end as probability,
  case when f.prediction_eligible then f.baseline_probability_low_90 end as probability_low_90,
  case when f.prediction_eligible then f.baseline_probability_high_90 end as probability_high_90,
  case when f.prediction_eligible then 'EMPIRICAL_REFERENCE_BASELINE' end as model_key,
  'outcome-probability-v1'::text as model_version,
  f.training_population, f.training_n, f.positive_n, f.feature_completeness, f.sample_state, f.model_support_state, f.calibration_evidence,
  f.prediction_eligible, f.prediction_exclusion_reason
from final f;

comment on view public.v_player_outcome_probability is
  'Outcome probability (Migration 041): one row per signing and target. probability is the empirical reference baseline of the player''s own reference population (with a 90% Wilson interval) ONLY when the outcome is still open, the player belongs to the tracked / opening-class Dodgers population (the only population predictions are made for), the route is amateur, and that population''s baseline is supported; it is NULL - never zero - otherwise, with prediction_exclusion_reason. No fitted model is used unless its recorded evaluation is MODEL_SUPPORTED. The probability describes the reference population, not the player.';

-- Research queue: what blocks support. Targets far from support, labels blocked by a missing audit, a stale evaluation.
create or replace view public.v_outcome_probability_research_queue
with (security_invoker = true)
as
with m as materialized (
  select 'TARGET_REFERENCE_NOT_SUPPORTED'::text as issue, 2 as priority, s.target_key, s.reference_population, null::text as player_slug,
    format('%s labelled rows (%s positive, %s negative); support needs %s rows, %s positives and %s negatives: %s more positive(s) and %s more labelled row(s).',
      s.labelled_n, s.positive_n, s.negative_n, s.min_reference_n, s.min_positives, s.min_negatives, s.additional_positives_needed, s.additional_labels_needed) as detail
  from public.v_outcome_target_support s where not s.baseline_supported
  union all
  select 'LABEL_BLOCKED_BY_MISSING_AUDIT', 2, p.target_key, p.reference_population, p.player_slug,
    format('The %s-season horizon has elapsed but the outcome is not established (unaudited, or a reacher without loaded bWAR facts).', p.horizon_seasons)
  from public.v_outcome_training_population p where p.training_state = 'OUTCOME_UNAUDITED'
  union all
  select 'MODEL_EVALUATION_STALE', 1, e.target_key, null, null,
    format('The %s evaluation was computed on a training set that no longer matches the live data; rebuild it before citing it.', e.model_key)
  from public.v_outcome_model_evaluation e where not e.evaluation_current
)
select * from m;

comment on view public.v_outcome_probability_research_queue is
  'Outcome-probability research queue (Migration 041): target / reference-population pairs below the support thresholds (with how many more positives and labels are needed), elapsed-horizon labels blocked by a missing audit or missing bWAR facts, and stored model evaluations whose training-set fingerprint no longer matches the live data.';
