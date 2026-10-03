# DISI Database History

This folder preserves the SQL lineage behind the DISI dashboard.

## Folder structure

- `sql/` — canonical database build and analytics sequence.
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

## Repair history

- `004a_diagnose_zero_cohort.sql`
- `004b_repair_dodgers_signings.sql`
- `004c_repair_observed_outcomes.sql`

The repair files document issues encountered during the first manual Supabase build and are intentionally kept out of the canonical build sequence.

## Methodology notes

DISI preserves provenance and uncertainty, leaves missing values as `NULL`, separates acquisition pathways and historical signing regimes, and distinguishes talent identification from organizational value realization. The mature results are explicitly a **tracked sample**, not a complete census. Multi-player trade returns use shared attribution rather than crediting the full incoming return to one prospect.

## Supabase CLI note

These SQL files were originally applied manually in Supabase SQL Editor. Do not move them directly into `supabase/migrations/` and assume Supabase CLI migration history will match. If the project later moves to CLI-managed migrations, create a clean baseline migration and keep this folder as historical source material.
