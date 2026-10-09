# Canonical seed drift audit (Migration 027)

Read-only comparison of the live database (canonical through 026, verifier 101/101) against a fresh
001 → 026 replay, taken 2026-10-08. Nothing on live was written. The exact, machine-readable result
is `reconciliation-manifest.json`; this note explains it.

## Finding

The live database never received the supplementary rows of the committed Migration-002 seed, and one block of
that seed is unsupported. Live and a fresh replay therefore did not represent the same canonical facts, and the
canonical verifier (which pinned totals, not these facts) could not see it.

Every one of the 268 signings carries identical facts live and in the replay (bonus, dates, market, pathway, rank, source
links, record scope); the only signing difference is the environment link. Nothing in Migrations 017-026 reads a
missing environment, the trade or the 12 sources (`audit-report.json`).

| Category | Replay | Live | Post-027 | Notes |
| --- | --- | --- | --- | --- |
| `signing_environments` | 8 | 0 | 8 | One per Dodgers signing period (2015, 2017, 2018, 2022-2026). |
| signing → environment links | 30 | 0 | 30 | Every other guarded signing field already matches. |
| `transactions` | 5 | 4 | 5 | Arnaldo Lantigua → Cincinnati, 2025-01-17. |
| `player_aliases` | 50 | 48 | 50 | "Oneal Cruz", "Yadiel Alvarez" (`SOURCE_VARIANT`). |
| `sources` (missing) | 12 | 0 | 12 | MLB.com URLs from the seed; URL is the identity. |
| source metadata variants | 3 | 3 | 3 canonical | Same URL, different type / title / tier. |
| signing evidence (missing) | 26 | 0 | 26 | Identity: signing + field + source URL. |
| evidence variants | 3 | 3 | 3 canonical | Cartaya, De Jesús, Rosario. |
| evidence note neutralisations | 3 (original note) | 0 | 3 (neutral note) | Morales 2024, Melburne 2026, Arias 2026. |
| `trainers` / `player_trainers` | 2 / 4 | 0 / 0 | 0 / 0 | Removed from the replay; not restored live. |

The 32 canonical evidence claims are 26 plain missing claims, the 3 variants' canonical forms, and 3 neutralised claims
(below); 26 of them cite the 12 missing sources.

## Target rule

**Migration-002 canonical values are retained except for** (1) the unsupported 2-trainer / 4-link seed, which is removed, and (2) the three
trainer-asserting evidence-note strings, which are intentionally neutralised. Both are forward semantic corrections, not unexplained drift.
A live-drift state and a canonical replay converge to this same corrected target.

## Canonical target per category

- **Environments, links, trade, aliases, 12 sources, 29 evidence claims:** the committed Migration-002 value.
- **Source metadata variants:** the committed form (replay). The live row is changed only when it exactly equals the
  known variant: 2025/01 transactions page (`DODGERS_TRANSACTION_LOG` → `TRANSACTIONS`), the Cartaya article
  (`DODGERS_CLASS_RELEASE` / `OFFICIAL_CLUB_RELEASE` → `ARTICLE` / `MLB_COM_REPORTING`) and the 2025 signing-day article
  (`MLB_PIPELINE_TRACKER` / `MLB_PIPELINE` → `ARTICLE` / `MLB_COM_REPORTING`). Views that read the 018 class tables are
  unchanged by this (verified in the tests).
- **Evidence variants:** the live rows (VERIFIED, "Dodgers-announced 2018 international signing.") are the *same claim*
  as the canonical row (HIGH, "MLB.com reported the agreements and bonuses from industry sources.": same signing,
  field and source URL), written by a later migration instead of the seed. They are duplicates of one claim, not
  additional facts, so the canonical form is the target and the live row is updated in place, never deleted.
- **Legacy trainer seed:** removed. It has no provenance, was marked VERIFIED, and at least one row conflates a person with
  an academy. Removal means DISI lacks sufficient verified evidence; it does not mean no relationship existed. The legacy
  tables and views stay until 028.

## Public views affected

Substantive differences (resolved by 027): signing cohort / regime and club pool, signing leaderboard, player signing profile,
signing efficiency, the Lantigua asset-realization and case-study text, player sources, player transactions and timeline,
the signing year summary, and alias counts in the bio / directory / identity views.

`v_player_timeline` shows, per signing, the evidence that sorts first by `(field_name nulls first, created_at)`. A restored
claim therefore receives a `created_at` just before the earliest other evidence of that signing, spaced by its replay rank,
so a repaired live database shows the same source as a fresh replay.

## Differences deliberately not reconciled (non-semantic)

- **`initcap()` capitalisation:** 24 canonical-name notes read "Baseball-reference" live and "Baseball-Reference" in the
  replay, and two research-queue detail strings capitalise "Class membership" differently. The engines treat `_` differently in
  `initcap()`. New migration logic must not use `initcap()` or any locale- or engine-sensitive normalisation (Migration
  028's alias normaliser included).
- **Floating-point formatting** (`5.935` vs `5.9350000000000005`).
- **Observation / retrieval dates:** WAR "observed through" dates and the 026 `retrieved_at` stamps.

## Neutralised trainer assertions

Three committed seed notes asserted that an MLB.com article reported trainer relationships for Emil Morales (2024), Ezequiel Melburne
and Rubel Arias (2026). That wording is not carried forward. The evidence rows themselves remain, since they are signing provenance, and
their note becomes:

> Migration 002 source retained for signing provenance. Trainer/academy attribution is not carried forward pending direct source verification.

The note preserves that the source is retained as signing provenance, asserts no trainer or academy relationship, makes clear that
network attribution needs future direct verification, and does not say that no relationship existed. A replay holding the original note is
corrected in place; a live database that lacks the row receives it with the neutral note. This is separate from the three Cartaya /
De Jesús / Rosario evidence variants. The candidates for direct verification are in `research-backlog.md`.
