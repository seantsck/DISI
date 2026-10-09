# Migration 030: financial acquisition intelligence

`database/sql/030_financial_acquisition_intelligence.sql` is generated from this folder:

```
node database/research/030/audit.mjs     # replays 001-029 in memory, checks every guard input -> audit-report.json
node database/research/030/build.mjs     # template + seed -> the migration (deterministic)
node database/research/030/test-030.mjs  # local harness: applies 030 twice on 001-029, writes financial-coverage.json
```

| File | Purpose |
|---|---|
| `seed-evidence.json` | Reviewed, directly read facts: sources, signing reports, environment reports, pool treatments, the component-rule matrix, the reviewed Ryu changes and the 2019-20 environment |
| `030_template.sql` | Hand-written schema, triggers, backfill, views, guards and postconditions (`{{payload_json}}` placeholder) |
| `build.mjs` | Validates the seed (vocabulary, basis / precision / derivation arithmetic, rule matrix) and writes the migration |
| `audit.mjs` / `audit-report.json` | Pre-030 facts the guards depend on, data-derived backfill counts, legacy WAR-view definition hashes |
| `test-030.mjs` / `financial-coverage.json` | Harness and the resulting research-progress counts (regenerated, never hand-edited) |
| `schema-design.md` | Model, vocabularies, reconciliation and completeness rules |
| `source-audit.md` / `.json` | What was read, how, and what each source supports |
| `research-backlog.md` | Leads not seeded |
| `legacy-war-per-dollar-views.md` | Limitations of the untouched legacy WAR-per-dollar views, and how 030's data change moves their outputs |

## What 030 establishes

- **Ledgers:** 103 signing reports (14 external, 89 legacy carry-forward, 0 DISI rule-derived; 2
  external reports have a rule-derived basis) and 18 environment reports (8 external, 10 legacy).
  Legacy counts are derived from data: every pre-030 non-null column without field-level evidence.
- **Ryu:** bonus $5,000,000 (Baseball America, CBS) is now canonical. The posting fee is the exact
  reported $25,737,737.33; the $25.7M forms stay as ROUNDED corroboration.
- **Sasaki:** two ACTIVE posting reports ($1,625,000 at 25% and $1,300,000 at 20%). The canonical fee is
  NULL and a FINANCIAL_REPORT_CONFLICT is queued.
- **Pool treatment:**
  - SUBJECT, from source statements: Sasaki, Yadier Alvarez, Yusniel Diaz, Omar Estevez.
  - NOT_APPLICABLE, from a source statement: Puig.
  - NOT_APPLICABLE by the pre-pool rule: 32 signings.
  - Everything else stays UNKNOWN.
- **Environments:** a Dodgers 2019-20 environment from the period summary (pool $5,366,400), with its
  3 population members linked; 9 environments in all. The 2015-16 facts are spend ~$45M
  (APPROXIMATE), tax rate 1.0 (no tax amount) and $700,000 after trades.
- **Utilization:** source-reported only for 2019-20 (99.8%); true DISI-row utilization nowhere.

The legacy WAR-per-dollar views are untouched (see `legacy-war-per-dollar-views.md`). The app is unchanged.
