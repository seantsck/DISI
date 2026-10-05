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
18. `018_signing_class_coverage_and_backfill.sql` — signing populations, class-membership provenance and the 2022 / 2024 / 2025 backfill (details below).
19. `019_mature_outcome_audit_expansion.sql` — evidence-based outcome audits, professional progress and outcome research views (details below; research in `database/research/019/`).

## 017 research-database layer

- **Player slugs.** `players.slug` (unique, not null, stable after assignment). A trigger assigns slugs to new players; collisions add the birth year, then `-2`, `-3`.
- **Source tiers.** `source_tiers` encodes the ingestion priority; `sources.source_tier` classifies every source (rule-based backfill via `disi_infer_source_tier`).
- **Official class-size sources.** The 2025 (29) and 2024 (19) Dodgers class releases and the 2022 MLB.com report (30) are registered and attached to the matching coverage declarations. The releases state class size but do not list every signee.
- **Metric-specific WAR.** `player_metric_observations` stores `CAREER_BWAR` (Baseball-Reference) and `CAREER_FWAR` (FanGraphs) separately, one row per observation date. A trigger rejects a bWAR row that does not cite Baseball-Reference and an fWAR row that does not cite FanGraphs. Legacy `outcomes.career_war` was backfilled to bWAR only where its source is a Baseball-Reference page (44 of 45 rows); the remaining value (MLB.com-cited) stays out and appears as a research task.
- **Backward compatibility.** `outcomes.career_war` is kept. `v_dodgers_portfolio_universe` and `v_dodgers_known_mlb_outcomes` keep every existing column and append `player_slug`, `career_bwar`, `bwar_observed_through_date`, `bwar_observed_through_season`; the universe now selects franchise `DODGERS` rather than abbreviation `LAD`.
- **Research views** (all `security_invoker`, select-only for `anon`/`authenticated`): `v_player_war`, `v_signing_records`, `v_player_directory`, `v_player_dossier`, `v_player_trainers`, `v_player_transactions`, `v_player_timeline`, `v_player_sources`, `v_class_research_coverage`, `v_research_tasks`, `v_database_status`, `v_market_research_summary`, `v_pathway_research_summary`, `v_signing_filter_options`, `v_player_filter_options`.
- **Rerunnable.** Every statement is idempotent; `npm run test:db` runs 017 twice and checks that nothing changes.

## 018 signing populations and class backfill

- **Population scope.** `signing_populations` defines each counted population (`OPENING_CLASS`, `FULL_SIGNING_PERIOD`, `HISTORICAL_VERIFIED_SET`, `TOP_PROSPECT_SAMPLE`, `OTHER_DEFINED_POPULATION`) with its stated size, size source and stated composition. Only `FULL_SIGNING_PERIOD` rows may set `rate_analysis_suitable` (check constraint). Legacy `signing_census_coverage` rows carry an explicit `population_scope` and `population_note`.
- **Announcement ≠ full period.** A complete opening class (2021, 2023, 2024, 2025) is not a complete signing period. No full-period population is complete today, so no class is rate-eligible.
- **Membership provenance.** `signing_population_members` + `signing_population_member_sources` record why a signing belongs to a population (`membership_basis`) and which facts the source supports (`supports_fields`); a class-list source never verifies a bonus or a transaction date.
- **Dates.** `signings.announced_date`, `signings.formal_transaction_date` and `signings.transaction_source_id` are new; `signing_date` is preserved and only filled where NULL.
- **Conflicts and candidates.** `research_source_conflicts` holds explicit disagreements between sources; `signing_period_candidates` holds MLB transaction signees not yet classified as DISI signings.
- **Rate views.** `v_dodgers_class_analysis_eligibility`, `v_dodgers_rate_eligible_player_analysis` (and so `v_dodgers_rate_eligible_summary`) only count members of complete, audited, mature full-period populations. `v_dodgers_opening_class_cohort_rates` labels opening-class statistics. Legacy tracked-sample rate views (004, 006) carry comments saying they are not organization rates.
- **Rerunnable.** `npm run test:db` reruns the latest migration and checks nothing changes. Because 018 widens views created in 017, re-running 017 after 018 is not supported.

## 019 outcome audits

- **Outcome state.** `outcome_audits.outcome_state` says what an audit concluded: `REACHED_MLB`, `NO_MLB_CAREER_ENDED`, `NO_MLB_ACTIVE_IN_MINORS` or `NO_MLB_STATUS_UNKNOWN`. A check constraint keeps it consistent with `reached_mlb_verified`.
- **Evidence required.** `outcome_evidence` records which facts each source supports. A deferred constraint trigger rejects any audit with `reached_mlb_verified = false` unless MLB-reach evidence exists for the player.
- **Progress, not outcome.** `player_professional_progress` stores highest level, last affiliated season and team, final transaction and disposition, for audited *and* developing players. A progress row never implies an outcome.
- **Policy.** New "no MLB" audits only for classes through 2021 (and "still active" only through 2020); recent classes get progress only. Existing audits were never overwritten.
- **Rates.** Unchanged from 018: fully audited historical or tracked classes are reported as tracked-cohort outcomes (`v_dodgers_outcome_by_signing_class`) and never become organization rates.
- **Reproducibility.** `database/research/019/` holds the artifacts, decisions, template and `build.mjs`; see its README.

## Repair history

- `004a_diagnose_zero_cohort.sql`
- `004b_repair_dodgers_signings.sql`
- `004c_repair_observed_outcomes.sql`

The repair files document issues encountered during the first manual Supabase build and are intentionally kept out of the canonical build sequence.

## Methodology notes

DISI preserves provenance and uncertainty, leaves missing values as `NULL`, separates acquisition pathways and historical signing regimes, and distinguishes talent identification from organizational value realization. Historical verified sets and prospect trackers are samples, not censuses. Multi-player trade returns use shared attribution rather than crediting the full incoming return to one prospect.

## Supabase CLI note

These SQL files were originally applied manually in Supabase SQL Editor. Do not move them directly into `supabase/migrations/` and assume Supabase CLI migration history will match. If the project later moves to CLI-managed migrations, create a clean baseline migration and keep this folder as historical source material.
