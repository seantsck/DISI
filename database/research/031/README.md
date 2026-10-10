# Migration 031: financial provenance and coverage expansion

`database/sql/031_financial_provenance_coverage_expansion.sql` is generated from this folder:

```
node database/research/031/audit.mjs     # replays 001-030 in memory, checks every guard input -> audit-report.json
node database/research/031/build.mjs     # template + view + seed -> the migration (deterministic)
node database/research/031/test-031.mjs  # local harness: applies 031 twice on 001-030, writes financial-coverage.json
```

| File | Purpose |
|---|---|
| `seed-evidence.json` | Reviewed, directly read facts: sources, signing reports (UPGRADE / NEW / CORRECTION), environments, environment reports, link windows and the deferred items |
| `031_template.sql` | Hand-written schema, guards, steps, postconditions (`{{payload_json}}` and `{{view_signing_financials}}` placeholders) |
| `view-signing-acquisition-financials.sql` | The 030 view with reviewed resolutions applied (columns of 030 unchanged, `resolved_components` appended) |
| `build.mjs` | Validates the seed (basis / precision, deferrals not seeded, no derived pool, the penalty memo) and writes the migration |
| `audit.mjs` / `audit-report.json` | Pre-031 facts the guards depend on, link-window membership, legacy WAR view definition hashes |
| `test-031.mjs` / `financial-coverage.json` | Harness and the resulting research-progress counts (regenerated, never hand-edited) |
| `schema-design.md` | The resolution model, lineage rules, period-membership linking |
| `source-audit.md` / `.json` | What was read, how, and what each source supports |
| `research-backlog.md` | Deferred conflicts and unreadable items |
| `legacy-view-effects.md` | Which existing outputs change because the data changed (definitions are untouched) |

## What 031 establishes

- **Pool capacity** for the Dodgers 2012-13, 2013-14, 2014-15, 2017-18 and 2020-21 periods, with externally sourced `BASE_POOL` reports. POOL_CAPACITY_UNKNOWN: 5 -> 0. These are denominators only; no period gains true utilization.
- **2021-22 pool ($4,644,000)** is the sourced post-penalty allocation. The $500,000 Bauer penalty is a memo (`PENALTY_REDUCTION`) and is never subtracted again; no pre-penalty base is stored.
- **13 same-amount provenance upgrades** (the legacy carry-forward stays ACTIVE as corroboration) and **4 newly sourced bonuses** (Soto, Medina, Sanchez, Luna). Bonuses: 93 known, 24 externally sourced, 69 legacy-only.
- **One correction:** Carlos Rincon's unsourced legacy $350,000 is superseded by the directly read $325,000 (a supersession, not a resolution).
- **`signing_financial_resolutions`:** a reviewed decision selecting one of several competing ACTIVE reports. No decision is recorded in 031: Sasaki stays unresolved and Rosario and Torres are deferred.
- **Environment links** by supported period membership (the signing date lies in the window): 33 dated signings; pathway does not decide, treatment is untouched.

The legacy WAR-per-dollar view definitions are untouched. The app is unchanged.
