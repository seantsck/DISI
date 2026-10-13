# Migrations 039-041 bundle: release plan

Prepared 2026-10-13 on the Hetzner VPS. **Nothing in this document has been executed against the hosted database.** Every step marked
**APPROVAL** needs an explicit go-ahead from the owner. One controlled window: one backup, 039 then 040 then 041, one release PR,
one Vercel production deploy.

## 0. Identity

| Item | Value |
|---|---|
| Bundle branch | `feature/disi-039-041-predictive-intelligence` (pushed), based on `main` `ea90453` (production: 001-038a) |
| Hosted baseline | 001-038a, live verifier 207/207, 60 tables / 125 views |
| Frozen history | 001-038a byte-identical to `main` and frozen in `tests/db/frozen-migrations.json` (39 entries; 038a frozen by `3d229a1`) |

| File | Bytes | SHA-256 | SHA-1 (content, LF) |
|---|---|---|---|
| `039_market_pathway_intelligence.sql` | 27457 | `593ddccfc7df5200225505fb0f580cf2951c01f62ca887a412a60fb3f3371d10` | `8e4d82fabab6f46b38395560fc19eb5d8cd6854e` |
| `040_historical_archetypes_comparables.sql` | 17114 | `740d52bf46677a0490948148fe542f8ea6b7488611f00c0cd371b4f990f7d6ab` | `9f33ea9dfa4b72567d36dd7bf16c8b5b22413c27` |
| `041_outcome_probability_infrastructure.sql` | 38391 | `78082e0a20c9e41e879077620479f66bc4fd82c1533291df29d70a2ea6aad84b` | `00a960d0404409ef99c5a5d170312d53fbcbf0d7` |

Each file is one `begin` … `commit` transaction with guarded preconditions (039 needs 038a's objects; 040 needs 039; 041 needs 040)
and postconditions. All three are idempotent and contain no CRLF.

## 1. What changes (derived; no existing fact, view, grant, policy or function is touched)

| | 039 | 040 | 041 | Total |
|---|---|---|---|---|
| New tables (RLS, public-read policy, SELECT-only) | `market_groups` (20 rows), `international_signing_eras` (3) | — | `outcome_targets` (4), `outcome_model_evaluations` (3) | 4 tables, 30 rows |
| New views (security_invoker, anon / authenticated SELECT) | 4 | 5 | 6 | 15 |
| Verifier checks added | 5 | 5 | 6 | 16 |
| Existing tables written / views redefined / ACLs changed | 0 | 0 | 0 | 0 |

Public schema: 60 tables / 125 views before, **64 tables / 140 views after**. The analysis as-of date (2026-10-05) does not move.
**Live verifier expected count after the release: 223/223**, with the bundle commit's verifier. Before the release the bundle verifier
correctly reports 221/223 against production: only `public_views_total` and `public_tables_total` differ.

## 2. Evidence (bundle checkpoint)

See the final report of the checkpoint for the full suite. The real-PostgreSQL 17 validator (`pg17/run-039-041.sh`) runs the released
001-038a → 039 → 040 → 041. It checks:
- per-migration additivity and exact idempotency
- whole-schema security
- verifier 207 → 223
- the bundle re-applied as a no-op
- a fresh 001-041 replay equal to the incremental path
- anon reads under 3 s
- the exact rollback, and a re-apply after the rollback

## 3. Read-only hosted probe (`sql/bundle-039-041-probe.sql`)

| Probe section | Before the release (expected now) | After 041 |
|---|---|---|
| 038 marker / 038a query shape | present / true | present / true |
| 039-041 marker objects (19) | all absent | all present |
| `market_groups` / `international_signing_eras` / `outcome_targets` / `outcome_model_evaluations` | NULL (absent) | 20 / 3 / 4 / 3 |
| `scouting_expectation_bands` / `signings` / `player_evaluations` | 15 / 268 / 51 | unchanged |
| `player_season_stints` / `development_progression_decisions` | 828 / 20 | unchanged |
| `player_network_relationships` / `network_entities` | 9 / 9 | unchanged |
| `outcome_audits` / `outcomes` / `player_mlb_team_season_war` | 136 / 58 / 1880 | unchanged |
| analysis as-of date | 2026-10-05 | 2026-10-05 |
| tables / views / no-RLS / not-invoker / API beyond SELECT | 60 / 125 / 0 / 0 / 0 | 64 / 140 / 0 / 0 / 0 |

Any other value before the release: **stop**, investigate the drift first and apply nothing. The 041 evaluation carries a training-set
fingerprint. If production data differed from the replay, `v_outcome_model_evaluation.evaluation_current` would be false after the
apply and the queue would list MODEL_EVALUATION_STALE: report it, never cite the evaluation. The convergence evidence says it will
match.

## 4. Backup (APPROVAL to connect; read-only)

The same procedure as the 036-038 release, through the scratchpad secret-safe runner. The credential comes only from
`~/.config/disi/verify.env` and is never printed.

1. Validate the credential (project ref `zpuqzmyprjiqjmvnmisa`), run the probe (section 3) and the 038a-era verifier (207/207).
2. `pg_dump --format=custom --schema=public --no-subscriptions` to `~/backups/disi/disi-pre-039-041-release-<UTC>.dump` (mode 600), and
   record its size and SHA-256.
3. Restore it into disposable PostgreSQL 17 (`pg17/restore-verify.mjs`, with the `main` tree as the verifier). It must show 207/207.

## 5. Apply (APPROVAL; one window, in this order)

```
safe-run apply database/sql/039_market_pathway_intelligence.sql        593ddccfc7df5200225505fb0f580cf2951c01f62ca887a412a60fb3f3371d10
safe-run apply database/sql/040_historical_archetypes_comparables.sql  740d52bf46677a0490948148fe542f8ea6b7488611f00c0cd371b4f990f7d6ab
safe-run apply database/sql/041_outcome_probability_infrastructure.sql 78082e0a20c9e41e879077620479f66bc4fd82c1533291df29d70a2ea6aad84b
```

- `apply` refuses on a SHA-256 mismatch and runs `psql -X -v ON_ERROR_STOP=1 -f`.
- Each file is one transaction, and a later file's precondition stops it before it can run on an incomplete state.
- On PostgreSQL 17 the three took 44 ms, 118 ms and 291 ms.

## 6. Post-apply verification

1. Probe: every value matches the "After 041" column.
2. Live verifier at the bundle commit: **223/223**.
3. Drift: a snapshot comparison before and after shows that no existing table (rows including ids and timestamps), view, ACL, policy,
   function or trigger changed. The only additions are the 4 tables, their 4 read policies and the 15 views.
4. Idempotency: re-apply 039, 040 and 041 (SHA-256-checked); zero drift, and the verifier stays 223/223.
5. `v_outcome_model_evaluation.evaluation_current` is true for all 3 rows.
6. **Anon performance gate (from the 038 experience).** Every new view is read as anon under the 3 s timeout:
   - at least 5 consecutive reads of each of the five heaviest:
     - `v_market_pathway_player_context`
     - `v_market_pathway_summary`
     - `v_archetype_research_queue`
     - `v_player_outcome_probability`
     - `v_player_comparable_summary`
   - plus server-side EXPLAIN timings

   Local PostgreSQL 17, anon, server-side maxima over 7 reads:

   | View | Max |
   |---|---|
   | `v_market_pathway_player_context` | 66 ms |
   | `v_market_pathway_summary` | 60 ms |
   | `v_archetype_research_queue` | 73 ms |
   | `v_player_outcome_probability` | 56 ms |
   | `v_outcome_probability_research_queue` | 40 ms |
   | `v_player_comparable_summary` | 40 ms |
   | every other new view | ≤ 35 ms |

   Production ran 2-6× slower than local when warm in the 038 release, and cold reads spiked further. Acceptance: no 57014, and
   meaningful headroom. A view that repeatedly passes 2 s blocks the PR, and a query-shape fix-forward follows the 038a pattern.
7. **APPROVAL:** merge the release PR (merge commit), which triggers one Vercel production deploy. No application code changed. Smoke
   `/`, `/league`, `/players`, `/signings` and `/research`, then check runtime errors. Freeze 039-041 in a follow-up commit.

## 7. Rollback

- **During section 5:** a failed file rolled itself back; the probe shows which of 039 / 040 / 041 are present.
- **After commit:** run `database/release/sql/rollback-039-041.sql` (**APPROVAL**; one guarded transaction). It drops the 15 views and 4
  tables in reverse dependency order, and refuses if anything outside the bundle depends on them. The result is the exact 001-038a
  state, proven on PostgreSQL 17 including ids and timestamps, and the bundle re-applies afterwards. The section 4 backup remains the
  last resort.
- **App:** the app does not read the new views, so no app change is needed for a database rollback.

## 8. Release PR description (draft)

> **DISI v0.30-v0.32: market context, historical comparables and outcome-probability infrastructure (Migrations 039-041)**
>
> One coherent stack, derived from existing canonical facts: a leakage-safe signing-time feature record → market / pathway context →
> explainable historical comparables → censoring-aware outcome-probability infrastructure. 4 reference tables (30 reviewed rows) and
> 15 security-invoker views; no existing table, view, grant, policy or function changes.
>
> - **039 Market / country / pathway intelligence.**
>   - Reviewed market groups and league eras for international amateur signings.
>   - `v_signing_time_features`: no outcome, position at signing only, an expectation only if dated by the signing cutoff.
>   - Summaries by dimension and population class. Never pooled, outcome-selected rows carry no share, no market is ranked.
> - **040 Historical archetypes and comparables.**
>   - Structured archetype keys.
>   - Up to 20 earlier-signed, non-outcome-selected comparables per signing, chosen only from signing-time features, every matched
>     dimension listed, outcomes attached afterwards.
>   - Benchmark and Dodgers comparables stay separable, and shares need 10+ mature audited comparables of one class.
> - **041 Outcome-probability infrastructure.**
>   - Four fixed-horizon targets.
>   - Labels exist only after the horizon has elapsed; unaudited, young or active players are never negatives; the outcome-selected
>     historical set never trains.
>   - A recorded leave-one-signing-year-out evaluation on 59 rows with 8 positives. **No model beats the base rate** (Brier skill
>     −0.12 / −0.15), and no reference population reaches the 50 / 10 / 10 support minimums. So **every probability is NULL with a
>     reason**, and the research queue says how much more evidence each target needs.
>
> Validation: focused tests 11 + 10 + 12 (including automated leakage, censoring, no-negative-coercion and support-switch tests); full
> suite once; real PostgreSQL 17 bundle validator 26/26; verifier 223/223; deterministic builders and evaluation; lint, typecheck.
>
> 🤖 Generated with [Claude Code](https://claude.com/claude-code)
