# 054a: development research-queue performance

`node database/research/054a/build.mjs` writes `database/sql/054a_development_queue_performance.sql` and `database/release/sql/rollback-054a.sql`.

- `054a_template.sql`, `rollback_template.sql`: the guards and postconditions.
- `build.mjs`: reads the research-queue view from the frozen 054 file and replaces exactly one token, `with team_stints as (` ->
  `with team_stints as not materialized (`. The rollback carries the 054 statement byte for byte.

No research data: 054a changes the query shape only. QUERY SHAPE != QUERY RESULT: the rows are proved identical in the migration, in
`tests/db/research-054a.test.mjs` and in `database/release/pg17/validate-054a.mjs`. The measurements that motivated it are in
`database/release/054a-release-plan.md`.
