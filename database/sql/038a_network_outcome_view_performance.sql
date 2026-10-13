-- DISI v0.29.1
-- 038a_network_outcome_view_performance.sql
-- Post-038 performance correction, applied after 038 and before any 039. Query shape only: v_network_player_outcomes keeps its
-- columns, types, rows, NULLs, labels, grants, comment and security_invoker behaviour; no table, fact, grant or policy changes.
--
-- Why. On the hosted database the 038 definition computed the 036 realized-outcome spine three times, plus the 036 expectation layer
-- and the 037 pathway layer for every tracked signing, before selecting the few documented network players; as anon it, and the
-- v_network_outcome_summary / v_network_outcome_research_queue views that read it, could exceed the 3 s statement timeout. This
-- definition reads the spine once and applies the 036 anchor and 037 pathway-class rules to the documented players only.
--
-- Built from database/research/038a/ (views.sql, build.mjs). The 038 file itself is applied and frozen in place; it is not edited.
--
-- Rerunnable: every statement is idempotent.

begin;

do $$
begin
  if to_regclass('public.v_network_player_outcomes') is null or to_regclass('public.v_network_outcome_summary') is null then
    raise exception '038a: Migration 038 has not been applied';
  end if;
end $$;

-- ===========================================================================
-- Migration 038a: v_network_player_outcomes, same columns and rows, computed for the documented network players only
-- ===========================================================================

-- The 038 definition read v_player_realized_outcome, v_player_expectation_vs_outcome and v_player_development_pathway, each of
-- which computes every tracked signing (the realized-outcome spine three times, the development summary and the expectation layer
-- once each) before the handful of documented players was selected. This definition starts from the ACTIVE relationships, reads the
-- spine once, and derives the expectation anchor and the pathway class for the documented players only, with exactly the 036 / 037
-- rules (the 038a tests compare every column with the 036 / 037 views for every Dodgers signing). v_network_outcome_summary and
-- v_network_outcome_research_queue read this view and are unchanged; v_network_outcome_coverage never read it.
create or replace view public.v_network_player_outcomes
with (security_invoker = true)
as
with m as materialized (
  with rel as materialized (
    select pr.* from public.player_network_relationships pr where pr.record_status = 'ACTIVE'
  ),
  r as materialized (
    select o.* from public.v_player_realized_outcome o where o.player_id in (select rel.player_id from rel)
  ),
  -- 036: the earliest banded pre-debut (or no-debut) observation per player and band family, its comparison state, and then the
  -- earliest of those anchors across families (the 038 choice)
  fam_anchor as materialized (
    select distinct on (o.player_id, o.band_family) o.*
    from public.v_scouting_expectation_observations o
    where o.player_id in (select r.player_id from r) and o.banding_state = 'BANDED' and o.debut_order in ('PRE_DEBUT', 'NO_DEBUT')
    order by o.player_id, o.band_family, o.evaluation_year nulls last, coalesce(o.evaluation_month, 0), o.evaluation_date nulls first, o.band_order, o.evaluation_id
  ),
  anchor as materialized (
    select distinct on (fa.player_id) fa.player_id, fa.band_family, fa.band_label,
      case
        when r.signing_id is null then 'OUTCOME_INCOMPLETE'
        when r.reached_mlb_verified is null then case when r.outcome_maturity = 'MATURE' then 'OUTCOME_INCOMPLETE' else 'TOO_EARLY' end
        when r.reached_mlb_verified then case
          when sb.exceeded_career_bwar_floor is not null and r.career_bwar >= sb.exceeded_career_bwar_floor then 'EXPECTATION_EXCEEDED'
          when sb.met_career_bwar_floor is null then 'EXPECTATION_MET'
          when r.career_bwar is null then 'OUTCOME_INCOMPLETE'
          when r.career_bwar >= sb.met_career_bwar_floor then 'EXPECTATION_MET'
          when r.career_still_accruing or r.outcome_maturity <> 'MATURE' then 'TOO_EARLY'
          else 'EXPECTATION_UNDERPERFORMED' end
        when r.outcome_maturity <> 'MATURE' then 'TOO_EARLY'
        when r.outcome_state = 'NO_MLB_ACTIVE_IN_MINORS' then 'TOO_EARLY'
        else 'EXPECTATION_UNDERPERFORMED'
      end as comparison_state
    from fam_anchor fa
    join public.scouting_expectation_bands sb on sb.band_code = fa.band_code
    left join r on r.player_id = fa.player_id
    order by fa.player_id, fa.evaluation_year nulls last, fa.evaluation_date nulls first, fa.band_family
  ),
  -- 037: the pathway class and status of the documented Dodgers signings
  latest as materialized (
    select max(s.season) as latest_observed_season from public.player_season_stints s where s.stint_kind = 'TEAM_STINT'
  ),
  sp as materialized (
    select x.* from public.v_player_development_season_path x where x.player_id in (select r.player_id from r where r.is_dodgers)
  ),
  path as materialized (
    select sp.player_id, max(sp.season) as last_affiliated_season, min(sp.season) as first_affiliated_season, count(*)::int as observed_seasons,
      count(*) filter (where sp.below_prior_primary_level)::int as seasons_below_prior_level
    from sp group by sp.player_id
  ),
  runs as (
    select ru.player_id, ru.run_length, ru.run_end
    from (
      select x.player_id, x.primary_level_rank, x.grp, count(*)::int as run_length, max(x.season) as run_end
      from (
        select sp.player_id, sp.season, sp.primary_level_rank,
          sp.observed_season_number - row_number() over (partition by sp.player_id, sp.primary_level_rank order by sp.season)
            + sum(case when sp.absent_seasons_before > 0 then 1000 else 0 end) over (partition by sp.player_id order by sp.season) as grp
        from sp
      ) x
      group by x.player_id, x.primary_level_rank, x.grp
    ) ru
  ),
  run_stats as materialized (
    select ru.player_id, (array_agg(ru.run_length order by ru.run_end desc))[1] as current_same_level_run from runs ru group by ru.player_id
  ),
  arrivals as materialized (
    select p.player_id,
      min(p.developmental_arrival_season) filter (where p.development_state = 'REACHED' and p.level in ('AA', 'AAA', 'MLB')) as aa_or_higher_arrival_season,
      count(*) filter (where p.development_state = 'UNRESOLVED')::int as levels_unresolved
    from public.v_player_development_progression p
    where p.player_id in (select r.player_id from r where r.is_dodgers)
    group by p.player_id
  ),
  pro_debut as materialized (
    select d.player_id, min(d.season_year) as season_year
    from public.development_milestones d
    where d.event_code = 'PROFESSIONAL_DEBUT' and d.player_id in (select r.player_id from r where r.is_dodgers)
    group by d.player_id
  ),
  feat as (
    select r.signing_id, r.reached_mlb_verified,
      case when r.pathway in ('CUBAN_PRO', 'JAPAN_PRO', 'KOREA_PRO', 'POSTED_PLAYER', 'MEXICAN_LEAGUE_TRANSFER') then 'PROFESSIONAL_SIGNING' else 'AMATEUR_OR_UNCLASSIFIED_SIGNING' end as signing_route,
      coalesce(pd.season_year, pa.first_affiliated_season) as professional_debut_season,
      coalesce(pa.observed_seasons, 0) as observed_seasons, coalesce(pa.seasons_below_prior_level, 0) as seasons_below_prior_level,
      coalesce(ar.levels_unresolved, 0) as levels_unresolved, ar.aa_or_higher_arrival_season, rs.current_same_level_run,
      pa.last_affiliated_season, lt.latest_observed_season
    from r
    left join pro_debut pd on pd.player_id = r.player_id
    left join path pa on pa.player_id = r.player_id
    left join run_stats rs on rs.player_id = r.player_id
    left join arrivals ar on ar.player_id = r.player_id
    cross join latest lt
    where r.is_dodgers
  ),
  feat2 as (
    select f.*,
      case when f.aa_or_higher_arrival_season is not null then f.aa_or_higher_arrival_season - f.professional_debut_season
        - case when f.professional_debut_season < 2020 and f.aa_or_higher_arrival_season > 2020 then 1 else 0 end end as seasons_to_aa,
      case when f.last_affiliated_season is not null then f.latest_observed_season - f.professional_debut_season + 1
        - case when f.professional_debut_season < 2020 and f.latest_observed_season > 2020 then 1 else 0 end end as seasons_since_debut,
      (f.last_affiliated_season >= f.latest_observed_season - 1) as active_affiliated
    from feat f
  ),
  pw as materialized (
    select f.signing_id,
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
      end as pathway_status
    from feat2 f
  )
  select
    pr.id as relationship_id, pr.player_id, r.player_slug, r.full_name, r.signing_id, r.signing_year, r.pathway, r.country_market,
    ne.id as entity_id, ne.slug as entity_slug, ne.canonical_name as entity_name, ne.entity_type,
    pr.relationship_type, pr.stage, (pr.signing_id is not null) as signing_linked,
    pr.confidence::text as relationship_confidence, pr.evidence_basis,
    case
      when pr.signing_id is not null and pr.stage in ('PRE_SIGNING', 'AT_SIGNING') and pr.confidence in ('VERIFIED', 'HIGH') then 'HIGH'
      when pr.signing_id is not null or pr.confidence in ('VERIFIED', 'HIGH') then 'MEDIUM'
      else 'LOW'
    end as attribution_confidence,
    r.outcome_state, r.reached_mlb_verified, r.outcome_maturity, r.career_bwar, r.signing_org_bwar as dodgers_bwar, r.elsewhere_bwar as non_dodgers_bwar,
    r.dodgers_attributable_organizational_bwar, r.known_acquisition_cost_usd, r.acquisition_cost_completeness,
    a.band_family as expectation_band_family, a.band_label as expectation_band_label, a.comparison_state as expectation_comparison_state,
    p.pathway_class, p.pathway_status,
    r.analysis_as_of_date
  from rel pr
  join public.network_entities ne on ne.id = pr.entity_id
  join r on r.player_id = pr.player_id
  left join anchor a on a.player_id = pr.player_id
  left join pw p on p.signing_id = r.signing_id
)
select * from m;

-- No COMMENT statement: CREATE OR REPLACE VIEW keeps the 038 comment, so the view's metadata is unchanged.

do $$
declare
  bad text;
  n int;
  expected int;
begin
  -- the public API surface is unchanged: SELECT only for anon / authenticated, the view still security_invoker
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '038a: API roles hold privileges beyond SELECT: %', bad;
  end if;
  if not has_table_privilege('anon', 'public.v_network_player_outcomes', 'SELECT')
     or not exists (select 1 from pg_class where oid = 'public.v_network_player_outcomes'::regclass and array_to_string(reloptions, ',') ~ 'security_invoker=(true|on)') then
    raise exception '038a postcondition: v_network_player_outcomes lost its anon SELECT grant or security_invoker';
  end if;
  -- one row per ACTIVE relationship, as before
  select count(*) into expected from public.player_network_relationships where record_status = 'ACTIVE';
  select count(*) into n from public.v_network_player_outcomes;
  if n <> expected then
    raise exception '038a postcondition: % network outcome rows for % ACTIVE relationships', n, expected;
  end if;
end $$;

commit;
