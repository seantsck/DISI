# DISI v1.0.0 serving layer: persisted product snapshots (Migration 045a)

## Why

| Attempt (2026-10-14) | What happened | Outcome |
|---|---|---|
| First | 044 needed about 700 MB of planner memory and restarted the 1 GB instance | Rolled back |
| Second | 043a / 044 / 045 staged that work. Single reads of the executive layer took about 0.5-0.7 s, but **four simultaneous anonymous overview reads stalled the instance and hit the 3 s statement timeout** | Rolled back |

The analytical semantics were right; the serving was wrong. Every page request rebuilt the 041 → 042 → 043 → 044 graph.

**Rule from 045a on: the public product never reconstructs the analytical graph during a request.**

```
canonical DISI facts (tables, 001-041)
        │  (unchanged)
042-045 analytical layer (views + staged functions)      INTERNAL: owner only
        │  disi_refresh_product_snapshots()  - explicit, privileged, staged, validated, one transaction
product snapshots (product_* tables)                      PUBLIC: anon / authenticated SELECT, RLS
        │  bounded SELECT (one row, or rows filtered by player)
Next.js pages (/, /portfolio, /prediction-readiness, dossier)
```

## What the snapshots are and are not

The snapshots are a **derived product cache**, a set of read models. They are not facts and never a research source.
- Canonical facts stay in the DISI tables.
- The 042-045 analytical layer stays the only computation.
- A snapshot stores the product-facing result of that computation at one generation, with its freshness.
- Each snapshot table is a column-exact projection of the analytical view it replaces: same names, types, typmods, NULLs, states, labels and
  provenance text, plus `generation_id`. "The snapshot equals its source" is therefore a row-for-row comparison, which the verifier runs.
- Nothing about support is hard-coded.
  - The refresh evaluates 041 → 043 every time.
  - If evidence makes a target, an expected value or a recommendation supported, the next refresh carries that state into the product.
  - This is proven in four states: unsupported, probability-only, expected value supported with no eligible candidate, and predictive
    decisions supported.

## The read models (derived from the actual page queries)

The 044 pages added eleven new reads. All eleven are analytical views, including two released 040 / 041 views (`v_outcome_model_evaluation`
and `v_player_comparable_summary`), each needing 40-55 MB of planner memory per read. They become ten tables:

| Snapshot table | Rows today | Replaces | Read by |
|---|---|---|---|
| `product_executive_snapshot` | 1 | `v_executive_overview` + `v_disi_release_status` + generation metadata | `/`, `/prediction-readiness`, freshness line on every product page |
| `product_prediction_readiness` | 7 | `v_prediction_readiness` | `/prediction-readiness` |
| `product_model_evaluations` | 3 | `v_outcome_model_evaluation` (041) | `/prediction-readiness` |
| `product_expected_value_support` | 1 | `v_expected_value_support` | `/portfolio`, `/prediction-readiness` |
| `product_portfolio_decision_support` | 6 | `v_portfolio_decision_support` | `/portfolio` |
| `product_portfolio_history` | 26 | `v_historical_portfolio_summary` | `/portfolio` |
| `product_portfolio_scenarios` | 52 | `v_portfolio_scenario_evaluation` | `/portfolio` |
| `product_player_decision` | 220 | `v_player_realized_organizational_value` ⟕ `v_portfolio_candidate_readiness` (decision columns; its two cost columns prefixed `readiness_`) | dossier, by `player_id` (indexed) |
| `product_player_expected_value` | 220 | `v_player_expected_organizational_value` | dossier, by `player_id` (indexed) |
| `product_player_comparables` | 475 | `v_player_comparable_summary`, Dodgers target signings only | dossier, by `target_signing_id` (indexed) |

**Not snapshotted:**
- The pre-042 pages' reads (unchanged and already in production).
- `v_executive_metric_provenance`, a static VALUES list: its planner memory is under 0.1 MB, so it stays a public view.

**Generation metadata** is in `product_executive_snapshot`:
- `generation_id`, `generated_at`, `snapshot_as_of_date` (UTC date of the refresh)
- `source_data_as_of_date` (the analysis as-of date of the source data) and `source_development_data_as_of_date`
- `product_version`, `schema_version`, `support_chain_state`, `canonical_through`

Every other snapshot row carries the same `generation_id`.

## Refresh

- **How to run it:**
  - `npm run refresh:product-snapshots`, which runs `scripts/db/refresh-product-snapshots.mjs`, or
  - for the release runner, `database/release/sql/refresh-product-snapshots.sql`.
- **When:** explicitly, after DISI research data changes. Never from a page request, and no schedule is required for v1.0.0.
- **Who:** the database owner only.
  - `disi_refresh_product_snapshots()` is invoker-rights with a fixed search_path, and EXECUTE is revoked from PUBLIC, anon and authenticated.
  - The command refuses anon / authenticated credentials and any role that can't execute the refresh.
  - It can check the expected project ref, verifies TLS for remote databases, and prints counts and timings only.
- **Atomicity:** one transaction.
  - The refresh takes an EXCLUSIVE lock on `product_executive_snapshot`. That serializes refreshes but still lets readers take ACCESS SHARE.
  - It then DELETEs and re-INSERTs each snapshot (never TRUNCATE, which would block readers).
  - MVCC lets readers see the previous complete generation until COMMIT, and the new complete generation afterwards. There is never a mix.
- **Bounded memory:** each snapshot is its own dynamic statement, planned when it runs and released when it ends. The heavy layers it reads
  are the staged 043a / 044 / 045 functions. No statement plans the whole graph.
- **Validation before commit**, derived from the snapshot itself:
  - The executive counts equal the snapshot rows.
  - No layer is supported beyond the layer below it.
  - No optimized selection exists without an eligible candidate.
  - No expected value is published on an unsupported row.

  Any violation raises, and the previous generation stays.
- **First generation:** 045a runs the refresh once, only if no generation exists, so a fresh replay and the production apply are complete
  and consistent. Re-running 045a is a no-op.

## Public / private boundary

**Public (anon / authenticated SELECT, RLS, no write):**
- the ten `product_*` tables
- the reference tables `expected_value_models`, `portfolio_scenario_definitions` and `disi_product_contract`
- `v_executive_metric_provenance`
- every pre-042 relation, unchanged

**Internal (owner only):**
- the fourteen 042-045 analytical views: realized / expected value, expected-value support, research queue, candidate readiness, the four 043 portfolio
  views, the executive overview, prediction readiness, release status and roadmap
- the six staged functions (043a, 044, 045)
- the refresh and drift functions

The application makes **zero** RPC calls.

**Product contract** (`disi_product_contract`): exactly the 47 relations the application reads. The 045a test proves the contract equals the
`.from()` reads in `lib/data.js` and `app/`, and that no analytical internal is among them.

## Freshness

`/`, `/portfolio`, `/prediction-readiness` and the dossier's decision section show one line:

> "Snapshot generated <date> · source data as of <date> · DISI v1.0.0"

DISI is a research database refreshed after research changes, not a live feed.

## Verifier (247 hard checks)

Four new checks:

| Check | What it enforces |
|---|---|
| `product_snapshot_api_violations` | Snapshots public; internals and functions closed |
| `product_snapshot_generation_violations` | One generation that covers every Dodgers signing |
| `product_snapshot_drift_violations` | Every snapshot equals a fresh evaluation of its source, through `disi_product_snapshot_drift()`, one statement per snapshot. A stale snapshot is reported. |
| `product_snapshot_support_violations` | The snapshot's own support chain |

The staged-function check also requires the staged functions to be internal once 045a exists.
