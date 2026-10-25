# Migration 055: the international benchmark deepened with the mature 2017 and 2018 classes

055 applies the 050 method, unchanged, to the next two MLB Pipeline international Top 30 lists. Both classes have completed the 7-season reach
horizon (2024, 2025), so their resolved players label `REACH_MLB_WITHIN_7_SEASONS` now; their 10-season horizons (2027, 2028) are still open, so
every 10-season label stays censored. Design: [`architecture.md`](architecture.md); every decision and its evidence: [`research-notes.md`](research-notes.md).

```
RANKING APPEARANCE != NEW SIGNING      SOURCE LIST MEMBERSHIP != VERIFIED SIGNING      NO MLB DEBUT != NEGATIVE OUTCOME
UNKNOWN BWAR != ZERO BWAR              RANKED PROSPECT SAMPLE != LEAGUE CENSUS         BENCHMARK SUPPORT != DODGERS SUPPORT
```

## Files

| File | Role |
|---|---|
| `derive-research.mjs` | reads the archived official MLB Pipeline feed, the official MLB transaction log and person records, the Chadwick register and (Cuban route only) Wikipedia; writes the three research files below. Uses the 050 identity rules (`../050/identity-rules.mjs`) unchanged. Network reads are cached, so a rerun is byte-identical |
| `source-cohorts.json` | the two official lists exactly as published (rank, name, position, slug), capture URLs, timestamps, SHA-256 and Internet Archive digests, the club revision and (2018) the corroborating pre-signing capture |
| `identity-research.json` | one decision per list member: `RESOLVED` / `CONFLICT` / `INSUFFICIENT_EVIDENCE`, with every signal and every candidate considered |
| `outcome-research.json` | the MLB outcome facts of every resolved player at the unchanged 2026-10-05 boundary, and a recorded death |
| `cohort-decisions.json` | written by `build.mjs`: what happened to each of the 60 list members |
| `baseline.json` | the pre-055 state (`measure.mjs --chain 054a_... --baseline`), proved by the migration before it writes |
| `measure.mjs` | the 050 measurement plus labels per Top-prospect population |
| `evaluate.mjs` | the 041 evaluation re-run on the 055 data (the 050 script, chain and paths changed) -> `evaluation.json` |
| `report.mjs` | measures before and after 055 on one database -> `support-before-after.json` and `source-audit.json` (the per-class audit) |
| `055_template.sql`, `rollback_template.sql`, `build.mjs` | the guarded migration and rollback templates and their deterministic assembly |

```
node database/research/055/derive-research.mjs --raw <captures> --register <chadwick-register> --cache <api-cache>
node database/research/055/measure.mjs --chain 054a_development_queue_performance.sql --baseline
node database/research/055/evaluate.mjs && node database/research/055/build.mjs && node database/research/055/report.mjs
```

The archived captures, the register files and the API cache are not committed. Their URLs, timestamps, SHA-256 and digests are, together with
every fact the migration writes, so each canonical write can be audited against its source.

## Result (analysis boundary 2026-10-05, last complete season 2026)

| | 2017 list | 2018 list |
|---|---|---|
| Listed (official feed, pre-signing) | 30 (updated 2017-05-25) | 30 (updated 2018-05-23; identical capture 2018-06-16) |
| Benchmark signings added | 28 | 22 |
| Listed Dodgers signings mapped, untouched | 0 | 2 (Cartaya, stored rank 1; Rosario, stored rank NULL) |
| Verified, not added | 1 (Daniel Flores: died 2017-11-08, before his outcome window) | 3 Cuban signees whose route no readable source states |
| Identity unresolved, for a person | 1 (Wildred Patino) | 3 (Antonio Gomez, Alvin Guzman, Eduarqi Fernandez) |
| Reached MLB by 2026-10-05 | 6 | 6 |
| Reach within 7 seasons | 5 TRUE, 23 FALSE | 6 TRUE, 16 FALSE |
| 10-season targets | 28 censored | 22 censored |

Benchmark players 102 -> 152. In the Top-prospect sample `REACH_MLB_WITHIN_7_SEASONS` goes from 90 labelled (19 / 71) to **140 (30 / 110)**,
`BASELINE_SUPPORTED` before and after; the bWAR targets do not move (75 labelled). The Dodgers population is unchanged on every target, and no
probability, expected value or recommendation exists. The re-run evaluation (148 rows, 30 positives, 7 folds) is current and supports no model:
the population-stratified rate has no skill over the base rate (-0.007), and the L2 logistic model, though its out-of-time Brier skill is
positive (0.035), has 30 positives where its six features need 60.
