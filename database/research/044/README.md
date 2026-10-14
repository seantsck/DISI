# Migration 044: executive product

Design: `../042/final-decision-architecture.md` (sections 16-18). Build: `node database/research/044/build.mjs` (deterministic).

## Database contract (2 bounded views)

| View | Grain | Purpose |
|---|---|---|
| `v_executive_overview` | 1 row | Coverage, known spend (a lower bound unless every cost is complete), realized organizational value (components separate), MLB value produced for other clubs (not Dodgers value), and the support state of every predictive layer |
| `v_prediction_readiness` | target x reference population (7) | Labelled evidence, minimums, what is still needed, the recorded evaluation |

Predictive counts in the overview are computed only when their upstream support exists (one-time filters), so they cost nothing and
are 0 by construction today. The verifier checks they equal the layers they report.

## Application

| Change | What it shows |
|---|---|
| Home (`/`) | An executive summary above the database status. It shows signings, MLB players, known spend (lower bound), realized organizational value with its parts, value produced for other clubs, prediction state and research tasks, plus the no-probability statement linked to `/prediction-readiness` |
| `/portfolio` (new) | The decision-support states (what DISI may and may not say), the retrospective capital allocation and realized value, and known costs against each year's international pool |
| `/prediction-readiness` (new) | The current state and evidence by target and reference population, the recorded model evaluation (no model beats the base rate), and the value models with their blockers |
| Player dossier | An "Organizational value and decision support" section for Dodgers signings, covering:<ul><li>realized value and its parts</li><li>cost with completeness</li><li>gated value per $1M</li><li>expected-value state</li><li>decision-support state at the signing date</li><li>earlier comparables as historical context</li></ul> |
| Navigation | Portfolio and Prediction Readiness |

Every predictive number reaches a page only through `lib/decision-display.js`. It returns a number only for a supported row, and
otherwise returns the state and its reason. No gauge, ranking or predicted badge exists, and `tests/unit/decision-product.test.mjs`
enforces this.

Every new loader is bounded:
- **Portfolio and readiness pages:** one query at a time, with column lists on the heavy views.
- **Dossier:** three extra queries, run sequentially after the existing batch and filtered by player.
- **Home:** one extra single-row query, run after the existing batch.

## Staged overview (after the 2026-10-14 release attempt)

The first production release attempt ran out of memory while this migration's postcondition evaluated the overview. The overview had
stacked the whole 041 -> 042 -> 043 chain into one statement, about 700 MB of planner memory (see `../043a/README.md`).
`v_executive_overview` is now a wrapper over `disi_executive_overview()`, a staged, read-only, invoker-rights function:

- Each aggregate is its own statement.
- The per-player predictive counts are read only when their upstream support exists, so they are not even planned while it is absent.
- The output is byte-identical in the unsupported, probability-only and expected-value-supported states.
- It plans in under 2 MB at the top level and peaks at about 71 MB on a 1 GB instance.
- The postconditions are structural only: the migration never evaluates the overview.
