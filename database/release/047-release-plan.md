# DISI 047 release plan: development histories and transaction chains

A research-data migration plus application changes (development completeness, asset paths). **Not applied to production.** Applying it,
merging the PR and any deploy need explicit owner approval.

## What changes

| | Before | After |
|---|---|---|
| Schema (tables / views / functions / grants / policies) | 78 / 155 / 8 | unchanged |
| Transaction events / assets | 204 / 382 | 209 / 387 (five Dodgers exits, one OUTGOING asset each) |
| Development stints / first-appearance milestones | 828 / 832 | 1083 / 873 (ten verified MLB players' whole recorded careers) |
| Progression decisions (pending review) | 20 (9) | 22 (11): Jansen's ambiguous AA / AAA sequence is PENDING, not asserted |
| Timing observations (ACTIVE) | 10 | 8 (the two "exit bounded before" facts the exact exits supersede are RETRACTED, never deleted) |
| Sources | 2243 | 2294 (Retrosheet transactions database, and the MLB Stats API requests behind the stints) |
| Incomplete transaction chains | 9 | 7 (Puig and De La Rosa no longer incomplete) |
| First professional season known | 161 of 220 | 164 of 220 |
| Signing to MLB with both exact dates | 6 of 47 | 16 of 47 |
| Development research queue / transaction queue / value queue | 104 / 64 / 93 | 154 / 59 / 91 (more history makes more gaps visible; fewer chain gaps remain) |
| Open research tasks, NOT_AUDITED, audits, known costs, spend | 349, 127, 93, 56, $121,700,237.33 | unchanged |
| Product snapshot generation | n | n + 1 (one refresh, run by the migration only because rows were added) |
| `/development`, `/asset-conversion`, dossiers, `/prediction-readiness` | | completeness by dimension with denominators; the asset-path ledger; a compact asset path per player; transaction evidence gaps (not gates) |

No threshold, audit, probability, expected value or recommendation changes, and no predictive layer becomes supported.

## Files

| File | bytes | sha256 |
|---|---|---|
| `database/sql/047_development_transaction_research_batch.sql` | 570356 | `6c669615be9be506735a35c31df1c6c2e640cc7f0ddcec99eff2923b00e2cde4` |
| `database/release/sql/rollback-047.sql` | 547954 | `c42badd2491e61c2f8b71f5ce26ed079316ea84c51bc48f15d441985cc85623e` |

## What the migration does

1. **Five downstream exits** from Retrosheet's transactions database (`tran.txt`, read directly): four free-agency grants (Steve Finley,
   Brent Mayne, Beltrán Pérez, Nick Punto) and one release (Homer Bailey). Each is an exact source row matched to the DISI asset by name
   **and** birth date, cites the Retrosheet transaction id, and closes the open Dodgers control interval of an asset the Dodgers received in a
   recorded trade. The bounded Dodgers bWAR does not move.
2. **Nothing is inferred** for the assets the source does not cover (Gail Harris, Robinson Checo, four minor-league assets) or whose return
   it does not name (Mike Judd). Bob Miller's exit (a four-player 1967 trade) was found but is **not recorded**: its two incoming players would
   be downstream assets whose bWAR cannot be loaded (the Baseball-Reference WAR files answer 403), so DISI could not value the chain.
3. **Development histories** of ten verified MLB players from the official MLB Stats API season splits through the Migration 021 pipeline.
   Seasons the API does not return are not filled in (Beltré signed in 1994; the first record is 1996). A level debut dated after the MLB
   debut season is a rehab or demotion appearance and is not recorded as a development milestone.
4. **Integrity, proven not assumed.** Fourteen team-less aggregate rows are classified `SEASON_TOTAL` only after the migration proves each
   equals the sum of its component team stints (the Migration 023 rule); one unproven row would stop the migration. Jansen's ambiguous
   sequence becomes two `REVIEW_REQUIRED` / `PENDING_REVIEW` decisions (Migration 024), never a self-asserted review.
5. One conditional **snapshot refresh** (generation + 1).

## Order

1. Back up (`pg_dump`, restore-verified).
2. Apply `047_development_transaction_research_batch.sql` through the safe runner (SHA-checked). One transaction; about 5 s on PG17.
3. Verify: live verifier, drift 0, anon reads.
4. Merge the PR (normal merge commit); one Vercel production deploy. The old application keeps working against the new database and the
   new application against the old one: no object was renamed, closed or removed, and the new reads use public relations that already exist.
5. Smoke the routes (Vercel SSO: needs an authenticated browser), check `/development`, `/asset-conversion` and a dossier, and the runtime errors.

Do not re-apply 047 in production to test idempotency (proven on PGlite and PostgreSQL 17). If step 2 fails nothing is committed.

## Expected verifier results

The verifier pins data counts (`CANONICAL_EXPECTATIONS`), and 047 moves fifteen of them (stints, season totals, milestones, progression decisions).
- Against production **before** applying 047: the verifier from the **pre-047 `main`** (or the candidate with `EXPECTATIONS_THROUGH_046`) passes **247/247**.
  The candidate's own verifier, run before the apply, fails exactly those fifteen development / progression counts. That is expected, not a defect.
- **After** applying: the candidate verifier passes **247/247**, drift 0, one generation across the eleven snapshots.

## Rollback

`rollback-047.sql` (one transaction, guarded) deletes exactly the five exit events and assets, the 255 stints, the 41 milestones and Jansen's
two pending decisions, and restores the two exit-bound observations as **new** ACTIVE rows (the originals are sealed and stay RETRACTED). It then
refreshes once. It refuses to run if any exit event is missing, if a progression decision is no longer the pending row 047 wrote, if a cohort
player holds a stint 047 did not write, or if later work depends on the exit assets. Unlike 046, nothing is only retracted, so **047 can be
applied again after its rollback** (the validator proves it). The source rows stay as provenance. The application change needs no rollback.

## Evidence

`database/research/047/`: `transaction-evidence.json` (the exact source rows, the unresolved cases with reasons, and the package-membership
cross-check of five trades DISI already records, all of which agree with the source), `development-cohort.json` (the cohort rule and the
pending reviews), `development-values.sql` (the reviewed pipeline values), `baseline.json` (the pre-047 measures) and `README.md`.
