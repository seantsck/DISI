# DISI 059 release plan: career bWAR metric reconciliation

Migration `059_career_bwar_metric_reconciliation.sql` writes one dated career-to-date `CAREER_BWAR` observation for each of eleven benchmark
players, derived from the complete team-season ledger DISI already holds for them (the 2026-09-28 live Baseball-Reference data files 035 loaded).
It is data only: no table, view, function, trigger, grant, policy, source, team-season row or outcome is added or changed.

**Not applied to production.** Applying it, merging the PR and any deploy need explicit owner approval. Production is at 058 (generation 14,
259/259), and 058 is frozen. Baseline `main` is `4747049cb662a6aec99b5fbb437f34d1df896ef0`.

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

- `database/sql/059_career_bwar_metric_reconciliation.sql`: 31292 bytes, sha256 `3734a39fe1f5150fb3ea28c424eaad5b9144375664bf84a7671d4ba348515a47`,
  normalized sha1 `1c9b78ec66eef3cbcb8d419bba5e7c110d5ce89e`.
- `database/release/sql/rollback-059.sql`: 18805 bytes, sha256 `0d22a10240e430c862e960147d27e7fc104591d242fb251371e8b6eb807138aa`.
- Superseded (the failed first release candidate, see "First production attempt"): migration sha256 `88d0ef1e…8cf8b8` (normalized sha1
  `6d7e98f2…`), rollback sha256 `575d1617…273ccc`. They are not release hashes.
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

## First production attempt (failed safely, 2026-10-29)

- **Run:** the superseded candidate (sha256 `88d0ef1e…`) through the safe runner, 2026-10-29T20:49:37Z → 20:53:47Z, exit 3, pipeline exit 3.
- **Failure:** `ERROR: canceling statement due to statement timeout`, in the postcondition `DO` block, after `INSERT 0 11` inside the transaction.
- **Outcome:** there was no COMMIT; PostgreSQL rolled the whole transaction back. A read-only re-read of production afterwards was byte-identical
  to the pre-059 baseline (CAREER_BWAR 47, BWAR_MISSING 50, generation 14, drift 0, 259/259). **059 was not applied.**
- **Root cause:** hosted production sets `statement_timeout = 2min` at the session / database level, and a `DO` block is one statement; the
  postcondition block (every isolation fingerprint, the table hashes and the queue checks) exceeded it. The PostgreSQL 17 rehearsal had no statement
  timeout and could not reproduce it (a rehearsal-parity gap).
- **Fix:** 059 and rollback-059 each run `set local statement_timeout = '600s';` right after `begin;`, the `refresh-product-snapshots.sql`
  convention. `SET LOCAL` applies to that transaction only and reverts at COMMIT or ROLLBACK: no role, database or system setting changes, and
  later sessions keep 2min. The substantive SQL is unchanged.

## Statement timeout (hosted parity, required)

| | Value |
|---|---|
| Hosted production default (session / database) | `2min` |
| Inside 059 (`SET LOCAL`) | `600s` |
| Inside rollback-059 (`SET LOCAL`) | `600s` |
| Restored-copy rehearsal and `run-059.sh`: server default | `2min` (no longer limit supplied by the runner or `PGOPTIONS`) |

Every rehearsal runs with the 2min default and records `SHOW statement_timeout` in the apply / rollback session before and after (2min both times).
The rehearsal also proves sensitivity on disposable copies: under a far tighter outer limit the superseded bytes are cancelled and roll back whole,
while the corrected bytes commit. A new production authorization is required for the corrected hash; the earlier one covered `88d0ef1e…` only.

## Order

1. **Back up.** `pg_dump` through the safe runner, mode 600, SHA-256 sidecar. Restore-verify on PostgreSQL 17 with a `statement_timeout = 2min`
   server default (hosted parity): on the restored copy the verifier
   passes 259/259; 059 applies, reruns as a no-op, rolls back, refuses a guarded rollback, and reapplies (`run-059.sh` proves the same on a replay).
2. **Read-only checks on production, before the apply:** verifier 259/259 (current expectations), catalog 79 / 156 / 37, sources 3384, players 398,
   active WAR 2025, generation **14** on all eleven snapshots, drift 0, CAREER_BWAR 47, `BWAR_MISSING` 50, none of the eleven or the 057 eleven with an
   observation, 299.00 / 88, queues 57 / 90, the three evaluation fingerprints, every output 0.
3. **Apply** `059_career_bwar_metric_reconciliation.sql` through the safe runner, SHA-checked, `ON_ERROR_STOP`. One transaction, applied once. The
   migration guards drift 0 and exactly one new generation; the absolute generation (14 → 15) is checked here, because a canonical replay starts one
   refresh lower (13 → 14).
4. **Verify, read-only:** verifier 259/259, generation 15 on all eleven, drift 0, CAREER_BWAR 58, `BWAR_MISSING` 39, the eleven values, sources 3384,
   active WAR 2025, value, queues and prediction fingerprints unchanged.
5. **Isolation.** Compare every table of the restored backup with live: only `player_metric_observations` changes (+11, no existing row changed);
   every snapshot's business columns are unchanged (generation and timestamps only). Schema and security fingerprints are identical.
6. **Merge and deploy** after the apply, as a normal merge commit with exact-head protection; the GitHub to Vercel production deploy follows. No
   application change.
7. **Smoke.**

   | Page | Expected |
   |---|---|
   | `/players/rafael-devers` (and the other ten) | Career bWAR 30.6, "Through the 2026 season", active-player note where applicable |
   | `/players/juan-soto` (and the other 057 players) | Unchanged: "No Baseball-Reference observation recorded yet" |
   | `/`, `/asset-conversion`, `/research`, `/prediction-readiness`, `/portfolio`, `/league`, `/methodology` | Unchanged values; no probability, expected value or recommendation |

   Every page returns HTTP 200 with no "Data unavailable", and the deployment's logs are clean.
8. **Freeze** on a bookkeeping-only branch: 62 → 63 frozen, `UNRELEASED_ADDITIONS = []`.

## Rollback

`rollback-059.sql` runs in one guarded transaction. Metric observations have no ACTIVE / RETRACTED lifecycle, so it **deletes** exactly the
eleven 059 observations, each matched on player, value, date (2026-09-28), season (2026), source (the live batting file), confidence and notes. It
refuses when 059 is not applied, when any of the eleven has a CAREER_BWAR observation that is not exactly the 059 one (a later observation or a
changed 059 row), and when fewer than eleven 059 rows exist. It then proves CAREER_BWAR 47, `BWAR_MISSING` back to the reviewed 50, every other
table and every other layer unchanged, and refreshes once (production 15 → 16). 059 can be applied again after its rollback (16 → 17).

**Dependency.** 059 creates no 057 / 058-style lock: no source is added, no team-season row is written, nothing cites the 057 archived sources, and
no released rollback reads `player_metric_observations`. rollback-058 and rollback-057 behave exactly as before (rollback-057 is already
unavailable once 058 has been applied).

## Evidence

- `database/research/059/`: `README.md`, `research-notes.md`, `scope.json`, `career-bwar-evidence.json`, `baseline.json` (canonical replay),
  `baseline-production.json` (read-only production measurement), `before-after.json`.
- `tests/unit/research-059.test.mjs` and `tests/db/research-059.test.mjs`.
- The independent PostgreSQL 17 validation, `database/release/pg17/run-059.sh`.
