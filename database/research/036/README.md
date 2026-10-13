# Migration 036 — scouting expectation vs realized outcome

First layer of the 036-038 intelligence bundle. `architecture-report.md` explains how 036, 037 and 038 connect.

| File | Role |
|---|---|
| `architecture-report.md` | bundle architecture: coverage measured at 035, reused structures, the three layers, guardrails |
| `bands.json` | reviewed expectation bands: one publication's own measure per family, with the DISI-convention outcome rule |
| `audit.mjs` | replays 001-035 in PGlite; measures the ACTIVE external observations, checks the bands -> `audit-report.json` |
| `036_template.sql`, `views.sql` | hand-written migration template and the five views |
| `build.mjs` | assembles `database/sql/036_scouting_expectation_outcomes.sql` (deterministic) |

```
node database/research/036/audit.mjs && node database/research/036/build.mjs
```

## What 036 adds

- `scouting_expectation_bands`, 15 bands in 4 families:
  - MLB Pipeline Top-30 international class rank: 1-10, 11-20, 21-30.
  - Baseball America Top 100: 1-10, 11-50, 51-100.
  - FanGraphs organization rank: 1-5, 6-10, 11-30, 31+.
  - FanGraphs FV: 60+, 55, 50, 45, 40 or lower.

  A band never crosses publications or scales.
- `v_player_realized_outcome`, the outcome spine shared by 036-038: 268 rows (220 Dodgers, 48 benchmark). It is passed through from
  032-034 and 035; MLB value is NULL without an MLB career.
- `v_scouting_expectation_observations`: 53 observations (48 tracker ranks, 2 FanGraphs org ranks, 2 FV grades, 1 Top-100 rank),
  every one banded, each with its order relative to the debut.
- `v_player_expectation_vs_outcome`: one frozen anchor per player and family, plus one row per tracked signing without an expectation.
- `v_scouting_calibration_summary`: descriptive band outcomes. Shares appear only from 10 comparable outcomes upward.
- `v_scouting_expectation_research_queue`.

No evaluation, outcome or value fact is added or changed. The verifier gains eight checks (`scripts/db/lib/expectation-invariants.mjs`).

## Findings at the 2026-10-05 boundary

The comparable sample is the MLB Pipeline 2013/2014 international-class tracker. It is a Top-prospect sample of non-Dodgers
signings, **not a census**.

| Band | Anchored | Comparable (mature, settled state) | Reached MLB | Exceeded (10+ bWAR) | Incomplete / too early |
|---|---|---|---|---|---|
| Class rank 1-10 | 18 | 16 | 8 (0.50) | 2 | 2 / 0 |
| Class rank 11-20 | 15 | 15 | 3 (0.20) | 0 | 0 / 0 |
| Class rank 21-30 | 15 | 11 | 0 (0.00) | 0 | 3 / 1 |

- In this sample, MLB reach falls with the band, and the 57.0 career bWAR of the reached players is almost all in the top band.
  That is a description of 48 ranked prospects of two classes. It is not a probability for any future prospect, and not an accuracy
  measure for MLB Pipeline.
- 31 of the 33 "underperformed" rows are no-debut-recorded players whose affiliated status is not established. They are counted as
  not having reached MLB by the as-of date, but `outcome_settled` is false.
- The Dodgers expectations are Josue De Paula (FV 55, org rank 1), Emil Morales (FV 50, org rank 4) and Roki Sasaki (Top 100 rank 1).
  All three are recent signings. De Paula's org rank and Sasaki's rank are "met" by MLB reach but not settled. The other three
  comparisons are TOO_EARLY.
- 45 Dodgers MLB players have no banded public expectation dated before their debut. This is the largest gap in the expectation
  layer, and it is queued as `MLB_REACHER_WITHOUT_PRE_DEBUT_EXPECTATION`.

## Guardrails

- Anchors use only observations dated before the debut, at the evaluation's own date precision. Later evaluations never move an anchor.
- UNAUDITED and immature outcomes are never misses. An active player without a debut, or an accruing MLB career below a floor, is
  TOO_EARLY.
- The outcome rules (MLB reach meets a rank band, 10+ career bWAR exceeds it, and the FV role floors) are DISI conventions, stated in
  every band.
- There are no probabilities, accuracy figures, hit rates, organization comparisons or causal claims.
