-- DISI v0.31
-- 040_historical_archetypes_comparables.sql
-- Historical archetypes and comparables: structured archetype keys and deterministic, explainable comparable sets built ONLY from the
-- 039 signing-time features; outcomes are attached after the comparable set is fixed. Run after 039.
--
-- Built from database/research/040/ (views.sql, audit.mjs, build.mjs; design in database/research/039/architecture-report.md).
--
-- What this is. No table, no fact. Comparables are earlier-signed players (history that existed at the time) with the same route and
-- position family at signing, never from the outcome-selected historical set, ordered by a fixed hierarchy with every matched
-- dimension listed. Benchmark and Dodgers comparables stay separable; populations are never pooled in a share; a share needs 10+
-- mature audited comparables of one population class. No likeness claim, no forecast.
--
-- Views: v_player_historical_archetype, v_player_comparables, v_player_comparable_summary, v_archetype_outcome_summary,
-- v_archetype_research_queue.
--
-- Rerunnable: every statement is idempotent.

begin;

do $$
begin
  if to_regclass('public.v_signing_time_features') is null or to_regclass('public.market_groups') is null then
    raise exception '040: Migration 039 has not been applied';
  end if;
end $$;

-- ===========================================================================
-- Migration 040 views: archetypes, comparables, comparable summary, archetype outcome summary, research queue
-- ===========================================================================

-- One row per signing: a structured archetype key built only from signing-time features (039). No outcome is read.
create or replace view public.v_player_historical_archetype
with (security_invoker = true)
as
with m as materialized (
  select f.signing_id, f.player_id, f.player_slug, f.full_name, f.is_dodgers, f.population_class, f.signing_year, f.feature_as_of_date,
    f.signing_route, f.position_family, f.age_band, f.expectation_tier, f.cost_band, f.market_group, f.era_key,
    concat_ws('|', f.signing_route, f.position_family, f.age_band) as coarse_archetype_key,
    concat_ws('|', f.signing_route, f.position_family, f.age_band, f.expectation_tier, f.cost_band, f.market_group, f.era_key) as archetype_key,
    (f.has_age and f.has_position) as archetype_defined,
    case
      when not f.has_position and not f.has_age then 'POSITION_AND_AGE_UNKNOWN'
      when not f.has_position then 'POSITION_UNKNOWN'
      when not f.has_age then 'AGE_UNKNOWN'
    end as archetype_gap
  from public.v_signing_time_features f
)
select * from m;

comment on view public.v_player_historical_archetype is
  'Historical archetype (Migration 040): one row per signing with a structured key built only from signing-time features (v_signing_time_features) - coarse key: route | position family at signing | age band; full key adds at-signing expectation tier | cost band | market group | era. No outcome, development or later fact is read, and no descriptive label is invented. archetype_defined is false when the position at signing or the age is unknown.';

-- For each signing, up to 20 comparable signings chosen ONLY from signing-time features: same route and position family at signing,
-- signed in an earlier signing year (history that existed at the time), never from the outcome-selected historical set. Ordered by a
-- fixed hierarchy - age band, expectation tier, cost band, market group, era - then age distance, more recent signing year and slug.
-- The comparable's outcome is attached after selection and never influences it.
create or replace view public.v_player_comparables
with (security_invoker = true)
as
with m as materialized (
  with f as materialized (select * from public.v_signing_time_features),
  pairs as (
    select t.signing_id as target_signing_id, c.signing_id as comparable_signing_id,
      (t.age_band = c.age_band and t.age_band <> 'AGE_UNKNOWN') as age_match,
      (t.expectation_tier = c.expectation_tier and t.expectation_tier <> 'NO_AT_SIGNING_EXPECTATION') as expectation_match,
      (t.cost_band = c.cost_band and t.cost_band <> 'BONUS_UNKNOWN') as cost_match,
      (t.market_group = c.market_group and t.market_group <> 'UNKNOWN') as market_match,
      (t.era_key = c.era_key and t.era_key not in ('ERA_BOUNDARY_AMBIGUOUS')) as era_match,
      abs(t.age_in_signing_year - c.age_in_signing_year) as age_distance,
      c.signing_year as comparable_signing_year, c.player_slug as comparable_slug
    from f t
    join f c on c.signing_route = t.signing_route and c.position_family = t.position_family and c.signing_year < t.signing_year
      and c.signing_id <> t.signing_id and c.population_class <> 'OUTCOME_SELECTED_SAMPLE'
    where t.position_family <> 'POSITION_UNKNOWN'
  ),
  ranked as (
    select p.*,
      (case when p.age_match then 16 else 0 end + case when p.expectation_match then 8 else 0 end + case when p.cost_match then 4 else 0 end
        + case when p.market_match then 2 else 0 end + case when p.era_match then 1 else 0 end) as match_score,
      row_number() over (partition by p.target_signing_id order by
        (case when p.age_match then 16 else 0 end + case when p.expectation_match then 8 else 0 end + case when p.cost_match then 4 else 0 end
          + case when p.market_match then 2 else 0 end + case when p.era_match then 1 else 0 end) desc,
        p.age_distance nulls last, p.comparable_signing_year desc, p.comparable_slug) as comparable_rank
    from pairs p
  )
  select
    t.signing_id as target_signing_id, t.player_id as target_player_id, t.player_slug as target_player_slug, t.population_class as target_population_class,
    r.comparable_rank, r.match_score,
    array_remove(array[case when r.age_match then 'AGE_BAND' end, case when r.expectation_match then 'EXPECTATION_TIER' end,
      case when r.cost_match then 'COST_BAND' end, case when r.market_match then 'MARKET_GROUP' end, case when r.era_match then 'ERA' end], null) as matched_dimensions,
    c.signing_id as comparable_signing_id, c.player_id as comparable_player_id, c.player_slug as comparable_player_slug,
    c.is_dodgers as comparable_is_dodgers, c.population_class as comparable_population_class, c.signing_year as comparable_signing_year,
    c.position_family, c.age_band as comparable_age_band, c.expectation_tier as comparable_expectation_tier, c.cost_band as comparable_cost_band,
    c.market_group as comparable_market_group, c.era_key as comparable_era_key,
    -- outcome attached after selection
    o.outcome_state as comparable_outcome_state, o.reached_mlb_verified as comparable_reached_mlb_verified,
    o.outcome_maturity as comparable_outcome_maturity, o.career_bwar as comparable_career_bwar, o.analysis_as_of_date
  from ranked r
  join f t on t.signing_id = r.target_signing_id
  join f c on c.signing_id = r.comparable_signing_id
  join public.v_player_realized_outcome o on o.signing_id = r.comparable_signing_id
  where r.comparable_rank <= 20
)
select * from m;

comment on view public.v_player_comparables is
  'Historical comparables (Migration 040): for each signing whose position at signing is known, up to 20 earlier-signed comparables with the same route and position family, chosen ONLY from signing-time features (never an outcome) and never from the outcome-selected historical set. Order: match_score (age band 16, at-signing expectation tier 8, cost band 4, market group 2, era 1; an unknown value - including no recorded at-signing expectation, which is missing, not unranked - never matches), then age distance, more recent signing year, slug. matched_dimensions says why each was chosen. The comparable''s outcome is attached after selection. Benchmark (non-Dodgers) and Dodgers comparables stay separable (comparable_population_class). "Among historical players sharing these documented characteristics" - never a forecast or a likeness claim.';

-- One row per target signing and comparable population class: how many comparables, how many mature and audited, how many reached
-- MLB; a share only for 10+ mature audited comparables of ONE population class (classes are never pooled).
create or replace view public.v_player_comparable_summary
with (security_invoker = true)
as
with m as materialized (
  with c as materialized (select * from public.v_player_comparables),
  targets as (
    select a.signing_id, a.player_slug, a.population_class, a.archetype_defined, a.position_family from public.v_player_historical_archetype a
  ),
  agg as (
    select c.target_signing_id, c.comparable_population_class,
      count(*)::int as comparables,
      count(*) filter (where c.comparable_outcome_maturity = 'MATURE')::int as mature_comparables,
      count(*) filter (where c.comparable_outcome_maturity = 'MATURE' and c.comparable_reached_mlb_verified is not null)::int as mature_audited_comparables,
      count(*) filter (where c.comparable_outcome_maturity = 'MATURE' and c.comparable_reached_mlb_verified)::int as mature_reached_mlb,
      round(avg(c.match_score), 1) as mean_match_score
    from c group by c.target_signing_id, c.comparable_population_class
  )
  select
    t.signing_id as target_signing_id, t.player_slug as target_player_slug, t.population_class as target_population_class,
    a.comparable_population_class, coalesce(a.comparables, 0) as comparables, coalesce(a.mature_comparables, 0) as mature_comparables,
    coalesce(a.mature_audited_comparables, 0) as mature_audited_comparables, coalesce(a.mature_reached_mlb, 0) as mature_reached_mlb,
    a.mean_match_score,
    case when a.mature_audited_comparables >= 10 then round(a.mature_reached_mlb::numeric / a.mature_audited_comparables, 3) end as comparable_reach_share,
    case
      when t.position_family = 'POSITION_UNKNOWN' then 'NO_COMPARABLES_POSITION_UNKNOWN'
      when a.comparables is null then 'NO_EARLIER_COMPARABLES'
      when a.comparables < 5 then 'INSUFFICIENT_COMPARABLES'
      when a.mature_audited_comparables >= 10 then 'DESCRIPTIVE_COMPARABLE_SAMPLE'
      else 'COMPARABLES_LISTED_NO_SHARE'
    end as comparable_state
  from targets t
  left join agg a on a.target_signing_id = t.signing_id
)
select * from m;

comment on view public.v_player_comparable_summary is
  'Comparable summary (Migration 040): one row per target signing and comparable population class (one row with NULL class when there is none). comparable_reach_share needs 10+ mature audited comparables of that one class; classes are never pooled. States: NO_COMPARABLES_POSITION_UNKNOWN, NO_EARLIER_COMPARABLES, INSUFFICIENT_COMPARABLES (< 5), COMPARABLES_LISTED_NO_SHARE, DESCRIPTIVE_COMPARABLE_SAMPLE. A share describes what happened to earlier players who shared documented signing-time characteristics; it is not a probability for the target.';

-- Outcomes by coarse archetype and population class (classes never pooled). Shares need a non-outcome-selected class with 10+ mature
-- audited members.
create or replace view public.v_archetype_outcome_summary
with (security_invoker = true)
as
with m as materialized (
  with a as (
    select h.*, o.outcome_maturity, o.reached_mlb_verified, o.career_bwar, o.years_signing_to_debut_season
    from public.v_player_historical_archetype h
    join public.v_player_realized_outcome o on o.signing_id = h.signing_id
  ),
  agg as (
    select a.coarse_archetype_key, a.signing_route, a.position_family, a.age_band, a.population_class,
      count(*)::int as members,
      count(*) filter (where a.outcome_maturity = 'MATURE')::int as mature_members,
      count(*) filter (where a.outcome_maturity = 'MATURE' and a.reached_mlb_verified is not null)::int as mature_audited_members,
      count(*) filter (where a.outcome_maturity = 'MATURE' and a.reached_mlb_verified)::int as mature_reached_mlb,
      sum(a.career_bwar) filter (where a.outcome_maturity = 'MATURE' and a.reached_mlb_verified) as mature_career_bwar_total,
      percentile_cont(0.5) within group (order by a.years_signing_to_debut_season) filter (where a.reached_mlb_verified) as median_years_to_debut_season
    from a group by a.coarse_archetype_key, a.signing_route, a.position_family, a.age_band, a.population_class
  )
  select agg.coarse_archetype_key, agg.signing_route, agg.position_family, agg.age_band, agg.population_class,
    agg.members, agg.mature_members, agg.mature_audited_members, agg.mature_reached_mlb,
    round(agg.mature_career_bwar_total, 2) as mature_career_bwar_total,
    round(agg.median_years_to_debut_season::numeric, 1) as median_years_to_debut_season,
    case when agg.population_class <> 'OUTCOME_SELECTED_SAMPLE' and agg.mature_audited_members >= 10
      then round(agg.mature_reached_mlb::numeric / agg.mature_audited_members, 3) end as sample_reach_share,
    case
      when agg.population_class = 'OUTCOME_SELECTED_SAMPLE' then 'OUTCOME_SELECTED_NOT_COMPARABLE'
      when agg.mature_audited_members >= 10 then 'DESCRIPTIVE_SAMPLE'
      else 'INSUFFICIENT_SAMPLE'
    end as sample_state
  from agg
)
select * from m;

comment on view public.v_archetype_outcome_summary is
  'Archetype outcomes (Migration 040): one row per coarse archetype (route | position family at signing | age band) and population class; classes are never pooled. sample_reach_share needs a non-outcome-selected class with 10+ mature audited members; OUTCOME_SELECTED_SAMPLE rows carry none. Descriptive only.';

-- Research queue: signings that cannot be placed in an archetype or have too little comparable history, for the signings whose outcome
-- is still open (the ones a comparison could inform).
create or replace view public.v_archetype_research_queue
with (security_invoker = true)
as
with m as materialized (
  with h as materialized (
    select h.*, o.outcome_maturity from public.v_player_historical_archetype h
    join public.v_player_realized_outcome o on o.signing_id = h.signing_id
    where h.population_class <> 'OUTCOME_SELECTED_SAMPLE'
  ),
  s as (select target_signing_id, sum(comparables)::int as comparables from public.v_player_comparable_summary group by 1)
  select 'ARCHETYPE_UNDEFINED'::text as issue, 2 as priority, h.signing_id, h.player_slug, h.full_name, h.signing_year,
    format('The archetype is undefined (%s); record the missing signing-time fact.', h.archetype_gap) as detail
  from h where not h.archetype_defined
  union all
  select 'INSUFFICIENT_COMPARABLE_HISTORY', 3, h.signing_id, h.player_slug, h.full_name, h.signing_year,
    format('%s earlier comparable signing(s) share the route and position family at signing; at least 5 are needed to describe the comparable history.', coalesce(s.comparables, 0))
  from h left join s on s.target_signing_id = h.signing_id
  where h.archetype_defined and h.outcome_maturity = 'NOT_MATURE' and coalesce(s.comparables, 0) < 5
)
select * from m;

comment on view public.v_archetype_research_queue is
  'Archetype research queue (Migration 040): non-outcome-selected signings whose archetype is undefined (position at signing or age unknown), and open-outcome signings with fewer than 5 earlier comparables.';

do $$
declare t text;
begin
  foreach t in array array['v_player_historical_archetype', 'v_player_comparables', 'v_player_comparable_summary', 'v_archetype_outcome_summary',
                           'v_archetype_research_queue'] loop
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
    raise exception '040: API roles hold privileges beyond SELECT: %', bad;
  end if;
  select count(*) into n from public.v_player_historical_archetype;
  select count(*) into expected from public.signings;
  if n <> expected then
    raise exception '040 postcondition: % archetype rows for % signings', n, expected;
  end if;
  -- comparables: earlier signing year, same route and position family, never outcome-selected, at most 20, ranks 1..n without gaps
  select count(*) into n from public.v_player_comparables c
  join public.v_signing_time_features t on t.signing_id = c.target_signing_id
  join public.v_signing_time_features k on k.signing_id = c.comparable_signing_id
  where k.signing_year >= t.signing_year or k.signing_route <> t.signing_route or k.position_family <> t.position_family
     or k.population_class = 'OUTCOME_SELECTED_SAMPLE' or c.comparable_rank > 20;
  if n <> 0 then
    raise exception '040 postcondition: % comparable row(s) violate the selection rules', n;
  end if;
end $$;

commit;
