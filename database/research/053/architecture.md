# 053 architectural gap analysis

Written before any 053 data. Result: **no schema change.** One detector condition is corrected; the transaction ledger already represents every
fact 053 records; three read-only verifier checks guard the boundaries the research relies on.

## What the ledger is

Every one of the 213 canonical events is recorded **from the Dodgers' side**: `transaction_events.from_organization_id` is a Dodgers organization
(BRO or LAD), `to_organization_id` is the counterparty or NULL (a release, a free agency, a free-agent signing), and each asset's `asset_side` says
which way it moved. An INCOMING player came from the counterparty to the Dodgers.

The asset views (`v_dodgers_international_exit_summary`, `v_dodgers_trade_package_conversion`, `v_transaction_asset_lineage`,
`v_downstream_organizational_realization`, `v_player_control_intervals`) rely on that: none of them filters on the from-organization, because it
was always the Dodgers. A trade between two other clubs recorded there would read as a Dodgers trade exit, a package, a lineage hop and a control
interval. **Recording later organization history in this ledger would contaminate the Dodgers asset views.** 053 therefore records Dodgers
transactions only, and `transaction_ledger_side_violations` makes the rule a verifier check. A ledger of other clubs' transactions would be a new
table with its own security review: not 053.

## What the 052 detector got wrong

`MULTI_ORG_SEASON_UNVERIFIED` closed a season only for one transaction whose `from_organization` and `to_organization` were the season's two
organizations, with the last game for the first on or before the date and the first game for the second on or after it.

| Gap | Effect | 053 |
|---|---|---|
| It read the ledger's columns, not the player's direction | every acquisition is read backwards (Dodgers -> counterparty); latent today, since the one acquisition in a two-organization season (Valdez 2000) predates game logs | the direction comes from `asset_side` (`playerMove`) |
| It required a counterparty | a release, a free agency and a free-agent signing can never bracket a season, so a Dodgers boundary the ledger records (Leon's 2026 release) stays open by construction | `BRACKETED_AT_DODGERS_BOUNDARY`: one Dodgers transaction with one known end, inside the bracket, in the dated order of the move |
| One bracketing transaction was enough, of any number | two bracketing transactions would close the season with no decision | exactly one; two or more are `MULTIPLE_POSSIBLE_TRANSACTIONS` (a person decides) |

A transaction with one known end concerns the move only when the dated order agrees with its direction: a Dodgers release after a season that began
elsewhere and ended with the Dodgers (Baez 2022) is a later exit, not this move. The pure rule (`lib/research/development-chronology.js`) and the
view condition (`multi-org-detector.sql`) are the same rule; `tests/db/research-053.test.mjs` proves they flag the same players.

## Reused structures

| Need | Existing structure |
|---|---|
| a re-acquisition | an INCOMING asset of the player: `v_player_control_intervals` opens an interval at it (the Valdez 2000 precedent) |
| a free-agent signing | `FREE_AGENT_SIGNING`, no counterparty, one INCOMING player (the Blake and Sharperson precedents) |
| a trade return whose WAR is not loaded | `RETURN_WAR_UNKNOWN` with a NULL bWAR, accepted by the identity check only for a pinned id (the 049 Garland precedent; 053 pins Leyritz) |
| cash of unstated amount | a CASH asset with `cash_amount_usd` NULL (CASH_AMOUNT_UNKNOWN) |
| the adjacent hop | the returned player's own Dodgers exit (Leyritz's free agency), so his interval closes on a stated date |

## What 053 does not use, and why

- **`dodgers_control_observations` is sealed**: a row is never deleted, only retracted, and its assets cannot be deleted while it exists. A
  migration that writes one cannot be rolled back to its exact pre-state. Juan Castro's 2000 trade to Cincinnati returned a minor leaguer (Kenny
  Lutz) with no WAR and no Baseball-Reference id; recording the trade needs the observation that Lutz never reached the majors. The trade, his 2009
  and December 2010 re-signings (which would overlap the 1991 interval without it) and his 2011 retirement are therefore stated in the evidence and
  not recorded. 049 avoided the sealed resolution table for the same reason.
- **No new transaction type.** Retirement is not a transaction; the schema's types cover every mechanism 053 records.
- **No new table or column.** Scope and blocker class are functions of the rows, derived in the research tooling and stored nowhere.

## Verifier

Three read-only checks (252 -> 255), each true on the 052 state too:

- `transaction_ledger_side_violations`: every event's from-organization is a Dodgers organization.
- `transaction_mechanism_shape_violations`: a release or a free agency lets players go to no counterparty and returns nothing; a free-agent signing
  brings players in from no counterparty and sends nothing (RELEASE != TRADE; FREE-AGENT SIGNING != TRADE RETURN).
- `control_interval_overlap_violations`: two control intervals of one identity never overlap (an acquisition recorded without the exit before it
  would).

`EXPECTATIONS_THROUGH_052` keeps the pre-053 pin list (Garland only).
