# Migration 033 schema design

## transaction_events (extended)

| Column | Meaning |
|---|---|
| `is_multi_team` | `true` when Dodgers assets moved with more than one counterparty (2024-07-29 only). Flows that never entered or left Dodgers control are not modeled. |
| `historical_label` | Historical mechanism wording where it differs from the normalized type (Clemente: minor-league ("Rule 5") draft; Garcia: 1997 expansion draft, 9th pick; "Elected free agency"; "Granted free agency"; "Released"; "Claimed off waivers"). |
| `transaction_type` | Closed list: TRADE, RELEASE, WAIVER, SALE, OTHER (pre-existing) plus RULE5_SELECTION, FREE_AGENCY, EXPANSION_DRAFT. No fact in 033 needed SALE or OTHER. |

## transaction_event_assets (extended)

| Column | Meaning |
|---|---|
| `player_id` | A DISI tracked signing only. No `players` row is ever created for a return asset. |
| `mlb_id` | Official MLBAM person id when verified against the official log person ids. PLAYER only, digits only. |
| `bref_id` | Baseball-Reference major-league / career id (`^[a-z0-9]+$`, the 032 constraint, not relaxed). |
| `bref_register_id` | Baseball-Reference Register (minor-league) id, e.g. `gooch-001arn`. A separate namespace with its own constraint; a Register id can never sit in `bref_id`. |
| `counterparty_organization_id` | Where this asset came from / went to, relative to the Dodgers. Required to read multi-team events. |
| `cash_amount_usd`, `pool_space_amount_usd` | Sourced amounts; allowed only on CASH / INTERNATIONAL_BONUS_POOL_SPACE. NULL means unknown, never zero. |
| `asset_type` | Closed list of the five observed types. No DRAFT_PICK or OTHER without a real case. |

`asset_side` stays relative to the Dodgers (OUTGOING / INCOMING).

## transaction_asset_resolutions (new, append-only)

Records what a placeholder consideration (PLAYER_TO_BE_NAMED or FUTURE_CONSIDERATIONS) later became. The placeholder asset is
never rewritten. A NAMED_PLAYER resolution points at a PLAYER asset of the same event and side; CASH_SETTLEMENT carries an
optional sourced amount. Guard: insert only as ACTIVE, no self-resolution, no incompatible asset, no second ACTIVE resolution
for a placeholder (also a partial unique index), never dated before the transaction, never deleted, and the only update
allowed is retraction (a correction retracts and re-inserts).

Four rows are seeded: Boston 2012 PTBNL #1 and #2 (De La Rosa, Sands), Fernandez 1957 (Ben Flowers) and Valdez 1999 (Brian
Stephenson - found during implementation on the Baseball-Reference LAD 1999 page; Phase 1B had listed this placeholder as
unresolved). Frias 2017 and the 2024 "PTBNL or cash" stay unresolved.

## dodgers_control_observations (new, append-only)

A dated, sourced observation about Dodgers control or MLB appearance, always with `observed_through_date`.

| Type | Subject | Meaning |
|---|---|---|
| `DODGERS_CONTROL_OBSERVED` | player or asset | The official log shows continued Dodgers-organization activity and no exit through the date. |
| `HISTORY_UNAVAILABLE` | player | The log does not establish the control history (Julian Leon, Lenix Osuna). No exit was inferred. |
| `NO_MLB_APPEARANCE_OBSERVED` | asset | No MLB appearance observed through the date (official career statistics empty, or a Baseball-Reference Register-only record). Never "will never reach MLB". |
| `CAREER_ENDED_WITH_DODGERS` | asset | The last MLB team-season in the Baseball-Reference files is with the Dodgers; mechanism unrecorded. |
| `EXIT_MECHANISM_UNRECORDED` | asset | The player left but no Dodgers exit transaction appears (Punto, Bailey). |

This is the smallest additive structure that carries an explicit observation boundary: the existing `evidence` table has no
date or value, and `player_metric_observations` is keyed to DISI players and numeric values. It brings the schema to 58
tables (the plan had 57).

## Return states (`v_trade_realization_edges.return_state`)

| State | Meaning | Player return bWAR |
|---|---|---|
| `LOADED` | An incoming player with loaded team-season facts and resolved acquisition timing | his Dodgers bWAR after the acquisition |
| `NO_MLB_APPEARANCE_OBSERVED` | An incoming player with a dated no-MLB-appearance observation | 0, valid only through the observation date |
| `NO_PLAYER_RETURN` | The complete incoming package is verified to contain no player (cash, future considerations, pool space) | 0 (not a statement about total transaction value) |
| `PLAYER_RETURN_PENDING` | A player to be named later is unresolved | NULL |
| `RETURN_UNRECORDED` | No incoming consideration is recorded | NULL |
| `RETURN_WAR_UNKNOWN` | An incoming player with no identity or no facts and no observation | NULL |
| `TIMING_UNRESOLVED` | A same-season Dodgers stint cannot be ordered against the counterparty stint (032 rule) | NULL |

Timing uses the asset-level counterparty (Edman is ordered against St. Louis, Kopech against the White Sox).

## Views

- `v_transaction_event_complete` - one row per event: Dodgers side, counterparties, asset counts, package and identity
  completeness, unresolved placeholders, unknown amounts, provenance, legacy match.
- `v_transaction_asset_chain_readiness` - one row per incoming PLAYER asset of a trade involving a tracked signing: identity,
  WAR availability, later exit, status (`EXIT_EVENT_RECORDED`, `STILL_WITH_DODGERS`, `CAREER_ENDED_WITH_DODGERS`,
  `HISTORY_INCOMPLETE`, `EXIT_NOT_RESEARCHED`, `IDENTITY_UNRESOLVED`). No value.
- `v_dodgers_international_exit_summary` - one row per tracked signing: `LEFT_DODGERS_CONTROL`, `STILL_DODGERS_CONTROLLED`,
  `NO_EXIT_EVIDENCE`, `HISTORY_UNAVAILABLE`, first exit, counterparties, shared package, return modeled, evidence tier.
- `v_transaction_research_queue` - derived deficiencies (counts are never fixed).
- `v_trade_realization_edges` (amended) - restricted to trades with a tracked outgoing asset; one row per incoming PLAYER
  asset or one event-level row with an explicit state; 032 attribution and timing semantics unchanged.
- The other three 032 views are recreated unchanged except that `v_player_organizational_realization` reads `return_state`.

## Security

Both new tables: RLS, SELECT policy, SELECT-only grants to anon / authenticated, no PUBLIC. Both guards: SECURITY INVOKER,
`search_path=''`, EXECUTE revoked from PUBLIC / anon / authenticated. All views `security_invoker`, SELECT-only.
