# DISI roadmap

DISI is a provenance-first research database of Dodgers international signings with a read-only product on top. This file records where it
stands and what the next phases are *for*. Nothing here is scheduled work: each phase starts only on an explicit decision.

## Where DISI stands (after 046, not yet released)

- **v1.0.0 / schema v0.36.1** is in production through Migration 045b. The product reads eleven persisted snapshots; the analytical layer
  is internal; the verifier has 247 hard checks.
- **220** Dodgers international signings are tracked. **93** have an outcome audit: **47** verified MLB, **46** verified no MLB.
  **127** are `NOT_AUDITED`. Of the **98** mature signings, **7** are not audited, and the audit policy correctly holds all seven (five are
  still playing affiliated ball in a class after 2020; two have no usable affiliated record). The other 120 `NOT_AUDITED` signings are in
  classes that are not yet five years old.
- Acquisition cost is known for **48** signings (**56** with 046), a lower bound of $117.4M ($121.7M with 046).
- Nothing is published that is not supported: **0** supported probability targets, **0** supported expected values, **0** recommendations.

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
3. **Transaction chains need package-level research.** Nine chains are incomplete. Four are pre-1999 players absent from the MLB
   transaction API; the others involve multi-player packages that the 033 audit must rebuild. They were not completed by inference.

## Candidate next phases (not started)

- **Development history.** The model already supports it (see the audit in the methodology); the work is coverage: 101 of 268 players
  have no season stints, 111 items are queued.
- **Cost research with access.** A human retrieval of the pages that answer 403 (Baseball America international reviews, MLB.com) would
  resolve most remaining unknown bonuses in classes since 2012.
- **Transaction chains.** The nine incomplete exits, then the 26 unresolved package attributions.
- **Audits as classes mature.** The 2021 class (22) is already mature: five players are active and need a decision rule once their careers
  end; the 2022 class matures in 2027.
- **Support thresholds.** Unchanged. The closest target remains `POSITIVE_BWAR_WITHIN_10_SEASONS` for the top-prospect benchmark sample
  (43 labelled, 7 positives; 7 more labels and 3 more positives needed; its 5 unaudited reference players are the first step).

## Not on the roadmap

Lowering a support threshold so a number can appear, treating `NOT_AUDITED` as no-MLB, replacing an unknown cost with zero or an estimate,
crediting a whole trade package to one signing, or letting a model write a canonical fact.
