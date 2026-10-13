# Release tooling (034 / 035)

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

```
database/release/pg17/run.sh                    # ~1 min; needs network once for npm
node database/release/pg17/restore-verify.mjs <work-dir> <backup.dump>
```
