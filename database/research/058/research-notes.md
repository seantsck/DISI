# 058 research notes

## Decisions (owner-approved after the feasibility pass)

- **Scope: all four.** Garland, Leyritz, Grant and Versalles each have a verified transaction asset (MLBAM and Baseball-Reference ids, provenance
  from 049 / 053), complete rows in the 057 captures, and a Dodgers value the existing rules can place. Grant and Versalles belong together: only
  both close the Chico Fernandez chain.
- **No new source.** The rows cite the two 057 source rows; the files are the same, so registering them twice would duplicate provenance.
- **No new player.** Returned players join team-season WAR by the asset's `bref_id`; 1,123 earlier rows already carry `player_id` NULL this way.
- **Full career rows.** The established returned-player pattern, and an architectural need: the counterparty's single stint in the acquisition
  season (`cp_ord`) is what makes the Dodgers stint `cp_ord + 1` "after the trade". Loading only Dodgers rows would leave Garland and Leyritz
  `TIMING_UNRESOLVED`.
- **Versalles 1969 WSA not loaded; no WSA mapping.** The row is a non-Dodgers season after his 1968-10-14 exit, so it cannot change his value
  (−1.12 with or without it, proven in `tests/db/research-058.test.mjs`). Loaded with a NULL organization it would only raise
  `TEAM_HISTORY_UNRESOLVED` and break the global no-unmapped-organization checks of 032–035. Adding a mapping for one row outside the window is
  not needed and was not approved.

## Findings

- **KNOWN RETURN WAR != ATTRIBUTABLE SIGNING VALUE.** Only Garland adds to a signing (Abreu, the sole outgoing asset). Leyritz is shared-package
  value (Vizcaino and cash went out); Grant and Versalles are observable chain value (Miller, Roseboro and Perranoski went out, none a tracked
  signing). Negative WAR stays negative.
- **OLDER VIEW != VALUE OF RECORD.** The 033 edge view is not bounded by a later exit and shows Garland 0.31 (his 2011 Dodgers stint included);
  `v_player_organizational_realization` repeats it. The value of record is the 034 interval-bounded 0.17. Casey Blake already shows the same split
  (9.16 / 0.94). No application code reads the 033 figures. Not redesigned here.
- **Garland 2011.** His 2011 Dodgers stint is after his recorded exit with no recorded re-acquisition. The existing queue exposes it as
  `DODGERS_RETURN_WITHOUT_RECORDED_ACQUISITION` (5 → 6) and credits it to no trade.
- **Queue total.** The feasibility report said the transaction queue "stays 58". The issue movements it listed (−2, +1) give 57; the total was
  mis-summed. The build derives the total from the movements and checks it.
- **Source sharing has a cost.** The released rollback-057 refuses when any row of another player, active or retracted, cites its sources; the
  frozen 057's postconditions count every row on them. After 058 has been applied once, neither runs again, even after rollback-058. Both
  refusals change nothing. Accepted: the alternative is duplicate sources or editing released files.
- **Generation.** A canonical replay reaches generation 12 after 057; production is at 13 (one extra manual refresh after an earlier release). The
  migration guards drift 0 before and exactly one new generation after; the absolute production generation (13 → 14) is a release-plan check.
- **Not in scope.** The other four `WAR_NOT_LOADED` assets (Roberts, Garcia, Muegge, Juárez) have no Baseball-Reference id and no row in either
  capture. Absence from a file is not zero; their value stays unknown and no observation is created.
- **`BWAR_MISSING`** reads `CAREER_BWAR` metric observations, a separate layer; it stays 50. No career observation is written.
