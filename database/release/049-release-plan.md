# DISI 049 release plan: transaction-package completion

A research-data migration plus tooling and wording changes (blocker classification, package split, asset-conversion and dossier wording, a pinned verifier
exception). **Not applied to production.** Applying it, merging the PR and any deploy need explicit owner approval.

## What changes

| | Before | After |
|---|---|---|
| Schema (tables / views / functions / grants / policies) | 78 / 155 / 8 | unchanged |
| Transaction events / assets | 209 / 387 | 213 / 396 (+4 events, +9 assets) |
| Transaction asset resolutions | 7 | 7 (049 adds none) |
| Sources | 2467 | 2472 (the Garland MLB log, the Chadwick Register, three SABR biographies) |
| Baseball-Reference team-season WAR rows | unchanged | unchanged (no WAR is loaded; the files answer 403) |
| Incomplete chains (database names) | 7 | 7: `INCOMPLETE_EXIT_NOT_RESEARCHED` 4 to 3, `INCOMPLETE_RETURN_UNRECORDED` 2 to 1, `INCOMPLETE_WAR_NOT_LOADED` 0 to 2 |
| ... of which transaction history open / recorded with value unknown | 7 / 0 | 5 / 2 |
| Attribution states | `CHAIN_INCOMPLETE` 7, `VALUE_NOT_DETERMINED` 4 | `CHAIN_INCOMPLETE` 5, `VALUE_NOT_DETERMINED` 6 (others unchanged) |
| Trade packages with an open issue | 21 (membership open 6, only terms open 15) | 20 (membership open 5, only terms open 15) |
| Transaction queue / value queue | 59 / 91 | 59 / 91 (`TRADE_RETURN_UNRECORDED` 1 to 0, `EXIT_NOT_RESEARCHED_DOWNSTREAM` 6 to 5, `DOWNSTREAM_WAR_NOT_LOADED` 4 to 6) |
| Tony Abreu individually attributable trade bWAR | recorded `0.00` (return unrecorded) | `NULL` (return recorded, WAR unknown) |
| **Published figures that move** (home page, `product_executive_snapshot`): signings with resolved value / realized direct Dodgers bWAR / realized organizational value | 88 / 284.00 / 298.83 | **87 / 282.77 / 297.60**: Abreu's 1.23 direct bWAR leaves the resolved-value set while his return's WAR is unknown (his organizational value is `VALUE_UNRESOLVED`, not his direct value alone). Before 049 the unrecorded return read as a `0.00` return. Individually attributable value (14.83) and every other signing are unchanged |
| Open research tasks, NOT_AUDITED, audits, known costs, spend | 349, 127, 93, 56, $121,700,237.33 | unchanged |
| Product snapshot generation | n | n + 1 (one refresh, run by the migration only because rows were added) |
| `/asset-conversion`, the dossier | | the three kinds of missing evidence, the reason attribution is withheld, the returned players named even when their value is unknown |

No threshold, audit, cost, probability, expected value or recommendation changes, no predictive layer becomes supported, no cash, pool-space or
future-consideration row changes, and no unknown becomes a zero.

## Files

| File | bytes | sha256 |
|---|---|---|
| `database/sql/049_transaction_package_completion.sql` | 27134 | `a92c3089d8527953278f65197873554119590c55398be9f5bd7a2990e886c892` |
| `database/release/sql/rollback-049.sql` | 14570 | `56c726017df1643fd226d6512ad84fbb8b2c4abeb96fad1330fc4fb649926248` |

## What the migration does

1. **The 2009 Tony Abreu trade, corrected forward.** The event moves from 2009-10-09 (the date the player to be named later was delivered, which is how
   DISI had stored it) to 2009-08-31 (the agreement), Jon Garland is added as the return, and the description quotes the text it replaces and names both
   dates. Abreu remains the only outgoing asset. No placeholder asset is added (it would count as a second outgoing asset), so no sealed resolution is written.
2. **The 1967 Dodgers-Twins trade** (Retrosheet 60573, read independently in three SABR biographies): Miller, Roseboro and Perranoski out; Grant and
   Versalles in; with the two 1968 expansion-draft exits and Garland's free agency (2009-11-05, official MLB log and Retrosheet 18248).
3. **Four MLB ids** (Garcia 472796, Roberts 425540, Muegge 458260, Juárez 452705) for assets recorded by name only, reconciled by season-by-season affiliations
   whose parent organizations bracket the trade. No exit is recorded for any of them, for Gail Harris or for Robinson Checo.
4. **Guards.** It refuses to run if the Abreu trade is not in the stored state or already records a different return, if Bob Miller's acquisition is not recorded
   with this identity or a later Dodgers exit is already recorded for him, if a named-only asset is not as researched, or if Garland, Grant or Versalles is already
   recorded in another transaction. Postconditions prove nothing else moved (every other event, all cash, pool-space and future-consideration rows, all WAR rows).
5. One conditional **snapshot refresh** (generation + 1), only when a transaction row changed.

## The verifier

Still 247 hard checks. `transaction_asset_identity_consistency_violations` required every returned player of a tracked-signing trade to have loaded WAR or an
observed zero. It now also accepts a player whose MLB id is pinned in `CANONICAL_EXPECTATIONS.transaction_war_unavailable_mlb_ids` (Jon Garland, 279782) **and**
whom the model shows as `RETURN_WAR_UNKNOWN` with a NULL Dodgers bWAR. Any other such player is still a violation, and removing the pin makes the same data fail
(tested). The 048 values are kept as `EXPECTATIONS_THROUGH_048`.

## Order

1. Back up (`pg_dump`, restore-verified).
2. Apply `049_transaction_package_completion.sql` through the safe runner (SHA-checked). One transaction; about a second on PG17 plus the refresh.
3. Verify: live verifier, drift 0, anon reads.
4. Merge the PR (normal merge commit); one Vercel production deploy. The old application keeps working against the new database (it reads the same
   relations; an unrecorded-to-recorded return only changes rows) and the new application against the old one (the wording reads columns that already exist).
5. Smoke the routes (Vercel SSO: needs an authenticated browser): `/asset-conversion` (Abreu, Fernandez), the Abreu and Fernandez dossiers, and the runtime errors.

Do not re-apply 049 in production to test idempotency (proven on PGlite and PostgreSQL 17). If step 2 fails nothing is committed.

## Expected verifier results

- Against production **before** applying 049: the candidate verifier passes **247/247** (049 moves no pinned count; the pinned id matches no asset yet).
- **After** applying: **247/247**, drift 0, one generation across the eleven snapshots.

## Rollback

`rollback-049.sql` (one transaction, guarded) deletes the four events and their assets, removes Garland from the Abreu trade, restores the trade's stored date,
description and asset note, clears the four ids, and refreshes once. The three transaction tables return to their **exact** pre-049 content (nothing here is
sealed and no resolution was added), and **049 can be applied again after its rollback** (the validator proves it). It refuses to run if later research depends on the
removed assets (a control or timing observation, a resolution) or if a later transaction was recorded for Garland, Grant, Versalles or Bob Miller. The source rows
stay as provenance. The application change needs no rollback.

## Evidence

`database/research/049/`: `transaction-evidence.json` (exact source rows, identities with matched birth dates, the SABR second reading, every issue the research
could not close with the reason), `baseline.json` (the pre-049 measures read from production on 2026-10-21), `transaction-research-notes.md`, `architecture.md` and
`README.md`. Independent validation: `database/release/pg17/run-049.sh`.
