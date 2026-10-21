# 049 architectural gap analysis

Written before any 049 schema decision. Result: **no schema change is necessary.** The existing model represents every fact 049 needs. One verifier rule
(not the schema) coupled a transaction to the availability of its valuation and is narrowed.

## Reused structures

| Need (spec phase) | Existing structure | Used for |
|---|---|---|
| a known transaction with an unknown value (3) | `v_trade_realization_edges.return_state = 'RETURN_WAR_UNKNOWN'` (incoming PLAYER asset with no team-season WAR → `NO_TEAM_SEASON_FACTS`), `v_downstream_organizational_realization.chain_status = 'INCOMPLETE_WAR_NOT_LOADED'`, `v_transaction_package_lineage.war_state = 'WAR_NOT_LOADED'` with a NULL interval value | Abreu / Garland, Miller / Grant / Versalles |
| transaction events and assets (2, 12) | `transaction_events`, `transaction_event_assets` (side, type, MLB / Baseball-Reference ids, counterparty) | the package, the exits, the identities |
| exits (2) | `TRADE`, `FREE_AGENCY`, `EXPANSION_DRAFT` events (the 1997 expansion-draft exit is the precedent) | Miller's trade, Garland, Grant, Versalles |
| a deferred player (11) | `transaction_asset_resolutions` (sealed), the Navarro / Maddux placeholder pattern | considered and **not** used for a one-player trade (below) |
| value (4, 5) | `player_mlb_team_season_war` (`war_system = 'BWAR'` only), the 032 / 033 counterparty-order timing rule, `CAREER_BWAR` provenance trigger | unchanged; nothing loaded |
| attribution (6) | `individual_attribution_permitted` = exactly one outgoing asset, one of them tracked | unchanged |
| blocker classification (1) | none needed: derived in `lib/research/transaction-research.js` | `ISSUE_BUCKET`, `chainBlocker`, `packageBlockerSplit` |

## Was transaction truth coupled to value?

- **In the views: no.** A returned player without WAR yields `RETURN_WAR_UNKNOWN`; the lineage yields `INCOMPLETE_WAR_NOT_LOADED`; neither hides the transaction.
- **In the verifier: yes.** `transaction_asset_identity_consistency_violations` flagged any returned player of a tracked-signing trade who had neither loaded
  WAR nor an observed zero, so recording the Abreu return (Garland) failed the 247-check verifier. 047 recorded neither Miller's exit nor Abreu's return for
  that reason. 049 pins the one id (Garland, MLB 279782) and accepts it only while the model shows `RETURN_WAR_UNKNOWN` with a NULL bWAR; any other returned
  player without WAR is still a violation, and removing the pin makes the same data fail. The Miller trade has no tracked outgoing asset, so it never hit the rule.
- **In the reporting: yes.** `attributionState` read every `INCOMPLETE_*` chain as `CHAIN_INCOMPLETE`, so a recorded chain whose WAR is not loaded looked like an
  open transaction history. `INCOMPLETE_WAR_NOT_LOADED` and `INCOMPLETE_TIMING` now read as `VALUE_NOT_DETERMINED`.

## Gaps found, and what 049 did about each

| Gap | Decision |
|---|---|
| the Abreu trade stored the PTBNL delivery date as the trade, with no return | corrected forward: event date = agreement (2009-08-31), Garland incoming, the delivery date in the description and the asset note |
| a PTBNL placeholder would count as a second outgoing asset (`outgoing_asset_count`, `individual_attribution_permitted`, and the older 009 / 017 package views that call `outgoing_asset_count = 1` a sole-outgoing trade) | **no placeholder** when the named player is the only outgoing asset. Changing the counting would mean redefining six views in four migrations; not necessary for a one-player trade |
| a verifier rule that couples a transaction to its valuation | narrowed to one pinned, reviewed id |
| "incomplete" mixes missing history, missing terms and missing value | derived buckets in the research tooling (no enum, no table) |
| four incoming assets recorded by name only | MLB ids, reconciled by bracketing season-by-season affiliations |
| the sealed resolution table cannot be rolled back by deletion | avoided: 049 adds no resolution, so its rollback restores the three transaction tables exactly |

## Why a new table or column would be wrong

- The blocker buckets and attribution states are functions of the queues and the decision snapshot; storing them would duplicate derivable facts.
- A trade with an unknown value is already representable. Adding a "value unknown" flag would store the absence of data.
- Every table that would be exposed needs RLS, grants, policies and a Data API audit; none is needed.
