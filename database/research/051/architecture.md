# 051 architectural gap analysis

Written before any 051 schema or data decision. Result: **no schema change and no data migration.** The existing model already represents every
fact the official source carries for the audited no-MLB cohort, and every one of those facts is already on record. 051 adds deterministic
derivations in `lib/research/`, a research mode, product reads of relations the contract already names, and one verifier check.

## Reused structures

| Need (spec phase) | Existing structure | Used for |
|---|---|---|
| the cohort (1) | `v_signing_records.outcome_audit_status` | `VERIFIED_NO_MLB` Dodgers signings, derived, never listed |
| whole recorded career (3, 4) | `player_season_stints` (021), with organization per team and season (021's affiliation table) | the comparison with the official source; the Dodgers-affiliate / other-organization split |
| highest level (5) | `v_dodgers_player_development_summary.highest_affiliated_level` (whole career) and the stints' own `organization_name` | both figures, reported apart |
| first professional season (6) | `firstProSeasonStatus` (048, pathway-aware) | applied unchanged |
| season coverage (7) | `historyCoverage` (048), with `LEAGUE_SEASON_NOT_PLAYED` (2020) | gaps and their causes, no `complete` flag |
| dates (10) | `first_game_date` / `last_game_date` (022), `development-exact-dates.mjs` | re-verified against today's game logs |
| ambiguous sequences (12) | `development_progression_decisions` (024) | every cohort inversion is already covered |
| needs (21) | `developmentNeeds` (048) | detector rows and de-duplicated evidence gaps, by group |

## Gaps found, and what 051 did about each

| Gap | Decision |
|---|---|
| The published highest-level distribution of audited no-MLB players counts the **whole recorded career**, including seasons with other organizations after the player left (7 of 44 players' highest level was first recorded elsewhere) | **Reported apart, not redefined.** `careerSegments` splits each career by the affiliate's own organization (a fact about that team and season, never inferred from adjacency); `/development` and the dossier show the whole-career figure, labelled, and the Dodgers-affiliate figure beside it. The view is unchanged, because the 037 pathway and 040 comparable layers read it and a redefinition belongs in its own reviewed migration. |
| The `SEASON_GAP` detector (021/024 SQL) does not know that 2020 was not played; every one of the cohort's 11 season-gap items names only 2020 | **Reported, not changed.** `historyCoverage` already explains 2020 (`LEAGUE_SEASON_NOT_PLAYED`), and the cohort measures say how many season-gap items are 2020-only. Changing the SQL detector would move every pinned queue count for all 220 signings; that is a separate reviewed decision. |
| The level taxonomy has no rookie-advanced level: Pioneer League seasons (2014-2018 here; 41 stints across all players) map to `OTHER` by the reviewed 021 era map ("rookie-advanced; complex-league equivalent only after reclassification") | **Documented as an architecture issue; the taxonomy is not modified to force a level.** A `ROOKIE_ADVANCED` level would be an enum change, a new ladder tier and a progression-rank change for every layer that ranks levels (024 progression, 037 pathways, 040 comparables). The stints stay on record, `LEVEL_UNCLEAR`, never ranked, and counted (`unplaceable_level_on_record`). |
| A two-organization season asks for the trade date to be verified (`MULTI_ORG_SEASON_UNVERIFIED`) | **Evidence attached, detector unchanged.** For each such season, `development-records.json` reports whether the dated appearances bracket the recorded exit transaction (three do exactly; one is after the player left). The transaction model stays the only source for an exit; nothing is created or moved. |
| Nothing verified that a VERIFIED_NO_MLB audit is consistent with the development record | **One verifier check**, `no_mlb_development_contradictions`: no such signing may hold an MLB-level stint or an `MLB_DEBUT` milestone (249 checks). |
| Development history must not reach the signing-time feature matrix | Already true (041); **proven again** in `tests/db/research-051.test.mjs`: new development rows leave `v_outcome_feature_matrix`, the support counts, the stored evaluation and the probabilities byte-identical. |

## Why no migration

A migration writes reviewed facts. The comparison found none to write: no stint, date, milestone, organization, level or review that the source
supports and DISI lacks. An empty migration, or one that re-asserts the existing state, would add a frozen file with no fact in it. The snapshot
generation therefore stays where 050 left it: no snapshot-backed relation changed.
