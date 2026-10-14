# 045a: product snapshot serving (post-045 serving-layer correction)

`database/sql/045a_product_snapshot_serving.sql` is built from this directory:

```
node database/research/045a/build.mjs
```

The build is deterministic. Its inputs:
- `045a_template.sql`: the header, precondition, first-generation step and structural postconditions.
- `snapshots.mjs`: the ten product snapshot definitions. They are shared with the verifier (`scripts/db/lib/product-snapshot-invariants.mjs`) and the tests.
- `../045/views.sql` and `../045/contract.json`: the release status is re-issued with schema v0.36.1 and canonical file 045a.

The design, the read models, the refresh, the API boundary and the evidence are in `../045/serving-layer-architecture.md`.

To refresh after research data changes: `npm run refresh:product-snapshots` (privileged credentials in `DISI_REFRESH_DB_URL`), or
`database/release/sql/refresh-product-snapshots.sql` through the release runner. `--drift` reports staleness without writing.
