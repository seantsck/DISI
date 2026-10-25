# Migration 055: architecture

## 1. Why 055

050 made `REACH_MLB_WITHIN_7_SEASONS` a supported reference baseline in the Top-prospect benchmark (90 labelled) and left every 10-season target
and every Dodgers target unsupported. The next mature classes are 2017 and 2018: both have completed the 7-season reach horizon (2024 and 2025
seasons are complete at the 2026-10-05 boundary). 055 adds them with the 050 method and rules, unchanged. No threshold is touched; the evidence
decides what moves.

## 2. Sources (as 050)

| Need | Source | Read how |
|---|---|---|
| List membership, rank, position | the official MLB Pipeline data feed `/gen/players/prospects/<year>/playerProspects.json`, list `prospect_players.int` | mlb.com answers 403; Internet Archive captures in raw `id_` mode. URL, capture time, `last_updated`, SHA-256 and the Archive's own digest are recorded |
| Signing club and date | the official MLB transaction log, per club over the class window (`SFA`, and `SGN` for some international amateurs) | direct |
| Identity, outcome, death | the MLB person record and career statistics | direct |
| Birth-date cross-check, Baseball-Reference id | the Chadwick register (identity crosswalk only) | direct, local copy |
| Cuban signing route | the official record, else a directly read Wikipedia account (route only) | direct |
| bWAR | Baseball-Reference only | answers 403: nothing loaded |

Both cohorts are the list as published before the signing period opened (2017-05-25, 2018-05-23), the stronger basis 050 used for 2015. The club
each player signed with is read from the final revision of the same feed (2018-08-29, 2019-04-17), which only narrows the candidates: the
signing club and date are always the official transaction's. Intermediate revisions disagreed for some 2018 players (Jose Rodriguez, Alexander
Ramirez); the official log decides. DISI spells San Francisco `SFG`; the feed and the Stats API write `SF`, mapped once in the derivation.

## 3. Identity (never by name alone; the 050 rules)

`database/research/050/identity-rules.mjs` is imported, not copied. A member is `RESOLVED` only when exactly one person the official log shows
signing inside the class window matches the published name, the club agrees with the list's club when it names one, the birth year fits, the
position family agrees, and the register birth date equals the person record where the register holds the person. Common names resolve only
by club and position (Luis Garcia, Julio Rodriguez, Carlos Rodriguez, Wander Franco, Jose Rodriguez - whose namesakes include a Dodgers signing).
What the rules cannot decide stays unresolved and goes to a person: Wildred Patino (a transposition; the official record is Wilderd Patiño),
Eduarqi Fernandez (a one-letter variant with no club in the final revision), Antonio Gomez and Alvin Guzman (one exact-name signing with the
listed club each, but the MLB record now lists a pitcher: the position-family rule compares the current position).

## 4. Membership

- `RANKING APPEARANCE != NEW SIGNING`. Diego Cartaya (#1) and Jerming Rosario (#30) are Dodgers signings. Each keeps his one Dodgers signing byte
  for byte, including the MLB Pipeline rank it already stores (Cartaya 1) or does not store (Rosario NULL). The rank observed in this edition is
  recorded in `cohort-decisions.json` only; no benchmark copy, player or evaluation is created, and the migration refuses to run if either row
  has changed. `BENCHMARK SUPPORT != DODGERS SUPPORT`.
- `SOURCE LIST MEMBERSHIP != VERIFIED SIGNING`. An unresolved member is not added; each population's `stated_composition` lists every member's
  decision and the existing `POPULATION_MEMBERS_NOT_TRACKED` queue item counts the gap.
- A Cuban signee whose route no readable source states is verified as a signing but not added (Osiel Rodriguez, Sandy Gaston, Denny Larrondo).
- `NO MLB DEBUT != NEGATIVE OUTCOME`. Daniel Flores (2017 #2, Boston) died on 2017-11-08 (official person record), four months after signing.
  A FALSE reach label would count a death as a prospect who did not develop. The 041 model has no exclusion state for a death, so 055 does not
  invent one: like the Cuban signees, his signing is verified and not added, recorded in the composition as `DECEASED_BEFORE_OUTCOME_HORIZON`.

## 5. Database (data only)

The 050 rows, unchanged: `players`, `player_aliases` (the published spelling), `signings` (`MLB_PIPELINE_TOP_PROSPECT`, official signing date,
published position and rank, bonus NULL), two `TOP_PROSPECT_SAMPLE` populations with their members and member sources, two `signing_census_coverage`
sample rows, `evidence` per field, 026 evaluations and rankings (DRAFT, ranking, then ACTIVE), `outcome_evidence`, `outcome_audits` and `outcomes`
(`career_war` NULL), and the three `outcome_model_evaluations` rows (replaced only after the migration proves they are the 050 ones). No table,
view, function, grant, policy or definition changes. Every row that existed before 055 is proved byte-identical after it (the 2013-2016 benchmark,
the Dodgers, costs, transactions, career history, development, WAR).

## 6. Labels, horizons and bWAR

055 writes no label; the 041 views derive them from the official signing year. A 2017 signing's reach horizon ends in 2024, a 2018 signing's in
2025: every added row is labelled for reach. Their 10-season horizons (2027, 2028) have not elapsed: every 10-season row is CENSORED with a NULL
label. George Valera (signed 2017, debut 2025) is FALSE for reach within 7 while his audit stays REACHED_MLB, as Miguel Amaya in 050.

## 7. Support and the evaluation

Thresholds are unchanged (50 / 10 / 10; 10 events per feature). Top-prospect reach: 90 (19 / 71) -> 140 (30 / 110), supported before and after.
Nothing crosses. The 041 evaluation is re-run unchanged: 148 rows, 30 positives, 7 folds. The population-stratified rate has no out-of-time skill
(-0.007); the L2 logistic model's skill is positive (0.035) but it has 30 positives where six features need 60. Both stay `MODEL_NOT_SUPPORTED`;
the migration refuses to commit if any model is supported. The fingerprint moves `af9ec05feb3ee1518cb7608193cd209a` -> `67f2f80cf330e1278095916314688eee`.

## 8. Snapshots, verifier, rollback

One snapshot refresh (the 050 convention: the readiness and executive snapshots read support and the evaluation), drift 0. The verifier keeps its
258 checks; five pins move (players 322 -> 372, benchmark players 102 -> 152, evaluations 105 -> 155, legacy ranks 113 -> 163 with 102 -> 152
represented); the 054a values are `EXPECTATIONS_THROUGH_054A`. `rollback-055.sql` removes exactly the 055 rows (the 026 ranking guards disabled
inside its transaction only, as in rollback-050), restores the 050 evaluation rows, keeps the sources as provenance, proves the Dodgers rows
unchanged and refreshes once; 055 can be applied again.
