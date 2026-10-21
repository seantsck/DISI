# Research behind migration 049

`database/sql/049_transaction_package_completion.sql` and `database/release/sql/rollback-049.sql` are generated from this folder.

```
node database/research/049/derive-transactions.mjs <dir>    # tran.txt + biofile.csv + register/ + api/ + web/ -> transaction-evidence.json
node database/research/049/build.mjs                         # template + evidence -> the migration and its rollback (deterministic)
node database/research/049/measure.mjs <dataset.json>      # the transaction / value measures (baseline.json is the pre-049 state)
```

| File | Purpose |
|---|---|
| `transaction-evidence.json` | the Abreu / Garland correction (exact Retrosheet rows and official MLB log rows), the 1967 package and the three exits (exact rows, identities with matched birth dates, the SABR second reading), four reconciled identities, and every issue the research could not close with the reason |
| `049_template.sql` / `rollback_template.sql` | hand-written guards, steps, proofs and postconditions |
| `baseline.json` | the pre-049 measures read from production on 2026-10-21 (generation 6) |
| `architecture.md` | the gap analysis: why no schema change, and the one verifier rule that coupled a transaction to its valuation |
| `transaction-research-notes.md` | where each open chain and package stands, issue by issue, with the result vocabulary |

## The research, in order

1. **Baseline.** 220 signings; 209 events, 387 assets; seven incomplete chains (Fernández, Amorós, Mondesí, Nomo, Frías, Offerman, Abreu); 21 trade packages
   with an open issue; transaction queue 59, value queue 91; attribution states `CHAIN_INCOMPLETE` 7, `INDIVIDUALLY_ATTRIBUTED` 6, `PACKAGE_LEVEL_ONLY` 13,
   `RECORDED_ZERO_RETURN` 5, `RETURN_STILL_ACCRUING` 10, `VALUE_NOT_DETERMINED` 4, `NOT_A_TRADE_EXIT` 175.
2. **The central question.** Can a known transaction be recorded while its returned player's value is `NULL`? The model says yes
   (`RETURN_WAR_UNKNOWN`, `INCOMPLETE_WAR_NOT_LOADED`). One verifier rule said no (`transaction_asset_identity_consistency_violations` required every returned
   player of a tracked-signing trade to have loaded WAR). 049 narrows that rule to one pinned id instead of removing it.
3. **Sources tried.** Retrosheet `tranDB.zip` and BIOFILE (read directly); the Chadwick Register (id crosswalk); the official MLB Stats API (person
   records, transaction logs by player and by club, season-by-season affiliations including the minors); SABR biographies (raw HTML, used for the 1967
   package and the 1968 expansion draft; the Harris, Checo and minor-leaguer pages carry no body text in the raw response); Wikipedia (discovery for Checo and
   Harris only). Baseball-Reference `war_daily_bat.txt` and `war_daily_pitch.txt` answered **403** again: no WAR was loaded.
4. **Recorded:** the Abreu / Garland trade (corrected forward), Garland's free agency, the 1967 Dodgers-Twins trade, the 1968 expansion-draft exits of Grant and
   Versalles, and four MLB ids. **Not recorded, on purpose:** every exit no readable source states, every cash and pool-space amount, every unnamed return.
5. **Rehearsal.** The migration is replayed on PGlite and on PostgreSQL 17 (`database/release/pg17/validate-049.mjs`) with the full 247-check verifier, idempotency,
   the guarded rollback and re-application.

## What the batch changed, and what it did not

- Chains: seven incomplete, of which **five** have an open transaction history and **two** (Abreu, Fernández) are recorded to their end with the value of
  Garland, Grant and Versalles unknown. Packages with an open issue 21 to 20. Queues unchanged in size (59, 91) and different in composition.
- The Abreu trade's individually attributable amount was a recorded 0.00 while its return was unrecorded; it is now `NULL`.
- **One published figure moves:** with the return recorded and its WAR unknown, Abreu's organizational value is `VALUE_UNRESOLVED` instead of resolved at a false 0.00 return, so
  the executive totals read signings with resolved value 87 (was 88), realized direct Dodgers bWAR 282.77 (was 284.00) and realized organizational value 297.60 (was 298.83).
- It did **not** load any WAR, change any attribution, audit, cost, threshold, probability, expected value or recommendation, or touch a cash,
  pool-space or future-consideration row.

## Findings worth keeping

- A trade's **agreement date** and its **completion date** are different facts. DISI stored the completion (the MLB log row of the delivered player) as the
  trade. Re-dating to the agreement keeps the return's WAR measured from the right moment; the completion date stays in the record.
- A resolved "player to be named later" placeholder and the player it resolved to are two outgoing assets to the model. For a one-player trade that makes a
  sole-outgoing trade look shared in the older package views, so 049 records the delivery in the notes instead of adding a placeholder.
- Disappearance from later records is not a release. Four of the six unresolved minor-league assets are demonstrably still in the Dodgers organization
  in the last season any source records; none of them has a stated exit.
