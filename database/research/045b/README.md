# 045b: home-page status snapshot (post-v1.0.0 performance hardening)

`database/sql/045b_database_status_snapshot.sql` is built from this directory:

```
node database/research/045b/build.mjs
```

The build is deterministic and reuses the 045a generators (`../045a/build.mjs`), so the refresh and drift functions can differ from 045a
only by the eleventh snapshot and its two validation rules. Inputs: `045b_template.sql` (header, precondition, first-generation step,
postconditions) and `snapshots.mjs` (the snapshot definition, shared with the verifier and the tests).

## Why

After DISI v1.0.0 the home page was the last public page that evaluated a legacy analytical view on every request: `v_database_status`
is one row of 25 scalar subqueries over the signing-record, class-coverage, population-coverage and research-task view stacks and
repeats per-player work. Under four concurrent full-page visitors it approached the 3 s statement timeout. The rule from 045a applies:
**the public product never reconstructs an analytical graph during a request.**

## What

```
v_database_status                      INTERNAL: owner only (definition unchanged)
    |  disi_refresh_product_snapshots()   one validated transaction, eleven snapshots, one generation
product_database_status                PUBLIC: anon / authenticated SELECT, RLS, no write
    |  one-row SELECT
/ (home page: getHomeData)
```

- `product_database_status`: `generation_id`, `generated_at`, `source_data_as_of_date`, `product_version`, `schema_version` (from the
  executive snapshot written earlier in the same refresh, so both always describe the same generation), then the 26
  `v_database_status` columns, column-exact (same names, types and values).
- The refresh re-issues the 045a function with the eleventh stage and two validation rules (the status snapshot is one row; its
  tracked-signings count equals the executive snapshot's). Any violation raises and the previous generation stays.
- The drift check compares the status columns with a fresh `v_database_status`; the verifier's four snapshot checks cover the new table.
- The product contract swaps `v_database_status` for `product_database_status` (47 relations). `v_database_status` is closed to
  anon / authenticated; it is still the source, and the verifier reads it with the owner's credentials.
- 045b migrates an existing 045a database by running the refresh once (generation + 1) while the new snapshot is empty. Re-running is a no-op.
- No metric, research datum, threshold or prediction changes. The release status (schema v0.36.1, canonical through 045a) is not
  touched, so `product_version` / `schema_version` in the snapshot are unchanged.

## Order of release

The previous application reads `v_database_status`; the new one reads `product_database_status`. Apply the database migration first, then
merge. Until the new deploy is live the **old application's whole home page** reports "Data unavailable": its single data call fails when
the status read is denied, and the page renders nothing else without the status row. Every other page is unaffected. Apply and merge
close together (the deploy takes a few minutes). Merging first is worse: the new application would read a table that does not exist yet.
A gap-free alternative (keep the grant until the new deploy is live, then revoke) would need a second statement after the deploy; 045b
does not do that. Rollback: `database/release/sql/rollback-045b.sql` (pair it with an application revert).

After research data changes, refresh as before: `npm run refresh:product-snapshots`.
