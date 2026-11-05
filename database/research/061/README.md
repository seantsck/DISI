# 061 transaction and identity closure: audit

This directory holds the **scope audit only** for Migration 061. No migration, rollback, template, release plan or manifest change exists. Production was not read or written.

| File | What it is |
|---|---|
| `owner-research-input.json` | The owner's 52 findings as supplied on 2026-11-05, each with its candidate source. Nothing in it is corroborated. |
| `baseline.json` | The state the audit started from: `main` 318a724, 64 frozen migrations, the replay through 060 (known cost 81 / 139, CAREER_BWAR 58, BWAR_MISSING 39, transaction queue 57, value queue 79), the production figures recorded at the 060 release, and the transaction-asset inventory. |
| `mapping.json` | Every item mapped to the current schema, with its single classification, amount quality, proposed table and field, provenance, source check, queue and value effect, and materiality. Classification counts at the top. |
| `materiality.json` | MATERIAL or LOW_MATERIALITY for each transaction item and what it blocks. No dollar amount is estimated. |
| `audit-report.md` | The three audit tables, the proposed (unbuilt) 061 scope, the measured effect, the owner decisions and the blockers. |

Amount quality is kept explicit as EXACT, APPROXIMATE, UNDISCLOSED, CONDITIONAL or UNKNOWN. The database has no such column, so it lives in these files only, and `DEFER_LOW_MATERIALITY` is an audit label, not a database status.

Excluded: the 39 `BWAR_MISSING` cases, which belong to 062.
