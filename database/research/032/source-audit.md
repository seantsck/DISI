# Migration 032: source audit

Reviewed 2026-10-10.

## Baseball-Reference WAR data files (one-time public download, not scraping)

| File | URL | Rows | SHA-256 | Last-Modified |
|---|---|---|---|---|
| batting | https://www.baseball-reference.com/data/war_daily_bat.txt | 126,547 | `ef920800678570138871bbaca91c1069e31e77725074af44c417803ba58775e8` | 2026-09-28 |
| pitching | https://www.baseball-reference.com/data/war_daily_pitch.txt | 57,884 | `061df2f8a22e7240d725bb8949bba8c8445769b86d03dd0f37b461f4d582e8e5` | 2026-09-28 |

- Retrieved 2026-10-10T07:36:40Z (HTTP 200 for both). Sizes 35,593,964 and 15,363,643 bytes.
- Both files are already registered DISI sources (`source_tier BASEBALL_REFERENCE`), whose notes state that career bWAR is the sum of the batting and pitching rows for the player's `mlb_ID`. 032 reuses them and adds no source row.
- **Format:** CSV with a header; one row per player, season, team and stint. The batting file carries `PA`, `G`, `WAR`; the pitching file `G`, `IPouts`, `WAR`. A `WAR` of the literal `NULL` appears; it is stored as NULL.
- **Identity:** rows join on `player_ID` (the B-Ref id, matching `players.bref_id` for all 47 verified players) and are cross-checked against `mlb_ID`; the derive step aborts on any mismatch.
- **Filter:** 754 rows (504 BAT, 250 PITCH) for 50 players. `parsed_rows_sha256` in `war-seed.json` covers the parsed rows.
- **Not committed:** the raw files (about 51 MB). `derive-seed.mjs` re-derives the identical seed from them and aborts if a checksum differs.

## What the files do and do not say

- BAT + PITCH per player equals the established career bWAR in all 47 cases within the one-decimal rounding of the legacy stores (largest difference 0.05).
- 36 batting rows with zero plate appearances and zero games have `WAR = NULL`; no sum is affected.
- The MLB Stats API was used only for identity corroboration (names and ids of the three return assets). Its `sabermetrics.war` field is a different WAR system and is not used.
- fWAR: none loaded; FanGraphs WAR stays out of 032.
