# Migrations 042-045 bundle (DISI v1.0.0): release plan, third attempt (with the 045a serving layer)

Revised 2026-10-14 after two interrupted attempts (section 0a). **Nothing in this revision has been executed against the hosted
database.** Every step marked **APPROVAL** needs an explicit go-ahead from the owner.

The release runs in one controlled window:
- one backup
- 042 → 043 → 043a → 044 → 045 → **045a**, back to back
- one explicit snapshot refresh
- the firewall and public snapshot gates
- one release PR and one Vercel production deploy (this release **does** change the application)

## 0. Identity

| Item | Value |
|---|---|
| Bundle branch | `feature/disi-042-045-decision-engine` (pushed), based on `main` `999f394` (production: 001-041) |
| Hosted baseline | 001-041, live verifier 223/223, 64 tables / 140 views, analysis as-of 2026-10-05 (restored exactly after each attempt) |
| Frozen history | 001-045 with 043a frozen in `tests/db/frozen-migrations.json` (47 entries). All five bundle files were applied in production once and are frozen as committed. |

| File | Bytes | SHA-256 | SHA-1 (content, LF) |
|---|---|---|---|
| `042_expected_organizational_value.sql` | 28784 | `93eedd1fe38e03036b9fb171c488499302ac510ba69d89d7d0a46fab3072a0af` | `696e2436480b9b20d0b62039bb481fd4ff5ed0b6` |
| `043_portfolio_decision_engine.sql` | 28587 | `861f8278a97e747d06401f1df455ecc0b97dbdf82f403e178b2e53a2f70ec20f` | `e9e71b5491a20f8ad8da63f64b46663492da9fb0` |
| `043a_decision_engine_performance.sql` | 33691 | `9c4e0774c98bdc2e389176de584e8f545dace2ae4bc96ea31f575796add1d368` | `272999c0585ae9a1f44db061ce6b45442ce60118` |
| `044_executive_product.sql` | 16127 | `75fcaf1b89357f7d98a16a843c3f088f8cd8d336b34130ca9aba64357ab8b520` | `7cd12ebe797695bf6071124117a7f2ae54be3377` |
| `045_final_integration_release.sql` | 32095 | `c79d407611f8d0a4e0e29ae2556abbc730eaf0e6d196c2d948851678df30db6b` | `c30998c3ad75ac1a1ec4d704d97bd1b3823725f9` |
| `045a_product_snapshot_serving.sql` | 45911 | `3f72f9466c2ae34df5eb174aaa6c65b8d11fc770241e69bc0dd5f476cab9347e` | `9a1bb65305e48cad751e739d192ac8c091ad0dc3` |
| `release/sql/refresh-product-snapshots.sql` (operation, not a migration) | | `7819ed62b252282a71db5145537b598bb59e4d75217459704695ce94b67e0569` | |

Each file is one `begin` … `commit` transaction with guarded preconditions:

| File | Precondition |
|---|---|
| 042 | 034, 041 |
| 043 | 042 |
| 043a | 042, 043 |
| 044 | 043a |
| 045 | 044 |
| 045a | 045 and 043a |

All six files are idempotent and contain no CRLF.

## 0a. The two earlier attempts (2026-10-14)

| Attempt | Database | Failure | Recovery |
|---|---|---|---|
| 1 (04:55-04:58 UTC) | 042 and 043 committed | The hosted PostgreSQL restarted during 044: planner memory, as the stacked overview needed about 700 MB of planning. Reproduced on PostgreSQL 17 limited to 1 GB. | Guarded rollback (approved) to exact 001-041. 043a (staged functions) and a structural 044 / 045 followed. |
| 2 (22:23-22:40 UTC) | 042-045 with 043a committed, verifier 243/243, zero drift, exact idempotency | Single anonymous reads were acceptable (overview median about 0.5 s), but **four simultaneous anonymous overview reads all hit the 3 s timeout** (a 30 s diagnostic run did not finish). No restart. | Guarded rollback (approved, 22:57) to exact 001-041 (223/223, snapshot identical). |

No application deploy and no merge happened in either attempt.

**Root cause of attempt 2:** the serving architecture. Every page request reconstructed the 041 → 044 analytical graph on a 1 GB instance
shared with the Supabase services.

**The fix (045a): persisted product snapshots.** Pages read bounded `product_*` rows. The analytical layer is internal, refreshed
explicitly by a privileged command. The full design is in `database/research/045/serving-layer-architecture.md`.

## 1. What changes

### Database (derived; no existing fact, view, grant, policy, function or trigger is touched)

| | 042 | 043 | 043a | 044 | 045 | 045a | Total |
|---|---|---|---|---|---|---|---|
| New tables (RLS, public-read policy, SELECT-only) | 1 | 1 | — | — | 1 | 10 product snapshots | 13 |
| New views (security_invoker) | 5 | 5 | — (4 redefined) | 2 | 3 | — (release status redefined: schema v0.36.1) | 15 |
| New functions (invoker, `search_path=''`, internal) | — | — | 4 staged | 1 staged | 1 staged | refresh + drift | 8 |
| Verifier checks added | 5 | 5 | 2 | 3 | 5 | 4 | 24 |

- **Public schema:**
  - **Before:** 64 tables / 140 views.
  - **After:** **77 tables / 155 views / 8 internal functions.**
  - The analysis as-of date (2026-10-05) does not move.
- **Live verifier after the release: 247/247.**
- **Before the release,** the bundle verifier reports **245/247** against production. Only `public_views_total` (140) and
  `public_tables_total` (64) differ; every bundle check passes trivially without its objects.
- **API surface after 045a.**
  - Public (anon / authenticated SELECT, RLS):
    - the ten `product_*` snapshots
    - `expected_value_models`, `portfolio_scenario_definitions`, `disi_product_contract` (47 rows, exactly what the app reads)
    - `v_executive_metric_provenance` (static)
  - Internal (no anon / authenticated access):
    - the fourteen analytical views
    - the six staged functions
    - the refresh and drift functions
  - The application makes **zero** RPC calls.

### Application

| Route | Reads (all persisted snapshots) |
|---|---|
| `/` | `product_executive_snapshot` (1 row) after the existing four-query batch; executive summary and freshness line |
| `/portfolio` | executive freshness, `product_portfolio_decision_support`, `product_portfolio_history`, `product_portfolio_scenarios`, `product_expected_value_support` |
| `/prediction-readiness` | `product_executive_snapshot`, `product_prediction_readiness`, `product_model_evaluations`, `product_expected_value_support` |
| `/players/[slug]` | `product_player_decision`, `product_player_expected_value` (by player), `product_player_comparables` (by signing), freshness |

The user-facing semantics are unchanged. Each product page shows "Snapshot generated <date> · source data as of <date> · DISI v1.0.0".

## 2. Evidence

**Semantic equivalence.** Every snapshot equals a fresh evaluation of its analytical source: values, NULLs, states, labels and
provenance (`disi_product_snapshot_drift()`, all ten at 0). The refresh carries each support state downstream; nothing is hard-coded.

| State | Snapshot `support_chain_state` | What the snapshot holds |
|---|---|---|
| Today (unsupported) | `NO_PREDICTIVE_LAYER_SUPPORTED` | 0 probabilities / 0 expected values / 0 recommendations |
| Probability only | `PROBABILITY_ONLY` | probabilities > 0, no expected value |
| Expected value supported, every candidate's cost incomplete | `EXPECTED_VALUE_SUPPORTED_NO_ELIGIBLE_CANDIDATE` | expected values > 0, 0 recommendations, 0 selections |
| Predictive decisions supported | `PREDICTIVE_DECISIONS_SUPPORTED` | expected values, recommendations and optimized selections > 0 |

**Constrained PostgreSQL 17**
- Setup: 1 GB cgroup, no swap, `shared_buffers` 224 MB, `work_mem` 2184 kB, the production planner settings, and anon `statement_timeout` 3 s.
- Data: the released 001-041 replayed, then the bundle.
- Apply times, with no OOM kill and no restart:

  | File | Time |
  |---|---|
  | 042 | 0.52 s |
  | 043 | 0.80 s (peak 438 MB, from the frozen 043's own postconditions) |
  | 043a | 0.02 s |
  | 044 | 0.03 s |
  | 045 | 0.03 s |
  | 045a | 1.98 s, including the first generation |

- **Refresh** (`npm run refresh:product-snapshots`): 1.9 s, with a non-reclaimable peak of 215 MB (+135 MB above baseline).
- **Public snapshot gate.** Each visitor reads the four pages' 14 product queries 5 times, as anon:

  | Visitors | Queries | Server median | Server p95 | Server max | Wall p95 | Memory peak |
  |---|---|---|---|---|---|---|
  | 1 | 70 | 0.08 ms | 0.41 ms | 0.78 ms | 1.2 ms | 90 MB |
  | 4 | 280 | 0.06 ms | 0.44 ms | 1.28 ms | 2.0 ms | 96 MB |
  | 8 | 560 | 0.05 ms | 0.43 ms | 2.6 ms | 2.7 ms | 104 MB |
  | 16 | 1120 | 0.04 ms | 0.36 ms | 7.4 ms | 3.4 ms | 120 MB |

  At every level: 0 errors, 0 timeouts, 0 lock waiters, and **0 calls to any staged or serving function**. That is measured with
  `track_functions`, and the counter does move when a refresh runs.
- **Context (unchanged pre-042 load).**
  - With 16 visitors also issuing the home page's existing four pre-042 reads, the snapshot reads stay at p95 0.15 ms.
  - Those legacy reads reach a server max of 309 ms (`v_database_status`) and push the non-reclaimable peak to 844 MB, with 0 errors.
  - This load is already served by production today. It is outside this bundle and is a candidate for later work.
- **Refresh under read** (4 anon readers; each statement reads all ten snapshots):
  - 8783 statements, with 0 errors, 0 mixed-generation reads and 0 incomplete reads.
  - While the refresh was uncommitted, readers saw only the old generation (3). After COMMIT, they saw the new one (4).
  - The slowest reader round took 17.5 ms.

**Tests and tools**
- Focused 045a test (`tests/db/serving-045a.test.mjs`): 10/10.
- 043a, 044 and 045 tests, migrations, verifier drift scenarios and unit tests (97/97): see the final report.
- Real PostgreSQL 17 bundle validator (`pg17/run-042-045.sh`): **42/42**. It covers:
  - frozen 001-045
  - per-migration additivity and exact idempotency
  - 045a changes only the release status
  - snapshot drift 0
  - eight internal functions
  - the firewall-aware ACLs: anon denied all 14 analytical views
  - verifier 247/247, incremental and fresh
  - convergence
  - the rollback from complete, 042 + 043 and through-045 states
  - the rollback refusing while an outside object depends on the bundle

## 3. Read-only hosted probe (`sql/bundle-042-045-probe.sql`)

| Probe section | Before the release (expected now) | After 045a |
|---|---|---|
| 041 marker / 042-045 markers (18) | present / all absent | present / all present |
| staged functions (6) | absent | present, wrapped by their views |
| snapshot tables (10) / generation | absent / NULL | present, RLS, anon-readable / ≥ 1 |
| internal views API-readable / internal functions API-executable | 0 / 0 | **0 / 0** |
| `expected_value_models` / `portfolio_scenario_definitions` / `disi_product_contract` | NULL | 1 / 4 / 47 |
| `signings` / `outcome_audits` / `outcomes` / `player_mlb_team_season_war` | 268 / 136 / 58 / 1880 | unchanged |
| analysis as-of date; 041 supported targets / models | 2026-10-05; 0 / 0 | unchanged |
| tables / views / no-RLS / not-invoker / API beyond SELECT | 64 / 140 / 0 / 0 / 0 | 77 / 155 / 0 / 0 / 0 |
| bundle state | `bundle not applied` | `bundle applied` (partial states are named) |

Any other value before the release: **stop**, investigate the drift first and apply nothing.

## 4. Backup (APPROVAL to connect; read-only)

This uses the scratchpad secret-safe runner. The credential comes only from `~/.config/disi/verify.env` and is never printed.

1. Validate the credential (project ref `zpuqzmyprjiqjmvnmisa`) and run the probe.
2. Run the bundle verifier. It must show **245/247**, with only the totals failing.
3. Take a state snapshot. It must be identical to the post-rollback snapshot.
4. Record `pg_postmaster_start_time()`.
5. Take a fresh `pg_dump --format=custom --schema=public --no-subscriptions` to `~/backups/disi/disi-pre-042-045a-release-<UTC>.dump` (folder
   mode 700, file mode 600). Record its size and SHA-256.
6. Restore it into disposable PostgreSQL 17 (`pg17/restore-verify.mjs`, `main` tree). It must show 223/223.

## 5. Apply (APPROVAL; one window, back to back, no public reads in between)

```
safe-run apply database/sql/042_expected_organizational_value.sql  93eedd1fe38e03036b9fb171c488499302ac510ba69d89d7d0a46fab3072a0af
safe-run apply database/sql/043_portfolio_decision_engine.sql      861f8278a97e747d06401f1df455ecc0b97dbdf82f403e178b2e53a2f70ec20f
safe-run apply database/sql/043a_decision_engine_performance.sql   9c4e0774c98bdc2e389176de584e8f545dace2ae4bc96ea31f575796add1d368
safe-run apply database/sql/044_executive_product.sql              75fcaf1b89357f7d98a16a843c3f088f8cd8d336b34130ca9aba64357ab8b520
safe-run apply database/sql/045_final_integration_release.sql      c79d407611f8d0a4e0e29ae2556abbc730eaf0e6d196c2d948851678df30db6b
safe-run apply database/sql/045a_product_snapshot_serving.sql      3f72f9466c2ae34df5eb174aaa6c65b8d11fc770241e69bc0dd5f476cab9347e
safe-run apply database/release/sql/refresh-product-snapshots.sql  7819ed62b252282a71db5145537b598bb59e4d75217459704695ce94b67e0569
```

- `apply` refuses on a SHA-256 mismatch and runs `psql -X -v ON_ERROR_STOP=1 -f`. Each file is one transaction.
- **Known heavy step: 043.** Its frozen postconditions evaluate the stacked candidate readiness. Production took 31-40 s (63 s on a
  re-apply). 043a and the rest follow immediately.
- **Exposure window.** From 042 until 045a commits, the analytical views are briefly API-readable. Nothing reads them: the current app
  doesn't, and the operator issues no read in the window. In production the whole window was about 50 s.
  - 045a closes the window. It revokes the analytical layer, then builds and validates the first generation (about 2 s on the constrained
    replay).
- **Refresh.** The explicit refresh then produces generation 2, the same procedure every later data update uses.
- **Restarts.** A disconnect or restart at any step means **stop**. Check `pg_postmaster_start_time()` and the probe before anything else.

## 6. Post-apply verification (before the PR)

1. **Probe:** every value matches "After 045a", internal API access is 0 / 0, and `pg_postmaster_start_time()` is unchanged.
2. **Live verifier at the bundle commit:** **247/247**, including snapshot drift 0, which means the snapshots are current.
3. **Drift:** a before / after snapshot comparison shows no existing table (rows including ids and timestamps), view, ACL, policy,
   function or trigger changed. The only additions are 13 tables, 13 read policies, 15 views and 8 functions.
4. **Hosted semantics, read from the snapshots:**
   - `NO_PREDICTIVE_LAYER_SUPPORTED`; 0 / 0 / 0
   - 157 PROBABILITY_NOT_SUPPORTED + 63 OUT_OF_SCOPE
   - candidates 137 / 1 / 30 / 52 / 0, and every scenario VALUE_OPTIMIZATION_NOT_SUPPORTED
   - known spend $117,377,237.33 over 48 / 220 (0.218, a lower bound); realized value 298.83; value that left 432.44
5. **Firewall, read-only as anon and authenticated:**
   - each of the 14 analytical views returns 42501
   - each of the 8 functions returns 42501
   - every snapshot table is readable
6. **Idempotency:** re-apply 042 → 045a (SHA-256-checked). Zero drift, no new generation, and the verifier stays 247/247.
   - Re-applying 042-045 briefly restores their own grants until 045a re-runs, so a re-apply always runs through 045a.
7. **Public snapshot gate, as anon under the 3 s timeout** (the page queries above):
   - 1, 4, 8 and 16 concurrent visitors, 5 iterations each, plus 10-run repeats.
   - Watch `pg_postmaster_start_time()` and the lock waiters.
   - **Acceptance:**
     - 0 timeouts, errors, restarts and lock pile-ups
     - snapshot reads with a server median under 50 ms and a p95 under 150 ms
     - no repeated snapshot read over 500 ms
   - Do not load-test the analytical layer; it is internal.

## 7. Release PR, merge and smoke (APPROVAL)

1. Open `feature/disi-042-045-decision-engine` → `main` with the description in section 9.
2. When the PR is CLEAN and the preview is green, merge with a **merge commit** (no squash, no rebase). This triggers exactly one
   Vercel production deploy; wait for READY.
3. **HTTP smoke:** `/`, `/league`, `/players`, `/signings`, `/research`, `/portfolio`, `/prediction-readiness` and one Dodgers dossier. Each
   must give HTTP 200, "Live Supabase data", no "Data unavailable", and no missing relation or permission error.
4. **Visible:**
   - The home executive summary with its freshness line.
   - `/portfolio`: "No predictive portfolio recommendation is made".
   - `/prediction-readiness`: the no-probability statement and 0 supported targets.
   - The dossier's decision section, with no predictive number.
5. **Runtime errors:** the owner checks Vercel runtime errors, because direct access is behind Vercel SSO. A 302 is not a pass.
6. **Freeze:** add 045a to `tests/db/frozen-migrations.json` in a follow-up commit.

## 8. Rollback

`database/release/sql/rollback-042-045.sql` (**APPROVAL**; one guarded transaction):
- **What it drops:** the 10 snapshot tables and the 2 serving functions first, then the 045 / 044 / 043 / 042 views, the 6 staged functions
  (each after the view that wraps it) and the 3 bundle tables.
- **Guard:** it refuses if anything outside the bundle depends on them.
- **Result:** it returns the database to the exact 001-041 state.
  - Proven on PostgreSQL 17 from the complete bundle, from 042 + 043, and from 042-045 without 045a, including ids and timestamps.
  - Earlier versions did exactly this in production twice on 2026-10-14.
- **After the merge:** the pages read the snapshots. A database rollback must be paired with `git revert -m 1 <merge>` and one deploy.
  The home summary and the dossier section are tolerant: they disappear instead of failing.
- **Last resort:** the section 4 backup.

## 9. Release PR description (draft)

> **DISI v1.0.0: expected organizational value, portfolio decision support, executive product and final integration (Migrations 042-045,
> with 043a and 045a)**
>
> **Headline: DISI does not yet have enough evidence to publish outcome probabilities, expected values or portfolio recommendations,
> and the product says so explicitly.**
> - No 041 target meets the support rule (50 labelled, 10 positive, 10 negative).
> - Both fitted models were worse than the naive base rate (Brier 0.124 base rate vs 0.143 stratified and 0.139 logistic).
>
> | Layer | Supported today |
> |---|---|
> | Supported outcome targets | 0 |
> | Expected organizational values | 0 |
> | Predictive portfolio recommendations | 0 |
> | Product state | `NO_PREDICTIVE_LAYER_SUPPORTED` |
>
> Descriptive and historical intelligence is available:
> - realized organizational value with every component separate
> - historical distributions and retrospective allocation
> - honest pool feasibility
> - per-target evidence of what is still needed
>
> The system refuses to manufacture predictive confidence.
>
> **Release note.** Two earlier production attempts were rolled back cleanly before any application deployment:
> - The first exposed a low-memory planner issue: the stacked executive view needed about 700 MB of planning on a 1 GB instance.
> - The second showed that, even staged, four simultaneous public reads of the analytical layer could stall the instance.
>
> Two forward corrections were validated on a constrained 1 GB PostgreSQL 17 before this re-release:
> - **043a** stages the analytical computation.
> - **045a** moves the public product onto persisted, refreshed snapshots, so a page request never recomputes the analytical graph.
>
> Semantics did not change, and 042-045 remain frozen as committed.
>
> - **042 Expected organizational value.**
>   - Realized value per Dodgers signing, with components separate.
>   - Cost components with completeness.
>   - HISTORICAL_DESCRIPTIVE distributions.
>   - Expected value = 041 probability × supported conditional value, NULL with a reason today.
> - **043 Portfolio decision engine.**
>   - Decision-date readiness from signing-time facts and population-level support.
>   - Decision-support states.
>   - RETROSPECTIVE allocation.
>   - Pool scenarios with honest feasibility.
>   - An exact optimizer that only eligible candidates can enter; none can today.
> - **043a Decision-engine performance.** Staged, plan-bounded analytical functions. Gated per-player layers are not even planned while
>   support is absent.
> - **044 Executive product.**
>   - The home executive summary.
>   - The **Portfolio** and **Prediction Readiness** pages.
>   - The Dodgers dossier section.
>   - Predictive numbers render only through `lib/decision-display.js`.
> - **045 Final integration.** The product contract, release status, research roadmap, metric provenance and methodology; package
>   version 1.0.0.
> - **045a Product snapshot serving.**
>   - Ten typed snapshot tables (column-exact projections of the analytical views).
>   - A privileged, validated, single-transaction refresh (`npm run refresh:product-snapshots`).
>   - A drift check.
>   - The analytical layer is closed to the API, and the product contract equals what the app reads.
>   - Freshness is shown on every product page.
>
> Validation:
> - Snapshots equal the analytical outputs in four support states.
> - Constrained 1 GB PostgreSQL 17, 16 concurrent visitors: snapshot reads p95 0.36 ms and max 7.4 ms, 0 errors, 0 timeouts, 0 lock
>   waiters, 0 analytical function calls.
> - Refresh under read: atomic, 0 mixed generations.
> - PG17 bundle validator 42/42 (incl. rollback from partial states).
> - Verifier 247/247.
> - Migration hashes as in `database/release/042-045-release-plan.md`.
> - Production: see the release report (backup, hashes, live verifier, security, drift, idempotency, snapshot concurrency gate).
>
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
