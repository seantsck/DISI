# Migration 037 — development pathway intelligence

Second layer of the 036-038 bundle (design: `../036/architecture-report.md`). It is derived only: 021-024 are not rewritten, and no
fact is added.

| File | Role |
|---|---|
| `views.sql` | the four views |
| `037_template.sql` | preconditions, grants, postconditions |
| `audit.mjs` | replays 001-036 in PGlite; checks the level ladder and the stint facts the views rely on -> `audit-report.json` |
| `build.mjs` | assembles `database/sql/037_development_pathway_intelligence.sql` (deterministic) |

```
node database/research/037/audit.mjs && node database/research/037/build.mjs
```

## Views

- `v_player_development_season_path`: 560 player-seasons of affiliated developmental play (167 Dodgers players).
  - The **primary level** of a season is the level with the most games, so a short cameo is never a promotion.
  - Each season's transition is FIRST_SEASON 167, PROMOTED 182, REPEATED 194, REGRESSED 7 or RETURNED_AFTER_ABSENCE 10.
  - 2020 (no minor-league season) is never counted as an absence.
- `v_player_development_pathway`: one row per Dodgers signing (220).
  - Features:
    - signing age, route, position group
    - seasons from the professional-debut season to full-season ball / AA / AAA / MLB (024 developmental arrivals, 2020 excluded)
    - age in the AA arrival season
    - skipped, repeated and regressed levels
    - absences, same-level runs
    - terminal level, activity
  - A DISI-convention **pathway class** and a lifecycle `pathway_status` (REACHED_MLB / ACTIVE_AFFILIATED /
    NO_RECENT_AFFILIATED_RECORD / NO_HISTORY), with the 036 outcome spine beside them.
- `v_development_pathway_summary`: pathway class and early velocity (seasons to the first full-season level) by signing pathway.
  It gives milestone and mature-outcome counts, and shares only from 10 mature players upward.
- `v_development_pathway_research_queue`: unresolved arrivals 4, regressions with unsourced reasons 8, prolonged same-level runs 7,
  professional signings outside the model 8.

## Pathway classes (precedence order; seasons counted from the professional-debut season)

| Class | Rule | Players |
|---|---|---|
| NOT_CLASSIFIED_PROFESSIONAL_SIGNING | CUBAN_PRO, JAPAN_PRO, KOREA_PRO, POSTED_PLAYER, MEXICAN_LEAGUE_TRANSFER: never on the amateur ladder | 8 |
| INSUFFICIENT_HISTORY | no affiliated team-stint history, or an arrival the 024 review left unresolved | 49 |
| NONLINEAR | a season whose primary level is below an earlier season's | 5 |
| FAST_TRACK | Double-A or higher within 3 seasons | 9 |
| STANDARD_PROGRESSION | Double-A in 4-5 seasons | 9 |
| SLOW_PROGRESSION | Double-A after 6+ seasons, or active 6+ seasons without it | 8 |
| EARLY_EXIT | no affiliated play in the two most recent observed seasons and Double-A never reached (reason not inferred) | 49 |
| STALLED | active, no Double-A, the last 3+ consecutive seasons at one primary level | 7 |
| STILL_DEVELOPING | active, no Double-A, fewer than 6 seasons; never a failure label | 76 |

## Findings (observed associations, not causes)

- Only two summary cells reach the 10-mature-player gate, both LATAM amateurs:
  - Of the 11 mature players who reached a full-season level by their second season, 7 reached Double-A (0.636) and 1 reached
    MLB (0.091).
  - Of the 13 mature players who never reached full-season ball, none reached Double-A or MLB.
  - The 21 mature EARLY_EXIT players reached MLB 0 times, which is true by definition of the class.
- The development history mostly covers 2012+ signings. 43 of the mature Dodgers MLB players have no stint history. Their
  INSUFFICIENT_HISTORY rows are marked `COVERAGE_ARTEFACT_NOT_COMPARABLE` and carry no share: older records were kept mainly for
  players who reached MLB, so a 91% "reach share" there would describe record-keeping, not a path.
- The Double-A share is shown only for early velocity. The pathway classes are themselves defined by Double-A arrival, so a Double-A
  share by class would be true by definition.

## Guardrails

- No reason (injury, demotion, release, assignment choice) is inferred for any transition.
- A young active player is STILL_DEVELOPING, never an exit or a stall. Activity means affiliated play in the latest observed season or
  the one before it.
- Pathways are never blended: every summary row belongs to one signing pathway.
- The wording is "observed players on this pathway…". There is no forecast, score or causal column.
- The verifier gains seven checks (`scripts/db/lib/pathway-invariants.mjs`, 201 in total). No table is added; there are 121 views.
