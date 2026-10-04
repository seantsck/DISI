# Changelog

## v0.7
- Added 39 sourced positive MLB outcomes across historical and modern Dodgers international acquisitions.
- Added Brooklyn/Los Angeles Dodgers franchise identity.
- Added known-MLB-outcome portfolio view.
- Added class-level rate eligibility; incomplete historical sets can no longer become misleading hit-rate denominators.
- Homepage now surfaces top historical MLB outcomes instead of visually reading as a four-player site.
- Added canonical SQL layer `016_historical_positive_outcomes_and_rate_guardrail.sql`.


## v0.6
- Added first-class outcome-audit operations for the 181-player universe.
- Added transparent audit-priority, class-progress and market-progress views.
- Added `/research` page showing the 162-player outcome queue instead of hiding it.
- Players with missing outcomes remain explicitly unaudited; they are never classified as failures by default.
- Added canonical SQL layer `015_outcome_audit_operations.sql`.


## v0.5
- Homepage now leads with the full tracked Dodgers international acquisition universe.
- Four-player case studies moved into a secondary audited-outcomes section.
- Added class coverage visualization and audit queue counts.
- Added Andy Pages, Miguel Vargas, Jorbit Vivas, Eddys Leonard, Keibert Ruiz, full 2021 and 2023 announced classes, and large 2022/2024/2025 transaction-log backfills.
- Added public source registry and organization-period signing summaries.
- Added MLB-reported 2019-20 signing counts and pool usage for all 30 organizations.
- Added canonical SQL layer `014_portfolio_universe_and_source_pipeline.sql`.
- No mock/fallback baseball data.


## v0.4
- Removed all hard-coded fallback/sample baseball data from the application.
- Data failures now render an explicit unavailable state.
- Added League Benchmark navigation/page.
- Added `012_historical_census_framework.sql`.
- Extended the current verified Dodgers international-acquisition floor to 1951, including Sandy Amoros and Chico Fernandez, and added Roberto Clemente plus additional 1980s/1990s signings.
- Added explicit census coverage metadata to prevent tracked samples from being mislabeled as complete populations.
- Added `013_league_benchmark_seed.sql`.
- Seeded the first all-MLB benchmark set from MLB Pipeline's 2013 and 2014 Top 30 international signing trackers.
- Canonical SQL lineage now runs 001–013.

## v0.3
- Added Overview, Signings, Markets, Development, Asset Conversion, and Methodology routes.
