# Migration 043: portfolio decision engine

Design: `../042/final-decision-architecture.md`. Build: `node database/research/043/build.mjs` (deterministic;
`scenarios.json` + `views.sql` + `043_template.sql` -> `database/sql/043_portfolio_decision_engine.sql`).

DISI does not say "sign this player". It says what can responsibly be concluded at a decision date, given the evidence.

| Object | Grain | What it says |
|---|---|---|
| `portfolio_scenario_definitions` (table) | scenario | Reviewed pool multiplier and reserve share: BASE_POOL, RESERVE_30, POOL_PLUS_25, POOL_MINUS_25 |
| `v_portfolio_candidate_readiness` | Dodgers signing (220) | Decision-support state and blockers at the signing cutoff, built only from signing-time features, outcome-free comparable counts and population-level expected-value support |
| `v_historical_portfolio_summary` | grain x value | RETROSPECTIVE capital allocation, known-spend concentration (largest share, HHI), cost coverage, realized value |
| `v_portfolio_scenario_evaluation` | scenario x signing year | Budget feasibility on known costs; an exact value-maximizing selection (subset search, at most 12 eligible candidates) only for optimization-eligible candidates |
| `v_portfolio_decision_support` | decision state | Count of candidates, what DISI may say and what it may not say |
| `v_portfolio_research_queue` | issue | Expected-value blocker, incomplete costs, missing features, indeterminate pool years |

## Decision-support states

These states come from **population** support and signing-time facts, never from the candidate's own outcome. A test flips every
outcome and the states stay byte-identical.

| State | Meaning | Candidates today |
|---|---|---|
| `PREDICTIVE_DECISION_SUPPORTED` | Supported expected value, complete cost and features; may enter optimization | 0 |
| `HISTORICAL_CONTEXT_ONLY` | No expected value; signing-time profile and earlier comparables shown as history | 137 |
| `INSUFFICIENT_OUTCOME_SUPPORT` | No expected value and no comparable listed | 1 |
| `INSUFFICIENT_COST_DATA` | Expected value supported but cost incomplete | 0 |
| `INSUFFICIENT_PLAYER_DATA` | Age, position or market at signing unknown | 30 |
| `OUT_OF_SCOPE` | Outcome-selected historical record or professional signing | 52 |

**Predictive recommendations: 0.** Every scenario-year reports `VALUE_OPTIMIZATION_NOT_SUPPORTED` with no selection. A
switch test was run inside a rolled-back transaction, with the support thresholds lowered and a stand-in conditional value:

- 14 candidates become eligible.
- The optimizer returns the exact value-maximizing feasible set, checked against a brute-force search.
- Every candidate with an unsupported input stays out.

## Retrospective findings (Dodgers tracked / opening-class amateur signings; outcome-selected set excluded)

- **Spend:** 168 signings, of which 33 have a known cost (19.6% cost coverage). Known spend is $45.94M and is a **lower bound**.
  - 63% of known spend is in the 2012-2017 soft-capped era, mostly the 2015 class: $28.85M against a $0.7M pool after trades.
  - The largest single signing is 34.8% of known spend; the HHI is 0.156.
- **Realized value:** 47 mature signings, 35 with a resolved value. They total -0.35 realized organizational bWAR, and none is positive.
- **Pool feasibility (BASE_POOL):**
  - 3 years are within budget on complete costs: 2014, 2019 and 2026.
  - 2015 exceeds budget on known costs.
  - 9 years are INDETERMINATE because unknown costs could change the answer.
