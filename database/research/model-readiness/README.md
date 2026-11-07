# Model-readiness audit (frozen 061 state)

A read-only audit of whether DISI's outcome-probability layer (041, as extended through 057) can support a model. It asks what limits it and which research would move it. This is analysis only. Nothing in it is a migration, a database write, a model fit, an evaluation re-run or a production read. It changes no target, threshold or support rule.

Read [`audit-report.md`](audit-report.md) first. The verdict is **NEEDS_MULTIPLE**: NEEDS_CENSUS_EXPANSION + NEEDS_MORE_LABELS + NEEDS_DATA.

## Files

| File | What it is |
|---|---|
| `export.mjs` | Loads a saved PGlite replay and reads 35 views and tables in a `READ ONLY` transaction that is rolled back. It writes one sorted JSON export (default `research-output/model-readiness/replay-export.json`, which is gitignored and about 5.9 MB). |
| `build.mjs` | A pure function of that export plus the committed `database/research/{041,050,055,056,057}/evaluation.json`. It writes every file below and carries no timestamp. |
| `population.json` | Dodgers and benchmark, kept separate. Covers signings, model scope, maturity (5-year rule and per-target horizon), outcome states, reached MLB, unaudited outcomes, labels by target, and feature completeness. |
| `targets.json` | Every `outcome_targets` row by reference population. Covers labelled N, positives, negatives, censored, missing past horizon, positive rate, support state, the gaps to support and to a 6-feature model, and the limiting target. |
| `feature-coverage.csv` | One row per feature and scope (Dodgers model scope, Dodgers reach-labelled, benchmark model scope, benchmark reach-labelled). Each row gives timing (signing-time or post-signing), the model role, eligible / known / missing / %, missingness (with a per-year and per-pathway breakdown), and whether a missing indicator or default is safe. |
| `mature-outcome-gaps.csv` | The 12 mature Dodgers signings without a final outcome. Each row has the maturity basis and date, the reach horizon and state, the current outcome state, the evidence missing, and a ready-to-paste Google query. |
| `model-history.json` | The nine stored evaluations, in the current state, with the events and skill rules applied. Also the 041 / 050 / 055 / 056 / 057 research evaluations. |
| `priority-backlog.csv` | The ranked blockers and every research queue, classified ACTIONABLE / UNDISCLOSED / STRUCTURALLY_UNKNOWN / LOW_MATERIALITY / NOT_APPLICABLE / IDENTITY_BLOCKED, with model impact. |
| `audit-report.md` | The report: population, targets, features, the unknown-cost policy, the mature backlog, development coverage, model history, queues, verdict and blockers, and what was not verified. |

## Commands

```
node database/research/model-readiness/export.mjs --dump ~/.cache/disi-062/post061.tar   # canonical post-061 replay (read-only)
node database/research/model-readiness/build.mjs                                          # writes the artifacts
```

The export used for the committed artifacts has SHA-256 `1ff4da597b3e959c3a88fa771bc193809355f5925b0254f1d90d3f76e46ccdaa`, as recorded in `population.json` and `audit-report.md`. Running the export twice gives the same bytes, and so does running the build twice.

## Scope rules this audit keeps

- Dodgers and benchmark are never pooled for support. The stored evaluations pool them only for the out-of-time comparison, which is how 041 defines it.
- The audited state is 061, frozen. 062 (owner-observed career bWAR) is not applied, and where it would change a number the report says so without assuming it.
- Development, transaction and later-evaluation facts are post-signing. They are reported as coverage, never as features for the signing-time targets.
