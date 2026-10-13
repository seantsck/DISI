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
select $m041${{payload_json}}$m041$::jsonb as j;

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

{{views}}

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
