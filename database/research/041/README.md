# Migration 041 — outcome-probability infrastructure

Third layer of the 039-041 bundle (design and the twelve definitions: `../039/architecture-report.md`).

| File | Role |
|---|---|
| `targets.json` | four reviewed targets with fixed horizons and support minimums (50 labelled rows, 10 positives, 10 negatives; 10 events per model feature) |
| `evaluate.mjs` | deterministic out-of-time evaluation on the 001-040 replay -> `evaluation.json` |
| `041_template.sql`, `views.sql`, `build.mjs` | migration template, six views, deterministic assembly (`build.mjs` also exports the assembler `evaluate.mjs` uses) |

```
node database/research/041/evaluate.mjs && node database/research/041/build.mjs
```

## Objects

- **Tables:** `outcome_targets` (4) and `outcome_model_evaluations` (3 rows: the recorded evaluation, with its training-set fingerprint).
- **Views:**
  - `v_outcome_training_population` (signing × target: label, training state, exclusion reason, reference population)
  - `v_outcome_feature_matrix` (signing-time features only)
  - `v_outcome_target_support` (per target and reference population, never pooled)
  - `v_outcome_model_evaluation` (stored evaluation plus `evaluation_current`)
  - `v_player_outcome_probability` (signing × target)
  - `v_outcome_probability_research_queue`

## Answers on today's data (analysis as of 2026-10-05; last complete MLB season 2026)

1. **How many signings are eligible for probability modelling?** Labelled, non-outcome-selected, amateur-route rows for the 7-season
   MLB target:
   - **25** Dodgers tracked rows (2 positive)
   - **43** top-prospect benchmark rows (6 positive), a separate reference population

   The other rows are:
   - 143 censored (horizon not elapsed)
   - 5 unaudited
   - 52 out of scope: the 49 outcome-selected historical signings and 3 professional-route signings
2. **Positive / negative mature labels** (Dodgers reference / benchmark reference):

   | Target | Dodgers | Benchmark |
   |---|---|---|
   | REACH_MLB_WITHIN_7_SEASONS | 2 / 23 | 6 / 37 |
   | POSITIVE_BWAR_WITHIN_10_SEASONS | 1 / 10 | 7 / 36 |
   | BWAR_2_WITHIN_10_SEASONS | 1 / 10 | 3 / 40 |
   | DODGERS_MLB_VALUE_WITHIN_10_SEASONS | 0 / 11 | n/a |

3. **Statistically supportable targets: none.** No reference population reaches 50 labelled rows with 10 positives and 10 negatives.
4. **Not supportable:** all four. The nearest is POSITIVE_BWAR_WITHIN_10_SEASONS in the benchmark sample, which needs 3 more positives
   and 7 more labelled rows. The Dodgers reach target needs 8 more positives and 25 more labels.
5. **Leakage-free features:**
   - population class, route, market group, league era
   - age in the signing year
   - position at signing
   - the earliest expectation dated by the signing cutoff

   Bonus is excluded from models (incomplete and selection-biased for Dodgers). Development, later evaluations, bWAR, transactions and
   network relationships with unknown start dates are never features. Tests flip every outcome and delete every stint, and the
   feature matrix stays byte-identical.
6. **Does a fitted model beat the naive baseline? No.** Leave-one-signing-year-out (5 folds, 59 rows with complete features, 8
   positives):

   | Model | Brier | Log loss | AUC | Brier skill vs base |
   |---|---|---|---|---|
   | Base rate | 0.124 | 0.428 | — | 0 |
   | Population-stratified rate | 0.143 | 0.844 | 0.355 | −0.152 |
   | L2 logistic | 0.139 | 0.455 | 0.565 | −0.123 |

   Both are MODEL_NOT_SUPPORTED: there are too few events (8 positives, where 10 per feature are required), and both are worse than
   the base rate out of time. No coefficients are stored.
7. **Calibration:** not acceptable for any model. The calibration bins are recorded, but with 8 positives they are not informative.
8. **Predictions DISI can responsibly show today: none.** Every one of the 1,072 signing × target rows has a NULL probability with a
   reason.
9. **Where probability must stay NULL:**
   - outcome already observed
   - outcome-selected population
   - professional route
   - target not applicable
   - unaudited past the horizon
   - no supported reference population for the player's own population, which today covers all 143-157 open Dodgers rows per target

   The rule switches on automatically once support is reached. A test lowers the thresholds inside a rolled-back transaction, and
   probabilities then appear only for open-outcome Dodgers amateur rows, equal to the baseline and inside its 90% Wilson interval.
10. **Research that would most improve this:**
    - Audit the 7 unaudited 2021 opening-class members and the 5 unresolved benchmark identities.
    - Add earlier full-period or opening-class Dodgers censuses (2015-2019) with outcome audits, which adds labelled, non-selected
      rows.
    - Extend the Top-30 tracker benchmark to more mature classes (2015-2018), which adds labelled rows and positives in a
      comparable sample.
    - Record the position at signing where it is missing.
