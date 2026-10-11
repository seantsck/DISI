# Migration 033: transaction and asset-chain completion

`database/sql/033_transaction_asset_chain_completion.sql` is generated from this folder:

```
node database/research/033/derive-seed.mjs   # raw B-Ref files (gitignored, same as 032) -> war-seed.json, checksum-verified
node database/research/033/audit.mjs         # replays 001-032 in memory, checks every precondition and the seed -> audit-report.json
node database/research/033/build.mjs         # template + views + seeds -> the migration (deterministic)
```

`event-seed.json` is the reviewed research output. Its derivation from the raw official-log and Baseball-Reference pages is
kept in `derive/` (`assemble.py`, `txparse.py`, `finalize.py`) for review; the raw API and HTML responses are gitignored
scratch (`research-output/033-work/`) and are not needed to build the migration.

| File | Purpose |
|---|---|
| `event-seed.json` | 161 transaction events with their 291 assets, stable identities, counterparties, amounts and sources; the 4 placeholder resolutions; 24 asset observations; 66 tracked-player observations; the sources to register |
| `war-seed.json` / `derive-seed.mjs` | 573 Baseball-Reference team-season rows for the 40 first-hop incoming players (same two files and checksums as 032) |
| `scope-config.json` | Data-file checksums, the four team-code map additions, the Diaz / Machado date correction, the legacy transaction expectations |
| `033_template.sql` / `views.sql` | Hand-written schema, guards, backfill, correction and postconditions; the amended trade-realization chain and the four new views |
| `audit.mjs` / `audit-report.json` | Pre-033 facts, the 032 analytics baseline the migration is compared against, partition and seed checks |
| `build.mjs` | Validates the seed (types, identity formats, amount rules, sources, team-code coverage) and writes the migration |
| `schema-design.md` | Columns, tables, guards, return states, observation model, views |
| `event-universe.md` | The 161 events, the 220-player partition, exit mechanisms, multi-team, placeholders, cash and pool space |
| `identity-resolution.md` | How MLB ids, Baseball-Reference ids and Register ids were established; the Antonini variant; coverage |
| `analytics-effects.md` | Generated comparison of the 032 analytics before and after 033 |
| `research-backlog.md` | What remains unknown and what is deferred to Migration 034 |

## What 033 establishes

- **Transactions:** 161 events - 140 tracked-player exits, one re-entry (Valdez reacquired 2000-07-26) and 20 first-hop
  return-asset exits. TRADE 48, RELEASE 84, FREE_AGENCY 26, RULE5_SELECTION 1, EXPANSION_DRAFT 1, WAIVER 1.
- **Partition of the 220 tracked signings:** 138 left Dodgers control, 64 verified still controlled (dated observation), 16
  with no exit evidence, 2 with unavailable history. No exit is inferred from absence.
- **Assets:** 291 (266 PLAYER, 15 CASH, 6 PLAYER_TO_BE_NAMED, 3 FUTURE_CONSIDERATIONS, 1 INTERNATIONAL_BONUS_POOL_SPACE); every
  PLAYER asset has a stable identity (DISI player, MLB id, Baseball-Reference id or Register id).
- **Return value inputs:** 40 incoming players, 573 team-season bWAR rows, four new team codes; the 032 timing rule is reused unchanged.
- **Explicit return states:** `LOADED`, `NO_MLB_APPEARANCE_OBSERVED`, `NO_PLAYER_RETURN`, `PLAYER_RETURN_PENDING`,
  `RETURN_UNRECORDED`, `RETURN_WAR_UNKNOWN`, `TIMING_UNRESOLVED`.
- **Not in 033:** second-hop or recursive realization, credit for second-generation assets, valuation of cash, pool space or
  prospects. That is Migration 034.

The legacy `transactions` table is kept (all five legacy rows reconcile to canonical events). The application is unchanged.
