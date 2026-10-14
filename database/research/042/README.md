# Migration 042: expected organizational value

Design: `final-decision-architecture.md` (the whole 042-045 bundle). Build: `node database/research/042/build.mjs` (deterministic;
`models.json` + `views.sql` + `042_template.sql` -> `database/sql/042_expected_organizational_value.sql`).

| Object | Grain | What it says |
|---|---|---|
| `expected_value_models` (table) | value model | Reviewed model: its 041 probability target, value component and conditional-support minimum |
| `v_player_realized_organizational_value` | Dodgers signing (220) | Realized value with each component separate, cost components with completeness, gated per-$1M ratio |
| `v_historical_org_value_distribution` | grain x value | HISTORICAL_DESCRIPTIVE quartiles and positive-value share (10+ resolved values) |
| `v_expected_value_support` | value model | Probability support (041) AND conditional value support, with the evidence still needed |
| `v_player_expected_organizational_value` | Dodgers signing x model | Expected value, NULL with a reason unless every input is supported |
| `v_expected_value_research_queue` | issue | Unsupported models, unresolved or incomplete realized value, incomplete cost |

## Findings on canonical data (as of 2026-10-05)

- **Realized value (220 Dodgers signings).**

  | State | Signings | Realized bWAR |
  |---|---|---|
  | Realized to date, mature | 77 | 232.66 |
  | Realized to date, recent | 2 | 1.60 |
  | Value known so far, chain incomplete | 9 | 64.57 |
  | Outcome not yet observed (unknown, never zero) | 132 | — |

- **Historical distribution.** The comparison population is mature Dodgers tracked / opening-class amateur signings, excluding the
  notable-player set.
  - It has 47 members, 35 with a resolved value. The median realized value is 0.00 bWAR and **none** of the 35 produced positive
    realized organizational value.
  - Every positive-value Dodgers international signing in DISI is in the notable-player set. That set is excluded from rates by design,
    which is exactly why it cannot train or describe a base population.
- **Expected value.** `EXPECTED_DIRECT_DODGERS_BWAR_V1` depends on 041 target `DODGERS_MLB_VALUE_WITHIN_10_SEASONS`.
  - The Dodgers reference population has 11 labels and 0 positives; it needs 10 more positives and 39 more labels.
  - The model also needs 10 positive, value-known observations; it has 0.
  - **0 of 220 expected values are supported**: 157 have an unsupported probability and 63 are out of scope (49 notable players, 11
    outcomes already observed, 3 professional signings). Every row is NULL with a reason.
- **Trade realization** has no forecasting model: future transactions are not knowable at signing.
