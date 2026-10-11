# Migration 032: design

## Layers

```
player_mlb_team_season_war   facts: bWAR by player, season, team, stint, component (sealed, supersedable)
bref_team_code_map           B-Ref code -> DISI organization with season ranges
transaction_event_assets.bref_id   identity of an incoming return player (no DISI players row needed)
                |
v_trade_realization_edges    one hop: event -> outgoing package -> incoming player -> its Dodgers bWAR
v_player_organizational_realization   one row per Dodgers signing
v_dodgers_international_value_portfolio   SUM/SUM aggregates by grain
v_value_research_queue       derived issues
```

There is no realization-event table and no trade-chain edge table: value is derived from facts, and the one-hop edge
is a view over the existing transaction tables.

## `player_mlb_team_season_war`

| Column | Meaning |
|---|---|
| `bref_id` | stable Baseball-Reference identity; never a name |
| `player_id` | DISI player where the identity is a DISI signing; NULL for return assets |
| `season`, `bref_team_code`, `stint_ordinal`, `component` | the deterministic key (one ACTIVE row per combination) |
| `organization_id` | resolved through the map; NULL only where no mapping covers the code and season |
| `war`, `games`, `plate_appearances`, `ip_outs` | the fact; `war` NULL means the file has none for that row (zero-PA batting), never zero |
| `war_system` | constrained to `BWAR` |
| `observed_through_date`, `observed_through_season`, `retrieved_at`, `source_id`, `confidence` | provenance (the file's own last-modified date) |
| `record_status`, `supersedes_record_id`, retraction fields | the sealed lifecycle |

BAT and PITCH are stored separately because the two files are separate and a player can have both; views sum them. The
guard trigger refuses deletes, mutation of ACTIVE rows, and any organization other than the one the map names.

## Definitions

- **`direct_dodgers_mlb_bwar`**: sum of BWAR over MLB team-season rows whose organization's franchise is the Dodgers (BRO and LAD both). Not career WAR, not the debut organization, not minor-league performance. A reacquired player is credited for every Dodgers stint.
- **`non_dodgers_mlb_bwar`**: sum over all other organizations. A career-outcome fact; never added to Dodgers value. The name stays correct for players traded away and reacquired.
- **Zero versus NULL**: zero only where team history is loaded and reconciled, or the outcome is audited as no MLB career. Otherwise NULL.
- **Trade return (one hop)**: the incoming player's bWAR for the Dodgers **after that specific acquisition** (see `trade-return-timing.md`): later seasons count, the acquisition season counts only for stints ordered after the counterparty's stint (B-Ref stint order), and any same-season stint that cannot be ordered leaves the return NULL (`TIMING_UNRESOLVED`, queued as `TRADE_RETURN_TIMING_UNRESOLVED`). Pre-acquisition Dodgers stints stay in the player's direct career value and are never credited to the return. Descendants are never attributed; a later *recorded* transaction sending the asset away raises `DOWNSTREAM_ASSET_CHAIN_INCOMPLETE`.
- **Package attribution**: `SOLE_OUTGOING_ATTRIBUTABLE` (the DISI player is the only outgoing asset), `SHARED_PACKAGE_NOT_ATTRIBUTABLE` (individual share NULL, package return exposed), `RETURN_WAR_UNKNOWN`, `NO_MODELED_TRADE_EVENT`. No equal split and no weighting.
- **`attributable_organizational_bwar`** = `direct_dodgers_mlb_bwar + individually_attributable_trade_return_bwar` (NULL contributes nothing); NULL when direct is not observed or the return is unknown; the basis is spelled out in `attributable_value_basis`.

## Status model (one primary status plus flags)

| Status | Rule |
|---|---|
| `DIRECT_DODGERS_MLB_VALUE` | verified MLB reach, loaded and reconciled, at least one Dodgers MLB team-season |
| `MLB_ELSEWHERE_ONLY` | verified MLB reach, loaded and reconciled, no Dodgers MLB season |
| `NO_MLB_VALUE_OBSERVED` | audited career ended, no MLB, and mature |
| `STILL_DEVELOPING` | audited active in the minors |
| `TOO_RECENT_TO_EVALUATE` | not mature and no MLB value yet |
| `OUTCOME_INCOMPLETE` | reached MLB without reconciled team facts, or mature and unaudited / unknown |

Flags: `flag_trade_return_attributable`, `flag_trade_return_package_only`, `flag_has_non_dodgers_mlb_value`, and
`downstream_asset_chain_incomplete`. `DIRECT_DODGERS_MLB_VALUE` describes the presence of Dodgers MLB seasons, not a
positive total (a Dodgers season can have negative WAR).

## Maturity

The reviewed 5-year rule is kept: a signing is mature when its signing date plus five years is on or before
`analysis_as_of_date`; with no date, when `signing_year <= year(as_of) - 5`. The as-of date is
`max(outcome_audits.audited_through_date)` (2026-10-05), never `CURRENT_DATE` and not the legacy literal 2026-10-03. The audit
and a test prove the flag equals the legacy `mature_5yr_cohort` for all 220 Dodgers signings. `maturity_basis` is exposed.

## Cost gating and aggregation

A cost-aware ratio exists only for COMPLETE acquisition cost greater than zero, an observed outcome (direct value not
NULL) and a mature signing; otherwise `ratio_suppression_reason` says why. PARTIAL cost stays descriptive; UNKNOWN and
NO_RULE get no ratio. Portfolio rates use `SUM(value) / SUM(cost)` over the same eligible rows, expose the eligible counts
and cost, flag samples under five, and are labelled tracked / verified-set analytics. The legacy executive KPI
(`AVG(career_war / bonus)`) is untouched.

## What 032 does not do

No fWAR, no Stats API WAR, no dollar valuation, no downstream chain beyond one hop, no weights, no scouting-accuracy or
development formula, and no value attributed to trainers, academies, programs or leagues.
