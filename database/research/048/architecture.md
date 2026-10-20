# 048 architectural gap analysis

Written before any 048 schema decision. Result: **no schema change is necessary.** The existing model represents every fact 048 needs, so
048 adds research data, deterministic derivations in `lib/research/`, and product reads of relations the contract already names.

## Reused structures

| Need (spec phase) | Existing structure | Used for |
|---|---|---|
| sourced chronology of development (2, 3) | `player_season_stints` (player / team / league / level / season, with source, as-of and retrieval) | the whole recorded career of each cohort player |
| first-appearance and arrival events (3, 5) | `development_milestones` + `development_event_codes` (date precision, season, evidence basis) | `DSL_DEBUT` .. `AAA_DEBUT`, `MLB_DEBUT`, `ORGANIZATION_CHANGE`, `RELEASED`, `RETIRED` |
| ambiguous level sequence (5, 6) | `development_progression_decisions` (`REVIEW_REQUIRED`, `PENDING_REVIEW`) + `v_player_development_progression` | pending, never decided |
| prior professional leagues (12) | `FOREIGN_PRO` level and `FOREIGN_PRO_LEAGUE` classification (021), `signings.pathway` (`CUBAN_PRO`, `JAPAN_PRO`, `KOREA_PRO`, `POSTED_PLAYER`, `MEXICAN_LEAGUE_TRANSFER`; 037's `PROFESSIONAL_SIGNING` route) | an established professional's affiliated start is not his first professional season |
| derived timing (8) | `v_dodgers_player_development_summary`, `disi_development_days / years` | signing-to-MLB from two exact dates, never stored |
| queue (9) | `v_dodgers_development_research_queue` (14 detectors) | merged by evidence gap in `lib/research/development-needs.js` |
| chronology and review reads (6, 13) | `v_player_development_stints`, `v_player_development_milestones`, `v_player_development_progression`, `development_progression_decisions` (all already `SELECT` to the API roles, with row-level security) | the reviewer's packet, the coverage table |

## Gaps found, and what 048 did about each

| Gap | Decision |
|---|---|
| `FIRST_PRO_SEASON` ignored the acquisition pathway: Puig (a Cuban professional) counted as a known first professional season, and 048's data would have added Urías, Álvarez and Díaz | `firstProSeasonStatus` returns `PRIOR_PROFESSIONAL_CAREER` for the five professional pathways; the pre-048 figure restates from 164 to 163 |
| "what is documented" was a single count of stints | `historyCoverage` names why the record is silent (source unavailable, begins late, no evidence for a season, organization unclear, level unclear); 2020 is explained by the league, not queued |
| the queue double-counted one missing-evidence fact under up to five detectors | `developmentNeeds` merges them into six evidence-gap needs; nothing is deleted and the detector rows stay visible |
| no human-review surface for a pending sequence | `progressionReviewPacket` / `--review`: read-only, decides nothing |
| a second precision of the same milestone would have been inserted for players Migration 021 already researched | the build removes rows already on record, and the migration refuses if the state disagrees |
| a timing interval mixes amateur development with an established professional's acquisition-to-debut | described by acquisition route, each with its denominator, never compared |
| NPB / KBO / Cuban seasons before the signing are not in the affiliated API | **documented as a limitation**: no subsystem was added; `FOREIGN_PRO` stints appear where the API carries them (Mexican League), and the pathway keeps the first-professional-season measure honest |
| organization resolution is the 021 affiliation table (Dodgers affiliates only, current club names) | **not changed in 048**; reported as `ORGANIZATION_UNCLEAR` and queued. The official teams endpoint carries `parentOrgName` per team and season, which a later phase can use, with historical franchise names mapped to the 31 organization rows |
| game-log dates for 2006+ seasons | **not retrieved in 048** (a second research pass with its own rollback); reported as `GAME_DATES` |

## Why a new table or column would be wrong

- Coverage, gap causes, needs and the review packet are functions of canonical rows; storing them would duplicate derivable facts and let them go stale.
- The pathway rule is a property of the signing, already stored; the first-professional-season status is derived from it.
- A review decision belongs in `development_progression_decisions` so the sealing and role rules apply; 048 writes only `PENDING_REVIEW` rows.
- Every table that would be exposed needs RLS, grants, policies and a Data API audit; none is needed.
