# DISI Database History

This folder preserves the SQL lineage behind the DISI research database.

## Folder structure

- `sql/` — canonical database build and analytics sequence (order recorded in `manifest.json`).
- `repairs/` — troubleshooting scripts used during the first Supabase build. These are preserved for provenance, but are **not** part of the clean build sequence.

## Canonical execution order

1. `001_disi_core_schema.sql` — core schema, enums, provenance, players, signings, outcomes, development, transactions.
2. `002_dodgers_seed_cohort.sql` — tracked Dodgers international signing cohort and signing-environment seed data.
3. `003_observed_outcomes_and_asset_value.sql` — observed MLB outcomes and first asset-value view.
4. `004_dodgers_analytics_views.sql` — Dodgers cohort, market, pathway, trainer, KPI, and leaderboard views.
5. `005_outcome_completeness_and_rosso.sql` — outcome-audit framework and Ramón Rosso completion.
6. `006_complete_mature_outcome_audit.sql` — completes the 17-player mature tracked cohort audit.
7. `007_mature_bonus_efficiency_analysis.sql` — bonus-tier and capital-efficiency analysis.
8. `008_mature_asset_realization.sql` — separates talent identification from direct Dodgers value realization.
9. `009_trade_package_asset_conversion.sql` — package-aware trade-return analysis.
10. `010_competitive_context_value.sql` — standings, need, urgency, acquisition horizon, and postseason context.
11. `011_executive_dashboard_layer.sql` — executive case studies, portfolio signals, findings, and dashboard feed.
12. `012_historical_census_framework.sql` — extends signing years backward, adds coverage metadata, and seeds verified Dodgers international acquisitions back to 1951.
13. `013_league_benchmark_seed.sql` — starts league-wide benchmarking with MLB Pipeline 2013/2014 Top 30 signing trackers.
14. `014_portfolio_universe_and_source_pipeline.sql` — expands the Dodgers signing universe, reconstructs modern classes, adds source provenance/coverage, and adds league organization-period signing volume and pool-spend data.
15. `015_outcome_audit_operations.sql` — converts the portfolio universe into a transparent outcome-research queue with class and market audit progress.
16. `016_historical_positive_outcomes_and_rate_guardrail.sql` — adds 39 verified MLB-reaching outcomes, franchise-aware debut classification, and class-level rate eligibility safeguards.
17. `017_research_database_layer.sql` — research-database layer for the web application (details below).

## 017 research-database layer

- **Player slugs.** `players.slug` (unique, not null, stable after assignment). A trigger assigns slugs to new players; collisions add the birth year, then `-2`, `-3`.
- **Source tiers.** `source_tiers` encodes the ingestion priority; `sources.source_tier` classifies every source (rule-based backfill via `disi_infer_source_tier`).
- **Official class-size sources.** The 2025 (29) and 2024 (19) Dodgers class releases and the 2022 MLB.com report (30) are registered and attached to the matching coverage declarations. The releases state class size but do not list every signee.
- **Metric-specific WAR.** `player_metric_observations` stores `CAREER_BWAR` (Baseball-Reference) and `CAREER_FWAR` (FanGraphs) separately, one row per observation date. A trigger rejects a bWAR row that does not cite Baseball-Reference and an fWAR row that does not cite FanGraphs. Legacy `outcomes.career_war` was backfilled to bWAR only where its source is a Baseball-Reference page (44 of 45 rows); the remaining value (MLB.com-cited) stays out and appears as a research task.
- **Backward compatibility.** `outcomes.career_war` is kept. `v_dodgers_portfolio_universe` and `v_dodgers_known_mlb_outcomes` keep every existing column and append `player_slug`, `career_bwar`, `bwar_observed_through_date`, `bwar_observed_through_season`; the universe now selects franchise `DODGERS` rather than abbreviation `LAD`.
- **Research views** (all `security_invoker`, select-only for `anon`/`authenticated`): `v_player_war`, `v_signing_records`, `v_player_directory`, `v_player_dossier`, `v_player_trainers`, `v_player_transactions`, `v_player_timeline`, `v_player_sources`, `v_class_research_coverage`, `v_research_tasks`, `v_database_status`, `v_market_research_summary`, `v_pathway_research_summary`, `v_signing_filter_options`, `v_player_filter_options`.
- **Rerunnable.** Every statement is idempotent; `npm run test:db` runs 017 twice and checks that nothing changes.

## Repair history

- `004a_diagnose_zero_cohort.sql`
- `004b_repair_dodgers_signings.sql`
- `004c_repair_observed_outcomes.sql`

The repair files document issues encountered during the first manual Supabase build and are intentionally kept out of the canonical build sequence.

## Methodology notes

DISI preserves provenance and uncertainty, leaves missing values as `NULL`, separates acquisition pathways and historical signing regimes, and distinguishes talent identification from organizational value realization. Historical verified sets and prospect trackers are samples, not censuses. Multi-player trade returns use shared attribution rather than crediting the full incoming return to one prospect.

## Supabase CLI note

These SQL files were originally applied manually in Supabase SQL Editor. Do not move them directly into `supabase/migrations/` and assume Supabase CLI migration history will match. If the project later moves to CLI-managed migrations, create a clean baseline migration and keep this folder as historical source material.
