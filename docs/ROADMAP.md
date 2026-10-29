# DISI roadmap

DISI is a provenance-first research database of Dodgers international signings with a read-only product on top. This file records where it
stands and what the next phases are *for*. Nothing here is scheduled work: each phase starts only on an explicit decision.

## Where DISI stands (after 058 is released and production-verified)

- **v1.0.0** is in production through Migration 058 (transaction-return bWAR evidence, applied once and committed 2026-10-29, PR #42 merged as
  `3182db1`; production deployment `dpl_u3P4hWGspx5Daq2DRto2ZCHeEjWL`; production-verified **259/259**, generation **14**, drift **0**; frozen).
  057 was released 2026-10-28 (PR #40 merged as `b451809`; frozen in PR #41). 056 was released 2026-10-27 (PR #37 merged as `3d51789`; frozen in PR #38). 055 was released 2026-10-25 / 2026-10-27 (PR #35 merged as `a0aae5f`; frozen in PR #36). 054a was released 2026-10-25 (PR #33 merged as `8741e95`; frozen in PR #34). 054 was released 2026-10-25 (PR #31 merged as `b73811c`; frozen in PR #32). 053 was released 2026-10-24 (PR #29 merged as `0d959ed`; frozen in PR #30). 052 was released
  2026-10-23 (PR #26 merged as `89742f2`; frozen in PR #28) with the dossier transaction-boundary hotfix (PR #27, `e36d2b8`; app only). 051 is
  released with no migration (PR #25 merged as `9bf42da`). 050 was released 2026-10-22 (PR #23 merged as `459460d`; frozen in PR #24). Canonical
  `main` after 058 is `3182db1ac24f4eadf10a330b3a44fb73acf6cf10`. Catalog: **79** tables, **156** views, **37** functions; **3384** sources.
  The product reads eleven persisted snapshots; the analytical layer is internal.
- Transaction-return bWAR evidence (058, released and production-verified): Baseball-Reference team-season bWAR for the four returned players of
  existing Dodgers trades whose value was unknown only because their WAR was not loaded (Garland, Leyritz, Grant, Versalles), from the two 057
  captures (no new source, player, mapping or schema). **91** rows (28 / 15 / 36 / 12; active WAR **1934 -> 2025**); Versalles's 1969 WSA stint
  is not loaded. The unchanged interval-bounded rules value them: Garland +0.17 is Tony Abreu's sole return (Abreu realized **1.40**); Leyritz
  -0.61 is shared-package value of the Vizcaino trade (Vizcaino stays 0.09); Grant +1.39 and Versalles -1.12 are observable, not attributable,
  value of the Fernández chain (Fernández stays 0.62). Realized organizational bWAR **297.60 -> 299.00** across **87 -> 88** signings; transaction
  queue **58 -> 57**, value queue **93 -> 90**; `BWAR_MISSING` stays 50. Prediction outputs stay at zero (byte-identical). 259 checks (the
  unavailable-WAR pins move to `EXPECTATIONS_THROUGH_057`); one snapshot refresh. Rollback: rollback-058 restores the logical pre-058 state;
  rollback-057 is permanently unavailable once 058 has ever been applied (the retracted 058 rows still cite the shared 057 sources), accepted
  before release (`database/release/058-release-plan.md`).
- Benchmark bWAR evidence (057, released and production-verified): Baseball-Reference team-season bWAR for the eleven mature benchmark MLB
  reachers whose 10-season window ends by 2025, read from Internet Archive captures of the two Baseball-Reference data files DISI already cites
  (the live files answer 403), each pinned by archive digest and SHA-256; observed through 2025, no partial 2026. **54** team-season rows (53
  batting, 1 pitching; active WAR **1880 -> 1934**) and the eleven `career_war` values (the 035 rule). Benchmark
  `POSITIVE_BWAR_WITHIN_10_SEASONS`: **75 (7 / 68) -> 86 (15 / 71), BASELINE_SUPPORTED** (reference baseline 0.174); `BWAR_2_WITHIN_10_SEASONS`
  **86 (9 / 77)**, not supported. Two benchmark reference baselines are now supported (reach, positive bWAR). `BASELINE SUPPORTED != MODEL
  SUPPORTED`: the stored bWAR evaluations (88 rows, 4 folds) support no model (stratified skill -0.014; logistic 14 of 60 events). Dodgers support,
  the reach evaluation, probabilities, expected values and recommendations do not move. Deferred: Arias, Oña, García Jr. and Morales (horizon
  2026); three identities stay unresolved. 259 checks (no pin moved); one snapshot refresh.
- International benchmark depth, 2019 (056, released and production-verified): the MLB Pipeline international Top 30 list of the mature 2019 class,
  read from the archived official feed as published on 2019-06-30, before the signing period opened, with the 050 / 055 method and identity rules
  unchanged. 30 listed, 27 resolved: 26 benchmark signings added and Luis Rodriguez (#4) mapped to his Dodgers signing, byte for byte (stored rank
  4). Benchmark signings **152 -> 178**. `REACH_MLB_WITHIN_7_SEASONS` in the benchmark sample: **140 (30 / 110) -> 166 (34 / 132)**, supported
  before and after; 2019: 4 TRUE (Domínguez, Amador, Lara, Acosta) / 22 FALSE; every 2019 10-season label is censored (horizon 2029). Three
  identities wait for a person: Robert Puason (position family), Yiddi Cappe (official signing MIA 2021-01-15, outside the window), Enmanuel
  Rodriguez (the official "Emmanuel", a variant with no list club). The re-run evaluation (173 rows, 34 positives, 7 folds) supports no model
  (logistic +0.018 with 34 of 60 events; stratified -0.0065). Dodgers support, probabilities, expected values and recommendations do not move.
  258 checks (five pins); one snapshot refresh.
- International benchmark depth (055, released and production-verified): the MLB Pipeline international Top 30 lists of the mature 2017 and 2018
  classes, read from the archived official feed as published before each signing period opened, with the 050 method and identity rules unchanged.
  Benchmark signings **102 -> 152** (28 + 22). `REACH_MLB_WITHIN_7_SEASONS` in the benchmark sample: **90 (19 / 71) -> 140 (30 / 110)**, supported
  before and after; every 2017 / 2018 10-season label is censored (horizons 2027 / 2028). Diego Cartaya and Jerming Rosario stay Dodgers records
  byte for byte (Rosario's stored rank stays NULL). Daniel Flores (died 2017) is verified and not added: `NO MLB DEBUT != NEGATIVE OUTCOME`. Three
  Cuban signees whose route is unknown are not added; four identities wait for a person (Patino, Gomez, Guzman, Fernandez). The re-run evaluation
  (148 rows, 30 positives) supports no model: the logistic model's out-of-time skill is positive (+0.035) but it has 30 of the 60 events its six
  features need. Dodgers support, probabilities, expected values and recommendations do not move. 258 checks (five pins); one snapshot refresh.
- Development research-queue performance (054a, released and production-verified): a query-shape correction only. The 054 queue view
  materialized its `team_stints` CTE, which on the hosted database (work_mem 2 MB) spilled to disk and was rescanned per player: as anon about
  1.3 s and about 5.4 GB of temp reads per read, and one `/development` request hit the 3 s anon timeout (57014). 054a marks the CTE
  `NOT MATERIALIZED`: about 55 ms, no temp I/O, the same 128 rows (whole-row hash `a263c500...`). Nothing else moves: every table, snapshot,
  grant and function is identical; 258 checks; generation stays 10, no refresh. Production gate: four concurrent anon sessions through the
  transaction pooler, 0 errors and every read under 1 s (one later run timed out during a brief instance slowdown with the same plan and buffers;
  three re-runs after a quiet period passed, 45/45 reads, max 794 ms). `QUERY SHAPE != QUERY RESULT`.
- Full-career transaction history (054, released and production-verified): `DODGERS ASSET LEDGER != FULL CAREER HISTORY`. The transaction ledger
  stays the Dodgers asset ledger; a player's moves between two other clubs get their own table (`player_career_transactions`, **46** reviewed rows
  from the official log and Retrosheet) and a labelled stream (`v_player_career_transactions`). Career history explains development chronology only.
  Transaction-blocked needs **16 -> 0**; development needs **108 -> 104** (detector rows 132 -> 128; players 65 -> 62): 4 close, 11 become
  source-limited (the recorded moves predate dated game logs), 1 goes to a person. The ledger, queues (58, 93), WAR, costs, outcomes and prediction
  do not move. 258 checks; one snapshot refresh (the contract gains one relation, 47 -> 48).
  Release note (not a defect): `/development` keeps the legend's definition of "Waits on a transaction", but no current development gap is
  classified that way (transaction-blocked is 0). The table column, the summary sentence and all 16 former per-gap labels are gone. The legend was
  left unchanged on purpose: removing it would be an application-code change, outside the bookkeeping-only freeze.
- Transaction and chronology resolution (053, released and production-verified): the development research queue reads a canonical transaction in the player's
  own direction and recognizes the Dodgers end of a move (a release before the other club's first game, a free-agent signing after its last); ten
  Dodgers transactions the official log or Retrosheet states are recorded (Baez, Park, Vizcaino and Leyritz, Daal, Castro). Development needs
  **110 -> 108** (transaction-blocked 18 -> 16; detector rows 134 -> 132; players 66 -> 65). **Every remaining transaction-blocked need waits on a
  move between two other clubs**: later organization history, which DISI's Dodgers ledger does not record. Transaction queue 59 -> 58, value queue
  91 -> 93 (the Vizcaino trade's unknown return value and shared package). 255 checks; one snapshot refresh.
- International benchmark (050, released): the MLB Pipeline international Top 30 lists of the 2015 and 2016 classes join the 2013 / 2014 trackers.
  Benchmark signings **48 -> 102**, identity-resolved **43 -> 99**, MLB reachers **11 -> 34**. `REACH_MLB_WITHIN_7_SEASONS` meets its support
  minimum **in the benchmark sample only** (90 labelled, 19 positive, 71 negative): a reference baseline for those ranked prospects, never a Dodgers
  probability. `BENCHMARK SUPPORT != DODGERS SUPPORT`.
- Development taxonomy and chronology (052, released and production-verified): every team stint checked against the official team record for its own team id
  and season (319 organizations resolved, 3 corrected, 1 co-op club with no MLB parent), 528 log-era stints and 101 level debuts dated from the
  official game log, 2020 no longer counted as a missing minor-league season (the official schedule holds no game), a season bracketed by a canonical
  transaction and game dates no longer flagged. Development needs **173 -> 110** (detector rows 347 -> 134, players 85 -> 66), none of them a fact
  the official source holds: 61 source-limited, 26 taxonomy-limited (the Pioneer League), 18 transaction-blocked, 5 for a person. 252 checks.
- Audited no-MLB development coverage (051, released, no migration): the 46 audited no-MLB players' recorded careers were checked fact by fact against
  the official season splits and game logs. **Every** stint (306), dated stint (278) and dated milestone (182) matches; the source holds nothing
  DISI lacks, so no canonical row is written. 051 reports the cohort's documented paths with the Dodgers-affiliate part and later play elsewhere
  apart, and adds one verifier check (249).
- **220** Dodgers international signings are tracked. **93** have an outcome audit: **47** verified MLB, **46** verified no MLB.
  **127** are `NOT_AUDITED`. Of the **98** mature signings, **7** are not audited, and the audit policy correctly holds all seven (five are
  still playing affiliated ball in a class after 2020; two have no usable affiliated record). The other 120 `NOT_AUDITED` signings are in
  classes that are not yet five years old.
- Acquisition cost is known for **56** signings (046), a lower bound of $121.7M.
- Development history (047 and 048, released): **1859** stints and **1073** milestones. Pre-MLB history exists for **42** of 47 verified MLB
  players, signing-to-MLB with both exact dates for **45** of 47, a verified first professional season for **19** of 47 under the pathway rule
  (179 of 220 signings). No path is complete: 44 of 47 are partial. After 054, 128 detector rows are 104 distinct development needs across 62 players (0 transaction-blocked).
- Transactions (after 053; 054 leaves the ledger unchanged): **223** events, **410** assets, **7** resolutions; after 058 the transaction queue holds **57** items and the value queue **90**.
  Packages with an open issue: **21** (membership open **5**, terms open **18**). `KNOWN TRANSACTION != KNOWN RETURN VALUE`. 049 recorded two chains
  whose history was open to their end with the value of what came back unavailable. 053 added ten Dodgers transactions (14 assets); its Vizcaino
  trade adds one terms-open package (cash of unstated amount). 058 loaded the returned players' WAR (Garland, Leyritz, Grant, Versalles), so the
  Abreu, Fernández and Vizcaino chains are complete and **five** incomplete chains remain, each with an open transaction history; the home page's
  realized organizational value reads 299.00 bWAR (signings with resolved value 88). No unknown became zero.
- Nothing is published that is not supported: **0** supported Dodgers probability targets, **0** supported expected values, **0** recommendations.
  After 050, one **benchmark reference baseline** is supported (reach within 7 seasons, in the rank-selected Top-prospect sample); it is shown on
  Prediction readiness and the League Benchmark page as a reference result and never produces a Dodgers probability.

## What 054 is for

053 proved that the transaction ledger is a Dodgers asset ledger: every exit, acquisition, package, return, control interval and value reads it.
The 16 needs it left waited on moves between two other clubs, which cannot go there without reading as Dodgers exits. 054 gives those moves their
own home, under `CAREER TRANSACTION != DODGERS ASSET TRANSACTION`, `CAREER MOVE != ASSET PACKAGE` and `ONE KNOWN MOVE != COMPLETE CAREER`.

1. **A separate layer.** One sourced movement fact per row, in the player's direction; a trade names both clubs, a release no destination, a signing
   no origin; never a Dodgers organization. No package, return, value or attribution.
2. **Two facts stay two.** A release and a later signing are two rows; the layer never synthesizes a trade between the clubs.
3. **Chronology only.** The research queue reads career history for a move between two other clubs; no asset, package, control or value view does,
   and a verifier check fails if one ever does.
4. **What remains is explained.** Most of the moves fall in seasons before dated game logs: the transaction is known, the appearances are not, so the
   season is source-limited. Castro's 2008 dated appearances overlap; a person reviews them.

## What 053 is for

052 classified the development queue; 18 needs waited on a transaction. 053 asked, for each of their 39 open seasons, whether an approved source
states the move, whether it is a Dodgers transaction, and whether the rule could read the one already on record, under `TEAM CHANGE != CANONICAL
TRANSACTION`, `ORGANIZATION CHANGE != TRANSACTION TYPE`, `KNOWN DESTINATION != KNOWN TRANSACTION MECHANISM` and `KNOWN EXIT DATE != KNOWN RETURN`.

1. **The rule read the ledger, not the player.** Every canonical transaction is recorded from the Dodgers' side, so an acquisition read backwards,
   and a release or a signing (no counterparty) could never bracket a season. The detector now reads the player's direction and the Dodgers end of
   a move; a release is never a trade and the other club's signing is never implied.
2. **Dodgers transactions the sources state, recorded.** Ten, each identity matched by exact birth date; where the official log and Retrosheet
   disagree on a date, both are kept and the official log is used. Castro's 2000 exit and his later re-signings are stated and not recorded:
   their return needs a sealed observation no rollback can remove.
3. **Later organization history stays open.** A move between two other clubs is not a Dodgers transaction; recording it in the Dodgers ledger would
   read as a Dodgers exit in the asset views. Every remaining transaction-blocked need is one of these.
4. **No unknown became a zero.** Leyritz's Dodgers bWAR was not loaded at 053 (RETURN_WAR_UNKNOWN; loaded by 058); the Vizcaino trade's cash amount is unknown. No stint,
   milestone, decision, audit, cost, WAR row, feature or probability moved.

## What 052 was for

051 left the development queue explained but large. 052 asked, for each of its 173 needs, whether a fact is missing, the taxonomy cannot place it,
no approved source holds it, a person must decide, or the detector misreads a known condition, under `HISTORICAL LEAGUE LABEL != MODERN LEVEL`,
`AFFILIATE NAME != ORGANIZATION WITHOUT SEASON CONTEXT`, `LEAGUE SEASON NOT PLAYED != MISSING PLAYER SEASON` and `SOURCE-LIMITED != RESEARCH FAILURE`.

1. **Facts the official record holds, recorded.** Organizations from the official team record per stint and season (a hand list of affiliates had
   missed 320 stints and mis-assigned three), and exact dates from the official game log (528 stints, 101 level debuts, 11 first professional games
   for amateur signings). Exact dates exposed five within-season sequences; they are pending reviews, never decided.
2. **Two detector conditions corrected.** 2020 is the league's, not the player's, for an affiliated minor leaguer; a season bracketed by a canonical
   transaction and game dates is not open. Every other detector is the 024 text.
3. **The Pioneer League stays unplaced, with the reason on record.** The official record files every season DISI holds under the Rookie sport;
   "Rookie Advanced" belongs to 2019-2020 only. A new level would contradict the record and touch every ladder; it waits for a reviewed decision.
4. **What remains is classified.** `npm run research:development -- --causes` and `/development` say, for each open need, why it is open and what
   evidence would close it. No outcome, transaction, WAR, cost, feature, probability or snapshot moved.

## What 051 was for

047 and 048 described the verified MLB players' documented paths. 051 asked the same of the 46 audited no-MLB players, under
`AUDITED NO MLB != CAREER FAILURE`, `LAST OBSERVED SEASON != CAREER END` and `DEVELOPMENT HISTORY != PREDICTION FEATURE`.

1. **The record was already the source.** Migration 021 had loaded every cohort player's whole recorded career, and the re-read on 2026-10-22
   matched it exactly: 306 of 306 stints, 278 of 278 dated stints, 182 of 182 dated milestones, no conflict, no organization to resolve, no new
   sequence review. 051 therefore writes nothing; a migration with no reviewed fact in it would only add a frozen file.
2. **Highest level is two questions.** The published distribution counts the whole recorded career. Seven players first reached their highest
   level with another organization after leaving, so the Dodgers-affiliate figure (Triple-A 5, not 9) is now shown beside it, never blended.
3. **What remains open is explained, not researched away.** Every season gap in the cohort is 2020; the level gaps are Pioneer League
   rookie-advanced seasons the taxonomy has no place for (documented, not forced); two players have no structured record at all and keep an unknown
   highest level; Carlos Ávila's sequence stays pending for a person.
4. **No prediction moved.** Development history is post-signing information; it never reaches the signing-time feature matrix, and a test proves
   new development rows leave the matrix, support, evaluation and probabilities byte-identical.

## What 050 was for

049 left the remaining transaction work blocked by sources DISI cannot read today. The next tractable bottleneck was outcome support: the nearest
041 target was the benchmark's positive-bWAR target (43 labelled, 7 positive), and the five unresolved benchmark identities alone could not reach the
50-row minimum. 050 extended the same MLB Pipeline international Top 30 methodology to the mature 2015 and 2016 classes, without lowering any
threshold, and let the evidence decide.

1. **A ranked list is not a signing, and a list year is not a signing year.** A listed player became a benchmark row only with an official MLB
   signing transaction and an identity resolved by more than his name (club, signing window, birth date, register, position). The two listed
   Dodgers signings stayed Dodgers records. Signing years come from the official dates: Luis Robert Jr. is on the 2016 list and signed in 2017.
2. **Reach crossed; value did not.** With 47 more labelled amateur rows, reach within 7 seasons met its minimums in the benchmark sample (19
   positives). The bWAR targets gained 32 labels but no positive: 23 reachers have no loaded Baseball-Reference WAR, so their labels stay NULL.
3. **Benchmark support is not Dodgers support, and one layer had pooled them.** The executive overview counted a target as supported when any
   population supported it. With the benchmark supported, it would have reported published probabilities while none exist. 050 fixed that one
   statement (and the snapshot check that mirrored it) so the published state follows the population DISI actually predicts for.
4. **The evaluation was re-run, not kept.** More labelled rows made the stored 041 evaluation stale; the same evaluation on the new data (101 rows,
   19 positives) still finds no model that beats the base rate out of time.
5. **Two of five legacy identities resolved, one is an open conflict.** DeJesus (reached MLB in 2023) and Zapata (Micker Adolfo) are resolved; Yrizarry's
   only matching signing disagrees with the stored country, and Rosario and Amundaray have no official record.

## What 049 was for

048 finished the broad development-history expansion. 049 returns to the other evidence gap: what happened to the asset after a Dodgers
international signing left, what the Dodgers received, and how much of that return DISI can value. The order is transaction truth, package truth,
return identity, return value, player attribution, and it is never reversed.

1. **Transaction truth did not need to wait for value.** The database already represents a known trade whose returned player has no loaded
   Baseball-Reference WAR (`RETURN_WAR_UNKNOWN`, `INCOMPLETE_WAR_NOT_LOADED`). The coupling was a verifier rule that required every returned
   player of a tracked-signing trade to have WAR, and the 047 decision not to record Bob Miller's 1967 exit or Tony Abreu's return. 049 records
   both, keeps the value `NULL`, and narrows the verifier rule to one pinned, explicitly reviewed id (Jon Garland) instead of removing it.
2. **What was missing is three different things.** The research tooling now classifies every open issue as a transaction-history or
   package-membership blocker, a terms blocker (cash or pool-space amount) or a value blocker, without storing the classification.
3. **The Abreu trade was a PTBNL completion stored as if it were the trade.** It is corrected forward to the 2009-08-31 agreement (Jon Garland
   for a player to be named later) with the 2009-10-09 delivery kept in the record.
4. **The obscure cases stay open for honest reasons.** No readable source states a Dodgers exit for the minor-league assets of the Mondesí, Nomo
   and Amorós trades, the Offerman return, the Frías player-to-be-named-or-cash, any cash amount or any pool-space amount. Disappearance from
   later records is not a release.

## What 048 was for (released 2026-10-21)

047 was the controlled proof; 048 is the coverage expansion. Can DISI reconstruct the documented development path of every verified MLB
Dodgers international signing without inventing missing seasons or pretending a partial history is complete? Mostly yes, as far as the
official record goes, and the gaps are now named rather than hidden:

1. **The source begins late for older players** (Astacio signed in 1987 and the API begins in 1990; the 1950s players have no minor-league
   record at all). `FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON`, and `PARTIAL HISTORY != NO HISTORY`: those seasons are unknown, not
   absent.
2. **Eight of the 47 were established professionals** (Cuban, Mexican League, NPB, KBO). Their first affiliated season is not their first
   professional season; the pathway rule keeps them out of the first-professional-season count.
3. **Six more ambiguous level sequences** need a person. 048 recorded them as pending, never decided, and added a reviewer's packet.
4. **The development queue double-counted evidence gaps.** 347 detector rows are 173 distinct pieces of work.
5. **Game-log dates and organization resolution are the next real work.** Every verified MLB path still has an open chronology issue.

## What 047 was for

Make how acquired players moved through the system, and what happened to the asset afterward, auditable. 047 added the development
research queue, the independent completeness dimensions, the attribution states, a controlled research batch (five Retrosheet-sourced exits and
ten players' whole development careers), and the asset-path views on `/development`, `/asset-conversion` and the dossier. It built no
development model, and no probability, expected value or recommendation became supported.

What the 047 research showed:

1. **Transaction gaps hide in downstream hops.** The "nine incomplete chains" are about the players the Dodgers *received*, not the signing's own
   exit. Five exits were recorded; the rest need an older-era source or the Baseball-Reference WAR files (which answer 403 today).
2. **Development history was missing for most verified MLB players.** Only 2 of 47 had pre-MLB seasons. The official API fills in most of it, but
   it starts late for older players and omits many international rookie-league seasons, so first-professional-season stays unknown for them.
3. **More history makes more gaps visible.** The development research queue grew from 104 to 154 items because ten careers entered, which is
   what loading real history should do.

## What 046 was for

Make more verified research available to future analysis, and make the remaining gaps explicit and ordered. 046 added: the read-only
research commands, a deterministic outcome cohort and cost queue, transaction work items, readiness blockers on the product, a verified
batch of acquisition costs, and the methodology in [`RESEARCH-METHODOLOGY.md`](RESEARCH-METHODOLOGY.md).

What the 046 research showed about the bottlenecks:

1. **Outcome audits are limited by time, not effort.** The mature `NOT_AUDITED` cohort is 7 players. Re-checking all 46 verified no-MLB
   audits against the MLB record found none that has since debuted. The 120 recent signings become auditable as their classes mature
   (the 2022 class, 55 players, from 2027).
2. **Acquisition cost is limited by readable sources.** Of the 19 signings whose bonus was looked for, 8 were found, 1 is a source conflict
   and 10 stay unknown; the blocked pages (MLB.com, Baseball America) are the main obstacle.
3. **Transaction chains need package-level research.** Nine chains are incomplete. Five are pre-2000 players whose Dodgers-era exits are
   absent from the MLB transaction API; the other four involve packages or players to be named that the 033 audit must rebuild. They were
   not completed by inference.

## Candidate next phases (not started)

- **Development history, continued.** The verified MLB cohort is covered at season precision. What remains: dated game logs for the log-era
  seasons (exact first and last appearances), organization resolution for non-Dodgers affiliates and historical franchise names, the seven
  ambiguous sequences (Jansen and the six 048 adds) for a person to decide, and the five players for whom the API holds no record before the MLB
  debut (three 1950s players, Valenzuela and Ryu). The audited non-MLB signings are the next development cohort after that.
- **Cost research with access.** A human retrieval of the pages that answer 403 (Baseball America international reviews, MLB.com) would
  resolve most remaining unknown bonuses in classes since 2012.
- **Transaction chains.** Five chains still have an open transaction history (Mondesí and Nomo: minor-league assets with no readable exit; Amorós:
  Gail Harris; Offerman: an unnamed conditional return; Frías: a player to be named or cash), and 20 trade packages have an open issue (cash, a
  player to be named, future considerations, pool space). The evidence that would close them is older-era club records or a human retrieval of
  the blocked pages. The Abreu and Fernández chains are complete since 058 (released); Garland's 2011 Dodgers stint, after his recorded exit, is
  queued as a return without a recorded acquisition and credited to no trade. Four returned assets still have no loaded WAR (Roberts, Garcia,
  Muegge, Juárez: no Baseball-Reference id); their value stays unknown, not zero.
- **Audits as classes mature.** The 2021 class (22) is already mature: five players are active and need a decision rule once their careers
  end; the 2022 class matures in 2027.
- **Support thresholds.** Unchanged. In the benchmark sample, reach within 7 seasons (050) and positive bWAR within 10 seasons (057) are
  supported; `BWAR_2_WITHIN_10_SEASONS` is one positive short (86, 9 / 77). Its 7 unlabelled rows are the four 2016-class reachers, whose window
  needs a capture taken after the 2026 season, and 3 unresolved identities. No Dodgers target is close: reach within 7 seasons has 25 labelled rows
  and 2 positives. `BWAR_MISSING` (50) reads `CAREER_BWAR` metric observations, which 057 does not write; closing it is a separate decision.
- **Benchmark depth.** 055 added the 2017 and 2018 lists and 056 the 2019 list. The 2020 class is not yet past its 7-season horizon (2027). Queued:
  the three 056 identities for a person (Puason, Cappe, Enmanuel Rodriguez), the four 055 identities for a person (Patino, Gomez, Guzman, Fernandez), the Cuban signees of 2016 (three) and 2018 (three) whose route no
  readable source states, Christopher Martinez (2015), and the three remaining legacy identities.
- **Verifier hardening (implemented, no migration).** The hard check `dodgers_benchmark_signing_overlap_players` (population group) counts canonical
  players holding both a Dodgers-franchise signing and a `MLB_PIPELINE_TOP_PROSPECT` signing; it must be 0. A Dodgers signing that appears in a
  benchmark list (Cartaya, Rosario, Luis Rodriguez) is mapped, not copied, and is not an overlap. 050, 055 and 056 still assert it in their own
  postconditions; the verifier now catches a later write. 259 checks (one new); no data, schema or pin changes beyond the check count.

## Not on the roadmap

Lowering a support threshold so a number can appear, treating `NOT_AUDITED` as no-MLB, replacing an unknown cost with zero or an estimate,
crediting a whole trade package to one signing, or letting a model write a canonical fact.
