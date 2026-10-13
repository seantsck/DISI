# Migration 040 — historical archetypes and comparables

Second layer of the 039-041 bundle (design: `../039/architecture-report.md`). It is derived only, with no table or fact added.

| File | Role |
|---|---|
| `views.sql` | the five views |
| `040_template.sql` | preconditions, grants, postconditions (selection rules re-checked at apply time) |
| `audit.mjs` | replays 001-039; measures archetype coverage and comparable pools -> `audit-report.json` |
| `build.mjs` | assembles `database/sql/040_historical_archetypes_comparables.sql` (deterministic) |

## Methodology

- **Archetype.** A structured key built only from the 039 signing-time features:
  - coarse key: route | position family at signing | age band
  - full key: adds at-signing expectation tier | cost band | market group | era

  No outcome is read, and no descriptive label is invented. 225 of 268 signings have a defined archetype. The other 43 lack the
  position at signing or the age.
- **Comparables.** For each signing whose position at signing is known, up to 20 other signings that:
  - share the route and position family at signing
  - were signed in an **earlier signing year** (history that existed at the time)
  - are **not** in the outcome-selected historical set

  They are ordered by a fixed hierarchy: match score (age band 16, expectation tier 8, cost band 4, market group 2, era 1), then age
  distance, a more recent signing year, and slug. `matched_dimensions` lists why each was chosen. An unknown value never matches. A
  missing at-signing expectation is missing, not "unranked", and never counts as a match.
- **Outcomes are attached after selection.** The tests flip every outcome audit, change every later position and delete every stint
  since 2020; the comparable sets, ranks, scores and archetypes stay byte-identical.
- **Samples.** Comparable summaries are kept per comparable population class (benchmark and Dodgers stay separable, never pooled). A
  share needs 10+ mature audited comparables of one class. Archetype summaries never give a share to the outcome-selected set.

## Coverage and findings

- Comparable states:

  | Target population | Rows: descriptive share | Listed, no share | Fewer than 5 | No earlier comparables | Position unknown |
  |---|---|---|---|---|---|
  | Tracked | 24 | 186 | 128 | 3 | 2 |
  | Opening class | 7 | 54 | 20 | 0 | 0 |
  | Top-prospect | 0 | 10 | 14 | 14 | 10 |

- Where a share exists, it describes the 2013/14 top-prospect comparables: for example, 2/10 to 4/16 reached MLB. That is a
  rank-selected sample, not a probability for the target.
- No coarse archetype yet has 10 mature audited members of one class, so `v_archetype_outcome_summary` shows counts and no shares.
- Research queue: ARCHETYPE_UNDEFINED 12, INSUFFICIENT_COMPARABLE_HISTORY 3.

The verifier gains five checks (`scripts/db/lib/archetype-invariants.mjs`, 217 in total). There are 62 tables and 134 views. Local
anon reads take at most 84 ms.
