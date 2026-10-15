# Migration 045: final integration (DISI v1.0.0)

Design: `../042/final-decision-architecture.md` (sections 15 and 18-20). Build: `node database/research/045/build.mjs` (deterministic;
`contract.json` + `metrics.json` + `views.sql` + `045_template.sql`).

| Object | What it is |
|---|---|
| `disi_product_contract` (table, 48 rows) | Exactly the relations `lib/data.js` reads. Each row gives the area, tier (EXECUTIVE / PAGE / DOSSIER / RESEARCH), routes and introducing migration, derived from the SQL files. Other public views stay readable research views but are not product API |
| `v_disi_release_status` (1 row) | `DISI v1.0.0`, schema `v0.36`, analysis as-of date, latest outcome audit and development data, model evaluation date, the probability / value / decision-engine versions, supported counts per layer and `support_chain_state` |
| `v_research_roadmap` (8 rows) | The highest-value research gaps in support-chain order, with open items, what each unlocks and the evidence needed |
| `v_executive_metric_provenance` | Every executive figure with its definition, denominator column, provenance and eligibility rule |

## The support chain, as of 2026-10-05

| Layer | Supported today | What is shown instead |
|---|---|---|
| 041 outcome probability | 0 of 4 targets; 0 of 1,072 probabilities | NULL with a reason |
| 042 expected organizational value | 0 of 1 model; 0 of 220 values | NULL with a reason, plus realized value |
| 043 predictive portfolio recommendations | 0 | Readiness states, feasibility and retrospective analysis |
| 044 interface | No probability, expected value, ranking or gauge rendered | The support statement and the evidence needed |
| 045 `support_chain_state` | `NO_PREDICTIVE_LAYER_SUPPORTED` | — |

The verifier's `support_chain_violations` fails if any layer supports more than the layer below allows. The tests also check the
switch: lowering one 041 threshold moves the chain to `PROBABILITY_ONLY` and no further.

## Research roadmap (priority order)

| Priority | Area | Open items |
|---|---|---|
| 1 | Outcome audits | 127 signings await an audit |
| 2 | Prediction support | The closest Dodgers target needs 25 more labelled outcomes, including 8 positives |
| 3 | Population completeness | 6 class-population items |
| 4 | Cost coverage | 172 unknown costs |
| 5 | Benchmark depth | 18 items |
| 6 | Signing-time features | 52 signings |
| 7 | Scouting coverage | 171 items |
| 8 | Realized-value resolution | Incomplete or unresolved transaction chains |

## Plan-bounded release status and roadmap (after the 2026-10-14 release attempt)

- `v_disi_release_status` reads its support counts from the executive overview. The definitions are the same, and they are computed once by the staged overview function.
- `v_research_roadmap` is a wrapper over `disi_research_roadmap()`, which counts each research queue in its own statement.
- Neither plans the whole stack at once. Before this change they needed about 690 MB and 245 MB of planner memory.
- Their output is byte-identical to the original definitions.
- The postconditions are structural only. See `../043a/README.md`.
