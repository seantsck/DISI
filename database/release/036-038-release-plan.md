# Migrations 036-038 bundle: release plan

Prepared 2026-10-13 on the Hetzner VPS. **Nothing in this document has been executed against the hosted database.** Every step marked
**APPROVAL** needs an explicit go-ahead from the owner. The release is one controlled window: one backup, 036 then 037 then 038, one
release PR, one Vercel production deploy.

## 0. Identity

| Item | Value |
|---|---|
| Bundle branch | `feature/disi-036-038-intelligence` (pushed), based on `main` `d35779c` (035 released + /research hotfix) |
| Hosted baseline | 001-035, live verifier 186/186 at `main` (035 applied 2026-10-13 08:58:57 UTC) |
| Frozen history | 001-035 byte-identical to `main` and to `tests/db/frozen-migrations.json` (035 frozen at SHA-1 `25d8460a…`) |

| File | Bytes | SHA-256 | SHA-1 (content, LF) |
|---|---|---|---|
| `036_scouting_expectation_outcomes.sql` | 48161 | `4426b44a86ff07b036dcc8cc3dc0495a694e0c9ff915248d5a5f8a68d8bf17ac` | `dda791e72b10e50829f57235e69b8aebbd1ca6db` |
| `037_development_pathway_intelligence.sql` | 29379 | `b2a809cfa32fb83b89b4c962135bae458d3e8acc235edc73624128c8c23e76c6` | `895a45373e8732f7987218ed04ff55543b46a4d8` |
| `038_signing_network_outcomes.sql` | 20277 | `c4d0e9bf2c46a82870ebd2bcfcb349f4fa3a08ffb79042abc0bb08639215b200` | `c07611249418c33f12e5a1934bb7948652a70dd7` |

Each file is one `begin` … `commit` transaction with guarded preconditions (036 needs 035; 037 needs 036; 038 needs 037) and
postconditions. All three are idempotent and contain no CRLF.

## 1. What changes (all derived; no existing fact, view, grant, policy or function is touched)

| | 036 | 037 | 038 | Total |
|---|---|---|---|---|
| New tables | `scouting_expectation_bands` (15 reviewed rows, RLS, public-read policy) | — | — | 1 |
| New views (security_invoker, anon / authenticated SELECT) | 5 | 4 | 4 | 13 |
| Verifier checks added | 8 | 7 | 6 | 21 |
| Existing tables written / views redefined / ACLs changed | 0 | 0 | 0 | 0 |

Public schema: 59 tables / 112 views before, **60 tables / 125 views after**. The analysis as-of date (2026-10-05) does not move.
**Live verifier expected count after the release: 207/207**, with the bundle commit's verifier. Until then, the bundle verifier
correctly reports 205/207 against the hosted 035 database: only `public_views_total` and `public_tables_total` differ.

## 2. Evidence (bundle checkpoint)

| Check | Result |
|---|---|
| Focused tests | 036 14/14, 037 13/13, 038 10/10 |
| Full DB + unit suite, once, `--test-concurrency=1` | see the final report of the checkpoint run (one 035 regression-test fix in the bundle, re-run green) |
| Real PostgreSQL 17.9 (`pg17/run-036-038.sh`) | released 001-035 → 036 → 037 → 038: per-migration additivity and exact idempotency, whole-schema security, verifier 207/207, bundle re-applied as a no-op, fresh 001-038 = incremental (content, definitions, ACLs, policies, functions, view outputs), anon reads within 3 s, rollback exact, re-apply after rollback |
| Deterministic builders | 036 / 037 / 038 `audit.mjs` + `build.mjs` reproduce the committed SQL byte-for-byte, and the audit reports are stable |

## 3. Read-only hosted probe (`sql/bundle-036-038-probe.sql`)

| Probe section | Before the release (expected now) | After 038 |
|---|---|---|
| 035 marker views | all present | all present |
| 036 / 037 / 038 marker objects (17 rows) | all absent | all present |
| `scouting_expectation_bands` rows | NULL (absent) | 15 |
| `signings` / `player_evaluations` / rankings / grades | 268 / 51 / 51 / 13 | unchanged |
| `player_season_stints` / `development_progression_decisions` | 828 / 20 | unchanged |
| `player_network_relationships` / `network_entities` | 9 / 9 | unchanged |
| `outcome_audits` / `outcomes` / `player_mlb_team_season_war` | 136 / 58 / 1880 | unchanged |
| analysis as-of date | 2026-10-05 | 2026-10-05 |
| tables / views / no-RLS / not-invoker / API beyond SELECT | 59 / 112 / 0 / 0 / 0 | 60 / 125 / 0 / 0 / 0 |

Any other value before the release: **stop**. Investigate the drift first and apply nothing.

## 4. Backup (APPROVAL to connect; read-only)

The same procedure as the 035 release, through the scratchpad secret-safe runner. The credential is read only from
`~/.config/disi/verify.env` into the child's environment and is never printed.

1. Validate the credential file (format and project ref `zpuqzmyprjiqjmvnmisa`), then run the probe (section 3).
2. `pg_dump --format=custom --schema=public --no-subscriptions` to `~/backups/disi/disi-pre-036-038-release-<UTC>.dump`, then record
   its size and SHA-256.
3. Prove recoverability on disposable PostgreSQL 17: `node database/release/pg17/restore-verify.mjs <work> <dump>`. The restored copy
   must pass the 035 verifier (186/186).
4. Keep the earlier dumps (`disi-pre-035-release-20261013-085800.dump`, sha256 `ce22173b…`).

## 5. Apply (APPROVAL; one window, in this order)

```
safe-run apply database/sql/036_scouting_expectation_outcomes.sql   4426b44a86ff07b036dcc8cc3dc0495a694e0c9ff915248d5a5f8a68d8bf17ac
safe-run apply database/sql/037_development_pathway_intelligence.sql b2a809cfa32fb83b89b4c962135bae458d3e8acc235edc73624128c8c23e76c6
safe-run apply database/sql/038_signing_network_outcomes.sql         c4d0e9bf2c46a82870ebd2bcfcb349f4fa3a08ffb79042abc0bb08639215b200
```

- `apply` refuses on a SHA-256 mismatch and runs `psql -X -v ON_ERROR_STOP=1 -f`. Each file is one transaction, so a failure rolls
  back that migration only, and a later file's precondition stops it before it can run on an incomplete state.
- On real PostgreSQL 17 the three transactions took 0.2 s, 0.2 s and 0.6 s. They create views and one small table and take only
  brief catalog locks; no existing table is rewritten.
- If 036 fails, nothing has changed. If 037 or 038 fails, the earlier ones stay applied (consistent, additive state). Fix forward, or
  roll back with section 7.

## 6. Post-apply verification and release

1. Probe again; every value must match the "After 038" column.
2. Live verifier at the bundle commit: **207/207**.
3. Idempotency: re-apply 036, 037 and 038 (the same SHA-256-checked command). Expect only NOTICEs and an unchanged state (a snapshot diff
   of tables, view definitions and ACLs shows no change).
4. PostgREST smoke test with the publishable (anon) key. For each of the 13 views, request `?select=*&limit=1`, then the full set,
   each well under the 3 s anon statement timeout. Local PostgreSQL 17 full reads take 4-264 ms. The heaviest are the three 038 views
   (about 0.25 s, since each recomputes the 036 / 037 layers). No app page reads them yet.
5. Convergence: a live vs fresh 001-038 snapshot comparison for the 14 new objects. The known pre-035 residuals (CRLF function bodies,
   pgcrypto schema, `current_date` dates, one 020 note) stay out of scope.
6. **APPROVAL:** merge the release PR (merge commit). This triggers one Vercel production deploy. The bundle changes no application
   code, so `/`, `/league`, `/players`, `/signings` and `/research` must stay 200 with live data. Smoke them and check Vercel runtime
   errors.
7. Freeze 036, 037 and 038 in `tests/db/frozen-migrations.json` (follow-up commit), and record the apply times in each migration's
   README.

## 7. Rollback

- **During section 5:** a failed file rolled itself back. Re-run the probe to see which of 036 / 037 / 038 are present.
- **After commit:** run `database/release/sql/rollback-036-038.sql` (**APPROVAL**; one guarded transaction). It drops the 13 views and
  the bands table in reverse dependency order, and refuses if anything outside the bundle depends on them. The bundle wrote nothing
  else, so the result is the exact 001-035 state. That was proven on PostgreSQL 17: every row including ids and timestamps, every view
  definition, ACL, policy and function, and the bundle re-applies afterwards. A dump restore or PITR is not needed for this bundle,
  but the section 4 backup remains the last resort.
- **App:** redeploy the previous Vercel production deployment if the merge deploy misbehaves. The app does not read the new views, so
  a database rollback needs no app change.

## 8. Release PR description (draft)

> **DISI v0.27-v0.29: expectation, pathway and network intelligence (Migrations 036-038)**
>
> Derived, read-only intelligence over existing canonical facts. One reference table and 13 security-invoker views; no existing table,
> view, grant, policy or function changes.
>
> - **036 Scouting expectation vs realized outcome.**
>   - `scouting_expectation_bands`: 15 source-native bands; no universal expectation number.
>   - The shared outcome spine `v_player_realized_outcome`.
>   - Frozen pre-debut expectation anchors with comparison states. TOO_EARLY and OUTCOME_INCOMPLETE are never misses.
>   - A descriptive calibration summary, gated at 10 comparable outcomes.
>   - In the 48-player MLB Pipeline 2013/14 Top-30 sample, MLB reach was 8/16, 3/15 and 0/11 by class-rank band. This is a sample, not
>     an accuracy measure.
> - **037 Development pathway intelligence.**
>   - Observed season paths: primary level by games, 2020 never an absence.
>   - Per-signing pathway features and classes. Young active players are never failures; professional signings are never on the
>     amateur ladder.
>   - Summaries by signing pathway, with coverage-artefact suppression.
> - **038 Signing network outcomes.**
>   - The 9 documented associations (5 players) beside outcome, expectation and pathway.
>   - `denominator_known` is always false, and every entity is ANECDOTAL today.
>   - The known sample vs unattributed signings is labelled selection-biased.
>   - No ranking, rate, ROI or causal claim.
>
> Validation: focused tests 14 + 13 + 10; full suite once at concurrency 1; real PostgreSQL 17 bundle validation (additivity,
> idempotency, convergence, security, verifier 207/207, rollback); deterministic builders; lint, typecheck.
> Hosted rollout: one backup, 036 → 037 → 038 (SHA-256 checked), live verifier 207/207, anon smoke. Rollback:
> `database/release/sql/rollback-036-038.sql`.
>
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
