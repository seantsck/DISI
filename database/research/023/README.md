# Research behind migration 023

Everything needed to inspect and rebuild `database/sql/023_development_stint_integrity.sql`: the audit that
proves which stints are season totals, the reviewed decisions, and the assembly of the migration.

## Pipeline

| Step | Command | Output |
| --- | --- | --- |
| 1. Audit | `node database/research/023/audit.mjs` | `values-decisions.json` (exits non-zero if any team-less row cannot be proven) |
| 2. Build | `node database/research/023/build.mjs` | `database/sql/023_development_stint_integrity.sql` |
| Harness | `node database/research/023/test-023.mjs` | builds 001→022 in PGlite, runs 023 twice (apply + rerun) |

`audit.mjs` builds the canonical chain **before** 023 in an in-memory PGlite database; it needs no network and
touches no real database. `023_template.sql` is hand-maintained (it carries the 021/022 view and status
definitions it recreates, with the reviewed changes); `build.mjs` only injects the reviewed season-total rows.

## Evidence

A team-less stint (no affiliate, no team id; `organizationBasis: NO_TEAM_NAME`) is the MLB Stats API's aggregate
split, emitted when a player appears for several teams in one sport season. It is proven to be a **season total**
only by arithmetic: every additive statistic it reports equals the sum of the same-season team stints at its
source level.

| Basis | Rows | Meaning |
| --- | --- | --- |
| `SAME_LEVEL` | 34 | all components at the total's own level (e.g. Jeral Pérez 2024: Rancho Cucamonga 75 + Kannapolis 30 = 105 G) |
| `CROSS_LEVEL` | 21 | components span canonical levels - rookie sport id 16 covers DSL + complex + Pioneer (e.g. Edgar León 2026: ACL 4 + DSL Tigers 1 2 + DSL Tigers 2 3 = 9 G) |
| `SUB_SEASON` | 1 | split-season label; the total covers only some of the season's teams |
| no match | 0 | none - the audit fails if a team-less row is unproven |

**Lenix Osuna 2018 (`SUB_SEASON`).** The MLB Stats API (`people/624646`, `stats=yearByYear`,
`leagueListId=milb_all`, retrieved 2026-10-07) lists the 2018 Mexican League as season `2018.1` - Diablos Rojos
(2 G) and Guerreros de Oaxaca (5 G) with a team-less `numTeams: 2` aggregate of 7 G / 26 BF - and season `2018.2`
- Generales de Durango (21 G). The aggregate equals only the first two teams. The same split explains why the
022 game-log query (`season=2018`, empty) left these four Mexican League stints undated: `season=2018.1`
returns the games. Dating them is a later research pass; they stay valid `FOREIGN_PRO` source gaps.

## What 023 changes

- 56 `SEASON_TOTAL` rows tagged by natural key (player slug, season, level, league, no team), behind in-migration
  arithmetic guards. 772 `TEAM_STINT`, 0 `UNRESOLVED`; all 828 raw rows and all 832 milestones are unchanged.
- Additive totals (team stints only): hitter games 17,997 → 16,573, pitcher games 4,792 → 4,430, PA 70,329 →
  64,651, AB 59,907 → 55,098, H 15,183 → 13,902, BF 42,026 → 39,150, IP 9,206.3 → 8,592.3. 1,786 games were
  double-counted.
- `undated_log_era_stints` 60 → 4. Research queue 395 → 100 flags (no genuine flag hidden; the 11 unknown-level
  rows are real Pioneer League team stints).
- Status: Edgar León `OUT_OF_AFFILIATED_BASEBALL` → `A_BALL` (the only change).
- Organizations: Elio Campos 2025 Augusta → Atlanta Braves (`organization_count` 3 → 2, false multi-org flag
  cleared); Ronny Brito 2019 Vancouver → Toronto Blue Jays (previously Oakland, with no organization id).
  Alex De Jesús 2022-23 and Brito 2021 at Vancouver were already correct. The legitimate Campos (2024) and Brito
  (2019) `ORGANIZATION_CHANGE` milestones are untouched.

## Limitations

- Carlos Frías's Columbus Clippers 2017 stint has no organization (no Cleveland affiliation rule). That is a
  genuine `UNRESOLVED_ORGANIZATION` item and is not repaired here without verified evidence.
- The 56 stored totals carry no `numTeams` (021 did not keep it), so they are proven by arithmetic alone.
  Future ingests carry `numTeams` and the raw season label (`scripts/mlb/lib/development.mjs`,
  `classifySeasonTotals`), and require both the source signal and the arithmetic.
- 023 status is still appearance-based. Whether a one-game AAA cameo is developmental arrival is migration 024.
