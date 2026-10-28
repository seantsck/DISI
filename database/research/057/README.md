# 057 — benchmark bWAR evidence

Baseball-Reference team-season bWAR for the eleven mature benchmark MLB reachers whose `POSITIVE_BWAR_WITHIN_10_SEASONS` label was NULL only
because their WAR was not loaded. The rows come from archived copies of the two data files DISI already cites. This is evidence recovery
plus the support transition that evidence causes. Thresholds are unchanged, and no fitted model becomes supported.

## Files

| File | What it is |
|---|---|
| `source-capture.json` | The two Internet Archive captures. Each records the original URL, Wayback timestamp, capture time, original Last-Modified, CDX digest, payload SHA-256, decoded SHA-256, row count and last season. Also the observed-through rule (2025). |
| `fetch-sources.mjs` | Retrieves the captures with `--fetch` (raw `id_` mode) into `research-output/057-work/raw/`, which is gitignored, and verifies every recorded hash and statistic. |
| `scope.json` | The eleven approved players, the four deferred 2016-class reachers, the three unresolved identities and the transaction-value follow-up, each with its reason. |
| `derive-war.mjs` | Builds `war-evidence.json` from the verified captures: the 032 / 035 row shape, seasons up to 2025 only, the excluded 2026 rows listed, and per-player window sums and labels. |
| `war-evidence.json` | The 54 rows (positional, as in 035), per-player sums and labels, and the 8 excluded mid-season 2026 rows. |
| `measure.mjs` | The 056 measurement, plus WAR rows, scoped bWAR labels, research queues and readiness. With `--baseline` it writes `baseline.json`. |
| `baseline.json` | The pre-057 state (canonical chain through 056) that the migration proves before it writes. |
| `evaluate.mjs` | The unchanged 041 out-of-time evaluation for the two bWAR targets on the 057 data. It also reproduces the stored reach rows. Output is `evaluation.json`. |
| `057_template.sql`, `rollback_template.sql`, `build.mjs` | The migration, the rollback and their deterministic assembly. |
| `report.mjs` | The before/after record, written to `support-before-after.json`. |
| `research-notes.md` | Decisions that need a person, and findings. |

## Commands

```
node database/research/057/fetch-sources.mjs --fetch          # or without --fetch: verify the local raw files
node database/research/057/derive-war.mjs
node database/research/057/measure.mjs --chain 056_international_benchmark_2019.sql --baseline > /dev/null
node database/research/057/evaluate.mjs && node database/research/057/build.mjs
node database/research/057/report.mjs
```

`evaluate.mjs` and `report.mjs` accept `--dump <post-056 PGlite tar>` to skip the two-minute chain build.

## Result

- **Sources:** 2 sources and 54 team-season rows (53 batting, 1 pitching) for eleven players.
  - Multi-team seasons are kept as their stints: Soto 2022 WSN/SDP, Taveras 2025 TEX/SEA, Pache 2024 PHI/BAL/MIA. The files have no TOT row.
- **Labels:** `outcomes.career_war` is set for the eleven and equals the sum of their rows.
  - `POSITIVE_BWAR_WITHIN_10_SEASONS`: 8 TRUE, 3 FALSE.
  - `BWAR_2_WITHIN_10_SEASONS`: 6 TRUE, 5 FALSE.
- **Benchmark support (`TOP_PROSPECT_SAMPLE`):**
  - Positive bWAR goes from 75 / 7 / 68 to 86 / 15 / 71 and is now **BASELINE_SUPPORTED**. The reference baseline is 0.174 (90% 0.117-0.251).
  - 2+ bWAR goes to 86 / 9 / 77 and is still not supported: it is one positive short.
- **Evaluation stored:** 88 pooled rows, 4 folds, 14 and 9 positives. No fitted model is supported.
  - Stratified rate: skill -0.014 (NO_SKILL_OVER_BASELINE).
  - Logistic: INSUFFICIENT_EVENTS (14 < 60).
- **Unchanged:**
  - Dodgers support, the reach target and its evaluation (173 / 34 / 7 folds, `86b58f47…`).
  - Probabilities, expected values and recommendations stay at 0.
- **Snapshots and verifier:** one snapshot refresh; 259/259 checks, with no pin moved.
