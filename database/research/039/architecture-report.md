# Migrations 039-041 — market context, archetypes and outcome-probability infrastructure: bundle architecture

Status: local implementation on `feature/disi-039-041-predictive-intelligence` (from `main` `ea90453`, canonical through 038a). Public
data only. Measured on a fresh 001-038a replay; analysis as-of date 2026-10-05.

## 1. The stack

```
039  SIGNING-TIME CONTEXT     v_signing_time_features: one leakage-safe feature record per signing (market, route, era, age, position,
                             cost, at-signing expectation), plus descriptive market / pathway / era summaries against outcomes
        +
036 / 037 FEATURES            expectation bands (036), development pathway (037) - descriptive only, never prediction inputs at signing
        ↓
040  ARCHETYPE / COMPARABLES  structured archetype keys and deterministic comparable sets built ONLY from signing-time features;
                             outcomes attached after selection
        ↓
041  OUTCOME PROBABILITY      targets, label maturity and censoring, training eligibility, feature matrix, a recorded model
                             evaluation against a naive baseline, and probabilities that stay NULL unless a reference population
                             supports them
```

The same signing-time feature record feeds 039, 040 and 041, so the three never disagree about what was known at signing.

## 2. Measured data reality (drives every decision below)

| Population (`signings.record_scope`) | Signings | Mature (signing + 5 y) | Mature audited | Reached MLB | What it is |
|---|---|---|---|---|---|
| HISTORICAL_VERIFIED (Dodgers 1951-2017) | 49 | 49 | 49 | 41 | **outcome-selected**: kept because the players became notable; never a label source |
| MLB_PIPELINE_TOP_PROSPECT (2013-14, non-Dodgers) | 48 | 48 | 43 | 11 | rank-selected Top-30 sample (035), selected on pre-signing information |
| TRACKED_DODGERS (2015-2026) | 136 | 27 | 27 | 4 (+2 recent) | Dodgers signings tracked from class lists and announcements |
| COMPLETE_CENSUS (2021, 2023 opening classes) | 35 | 22 | 15 | 0 | complete **opening-class** census, not a signing-period census |

At-signing feature coverage: position at signing 225/268 (the later `primary_position` is never used: it can reflect a conversion);
birth year 263/268; signing date 197/268; bonus 93/268 and only 36 of the 171 tracked / opening-class Dodgers signings, which makes
bonus a selection-biased, incomplete feature for Dodgers rows.

## 3. The twelve definitions

1. **Observation unit.** One tracked signing (`signings` row; one per player today, 268). Every 039-041 view keys on `signing_id`.
2. **As-of semantics.** The prediction horizon is AT_SIGNING. `signing_cutoff_date` = signing date, else formal transaction date, else
   announcement date, else 31 December of the signing year (`cutoff_precision` DAY or YEAR_END). Outcome facts are read as of the
   analysis as-of date (2026-10-05) and the last complete MLB season (2026).
3. **Mature outcome eligibility.** A label is defined only on a fixed horizon that has fully elapsed: REACH_MLB_WITHIN_7_SEASONS needs
   signing year + 7 ≤ the last complete season; the bWAR targets use 10 seasons. Before that the row is CENSORED, never negative.
4. **Benchmark / sample eligibility.** `population_class`: OUTCOME_SELECTED_SAMPLE (historical verified), TOP_PROSPECT_SAMPLE,
   TRACKED_SAMPLE, OPENING_CLASS_CENSUS. Summaries never pool classes. A census-grade rate (`rate_eligible`) needs a complete
   population, every member mature and audited, and 10+ members - true for nothing today. A labelled sample share is shown for a
   non-outcome-selected class with 10+ mature audited members.
5. **Training eligibility (041).** `training_state` per signing and target: OUT_OF_SCOPE (outcome-selected, professional route, or a
   target that does not apply), CENSORED, OUTCOME_UNAUDITED, BENCHMARK_SAMPLE_ONLY (labelled top-prospect rows: their own reference
   population, never pooled into Dodgers predictions), TRAINING_ELIGIBLE (labelled tracked / opening-class Dodgers rows). Nothing is
   coerced to 0.
6. **Leakage prevention.** Features are signing-time facts only: market, route, era, age in the signing year, position at signing,
   reported signing bonus (a fact of the signing event; DISI does not know when the public first learned it, which is stated), and the
   earliest expectation observation dated on or before the cutoff. Post-signing evidence - later scouting grades, development levels
   and pathway classes, bWAR, transactions, network relationships with unknown start dates - is never a prediction input.
   Comparable selection uses features only; outcomes attach afterwards. Automated tests prove that changing any future fact leaves
   every feature, archetype and comparable set unchanged.
7. **Feature provenance.** Every feature row carries `feature_as_of_date` (= the cutoff) and per-feature availability flags; each
   feature names its source column (signings, players, 030 financial view, 026 evaluations).
8. **Minimum samples.** Shares: 10+ mature audited non-outcome-selected members. Comparable summary: 5+ comparables listed, 10+
   mature audited comparables before a share. 041 empirical reference baseline: 50+ labelled rows, 10+ positives and 10+ negatives in
   one reference population. Fitted model: 10+ positive events per model feature and an out-of-time Brier skill above the baseline.
9. **Missing data.** Missing stays NULL and is counted (`feature_completeness`, coverage columns, research queues). No imputation, no
   fallback to a later value, no zero filling.
10. **Uncertainty.** Every share and probability carries its n and positives; probabilities carry a 90% Wilson score interval.
11. **Calibration.** Validation is leave-one-signing-year-out (an out-of-time split); Brier score and log loss are primary, AUC
    secondary, with calibration bins and the comparison against the training-fold base rate. In-sample fit is never reported as
    performance.
12. **When predictions MUST be NULL.** Outcome already observed; outcome-selected population; professional route; target not
    supported; no supported reference population of the player's own population class; features incomplete for a fitted model.

## 4. Migration 039 — market / country / pathway intelligence

- Tables: `market_groups` (each observed `country_market` → a market group justified by the data: Dominican Republic, Venezuela,
  Mexico, Cuba, other Latin America & Caribbean, Asia-Pacific, Europe / Africa / other; NULL → UNKNOWN) and `international_signing_eras`
  (league rules for international amateur signings: before bonus pools; 2012 Basic Agreement soft-capped pools from 2 July 2012;
  2016 Basic Agreement hard-capped pools from 2 July 2017; a signing without a date in 2012 or 2017 is ERA_BOUNDARY_AMBIGUOUS;
  professional routes are not placed on the amateur era scale).
- Views: `v_signing_time_features` (leakage-safe features, no outcome), `v_market_pathway_player_context` (features + realized
  outcome + 037 pathway, descriptive), `v_market_pathway_summary` (by dimension and population class, with population_scope,
  sample_state, tracked / mature / audited counts, cost and outcome coverage, rate_eligible), `v_market_research_queue`.
- No ranking of markets; no causal language.

## 5. Migration 040 — archetypes and comparables

- **Archetype**: a structured key (route, position family, age band, at-signing expectation tier, cost band, market group, era) and
  a coarse key (route, position family, age band) for summaries. No colourful labels.
- **Comparables**: for each signing, candidates are other signings with the same route and position family, signed in an EARLIER
  signing year (only history known at the time), not outcome-selected. They are ordered by a fixed hierarchy - age band, expectation
  tier, cost band, market group, era - then age distance, signing year and slug; at most 10 are kept, each with the list of matched
  dimensions. Outcomes (spine) attach after selection. Fewer than 5 comparables → no comparable summary.
- Views: `v_player_historical_archetype`, `v_player_comparables`, `v_player_comparable_summary`, `v_archetype_outcome_summary`,
  `v_archetype_research_queue`.

## 6. Migration 041 — outcome-probability infrastructure

- Tables: `outcome_targets` (REACH_MLB_WITHIN_7_SEASONS, POSITIVE_BWAR_WITHIN_10_SEASONS, BWAR_2_WITHIN_10_SEASONS,
  DODGERS_MLB_VALUE_WITHIN_10_SEASONS, with horizon and support thresholds) and `outcome_model_evaluations` (the deterministic
  build-time evaluation: base rate, sample-stratified rate and an L2 logistic regression under leave-one-signing-year-out, with Brier,
  log loss, AUC, calibration bins, a training-set fingerprint and the decision).
- Views: `v_outcome_training_population`, `v_outcome_feature_matrix`, `v_outcome_model_evaluation` (stored evaluation + whether the
  live training set still matches its fingerprint), `v_player_outcome_probability` (one row per signing and target, probability NULL
  unless supported, with the exclusion reason), `v_outcome_probability_research_queue`.
- Expected result on today's data: a usable infrastructure, an honest evaluation, and probabilities that are NULL for every current
  signing, because no Dodgers reference population reaches the support thresholds. That is a finding, not a failure.

## 7. Performance rule (learned from 038)

No view stacks more than two computations of the 036 outcome spine; feature views read no outcome at all; selective populations are
filtered first; every intermediate referenced more than once is MATERIALIZED. Every new public view is timed as anon under a 3 s
statement timeout, repeatedly, locally, and read-only against production before the release report.
