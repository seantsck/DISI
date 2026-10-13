# Migration 039 — market / country / pathway intelligence

First layer of the 039-041 bundle (design: `architecture-report.md`). It is derived only: no signing, outcome, cost or value fact is
added.

| File | Role |
|---|---|
| `architecture-report.md` | 039-041 architecture: the stack, measured data reality, the twelve definitions (observation unit, as-of, maturity, eligibility, leakage, minimum samples, uncertainty, calibration, NULL rules) |
| `reference.json` | reviewed market groups (20 observed markets → 7 groups) and the three league eras for international amateur signings |
| `audit.mjs` | replays 001-038a in PGlite; checks the mapping and era contiguity -> `audit-report.json` |
| `039_template.sql`, `views.sql`, `build.mjs` | migration template, the four views, deterministic assembly |

## Objects

- **Tables:** `market_groups` (20 rows) and `international_signing_eras` (3 rows).
  - The eras are: before bonus pools, soft-capped pools from 2 July 2012, and hard-capped pools from 2 July 2017.
  - Professional routes are not placed on the amateur era scale.
- **`v_signing_time_features`:** the leakage-safe feature record shared by 039-041, one row per signing (268). It holds:
  - population class, route, market group, era
  - age in the signing year
  - position at signing (never the later primary position)
  - reported bonus and cost band
  - the earliest expectation dated on or before the signing cutoff

  It reads no outcome.
- **`v_market_pathway_player_context`:** the features plus the realized outcome (036) and the development pathway (037). It is
  descriptive.
- **`v_market_pathway_summary`:** results by 9 dimensions × population class. Each row has population_scope, sample_state,
  tracked / mature / audited counts, cost and outcome coverage, rate_eligible, sample_reach_share and census_reach_rate.
- **`v_market_research_queue`:** SIGNING_MARKET_UNKNOWN 29, POSITION_AT_SIGNING_UNKNOWN 12, AGE_AT_SIGNING_UNKNOWN 5.

## Findings (descriptive; populations never pooled)

- **Population classes:**
  - outcome-selected historical 49 (no shares)
  - Top-prospect sample 48
  - tracked 136
  - opening-class census 35 (2021, 2023)
- **Top-prospect sample:** 11 of 43 mature audited reached MLB (0.256): Dominican Republic 6/21 (0.286), Venezuela 4/17 (0.235).
  These are rank-selected 2013/14 non-Dodgers prospects, not a market census.
- **Tracked Dodgers sample:** soft-cap era 2/11; hard-cap era 0/14 mature audited so far.
- **No census rate is eligible.** The 2021 opening class has 7 of 22 mature members unaudited.
- **At-signing expectation:** only the 48 tracker ranks and Roki Sasaki's Top-100 rank. The FanGraphs evaluations of De Paula and
  Morales were published years after signing, so they are never at-signing features.

The verifier gains five checks (`scripts/db/lib/market-invariants.mjs`, 212 in total). There are 62 tables and 129 views.
