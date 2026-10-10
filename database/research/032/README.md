# Migration 032: player value and organizational realization

`database/sql/032_player_value_organizational_realization.sql` is generated from this folder:

```
node database/research/032/derive-seed.mjs   # raw B-Ref files (gitignored) -> war-seed.json, checksum-verified
node database/research/032/audit.mjs         # replays 001-031 in memory, checks every guard input -> audit-report.json
node database/research/032/build.mjs         # template + views + seed -> the migration (deterministic)
node database/research/032/test-032.mjs      # local harness: applies 032 twice on 001-031, writes value-coverage.json
```

The two raw Baseball-Reference files (about 51 MB) are not committed. They live under `research-output/032-work/raw/`
(gitignored) and are re-downloadable from the URLs in `scope-config.json`; `derive-seed.mjs` refuses to run unless their
SHA-256 matches. Only the 754 required rows are committed (`war-seed.json`).

| File | Purpose |
|---|---|
| `scope-config.json` | The two source files (URL, SHA-256, row counts), retrieval metadata, return-asset identities, and the Baseball-Reference team-code map |
| `derive-seed.mjs` / `war-seed.json` | Deterministic filter of the raw files to the 47 verified players and 3 return assets; parsed-row checksum |
| `032_template.sql` / `views.sql` | Hand-written schema, guard, load, reconciliation and the four views |
| `audit.mjs` / `audit-report.json` | Pre-032 facts, career reconciliation per player, backfills, return-asset comparison, maturity equivalence |
| `trade-return-timing.md` | The acquisition-boundary rule for trade-return value and the canonical return assets under it |
| `build.mjs` | Validates the seed (components, WAR format, uniqueness, code ranges) and writes the migration |
| `test-032.mjs` / `value-coverage.json` | Harness and the resulting counts (regenerated, never hand-edited) |
| `schema-design.md` | Definitions, attribution, status model, cost gating, maturity |
| `source-audit.md` | The two files: provenance, format, how they were read |
| `team-code-map-audit.md` | Every team code, its organization and season range |
| `return-asset-identity.md` | Fields, Watson, Machado identity checks and the return comparison |
| `career-reconciliation.md` | Team-season totals against both legacy stores, and the three backfills |
| `proof-cohort.md` | Cruz, Alvarez, Ryu, De Paula, Sasaki, Urias and others, from the database |
| `legacy-value-comparison.md` | Legacy ratios versus the new definitions, and which outputs moved |
| `research-backlog.md` | What 032 deliberately leaves |

## What 032 establishes

- **Facts:** `player_mlb_team_season_war` holds 754 bWAR rows (504 BAT, 250 PITCH) for 50 players (47 verified Dodgers signings, 3 trade-return players), every row resolved to an organization through `bref_team_code_map` (36 codes with season ranges). 36 rows have no WAR in the file (zero-PA batting rows) and are stored as NULL, not zero.
- **Value definitions:** `direct_dodgers_mlb_bwar` (MLB seasons of the Dodgers franchise, BRO and LAD), `non_dodgers_mlb_bwar` (other organizations; never credited to Los Angeles), and a one-hop trade return.
- **Attribution:** a DISI player receives an individual trade-return share only as the sole outgoing asset (Alvarez). Shared packages (Cruz, Diaz) are exposed at package level with an individual share of NULL.
- **Reconciliation:** the loaded totals agree with both legacy career-WAR stores within 0.1 for all 47 players. Frias and Cedeno `outcomes.career_war` and Leonard's `CAREER_BWAR` observation were the only gaps and are backfilled from the facts.
- **Ratios:** cost-aware figures exist only for COMPLETE acquisition cost, an observed outcome and a mature signing; portfolio rates are SUM / SUM over the same eligible rows.

The legacy WAR-per-dollar and executive KPI definitions are unchanged. The app is unchanged.
