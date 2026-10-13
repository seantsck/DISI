# Migration 038a — network outcome view performance (post-038 correction)

A forward-only, query-shape correction. It is applied after the already-applied 038 and before any 039, and it does not take 039's
slot in the roadmap.
- The `038a_` name sorts between `038_` and `039_` in the manifest and in fresh replays, following the `004a` letter-suffix precedent.
- The applied 038 file is frozen in `tests/db/frozen-migrations.json` and is not edited.

| File | Role |
|---|---|
| `views.sql` | the new definition of `v_network_player_outcomes` |
| `038a_template.sql` | precondition (038 applied) and postconditions (SELECT-only API, security_invoker, one row per ACTIVE relationship) |
| `build.mjs` | assembles `database/sql/038a_network_outcome_view_performance.sql` (deterministic) |

## Why

On the hosted database, anon reads of `v_network_outcome_summary` and `v_network_outcome_research_queue` exceeded the 3 s statement
timeout (57014). `v_network_player_outcomes` and the spine came close on a cold read.

The 038 definition of `v_network_player_outcomes` computed the following for every tracked signing before selecting the few
documented network players:
- the 036 realized-outcome spine, three times (directly, and inside the expectation and pathway views)
- the 037 development summary
- the 036 expectation layer

The two slow views read `v_network_player_outcomes`.

## What changes

- **Only the query of `v_network_player_outcomes`.** It starts from the ACTIVE relationships and reads the spine once. It applies the
  036 anchor rule and the 037 pathway-class rule to the documented players only. Every intermediate is MATERIALIZED, so the planner
  cannot re-run it per output row.
- **The same:** columns, types, row set, NULLs, labels, grants, comment, security_invoker, and every other view.
  `v_network_outcome_summary` and `v_network_outcome_research_queue` read the new view unchanged.
- **No table, fact, grant or policy changes.**

## Proof

- The old 038 definitions were kept as copies and compared with the new ones:
  - on the real data
  - on a synthetic ACTIVE relationship for every tracked signing (268 players), covering all 9 pathway classes and 5 expectation
    states and NULL pathways for benchmark players

  All four network views return identical rows (`tests/db/network-038a.test.mjs`).
- Verifier 207/207. 038a is idempotent and reproducible.
- Local PostgreSQL 17, as anon, server-side milliseconds over 7 consecutive reads:

| View | 038 | 038a |
|---|---|---|
| `v_network_player_outcomes` | 58-81 | 20-21 |
| `v_network_outcome_summary` | 59-75 | 21-36 |
| `v_network_outcome_research_queue` | 56-60 | 20-28 |
| `v_network_outcome_coverage` (does not read the player view) | 15-17 | 14-22 |
