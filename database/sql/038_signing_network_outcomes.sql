-- DISI v0.29
-- 038_signing_network_outcomes.sql
-- Trainer / academy / signing network outcomes: derived, read-only views that place the 029 documented network associations beside the
-- 036 realized-outcome spine and expectation anchors and the 037 development pathways, with explicit coverage and sample guardrails.
-- Run after 037.
--
-- Built from database/research/038/ (views.sql, audit.mjs, build.mjs; design in database/research/036/architecture-report.md).
--
-- What this is. No table, no fact; 029 is not rewritten. A documented association is context, never a cause: no value, bonus or
-- outcome is credited to a trainer, academy, program or showcase. DISI holds no entity's full population, so every entity summary has
-- denominator_known = false and a sample state that is never a census; the known network sample is shown beside the unattributed
-- signings with the fixed label DESCRIPTIVE_ONLY_SELECTION_BIASED. No rate, ranking, ratio, ROI or leaderboard is computed.
--
-- Views: v_network_player_outcomes, v_network_outcome_summary, v_network_outcome_coverage, v_network_outcome_research_queue.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 1. PRECONDITIONS
-- ===========================================================================

do $$
begin
  if to_regclass('public.v_player_development_pathway') is null or to_regclass('public.v_development_pathway_summary') is null then
    raise exception '038: Migration 037 has not been applied';
  end if;
  if to_regclass('public.player_network_relationships') is null or to_regclass('public.network_entities') is null then
    raise exception '038: the Migration 029 network layer is missing';
  end if;
  -- every documented association belongs to a tracked signing (the outcome spine keys on it)
  if exists (select 1 from public.player_network_relationships pr where pr.record_status = 'ACTIVE'
             and not exists (select 1 from public.signings s where s.player_id = pr.player_id)) then
    raise exception '038: an ACTIVE network relationship names a player without a tracked signing';
  end if;
end $$;

-- ===========================================================================
-- 2. VIEWS
-- ===========================================================================

-- ===========================================================================
-- Migration 038 views: network player outcomes, network outcome summary, known-sample coverage, network outcome research queue
-- ===========================================================================

-- One row per ACTIVE player-network relationship (029): the documented association, how strongly it is documented, and the player's
-- realized outcome (036 spine), earliest public expectation (036) and development pathway (037). An association is context, never a
-- cause: no value, bonus or outcome is credited to the entity.
create or replace view public.v_network_player_outcomes
with (security_invoker = true)
as
with m as materialized (
  with anchor as (
    select distinct on (x.player_id) x.player_id, x.band_family, x.band_label, x.comparison_state
    from public.v_player_expectation_vs_outcome x
    where x.band_code is not null
    order by x.player_id, x.anchor_evaluation_year nulls last, x.anchor_evaluation_date nulls first, x.band_family
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
  from public.player_network_relationships pr
  join public.network_entities ne on ne.id = pr.entity_id
  join public.v_player_realized_outcome r on r.player_id = pr.player_id
  left join anchor a on a.player_id = pr.player_id
  left join public.v_player_development_pathway p on p.signing_id = r.signing_id
  where pr.record_status = 'ACTIVE'
)
select * from m;

comment on view public.v_network_player_outcomes is
  'Network context of realized outcomes (Migration 038): one row per ACTIVE player-network relationship (029) with the player''s outcome (v_player_realized_outcome), earliest public expectation (v_player_expectation_vs_outcome) and pathway class (v_player_development_pathway). attribution_confidence grades how strongly the ASSOCIATION is documented - HIGH: tied to the signing, stated before or at signing, HIGH / VERIFIED source confidence; MEDIUM: tied to the signing or HIGH / VERIFIED; LOW otherwise - and is never a share of credit. A trainer, academy, program or showcase is not credited with any value, bonus or outcome, and nothing here is causal or predictive.';

-- One row per network entity and relationship type: the tracked signees and their outcomes, with coverage and sample indicators.
-- DISI holds no entity's full population of trainees or signees, so denominator_known is always false: these are documented
-- associations, not a census, and no rate, ranking, ratio or ROI is computed.
create or replace view public.v_network_outcome_summary
with (security_invoker = true)
as
with m as materialized (
  with x as (select * from public.v_network_player_outcomes),
  per_player as (
    -- one row per entity, relationship type and player (a player can be linked to an entity by more than one relationship row)
    select x.entity_id, x.entity_slug, x.entity_name, x.entity_type, x.relationship_type, x.player_id,
      bool_or(x.signing_linked) as signing_linked, max(x.attribution_confidence) filter (where x.attribution_confidence = 'HIGH') as has_high,
      min(x.outcome_maturity) as outcome_maturity, bool_or(x.reached_mlb_verified) as reached_mlb_verified,
      bool_and(x.reached_mlb_verified is not null) as audited,
      max(x.career_bwar) as career_bwar, max(x.dodgers_bwar) as dodgers_bwar, max(x.non_dodgers_bwar) as non_dodgers_bwar,
      max(x.dodgers_attributable_organizational_bwar) as dodgers_attributable_organizational_bwar,
      max(x.known_acquisition_cost_usd) as known_acquisition_cost_usd, min(x.acquisition_cost_completeness) as acquisition_cost_completeness,
      max(x.pathway_class) as pathway_class, bool_or(x.expectation_band_family is not null) as has_expectation
    from x
    group by x.entity_id, x.entity_slug, x.entity_name, x.entity_type, x.relationship_type, x.player_id
  ),
  agg as (
    select pp.entity_id, pp.entity_slug, pp.entity_name, pp.entity_type, pp.relationship_type,
      count(*)::int as tracked_signees,
      count(*) filter (where pp.signing_linked)::int as signing_linked_signees,
      count(*) filter (where pp.has_high is not null)::int as high_confidence_signees,
      count(*) filter (where pp.outcome_maturity = 'MATURE')::int as mature_signees,
      count(*) filter (where pp.outcome_maturity = 'MATURE' and pp.audited)::int as mature_audited_signees,
      count(*) filter (where pp.audited)::int as audited_signees,
      count(*) filter (where pp.reached_mlb_verified)::int as reached_mlb,
      sum(pp.career_bwar) as career_bwar_total,
      sum(pp.dodgers_bwar) as dodgers_bwar_total,
      sum(pp.non_dodgers_bwar) as non_dodgers_bwar_total,
      sum(pp.dodgers_attributable_organizational_bwar) as dodgers_attributable_bwar_total,
      count(*) filter (where pp.acquisition_cost_completeness = 'COMPLETE')::int as cost_complete_signees,
      sum(pp.known_acquisition_cost_usd) filter (where pp.acquisition_cost_completeness = 'COMPLETE') as complete_acquisition_cost_usd,
      count(*) filter (where pp.has_expectation)::int as expectation_anchored_signees,
      array_agg(distinct pp.pathway_class order by pp.pathway_class) filter (where pp.pathway_class is not null) as pathway_classes
    from per_player pp
    group by pp.entity_id, pp.entity_slug, pp.entity_name, pp.entity_type, pp.relationship_type
  )
  select
    a.entity_id, a.entity_slug, a.entity_name, a.entity_type, a.relationship_type,
    a.tracked_signees, a.signing_linked_signees, a.high_confidence_signees, a.mature_signees, a.mature_audited_signees, a.audited_signees,
    a.reached_mlb,
    round(a.career_bwar_total, 2) as career_bwar_total,
    round(a.dodgers_bwar_total, 2) as dodgers_bwar_total,
    round(a.non_dodgers_bwar_total, 2) as non_dodgers_bwar_total,
    round(a.dodgers_attributable_bwar_total, 2) as dodgers_attributable_bwar_total,
    a.cost_complete_signees,
    case when a.cost_complete_signees = a.tracked_signees then a.complete_acquisition_cost_usd end as complete_acquisition_cost_usd,
    case when a.cost_complete_signees = a.tracked_signees then 'COMPLETE' when a.cost_complete_signees > 0 then 'PARTIAL' else 'NONE' end as cost_coverage,
    a.expectation_anchored_signees,
    coalesce(a.pathway_classes, '{}'::text[]) as pathway_classes,
    round(a.audited_signees::numeric / a.tracked_signees, 3) as outcome_coverage,
    false as denominator_known,
    case when a.mature_audited_signees < 3 then 'ANECDOTAL' when a.mature_audited_signees < 10 then 'SMALL_SAMPLE' else 'DESCRIPTIVE_SAMPLE' end as network_sample_state,
    'NO_COMPARISON_DENOMINATOR_UNKNOWN'::text as comparison_label
  from agg a
)
select * from m;

comment on view public.v_network_outcome_summary is
  'Network outcome summary (Migration 038): one row per network entity and relationship type over its documented signees (v_network_player_outcomes, one count per player). denominator_known is always false: DISI holds no entity''s full population, so these are associations, not a census; network_sample_state is ANECDOTAL below 3 mature audited signees, SMALL_SAMPLE below 10, else DESCRIPTIVE_SAMPLE, and never CENSUS. bWAR totals are descriptive sums by side (career, Dodgers, non-Dodgers, Dodgers attributable). complete_acquisition_cost_usd appears only when every signee''s acquisition cost is COMPLETE. No rate, rank, ordering by value, ratio, ROI or causal statement is computed; comparison_label is always NO_COMPARISON_DENOMINATOR_UNKNOWN.';

-- KNOWN_NETWORK_SAMPLE (Dodgers signings with any ACTIVE network relationship) vs UNATTRIBUTED_SIGNINGS (all other Dodgers signings),
-- for all signings, by signing era and by signing pathway. Documented relationships exist mostly for notable prospects, so the two
-- segments are selected differently and are never compared as if one caused the other.
create or replace view public.v_network_outcome_coverage
with (security_invoker = true)
as
with m as materialized (
  with r as (
    select r.*,
      case when exists (select 1 from public.player_network_relationships pr where pr.player_id = r.player_id and pr.record_status = 'ACTIVE')
        then 'KNOWN_NETWORK_SAMPLE' else 'UNATTRIBUTED_SIGNINGS' end as network_state,
      exists (select 1 from public.player_network_relationships pr where pr.player_id = r.player_id and pr.record_status = 'ACTIVE' and pr.signing_id is not null) as signing_linked,
      case when r.signing_year < 2010 then 'Before 2010' when r.signing_year < 2018 then '2010-2017' else '2018 and later' end as signing_era
    from public.v_player_realized_outcome r
    where r.is_dodgers
  ),
  seg as (
    select 'ALL'::text as segment_kind, 'All Dodgers signings'::text as segment_value, r.* from r
    union all
    select 'SIGNING_ERA', r.signing_era, r.* from r
    union all
    select 'PATHWAY', r.pathway, r.* from r
  ),
  agg as (
    select s.segment_kind, s.segment_value, s.network_state,
      count(*)::int as signings,
      count(*) filter (where s.signing_linked)::int as signing_linked_signings,
      count(*) filter (where s.outcome_maturity = 'MATURE')::int as mature_signings,
      count(*) filter (where s.outcome_maturity = 'MATURE' and s.reached_mlb_verified is not null)::int as mature_audited_signings,
      count(*) filter (where s.reached_mlb_verified)::int as reached_mlb,
      count(*) filter (where s.outcome_maturity = 'MATURE' and s.reached_mlb_verified)::int as mature_reached_mlb,
      round(sum(s.career_bwar), 2) as career_bwar_total,
      round(sum(s.signing_org_bwar), 2) as dodgers_bwar_total,
      count(*) filter (where s.acquisition_cost_completeness = 'COMPLETE')::int as cost_complete_signings
    from seg s
    group by s.segment_kind, s.segment_value, s.network_state
  ),
  -- every segment shows both states, so an empty known sample is stated as zero signings, not left out
  grid as (
    select g.segment_kind, g.segment_value, st.network_state
    from (select distinct segment_kind, segment_value from seg) g
    cross join (values ('KNOWN_NETWORK_SAMPLE'), ('UNATTRIBUTED_SIGNINGS')) st(network_state)
  )
  select
    g.segment_kind, g.segment_value, g.network_state,
    coalesce(a.signings, 0) as signings,
    coalesce(a.signing_linked_signings, 0) as signing_linked_signings,
    coalesce(a.mature_signings, 0) as mature_signings,
    coalesce(a.mature_audited_signings, 0) as mature_audited_signings,
    coalesce(a.reached_mlb, 0) as reached_mlb,
    coalesce(a.mature_reached_mlb, 0) as mature_reached_mlb,
    a.career_bwar_total,
    a.dodgers_bwar_total,
    coalesce(a.cost_complete_signings, 0) as cost_complete_signings,
    'DESCRIPTIVE_ONLY_SELECTION_BIASED'::text as comparison_label
  from grid g
  left join agg a on a.segment_kind = g.segment_kind and a.segment_value = g.segment_value and a.network_state = g.network_state
)
select * from m;

comment on view public.v_network_outcome_coverage is
  'Known network sample vs unattributed signings (Migration 038), for every Dodgers signing: all, by signing era, by signing pathway, each segment with both states (zero signings stated, not omitted; bWAR totals NULL when no segment member has an MLB career). KNOWN_NETWORK_SAMPLE has at least one ACTIVE documented network relationship; UNATTRIBUTED_SIGNINGS has none, which means "not documented", never "no trainer". Public sources document relationships mostly for notable prospects, so the segments are selected differently: comparison_label is always DESCRIPTIVE_ONLY_SELECTION_BIASED and no rate or difference is computed. v_dodgers_network_coverage keeps the 029 attribution-share view of its narrower denominator.';

-- Research queue for the network outcome layer. Issues are new to 038; v_network_research_queue keeps SIGNING_WITHOUT_NETWORK_ATTRIBUTION
-- and RELATIONSHIP_STAGE_UNKNOWN.
create or replace view public.v_network_outcome_research_queue
with (security_invoker = true)
as
with m as materialized (
  with x as materialized (select * from public.v_network_player_outcomes),
  -- the anecdotal test of v_network_outcome_summary, computed from the same rows (one count per player)
  s as (
    select e.entity_id, e.entity_slug, e.relationship_type, count(*)::int as tracked_signees,
      count(*) filter (where e.mature_audited)::int as mature_audited_signees
    from (select x.entity_id, x.entity_slug, x.relationship_type, x.player_id,
            bool_and(x.outcome_maturity = 'MATURE' and x.reached_mlb_verified is not null) as mature_audited
          from x group by x.entity_id, x.entity_slug, x.relationship_type, x.player_id) e
    group by e.entity_id, e.entity_slug, e.relationship_type
  )
  select distinct 'NETWORK_SIGNEE_OUTCOME_UNAUDITED'::text as issue, 2 as priority, x.player_id, x.player_slug, x.entity_id, x.entity_slug,
    format('%s is a documented %s signee and mature, but the MLB outcome is unaudited; audit it before describing the association.', x.player_slug, x.entity_slug) as detail
  from x where x.outcome_maturity = 'MATURE' and x.reached_mlb_verified is null
  union all
  select distinct 'NETWORK_SIGNEE_COST_INCOMPLETE', 3, x.player_id, x.player_slug, x.entity_id, x.entity_slug,
    format('%s acquisition cost is %s; cost totals for %s exclude it.', x.player_slug, x.acquisition_cost_completeness, x.entity_slug)
  from x where x.acquisition_cost_completeness is distinct from 'COMPLETE'
  union all
  select 'NETWORK_RELATIONSHIP_NOT_SIGNING_LINKED', 3, x.player_id, x.player_slug, x.entity_id, x.entity_slug,
    format('%s %s %s is not tied to a signing by its source; it is context for the player, not for an acquisition.', x.player_slug, lower(x.relationship_type), x.entity_slug)
  from x where not x.signing_linked
  union all
  select 'NETWORK_ENTITY_SAMPLE_ANECDOTAL', 3, null::uuid, null::text, s.entity_id, s.entity_slug,
    format('%s (%s): %s documented signee(s), %s mature and audited; anecdotal, so no outcome statement is supported. More documented signees would be needed.',
      s.entity_slug, lower(s.relationship_type), s.tracked_signees, s.mature_audited_signees)
  from s where s.mature_audited_signees < 3
)
select * from m;

comment on view public.v_network_outcome_research_queue is
  'Network outcome research queue (Migration 038): documented signees whose outcome is unaudited or whose acquisition cost is incomplete, relationships the source does not tie to a signing, and entities whose documented sample is anecdotal. Unattributed signings stay in v_network_research_queue (SIGNING_WITHOUT_NETWORK_ATTRIBUTION).';

-- ===========================================================================
-- 3. GRANTS (explicit) AND POSTCONDITIONS
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array['v_network_player_outcomes', 'v_network_outcome_summary', 'v_network_outcome_coverage', 'v_network_outcome_research_queue'] loop
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
    raise exception '038: API roles hold privileges beyond SELECT: %', bad;
  end if;
  -- one outcome row per ACTIVE relationship
  select count(*) into expected from public.player_network_relationships where record_status = 'ACTIVE';
  select count(*) into n from public.v_network_player_outcomes;
  if n <> expected then
    raise exception '038 postcondition: % network outcome rows for % ACTIVE relationships', n, expected;
  end if;
  -- no census claim and no comparison: the denominator is never known and the coverage segments are never comparable
  select count(*) into n from public.v_network_outcome_summary
  where denominator_known or network_sample_state not in ('ANECDOTAL', 'SMALL_SAMPLE', 'DESCRIPTIVE_SAMPLE') or comparison_label <> 'NO_COMPARISON_DENOMINATOR_UNKNOWN';
  if n <> 0 then
    raise exception '038 postcondition: % entity summary row(s) claim a denominator or a comparison', n;
  end if;
  select count(*) into n from public.v_network_outcome_coverage where comparison_label <> 'DESCRIPTIVE_ONLY_SELECTION_BIASED';
  if n <> 0 then
    raise exception '038 postcondition: % coverage row(s) without the selection-bias label', n;
  end if;
end $$;

commit;
