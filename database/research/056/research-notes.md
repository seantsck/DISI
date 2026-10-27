# Migration 056: research notes

## Source verification

- The cohort capture was re-downloaded from the Internet Archive and compared byte for byte with the feasibility copy: SHA-256
  `9162c700163c1f40df0f75daccf5c68dfbde160e11000916456c75866379625f`; the SHA-1 of the payload equals the Archive's CDX digest
  `MAQMR2BLWSWRPZCIL222OY36SNO3AJBI`. `year` 2019, every `prospect_year` 2019, 30 records, ranks 1-30 once each, no club named, no record missing
  a rank, name, position or slug.
- The committed rank list reproduces the raw capture: md5 of `[rank, first, last, position, slug]` is `ee47e18dddabe538a628f81907a82799` from the
  raw file and from `source-cohorts.json` alike.
- The final revision (club source) was re-downloaded and is byte-identical: SHA-256 of the archived gzip payload `2a4bd11a...`, digest `Q7EXICG3...`.
- Not usable as the cohort: the 2019-01-29, 2019-04-11 and 2019-04-30 captures have no `int` list; the 2020-02-13 edition is a re-ranking.

## Decisions that need a person

| Rank | Published | Official record | Why it is not resolved |
|---|---|---|---|
| 2 | Robert Puason (SS, OAK) | 691188, OAK 2019-07-02 | The one exact-name signing is with the listed club, but the MLB record now lists a pitcher; the 050 rule compares the current position family. |
| 7 | Yiddi Cappe (SS) | 691268, MIA 2021-01-15, born in Cuba | No official signing inside the 2019 class window (2019-06-01 - 2020-06-30). As a 2021 signing his horizons would differ (reach 2028) and his Cuban route is not established. |
| 8 | Enmanuel Rodriguez (OF) | 691181 "Emmanuel Rodriguez", MIN 2019-07-02 | A one-letter variant, accepted only with the list's own club; later revisions re-key him under `rodriguez_emmanuel`, so the cohort entry has no club. He debuted in MLB on 2026-09-12; a resolution would add a TRUE reach label, which does not affect this decision. |

## Dodgers overlap (mapped, never written)

Luis Rodriguez (#4): official LAD signing 2019-07-02, MLB 691177; DISI's Dodgers signing `luis-rodriguez-2019` stores MLB Pipeline rank 4,
the same as this edition. Unchanged. Three namesakes signed in the same window and are set aside by the listed club.

## Other facts

- Every added signing is dated in 2019 (the latest: Luis Gutierrez SD 2019-07-31, Kristian Cardozo SEA 2019-08-01, Jhon Diaz TB 2019-08-29).
- No death is recorded for any resolved player; no debut falls after the boundary; no Cuban signee is resolved.
- Sources added: 54 (the cohort capture, the club revision, 26 person records, 26 transaction logs).
- Prior backlog (out of scope): the four 055 identities and the six Cuban route cases were re-read on 2026-10-27; nothing new under the rules.
