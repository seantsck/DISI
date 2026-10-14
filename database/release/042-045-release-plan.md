# Migrations 042-045 bundle (DISI v1.0.0): release plan, second attempt

Revised 2026-10-14 after the interrupted first attempt (section 0a). **Nothing in this revision has been executed against the hosted
database.** Every step marked **APPROVAL** needs an explicit go-ahead from the owner.

The release runs in one controlled window:
- one backup
- 042 → 043 → **043a** → 044 → 045
- one release PR
- one Vercel production deploy (this release **does** change the application)

## 0. Identity

| Item | Value |
|---|---|
| Bundle branch | `feature/disi-042-045-decision-engine` (pushed), based on `main` `999f394` (production: 001-041) |
| Hosted baseline | 001-041, live verifier 223/223, 64 tables / 140 views, analysis as-of 2026-10-05 (restored exactly after the first attempt) |
| Frozen history | 001-043 frozen in `tests/db/frozen-migrations.json` (44 entries). 042 and 043 were applied once and are frozen as committed. |

| File | Bytes | SHA-256 | SHA-1 (content, LF) |
|---|---|---|---|
| `042_expected_organizational_value.sql` | 28784 | `93eedd1fe38e03036b9fb171c488499302ac510ba69d89d7d0a46fab3072a0af` | `696e2436480b9b20d0b62039bb481fd4ff5ed0b6` |
| `043_portfolio_decision_engine.sql` | 28587 | `861f8278a97e747d06401f1df455ecc0b97dbdf82f403e178b2e53a2f70ec20f` | `e9e71b5491a20f8ad8da63f64b46663492da9fb0` |
| `043a_decision_engine_performance.sql` | 33691 | `9c4e0774c98bdc2e389176de584e8f545dace2ae4bc96ea31f575796add1d368` | `272999c0585ae9a1f44db061ce6b45442ce60118` |
| `044_executive_product.sql` | 16127 | `75fcaf1b89357f7d98a16a843c3f088f8cd8d336b34130ca9aba64357ab8b520` | `7cd12ebe797695bf6071124117a7f2ae54be3377` |
| `045_final_integration_release.sql` | 32095 | `c79d407611f8d0a4e0e29ae2556abbc730eaf0e6d196c2d948851678df30db6b` | `c30998c3ad75ac1a1ec4d704d97bd1b3823725f9` |

- **042 and 043** are byte-identical to the files applied on 2026-10-14.
- **043a** is new.
- **044 and 045** changed. They never committed in production.

Each file is one `begin` … `commit` transaction with guarded preconditions and postconditions:

| File | Precondition |
|---|---|
| 042 | 034 and 041 present |
| 043 | 042 present |
| 043a | 042 and 043 present |
| 044 | 042, 043 and 043a present |
| 045 | 044 present |

All five files are idempotent and contain no CRLF.

## 0a. The first attempt (2026-10-14) and what changed

**Timeline (UTC)**

| Time | Event |
|---|---|
| Before 04:55 | Preflight passed: 239/241 with only the totals failing; snapshot identical to post-041 |
| 04:55 | Backup `disi-pre-042-045-release-20261014-045511.dump`, SHA-256 `21fb5575…eeb4`, restored at 223/223 |
| 04:56 | 042 committed (5.0 s) |
| 04:57 | 043 committed (39.7 s; 0.7 s locally) |
| 04:57:06 | 044 started |
| 04:58:36 | **The hosted PostgreSQL restarted**; 044 did not commit and 045 was not run |
| ~20:02 | After owner approval: the hung client was stopped and the guarded rollback committed (3.9 s) |

**State after the rollback**
- Production is back to exactly 001-041.
- The 041 verifier passes 223/223.
- The state snapshot is identical to the pre-release one: rows, ids, timestamps, views, ACLs, policies, functions and triggers.
- No application deploy happened, and nothing was merged.

**Root cause:** planner memory. It reproduces on PostgreSQL 17 in a 1 GB cgroup with the production memory settings, where the 044 apply
is OOM-killed (signal 9). Details are in `database/research/043a/README.md`.
- Views are inlined, so a statement plans every layer below it, including per-player layers that a one-time filter skips at
  execution. work_mem does not bound planning.
- The 044 overview stacked the whole 041 → 042 → 043 chain into one statement (about 700 MB of planner memory). Its migration
  postcondition evaluated it twice.
- The candidate-readiness stack under the 043 views planned about 230-255 MB per view.

**Why local validation missed it:** the earlier PostgreSQL 17 checks ran without a memory limit. Planning succeeded in under 3 s, so
the timing gate was green. Memory was never measured.

**Fix (forward-only):**
- **043a.** Four 042 / 043 views become wrappers over staged, read-only (STABLE), invoker-rights PL/pgSQL functions with a fixed
  `search_path`.
  - Each stage is a separate dynamic statement, planned only when it runs.
  - Gated per-player layers are not planned while their support is absent.
- **044.** The overview is a staged function, and the postconditions are structural.
- **045.** The release status reads the overview's counts, the roadmap is staged, and the postconditions are structural.
- Outputs are byte-identical to the original definitions in three states: unsupported, probability-only and expected value supported.

## 1. What changes

### Database (derived; no existing fact, view, grant, policy, function or trigger is touched)

| | 042 | 043 | 043a | 044 | 045 | Total |
|---|---|---|---|---|---|---|
| New tables (RLS, public-read policy, SELECT-only) | `expected_value_models` (1 row) | `portfolio_scenario_definitions` (4) | — | — | `disi_product_contract` (48) | 3 tables, 53 rows |
| New views (security_invoker, anon / authenticated SELECT) | 5 | 5 | — (4 of 042 / 043 redefined in place) | 2 | 3 | 15 |
| New staged functions (STABLE, invoker, `search_path=''`, no PUBLIC execute, anon / authenticated execute) | — | — | 4 | 1 | 1 | 6 |
| Verifier checks added | 5 | 5 | 2 | 3 | 5 | 20 |
| Existing tables written / pre-042 views redefined / ACLs changed | 0 | 0 | 0 | 0 | 0 | 0 |

- **Public schema:** 64 tables / 140 views before, **67 tables / 155 views and 6 staged functions after**. The analysis as-of date
  (2026-10-05) does not move.
- **Live verifier after the release: 243/243.**
- **Before the release,** the bundle verifier reports **241/243** against production. Only `public_views_total` (140) and
  `public_tables_total` (64) differ; the staged-function checks pass trivially until 043a exists.
- **API execution surface:**
  - The six functions return exactly what their views return. RLS of the caller applies, and they can't write (STABLE).
  - The pure IMMUTABLE `disi_*` helpers were already executable through PUBLIC.
  - The verifier forbids any API-executable `disi_` function that is VOLATILE or SECURITY DEFINER.

### Application

Unchanged from the first attempt. The view columns are identical, so no application code changed.

| Route | Change | Reads (new) |
|---|---|---|
| `/` | Executive summary above the database status | `v_executive_overview`: 1 row, read after the existing four-query batch |
| `/portfolio` (new) | Decision-support states, retrospective allocation, pool scenarios | 4 sequential queries with column lists |
| `/prediction-readiness` (new) | Current state, evidence by target, recorded evaluation, value-model blockers | 4 sequential queries |
| `/players/[slug]` | "Organizational value and decision support" for Dodgers signings | 4 sequential queries after the existing batch, filtered by player |
| Nav, Methodology, footer | Two links; decision-layer section; `DISI v1.0.0` | — |

## 2. Evidence

**Semantic equivalence (original bundle against corrected bundle, same data)**
- All 15 bundle views and 3 bundle tables are byte-identical: row count and the md5 of every sorted row. This holds in three states:
  - unsupported (today)
  - probability-only
  - expected value supported: 143 expected values, 14 optimization-eligible candidates, 20 optimized selections,
    `PREDICTIVE_DECISIONS_SUPPORTED`
- Every public column type and typmod, comment, option, ACL and policy is identical.

**Constrained PostgreSQL 17**
- Setup: 1 GB cgroup, no swap, `shared_buffers` 224 MB, `work_mem` 2184 kB, `hash_mem_multiplier` 2, `effective_cache_size` 384 MB,
  `maintenance_work_mem` 32 MB, 1 parallel worker per gather, JIT off, `random_page_cost` 1.1 (all read from production), and anon
  `statement_timeout` 3 s. Data: a replay of the released 001-041.
- The original 044 is OOM-killed on apply (reproduced).
- The corrected bundle applies cleanly:

  | File | Time |
  |---|---|
  | 042 | 0.49 s |
  | 043 | 0.75 s (peak 438 MB, from the committed 043 postconditions) |
  | 043a / 044 / 045 | 0.03 s each |

  No OOM kill and no restart.
- Per-read memory (cgroup peak above baseline):

  | Read | Before | After |
  |---|---|---|
  | Executive overview | 816 MB | 71 MB |
  | Release status | 760 MB | 72 MB |
  | Roadmap | 310 MB | 75 MB |
  | Candidate readiness | 282 MB | 74 MB |
  | Each 043 view | about 308 MB | about 78 MB |
  | Every bundle view (maximum) | | 78 MB |

- All 57 relations (the 48 contract relations and every new one) were read as anon with 0 errors and 0 timeouts. The slowest
  server-side reads:

  | Read | Server-side |
  |---|---|
  | Overview | 363 ms |
  | Roadmap | 337 ms |
  | Release status | 335 ms |
  | `/development` class view (pre-existing) | 321 ms |

- 10-run repeats, as anon, server-side:
  - overview: median 275 ms, max 382 ms
  - every other heavy app query: median 130-145 ms
  - none over 1.5 s
- Concurrent visitors, each loading `/`, `/portfolio`, `/prediction-readiness` and a dossier (13 queries):

  | Visitors | Queries | Server p95 | Server max | Non-reclaimable memory peak |
  |---|---|---|---|---|
  | 4 | 52 | 360 ms | 423 ms | 475 MB |
  | 8 | 104 | 735 ms | 922 ms | 800 MB |

  All 156 queries succeeded. The same 8-visitor concurrency over the pre-042 contract that production serves today peaks at 770 MB.
- The bundle verifier against the constrained instance passes 243/243, with a non-reclaimable peak of 409 MB.

**Tests**
- Focused tests:

  | Test | Result |
  |---|---|
  | 043a (new) | 8/8 |
  | 044 | 10/10 |
  | 045 | 9/9 |
  | 042 | 13/13 |
  | 043 | 10/10 |

  - 043a covers equivalence in the three states, catalog identity, the planning bound and the booby-trap gating proof.
  - 044 adds the planning bound and the booby-trap gating proof.
- Unit tests 96/96.
- Other affected tests:

  | Test | Result |
  |---|---|
  | `migrations.test.mjs` (frozen history 001-043, manifest, grants) | 125/125 |
  | `verify-live-invariants.test.mjs` (the full-chain verifier drift scenarios) | 13/13 |
  | Spot checks of the 243 pin: 040 / 038a | 10/10 and 7/7 |

- Canonical verifier (`npm run verify:db`, PGlite, 001-045): 243/243.
- Lint, typecheck and `next build` pass.
- The full suite was not rerun. Semantics are proven unchanged, and the last full run (`ae402e3`, 527/527) covers all behaviour this
  revision does not touch.

**Real PostgreSQL 17 bundle validator (`pg17/run-042-045.sh`, baseline `origin/main` `999f394`, candidate `334a7cb`): 36/36**
- Frozen history: 001-041 identical to `main`; 001-043 frozen (44 entries).
- Per-migration additivity and exact idempotency. 043a redefines exactly its four views, and every bundle view returns the same rows.
- Exactly the six staged functions with the required properties.
- Planning bound: every staged view, and every view over one, plans in under 2 MB at the top level (maximum 1.2 MB).
- Whole-schema security: 67 / 155, every table RLS, every view security_invoker.
- Verifier 223 → 243/243.
- The bundle re-applied as a no-op, and a fresh 001-045 replay equal to the incremental path.
- Anon reads under 3 s.
- Rollback:
  - the exact guarded rollback from the full bundle **and from the partial 042 + 043 state**
  - a re-apply after the rollback
  - refusal while an outside object depends on the bundle

## 3. Read-only hosted probe (`sql/bundle-042-045-probe.sql`)

| Probe section | Before the release (expected now) | After 045 |
|---|---|---|
| 041 marker | present | present |
| 042-045 marker objects (18) | all absent | all present |
| staged functions (6) / views that wrap them | all absent / false | all present, STABLE invoker granted / true |
| `expected_value_models` / `portfolio_scenario_definitions` / `disi_product_contract` | NULL (absent) | 1 / 4 / 48 |
| `outcome_targets` / `outcome_model_evaluations` / `market_groups` / `international_signing_eras` | 4 / 3 / 20 / 3 | unchanged |
| `signings` / `outcome_audits` / `outcomes` / `player_mlb_team_season_war` | 268 / 136 / 58 / 1880 | unchanged |
| `signing_environments` / `player_season_stints` / `portfolio_scenarios` / `model_predictions` | 13 / 828 / 0 / 0 | unchanged |
| analysis as-of date | 2026-10-05 | 2026-10-05 |
| 041 supported targets / supported models | 0 / 0 | 0 / 0 |
| tables / views / no-RLS / not-invoker / API beyond SELECT | 64 / 140 / 0 / 0 / 0 | 67 / 155 / 0 / 0 / 0 |
| bundle state | `bundle not applied` | `bundle applied` (a partial state names the last migration present) |

Any other value before the release: **stop**, investigate the drift first and apply nothing.

## 4. Backup (APPROVAL to connect; read-only)

This is the same procedure as before, through the scratchpad secret-safe runner. The credential comes only from
`~/.config/disi/verify.env` and is never printed.

1. Validate the credential (project ref `zpuqzmyprjiqjmvnmisa`) and run the probe (section 3).
2. Run the bundle verifier. It must show **241/243**, with only the totals failing.
3. Take a state snapshot. It must be identical to the post-rollback snapshot.
4. Take a fresh `pg_dump --format=custom --schema=public --no-subscriptions` to `~/backups/disi/disi-pre-042-045-release-<UTC>.dump`
   (folder mode 700, file mode 600). Record its size and SHA-256.
5. Restore it into disposable PostgreSQL 17 (`pg17/restore-verify.mjs`, with the `main` tree as the verifier). It must show 223/223.

## 5. Apply (APPROVAL; one window, in this order, back to back)

```
safe-run apply database/sql/042_expected_organizational_value.sql  93eedd1fe38e03036b9fb171c488499302ac510ba69d89d7d0a46fab3072a0af
safe-run apply database/sql/043_portfolio_decision_engine.sql      861f8278a97e747d06401f1df455ecc0b97dbdf82f403e178b2e53a2f70ec20f
safe-run apply database/sql/043a_decision_engine_performance.sql   9c4e0774c98bdc2e389176de584e8f545dace2ae4bc96ea31f575796add1d368
safe-run apply database/sql/044_executive_product.sql              75fcaf1b89357f7d98a16a843c3f088f8cd8d336b34130ca9aba64357ab8b520
safe-run apply database/sql/045_final_integration_release.sql      c79d407611f8d0a4e0e29ae2556abbc730eaf0e6d196c2d948851678df30db6b
```

- `apply` refuses on a SHA-256 mismatch and runs `psql -X -v ON_ERROR_STOP=1 -f`.
- Each file is one transaction, and a later file's precondition stops it on an incomplete state.
- **Known heavy step: 043.** Its committed postconditions evaluate the stacked candidate readiness. Production applied it once in
  39.7 s; the constrained replay peaked at 438 MB.
  - It is unchanged because it is frozen.
  - **043a follows immediately.** Until 043a commits, the stacked 043 views exist, but no page reads them yet.
  - Run the window when traffic is low, and run nothing else in parallel.
- **043a, 044 and 045** evaluate no analytical view during apply (0.03 s each on the constrained replay).
- **Wrapper:** the apply wrapper has a 600 s timeout per file. A file that does not finish is investigated with read-only
  `pg_stat_activity` and `pg_postmaster_start_time()` before anything else happens.
- **The database goes first:** the current production application does not read 042-045, so applying them changes no live page.

## 6. Post-apply verification (before the PR)

1. **Probe:** every value matches the "After 045" column, and `pg_postmaster_start_time()` is unchanged (no restart).
2. **Live verifier at the bundle commit:** **243/243**.
3. **Drift:** a before / after snapshot comparison shows no existing table (rows including ids and timestamps), view, ACL, policy,
   function or trigger changed. The only additions are 3 tables, 3 read policies, 15 views and the 6 staged functions.
4. **Hosted semantics:**
   - 0 supported 041 targets, 0 supported expected values, 0 optimization-eligible candidates, 0 scenario selections.
   - `v_disi_release_status.support_chain_state = 'NO_PREDICTIVE_LAYER_SUPPORTED'`.
   - The overview statement is exactly the no-probability statement.
   - Expected-value states are 157 PROBABILITY_NOT_SUPPORTED and 63 OUT_OF_SCOPE.
   - Candidate states are 137 / 1 / 30 / 52 / 0.
   - Known spend is $117.38M over 48 signings (a lower bound); realized organizational value is 298.83; value that left is 432.44.
5. **Idempotency:** re-apply 042, 043, 043a, 044 and 045 (SHA-256-checked).
   - Zero drift, and the verifier stays 243/243.
   - The 043 re-apply evaluates its committed postconditions again over the now-staged views, which is cheap.
6. **Anon performance gate**, as role anon under the 3 s timeout:
   - Read every contract relation and every new view.
   - Read the app's 13 decision queries in page order.
   - Read the heaviest queries 10 consecutive times each.
   - Run one modest concurrent read (4 visitors).
   - Watch `pg_postmaster_start_time()` throughout.
   - **Acceptance:**
     - no 57014, no permission error, no missing object, and no restart
     - no repeated read over 1.5 s server-side
     - app reads preferably under 500 ms, and the overview under 1 s

## 7. Release PR, merge and smoke (APPROVAL)

1. Open `feature/disi-042-045-decision-engine` → `main` with the description in section 9.
2. When the PR is CLEAN and the preview is green, merge with a **merge commit** (no squash, no rebase). This triggers exactly one
   Vercel production deploy; wait for READY.
3. **HTTP smoke:** `/`, `/league`, `/players`, `/signings`, `/research`, **`/portfolio`, `/prediction-readiness`** and one Dodgers
   dossier. Each must give:
   - HTTP 200
   - "Live Supabase data"
   - no "Data unavailable"
   - no missing relation or permission error
4. **Required visible results:**
   - The home page shows the executive summary with "Not published" for outcome probabilities.
   - `/prediction-readiness` shows the no-probability statement and 0 supported targets.
   - `/portfolio` shows "No predictive portfolio recommendation is made".
5. **Runtime errors:** check Vercel production runtime errors after the requests. Direct access is behind Vercel SSO, so the owner runs
   the smoke; a 302 to SSO is not a pass.
6. **Freeze:** add 043a, 044 and 045 to `tests/db/frozen-migrations.json` in a follow-up commit.

## 8. Rollback

- **During section 5:** a failed file rolled itself back. The probe's `bundle_state` names the last migration present, and the
  application is unaffected because it does not yet read the bundle.
- **After a database commit, before the merge:** run `database/release/sql/rollback-042-045.sql` (**APPROVAL**; one guarded
  transaction).
  - It drops the 15 views, the 6 staged functions (each after the view that wraps it) and the 3 tables, in reverse dependency order.
  - It refuses if anything outside the bundle depends on them.
  - It returns the database to the exact 001-041 state from the full bundle or from any partial state.
  - **Precedent:** its previous version did exactly this in production on 2026-10-14, from 042 + 043. The validator proves both the full
    and the partial case, including ids and timestamps, and that the bundle re-applies afterwards.
- **After the merge:** the 044 pages read 042-045 views.
  - A database rollback must be paired with a revert of the merge commit (`git revert -m 1 <merge>`) and one deploy.
  - Otherwise the new pages, and the home executive summary, report unavailable data. The home summary and the dossier section are
    tolerant: they disappear instead of failing.
- The rollback cannot undo writes made by later work. The section 4 backup remains the last resort.

## 9. Release PR description (draft)

> **DISI v1.0.0: expected organizational value, portfolio decision support, executive product and final integration (Migrations 042-045, with 043a)**
>
> **Headline: DISI does not yet have enough evidence to publish outcome probabilities, expected values or portfolio recommendations,
> and the product now says so explicitly.** No 041 target meets the support rule (50 labelled, 10 positive, 10 negative), and both
> fitted models were worse than the naive base rate (Brier 0.124 base rate vs 0.143 stratified and 0.139 logistic). The full
> chain is therefore NULL by construction, and the verifier proves it:
>
> | Layer | Supported today |
> |---|---|
> | Supported outcome targets | 0 |
> | Expected organizational values | 0 |
> | Value-maximizing recommendations | 0 |
> | Probability, expected value, ranking or gauge rendered in the UI | none |
>
> Descriptive and historical decision intelligence is available: realized organizational value with every component separate,
> historical distributions, retrospective allocation, and honest pool feasibility. The system refuses to manufacture predictive
> confidence.
>
> **Release note.** The initial production attempt exposed an unacceptable low-memory query-plan issue before application deployment.
> The partial database release was rolled back cleanly. A forward performance patch (043a) and a lighter executive query layer were
> validated under production-like resource constraints before re-release.
>
> - **042 Expected organizational value.**
>   - Realized organizational value per Dodgers signing, with every component separate: direct Dodgers bWAR, individually attributable
>     trade return, package participation, observable-not-attributable value, and MLB value for other clubs, which is not Dodgers
>     value.
>   - Cost components are kept separate with completeness.
>   - HISTORICAL_DESCRIPTIVE distributions.
>   - Expected value = 041 probability × supported conditional value, NULL with a reason today.
> - **043 Portfolio decision engine.**
>   - Readiness at the signing date, from signing-time facts and population-level support only.
>   - Decision-support states, each saying what DISI may and may not say.
>   - RETROSPECTIVE allocation and concentration.
>   - Pool scenarios with honest feasibility (INDETERMINATE when costs are unknown).
>   - An exact optimizer that only eligible candidates can enter; none can today.
> - **043a Decision-engine performance.**
>   - Four 042 / 043 views become wrappers over staged, read-only, invoker-rights functions.
>   - Each stage is planned only when it runs, so no statement plans the whole 041 → 042 → 043 stack. Gated per-player layers are not
>     planned while support is absent.
>   - Same rows, columns, types, grants and comments, proven in the unsupported, probability-only and supported states.
> - **044 Executive product.**
>   - An executive summary on the home page, computed by a staged function.
>   - New **Portfolio** and **Prediction Readiness** pages.
>   - An organizational-value and decision-support section in each Dodgers dossier.
>   - Predictive numbers reach a page only through `lib/decision-display.js`, which shows a number only for a supported row.
> - **045 Final integration.**
>   - The product contract: exactly the 48 relations the app reads.
>   - Release status with data freshness, model versions and `support_chain_state`.
>   - The research roadmap.
>   - Executive metric provenance.
>   - Methodology for every decision layer.
>   - Package version 1.0.0.
>
> Notable findings:
> - Among 35 mature tracked / opening-class Dodgers amateur signings with a resolved value, none produced positive realized
>   organizational value. All positive value sits in the outcome-selected historical record, which is excluded from rates by design.
> - Known spend covers 48 of 220 Dodgers signings, so every spend total is labelled a lower bound ($117.38M known). Realized
>   organizational value is 298.83 bWAR; value that left the organization (432.44 bWAR) is reported separately.
>
> Validation:
> - Focused tests, unit tests, frozen history, and the PostgreSQL 17 bundle validator (including the partial-state rollback).
> - Constrained 1 GB PostgreSQL 17 replay: every bundle read peaks at 78 MB or less. The overview dropped from 816 MB to 71 MB; at most
>   382 ms over 10 runs.
> - Verifier 243/243.
> - Migration hashes as in `database/release/042-045-release-plan.md`.
> - Production: see the release report (backup, hashes, live verifier, security, drift, idempotency, anon performance).
>
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
