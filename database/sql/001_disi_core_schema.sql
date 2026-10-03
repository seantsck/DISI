-- DISI v0.1 — Dodgers International Signing Intelligence
-- Supabase/Postgres schema
-- Design goals:
--   1) preserve provenance and uncertainty
--   2) separate acquisition pathways/regimes
--   3) support longitudinal development analysis
--   4) public-read / private-write baseline security
--   5) leave missing values NULL rather than fabricating data

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.acquisition_pathway as enum (
    'LATAM_AMATEUR',
    'MEXICAN_LEAGUE_TRANSFER',
    'CUBAN_AMATEUR',
    'CUBAN_PRO',
    'JAPAN_AMATEUR',
    'JAPAN_PRO',
    'KOREA_AMATEUR',
    'KOREA_PRO',
    'POSTED_PLAYER',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.signing_regime as enum (
    'STANDARD_POOL',
    'AGGRESSIVE_OVERAGE',
    'PENALTY_RESTRICTED',
    'POST_PENALTY',
    'MODERN_HARD_POOL',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.confidence_level as enum (
    'VERIFIED',
    'HIGH',
    'MEDIUM',
    'LOW',
    'UNVERIFIED'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.milestone_type as enum (
    'SIGNED',
    'DSL_DEBUT',
    'COMPLEX_DEBUT',
    'A_DEBUT',
    'HIGH_A_DEBUT',
    'AA_DEBUT',
    'AAA_DEBUT',
    'MLB_DEBUT',
    'TRADED',
    'RELEASED',
    'RETIRED',
    'OTHER'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- REFERENCE / PROVENANCE
-- ---------------------------------------------------------------------------

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_type text not null,
  title text,
  url text not null,
  author text,
  publication_date date,
  accessed_at timestamptz not null default now(),
  notes text,
  unique(url)
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  field_name text,
  source_id uuid not null references public.sources(id) on delete cascade,
  confidence public.confidence_level not null default 'MEDIUM',
  evidence_note text,
  created_at timestamptz not null default now()
);

create index if not exists evidence_entity_idx
  on public.evidence(entity_type, entity_id);

create index if not exists evidence_source_idx
  on public.evidence(source_id);

-- ---------------------------------------------------------------------------
-- BASEBALL ENTITIES
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  abbreviation text,
  organization_type text not null default 'MLB_CLUB',
  league text,
  country text,
  active boolean not null default true,
  unique(name)
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  canonical_name text,
  birth_date date,
  birth_country text,
  birth_city text,
  nationality text,
  primary_position text,
  secondary_positions text[],
  bats text check (bats is null or bats in ('L','R','S')),
  throws text check (throws is null or throws in ('L','R')),
  height_in numeric(5,2),
  weight_lb numeric(6,2),
  mlb_id bigint unique,
  bref_id text unique,
  fangraphs_id text unique,
  active boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_name_idx
  on public.players using btree (lower(full_name));

create table if not exists public.player_aliases (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  alias text not null,
  language_code text,
  alias_type text,
  unique(player_id, alias)
);

create table if not exists public.trainers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  academy_name text,
  country text,
  city text,
  notes text,
  unique(name, academy_name)
);

create table if not exists public.player_trainers (
  player_id uuid not null references public.players(id) on delete cascade,
  trainer_id uuid not null references public.trainers(id) on delete cascade,
  relationship_type text not null default 'PRE_SIGNING_TRAINER',
  start_date date,
  end_date date,
  confidence public.confidence_level not null default 'MEDIUM',
  primary key (player_id, trainer_id, relationship_type)
);

-- ---------------------------------------------------------------------------
-- SIGNING ENVIRONMENT + TRANSACTIONS
-- ---------------------------------------------------------------------------

create table if not exists public.signing_environments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  signing_year int not null check (signing_year between 1990 and 2100),
  regime public.signing_regime not null default 'OTHER',
  club_bonus_pool_usd numeric(14,2),
  pool_after_trades_usd numeric(14,2),
  signing_period_label text,
  max_individual_bonus_usd numeric(14,2),
  overage_tax_rate numeric(8,5),
  tradeable_pool_space boolean,
  penalty_status text,
  rules_summary text,
  cba_regime text,
  notes text,
  unique(organization_id, signing_year)
);

create table if not exists public.signings (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  signing_environment_id uuid references public.signing_environments(id) on delete set null,
  signing_date date,
  signing_year int not null check (signing_year between 1990 and 2100),
  age_at_signing numeric(5,2),
  country_market text,
  pathway public.acquisition_pathway not null default 'OTHER',
  source_league text,
  source_club text,
  professional_experience_years numeric(6,2),
  signing_bonus_usd numeric(14,2) check (signing_bonus_usd is null or signing_bonus_usd >= 0),
  bonus_publicly_reported boolean not null default false,
  posting_fee_usd numeric(14,2),
  transfer_fee_usd numeric(14,2),
  total_known_acquisition_cost_usd numeric(14,2)
    generated always as (
      case
        when signing_bonus_usd is null
         and posting_fee_usd is null
         and transfer_fee_usd is null
        then null
        else coalesce(signing_bonus_usd,0)
           + coalesce(posting_fee_usd,0)
           + coalesce(transfer_fee_usd,0)
      end
    ) stored,
  international_rank numeric(8,2),
  rank_source text,
  notes text,
  created_at timestamptz not null default now(),
  unique(player_id, organization_id, signing_year)
);

create index if not exists signings_org_year_idx
  on public.signings(organization_id, signing_year);

create index if not exists signings_country_idx
  on public.signings(country_market);

create index if not exists signings_bonus_idx
  on public.signings(signing_bonus_usd);

create index if not exists signings_pathway_idx
  on public.signings(pathway);

-- ---------------------------------------------------------------------------
-- SCOUTING / EVALUATION
-- ---------------------------------------------------------------------------

create table if not exists public.evaluations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  evaluation_date date,
  evaluator_source text not null,
  evaluation_stage text,
  overall_fv numeric(5,2) check (overall_fv is null or overall_fv between 20 and 80),
  hit_grade numeric(5,2) check (hit_grade is null or hit_grade between 20 and 80),
  game_power_grade numeric(5,2) check (game_power_grade is null or game_power_grade between 20 and 80),
  raw_power_grade numeric(5,2) check (raw_power_grade is null or raw_power_grade between 20 and 80),
  run_grade numeric(5,2) check (run_grade is null or run_grade between 20 and 80),
  field_grade numeric(5,2) check (field_grade is null or field_grade between 20 and 80),
  arm_grade numeric(5,2) check (arm_grade is null or arm_grade between 20 and 80),
  fastball_grade numeric(5,2) check (fastball_grade is null or fastball_grade between 20 and 80),
  breaking_ball_grade numeric(5,2) check (breaking_ball_grade is null or breaking_ball_grade between 20 and 80),
  changeup_grade numeric(5,2) check (changeup_grade is null or changeup_grade between 20 and 80),
  command_grade numeric(5,2) check (command_grade is null or command_grade between 20 and 80),
  risk_label text,
  prospect_rank numeric(8,2),
  prospect_rank_scope text,
  scouting_summary text,
  source_id uuid references public.sources(id) on delete set null,
  confidence public.confidence_level not null default 'MEDIUM',
  created_at timestamptz not null default now()
);

create index if not exists evaluations_player_date_idx
  on public.evaluations(player_id, evaluation_date desc);

-- ---------------------------------------------------------------------------
-- PERFORMANCE + DEVELOPMENT
-- ---------------------------------------------------------------------------

create table if not exists public.performance_seasons (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  season int not null check (season between 1990 and 2100),
  organization_id uuid references public.organizations(id) on delete set null,
  affiliate text,
  league text,
  level text not null,
  age numeric(5,2),

  -- batting
  pa int,
  ab int,
  h int,
  doubles int,
  triples int,
  hr int,
  bb int,
  so int,
  sb int,
  cs int,
  avg numeric(7,4),
  obp numeric(7,4),
  slg numeric(7,4),
  ops numeric(7,4),
  wrc_plus numeric(8,2),

  -- pitching
  ip numeric(8,2),
  batters_faced int,
  era numeric(8,3),
  fip numeric(8,3),
  whip numeric(8,3),
  k_pct numeric(7,4),
  bb_pct numeric(7,4),

  -- value / context
  war numeric(8,3),
  games int,
  source_id uuid references public.sources(id) on delete set null,
  confidence public.confidence_level not null default 'MEDIUM',
  notes text,
  unique(player_id, season, level, affiliate)
);

create index if not exists performance_player_season_idx
  on public.performance_seasons(player_id, season);

create table if not exists public.development_milestones (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  milestone public.milestone_type not null,
  milestone_date date,
  age_at_milestone numeric(5,2),
  organization_id uuid references public.organizations(id) on delete set null,
  affiliate text,
  notes text,
  source_id uuid references public.sources(id) on delete set null,
  confidence public.confidence_level not null default 'MEDIUM',
  unique(player_id, milestone, milestone_date)
);

create index if not exists milestones_player_idx
  on public.development_milestones(player_id, milestone_date);

-- ---------------------------------------------------------------------------
-- TRANSACTIONS / ORGANIZATIONAL VALUE
-- A player's eventual MLB career is not the same thing as value realized by
-- the signing organization. This layer tracks trades, releases, etc.
-- ---------------------------------------------------------------------------

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  transaction_date date,
  transaction_type text not null,
  from_organization_id uuid references public.organizations(id) on delete set null,
  to_organization_id uuid references public.organizations(id) on delete set null,
  return_description text,
  estimated_org_value_war numeric(9,3),
  estimated_org_value_usd numeric(16,2),
  value_model_version text,
  notes text,
  source_id uuid references public.sources(id) on delete set null,
  confidence public.confidence_level not null default 'MEDIUM',
  created_at timestamptz not null default now()
);

create index if not exists transactions_player_date_idx
  on public.transactions(player_id, transaction_date);

-- ---------------------------------------------------------------------------
-- OUTCOMES
-- ---------------------------------------------------------------------------

create table if not exists public.outcomes (
  player_id uuid primary key references public.players(id) on delete cascade,
  reached_mlb boolean,
  mlb_debut_date date,
  mlb_games int,
  mlb_pa int,
  mlb_ip numeric(10,2),
  career_war numeric(9,3),
  peak_single_season_war numeric(9,3),
  years_of_mlb_service numeric(8,3),
  current_status text,
  outcome_through_season int,
  source_id uuid references public.sources(id) on delete set null,
  confidence public.confidence_level not null default 'MEDIUM',
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- MARKET / LEAGUE CONTEXT
-- ---------------------------------------------------------------------------

create table if not exists public.market_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_year int not null check (snapshot_year between 1990 and 2100),
  country_market text not null,
  pathway public.acquisition_pathway,
  position_group text,
  sample_size int,
  median_bonus_usd numeric(14,2),
  mean_bonus_usd numeric(14,2),
  p25_bonus_usd numeric(14,2),
  p75_bonus_usd numeric(14,2),
  mlb_reach_rate numeric(7,5),
  mean_time_to_mlb_years numeric(8,3),
  mean_career_war numeric(9,3),
  notes text,
  source_id uuid references public.sources(id) on delete set null,
  unique(snapshot_year, country_market, pathway, position_group)
);

create table if not exists public.league_translation_factors (
  id uuid primary key default gen_random_uuid(),
  source_league text not null,
  source_level text,
  target_level text not null default 'MLB',
  season_start int,
  season_end int,
  metric_name text not null,
  factor numeric(12,6) not null,
  sample_size int,
  model_version text,
  source_id uuid references public.sources(id) on delete set null,
  notes text,
  unique(source_league, source_level, target_level, season_start, season_end, metric_name, model_version)
);

-- ---------------------------------------------------------------------------
-- MODEL OUTPUTS
-- Keep model outputs separate from observed facts.
-- ---------------------------------------------------------------------------

create table if not exists public.model_predictions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  model_name text not null,
  model_version text not null,
  prediction_date date not null default current_date,
  prediction_horizon text,
  probability_reach_mlb numeric(7,6)
    check (probability_reach_mlb is null or probability_reach_mlb between 0 and 1),
  expected_career_war numeric(10,4),
  expected_surplus_value_usd numeric(16,2),
  expected_time_to_mlb_years numeric(8,3),
  uncertainty_low numeric(12,4),
  uncertainty_high numeric(12,4),
  feature_snapshot jsonb,
  explanation jsonb,
  created_at timestamptz not null default now(),
  unique(player_id, model_name, model_version, prediction_date)
);

create table if not exists public.portfolio_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_id uuid references public.organizations(id) on delete set null,
  signing_year int,
  available_pool_usd numeric(14,2),
  model_name text,
  model_version text,
  constraints jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ANALYTICAL VIEWS
-- security_invoker ensures underlying RLS applies.
-- ---------------------------------------------------------------------------

create or replace view public.v_player_signing_profile
with (security_invoker = true)
as
select
  p.id as player_id,
  p.full_name,
  p.birth_date,
  p.birth_country,
  p.primary_position,
  s.id as signing_id,
  s.signing_year,
  s.signing_date,
  s.age_at_signing,
  s.country_market,
  s.pathway,
  s.signing_bonus_usd,
  s.bonus_publicly_reported,
  s.total_known_acquisition_cost_usd,
  o.name as signing_organization,
  se.regime as signing_regime,
  se.club_bonus_pool_usd,
  oc.reached_mlb,
  oc.mlb_debut_date,
  oc.career_war,
  oc.current_status
from public.players p
join public.signings s on s.player_id = p.id
join public.organizations o on o.id = s.organization_id
left join public.signing_environments se on se.id = s.signing_environment_id
left join public.outcomes oc on oc.player_id = p.id;

create or replace view public.v_signing_efficiency
with (security_invoker = true)
as
select
  v.*,
  case
    when v.signing_bonus_usd is not null
     and v.signing_bonus_usd > 0
     and v.career_war is not null
    then v.career_war / (v.signing_bonus_usd / 1000000.0)
    else null
  end as career_war_per_million_bonus
from public.v_player_signing_profile v;

-- ---------------------------------------------------------------------------
-- SECURITY: public-read / private-write baseline
-- No client-side insert/update/delete policies are created yet.
-- Service-role and SQL-editor operations can still manage data.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'sources',
    'evidence',
    'organizations',
    'players',
    'player_aliases',
    'trainers',
    'player_trainers',
    'signing_environments',
    'signings',
    'evaluations',
    'performance_seasons',
    'development_milestones',
    'transactions',
    'outcomes',
    'market_snapshots',
    'league_translation_factors',
    'model_predictions',
    'portfolio_scenarios'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to anon, authenticated', t);
    execute format(
      'drop policy if exists %I on public.%I',
      'public_read_' || t,
      t
    );
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      'public_read_' || t,
      t
    );
  end loop;
end $$;

grant select on public.v_player_signing_profile to anon, authenticated;
grant select on public.v_signing_efficiency to anon, authenticated;

-- ---------------------------------------------------------------------------
-- UPDATED-AT helper
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at
before update on public.players
for each row execute function public.set_updated_at();

drop trigger if exists outcomes_set_updated_at on public.outcomes;
create trigger outcomes_set_updated_at
before update on public.outcomes
for each row execute function public.set_updated_at();

commit;

-- ---------------------------------------------------------------------------
-- POST-MIGRATION VERIFICATION QUERIES
-- Run these after the migration.
-- ---------------------------------------------------------------------------

-- 1) Confirm core tables:
-- select table_name
-- from information_schema.tables
-- where table_schema = 'public'
--   and table_name in (
--     'players','signings','signing_environments','evaluations',
--     'performance_seasons','development_milestones','outcomes',
--     'trainers','sources','evidence'
--   )
-- order by table_name;

-- 2) Confirm RLS is enabled:
-- select relname, relrowsecurity
-- from pg_class
-- join pg_namespace on pg_namespace.oid = pg_class.relnamespace
-- where pg_namespace.nspname = 'public'
--   and relname in ('players','signings','sources','outcomes');

-- 3) Confirm analytical view:
-- select * from public.v_player_signing_profile limit 5;
