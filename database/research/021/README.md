# Research behind migration 021

Everything needed to inspect and rebuild `database/sql/021_player_development_history.sql`: the
reproducible development-history dataset for tracked Dodgers international signings.

## Pipeline

| Step | Command | Output |
| --- | --- | --- |
| Input | `players-dev.json` (263 tracked players with a resolved MLB id — slug, name, signingYear, signingDate, mlbId; from the 020 `players-with-ids.json`) | — |
| 1. Season splits | `node scripts/mlb/player-seasons.mjs --input research-output/021-work/players-dev.json --out research-output/021` | `player-seasons.json` / `.csv` |
| 2. Game-level dates (optional) | `node scripts/mlb/player-game-levels.mjs --input ... --out research-output/021 [--game-logs]` | `player-game-levels.json` / `.csv` |
| 3. Milestone candidates | `node scripts/mlb/development-milestones.mjs --input ... --out research-output/021` | `development-milestones.json` / `.csv` |
| 4. Reviewed values | `node scripts/mlb/development-sql-values.mjs --seasons ... --milestones ... --game-levels ... --as-of 2026-10-06 --out database/research/021/values.sql` | `values.sql`, `values-decisions.json` |
| 5. Build | `node database/research/021/build.mjs` | `database/sql/021_player_development_history.sql` |

Steps 1–3 read only the MLB Stats API cache (`.cache/mlb`) plus the input file; `--offline` never
touches the network, `--game-logs` would fetch game logs (not available offline — see limitations).

## What was built (as of 2026-10-06)

- **828 stint rows** for **167 players**. All 263 tracked players with a resolved MLB id were
  queried (each query executed against the cached season-splits responses): 167 returned structured
  season rows; the other 96 are `researched_no_structured_season_data` — the query ran and returned
  no structured season rows. Absence of returned season data is never treated as evidence that a
  player did not play. The 5 tracked players without an MLB id were not queryable at all.
- Levels: INTERNATIONAL_ROOKIE 334 · COMPLEX_ROOKIE 158 · LOW_A 122 · HIGH_A 71 · AA 46 · AAA 32 ·
  MLB 14 · FOREIGN_PRO 8 · OTHER 43 (UNKNOWN_ROOKIE_LEAGUE: Pioneer-league-era and blank-league rows).
- 173 player-seasons with more than one stint row (140 multi-level, 10 with two organizations in the
  same season, kept as separate stints and queued for review).
- **666 event-coded milestones**: SIGNED 154 · DSL_DEBUT 157 · COMPLEX_DEBUT 97 · A_DEBUT 71 ·
  HIGH_A_DEBUT 37 · AA_DEBUT 25 · AAA_DEBUT 16 · MLB_DEBUT 7 · ORGANIZATION_CHANGE 18 · RELEASED 84 —
  plus the 5 legacy 003 MLB debuts tagged `LEGACY_OUTCOME_AUDIT`.
- Exact MLB debut dates exist for Roger Cedeno (1995-06-20) and Carlos Frias (2014-08-04) from the
  MLB person record; 5 more from legacy audits (De Paula, Oneil Cruz, Sasaki, Yordan Alvarez,
  Yusniel Diaz). Six players have a calculable signing → MLB time.
- **No fabricated dates anywhere**: game-log dates are absent offline, so every `first_game_date` /
  `last_game_date` is NULL and `gameLogError` entries are recorded in the game-levels artifact.

## MLB-reach counts (scope-explicit — do not mix these)

| Scope | Definition (documented query) | Count |
| --- | --- | --- |
| All tracked players with verified MLB reach | `players.mlb_debut_date` from the MLB person record (`count(*) from players where mlb_debut_date is not null`); `bref_id` covers 58 of 58 | **58** |
| Dodgers signings with verified MLB reach | the Dodgers-signee subset above: `... join signings/organizations on franchise_key = 'DODGERS'` | **47** |
| Benchmark / non-Dodgers players with verified MLB reach | the complement above (Gleyber Torres, Rafael Devers, Eloy Jimenez, Hyo-Jun Park, …) | **11** |
| Dodgers signings with a verified MLB **outcome audit** | `count(*) from outcome_audits where reached_mlb_verified` — exactly the 47 Dodgers signees; benchmark players are never outcome-audited | **47** |

- The audited count (47) and the all-tracked count (58) are different measures over overlapping
  scopes; 47 + 11 = 58. `v_database_status.verified_mlb_outcomes = 47` is the Dodgers-scope figure
  (that view counts Dodgers signings only).
- The DB test `021 MLB-reach counts are scope-explicit` asserts this partition end to end.
- Historical note: an earlier 020 report said "57 MLB players"; that count predates the final
  Hyo-Jun Park resolution — the 020 README's own coverage line is "58 of 58 MLB players".

## Development-season coverage (calendar seasons — NOT signing-class coverage)

Counts below are stints / players **per calendar development season**, not 2018- or 2019-signing-class
populations. Signing-class coverage is reported only by `v_dodgers_development_by_signing_class`,
which groups by `signing_year`.

| Development season | Stints / players | | Development season | Stints / players |
| --- | --- | --- | --- | --- |
| 2016 | 30 / 16 | | 2022 | 88 / 69 |
| 2017 | 31 / 15 | | 2023 | 116 / 83 |
| **2018 (development season)** | **23 / 12** | | 2024 | 130 / 91 |
| **2019 (development season)** | **32 / 22** | | 2025 | 147 / 101 |
| 2020 | none (no minor-league season) | | 2026 | 122 / 86 |
| 2021 | 44 / 34 | | 2013 / 2014 / 2015 | 6/4 · 13/9 · 15/9 |
| | | | 1992–2012 | 1–3 stints / 1 player per season (Cedeno 1992–2005, Frias 2007–2012) |

## Rules encoded here (mirrored by the migration's checks)

- The Mexican League, NPB, KBO and Cuban professional are `FOREIGN_PRO` in every era, never
  affiliated AAA, whatever sport id the source used (keeps the 019 correction).
- A season split evidences appearance for a team in a season — never a date.
- Unresolvable rookie-league labels stay `OTHER` / `UNKNOWN_ROOKIE_LEAGUE`; nothing is invented.
- Organization ownership is per stint, resolved per season from a reviewed affiliation table; a
  foreign professional club keeps organization NULL by design (`FOREIGN_PRO_CLUB`).

## Limitations

- **No game logs cached** → no first/last game dates, so no exact level-debut dates except the two
  person-record MLB debuts. Fetch with `--game-logs` when the network is allowed and rebuild.
- **`researched_no_structured_season_data`**: 96 players' season-splits queries executed and
  returned no structured season rows. This is a data-absence state, never a negative outcome and
  never zero seasons; the research queue keeps them visible (`IDENTITY_BUT_NO_PROFESSIONAL_SEASONS`).
- **5 players without an MLB id** were not queryable against the MLB Stats API at all.
- 43 `UNKNOWN_ROOKIE_LEAGUE` stints await era-specific classification.
- Two-organization seasons are flagged for review; trade dates are never inferred.

## Tests

- `tests/unit/mlb-development.test.mjs` — offline library tests (taxonomy, orgs, distillation, milestones).
- `tests/db/migrations.test.mjs` — the 021 block asserts the dataset invariants end to end in PGlite.
- `node database/research/021/test-021.mjs` — quick local harness (001–020 + 021) for template iteration.
