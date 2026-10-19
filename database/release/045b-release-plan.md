# DISI 045b release plan: home-page status snapshot

Post-v1.0.0 performance hardening. **Not applied to production.** Applying it, merging the PR and any deploy need explicit owner approval.

## What changes

| | Before (v1.0.0) | After (045b) |
|---|---|---|
| Home page status read | `v_database_status` (25 scalar subqueries over the signing / class / task view stacks), evaluated on every request | `product_database_status` (one persisted row) |
| `v_database_status` | public | internal (definition unchanged; no anon / authenticated access) |
| Tables / views / internal functions | 77 / 155 / 8 | **78** / 155 / 8 |
| Product contract | 47 relations | 47 relations (the view is swapped for the snapshot) |
| Snapshots per generation | 10 | 11, one transaction, one generation |

No metric, research datum, threshold or prediction changes. The release status is not touched.

## Files

| File | bytes | sha256 |
|---|---|---|
| `database/sql/045b_database_status_snapshot.sql` | 28192 | `a41afa5f560f130027e01e537fe3edf595f09c78b653bacc3cba7a0c3a7fc159` |
| `database/release/sql/rollback-045b.sql` | | `7f02af795f12547f4cf80b08ce7128ac22691a61797f1b3523301da4a060a0f3` |
| `database/release/sql/rollback-042-045.sql` (now also drops the status snapshot and restores the grant) | | `ca7ca0d456ff870d21552cc468f3770434c76e13531fb5a2e9af42c553c839d5` |

## Order

1. Back up (`pg_dump`, restore-verified), as for the previous releases.
2. Apply `045b_database_status_snapshot.sql` through the safe runner (SHA-checked). It creates the table, re-issues the refresh / drift functions, swaps the contract row, revokes the view, and runs **one** refresh (generation + 1) because the new snapshot is empty. Expect about 20 s (the 045a first generation took 20.5 s).
3. Verify: the live verifier (247/247), drift 0, the firewall, then the anon snapshot gate.
4. Merge the PR (normal merge commit); one Vercel production deploy. Between steps 2 and 4 the *old* application's home-page status block shows "Data unavailable" (the rest of the page keeps working). Apply and merge close together.
5. Smoke the routes (Vercel SSO: needs an authenticated browser) and check runtime errors.

Do not re-apply 045b in production to test idempotency (proven on PostgreSQL 17 / PGlite).

## Expected verifier results

- Before applying, against production (77 tables): **246/247**; the only failure is `public_tables_total` (expects 78). Same convention as the previous releases.
- After applying: **247/247**, snapshot drift 0, generation consistent across 11 tables.

## Evidence (disposable PostgreSQL 17 limited to 1 GB with the production memory settings; anon, 3 s timeout; each visitor runs the five home-page reads 10 times)

| Visitors | Reads | status read, before | status read, after | page (5 reads) median, before / after | non-reclaimable peak, before / after | errors / timeouts / restarts |
|---|---|---|---|---|---|---|
| 1 | 50 | 56.5 ms median, 81 max | 0.7 ms, 1.7 max | 75 / 22 ms | 226 / 181 MB | 0 / 0 / 0 |
| 4 | 200 | 56 ms, 114 max | 0.4 ms, 2.4 max | 75 / 17 ms | 389 / 216 MB | 0 / 0 / 0 |
| 8 | 400 | 96 ms, 255 max | 0.5 ms, 5.2 max | 127 / 35 ms | 587 / 263 MB | 0 / 0 / 0 |
| 16 | 800 | 211 ms, 412 max | 1.8 ms, 23 max | 281 / 68 ms | **994** / 355 MB | 0 / 0 / 0 |

On the 1 GB instance the legacy status read drove non-reclaimable memory to 994 MB of 1024 MB at 16 concurrent visitors; the snapshot read keeps it at 355 MB. The remaining home reads (signings, known MLB, rate summary) are unchanged and are the next candidates (rate summary: 34 ms median, 73 max at 16 visitors).

## Rollback

`rollback-045b.sql` (one transaction, guarded): drops the status table, restores the 045a bodies of the two serving functions, restores the contract row and the SELECT grant on `v_database_status`. Proven to return the exact 045a catalog on PostgreSQL. Pair it with an application revert.
