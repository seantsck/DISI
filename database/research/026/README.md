# Research behind migration 026

Everything needed to inspect and rebuild `database/sql/026_scouting_evaluation_history.sql`: the audit that measures the
migration's preconditions, the reviewed public evidence, the source audit, and the assembly of the migration. The design is in
`schema-design.md`; the source audit is in `source-audit.json`.

## Pipeline

| Step | Command | Output |
| --- | --- | --- |
| Reviewed input | `seed-evidence.json` (scale, publications, citations, evaluations, who has no evaluation) | — |
| 1. Audit | `node database/research/026/audit.mjs` | `audit-report.json` (exits non-zero if a precondition fails) |
| 2. Build | `node database/research/026/build.mjs` | `database/sql/026_scouting_evaluation_history.sql` |
| Harness | `node database/research/026/test-026.mjs` | builds 001→025 in PGlite, runs 026 twice |

`audit.mjs` builds the canonical chain **before** 026 in memory; it needs no network and touches no real database. It records
the legacy table's shape and dependents, scans the repository for references, splits the 59 legacy ranks into 48 with
provenance and 11 without, and checks that every player, organization and source the seed names resolves.
`026_template.sql` is hand-maintained; `build.mjs` injects the reviewed rows and the audit-measured facts.

## Data-entry policy

Seed values come only from publicly accessible pages, read in this audit; no paywall was bypassed, nothing was bulk-scraped,
and no scouting text is stored (only individual rank / grade / ETA values and short DISI paraphrases of <= 500 characters).
`mlb.com` returned HTTP 406 to automated requests and was not circumvented. FanGraphs' terms page was not located, so only
individual factual values from one page are transcribed.

## What 026 holds

- **48 backfilled evaluations**: the legacy MLB Pipeline international ranks whose signing is linked to a tracker source with a
  publication date (2013 ×20, 2014 ×28), as `INTERNATIONAL_CLASS` rankings. Every signing date is unknown, so no
  chronology is claimed: the context is `INTERNATIONAL_CLASS_LIST` (an international signing-class list, not an MLB-wide one), never `GLOBAL_LIST` or `PRE_SIGNING`. Includes the benchmark cases Eloy Jiménez (#1),
  Gleyber Torres (#3) and Rafael Devers (#6) of the 2013 class.
- **3 hand-researched evaluations** (values read from the pages on 2026-10-08):
  - FanGraphs Dodgers Top 53 (published 2025-12-05): **Josue De Paula** rank 1, FV 55, ETA 2027, with present/future tool grades;
    **Emil Morales** rank 4, FV 50, ETA 2030. Verified by parsing the downloaded HTML tables.
  - **Roki Sasaki**: No. 1 on Baseball America's Top 100 for 2025, released Wednesday 2025-01-22, reported by Sports
    Illustrated (a **secondary citation**: Baseball America's list itself was not read).
- **No verified evaluation found** (kept valid on purpose): Roger Cedeño, Carlos Frías, and the candidates listed in
  `seed-evidence.json` (Yordan Álvarez, Oneil Cruz, Julio Urías, Yusniel Díaz, Yadier Álvarez, Diego Cartaya).
- **11 unsourced legacy ranks** (Dodgers 2015 ×4, 2018, 2019, 2023 ×2, 2024, 2025, 2026): not evaluation facts; queued as
  `LEGACY_RANK_WITHOUT_EVALUATION`.

Totals: 3 publications, 1 scale, 51 evaluations, 51 rankings, 13 grades, 1 note, 2 added sources.

## Research queue at 026 (counts are research coverage, not invariants)

LEGACY_RANK_WITHOUT_EVALUATION 11 · MISSING_ARCHIVE_REFERENCE 3 (targeted: the two FanGraphs evaluations of a page edited after publication, and the
Sasaki secondary citation; a missing archive URL alone is not an issue) · PLAYER_WITHOUT_SCOUTING_HISTORY 53 · SIGNING_WITHOUT_SIGNING_EVALUATION 41 ·
EVALUATION_DATE_IMPRECISE 0 · EVALUATION_WITHOUT_DATE 0. Conditions the schema forbids (rank without scope, grade without scale,
evaluation without a source) cannot occur and are not queued; differing opinions between publications are not conflicts.

## Limitations

- The FanGraphs values are as displayed on 2026-10-08; the page was last modified 2026-02-09 and has no archive snapshot, so
  they are recorded at MEDIUM confidence.
- `v_dodgers_scouting_at_signing` is nearly empty by design: the ranked Dodgers signings are exactly the 11 unsourced legacy
  ranks, which are not shown as evaluation facts.
- Re-valuation and expected-vs-realized views are deferred until coverage supports them.
