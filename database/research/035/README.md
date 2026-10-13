# Migration 035 — international benchmark outcomes

Bounded first step of league-wide international benchmarking. See `architecture-report.md` for the full reasoning.

| File | Role |
|---|---|
| `derive-outcomes.mjs` | read-only: benchmark roster from the DB, MLB Stats API person + career record per player -> `benchmark-outcomes.json` |
| `derive-war.mjs` | Baseball-Reference team-season bWAR for the benchmark players who reached MLB -> `war-seed.json` |
| `scope-config.json` | data-file checksums and the audit boundary (2026-10-05, unchanged) |
| `audit.mjs` | replays 001-034 in PGlite, checks roster/identity/coverage -> `audit-report.json` |
| `035_template.sql`, `views.sql` | hand-written migration template and the three views |
| `build.mjs` | assembles `database/sql/035_international_benchmark_outcomes.sql` (deterministic) |

```
node database/research/035/audit.mjs && node database/research/035/build.mjs
```

Adds no table. Adds 43 outcome audits (11 reached), 11 outcomes, 59 team-season rows and three views. It makes no census claim,
computes no organizational rate and ranks nothing.

## Status (2026-10-13)

- **Branch / release.** `wip/disi-migration-035` (pushed to `origin`, no PR), based on `1edf314`, the head of the 034 release PR #6
  (draft, unmerged). **Not applied to any hosted database.** 034 is frozen and unchanged (SHA-1 `3cb5494f13800a4d44e2ffb6aa6bd1ff88aae5f5`,
  `tests/db/frozen-migrations.json`).
- **Verification.** `tests/db/benchmark-035.test.mjs` 16/16; full suite 397/397 at `--test-concurrency=1`; lint, typecheck and
  `next build` clean (PGlite). Independently on real PostgreSQL 17.9 (`database/release/pg17/run.sh`): 21/21 checks, 035 verifier
  186/186, rerun no-op, fresh 001-035 replay converges with 001-034 + 035.
- **Reproducibility.** `build.mjs` reproduces the committed SQL byte-for-byte (tested); no external source was re-fetched (same bWAR
  files and checksums as 032 - 034, see `scope-config.json`).
- **Before release.** 034 must be released first; then rebase, re-test and apply as in `database/release/034-release-checklist.md`
  section 7 (a simulated merge of PR #6 + rebase is conflict-free).
