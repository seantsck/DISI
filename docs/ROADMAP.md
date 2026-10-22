# DISI roadmap

DISI is a provenance-first research database of Dodgers international signings with a read-only product on top. This file records where it
stands and what the next phases are *for*. Nothing here is scheduled work: each phase starts only on an explicit decision.

## Where DISI stands (after 050 is built; 050 is not yet released)

- **v1.0.0** is in production through Migration 049 (transaction-package completion, released 2026-10-22, PR #21 merged as `519fad7`;
  production-verified; frozen in PR #22). Canonical `main` is `f378eeefb687ec6aef839c728e4abd0af63ec5f3`. The product reads eleven persisted
  snapshots; the analytical layer is internal; the verifier had 247 hard checks (generation 7, drift 0). **050 is built, tested and awaiting its
  release gate.**
- International benchmark (050, built): the MLB Pipeline international Top 30 lists of the 2015 and 2016 classes join the 2013 / 2014 trackers.
  Benchmark signings **48 -> 102** (27 + 27 verified non-Dodgers signings; the two listed Dodgers signings stay Dodgers records; 4 listed players
  are queued), identity-resolved **43 -> 99**, MLB reachers **11 -> 34**. `REACH_MLB_WITHIN_7_SEASONS` now meets its support minimum **in the
  benchmark sample only** (90 labelled, 19 positive, 71 negative): a reference baseline for those ranked prospects, never a Dodgers probability.
  `BENCHMARK SUPPORT != DODGERS SUPPORT`: no Dodgers target moved, no probability is published, and expected value and recommendations stay
  unsupported. The bWAR targets gain labels but no positives (no Baseball-Reference WAR is loaded; the files answer 403). The verifier has 248
  checks.
- **220** Dodgers international signings are tracked. **93** have an outcome audit: **47** verified MLB, **46** verified no MLB.
  **127** are `NOT_AUDITED`. Of the **98** mature signings, **7** are not audited, and the audit policy correctly holds all seven (five are
  still playing affiliated ball in a class after 2020; two have no usable affiliated record). The other 120 `NOT_AUDITED` signings are in
  classes that are not yet five years old.
- Acquisition cost is known for **56** signings (046), a lower bound of $121.7M.
- Development history (047 and 048, released): **1859** stints and **1073** milestones. Pre-MLB history exists for **42** of 47 verified MLB
  players, signing-to-MLB with both exact dates for **45** of 47, a verified first professional season for **19** of 47 under the pathway rule
  (179 of 220 signings). No path is complete: 44 of 47 are partial. 347 detector rows are 173 distinct pieces of development work.
- Transactions (049, released): **213** events, **396** assets, **7** resolutions; the transaction queue keeps **59** items and the value queue **91**. `KNOWN TRANSACTION != KNOWN RETURN VALUE`. Two chains whose history was open are now recorded to their end with the
  value of what came back unavailable, so the seven incomplete chains read as **five** whose transaction history is open and **two** whose history
  is recorded and whose returned players' Baseball-Reference WAR is not loaded. Open packages: **20** (membership open **5**, only terms open **15**).
  Nothing was valued and no unknown became zero. Abreu's return is recorded with its WAR unknown, so the home page's realized organizational value
  reads 297.60 bWAR (signings with resolved value 87).
- Nothing is published that is not supported: **0** supported Dodgers probability targets, **0** supported expected values, **0** recommendations.
  After 050, one **benchmark reference baseline** is supported (reach within 7 seasons, in the rank-selected Top-prospect sample); it is shown on
  Prediction readiness and the League Benchmark page as a reference result and never produces a Dodgers probability.

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
  the blocked pages. Two more chains (Abreu, Fernández) are recorded to their end and wait only for Baseball-Reference team-season bWAR, which
  answers 403 today: Garland, Grant and Versalles are the returned players whose value is unknown.
- **Audits as classes mature.** The 2021 class (22) is already mature: five players are active and need a decision rule once their careers
  end; the 2022 class matures in 2027.
- **Support thresholds.** Unchanged. In the benchmark sample, reach within 7 seasons is supported (050); `POSITIVE_BWAR_WITHIN_10_SEASONS` has 75
  labelled rows and 7 positives, and its 18 unlabelled rows are 15 reachers whose Baseball-Reference team-season WAR is not loaded (the files answer 403 today) and 3 unresolved identities. No
  Dodgers target is close: reach within 7 seasons has 25 labelled rows and 2 positives.
- **Benchmark depth.** The 2017 and 2018 Top 30 lists are already past the 7-season reach horizon (2024 and 2025 seasons) and are the next classes; the 2016 list's three Cuban signees
  whose route no readable source states, Christopher Martinez (2015), and the three remaining legacy identities are queued.

## Not on the roadmap

Lowering a support threshold so a number can appear, treating `NOT_AUDITED` as no-MLB, replacing an unknown cost with zero or an estimate,
crediting a whole trade package to one signing, or letting a model write a canonical fact.
