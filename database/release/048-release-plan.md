# DISI 048 release plan: verified MLB development coverage

A research-data migration plus application changes (documented-path coverage, de-duplicated needs, the reviewer's packet). **Not applied to
production.** Applying it, merging the PR and any deploy need explicit owner approval.

## What changes

| | Before | After |
|---|---|---|
| Schema (tables / views / functions / grants / policies) | 78 / 155 / 8 | unchanged |
| Transaction events / assets | 209 / 387 | unchanged (048 records no transaction) |
| Development stints / first-appearance milestones | 1083 / 873 | 1859 / 1073 (35 verified MLB players' whole recorded careers: +776 / +200) |
| Team-less season rows proven as season totals | 70 | 120 (+50, each proven equal to its component team stints) |
| Progression decisions (pending review) | 22 (11) | 37 (26): +15 pending for six players; none is decided |
| Sources | 2294 | 2467 (the MLB Stats API requests behind the stints) |
| Verified MLB players with any pre-MLB history | 10 of 47 | 42 of 47 |
| Signing to MLB with both exact dates | 16 of 47 | 45 of 47 (min 0.15, median 4.59, max 9.08 years; the two without a signing date are not calculable) |
| First professional season known, all 220 signings | 163 (164 as published after 047; Puig is a Cuban professional) | 179 |
| Verified MLB paths with no gap visible at season precision | 1 of 47 | 3 of 47 (none is "complete") |
| Development detector rows / distinct evidence gaps | 154 / 113 | 347 / 173 |
| Open research tasks, NOT_AUDITED, audits, known costs, spend | 349, 127, 93, 56, $121,700,237.33 | unchanged |
| Product snapshot generation | n | n + 1 (one refresh, run by the migration only because rows were added) |
| `/development`, the dossier | | verified MLB coverage with denominators, the documented path and where the record is silent, timing by acquisition route, the de-duplicated needs |

No threshold, audit, cost, transaction, probability, expected value or recommendation changes, and no predictive layer becomes supported.

## Files

| File | bytes | sha256 |
|---|---|---|
| `database/sql/048_verified_mlb_development_coverage.sql` | 1498033 | `75c8f3c3f75c787f0adb06928cb44680f4df286e1cbf114942e71aeaf8d20d5c` |
| `database/release/sql/rollback-048.sql` | 1460760 | `08119ebe2dc18e496adc9670a2f1edb3a7fea24b9052e1ee6705c898d3fe8ee5` |

## What the migration does

1. **Development histories** of the 35 verified MLB players outside the 047 cohort that hold no development rows, from the official MLB Stats API
   season splits through the Migration 021 / 047 pipeline. Seasons the API does not return are not filled in (Astacio signed in 1987; the first record
   is 1990). A level debut dated after the MLB debut season is a rehab or demotion appearance and is not recorded as a development milestone. The
   MLB debut milestone of every cohort player equals the verified outcome-audit date (the migration refuses a mismatch).
2. **Nothing is overwritten.** Cedeño and Frías (researched by Migration 021) hold exactly what they held; every stint insert is `do nothing` on conflict.
3. **Integrity, proven not assumed.** Fifty team-less aggregate rows are classified `SEASON_TOTAL` only after the migration proves each equals the sum
   of its component team stints (the Migration 023 rule); one unproven row would stop the migration.
4. **Ambiguous level sequences** of six players (Kuo, Abreu, Santana, Urías, Díaz, Cruz) become 15 `REVIEW_REQUIRED` / `PENDING_REVIEW` decisions,
   never a self-asserted review. Jansen's two pending decisions are unchanged.
5. **Guards.** It refuses to run if a cohort player already holds other development rows (later research exists), if an already-researched player's
   state differs, if Migration 047 is not applied, or if a cohort player is not a verified MLB player with the MLB id the research used.
6. One conditional **snapshot refresh** (generation + 1).

## Order

1. Back up (`pg_dump`, restore-verified).
2. Apply `048_verified_mlb_development_coverage.sql` through the safe runner (SHA-checked). One transaction; about a second on PG17 plus the refresh.
3. Verify: live verifier, drift 0, anon reads.
4. Merge the PR (normal merge commit); one Vercel production deploy. The old application keeps working against the new database and the new
   application against the old one (it reads one more column, `pathway`, and a relation already in the product contract).
5. Smoke the routes (Vercel SSO: needs an authenticated browser), check `/development` and a dossier, and the runtime errors.

Do not re-apply 048 in production to test idempotency (proven on PGlite and PostgreSQL 17). If step 2 fails nothing is committed.

## Expected verifier results

The verifier pins data counts (`CANONICAL_EXPECTATIONS`), and 048 moves fifteen of them (stints, season totals, milestones, progression decisions).
- Against production **before** applying 048: the verifier from the **pre-048 `main`** (or the candidate with `EXPECTATIONS_THROUGH_047`) passes **247/247**.
  The candidate's own verifier, run before the apply, fails exactly those fifteen development / progression counts. That is expected, not a defect.
- **After** applying: the candidate verifier passes **247/247**, drift 0, one generation across the eleven snapshots.

## Rollback

`rollback-048.sql` (one transaction, guarded) deletes exactly the 776 stints, the 200 milestones and the 15 pending decisions, then refreshes once.
It refuses to run if any pending decision is no longer the row 048 wrote (a reviewer's later decision would be lost), if a player holds a stint 048
did not write, or if an already-researched player holds a stint from the 048 as-of date. Nothing is only retracted, so **048 can be applied again after
its rollback** (the validator proves it). The source rows stay as provenance. The application change needs no rollback.

## Evidence

`database/research/048/`: `development-cohort.json` (the derived cohort, the two already researched, the 15 pending reviews with their evidence),
`development-values.sql` (the reviewed pipeline values), `existing-development.json` (the rows already on record), `baseline.json` (the pre-048 measures
read from production on 2026-10-20), `architecture.md` (why no schema change) and `README.md`.
