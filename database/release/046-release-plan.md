# DISI 046 release plan: reviewed acquisition-cost research batch

A research-data migration plus an application change (readiness blockers). **Not applied to production.** Applying it, merging the PR and
any deploy need explicit owner approval.

## What changes

| | Before | After |
|---|---|---|
| Schema (tables / views / functions / grants / policies) | 78 / 155 / 8 | unchanged |
| Signings with a known acquisition cost | 48 of 220 | 56 of 220 |
| Known acquisition spend (lower bound) | $117,377,237.33 | $121,700,237.33 (+$4,323,000.00) |
| Open research tasks | 357 | 349 |
| Scouting research queue (`v_scouting_research_queue`, `SIGNING_WITHOUT_SIGNING_EVALUATION`) | 46 | 54 (a signing with a publicly reported bonus and no signing-time evaluation is queued; the same effect as 031) |
| `NOT_AUDITED` / outcome audits | 127 / 93 | 127 / 93 (unchanged) |
| Product snapshot generation | 3 | 4 (one refresh, run by the migration only because reports were added) |
| `/prediction-readiness` | counts and an explanation | the same, plus "Blockers by layer" derived from the snapshots |

No threshold, audit, probability, expected value or recommendation changes. The release status (schema v0.36.1, canonical through 045a)
is not touched.

## Files

| File | bytes | sha256 |
|---|---|---|
| `database/sql/046_outcome_cost_research_batch.sql` | 17272 | `45325b81e0df48e5db4da55443a310e5241900a88298f3438b6c482b98a417f1` |
| `database/release/sql/rollback-046.sql` | 12547 | `c4b9d7abee35d0294edc027a8d583cb7ad6073a4db84f35aa59e3dec8aa7db55` |

## Order

1. Back up (`pg_dump`, restore-verified), as for the previous releases.
2. Apply `046_outcome_cost_research_batch.sql` through the safe runner (SHA-checked). It records ten reports and eight canonical bonuses and
   runs **one** snapshot refresh (generation + 1, about 5 s on the 1 GB instance).
3. Verify: the live verifier (247/247), drift 0, an anon read of the snapshots.
4. Merge the PR (normal merge commit); one Vercel production deploy. The *old* application keeps working against the new database (no
   object was renamed, closed or removed), so unlike 045b there is **no unavailability gap** between steps 2 and 4.
5. Smoke the routes (Vercel SSO: needs an authenticated browser), look at `/prediction-readiness`, and check runtime errors.

Do not re-apply 046 in production to test idempotency (proven on PostgreSQL / PGlite). If step 2 fails nothing is committed: the migration
is one transaction.

## Expected verifier results

- Before applying, against production: **247/247** (046 changes no structure the verifier pins).
- After applying: **247/247**, snapshot drift 0, one generation across the eleven snapshots.

## Rollback

`rollback-046.sql` (one transaction, guarded) **retracts** exactly the ten reports 046 wrote (financial reports are never deleted: the
ledger seals them), returns the eight canonical bonuses to NULL / not publicly reported and refreshes once. It refuses to run if any of the
ten reports is missing or retracted, if later bonus research exists for any of the nine signings, or if a bonus resolution exists. The eight
source rows stay as provenance. After a rollback the reports are RETRACTED, so 046 must not be re-applied; a re-release needs a new migration.
The application change needs no rollback: it reads only snapshot tables that exist both before and after.

## Evidence

The reports, their sources and every signing looked for are in `database/research/046/research-evidence.json`. Each source was fetched with
curl (HTTP 200) and read as raw HTML; pages that answered 403/404 (MLB.com, Baseball America, Pirates Prospects) were not used. A
disagreement (Adrian Beltre, $23,000 versus $17,000) is stored as two ACTIVE reports with a NULL canonical bonus.
