# Migrations 036-038 — expectation, pathway and network intelligence: bundle architecture report

Status: research and local implementation on `feature/disi-036-038-intelligence`. Nothing here is applied to the hosted database.
Public data only. Measured on a fresh 001-035 replay (PostgreSQL 17.9, analysis as-of date 2026-10-05).

## 1. Purpose

DISI already holds facts in separate layers: what evaluators published (026), how players moved through the minors (021-024), who
the sources say they trained with or signed out of (029), what they cost (030-031), and what they produced (032-035). Migrations
036-038 add **derived, read-only intelligence** that connects those facts without rewriting any of them:

```
SCOUTING EXPECTATION   036  what a public evaluator said, frozen at the date it was said
        |
DEVELOPMENT PATH       037  how the player actually moved through the levels (observed, never explained)
        |
REALIZED OUTCOME       036  one outcome spine reused by all three (reach, bWAR by side, Dodgers attributable value, maturity)
        |
NETWORK CONTEXT        038  which documented trainer / academy / showcase associations sit around those players
```

The bundle answers *what was expected*, *what happened*, *which observed paths and contexts co-occur with which outcomes*, and above
all **how much evidence there is** for each answer. It makes no causal claim and produces no predictive score.

## 2. Coverage measured before any schema decision

| Layer | What exists at 035 | Consequence |
|---|---|---|
| Scouting (026) | 51 ACTIVE external evaluations: 48 MLB Pipeline 2013/2014 Top-30 international-class ranks (all non-Dodgers, the 035 benchmark sample), 2 FanGraphs Dodgers org-list evaluations (FV 55 / 50, 2025-12-05), 1 Baseball America Top-100 rank (Sasaki, 2025-01-22) | The only outcome-comparable expectation sample is the 48-player tracker sample (43 audited, 11 reached MLB). Dodgers expectations are all too recent. |
| Development (021-024) | 828 stints (772 team stints) for **167 Dodgers players**, seasons 1992-2026, mostly 2012+ signing classes; developmental arrival per level from 024; no stints for any non-Dodgers player | Pathways are Dodgers-only. Of the mature Dodgers players who reached MLB, only 2 have stint history (most reachers signed before the game-log era), so pathway → MLB-outcome links are thin; intermediate milestones (AA / AAA reach) are the richer signal. |
| Network (029) | 9 entities, **9 ACTIVE relationships for 6 Dodgers players** (2015 / 2017 classes); 62 of the 67-signing primary denominator have no attribution | Any per-entity outcome summary is anecdotal. 038 is a coverage-and-guardrail layer, not a performance ranking. |
| Outcomes (032-035) | 220 Dodgers signings (98 mature, 122 recent) with organizational realization; 48 benchmark signings with outcome tiers; one signing per player (268 / 268) | One outcome spine can serve all three migrations. |
| Cost (030-031) | completeness per signing in `v_signing_acquisition_financials` | Cost totals only over COMPLETE cost; no ROI anywhere in the bundle. |

Decision: the bundle is **derived intelligence over existing canonical facts**. It adds no external data (no new evaluation, stint,
relationship or outcome is researched in 036-038); the research queues of each layer name exactly what data would raise coverage.

## 3. Reused structures (nothing duplicated)

| Existing | Reused by | How |
|---|---|---|
| 020 identity (`players`, stable MLB / Baseball-Reference ids, `v_signing_ages`) | all | player and signing ids, birth date / age |
| 021-024 (`player_season_stints` TEAM_STINT rows, `v_player_development_progression`, `v_dodgers_player_development_summary`, `development_levels`) | 037 | season ladder, developmental arrival (024 decisions respected), existing exact timings reused rather than recomputed |
| 026 (`player_evaluations` ACTIVE + EXTERNAL / TEAM_PUBLIC, rankings, grades, `scouting_publications`, `evaluation_scales`) | 036 | expectation observations; DISI_RESEARCH stays excluded as in every 026 view |
| 029 (`player_network_relationships` ACTIVE, `network_entities`) | 038 | associations with stage, signing link and confidence |
| 030-031 (`v_signing_acquisition_financials`) | 036, 038 | known cost and cost completeness |
| 032-034 (`v_player_organizational_realization`) | 036 spine | direct Dodgers bWAR, non-Dodgers bWAR, attributable organizational bWAR, maturity, outcome state |
| 035 (`v_international_benchmark_player_outcomes`) | 036 spine | benchmark outcome state, original-organization vs elsewhere bWAR, maturity |

The existing queues (`v_scouting_research_queue`, `v_dodgers_development_research_queue`, `v_network_research_queue`,
`v_value_research_queue`, `v_international_benchmark_research_queue`) keep their issues; the new queues add only issues that did
not exist (no PLAYER_WITHOUT_SCOUTING_HISTORY, SEASON_GAP or SIGNING_WITHOUT_NETWORK_ATTRIBUTION duplicates).

## 4. Migration 036 — scouting expectation vs realized outcome

**New table (1):** `scouting_expectation_bands` — reviewed, source-scale-native band definitions (DISI convention, stated as such):

| Family | Publication / measure | Bands |
|---|---|---|
| `MLBP_INTL_CLASS_TOP30_RANK` | MLB Pipeline Top-30 international signing tracker, INTERNATIONAL_CLASS rank (list of 30) | 1-10, 11-20, 21-30 |
| `BA_TOP100_RANK` | Baseball America Top 100, MLB_GLOBAL rank | 1-10, 11-50, 51-100 |
| `FG_ORG_LIST_RANK` | FanGraphs organization lists, ORGANIZATION rank | 1-5, 6-10, 11-30, 31+ |
| `FG_FV_20_80` | FanGraphs OVERALL / FUTURE grade (FV) on SCOUTING_20_80, numeric base | 60+, 55, 50, 45, ≤40 |

A band never crosses publications or scales: there is **no universal expectation number**. Each band stores its expectation
statement, its basis (`SOURCE_SCALE_DEFINITION` for FV roles, `DISI_CONVENTION` for ranks) and the explicit outcome rule used for the
comparison state (MLB reach; a career-bWAR floor where the source defines a role; an "exceeded" floor).

**Views (5, security_invoker, SELECT-only):**

- `v_player_realized_outcome` — **the shared outcome spine**: one row per tracked signing (220 Dodgers + 48 benchmark), unified from
  032-034 and 035 without recomputing anything: outcome state (UNAUDITED is never "no MLB"), reach, maturity, Baseball-Reference
  team-season career bWAR, signing-organization bWAR, elsewhere bWAR, Dodgers attributable organizational bWAR (Dodgers only; NULL,
  not zero, for benchmark rows), years signing → debut season, career-still-accruing flag, cost completeness.
- `v_scouting_expectation_observations` — one row per ACTIVE external expectation measure (each ranking; each FV grade), with its band,
  the age at evaluation, the signing organization, and the evaluation's position relative to the MLB debut
  (`PRE_DEBUT` / `POST_DEBUT` / `ORDER_AMBIGUOUS` / `NO_DEBUT`).
- `v_player_expectation_vs_outcome` — one row per player and band family, anchored on the **earliest pre-debut observation** of that
  family (a frozen historical expectation: later evaluations and any outcome field never change the anchor), plus one row per
  tracked signing with no banded expectation (`INSUFFICIENT_EXPECTATION_DATA`). `comparison_state` ∈ EXPECTATION_EXCEEDED,
  EXPECTATION_MET, EXPECTATION_UNDERPERFORMED, TOO_EARLY, OUTCOME_INCOMPLETE, INSUFFICIENT_EXPECTATION_DATA, with a `state_reason`.
  UNDERPERFORMED requires a mature, audited, settled outcome; an immature or still-active player is TOO_EARLY, never a miss.
- `v_scouting_calibration_summary` — one row per family and band: anchors, comparable outcomes, reach / met / exceeded counts,
  bWAR totals; shares only when at least 10 comparable outcomes exist (`DESCRIPTIVE_SAMPLE`), otherwise `INSUFFICIENT_SAMPLE`; the
  population label states the sample type (a Top-prospect tracker is a rank-selected sample, not a census). Never called accuracy.
- `v_scouting_expectation_research_queue` — high-band misses and low-band surprises worth review, unbanded measures, post-debut
  evaluations excluded from comparison, comparisons blocked by an incomplete outcome, and MLB reachers without any pre-debut expectation.

## 5. Migration 037 — development pathway intelligence

No table. Views (4):

- `v_player_development_season_path` — one row per Dodgers player and observed season (TEAM_STINT rows, affiliated developmental
  levels only): the season's **primary level** (most games; ties to the higher level, so a two-game cameo does not count as a
  promotion), the season's highest level, and the observed transition from the previous observed season (FIRST_SEASON, PROMOTED,
  REPEATED, REGRESSED, RETURNED_AFTER_ABSENCE) with the number of absent seasons. 2020 had no minor-league season and is never an absence.
- `v_player_development_pathway` — one row per Dodgers signing: signing age, pathway, position group, developmental arrival seasons
  (024), years from the professional-debut season to each level (2020 excluded), skipped / repeated / regressed / absence counts,
  longest same-level run, terminal level, activity state, and a **pathway class**:

  | Class | Rule (DISI convention, seasons counted from the professional-debut season, 2020 excluded) |
  |---|---|
  | INSUFFICIENT_HISTORY | no affiliated team-stint history, or a developmental arrival the 024 review left unresolved |
  | NONLINEAR | at least one season whose primary level is below an earlier season's primary level |
  | FAST_TRACK | reached AA within 3 seasons |
  | STANDARD_PROGRESSION | reached AA in 4-5 seasons |
  | SLOW_PROGRESSION | reached AA after 6+ seasons, or active without AA after 6+ seasons |
  | STALLED | not at AA, and the last 3+ observed seasons at the same primary level |
  | EARLY_EXIT | no affiliated record in the two most recent seasons and AA never reached (reason never inferred) |
  | STILL_DEVELOPING | active, AA not reached, fewer than 6 seasons — never a failure label |

  plus `pathway_status` (REACHED_MLB, ACTIVE_AFFILIATED, NO_RECENT_AFFILIATED_RECORD, NO_HISTORY) and the outcome spine columns.
- `v_development_pathway_summary` — pathway class × signing pathway (pathways never blended): players, AA / AAA / MLB reach, median
  years to AA and age at AA, and mature-only outcome counts, with `sample_state` and the fixed wording "Observed players on this
  pathway…" — association only.
- `v_development_pathway_research_queue` — unclassifiable histories, unresolved arrivals that block a class, observed regressions and
  long stalls whose reasons are not sourced (DISI never infers injury, demotion reason or release).

## 6. Migration 038 — trainer / academy / signing network outcomes

No table. Views (4):

- `v_network_player_outcomes` — one row per ACTIVE player-network relationship: entity, relationship type, stage, signing link,
  `attribution_confidence` (an association's evidence strength, not a credit share), the outcome spine, the 036 expectation anchor
  and the 037 pathway class, and cost with its completeness.
- `v_network_outcome_summary` — one row per entity and relationship type: tracked signees, mature, audited, reached MLB, bWAR totals by
  side, cost coverage, pathway-class mix; `denominator_known` is always false (no entity's full trainee population is held),
  `network_sample_state` ANECDOTAL (< 3 mature audited signees) / SMALL_SAMPLE (< 10) / DESCRIPTIVE_SAMPLE — never a census; no rank,
  no ratio, no ROI, no ordering by value.
- `v_network_outcome_coverage` — KNOWN_NETWORK_SAMPLE vs UNATTRIBUTED_SIGNINGS for the Dodgers signings (all, by signing era, by
  pathway), with outcome counts and the fixed label `DESCRIPTIVE_ONLY_SELECTION_BIASED`: documented relationships exist mostly for
  notable prospects, so the two segments are not comparable.
- `v_network_outcome_research_queue` — network signees whose outcome or cost is incomplete, relationships without a signing link that
  therefore cannot support signing-level context, and entities below the anecdotal threshold.

## 7. Semantic guardrails (enforced by views and verifier checks)

1. Missing ≠ zero: every bWAR side is NULL without loaded facts; UNAUDITED keeps a NULL reach flag.
2. Unaudited ≠ failure; immature or still active ≠ miss (TOO_EARLY / STILL_DEVELOPING).
3. Historical expectations are frozen: anchors use only evaluation rows dated before the debut; no view writes or rescales a grade.
4. Career outcome ≠ Dodgers organizational value: separate columns, attributable value Dodgers-only.
5. Pathways stay distinct: summaries group by the signing pathway value; professional signings are never classified on the
   amateur ladder.
6. bWAR is primary; fWAR is not read by any 036-038 view.
7. Samples stay labelled samples; no organization-wide or entity-wide rate without a complete denominator.
8. Cost metrics only over COMPLETE cost; no ROI ranking.
9. No causal wording, no leaderboard ordering by value, no predictive score.
10. Security: every new view `security_invoker`, the new table has RLS with a public-read policy, anon / authenticated SELECT only.

## 8. Verification plan

Per migration: a focused test file (`tests/db/expectation-036.test.mjs`, `pathway-037.test.mjs`, `network-038.test.mjs`) on a
001-03x replay, a verifier module (`scripts/db/lib/expectation-invariants.mjs`, `pathway-invariants.mjs`, `network-outcome-invariants.mjs`)
whose checks count violations, idempotency (second application changes nothing), the deterministic builder, lint and typecheck.
Bundle checkpoint once through 038: full DB suite, verifier, fresh replay, convergence, idempotency, security, frozen history.

## 9. Decision

IMPLEMENT 036 (1 table, 5 views), 037 (4 views), 038 (4 views) as one bundle. DEFER: new evaluation research (e.g. the 11 unsourced
legacy ranks), non-Dodgers development histories, network relationship expansion, any predictive model or causal analysis.
