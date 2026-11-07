# DISI model-readiness audit (frozen 061 state)

Read-only audit of the canonical post-061 replay (analysis as of 2026-10-05, last complete MLB season 2026). Export SHA-256 `1ff4da597b3e959c3a88fa771bc193809355f5925b0254f1d90d3f76e46ccdaa`.
No migration, database write, model fit or evaluation re-run was made. Numbers are exact counts from the export; the only estimate is marked as one.

**Verdict: NEEDS_MULTIPLE** (NEEDS_CENSUS_EXPANSION + NEEDS_MORE_LABELS + NEEDS_DATA). Supported fitted models 0; Dodgers supported targets 0; probabilities, expected values and recommendations 0.

## 1. Population (Dodgers and benchmark are never pooled for support)

| | Dodgers | Benchmark |
|---|---:|---:|
| Signings | 220 | 178 |
| Signing years | 1951-2026 | 2013-2019 |
| Population classes | OPENING_CLASS_CENSUS 35, OUTCOME_SELECTED_SAMPLE 49, TRACKED_SAMPLE 136 | TOP_PROSPECT_SAMPLE 178 |
| Model scope (reference population, amateur route) | 168 | 169 |
| Outcome-mature (5-year rule), all | 98 | 178 |
| Outcome-mature, model scope | 47 | 169 |
| 7-season horizon elapsed (exposure complete) | 76 | 178 |
| 10-season horizon elapsed | 58 | 101 |
| Reached MLB true / false / unaudited | 47 / 46 / 127 | 50 / 125 / 3 |
| Unaudited outcomes | 127 | 3 |
| Mature without a final outcome | 12 | 128 |
| Positive / non-positive bWAR labels (in scope) | 1 / 10 | 15 / 71 |
| Positive-bWAR label missing past horizon | 0 | 7 |
| Signing-time features complete (age, position, market), model scope | 138 / 168 | 152 / 169 |

Dodgers model-scope rows by signing year: 2015: 11, 2018: 10, 2019: 4, 2021: 22, 2022: 56, 2023: 13, 2024: 19, 2025: 28, 2026: 5. The 49 outcome-selected historical signings (1951-2017) carry labels but are excluded by design (selected because they reached MLB); the 3 professional-route signings are excluded.

**Usable N** (labelled, in scope): Dodgers 25 for REACH_MLB_WITHIN_7_SEASONS (21 with complete features), 11 for each 10-season target. Benchmark 166 for reach (152 complete), 86 for each bWAR target (77 complete).

## 2. Targets

| Target | Population | Labelled N | Features complete | Positives | Negatives | Censored | Missing past horizon | Positive rate | Support | Needs labels / positives |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| REACH_MLB_WITHIN_7_SEASONS | DODGERS | 25 | 21 | 2 | 23 | 143 | 0 | 0.0800 | BASELINE_NOT_SUPPORTED | 25 / 8 |
| REACH_MLB_WITHIN_7_SEASONS | BENCHMARK | 166 | 152 | 34 | 132 | 0 | 3 | 0.2048 | BASELINE_SUPPORTED | 0 / 0 |
| POSITIVE_BWAR_WITHIN_10_SEASONS | DODGERS | 11 | 11 | 1 | 10 | 157 | 0 | 0.0909 | BASELINE_NOT_SUPPORTED | 39 / 9 |
| POSITIVE_BWAR_WITHIN_10_SEASONS | BENCHMARK | 86 | 77 | 15 | 71 | 76 | 7 | 0.1744 | BASELINE_SUPPORTED | 0 / 0 |
| BWAR_2_WITHIN_10_SEASONS | DODGERS | 11 | 11 | 1 | 10 | 157 | 0 | 0.0909 | BASELINE_NOT_SUPPORTED | 39 / 9 |
| BWAR_2_WITHIN_10_SEASONS | BENCHMARK | 86 | 77 | 9 | 77 | 76 | 7 | 0.1047 | BASELINE_NOT_SUPPORTED | 0 / 1 |
| DODGERS_MLB_VALUE_WITHIN_10_SEASONS | DODGERS | 11 | 11 | 0 | 11 | 157 | 0 | 0.0000 | BASELINE_NOT_SUPPORTED | 39 / 10 |

Thresholds (every target): 50 labelled, 10 positives, 10 negatives; 10 events per model feature.

Limiting target: **REACH_MLB_WITHIN_7_SEASONS** (25 more labels, 8 more positives). No Dodgers target is supported. The limiting target is REACH_MLB_WITHIN_7_SEASONS: it is the nearest to support and every other Dodgers target needs strictly more labels and positives. The 10-season targets (positive bWAR, 2+ bWAR, Dodgers MLB value) can only label 2016-and-earlier signings, of which the tracked Dodgers population holds 11 amateur rows; DODGERS_MLB_VALUE_WITHIN_10_SEASONS has 0 positives and gates the only expected-value model.

Benchmark reach and positive-bWAR baselines are BASELINE_SUPPORTED for the benchmark population only (never shown for a Dodgers player); BWAR_2 is one positive short. BASELINE SUPPORTED is not MODEL SUPPORTED.

062 effect: Not verified (062 is not applied to the audited state). Owner-observed career bWAR adds CAREER_BWAR metric observations; the bWAR labels read team-season WAR rows (player_mlb_team_season_war) inside the horizon window, not CAREER_BWAR, so 062 as described changes BWAR_MISSING and the CAREER_BWAR count but no label, support count or evaluation fingerprint.

## 3. Feature completeness

The 041 model features are signing-time only: population class, age in signing year, position family at signing, market group, and the earliest expectation band dated on or before the signing cutoff. Bonus / cost is shown but excluded by design. Development, later evaluations, bWAR and transactions are post-signing facts and are never features for these targets (the feature matrix is tested to be invariant to them). "STRUCTURAL" means the missing rate differs by at least 40 points between signing years with 5 or more rows; details per row are in `feature-coverage.csv`.

Dodgers model scope (168 rows):

| Feature | Timing | Role | Eligible | Known | Missing | % | Missingness |
|---|---|---|---:|---:|---:|---:|---|
| age_in_signing_year | SIGNING_TIME | USED_BY_041_LOGISTIC | 168 | 168 | 0 | 100.0 | NO_MISSING |
| position_at_signing | SIGNING_TIME | USED_BY_041_LOGISTIC (is_pitcher) | 168 | 167 | 1 | 99.4 | NOT_STRUCTURAL |
| country_market | SIGNING_TIME | USED_BY_041_LOGISTIC (is_dominican_republic, is_venezuela) | 168 | 139 | 29 | 82.7 | STRUCTURAL |
| market_group_mapped | SIGNING_TIME | USED_BY_041_LOGISTIC | 168 | 139 | 29 | 82.7 | STRUCTURAL |
| pathway_classified | SIGNING_TIME | SCOPE_RULE (professional route excluded) | 168 | 124 | 44 | 73.8 | STRUCTURAL |
| era_key | SIGNING_TIME | AVAILABLE_NOT_USED | 168 | 168 | 0 | 100.0 | NO_MISSING |
| exact_signing_date | SIGNING_TIME | CUTOFF_ONLY | 168 | 152 | 16 | 90.5 | STRUCTURAL |
| signing_bonus_usd | SIGNING_TIME | EXCLUDED_BY_041_DESIGN | 168 | 50 | 118 | 29.8 | STRUCTURAL |
| total_known_acquisition_cost_usd | SIGNING_TIME | EXCLUDED_BY_041_DESIGN | 168 | 50 | 118 | 29.8 | STRUCTURAL |
| acquisition_cost_complete | SIGNING_TIME | EXCLUDED_BY_041_DESIGN | 168 | 49 | 119 | 29.2 | STRUCTURAL |
| expectation_at_signing (scouting band) | SIGNING_TIME | USED_BY_041_LOGISTIC (is_top_expectation_band) | 168 | 0 | 168 | 0.0 | ALL_MISSING |
| international_rank (signing record) | SIGNING_TIME | AVAILABLE_NOT_USED | 168 | 9 | 159 | 5.4 | NOT_STRUCTURAL |
| any_ranking_observation | MIXED (often post-signing) | NOT_A_FEATURE_UNLESS_DATED_BEFORE_CUTOFF | 168 | 2 | 166 | 1.2 | NOT_STRUCTURAL |
| first_pro_game_exact | POST_SIGNING | NOT_A_FEATURE (leakage for signing-time targets) | 168 | 159 | 9 | 94.6 | NOT_STRUCTURAL |
| professional_debut_season | POST_SIGNING | NOT_A_FEATURE (leakage for signing-time targets) | 168 | 159 | 9 | 94.6 | NOT_STRUCTURAL |
| dsl_debut_exact (among DSL debuts) | POST_SIGNING | NOT_A_FEATURE | 155 | 155 | 0 | 100.0 | NO_MISSING |
| complex_debut_exact (among complex debuts) | POST_SIGNING | NOT_A_FEATURE | 91 | 91 | 0 | 100.0 | NO_MISSING |
| full_season_A_exact (among A arrivals) | POST_SIGNING | NOT_A_FEATURE | 67 | 67 | 0 | 100.0 | NO_MISSING |
| high_A_exact (among High-A arrivals) | POST_SIGNING | NOT_A_FEATURE | 35 | 35 | 0 | 100.0 | NO_MISSING |
| AA_exact (among AA arrivals) | POST_SIGNING | NOT_A_FEATURE | 24 | 24 | 0 | 100.0 | NO_MISSING |
| AAA_exact (among AAA arrivals) | POST_SIGNING | NOT_A_FEATURE | 14 | 14 | 0 | 100.0 | NO_MISSING |
| level_progression (observed affiliated seasons) | POST_SIGNING | NOT_A_FEATURE | 168 | 160 | 8 | 95.2 | NOT_STRUCTURAL |
| development_velocity (seasons to full-season) | POST_SIGNING | NOT_A_FEATURE | 68 | 68 | 0 | 100.0 | NO_MISSING |
| mlb_debut_date (among MLB reachers) | LABEL_INPUT | LABEL (REACH uses the debut season) | 3 | 3 | 0 | 100.0 | NO_MISSING |
| days_signing_to_mlb_exact (among reachers) | POST_SIGNING | NOT_A_FEATURE | 3 | 3 | 0 | 100.0 | NO_MISSING |
| career_transaction_history | POST_SIGNING | NOT_A_FEATURE | 168 | 1 | 167 | 0.6 | NOT_STRUCTURAL |

Benchmark model scope (169 rows):

| Feature | Timing | Role | Eligible | Known | Missing | % | Missingness |
|---|---|---|---:|---:|---:|---:|---|
| age_in_signing_year | SIGNING_TIME | USED_BY_041_LOGISTIC | 169 | 166 | 3 | 98.2 | NOT_STRUCTURAL |
| position_at_signing | SIGNING_TIME | USED_BY_041_LOGISTIC (is_pitcher) | 169 | 159 | 10 | 94.1 | NOT_STRUCTURAL |
| country_market | SIGNING_TIME | USED_BY_041_LOGISTIC (is_dominican_republic, is_venezuela) | 169 | 162 | 7 | 95.9 | NOT_STRUCTURAL |
| market_group_mapped | SIGNING_TIME | USED_BY_041_LOGISTIC | 169 | 162 | 7 | 95.9 | NOT_STRUCTURAL |
| pathway_classified | SIGNING_TIME | SCOPE_RULE (professional route excluded) | 169 | 161 | 8 | 95.3 | NOT_STRUCTURAL |
| era_key | SIGNING_TIME | AVAILABLE_NOT_USED | 169 | 169 | 0 | 100.0 | NO_MISSING |
| exact_signing_date | SIGNING_TIME | CUTOFF_ONLY | 169 | 121 | 48 | 71.6 | STRUCTURAL |
| signing_bonus_usd | SIGNING_TIME | EXCLUDED_BY_041_DESIGN | 169 | 47 | 122 | 27.8 | STRUCTURAL |
| total_known_acquisition_cost_usd | SIGNING_TIME | EXCLUDED_BY_041_DESIGN | 169 | 47 | 122 | 27.8 | STRUCTURAL |
| acquisition_cost_complete | SIGNING_TIME | EXCLUDED_BY_041_DESIGN | 169 | 46 | 123 | 27.2 | STRUCTURAL |
| expectation_at_signing (scouting band) | SIGNING_TIME | USED_BY_041_LOGISTIC (is_top_expectation_band) | 169 | 151 | 18 | 89.3 | STRUCTURAL |
| international_rank (signing record) | SIGNING_TIME | AVAILABLE_NOT_USED | 169 | 169 | 0 | 100.0 | NO_MISSING |
| any_ranking_observation | MIXED (often post-signing) | NOT_A_FEATURE_UNLESS_DATED_BEFORE_CUTOFF | 169 | 169 | 0 | 100.0 | NO_MISSING |
| first_pro_game_exact | POST_SIGNING | NOT_A_FEATURE (leakage for signing-time targets) | 169 | 0 | 169 | 0.0 | ALL_MISSING |
| professional_debut_season | POST_SIGNING | NOT_A_FEATURE (leakage for signing-time targets) | 169 | 0 | 169 | 0.0 | ALL_MISSING |
| dsl_debut_exact (among DSL debuts) | POST_SIGNING | NOT_A_FEATURE | 0 | 0 | 0 |  | NO_MISSING |
| complex_debut_exact (among complex debuts) | POST_SIGNING | NOT_A_FEATURE | 0 | 0 | 0 |  | NO_MISSING |
| full_season_A_exact (among A arrivals) | POST_SIGNING | NOT_A_FEATURE | 0 | 0 | 0 |  | NO_MISSING |
| high_A_exact (among High-A arrivals) | POST_SIGNING | NOT_A_FEATURE | 0 | 0 | 0 |  | NO_MISSING |
| AA_exact (among AA arrivals) | POST_SIGNING | NOT_A_FEATURE | 0 | 0 | 0 |  | NO_MISSING |
| AAA_exact (among AAA arrivals) | POST_SIGNING | NOT_A_FEATURE | 0 | 0 | 0 |  | NO_MISSING |
| level_progression (observed affiliated seasons) | POST_SIGNING | NOT_A_FEATURE | 169 | 0 | 169 | 0.0 | ALL_MISSING |
| development_velocity (seasons to full-season) | POST_SIGNING | NOT_A_FEATURE | 0 | 0 | 0 |  | NO_MISSING |
| mlb_debut_date (among MLB reachers) | LABEL_INPUT | LABEL (REACH uses the debut season) | 42 | 42 | 0 | 100.0 | NO_MISSING |
| days_signing_to_mlb_exact (among reachers) | POST_SIGNING | NOT_A_FEATURE | 42 | 0 | 42 | 0.0 | ALL_MISSING |
| career_transaction_history | POST_SIGNING | NOT_A_FEATURE | 169 | 0 | 169 | 0.0 | ALL_MISSING |

Top missing features that matter: (1) expectation at signing for Dodgers (0/168), a 041 logistic input; (2) acquisition cost (50/168 Dodgers in scope, 47/169 benchmark), excluded by design; (3) market for Dodgers (29 missing, 3 of them in labelled rows); (4) exact signing date (16 Dodgers in scope, 48 benchmark), cutoff precision only.

## 4. Unknown-cost policy (evaluated, not applied)

Proposal: `acquisition_cost_model_usd = COALESCE(total_known_acquisition_cost_usd, 0)`, `acquisition_cost_missing = (total_known_acquisition_cost_usd IS NULL)`, and `acquisition_cost_state` in KNOWN / PARTIAL / UNKNOWN / UNDISCLOSED / NO_COST_RULE (KNOWN = COMPLETE, PARTIAL = PARTIAL lower bound, UNKNOWN = no component known, NO_COST_RULE = NO_RULE pathway, UNDISCLOSED = 0 rows: the schema has no field that distinguishes "never disclosed" from "not yet found").

| Scope | Rows | KNOWN | PARTIAL | UNKNOWN | UNDISCLOSED | NO_COST_RULE | Rows with a cost value before -> after | Known $0 rows | Reach-labelled rows with cost known | Positives / negatives with cost known |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---|
| DODGERS_MODEL_SCOPE | 168 | 49 | 0 | 75 | 0 | 44 | 50 -> 168 | 0 | 19/25 | 2/2 / 17/23 |
| DODGERS_REACH_LABELLED | 25 | 19 | 0 | 3 | 0 | 3 | 19 -> 25 | 0 | 19/25 | 2/2 / 17/23 |
| BENCHMARK_MODEL_SCOPE | 169 | 46 | 0 | 115 | 0 | 8 | 47 -> 169 | 0 | 44/166 | 6/34 / 38/132 |
| BENCHMARK_REACH_LABELLED | 166 | 43 | 0 | 115 | 0 | 8 | 44 -> 166 | 0 | 44/166 | 6/34 / 38/132 |

Findings:
- **Usable N.** It raises the rows that carry a cost value (Dodgers model scope 50 -> 168). It adds no label. Labels are what limit every target, and cost is not a 041 feature, so the usable N of every target stays the same: Dodgers reach 25.
- **Ledger.** It corrupts nothing as long as it stays a model-side derived column, in an export or a view that is never written back. Dodgers known cost stays 81 / 139 and $127,632,237.33. It would corrupt the ledger if it were persisted into a cost column or into `total_known_acquisition_cost_usd`: the 0 would become indistinguishable from a known $0.00 (Pedro Astacio, outside model scope; 0 known-zero rows in Dodgers scope) and would understate a lower-bound spend.
- **Signal.** In the labelled Dodgers reach rows, cost is known for 2/2 positives and 17/23 negatives. Missingness tracks source coverage and signing class (`feature-coverage.csv` missingness_detail), so the indicator would learn coverage, not talent. PARTIAL values are lower bounds and must not be read as totals.
- **Verdict.** It is acceptable as a modelling convention: the indicator is mandatory, the state must be carried, nothing is written to the ledger, and it is used only in a model whose evaluation beats the base rate. It is not a readiness lever.

## 5. Mature outcome backlog (Dodgers, 5-year maturity, outcome not final)

12 signings. Immature players are skipped. `mature-outcome-gaps.csv` has the evidence each one is missing and a Google query ready to paste.

| Player | Signing | Mature since | Reach horizon end | Reach state | Outcome state | Highest level (season) |
|---|---|---|---|---|---|---|
| Alex De Jesus | 2018 | 2023-07-02 | 2025 | TRAINING_ELIGIBLE false | NO_MLB_STATUS_UNKNOWN | AA (2025) |
| Christian Suarez | 2018 | 2023-07-02 | 2025 | TRAINING_ELIGIBLE false | NO_MLB_ACTIVE_IN_MINORS | AA (2026) |
| Jerming Rosario | 2018 | 2023-07-02 | 2025 | TRAINING_ELIGIBLE false | NO_MLB_ACTIVE_IN_MINORS | AAA (2026) |
| Roque Gutierrez | 2019 | 2024 (year only) | 2026 | TRAINING_ELIGIBLE false | NO_MLB_ACTIVE_IN_MINORS | AA (2026) |
| Yeiner Fernandez | 2019 | 2024-07-02 | 2026 | TRAINING_ELIGIBLE false | NO_MLB_ACTIVE_IN_MINORS | AA (2026) |
| Christian Romero | 2021 | 2026-01-15 | 2028 | CENSORED | UNAUDITED | AAA (2026) |
| Dailoui Abad | 2021 | 2026-01-15 | 2028 | CENSORED | UNAUDITED | LOW_A (2026) |
| Isaac Barreto | 2021 | 2026-01-15 | 2028 | CENSORED | UNAUDITED | none |
| Jesus Galiz | 2021 | 2026-01-15 | 2028 | CENSORED | UNAUDITED | HIGH_A (2026) |
| Jorge Carpintero | 2021 | 2026-01-15 | 2028 | CENSORED | UNAUDITED | none |
| Kelvin Ramirez | 2021 | 2026-01-15 | 2028 | CENSORED | UNAUDITED | AA (2026) |
| Thayron Liranzo | 2021 | 2026-01-15 | 2028 | CENSORED | UNAUDITED | AA (2026) |

None of the 12 can add a label today:
- The five 2018-2019 signings already carry a FALSE reach label. Their horizon has elapsed, and reach is not affected by whether their careers are over.
- The seven 2021 opening-class signings are CENSORED until the 2028 season for every target.
- Closing the backlog makes the outcome records final. It does not move support.

## 6. Development-path coverage (Dodgers model scope; benchmark has no development rows)

| Field | Eligible | Known exact | % | Classification |
|---|---:|---:|---:|---|
| exact_signing_date | 168 | 152 | 90.5 | NICE_TO_HAVE |
| first_pro_game_exact | 168 | 159 | 94.6 | NICE_TO_HAVE |
| dsl_debut_exact (among DSL debuts) | 155 | 155 | 100.0 | NICE_TO_HAVE |
| complex_debut_exact (among complex debuts) | 91 | 91 | 100.0 | NICE_TO_HAVE |
| full_season_A_exact (among A arrivals) | 67 | 67 | 100.0 | NICE_TO_HAVE |
| high_A_exact (among High-A arrivals) | 35 | 35 | 100.0 | NICE_TO_HAVE |
| AA_exact (among AA arrivals) | 24 | 24 | 100.0 | NICE_TO_HAVE |
| AAA_exact (among AAA arrivals) | 14 | 14 | 100.0 | NICE_TO_HAVE |
| level_progression (observed affiliated seasons) | 168 | 160 | 95.2 | NICE_TO_HAVE |
| development_velocity (seasons to full-season) | 68 | 68 | 100.0 | NICE_TO_HAVE |
| mlb_debut_date (among MLB reachers) | 3 | 3 | 100.0 | MODEL_BLOCKING (label input) |
| days_signing_to_mlb_exact (among reachers) | 3 | 3 | 100.0 | NICE_TO_HAVE |

Only the MLB debut date of a reacher feeds a label. It is complete, so it is not blocking. Every other development field is post-signing, so it is NICE_TO_HAVE for the 041 signing-time targets. It would become MODEL_BLOCKING only for a conditional model that is evaluated at a later as-of date (for example, P(MLB | reached full-season by season 2)), and no such target exists in `outcome_targets`.

## 7. Model history

| Target | Rows / positives / folds | Base-rate Brier | Model | Brier | Skill vs base | AUC | Events need / have | Decision | Failure reason |
|---|---|---:|---|---:|---:|---:|---|---|---|
| REACH_MLB_WITHIN_7_SEASONS | 173 / 34 / 7 | 0.159675 | LOGISTIC_L2 | 0.156826 | 0.017844 | 0.593737 | 60 / 34 | MODEL_NOT_SUPPORTED | INSUFFICIENT_EVENTS |
| REACH_MLB_WITHIN_7_SEASONS | 173 / 34 / 7 | 0.159675 | POPULATION_STRATIFIED_RATE | 0.160719 | -0.006535 | 0.431549 | 10 / 34 | MODEL_NOT_SUPPORTED | NO_SKILL_OVER_BASELINE |
| POSITIVE_BWAR_WITHIN_10_SEASONS | 88 / 14 / 4 | 0.140938 | LOGISTIC_L2 | 0.153014 | -0.085678 | 0.319981 | 60 / 14 | MODEL_NOT_SUPPORTED | INSUFFICIENT_EVENTS |
| POSITIVE_BWAR_WITHIN_10_SEASONS | 88 / 14 / 4 | 0.140938 | POPULATION_STRATIFIED_RATE | 0.142906 | -0.013963 | 0.357143 | 10 / 14 | MODEL_NOT_SUPPORTED | NO_SKILL_OVER_BASELINE |
| BWAR_2_WITHIN_10_SEASONS | 88 / 9 / 4 | 0.099031 | LOGISTIC_L2 | 0.106562 | -0.076047 | 0.170183 | 60 / 9 | MODEL_NOT_SUPPORTED | INSUFFICIENT_EVENTS |
| BWAR_2_WITHIN_10_SEASONS | 88 / 9 / 4 | 0.099031 | POPULATION_STRATIFIED_RATE | 0.100137 | -0.011166 | 0.276371 | 10 / 9 | MODEL_NOT_SUPPORTED | INSUFFICIENT_EVENTS |

Validation for every row is leave-one-signing-year-out over the pooled Dodgers and benchmark labelled rows with complete features. That is out-of-time by construction. There is no separate later holdout. All stored evaluations are current: the live training fingerprint matches. The only positive skill is REACH LOGISTIC_L2 (+0.017844). It is rejected on events per feature (34 < 60). The research history (`model-history.json`) shows REACH moving through 59/8 (041), 101/19 (050), 148/30 (055) and 173/34 (056). Over those steps logistic skill went -0.123, -0.037, +0.035, +0.018. It is not monotone, and no fitted model was ever supported.

## 8. Research queues classified

Classes: ACTIONABLE, UNDISCLOSED, STRUCTURALLY_UNKNOWN, LOW_MATERIALITY, NOT_APPLICABLE, IDENTITY_BLOCKED. The goal is not to drive the queues to zero: most queue rows have no model impact.

| Queue | Item | Population | Count | Class | Model impact |
|---|---|---|---:|---|---|
| v_research_tasks | OUTCOME_AUDIT (not yet 5-year mature) | DODGERS | 120 | NOT_APPLICABLE | NONE |
| v_research_tasks | OUTCOME_AUDIT | BENCHMARK | 3 | IDENTITY_BLOCKED | MEDIUM |
| v_research_tasks | ACQUISITION_COST_UNKNOWN | DODGERS | 139 | LOW_MATERIALITY | LOW |
| v_research_tasks | ACQUISITION_COST_UNKNOWN | BENCHMARK | 131 | LOW_MATERIALITY | NONE |
| v_research_tasks | BWAR_MISSING | BENCHMARK | 39 | NOT_APPLICABLE | NONE |
| v_research_tasks | SIGNING_DATE_MISSING | ALL | 71 | ACTIONABLE | LOW |
| v_research_tasks | MARKET_MISSING | ALL | 36 | ACTIONABLE | MEDIUM |
| v_research_tasks | CLASS_MEMBERS_MISSING / CLASS_SIZE_SOURCE_NOT_OFFICIAL | DODGERS | 6 | ACTIONABLE | HIGH |
| v_outcome_probability_research_queue | LABEL_BLOCKED_BY_MISSING_AUDIT (4 deferred 2016 benchmark reachers) | BENCHMARK | 8 | ACTIONABLE | MEDIUM |
| v_outcome_probability_research_queue | LABEL_BLOCKED_BY_MISSING_AUDIT (3 identities) | BENCHMARK | 9 | IDENTITY_BLOCKED | LOW |
| v_dodgers_mature_outcome_queue | mature 2021 opening-class unaudited | DODGERS | 7 | ACTIONABLE | LOW |
| v_dodgers_development_research_queue | development dates / levels | DODGERS | 128 | LOW_MATERIALITY | NONE |
| v_transaction_research_queue | CASH_AMOUNT_UNKNOWN / POOL_SPACE_AMOUNT_UNKNOWN | DODGERS | 13 | UNDISCLOSED | NONE |
| v_transaction_research_queue | other transaction gaps | DODGERS | 38 | NOT_APPLICABLE | NONE |
| v_value_research_queue | value gaps | DODGERS | 79 | NOT_APPLICABLE | LOW |
| v_financial_research_queue | financial provenance | ALL | 280 | LOW_MATERIALITY | NONE |
| v_international_benchmark_research_queue | benchmark research | BENCHMARK | 184 | LOW_MATERIALITY | LOW |
| v_dodgers_player_identity_research_queue | identity attributes | ALL | 280 | LOW_MATERIALITY | NONE |

## 9. Verdict and blockers

**NEEDS_MULTIPLE**: NEEDS_CENSUS_EXPANSION, NEEDS_MORE_LABELS, NEEDS_DATA. Ranked by expected impact on reaching Dodgers support and a supported model:

1. **DODGERS_CENSUS_EXPANSION_MATURE_CLASSES** (NEEDS_CENSUS_EXPANSION; ACTIONABLE). Only 25 Dodgers amateur rows can carry a 7-season label (classes 2015, 2018, 2019; none for 2016-2017 or before 2015 outside the outcome-selected set). Support needs 25 more labels and 8 more positives; at the observed Dodgers rate (2/25) 10 positives imply roughly 125 labelled rows. DISI already registers the expected size of three mature classes with members missing (2013: 47 of 47 missing, 2016: 26 of 26 missing, 2019: 47 of 50 missing): up to 120 signees (fewer if some are professional-route), 120 of them past the 7-season horizon and 73 past the 10-season horizon. Loading and auditing them could by itself clear the 50-row minimum; whether it clears 10 positives depends on how many reached MLB. No CLASS_MEMBERS_MISSING task exists for any other mature class; this audit did not check whether those classes have a registered size.
2. **HORIZON_CENSORING_OF_RECENT_DODGERS_CLASSES** (NEEDS_MORE_LABELS (time); STRUCTURALLY_UNKNOWN). 143 of 168 Dodgers in-scope rows are CENSORED for the 7-season target (2021+ classes; the 2021 class labels after the 2028 season, 2022 after 2029). No research shortens this; it is a waiting cost.
3. **EVENTS_PER_FEATURE_FOR_ANY_FITTED_MODEL** (NEEDS_CENSUS_EXPANSION (benchmark depth); ACTIONABLE). Best case (REACH pooled): 34 positives against 60 needed for the 6-feature logistic; the population-stratified rate has no out-of-time skill. The benchmark already covers every mature class 2013-2019 (Top 30); more events need deeper lists or a league census, not more classes.
4. **DODGERS_SIGNING_TIME_EXPECTATION_MISSING** (NEEDS_DATA; ACTIONABLE). 0 of 168 Dodgers in-scope rows have a pre-signing expectation band versus 151 of 169 benchmark rows, so is_top_expectation_band and is_top_prospect_sample are confounded with population.
5. **DODGERS_10_SEASON_TARGETS_HAVE_NO_DEPTH** (NEEDS_CENSUS_EXPANSION; STRUCTURALLY_UNKNOWN). 10-season targets label only 2016-and-earlier signings: 11 Dodgers rows (1 positive bWAR, 0 Dodgers-value positive). DODGERS_MLB_VALUE gates the only expected-value model.
6. **BENCHMARK_LABELS_BLOCKED (4 deferred reachers + 3 identities)** (NEEDS_MORE_LABELS; ACTIONABLE). BWAR_2 benchmark support is one positive short; the 4 deferred 2016 reachers are the only near-term source of that positive (post-2026 capture).
7. **DODGERS_MARKET_MISSING_IN_LABELLED_ROWS** (NEEDS_DATA; ACTIONABLE). 3 labelled Dodgers reach rows lack market and 1 lacks position, so 21 of 25 enter the evaluation.

The estimate in blocker 1 is arithmetic on the observed rate. It is not a forecast.

## Not verified

- The 062 effect is reasoned from the label definitions in 041. It was not measured, because 062 is not applied to this replay.
- The replay is generation 15; production is generation 16. The two are logically equal per the release records. Production was not read.
- UNDISCLOSED cost cannot be separated from UNKNOWN with the current schema. The 0 in that column is a schema limit, not a finding.
