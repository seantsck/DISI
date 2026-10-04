# Changelog

## v0.8
Product renamed to **DISI — Dodgers International Signings Research Database**, rebuilt as a research database rather than a case-study landing page.

Application
- `/signings` is now a server-side sortable, filterable, paginated research table. Every column header sorts with datatype-aware ordering (Postgres types; NULLs always last; enum codes sorted alphabetically). Search covers names and aliases, accent-insensitive. Filters: year / range, market (incl. unknown), position, pathway, audit status, MLB reached (yes / no / unknown), direct Dodgers-franchise debut, record scope, class coverage, organization scope. All state is in the URL. Rows link to player pages.
- New `/players` directory (A–Z browsing; country, position, first-signing era, MLB reached, Dodgers-franchise debut, audit status) and `/players/[slug]` dossiers: biography, acquisition costs by component, prospect rank, MLB outcome, bWAR with through-season and observation history, chronological timeline, trainer relationships, package-aware transactions with competitive context, and every source with tier, publication and access dates.
- Global player search in the header (`/api/player-search`).
- Homepage redesigned: plain description, database-status figures, recent signing records, section index; historical MLB outcomes moved to a secondary findings list. Removed the marketing headline. No MLB rate is shown unless classes pass the rate-eligibility rules.
- `/research` rebuilt as Research & Data Coverage: per-year expected vs. tracked class size, the source behind each expected size, known-bonus / audit / bWAR counts, class status, a typed research queue and the source-priority table.
- Markets, Development, Asset Conversion and League pages read the new bWAR-aware views and link every player name.
- “WAR” replaced by “bWAR” wherever the value is Baseball-Reference WAR, with a methodology note on player pages.
- Data-backed pages render per request so they never serve a build-time snapshot.

Database — `017_research_database_layer.sql`
- Canonical unique `players.slug` with collision handling and a trigger for new players.
- `source_tiers` and `sources.source_tier`, encoding the ingestion source priority.
- Official 2025 (29) and 2024 (19) Dodgers class releases and the 2022 MLB.com report (30) registered as the sources for those expected class sizes.
- `player_metric_observations` for metric-specific provenance (`CAREER_BWAR`, `CAREER_FWAR`) with a trigger that rejects mismatched providers; `v_player_war` exposes `career_bwar`, `bwar_source_id`, `bwar_observed_through_date`, `career_fwar`, `fwar_source_id`, `fwar_observed_through_date`. 44 Baseball-Reference-cited legacy values backfilled; one MLB.com-cited value held back.
- `outcomes.career_war` kept for compatibility; existing universe / known-outcome views gain appended bWAR and slug columns and now select by franchise key.
- New security-invoker research views for signing records, player directory, dossier, timeline, transactions, sources, class coverage, research tasks, database status, market / pathway summaries and filter facets.

Engineering
- Version bumped from the stale 0.4.0 to 0.8.0.
- Added ESLint (flat config), `checkJs` typechecking, unit tests and a PGlite database test that runs the full migration chain, reruns 017 and checks data rules and RLS.
- Added `docs/INGESTION.md`.

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
