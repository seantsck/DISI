# Migration 060: owner-reviewed acquisition costs

`database/sql/060_owner_reviewed_acquisition_costs.sql` and `database/release/sql/rollback-060.sql` are generated from this folder:

```
node database/research/060/measure.mjs --chain 059_career_bwar_metric_reconciliation.sql --baseline   # the measured pre-060 state (baseline.json)
node database/research/060/build.mjs            # research-evidence.json + baseline.json + the templates -> the migration and the rollback
node database/research/060/build.mjs --check    # exit 1 unless both files are the build output
node database/research/060/report.mjs [--dump <post-059 PGlite tar>]   # before-after.json
```

| File | Purpose |
|---|---|
| `research-evidence.json` | The reviewed input, the only copy of the values: 25 signing bonuses supplied and reviewed by the owner on 2026-11-04, the ledger mapping, the policy, and the Beltre resolution |
| `baseline.json` | The measured 001-059 state (`measure.mjs`): cost counts, ledger, resolutions, the 25 reviewed signings, the missing-cost list, fingerprints, plus the 059 measurement |
| `060_template.sql`, `rollback_template.sql` | Guards, writes, postconditions, one conditional snapshot refresh; the guarded retracting rollback |
| `build.mjs` | Validates the input against the baseline and writes both files |
| `measure.mjs` | The read-only measurement (PGlite dump, canonical chain or `DISI_VERIFY_DB_URL`) |
| `report.mjs`, `before-after.json` | Every measured section before and after 060 on the canonical replay, with the changed paths |
| `release-check.mjs` | The release check: a pure comparison of two production measurements (PASS / HOLD) |

## The input and its provenance

The 25 values are `OWNER_REVIEWED_INPUT`. The owner supplied and reviewed them; this batch did not research, corroborate, replace or
reinterpret them, and retains no external citation. Unknown rows are not part of 060 and stay NULL: nothing is inferred (no $9,999, no
"<$10K", no $0 placeholder).

The 030 ledger has no owner-reviewed origin. Its unsourced-canonical path is the only honest representation, and 060 uses it unchanged:

| Field | Value |
|---|---|
| `report_origin` | `LEGACY_CARRYFORWARD` (no field-level source) |
| `source_id`, `amount_basis`, `retrieved_at` | NULL |
| `evidence_basis` | `LEGACY_CANONICAL_VALUE` |
| `confidence` | `UNVERIFIED` (nothing external was read) |
| `note` | `Owner-reviewed acquisition-cost input supplied 2026-11-04; no external citation retained in this research batch.` (Astacio's adds that the amount is a known $0.00) |
| `bonus_publicly_reported` | unchanged (`false`): an owner-supplied value is not a public report |

`v_signing_acquisition_financials` therefore reports the 24 as `LEGACY_CANONICAL_ONLY`, never `EXTERNALLY_SOURCED`. No source row, URL or
publisher is created.

## What 060 changes

| | Before (059) | After |
|---|---|---|
| Dodgers signings | 220 | 220 |
| Known acquisition cost | 56 | **81** |
| Unknown acquisition cost | 164 | **139** |
| Known acquisition cost (lower bound) | $121,700,237.33 | **$127,632,237.33** (+$5,932,000.00) |
| `ACQUISITION_COST_UNKNOWN` research tasks (Dodgers / all) | 164 / 295 | 139 / 270 |
| Open research tasks | 349 | 324 |
| Value queue `ACQUISITION_COST_INCOMPLETE` (queue total) | 28 (90) | 17 (79) |
| Zero bonuses | none | one, Pedro Astacio (a known $0.00) |
| Financial resolutions | none | one, Adrian Beltre |
| Snapshot generation (replay) | 14 | 15 (one refresh), drift 0 |
| Verifier | 259/259 | 259/259, no expectation change |

**Pedro Astacio (1987).** The reviewed value is a known $0.00: `KNOWN ZERO != UNKNOWN`. His cost reads `KNOWN` / `COMPLETE` at $0.00 and he
leaves the missing-cost list; the realized-value ratio is suppressed for him (`ZERO_OR_UNKNOWN_COST`), so nothing divides by it. It is not a
rule for any other signing.

**Adrian Beltre (1994).** 046 recorded two disagreeing ACTIVE reports (SABR $23,000; ESPN.com / AP $17,000) and no canonical bonus. 060 adds no
third report. One `signing_financial_resolutions` row (basis `OTHER_REVIEWED`, reviewed by Sean Cannon, 2026-11-04) selects the existing
$23,000 report; the canonical bonus becomes $23,000 and the component reads `RESOLVED` (bonus status `KNOWN`, source status
`EXTERNALLY_SOURCED`, because the selected report is the external SABR one). Both reports stay ACTIVE, so the disagreement stays visible. The
two 046 report notes still say the conflict is unresolved: ACTIVE ledger rows are sealed, and the resolution is the record of the decision.

## What does not change

Measured on the replay (`before-after.json`): no outcome, outcome audit, team-season WAR row, metric observation, source, transaction,
development row, benchmark population, support row, stored evaluation, probability, expected value or recommendation moves; the value totals
(299.00 / 88) and the transaction queue are identical; every signing outside the 25 and every other ledger, resolution and environment row is
byte-identical. Views that read the bonus move for the 25 rows only, in their cost columns: the outcome feature matrix (`signing_bonus_usd`,
`has_bonus`, `cost_band`), realized outcome and organizational value (cost, coverage and the per-dollar ratio), and the executive overview's
cost coverage.

## Consequences for earlier migrations

- **046 is no longer rerunnable after 060.** Its precondition refuses Beltre with a canonical bonus while his sources disagree. It fails closed
  and changes nothing; frozen 046 is not edited.
- **rollback-046 is unavailable while 060 is applied.** It refuses because a bonus resolution exists for Beltre. Roll back 060 first.
- 059 still reruns cleanly over 060.
