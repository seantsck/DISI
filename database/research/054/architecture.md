# 054 architecture: the Dodgers asset ledger and the player's career history

Written after auditing the schema and before any 054 data. Result: **one new table and one new view.** The Dodgers asset ledger is not extended.

## Why the existing ledger cannot hold a third-party move

All 223 canonical events in `transaction_events` are recorded from the Dodgers' side (`from_organization_id` is BRO or LAD; the 053 check
`transaction_ledger_side_violations` keeps it so). Everything built on it assumes that:

| Consumer | What it would do with a Cincinnati -> Cleveland trade of Yasiel Puig |
|---|---|
| `v_player_control_intervals` | read an OUTGOING player row as a Dodgers exit and an INCOMING one as an acquisition, opening or closing a Dodgers control interval |
| `v_dodgers_international_exit_summary` | count it as a Dodgers exit mechanism |
| `v_trade_realization_edges`, `v_dodgers_trade_package_conversion`, `v_transaction_asset_lineage`, `v_downstream_organizational_realization` | read it as a Dodgers trade package with a return to value |
| `v_transaction_research_queue`, `v_value_research_queue` | raise exit, return and attribution items for it |
| `v_player_transactions` (the dossier's asset history, `/asset-conversion`) | show it as a Dodgers trade |

None of these views filters on the from-organization, because it was always the Dodgers. **DODGERS ASSET TRANSACTION != GENERAL CAREER TRANSACTION.**

## The career-history layer

| Object | What it is |
|---|---|
| `player_career_transactions` | one sourced movement fact about one player, in his direction: `TRADE`, `WAIVER_CLAIM`, `PURCHASE` (both clubs named), `RELEASE` (no destination), `FREE_AGENT_SIGNING` (no origin). A CHECK fixes the shape per mechanism. Each row cites a source and names the source row (`MLB transaction <id>`, `Retrosheet transaction <id>`). Organizations are `organizations` ids. RLS, a read policy, SELECT-only grants. No package, no return, no value, no attribution columns. |
| `v_player_career_transactions` | the player's transaction stream, `security_invoker`: the Dodgers-ledger rows turned to the player's direction (an INCOMING asset reads counterparty -> Dodgers) labelled `DODGERS_LEDGER`, and the career rows labelled `CAREER_HISTORY`. Read by the dossier and `/development` for chronology, and listed in the product contract. |

Only the five types the 33 transitions need exist. A Dodgers transaction is never copied into career history: no row may name a Dodgers
organization (`career_transaction_dodgers_ledger_overlap_violations`), so the two layers never duplicate one another, and a distinct third-party
event in a season with a Dodgers move (a later club's signing after a Dodgers release) is not a conflict.

## The relationship between the two layers

- The ledger is the only layer organizational value reads: packages, returns, control intervals, attribution, both research queues. Career
  history reaches **no** asset, package, control or value view (`career_transaction_asset_leakage_violations`: only the stream and the research
  queue read the table, and nothing reads the stream).
- Both layers explain chronology. The research queue's `MULTI_ORG_SEASON_UNVERIFIED` condition counts, for a season with exactly two
  organizations whose stints are all game-dated: the 053 Dodgers-ledger explanations; a career move from the first club to the second inside the
  bracket; and a career exit from the first club paired with a later career entry to the second, both inside the bracket (a release and a signing,
  or a move through a third club). Exactly one explanation closes the season; two or more stay open for a person.
- A release and a later signing are two rows. The layer never synthesizes `A -> B` from them: `A -> free agency -> B` is two transactions.

## What does not change

No ledger row, package, resolution, control observation or control interval; no development stint, milestone or decision; no outcome, WAR or cost
row; no feature, support, evaluation or probability. The persisted snapshots read none of the new objects; the executive snapshot counts the
product contract, which gains one relation (47 -> 48), so the migration refreshes once.

## Verifier (255 -> 258)

- `career_transaction_dodgers_ledger_overlap_violations`: no career row names a Dodgers organization or repeats a Dodgers-ledger movement of the
  same player on the same date.
- `career_transaction_shape_violations`: the mechanism's shape, a source and a source row on every row; one movement fact is one row.
- `career_transaction_asset_leakage_violations`: only the stream and the research queue read career history; nothing reads the stream; the stream
  labels every career row `CAREER_HISTORY`.

Identity and organization endpoints are foreign keys, so no separate check pins them. `EXPECTATIONS_THROUGH_053` keeps 155 views and 78 tables.
