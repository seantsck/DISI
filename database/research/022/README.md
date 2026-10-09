# Research behind migration 022

Everything needed to inspect and rebuild `database/sql/022_player_development_exact_dates.sql`: exact
development dates (SEASON → DAY milestone upgrades, per-stint first/last appearance dates and exact
professional debuts) derived from official game-level evidence.

## Pipeline

| Step | Command | Output |
| --- | --- | --- |
| Input | the 021 artifacts (`research-output/021-work/players-dev.json`, `research-output/021/player-seasons.json`, `research-output/021/development-milestones.json`) | — |
| 1. Game logs | `node scripts/mlb/player-game-logs.mjs --input research-output/021-work/players-dev.json --seasons research-output/021/player-seasons.json --out research-output/022` | `player-game-logs.json` / `.csv` |
| 2. Exact-date distiller | `node scripts/mlb/development-exact-dates.mjs --seasons research-output/021/player-seasons.json --milestones research-output/021/development-milestones.json --game-logs research-output/022/player-game-logs.json --out research-output/022` | `development-exact-dates.json` / `.csv` |
| 3. Reviewed values | `node scripts/mlb/development-date-sql-values.mjs --exact-dates research-output/022/development-exact-dates.json --as-of 2026-10-06 --out database/research/022/values.sql` | `values.sql`, `values-decisions.json` |
| 4. Build | `node database/research/022/build.mjs` | `database/sql/022_player_development_exact_dates.sql` |
| Harness | `node database/research/022/test-022.mjs` | builds 001→021 in PGlite, then 022 |

Step 1 is cache-first and resumable; `--offline` never touches the network. The library behind every
rule is `scripts/mlb/lib/exact-dates.mjs` (unit-tested in `tests/unit/mlb-exact-dates.test.mjs`).

## Evidence rules

- **Participation**: a dated entry in the official gameLog endpoint with a stat block IS a recorded
  appearance (hitters: plate appearance, at-bat or represented defensive appearance
  (`positionsPlayed`); pitchers: recorded pitching line). Roster lists, transactions, promotions,
  options, assignments and team schedules are never appearances.
- **Endpoints**: the plain `stats=gameLog` form covers only MLB-level games (it returns an empty
  stats array for minor leaguers); `leagueListId=milb_all` covers the affiliated minor leagues
  (complex rookie leagues included) and never MLB games. Both return regular-season entries
  (gameType `R`) only, so spring training never produces a date. Each (season, group) fetches
  exactly the forms its reviewed stints need.
- **Upgrade rule**: an existing SEASON-precision debut milestone becomes DAY only when the earliest
  game-verified appearance at that level falls in the milestone's own reviewed `season_year`. When
  the game logs only start later, or never cover the level, the milestone keeps SEASON precision —
  absence of evidence is never evidence of absence.
- **Never overwritten**: an existing DAY milestone keeps its date. A disagreeing game-log date would
  become an `EXACT_DATE_CONFLICT` research conflict (none occurred in this run).
- **PROFESSIONAL_DEBUT** (no rows existed after 021) is emitted only with exact game-log evidence,
  and only when the earliest appearance falls in the player's first stint season — the first
  professional game otherwise predates log coverage and stays unknown.
- **Stint dates**: first/last appearance dates attach only to the specific stint
  (season, team, league, level) the games belong to; a stint without a team identity cannot take a
  game-attributed date.

## What was built (as of 2026-10-06)

- **591 gameLog fetches** over 263 players (565 network + 26 cache, 0 errors) yielding
  **19,190 dated appearances** across seasons 2007–2026.
- **400 SEASON → DAY upgrades, in place, guarded**: DSL_DEBUT 157/157 · COMPLEX_DEBUT 97/97 ·
  A_DEBUT 71/71 · HIGH_A_DEBUT 36/37 · AA_DEBUT 24/25 · AAA_DEBUT 15/16. Every upgraded row names
  the basis it replaced in `prior_evidence_basis` (SEASON_SPLITS) and keeps its reviewed season.
- **3 milestones stay SEASON-precision, dateless**: Roger Cedeño's 1993 AA/AAA and 1998 High-A
  debuts — all before the 2006 gameLog era (`NO_GAME_LOG_COVERAGE` research notes; the
  `SEASON_ONLY_MILESTONE` queue issue flags exactly one player).
- **166 exact PROFESSIONAL_DEBUT rows** (DSL-basis 157, complex 8, Low-A 1). The event-code map now
  types PROFESSIONAL_SIGNING with 001's previously unused `SIGNED` milestone value so a player who
  signed and debuted on the same day (Ilmerson Colon, 2022-06-20) keeps two distinct facts.
- **746 of 828 stints** carry verified `first_game_date` / `last_game_date` (`game_date_basis`
  GAME_LOG). The 60 undated log-era stints are 56 stints without a team identity (the gameLog names
  specific complex-league squads the reviewed evidence did not) and 4 genuinely unlogged 2018
  Mexican-League stints.
- Existing exact dates were never touched: the 7 MLB_DEBUT rows keep their dates (Frias 2014-08-04,
  `MLB_PERSON_RECORD`) and game evidence agreed everywhere it existed.
- **0 conflicts**: no game-log date disagreed with a stored exact date.

## New schema and views

- `development_milestones.prior_evidence_basis` — the basis a milestone had before its 022 upgrade
  (null for milestones never upgraded).
- `v_dodgers_development_date_coverage` — exact versus season-only facts per level, calculable
  signing→level elapsed times, and the unresolved-conflict count (0).
- `v_dodgers_player_development_summary` extends with `days_signing_to_high_a_exact`,
  `years_signing_to_high_a_exact`, `days_a_to_high_a_exact`, `days_high_a_to_aa_exact` (appended
  columns only — create or replace view may not reorder existing ones).
- `v_dodgers_development_research_queue` adds `MISSING_FIRST_GAME_DATE` (46 players),
  `MISSING_LAST_GAME_DATE` (46), `SEASON_ONLY_MILESTONE` (1), `GAME_LOG_UNAVAILABLE` (0),
  `EXACT_DATE_CONFLICT` (0), `MLB_PLAYER_MISSING_PRE_MLB_EXACT_DATES` (1 — Cedeño, pre-log era),
  `UNKNOWN_LEVEL_GAME_LOG` (20).
- Headline exact metrics after the upgrade: signing→pro debut 146 · signing→A 61 ·
  signing→High-A 28 · signing→AA 19 · signing→AAA 11 · signing→MLB 6.

## Limitations

- 96 of the 263 tracked players return no structured season rows (unchanged from 021); they have no
  stints and stay outside the exact-date scope. Absence of data is never evidence of not playing.
- Game-log coverage starts at the 2006 log era (`GAME_LOG_MIN_SEASON`); earlier careers keep
  season-precision facts.
- A stint the reviewed evidence recorded without a team identity cannot receive game-attributed
  dates, even when that season's games are logged; attaching a squad to such a stint is a research
  decision, not a derivation, and stays queued (`UNKNOWN_LEVEL_GAME_LOG` / `MISSING_FIRST_GAME_DATE`).
