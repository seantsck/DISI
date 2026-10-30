# 059 research notes

## Decisions (owner-approved after the feasibility pass)

- **Semantics: career-to-date as of a date.** `CAREER_BWAR` is what 017 defines: a dated Baseball-Reference bWAR observation, one row per player and
  observation date "so active-player totals keep their history"; `v_player_war` reads the latest. Eleven of the 47 existing observations belong to
  players with a 2026 season, and the dossier renders "Through the 2026 season · active player, total still changing". Active MLB status is not a
  blocker; the 059 values are career-to-date through 2026, not final career values. The semantic is not redesigned.
- **Scope: the eleven 035 players.** Each has one benchmark signing, a stable MLBAM / Baseball-Reference identity, and a complete mapped ledger
  from the 2026-09-28 live files (every row of the player in both files, 032's filters; no TOT, no unmapped team, no duplicate stint), and a stored
  `outcomes.career_war` equal to the ledger sum.
- **The 032 pattern.** round(sum(war), 1) over the ACTIVE BWAR BAT + PITCH rows (PostgreSQL numeric rounding, half away from zero: Herrera −0.65 →
  −0.7, Espinoza −0.02 → 0.0); observed through 2026-09-28 (the files' date, as 032's Eddys Leonard observation) and the 2026 season; the batting
  data-file source is cited and the pitching file is named in the notes. The table holds one source per row; every summed ledger row keeps its own
  source, so the derivation stays exact. No schema change, no new source (3384).
- **Notes pin both files.** Each note names the derivation, the player's MLBAM and Baseball-Reference ids, the as-of, and both file URLs with the
  SHA-256 values 032 and 035 pinned (`ef920800…`, `061df2f8…`).

## Findings

- **OUTCOME CAREER_WAR FIELD != CAREER_BWAR METRIC.** The benchmark outcome spine (`v_international_benchmark_player_outcomes`,
  `v_player_realized_outcome`) and the 10-season labels (`window_bwar`) read team-season rows directly; `career_bwar` passes through
  `v_outcome_training_population` unused. A new observation moves no label, feature, support row, evaluation or output (proven in the tests).
- **CAREER_BWAR != TRANSACTION RETURN VALUE INPUT.** Organizational and transaction value read team-season rows (Dodgers signings only); the eleven
  are benchmark signings. Every value view is byte-identical.
- **No snapshot content changes.** The persisted snapshots that carry bWAR are Dodgers-scoped (`signings_with_bwar` 47, open tasks 349). 059 still
  refreshes once, by the migration convention, only when it adds an observation.
- **The 057 eleven are not reconciled.** Their rows stop at 2025 (057 excluded the partial 2026 batting season) and cite the `web.archive.org`
  captures; the provider trigger accepts only a Baseball-Reference URL, and citing the live file for rows not read from it would be false
  provenance. All eleven played in 2026: Soto's 42.57 is a through-2025 total, not a current career value. 10-SEASON WINDOW COMPLETE != CAREER
  COMPLETE. A separate decision.
- **The other 28** BWAR_MISSING players have no team-season WAR. Their value stays unknown, never zero.
- **Cross-check.** All 47 existing observations reconcile with their ledgers within 0.05 (5 exact, 42 rounding); the verifier tolerance is 0.1.
- **Rollback.** Metric observations have no ACTIVE / RETRACTED lifecycle; the rollback deletes exactly the eleven 059 rows, matched on every
  column, and refuses a later or changed observation. No source, ledger row or rollback dependency is created: no released rollback reads
  `player_metric_observations`, and 059 adds nothing on the 057 sources.

## First production attempt and the timeout fix (2026-10-29)

- The first candidate (sha256 `88d0ef1e…`) was cancelled on production by the hosted `statement_timeout = 2min` inside its postcondition `DO`
  block (20:49:37Z → 20:53:47Z, exit 3) and rolled back whole; production was re-read byte-identical afterwards. 059 was not applied.
- 059 and rollback-059 now `set local statement_timeout = '600s'` right after `begin;` (the `refresh-product-snapshots.sql` convention), scoped to
  their own transaction. Nothing else changed: scope, values, as-of, provenance, guards and snapshot behaviour are as reviewed.
- Rehearsals run with a 2min server default; a tighter outer limit proves the superseded bytes fail and the corrected ones commit.
