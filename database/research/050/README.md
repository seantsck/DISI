# Migration 050: mature international benchmark expansion and probability-support audit

050 extends the MLB Pipeline international Top 30 benchmark of 035 to the mature 2015 and 2016 classes, resolves what it can of the five
benchmark identities 035 left open, re-runs the stored 041 evaluation on the new data, and fixes the one place where a benchmark baseline would
have been reported as Dodgers forecasting. Design and reasoning: [`architecture.md`](architecture.md); every decision and its evidence:
[`research-notes.md`](research-notes.md).

```
RANKING APPEARANCE != NEW SIGNING          RANKING CLASS YEAR != SIGNING YEAR      SOURCE LIST MEMBERSHIP != VERIFIED SIGNING
NOT_AUDITED != AUDITED_NO_MLB              NO MLB DEBUT FOUND != CAREER ENDED       UNKNOWN BWAR != ZERO BWAR      MLB REACH != POSITIVE BWAR
RANKED PROSPECT SAMPLE != LEAGUE CENSUS    BENCHMARK SUPPORT != DODGERS SUPPORT
```

## Files

| File | Role |
|---|---|
| `derive-research.mjs` | reads the archived official MLB Pipeline feed, the official MLB transaction log and person records, the Chadwick register and (Cuban route only) Wikipedia; writes the three research files below. Network reads are cached, so a rerun is byte-identical |
| `identity-rules.mjs` | the identity, signing and route rules as pure functions (unit-tested) |
| `source-cohorts.json` | the two official lists exactly as published (rank, name, position, list club), capture URLs, timestamps, SHA-256, and the later revisions recorded beside them |
| `identity-research.json` | one decision per list member and per legacy identity: `RESOLVED` / `CONFLICT` / `INSUFFICIENT_EVIDENCE`, with every signal used |
| `outcome-research.json` | the MLB outcome facts of every resolved player at the unchanged 2026-10-05 boundary |
| `cohort-decisions.json` | written by `build.mjs`: what happened to each of the 60 list members and the five legacy identities |
| `baseline.json` | the pre-050 state (`measure.mjs --baseline`), proved by the migration before it writes |
| `measure.mjs` | measures a database (PGlite replay or PostgreSQL, read-only) |
| `evaluate.mjs` | the 041 evaluation re-run on the 050 data -> `evaluation.json` |
| `support-before-after.json` | written by `report.mjs` from two measurements: support per target and population, evaluation, probabilities, executive, release, expected value, benchmark classes and queue |
| `050_template.sql`, `rollback_template.sql`, `build.mjs` | the guarded migration and rollback templates and their deterministic assembly |

```
node database/research/050/derive-research.mjs --raw <captures> --register <chadwick-register> --cache <api-cache>
node database/research/050/measure.mjs --dump <post-049 replay> --baseline
node database/research/050/evaluate.mjs [--dump <post-049 replay>] && node database/research/050/build.mjs
node database/research/050/measure.mjs --dump <post-050 replay> > after.json && node database/research/050/report.mjs database/research/050/baseline.json after.json
```

The archived captures, the register files and the API cache are not committed. Their URLs, timestamps and SHA-256 are, together with every fact
the migration writes, so each canonical write can be audited against its source.

## Result (analysis boundary 2026-10-05, last complete season 2026)

| | 2015 list | 2016 list |
|---|---|---|
| Listed (official feed) | 30 (pre-signing, updated 2015-05-11) | 30 (signing period, updated 2017-05-27) |
| Verified non-Dodgers benchmark signings added | 27 | 27 |
| Listed Dodgers signings mapped to the existing row | 2 (Heredia, Brito) | 0 |
| Not added | 1 identity unresolved (Christopher Martinez) | 3 Cuban signees whose route no readable source states (Armenteros, Yanio Pérez, Machado) |
| Signing years | 2015: 27 | 2016: 26, 2017: 1 (Luis Robert Jr.) |
| Professional route (prior Cuban National Series play) | 0 | 9 |
| Reached MLB by 2026-10-05 | 10 | 12 |

Legacy identities: Emmanuel DeJesus resolved (MLB 646241, reached MLB 2023-09-09), Micker Zapata resolved (MLB 650520, "Micker Adolfo", no MLB
debut); Yeyson Yrizarry a `CONFLICT` (the only matching signing is born in Venezuela, the tracker row records the Dominican Republic); Yeremy
Rosario and Jonathan Amundaray `INSUFFICIENT_EVIDENCE` (no official signing record). Benchmark players 48 -> 102, identity-resolved 43 -> 99.

| Target, benchmark sample | Before | After |
|---|---|---|
| `REACH_MLB_WITHIN_7_SEASONS` | 43 labelled, 6 / 37, not supported | **90 labelled, 19 / 71, BASELINE_SUPPORTED** (0.211, 90% 0.149-0.290) |
| `POSITIVE_BWAR_WITHIN_10_SEASONS` | 43, 7 / 36 | 75, 7 / 68, not supported (18 unlabelled: 15 reachers without loaded WAR, 3 unresolved identities) |
| `BWAR_2_WITHIN_10_SEASONS` | 43, 3 / 40 | 75, 3 / 72, not supported |

The Dodgers population is unchanged on every target. Benchmark support is not Dodgers support: no probability is published, the executive
overview reports 0 supported probability targets, and expected value and recommendations stay unsupported. The re-run evaluation (101 rows, 19
positives, 6 folds) is current; no fitted model beats the base rate (Brier skill -0.015 and -0.037).
