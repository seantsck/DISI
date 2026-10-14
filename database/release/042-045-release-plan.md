# Migrations 042-045 bundle (DISI v1.0.0): release plan

Prepared 2026-10-14 on the Hetzner VPS. **Nothing in this document has been executed against the hosted database.** Every step marked
**APPROVAL** needs an explicit go-ahead from the owner. One controlled window: one backup, 042 → 043 → 044 → 045, one release PR, one
Vercel production deploy (this release **does** change the application).

## 0. Identity

| Item | Value |
|---|---|
| Bundle branch | `feature/disi-042-045-decision-engine` (pushed), based on `main` `999f394` (production: 001-041) |
| Hosted baseline | 001-041, live verifier 223/223, 64 tables / 140 views, analysis as-of 2026-10-05 |
| Frozen history | 001-041 frozen in `tests/db/frozen-migrations.json` (42 entries, 0 mismatches; 039-041 frozen by `6b88d9e`) |

| File | Bytes | SHA-256 | SHA-1 (content, LF) |
|---|---|---|---|
| `042_expected_organizational_value.sql` | 28784 | `93eedd1fe38e03036b9fb171c488499302ac510ba69d89d7d0a46fab3072a0af` | `696e2436480b9b20d0b62039bb481fd4ff5ed0b6` |
| `043_portfolio_decision_engine.sql` | 28587 | `861f8278a97e747d06401f1df455ecc0b97dbdf82f403e178b2e53a2f70ec20f` | `e9e71b5491a20f8ad8da63f64b46663492da9fb0` |
| `044_executive_product.sql` | 11553 | `3c76448590e60572ad40566bd25b030edb7a3ae05cdbce34266572e6d43de9ee` | `1f04f5782f7c7b114a2b2a718f3b86217d8512a5` |
| `045_final_integration_release.sql` | 29555 | `916fa138b9a3ecfd5e9726e7afb811793693f36779448b74ae7b6c7fb8c99e75` | `4ce5c71c886abc52c820e2b4e1fea38863a6c4e4` |

Each file is one `begin` … `commit` transaction with guarded preconditions and postconditions:

| File | Precondition |
|---|---|
| 042 | 034 and 041 present |
| 043 | 042 present |
| 044 | 042 and 043 present |
| 045 | 044 present |

All four files are idempotent and contain no CRLF.

## 1. What changes

### Database (derived; no existing fact, view, grant, policy, function or trigger is touched)

| | 042 | 043 | 044 | 045 | Total |
|---|---|---|---|---|---|
| New tables (RLS, public-read policy, SELECT-only) | `expected_value_models` (1 row) | `portfolio_scenario_definitions` (4) | — | `disi_product_contract` (48) | 3 tables, 53 rows |
| New views (security_invoker, anon / authenticated SELECT) | 5 | 5 | 2 | 3 | 15 |
| Verifier checks added | 5 | 5 | 3 | 5 | 18 |
| Existing tables written / views redefined / ACLs changed | 0 | 0 | 0 | 0 | 0 |

- **Public schema:** 64 tables / 140 views before, **67 tables / 155 views after**. The analysis as-of date (2026-10-05) does not move.
- **Live verifier after the release: 241/241.**
- **Before the release,** the bundle verifier reports 239/241 against production; only `public_views_total` (140) and
  `public_tables_total` (64) differ. Confirmed on a 001-041 replay.

### Application (the first bundle since 035 that changes pages)

| Route | Change | Reads (new) |
|---|---|---|
| `/` | Executive summary above the database status | `v_executive_overview`: 1 row, read after the existing four-query batch |
| `/portfolio` (new) | Decision-support states, retrospective allocation, pool scenarios | 4 sequential queries with column lists |
| `/prediction-readiness` (new) | Current state, evidence by target, recorded evaluation, value-model blockers | 4 sequential queries |
| `/players/[slug]` | "Organizational value and decision support" for Dodgers signings | 4 sequential queries after the existing batch, filtered by player |
| Nav, Methodology, footer | Two links; decision-layer section; `DISI v1.0.0` | — |

The other routes (`/signings`, `/players`, `/markets`, `/development`, `/asset-conversion`, `/league`, `/research`) are unchanged.

## 2. Evidence (final checkpoint)

**Tests**
- Focused tests: 042 13/13, 043 10/10, 044 9/9, 045 9/9.
- Unit tests for the decision product: 6/6.
- Full suite once (`ae402e3`, concurrency 2, 62 min): 526/527. The one failure was a stale 041-era grant pin in
  `tests/db/migrations.test.mjs` (140 views / 64 tables, now 155 / 67). After that pin was updated, the file was rerun
  alone: 125/125.

**Real PostgreSQL 17 bundle validator (`pg17/run-042-045.sh`, `ae402e3`): 29/29**
- Replays the released 001-041 and applies 042 → 045.
- Per-migration additivity and exact idempotency.
- Whole-schema security.
- Verifier 223 → 241.
- The bundle re-applied as a no-op.
- A fresh 001-045 replay equal to the incremental path.
- Anon reads under 3 s.
- The exact guarded rollback, and a re-apply after the rollback.

**Anon performance**
- Every product-contract relation was read in full as anon on local PostgreSQL 17, with server-side maxima over 3 reads.
- New views:
  - `v_executive_overview`: 257 ms (warm 190 ms)
  - `v_historical_portfolio_summary`: 102 ms
  - `v_player_realized_organizational_value`: 94 ms
  - `v_portfolio_scenario_evaluation`: 91 ms
  - `v_portfolio_candidate_readiness`: 90 ms
  - every other new view ≤ 80 ms
- `v_research_roadmap`, which is not read by a page, is about 155 ms.
- The three pre-existing `/development` views remain the slowest app reads, at about 270 ms.
- The cold first reads in the fresh validator cluster (no planner statistics) were higher, up to 737 ms (`v_disi_release_status`).
  Production runs 2-6× slower than local, so the hosted gate in section 6 decides.

## 3. Read-only hosted probe (`sql/bundle-042-045-probe.sql`)

| Probe section | Before the release (expected now) | After 045 |
|---|---|---|
| 041 marker | present | present |
| 042-045 marker objects (18) | all absent | all present |
| `expected_value_models` / `portfolio_scenario_definitions` / `disi_product_contract` | NULL (absent) | 1 / 4 / 48 |
| `outcome_targets` / `outcome_model_evaluations` / `market_groups` / `international_signing_eras` | 4 / 3 / 20 / 3 | unchanged |
| `signings` / `outcome_audits` / `outcomes` / `player_mlb_team_season_war` | 268 / 136 / 58 / 1880 | unchanged |
| `signing_environments` / `player_season_stints` / `portfolio_scenarios` / `model_predictions` | unchanged facts / 828 / 0 / 0 | unchanged |
| analysis as-of date | 2026-10-05 | 2026-10-05 |
| 041 supported targets / supported models | 0 / 0 | 0 / 0 |
| tables / views / no-RLS / not-invoker / API beyond SELECT | 64 / 140 / 0 / 0 / 0 | 67 / 155 / 0 / 0 / 0 |

Any other value before the release: **stop**, investigate the drift first and apply nothing.

## 4. Backup (APPROVAL to connect; read-only)

The same procedure as the 039-041 release, through the scratchpad secret-safe runner. The credential comes only from
`~/.config/disi/verify.env` and is never printed.

1. Validate the credential (project ref `zpuqzmyprjiqjmvnmisa`), run the probe (section 3), and run the bundle verifier, which must
   show 239/241 with only the totals failing.
2. Take a state snapshot.
3. `pg_dump --format=custom --schema=public --no-subscriptions` to `~/backups/disi/disi-pre-042-045-release-<UTC>.dump` (folder mode
   700, file mode 600), and record its size and SHA-256.
4. Restore it into disposable PostgreSQL 17 (`pg17/restore-verify.mjs`, with the `main` tree as the verifier). It must show 223/223.

## 5. Apply (APPROVAL; one window, in this order)

```
safe-run apply database/sql/042_expected_organizational_value.sql  93eedd1fe38e03036b9fb171c488499302ac510ba69d89d7d0a46fab3072a0af
safe-run apply database/sql/043_portfolio_decision_engine.sql      861f8278a97e747d06401f1df455ecc0b97dbdf82f403e178b2e53a2f70ec20f
safe-run apply database/sql/044_executive_product.sql              3c76448590e60572ad40566bd25b030edb7a3ae05cdbce34266572e6d43de9ee
safe-run apply database/sql/045_final_integration_release.sql      916fa138b9a3ecfd5e9726e7afb811793693f36779448b74ae7b6c7fb8c99e75
```

- `apply` refuses on a SHA-256 mismatch and runs `psql -X -v ON_ERROR_STOP=1 -f`.
- Each file is one transaction; a later file's precondition stops it on an incomplete state.
- On PostgreSQL 17 the four files took 1.1 s, 0.7 s, 2.6 s and 0.1 s.
- **The database goes first:** the current production application does not read 042-045, so applying them changes no live page.

## 6. Post-apply verification (before the PR)

1. **Probe:** every value matches the "After 045" column.
2. **Live verifier at the bundle commit:** **241/241**.
3. **Drift:** a before / after snapshot comparison shows no existing table (rows including ids and timestamps), view, ACL, policy,
   function or trigger changed. The only additions are 3 tables, 3 read policies and 15 views.
4. **Hosted semantics:**
   - 0 supported 041 targets, 0 supported expected values, 0 optimization-eligible candidates, 0 scenario selections.
   - `v_disi_release_status.support_chain_state = 'NO_PREDICTIVE_LAYER_SUPPORTED'`.
   - The overview statement is exactly the no-probability statement.
   - Content fingerprints of the 15 views and 3 tables match the local replay, ignoring generated ids.
5. **Idempotency:** re-apply 042, 043, 044 and 045 (SHA-256-checked). Zero drift; the verifier stays 241/241.
6. **Anon performance gate.**
   - Read every new view as anon under the 3 s timeout.
   - Read the five slowest at least 5 consecutive times each, with server-side EXPLAIN timings.
   - **Also time the new app reads as the app issues them:**
     - `v_executive_overview` (home)
     - the four portfolio and four readiness queries in sequence
     - the dossier's four filtered queries for a Dodgers player
   - Acceptance: no 57014 and meaningful headroom. A view that repeatedly passes about 2 s blocks the PR, and a query-shape fix-forward
     follows the 038a pattern (`042a` …).

## 7. Release PR, merge and smoke (APPROVAL)

1. Open `feature/disi-042-045-decision-engine` → `main` with the description in section 9.
2. When the PR is CLEAN and the preview is green, merge with a **merge commit** (no squash, no rebase). This triggers exactly one
   Vercel production deploy; wait for READY.
3. **HTTP smoke:** `/`, `/league`, `/players`, `/signings`, `/research`, **`/portfolio`, `/prediction-readiness`** and one Dodgers
   dossier (for example `/players/<slug>` of a mature Dodgers MLB player). Each must give:
   - HTTP 200
   - "Live Supabase data"
   - no "Data unavailable"
   - no missing relation or permission error
4. **Required visible results:**
   - The home page shows the executive summary with "Not published" for outcome probabilities.
   - `/prediction-readiness` shows the no-probability statement and 0 supported targets.
   - `/portfolio` shows "No predictive portfolio recommendation is made".
5. **Runtime errors:** Vercel production runtime errors after the requests. Direct access is behind Vercel SSO, so the owner runs the
   smoke; a 302 to SSO is not a pass.
6. **Freeze:** add 042-045 to `tests/db/frozen-migrations.json` in a follow-up commit.

## 8. Rollback

- **During section 5:** a failed file rolled itself back; the probe shows which of 042-045 are present. The application is unaffected
  because it does not yet read them.
- **After the database commit, before the merge:** run `database/release/sql/rollback-042-045.sql` (**APPROVAL**; one guarded
  transaction).
  - It drops the 15 views and 3 tables in reverse dependency order.
  - It refuses if anything outside the bundle depends on them.
  - It returns the database to the exact 001-041 state, proven on PostgreSQL 17 including ids and timestamps, and the bundle re-applies
    afterwards.
- **After the merge:** the 044 pages read 042-045 views. A database rollback must be paired with a revert of the merge commit
  (`git revert -m 1 <merge>`), and one deploy. Otherwise the new pages, and the home executive summary, report unavailable data. The
  home summary and the dossier section are tolerant: they disappear instead of failing.
- The rollback cannot undo writes made by later work. The section 4 backup remains the last resort.

## 9. Release PR description (draft)

> **DISI v1.0.0: expected organizational value, portfolio decision support, executive product and final integration (Migrations 042-045)**
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
> - **044 Executive product.**
>   - An executive summary on the home page.
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
> - Known spend covers 48 of 220 Dodgers signings, so every spend total is labelled a lower bound.
>
> Validation:
> - Focused tests 13 + 10 + 9 + 9 and unit tests 6 (including the end-to-end support-propagation chain, leakage, NULL-safety and
>   switch tests); full suite 527/527 (after one stale pin was updated).
> - Real PostgreSQL 17 bundle validator 29/29.
> - Verifier 241/241.
> - Deterministic builders; lint, typecheck and Next.js build.
> - Production: see the release report (backup, hashes, live verifier, security, drift, idempotency, anon performance).
>
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
