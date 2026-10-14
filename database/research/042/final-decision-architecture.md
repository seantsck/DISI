# DISI final bundle (042-045): decision architecture

Written 2026-10-14 against canonical production 001-041 (`main` 999f394; 64 tables / 140 views; verifier 223/223; analysis as-of
2026-10-05). It governs Migrations 042 (expected organizational value), 043 (portfolio decision support), 044 (executive product)
and 045 (final integration and release closure).

## The one rule this bundle exists to enforce

```
unsupported probability  ->  NULL expected value  ->  no player ranking  ->  no value-maximizing portfolio
```

Each layer reads the support state of the layer below and may only **narrow** it, never widen it. "The infrastructure exists" and "the
estimate is supported" are separate columns everywhere. Migration 041 currently supports **no** outcome target (support rule: at
least 50 labelled observations, 10 positives and 10 negatives in one reference population; every fitted model is worse than the base
rate), so on today's data:

| Layer | Supported outputs today | What is shown instead |
|---|---|---|
| 041 probability | 0 of 1,072 | NULL with `prediction_exclusion_reason` |
| 042 expected organizational value | 0 | NULL with `expected_value_exclusion_reason`; realized value and labelled historical distributions |
| 043 predictive portfolio recommendations | 0 | readiness states, budget feasibility, retrospective portfolio analysis |
| 044 product | no probability, expected value, ranking or gauge rendered | the support/research state and what evidence would activate it |

## 1. Organizational value

Organizational value is the **regular-season Baseball-Reference WAR (bWAR) the Dodgers organization obtained from an asset it
acquired**, at the strongest attribution level the transaction record supports. It is not career value: a player who produces 30 bWAR
for other clubs after leaving produced 0 Dodgers organizational value unless the Dodgers received something attributable in return.
fWAR is never mixed in (it exists only as a separately labelled career metric).

## 2. Realized vs expected

* **Realized** organizational value is observed: bWAR already accrued with the Dodgers (and through attributable trade returns) up to
  the analysis as-of date. It exists today for every Dodgers signing whose chain is resolved (Migrations 032-034).
* **Expected** organizational value is a forecast made at a decision date: `P(outcome) x E[value | outcome]` for a reference
  population. It needs a supported probability (041) **and** a supported conditional value distribution (enough mature, positive,
  value-known observations). Neither exists today, so it is NULL.

A historical average of realized value is a **historical descriptive statistic** of a defined population, never a player's expected
value. 042 publishes such distributions only in views and columns named `historical_*`, with `statistic_kind =
'HISTORICAL_DESCRIPTIVE'`.

## 3. Components that may be combined

These are combined only through the existing 034 definition `total_individually_attributable_organizational_bwar`. It is NULL whenever
any player-attributable interval is unresolved.

* `DIRECT_DODGERS_VALUE`: regular-season bWAR in Dodgers team-seasons (`direct_dodgers_mlb_bwar`).
* `INDIVIDUALLY_ATTRIBUTABLE_TRADE_VALUE`: Dodgers bWAR of returns from trades in which the player was the **sole** tracked outgoing
  asset, at first hop and downstream. These are `PLAYER_ATTRIBUTABLE` lineage edges.

## 4. Components that stay separate (never added to a player's total)

* `PACKAGE_ATTRIBUTABLE_VALUE`: value returned for a multi-asset package. It belongs to the package, not to any one player, so it is
  shown at package grain or labelled "package participation".
* `OBSERVABLE_NOT_ATTRIBUTABLE_VALUE`: value observable downstream in a chain that cannot be attributed (mixed lineage, unresolved
  timing).
* `VALUE_LEFT_ORGANIZATION`: MLB bWAR the player produced for other clubs (`non_dodgers_mlb_bwar`). It is a fact about the player's
  career, not Dodgers value.
* Career bWAR, which is the player's realized outcome.
* bWAR and fWAR, which are never blended.

## 5. Acquisition cost

The cost components stay separate:

* `signing_bonus_usd`
* `posting_fee_usd`
* `transfer_fee_usd`
* `release_fee_usd`
* `other_acquisition_fee_usd`

`known_acquisition_cost_usd` is the sum of the **known** components and is labelled as known, never as total. The required and
possible components come from `acquisition_cost_component_rules` (030), and completeness is `acquisition_cost_completeness` (COMPLETE /
PARTIAL / UNKNOWN / NO_RULE). The international pool charge is a regulatory charge against the pool, not an acquisition cost, and is
never added.

## 6. Missing cost

Value per cost (bWAR per $1M), net expected value and any budget optimization need `cost_complete = true`. PARTIAL / UNKNOWN / NO_RULE
cost produces:

* a NULL ratio, with `cost_coverage_state` explaining why;
* exclusion from value-per-cost optimization (043);
* in budget feasibility, an `INDETERMINATE` state when an unknown cost could change the answer, never an assumption of $0.

## 7. How probability enters expected value

Each reviewed value model in `expected_value_models` (042) names its probability target (041), the value component it forecasts, and a
conditional-support minimum. The first and only model is `EXPECTED_DIRECT_DODGERS_BWAR_V1`:

* probability target `DODGERS_MLB_VALUE_WITHIN_10_SEASONS`;
* value: the mean 10-season Dodgers bWAR of positive-labelled training rows;
* conditional minimum: 10 mature, positive, value-known observations.

When both supports hold:

```
expected = probability (041, the player's reference population) x conditional mean (the same population)
```

with the interval taken from the probability interval times the conditional mean. Expected trade realization has **no** model in v1:
trade outcomes depend on future transactions DISI cannot see at signing, so `expected_trade_realization_bwar` is always NULL with
reason `NO_TRADE_REALIZATION_MODEL`.

## 8. NULL probability

A NULL probability gives a NULL expected value. The reason propagates:

* `PROBABILITY_NOT_SUPPORTED:<041 reason>`, or
* `CONDITIONAL_VALUE_NOT_SUPPORTED`, or
* `OUT_OF_SCOPE:<reason>`.

Nothing is coalesced to zero. Downstream counts treat a NULL expected value as unknown.

## 9. What a portfolio decision may say

* Which candidates are **ready** for value-based decision support, and for each one that is not, the precise blocker (outcome support,
  cost data, player data, scope).
* Whether a candidate set **fits a budget**, using known and complete costs, and when the answer is indeterminate because costs are
  unknown.
* Retrospective portfolio facts, labelled RETROSPECTIVE:
  * capital allocation by market, cost tier and era;
  * spend and realized-value concentration;
  * cost coverage;
  * realized organizational value by cohort.
* Historical comparable context (040), labelled descriptive.
* When (and only when) every input is supported: a value-maximizing selection among **optimization-eligible** candidates, with its
  expected total and interval.

## 10. What a portfolio decision may not say

* "Sign X", "X is the best signing", or any ranking by predicted return, while expected value is unsupported.
* An "optimal" portfolio that includes a candidate whose expected value is NULL, or treats NULL as 0.
* That a hindsight-best historical portfolio was knowable at the signing date.
* Causal statements about markets, trainers, pathways or spending ("spending more in market M causes value").
* "AI general manager", "success predictor" or "signing oracle" language.

## 11. Decision as-of semantics

A candidate's decision date is its signing cutoff (039 `signing_cutoff_date`: signing date, else the formal or announced date, else Dec
31 of the signing year). Every candidate input comes from `v_signing_time_features` / `v_outcome_feature_matrix`, which already
contain only signing-time information. The supporting evidence (labels, evaluation) is as of the analysis as-of date
(`max(outcome_audits.audited_through_date)`). Both dates are exposed:

* `decision_as_of_date`: what was knowable about the candidate;
* `evidence_as_of_date`: when the reference evidence was assembled.

## 12. Leakage prevention

* Candidate features come only from the 039 signing-time record (no outcome, no later position, expectations dated on or before the
  cutoff).
* 043 readiness depends on outcomes only through **population-level** support states (041/042), never through the candidate's own
  outcome.
* Tests flip every outcome and add later facts, and require byte-identical candidate features and decision states (support states are
  computed from other players' labels).
* Retrospective views are segregated by name (`v_historical_*`) and carry `analysis_kind = 'RETROSPECTIVE'`.

## 13. Portfolio budget semantics

* **Budget:** for a hard-capped era, the club's reported international bonus pool (`signing_environments.club_bonus_pool_usd`, after
  trades when reported). Scenarios in `portfolio_scenario_definitions` (043) apply a reviewed multiplier and a reserve share.
* **Candidate set:** the Dodgers signings of that signing year, at their decision dates.
* **Budget states:**
  * `WITHIN_BUDGET_ON_COMPLETE_COSTS`
  * `EXCEEDS_BUDGET_ON_KNOWN_COSTS`: known costs alone exceed the budget
  * `INDETERMINATE_UNKNOWN_COSTS`: known costs fit, but unknown costs could exceed it
  * `NO_POOL_REPORTED`
  * `NO_CANDIDATES`
* **Accounting:** pool charges are not acquisition costs, but pool-era bonuses are the pool's main draw. DISI compares known
  signing-bonus totals of pool-charged pathways to the pool and labels this an approximation of pool usage, never a reconciled pool
  ledger.

## 14. Risk and uncertainty

* Probabilities carry 90% Wilson intervals (041), and expected values carry the propagated interval.
* Historical distributions report the quartiles (25th, 50th and 75th percentiles), the positive-value share and the count.
* With fewer than 10 known values, the distribution columns are NULL with `SMALL_SAMPLE`.
* No point estimate is shown without its population, its count and its support state.
* Concentration uses known values only, together with the share of the total that is known.

## 15. Support-state propagation

| Layer | Column | Values | Rule |
|---|---|---|---|
| 041 | `v_outcome_target_support.baseline_supported`, `v_player_outcome_probability.prediction_eligible` | bool | 50/10/10 |
| 042 | `v_expected_value_support.expected_value_supported` | bool | probability target supported **and** conditional value supported |
| 042 | `v_player_expected_organizational_value.expected_value_state` | `EXPECTED_VALUE_SUPPORTED` / `PROBABILITY_NOT_SUPPORTED` / `CONDITIONAL_VALUE_NOT_SUPPORTED` / `OUT_OF_SCOPE` | non-NULL value iff SUPPORTED |
| 043 | `v_portfolio_candidate_readiness.decision_support_state` | `PREDICTIVE_DECISION_SUPPORTED` / `HISTORICAL_CONTEXT_ONLY` / `INSUFFICIENT_OUTCOME_SUPPORT` / `INSUFFICIENT_COST_DATA` / `INSUFFICIENT_PLAYER_DATA` / `OUT_OF_SCOPE` | `optimization_eligible` iff PREDICTIVE_DECISION_SUPPORTED, which requires `EXPECTED_VALUE_SUPPORTED` and complete cost and complete core features |
| 043 | `v_portfolio_scenario_evaluation.value_optimization_state` | `VALUE_OPTIMIZATION_SUPPORTED` / `VALUE_OPTIMIZATION_NOT_SUPPORTED` | supported iff at least one optimization-eligible candidate; ineligible candidates never enter the selection |
| 044 | `v_prediction_readiness`, `v_executive_overview` | counts and states | the UI renders numbers only from supported columns |
| 045 | `v_disi_release_status` | supported counts at every layer | verifier: each layer's supported count is no larger than the layer below permits |

The verifier (045) and the focused tests enforce each arrow. A downstream "supported" row whose upstream is unsupported is a hard
violation.

## 16. Executive-product display rules

* Overview first, evidence on demand: the home page shows a short, high-signal summary, and the deeper pages carry evidence and
  methodology.
* Every number shows its population and denominator (for example "of 98 mature tracked signings"), and known-only totals say "known".
* No gauge, percentage dial, ranking or "predicted" badge unless the underlying support state is SUPPORTED. Today the Prediction
  Readiness page states: *"DISI does not currently publish player outcome probabilities because the verified mature sample does not
  meet the minimum support threshold."* and lists the evidence needed.
* Missing renders as "—" or "unknown", never 0. Retrospective tables carry a "Retrospective" tag.
* The existing visual language is kept: dark navy panels, `.table-panel`, `.kpi-card` and `.page-guardrail` for limitations.

## 17. Performance

Production anon has a 3 s statement timeout, and production is 2-6x slower than local.

* Every new public view: anon server-side under 300 ms locally on repeated reads.
* Executive views read by pages: bounded (single-row or fewer than 100 rows) and selected by column.
* Pages: at most 4 concurrent queries. Heavier pages run sequentially, as `/research` already does.
* The player dossier adds at most 3 queries, each filtered by player.
* No page reads `v_player_comparables`, `v_outcome_training_population` or `v_player_outcome_probability` unfiltered.
* Heavy upstream views are read once per view through MATERIALIZED CTEs, which is the lesson from 038a.

## 18. Public API / view boundaries

* 045 records the **product contract** in `disi_product_contract`: the views the application may read, each with its purpose, grain,
  and whether it is executive (bounded) or research (deep).
* All views stay readable (public research database), but only contract views are product API.
* The verifier checks that every view the app reads (`lib/data.js`) is in the contract and exists.

## 19. Release and versioning

* The data/product version is `DISI v1.0.0` (schema layer v0.33-v0.36 for 042-045), recorded in `disi_product_contract` metadata and
  shown by `v_disi_release_status` with:
  * the analysis as-of date;
  * the latest research update (latest audit date);
  * the probability model version, value model version and decision engine version;
  * the supported counts.
* One hosted release of 042-045 follows explicit approval, and the package version becomes 1.0.0.

## 20. "DISI complete through 045"

All of the following hold:

* Migrations 001-045 are applied to production, byte-identical to frozen `main`.
* The verifier passes every check through 045.
* Every app route is green within the anon timeout budget.
* The support-propagation chain is proven by automated tests and the verifier.
* Methodology documents every layer.
* The research roadmap is published.
* No layer publishes an estimate its evidence does not support.

DISI v1 is **provenance-first international signing intelligence and decision support**, not a predictor.

## Objects (planned)

| Migration | Tables | Views |
|---|---|---|
| 042 | `expected_value_models` | `v_player_realized_organizational_value`, `v_historical_org_value_distribution`, `v_expected_value_support`, `v_player_expected_organizational_value`, `v_expected_value_research_queue` |
| 043 | `portfolio_scenario_definitions` | `v_portfolio_candidate_readiness`, `v_historical_portfolio_summary`, `v_portfolio_scenario_evaluation`, `v_portfolio_decision_support`, `v_portfolio_research_queue` |
| 044 | — | `v_executive_overview`, `v_prediction_readiness` |
| 045 | `disi_product_contract` | `v_disi_release_status`, `v_research_roadmap`, `v_executive_metric_provenance` |

Totals after 045: 67 tables and 155 views. The legacy, empty `model_predictions` and `portfolio_scenarios` tables (001) stay untouched
and unused: no frozen object is altered.
