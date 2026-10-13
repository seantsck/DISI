# Migration 038 — trainer / academy / signing network outcomes

Third layer of the 036-038 bundle (design: `../036/architecture-report.md`). It is derived only: 029 is not rewritten, and no
association, outcome or cost is added.

| File | Role |
|---|---|
| `views.sql` | the four views |
| `038_template.sql` | preconditions, grants, postconditions |
| `audit.mjs` | replays 001-037 in PGlite; measures the network coverage and checks that every association has one tracked signing -> `audit-report.json` |
| `build.mjs` | assembles `database/sql/038_signing_network_outcomes.sql` (deterministic) |

```
node database/research/038/audit.mjs && node database/research/038/build.mjs
```

## Coverage at 037 (measured, not assumed)

There are 9 network entities, 8 of them with ACTIVE relationships, and 9 ACTIVE player relationships. The relationships cover
**5 Dodgers players**, all from the 2015 and 2017 classes. 7 of the 9 relationships are tied to a signing. 215 of the 220 Dodgers
signings have no documented association.

**This is a known network sample, not a census.** No entity's full population of trainees or signees is held.

## Views

- `v_network_player_outcomes`: one row per ACTIVE relationship (9). Each row carries:
  - the realized outcome (036 spine)
  - the earliest public expectation (036)
  - the pathway class (037)
  - cost and its completeness
  - `attribution_confidence`: how strongly the association is documented, never a share of credit
    - HIGH: tied to the signing, stated before or at signing, with HIGH / VERIFIED confidence
    - MEDIUM: tied to the signing, or HIGH / VERIFIED
    - LOW: otherwise
- `v_network_outcome_summary`: one row per entity and relationship type (8), with:
  - tracked / mature / audited signees
  - MLB reach and bWAR totals by side
  - cost coverage; a cost total only when every signee's cost is COMPLETE
  - pathway classes
  - `denominator_known` = false
  - `network_sample_state`: ANECDOTAL < 3 mature audited signees, SMALL_SAMPLE < 10, otherwise DESCRIPTIVE_SAMPLE, and never a census

  Every entity is ANECDOTAL today.
- `v_network_outcome_coverage`: KNOWN_NETWORK_SAMPLE vs UNATTRIBUTED_SIGNINGS for all Dodgers signings, by signing era and by
  pathway. Each segment shows both states, with zeros stated. The fixed label is `DESCRIPTIVE_ONLY_SELECTION_BIASED`, and no rate or
  difference is computed.
- `v_network_outcome_research_queue`: NETWORK_ENTITY_SAMPLE_ANECDOTAL 8, NETWORK_RELATIONSHIP_NOT_SIGNING_LINKED 2,
  NETWORK_SIGNEE_COST_INCOMPLETE 1.

## What the data can and cannot say today

- **Can:** which documented associations exist, how strong the documentation is, and what happened to each associated player.
  - Oneil Cruz (trained with Raul Valera; the stage is unknown and not signing-linked) reached MLB with 8.17 career bWAR, all of it
    after the Dodgers traded him.
  - Jorbit Vivas (signed out of the Yasser Mendez academy) reached MLB with 0.51 bWAR.
  - The three other documented 2015 signees did not reach MLB.
- **Cannot:** any trainer, academy or showcase effect, ranking, hit rate, ROI or prediction. Every entity has at most 2 documented
  signees, and the documented sample is selected by what public sources chose to report.

## Guardrails

- No value, bonus or outcome is credited to an entity.
- "Unattributed" means not documented, never "no trainer".
- A cost total appears only when the cost is complete, and no ratio of value to cost is computed.
- The verifier gains six checks (`scripts/db/lib/network-outcome-invariants.mjs`, 207 in total). No table is added; there are
  125 views.
