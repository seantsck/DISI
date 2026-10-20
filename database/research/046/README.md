# Migration 046: reviewed acquisition-cost research batch

`database/sql/046_outcome_cost_research_batch.sql` is generated from this folder:

```
node database/research/046/build.mjs   # 046_template.sql + research-evidence.json -> the migration (deterministic)
```

| File | Purpose |
|---|---|
| `research-evidence.json` | The reviewed facts: 8 sources, 10 signing-bonus reports, and the 19 signings whose bonus was looked for (with the outcome of each) |
| `046_template.sql` | Guards, source insert, report insert, postconditions, one conditional snapshot refresh |
| `build.mjs` | Validates the evidence (closed vocabularies, one report per NEW fact, real disagreement for a CONFLICT, every source cited) and writes the migration |
| `baseline.json` | The `product_database_status` row read from production before 046, for `npm run research:progress` |

## What 046 changes

It is a research-data migration. It adds no table, view, function, grant or policy and writes no outcome audit.

| | Before | After |
|---|---|---|
| Signings with a known acquisition cost | 48 of 220 | 56 of 220 |
| Known acquisition spend (lower bound) | $117,377,237.33 | $121,700,237.33 |
| Open research tasks | 357 | 349 |
| `NOT_AUDITED` | 127 | 127 |
| Product snapshot generation | 3 | 4 (one refresh, only when a report was added) |

Eight bonuses were unknown and are now sourced: Sandy Amorós $1,000, Juan Guzmán $4,000, Raúl Mondesí $4,000, Pedro Martínez $6,500,
Miguel Vargas $300,000, Wilman Diaz $2,697,500, Jesus Galiz $812,500 and Rayne Doncon $497,500. Each has exactly one report, so each
resolves to its amount (confidence MEDIUM: one source, and none is a club or league primary text).

Adrián Beltré is the other side of the methodology. SABR says $23,000 and the AP report of Commissioner Selig's 1999 ruling says
$17,000. Both reports are ACTIVE, no resolution is recorded, the canonical bonus stays NULL and `v_signing_acquisition_financials`
reports a `CONFLICT`. He is a research task, not a number.

## What was looked for and not found

The `examined` list in `research-evidence.json` records every signing whose bonus was looked for: 8 resolved, 1 conflict and 10 unresolved
(Santana, Vivas, Ramón Martínez, Astacio, Chico Fernández, Offerman, and four 2018 Venezuelans whose class table prints the bonus as
"unknown"). Unresolved means the bonus stays unknown. It is never zero and never estimated.

## Rules the evidence follows

- A page is used only if it was fetched with HTTP 200 and read as raw HTML. MLB.com and Baseball America answered 403 and Pirates Prospects
  404; nothing was worked around, and search-snippet claims were never stored.
- Amounts printed with every digit are `EXACT`. `APPROXIMATE` never selects a canonical value.
- Independent reports that disagree both stay ACTIVE (a CONFLICT) and the canonical column stays NULL.
- A zero is never seeded. The builder rejects a non-positive amount; an evidenced zero would need its own reviewed evidence.

## Release and rollback

See `database/release/046-release-plan.md`. The migration is rerunnable; a rerun adds nothing and runs no refresh. The rollback is data-only
and guarded (it removes exactly the ten reports and eight canonical values this migration wrote, then refreshes once).

## Outcome-audit research (no migration: nothing met the audit policy)

| | Count |
|---|---|
| `NOT_AUDITED` at the start | 127 (7 mature, 120 in classes under five years old) |
| Mature `NOT_AUDITED` researched against the MLB record (2026-10-20, as of 2026-10-05) | 7 |
| New audits resolved | **0** |
| Still `NOT_AUDITED` after 046 | **127** |

The seven are all the 2021 opening class. Five (Romero, Abad, Galiz, Ramirez, Liranzo) played affiliated ball in 2026 with no MLB debut:
the audit policy audits "active in the minors" only for classes through 2020, so each remains `NOT_AUDITED` (an unfinished career is not an
outcome). Two (Barreto, Carpintero) have only signing and assignment transactions and no affiliated season, so the evidence is
`INSUFFICIENT_EVIDENCE` and they stay `NOT_AUDITED`. The policy was not changed.

The existing negatives were re-verified: all 46 verified no-MLB audits that have an MLB id were checked against the MLB person, season and
transaction records as of 2026-10-05. None has an MLB debut (41 career ended, 4 still active, 1 with unestablished status), so no stale
negative exists. See `transaction-research-notes.md` for the transaction work.
