# Migration 034 design

## Architecture: view-first, no stored graph

The transaction graph is factual after 033 (events, assets, stable identities, resolutions, observations). Lineage is derived:
an incoming PLAYER asset of event A -> the first later event of the same identity where it is OUTGOING. Identity matches on
`player_id`, `mlb_id`, `bref_id` or `bref_register_id`, never on names. There is no `chain_edges` table and no helper function.

## The one new table: `transaction_asset_timing_observations`

Sealed, append-only chronology facts attached to an incoming PLAYER asset (the start of a control interval). Distinct from
`dodgers_control_observations`, which states a bounded state through a date; a timing fact is a point in time.

| Column | Meaning |
|---|---|
| `subject_asset_id`, `event_id` | the incoming PLAYER asset and its acquisition event (the guard requires they agree) |
| `fact_type` | `FIRST_DODGERS_APPEARANCE`, `LAST_DODGERS_APPEARANCE`, `SEASON_START_CONFIRMS_POST_ACQUISITION`, `EXIT_BOUNDED_BEFORE` |
| `season` | required for the first three, null for `EXIT_BOUNDED_BEFORE`; must equal the year of `observed_date` |
| `observed_date`, `source_id`, `confidence`, `note` | the fact and its provenance; never dated before the acquisition |
| `record_status` ... | ACTIVE / RETRACTED; only retraction of an ACTIVE row is allowed |

Guard `disi_timing_observation_guard` is SECURITY INVOKER with `search_path=''`, EXECUTE revoked from PUBLIC / anon / authenticated.

## Views

- **`v_player_control_intervals`** one row per continuous Dodgers tenure (tracked signing, or incoming PLAYER asset of any acquisition
  event: trade, free-agent signing). Ends at the first later exit event of the same identity. `interval_bounded_dodgers_bwar` is
  acquisition-relative (the 032 counterparty stint rule, the calendar, no Dodgers stint that season, or a sourced chronology fact; the
  basis is exposed as `timing_resolution_basis`) and exit-relative from an exact-dated exit (an offseason exit, no Dodgers stint that season, or one contiguous Dodgers stint with no same-season re-entry; `exit_resolution_basis` names which; an approximate exit date never resolves a mid-season stint).
  A single Dodgers team row or the absence of an earlier modeled interval is not chronology evidence. An unplaceable stint gives NULL
  with state `TIMING_UNRESOLVED`. A verified zero exists only through a dated no-MLB-appearance observation.
- **`v_transaction_asset_lineage`** one row per root package x path x hop (recursive CTE; an event and an interval appear once per path).
- **`v_transaction_package_lineage`** one row per root package x interval, deduplicated across signings and paths (the canonical basis of
  package aggregates; `is_additive_to_package_total`).
- **`v_downstream_organizational_realization`** `row_grain` SIGNING (individually attributable value only) and PACKAGE (package value once).

Amended additively: `v_dodgers_international_value_portfolio` (appended columns, every earlier column unchanged),
`v_value_research_queue` and `v_transaction_research_queue` (downstream issues; the first-hop timing and downstream-chain issues are
recomputed from intervals and lineage). `v_trade_realization_edges` and `v_player_organizational_realization` are unchanged.

## Two resolution dimensions

`v_transaction_asset_lineage` and `v_transaction_package_lineage` expose `attribution_resolution` (RESOLVED / UNRESOLVED: can the
attribution level be determined) and `value_resolution` (VALUE_RESOLVED, ZERO_OBSERVED_THROUGH_DATE, VALUE_NOT_LOADED,
VALUE_TIMING_UNRESOLVED, VALUE_IDENTITY_UNRESOLVED). A minor-league player the WAR source does not contain has a resolved attribution
and a value that is NOT_LOADED; it is never zero without a dated no-MLB-appearance observation.

## Completeness unit and legacy flag

The completeness unit is the root package (41 packages: COMPLETE_TERMINAL, STILL_ACTIVE or INCOMPLETE_*). The 033
`downstream_asset_chain_incomplete` flag is kept for compatibility: it is true whenever a return asset has any later recorded exit, so
it rises as exits are recorded and is not the number of incomplete chains. A known attribution boundary (`LINEAGE_BOUNDARY_NOTED`) is
informational and never makes a chain incomplete.

## Package-deduplicated total

`package_deduplicated_total_bwar` is an observed lineage total, not an attributable total: every control interval of every root package
counted once (first-hop package value + downstream PLAYER_ATTRIBUTABLE + downstream PACKAGE_ATTRIBUTABLE + CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE
intervals each once).

## Package root

`root_package_key = <root trade event key>|<sorted tracked outgoing slugs>`, deterministic across replays (slugs, never uuids).
A root package is a TRADE with at least one tracked signing outgoing; its whole outgoing set is the package.

## Attribution levels (only degrade)

| Level | Rule |
|---|---|
| `PLAYER_ATTRIBUTABLE` | the root package has exactly one outgoing asset total, and every exit on the path sent the asset alone (no cash, no co-member, no consideration) |
| `PACKAGE_ATTRIBUTABLE` | one root package, but a boundary carries other outgoing assets: same-root players, cash, pool space, placeholders |
| `CHAIN_OBSERVABLE_NOT_ATTRIBUTABLE` | another root lineage, another tracked signing, or a lineage-less player participates at a boundary: visible, never added to a root |
| `UNRESOLVED` | identity or timing unresolved for the interval; value NULL |

Hop 1 is judged on the root event itself (its co-members are the package). Later hops are judged on the exit trade's outgoing set.
A known attribution boundary is information (`LINEAGE_BOUNDARY_NOTED`), not missing research.

## Signing-level total

`total_individually_attributable_organizational_bwar` = direct Dodgers bWAR + interval-bounded PLAYER_ATTRIBUTABLE first-hop return +
downstream PLAYER_ATTRIBUTABLE bWAR. Package-attributable, mixed-lineage and unresolved value is never added; NULL when a
PLAYER_ATTRIBUTABLE interval is unresolved. Negative bWAR stays negative.

## Branch and chain statuses

Branch: `CONTINUES`, `STILL_ACTIVE`, `TERMINAL_NO_RETURN`, `TERMINAL_NON_PLAYER_RETURN`, `COMPLETE_TERMINAL`, `NO_MLB_APPEARANCE`,
`PENDING_CONSIDERATION`, `RETURN_UNRECORDED`, `EXIT_NOT_RESEARCHED`, `EXIT_UNRECORDED_BOUNDED`, `HISTORY_INCOMPLETE`,
`TIMING_UNRESOLVED`, `IDENTITY_UNRESOLVED`. Chain: `COMPLETE_TERMINAL`, `STILL_ACTIVE`, `INCOMPLETE_*`.

## Security

One new table (RLS, SELECT-only anon / authenticated, no write policy, no PUBLIC grant), one invoker-rights guard, four new views and
three amended views, all `security_invoker` and SELECT-only. 59 tables / 109 views.
