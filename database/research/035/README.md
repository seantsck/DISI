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

- **Released.** 035 was applied to the hosted DISI Supabase database on 2026-10-13 (08:58:57 UTC) from the committed file:
  SHA-256 `b21dd65d744d63d92cb2649b5dc170d5ada8f35f9be495c6a404a90a44cf15f5`, one transaction. The hosted database held exactly the
  frozen 034 before, which is unchanged (SHA-1 `3cb5494f13800a4d44e2ffb6aa6bd1ff88aae5f5`).
- **Hosted verification (complete).** The live verifier passed 186/186 hard invariants. Security checks are green (RLS on every table,
  every view security-invoker, API roles SELECT-only). A second application was a no-op. The hosted state converges with a fresh
  001-035 replay for every object 035 touches. A restore-verified backup was taken before the apply.
- **Git and app.** The rebased branch merged to `main` through PR #7 (merge commit `32b7552`), and the Vercel production deployment
  completed. The `/research` page then hit the 3 s anon statement timeout under its 15 concurrent queries. That was an application
  problem, not a 035 one, and it is fixed separately by the research-page timeout hotfix PR.
- **Local verification.** `tests/db/benchmark-035.test.mjs` 16/16; full suite 397/397 at `--test-concurrency=1`; real PostgreSQL 17.9
  (`database/release/pg17/run.sh`) 21/21.
- **Reproducibility.** `build.mjs` reproduces the committed SQL byte-for-byte; no external source was re-fetched (same bWAR files and
  checksums as 032 - 034, see `scope-config.json`).
