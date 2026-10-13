-- DISI v0.32
-- 041_outcome_probability_infrastructure.sql
-- Outcome-probability infrastructure: reviewed targets with fixed, censoring-aware horizons; training eligibility; a leakage-safe
-- feature matrix; per-population support; a recorded, deterministic out-of-time model evaluation against a naive baseline; and
-- probabilities that are NULL - never zero - unless a reference population supports them. Run after 040.
--
-- Built from database/research/041/ (targets.json, evaluate.mjs -> evaluation.json, views.sql, build.mjs; design in
-- database/research/039/architecture-report.md).
--
-- What this is. Normal statistical computation from DISI facts; no provider judgement, no fitted coefficients unless the evaluation
-- supports a model (it does not on today's data). A label exists only after its horizon has fully elapsed; unaudited, censored,
-- young or active players are never negatives; the outcome-selected historical set and professional routes never train anything;
-- top-prospect sample rows are their own reference population and are never pooled into Dodgers estimates.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED TARGETS AND THE RECORDED EVALUATION (database/research/041/)
-- ===========================================================================

create temporary table _m041 on commit drop as
select $m041${"evaluations":[{"auc":null,"brier_score":0.124032,"brier_skill_vs_base_rate":0,"calibration_bins":[{"bin":"0-0.1","mean_predicted":0.088889,"n":14,"observed_rate":0.285714},{"bin":"0.1-0.2","mean_predicted":0.15544,"n":45,"observed_rate":0.088889},{"bin":"0.2-0.3","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.3-0.5","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.5-1","mean_predicted":null,"n":0,"observed_rate":null}],"data_as_of_date":"2026-10-05","decision":"BASELINE_REFERENCE","decision_reason":"Naive reference: the training-fold positive rate. 8 positives in 59 labelled rows of two reference populations; neither population reaches the 10-positive support minimum, so no baseline is shown for any player.","evaluated_rows":59,"feature_list":[],"folds":5,"log_loss":0.428292,"model_key":"BASE_RATE","model_version":"outcome-probability-v1","positive_n":8,"target_key":"REACH_MLB_WITHIN_7_SEASONS","training_fingerprint":"683251fe2e7522fcd346cf6a26004e08","training_populations":["DODGERS_TRACKED_AND_OPENING_CLASS","TOP_PROSPECT_SAMPLE"],"validation_method":"LEAVE_ONE_SIGNING_YEAR_OUT"},{"auc":0.355392,"brier_score":0.142827,"brier_skill_vs_base_rate":-0.151533,"calibration_bins":[{"bin":"0-0.1","mean_predicted":0.046667,"n":25,"observed_rate":0.24},{"bin":"0.1-0.2","mean_predicted":0.133333,"n":10,"observed_rate":0},{"bin":"0.2-0.3","mean_predicted":0.285714,"n":24,"observed_rate":0.083333},{"bin":"0.3-0.5","mean_predicted":null,"n":0,"observed_rate":null},{"bin":"0.5-1","mean_predicted":null,"n":0,"observed_rate":null}],"data_as_of_date":"2026-10-05","decision":"MODEL_NOT_SUPPORTED","decision_reason":"INSUFFICIENT_EVENTS: 8 positives for 1 feature(s); at least 10 are required (10 per feature). Out-of-time Brier skill against the base rate -0.151533.","evaluated_rows":59,"feature_list":["population_class"],"folds":5,"log_loss":0.843747,"model_key":"POPULATION_STRATIFIED_RATE","model_version":"outcome-probability-v1","positive_n":8,"target_key":"REACH_MLB_WITHIN_7_SEASONS","training_fingerprint":"683251fe2e7522fcd346cf6a26004e08","training_populations":["DODGERS_TRACKED_AND_OPENING_CLASS","TOP_PROSPECT_SAMPLE"],"validation_method":"LEAVE_ONE_SIGNING_YEAR_OUT"},{"auc":0.564951,"brier_score":0.13927,"brier_skill_vs_base_rate":-0.12286,"calibration_bins":[{"bin":"0-0.1","mean_predicted":0.055757,"n":31,"observed_rate":0.129032},{"bin":"0.1-0.2","mean_predicted":0.120473,"n":13,"observed_rate":0.153846},{"bin":"0.2-0.3","mean_predicted":0.248233,"n":7,"observed_rate":0.142857},{"bin":"0.3-0.5","mean_predicted":0.405556,"n":5,"observed_rate":0.2},{"bin":"0.5-1","mean_predicted":0.618952,"n":3,"observed_rate":0}],"data_as_of_date":"2026-10-05","decision":"MODEL_NOT_SUPPORTED","decision_reason":"INSUFFICIENT_EVENTS: 8 positives for 6 feature(s); at least 60 are required (10 per feature). Out-of-time Brier skill against the base rate -0.12286.","evaluated_rows":59,"feature_list":["is_top_prospect_sample","is_top_expectation_band","age_in_signing_year_minus_17","is_pitcher","is_dominican_republic","is_venezuela"],"folds":5,"log_loss":0.454953,"model_key":"LOGISTIC_L2","model_version":"outcome-probability-v1","positive_n":8,"target_key":"REACH_MLB_WITHIN_7_SEASONS","training_fingerprint":"683251fe2e7522fcd346cf6a26004e08","training_populations":["DODGERS_TRACKED_AND_OPENING_CLASS","TOP_PROSPECT_SAMPLE"],"validation_method":"LEAVE_ONE_SIGNING_YEAR_OUT"}],"targets":[{"applies_to":"ALL","events_per_feature":10,"horizon_seasons":7,"label":"MLB debut by signing year + 7 seasons","label_rule":"TRUE when the audited MLB debut season is at most signing year + 7; FALSE when the audited outcome is no MLB debut, or a debut after the horizon; NULL when unaudited.","min_negatives":10,"min_positives":10,"min_reference_n":50,"target_key":"REACH_MLB_WITHIN_7_SEASONS","threshold_bwar":null},{"applies_to":"ALL","events_per_feature":10,"horizon_seasons":10,"label":"Positive bWAR by signing year + 10 seasons","label_rule":"TRUE when the Baseball-Reference team-season bWAR of seasons up to signing year + 10 sums above 0; FALSE for an audited no-MLB outcome, a debut after the horizon, or a sum at or below 0; NULL when unaudited or a reacher has no loaded season.","min_negatives":10,"min_positives":10,"min_reference_n":50,"target_key":"POSITIVE_BWAR_WITHIN_10_SEASONS","threshold_bwar":0},{"applies_to":"ALL","events_per_feature":10,"horizon_seasons":10,"label":"2+ bWAR by signing year + 10 seasons","label_rule":"TRUE when the team-season bWAR of seasons up to signing year + 10 sums to 2 or more; otherwise as POSITIVE_BWAR_WITHIN_10_SEASONS.","min_negatives":10,"min_positives":10,"min_reference_n":50,"target_key":"BWAR_2_WITHIN_10_SEASONS","threshold_bwar":2},{"applies_to":"DODGERS_ONLY","events_per_feature":10,"horizon_seasons":10,"label":"Dodgers MLB bWAR above 0 by signing year + 10 seasons","label_rule":"Dodgers signings only: TRUE when the team-season bWAR with the Dodgers franchise in seasons up to signing year + 10 sums above 0; FALSE for no MLB, a debut after the horizon, or no positive Dodgers bWAR; NULL when unaudited.","min_negatives":10,"min_positives":10,"min_reference_n":50,"target_key":"DODGERS_MLB_VALUE_WITHIN_10_SEASONS","threshold_bwar":0}]}$m041$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
begin
  if to_regclass('public.v_player_comparables') is null or to_regclass('public.v_signing_time_features') is null then
    raise exception '041: Migrations 039 and 040 have not been applied';
  end if;
end $$;

-- ===========================================================================
-- 2. TABLES (written only by migrations)
-- ===========================================================================

create table if not exists public.outcome_targets (
  target_key text primary key check (target_key ~ '^[A-Z0-9_]+$'),
  label text not null check (btrim(label) <> ''),
  horizon_seasons integer not null check (horizon_seasons between 1 and 25),
  applies_to text not null check (applies_to in ('ALL', 'DODGERS_ONLY')),
  threshold_bwar numeric,
  label_rule text not null check (btrim(label_rule) <> '' and char_length(label_rule) <= 600),
  min_reference_n integer not null check (min_reference_n >= 30),
  min_positives integer not null check (min_positives >= 10),
  min_negatives integer not null check (min_negatives >= 10),
  events_per_feature integer not null check (events_per_feature >= 10),
  created_at timestamptz not null default now()
);

comment on table public.outcome_targets is
  'Outcome targets (Migration 041): fixed-horizon labels (seasons from the signing year) with the support thresholds every reference population must reach before an empirical baseline is shown, and the events-per-feature rule a fitted model must meet.';

create table if not exists public.outcome_model_evaluations (
  target_key text not null references public.outcome_targets(target_key) on delete restrict,
  model_key text not null check (model_key in ('BASE_RATE', 'POPULATION_STRATIFIED_RATE', 'LOGISTIC_L2')),
  model_version text not null check (btrim(model_version) <> ''),
  validation_method text not null check (validation_method = 'LEAVE_ONE_SIGNING_YEAR_OUT'),
  feature_list text[] not null,
  training_populations text[] not null,
  evaluated_rows integer not null check (evaluated_rows >= 0),
  positive_n integer not null check (positive_n >= 0 and positive_n <= evaluated_rows),
  folds integer not null check (folds >= 0),
  brier_score numeric,
  log_loss numeric,
  auc numeric check (auc is null or (auc >= 0 and auc <= 1)),
  brier_skill_vs_base_rate numeric,
  calibration_bins jsonb not null,
  decision text not null check (decision in ('MODEL_SUPPORTED', 'MODEL_NOT_SUPPORTED', 'BASELINE_REFERENCE')),
  decision_reason text not null check (btrim(decision_reason) <> ''),
  training_fingerprint text not null check (training_fingerprint ~ '^[0-9a-f]{32}$'),
  data_as_of_date date not null,
  created_at timestamptz not null default now(),
  primary key (target_key, model_key)
);

comment on table public.outcome_model_evaluations is
  'Recorded model evaluations (Migration 041): computed deterministically by database/research/041/evaluate.mjs from the canonical replay, out-of-time (leave one signing year out), with the training-set fingerprint so a stale evaluation is detectable. Coefficients are stored only for a MODEL_SUPPORTED model (none today).';

do $$
declare t text;
begin
  foreach t in array array['outcome_targets', 'outcome_model_evaluations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format('drop policy if exists public_read_%I on public.%I', t, t);
    execute format('create policy public_read_%I on public.%I for select to anon, authenticated using (true)', t, t);
  end loop;
end $$;

insert into public.outcome_targets (target_key, label, horizon_seasons, applies_to, threshold_bwar, label_rule, min_reference_n, min_positives, min_negatives, events_per_feature)
select x ->> 'target_key', x ->> 'label', (x ->> 'horizon_seasons')::int, x ->> 'applies_to', (x ->> 'threshold_bwar')::numeric, x ->> 'label_rule',
       (x ->> 'min_reference_n')::int, (x ->> 'min_positives')::int, (x ->> 'min_negatives')::int, (x ->> 'events_per_feature')::int
from _m041, jsonb_array_elements(j -> 'targets') x
on conflict (target_key) do nothing;

insert into public.outcome_model_evaluations (target_key, model_key, model_version, validation_method, feature_list, training_populations, evaluated_rows,
  positive_n, folds, brier_score, log_loss, auc, brier_skill_vs_base_rate, calibration_bins, decision, decision_reason, training_fingerprint, data_as_of_date)
select x ->> 'target_key', x ->> 'model_key', x ->> 'model_version', x ->> 'validation_method',
       array(select jsonb_array_elements_text(x -> 'feature_list')), array(select jsonb_array_elements_text(x -> 'training_populations')),
       (x ->> 'evaluated_rows')::int, (x ->> 'positive_n')::int, (x ->> 'folds')::int, (x ->> 'brier_score')::numeric, (x ->> 'log_loss')::numeric,
       (x ->> 'auc')::numeric, (x ->> 'brier_skill_vs_base_rate')::numeric, x -> 'calibration_bins', x ->> 'decision', x ->> 'decision_reason',
       x ->> 'training_fingerprint', (x ->> 'data_as_of_date')::date
from _m041, jsonb_array_elements(j -> 'evaluations') x
on conflict (target_key, model_key) do nothing;

-- ===========================================================================
-- 3. VIEWS
-- ===========================================================================

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

-- ===========================================================================
-- 4. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['v_outcome_training_population', 'v_outcome_feature_matrix', 'v_outcome_target_support', 'v_outcome_model_evaluation',
                           'v_player_outcome_probability', 'v_outcome_probability_research_queue'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
  end loop;
end $$;

do $$
declare
  bad text;
  n int;
  expected int;
begin
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '041: API roles hold privileges beyond SELECT: %', bad;
  end if;
  select count(*) into expected from _m041, jsonb_array_elements(j -> 'targets');
  select count(*) into n from public.outcome_targets;
  if n < expected then
    raise exception '041 postcondition: % of % targets present', n, expected;
  end if;
  -- no censored, unaudited or out-of-scope row carries a label used for training; no probability without eligibility
  select count(*) into n from public.v_outcome_training_population
  where (training_state in ('TRAINING_ELIGIBLE', 'BENCHMARK_SAMPLE_ONLY')) <> (label is not null and training_state not in ('OUT_OF_SCOPE', 'CENSORED', 'OUTCOME_UNAUDITED'))
     or (training_state = 'CENSORED' and label is not null);
  if n <> 0 then
    raise exception '041 postcondition: % training row(s) violate the label / state rules', n;
  end if;
  select count(*) into n from public.v_player_outcome_probability where (probability is not null) <> prediction_eligible;
  if n <> 0 then
    raise exception '041 postcondition: % probability row(s) violate the eligibility rule', n;
  end if;
end $$;

commit;
