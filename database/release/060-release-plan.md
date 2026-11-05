# DISI 060 release plan: owner-reviewed acquisition costs

Migration `060_owner_reviewed_acquisition_costs.sql` makes 25 owner-reviewed Dodgers signing bonuses (owner input of 2026-11-04) canonical. It is
data only: no table, view, function, trigger, grant, policy, source, player or signing is added or changed.

**Released and frozen.** 060 was applied to production on 2026-11-05 (PR #46 merged as `9ebb2d04018844eb3da82a9dc9ee7ccc5f762942`; frozen in
the bookkeeping PR that records this section). The plan below is kept as the release procedure that was followed.

## Release record

| | |
|---|---|
| Production apply | 2026-11-05 04:34:12.363Z -> 04:34:31.985Z (19.6 s), one transaction, `COMMIT`, exit 0; all five phase NOTICEs |
| External release check | `release-check.mjs` 18/18 PASS (exit 0) |
| PR | #46, normal merge commit `9ebb2d04018844eb3da82a9dc9ee7ccc5f762942` (parents `ab6677bb6e607c8551457239a3d1396c71512704` and `127c43da3389ba474603b5ec9dbc4c5ae292349c`) |
| Deployment | `dpl_FKocKNoJuZgqVVKX12fgBKDcKL6i`, deployed SHA `9ebb2d04018844eb3da82a9dc9ee7ccc5f762942`, production, READY |
| Smoke | passed (dossiers, aggregate pages, unknown controls; request logs all 200, no runtime errors) |
| Production after | generation 16, drift 0, verifier 259/259; known acquisition cost 81 / unknown 139; known spend `127632237.33` |
| Migration sha256 / normalized sha1 | `525afef8fb91cc059ca2f338faaf9e6d37c89c0bc6d0f302c7dfa01ebf10db30` / `19a63a45ce75ab17e01154259035e52a932dbd7e` |
| Rollback sha256 | `1bd46dcfcb003375a1edb2f0e3587c55614bfcdc75e368d755078a9c94b951b8` (not run) |

The PG17 restored-backup rehearsal (fresh backup of generation 15) passed before the apply. Its two failed comparisons were the sort order of the
`missing_cost` list only (production ICU `en-US` against the rehearsal's libc `en_US.UTF-8`); the row set was identical and the set-based release
check passed.

## Files

- `database/sql/060_owner_reviewed_acquisition_costs.sql`: built by `database/research/060/build.mjs` (hashes in the PR).
- `database/release/sql/rollback-060.sql`: built from the same input.
- `database/research/060/`: the reviewed input, baseline, build, measurement, report and release check (`README.md`).
- `tests/db/research-060.test.mjs`, `tests/unit/research-060.test.mjs`.

## What changes

| | Before (059) | After |
|---|---|---|
| Known acquisition cost (Dodgers) | 56 of 220 | **81** of 220 |
| Unknown acquisition cost | 164 | **139** |
| Known acquisition cost (lower bound) | $121,700,237.33 | **$127,632,237.33** (+$5,932,000.00) |
| Owner-reviewed unsourced bonus reports | 0 | 24 (`LEGACY_CARRYFORWARD`, `LEGACY_CANONICAL_ONLY`) |
| Financial resolutions | 0 | 1 (Beltre, `OTHER_REVIEWED`, selects the existing $23,000 report) |
| Zero bonuses | 0 | 1 (Pedro Astacio, a known $0.00) |
| `ACQUISITION_COST_UNKNOWN` (Dodgers) / open research tasks | 164 / 349 | 139 / 324 |
| Value queue `ACQUISITION_COST_INCOMPLETE` (total) | 28 (90) | 17 (79) |
| Outcomes, WAR, transactions, development, benchmarks, support, evaluations, prediction outputs | | unchanged |
| Realized organizational bWAR / resolved signings | 299.00 / 88 | unchanged |
| Verifier | 259/259 | 259/259 (no expectation change) |
| Snapshots | generation 15 | 16 (one refresh), drift 0 |

Provenance: the 24 values that were unknown are `OWNER_REVIEWED_INPUT` mapped onto the ledger's unsourced-canonical path. They are never
presented as externally sourced, no source row or URL is created, and `bonus_publicly_reported` is not changed. Unknown values stay NULL.

## Consequences (accept before release)

- **046 becomes non-rerunnable** while 060 is applied: its precondition refuses Beltre with a canonical bonus under disagreeing sources. It fails
  closed and changes nothing.
- **rollback-046 becomes unavailable** while 060 is applied (a bonus resolution exists for Beltre). rollback-060 first restores the 046 state.

## Order (the 059 v3 release discipline)

1. **Backup.** `pg_dump` through the safe runner, mode 600, SHA-256 sidecar; restore-verify on PostgreSQL 17 with the hosted 2min default and memory
   settings, and rehearse apply, rerun, rollback, refusals and reapply there.
2. **Exact pin.** PR head, `main`, the migration and rollback SHA-256 from disk.
3. **Cheap baseline (read-only).** CAREER_BWAR 58, BWAR_MISSING 39, generation 15, drift 0, verifier 259/259, known cost 56 / unknown 164,
   `pg_postmaster_start_time()` recorded.
4. **Pre-apply capture (read-only).** `node database/research/060/measure.mjs --out pre.json` through the safe runner. Its finance sections must
   equal `baseline.json` (cost counts, ledger, resolutions, the 25 reviewed signings, missing-cost list, fingerprints).
5. **Health gate.** Server start unchanged, no release session or idle-in-transaction session, no ungranted lock, cheap probes responsive.
6. **Apply once** through the safe runner's streaming mode: SHA-checked, `psql -X`, `ON_ERROR_STOP=1`, `\timing on`, timestamped streamed output.
   The five phase NOTICEs (preconditions, ledger facts, resolution, postconditions, snapshots) and `COMMIT` must appear. No outside timeout
   override; the migration raises its own with `SET LOCAL`.
7. **Cheap post-commit guard.** Known 81 / unknown 139, generation 16, drift 0, verifier 259/259, outcomes and prediction outputs unchanged.
8. **Post-commit capture and check (read-only).** `measure.mjs --out post.json`, then
   `node database/research/060/release-check.mjs --pre pre.json --post post.json` → PASS (exit 0) or HOLD (exit 2).
9. **Stop for review.** Merge, deploy, smoke and freeze are separate owner decisions.

A HOLD after a successful commit means stop: no merge, deploy, freeze or automatic rollback. The owner decides.

## Smoke (after deploy)

| Page | Expected |
|---|---|
| `/players/carlos-santana` (and the other 23) | Signing bonus the reviewed amount (for example $75,000); known cost |
| `/players/pedro-astacio` | Signing bonus $0 (a known value, not "Unknown (not $0)") |
| `/players/adrian-beltre` | Signing bonus $23,000 |
| `/players/juan-soto` and any other unknown | Unchanged: "Unknown (not $0)" |
| `/`, `/markets`, `/portfolio`, `/research`, `/prediction-readiness` | Known spend and coverage move as above; no probability, expected value or recommendation |

## Rollback

`rollback-060.sql` retracts (never deletes) the 24 reports and the one resolution 060 wrote, returns the 25 canonical bonuses to NULL (Beltre back to
`CONFLICT` with both 046 reports ACTIVE), asserts `bonus_publicly_reported` is unchanged and refreshes once. It refuses when 060 is not applied,
when the state is partial, or when a later report, resolution or supersession depends on a 060 row. 060 can be reapplied after it: the facts are
recorded again as new ACTIVE rows; the retracted rows stay as history.
