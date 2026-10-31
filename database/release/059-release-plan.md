# DISI 059 release plan: career bWAR metric reconciliation

Migration `059_career_bwar_metric_reconciliation.sql` writes one dated career-to-date `CAREER_BWAR` observation for each of eleven benchmark
players, derived from the complete team-season ledger DISI already holds for them (the 2026-09-28 live Baseball-Reference data files 035 loaded).
It is data only: no table, view, function, trigger, grant, policy, source, team-season row or outcome is added or changed.

**Released.** 059 v3 was applied once to production on 2026-10-30 and committed, after two earlier attempts that did not commit (see "Release record"
and "Production attempts 1 and 2"). PR #44 was merged as `9d4da66a10f96990a4818bec237c675a79d7d15e` and deployed as `dpl_5VAyprTMhmZuNm9HJFHCYB4Ug6xg`.
The freeze of 059 is the bookkeeping PR that adds this text.

## What changes

| | Before (frozen 058) | After |
|---|---|---|
| CAREER_BWAR observations | 47 | **58** (+11; none of the 47 changed) |
| `BWAR_MISSING` | 50 | **39** (the eleven leave; all benchmark signings) |
| Sources | 3384 | 3384 (no new source) |
| Team-season WAR rows (active) | 2025 | 2025 (unchanged) |
| Outcomes, labels, features, support, evaluations | | byte-identical |
| Prediction outputs (models, probabilities, expected values, recommendations, Dodgers targets) | 0 / 0 / 0 / 0 / 0 | unchanged |
| Realized organizational bWAR / resolved signings | 299.00 / 88 | unchanged |
| Transaction queue / value queue | 57 / 90 | unchanged |
| Verifier | 259 | 259 (no pin moves; the same expectations hold before and after) |
| Snapshots | generation 14 | 15 (one refresh; no persisted snapshot changes content) |

## Semantics (accepted)

`CAREER_BWAR` is a dated career-to-date Baseball-Reference bWAR observation, as 017 defines it: one row per player and observation date, so an
active player's total keeps its history; `v_player_war` reads the latest. It is not restricted to completed careers. The 059 values are
career-to-date through the 2026 season; the dossier shows "Through the 2026 season" and, for an active player, "active player, total still
changing".

## Files

- `database/sql/059_career_bwar_metric_reconciliation.sql` (v3): 30868 bytes, sha256 `8598c5f158a56459f120e11cdb690302a062f2dabc90222cfcdc9ff844ed7dcc`,
  normalized sha1 `e6f70db245fe407dff603f351a4b488a476d716a`.
- `database/release/sql/rollback-059.sql` (v3): 18264 bytes, sha256 `b52298c3534e015cdc0b876d28bc43fe7d2d5aa314579a3c7ad993e137af0bdc`.
- Superseded, incident history only (not release hashes):
  - v1 (attempt 1): migration sha256 `88d0ef1e…8cf8b8` (normalized sha1 `6d7e98f2…`), rollback `575d1617…273ccc`.
  - v2 (attempt 2): migration sha256 `3734a39f…a515a47` (normalized sha1 `1c9b78ec…`), rollback `0d22a102…7138aa`.
- `database/research/059/release-evidence.mjs`: the external pre-apply capture and post-commit verifier (v3). `verification-architecture.md`:
  every check classified.
- `database/research/059/`: scope, baseline (replay and production), build, evidence, report, notes.
- `database/release/pg17/run-059.sh`, `validate-059.mjs`: the independent PostgreSQL 17 validation.
- `tests/db/research-059.test.mjs`, `tests/unit/research-059.test.mjs`.

## Source architecture (existing, reused)

| Role | URL | SHA-256 (pinned by 032 / 035) |
|---|---|---|
| Cited source (`source_id`) | `https://www.baseball-reference.com/data/war_daily_bat.txt` | `ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8` |
| Named in the notes | `https://www.baseball-reference.com/data/war_daily_pitch.txt` | `061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5` |

Both are the registered `WAR_DATA_FILE` / `BASEBALL_REFERENCE` sources (file date 2026-09-28, retrieved 2026-10-10). The observation table holds one
source per row; the 032 pattern cites the batting file and names the pitching file, and every summed ledger row keeps its own source. The
`CAREER_BWAR` provider trigger is not changed.

## Scope and values

| Player | bref / MLBAM | Rows (BAT + PITCH) | BAT | PITCH | Raw | CAREER_BWAR | MLB record |
|---|---|---|---:|---:|---:|---:|---|
| Rafael Devers | deverra01 / 646240 | 11 (11 + 0) | 30.62 | — | 30.62 | **30.6** | active |
| Gleyber Torres | torregl01 / 650402 | 9 (9 + 0) | 20.91 | — | 20.91 | **20.9** | active |
| Eloy Jiménez | jimenel02 / 650391 | 8 (8 + 0) | 5.17 | — | 5.17 | **5.2** | active |
| Huascar Ynoa | ynoahu01 / 660623 | 8 (4 + 4) | 0.33 | 0.73 | 1.06 | **1.1** | active |
| Marcos Diplán | diplama01 / 650959 | 4 (2 + 2) | 0.00 | 0.38 | 0.38 | **0.4** | active |
| Dérmis García | garcide02 / 660650 | 1 (1 + 0) | 0.50 | — | 0.50 | **0.5** | not active |
| Lewin Díaz | diazle01 / 650331 | 3 (3 + 0) | 0.13 | — | 0.13 | **0.1** | not active |
| Anderson Espinoza | espinan01 / 659262 | 2 (1 + 1) | — | −0.02 | −0.02 | **0.0** | active |
| Hyo-Jun Park | parkho01 / 660829 | 3 (3 + 0) | −0.63 | — | −0.63 | **−0.6** | not active |
| José Herrera | herrejo04 / 645444 | 6 (4 + 2) | −0.62 | −0.03 | −0.65 | **−0.7** | active |
| Diego Castillo | castidi02 / 660636 | 4 (3 + 1) | −0.51 | −0.26 | −0.77 | **−0.8** | active |

Every observation: observed through **2026-09-28** / season **2026**, confidence VERIFIED, the batting-file source, notes naming both files and
hashes. Each value equals the stored `outcomes.career_war` at one decimal; `outcomes` is not touched. "Not active per the MLB person record" is not
retirement evidence and is not used.

**Not in scope.** The 057 eleven (DeJesus, Guerrero, Celestino, Pache, Giménez, Taveras, Soto, Amaya, Muzziotti, Tatis, Marchán): their rows stop
at 2025 and cite the archived captures the provider rule does not accept, and all played in 2026 (10-SEASON WINDOW COMPLETE != CAREER COMPLETE).
The other 28 `BWAR_MISSING` players have no team-season WAR. After 059 the 39 remaining are these 11 + 28.

## Release record

**Attempt 3 (v3), sha256 `8598c5f1…`: committed.**
- **Pre-apply capture:** 404.5 s, read-only; equal in every section to the reviewed capture of the restored backup. The post-capture health gate passed (server start unchanged, no release sessions, 0 ungranted locks, cheap probes 107–267 ms).
- **Apply:** `2026-10-30T23:57:08.635Z → 2026-10-30T23:57:26.005Z`, **17.4 s**. `INSERT 0 11`, `COMMIT`, exit 0, pipeline exit 0. No restart and no connection interruption.
- **Phases, elapsed inside the transaction:** preconditions +8.26 s, insert +8.53 s, postconditions +8.58 s (the phase itself about 41 ms), snapshots +16.35 s.
- **Post-commit capture and verify:** 368.2 s, read-only. External verifier **17/17 PASS**. The only changes are +11 exact observations, `BWAR_MISSING` 50 → 39 and generation 14 → 15.
- **Merge:** PR #44, regular merge commit `9d4da66a10f96990a4818bec237c675a79d7d15e` at 2026-10-31T20:38:25Z (parents `4747049…`, `880c6f2…`).
- **Deployment:** `dpl_5VAyprTMhmZuNm9HJFHCYB4Ug6xg` at commit `9d4da66`, READY, production alias `disi-liart.vercel.app`.
- **Smoke: PASS.** The eleven dossiers show their values through the 2026 season (Devers 30.6, Ynoa 1.1, Herrera -0.7, ...); Juan Soto still shows no observation; the core pages return 200 with no "Data unavailable", 299.0 realized value and no probability, expected value or recommendation. Runtime logs were empty and no statement timeout appears in the request logs.
- **Production final state:** CAREER_BWAR 58, `BWAR_MISSING` 39, 11 exact 059 rows, generation 15, drift 0, verifier 259/259, sources 3384, active WAR 2025, 299.00 / 88, queues 57 / 90, outputs 0 / 0 / 0 / 0 / 0, none of the 057 eleven has a CAREER_BWAR observation.

## Production attempts 1 and 2 (neither committed)

### Attempt 1 (2026-10-29, v1 `88d0ef1e…`): statement timeout, no commit

- **Run:** the safe runner, 2026-10-29T20:49:37Z → 20:53:47Z, exit 3.
- **Failure:** `ERROR: canceling statement due to statement timeout`, in the postcondition `DO` block, after `INSERT 0 11`.
- **Outcome:** no COMMIT; PostgreSQL rolled the transaction back. Production was re-read byte-identical to the pre-059 baseline.
- **Cause:** hosted production sets `statement_timeout = 2min`, and a `DO` block is one statement.
- **v2 response:** `set local statement_timeout = '600s'` right after `begin;` (kept in v3).

### Attempt 2 (2026-10-30, v2 `3734a39f…`): server restart, no commit, cause unknown

- **Run:** the safe runner, started 2026-10-30T11:50:06Z after a passing read-only pre-check.
- **Progress:** the transaction again reached `INSERT 0 11` and entered the postcondition `DO` block.
- **Restart:** at 11:55:15Z (`pg_postmaster_start_time()`) the whole PostgreSQL server restarted. The 059 backend disappeared, and no COMMIT occurred.
- **Abrupt stop:** cumulative statistics were discarded at startup, which PostgreSQL does after a crash or an immediate stop, not after a clean shutdown.
- **Outcome:** recovery discarded the transaction. Production was re-read exactly pre-059 (CAREER_BWAR 47, BWAR_MISSING 50, generation 14, drift 0, 259/259).
- **Cause unknown:** the Supabase logs were not accessible. It is not established that the migration caused the restart, nor that the restart was external.
- **Local client:** the `psql` process stayed blocked on the dead connection until it was terminated locally at 16:40Z. Its output was buffered, so the run left no per-statement timing.

### What both attempts share

The same phase failed twice: the postcondition `DO` block, after the insert, inside the open write transaction.
- **What that block did:** v1 and v2 re-hashed every public base table (67 besides the metric table and the snapshots) and fifteen complex prediction / outcome / value / queue views there, a second time after the pre-insert pass.
- **Local cost:** on a local restore with the hosted memory settings the whole v2 migration takes about 11 s.
- **Production cost:** in production the block ran for minutes. Production executes ordinary read-only guards 2–4× slower than local, and the gap here was much larger and is unexplained.

## v3 design: the exhaustive isolation proof moves outside the write transaction

**The principle:**
- The migration proves *"the requested write is valid and the expected immediate state exists"*.
- The external release verifier proves *"nothing unrelated changed"*.

Every v1 / v2 check is classified in `database/research/059/verification-architecture.md`.

- **Inside the transaction (unchanged):** `set local statement_timeout = '600s'`, and every precondition: scope, identities, the registered sources, the complete ledger and its sums, `outcomes.career_war`, no conflicting or later observation, the 057 exclusion, CAREER_BWAR 47, the exact BWAR_MISSING 50, drift 0, partial-set refusal.
- **Write:** the insert is unchanged (the eleven rows, derived from the ledger).
- **Inside the transaction (minimal postcondition):**
  - the eleven exact rows, every column, one per player, no conflict;
  - CAREER_BWAR = 47 + 11, all observations = before + 11, every other player's observation rows unchanged, no 057 observation;
  - `v_player_war` reads the eleven;
  - BWAR_MISSING = exactly the reviewed 39 (the eleven gone, the 057 eleven still in it);
  - unchanged counters for sources, team-season rows (all and ACTIVE), outcomes, and the eleven outcome rows.
- **Refresh:** once, generation + 1, drift 0, and every `product_*` table at that single generation. A rerun is a no-op (no insert, no refresh, generation unchanged).
- **Removed from the transaction, kept in the release:**
  - the full table-hash pass (`_m059_tables`) and the fifteen view fingerprints (`_m059_untouched`), before and after the insert;
  - the snapshot business-content comparison.

  They now run in `release-evidence.mjs`: `capture` read-only before the apply and again after the commit, then `verify --kind apply` (or `rollback`, `noop`).
- **rollback-059 (v3):** the same split.
  - **Every refusal kept:** not applied, a later or changed observation (mandatory, unchanged), partial set, count not 58.
  - **Then:** the exact delete; CAREER_BWAR 47; all observations − 11; the other rows unchanged; BWAR_MISSING the original 50; the counters; one refresh, generation + 1, drift 0, every snapshot table at that generation.
- **Timing:** each phase raises a `NOTICE` with its elapsed time (preconditions, insert, postconditions, snapshots). The release runner applies with `\timing on` and must stream its output line by line, so a future log shows where the time goes.

## Statement timeout (hosted parity, required)

| | Value |
|---|---|
| Hosted production default (session / database) | `2min` |
| Inside 059 / rollback-059 (`SET LOCAL`) | `600s` |
| Restored-copy rehearsal and `run-059.sh`: server default | `2min`, plus the hosted memory settings on the restored copy (`work_mem` 2184kB, `shared_buffers` 224MB) |

## Order

1. **Back up.** `pg_dump` through the safe runner, mode 600, SHA-256 sidecar. Restore-verify on PostgreSQL 17 with the 2min default and the hosted
   memory settings: the restored copy passes 259/259, and the v3 sequence (capture, apply, verify, rerun, rollback, refusals, reapply) passes there.
2. **Pre-apply evidence (read-only).** Run `release-evidence.mjs capture --out pre.json` against production through the safe runner. It must show:
   - CAREER_BWAR 47, BWAR_MISSING 50, generation 14, drift 0, verifier 259/259;
   - its tables, views, observations, measurement and snapshots equal to the restored backup's capture.

   Keep `pre.json` with the release record.
3. **Apply** `059_career_bwar_metric_reconciliation.sql` through the safe runner: SHA-checked, `ON_ERROR_STOP`, `\timing on`, output streamed with
   timestamps. One transaction, applied once. The four phase `NOTICE`s and the `COMMIT` must appear.
4. **Post-commit evidence (read-only).** Run `capture --out post.json`, then `verify --kind apply --pre pre.json --post post.json`.
   - **PASS** requires exactly the allowed delta: +11 exact observations, BWAR_MISSING −11, generation 14 → 15, no snapshot business change.
   - **Nothing else may move:** every other base table, the fifteen view fingerprints, every other measurement section and the catalog.
   - **Also required:** verifier 259/259, sources 3384, WAR 2025, 299.00 / 88, queues 57 / 90, outputs 0.
5. **Merge and deploy** only after a PASS: a normal merge commit with exact-head protection. No application change.
6. **Smoke.**

   | Page | Expected |
   |---|---|
   | `/players/rafael-devers` (and the other ten) | Career bWAR 30.6, "Through the 2026 season", active-player note where applicable |
   | `/players/juan-soto` (and the other 057 players) | Unchanged: "No Baseball-Reference observation recorded yet" |
   | `/`, `/asset-conversion`, `/research`, `/prediction-readiness`, `/portfolio`, `/league`, `/methodology` | Unchanged values; no probability, expected value or recommendation |

   Every page returns HTTP 200 with no "Data unavailable", and the deployment's logs are clean.
7. **Freeze** on a bookkeeping-only branch: 62 → 63 frozen, `UNRELEASED_ADDITIONS = []`.

## If the commit succeeds but the external verification fails (HOLD)

1. **STOP.** No merge, no deploy, no freeze.
2. **Inspect the exact mismatch.** `verify` names every failing check and the tables, views or sections that moved. Re-capture once, read-only, to rule out concurrent activity.
3. **Roll back only with owner review.** Run the guarded `rollback-059.sql` only after the owner has reviewed the mismatch and authorized the rollback. No release policy allows an automatic rollback for 059.
4. **Verify the restored state externally:** `capture --out rolled.json`, then `verify --kind rollback --pre post.json --post rolled.json --original pre.json`. It must PASS.

If the apply itself fails (any error, or no `COMMIT`), PostgreSQL rolls the transaction back. Re-read production read-only, and stop.

## Rollback

`rollback-059.sql` runs in one guarded transaction. Metric observations have no ACTIVE / RETRACTED lifecycle, so it **deletes** exactly the
eleven 059 observations, each matched on player, value, date (2026-09-28), season (2026), source (the live batting file), confidence and notes. It
refuses when 059 is not applied, when any of the eleven has a CAREER_BWAR observation that is not exactly the 059 one (a later observation or a
changed 059 row), and when fewer than eleven 059 rows exist. Inside the transaction it then proves CAREER_BWAR 47, every other observation
unchanged, `BWAR_MISSING` back to the reviewed 50 and the unchanged-input counters, and refreshes once (production 15 → 16, every snapshot table
at that generation, drift 0). That every other table and layer equals the original pre-059 state is proven outside it, read-only
(`release-evidence.mjs verify --kind rollback`). 059 can be applied again after its rollback (16 → 17).

**Dependency.** 059 creates no 057 / 058-style lock: no source is added, no team-season row is written, nothing cites the 057 archived sources, and
no released rollback reads `player_metric_observations`. rollback-058 and rollback-057 behave exactly as before (rollback-057 is already
unavailable once 058 has been applied).

## Evidence

- `database/research/059/`: `README.md`, `research-notes.md`, `scope.json`, `career-bwar-evidence.json`, `baseline.json` (canonical replay),
  `baseline-production.json` (read-only production measurement), `before-after.json`.
- `database/research/059/release-evidence.mjs` and `verification-architecture.md` (v3).
- `tests/unit/research-059.test.mjs` and `tests/db/research-059.test.mjs`.
- The independent PostgreSQL 17 validation, `database/release/pg17/run-059.sh`.
