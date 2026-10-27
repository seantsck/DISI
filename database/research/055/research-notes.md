# Migration 055: research notes

## Source verification (2026-10-25)

- Cohort captures re-downloaded from the Internet Archive and compared byte for byte with the probe's copies: identical SHA-256 (2017
  `2397266c...`, 2018 `029bfce6...`), and the SHA-1 of each payload equals the Archive's own CDX digest (`P2LLK4QR...`, `JBLKCXBZ...`): the
  files are the archived payloads, unmodified.
- Each holds `prospect_players.int` with exactly 30 records, ranks 1-30 once each, no club named (pre-signing), `year` and `prospect_year` equal to
  the class. The 2018 capture of 2018-06-16 carries the identical rank / name / position / slug tuples.
- The committed rank lists reproduce the raw captures: md5 of `[rank, first, last, position, slug]` is `8afcbdb1e7e832cda8eaf8ef94f74581` (2017)
  and `ab82ba95899a87081d9f2f76ce436232` (2018) computed from the raw files and from `source-cohorts.json` alike.
- Earlier captures were not usable: 2017-04-10 has no `int` list, 2017-01-30 is a stub; 2018-02-16 and 2018-03-21 have no `int` list.

## Decisions that need a person

| Class | Rank | Published | Why it is not resolved |
|---|---|---|---|
| 2017 | 25 | Wildred Patino (OF, ARI) | The official transaction reads "Arizona Diamondbacks signed free agent CF Wilderd Patino" (2017-10-02; the person record spells Wilderd Patiño). A two-letter transposition is outside the 050 one-letter variant rule; no candidate matches. |
| 2018 | 11 | Antonio Gomez (C, NYY) | One exact-name official signing with NYY (682625, 2018-07-02), but the MLB record now lists him as a pitcher; the 050 rule compares the current position family. |
| 2018 | 16 | Alvin Guzman (OF, ARI) | Same: one exact-name ARI signing (682630, 2018-07-02), MLB record now a pitcher. |
| 2018 | 18 | Eduarqi Fernandez (OF) | The official record is "Eduarqui Fernandez" (MIL 682631): a one-letter variant, accepted only with the list's own club. Later revisions re-key him under a corrected slug (`fernandez_eduarqui`) and name MIL there; clubs are carried over by slug, so the cohort entry has no club and the variant is not accepted. |

None is guessed. A reviewer who accepts one adds it in a later migration with the evidence above.

## Verified, not added

- Daniel Flores (2017 #2, BOS 2017-07-02, MLB 677567): the official person record's `deathDate` is 2017-11-08. His missing debut is not a prospect
  outcome; no label is written (`DECEASED_BEFORE_OUTCOME_HORIZON`).
- Osiel Rodriguez (NYY), Sandy Gaston (TB), Denny Larrondo (NYY): born in Cuba; no official winter-league or Caribbean Series season before the
  signing year and no readable account of Cuban National Series play. The route is not established, so the signing is not added (050 rule).

## Dodgers overlaps (mapped, never written)

- Diego Cartaya (2018 #1): official LAD signing 2018-07-02, MLB 682616; DISI's Dodgers signing stores MLB Pipeline rank 1. Unchanged.
- Jerming Rosario (2018 #30): official LAD signing 2018-07-02, MLB 682645; DISI's Dodgers signing stores no rank (NULL). Unchanged: the observed #30
  is not written.
- Jose Rodriguez (2018 #21, TEX catcher): one of his four namesakes signed with the Dodgers in the same window (692064); the list's club sets him aside.

## Other facts worth knowing

- San Francisco: DISI's organization abbreviation is `SFG`; the feed and the Stats API write `SF` (050 had no Giants signing).
- Signings after the class year: Stir Candelario (2017 list, TB 2018-03-28) has signing_year 2018; no 2018-list signing is in 2019.
- The six 2017 and six 2018 reachers are listed in `source-audit.json`; George Valera's 2025 debut is his eighth season (FALSE for reach within 7).
- The Chadwick register was downloaded fresh (16 files, SHA-256 in `identity-research.json`); it records no death for any resolved player.
