# 059 verification architecture (v3): check classification

Both production attempts of 059 reached `INSERT 0 11` and then failed in the same place: the postcondition `DO` block, which re-hashed every
public base table and fifteen complex views inside the open write transaction.
- **Attempt 1** (sha256 `88d0ef1e…`, 2026-10-29): cancelled by the hosted 2-minute statement timeout.
- **Attempt 2** (sha256 `3734a39f…`, 2026-10-30): the PostgreSQL server restarted abruptly about five minutes after the start, cause unknown.

Neither committed, and production stayed exactly pre-059.

v3 keeps every check, but no longer runs every check inside the transaction:

- **The migration** proves that the requested write is valid and that the expected immediate state exists.
- **The external release verifier** (`release-evidence.mjs`) proves that nothing unrelated changed. It reads production before the apply and again after the commit, and compares the two.

Classes:

| Class | Meaning |
|---|---|
| **A** | Required inside the transaction, before COMMIT, for correctness or atomicity. |
| **B** | Pre-apply external evidence: a read-only baseline (`release-evidence.mjs capture`, before the apply). |
| **C** | Post-apply external evidence: a read-only isolation and product proof (`release-evidence.mjs capture` after the commit, then `verify`). |
| **D** | Redundant: already proven elsewhere and unnecessary in the release path. |

## Migration 059

| # | Check (v1 / v2) | Class | v3 |
|---|---|---|---|
| M0 | Reviewed payload, `_m059_exact` (the released row, every column), `_m059_conflicts` | A | kept |
| M1 | `_m059_tables`: row hash of all 67 other base tables, before the insert | **B** | moved: `capture` → `tables` |
| M2 | `_m059_untouched` / `_m059_before`: 15 view fingerprints, before the insert | **B** | moved: `capture` → `views` |
| M3 | `_m059_before.generation`, `exact_before` | A | kept |
| M3a | Inexpensive counters: all observations, sources, team-season rows (all and ACTIVE), outcomes, the eleven `outcomes` rows (11-row hash), every other player's observation rows (the written table) | A | **new**, compared after the insert |
| P1 | Scope: exactly the eleven, distinct; the 057 eleven, none in scope | A | kept |
| P2 | The live batting / pitching data files are the registered `WAR_DATA_FILE` / `BASEBALL_REFERENCE` sources | A | kept |
| P3 | Sources = 3384 | A | kept |
| P4 | Identity: slug + Baseball-Reference id + MLBAM id | A | kept |
| P5 | One verified-MLB benchmark signing (not Dodgers) | A | kept |
| P6 | Ledger shape: rows, BAT / PITCH rows, no TOT, no unmapped team, the matching live-file source, as-of 2026-09-28 / 2026, no duplicate stint | A | kept |
| P7 | Ledger sums: BAT, PITCH, raw, rounded to one decimal | A | kept |
| P8 | `outcomes.career_war` = the reviewed raw sum | A | kept |
| P9 | No CAREER_BWAR observation of the eleven that is not the 059 one (earlier, later or changed) | A | kept |
| P10 | No 057 player has a CAREER_BWAR observation | A | kept |
| P11 | First run: CAREER_BWAR = 47 | A | kept |
| P12 | First run: BWAR_MISSING = the reviewed 50 (evaluated three times in v2) | A | kept; evaluated once (the second and third evaluations are **D**) |
| P13 | First run: snapshot drift 0 | A | kept |
| P14 | Partial set (n not 0 or 11): refused | A | kept |
| I | `INSERT` of the eleven, derived from the ledger | A | unchanged |
| Q1 | Exactly the eleven exact rows, one per player, no conflict | A | kept |
| Q2 | CAREER_BWAR = 47 + 11; no 057 player has one | A | kept; also all observations = before + 11, and every other player's observation rows unchanged (M3a) |
| Q3 | `v_player_war` reads the 059 observation for each of the eleven | A | kept |
| Q4 | BWAR_MISSING = the reviewed 39 (evaluated three times in v2) | A | kept; evaluated once, plus none of the eleven left and all of the 057 eleven still in it |
| Q5 | All 67 base tables re-hashed and compared | **C** | moved: `verify` → base tables / player_metric_observations. The transaction keeps the M3a counters (sources, team-season rows, outcomes, the eleven outcomes, other observations). |
| Q6 | Seven prediction / outcome view fingerprints (support, training population, feature matrix, evaluations, probabilities, expected values, realized outcome) | **C** | moved: `verify` → view fingerprints, measurement, prediction outputs |
| Q7 | Five value view fingerprints (realized value, lineage, transaction queue, value queue, executive overview) | **C** | moved: `verify` → view fingerprints, measurement |
| Q8 | Other research tasks fingerprint | **C** | moved: `verify` → research tasks, `other_research_tasks` |
| Q9 | Other players' metric observations fingerprint | A + C | kept inside: it is the written table, at most a few dozen rows. Also in `verify` → `other_metric_observations` |
| R1 | First run: one refresh, generation + 1, drift 0. Rerun: generation unchanged. | A | kept |
| R2 | Every `product_*` table carries exactly that one generation | A | **new** (cheap: 11 small tables) |
| R3 | Snapshot business content unchanged | **C** | moved: `verify` → snapshots (business columns apart from generation, ids and timestamps) |
| T | Phase timing | — | **new**: a `NOTICE` with the elapsed time at the end of each phase (no persistent instrumentation) |

## Rollback 059

| # | Check (v1 / v2) | Class | v3 |
|---|---|---|---|
| G0 | Payload, `_r059_exact` (every column), `_r059_conflicts` | A | kept |
| G1 | `_r059_tables`: 67 base tables hashed before the delete | **B** | moved: `capture` of the post-apply state |
| G2 | `_r059_untouched`: 9 view fingerprints before the delete | **B** | moved: `capture` |
| G3 | Not applied (no exact row and no conflict): refused | A | kept |
| G4 | A later or changed CAREER_BWAR observation of the eleven: refused | A | **kept, unchanged** (mandatory) |
| G5 | Partial set (not 11 rows for 11 players): refused | A | kept |
| G6 | CAREER_BWAR count is not 58: refused | A | kept |
| X | `DELETE` of exactly the eleven exact rows | A | unchanged |
| H1 | No observation left for the eleven; CAREER_BWAR = 47 | A | kept; also all observations = before − 11, and every other player's rows unchanged |
| H2 | BWAR_MISSING = the original 50 (evaluated three times) | A | kept; evaluated once |
| H3 | All 67 base tables re-hashed and compared | **C** | moved: `verify --kind rollback` against the original pre-059 capture. Inside: counters for sources, team-season rows, outcomes |
| H4 | Nine view fingerprints compared | **C** | moved: `verify --kind rollback` |
| H5 | One refresh, generation + 1, drift 0 | A | kept |
| H6 | Every `product_*` table at that one generation | A | **new** |
| H7 | Snapshot business content | **C** | `verify --kind rollback` (equal to the original pre-059 capture) |

## External evidence (`database/research/059/release-evidence.mjs`)

**Capture** (B before the apply, C after the commit; read-only, one repeatable-read transaction) records:
- **Release pins:** origin/main, HEAD, the migration sha256 and normalized sha1, the rollback sha256.
- **Database identity:** version, postmaster start, statement_timeout, work_mem.
- **Catalog:** relations, views, columns, constraints, functions, policies, triggers, ACLs.
- **Tables:** every public base table that is not a snapshot (row count and row fingerprint, the v1 / v2 form).
- **Snapshots:** every `product_*` table (business-column fingerprint and its generations), plus drift.
- **Views:** the fifteen view fingerprints.
- **Observations:** every `player_metric_observations` row.
- **Measurement:** the full 059 measurement (`measure.mjs`: counts, prediction, value, queues, dossiers, ...).
- **Verifier:** `CANONICAL_EXPECTATIONS`.

**Verify** (pure, no database) checks one transition and returns PASS or HOLD:

| Kind | Asserts |
|---|---|
| `apply` | **Allowed:** `player_metric_observations` +11, the exact rows (every pre-059 row unchanged); BWAR_MISSING −11 (the 057 eleven stay); the eleven dossiers; snapshot generation +1 on every table. **Everything else must be identical:** every other base table, the fifteen view fingerprints, every other measurement section, the snapshot business content, the catalog. Also: CAREER_BWAR 58, verifier 259/259, sources 3384, active WAR 2025, value 299.00 / 88, queues 57 / 90, outputs 0, the evaluation fingerprints, drift 0. |
| `noop` | A rerun: nothing at all changes, the generation included. |
| `rollback` | The rolled-back state equals the original pre-059 capture everywhere. The snapshot generation is +1 over the post-apply capture. |

A HOLD means stop: no merge, deploy or freeze. See "If the commit succeeds but the external verification fails" in
`database/release/059-release-plan.md`.
