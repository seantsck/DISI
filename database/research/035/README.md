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

- **Branch / release.** Lives on `wip/disi-migration-035`, stacked on 034 (draft PR #6, unmerged). Not pushed, no 035 PR, **not applied to live Supabase**; 034 is frozen and unchanged (sha1 in `tests/db/frozen-migrations.json`).
- **Verification.** `tests/db/benchmark-035.test.mjs` 16/16; full suite 397/397 at `--test-concurrency=1`; lint, typecheck and `next build` clean. Local PGlite only.
- **Reproducibility.** `build.mjs` reproduces the committed SQL byte-for-byte (tested); no external source was re-fetched (same bWAR files and checksums as 032 - 034, see `scope-config.json`).
- **Before release.** Merge 034 first, rebase 035, review the diff, then apply to a Supabase branch / staging database before production.
