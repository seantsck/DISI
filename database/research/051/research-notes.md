# 051 research notes

Dates: the official source was read on 2026-10-22; the canonical state was read from production the same day (generation 8, after 050).

## The premise, checked

051 started from the expectation that the audited no-MLB players had not had the whole-career treatment 047 and 048 gave the verified MLB players.
They had: Migration 021 loaded every cohort player's whole recorded career from the same official season splits (306 rows, retrieved
2026-10-05), Migration 022 dated the log-era stints from game logs, and Migration 024 recorded the progression decisions. The re-read found the
record and the source in exact agreement. That is the finding, not a failure to find something.

## Findings worth keeping

- **Highest level is two questions.** The whole recorded career and the Dodgers-affiliate part of it differ for seven players: Clementina reached
  Triple-A with Atlanta after a Dodgers path that ends in the Pioneer League; Elio Campos reached Triple-A with Atlanta after a Dodgers record that
  ends in the DSL; León (Angels), Rincón (Mets), Brito and De Jesús (Blue Jays) and Doncon (Twins) likewise. Neither figure explains anything; both
  are what is recorded.
- **2020 is not a gap in anyone's record.** Every season-gap item in this cohort names only 2020. The four 2019 signings first observed in 2021
  (Lesther Medrano, Luis Rodríguez, Roque Gutiérrez, Yeiner Fernández) are `FIRST_OBSERVED_ONLY` under the 048 rule exactly as written (signing
  season or the one after it). Whether a cancelled season should be skipped when that rule counts seasons is a rule question with its own review;
  051 applies the rule unchanged and reports the four. Christopher Arias (signed 2015, first observed 2017) is a genuine late start: 2016 is missing,
  not absent.
- **Two players have no structured record at all.** Damaso Marte Jr. (MLB id 666006) and Sebastián Jiménez (699067): the person record exists and no
  season split is returned. Their highest level stays unknown; no rookie season is invented.
- **Rookie-advanced is not on the ladder.** Nine cohort players have Pioneer League seasons (Ogden, Billings, 2014-2018). They are on record and
  unplaceable by the reviewed taxonomy; see architecture.md.
- **Three Dodgers exits bracket their trade dates exactly.** Clementina (last Ogden game 2017-07-29, trade 2017-07-31, first Billings game
  2017-08-03), Rincón (2021-07-18 / 2021-07-21 / 2021-07-23) and De Jesús (2022-07-31 / 2022-08-02 / 2022-08-08). Cartaya's two-organization season
  (2025, Twins then Giants) is after he left the Dodgers (traded 2025-01-09) and is not a Dodgers exit season.
- **Foreign professional play stays apart.** Lenix Osuna's 2017-2019 Mexican League seasons are `FOREIGN_PRO`, never affiliated development; the
  minor-league game log returns no games for his 2018 season, so those three stints keep no dates.
- **Exit evidence is separate.** 37 cohort players have a recorded exit, 4 are still Dodgers-controlled, 3 have no exit evidence and 2 have no
  transaction history available. A last observed season is never read as a release.

## Not done on purpose

- No outcome was reviewed or changed. No contradiction was found; had one been, the player would have been stopped and reported, not corrected here.
- No source answering 403 (Baseball-Reference, MLB.com, MiLB.com) was read or worked around; no search snippet was used as evidence.
- No reason (injury, release, demotion, promotion) was inferred from any gap or sequence.
