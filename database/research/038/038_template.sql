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

{{views}}

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
