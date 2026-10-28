# 057 research notes

## Owner decisions applied (2026-10-28)

- **Archived captures are canonical evidence.** The exact accepted Baseball-Reference bulk files are approved when read as Internet Archive
  captures of their original URLs. The live files answer 403 behind a Cloudflare challenge, which is not worked around.
  - Each capture is pinned three ways: the CDX digest, which is the SHA-1 in base32 of the archived payload and was recomputed and matched; the
    payload SHA-256; and the decoded file's SHA-256.
  - Source kind is unchanged: `WAR_DATA_FILE` / `BASEBALL_REFERENCE`.
  - No fWAR, WARP, estimate or copied number is used.
- **Completeness.** Only reachers whose 10-season horizon ends by 2025 are loaded. The batting capture (2026-09-11) is mid-season for 2026, and
  the pitching capture (2026-02-10) ends with 2025.
  - Gabriel Arias, Jorge Oña, Luis García Jr. and Francisco Morales (horizon 2026) are deferred until a capture taken after the 2026 season
    exists. Their partial 2026 rows are not loaded, even where the label looks obvious.
- **Identities.** Yrizarry (birth-country conflict), Rosario and Amundaray stay unresolved.
  - Amundaray now has an official MLB person record: 660657, Jonathan Jonas Amundaray, born 1998-05-11 in Maturín, RF. It shows a Yankees DSL
    assignment on 2015-05-29 and a release on 2018-06-02.
  - There is still no signing (SFA) transaction, which the 050 rule requires. An assignment corroborates; it is not a signing.
- **Stored evaluation.** The evaluation is stored for the two bWAR targets so the database itself records that BASELINE SUPPORTED is not MODEL
  SUPPORTED.

## Findings

- **`BWAR_MISSING` does not move (50 → 50).**
  - That research task reads `v_player_war.career_bwar`, which is the latest `player_metric_observations` `CAREER_BWAR` (017 and 018). It does not
    read team-season rows.
  - 057 follows the 035 rule exactly: it sets `outcomes.career_war` and writes no metric observation. The eleven therefore keep their
    `BWAR_MISSING` task, exactly as the eleven 035 players already do (Devers, Torres and the others).
  - The feasibility pass expected 11 tasks to close. That was wrong.
  - Closing them would require either a `CAREER_BWAR` observation for the 22 benchmark players with loaded rows, or a task rule that reads
    team-season rows. Either is a separate owner decision.
  - The probability research queue does move: `LABEL_BLOCKED_BY_MISSING_AUDIT` goes from 18 to 7 for each bWAR target. The 7 that remain are the
    four deferred reachers and the three identities.
- **The Prediction Readiness count goes from 1 to 2, not from none to one.** "Benchmark reference baselines" already counted the benchmark reach
  baseline (supported since 050), so it reads 1 → 2.
  - The "Benchmark support is not Dodgers support" guardrail was already visible. It now names both targets, and its grammar was made plural.
- **Rollback order.**
  - `rollback-057` retracts the 54 rows; the 032 guard forbids deleting a team-season fact. It sets the eleven career values back to NULL and
    removes the six bWAR evaluation rows.
  - `rollback-050` refuses once any team-season row exists for a player it covers, retracted rows included. It covers ten of the eleven (all but
    Emmanuel DeJesus, who was in DISI before 050), so it is no longer available after 057 has been applied once. The ledger never deletes.
  - Erratum: earlier text, including the comment in the released `rollback-057.sql` (left byte-identical), said "all eleven".
  - `rollback-055` and `rollback-056` are unaffected.
- **Career bWAR runs through 2025.** For the ten active 2015-class players, `outcomes.career_war` is the sum of the loaded rows through 2025. The
  2026 season is not loaded.

## Follow-up (not 057)

- **Transaction-value WAR.** Jon Garland (2009 LAD stint 2), Mudcat Grant (1968 LAD), Zoilo Versalles (1968 LAD) and Jim Leyritz (2000 LAD) have
  complete rows in the same captures. They belong to the transaction / value domain:
  - Garland and Leyritz are pinned in `transaction_war_unavailable_mlb_ids`.
  - Versalles's 1969 WSA stint has no `bref_team_code_map` row.
  - Loading them needs its own migration and postconditions.
- **The four 2016-class reachers.** Load them from a capture taken after the 2026 season. Their window would then be complete.
