# DISI ingestion and provenance workflow

How new facts enter the database. The goal is complete signing classes from authoritative sources, not a hand-picked list of well-known players.

## Source priority

| Priority | Tier (`source_tiers.tier_code`) | Authoritative for | Never used for |
| --- | --- | --- | --- |
| 1 | `OFFICIAL_CLUB_RELEASE` — official Dodgers / MLB club releases | class membership, stated class size, club transactions | — |
| 2 | `MLB_TRANSACTION_LOG` — official MLB transaction logs | exact signing dates, additional class members | class size on its own |
| 3 | `MLB_PIPELINE` — MLB Pipeline trackers and prospect profiles | prospect rank, reported bonus, position, market | class size, league census |
| 4 | `BASEBALL_REFERENCE` | MLB debut, MLB outcomes, **bWAR**, historical transactions | fWAR |
| 5 | `FANGRAPHS` | **fWAR** only | bWAR |
| 6 | `MILB_MLB_PLAYER_RECORD` | development milestones, minor-league progression, biography | bWAR |
| 7 | `MLB_COM_REPORTING` | context, reported class size until an official release is found | — |

When two sources disagree about the same fact type, the lower priority number wins. Record both; do not delete the losing source.

## Every source keeps

`sources.url` (unique), `source_name`, `source_type`, `title`, `publication_date`, `accessed_at`, `source_tier`, and optional `notes`. Every fact link keeps a `confidence` (`evidence.confidence`, `outcome_audits.confidence`, `player_metric_observations.confidence`).

## Adding a signing class

1. **Register the class source.** Prefer the official club release. Insert into `sources` with `source_tier = 'OFFICIAL_CLUB_RELEASE'`, `publication_date` and `accessed_at`.
2. **Declare coverage.** Upsert `signing_census_coverage` for the organization and year:
   - `expected_signings` only when a source states the class total;
   - `coverage_type = 'COMPLETE_CENSUS'` only when the source lists **every** signee (a class total without a name list is `PARTIAL_CENSUS` until all names are recovered);
   - `source_id` = the source that states the total.
3. **Add players.** Insert `players` (slugs are assigned automatically). Leave unknown biography fields `NULL`. Add spelling variants to `player_aliases`.
4. **Add signings.** Insert `signings` with `record_scope`, `country_market`, `pathway`, `signing_date` (from the transaction log), and only the cost components the sources state: `signing_bonus_usd`, `posting_fee_usd`, `transfer_fee_usd`. Never enter `0` for unknown.
5. **Link evidence.** One `evidence` row per signing and source (`entity_type = 'signing'`); use `field_name` when a source supports one specific field (for example `signing_bonus_usd`).
6. **Check coverage.** `/research` (view `v_class_research_coverage`) recomputes tracked size live. The class turns `COMPLETE` only when declared complete and every expected row is present.

Example: the official 2025 release states 29 international amateur free agents but does not name all of them. The 2025 class therefore stays `PARTIAL_CENSUS` with 18 transaction-log rows until the other 11 names come from an official or transaction-log source.

## Recording outcomes

- **Outcome audit:** `outcome_audits` with `audited_through_date`, `reached_mlb_verified` (`true` or `false`), `source_id`, `confidence`. A player without an audit row is "not audited", which is different from "did not reach MLB".
- **MLB debut:** `outcomes.mlb_debut_date` and `mlb_debut_organization_id` from Baseball-Reference. Use the historical organization row (e.g. `BRO` for a Brooklyn debut).
- **bWAR:** insert into `player_metric_observations` with `metric_key = 'CAREER_BWAR'`, the Baseball-Reference page as `source_id`, `observed_through_date` (the date you read the value) and `observed_through_season`. Add a new row on each refresh instead of overwriting, so active players keep their history. The database rejects bWAR citing any non-Baseball-Reference source.
- **fWAR:** same table with `metric_key = 'CAREER_FWAR'` and a FanGraphs source. It is displayed separately and never replaces bWAR.
- Do not write new values to the legacy `outcomes.career_war` column.

## Transactions

Use `transaction_events` + `transaction_event_assets` for every trade so the whole package is recorded (`OUTGOING` and `INCOMING` assets). Return metrics go in `transaction_return_metrics` at event level; never assign a multi-player return to one outgoing player.

## Before publishing a change

Run `npm test`. The database test executes every migration in order, reruns the latest migration, and checks slugs, bWAR provenance, class status rules, NULL handling and the read-only security model.
