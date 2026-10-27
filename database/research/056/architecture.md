# Migration 056: architecture

## 1. Why 056

After 055 the Top-prospect benchmark holds the 2013-2018 lists. The 2019 class is the next one whose 7-season reach horizon has elapsed: under the
041 rule `exposure_complete = signing_year + 7 <= last_complete_season`, and the last complete season at the 2026-10-05 boundary is 2026, so a 2019
signing (2019 + 7 = 2026) is exposed. 056 adds it with the 050 / 055 method and rules, unchanged. No threshold is touched.

## 2. Source and editions

The cohort is the official MLB Pipeline feed `/gen/players/prospects/2019/playerProspects.json`, list `prospect_players.int`, captured by the
Internet Archive on 2019-07-01 with `last_updated` 2019-06-30, before the 2019-20 period opened on 2 July (the basis of 2015, 2017 and 2018).
Earlier 2019 captures (January, April) carry no international list. Five later editions were compared with the cohort:

| Edition (captured / last_updated) | Classification |
|---|---|
| 2019-08-14, 2019-09-29, 2019-10-26 | same ranking; clubs for 29; rank 8 re-keyed as "Emmanuel Rodriguez" |
| 2020-02-16 / 2020-02-13 | **re-ranked**: four players added (Pedro León, Norge Vera, Dyan Jorge, Emmanuel Rodriguez at #10), four dropped, 24 ranks moved. Recorded, never used |
| 2021-09-06 / 2019-12-15 (final revision) | same ranking; the club source, as in 055 |

The archive stores the later captures gzip-encoded; their SHA-256 and digest are of the archived payload and the list is read from the decoded JSON.

## 3. Identity (never by name alone; the 050 rules)

Imported unchanged. Common names resolve only by the listed club and position: Luis Rodriguez (three namesakes), Junior Sanchez, Luis Gutierrez.
What the rules cannot decide stays unresolved and goes to a person: Robert Puason (one exact-name OAK signing; the MLB record now lists a pitcher),
Yiddi Cappe (his official signing is Miami 2021-01-15, outside the 2019-06-01 - 2020-06-30 window; he is never redefined as a 2019 signing), and
Enmanuel Rodriguez (the official "Emmanuel Rodriguez", MIN: a one-letter variant, which is accepted only with the list's own club, and the final
revision re-keyed his slug, so no club carries over). The downstream effect of a resolution (Emmanuel Rodriguez debuted 2026-09-12) plays no part.

## 4. Membership and the Dodgers overlap

`RANKING APPEARANCE != NEW SIGNING`. Luis Rodriguez (#4, MLB 691177) is the Dodgers signing `luis-rodriguez-2019` (LAD 2019-07-02), which already
stores MLB Pipeline rank 4. It is mapped, never written: no benchmark copy, player or evaluation; the migration refuses to run if the row or its
rank has changed and re-proves it after the writes. `BENCHMARK SUPPORT != DODGERS SUPPORT`.

## 5. Database (data only)

The 055 rows, unchanged in kind: players, published-spelling aliases, signings (`MLB_PIPELINE_TOP_PROSPECT`, official signing date, published
position and rank, bonus NULL), one `TOP_PROSPECT_SAMPLE` population with members and member sources, one coverage row, evidence, one ACTIVE ranking
per player, audits, outcomes (`career_war` NULL), and the three stored evaluation rows (replaced only after proving they are the 055 ones). No
table, view, function, grant, policy or definition changes; every row that existed before 056 is proved byte-identical after it.

## 6. Labels, support, the evaluation

056 writes no label. Reach within 7: 4 TRUE, 22 FALSE (the official debut dates: Domínguez 2023-09-01, Amador 2024-06-09, Lara 2025-07-02, Acosta
2025-08-18). Top-prospect reach 140 (30 / 110) -> 166 (34 / 132), supported before and after; the bWAR targets do not move. The 041 evaluation is
re-run unchanged: 173 rows, 34 positives, 139 negatives, 7 folds (2019 is already a fold through Dodgers signings). José Salas (born in the United
States) is labelled but has no complete signing-time features, so he is not evaluated (the existing rule). No model is supported (logistic +0.018,
34 of 60 events; stratified -0.0065); the migration refuses to commit otherwise. Fingerprint `67f2f80c...` -> `86b58f473301e2425751d853abd88e94`.

## 7. Snapshots, verifier, rollback

One snapshot refresh (the 055 convention), drift 0. The verifier keeps 258 checks; five pins move (players 372 -> 398, benchmark players 152 -> 178,
evaluations 155 -> 181, legacy ranks 163 -> 189, represented 152 -> 178); the 055 values are `EXPECTATIONS_THROUGH_055`. `rollback-056.sql`
removes exactly the 056 rows, restores the 055 evaluation rows, keeps the sources as provenance, proves the Dodgers rows unchanged and refreshes
once; 056 can be applied again. The proposed hard check "no player with both a Dodgers and a benchmark signing" is a separate follow-up, not 056.
