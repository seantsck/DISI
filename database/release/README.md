# Release tooling (034 / 035, 036-038, 039-041 and 042-045 bundles)

Nonproduction tooling and the release plan. Nothing here connects to a hosted database by itself.

| File | Role |
|---|---|
| `034-release-checklist.md` | identity, evidence, hosted-state probe and decision table, backup, apply, verification, rollback, 035 follow-on, blockers |
| `sql/live-state-probe.sql` | read-only probe of a hosted database (`begin read only` ... `rollback`) |
| `sql/fingerprint-034.sql` | read-only: which of the four 034 revisions a database holds |
| `pg17/run.sh` | independent validation on a disposable PostgreSQL 17 (embedded-postgres installed into a throwaway work dir, never the repo) |
| `pg17/validate-035.mjs` | frozen 034 identity, 035 additivity / security / sample semantics / idempotency / convergence, both verifiers |
| `pg17/upgrade-034.mjs` | each earlier 034 revision -> frozen 034 applies and converges; revision fingerprints |
| `pg17/expected-probe.mjs` | the probe's expected output for "frozen 034" and "034 + 035" |
| `pg17/restore-verify.mjs` | proves a `pg_dump -Fc` backup restores and verifies (`--selftest` round-trips the frozen chain) |
| `036-038-release-plan.md` | the 036-038 bundle: identity and hashes, changes, evidence, expected probe values, backup, apply order, post-apply verification, rollback, PR draft |
| `sql/bundle-036-038-probe.sql` | read-only probe of the bundle state (marker objects, fact counts, as-of date, API surface) |
| `sql/rollback-036-038.sql` | WRITE, approval only: guarded logical rollback of the bundle to the exact 001-035 state |
| `pg17/run-036-038.sh`, `pg17/validate-036-038.mjs` | bundle validation on disposable PostgreSQL 17: frozen 001-035, per-migration additivity and exact idempotency, security, verifier 207/207, convergence, anon reads, rollback |
| `039-041-release-plan.md` | the 039-041 bundle: hashes, changes, expected probe values, backup, 039 -> 040 -> 041 apply order, verification incl. the anon performance gate, rollback, PR draft |
| `sql/bundle-039-041-probe.sql` | read-only probe of the 039-041 bundle state |
| `sql/rollback-039-041.sql` | WRITE, approval only: guarded logical rollback of 039-041 to the exact 001-038a state |
| `pg17/run-039-041.sh`, `pg17/validate-039-041.mjs` | 039-041 bundle validation on disposable PostgreSQL 17 (frozen history, additivity, idempotency, security, verifier 207 -> 223, convergence, anon reads, rollback) |
| `042-045-release-plan.md` | the 042-045 bundle (DISI v1.0.0, database + application), third attempt with the 045a serving layer (persisted product snapshots, API firewall, refresh, snapshot concurrency gate); history of both earlier attempts; the interrupted first attempt (2026-10-14, low-memory restart, clean rollback) and the 043a fix, hashes, changes, expected probe values, backup, 042 -> 043 -> 043a -> 044 -> 045 apply order, verification incl. the anon / app-read performance and memory gate, PR, smoke, rollback (paired with a merge revert after the merge), PR draft |
| `sql/bundle-042-045-probe.sql` | read-only probe of the 042-045 bundle state, incl. the six staged functions and partial states |
| `sql/refresh-product-snapshots.sql` | WRITE, privileged only: one validated product-snapshot generation (045a), the release-runner form of `npm run refresh:product-snapshots` |
| `sql/rollback-042-045.sql` | WRITE, approval only: guarded logical rollback of 042-045 (incl. 043a, 045a, the snapshot tables and the eight functions) to the exact 001-041 state, from the full bundle or any partial state; its previous version rolled production back from 042 + 043 on 2026-10-14 |
| `pg17/run-042-045.sh`, `pg17/validate-042-045.mjs` | 042-045 bundle validation on disposable PostgreSQL 17 (frozen history, additivity, idempotency, security, verifier 223 -> 247, staged and serving functions, snapshot drift, API firewall, plan-bounded views, convergence, anon reads, rollback from complete and partial states) |

```
database/release/pg17/run.sh                    # ~1 min; needs network once for npm
database/release/pg17/run-036-038.sh            # ~1.5 min; the 036-038 bundle against the released main
database/release/pg17/run-039-041.sh            # ~1.5 min; the 039-041 bundle against the released main
database/release/pg17/run-042-045.sh            # ~1 min; the 042-045 bundle against the released main
node database/release/pg17/restore-verify.mjs <work-dir> <backup.dump>
```
