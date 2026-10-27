# Migration 056: the international benchmark deepened with the mature 2019 class

056 applies the 050 / 055 method, unchanged, to the 2019 MLB Pipeline international Top 30. A 2019 signing's 7-season reach horizon ends with
the 2026 season, the last complete season at the 2026-10-05 boundary, so its resolved players label `REACH_MLB_WITHIN_7_SEASONS` now; the
10-season horizon (2029) is open, so every 10-season label stays censored. Design: [`architecture.md`](architecture.md); every decision and its
evidence: [`research-notes.md`](research-notes.md).

```
RANKING APPEARANCE != NEW SIGNING      SOURCE LIST MEMBERSHIP != VERIFIED SIGNING      UNKNOWN BWAR != ZERO BWAR
RANKED PROSPECT SAMPLE != LEAGUE CENSUS                                                BENCHMARK SUPPORT != DODGERS SUPPORT
```

## Files

| File | Role |
|---|---|
| `derive-research.mjs` | the 055 derivation with the 2019 captures and window: reads the archived official MLB Pipeline feed (gzip-encoded captures decoded), the official MLB transaction log and person records and the Chadwick register; compares every later edition with the cohort; uses the 050 identity rules (`../050/identity-rules.mjs`) unchanged; cached network reads |
| `source-cohorts.json` | the official list exactly as published (rank, name, position, slug), the capture URLs, timestamps, SHA-256 and Internet Archive digests, the club revision, and the five later editions compared (the 2020-02-13 re-ranking classified `RE_RANKED_EDITION_NOT_USED`) |
| `identity-research.json`, `outcome-research.json` | one identity decision per member with every candidate considered; the outcome facts at the unchanged 2026-10-05 boundary |
| `cohort-decisions.json` | written by `build.mjs`: what happened to each of the 30 members |
| `baseline.json` | the pre-056 state (`measure.mjs --chain 055_... --baseline`), proved by the migration before it writes |
| `measure.mjs` | the 055 measurement, re-exported |
| `evaluate.mjs` | the 041 evaluation re-run on the 056 data (the 050 script, chain and paths changed) -> `evaluation.json` |
| `report.mjs` | before / after on one database -> `support-before-after.json` and `source-audit.json` |
| `056_template.sql`, `rollback_template.sql`, `build.mjs` | the guarded migration and rollback templates (the 055 ones, re-targeted) and their deterministic assembly |

```
node database/research/056/derive-research.mjs --raw <captures> --register <chadwick-register> --cache <api-cache>
node database/research/056/measure.mjs --chain 055_international_benchmark_2017_2018.sql --baseline
node database/research/056/evaluate.mjs && node database/research/056/build.mjs && node database/research/056/report.mjs
```

## Result (analysis boundary 2026-10-05, last complete season 2026)

| | 2019 list |
|---|---|
| Listed (official feed, pre-signing, updated 2019-06-30) | 30 |
| Identities resolved | 27 |
| Benchmark signings added | 26 |
| Listed Dodgers signing mapped, untouched | 1 (Luis Rodriguez #4, stored rank 4) |
| Identity unresolved, for a person | 3 (Robert Puason, Yiddi Cappe, Enmanuel Rodriguez) |
| Reach within 7 seasons | 4 TRUE (Domínguez 2023, Amador 2024, Lara 2025, Acosta 2025), 22 FALSE, 0 censored |
| 10-season targets | 26 censored (horizon 2029) |

Benchmark players 152 -> 178. Top-prospect `REACH_MLB_WITHIN_7_SEASONS`: 140 (30 / 110) -> **166 (34 / 132)**, supported before and after. The
Dodgers population is unchanged; no probability, expected value or recommendation exists. The re-run evaluation (173 rows, 34 positives, 7 folds)
supports no model: the logistic model's out-of-time skill is +0.018 with 34 of the 60 events six features need; the population-stratified rate
has no skill (-0.0065).
