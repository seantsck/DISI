-- DISI v0.27
-- 036_scouting_expectation_outcomes.sql
-- Scouting expectation vs realized outcome: a frozen, source-native expectation layer over the 026 evaluation history and one
-- shared realized-outcome spine over 032-035, compared without treating any grade or rank as a probability. Run after 035.
--
-- Built from database/research/036/ (bands.json, audit.mjs, build.mjs, views.sql, architecture-report.md).
--
-- What this is. Derived, read-only intelligence: it adds no evaluation, outcome or value fact and rewrites none.
--   * scouting_expectation_bands: reviewed band definitions, each reading ONE publication's own measure (a rank range of one list
--     scope, or a numeric-base grade range of one scale dimension). No band crosses publications or scales; there is no universal
--     expectation number. Every band states its expectation and the DISI-convention outcome rule used to compare it.
--   * v_player_realized_outcome: one row per tracked signing (Dodgers + Top-prospect benchmark), the outcome spine reused by 036-038.
--   * v_scouting_expectation_observations: every ACTIVE external rank / FV observation with its band and its order relative to the
--     MLB debut.
--   * v_player_expectation_vs_outcome: the earliest pre-debut observation per player and band family (a frozen historical
--     expectation) against the realized outcome; TOO_EARLY and OUTCOME_INCOMPLETE are never misses.
--   * v_scouting_calibration_summary: descriptive band outcomes, with shares only for samples of 10+ comparable outcomes.
--   * v_scouting_expectation_research_queue.
--
-- Not claimed: accuracy, probability, hit rates for an organization or a publication, causal effects, any predictive score.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 0. REVIEWED RESEARCH DATA (database/research/036/bands.json)
-- ===========================================================================

create temporary table _m036 on commit drop as
select $m036${{payload_json}}$m036$::jsonb as j;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
declare
  f jsonb;
begin
  if to_regclass('public.v_international_benchmark_player_outcomes') is null or to_regclass('public.v_player_organizational_realization') is null then
    raise exception '036: Migration 035 has not been applied';
  end if;
  if to_regclass('public.player_evaluations') is null or to_regclass('public.evaluation_scales') is null then
    raise exception '036: the Migration 026 evaluation history is missing';
  end if;
  for f in select x from _m036, jsonb_array_elements(j -> 'families') x loop
    if not exists (select 1 from public.scouting_publications where publication_slug = f ->> 'publication_slug') then
      raise exception '036: band family % names an unknown publication %', f ->> 'band_family', f ->> 'publication_slug';
    end if;
    if f ->> 'measure' = 'GRADE' and not exists (select 1 from public.evaluation_scales where scale_code = f ->> 'scale_code') then
      raise exception '036: band family % names an unknown scale %', f ->> 'band_family', f ->> 'scale_code';
    end if;
  end loop;
  -- one signing per player: the spine and the observation layer key on the player's signing
  if exists (select 1 from public.signings group by player_id having count(*) > 1) then
    raise exception '036: a player has more than one signing; the outcome spine needs an explicit signing choice first';
  end if;
end $$;

-- ===========================================================================
-- 2. EXPECTATION BANDS (reference table; written only by migrations)
-- ===========================================================================

create table if not exists public.scouting_expectation_bands (
  band_code text primary key check (band_code ~ '^[A-Z0-9_]+$'),
  band_family text not null check (band_family ~ '^[A-Z0-9_]+$'),
  family_label text not null check (btrim(family_label) <> ''),
  publication_id uuid not null references public.scouting_publications(id) on delete restrict,
  measure text not null check (measure in ('RANK', 'GRADE')),
  ranking_scope text check (ranking_scope is null or ranking_scope in ('ORGANIZATION', 'MLB_GLOBAL', 'INTERNATIONAL_CLASS', 'LEAGUE', 'POSITION', 'ROOKIE_CLASS', 'OTHER')),
  required_list_size integer check (required_list_size is null or required_list_size >= 1),
  scale_code text references public.evaluation_scales(scale_code),
  dimension_code text,
  temporal_basis text check (temporal_basis is null or temporal_basis in ('PRESENT', 'FUTURE', 'UNSPECIFIED')),
  lower_value numeric not null,
  upper_value numeric,
  band_order integer not null check (band_order >= 1),
  band_label text not null check (btrim(band_label) <> ''),
  expectation_statement text not null check (btrim(expectation_statement) <> '' and char_length(expectation_statement) <= 500),
  population_label text not null check (population_label in ('TOP_PROSPECT_SAMPLE', 'RANKED_LIST_SAMPLE', 'ORGANIZATION_LIST_SAMPLE', 'GRADED_SAMPLE')),
  met_requires_mlb boolean not null default true,
  met_career_bwar_floor numeric,
  exceeded_career_bwar_floor numeric,
  outcome_rule_basis text not null default 'DISI_CONVENTION' check (outcome_rule_basis = 'DISI_CONVENTION'),
  created_at timestamptz not null default now(),
  constraint scouting_expectation_bands_family_order_key unique (band_family, band_order),
  constraint scouting_expectation_bands_range_check check (upper_value is null or upper_value >= lower_value),
  constraint scouting_expectation_bands_measure_shape_check check (coalesce(case measure
    when 'RANK' then ranking_scope is not null and scale_code is null and dimension_code is null and temporal_basis is null and lower_value >= 1
    else ranking_scope is null and required_list_size is null and scale_code is not null and dimension_code is not null and temporal_basis is not null
  end, false)),
  constraint scouting_expectation_bands_floor_check check (
    met_requires_mlb
    and (met_career_bwar_floor is null or met_career_bwar_floor >= 0)
    and (exceeded_career_bwar_floor is null or exceeded_career_bwar_floor > coalesce(met_career_bwar_floor, 0)))
);

comment on table public.scouting_expectation_bands is
  'Reviewed expectation bands (Migration 036). A band reads one publication''s own measure: a rank range within one list scope, or a numeric-base grade range of one scale dimension. Bands never cross publications or scales and define no universal expectation number. The outcome rule (met: MLB reach plus an optional career-bWAR floor; exceeded: a career-bWAR floor) is a DISI convention stated in expectation_statement, never the publisher''s claim.';

do $$
begin
  alter table public.scouting_expectation_bands enable row level security;
  revoke all on table public.scouting_expectation_bands from anon, authenticated;
  grant select on table public.scouting_expectation_bands to anon, authenticated;
  drop policy if exists public_read_scouting_expectation_bands on public.scouting_expectation_bands;
  create policy public_read_scouting_expectation_bands on public.scouting_expectation_bands for select to anon, authenticated using (true);
end $$;

insert into public.scouting_expectation_bands (band_code, band_family, family_label, publication_id, measure, ranking_scope, required_list_size,
  scale_code, dimension_code, temporal_basis, lower_value, upper_value, band_order, band_label, expectation_statement, population_label,
  met_requires_mlb, met_career_bwar_floor, exceeded_career_bwar_floor)
select b ->> 'band_code', f ->> 'band_family', f ->> 'family_label', sp.id, f ->> 'measure', f ->> 'ranking_scope', (f ->> 'required_list_size')::int,
       f ->> 'scale_code', f ->> 'dimension_code', f ->> 'temporal_basis', (b ->> 'lower_value')::numeric, (b ->> 'upper_value')::numeric,
       (b ->> 'band_order')::int, b ->> 'band_label', b ->> 'expectation_statement', f ->> 'population_label',
       true, (b ->> 'met_career_bwar_floor')::numeric, (b ->> 'exceeded_career_bwar_floor')::numeric
from _m036 cross join lateral jsonb_array_elements(j -> 'families') f cross join lateral jsonb_array_elements(f -> 'bands') b
join public.scouting_publications sp on sp.publication_slug = f ->> 'publication_slug'
on conflict (band_code) do nothing;

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
  foreach t in array array['v_player_realized_outcome', 'v_scouting_expectation_observations', 'v_player_expectation_vs_outcome',
                           'v_scouting_calibration_summary', 'v_scouting_expectation_research_queue'] loop
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
    raise exception '036: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- the reviewed bands are present exactly as researched
  select count(*) into expected from _m036, jsonb_array_elements(j -> 'families') f, jsonb_array_elements(f -> 'bands') b;
  select count(*) into n from public.scouting_expectation_bands sb
  join _m036 on true
  where exists (select 1 from jsonb_array_elements(j -> 'families') f, jsonb_array_elements(f -> 'bands') b
    where b ->> 'band_code' = sb.band_code and f ->> 'band_family' = sb.band_family and (b ->> 'lower_value')::numeric = sb.lower_value
      and (b ->> 'upper_value')::numeric is not distinct from sb.upper_value and (b ->> 'band_order')::int = sb.band_order
      and (b ->> 'met_career_bwar_floor')::numeric is not distinct from sb.met_career_bwar_floor
      and (b ->> 'exceeded_career_bwar_floor')::numeric is not distinct from sb.exceeded_career_bwar_floor);
  if n <> expected then
    raise exception '036 postcondition: % of % expectation bands match the reviewed definitions', n, expected;
  end if;
  -- bands of one family never overlap
  select count(*) into n from public.scouting_expectation_bands a join public.scouting_expectation_bands b
    on a.band_family = b.band_family and a.band_code < b.band_code
   and a.lower_value <= coalesce(b.upper_value, 'infinity'::numeric) and b.lower_value <= coalesce(a.upper_value, 'infinity'::numeric);
  if n <> 0 then
    raise exception '036 postcondition: % overlapping band pair(s)', n;
  end if;
  -- the spine covers every signing exactly once
  select count(*) into n from public.v_player_realized_outcome;
  select count(*) into expected from public.signings;
  if n <> expected then
    raise exception '036 postcondition: the outcome spine has % rows for % signings', n, expected;
  end if;
  -- no anchor is a post-debut or order-ambiguous observation, and an unaudited outcome is never a miss
  select count(*) into n from public.v_player_expectation_vs_outcome where anchor_debut_order in ('POST_DEBUT', 'ORDER_AMBIGUOUS')
     or (reached_mlb_verified is null and comparison_state in ('EXPECTATION_UNDERPERFORMED', 'EXPECTATION_MET', 'EXPECTATION_EXCEEDED'));
  if n <> 0 then
    raise exception '036 postcondition: % expectation row(s) violate the anchor or unknown-outcome rules', n;
  end if;
end $$;

commit;
