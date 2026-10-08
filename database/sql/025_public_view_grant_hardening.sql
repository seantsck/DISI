-- DISI v0.16
-- 025_public_view_grant_hardening.sql
-- Public view grant hardening. Run after 024.
--
-- Built from reviewed research (database/research/025/): audit.mjs is a read-only
-- catalog audit of every public view, view-inventory.json is the reviewed
-- inventory, and build.mjs assembles this file.
--
-- Problem (found by the post-024 live security review): 43 public views created
-- by migrations 001-016 granted ALL privileges (INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN as well as SELECT) to anon and authenticated.
-- They inherited Supabase's default privileges for objects created by postgres
-- in the public schema; later migrations revoke and re-grant explicitly, these
-- did not. Every one is security_invoker, none is updatable or insertable, none
-- has an INSTEAD OF trigger or rule, and no base table grants or policies give
-- anon/authenticated write access, so no write path existed - but least
-- privilege still applies to the view itself.
--
-- What this does:
--   * Checks that every public view is in the reviewed inventory, is a view, and
--     is security_invoker (raises otherwise; nothing is changed).
--   * For each inventoried read-only analytical view: REVOKE ALL from anon and
--     authenticated, then GRANT SELECT to both. View definitions, data, RLS,
--     policies, table grants and service_role privileges are not touched.
--   * Re-checks afterwards that no public view or table grants anon,
--     authenticated or PUBLIC anything beyond SELECT (raises and rolls back
--     otherwise).
--
-- Global default privileges are deliberately NOT changed here (see
-- database/research/025/README.md); future objects stay correct through the
-- explicit revoke-all / grant-select convention and the verifier.
--
-- Rerunnable: every statement is idempotent.

begin;

-- ===========================================================================
-- 1. GUARDS: the reviewed inventory matches the database
-- ===========================================================================

do $$
declare
  inventory text[] := array[
    'v_class_research_coverage',
    'v_database_status',
    'v_dodgers_asset_conversion_brief',
    'v_dodgers_asset_realization',
    'v_dodgers_audit_pipeline_summary',
    'v_dodgers_class_analysis_eligibility',
    'v_dodgers_class_coverage',
    'v_dodgers_class_research_progress',
    'v_dodgers_class_source_reconciliation',
    'v_dodgers_competitive_asset_brief',
    'v_dodgers_competitive_asset_conversion',
    'v_dodgers_development_by_bonus_band',
    'v_dodgers_development_by_market',
    'v_dodgers_development_by_signing_class',
    'v_dodgers_development_coverage',
    'v_dodgers_development_date_coverage',
    'v_dodgers_development_research_queue',
    'v_dodgers_executive_case_studies',
    'v_dodgers_executive_dashboard_feed',
    'v_dodgers_executive_findings_v2',
    'v_dodgers_executive_kpis',
    'v_dodgers_executive_kpis_v2',
    'v_dodgers_historical_signings',
    'v_dodgers_known_mlb_outcomes',
    'v_dodgers_market_research_progress',
    'v_dodgers_market_summary',
    'v_dodgers_mature_asset_realization',
    'v_dodgers_mature_asset_summary',
    'v_dodgers_mature_bonus_tiers',
    'v_dodgers_mature_executive_findings',
    'v_dodgers_mature_outcome_queue',
    'v_dodgers_mature_player_analysis',
    'v_dodgers_mature_premium_comparison',
    'v_dodgers_mature_tracked_sample',
    'v_dodgers_mature_year_analysis',
    'v_dodgers_next_outcome_audits',
    'v_dodgers_opening_class_cohort_rates',
    'v_dodgers_outcome_audit_operations',
    'v_dodgers_outcome_audit_progress',
    'v_dodgers_outcome_audit_queue',
    'v_dodgers_outcome_by_signing_class',
    'v_dodgers_outcome_coverage',
    'v_dodgers_pathway_summary',
    'v_dodgers_player_development_summary',
    'v_dodgers_player_identity_coverage',
    'v_dodgers_player_identity_research_queue',
    'v_dodgers_portfolio_signals',
    'v_dodgers_portfolio_universe',
    'v_dodgers_rate_eligible_player_analysis',
    'v_dodgers_rate_eligible_summary',
    'v_dodgers_signing_cohort',
    'v_dodgers_signing_leaderboard',
    'v_dodgers_signing_period_research_queue',
    'v_dodgers_signing_population_coverage',
    'v_dodgers_signing_year_summary',
    'v_dodgers_trade_package_conversion',
    'v_dodgers_trainer_network',
    'v_dodgers_universe_summary',
    'v_league_org_benchmark',
    'v_league_period_org_summary',
    'v_league_signing_benchmark',
    'v_market_research_summary',
    'v_pathway_research_summary',
    'v_player_bio',
    'v_player_development_milestones',
    'v_player_development_progression',
    'v_player_development_stints',
    'v_player_directory',
    'v_player_dossier',
    'v_player_filter_options',
    'v_player_identity_scope',
    'v_player_signing_profile',
    'v_player_sources',
    'v_player_timeline',
    'v_player_trainers',
    'v_player_transactions',
    'v_player_war',
    'v_research_tasks',
    'v_signing_ages',
    'v_signing_asset_outcomes',
    'v_signing_data_coverage',
    'v_signing_efficiency',
    'v_signing_filter_options',
    'v_signing_population_coverage',
    'v_signing_population_memberships',
    'v_signing_records'
  ];
  missing text;
  not_invoker text;
  unreviewed text;
begin
  select string_agg(v, ', ' order by v) into missing
  from unnest(inventory) v
  where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = v and c.relkind = 'v');
  if missing is not null then
    raise exception '025: reviewed views missing or not views: %', missing;
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into not_invoker
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v' and c.relname = any (inventory)
    and not coalesce(array_to_string(c.reloptions, ',') ~ 'security_invoker=(true|on)', false);
  if not_invoker is not null then
    raise exception '025: reviewed views are not security_invoker: %', not_invoker;
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into unreviewed
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v' and not (c.relname = any (inventory));
  if unreviewed is not null then
    raise exception '025: public views not in the reviewed inventory: %', unreviewed;
  end if;
end $$;

-- ===========================================================================
-- 2. HARDENING: read-only analytical views get SELECT only
-- ===========================================================================

do $$
declare
  v text;
begin
  foreach v in array array[
    'v_class_research_coverage',
    'v_database_status',
    'v_dodgers_asset_conversion_brief',
    'v_dodgers_asset_realization',
    'v_dodgers_audit_pipeline_summary',
    'v_dodgers_class_analysis_eligibility',
    'v_dodgers_class_coverage',
    'v_dodgers_class_research_progress',
    'v_dodgers_class_source_reconciliation',
    'v_dodgers_competitive_asset_brief',
    'v_dodgers_competitive_asset_conversion',
    'v_dodgers_development_by_bonus_band',
    'v_dodgers_development_by_market',
    'v_dodgers_development_by_signing_class',
    'v_dodgers_development_coverage',
    'v_dodgers_development_date_coverage',
    'v_dodgers_development_research_queue',
    'v_dodgers_executive_case_studies',
    'v_dodgers_executive_dashboard_feed',
    'v_dodgers_executive_findings_v2',
    'v_dodgers_executive_kpis',
    'v_dodgers_executive_kpis_v2',
    'v_dodgers_historical_signings',
    'v_dodgers_known_mlb_outcomes',
    'v_dodgers_market_research_progress',
    'v_dodgers_market_summary',
    'v_dodgers_mature_asset_realization',
    'v_dodgers_mature_asset_summary',
    'v_dodgers_mature_bonus_tiers',
    'v_dodgers_mature_executive_findings',
    'v_dodgers_mature_outcome_queue',
    'v_dodgers_mature_player_analysis',
    'v_dodgers_mature_premium_comparison',
    'v_dodgers_mature_tracked_sample',
    'v_dodgers_mature_year_analysis',
    'v_dodgers_next_outcome_audits',
    'v_dodgers_opening_class_cohort_rates',
    'v_dodgers_outcome_audit_operations',
    'v_dodgers_outcome_audit_progress',
    'v_dodgers_outcome_audit_queue',
    'v_dodgers_outcome_by_signing_class',
    'v_dodgers_outcome_coverage',
    'v_dodgers_pathway_summary',
    'v_dodgers_player_development_summary',
    'v_dodgers_player_identity_coverage',
    'v_dodgers_player_identity_research_queue',
    'v_dodgers_portfolio_signals',
    'v_dodgers_portfolio_universe',
    'v_dodgers_rate_eligible_player_analysis',
    'v_dodgers_rate_eligible_summary',
    'v_dodgers_signing_cohort',
    'v_dodgers_signing_leaderboard',
    'v_dodgers_signing_period_research_queue',
    'v_dodgers_signing_population_coverage',
    'v_dodgers_signing_year_summary',
    'v_dodgers_trade_package_conversion',
    'v_dodgers_trainer_network',
    'v_dodgers_universe_summary',
    'v_league_org_benchmark',
    'v_league_period_org_summary',
    'v_league_signing_benchmark',
    'v_market_research_summary',
    'v_pathway_research_summary',
    'v_player_bio',
    'v_player_development_milestones',
    'v_player_development_progression',
    'v_player_development_stints',
    'v_player_directory',
    'v_player_dossier',
    'v_player_filter_options',
    'v_player_identity_scope',
    'v_player_signing_profile',
    'v_player_sources',
    'v_player_timeline',
    'v_player_trainers',
    'v_player_transactions',
    'v_player_war',
    'v_research_tasks',
    'v_signing_ages',
    'v_signing_asset_outcomes',
    'v_signing_data_coverage',
    'v_signing_efficiency',
    'v_signing_filter_options',
    'v_signing_population_coverage',
    'v_signing_population_memberships',
    'v_signing_records'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', v);
    execute format('grant select on public.%I to anon, authenticated', v);
  end loop;
end $$;

-- ===========================================================================
-- 3. POSTCONDITION: nothing in public grants the API roles more than SELECT
-- ===========================================================================
-- aclexplode reads the ACL itself, so privileges information_schema does not
-- report (MAINTAIN) are covered too.

do $$
declare
  bad text;
begin
  select string_agg(format('%s:%s:%s', c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type), ', ' order by 1) into bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
  left join pg_roles r on r.oid = a.grantee
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and (r.rolname in ('anon', 'authenticated') or a.grantee = 0)
    and a.privilege_type <> 'SELECT';
  if bad is not null then
    raise exception '025: API roles still hold privileges beyond SELECT: %', bad;
  end if;
end $$;

commit;
