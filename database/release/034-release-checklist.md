# Migration 034 release checklist and execution plan (with the 035 follow-on)

Prepared 2026-10-13 on the Hetzner VPS. Nothing in this document has been executed against the hosted database. Every step marked
**APPROVAL** needs an explicit go-ahead from the owner; nothing here grants it.

## 0. Identity of what is being released

| Item | Value |
|---|---|
| Release PR | #6 `feature/research-database-v0.8` -> `main`, draft, mergeable (CLEAN), head `1edf314dec0dd9bcbe41499e01b7735e182214eb` |
| `main` today | `053587b` (Merge PR #5; canonical chain ends at 033) |
| Frozen 034 file | `database/sql/034_downstream_organizational_value_chains.sql`, 158 718 bytes, no CRLF |
| 034 SHA-1 (content, `sha1sum`) | `3cb5494f13800a4d44e2ffb6aa6bd1ff88aae5f5` (= `tests/db/frozen-migrations.json`) |
| 034 git blob id | `b48fb86340d4b86d0e519eb8f57cdc4533d57180` (`git hash-object`; header + content, not comparable with the SHA-1 above) |
| 034 SHA-256 | `18a7bfbc0ac089415a8ef3e144744cab8bdcadf3233fd9b9c645d31a45b0fc10` |
| 035 branch | `wip/disi-migration-035`, based directly on `1edf314`; 001-034 byte-identical to `1edf314` |
| CI | Vercel only (preview build `SUCCESS` on `1edf314`); the repo has no GitHub Actions workflow, so the test suites run locally only |

Merging PR #6 into `main` triggers a Vercel **production** deployment of the app. Database and app release are therefore coupled
at the merge.

## 1. Local evidence already collected (no hosted access)

| Evidence | Where | Result |
|---|---|---|
| 034 drift-verifier regression (`tests/db/verify-live-invariants.test.mjs`) at `1edf314`, PGlite | 2026-10-13 | 13/13, exit 0, clean replays 178/178 |
| Full suite on the 035 branch (concurrency 1), lint, typecheck, `next build` | 2026-10-13, `f4cdbb0` | 397/397; all clean |
| Independent replay on real PostgreSQL 17.9 (`database/release/pg17/run.sh`) | 2026-10-13 | 21/21 035 checks; 034 verifier 178/178; 035 verifier 186/186 |
| Upgrade path: each earlier 034 revision -> frozen 034, PG17 | same | applies and converges with a clean frozen replay (rows, views, ACL/RLS, functions, triggers) for `d3d9e85`, `1ac2f75`, `b0c7f37` |
| Backup round trip: `pg_dump -Fc --schema=public` -> `pg_restore` into PG17 | same | 178/178 on the restored copy; every table row-identical; every view returns identical rows; ACL / RLS / reloptions identical |

## 2. What the hosted database holds - UNVERIFIED, read-only probe required

The commit message of `1ac2f75` (2026-10-12) states "Migration 034 is applied live but not yet released to main". The 034 SQL then
changed twice more (`b0c7f37`, `1edf314`; view-only, `MATERIALIZED` CTEs for PostgREST statement-timeout limits). So the hosted
database may hold **any** of four 034 revisions, or none. Nothing on this VPS can tell which: there is no `.env.local`, no
connection string and no Supabase CLI link. This is the first blocker.

Run on a machine that has the credentials (read-only; every statement is a SELECT inside `begin read only` ... `rollback`):

```
psql "$DISI_VERIFY_DB_URL" -X -v ON_ERROR_STOP=1 -f database/release/sql/live-state-probe.sql
npm run verify:db:live            # at 1edf314: the 178-check read-only verifier
```

Use the direct / session connection (port 5432), not the transaction pooler (6543).

### Expected values (from `database/release/pg17/expected-probe.mjs`)

| Probe section | Frozen 034 applied, 035 not | After 035 |
|---|---|---|
| 033 objects present | all true | all true |
| 034 objects present | all true | all true |
| 035 views present | all false | all true |
| `outcome_audits` / `outcome_evidence` / `outcomes` | 93 / 1108 / 47 | 136 / 1151 / 58 |
| `player_mlb_team_season_war` / `sources` | 1821 / 2192 | 1880 / 2235 |
| `transaction_events` / `transaction_event_assets` / `transaction_asset_resolutions` | 204 / 382 / 7 | unchanged |
| `dodgers_control_observations` / `bref_team_code_map` / `transaction_asset_timing_observations` | 94 / 40 / 10 | unchanged |
| analysis as-of date | 2026-10-05 | 2026-10-05 |
| public tables / views, tables without RLS, views not security-invoker | 59 / 109, 0, 0 | 59 / 112, 0, 0 |

### 034 revision fingerprint (`materialized_ctes` / `realization_refs`)

| View | `d3d9e85` | `1ac2f75` | `b0c7f37` | `1edf314` (frozen) |
|---|---|---|---|---|
| v_dodgers_international_value_portfolio | 0 / 64 | 0 / 64 | 1 / 64 | **2 / 31** |
| v_downstream_organizational_realization | 0 / 0 | 1 / 0 | 1 / 0 | 1 / 0 |
| v_player_control_intervals | 0 / 0 | 1 / 0 | 1 / 0 | 1 / 0 |
| v_transaction_asset_lineage | 0 / 0 | 1 / 0 | 1 / 0 | 1 / 0 |
| v_transaction_package_lineage | 0 / 0 | 1 / 0 | 1 / 0 | 1 / 0 |
| v_transaction_research_queue | 0 / 0 | 4 / 31 | 4 / 31 | 4 / 31 |
| v_value_research_queue | 0 / 1 | 4 / 31 | 4 / 31 | 4 / 31 |

Counts come from `pg_get_viewdef`, which can deparse slightly differently across server majors; the
`v_dodgers_international_value_portfolio` row alone separates the frozen revision from the others.

### Decision table

| Probe result | Action |
|---|---|
| 034 present, fingerprint = `1edf314`, counts as expected, `verify:db:live` 178/178 | **No 034 SQL is needed.** Release = merge PR #6 (section 5). |
| 034 present, fingerprint = an earlier revision | Re-apply the frozen 034 (section 4). Proven on PG17 to apply and converge from every earlier revision. |
| 033 present, 034 absent | Apply the frozen 034 (section 4). |
| 033 absent, any 035 view present, an unknown fingerprint, unexpected counts, or any verifier failure | **Stop.** Do not apply anything; investigate drift first. |

## 3. Backup before any hosted SQL (APPROVAL to connect; read-only)

1. In the Supabase dashboard, record the project's backup state: daily backup timestamp, and whether PITR is enabled (PITR is the
   fastest whole-database rollback).
2. Take a logical backup of the `public` schema (read-only; PostgreSQL 18 client works against a 15/17 server):

   ```
   ts=$(date -u +%Y%m%dT%H%M%SZ)
   pg_dump "$DISI_BACKUP_DB_URL" --format=custom --schema=public --no-subscriptions --file "disi-pre034-$ts.dump"
   sha256sum "disi-pre034-$ts.dump" > "disi-pre034-$ts.dump.sha256"
   ```

3. Prove it is recoverable, on disposable PostgreSQL 17 (no hosted connection):

   ```
   node database/release/pg17/restore-verify.mjs <work-dir> "disi-pre034-$ts.dump"
   ```

   Expected: `pg_restore` succeeds in one transaction and, when 034 is already live, the frozen 034 verifier passes 178/178 on the
   restored copy. When 034 is not yet live, the restore must succeed and the verifier result must equal the result of
   `npm run verify:db:live` on the hosted database at the time of the dump (the copy is faithful, whatever it holds).
4. Copy the dump and its `.sha256` off the VPS (two locations). Record the file name, size and SHA-256 in the release notes.

## 4. Apply the frozen 034 - only if the decision table requires it (APPROVAL)

```
sha1sum database/sql/034_downstream_organizational_value_chains.sql   # must print 3cb5494f13800a4d44e2ffb6aa6bd1ff88aae5f5
psql "$DISI_MIGRATE_DB_URL" -X -v ON_ERROR_STOP=1 -f database/sql/034_downstream_organizational_value_chains.sql
```

* The file is one `begin` ... `commit` transaction with guarded preconditions (033 present, organizations and Baseball-Reference
  sources registered, the 161 events of 033) and postconditions; any failure rolls the whole migration back.
* The full 001-034 chain replays in about 3 s on PG17; the 034 transaction itself is short. `create or replace view` takes brief
  exclusive locks on the redefined views; apply outside peak use.
* Rerunnable: a second run is a no-op (tested).

## 5. Post-apply verification and release

1. Re-run the probe (section 2): every value must match the "Frozen 034 applied" column and the fingerprint must be `1edf314`.
2. `npm run verify:db:live` at `1edf314`: 178/178, exit 0.
3. PostgREST smoke test with the publishable (anon) key, each well under the 3 s anon statement timeout that motivated `1ac2f75`:
   `v_player_control_intervals`, `v_transaction_research_queue`, `v_dodgers_international_value_portfolio`,
   `v_value_research_queue` (`?select=*&limit=1`, then an unbounded request).
4. **APPROVAL:** mark PR #6 ready and merge it (merge commit; the 035 rebase was simulated against exactly this). This deploys the
   app to production through Vercel; check the production deployment and the `/` and `/asset-conversion` pages afterwards.

## 6. Rollback

* Failure during section 4: nothing to do; the transaction rolled back. Re-run the probe to confirm.
* After commit: there is no down-migration. Roll back with Supabase PITR to the recorded pre-apply time, or restore the section 3
  dump into `public` (destructive; **APPROVAL**). Revert the app by redeploying the previous Vercel production deployment.

## 7. Migration 035 after 034 is released

Readiness, verified 2026-10-13:

* 035 depends only on 034 (its precondition raises `035: Migration 034 has not been applied`); it creates no table, redefines no
  001-034 view, changes no ACL, RLS, policy or function, adds three security-invoker SELECT-only views and is idempotent.
* A simulated merge of PR #6 into `origin/main` followed by a rebase of the two 035 commits is conflict-free and produces a tree
  identical to `f4cdbb0`; the frozen 034 bytes are unchanged by the rebase.

Steps, each after the previous is complete:

1. `git fetch && git rebase origin/main wip/disi-migration-035`; confirm `sha1sum` of 034 is unchanged and run
   `node --test --test-concurrency=1 tests/db/benchmark-035.test.mjs tests/db/migrations.test.mjs` plus lint, typecheck and build.
2. **APPROVAL:** push and open the 035 PR.
3. Probe (expect the "Frozen 034 applied" column), fresh backup (section 3), then **APPROVAL** to apply
   `database/sql/035_international_benchmark_outcomes.sql` the same way; re-probe (expect the "After 035" column) and run the
   035-branch verifier (186/186).

## Open blockers

1. No hosted credentials on the VPS: the hosted 034 revision, row counts and backup state are unknown (sections 2-3).
2. Owner approvals: connecting to the hosted database, backup, any hosted SQL, merging PR #6 (production deploy), the 035 PR.
3. No automated CI for the database suites (Vercel builds only); the local evidence in section 1 stands in for it.
