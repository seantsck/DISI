# DISI 050 release plan: international benchmark expansion and probability-support audit

A reviewed research-data migration plus one demonstrated definition fix (one statement in each of two existing functions), the population-aware
verifier and readiness rules, and the League Benchmark / Prediction Readiness wording. **Not applied to production.** Applying it, merging the PR and
any deploy need explicit owner approval.

## What changes

| | Before (frozen 049) | After |
|---|---|---|
| Schema (tables / views / functions / grants / policies / triggers) | 78 / 155 / 73 | unchanged; two function bodies change by one statement each (below) |
| Players / benchmark players (`v_database_status`) | 268 / 48 | 322 / 102 |
| Benchmark signings (`MLB_PIPELINE_TOP_PROSPECT`) | 48 | 102 (+27 from the 2015 list, +27 from the 2016 list) |
| Benchmark identities resolved | 43 of 48 | 99 of 102 (2 of the 5 legacy gaps resolved; 1 conflict and 2 without an official record stay unresolved) |
| `TOP_PROSPECT_SAMPLE` populations / coverage rows | 2 / 2 | 4 / 4 (2015 and 2016, `expected_size` 30, samples, never censuses) |
| Outcome audits / outcomes | 136 / 58 | 192 / 81 (benchmark only; Dodgers 93 audits unchanged) |
| Evaluations (026) | 51 | 105 (one MLB Pipeline international ranking per new benchmark signing) |
| Baseball-Reference team-season WAR rows | 1880 | 1880 (none loaded: the files answer 403; 23 reachers keep NULL bWAR labels) |
| Dodgers signings / audits / verified MLB / no MLB / NOT_AUDITED | 220 / 93 / 47 / 46 / 127 | unchanged, byte-identical |
| Known costs / spend / open research tasks | 56 / $121,700,237.33 / 349 | unchanged |
| Transactions / development | 213 events, 396 assets / 1859 stints, 1073 milestones | unchanged, byte-identical |
| `REACH_MLB_WITHIN_7_SEASONS`, benchmark | 43 labelled (6 / 37), not supported | **90 labelled (19 / 71), BASELINE_SUPPORTED**: 0.2111 (90% 0.1493-0.2898), a reference result for that sample only |
| `POSITIVE_BWAR_WITHIN_10_SEASONS`, benchmark | 43 (7 / 36) | 75 (7 / 68), not supported |
| `BWAR_2_WITHIN_10_SEASONS`, benchmark | 43 (3 / 40) | 75 (3 / 72), not supported |
| Every Dodgers target | not supported | unchanged |
| Stored 041 evaluation | fingerprint `683251fe...`, 59 rows, 8 positives, current | re-run: fingerprint `af9ec05f...`, 101 rows, 19 positives, 6 folds, current; still no fitted model supported |
| Probabilities / supported Dodgers targets / expected values / recommendations | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Verifier | 247 checks | 248 (+ `outcome_population_isolation_violations`) |
| Product snapshot generation | n | n + 1 (one refresh, run by the migration only because rows changed) |

## Files

| File | bytes | sha256 |
|---|---|---|
| `database/sql/050_international_benchmark_support_expansion.sql` | 253626 | `7251a2d326e6a78e713a1124b79b812ef9e38615f6af14b9a15c7a560455e82e` |
| `database/release/sql/rollback-050.sql` | 36787 | `49dc902c17baadea9489b53e1a844e01ed0e159f2d27ff60dfe2c8580de35b2a` |

## The definition fix (BENCHMARK SUPPORT != DODGERS SUPPORT)

`v_player_outcome_probability` shows a probability only for the Dodgers tracked / opening-class population. `disi_executive_overview()` (044)
counted a target as a supported probability target when any reference population supported it, and `disi_refresh_product_snapshots()` (045b)
validated each generation against that same pooled count. With the benchmark reach target supported, the overview would have reported one
supported target and "probabilities published" while no probability exists. 050 replaces the one counting statement of each function; the
migration refuses to run unless each live body is exactly the 044 / 045b one (md5) and proves the reviewed body after. Signatures, grants,
`security invoker`, volatility and every other statement are unchanged. On any pre-050 database the two counts are equal, so nothing published
moves except through 050's own data.

## Order

1. Back up (`pg_dump`, restore-verified on PostgreSQL 17, candidate verifier 248/248 on the restored copy).
2. Apply `050_international_benchmark_support_expansion.sql` through the safe runner (SHA-checked). One transaction; about 12 s on PGlite plus the refresh.
3. Verify: live verifier 248/248, drift 0, one generation, the counts above, fingerprints (only the two function bodies differ).
4. Merge the PR (normal merge commit); one Vercel production deploy. The new application reads only relations in the product contract
   (`v_signing_records`, `v_signing_data_coverage`, `product_prediction_readiness`) and works against the pre-050 database too.
5. Smoke (authenticated): `/league` (the per-list sample table, label coverage, "rank-selected sample"), `/prediction-readiness` (benchmark baseline
   shown apart from the Dodgers targets; 0 supported Dodgers targets), `/` (no probability claimed), a new benchmark dossier, a Dodgers dossier.

Do not re-apply 050 in production to test idempotency (proven on PGlite and PostgreSQL 17). If step 2 fails nothing is committed.

## Expected verifier results

- Against production **before** applying 050: the candidate verifier is **243/248**. The five pinned counts 050 moves (`players_total`,
  `league_benchmark_players`, `player_evaluations`, `scouting_legacy_ranks_total`, `scouting_legacy_ranks_backfilled`) fail by design; every
  other check, including the new isolation check, passes.
- **After** applying: **248/248**, drift 0, one generation across the eleven snapshots.

## Rollback

`rollback-050.sql` (one transaction, guarded) refuses if later research depends on a 050 benchmark player, removes exactly what 050 added
(players, signings, members, coverage rows, populations, audits, outcomes, evidence and the 050 rankings; the 026 guard seals ACTIVE rankings, so
the two evaluation guard triggers are disabled inside this transaction only and re-enabled before commit, which the rollback proves), returns the
two legacy identities to unresolved, restores the 041 evaluation rows exactly and the 044 / 045b function definitions, and refreshes once. Every
research table returns to its pre-050 content (the two legacy player rows differ only in their trigger-stamped `updated_at`); sources stay as
provenance; **050 can be applied again after its rollback**.

## Evidence

`database/research/050/`: `source-cohorts.json`, `identity-research.json`, `outcome-research.json`, `cohort-decisions.json`, `baseline.json`,
`evaluation.json`, `support-before-after.json`, `research-notes.md`, `architecture.md`, `README.md`. Independent validation:
`database/release/pg17/run-050.sh`.
