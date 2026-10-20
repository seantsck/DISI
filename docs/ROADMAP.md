# DISI roadmap

DISI is a provenance-first research database of Dodgers international signings with a read-only product on top. This file records where it
stands and what the next phases are *for*. Nothing here is scheduled work: each phase starts only on an explicit decision.

## Where DISI stands (after 048 is built; 048 is not yet released)

- **v1.0.0 / schema v0.36.1** is in production through Migration 047 (released 2026-10-20, PR #17; frozen in PR #18). The product reads eleven
  persisted snapshots; the analytical layer is internal; the verifier has 247 hard checks. **048 is built, tested and awaiting release.**
- **220** Dodgers international signings are tracked. **93** have an outcome audit: **47** verified MLB, **46** verified no MLB.
  **127** are `NOT_AUDITED`. Of the **98** mature signings, **7** are not audited, and the audit policy correctly holds all seven (five are
  still playing affiliated ball in a class after 2020; two have no usable affiliated record). The other 120 `NOT_AUDITED` signings are in
  classes that are not yet five years old.
- Acquisition cost is known for **56** signings (046), a lower bound of $121.7M.
- Development history (047, released): **1083** stints and **873** milestones; **16** of 47 verified MLB players had both exact dates for
  signing-to-MLB; 7 transaction chains incomplete, 21 trade packages with an open issue.
- Development history (048, built): the other verified MLB players' careers (35 players, 776 stints, 200 milestones): pre-MLB history for **42**
  of 47 verified MLB players (10 before), signing-to-MLB with both exact dates for **45** of 47 (16 before), a verified first professional
  season for **19** of 47 under the pathway rule (3 before; 179 of 220 signings, 163 before). No path is complete: 44 of 47 are partial.
- Nothing is published that is not supported: **0** supported probability targets, **0** supported expected values, **0** recommendations.

## What 048 was for

047 was the controlled proof; 048 is the coverage expansion. Can DISI reconstruct the documented development path of every verified MLB
Dodgers international signing without inventing missing seasons or pretending a partial history is complete? Mostly yes, as far as the
official record goes, and the gaps are now named rather than hidden:

1. **The source begins late for older players** (Astacio signed in 1987 and the API begins in 1990; the 1950s players have no minor-league
   record at all). `FIRST OBSERVED SEASON != FIRST PROFESSIONAL SEASON`, and `PARTIAL HISTORY != NO HISTORY`: those seasons are unknown, not
   absent.
2. **Eight of the 47 were established professionals** (Cuban, Mexican League, NPB, KBO). Their first affiliated season is not their first
   professional season; the pathway rule keeps them out of the first-professional-season count.
3. **Six more ambiguous level sequences** need a person. 048 records them as pending, never decided, and adds a reviewer's packet.
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
- **Transaction chains.** Seven chains remain incomplete, and 21 trade packages have an open issue (cash, a player to be named, future
  considerations). Loading Baseball-Reference team-season bWAR (blocked today) would let Bob Miller's 1967 exit be recorded.
- **Audits as classes mature.** The 2021 class (22) is already mature: five players are active and need a decision rule once their careers
  end; the 2022 class matures in 2027.
- **Support thresholds.** Unchanged. The closest target remains `POSITIVE_BWAR_WITHIN_10_SEASONS` for the top-prospect benchmark sample
  (43 labelled, 7 positives; 7 more labels and 3 more positives needed; its 5 unaudited reference players are the first step).

## Not on the roadmap

Lowering a support threshold so a number can appear, treating `NOT_AUDITED` as no-MLB, replacing an unknown cost with zero or an estimate,
crediting a whole trade package to one signing, or letting a model write a canonical fact.
