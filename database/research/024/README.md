# Research behind migration 024

Everything needed to inspect and rebuild `database/sql/024_development_progression_decisions.sql`: the reviewed
progression decisions, the audit that checks them against the canonical data, and the assembly of the migration.

## Pipeline

| Step | Command | Output |
| --- | --- | --- |
| Reviewed input | hand-curated `values-decisions.json` | 20 decisions (11 reviewed, 9 pending review) |
| 1. Audit | `node database/research/024/audit.mjs` | `audit-report.json` (exits non-zero if a decision fails its evidence check or a raw inversion is uncovered) |
| 2. Build | `node database/research/024/build.mjs` | `database/sql/024_development_progression_decisions.sql` |
| Harness | `node database/research/024/test-024.mjs` | builds 001→023 in PGlite, runs 024 twice (apply + rerun) |

`audit.mjs` builds the canonical chain **before** 024 in an in-memory PGlite database; it needs no network and
touches no real database. It never creates a decision. `024_template.sql` is hand-maintained (it carries the 023
summary, research-queue and status definitions it recreates, with the reviewed changes); `build.mjs` only injects
the reviewed decision rows.

## Semantics

A `*_DEBUT` milestone is the **first recorded appearance** at a level. It is never rewritten. A decision says how
that appearance counts as **development**:

| Role | Meaning | Developmental arrival |
| --- | --- | --- |
| *(no row)* | the first appearance is the arrival | the first appearance |
| `DEVELOPMENTAL_ARRIVAL` | reviewed confirmation of the above (clears a candidate) | the first appearance |
| `EARLY_CAMEO` | a real appearance that did not establish the level | the reviewed later date, or NULL = not yet reached |
| `POST_ESTABLISHMENT_APPEARANCE` | first appeared only after establishing at a higher level | none (the level is skipped) |
| `REVIEW_REQUIRED` | ambiguous; pending review | unknown (state `UNRESOLVED`), never guessed |

`v_player_development_progression` derives, per player and ladder level (DSL, complex, A, High-A, AA, AAA, MLB;
never FOREIGN_PRO), the first appearance, the decision, the developmental arrival and a state: `REACHED`,
`SKIPPED` (no arrival here but an arrival at a higher level — derived, never stored), `NOT_REACHED`, or
`UNRESOLVED`.

## Evidence (audit-report.json)

| Player | Event | First appearance | Role | Arrival |
| --- | --- | --- | --- | --- |
| Roger Cedeño | High-A | 1998 (6 G, season-only), after AA/AAA 1993 and MLB 1995-06-20 | POST_ESTABLISHMENT_APPEARANCE | — |
| Omar Estevez | Complex | 2019-06-24 (7 G), after A 2016, High-A 2017, AA 2019-04-04 | POST_ESTABLISHMENT_APPEARANCE | — |
| Elio Campos | Complex | 2025-06-10 (3 G), after A 2025-04-04 | POST_ESTABLISHMENT_APPEARANCE (medium) | — |
| Elio Campos | AAA | 2025-08-01 (1 G), no AA/High-A ever | EARLY_CAMEO | not reached |
| Eduardo Guerrero | AAA | 2024-08-03 (1 G), before A 2024-08-06 | EARLY_CAMEO | not reached |
| Javier Herrera | AAA | 2025-08-01 (1 G) | EARLY_CAMEO | not reached |
| Eduardo Rojas | AAA | 2026-07-05 (1 G) | EARLY_CAMEO | not reached |
| Sean Linan | AAA | 2025-05-17 (2 G) | EARLY_CAMEO | not reached |
| Mairoshendrick Martinus | High-A | 2025-04-20 (7 G) | EARLY_CAMEO | 2026-08-02 (after 184 Low-A games) |
| Ronny Brito | High-A | 2019-05-30 (4 G) | EARLY_CAMEO (medium-high, stored MEDIUM) | 2021-05-04 |
| Jeral Pérez | A | 2023-04-20 (7 G) | EARLY_CAMEO | 2024-04-05 (after a 53-game ACL season) |
| Carlos Frías | A, High-A | High-A 2011 (12 G) and 2012 (3 G), Ogden, then A 2013 | REVIEW_REQUIRED ×2 | unknown |
| Carlos Avila | A, AA, AAA | AA 2024 (6 G) / 2025 (1 G), A 2025 (5 G), AAA 2025 (3 G), mainly ACL | REVIEW_REQUIRED ×3 | unknown |
| Christian Romero | AA, AAA | AAA 2024-05-17, AA five days later, High-A 2025, AAA again 2025 | REVIEW_REQUIRED ×2 | unknown |
| Nicolas Cruz | A, High-A | High-A 2024 (3 G), then interleaved High-A / A in 2025 | REVIEW_REQUIRED ×2 | unknown |

Each reviewed later arrival is the game-log first appearance of a team stint at that level (the migration guard
re-checks it). In each ambiguous sequence **every** level whose interpretation is unresolved is pending (9 events),
so no ambiguous appearance is silently accepted as an arrival. All 20 raw first-appearance inversions (14 players)
are covered.

**Heuristic candidates, not decisions.** A High-A/AA/AAA first appearance that skips the level below with at most
2 team-stint games is listed as `LEVEL_SKIP_CAMEO_CANDIDATE` in the research queue when no decision exists:
Umar Male, Domingo Gerónimo, Agustín Acosta and Reyli Mariano (each a 1–2 game AA appearance). Their analytics are
unchanged until someone reviews them.

## What 024 changes

- Elapsed development metrics (signing to A/High-A/AA/AAA, A to High-A/AA, High-A to AA, AA to AAA, AAA to MLB, and
  the season approximations to A/AA) use developmental arrival. Exact counts: signing→A 61→58, signing→High-A
  28→26, signing→AA 19→17, signing→AAA 11→4, A→High-A 32→34, A→AA 20→18, High-A→AA 19→17, AA→AAA 9→8, AAA→MLB 1;
  signing→pro debut 146 and signing→MLB 6 are unchanged. No negative interval and no developmental inversion remain.
- `first_*` and `age_at_first_*` stay literal first appearances; `dev_<level>_date/season/state/role` and
  `progression_review_pending` are appended to the summary.
- `player_development_status.status` is **the highest unambiguously established developmental level. Pending
  milestones do not count as reached and do not invalidate a separately verified higher level.** Guerrero and
  Linan AAA → AA; Herrera, Rojas and Campos AAA → A_BALL; Avila AAA → ROOKIE_LEVEL, Romero AAA → HIGH_A, Cruz
  HIGH_A → ROOKIE_LEVEL; Frías stays MLB (a verified outcome, unaffected by his pending A / High-A). Their status note names the levels pending review, and `progression_review_pending` is true.
  `highest_affiliated_level` is still appearance-based. Distribution: ROOKIE_LEVEL 94, MLB 47, A_BALL 33,
  HIGH_A 16, AA 14, AAA 7, OUT_OF_AFFILIATED_BASEBALL 1.
- The signing-class, market and bonus-band views keep their 021 `reached_*` / `*_reach_count` columns unchanged for
  existing consumers, now documented (column comments) as first appearances, and append
  `developmentally_reached_*` counts and `progression_review_pending_players`. The `/development` page shows the
  developmental counts under "Reached".
- The research queue adds `NON_MONOTONIC_PROGRESSION` (0 after the decisions) and `LEVEL_SKIP_CAMEO_CANDIDATE` (4).

## Limitations

- A level with no appearance below an unresolved level (Avila's High-A) is `NOT_REACHED`, not `SKIPPED`: skipping
  needs a decided higher arrival.
- Progression is derived from milestones; a player who reached MLB without an `MLB_DEBUT` milestone does not mark
  lower levels as skipped.
