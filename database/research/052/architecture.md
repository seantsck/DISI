# 052 architectural gap analysis

Written before the migration was settled. Result: **a data migration and one detector correction; no table, enum, function, grant or policy.**
Every fact 052 records fits the existing model; the one structure that does not (a rookie-class league that is neither international nor complex)
is documented and left unplaced.

## Reused structures

| Need (spec phase) | Existing structure | Used for |
|---|---|---|
| season-aware organization (4, 5) | `player_season_stints.organization_id` / `organization_name`, resolved per stint and season (021), with `detail.organizationBasis` | the parent organization the official team-season record names for the stint's own team id and season, with the record itself kept in `detail.organizationEvidence` |
| historical organization names | one `organizations` row per franchise (Brooklyn and Los Angeles kept apart, as 021 did) | the franchise row; the season's own parent name (Montreal Expos, Florida Marlins, Cleveland Indians) stays in the evidence |
| exact dates (10) | `first_game_date` / `last_game_date` / `game_date_basis` (022) | filled only where NULL, only from the gameLog |
| exact level debuts | `development_milestones.date_precision` / `prior_evidence_basis` (022) | SEASON -> DAY in place, inside the milestone's own season |
| sequence reviews (12) | `development_progression_decisions` (024) | PENDING_REVIEW rows for the sequences exact dates make visible |
| era-aware levels (2, 3) | `development_level_era_map` (021) | the Pioneer League per era |
| detectors (8, 9) | `v_dodgers_development_research_queue` (024) | two conditions corrected; every other detector unchanged |
| the multi-organization check (6, 7) | `transaction_events` / `transaction_event_assets` (033) | read, never written |

## Gaps found, and what 052 did about each

| Gap | Decision |
|---|---|
| 320 team stints had no organization: the 021 affiliation rules are a hand list keyed by team name, so the 048 careers (other clubs, other decades) and every historical franchise name (Cleveland Indians, Montreal Expos) fell outside it | **Resolved from the official record, per stint.** The MLB Stats API team record for the stint's own team id and season names the parent organization (a major-league club is its own). No new table: the fact belongs to the stint, and a separate affiliate table would duplicate it. 1,383 of 1,386 recorded organizations matched the record; the 3 that did not (the New Orleans Zephyrs carried as Houston's in 2005-2007) are corrected and the research rule fixed. One co-operative club (Bakersfield 1995) has no MLB parent and stays unresolved |
| The Pioneer League has no level: 41 team stints (1988-2018) are `OTHER`, unranked, `LEVEL_UNCLEAR` | **Taxonomy-limited, documented, not forced.** The official record files every one of those seasons under the Rookie sport (16), the sport of the Dominican Summer and complex leagues; it filed the league under Rookie Advanced (5442) only in 2019 and 2020, when no stint on record exists, and under the Independent sport (23) from 2021. A `ROOKIE_ADVANCED` level would contradict the official classification of every season on record; mapping to `COMPLEX_ROOKIE` would be an assumption (it is not a complex league). A new level would also need an enum value (which cannot be used in the transaction that adds it), a ladder rank every highest-level query honors (an unranked affiliated level sorts first under `order by level_rank desc`), and a review of the 024 progression tiers, 037 pathways and 040 comparables. 052 records the per-era classification in the era map and leaves the stints unplaced |
| `SEASON_GAP` counted 2020 as a missing season (16 players' only gap) | **Corrected in the view.** The official schedule holds no 2020 regular-season game at sport ids 11-16; the rule explains 2020 only for an affiliated minor leaguer without a major-league stint by then, so the leagues that played (MLB, NPB, KBO) are never suppressed. A verifier check proves no affiliated minor-league stint exists for 2020 |
| `MULTI_ORG_SEASON_UNVERIFIED` fired for seasons the record already explains | **Corrected in the view.** A season closes only when one canonical transaction of the player between exactly two organizations is bracketed by his dated appearances. TEAM CHANGE != CANONICAL TRANSACTION: no transaction is created, and a season without one stays open |
| 534 log-era stints were undated: 048 loaded careers without game logs | **Dated from the official gameLog** (528). The 6 left are 2018 Mexican League stints: foreign professional play the minor-league log does not carry (source-limited) |
| Exact dates make a within-season inversion visible (a lower level's first game after a higher level's) | **Recorded as pending reviews** (5, for 4 players), as 048 recorded the season-precision ones; the verifier's no-inversion check depends on it. None is decided |
| A dated first professional game was proposed for professional signings | **Rejected by the 048 rule.** For Ryu, Sasaki, Urías, Puig, Álvarez and Díaz the first affiliated game is not the first professional game; Herrera and Rosso were first observed two or more seasons after signing |
| Nothing checked that a season-bounded organization stays season-bounded | **One verifier check** (`organization_evidence_violations`): the evidence names the stint's own team and season, and the Dodgers organization is assigned exactly when the record names the Dodgers. Two more: no 2020 affiliated minor-league stint, no date without a game-log basis (252 checks) |

## Why no new table, enum or function

A table of affiliate ownership would hold exactly what each stint already carries, keyed the same way, and would need its own RLS, grants and
verifier coverage to say nothing new. An enum value for a rookie-advanced level would assert a classification the official record gives to no
season on record. The detector correction is a view definition; the migration replaces it with the 024 text plus two conditions, and the rollback
restores the 024 text byte for byte.

## Snapshots

No persisted snapshot reads a stint organization, a game date, a milestone date, a pending review, the era map or the research queue: the
migration proves every snapshot still equals a fresh evaluation of its source (drift 0) and runs no refresh. The generation does not move.
