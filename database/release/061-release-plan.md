# DISI 061 release record: transaction research closure

Migration `061_transaction_research_closure.sql` writes reviewed transaction facts over the existing transaction tables (research in
`database/research/061/`). It is data only: no table, view, function, enum, trigger, grant or policy is added or changed.

**Released and frozen.** 061 was applied to production once on 2026-11-06 (PR #48 merged as `b29d7cbe31cdc7b6fc55aaa24cf6c6cfb04f0d7c`; frozen in
the bookkeeping PR that records this file).

## Release record

| | |
|---|---|
| Candidate | PR #48 head `398f087e89eb1c795a3b4f982c9f4a99e15fe275` |
| Migration sha256 / normalized sha1 | `63afb49e65188e4598aad83db6a5daf8836adf7e67e29f71f9fa0bd3a79dd01f` / `dd59aa1c962efbc1315925c8c7feb7cf336c94ff` |
| Rollback sha256 | `84ca0efcc8c5fb5b4a250cc18bebe6a5d058c0ee30274608cab2ac80958b7a70` (rehearsed, not run on production) |
| Backup | `disi-pre-061-release-20261106-174737.dump` (captured 2026-11-06T17:47:37Z from PostgreSQL 17.11), sha256 `5aa64f5d84853a64613582b9c87d586593a30323aa4513bd7f86913933765a27` |
| Rehearsal | PG17.9 restore of that backup with a 2min server `statement_timeout`: apply 7.63 s, rerun 5.37 s (no-op), rollback 5.40 s, reapply 7.19 s; verifier 259/259 at every step, generation unchanged, drift 0. The only failed comparison was the row order of the two research queues (production ICU against the rehearsal's libc collation); the row sets were identical. |
| Production apply | 2026-11-06 18:27:41.230Z -> 18:27:56.753Z (15.5 s) under `timeout --signal=TERM --kill-after=10s 120s` around the SHA-checked `apply-stream` runner (the migration's own `SET LOCAL statement_timeout = '600s'` applies inside the transaction); one transaction, `COMMIT`, exit 0; four phase NOTICEs; 28 facts written; no snapshot refresh |
| PR | #48, normal merge commit `b29d7cbe31cdc7b6fc55aaa24cf6c6cfb04f0d7c` (parents `318a7243f33680ba7e8a9f1f4e6e50b99ffb968f` and `398f087e89eb1c795a3b4f982c9f4a99e15fe275`), 2026-11-06T18:43:12Z |
| Deployment | `dpl_qknDJD4AB9NBm91wP78tfoEBACFo` (GitHub deployment 7608065478, SHA `b29d7cb`), production, READY |
| Smoke | 11 pages and 8 dossiers 200 (the 061-affected Lantigua, Brito, Doncon, Puig, Perez, Frias, Martinez, Abreu); two expected 404s (`jeter-downs`, not a DISI player, and a nonexistent slug); 81 requests (79 x 200, 2 x 404), no runtime or error logs |
| Production after | verifier 259/259, generation 16, drift 0; events 225, assets 415, resolutions 7, sources 3396, evidence 4507; unknown CASH 11, pool assets 3 (2 with unknown amount); transaction queue 51, value queue 79; known acquisition cost 81 / unknown 139, known spend `127632237.33`; CAREER_BWAR 58, BWAR_MISSING 39; no supported model or probability |

## Consequences

- `rollback-061.sql` deletes what 061 added and returns the six amounts to NULL; the twelve source rows stay as provenance, and 061 can be
  reapplied afterwards.
- While 061 is applied, `rollback-049.sql` refuses (a later transaction exists for Jon Garland); roll back 061 first.
