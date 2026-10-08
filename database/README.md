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
20. `020_player_identity_and_biography_enrichment.sql` — external identifiers, biography with field-level provenance, position at signing, derived ages and identity research views (details below; research in `database/research/020/`).
21. `021_player_development_history.sql` — development-history dataset: stints, extended milestones, derived metrics, development status and research views (details below; research in `database/research/021/`).
22. `022_player_development_exact_dates.sql` — exact game-log dates for development milestones and stints (research in `database/research/022/`).
23. `023_development_stint_integrity.sql` — season-total stints classified and excluded from additive analytics, team-stint-only status and research queue, two affiliation corrections (details below; research in `database/research/023/`).

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

## 020 player identity and biography

- **Columns.** `players.birth_state_province`, `players.current_position` (MLB record, as of retrieval), `players.mlb_debut_date` (MLB person record; the audited value stays in `outcomes`), `signings.position_at_signing` + `position_at_signing_source_id` (from the signing transaction).
- **Resolution log.** `player_identity_resolutions`: one row per player per id system (`MLB`, `BASEBALL_REFERENCE`, `FANGRAPHS`) with status, method, confidence, signals, candidates and query. Check constraints: `RESOLVED` needs an id; `AMBIGUOUS` / `NEEDS_REVIEW` / `NOT_FOUND` cannot carry one.
- **Conflict types** gain `BIRTH_DATE` and `HANDEDNESS`.
- **Functions.** `disi_age_years`, `disi_age_decimal`, `disi_signing_age_band` (NULL in, NULL out).
- **Views.** `v_signing_ages`, `v_player_bio`, `v_player_identity_scope`, `v_dodgers_player_identity_coverage`, `v_dodgers_player_identity_research_queue`. `v_player_directory`, `v_player_filter_options` and `v_player_dossier` keep their columns and append identity fields; the directory's legacy `countries` array is unchanged, and new `birth_country` / `signing_market` facets keep the two apart.
- **Corrections.** Five legacy birth countries that were really signing countries are corrected from the MLB person record (legacy value kept on the resolved conflict); signing markets never change.
- **Scope.** `v_database_status` adds `dodgers_players` / `league_benchmark_players`; `v_player_filter_options` adds `has_dodgers_signing` so Dodgers pages count Dodgers signees only.
- **Coverage semantics.** `v_dodgers_player_identity_coverage` reports each identity field as present, resolved (evidence-backed, no open conflict), conflicted or unsourced; `v_player_bio` exposes `open_conflict_fields` and `sourced_fields`.
- **Rerunnable**, fills NULLs only, never takes an id another player holds. See `database/research/020/README.md` for the rules, results and manual decisions.

## 021 player development history

- **Stints, not one row per season.** `player_season_stints` holds one row per player / team / league / level / season. A season with several affiliates, levels or organizations is several rows; it is never collapsed. Batting fields are only filled from hitting data and pitching fields only from pitching data; `ip` is decimal thirds (37.2 → 37.6667).
- **Canonical levels.** `development_levels` + `development_level_era_map` classify every era separately, and the source label is preserved beside the classification (`source_level`, `level_classification`). The 019 correction holds: the Mexican League, NPB, KBO and Cuban professional are `FOREIGN_PRO` at every point in history, never affiliated AAA, whatever the MLB Stats API sport id said. Rookie leagues the source names only vaguely stay `OTHER` / `UNKNOWN_ROOKIE_LEAGUE` — unresolved, not invented.
- **Milestones extended in place.** `development_milestones` gains `event_code` (vocabulary in `development_event_codes`), `date_precision` (`DAY` / `SEASON`), `season_year`, `evidence_basis`. A `SEASON` milestone never carries a date — no fabricated January 1 — and a `DAY` milestone always carries one. The legacy 003 MLB debut rows are tagged `LEGACY_OUTCOME_AUDIT`, not duplicated.
- **Exact vs approximate.** `disi_development_days` / `disi_development_years` return NULL unless both endpoint dates exist. Season-based approximations are separate, clearly labelled columns and never blend with the exact ones.
- **Status, not a grade.** `player_development_status` is a research classification (`ROOKIE_LEVEL` … `MLB`, `FOREIGN_PRO`, `OUT_OF_AFFILIATED_BASEBALL`, `UNKNOWN`). Unknown is never "not reached", lower levels are never a failure verdict, and `NOT_YET_DEBUTED` requires an unresolved identity.
- **Organization per stint.** Ownership is resolved per season from a reviewed affiliation table, so post-trade development stays attributable: same-season two-org spells keep both stints and are queued for review, not asserted as a trade date.
- **Views** (all security_invoker): `v_dodgers_player_development_summary`, `v_player_development_stints`, `v_player_development_milestones`, `v_dodgers_development_by_signing_class`, `v_dodgers_development_by_market`, `v_dodgers_development_by_bonus_band`, `v_dodgers_development_research_queue`, `v_dodgers_development_coverage`. Reach counts accept any evidence (exact date or labelled season); median elapsed times are exact-date only, with n columns saying how many.
- **Sources.** Every stint row cites the endpoints it was built from (`source_urls`, `source_id`, `retrieved_at`, `as_of_date`); sources are registered with `disi_infer_source_tier`, and rows already registered by 019/020 keep their metadata.
- **Rerunnable**: inserts are on-conflict, conflicts are detected inside the reviewed artifact only, and a rerun changes nothing. See `database/research/021/README.md` for the pipeline, results and limitations.

## 023 development stint integrity

- **Raw rows vs team stints.** The MLB Stats API emits a team-less *season-total* split when a player appears for several teams in one sport season. 021 stored 56 of them (no affiliate, no team id) beside the team stints they sum, so summing `player_season_stints` double-counted 1,786 games. 023 adds `stint_kind` (`TEAM_STINT`, `SEASON_TOTAL`, `UNRESOLVED`) and `season_total_basis` (`SAME_LEVEL`, `CROSS_LEVEL`, `SUB_SEASON`) with CHECK constraints tying them together. No row is deleted: all 828 raw rows stay (772 `TEAM_STINT`, 56 `SEASON_TOTAL`, 0 `UNRESOLVED`), and a season total remains source evidence on the player page.
- **Additive rule.** Sum or count stints **only** `WHERE stint_kind = 'TEAM_STINT'`. A `SEASON_TOTAL` may stand in only where no component team stints exist (none today). Non-additive facts (rates, age, league) are not changed by the classification.
- **Proof, not assumption.** A team-less row is a season total only when its additive stats equal the sum of the player's same-season team stints at its source level (all of them, or an exact subset for a split-season label such as Lenix Osuna's 2018.1 Mexican League total). The migration re-proves this arithmetic and raises (rolling back) if any tagged total disagrees; `season_total_sum_mismatch` keeps checking it on a live database. A future team-less row that is not proven stays `UNRESOLVED`.
- **Coverage and queue.** `undated_log_era_stints` now counts team stints only (60 → 4; the four are 2018 Mexican League source gaps, still undated). The research queue, coverage view, summary view and development status read team stints only. The inherited 021 `SEASON_GAP` check bound a bare `player_id` to the inner table and measured the whole table's season span (flagging 144 players); it is now scoped per player over distinct team-stint seasons (15 genuine gaps). `FOREIGN_PRO` clubs are organization-unmapped by design and no longer raise `UNRESOLVED_ORGANIZATION`.
- **Status is still appearance-based.** Edgar León's cross-level 2026 rookie total no longer reads as unaffiliated play (`OUT_OF_AFFILIATED_BASEBALL` → `A_BALL`). Developmental-arrival semantics (cameos, post-establishment appearances) are a separate, later migration.
- **Organization corrections.** Augusta GreenJackets 2021+ → Atlanta Braves and Vancouver Canadians 2011+ → Toronto Blue Jays (Elio Campos 2025, Ronny Brito 2019 changed); raw affiliate names are preserved and the legitimate `ORGANIZATION_CHANGE` milestones are untouched.
- **Rerunnable**; research and reproduction steps in `database/research/023/README.md`.

## Player identity (020)

- **Identifier roles.** `players.mlb_id` is the MLB Stats API person id and the anchor of every identity: biography and the other ids are applied only to a player whose MLB id is resolved. `bref_id` is the Baseball-Reference page id, recorded only for players with an MLB debut. `fangraphs_id` comes from MLB's cross-reference and is only an identifier; it never implies fWAR.
- **Resolution.** Several signals, never a name alone (club transaction name + club + year; a B-Ref page DISI already cites; name + debut year + debut franchise). Ambiguous or name-only matches are never selected. Every attempt is in `player_identity_resolutions` (query, candidates, signals, status, confidence) and anything unresolved is in `v_dodgers_player_identity_research_queue`.
- **Canonical name vs alias.** `full_name` / `canonical_name` is one spelling; every other spelling is a `player_aliases` row (`PREVIOUS_DISI_SPELLING`, `MLB_RECORD_NAME`, `PUBLISHED_SPELLING`, `SOURCE_VARIANT`). Names change only for accent-only differences. Slugs never change, and players are never merged because their names match.
- **Birth country vs signing market vs nationality.** `players.birth_country` is where the player was born (the literal value of a birth / player record: Joseph Deng Thon, born in Juba before 2011, is Sudan); `signings.country_market` is where he was signed; `players.nationality` is stated only where a source states it. None is derived from another, and a class list or signing announcement is evidence for the signing market only, never for birth country.
- **Fill NULLs only; record disagreements.** A source value that contradicts a stored value becomes a `research_source_conflicts` row; the stored value stays.
- **Field-level provenance.** Every identity field has its own `evidence` row (`field_name`) naming the source and its retrieval time (`sources.accessed_at`). Coverage counts a value as *resolved* only when such a row exists and no conflict is open; a non-null value without one is *unsourced* and queued.
- **Dates and ages.** `signing_date` (recorded signing / agreement date), `announced_date` (class announcement) and `formal_transaction_date` (MLB transaction) are different facts. `v_signing_ages` computes an age from each separately and `signing_date_basis` says whether the signing date matches the transaction. `age_at_signing` uses `signing_date` only; when it is missing the age is NULL, never borrowed from another date. Ages are completed years (`disi_age_years`) and decimal years truncated to one place (`disi_age_decimal`); the signing-age band uses completed years. `age_at_mlb_debut` uses the audited outcome debut date, then the progress record, then the MLB person record (`mlb_debut_date_basis`).

## Repair history

- `004a_diagnose_zero_cohort.sql`
- `004b_repair_dodgers_signings.sql`
- `004c_repair_observed_outcomes.sql`
- `repairs/README.md` — provenance for the 2026-10-06 one-time live drift repair (the five 003-era legacy MLB_DEBUT milestones were missing on the production database and were backfilled; 021 then tagged them).

The repair files document issues encountered during the first manual Supabase build and are intentionally kept out of the canonical build sequence.

## Methodology notes

DISI preserves provenance and uncertainty, leaves missing values as `NULL`, separates acquisition pathways and historical signing regimes, and distinguishes talent identification from organizational value realization. Historical verified sets and prospect trackers are samples, not censuses. Multi-player trade returns use shared attribution rather than crediting the full incoming return to one prospect.

## Supabase CLI note

These SQL files were originally applied manually in Supabase SQL Editor. Do not move them directly into `supabase/migrations/` and assume Supabase CLI migration history will match. If the project later moves to CLI-managed migrations, create a clean baseline migration and keep this folder as historical source material.
