# Research behind migration 028

Migration 028 is a small, guarded, **data-only** forward migration that removes the last two substantive differences between live and a fresh
`001 → 027` replay. Migrations 001-027 are not edited. Trainer / academy / signing-network work moved to Migration 029.

| File | Purpose |
| --- | --- |
| `drift-audit.md` | The four differing values, the target for each, and why |
| `reconciliation-manifest.json` | Exactly four corrections with stable selectors: 1 transaction wording, 3 confidence values |
| `audit.mjs` → `audit-report.json` | Offline check that each canonical value equals a fresh 001 → 027 replay, that the manifest holds only the four corrections, and which public views the live values change |
| `028_template.sql` + `build.mjs` | Guarded steps and the build that embeds the manifest → `database/sql/028_residual_canonical_drift_reconciliation.sql` |
| `test-028.mjs` | Local harness: applies 028 twice over a 001-027 replay |

```
node database/research/028/audit.mjs && node database/research/028/build.mjs
```

## The migration

One transaction; each row must be in its canonical state or the exact known live variant, otherwise (missing, duplicated, any other value) it aborts.
Rows are found by stable keys (player slug, organization names, date, type, population key, source URL), never by id.

1. **Díaz trade wording:** updates only `return_description`.
2. **Three class-membership links:** updates only `confidence` (VERIFIED → HIGH); a link whose basis, supported fields or note differ aborts.

Postconditions assert the transaction carries the canonical wording exactly once and each link is `HIGH`.

## Verifier

Two new hard checks in `scripts/db/lib/seed-reconciliation.mjs`: `reconciliation_trade_wording_violations` (exactly one trade with the canonical wording, no
known live wording left anywhere) and `reconciliation_class_link_confidence_violations` (the three links are HIGH). The verifier is now 114 checks.

## Not reconciled

`initcap()` capitalisation, float formatting, observed-through dates and retrieval timestamps. New logic must not use `initcap()` or other engine-sensitive functions.
