-- ===========================================================================
-- Migration 035 views: benchmark outcomes, class coverage, research queue
-- ===========================================================================

-- One row per signing of the benchmark scope (MLB Pipeline Top-prospect signings, every organization including the Dodgers):
-- outcome state, debut, years to debut season, direct (original-organization) and elsewhere bWAR where team-season facts exist, and
-- which comparison tiers the row can support. An unaudited player is UNAUDITED with a NULL reach flag: missing is never "no MLB".
create or replace view public.v_international_benchmark_player_outcomes
with (security_invoker = true)
as
with m as materialized (
  with as_of as (select max(audited_through_date) as analysis_as_of_date from public.outcome_audits),
  mem as (
    select m.signing_id, array_agg(sp.population_key order by sp.population_key) as population_keys,
      (array_agg(sp.population_scope order by sp.population_key))[1] as population_scope
    from public.signing_population_members m join public.signing_populations sp on sp.id = m.population_id
    group by m.signing_id
  ),
  war as (
    select w.bref_id,
      count(*)::int as team_season_rows,
      count(*) filter (where w.organization_id is null)::int as unmapped_rows,
      sum(w.war) as career_bwar,
      sum(w.war) filter (where og.franchise_key = f.franchise_key) as original_org_bwar,
      sum(w.war) filter (where og.franchise_key is distinct from f.franchise_key and w.organization_id is not null) as elsewhere_bwar,
      max(w.season) as last_season
    from public.player_mlb_team_season_war w
    left join public.organizations og on og.id = w.organization_id
    join public.players pl on pl.bref_id = w.bref_id
    join public.signings s on s.player_id = pl.id
    join public.organizations f on f.id = s.organization_id
    where w.record_status = 'ACTIVE' and w.war_system = 'BWAR'
    group by w.bref_id, f.franchise_key
  )
  select
    s.id as signing_id, pl.id as player_id, pl.slug as player_slug, pl.full_name,
    o.abbreviation as organization, o.franchise_key, (o.franchise_key = 'DODGERS') as is_dodgers,
    s.signing_year, s.country_market, s.pathway, s.record_scope,
    coalesce(pl.primary_position, s.position_at_signing) as primary_position,
    s.international_rank, s.rank_source,
    mem.population_keys, mem.population_scope,
    s.signing_bonus_usd, f.known_acquisition_cost_usd, f.acquisition_cost_completeness,
    pl.birth_date,
    case when pl.birth_date is not null then s.signing_year - extract(year from pl.birth_date)::int end as age_in_signing_year,
    (pl.mlb_id is not null) as identity_resolved,
    case when a.player_id is null then 'UNAUDITED' else a.outcome_state end as outcome_state,
    a.reached_mlb_verified,
    a.audited_through_date,
    a.confidence::text as audit_confidence,
    oc.mlb_debut_date,
    case when oc.mlb_debut_date is not null then extract(year from oc.mlb_debut_date)::int - s.signing_year end as years_signing_to_debut_season,
    w.team_season_rows, w.career_bwar, w.original_org_bwar, w.elsewhere_bwar,
    w.last_season as bwar_last_season,
    (s.signing_year <= extract(year from ao.analysis_as_of_date)::int - 5) as is_mature,
    ao.analysis_as_of_date,
    -- tier 1: reach / age / bonus / time to MLB are comparable across organizations once audited; tier 2 additionally needs loaded
    -- team-season facts; tier 3 (organizational realization with transaction lineage) exists for the Dodgers only
    (a.player_id is not null) as tier1_reach_comparable,
    (a.reached_mlb_verified is true and w.team_season_rows > 0 and w.unmapped_rows = 0) as tier2_original_org_bwar_comparable,
    false as tier3_organizational_realization_comparable
  from public.signings s
  join public.players pl on pl.id = s.player_id
  join public.organizations o on o.id = s.organization_id
  join public.v_signing_acquisition_financials f on f.signing_id = s.id
  left join mem on mem.signing_id = s.id
  left join public.outcome_audits a on a.player_id = pl.id
  left join public.outcomes oc on oc.player_id = pl.id
  left join war w on w.bref_id = pl.bref_id
  cross join as_of ao
  where s.record_scope = 'MLB_PIPELINE_TOP_PROSPECT'
)
select * from m;

comment on view public.v_international_benchmark_player_outcomes is
  'One row per Top-prospect-tracker signing (every organization). This is a prospect-rank-selected sample, not a census and not an organization population: a tracker row says the player was a ranked prospect, so reach and bWAR describe ranked prospects only. outcome_state is UNAUDITED (reached flag NULL, never false) until an outcome audit exists. original_org_bwar sums team-season bWAR with the signing organization''s franchise, elsewhere_bwar the rest; each is NULL when no loaded team-season row exists for that side (no season with the organization is not a zero-WAR season, and no loaded facts is not a zero). The three tier flags say which comparisons the row can support; organizational realization (tier 3) is Dodgers-only context and is not comparable. No rank, percentile or organization ordering is computed.';

-- One row per tracked signing population: what it is, how much of it DISI holds, how much is audited, and whether it can support an
-- organizational rate. rate_eligible_strict is derived and deliberately demanding; the legacy rate_analysis_suitable flag is shown
-- beside it, never trusted in its place.
create or replace view public.v_international_benchmark_class_coverage
with (security_invoker = true)
as
with m as materialized (
  with as_of as (select max(audited_through_date) as analysis_as_of_date from public.outcome_audits),
  mem as (
    select m.population_id, o.franchise_key,
      count(*)::int as members,
      count(*) filter (where p.mlb_id is not null)::int as members_identity_resolved,
      count(*) filter (where a.player_id is not null)::int as members_audited,
      count(*) filter (where a.reached_mlb_verified is true)::int as members_reached,
      count(*) filter (where s.signing_bonus_usd is not null)::int as members_bonus_known,
      count(*) filter (where f.acquisition_cost_completeness = 'COMPLETE')::int as members_cost_complete,
      count(*) filter (where o.franchise_key = 'DODGERS')::int as dodgers_members
    from public.signing_population_members m
    join public.signings s on s.id = m.signing_id
    join public.players p on p.id = s.player_id
    join public.organizations o on o.id = s.organization_id
    join public.v_signing_acquisition_financials f on f.signing_id = s.id
    left join public.outcome_audits a on a.player_id = p.id
    group by m.population_id, o.franchise_key
  ),
  agg as (
    select population_id, sum(members)::int as members, sum(members_identity_resolved)::int as members_identity_resolved,
      sum(members_audited)::int as members_audited, sum(members_reached)::int as members_reached, sum(members_bonus_known)::int as members_bonus_known,
      sum(members_cost_complete)::int as members_cost_complete, sum(dodgers_members)::int as dodgers_members,
      count(distinct franchise_key)::int as organizations
    from mem group by population_id
  )
  select
    sp.population_key, sp.franchise_key, sp.population_scope, sp.period_label, sp.class_year_start, sp.class_year_end,
    sp.expected_size, sp.rate_analysis_suitable as legacy_rate_analysis_suitable,
    coalesce(g.members, 0) as members, coalesce(g.members_identity_resolved, 0) as members_identity_resolved,
    coalesce(g.members_audited, 0) as members_audited, coalesce(g.members_reached, 0) as members_reached,
    coalesce(g.members_bonus_known, 0) as members_bonus_known, coalesce(g.members_cost_complete, 0) as members_cost_complete,
    coalesce(g.organizations, 0) as organizations, coalesce(g.dodgers_members, 0) as dodgers_members,
    (sp.class_year_end <= extract(year from ao.analysis_as_of_date)::int - 5) as is_mature,
    case
      when sp.population_scope = 'FULL_SIGNING_PERIOD' and sp.expected_size is not null and coalesce(g.members, 0) = sp.expected_size then 'CENSUS_COMPLETE'
      when sp.population_scope = 'FULL_SIGNING_PERIOD' and coalesce(g.members, 0) > 0 then 'CENSUS_PARTIAL'
      when sp.population_scope = 'FULL_SIGNING_PERIOD' then 'UNKNOWN_COVERAGE'
      when sp.population_scope = 'TOP_PROSPECT_SAMPLE' then 'TOP_PROSPECT_SAMPLE'
      when sp.population_scope = 'HISTORICAL_VERIFIED_SET' then 'VERIFIED_SAMPLE'
      when sp.population_scope = 'OPENING_CLASS' then 'OPENING_CLASS_PARTIAL'
      else 'CURATED_SAMPLE' end as census_state,
    ao.analysis_as_of_date
  from public.signing_populations sp
  left join agg g on g.population_id = sp.id
  cross join as_of ao
),
x as (
  select m.*,
    array_remove(array[
      case when population_scope <> 'FULL_SIGNING_PERIOD' then 'NOT_A_FULL_SIGNING_PERIOD' end,
      case when expected_size is null then 'DENOMINATOR_NOT_SOURCED' end,
      case when expected_size is not null and members <> expected_size then 'MEMBERS_DO_NOT_EQUAL_EXPECTED_SIZE' end,
      case when members_audited < members or members = 0 then 'OUTCOMES_NOT_FULLY_AUDITED' end,
      case when members_identity_resolved < members or members = 0 then 'IDENTITIES_NOT_FULLY_RESOLVED' end,
      case when not is_mature then 'COHORT_NOT_MATURE' end
    ], null) as rate_blockers
  from m
)
select
  population_key, franchise_key, population_scope, period_label, class_year_start, class_year_end,
  expected_size, members, members_identity_resolved, members_audited, members_reached, members_bonus_known, members_cost_complete,
  organizations, dodgers_members, is_mature, census_state,
  (cardinality(rate_blockers) = 0) as rate_eligible_strict,
  rate_blockers,
  legacy_rate_analysis_suitable,
  case when cardinality(rate_blockers) = 0 then 'CLASS_COMPLETE_COMPARISON' else 'SAMPLE_COMPARISON' end as comparison_label,
  (dodgers_members > 0) as has_dodgers_comparator,
  analysis_as_of_date
from x;

comment on view public.v_international_benchmark_class_coverage is
  'One row per signing population. census_state: CENSUS_COMPLETE only for a FULL_SIGNING_PERIOD whose sourced expected_size equals the members DISI holds; TOP_PROSPECT_SAMPLE, VERIFIED_SAMPLE, OPENING_CLASS_PARTIAL and CENSUS_PARTIAL are samples. rate_eligible_strict is true only for a full signing period with a sourced denominator, every member held, identified and outcome-audited, and a mature cohort; rate_blockers lists every unmet requirement. The legacy rate_analysis_suitable flag is shown beside it and is never used in its place. comparison_label is SAMPLE_COMPARISON unless the class is strictly eligible (CLASS_COMPLETE_COMPARISON); a league-rate comparison needs every organization''s class complete for one period and is not available for any period. No organization ranking is computed.';

-- Unresolved benchmark research, derived from the facts. Counts are never fixed.
create or replace view public.v_international_benchmark_research_queue
with (security_invoker = true)
as
with m as materialized (
  with issues as (
    select 'BENCHMARK_IDENTITY_UNRESOLVED'::text as issue, 1 as priority, o.player_slug, o.population_keys[1] as population_key, o.organization, o.signing_year,
      'The benchmark player has no MLB id: the outcome cannot be audited and no MLB reach is inferred'::text as detail
    from public.v_international_benchmark_player_outcomes o
    where o.is_dodgers is false and not o.identity_resolved
    union all
    select 'BENCHMARK_OUTCOME_UNAUDITED', 2, o.player_slug, o.population_keys[1], o.organization, o.signing_year,
      'An identity-resolved benchmark player has no MLB outcome audit; reach is unknown, not no'
    from public.v_international_benchmark_player_outcomes o
    where o.identity_resolved and o.outcome_state = 'UNAUDITED'
    union all
    select 'BENCHMARK_REACHED_WITHOUT_TEAM_SEASON_FACTS', 2, o.player_slug, o.population_keys[1], o.organization, o.signing_year,
      'A benchmark player who reached MLB has no loaded team-season bWAR facts; career and original-organization bWAR are unknown'
    from public.v_international_benchmark_player_outcomes o
    where o.reached_mlb_verified is true and coalesce(o.team_season_rows, 0) = 0
    union all
    select 'BENCHMARK_BONUS_UNKNOWN', 3, o.player_slug, o.population_keys[1], o.organization, o.signing_year,
      'The signing bonus is not sourced; bonus-based comparisons exclude this player'
    from public.v_international_benchmark_player_outcomes o
    where o.is_dodgers is false and o.signing_bonus_usd is null
    union all
    select 'POPULATION_MEMBERS_NOT_TRACKED', 2, null, c.population_key, null, c.class_year_start,
      format('The population names %s members; %s are tracked. Untracked members are unknown, not non-reachers', c.expected_size, c.members)
    from public.v_international_benchmark_class_coverage c
    where c.expected_size is not null and c.members < c.expected_size
    union all
    select 'POPULATION_DENOMINATOR_NOT_SOURCED', 3, null, c.population_key, null, c.class_year_start,
      'The population is flagged suitable for rate analysis in the legacy model but no sourced expected size exists; no rate is computed'
    from public.v_international_benchmark_class_coverage c
    where c.legacy_rate_analysis_suitable and c.expected_size is null
    union all
    select 'SAMPLE_HAS_NO_DODGERS_COMPARATOR', 4, null, c.population_key, null, c.class_year_start,
      'Informational: the sample has no Dodgers member, so no Dodgers-versus-sample comparison is possible within it'
    from public.v_international_benchmark_class_coverage c
    where c.census_state = 'TOP_PROSPECT_SAMPLE' and c.dodgers_members = 0
  )
  select i.issue, i.priority, i.player_slug, i.population_key, i.organization, i.signing_year, i.detail from issues i
)
select * from m;

comment on view public.v_international_benchmark_research_queue is
  'Unresolved international-benchmark research, derived from the facts: identity-unresolved or unaudited benchmark players, reachers without team-season facts, unknown bonuses, population members that are named but not tracked, rate-suitable populations with no sourced denominator, and (informationally) samples with no Dodgers comparator.';
